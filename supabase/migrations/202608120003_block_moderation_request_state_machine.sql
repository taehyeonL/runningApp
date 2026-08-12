-- Blocking, moderation and connection-request state machine.
-- The database is the source of truth: UI state cannot bypass these transitions.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.request_resolution_reason as enum (
  'accepted',
  'recipient_declined',
  'requester_cancelled',
  'expired_timeout',
  'blocked',
  'consent_withdrawn',
  'moderation_restricted',
  'duplicate_cleanup',
  'legacy_migration'
);

alter table public.connection_requests
  add column resolution_reason public.request_resolution_reason,
  add column status_changed_at timestamptz;

update public.connection_requests
   set resolution_reason = case status
         when 'accepted' then 'accepted'::public.request_resolution_reason
         when 'declined' then 'recipient_declined'::public.request_resolution_reason
         when 'cancelled' then 'legacy_migration'::public.request_resolution_reason
         when 'expired' then 'expired_timeout'::public.request_resolution_reason
         else null
       end,
       status_changed_at = coalesce(responded_at, created_at),
       responded_at = case
         when status = 'pending' then null
         else coalesce(responded_at, created_at)
       end;

alter table public.connection_requests
  alter column status_changed_at set default now(),
  alter column status_changed_at set not null,
  add constraint connection_requests_resolution_shape_check check (
    (status = 'pending' and responded_at is null and resolution_reason is null)
    or
    (status <> 'pending' and responded_at is not null and resolution_reason is not null)
  ),
  add constraint connection_requests_resolution_matches_status_check check (
    (status = 'pending' and resolution_reason is null)
    or (status = 'accepted' and resolution_reason = 'accepted')
    or (status = 'declined' and resolution_reason = 'recipient_declined')
    or (status = 'expired' and resolution_reason = 'expired_timeout')
    or (status = 'cancelled' and resolution_reason in (
      'requester_cancelled', 'blocked', 'consent_withdrawn',
      'moderation_restricted', 'duplicate_cleanup', 'legacy_migration'
    ))
  );

-- Resolve legacy opposite-direction pending duplicates deterministically before
-- creating the canonical-pair unique index.
with ranked_pending as (
  select id,
         row_number() over (
           partition by least(requester_id, recipient_id), greatest(requester_id, recipient_id)
           order by created_at, id
         ) as pair_rank
    from public.connection_requests
   where status = 'pending'
)
update public.connection_requests r
   set status = 'cancelled',
       resolution_reason = 'duplicate_cleanup',
       responded_at = now(),
       status_changed_at = now()
  from ranked_pending duplicate
 where duplicate.id = r.id and duplicate.pair_rank > 1;

create unique index connection_requests_one_pending_canonical_pair_idx
  on public.connection_requests (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  ) where status = 'pending';

create index connection_requests_pending_expiry_idx
  on public.connection_requests (expires_at, id)
  where status = 'pending';

create table public.connection_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.connection_requests(id) on delete restrict,
  from_status public.request_status,
  to_status public.request_status not null,
  reason public.request_resolution_reason,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_kind text not null check (actor_kind in ('user', 'system')),
  occurred_at timestamptz not null default now(),
  check (from_status is null or from_status <> to_status)
);
create index connection_request_events_request_time_idx
  on public.connection_request_events(request_id, occurred_at, id);
alter table public.connection_request_events enable row level security;

create or replace function public.enforce_connection_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requester_id <> old.requester_id
     or new.recipient_id <> old.recipient_id
     or new.template_key <> old.template_key
     or new.message is distinct from old.message
     or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at then
    raise exception 'Connection request identity and proposal fields are immutable'
      using errcode = '23000';
  end if;

  if new.status = old.status then
    if new.responded_at is distinct from old.responded_at
       or new.resolution_reason is distinct from old.resolution_reason
       or new.status_changed_at is distinct from old.status_changed_at then
      raise exception 'State metadata can change only with status'
        using errcode = '23000';
    end if;
    return new;
  end if;

  if old.status <> 'pending'
     or new.status not in ('accepted', 'declined', 'cancelled', 'expired') then
    raise exception 'Invalid connection request transition: % -> %', old.status, new.status
      using errcode = '23000';
  end if;

  new.status_changed_at := now();
  new.responded_at := now();
  return new;
end;
$$;

create trigger connection_requests_enforce_transition
before update on public.connection_requests
for each row execute function public.enforce_connection_request_transition();

create or replace function public.audit_connection_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.connection_request_events (
      request_id, from_status, to_status, reason, actor_id, actor_kind
    ) values (
      new.id, null, new.status, new.resolution_reason, auth.uid(),
      case when auth.uid() is null then 'system' else 'user' end
    );
  elsif new.status is distinct from old.status then
    insert into public.connection_request_events (
      request_id, from_status, to_status, reason, actor_id, actor_kind
    ) values (
      new.id, old.status, new.status, new.resolution_reason, auth.uid(),
      case when auth.uid() is null then 'system' else 'user' end
    );
  end if;
  return new;
end;
$$;

create trigger connection_requests_audit_transition
after insert or update on public.connection_requests
for each row execute function public.audit_connection_request_transition();

-- Existing requests predate the audit trigger. Seed one immutable baseline event
-- per request so later investigations have a complete current-state snapshot.
insert into public.connection_request_events (
  request_id, from_status, to_status, reason, actor_id, actor_kind, occurred_at
)
select id, null, status, resolution_reason, null, 'system', status_changed_at
  from public.connection_requests;

create or replace function private.has_active_moderation_action(
  checked_user_id uuid,
  checked_action_types text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.moderation_actions ma
     where ma.subject_id = checked_user_id
       and ma.action_type = any(checked_action_types)
       and ma.starts_at <= now()
       and (ma.ends_at is null or ma.ends_at > now())
  );
$$;

create or replace function private.can_view_relationship(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.is_blocked(other_user_id)
    and not private.has_active_moderation_action(
      auth.uid(), array['suspension', 'ban']
    )
    and not private.has_active_moderation_action(
      other_user_id, array['suspension', 'ban']
    );
$$;

create or replace function private.is_pair_visible(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and auth.uid() <> other_user_id
    and not public.is_blocked(other_user_id)
    and public.has_current_consent('terms')
    and public.has_current_consent('privacy')
    and public.has_current_consent('location')
    and exists (
      select 1
        from public.profiles me
        join public.profiles other on other.id = other_user_id
       where me.id = auth.uid()
         and me.age_verified_at is not null
         and me.discovery_enabled = true
         and other.age_verified_at is not null
         and other.discovery_enabled = true
         and other.profile_visibility in ('profile', 'matching')
    )
    and not exists (
      select 1
        from unnest(array['terms', 'privacy', 'location']) as required(consent_type)
       where not coalesce((
         select cr.granted
           from public.consent_records cr
          where cr.user_id = other_user_id
            and cr.consent_type = required.consent_type
          order by cr.captured_at desc, cr.id desc
          limit 1
       ), false)
    )
    and not private.has_active_moderation_action(
      auth.uid(), array['visibility_restriction', 'suspension', 'ban']
    )
    and not private.has_active_moderation_action(
      other_user_id, array['visibility_restriction', 'suspension', 'ban']
    );
$$;

create or replace function private.can_send_message(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.can_view_relationship(other_user_id)
    and public.are_friends(other_user_id);
$$;

create or replace function private.is_request_eligible(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_pair_visible(target_user_id)
    and not private.has_active_moderation_action(
      auth.uid(), array['request_restriction', 'suspension', 'ban']
    )
    and exists (
      select 1
        from public.encounter_candidates c
       where c.viewer_id = auth.uid()
         and c.candidate_profile_id = target_user_id
         and c.request_eligible = true
         and c.repeat_encounters_30d >= 5
         and c.expires_at > now()
    );
$$;

drop policy if exists "users read safe active candidate cards" on public.encounter_candidates;
create policy "users read safe active candidate cards"
  on public.encounter_candidates for select
  using (
    viewer_id = auth.uid()
    and expires_at > now()
    and private.is_pair_visible(candidate_profile_id)
  );

drop policy if exists "friends read messages while unblocked" on public.messages;
create policy "friends read messages while permitted"
  on public.messages for select
  using (
    (sender_id = auth.uid() and private.can_send_message(recipient_id))
    or (recipient_id = auth.uid() and private.can_send_message(sender_id))
  );
drop policy if exists "friends send messages while unblocked" on public.messages;
create policy "friends send messages while permitted"
  on public.messages for insert
  with check (sender_id = auth.uid() and private.can_send_message(recipient_id));

create or replace view public.public_profiles
with (security_barrier = true)
as
  select p.id, p.nickname,
         case
           when p.birth_year is null then null
           when extract(year from now())::int - p.birth_year < 30 then '20대'
           when extract(year from now())::int - p.birth_year < 40 then '30대'
           when extract(year from now())::int - p.birth_year < 50 then '40대'
           else '50대 이상'
         end as age_band,
         p.relationship_intents, p.running_style_tags,
         p.avatar_path, p.pace_min_seconds, p.pace_max_seconds,
         p.monthly_distance_km, p.completed_run_count
    from public.profiles p
    join public.encounter_candidates c
      on c.candidate_profile_id = p.id
     and c.viewer_id = auth.uid()
     and c.expires_at > now()
   where private.is_pair_visible(p.id);

drop policy if exists "participants read unblocked requests" on public.connection_requests;
create policy "participants read permitted requests"
  on public.connection_requests for select
  using (
    (requester_id = auth.uid() and private.can_view_relationship(recipient_id))
    or (recipient_id = auth.uid() and private.can_view_relationship(requester_id))
  );

-- Do not disclose automatic cancellation reasons such as `blocked` to the
-- other participant. Clients consume this safe projection; operators retain
-- the detailed reason in the base table and audit events.
create view public.connection_request_summaries
with (security_barrier = true)
as
  select r.id, r.requester_id, r.recipient_id, r.candidate_id,
         r.template_key, r.message, r.status,
         r.created_at, r.responded_at, r.expires_at, r.status_changed_at
    from public.connection_requests r
   where (r.requester_id = auth.uid() and private.can_view_relationship(r.recipient_id))
      or (r.recipient_id = auth.uid() and private.can_view_relationship(r.requester_id));

drop policy if exists "participants read unblocked friendships" on public.friendships;
create policy "participants read permitted friendships"
  on public.friendships for select
  using (
    (user_one_id = auth.uid() and private.can_view_relationship(user_two_id))
    or (user_two_id = auth.uid() and private.can_view_relationship(user_one_id))
  );

-- Internal state transition used by request RPCs and the scheduled expiry job.
create or replace function public.transition_connection_request(
  target_request_id uuid,
  target_status public.request_status,
  target_reason public.request_resolution_reason,
  required_actor text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.connection_requests;
begin
  select * into request_row
    from public.connection_requests
   where id = target_request_id and status = 'pending'
   for update;
  if request_row.id is null then return false; end if;

  if request_row.expires_at <= now() and target_status <> 'expired' then
    update public.connection_requests
       set status = 'expired', resolution_reason = 'expired_timeout'
     where id = request_row.id;
    return false;
  end if;

  if required_actor = 'requester' and request_row.requester_id <> auth.uid() then
    return false;
  elsif required_actor = 'recipient' and request_row.recipient_id <> auth.uid() then
    return false;
  elsif required_actor = 'system' and auth.uid() is not null then
    return false;
  elsif required_actor not in ('requester', 'recipient', 'system') then
    raise exception 'Invalid request actor requirement' using errcode = '22023';
  end if;

  update public.connection_requests
     set status = target_status, resolution_reason = target_reason
   where id = request_row.id;
  return true;
end;
$$;

create or replace function public.expire_due_connection_requests(batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  if batch_size not between 1 and 5000 then
    raise exception 'batch_size must be between 1 and 5000' using errcode = '22023';
  end if;

  with due as (
    select id
      from public.connection_requests
     where status = 'pending' and expires_at <= now()
     order by expires_at, id
     for update skip locked
     limit batch_size
  )
  update public.connection_requests r
     set status = 'expired', resolution_reason = 'expired_timeout'
    from due
   where r.id = due.id;
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.reconcile_restricted_connection_requests(batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_count integer;
begin
  if batch_size not between 1 and 5000 then
    raise exception 'batch_size must be between 1 and 5000' using errcode = '22023';
  end if;

  with restricted as (
    select r.id
      from public.connection_requests r
     where r.status = 'pending'
       and (
         private.has_active_moderation_action(
           r.requester_id,
           array['request_restriction', 'visibility_restriction', 'suspension', 'ban']
         )
         or private.has_active_moderation_action(
           r.recipient_id,
           array['visibility_restriction', 'suspension', 'ban']
         )
       )
     order by r.created_at, r.id
     for update skip locked
     limit batch_size
  )
  update public.connection_requests r
     set status = 'cancelled', resolution_reason = 'moderation_restricted'
    from restricted
   where r.id = restricted.id;
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

create or replace function public.cancel_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.transition_connection_request(
    request_id, 'cancelled', 'requester_cancelled', 'requester'
  );
end;
$$;

create or replace function public.decline_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.transition_connection_request(
    request_id, 'declined', 'recipient_declined', 'recipient'
  );
end;
$$;

create or replace function public.accept_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.connection_requests;
begin
  select * into request_row
    from public.connection_requests
   where id = request_id and status = 'pending'
   for update;
  if request_row.id is null then return false; end if;
  if request_row.recipient_id <> auth.uid() then return false; end if;
  if request_row.expires_at <= now() then
    update public.connection_requests
       set status = 'expired', resolution_reason = 'expired_timeout'
     where id = request_row.id;
    return false;
  end if;
  if private.has_active_moderation_action(
       request_row.requester_id,
       array['request_restriction', 'visibility_restriction', 'suspension', 'ban']
     )
     or private.has_active_moderation_action(
       request_row.recipient_id,
       array['visibility_restriction', 'suspension', 'ban']
     ) then
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'moderation_restricted'
     where id = request_row.id;
    return false;
  end if;
  if not private.can_view_relationship(request_row.requester_id) then return false; end if;

  update public.connection_requests
     set status = 'accepted', resolution_reason = 'accepted'
   where id = request_row.id;
  insert into public.friendships (user_one_id, user_two_id, accepted_request_id)
  values (
    least(request_row.requester_id, request_row.recipient_id),
    greatest(request_row.requester_id, request_row.recipient_id),
    request_row.id
  ) on conflict (user_one_id, user_two_id) do nothing;
  return true;
end;
$$;

-- Refresh send logic so stale pending rows are expired before uniqueness and
-- cooldown checks. Opposite-direction requests share the canonical unique key.
create or replace function public.send_connection_request(
  p_target_user_id uuid,
  p_candidate_id uuid,
  p_template_key text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_template_key not in ('weekend_5k', 'after_work_jog', 'morning_run', 'custom') then
    raise exception 'Invalid request template' using errcode = '22023';
  end if;
  if p_message is not null and char_length(p_message) > 240 then
    raise exception 'Request message is too long' using errcode = '22001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(auth.uid(), p_target_user_id)::text || ':' || greatest(auth.uid(), p_target_user_id)::text,
      0
    )
  );

  update public.connection_requests
     set status = 'expired', resolution_reason = 'expired_timeout'
   where status = 'pending'
     and expires_at <= now()
     and (requester_id = auth.uid() or recipient_id = auth.uid());

  if not private.is_request_eligible(p_target_user_id) then
    raise exception 'Request is not eligible' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.encounter_candidates c
     where c.id = p_candidate_id
       and c.viewer_id = auth.uid()
       and c.candidate_profile_id = p_target_user_id
       and c.request_eligible = true
       and c.repeat_encounters_30d >= 5
       and c.expires_at > now()
  ) then
    raise exception 'Candidate does not match this request' using errcode = '42501';
  end if;
  if (select count(*) from public.connection_requests r
       where r.requester_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Daily request limit reached' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.connection_requests r
     where (
       (r.requester_id = auth.uid() and r.recipient_id = p_target_user_id)
       or (r.requester_id = p_target_user_id and r.recipient_id = auth.uid())
     )
       and (r.status = 'pending' or r.created_at > now() - interval '7 days')
  ) then
    raise exception 'Request cooldown is active' using errcode = '23505';
  end if;

  insert into public.connection_requests (
    requester_id, recipient_id, candidate_id, template_key, message
  ) values (
    auth.uid(), p_target_user_id, p_candidate_id, p_template_key, p_message
  ) returning id into new_request_id;
  return new_request_id;
end;
$$;

-- Replace cleanup hooks so every automatic cancellation carries a machine-
-- readable reason and is captured by the request audit trigger.
create or replace function public.cleanup_after_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.encounter_candidates
   where (viewer_id = new.blocker_id and candidate_profile_id = new.blocked_id)
      or (viewer_id = new.blocked_id and candidate_profile_id = new.blocker_id);
  update public.connection_requests
     set status = 'cancelled', resolution_reason = 'blocked'
   where status = 'pending'
     and ((requester_id = new.blocker_id and recipient_id = new.blocked_id)
       or (requester_id = new.blocked_id and recipient_id = new.blocker_id));
  return new;
end;
$$;

create or replace function public.record_consent(
  consent_type text,
  policy_version text,
  granted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  consent_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if consent_type not in ('adult_confirmation', 'terms', 'privacy', 'location', 'marketing', 'health_data') then
    raise exception 'Invalid consent type' using errcode = '22023';
  end if;
  if policy_version is null or char_length(btrim(policy_version)) not between 1 and 100 then
    raise exception 'Invalid policy version' using errcode = '22023';
  end if;
  insert into public.consent_records (user_id, consent_type, policy_version, granted)
  values (auth.uid(), consent_type, btrim(policy_version), granted)
  returning id into consent_id;

  if consent_type = 'location' and granted = false then
    update public.profiles set discovery_enabled = false where id = auth.uid();
    delete from public.encounter_candidates
     where viewer_id = auth.uid() or candidate_profile_id = auth.uid();
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'consent_withdrawn'
     where status = 'pending'
       and (requester_id = auth.uid() or recipient_id = auth.uid());
  end if;
  return consent_id;
end;
$$;

create or replace function public.apply_moderation_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_at > now() or (new.ends_at is not null and new.ends_at <= now()) then
    return new;
  end if;

  if new.action_type in ('visibility_restriction', 'suspension', 'ban') then
    delete from public.encounter_candidates
     where viewer_id = new.subject_id or candidate_profile_id = new.subject_id;
  end if;

  if new.action_type = 'request_restriction' then
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'moderation_restricted'
     where status = 'pending' and requester_id = new.subject_id;
  elsif new.action_type in ('visibility_restriction', 'suspension', 'ban') then
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'moderation_restricted'
     where status = 'pending'
       and (requester_id = new.subject_id or recipient_id = new.subject_id);
  end if;
  return new;
end;
$$;

create trigger moderation_actions_apply_restriction
after insert or update of action_type, starts_at, ends_at on public.moderation_actions
for each row execute function public.apply_moderation_restriction();

-- Request audit events are server-only. Participants receive current request
-- state through connection_requests without exposing internal operational data.
revoke all privileges on table public.connection_request_events
  from public, anon, authenticated;
revoke select on table public.connection_requests from authenticated;
revoke all privileges on table public.connection_request_summaries
  from public, anon, authenticated;
grant select on table public.connection_request_summaries to authenticated;

revoke execute on function public.enforce_connection_request_transition()
  from public, anon, authenticated;
revoke execute on function public.audit_connection_request_transition()
  from public, anon, authenticated;
revoke execute on function public.apply_moderation_restriction()
  from public, anon, authenticated;
revoke execute on function private.has_active_moderation_action(uuid, text[])
  from public, anon, authenticated;
revoke execute on function private.can_view_relationship(uuid)
  from public, anon, authenticated;
revoke execute on function private.is_pair_visible(uuid)
  from public, anon, authenticated;
revoke execute on function private.can_send_message(uuid)
  from public, anon, authenticated;
revoke execute on function private.is_request_eligible(uuid)
  from public, anon, authenticated;
revoke execute on function public.transition_connection_request(uuid, public.request_status, public.request_resolution_reason, text)
  from public, anon, authenticated;
revoke execute on function public.expire_due_connection_requests(integer)
  from public, anon, authenticated;
revoke execute on function public.reconcile_restricted_connection_requests(integer)
  from public, anon, authenticated;

-- These helpers are required while evaluating RLS, but the private schema is
-- not exposed by PostgREST and therefore cannot be called as public RPCs.
grant usage on schema private to authenticated;
grant execute on function private.can_view_relationship(uuid),
  private.is_pair_visible(uuid), private.can_send_message(uuid)
to authenticated;

-- Remove direct RPC access to legacy public helpers. They remain only as
-- implementation details used by private security-definer functions.
revoke execute on function public.are_friends(uuid), public.is_blocked(uuid),
  public.is_pair_visible(uuid), public.can_send_message(uuid),
  public.is_request_eligible(uuid)
from authenticated;

-- Only service workers call expiry directly. In hosted Supabase, schedule this
-- function (for example every minute) with a server-side cron/worker.
grant execute on function public.expire_due_connection_requests(integer)
  to service_role;
grant execute on function public.reconcile_restricted_connection_requests(integer)
  to service_role;

comment on table public.connection_request_events is
  'Immutable server-only audit trail for connection request state transitions.';
comment on view public.connection_request_summaries is
  'Participant-safe request state without internal cancellation or moderation reasons.';
comment on function public.expire_due_connection_requests(integer) is
  'Server-only batch transition for pending requests whose expires_at has passed.';
comment on function public.reconcile_restricted_connection_requests(integer) is
  'Server-only reconciliation for pending requests affected by scheduled moderation actions.';
comment on function public.apply_moderation_restriction() is
  'Immediately removes discovery/request paths when an active restriction is applied.';

commit;
