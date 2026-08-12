-- Server-only co-running worker contract. Raw coordinates remain in
-- location_points; only coarse, non-user-addressable evidence lives here.
create table private.co_running_encounters (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  session_low_id uuid not null references public.running_sessions(id) on delete cascade,
  session_high_id uuid not null references public.running_sessions(id) on delete cascade,
  encounter_day date not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  overlap_seconds integer not null check (overlap_seconds >= 30),
  overlap_meters numeric(10,2) not null check (overlap_meters >= 200),
  average_distance_meters numeric(7,2) not null check (average_distance_meters between 0 and 35),
  average_direction_delta_degrees numeric(6,2) not null check (average_direction_delta_degrees between 0 and 45),
  pace_delta_ratio numeric(6,4) not null check (pace_delta_ratio between 0 and 0.35),
  created_at timestamptz not null default now(),
  check (user_low_id < user_high_id),
  check (session_low_id <> session_high_id),
  unique (session_low_id, session_high_id)
);

create index co_running_encounters_pair_day_idx
  on private.co_running_encounters(user_low_id, user_high_id, encounter_day desc);

revoke all on private.co_running_encounters from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.co_running_encounters to service_role;

create or replace function private.worker_pair_is_discoverable(first_user_id uuid, second_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select first_user_id is not null
    and second_user_id is not null
    and first_user_id <> second_user_id
    and not exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = first_user_id and b.blocked_id = second_user_id)
          or (b.blocker_id = second_user_id and b.blocked_id = first_user_id)
    )
    and not private.has_active_moderation_action(
      first_user_id, array['visibility_restriction', 'suspension', 'ban']
    )
    and not private.has_active_moderation_action(
      second_user_id, array['visibility_restriction', 'suspension', 'ban']
    )
    and not exists (
      select 1
        from (values (first_user_id), (second_user_id)) as users(user_id)
        join public.profiles p on p.id = users.user_id
       where p.age_verified_at is null
          or p.discovery_enabled = false
          or p.profile_visibility not in ('profile', 'matching')
          or exists (
            select 1
              from unnest(array['terms', 'privacy', 'location']) required(consent_type)
             where not coalesce((
               select c.granted
                 from public.consent_records c
                where c.user_id = users.user_id
                  and c.consent_type = required.consent_type
                order by c.captured_at desc, c.id desc
                limit 1
             ), false)
          )
    )
    and (
      select count(*) from public.profiles p
       where p.id in (first_user_id, second_user_id)
    ) = 2;
$$;

revoke execute on function private.worker_pair_is_discoverable(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.worker_pair_is_discoverable(uuid, uuid) to service_role;

create or replace function public.worker_claim_detection_jobs(
  p_limit integer default 3,
  p_session_id uuid default null
)
returns table(job_id uuid, session_id uuid)
language sql
security definer
set search_path = public
as $$
  with claimable as (
    select j.id
      from public.detection_jobs j
      join public.running_sessions s on s.id = j.session_id
     where (p_session_id is null or j.session_id = p_session_id)
       and (
         (j.status in ('queued', 'failed') and j.available_at <= now())
         or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
       )
       and j.attempts < 5
       and s.status = 'processing'
     order by j.available_at, j.created_at
     for update of j skip locked
     limit greatest(1, least(coalesce(p_limit, 3), 10))
  ), claimed as (
    update public.detection_jobs j
       set status = 'processing',
           attempts = j.attempts + 1,
           locked_at = now(),
           error_message = null
      from claimable c
     where j.id = c.id
    returning j.id, j.session_id
  )
  select claimed.id, claimed.session_id from claimed;
$$;

create or replace function public.worker_fail_detection_job(
  p_job_id uuid,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.detection_jobs
     set status = 'failed',
         available_at = now() + make_interval(mins => least(60, (2 ^ least(attempts, 5))::integer)),
         locked_at = null,
         error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Unknown worker error'), 1000)
   where id = p_job_id
     and status = 'processing';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.worker_finalize_detection_job(
  p_job_id uuid,
  p_valid boolean,
  p_distance_meters numeric,
  p_duration_seconds integer,
  p_moving_seconds integer,
  p_average_pace_seconds integer,
  p_gps_quality_summary jsonb,
  p_encounters jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  job_row public.detection_jobs%rowtype;
  session_row public.running_sessions%rowtype;
  other_session public.running_sessions%rowtype;
  encounter jsonb;
  other_session_id uuid;
  low_user_id uuid;
  high_user_id uuid;
  low_session_id uuid;
  high_session_id uuid;
  pair_count integer;
  confidence numeric;
  overlap_seconds integer;
  overlap_meters numeric;
  average_distance numeric;
  direction_delta numeric;
  pace_delta numeric;
  similarity text;
  safe_reasons jsonb;
  safe_summary text;
begin
  if p_distance_meters < 0 or p_duration_seconds < 0 or p_moving_seconds < 0
     or p_moving_seconds > p_duration_seconds then
    raise exception 'Invalid validated run metrics' using errcode = '22023';
  end if;
  if p_average_pace_seconds is not null and p_average_pace_seconds not between 60 and 7200 then
    raise exception 'Invalid validated pace' using errcode = '22023';
  end if;
  if jsonb_typeof(p_gps_quality_summary) <> 'object'
     or jsonb_typeof(p_encounters) <> 'array'
     or jsonb_array_length(p_encounters) > 100 then
    raise exception 'Invalid worker payload' using errcode = '22023';
  end if;

  select * into job_row
    from public.detection_jobs
   where id = p_job_id
   for update;
  if job_row.id is null or job_row.status <> 'processing' then return false; end if;

  select * into session_row
    from public.running_sessions
   where id = job_row.session_id
   for update;
  if session_row.id is null or session_row.status <> 'processing' then return false; end if;
  if p_valid and p_distance_meters < 3000 then
    raise exception 'A match-eligible run must be at least 3km' using errcode = '22023';
  end if;

  update public.running_sessions
     set status = 'completed',
         distance_meters = round(p_distance_meters, 2),
         duration_seconds = p_duration_seconds,
         moving_seconds = p_moving_seconds,
         average_pace_seconds = p_average_pace_seconds,
         gps_quality_summary = p_gps_quality_summary || jsonb_build_object(
           'server_validated', true,
           'match_eligible', p_valid
         ),
         raw_points_purge_after = least(
           coalesce(raw_points_purge_after, now() + interval '30 days'),
           now() + interval '30 days'
         ),
         is_match_eligible = p_valid
   where id = session_row.id;

  if p_valid then
    for encounter in select value from jsonb_array_elements(p_encounters)
    loop
      other_session_id := nullif(encounter->>'other_session_id', '')::uuid;
      confidence := (encounter->>'confidence')::numeric;
      overlap_seconds := (encounter->>'overlap_seconds')::integer;
      overlap_meters := (encounter->>'overlap_meters')::numeric;
      average_distance := (encounter->>'average_distance_meters')::numeric;
      direction_delta := (encounter->>'average_direction_delta_degrees')::numeric;
      pace_delta := (encounter->>'pace_delta_ratio')::numeric;

      if confidence not between 0.55 and 1
         or overlap_seconds < 30
         or overlap_meters < 200
         or average_distance not between 0 and 35
         or direction_delta not between 0 and 45
         or pace_delta not between 0 and 0.35 then
        raise exception 'Invalid co-running evidence' using errcode = '22023';
      end if;

      select * into other_session
        from public.running_sessions
       where id = other_session_id
         and user_id <> session_row.user_id
         and status = 'completed'
         and is_match_eligible = true;
      if other_session.id is null then continue; end if;
      if not private.worker_pair_is_discoverable(session_row.user_id, other_session.user_id) then
        continue;
      end if;

      low_user_id := least(session_row.user_id, other_session.user_id);
      high_user_id := greatest(session_row.user_id, other_session.user_id);
      if session_row.user_id = low_user_id then
        low_session_id := session_row.id;
        high_session_id := other_session.id;
      else
        low_session_id := other_session.id;
        high_session_id := session_row.id;
      end if;

      insert into private.co_running_encounters (
        user_low_id, user_high_id, session_low_id, session_high_id,
        encounter_day, confidence, overlap_seconds, overlap_meters,
        average_distance_meters, average_direction_delta_degrees, pace_delta_ratio
      ) values (
        low_user_id, high_user_id, low_session_id, high_session_id,
        greatest(session_row.started_at, other_session.started_at)::date,
        confidence, overlap_seconds, overlap_meters,
        average_distance, direction_delta, pace_delta
      ) on conflict (session_low_id, session_high_id) do update
        set confidence = excluded.confidence,
            overlap_seconds = excluded.overlap_seconds,
            overlap_meters = excluded.overlap_meters,
            average_distance_meters = excluded.average_distance_meters,
            average_direction_delta_degrees = excluded.average_direction_delta_degrees,
            pace_delta_ratio = excluded.pace_delta_ratio;

      select count(*)::integer into pair_count
        from private.co_running_encounters e
       where e.user_low_id = low_user_id
         and e.user_high_id = high_user_id
         and e.encounter_day >= current_date - 29;

      similarity := case
        when confidence >= 0.80 then 'good_match'
        when confidence >= 0.65 then 'quite_good_match'
        else 'new_rhythm'
      end;
      safe_reasons := jsonb_build_array('활동 시간대가 비슷해요');
      if pace_delta <= 0.15 then
        safe_reasons := safe_reasons || jsonb_build_array('평균 페이스가 비슷해요');
      end if;
      if overlap_meters >= 800 then
        safe_reasons := safe_reasons || jsonb_build_array('충분한 구간에서 같은 리듬으로 달렸어요');
      end if;
      safe_summary := case
        when overlap_meters >= 1500 then '긴 구간에서 리듬이 비슷했어요'
        else '동선 일부가 비슷했어요'
      end;

      insert into public.encounter_candidates (
        viewer_id, candidate_profile_id, similarity_label, reasons,
        repeat_encounters_30d, request_eligible, safe_overlap_summary,
        generated_at, expires_at
      ) values
        (session_row.user_id, other_session.user_id, similarity, safe_reasons,
         pair_count, pair_count >= 5, safe_summary, now(), now() + interval '30 days'),
        (other_session.user_id, session_row.user_id, similarity, safe_reasons,
         pair_count, pair_count >= 5, safe_summary, now(), now() + interval '30 days')
      on conflict (viewer_id, candidate_profile_id) do update
        set similarity_label = excluded.similarity_label,
            reasons = excluded.reasons,
            repeat_encounters_30d = excluded.repeat_encounters_30d,
            request_eligible = excluded.request_eligible,
            safe_overlap_summary = excluded.safe_overlap_summary,
            generated_at = excluded.generated_at,
            expires_at = excluded.expires_at;
    end loop;
  end if;

  update public.profiles p
     set completed_run_count = stats.completed_count,
         monthly_distance_km = stats.monthly_distance_km
    from (
      select count(*) filter (where status = 'completed')::integer as completed_count,
             coalesce(sum(distance_meters) filter (
               where status = 'completed'
                 and started_at >= date_trunc('month', now())
             ), 0) / 1000 as monthly_distance_km
        from public.running_sessions
       where user_id = session_row.user_id
    ) stats
   where p.id = session_row.user_id;

  update public.detection_jobs
     set status = 'completed', completed_at = now(), locked_at = null,
         error_message = null
   where id = job_row.id;
  return true;
end;
$$;

create or replace function public.worker_purge_expired_location_points(p_limit integer default 10000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  with expired as (
    select lp.id
      from public.location_points lp
      join public.running_sessions s on s.id = lp.session_id
     where s.raw_points_purge_after <= now()
     order by s.raw_points_purge_after
     limit greatest(1, least(coalesce(p_limit, 10000), 50000))
  )
  delete from public.location_points lp
  using expired e
  where lp.id = e.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.worker_claim_detection_jobs(integer, uuid)
  from public, anon, authenticated;
revoke execute on function public.worker_fail_detection_job(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.worker_finalize_detection_job(
  uuid, boolean, numeric, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
revoke execute on function public.worker_purge_expired_location_points(integer)
  from public, anon, authenticated;

grant execute on function public.worker_claim_detection_jobs(integer, uuid) to service_role;
grant execute on function public.worker_fail_detection_job(uuid, text) to service_role;
grant execute on function public.worker_finalize_detection_job(
  uuid, boolean, numeric, integer, integer, integer, jsonb, jsonb
) to service_role;
grant execute on function public.worker_purge_expired_location_points(integer) to service_role;

comment on table private.co_running_encounters is
  'Server-only deduplication and 30-day repeat-count evidence. Contains no raw coordinates.';
comment on function public.worker_finalize_detection_job(uuid, boolean, numeric, integer, integer, integer, jsonb, jsonb) is
  'Atomically finalizes server-validated run metrics and writes only coarse candidate summaries.';
