begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000371','seed-a@example.test'),
 ('00000000-0000-0000-0000-000000000372','seed-b@example.test');
insert into public.profiles(id,nickname,age_verified_at,discovery_enabled,profile_visibility) values
 ('00000000-0000-0000-0000-000000000371','씨앗가',now(),true,'matching'),
 ('00000000-0000-0000-0000-000000000372','씨앗나',now(),true,'matching');
insert into public.consent_records(user_id,consent_type,policy_version,granted)
select u,c,'seed-test',true from (values('00000000-0000-0000-0000-000000000371'::uuid),('00000000-0000-0000-0000-000000000372'::uuid)) users(u)
cross join (values('terms'),('privacy'),('location')) consents(c);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000371',true);
set local role authenticated;
select public.start_garden();
select public.start_garden();
select is((public.get_garden(auth.uid())->'inventory'->>'sun_seed')::integer,1,'seed gift cannot be claimed twice');
select lives_ok($$select public.plant_garden_seed('sun_seed',1,0)$$,'plant one owned seed');
select is(public.get_garden(auth.uid())->'inventory'->>'sun_seed',null::text,'plant consumes seed');
select is(public.get_garden(auth.uid())->'collection'->>'sun_seed','discovered','consuming final seed preserves discovery');
select throws_ok($$select public.plant_garden_seed('sun_seed',2,1)$$,'22023','보유한 씨앗이 없어요.','cannot plant consumed seed again');
select throws_ok($$select public.plant_garden_seed('clover_seed',1,1)$$,'22023','빈 칸과 씨앗을 선택해 주세요.','occupied plant cell denied');
select throws_ok($$select public.plant_garden_seed('clover_seed',16,1)$$,'22023','빈 칸과 씨앗을 선택해 주세요.','locked cell denied');
select throws_ok($$select public.save_garden(1,'[{"cell":2,"itemId":"clover_seed"}]','private')$$,'22023','Invalid garden layout','legacy save cannot bypass planting');
select throws_ok($$select public.save_garden(1,'[{"cell":1,"itemId":"rock"}]','private')$$,'22023','Invalid garden layout','decoration cannot overlap plant');
select lives_ok($$select public.save_garden(1,'[{"cell":0,"itemId":"tree"}]','friends')$$,'legacy completed tree preserved');
select public.plant_garden_seed('clover_seed',2,2);
reset role;
insert into private.garden_inventory values(auth.uid(),'moon_spore',1),(auth.uid(),'spring_seed',1),(auth.uid(),'fern_spore',1);
select public.plant_garden_seed('moon_spore',4,3);
select public.plant_garden_seed('spring_seed',5,4);
select public.plant_garden_seed('fern_spore',3,5);
select is((select sum(weight)::integer from private.garden_catalog),60,'new catalog preserves overall drop rate');
select is((select sum(weight)::integer from private.garden_catalog where rarity='rare'),5,'rare items remain ordinary drops');
select is((select sum(weight)::integer from private.garden_catalog where id in ('flower','tree','mushroom')),0,'legacy plants no longer drop as completed items');
select is(private.garden_growth_multiplier('day',6,1,false,false),1.2::numeric,'day starts at 06');
select is(private.garden_growth_multiplier('day',18,1,false,false),1::numeric,'day ends at 18');
select is(private.garden_growth_multiplier('evening',18,1,false,false),1.2::numeric,'evening starts at 18');
select is(private.garden_growth_multiplier('evening',22,1,false,false),1::numeric,'no deep-night bonus');
select is(private.garden_growth_multiplier('evening',2,1,false,false),1::numeric,'early morning also grows at base rate');
select is(private.garden_growth_multiplier('steady',10,2,false,false),1::numeric,'two days not three');
select is(private.garden_growth_multiplier('steady',10,3,false,false),1.2::numeric,'three distinct days grant steady bonus');
select is(private.garden_growth_multiplier('comeback',10,1,true,false),1.2::numeric,'comeback bonus');
select is(private.garden_growth_multiplier('evening',20,1,false,true),1.3::numeric,'trait and neighbor bonuses add rather than compound');
insert into public.running_sessions(id,user_id,source_record_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values('00000000-0000-0000-0000-000000000379',auth.uid(),'seed-run','processing','2030-01-01 10:00+09','2030-01-01 10:10+09',600,1000,'{"server_validated":true,"rejection_reasons":["distance_below_3km"]}');
select is((select sum(growth) from private.garden_plants where owner_id=auth.uid()),0::numeric,'pending run never grows plants');
update public.running_sessions set status='completed' where id='00000000-0000-0000-0000-000000000379';
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='sun_seed'),1200::numeric,'verified short daytime run grows sun plant');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='moon_spore'),1100::numeric,'moon grows in daytime with tree-neighbor bonus');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='fern_spore'),1000::numeric,'row boundary is not adjacency');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='spring_seed'),1200::numeric,'first garden run welcomed');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='clover_seed'),1000::numeric,'all plants grow without dividing distance');
update public.running_sessions set status='completed' where id='00000000-0000-0000-0000-000000000379';
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='sun_seed'),1200::numeric,'same run cannot grow twice');
delete from public.running_sessions where id='00000000-0000-0000-0000-000000000379';
insert into public.running_sessions(user_id,source_record_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'seed-run','completed','2030-01-01 10:00+09','2030-01-01 10:10+09',600,1000,'{"server_validated":true,"rejection_reasons":[]}');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='sun_seed'),1200::numeric,'deleted source replay does not grow again');
create temp table seed_ids as select id,item_id from private.garden_plants where owner_id=auth.uid();
set local role authenticated;
select lives_ok($$select public.move_garden_plant((select (p->>'id')::uuid from jsonb_array_elements(public.get_garden(auth.uid())->'plants') p where p->>'itemId'='moon_spore'),null,6)$$,'plant may be stored');
reset role;
select is((select count(*)::integer from private.garden_plants where owner_id=auth.uid() and cell is null),1,'stored plant keeps instance');
create temp table growth_before as select id,growth from private.garden_plants where owner_id=auth.uid();
select public.set_garden_collecting(false);
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed','2030-01-02 20:00+09','2030-01-02 20:10+09',600,1000,'{"server_validated":true,"rejection_reasons":[]}');
select results_eq('select id,growth from private.garden_plants where owner_id=auth.uid() order by id','select id,growth from growth_before order by id','withdrawal pauses all growth without loss');
select public.set_garden_collecting(true);
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed','2030-01-03 10:00+09','2030-01-03 10:10+09',600,1000,'{"server_validated":true,"rejection_reasons":["low_quality_ratio"]}');
select results_eq('select id,growth from private.garden_plants where owner_id=auth.uid() order by id','select id,growth from growth_before order by id','invalid GPS never grows');
select public.move_garden_plant((select id from private.garden_plants where owner_id=auth.uid() and item_id='fern_spore'),6,7);
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='fern_spore'),1000::numeric,'moving or replanting keeps previous growth');
select throws_ok($$select public.plant_garden_seed('sun_seed',7,7)$$,'40001','다른 화면에서 정원이 변경되었어요. 새로고침 후 다시 꾸며주세요.','concurrent stale mutation is rejected');
update private.garden_plants set positioned_at='2030-01-04 11:00+09' where owner_id=auth.uid() and item_id='fern_spore';
-- Force two same-species plants near completion to reproduce multi-row collection upsert.
insert into private.garden_plants(owner_id,item_id,cell,growth) values(auth.uid(),'tree_seed',8,9900),(auth.uid(),'tree_seed',9,9900);
insert into public.running_sessions(user_id,status,started_at,ended_at,duration_seconds,distance_meters,gps_quality_summary)
values(auth.uid(),'completed','2030-01-04 10:00+09','2030-01-04 10:10+09',600,1000,'{"server_validated":true,"rejection_reasons":[]}');
select is((select count(*)::integer from private.garden_plants where item_id='tree_seed' and owner_id=auth.uid() and growth=10000),2,'two identical plants complete without failing run transaction');
select is(public.get_garden(auth.uid())->'collection'->>'tree_seed','completed','completion recorded in own collection');
select is((select growth from private.garden_plants where owner_id=auth.uid() and item_id='fern_spore'),1000::numeric,'late run started before plant positioning cannot grow it');
select is((select count(*)::integer from private.garden_growth_days where owner_id=auth.uid()),2,'pending invalid withdrawn and duplicate runs never create growth days');
select ok(not exists(select 1 from private.garden_plants p join growth_before b on b.id=p.id where p.cell is null and p.growth<>b.growth),'stored plant did not grow');
select ok(not has_table_privilege('authenticated','private.garden_plants','SELECT') and not has_table_privilege('authenticated','private.garden_growth_days','SELECT'),'plant and day tables are private');
select ok(not has_function_privilege('authenticated','private.garden_growth_multiplier(text,integer,integer,boolean,boolean)','EXECUTE'),'bonus helper not callable by app');
select ok(not has_function_privilege('anon','public.plant_garden_seed(text,integer,integer)','EXECUTE'),'anonymous cannot plant');
insert into public.friendships(user_one_id,user_two_id) values(auth.uid(),'00000000-0000-0000-0000-000000000372');
grant select on seed_ids to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000372',true);
set local role authenticated;
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_garden('00000000-0000-0000-0000-000000000371')) k),array['catalog','cellCount','nickname','ownerId','placements']::text[],'visitor receives no growth progress inventory dates or collection');
select ok(not exists(select 1 from jsonb_array_elements(public.get_garden('00000000-0000-0000-0000-000000000371')->'placements') p,jsonb_object_keys(p) k where k not in ('cell','itemId','stage')),'visitor plant projection exposes only appearance');
select public.start_garden();
select throws_ok(format('select public.move_garden_plant(%L,1,0)',(select id from seed_ids limit 1)),'42501','Plant unavailable','cannot move another owners actual plant');
select throws_ok($$select public.move_garden_plant('00000000-0000-0000-0000-000000000370',1,0)$$,'42501','Plant unavailable','cannot manipulate foreign or missing instance');
reset role;
insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),'00000000-0000-0000-0000-000000000371');
set local role authenticated;
select throws_ok($$select public.get_garden('00000000-0000-0000-0000-000000000371')$$,'42501','정원을 볼 수 없어요. 공개 설정이나 관계가 변경되었어요.','block still revokes growth garden');
reset role;
delete from auth.users where id='00000000-0000-0000-0000-000000000371';
select is((select count(*)::integer from private.garden_plants where owner_id='00000000-0000-0000-0000-000000000371'),0,'account purge removes plants');
select is((select count(*)::integer from private.garden_growth_days where owner_id='00000000-0000-0000-0000-000000000371'),0,'account purge removes growth dates');
select is((select count(*)::integer from private.garden_collection where owner_id='00000000-0000-0000-0000-000000000371'),0,'account purge removes collection');
select * from finish();
rollback;
