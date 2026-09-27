-- Isolated, rolled-back journey: seed only adult/consent/candidate prerequisites;
-- create the relationship through the same request and acceptance RPCs as the app.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000009901', 'journey-a@example.test'),
 ('00000000-0000-0000-0000-000000009902', 'journey-b@example.test');
insert into public.profiles (id, nickname, age_verified_at, discovery_enabled, profile_visibility) values
 ('00000000-0000-0000-0000-000000009901', '여정가', now(), true, 'matching'),
 ('00000000-0000-0000-0000-000000009902', '여정나', now(), true, 'matching');
insert into public.consent_records(user_id, consent_type, policy_version, granted)
 select u, c, 'journey-test', true from unnest(array['00000000-0000-0000-0000-000000009901'::uuid,'00000000-0000-0000-0000-000000009902'::uuid]) u
 cross join unnest(array['terms','privacy','location']) c;
insert into public.encounter_candidates(id, viewer_id, candidate_profile_id, similarity_label, repeat_encounters_30d, expires_at) values
 ('10000000-0000-0000-0000-000000009902','00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','good_match',public.repeat_encounter_threshold(),now()+interval '1 day');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009901',true);
set local role authenticated;
select is((select count(*)::int from public.encounter_candidates),1,'A discovers B through the app surface');
select is((select count(*)::int from public.list_chat_threads()),0,'discovery alone never opens chat');
select throws_ok($$insert into public.messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','premature')$$,'42501',null,'no messaging before acceptance');
select isnt(public.send_connection_request('00000000-0000-0000-0000-000000009902','10000000-0000-0000-0000-000000009902','weekend_5k',null),null,'A sends a normal request');
select is((select count(*)::int from public.list_chat_threads()),0,'pending request still has no chat');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009902',true);
set local role authenticated;
select is((select template_key from public.connection_request_summaries where requester_id='00000000-0000-0000-0000-000000009901'),'weekend_5k','B sees the selected request');
select ok(public.accept_connection_request((select id from public.connection_request_summaries where requester_id='00000000-0000-0000-0000-000000009901')),'B accepts using the normal RPC');
select is((select count(*)::int from public.list_chat_threads()),1,'B sees the accepted thread even without messages');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009901',true);
set local role authenticated;
select is((select count(*)::int from public.list_chat_threads()),1,'A sees the accepted thread');
select ok(public.set_match_preferences('unspecified','hidden'),'A hides from new matching after acceptance');
select is((select count(*)::int from public.list_chat_threads()),1,'hidden matching preserves accepted friendship');
select is((select count(*)::int from public.encounter_candidates),0,'hidden matching still closes discovery');
select lives_ok($$insert into public.messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','반가워요! 편한 페이스로 맞춰봐요.')$$,'A explicitly sends a first greeting');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009902',true);
set local role authenticated;
select is((select count(*)::int from public.messages),1,'B receives the greeting');
select is(public.mark_messages_read('00000000-0000-0000-0000-000000009901'),1,'B marks it read');
insert into public.user_blocks(blocker_id,blocked_id) values('00000000-0000-0000-0000-000000009902','00000000-0000-0000-0000-000000009901');
select is((select count(*)::int from public.list_chat_threads()),0,'block removes B thread');
select is((select count(*)::int from public.messages),0,'block hides B message surface');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009901',true);
set local role authenticated;
select is((select count(*)::int from public.list_chat_threads()),0,'block removes A thread too');
select is((select count(*)::int from public.encounter_candidates),0,'block removes A discovery');
select is((select count(*)::int from public.messages),0,'block hides A messages too');
select throws_ok($$insert into public.messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','after block')$$,'42501',null,'blocked pair cannot send again');
reset role;
select is((select count(*)::int from public.worker_claim_message_pushes(100) where sender_nickname='여정가'),0,'queued greeting cannot notify after block');
select * from finish();
rollback;
