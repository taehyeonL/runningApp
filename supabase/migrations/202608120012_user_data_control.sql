-- 사용자 데이터 통제권: 계정 삭제, 위치 동의 철회, 러닝 로그 삭제·공개 범위 변경.
-- 기획서 §4 "데이터 보호 원칙"에 따라 이 기능들은 요금제와 무관하게 항상 제공한다.
-- 클라이언트는 임의 UPDATE 대신 좁은 RPC만 호출하며, 서버 판정 필드는 건드릴 수 없다.
begin;

-- ---------------------------------------------------------------------------
-- 0. 러닝 세션 생성 권한 복구
-- ---------------------------------------------------------------------------
-- 202608120002가 "owners start recording sessions" INSERT 정책은 만들었지만
-- 대응하는 테이블 grant를 빠뜨려, 클라이언트의 러닝 시작이 42501로 막혀 있었다.
-- 정책이 status='recording' / is_match_eligible=false를 요구하고 두 컬럼 모두
-- 같은 값이 기본값이므로, grant를 시작 시점에 정당한 컬럼으로만 좁히면
-- 클라이언트는 거리·매칭 자격을 위조할 수 없으면서 러닝을 시작할 수 있다.
grant insert (user_id, source, source_record_id, started_at, visibility)
  on public.running_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 1. 러닝 로그 공개 범위
-- ---------------------------------------------------------------------------
-- 컬럼 단위 grant(202608120002)가 이미 UPDATE 대상을 visibility 하나로 묶어
-- 두었으므로 정책은 그대로 둔다. 이 RPC는 enum 검증과 "검증이 끝난 기록만
-- 공개 범위를 바꿀 수 있다"는 규칙을 한 번의 왕복으로 처리하기 위한 것이다.
create or replace function public.set_running_session_visibility(
  p_session_id uuid,
  p_visibility text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_visibility public.profile_visibility;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'friends', 'profile', 'matching') then
    raise exception 'Invalid visibility' using errcode = '22023';
  end if;
  next_visibility := p_visibility::public.profile_visibility;

  update public.running_sessions
     set visibility = next_visibility
   where id = p_session_id
     and user_id = auth.uid()
     and status in ('processing', 'completed');
  return found;
end;
$$;

comment on function public.set_running_session_visibility(uuid, text) is
  '로그별 공개 범위 변경. 거리·페이스·매칭 적격 여부 등 서버 판정 필드는 변경할 수 없다.';

-- ---------------------------------------------------------------------------
-- 2. 개별 러닝 로그 삭제
-- ---------------------------------------------------------------------------
-- location_points와 private.co_running_encounters는 session FK cascade로 함께
-- 지워진다. 그러나 encounter_candidates는 session을 참조하지 않으므로, 근거가
-- 사라진 카드가 남지 않도록 명시적으로 정리한다.
create or replace function private.prune_orphaned_candidates(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.encounter_candidates c
   where (c.viewer_id = p_user_id or c.candidate_profile_id = p_user_id)
     and not exists (
       select 1
         from private.co_running_encounters e
        where e.user_low_id = least(c.viewer_id, c.candidate_profile_id)
          and e.user_high_id = greatest(c.viewer_id, c.candidate_profile_id)
          and e.encounter_day > (now() - interval '30 days')::date
     );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function public.delete_running_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  delete from public.running_sessions
   where id = p_session_id
     and user_id = auth.uid()
  returning user_id into owner_id;
  if owner_id is null then return false; end if;

  -- 근거가 남지 않은 발견 카드는 양쪽 모두에서 즉시 사라져야 한다.
  perform private.prune_orphaned_candidates(owner_id);
  return true;
end;
$$;

comment on function public.delete_running_session(uuid) is
  '러닝 로그 삭제. 원본 GPS와 co-running 근거, 근거가 사라진 발견 카드까지 함께 제거한다.';

-- ---------------------------------------------------------------------------
-- 3. 프로필 공개 설정
-- ---------------------------------------------------------------------------
-- profiles의 UPDATE 정책은 닉네임·태그 편집을 위해 유지하되, 공개 설정은
-- 한 번의 호출로 원자적으로 바꿀 수 있게 한다.
create or replace function public.set_profile_privacy(
  p_discovery_enabled boolean,
  p_profile_visibility text,
  p_log_default_visibility text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_profile_visibility not in ('private', 'friends', 'profile', 'matching')
     or p_log_default_visibility not in ('private', 'friends', 'profile', 'matching') then
    raise exception 'Invalid visibility' using errcode = '22023';
  end if;

  update public.profiles
     set discovery_enabled = p_discovery_enabled,
         profile_visibility = p_profile_visibility::public.profile_visibility,
         log_default_visibility = p_log_default_visibility::public.profile_visibility
   where id = auth.uid();
  if not found then return false; end if;

  -- 발견에서 빠지기로 했다면 이미 노출 중인 카드도 즉시 회수한다.
  if p_discovery_enabled = false then
    delete from public.encounter_candidates
     where viewer_id = auth.uid() or candidate_profile_id = auth.uid();
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 위치 동의 철회
-- ---------------------------------------------------------------------------
-- record_consent()가 이미 발견 중단과 대기 요청 취소를 처리한다. 여기서는
-- 원본 GPS 파기까지 이어지도록 보관 만료 시각을 앞당긴다. 러닝 기록 자체
-- (거리·시간·페이스)는 사용자의 자산이므로 삭제하지 않는다.
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
     set raw_points_purge_after = now()
   where user_id = auth.uid()
     and (raw_points_purge_after is null or raw_points_purge_after > now());
  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.withdraw_location_consent(text) is
  '위치 동의 철회. 발견 중단·대기 요청 취소와 함께 원본 GPS를 즉시 파기 대상으로 만든다.';

-- ---------------------------------------------------------------------------
-- 5. 계정 삭제
-- ---------------------------------------------------------------------------
-- 신청 즉시 서비스에서 사라지고(발견·요청·채팅 차단), 유예 기간이 지나면
-- worker가 auth.users를 삭제해 모든 데이터가 cascade로 제거된다. 유예 기간은
-- 오조작 복구와, 중대 위반 신고의 증거 보존 처리를 위해 둔다.
create table public.account_deletion_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  reason text check (char_length(reason) <= 500),
  cancelled_at timestamptz,
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;

create index account_deletion_requests_due_idx
  on public.account_deletion_requests(purge_after)
  where cancelled_at is null and completed_at is null;

create policy "users read own deletion request"
  on public.account_deletion_requests for select
  using (user_id = auth.uid());

-- 중대 위반 신고와 제재 이력은 계정이 사라져도 재가입 악용을 막기 위해
-- 비식별 형태로 남긴다. 원본 신고 내용(details·evidence)은 보관하지 않고
-- 유형·시점·처리 결과만 남긴다.
create table public.retained_moderation_records (
  id uuid primary key default gen_random_uuid(),
  record_kind text not null check (record_kind in ('report', 'moderation_action')),
  subject_digest text not null,
  reason text,
  action_type text,
  report_status public.moderation_status,
  reported_at timestamptz not null,
  retained_at timestamptz not null default now(),
  check (
    case record_kind
      when 'report' then reason is not null and report_status is not null
      when 'moderation_action' then action_type is not null
    end
  )
);
alter table public.retained_moderation_records enable row level security;
create index retained_moderation_records_digest_idx
  on public.retained_moderation_records(subject_digest);

-- 탈퇴자가 "남을 신고한" 기록은 신고당한 쪽의 운영 이력이므로 지우면 안 된다.
-- reporter_id를 비우고 digest만 남기면 신고 내역은 살아남고 탈퇴자는
-- 식별되지 않는다. digest가 있으니 동일인의 반복 허위신고는 계속 추적된다.
-- FK는 restrict로 두어, 이 파기 경로 밖에서 프로필을 지워 신고를 없애는
-- 우회는 여전히 막힌다.
alter table public.reports alter column reporter_id drop not null;
alter table public.reports add column reporter_digest text;

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
  -- 원본 GPS는 유예 기간을 기다리지 않고 파기 대상이 된다.
  update public.running_sessions
     set raw_points_purge_after = now()
   where user_id = auth.uid();

  return purge_at;
end;
$$;

create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.account_deletion_requests
     set cancelled_at = now()
   where user_id = auth.uid()
     and cancelled_at is null
     and completed_at is null;
  return found;
end;
$$;

comment on function public.cancel_account_deletion() is
  '유예 기간 안에서만 삭제 신청을 되돌린다. 발견 노출은 사용자가 다시 켜야 재개된다.';

-- worker가 유예 기간이 지난 계정을 실제로 파기한다. auth.users를 지우면
-- profiles부터 전 테이블이 cascade로 정리된다.
create or replace function public.worker_purge_due_account_deletions(p_limit integer default 50)
returns integer
language plpgsql
security definer
-- digest()는 호스티드 Supabase에서 extensions 스키마에 설치된다.
set search_path = public, extensions
as $$
declare
  due record;
  subject_digest text;
  purged integer := 0;
begin
  for due in
    select user_id
      from public.account_deletion_requests
     where cancelled_at is null
       and completed_at is null
       and purge_after <= now()
     order by purge_after
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  loop
    subject_digest := encode(digest(due.user_id::text, 'sha256'), 'hex');

    -- (1) 이 사용자를 향한 신고: 중대 건만 비식별 요약으로 남기고 원본은 지운다.
    insert into public.retained_moderation_records (
      record_kind, subject_digest, reason, report_status, reported_at
    )
    select 'report', subject_digest, r.reason, r.status, r.created_at
      from public.reports r
     where r.reported_id = due.user_id
       and r.status in ('open', 'under_review', 'actioned');
    delete from public.reports where reported_id = due.user_id;

    -- (2) 이 사용자가 제출한 신고: 신고당한 쪽 이력이므로 익명화만 한다.
    update public.reports
       set reporter_id = null,
           reporter_digest = subject_digest
     where reporter_id = due.user_id;

    -- (3) 이 사용자에게 내려진 제재: 재가입 악용 판단에 필요하므로 요약 보관.
    insert into public.retained_moderation_records (
      record_kind, subject_digest, action_type, reported_at
    )
    select 'moderation_action', subject_digest, m.action_type, m.created_at
      from public.moderation_actions m
     where m.subject_id = due.user_id
       and m.action_type <> 'dismissed';
    delete from public.moderation_actions where subject_id = due.user_id;

    update public.account_deletion_requests
       set completed_at = now()
     where user_id = due.user_id;

    delete from auth.users where id = due.user_id;
    purged := purged + 1;
  end loop;
  return purged;
end;
$$;

comment on function public.worker_purge_due_account_deletions(integer) is
  '유예 기간이 지난 계정을 파기한다. 중대 신고는 비식별 요약으로만 남는다.';

-- ---------------------------------------------------------------------------
-- 6. 사용자에게 보여줄 현재 상태
-- ---------------------------------------------------------------------------
create or replace view public.my_privacy_status
with (security_barrier = true) as
  select p.id as user_id,
         p.discovery_enabled,
         p.profile_visibility,
         p.log_default_visibility,
         public.has_current_consent('location') as location_consent_granted,
         public.has_current_consent('marketing') as marketing_consent_granted,
         d.requested_at as deletion_requested_at,
         d.purge_after as deletion_purge_after
    from public.profiles p
    left join public.account_deletion_requests d
      on d.user_id = p.id and d.cancelled_at is null and d.completed_at is null
   where p.id = auth.uid();

grant select on public.my_privacy_status to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 권한
-- ---------------------------------------------------------------------------
revoke all privileges on table public.account_deletion_requests
  from public, anon, authenticated;
grant select on table public.account_deletion_requests to authenticated;
revoke all privileges on table public.retained_moderation_records
  from public, anon, authenticated;

revoke execute on function private.prune_orphaned_candidates(uuid)
  from public, anon, authenticated;
revoke execute on function public.worker_purge_due_account_deletions(integer)
  from public, anon, authenticated;
grant execute on function public.worker_purge_due_account_deletions(integer) to service_role;

grant execute on function
  public.set_running_session_visibility(uuid, text),
  public.delete_running_session(uuid),
  public.set_profile_privacy(boolean, text, text),
  public.withdraw_location_consent(text),
  public.request_account_deletion(text, integer),
  public.cancel_account_deletion()
to authenticated;

commit;
