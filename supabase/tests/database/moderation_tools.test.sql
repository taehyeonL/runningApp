begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- 권한: 운영 도구는 앱 사용자에게 어떤 형태로도 열리지 않는다.
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.operator_review_queue(uuid,text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_review_queue(uuid,text,integer)', 'EXECUTE'),
  'the operator review queue is never reachable from the app'
);
select ok(
  has_function_privilege('service_role', 'public.operator_resolve_report(uuid,uuid,text,integer,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_resolve_report(uuid,uuid,text,integer,text,text)', 'EXECUTE'),
  'only operators can hand down a sanction'
);
select ok(
  not has_function_privilege('authenticated', 'public.operator_sanction_history(uuid,uuid)', 'EXECUTE'),
  'sanction history with internal notes stays server-side'
);
select ok(
  has_table_privilege('authenticated', 'public.user_moderation_notices', 'SELECT'),
  'a sanctioned user can read their own notice'
);
-- 같은 사실을 보여주는 창구가 둘이면 한쪽만 고쳐진다. 실제로 origin 필터가
-- 없는 옛 뷰를 통해 자동 임시 제한이 그대로 노출되고 있었다.
select is(
  (select count(*)::integer from information_schema.views
    where table_schema = 'public' and table_name = 'my_moderation_notices'),
  0,
  'there is exactly one place that shows a user their sanctions'
);
-- Supabase 기본 권한은 새 뷰에 ALL을 준다. 회수를 빠뜨린 뷰를 통째로 잡는다.
select is(
  (select coalesce(string_agg(distinct table_name, ', ' order by table_name), '')
     from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type <> 'SELECT'
      and g.table_name in (
        select table_name from information_schema.views where table_schema = 'public'
      )),
  '',
  'no view hands clients anything beyond SELECT'
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
-- 실제 조회/접촉 관계를 만들고 신고한다. 임의 UUID만 아는 사용자는 대상이 아니다.
insert into public.friendships(user_one_id,user_two_id) values
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000502'),
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000503'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000504');
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
  (select count(*)::integer from public.user_moderation_notices),
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
-- 운영자 명부: service_role 키만으로는 판단을 내릴 수 없다.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000509', 'operator@example.test'),
  ('00000000-0000-0000-0000-000000000510', 'ex-operator@example.test');
insert into public.profiles (id, nickname, birth_year, age_verified_at)
values
  ('00000000-0000-0000-0000-000000000509', '운영자', 1985, now()),
  ('00000000-0000-0000-0000-000000000510', '퇴사자', 1985, now());
insert into public.operators (user_id, label, active)
values
  ('00000000-0000-0000-0000-000000000509', '운영자 김', true),
  ('00000000-0000-0000-0000-000000000510', '퇴사한 운영자', false);

select ok(
  not has_table_privilege('authenticated', 'public.operators', 'SELECT')
  and not has_table_privilege('authenticated', 'public.moderation_audit_log', 'SELECT'),
  'the operator roster and audit trail are never visible to app users'
);
-- 권한을 회수당한 운영자는 키가 남아 있어도 아무것도 하지 못해야 한다.
select throws_ok(
  $$select public.operator_review_queue('00000000-0000-0000-0000-000000000510', 'under_review', 50)$$,
  '42501',
  null,
  'a deactivated operator cannot use the tools'
);
select throws_ok(
  $$select public.operator_review_queue('00000000-0000-0000-0000-000000000501', 'under_review', 50)$$,
  '42501',
  null,
  'an ordinary user id cannot be passed off as an operator'
);

-- ---------------------------------------------------------------------------
-- 운영자 검토 큐
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.operator_review_queue('00000000-0000-0000-0000-000000000509', 'under_review', 50)) > 0,
  'the accumulated reports appear in the operator queue'
);
select is(
  (select distinct_reporters_30d from public.operator_review_queue('00000000-0000-0000-0000-000000000509', 'under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  2,
  'the queue shows how many different people reported the subject'
);
select is(
  (select confirmed_violations_90d from public.operator_review_queue('00000000-0000-0000-0000-000000000509', 'under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  0,
  'an automatic hold is not counted as a confirmed violation'
);
select ok(
  (select currently_restricted from public.operator_review_queue('00000000-0000-0000-0000-000000000509', 'under_review', 50)
    where subject_id = '00000000-0000-0000-0000-000000000501' limit 1),
  'the queue shows that exposure is already on hold'
);

-- ---------------------------------------------------------------------------
-- 기각: 허위 신고로 끊긴 노출은 되살아나야 한다.
-- ---------------------------------------------------------------------------
select is(
  public.operator_resolve_report(
    '00000000-0000-0000-0000-000000000509',
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
    '00000000-0000-0000-0000-000000000509',
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
  (select count(*)::integer from public.user_moderation_notices),
  1,
  'the sanctioned user is told about the confirmed sanction'
);
select ok(
  (select user_notice like '%이의%' from public.user_moderation_notices limit 1),
  'the notice explains how to appeal'
);
select ok(
  (select ends_at is not null from public.user_moderation_notices limit 1),
  'the notice states when the restriction ends'
);
reset role;

-- 신고자 신원과 내부 메모는 당사자에게 절대 보이지 않는다.
select ok(
  not exists (
    select 1 from information_schema.columns
     where table_name = 'user_moderation_notices'
       and column_name in ('internal_notes', 'report_id', 'subject_id')
  ),
  'the notice view exposes neither internal notes nor the reporter link'
);

-- 운영자는 자동 조치와 확정 제재를 구분해 이력을 본다.
select is(
  (select count(*)::integer from public.operator_sanction_history('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000504')),
  2,
  'the sanction history keeps both the automatic hold and the confirmed action'
);
select is(
  (select count(*)::integer from public.operator_sanction_history('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000504')
    where origin = 'operator'),
  1,
  'only one of them is a confirmed operator decision'
);

-- ---------------------------------------------------------------------------
-- 책임 소재: 누가 내렸는지 남는다.
-- ---------------------------------------------------------------------------
-- 사람의 이용을 끊는 도구에 행위자가 없으면 실제 운영에 쓸 수 없다.
select is(
  (select decided_by_label from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000504'
      and origin = 'operator'),
  '운영자 김',
  'a confirmed sanction records which operator handed it down'
);
select ok(
  (select decided_by is null from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000504'
      and origin = 'auto'),
  'an automatic hold has no operator attached, because nobody decided it'
);
select is(
  (select count(*)::integer from public.moderation_audit_log
    where action = 'resolved_report'
      and operator_id = '00000000-0000-0000-0000-000000000509'),
  2,
  'every operator decision is written to the audit trail'
);
select is(
  (select detail ->> 'action_type' from public.moderation_audit_log
    where action = 'resolved_report'
      and subject_id = '00000000-0000-0000-0000-000000000504'),
  'suspension',
  'the audit entry records what was decided, not just that something was'
);

-- 내부 메모까지 보이는 조회는 누가 누구를 열어봤는지 남겨야 한다.
select is(
  (select count(*)::integer from public.moderation_audit_log
    where action = 'viewed_sanction_history'
      and subject_id = '00000000-0000-0000-0000-000000000504'),
  2,
  'opening a user sanction history is itself recorded'
);

-- 운영자 계정이 지워져도 판단 기록은 남아야 한다.
delete from auth.users where id = '00000000-0000-0000-0000-000000000509';
select is(
  -- 판단 2건(기각·정지) + 제재 이력 조회 2건
  (select count(*)::integer from public.moderation_audit_log
    where operator_label = '운영자 김'),
  4,
  'the audit trail outlives the operator account that produced it'
);
select is(
  (select decided_by_label from public.moderation_actions
    where subject_id = '00000000-0000-0000-0000-000000000504'
      and origin = 'operator'),
  '운영자 김',
  'a sanction still says who decided it after that operator is removed'
);

select * from finish();
rollback;
