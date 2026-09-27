begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_table_privilege('authenticated', 'public.connection_requests', 'UPDATE'),
  'request rows cannot bypass transition RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.connection_request_events', 'SELECT'),
  'request audit events are server-only'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.connection_requests', 'resolution_reason', 'SELECT'
  ),
  'automatic cancellation reasons are not disclosed to clients'
);
select ok(
  has_table_privilege(
    'authenticated', 'public.connection_request_summaries', 'SELECT'
  ),
  'participants read request state through the safe projection'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.transition_connection_request(uuid,public.request_status,public.request_resolution_reason,text)',
    'EXECUTE'
  ),
  'the generic transition helper is not a client RPC'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.expire_due_connection_requests(integer)', 'EXECUTE'
  ),
  'expiry batches are server-only'
);
select ok(
  has_function_privilege(
    'service_role', 'public.expire_due_connection_requests(integer)', 'EXECUTE'
  ),
  'service workers can expire due requests'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.has_active_moderation_action(uuid,text[])', 'EXECUTE'
  ),
  'clients cannot probe another user moderation status directly'
);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000101', 'state-a@example.test'),
  ('00000000-0000-0000-0000-000000000102', 'state-b@example.test'),
  ('00000000-0000-0000-0000-000000000103', 'state-c@example.test'),
  ('00000000-0000-0000-0000-000000000104', 'state-d@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at)
values
  ('00000000-0000-0000-0000-000000000101', '상태가', 1990, now()),
  ('00000000-0000-0000-0000-000000000102', '상태나', 1991, now()),
  ('00000000-0000-0000-0000-000000000103', '상태다', 1992, now()),
  ('00000000-0000-0000-0000-000000000104', '상태라', 1993, now());

insert into public.consent_records (user_id, consent_type, policy_version, granted)
select user_id, consent_type, 'state-test-v1', true
  from (
    values
      ('00000000-0000-0000-0000-000000000101'::uuid),
      ('00000000-0000-0000-0000-000000000102'::uuid),
      ('00000000-0000-0000-0000-000000000103'::uuid),
      ('00000000-0000-0000-0000-000000000104'::uuid)
  ) as users(user_id)
  cross join (
    values ('terms'), ('privacy'), ('location')
  ) as consents(consent_type);

-- Request 1: only its recipient may decline it.
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key
) values (
  '30000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'weekend_5k'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103',
  true
);
set local role authenticated;

select is(
  public.cancel_connection_request('30000000-0000-0000-0000-000000000101'),
  false,
  'a third party cannot cancel another request'
);
select is(
  public.decline_connection_request('30000000-0000-0000-0000-000000000101'),
  false,
  'a third party cannot decline another request'
);
select is(
  public.accept_connection_request('30000000-0000-0000-0000-000000000101'),
  false,
  'a third party cannot accept another request'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102',
  true
);
set local role authenticated;

select is(
  public.decline_connection_request('30000000-0000-0000-0000-000000000101'),
  true,
  'the recipient can decline a pending request'
);
select is(
  public.decline_connection_request('30000000-0000-0000-0000-000000000101'),
  false,
  'a terminal request cannot transition twice'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$
    update public.connection_requests
       set status = 'pending', resolution_reason = null, responded_at = null
     where id = '30000000-0000-0000-0000-000000000101'
  $$
);
select is(
  (
    select status::text || ':' || resolution_reason::text
      from public.connection_requests
     where id = '30000000-0000-0000-0000-000000000101'
  ),
  'declined:recipient_declined',
  'decline records a machine-readable terminal reason'
);
select is(
  (
    select count(*)::integer
      from public.connection_request_events
     where request_id = '30000000-0000-0000-0000-000000000101'
  ),
  2,
  'request creation and transition are both audited'
);

-- Request 2: blocking either direction cancels it immediately.
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key
) values (
  '30000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103',
  'morning_run'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);
set local role authenticated;
insert into public.user_blocks (blocker_id, blocked_id)
values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select is(
  (
    select status::text || ':' || resolution_reason::text
      from public.connection_requests
     where id = '30000000-0000-0000-0000-000000000102'
  ),
  'cancelled:blocked',
  'blocking cancels pending requests with the blocked reason'
);

-- Requests in opposite directions share one canonical pending slot.
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key
) values (
  '30000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103',
  'after_work_jog'
);
select throws_ok(
  $$
    insert into public.connection_requests (
      id, requester_id, recipient_id, template_key
    ) values (
      '30000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000103',
      '00000000-0000-0000-0000-000000000102',
      'after_work_jog'
    )
  $$
);

-- Request restrictions cancel outbound contact but do not expose internal notes.
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key
) values (
  '30000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000104',
  '00000000-0000-0000-0000-000000000101',
  'weekend_5k'
);
insert into public.moderation_actions (
  subject_id, action_type, internal_notes, user_notice
) values (
  '00000000-0000-0000-0000-000000000104',
  'request_restriction',
  'operator-only evidence summary',
  '요청 기능이 일시 제한되었습니다.'
);

select is(
  (
    select status::text || ':' || resolution_reason::text
      from public.connection_requests
     where id = '30000000-0000-0000-0000-000000000105'
  ),
  'cancelled:moderation_restricted',
  'request restriction cancels outbound pending requests'
);

-- An expired request becomes terminal when a recipient attempts acceptance.
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key, created_at, expires_at
) values (
  '30000000-0000-0000-0000-000000000106',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'morning_run',
  now() - interval '8 days',
  now() - interval '1 day'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102',
  true
);
set local role authenticated;
select is(
  public.accept_connection_request('30000000-0000-0000-0000-000000000106'),
  false,
  'an expired request cannot be accepted'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select is(
  (
    select status::text || ':' || resolution_reason::text
      from public.connection_requests
     where id = '30000000-0000-0000-0000-000000000106'
  ),
  'expired:expired_timeout',
  'an attempted expired acceptance records timeout expiry'
);

-- Suspension dynamically hides existing social relationships and chat.
insert into public.friendships (user_one_id, user_two_id)
values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102'
);
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  'message hidden by suspension'
);
insert into public.moderation_actions (
  subject_id, action_type, user_notice
) values (
  '00000000-0000-0000-0000-000000000102',
  'suspension',
  '계정 이용이 일시 정지되었습니다.'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.friendships),
  0,
  'a suspended friendship is hidden from the other participant'
);
select is(
  (select count(*)::integer from public.messages),
  0,
  'messages involving a suspended account are hidden'
);

-- 요청 자격 기준은 public.repeat_encounter_threshold() 한 곳에서만 결정된다.
-- 숫자를 직접 쓰지 않고 함수를 호출해 비교하므로, 기준이 다시 바뀌어도 이 테스트는
-- 그대로 유효하다. 반대로 판정 지점 중 하나만 옛 숫자로 남으면 여기서 깨진다.
reset role;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000105', 'threshold-viewer@example.test'),
  ('00000000-0000-0000-0000-000000000106', 'threshold-at@example.test'),
  ('00000000-0000-0000-0000-000000000107', 'threshold-below@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at)
values
  ('00000000-0000-0000-0000-000000000105', '기준뷰어', 1990, now()),
  ('00000000-0000-0000-0000-000000000106', '기준충족', 1991, now()),
  ('00000000-0000-0000-0000-000000000107', '기준미달', 1992, now());

insert into public.consent_records (user_id, consent_type, policy_version, granted)
select user_id, consent_type, 'state-test-v1', true
  from (
    values
      ('00000000-0000-0000-0000-000000000105'::uuid),
      ('00000000-0000-0000-0000-000000000106'::uuid),
      ('00000000-0000-0000-0000-000000000107'::uuid)
  ) as users(user_id)
  cross join (
    values ('terms'), ('privacy'), ('location')
  ) as consents(consent_type);

-- request_eligible 을 일부러 반대로 넣는다. 트리거가 횟수에서 다시 파생시키지
-- 않으면 아래 두 단언이 모두 뒤집힌다.
insert into public.encounter_candidates (
  id, viewer_id, candidate_profile_id, similarity_label,
  repeat_encounters_30d, request_eligible, expires_at
) values
  (
    '10000000-0000-0000-0000-000000000106',
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000106',
    'good_match', public.repeat_encounter_threshold(), false, now() + interval '7 days'
  ),
  (
    '10000000-0000-0000-0000-000000000107',
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000107',
    'good_match', public.repeat_encounter_threshold() - 1, true, now() + interval '7 days'
  );

select is(
  (select request_eligible from public.encounter_candidates
    where id = '10000000-0000-0000-0000-000000000106'),
  true,
  'a candidate at the threshold is derived eligible even when written as false'
);
select is(
  (select request_eligible from public.encounter_candidates
    where id = '10000000-0000-0000-0000-000000000107'),
  false,
  'a candidate below the threshold is derived ineligible even when written as true'
);

-- worker는 on conflict do update 로 같은 행을 다시 쓴다. before insert 만 막고
-- update 를 놓치면 재검출 한 번에 옛 기준이 되살아난다.
insert into public.encounter_candidates (
  viewer_id, candidate_profile_id, similarity_label,
  repeat_encounters_30d, request_eligible, expires_at
) values (
  '00000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000106',
  'good_match', public.repeat_encounter_threshold(), false, now() + interval '7 days'
)
on conflict (viewer_id, candidate_profile_id) do update
  set repeat_encounters_30d = excluded.repeat_encounters_30d,
      request_eligible = excluded.request_eligible;

select is(
  (select request_eligible from public.encounter_candidates
    where id = '10000000-0000-0000-0000-000000000106'),
  true,
  'a re-detected candidate keeps the derived eligibility on conflict update'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000105',
  true
);
set local role authenticated;

select isnt(
  public.send_connection_request(
    '00000000-0000-0000-0000-000000000106',
    '10000000-0000-0000-0000-000000000106',
    'weekend_5k'
  ),
  null,
  'a request is accepted at exactly the repeat encounter threshold'
);
select throws_ok(
  $$
    select public.send_connection_request(
      '00000000-0000-0000-0000-000000000107',
      '10000000-0000-0000-0000-000000000107',
      'weekend_5k'
    )
  $$,
  '42501',
  'Request is not eligible',
  'a request one encounter below the threshold is refused'
);

select * from finish();
rollback;
