begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.list_chat_threads()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_chat_threads()', 'EXECUTE'),
  'only signed-in users can list their conversations'
);
select ok(
  not has_table_privilege('authenticated', 'public.messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.messages', 'DELETE'),
  'message bodies can never be edited or deleted by clients'
);
select ok(
  has_function_privilege('authenticated', 'public.mark_messages_read(uuid)', 'EXECUTE'),
  'read receipts go through a narrow RPC instead of table UPDATE'
);
select ok(
  not has_table_privilege('authenticated', 'private.message_push_outbox', 'SELECT'),
  'the push outbox is server-only'
);

-- 실시간 갱신은 별도의 읽기 경로다. postgres_changes는 구독자의 JWT로 해당
-- 테이블의 RLS를 평가하므로, RLS가 꺼지거나 정책이 사라지면 실시간 경로로
-- 남의 메시지가 새어 나간다. 발행 등록과 RLS를 함께 고정한다.
select ok(
  exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'messages'
  ),
  'messages are published for realtime so conversations update live'
);
select ok(
  (select relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'messages'),
  'realtime never publishes a table whose row security is off'
);
select ok(
  (select relreplident from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'messages') = 'f',
  'read receipts reach the sender, which needs the full old row for RLS'
);
-- 원본 GPS가 실시간으로 흘러나가는 일은 없어야 한다.
select is(
  (select coalesce(string_agg(tablename, ', ' order by tablename), '')
     from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('location_points', 'session_route_summaries', 'running_sessions')),
  '',
  'location data is never streamed over realtime'
);
select ok(
  has_function_privilege('service_role', 'public.worker_claim_message_pushes(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.worker_claim_message_pushes(integer)', 'EXECUTE'),
  'only the worker claims push notifications'
);
select ok(
  not has_table_privilege('authenticated', 'public.push_tokens', 'INSERT'),
  'push tokens are registered through an RPC so nobody can claim another device'
);

-- ---------------------------------------------------------------------------
-- Fixtures: 상호 수락한 두 사람과, 아무 관계 없는 제3자
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000401', 'chat-a@example.test'),
  ('00000000-0000-0000-0000-000000000402', 'chat-b@example.test'),
  ('00000000-0000-0000-0000-000000000403', 'chat-c@example.test');

insert into public.profiles (id, nickname, birth_year, age_verified_at)
values
  ('00000000-0000-0000-0000-000000000401', '채팅가', 1990, now()),
  ('00000000-0000-0000-0000-000000000402', '채팅나', 1991, now()),
  ('00000000-0000-0000-0000-000000000403', '무관계', 1992, now());

insert into public.consent_records (user_id, consent_type, policy_version, granted, captured_at)
select user_id, consent_type, 'chat-test-v1', true, now() - interval '7 days'
  from (
    values
      ('00000000-0000-0000-0000-000000000401'::uuid),
      ('00000000-0000-0000-0000-000000000402'::uuid),
      ('00000000-0000-0000-0000-000000000403'::uuid)
  ) as u(user_id)
  cross join (
    values ('adult_confirmation'), ('terms'), ('privacy'), ('location')
  ) as c(consent_type);

insert into public.friendships (user_one_id, user_two_id)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000402'
);

-- ---------------------------------------------------------------------------
-- 상호 수락 없이는 채팅이 열리지 않는다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$
    insert into public.messages (sender_id, recipient_id, body)
    values (
      '00000000-0000-0000-0000-000000000403',
      '00000000-0000-0000-0000-000000000401',
      '안녕하세요'
    )
  $$,
  '42501',
  null,
  'a stranger cannot open a chat without mutual acceptance'
);
select is(
  (select count(*)::integer from public.list_chat_threads()),
  0,
  'a user with no accepted request sees no conversations'
);
reset role;

-- ---------------------------------------------------------------------------
-- 수락한 상대와의 대화
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
set local role authenticated;

insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000402',
  '주말 러닝 좋아요'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;

insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000401',
  '토요일 아침 어떠세요'
);

reset role;
-- created_at 기본값은 트랜잭션 시각이라 한 트랜잭션에서 넣은 메시지가 모두 같은
-- 시각이 된다. 실제 대화처럼 순서를 벌려 둔다. 클라이언트에는 created_at INSERT
-- 권한이 없으므로 여기서만 조정한다.
update public.messages set created_at = now() - interval '2 minutes'
 where body = '주말 러닝 좋아요';
update public.messages set created_at = now() - interval '1 minute'
 where body = '토요일 아침 어떠세요';
set local role authenticated;

select is(
  (select count(*)::integer from public.list_chat_threads()),
  1,
  'an accepted counterpart shows up as one conversation'
);
select is(
  (select partner_nickname from public.list_chat_threads()),
  '채팅가',
  'the conversation carries the counterpart nickname'
);
select is(
  (select last_message_body from public.list_chat_threads()),
  '토요일 아침 어떠세요',
  'the conversation shows the most recent message'
);
select ok(
  (select last_message_mine from public.list_chat_threads()),
  'the list marks whether the last message was mine'
);
select is(
  (select unread_count from public.list_chat_threads()),
  1,
  'messages I have not opened are counted as unread'
);
reset role;

-- ---------------------------------------------------------------------------
-- 읽음 처리
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;
select is(
  public.mark_messages_read('00000000-0000-0000-0000-000000000401'),
  1,
  'opening a conversation marks the received messages as read'
);
select is(
  public.mark_messages_read('00000000-0000-0000-0000-000000000401'),
  0,
  'reopening a conversation does not re-mark anything'
);
select is(
  (select unread_count from public.list_chat_threads()),
  0,
  'the unread badge clears once the conversation is opened'
);
reset role;

-- 읽음 처리는 내가 받은 메시지만 건드린다. 내가 보낸 메시지를 스스로 읽음으로
-- 바꿔 상대가 읽은 것처럼 보이게 만들 수 없어야 한다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
set local role authenticated;
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000402',
  '그럼 토요일에 봬요'
);
select is(
  public.mark_messages_read('00000000-0000-0000-0000-000000000402'),
  1,
  'marking read only ever touches messages I received'
);
reset role;

select ok(
  (select read_at is null from public.messages where body = '그럼 토요일에 봬요'),
  'a message I sent is not marked read on my own behalf'
);

-- ---------------------------------------------------------------------------
-- 메시지 신고: 증거는 서버가 만든다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;

select ok(
  public.report_message(
    (select id from public.messages where body = '주말 러닝 좋아요'),
    'hate',
    '불쾌한 표현이었어요'
  ) is not null,
  'the recipient can report a message straight from the conversation'
);
select throws_ok(
  $$
    select public.report_message(
      (select id from public.messages where body = '주말 러닝 좋아요'),
      'not_a_reason'
    )
  $$,
  '22023',
  null,
  'unknown report reasons are rejected'
);
-- 자기가 보낸 메시지를 신고해 상대 기록을 더럽힐 수 없다.
select throws_ok(
  $$
    select public.report_message(
      (select id from public.messages where body = '토요일 아침 어떠세요'),
      'hate'
    )
  $$,
  '42501',
  null,
  'only the recipient of a message can report it'
);
reset role;

select is(
  (select reported_id from public.reports where reason = 'hate'),
  '00000000-0000-0000-0000-000000000401'::uuid,
  'the report is filed against the message sender'
);
select is(
  (select evidence -> 0 ->> 'body' from public.reports where reason = 'hate'),
  '주말 러닝 좋아요',
  'the evidence is copied from the original message by the server'
);
select is(
  (select evidence -> 0 ->> 'kind' from public.reports where reason = 'hate'),
  'message',
  'the evidence records what kind of artefact it is'
);

-- ---------------------------------------------------------------------------
-- 푸시 알림: 본문은 나가지 않는다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
set local role authenticated;
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[chat-a-device]', 'ios')$$,
  'a signed-in user can register their device for notifications'
);
reset role;

select is(
  (select count(*)::integer from private.message_push_outbox),
  3,
  'every delivered message queues exactly one notification'
);

select ok(
  (select count(*) from public.worker_claim_message_pushes(10)) = 1,
  'the worker only sends to devices that are actually registered'
);
select is(
  (select sender_nickname from public.worker_claim_message_pushes(10)),
  null,
  'a claimed notification is not handed out twice'
);

-- 로그아웃한 기기로는 더 이상 알림이 가지 않는다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
set local role authenticated;
select lives_ok(
  $$select public.unregister_push_token('ExponentPushToken[chat-a-device]')$$,
  'logging out removes the device token'
);
select is(
  (select count(*)::integer from public.push_tokens),
  0,
  'no token remains for the signed-out device'
);
reset role;

-- ---------------------------------------------------------------------------
-- 차단하면 알림도 멈춘다.
-- ---------------------------------------------------------------------------
-- 대화 목록과 메시지 조회는 차단을 반영하지만 알림 발송이 별도 경로라, 차단
-- 전에 도착한 메시지의 알림이 뒤늦게 나가면 차단한 사람의 닉네임이 잠금화면에
-- 뜬다. 열 수도 없는 대화에 대한 알림이므로 발송 대상에서 빠져야 한다.
insert into public.friendships (user_one_id, user_two_id)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000403'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
set local role authenticated;
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000403',
  '00000000-0000-0000-0000-000000000401',
  '차단 직전에 보낸 메시지'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
set local role authenticated;
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[block-test]', 'ios')$$,
  'the recipient has a registered device'
);
insert into public.user_blocks (blocker_id, blocked_id)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000403'
);
select is(
  (select count(*)::integer from public.list_chat_threads()
    where partner_id = '00000000-0000-0000-0000-000000000403'),
  0,
  'blocking removes the conversation from the list'
);
reset role;

select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)
    where sender_nickname = '무관계'),
  0,
  'no notification is sent for a conversation the block already closed'
);

-- ---------------------------------------------------------------------------
-- 알림 유실 방지: 발송을 확인해야 완료 처리된다.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.worker_mark_message_pushes_delivered(bigint[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.worker_mark_message_pushes_delivered(bigint[])', 'EXECUTE'),
  'only the worker can confirm a notification was sent'
);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000404', 'chat-d@example.test');
insert into public.profiles (id, nickname, birth_year, age_verified_at)
values ('00000000-0000-0000-0000-000000000404', '알림받는이', 1990, now());
insert into public.consent_records (user_id, consent_type, policy_version, granted, captured_at)
select '00000000-0000-0000-0000-000000000404', t, 'chat-test-v1', true, now() - interval '7 days'
  from (values ('adult_confirmation'), ('terms'), ('privacy'), ('location')) v(t);
insert into public.friendships (user_one_id, user_two_id)
values ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000404');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
set local role authenticated;
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[retry-device]', 'ios')$$,
  'the recipient registers a device'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000404',
  '알림 확인용 메시지'
);
reset role;

-- 1회차: worker가 가져가지만 발송 확인은 하지 않는다 (Expo 호출 실패 상황).
select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)
    where token = 'ExponentPushToken[retry-device]'),
  1,
  'the worker claims the pending notification'
);
select ok(
  (select delivered_at is null from private.message_push_outbox
    where recipient_id = '00000000-0000-0000-0000-000000000404'),
  'claiming alone does not mark the notification as delivered'
);

-- 확인되지 않은 알림은 임대 시간이 지나면 다시 발송 대상이 된다.
select is(
  public.worker_fail_message_pushes(
    array(select id from private.message_push_outbox
           where recipient_id = '00000000-0000-0000-0000-000000000404'),
    'Expo push returned HTTP 502'
  ),
  1,
  'a failed send is recorded instead of being silently dropped'
);
select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)
    where token = 'ExponentPushToken[retry-device]'),
  1,
  'an unconfirmed notification is retried rather than lost'
);

-- 2회차: 발송을 확인하면 그때 완료된다.
select is(
  public.worker_mark_message_pushes_delivered(
    array(select id from private.message_push_outbox
           where recipient_id = '00000000-0000-0000-0000-000000000404')
  ),
  1,
  'confirming delivery closes the notification'
);
select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)
    where token = 'ExponentPushToken[retry-device]'),
  0,
  'a confirmed notification is never sent twice'
);

-- 재시도 상한을 넘기면 포기한다. 알림은 오래될수록 가치가 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000404',
  '재시도 상한 확인용'
);
reset role;

update private.message_push_outbox
   set attempts = public.message_push_max_attempts()
 where delivered_at is null and recipient_id = '00000000-0000-0000-0000-000000000404';

select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)),
  0,
  'a notification that exhausted its retries is not claimed again'
);
select is(
  (select last_error from private.message_push_outbox
    where delivered_at is null and abandoned_at is not null
      and recipient_id = '00000000-0000-0000-0000-000000000404'),
  'max_attempts_exhausted',
  'giving up records why, instead of leaving the row pending forever'
);

-- 보낼 기기가 없는 알림도 큐에 영원히 남지 않는다.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
set local role authenticated;
select lives_ok(
  $$select public.unregister_push_token('ExponentPushToken[retry-device]')$$,
  'the recipient signs out of their device'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
set local role authenticated;
insert into public.messages (sender_id, recipient_id, body)
values (
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000404',
  '기기 없는 상태 확인용'
);
reset role;

select is(
  (select count(*)::integer from public.worker_claim_message_pushes(10)),
  0,
  'nothing is claimed when the recipient has no device'
);
select is(
  (select count(*)::integer from private.message_push_outbox
    where recipient_id = '00000000-0000-0000-0000-000000000404'
      and abandoned_at is null and delivered_at is null),
  0,
  'an undeliverable notification is abandoned instead of retrying forever'
);

select * from finish();
rollback;
