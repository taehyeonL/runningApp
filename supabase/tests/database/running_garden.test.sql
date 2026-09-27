begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000341','garden-a@example.test'),
 ('00000000-0000-0000-0000-000000000342','garden-b@example.test');
insert into public.profiles(id,nickname,age_verified_at,discovery_enabled,profile_visibility) values
 ('00000000-0000-0000-0000-000000000341','정원가',now(),true,'matching'),
 ('00000000-0000-0000-0000-000000000342','정원나',now(),true,'matching');
insert into public.consent_records(user_id,consent_type,policy_version,granted)
select u,c,'garden-test',true from (values('00000000-0000-0000-0000-000000000341'::uuid),('00000000-0000-0000-0000-000000000342'::uuid)) users(u)
cross join (values('terms'),('privacy'),('location')) consents(c);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000341',true);
set local role authenticated;
select lives_ok($$select public.start_garden()$$,'owner opts in');
select lives_ok($$select public.start_garden()$$,'start is idempotent');
select is(public.get_garden(auth.uid())->'inventory','{"flower":1,"tree":1,"rock":1,"sun_seed":1,"clover_seed":1}'::jsonb,'legacy and seed starter gifts only once');
select is(public.get_garden(auth.uid())->>'visibility','private','default private');
select throws_ok($$select public.save_garden(0,'[{"cell":0,"itemId":"fountain"}]','private')$$,'22023','Invalid garden layout','cannot place unowned rare');
select throws_ok($$select public.save_garden(0,'[{"cell":16,"itemId":"flower"}]','private')$$,'22023','Invalid garden layout','locked cells rejected');
select throws_ok($$select public.save_garden(0,'[{"cell":0,"itemId":"flower"},{"cell":1,"itemId":"flower"}]','private')$$,'22023','Invalid garden layout','quantity cannot duplicate');
select lives_ok($$select public.save_garden(0,'[{"cell":0,"itemId":"flower","gps":"must not persist"}]','matching')$$,'valid placement saved');
select is(public.get_garden(auth.uid())->'placements','[{"cell":0,"itemId":"flower"}]'::jsonb,'unknown metadata stripped');
select throws_ok($$select public.save_garden(0,'[]','private')$$,'40001','다른 화면에서 정원이 변경되었어요. 새로고침 후 다시 꾸며주세요.','stale writer rejected');
reset role;
insert into public.running_sessions(id,user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary) values
 ('00000000-0000-0000-0000-000000000351','00000000-0000-0000-0000-000000000341','processing',now(),now()+interval '1 minute',60,250,'{"server_validated":true,"rejection_reasons":["distance_below_3km"]}'),
 ('00000000-0000-0000-0000-000000000352','00000000-0000-0000-0000-000000000341','processing',now(),now()+interval '1 minute',60,250,'{"server_validated":true,"rejection_reasons":["distance_below_3km"]}');
select is((select count(*)::integer from private.garden_credits where owner_id=auth.uid()),0,'pending no credit');
update public.running_sessions set status='completed' where id='00000000-0000-0000-0000-000000000351';
select is((select meters from private.gardens where owner_id=auth.uid()),250::numeric,'short valid run counts');
update public.running_sessions set status='completed' where id='00000000-0000-0000-0000-000000000352';
select is((select sum(opportunities)::integer from private.garden_credits where owner_id=auth.uid()),1,'250 plus 250 gives one opportunity');
create temp table prior_rewards as select * from private.garden_credits where owner_id=auth.uid();
update public.running_sessions set status='completed' where id='00000000-0000-0000-0000-000000000352';
select results_eq('select rewards from private.garden_credits where owner_id=auth.uid() order by session_id','select rewards from prior_rewards order by session_id','no reroll');
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed',now(),now()+interval '4 hours',14400,41500,'{"server_validated":true,"rejection_reasons":[]}');
select is((public.get_garden(auth.uid())->>'cellCount')::integer,20,'42km unlocks 4 cells');
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed',now(),now()+interval '30 minutes',1800,5000,'{"server_validated":true,"rejection_reasons":["low_quality_ratio"]}');
select is((select meters from private.gardens where owner_id=auth.uid()),42000::numeric,'invalid quality never credited');
delete from public.running_sessions where id='00000000-0000-0000-0000-000000000352';
select is((select meters from private.gardens where owner_id=auth.uid()),42000::numeric,'log deletion preserves reward progress');
select ok(not has_table_privilege('authenticated','private.garden_inventory','SELECT') and not has_table_privilege('authenticated','private.gardens','UPDATE'),'no direct access');
select ok(not has_function_privilege('anon','public.get_garden(uuid)','EXECUTE'),'anonymous denied');
select is((select sum(weight)::integer from private.garden_catalog where rarity='rare'),5,'ordinary catalog includes positive rare chance');
select is((select sum(weight)::integer from private.garden_catalog),60,'catalog weight plus no drop totals 100');
select lives_ok($$select public.set_garden_collecting(false)$$,'participation may be withdrawn');
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed',now(),now()+interval '30 minutes',1800,5000,'{"server_validated":true,"rejection_reasons":[]}');
select is((select meters from private.gardens where owner_id=auth.uid()),42000::numeric,'withdrawal prevents new credit');
select lives_ok($$select public.set_garden_collecting(true)$$,'participation resumes');
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed',now()-interval '1 day',now()-interval '23 hours',3600,5000,'{"server_validated":true,"rejection_reasons":[]}');
select is((select meters from private.gardens where owner_id=auth.uid()),42000::numeric,'late upload of pre-participation run earns nothing');
insert into public.running_sessions(id,user_id,source_record_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values('00000000-0000-0000-0000-000000000359',auth.uid(),'garden-replay','completed',now(),now()+interval '30 minutes',1800,5000,'{"server_validated":true,"rejection_reasons":[]}');
delete from public.running_sessions where id='00000000-0000-0000-0000-000000000359';
insert into public.running_sessions(user_id,source_record_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'garden-replay','completed',now(),now()+interval '30 minutes',1800,5000,'{"server_validated":true,"rejection_reasons":[]}');
select is((select meters from private.gardens where owner_id=auth.uid()),47000::numeric,'deleting and importing same source does not reward again');
insert into public.encounter_candidates(viewer_id,candidate_profile_id,similarity_label,repeat_encounters_30d,expires_at)
values('00000000-0000-0000-0000-000000000342','00000000-0000-0000-0000-000000000341','good_match',3,now()+interval '1 day');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000342',true);
set local role authenticated;
select lives_ok($$select public.get_garden('00000000-0000-0000-0000-000000000341')$$,'candidate may visit opted-in garden');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_garden('00000000-0000-0000-0000-000000000341')) k),array['catalog','cellCount','nickname','ownerId','placements']::text[],'visitor projection has no time route inventory or reward history');
select throws_ok($$select public.run_garden_rewards('00000000-0000-0000-0000-000000000351')$$,'42501','Run unavailable','visitor cannot read rewards');
reset role;
select ok(not private.can_pair_message(auth.uid(),'00000000-0000-0000-0000-000000000341'),'garden access grants no chat');
delete from public.encounter_candidates where viewer_id=auth.uid();
select ok(not private.can_visit_garden('00000000-0000-0000-0000-000000000341'),'candidate expiry/removal revokes visit');
insert into public.friendships(user_one_id,user_two_id) values('00000000-0000-0000-0000-000000000341','00000000-0000-0000-0000-000000000342');
select is(jsonb_array_length(public.garden_friends()),1,'friend directory includes permitted garden');
update private.gardens set visibility='private' where owner_id='00000000-0000-0000-0000-000000000341';
select is(jsonb_array_length(public.garden_friends()),0,'private removes garden from directory');
select ok(not private.can_visit_garden('00000000-0000-0000-0000-000000000341'),'private revokes direct visit');
update private.gardens set visibility='friends' where owner_id='00000000-0000-0000-0000-000000000341';
update public.profiles set age_verified_at=null where id=auth.uid();
select is(jsonb_array_length(public.garden_friends()),0,'adult gate applies to friend directory');
select ok(not private.can_visit_garden('00000000-0000-0000-0000-000000000341'),'adult gate applies to direct visit');
update public.profiles set age_verified_at=now() where id=auth.uid();
delete from public.friendships where user_two_id=auth.uid();
select is(jsonb_array_length(public.garden_friends()),0,'friend removal removes directory entry');
select ok(not private.can_visit_garden('00000000-0000-0000-0000-000000000341'),'friend removal revokes direct visit');
insert into public.friendships(user_one_id,user_two_id) values('00000000-0000-0000-0000-000000000341','00000000-0000-0000-0000-000000000342');
insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),'00000000-0000-0000-0000-000000000341');
set local role authenticated;
select is(jsonb_array_length(public.garden_friends()),0,'blocked garden disappears from directory');
select throws_ok($$select public.get_garden('00000000-0000-0000-0000-000000000341')$$,'42501','정원을 볼 수 없어요. 공개 설정이나 관계가 변경되었어요.','block revokes direct visit');
reset role;
delete from auth.users where id='00000000-0000-0000-0000-000000000341';
select is((select count(*)::integer from private.gardens where owner_id='00000000-0000-0000-0000-000000000341'),0,'account purge removes garden');
select is((select count(*)::integer from private.garden_inventory where owner_id='00000000-0000-0000-0000-000000000341'),0,'account purge removes inventory');
select is((select count(*)::integer from private.garden_credits where owner_id='00000000-0000-0000-0000-000000000341'),0,'account purge removes reward ledger');
select * from finish();
rollback;
