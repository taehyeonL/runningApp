begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- 데이터 통제 기능은 요금제와 무관한 기본 권리다. 권한 회귀가 생기면
-- 사용자가 자기 기록을 지우지 못하게 되므로 capability부터 고정한다.
-- INSERT 정책만 있고 grant가 없으면 러닝 시작 자체가 42501로 막힌다.
select ok(
  has_column_privilege('authenticated', 'public.running_sessions', 'started_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.running_sessions', 'distance_meters', 'INSERT')
  and not has_column_privilege('authenticated', 'public.running_sessions', 'is_match_eligible', 'INSERT'),
  'clients can start a run but cannot forge server-judged fields'
);
select ok(
  has_function_privilege('authenticated', 'public.set_running_session_visibility(uuid,text)', 'EXECUTE'),
  'clients can change the visibility of their own log'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_running_session(uuid)', 'EXECUTE'),
  'clients can delete an individual run for free'
);
select ok(
  has_function_privilege('authenticated', 'public.withdraw_location_consent(text)', 'EXECUTE'),
  'clients can withdraw location consent from inside the app'
);
select ok(
  has_function_privilege('authenticated', 'public.request_account_deletion(text,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_account_deletion()', 'EXECUTE'),
  'clients can request and undo account deletion'
);
select ok(
  not has_function_privilege('authenticated', 'public.worker_purge_due_account_deletions(integer)', 'EXECUTE'),
  'only service workers may execute the irreversible purge'
);
select ok(
  has_function_privilege('service_role', 'public.worker_purge_due_account_deletions(integer)', 'EXECUTE'),
  'service workers can purge due accounts'
);
select ok(
  not has_function_privilege('authenticated', 'private.prune_orphaned_candidates(uuid)', 'EXECUTE'),
  'candidate pruning is an internal helper, not a client RPC'
);
select ok(
  has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT')
  and not has_table_privilege('authenticated', 'public.account_deletion_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.account_deletion_requests', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.account_deletion_requests', 'DELETE'),
  'deletion schedule is readable but only mutable through the RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.retained_moderation_records', 'SELECT'),
  'de-identified moderation retention is never exposed to app users'
);
select ok(
  has_table_privilege('authenticated', 'public.my_privacy_status', 'SELECT')
  and not has_table_privilege('anon', 'public.my_privacy_status', 'SELECT'),
  'only the signed-in user reads their own privacy status'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000201', 'control-a@example.test'),
  ('00000000-0000-0000-0000-000000000202', 'control-b@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at, discovery_enabled, profile_visibility)
values
  ('00000000-0000-0000-0000-000000000201', '통제A', 1990, now(), true, 'matching'),
  ('00000000-0000-0000-0000-000000000202', '통제B', 1991, now(), true, 'matching');

-- captured_at은 트랜잭션 시각 now()로 고정되므로, 동의와 철회를 한 트랜잭션에서
-- 만들면 has_current_consent의 정렬이 두 행 사이에서 갈린다. 실제 서비스처럼
-- 가입 시점 동의를 과거로 두어야 철회가 최신 상태로 판정된다.
insert into public.consent_records (user_id, consent_type, policy_version, granted, captured_at)
select user_id, consent_type, 'control-test-v1', true, now() - interval '7 days'
  from (
    values
      ('00000000-0000-0000-0000-000000000201'::uuid),
      ('00000000-0000-0000-0000-000000000202'::uuid)
  ) as u(user_id)
  cross join (
    values ('adult_confirmation'), ('terms'), ('privacy'), ('location')
  ) as c(consent_type);

insert into public.running_sessions (
  id, user_id, status, started_at, ended_at, duration_seconds,
  distance_meters, visibility, raw_points_purge_after
)
values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000201',
   'completed', now() - interval '2 hours', now() - interval '1 hour', 3600,
   5200, 'private', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-000000000202',
   'completed', now() - interval '2 hours', now() - interval '1 hour', 3600,
   5100, 'private', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-000000000201',
   'completed', now() - interval '1 day', now() - interval '23 hours', 3600,
   4800, 'private', now() + interval '30 days');

insert into public.location_points (session_id, user_id, recorded_at, latitude, longitude, accuracy_meters)
values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000201',
   now() - interval '90 minutes', 37.5665, 126.9780, 8),
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000201',
   now() - interval '89 minutes', 37.5666, 126.9781, 9);

insert into private.co_running_encounters (
  user_low_id, user_high_id, session_low_id, session_high_id, encounter_day,
  confidence, overlap_seconds, overlap_meters, average_distance_meters,
  average_direction_delta_degrees, pace_delta_ratio
)
values (
  '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0002',
  current_date, 0.8200, 240, 900, 22.5, 12.0, 0.0800
);

insert into public.encounter_candidates (
  viewer_id, candidate_profile_id, similarity_label, repeat_encounters_30d,
  request_eligible, expires_at
)
values (
  '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202',
  'good_match', 5, true, now() + interval '7 days'
);

-- ---------------------------------------------------------------------------
-- 로그별 공개 범위
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select ok(
  public.set_running_session_visibility('00000000-0000-0000-0000-0000000a0001', 'friends'),
  'the owner can open a single log to friends'
);
select ok(
  not public.set_running_session_visibility('00000000-0000-0000-0000-0000000a0002', 'matching'),
  'the visibility RPC refuses another user log'
);
select throws_ok(
  $$ select public.set_running_session_visibility(
       '00000000-0000-0000-0000-0000000a0001', 'public'
     ) $$,
  '22023',
  null,
  'unknown visibility values are rejected instead of silently stored'
);

reset role;
select is(
  (select visibility::text from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000a0001'),
  'friends',
  'the visibility change is persisted'
);
select is(
  (select visibility::text from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000a0002'),
  'private',
  'another user log is untouched'
);

-- ---------------------------------------------------------------------------
-- 개별 로그 삭제: 원본 GPS와 근거 없는 발견 카드까지 사라져야 한다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select ok(
  public.delete_running_session('00000000-0000-0000-0000-0000000a0001'),
  'the owner can delete an individual run'
);
select ok(
  not public.delete_running_session('00000000-0000-0000-0000-0000000a0002'),
  'deleting another user run is refused'
);
reset role;

select is(
  (select count(*)::integer from public.location_points
    where session_id = '00000000-0000-0000-0000-0000000a0001'),
  0,
  'deleting a run removes its raw GPS points'
);
select is(
  (select count(*)::integer from private.co_running_encounters
    where session_low_id = '00000000-0000-0000-0000-0000000a0001'),
  0,
  'deleting a run removes the co-running evidence derived from it'
);
select is(
  (select count(*)::integer from public.encounter_candidates
    where viewer_id = '00000000-0000-0000-0000-000000000201'),
  0,
  'a discovery card with no remaining evidence disappears for both sides'
);

-- ---------------------------------------------------------------------------
-- 위치 동의 철회
-- ---------------------------------------------------------------------------
set local role authenticated;
select ok(
  public.withdraw_location_consent('control-test-v1') >= 1,
  'withdrawing location consent schedules the remaining raw GPS for purge'
);
reset role;

select ok(
  (select bool_and(raw_points_purge_after <= now())
     from public.running_sessions
    where user_id = '00000000-0000-0000-0000-000000000201'),
  'every remaining run of the user becomes purge-eligible immediately'
);
select ok(
  not (select discovery_enabled from public.profiles
        where id = '00000000-0000-0000-0000-000000000201'),
  'withdrawing location consent also stops discovery'
);
select ok(
  not public.has_current_consent('location'),
  'the withdrawal is recorded as the current consent state'
);

-- 러닝 기록 자체는 사용자의 자산이므로 동의 철회로 사라지지 않는다.
select ok(
  (select count(*) from public.running_sessions
    where user_id = '00000000-0000-0000-0000-000000000201') > 0,
  'withdrawing location consent keeps distance and pace history'
);

-- ---------------------------------------------------------------------------
-- 계정 삭제 신청 · 취소 · 파기
-- ---------------------------------------------------------------------------
-- 탈퇴자를 향한 신고와, 탈퇴자가 남을 향해 낸 신고는 처리 방식이 달라야 한다.
insert into public.reports (reporter_id, reported_id, reason, status)
values (
  '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000201',
  'stalking', 'under_review'
), (
  '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202',
  'fraud', 'under_review'
);

insert into public.moderation_actions (subject_id, action_type, user_notice)
values (
  '00000000-0000-0000-0000-000000000201', 'suspension', '반복 신고로 이용이 제한되었습니다.'
);

set local role authenticated;
select ok(
  public.request_account_deletion('개인정보가 걱정돼요', 30) between now() + interval '29 days' and now() + interval '30 days',
  'account deletion is scheduled after a grace period'
);
reset role;

select is(
  (select profile_visibility::text from public.profiles
    where id = '00000000-0000-0000-0000-000000000201'),
  'private',
  'requesting deletion hides the profile immediately'
);

set local role authenticated;
select ok(public.cancel_account_deletion(), 'the user can undo deletion during the grace period');
select ok(
  not public.cancel_account_deletion(),
  'cancelling twice is not treated as a second undo'
);
select ok(
  (select count(*) from public.account_deletion_requests) = 1,
  'the user can read their own deletion schedule'
);
reset role;

-- 유예 기간이 지난 신청만 파기된다.
set local role authenticated;
select ok(public.request_account_deletion(null, 30) is not null, 'deletion can be requested again');
reset role;

select is(
  public.worker_purge_due_account_deletions(10),
  0,
  'the worker does not purge an account still inside its grace period'
);

update public.account_deletion_requests
   set purge_after = now() - interval '1 minute'
 where user_id = '00000000-0000-0000-0000-000000000201';

select is(
  public.worker_purge_due_account_deletions(10),
  1,
  'the worker purges an account whose grace period has passed'
);
select is(
  (select count(*)::integer from auth.users
    where id = '00000000-0000-0000-0000-000000000201'),
  0,
  'purging removes the auth account so every table cascades'
);
select is(
  (select count(*)::integer from public.running_sessions
    where user_id = '00000000-0000-0000-0000-000000000201'),
  0,
  'purging removes the run history through cascade'
);
select is(
  (select count(*)::integer from public.retained_moderation_records
    where record_kind = 'report' and reason = 'stalking'),
  1,
  'an open stalking report survives deletion in de-identified form'
);
select ok(
  (select subject_digest from public.retained_moderation_records where reason = 'stalking')
    <> '00000000-0000-0000-0000-000000000201',
  'the retained record stores a digest, not the original user id'
);
select is(
  (select count(*)::integer from public.retained_moderation_records
    where record_kind = 'moderation_action' and action_type = 'suspension'),
  1,
  'a sanction against the departing account is retained for re-signup abuse checks'
);

-- 남을 신고한 기록까지 지우면 신고당한 쪽의 운영 이력이 사라진다.
select is(
  (select count(*)::integer from public.reports
    where reported_id = '00000000-0000-0000-0000-000000000202'
      and reason = 'fraud'),
  1,
  'a report filed by the departing user against someone else survives'
);
select ok(
  (select reporter_id is null and reporter_digest is not null
     from public.reports
    where reported_id = '00000000-0000-0000-0000-000000000202'),
  'the surviving report keeps only an anonymised reporter digest'
);

-- ---------------------------------------------------------------------------
-- 동의 판정은 결정적이어야 한다.
-- ---------------------------------------------------------------------------
-- captured_at 기본값은 트랜잭션 시각이라, 같은 트랜잭션에서 같은 유형의 동의와
-- 철회가 기록되면 두 행의 captured_at이 같다. 예전에는 순서를 uuid로 갈라
-- 어느 쪽이 이길지 알 수 없었다. 위치 수집을 여는 값이므로 뒤에 기록된 쪽이
-- 항상 이겨야 한다.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000203', 'consent-order@example.test');
insert into public.profiles (id, nickname, birth_year, age_verified_at)
values ('00000000-0000-0000-0000-000000000203', '동의순서', 1990, now());

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
set local role authenticated;

-- 같은 트랜잭션, 같은 시각에 동의 → 철회 → 재동의 순으로 기록한다.
select lives_ok(
  $$select public.record_consent('location', 'tie-break-v1', true)$$,
  'the user grants location consent'
);
select lives_ok(
  $$select public.record_consent('location', 'tie-break-v1', false)$$,
  'the user withdraws it in the same transaction'
);
select ok(
  not public.has_current_consent('location'),
  'the withdrawal wins because it was recorded last'
);

select lives_ok(
  $$select public.record_consent('location', 'tie-break-v1', true)$$,
  'the user grants it again'
);
select ok(
  public.has_current_consent('location'),
  'the latest record always wins, regardless of matching timestamps'
);
reset role;

-- 같은 captured_at을 가진 행들이 실제로 만들어졌는지 확인한다. 시각이 서로
-- 달랐다면 이 테스트는 tie-break를 검증하지 못한 셈이 된다.
select ok(
  (select count(distinct captured_at) from public.consent_records
    where user_id = '00000000-0000-0000-0000-000000000203'
      and consent_type = 'location') = 1,
  'the three records really do share one timestamp, so the tie-break was exercised'
);

-- 동의 판정이 여러 곳에 복사되어 있으면 경로마다 답이 갈린다.
select is(
  (select count(*)::integer from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%consent_records%'
      and p.proname <> 'consent_granted'
      and p.proname <> 'record_consent'),
  0,
  'consent state is decided in exactly one place'
);

select * from finish();
rollback;
