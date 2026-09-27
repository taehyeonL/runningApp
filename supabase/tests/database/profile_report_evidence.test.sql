-- Server snapshots preserve reported content without reopening a blocked profile.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000008801','evidence-a@example.test'),
 ('00000000-0000-0000-0000-000000008802','evidence-b@example.test'),
 ('00000000-0000-0000-0000-000000008803','evidence-c@example.test');
insert into public.profiles(id,nickname,age_verified_at,bio,conversation_preference,preferred_distance) values
 ('00000000-0000-0000-0000-000000008801','신고러너',now(),'내 소개','any','any'),
 ('00000000-0000-0000-0000-000000008802','대상러너',now(),'신고 당시 소개','quiet','5k'),
 ('00000000-0000-0000-0000-000000008803','무관러너',now(),'비공개 소개','chatty','10k');
insert into public.friendships(user_one_id,user_two_id) values
 ('00000000-0000-0000-0000-000000008801','00000000-0000-0000-0000-000000008802');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008801',true);
set local role authenticated;
select is((select count(*)::int from public.social_runner_details),1,'fixture has one visible counterpart');
select isnt(public.report_profile('00000000-0000-0000-0000-000000008802','hate','사용자 설명'),null,'visible profile can be reported');
select throws_ok($$select public.report_profile('00000000-0000-0000-0000-000000008803','other',null)$$,'42501',null,'unrelated UUID cannot be used to file a profile report');
select throws_ok($$update public.reports set evidence='[]'::jsonb$$,'42501',null,'clients cannot overwrite evidence');
select throws_ok($$select evidence from public.reports$$,'42501',null,'raw evidence is not a client read surface');
select throws_ok($$insert into public.reports(reporter_id,reported_id,reason,details,evidence) values('00000000-0000-0000-0000-000000008801','00000000-0000-0000-0000-000000008803','other','forged','[{"kind":"profile","bio":"fake"}]')$$,'42501',null,'direct insert cannot bypass eligibility or forge evidence');
select is((select count(id)::int from public.reports),1,'reporter can still see own submission receipt');
reset role;
select is((select evidence->0->>'bio' from public.reports where reported_id='00000000-0000-0000-0000-000000008802'),'신고 당시 소개','server captures bio');
select is((select evidence->0->>'conversation_preference' from public.reports where reported_id='00000000-0000-0000-0000-000000008802'),'quiet','server captures visible conversation preference');
select is((select evidence->0->>'preferred_distance' from public.reports where reported_id='00000000-0000-0000-0000-000000008802'),'5k','server captures visible distance');
select is((select evidence->0->>'snapshot_status' from public.reports where reported_id='00000000-0000-0000-0000-000000008802'),'captured','snapshot states that capture succeeded');
select ok(not exists(select 1 from public.reports r cross join lateral jsonb_object_keys(r.evidence->0) k where k in('matching_gender','match_preference','latitude','longitude','location_points','started_at','birth_year','email')),'snapshot excludes private profile and GPS fields');
update public.profiles set bio='수정한 소개',conversation_preference='chatty',preferred_distance='10k' where id='00000000-0000-0000-0000-000000008802';
select is((select evidence->0->>'bio' from public.reports where reported_id='00000000-0000-0000-0000-000000008802'),'신고 당시 소개','later profile edit cannot change existing evidence');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008801',true);
set local role authenticated;
insert into public.user_blocks(blocker_id,blocked_id) values('00000000-0000-0000-0000-000000008801','00000000-0000-0000-0000-000000008802');
select is((select count(*)::int from public.social_runner_details),0,'blocked profile is unavailable');
select isnt(public.report_profile('00000000-0000-0000-0000-000000008802','other','차단 후 추가 신고'),null,'blocking never removes the ability to report');
reset role;
select is((select evidence->0->>'snapshot_status' from public.reports where reported_id='00000000-0000-0000-0000-000000008802' and reason='other'),'unavailable','blocked report explicitly records unavailable snapshot');
select ok((select not (evidence->0 ? 'bio') from public.reports where reported_id='00000000-0000-0000-0000-000000008802' and reason='other'),'blocked report never fetches current hidden bio');
select is((select evidence->0->>'bio' from public.reports where reported_id='00000000-0000-0000-0000-000000008802' and reason='hate'),'신고 당시 소개','blocking does not erase prior evidence');
select ok(not has_function_privilege('anon','public.report_profile(uuid,text,text)','EXECUTE'),'anonymous report RPC is forbidden');
select * from finish();
rollback;
