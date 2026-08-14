begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- 권한: 운영 도구는 앱 사용자에게 어떤 형태로도 열리지 않는다.
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.operator_review_queue(text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_review_queue(text,integer)', 'EXECUTE'),
  'the operator review queue is never reachable from the app'
);
select ok(
  has_function_privilege('service_role', 'public.operator_resolve_report(uuid,text,integer,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_resolve_report(uuid,text,integer,text,text)', 'EXECUTE'),
  'only operators can hand down a sanction'
);
select ok(
  not has_function_privilege('authenticated', 'public.operator_sanction_history(uuid)', 'EXECUTE'),
  'sanction history with internal notes stays server-side'
);
select ok(
  has_table_privilege('authenticated', 'public.my_moderation_notices', 'SELECT'),
  'a sanctioned user can read their own notice'
);
select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'SELECT'),
  'the raw sanction table with internal notes is not client readable'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000501', 'mod-subject@example.test'),
  ('00000000-0000-0000-0000-000000000502', 'mod-reporter-a@example.test'),
  ('00000000-0000-0000-0000-000000000503', 'mod-reporter-b@example.test'),
  ('00000000-0000-0000-0000-000000000504', 'mod-subject-two@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at, discovery_enabled)
values
  ('00000000-0000-0000-0000-000000000501', '신고대상', 1990, now(), true),
  ('00000000-0000-0000-0000-000000000502', '신고자가', 1991, now(), true),
  ('00000000-0000-0000-0000-000000000503', '신고자나', 1992, now(), true),
  ('00000000-0000-0000-0000-000000000504', '대상둘', 1993, now(), true);

-- ---------------------------------------------------------------------------
-- 프로필 신고: 증거는 서버가 만든다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000502', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select ok(
  public.report_profile('00000000-0000-0000-0000-000000000501', 'hate', '반복적인 폭언') is not null,
  'a user can report a profile'
);
select throws_ok(
  $$select public.report_profile('00000000-0000-0000-0000-000000000502', 'hate')$$,
  '22023',
  null,
  'reporting yourself is rejected'
);
reset role;

select is(
  (select evidence -> 0 ->> 'nickname' from public.reports
    where reported_id = '00000000-0000-0000-0000-000000000501' and reason = 'hate'),
  '신고대상',
  'the profile snapshot is captured by the server as evidence'
);

-- ---------------------------------------------------------------------------
-- 한 사람의 반복 신고만으로는 노출이 끊기지 않는다. (보복 신고 방지)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000502', true);
set local role authenticated;
select ok(
  public.report_profile('00000000-0000-0000-0000-000000000501', 'other', '또 신고합니다') is not null,
  'the same reporter can file again'
);
reset role;

select is(
  (select count(*)::integer from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000501'),
  0,
  'repeated reports from a single user do not restrict anyone'
);

-- ---------------------------------------------------------------------------
-- 서로 다른 이용자 2명 → 자동 노출 제한 + 검토 대기
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000503', true);
set local role authenticated;
select ok(
  public.report_profile('00000000-0000-0000-0000-000000000501', 'other', '저도 불쾌했어요') is not null,
  'a second, different user files a report'
);
reset role;

select is(
  (select count(*)::integer from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000501'
      and action_type = 'visibility_restriction'
      and origin = 'auto'),
  1,
  'reports from two different users temporarily stop discovery exposure'
);
select is(
  (select count(*)::integer from public.reports
    where reported_id = '00000000-0000-0000-0000-000000000501' and status = 'open'),
  0,
  'the accumulated reports move into the operator review queue'
);

-- 자동 제한은 확정 제재가 아니므로 당사자 안내에 뜨지 않는다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000501', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.my_moderation_notices),
  0,
  'an automatic hold is not shown to the user as a confirmed sanction'
);
reset role;

-- 신고가 더 들어와도 제재 이력이 중복으로 쌓이지 않는다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000503', true);
set local role authenticated;
select ok(
  public.report_profile('00000000-0000-0000-0000-000000000501', 'other', '한 번 더') is not null,
  'another report arrives while the hold is active'
);
reset role;
select is(
  (select count(*)::integer from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000501'),
  1,
  'an active hold is not stacked on every new report'
);

-- ---------------------------------------------------------------------------
-- 중대 사안은 1건이라도 즉시 노출을 멈추되, 계정을 자동 정지하지는 않는다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000502', true);
set local role authenticated;
select ok(
  public.report_profile('00000000-0000-0000-0000-000000000504', 'stalking', '계속 따라옵니다') is not null,
  'a single severe report is enough to act on'
);
reset role;

select is(
  (select action_type from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000504'),
  'visibility_restriction',
  'a severe report stops exposure immediately'
);
select is(
  (select count(*)::integer from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000504'
      and action_type in ('suspension', 'ban')),
  0,
  'an unreviewed report never suspends an account on its own'
);

-- ---------------------------------------------------------------------------
-- 운영자 검토 큐
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.operator_review_queue('under_review', 50)) > 0,
  'the accumulated reports appear in the operator queue'
);
select is(
  (select distinct_reporters_30d from public.operator_review_queue('under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  2,
  'the queue shows how many different people reported the subject'
);
select is(
  (select confirmed_violations_90d from public.operator_review_queue('under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  0,
  'an automatic hold is not counted as a confirmed violation'
);
select ok(
  (select currently_restricted from public.operator_review_queue('under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  'the queue shows that exposure is already on hold'
);

-- ---------------------------------------------------------------------------
-- 기각: 허위 신고로 끊긴 노출은 되살아나야 한다.
-- ---------------------------------------------------------------------------
select is(
  public.operator_resolve_report(
    (select id from public.reports
      where reported_id = '00000000-0000-0000-0000-000000000501' limit 1),
    'dismissed'
  ),
  null,
  'an operator can dismiss a report'
);
select ok(
  (select resolved_at is not null from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000501'),
  'dismissing a report records who lifted the automatic hold'
);
-- 실제로 제한이 풀렸는지는 기존 집행 함수로 확인해야 한다. resolved_at만 찍고
-- ends_at을 안 당기면 사용자는 영원히 막힌 채로 남는다.
select ok(
  not private.has_active_moderation_action(
    '00000000-0000-0000-0000-000000000501',
    array['visibility_restriction', 'suspension', 'ban']
  ),
  'a dismissed report actually restores the user, not just the audit column'
);

-- ---------------------------------------------------------------------------
-- 확정 제재: 사유·기간이 당사자에게 안내된다.
-- ---------------------------------------------------------------------------
select ok(
  public.operator_resolve_report(
    (select id from public.reports where reported_id = '00000000-0000-0000-0000-000000000504' limit 1),
    'suspension',
    30,
    '스토킹 신고가 확인되어 30일간 이용이 제한됩니다. 이의가 있으면 고객센터로 알려주세요.',
    '증거: 메시지 3건 확인'
  ) is not null,
  'an operator can confirm a suspension after reviewing the evidence'
);
select is(
  (select status::text from public.reports where reported_id = '00000000-0000-0000-0000-000000000504'),
  'actioned',
  'resolving a report closes it instead of leaving it open'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000504', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.my_moderation_notices),
  1,
  'the sanctioned user is told about the confirmed sanction'
);
select ok(
  (select user_notice like '%이의%' from public.my_moderation_notices limit 1),
  'the notice explains how to appeal'
);
select ok(
  (select ends_at is not null from public.my_moderation_notices limit 1),
  'the notice states when the restriction ends'
);
reset role;

-- 신고자 신원과 내부 메모는 당사자에게 절대 보이지 않는다.
select ok(
  not exists (
    select 1 from information_schema.columns
     where table_name = 'my_moderation_notices'
       and column_name in ('internal_notes', 'report_id', 'subject_id')
  ),
  'the notice view exposes neither internal notes nor the reporter link'
);

-- 운영자는 자동 조치와 확정 제재를 구분해 이력을 본다.
select is(
  (select count(*)::integer from public.operator_sanction_history('00000000-0000-0000-0000-000000000504')),
  2,
  'the sanction history keeps both the automatic hold and the confirmed action'
);
select is(
  (select count(*)::integer from public.operator_sanction_history('00000000-0000-0000-0000-000000000504')
    where origin = 'operator'),
  1,
  'only one of them is a confirmed operator decision'
);

select * from finish();
rollback;
