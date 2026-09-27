-- Launch profile/discovery/appointment surfaces use the normal mutual-consent journey.
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
select is(public.get_my_discovery_status(),'ready','owner sees actual candidate state');
select ok(public.set_runner_introduction('천천히 달려요','quiet','5k'),'owner saves selected profile traits');
select is((select bio from public.get_runner_introduction()),'천천히 달려요','owner reads own intro');
select throws_ok($$select public.set_runner_introduction(repeat('가',301),'quiet','5k')$$,'22023',null,'intro length is server validated');
select throws_ok($$select public.set_runner_introduction('소개','invalid','5k')$$,'22023',null,'trait enum is server validated');
select throws_ok($$select public.propose_running_appointment('00000000-0000-0000-0000-000000009902','this_week','daytime','5k')$$,'42501',null,'candidate alone cannot propose appointment');
select is((select count(*)::int from public.list_running_appointments('00000000-0000-0000-0000-000000009902')),0,'candidate has no appointment read access');
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
select isnt(public.propose_running_appointment('00000000-0000-0000-0000-000000009902','this_week','daytime','5k'),null,'accepted pair can propose');
select is((select count(*)::int from public.list_running_appointments('00000000-0000-0000-0000-000000009902')),1,'proposer reads appointment');
select is((select week_start from public.list_running_appointments('00000000-0000-0000-0000-000000009902')),date_trunc('week',now() at time zone 'Asia/Seoul')::date,'appointment week is fixed when proposed');
select is(public.respond_running_appointment((select id from public.list_running_appointments('00000000-0000-0000-0000-000000009902')),'confirmed'),false,'proposer cannot accept own proposal');
select throws_ok($$select public.propose_running_appointment('00000000-0000-0000-0000-000000009902','this_week','daytime','5k')$$,'23505',null,'only one active appointment per unordered pair');
select ok(public.set_match_preferences('unspecified','hidden'),'A hides from new matching after acceptance');
select is((select count(*)::int from public.list_chat_threads()),1,'hidden matching preserves accepted friendship');
select is((select count(*)::int from public.encounter_candidates),0,'hidden matching still closes discovery');
select is(public.get_my_discovery_status(),'hidden','hidden is distinguished from empty');
select is((select count(*)::int from public.list_running_appointments('00000000-0000-0000-0000-000000009902')),1,'hidden matching preserves accepted appointment');
select lives_ok($$insert into public.messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','반가워요! 편한 페이스로 맞춰봐요.')$$,'A explicitly sends a first greeting');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009902',true);
set local role authenticated;
select is((select count(*)::int from public.messages),1,'B receives the greeting');
select is(public.mark_messages_read('00000000-0000-0000-0000-000000009901'),1,'B marks it read');
select is((select bio from public.social_runner_details where id='00000000-0000-0000-0000-000000009901'),'천천히 달려요','friend can see safe intro');
select ok(public.respond_running_appointment((select id from public.list_running_appointments('00000000-0000-0000-0000-000000009901')),'confirmed'),'recipient alone can confirm');
select set_config('test.appointment_id',(select id::text from public.list_running_appointments('00000000-0000-0000-0000-000000009901')),true);
select is(public.respond_running_appointment((select id from public.list_running_appointments('00000000-0000-0000-0000-000000009901')),'declined'),false,'stale transition rejected');
insert into public.user_blocks(blocker_id,blocked_id) values('00000000-0000-0000-0000-000000009902','00000000-0000-0000-0000-000000009901');
select is((select count(*)::int from public.list_chat_threads()),0,'block removes B thread');
select is((select count(*)::int from public.messages),0,'block hides B message surface');
select is((select count(*)::int from public.social_runner_details),0,'block hides every intro surface');
select is((select count(*)::int from public.list_running_appointments('00000000-0000-0000-0000-000000009901')),0,'block hides appointments');
select is(public.respond_running_appointment(current_setting('test.appointment_id')::uuid,'completed'),false,'block prevents changing known appointment id');
select throws_ok($$select public.propose_running_appointment('00000000-0000-0000-0000-000000009901','this_week','daytime','5k')$$,'42501',null,'block prevents appointment writes');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009901',true);
set local role authenticated;
select is((select count(*)::int from public.list_chat_threads()),0,'block removes A thread too');
select is((select count(*)::int from public.encounter_candidates),0,'block removes A discovery');
select is((select count(*)::int from public.messages),0,'block hides A messages too');
select throws_ok($$insert into public.messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902','after block')$$,'42501',null,'blocked pair cannot send again');
reset role;
select is((select count(*)::int from public.worker_claim_message_pushes(100) where sender_nickname='여정가'),0,'queued greeting cannot notify after block');
select ok(not has_table_privilege('authenticated','private.running_appointments','SELECT'),'no base appointment table access');
select ok(not has_function_privilege('anon','public.get_my_discovery_status()','EXECUTE'),'anon cannot read discovery status');
select ok(not has_function_privilege('anon','public.propose_running_appointment(uuid,text,text,text)','EXECUTE'),'anon cannot propose');
select ok(not has_column_privilege('authenticated','public.profiles','conversation_preference','UPDATE'),'new profile fields are RPC-only');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='social_runner_details' and column_name in('matching_gender','match_preference','started_at','latitude','longitude')),'safe detail surface contains no matching-private or location fields');
insert into public.moderation_actions(subject_id,action_type,origin,internal_notes)
values('00000000-0000-0000-0000-000000009902','visibility_restriction','auto','internal only');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009902',true);
set local role authenticated;
select is(public.get_my_discovery_status(),'searching','discovery status does not identify internal automatic hold');
reset role;
select * from finish();
rollback;
