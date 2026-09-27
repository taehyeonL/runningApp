begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('00000000-0000-0000-0000-000000000361','dev-a@example.test','{"dev_social_test":{"enabled":true,"source":"manual_test_not_pass"}}'),
 ('00000000-0000-0000-0000-000000000362','dev-b@example.test','{"dev_social_test":{"enabled":true,"source":"manual_test_not_pass"}}'),
 ('00000000-0000-0000-0000-000000000363','ordinary@example.test','{}');
insert into public.profiles(id,nickname,age_verified_at) values
 ('00000000-0000-0000-0000-000000000361','시험가',now()),
 ('00000000-0000-0000-0000-000000000362','시험나',now()),
 ('00000000-0000-0000-0000-000000000363','일반러너',now());
insert into public.consent_records(user_id,consent_type,policy_version,granted)
select u,c,'dev-fixture-test',true from (values('00000000-0000-0000-0000-000000000361'::uuid),('00000000-0000-0000-0000-000000000362'::uuid),('00000000-0000-0000-0000-000000000363'::uuid)) users(u)
cross join (values('terms'),('privacy')) consents(c);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000361',true);
set local role authenticated;
select is(jsonb_array_length(public.list_dev_test_runners()->'runners'),1,'only explicitly enabled peers are listed');
select lives_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000362')$$,'test pair connects without runs, candidates, or requests');
select lives_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000362')$$,'repeated connection is idempotent and has no cooldown');
select throws_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000363')$$,'42501','테스트 친구 연결 권한이 없거나 안전 제한이 적용되어 있어요.','normal users cannot be targeted');
reset role;
select is((select count(*)::integer from public.friendships where user_one_id=auth.uid()),1,'exactly one relationship');
select is((select count(*)::integer from public.connection_requests where requester_id=auth.uid()),0,'no manufactured accepted request');
insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),'00000000-0000-0000-0000-000000000362');
set local role authenticated;
select is(jsonb_array_length(public.list_dev_test_runners()->'runners'),0,'blocks remove peers from test directory');
select throws_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000362')$$,'42501','테스트 친구 연결 권한이 없거나 안전 제한이 적용되어 있어요.','test connection never bypasses block');
reset role;
delete from public.user_blocks where blocker_id=auth.uid();
update auth.users set raw_app_meta_data='{}' where id='00000000-0000-0000-0000-000000000362';
set local role authenticated;
select is(jsonb_array_length(public.list_dev_test_runners()->'runners'),0,'operator revocation removes target');
select throws_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000362')$$,'42501','테스트 친구 연결 권한이 없거나 안전 제한이 적용되어 있어요.','revocation disables RPC');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000363',true);
update auth.users set raw_user_meta_data='{"dev_social_test":{"enabled":true,"source":"manual_test_not_pass"}}' where id=auth.uid();
set local role authenticated;
select is(public.list_dev_test_runners()->>'enabled','false','user-editable metadata cannot enable test mode');
select throws_ok($$select public.connect_dev_test_friend('00000000-0000-0000-0000-000000000361')$$,'42501','테스트 친구 연결 권한이 없거나 안전 제한이 적용되어 있어요.','normal caller cannot use fixture RPC');
reset role;
select ok(not has_function_privilege('anon','public.connect_dev_test_friend(uuid)','EXECUTE'),'anonymous execution denied');
select * from finish();
rollback;
