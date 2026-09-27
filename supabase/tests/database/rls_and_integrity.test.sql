begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Capability-level regression checks: table-wide grants must never silently
-- re-open protected server fields.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'age_verified_at', 'UPDATE'),
  'clients cannot self-verify age'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'completed_run_count', 'UPDATE'),
  'clients cannot edit trust aggregates'
);
select ok(
  not has_column_privilege('authenticated', 'public.running_sessions', 'is_match_eligible', 'INSERT')
  and not has_column_privilege('authenticated', 'public.running_sessions', 'is_match_eligible', 'UPDATE'),
  'clients cannot mark a run match-eligible'
);
select ok(
  not has_column_privilege('authenticated', 'public.consent_records', 'captured_at', 'INSERT'),
  'clients cannot forge consent timestamps'
);
select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'SELECT'),
  'clients cannot read moderation_actions directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'nickname', 'UPDATE')
  and has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE'),
  'nickname changes use the cooldown RPC while other safe profile fields remain editable'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'birth_year', 'UPDATE'),
  'verified users cannot change birth year without server re-verification'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'clients cannot erase safety evidence through profile deletion'
);
select ok(
  not has_table_privilege('anon', 'public.public_profiles', 'SELECT'),
  'anonymous callers cannot enumerate public profiles'
);
select ok(
  has_table_privilege('authenticated', 'public.public_profiles', 'SELECT'),
  'authenticated callers can read their candidate-scoped projection'
);
select ok(
  has_table_privilege('authenticated', 'public.social_profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.social_profiles', 'SELECT'),
  'only authenticated callers can read the relationship-scoped social projection'
);
select ok(
  not has_table_privilege('authenticated', 'public.operational_alerts', 'SELECT'),
  'operational alerts are never exposed to app users'
);
select ok(
  not has_table_privilege('authenticated', 'public.worker_http_requests', 'SELECT'),
  'scheduled worker request correlation is server-only'
);
select ok(
  not has_function_privilege('anon', 'public.cleanup_after_block()', 'EXECUTE'),
  'trigger helpers are not callable by anonymous clients'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.send_connection_request(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated callers use the guarded request RPC'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.location_points'::regclass
       and conname = 'location_points_session_recorded_at_key'
       and contype = 'u'
  ),
  'GPS retries have a database uniqueness boundary'
);
select is(
  (
    select count(*)::integer
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'user_moderation_notices'
       and column_name = 'internal_notes'
  ),
  0,
  'the user moderation view omits internal notes'
);

-- Use stable IDs so friendship canonical ordering is deterministic.
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'rls-a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'rls-b@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'rls-c@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at)
values
  ('00000000-0000-0000-0000-000000000001', '러너가', 1990, now()),
  ('00000000-0000-0000-0000-000000000002', '러너나', 1991, now()),
  ('00000000-0000-0000-0000-000000000003', '러너다', 1992, now());

insert into public.consent_records (user_id, consent_type, policy_version, granted)
select user_id, consent_type, 'rls-test-v1', true
  from (
    values
      ('00000000-0000-0000-0000-000000000001'::uuid),
      ('00000000-0000-0000-0000-000000000002'::uuid)
  ) as users(user_id)
  cross join (
    values ('terms'), ('privacy'), ('location')
  ) as consents(consent_type);

insert into public.encounter_candidates (
  id, viewer_id, candidate_profile_id, similarity_label,
  repeat_encounters_30d, request_eligible, expires_at
) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'good_match', 5, true, now() + interval '1 day'
);

insert into public.running_sessions (id, user_id, started_at)
values (
  '20000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  now() - interval '10 minutes'
);

insert into public.connection_requests (
  id, requester_id, recipient_id, candidate_id, template_key
) values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'weekend_5k'
);

insert into public.friendships (user_one_id, user_two_id)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'RLS test message'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select results_eq(
  $$select id from public.public_profiles order by id$$,
  $$values ('00000000-0000-0000-0000-000000000002'::uuid)$$,
  'public profile projection contains only server-issued candidates'
);

select results_eq(
  $$select id from public.social_profiles order by id$$,
  $$values ('00000000-0000-0000-0000-000000000002'::uuid)$$,
  'social profile projection contains only a current safe relationship'
);

select throws_ok(
  $$update public.profiles set completed_run_count = 999 where id = auth.uid()$$
);

-- 세션 id는 서버가 발급한다. 클라이언트는 재시도 멱등성을 위해
-- source_record_id만 정하고, unique(user_id, source, source_record_id)가
-- 중복 생성을 막는다.
select lives_ok(
  $$
    insert into public.running_sessions (
      user_id, source, source_record_id, started_at, visibility
    ) values (
      auth.uid(), 'phone', 'pg-tap-run-a', '2026-08-12T00:00:00Z', 'private'
    )
  $$,
  'the owner can start a recording session'
);

insert into public.location_points (
  session_id, user_id, recorded_at, latitude, longitude, accuracy_meters
)
select id, auth.uid(), '2026-08-12T00:00:05Z', 37.5, 127.0, 8
  from public.running_sessions where source_record_id = 'pg-tap-run-a';
insert into public.location_points (
  session_id, user_id, recorded_at, latitude, longitude, accuracy_meters
)
select id, auth.uid(), '2026-08-12T00:00:05Z', 37.5, 127.0, 8
  from public.running_sessions where source_record_id = 'pg-tap-run-a'
on conflict (session_id, recorded_at) do nothing;

select is(
  (
    select count(*)::integer
      from public.location_points
     where session_id = (
       select id from public.running_sessions where source_record_id = 'pg-tap-run-a'
     )
  ),
  1,
  'a retried GPS point is idempotent'
);

select ok(
  public.submit_running_session(
    (select id from public.running_sessions where source_record_id = 'pg-tap-run-a'),
    '2026-08-12T00:01:00Z',
    60, 100, 600, 60, null, null,
    '{"total_points":1,"accepted_points":1}'::jsonb,
    '{"client":"pg_tap"}'::jsonb
  ),
  'the owner can submit a recording session for server processing'
);
select is(
  (
    select status::text
      from public.running_sessions
     where source_record_id = 'pg-tap-run-a'
  ),
  'processing',
  'submission moves the session to processing, not client-completed'
);
select throws_ok(
  $$select count(*) from public.detection_jobs$$
);

select throws_ok(
  $$
    insert into public.location_points (
      session_id, user_id, recorded_at, latitude, longitude
    ) values (
      '20000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      now(), 37.5, 127.0
    )
  $$
);

insert into public.user_blocks (blocker_id, blocked_id)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

select is(
  (select count(*)::integer from public.encounter_candidates),
  0,
  'blocking immediately removes the candidate from client visibility'
);
select is(
  (select count(*)::integer from public.messages),
  0,
  'blocking immediately hides existing messages'
);

reset role;

select is(
  (
    select status::text
      from public.connection_requests
     where id = '30000000-0000-0000-0000-000000000001'
  ),
  'cancelled',
  'blocking atomically cancels pending requests in either direction'
);
select is(
  (
    select count(*)::integer
      from public.encounter_candidates
     where viewer_id = '00000000-0000-0000-0000-000000000001'
       and candidate_profile_id = '00000000-0000-0000-0000-000000000002'
  ),
  0,
  'blocking physically removes both directions of the candidate pair'
);

-- ---------------------------------------------------------------------------
-- 접근 판정은 한 벌만 존재해야 한다.
-- ---------------------------------------------------------------------------
-- 이 저장소에서 반복된 사고가 전부 "같은 판정이 여러 벌 있고 한쪽만 고쳐졌다"
-- 였다. is_pair_visible / can_send_message / is_request_eligible는 private으로
-- 옮긴 뒤에도 public 사본이 남아 두 벌로 유지되고 있었다. 같은 이름이 두 스키마에
-- 동시에 존재하면 새 정책이 낡은 사본에 연결돼도 아무도 알아채지 못한다.
select is(
  (select coalesce(string_agg(proname, ', ' order by proname), '')
     from (
       select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prokind = 'f'
          and n.nspname in ('public', 'private')
        group by p.proname
       having count(distinct n.nspname) > 1
     ) duplicated),
  '',
  'no access decision exists in both public and private'
);

-- 살아있는 정책·뷰가 실제로 private 쪽을 보고 있는지도 고정한다.
select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%private.is_pair_visible%'
  ),
  'discovery policies decide visibility through the private helper'
);

select * from finish();
rollback;
