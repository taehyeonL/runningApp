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
  ('00000000-0000-0000-0000-000000000101', '상태A', 1990, now()),
  ('00000000-0000-0000-0000-000000000102', '상태B', 1991, now()),
  ('00000000-0000-0000-0000-000000000103', '상태C', 1992, now()),
  ('00000000-0000-0000-0000-000000000104', '상태D', 1993, now());

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

select * from finish();
rollback;
