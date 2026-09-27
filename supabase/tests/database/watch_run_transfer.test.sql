-- 워치 단독 러닝 이관이 폰 러닝과 **같은 표면**을 쓰고, 새 노출 경로를
-- 만들지 않는다는 성질을 고정한다.
--
-- 워치는 서버에 직접 쓰지 않는다. 폰이 워치가 넘긴 좌표를 받아 자기 세션과
-- 똑같이 `location_points`에 넣고 `submit_running_session`을 부른다. 그래서
-- 여기서 검증할 것은 "워치 전용 경로가 따로 없다"는 사실이다.
-- source가 'apple_watch'로 바뀌었다고 원본 좌표가 남에게 보이거나,
-- 클라이언트가 매칭 자격을 스스로 세울 수 있게 되면 안 된다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'watch-owner@example.test'),
  ('00000000-0000-0000-0000-000000000302', 'watch-stranger@example.test');
insert into public.profiles (id, nickname, age_verified_at) values
  ('00000000-0000-0000-0000-000000000301', '워치주인', now()),
  ('00000000-0000-0000-0000-000000000302', '남남', now());
insert into public.consent_records (user_id, consent_type, policy_version, granted, captured_at)
select user_id, consent_type, 'watch-test-v1', true, now() - interval '1 day'
  from (values
    ('00000000-0000-0000-0000-000000000301'::uuid),
    ('00000000-0000-0000-0000-000000000302'::uuid)
  ) as users(user_id)
  cross join (values ('terms'), ('privacy'), ('location')) as consents(consent_type);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
set local role authenticated;

-- 폰이 워치 러닝을 대신 만든다. source만 다를 뿐 같은 insert 경로다.
select lives_ok(
  $$
    insert into public.running_sessions (
      user_id, source, source_record_id, started_at, visibility
    ) values (
      auth.uid(), 'apple_watch', 'watch-1755000000-abcd1234',
      '2026-08-12T00:00:00Z', 'private'
    )
  $$,
  'the phone can open a session on the owner''s behalf for a watch-recorded run'
);

insert into public.location_points (
  session_id, user_id, recorded_at, latitude, longitude, accuracy_meters
)
select id, auth.uid(), '2026-08-12T00:00:05Z', 37.5, 127.0, 8
  from public.running_sessions where source_record_id = 'watch-1755000000-abcd1234';

-- 워치가 같은 파일을 두 번 배달해도 좌표가 불어나면 안 된다. 폰이 배달
-- 확인 전에 파일을 지우지 않으므로 재배달은 정상 동작이다.
insert into public.location_points (
  session_id, user_id, recorded_at, latitude, longitude, accuracy_meters
)
select id, auth.uid(), '2026-08-12T00:00:05Z', 37.5, 127.0, 8
  from public.running_sessions where source_record_id = 'watch-1755000000-abcd1234'
on conflict (session_id, recorded_at) do nothing;

select is(
  (
    select count(*)::integer from public.location_points
     where session_id = (
       select id from public.running_sessions
        where source_record_id = 'watch-1755000000-abcd1234'
     )
  ),
  1,
  'a redelivered watch GPS point does not duplicate'
);

-- 같은 source_record_id로 세션을 또 만들면 막혀야 한다. 폰이 적재 전에
-- 기존 세션을 찾아보는 이유가 이것이다.
select throws_ok(
  $$
    insert into public.running_sessions (
      user_id, source, source_record_id, started_at, visibility
    ) values (
      auth.uid(), 'apple_watch', 'watch-1755000000-abcd1234',
      '2026-08-12T00:00:00Z', 'private'
    )
  $$,
  '23505'
);

select ok(
  public.submit_running_session(
    (select id from public.running_sessions where source_record_id = 'watch-1755000000-abcd1234'),
    '2026-08-12T00:30:00Z',
    1800, 5000, 360, 1750, null, null,
    '{"total_points":1,"accepted_points":1}'::jsonb,
    '{"client":"apple-watch"}'::jsonb
  ),
  'a watch-recorded run is submitted through the same RPC as a phone run'
);

select is(
  (select status::text from public.running_sessions
    where source_record_id = 'watch-1755000000-abcd1234'),
  'processing',
  'a watch run waits for server validation like any other run'
);
select is(
  (select is_match_eligible from public.running_sessions
    where source_record_id = 'watch-1755000000-abcd1234'),
  false,
  'submitting a watch run never grants match eligibility'
);

reset role;

-- 남의 세션 id를 실제로 손에 쥔 상태를 만든다. RLS가 세션을 가려 주는 것에
-- 기대면, 아래 쓰기 차단 검사가 "0행을 넣어서 조용히 성공"으로 새어 나간다.
create temporary table watch_run_ids as
select id from public.running_sessions
 where source_record_id = 'watch-1755000000-abcd1234';
-- grant을 빠뜨리면 아래 검사가 RLS 대신 temp 테이블 권한 오류(같은 42501)를
-- 잡아 거짓 통과한다.
grant select on watch_run_ids to authenticated;

-- 핵심 성질: 워치에서 온 원본 좌표도 남에게는 보이지 않고, 남이 쓸 수도 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
set local role authenticated;

select is(
  (
    select count(*)::integer from public.location_points
     where user_id = '00000000-0000-0000-0000-000000000301'
  ),
  0,
  'raw GPS from a watch run stays invisible to every other user'
);
select is(
  (
    select count(*)::integer from public.running_sessions
     where source_record_id = 'watch-1755000000-abcd1234'
  ),
  0,
  'a watch run is not listed to anyone but its owner'
);

select throws_ok(
  $$
    insert into public.location_points (
      session_id, user_id, recorded_at, latitude, longitude
    )
    select id, '00000000-0000-0000-0000-000000000301', '2026-08-12T00:00:09Z', 37.5, 127.0
      from watch_run_ids
  $$,
  '42501'
);
-- 세션 id를 정확히 알고 직접 겨눠도 한 점도 보이지 않아야 한다.
select is(
  (
    select count(*)::integer from public.location_points
     where session_id in (select id from watch_run_ids)
  ),
  0,
  'knowing the session id does not reveal a watch run''s raw GPS'
);

reset role;
select * from finish();
rollback;
