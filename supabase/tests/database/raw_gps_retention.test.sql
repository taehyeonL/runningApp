begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- 권한: 원본 파기와 앵커 표는 운영 워커만 다룬다.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.worker_purge_expired_location_points(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.worker_purge_expired_location_points(integer)', 'EXECUTE'),
  'only service workers run the raw GPS purge'
);
select ok(
  not has_function_privilege('authenticated', 'private.summarize_session_route(uuid)', 'EXECUTE'),
  'clients cannot trigger route summarisation directly'
);
select ok(
  not has_table_privilege('authenticated', 'private.user_location_anchors', 'SELECT'),
  'the home/work anchor table is never readable by app users'
);
select ok(
  has_table_privilege('authenticated', 'public.session_route_summaries', 'SELECT')
  and not has_table_privilege('authenticated', 'public.session_route_summaries', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.session_route_summaries', 'DELETE'),
  'route summaries are read-only for the owner'
);
select is(
  public.raw_gps_retention_days(),
  30,
  'the notified raw GPS retention period is defined in one place'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000301', 'retention@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at)
values ('00000000-0000-0000-0000-000000000301', '보관', 1990, now());

-- 같은 지점에서 출발하는 러닝 두 번. 두 번째부터 그 지점은 생활 반경으로 본다.
insert into public.running_sessions (
  id, user_id, status, source_record_id, started_at, ended_at,
  duration_seconds, distance_meters, raw_points_purge_after
)
values
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-000000000301',
   'completed', 'retention-a', now() - interval '40 days', now() - interval '40 days' + interval '20 minutes',
   1200, 2226, now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-000000000301',
   'completed', 'retention-b', now() - interval '39 days', now() - interval '39 days' + interval '20 minutes',
   1200, 2226, now() - interval '9 days'),
  -- 아직 보관 기간이 남은 세션은 건드리면 안 된다.
  ('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-000000000301',
   'completed', 'retention-c', now() - interval '1 day', now() - interval '1 day' + interval '20 minutes',
   1200, 2226, now() + interval '29 days');

-- 세 세션 모두 37.5000/127.0 에서 북쪽으로 약 2.2km 직선 주행.
insert into public.location_points (
  session_id, user_id, recorded_at, latitude, longitude, accuracy_meters
)
select s.id,
       '00000000-0000-0000-0000-000000000301',
       s.started_at + make_interval(secs => i * 30),
       37.5000 + i * 0.0005,
       127.0000,
       8
  from public.running_sessions s
  cross join generate_series(0, 40) as i
 where s.user_id = '00000000-0000-0000-0000-000000000301';

-- ---------------------------------------------------------------------------
-- 보관 기한 공백: 새 세션은 생성 시점에 기한을 받는다.
-- ---------------------------------------------------------------------------
insert into public.running_sessions (id, user_id, source_record_id, started_at)
values (
  '00000000-0000-0000-0000-0000000b0004',
  '00000000-0000-0000-0000-000000000301',
  'retention-abandoned',
  now()
);
select ok(
  (select raw_points_purge_after is not null
     from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000b0004'),
  'an abandoned recording session still gets a purge deadline'
);
select ok(
  (select raw_points_purge_after
     from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000b0004')
  between now() + interval '29 days' and now() + interval '30 days',
  'the deadline follows the declared retention period'
);

-- ---------------------------------------------------------------------------
-- 파기 작업
-- ---------------------------------------------------------------------------
select ok(
  public.worker_purge_expired_location_points(10) > 0,
  'the worker purges raw GPS once the retention period has passed'
);

select is(
  (select count(*)::integer from public.location_points
    where session_id in (
      '00000000-0000-0000-0000-0000000b0001',
      '00000000-0000-0000-0000-0000000b0002'
    )),
  0,
  'expired sessions keep no raw GPS points at all'
);
select ok(
  (select count(*) from public.location_points
    where session_id = '00000000-0000-0000-0000-0000000b0003') > 0,
  'a session still inside its retention window is untouched'
);
select ok(
  (select raw_points_purged_at is null
     from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000b0003'),
  'the untouched session is not marked as purged'
);

-- 거리·페이스 기록은 남는다. 원본만 사라진다.
select is(
  (select distance_meters::integer from public.running_sessions
    where id = '00000000-0000-0000-0000-0000000b0001'),
  2226,
  'purging raw GPS keeps the run summary the user earned'
);

-- ---------------------------------------------------------------------------
-- 격자 요약 전환
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.session_route_summaries
    where session_id in (
      '00000000-0000-0000-0000-0000000b0001',
      '00000000-0000-0000-0000-0000000b0002'
    )),
  2,
  'each purged session is converted into a de-identified grid summary'
);
select ok(
  (select jsonb_array_length(cells) > 0 from public.session_route_summaries
    where session_id = '00000000-0000-0000-0000-0000000b0002'),
  'the summary keeps a coarse route instead of losing the run entirely'
);
select is(
  (select cell_size_meters from public.session_route_summaries
    where session_id = '00000000-0000-0000-0000-0000000b0002'),
  500,
  'route cells are hundreds of metres wide, not raw coordinates'
);

-- ---------------------------------------------------------------------------
-- 끝점 마스킹
-- ---------------------------------------------------------------------------
-- 도착 지점(37.5200)은 마지막 200m 안에 있으므로 어떤 요약에도 남지 않는다.
select ok(
  not (select cells @> to_jsonb(private.route_cell_key(37.5200, 127.0000))
         from public.session_route_summaries
        where session_id = '00000000-0000-0000-0000-0000000b0001'),
  'the finishing point is trimmed out of the summary'
);

-- ---------------------------------------------------------------------------
-- 반복 출발·도착 지점 자동 마스킹
-- ---------------------------------------------------------------------------
select ok(
  (select hit_count from private.user_location_anchors
    where user_id = '00000000-0000-0000-0000-000000000301'
      and cell_key = private.route_cell_key(37.5000, 127.0000)) >= 2,
  'a start point used twice is recorded as a living-area anchor'
);
select ok(
  not (select cells @> to_jsonb(private.route_cell_key(37.5000, 127.0000))
         from public.session_route_summaries
        where session_id = '00000000-0000-0000-0000-0000000b0002'),
  'a repeated start cell is masked out of the summary'
);
-- 집·직장은 나중에야 반복으로 드러나므로 과거 요약도 소급해 지워야 한다.
select ok(
  not (select cells @> to_jsonb(private.route_cell_key(37.5000, 127.0000))
         from public.session_route_summaries
        where session_id = '00000000-0000-0000-0000-0000000b0001'),
  'the anchor is scrubbed from summaries written before it was known'
);

-- ---------------------------------------------------------------------------
-- 운영 반복 실행
-- ---------------------------------------------------------------------------
select is(
  public.worker_purge_expired_location_points(10),
  0,
  're-running the purge job does no further work'
);
select is(
  (select count(*)::integer from public.session_route_summaries
    where session_id = '00000000-0000-0000-0000-0000000b0001'),
  1,
  're-running the job does not duplicate summaries'
);

-- ---------------------------------------------------------------------------
-- 요약 노출 범위
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000302', 'retention-other@example.test');
insert into public.profiles (id, nickname, birth_year, age_verified_at)
values ('00000000-0000-0000-0000-000000000302', '남의계정', 1990, now());

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.session_route_summaries),
  0,
  'another user cannot read anyone else route summary'
);
reset role;

select * from finish();
rollback;
