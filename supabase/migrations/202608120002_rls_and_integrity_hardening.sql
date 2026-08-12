-- Harden the MVP trust boundary. Client-provided run/GPS data remains untrusted;
-- only server processing may mark a run eligible or update trust aggregates.
begin;

-- A point must belong to the same user as its parent session. The previous two
-- independent foreign keys allowed a caller to mix another session_id with its
-- own user_id.
alter table public.running_sessions
  add constraint running_sessions_id_user_id_key unique (id, user_id);

alter table public.location_points
  add constraint location_points_session_owner_fkey
  foreign key (session_id, user_id)
  references public.running_sessions (id, user_id)
  on delete cascade;

alter table public.location_points
  drop constraint location_points_session_id_fkey;

alter table public.profiles
  add constraint profiles_pace_range_check
  check (
    pace_min_seconds is null
    or pace_max_seconds is null
    or pace_min_seconds <= pace_max_seconds
  );

alter table public.profiles
  add constraint profiles_nonnegative_aggregates_check
  check (monthly_distance_km >= 0 and completed_run_count >= 0);

alter table public.running_sessions
  add constraint running_sessions_finished_state_check
  check (
    status not in ('processing', 'completed')
    or (ended_at is not null and duration_seconds is not null)
  );

alter table public.running_sessions
  add constraint running_sessions_match_eligibility_check
  check (
    is_match_eligible = false
    or (status = 'completed' and distance_meters >= 3000)
  );

alter table public.running_sessions
  add constraint running_sessions_metric_ranges_check
  check (
    (average_pace_seconds is null or average_pace_seconds between 60 and 7200)
    and (moving_seconds is null or moving_seconds >= 0)
    and (duration_seconds is null or moving_seconds is null or moving_seconds <= duration_seconds)
    and (calories is null or calories >= 0)
    and (average_heart_rate is null or average_heart_rate between 20 and 300)
    and jsonb_typeof(gps_quality_summary) = 'object'
    and jsonb_typeof(sync_metadata) = 'object'
  );

alter table public.messages
  add constraint messages_read_after_creation_check
  check (read_at is null or read_at >= created_at);

alter table public.moderation_actions
  add constraint moderation_actions_time_range_check
  check (ends_at is null or ends_at > starts_at);

alter table public.detection_jobs
  add constraint detection_jobs_attempts_check check (attempts >= 0);

-- Safety evidence must not disappear just because the reported account asks to
-- delete its profile. Account deletion therefore needs a server-side archival /
-- anonymisation workflow before the profile row can be removed.
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports
  add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete restrict;
alter table public.reports drop constraint reports_reported_id_fkey;
alter table public.reports
  add constraint reports_reported_id_fkey
  foreign key (reported_id) references public.profiles(id) on delete restrict;
alter table public.moderation_actions drop constraint moderation_actions_subject_id_fkey;
alter table public.moderation_actions
  add constraint moderation_actions_subject_id_fkey
  foreign key (subject_id) references public.profiles(id) on delete restrict;

alter table public.connection_requests add column expires_at timestamptz;
update public.connection_requests
   set expires_at = created_at + interval '7 days'
 where expires_at is null;
alter table public.connection_requests
  alter column expires_at set default (now() + interval '7 days'),
  alter column expires_at set not null;
alter table public.connection_requests
  add constraint connection_requests_expiry_check check (expires_at > created_at);
create index connection_requests_recipient_pending_idx
  on public.connection_requests(recipient_id, created_at desc)
  where status = 'pending';

-- Replace broad ALL policies with operation-specific policies. Column grants
-- below provide the second half of the boundary: RLS limits rows; grants limit
-- which fields a mobile client may mutate.
drop policy if exists "users manage only their profile" on public.profiles;
drop policy if exists "owners manage their sessions" on public.running_sessions;
drop policy if exists "owners manage their own raw GPS points" on public.location_points;
drop policy if exists "users read their candidate cards" on public.encounter_candidates;
drop policy if exists "requester reads own requests" on public.connection_requests;
drop policy if exists "eligible users send requests" on public.connection_requests;
drop policy if exists "requester cancels pending requests" on public.connection_requests;
drop policy if exists "recipient declines pending requests" on public.connection_requests;
drop policy if exists "friends see their relationship" on public.friendships;
drop policy if exists "users manage their blocks" on public.user_blocks;
drop policy if exists "friends read messages only" on public.messages;
drop policy if exists "friends send messages only" on public.messages;
drop policy if exists "reporter creates and reads their reports" on public.reports;
drop policy if exists "reporter submits report" on public.reports;
drop policy if exists "subject sees their own action notice" on public.moderation_actions;
drop policy if exists "users read their consent history" on public.consent_records;
drop policy if exists "users append their own consent" on public.consent_records;

create or replace function public.has_current_consent(required_consent_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select cr.granted
      from public.consent_records cr
     where cr.user_id = auth.uid()
       and cr.consent_type = required_consent_type
     order by cr.captured_at desc, cr.id desc
     limit 1
  ), false);
$$;

create or replace function public.are_friends(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.friendships
     where (user_one_id = auth.uid() and user_two_id = other_user_id)
        or (user_two_id = auth.uid() and user_one_id = other_user_id)
  );
$$;

create or replace function public.is_blocked(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.user_blocks
     where (blocker_id = auth.uid() and blocked_id = other_user_id)
        or (blocked_id = auth.uid() and blocker_id = other_user_id)
  );
$$;

create or replace function public.is_pair_visible(other_user_id uuid)
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
    and not exists (
      select 1
        from public.moderation_actions ma
       where ma.subject_id in (auth.uid(), other_user_id)
         and ma.starts_at <= now()
         and (ma.ends_at is null or ma.ends_at > now())
         and ma.action_type in ('visibility_restriction', 'suspension', 'ban')
    );
$$;

create or replace function public.can_send_message(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.is_blocked(other_user_id)
    and public.are_friends(other_user_id)
    and not exists (
      select 1
        from public.moderation_actions ma
       where ma.subject_id in (auth.uid(), other_user_id)
         and ma.starts_at <= now()
         and (ma.ends_at is null or ma.ends_at > now())
         and ma.action_type in ('suspension', 'ban')
    );
$$;

create or replace function public.is_request_eligible(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_pair_visible(target_user_id)
    and not exists (
      select 1
        from public.moderation_actions ma
       where ma.subject_id = auth.uid()
         and ma.starts_at <= now()
         and (ma.ends_at is null or ma.ends_at > now())
         and ma.action_type in ('request_restriction', 'suspension', 'ban')
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

create policy "users read own profile"
  on public.profiles for select
  using (id = auth.uid());
create policy "users create own profile"
  on public.profiles for insert
  with check (id = auth.uid());
create policy "users update own profile"
  on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "owners read sessions"
  on public.running_sessions for select
  using (user_id = auth.uid());
create policy "owners start recording sessions"
  on public.running_sessions for insert
  with check (
    user_id = auth.uid()
    and status = 'recording'
    and is_match_eligible = false
    and public.has_current_consent('location')
  );
create policy "owners update session visibility"
  on public.running_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owners delete sessions"
  on public.running_sessions for delete
  using (user_id = auth.uid());

create policy "owners read raw GPS points"
  on public.location_points for select
  using (user_id = auth.uid());
create policy "owners append raw GPS to recording session"
  on public.location_points for insert
  with check (
    user_id = auth.uid()
    and public.has_current_consent('location')
    and exists (
      select 1
        from public.running_sessions s
       where s.id = session_id
         and s.user_id = auth.uid()
         and s.status = 'recording'
    )
  );
create policy "users read safe active candidate cards"
  on public.encounter_candidates for select
  using (
    viewer_id = auth.uid()
    and expires_at > now()
    and public.is_pair_visible(candidate_profile_id)
  );

create policy "participants read unblocked requests"
  on public.connection_requests for select
  using (
    (requester_id = auth.uid() and not public.is_blocked(recipient_id))
    or (recipient_id = auth.uid() and not public.is_blocked(requester_id))
  );

create policy "participants read unblocked friendships"
  on public.friendships for select
  using (
    (user_one_id = auth.uid() and not public.is_blocked(user_two_id))
    or (user_two_id = auth.uid() and not public.is_blocked(user_one_id))
  );

create policy "users read own blocks"
  on public.user_blocks for select
  using (blocker_id = auth.uid());
create policy "users create own blocks"
  on public.user_blocks for insert
  with check (blocker_id = auth.uid());
create policy "users remove own blocks"
  on public.user_blocks for delete
  using (blocker_id = auth.uid());

create policy "friends read messages while unblocked"
  on public.messages for select
  using (
    (sender_id = auth.uid() and public.can_send_message(recipient_id))
    or (recipient_id = auth.uid() and public.can_send_message(sender_id))
  );
create policy "friends send messages while unblocked"
  on public.messages for insert
  with check (sender_id = auth.uid() and public.can_send_message(recipient_id));

create policy "reporters read own reports"
  on public.reports for select
  using (reporter_id = auth.uid());
create policy "reporters submit reports"
  on public.reports for insert
  with check (reporter_id = auth.uid());

create policy "users read own consent history"
  on public.consent_records for select
  using (user_id = auth.uid());

-- Raw UPDATE access to requests is removed. Each transition is atomic and checks
-- expiry, blocking and current moderation state at the point of use.
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

  -- Serialize rate-limit checks for this requester.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if not public.is_request_eligible(p_target_user_id) then
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
     where r.requester_id = auth.uid()
       and r.recipient_id = p_target_user_id
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

create or replace function public.cancel_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.connection_requests
     set status = 'cancelled', responded_at = now()
   where id = request_id and requester_id = auth.uid() and status = 'pending';
  return found;
end;
$$;

create or replace function public.decline_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.connection_requests
     set status = 'declined', responded_at = now()
   where id = request_id and recipient_id = auth.uid() and status = 'pending';
  return found;
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
   where id = request_id and recipient_id = auth.uid() and status = 'pending'
   for update;
  if request_row.id is null then return false; end if;
  if request_row.expires_at <= now() then
    update public.connection_requests set status = 'expired', responded_at = now() where id = request_row.id;
    return false;
  end if;
  if public.is_blocked(request_row.requester_id)
     or exists (
       select 1 from public.moderation_actions ma
        where ma.subject_id in (request_row.requester_id, request_row.recipient_id)
          and ma.starts_at <= now() and (ma.ends_at is null or ma.ends_at > now())
          and ma.action_type in ('suspension', 'ban')
     ) then
    return false;
  end if;

  update public.connection_requests
     set status = 'accepted', responded_at = now()
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

create or replace function public.submit_running_session(
  p_session_id uuid,
  p_ended_at timestamptz,
  p_duration_seconds integer,
  p_distance_meters numeric,
  p_average_pace_seconds integer,
  p_moving_seconds integer,
  p_calories numeric default null,
  p_average_heart_rate integer default null,
  p_gps_quality_summary jsonb default '{}'::jsonb,
  p_sync_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_duration_seconds < 0 or p_distance_meters < 0 or p_moving_seconds < 0 then
    raise exception 'Run metrics cannot be negative' using errcode = '22023';
  end if;
  if jsonb_typeof(p_gps_quality_summary) <> 'object' or jsonb_typeof(p_sync_metadata) <> 'object' then
    raise exception 'Run metadata must be JSON objects' using errcode = '22023';
  end if;

  update public.running_sessions s
     set status = 'processing',
         ended_at = p_ended_at,
         duration_seconds = p_duration_seconds,
         distance_meters = p_distance_meters,
         average_pace_seconds = p_average_pace_seconds,
         moving_seconds = p_moving_seconds,
         calories = p_calories,
         average_heart_rate = p_average_heart_rate,
         gps_quality_summary = p_gps_quality_summary,
         sync_metadata = p_sync_metadata,
         is_match_eligible = false
   where s.id = p_session_id
     and s.user_id = auth.uid()
     and s.status = 'recording'
     and p_ended_at >= s.started_at;
  if not found then return false; end if;

  insert into public.detection_jobs (session_id)
  values (p_session_id)
  on conflict (session_id) do nothing;
  return true;
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
       set status = 'cancelled', responded_at = now()
     where status = 'pending'
       and (requester_id = auth.uid() or recipient_id = auth.uid());
  end if;
  return consent_id;
end;
$$;

-- Blocking immediately removes discovery visibility and pending contact paths.
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
     set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and ((requester_id = new.blocker_id and recipient_id = new.blocked_id)
       or (requester_id = new.blocked_id and recipient_id = new.blocker_id));
  return new;
end;
$$;
create trigger user_blocks_cleanup_after_insert
after insert on public.user_blocks
for each row execute function public.cleanup_after_block();

-- The discovery view is now candidate-scoped. It cannot be used to enumerate
-- every discoverable profile.
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
   where public.is_pair_visible(p.id);

-- Never expose internal_notes from moderation_actions to the subject.
create or replace view public.user_moderation_notices
with (security_barrier = true)
as
  select id, action_type, starts_at, ends_at, user_notice, created_at
    from public.moderation_actions
   where subject_id = auth.uid();

-- Explicit table/column capabilities. Table-wide UPDATE/INSERT grants would
-- override column grants, so revoke them before granting the safe subset.
revoke all privileges on table
  public.profiles, public.running_sessions, public.location_points,
  public.encounter_candidates, public.connection_requests, public.friendships,
  public.user_blocks, public.messages, public.reports,
  public.moderation_actions, public.consent_records, public.detection_jobs
from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant insert (id, nickname, birth_year, bio, relationship_intents, running_style_tags,
  profile_visibility, log_default_visibility, discovery_enabled, avatar_path,
  pace_min_seconds, pace_max_seconds) on public.profiles to authenticated;
grant update (nickname, bio, relationship_intents, running_style_tags,
  profile_visibility, log_default_visibility, discovery_enabled, avatar_path,
  pace_min_seconds, pace_max_seconds) on public.profiles to authenticated;

grant select, delete on public.running_sessions to authenticated;
grant insert (user_id, source, source_record_id, started_at, visibility)
  on public.running_sessions to authenticated;
grant update (visibility) on public.running_sessions to authenticated;

grant select on public.location_points to authenticated;
grant insert (session_id, user_id, recorded_at, latitude, longitude,
  accuracy_meters, altitude_meters, speed_mps, heading_degrees)
  on public.location_points to authenticated;

grant select on public.encounter_candidates, public.connection_requests,
  public.friendships, public.messages, public.reports, public.consent_records
  to authenticated;
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;
grant insert (sender_id, recipient_id, body) on public.messages to authenticated;
grant insert (reporter_id, reported_id, reason, details, evidence)
  on public.reports to authenticated;

revoke all privileges on public.public_profiles from public, anon, authenticated;
revoke all privileges on public.user_moderation_notices from public, anon, authenticated;
grant select on public.public_profiles, public.user_moderation_notices to authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- implicit capability and allow only the authenticated entry points/helpers.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.cleanup_after_block() from public, anon, authenticated;
revoke execute on function public.has_current_consent(text) from public, anon, authenticated;
revoke execute on function public.are_friends(uuid) from public, anon, authenticated;
revoke execute on function public.is_blocked(uuid) from public, anon, authenticated;
revoke execute on function public.is_pair_visible(uuid) from public, anon, authenticated;
revoke execute on function public.can_send_message(uuid) from public, anon, authenticated;
revoke execute on function public.is_request_eligible(uuid) from public, anon, authenticated;
revoke execute on function public.send_connection_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_connection_request(uuid) from public, anon, authenticated;
revoke execute on function public.decline_connection_request(uuid) from public, anon, authenticated;
revoke execute on function public.accept_connection_request(uuid) from public, anon, authenticated;
revoke execute on function public.submit_running_session(uuid, timestamptz, integer, numeric, integer, integer, numeric, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.record_consent(text, text, boolean) from public, anon, authenticated;

grant execute on function public.are_friends(uuid), public.is_blocked(uuid),
  public.has_current_consent(text),
  public.is_pair_visible(uuid), public.can_send_message(uuid),
  public.is_request_eligible(uuid),
  public.send_connection_request(uuid, uuid, text, text),
  public.cancel_connection_request(uuid), public.decline_connection_request(uuid),
  public.accept_connection_request(uuid),
  public.submit_running_session(uuid, timestamptz, integer, numeric, integer, integer, numeric, integer, jsonb, jsonb),
  public.record_consent(text, text, boolean)
to authenticated;

comment on view public.public_profiles is
  'Candidate-scoped safe profile projection. It is not a directory of all discoverable users.';
comment on view public.user_moderation_notices is
  'User-safe moderation notices. Internal operator notes are intentionally omitted.';
comment on function public.submit_running_session(uuid, timestamptz, integer, numeric, integer, integer, numeric, integer, jsonb, jsonb) is
  'Accepts untrusted client metrics and queues server validation. Only a server worker may mark is_match_eligible.';

commit;
