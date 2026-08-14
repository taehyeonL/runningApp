-- 동의를 철회한 GPS로는 파생 데이터를 만들지 않는다.
--
-- 202608120013이 도입한 "보관 기간이 지나면 격자 요약으로 전환한다"는 규칙은
-- 정상 보관 만료에만 맞는 규칙이다. 202608120012의 위치 동의 철회와 계정 삭제
-- 신청은 raw_points_purge_after를 now()로 당겨 같은 파기 경로를 태우는데, 그
-- 결과 철회한 사용자의 GPS에서 격자 요약과 집·직장 앵커가 "새로" 만들어졌다.
-- 철회는 삭제여야지 변환이 되어서는 안 된다.
--
-- 파기 사유를 세션에 남기고, 사유가 보관 만료가 아니면 요약 없이 지운다.
-- 이미 만들어져 있던 파생 위치 데이터도 철회 시점에 함께 지운다.
begin;

create type public.raw_points_purge_reason as enum (
  'retention',
  'consent_withdrawn',
  'account_deletion'
);

alter table public.running_sessions
  add column raw_points_purge_reason public.raw_points_purge_reason
    not null default 'retention';

comment on column public.running_sessions.raw_points_purge_reason is
  '원본 GPS를 지우는 이유. retention만 격자 요약으로 전환하고, 나머지는 그냥 지운다.';

-- ---------------------------------------------------------------------------
-- 1. 파생 위치 데이터 일괄 삭제
-- ---------------------------------------------------------------------------
-- 격자 요약과 생활 반경 앵커는 모두 위치에서 파생된 데이터다. 위치 이용에
-- 동의하지 않는 사용자에 대해 이 둘을 계속 들고 있을 근거가 없다.
-- 거리·시간·페이스 기록은 위치 데이터가 아니므로 그대로 남는다.
create or replace function private.forget_derived_location_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.session_route_summaries where user_id = p_user_id;
  delete from private.user_location_anchors where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 위치 동의 철회
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_location_consent(p_policy_version text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  perform public.record_consent('location', p_policy_version, false);

  update public.running_sessions
     set raw_points_purge_after = now(),
         raw_points_purge_reason = 'consent_withdrawn'
   where user_id = auth.uid()
     and (raw_points_purge_after is null or raw_points_purge_after > now());
  get diagnostics affected = row_count;

  -- 이미 격자로 바뀌어 있던 과거 경로와 집·직장 앵커도 함께 지운다.
  perform private.forget_derived_location_data(auth.uid());

  return affected;
end;
$$;

comment on function public.withdraw_location_consent(text) is
  '위치 동의 철회. 원본 GPS를 즉시 파기 대상으로 만들고, 이미 만들어진 격자 요약·생활 반경 앵커까지 지운다. 요약으로 전환하지 않는다.';

-- ---------------------------------------------------------------------------
-- 3. 계정 삭제 신청
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion(
  p_reason text default null,
  p_grace_days integer default 30
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  grace_days integer := greatest(0, least(coalesce(p_grace_days, 30), 30));
  purge_at timestamptz := now() + make_interval(days => grace_days);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'Reason is too long' using errcode = '22023';
  end if;

  insert into public.account_deletion_requests (user_id, purge_after, reason)
  values (auth.uid(), purge_at, p_reason)
  on conflict (user_id) do update
     set requested_at = now(),
         purge_after = excluded.purge_after,
         reason = excluded.reason,
         cancelled_at = null;

  -- 신청 즉시 서비스에서 보이지 않게 한다.
  update public.profiles
     set discovery_enabled = false,
         profile_visibility = 'private'
   where id = auth.uid();
  delete from public.encounter_candidates
   where viewer_id = auth.uid() or candidate_profile_id = auth.uid();
  update public.connection_requests
     set status = 'cancelled', resolution_reason = 'consent_withdrawn'
   where status = 'pending'
     and (requester_id = auth.uid() or recipient_id = auth.uid());

  -- 원본 GPS는 유예 기간을 기다리지 않고 파기 대상이 된다. 떠나는 사용자의
  -- 경로를 격자로 남겨 둘 이유가 없으므로 요약 전환도 하지 않는다.
  update public.running_sessions
     set raw_points_purge_after = now(),
         raw_points_purge_reason = 'account_deletion'
   where user_id = auth.uid();
  perform private.forget_derived_location_data(auth.uid());

  return purge_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 파기 작업: 사유에 따라 요약 여부를 가른다
-- ---------------------------------------------------------------------------
create or replace function public.worker_purge_expired_location_points(p_limit integer default 10000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired record;
  deleted_count integer := 0;
  batch integer;
begin
  for expired in
    select s.id, s.raw_points_purge_reason
      from public.running_sessions s
     where s.raw_points_purge_after <= now()
       and s.raw_points_purged_at is null
       and exists (select 1 from public.location_points lp where lp.session_id = s.id)
     order by s.raw_points_purge_after
     limit greatest(1, least(coalesce(p_limit, 10000), 50000))
  loop
    -- 보관 기간 만료일 때만 격자 요약으로 전환한다. 동의 철회·계정 삭제로
    -- 지우는 경우에는 어떤 파생 위치 데이터도 새로 만들지 않는다.
    if expired.raw_points_purge_reason = 'retention' then
      perform private.summarize_session_route(expired.id);
    end if;

    delete from public.location_points where session_id = expired.id;
    get diagnostics batch = row_count;
    deleted_count := deleted_count + batch;

    update public.running_sessions
       set raw_points_purged_at = now()
     where id = expired.id;
  end loop;

  return deleted_count;
end;
$$;

comment on function public.worker_purge_expired_location_points(integer) is
  '보관 기간이 지난 세션의 원본 GPS를 지운다. 보관 만료인 경우에만 격자 요약으로 전환하고, 동의 철회·계정 삭제는 파생 데이터 없이 삭제한다. p_limit은 세션 수.';

revoke execute on function private.forget_derived_location_data(uuid)
  from public, anon, authenticated;

commit;
