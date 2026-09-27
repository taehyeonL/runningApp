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

select is((select preference from public.get_match_preferences()),'any','existing account defaults to any');
select is((select gender from public.get_match_preferences()),'unspecified','never infer gender');
select throws_ok($$select public.set_match_preferences(null,'any')$$,'22023',null,'reject null');
select throws_ok($$select public.set_match_preferences('male','invalid')$$,'22023',null,'reject invalid');
select throws_ok($$update public.profiles set match_preference='hidden' where id=auth.uid()$$,'42501',null,'no direct column write bypass');
select ok(public.set_match_preferences('male','female'),'owner saves preferences');
select is((select count(*)::int from public.encounter_candidates),0,'unspecified gender does not satisfy female only');
select is((select count(*)::int from public.social_profiles),0,'candidate profile cannot bypass preference');
reset role;
select ok(not private.worker_pair_is_discoverable('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902'),'worker uses same filter');
update public.profiles set matching_gender='female',match_preference='female' where id='00000000-0000-0000-0000-000000009902';
set local role authenticated;
select is((select count(*)::int from public.encounter_candidates),0,'other users preference also applies');
select throws_ok($$select public.send_connection_request('00000000-0000-0000-0000-000000009902','10000000-0000-0000-0000-000000009902','weekend_5k',null)$$,'42501',null,'stale candidate cannot send');
reset role;
update public.profiles set match_preference='male' where id='00000000-0000-0000-0000-000000009902';
select ok(private.worker_pair_is_discoverable('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902'),'worker permits mutual match');
set local role authenticated;
select is((select count(*)::int from public.encounter_candidates),1,'mutual preference reveals candidate');
select is((select count(*)::int from public.social_profiles),1,'mutual preference reveals safe profile');
select isnt(public.send_connection_request('00000000-0000-0000-0000-000000009902','10000000-0000-0000-0000-000000009902','weekend_5k',null),null,'normal request');
select ok(public.set_match_preferences('male','hidden'),'hide before acceptance');
select is((select status::text from public.connection_request_summaries limit 1),'cancelled','hide cancels pending request');
select is((select count(*)::int from public.encounter_candidates),0,'hide excludes viewer');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009902',true);
set local role authenticated;
select is((select preference from public.get_match_preferences()),'male','read returns only current user');
select ok(not public.accept_connection_request((select id from public.connection_request_summaries limit 1)),'cannot accept withdrawn pending request');
select is((select count(*)::int from public.list_chat_threads()),0,'no mutual consent bypass');
reset role;
-- All combinations of both genders and preferences must share one symmetric decision.
create function pg_temp.check_match_matrix() returns setof text language plpgsql as $$
declare a text; b text; x text; y text; expected boolean;
begin
 foreach a in array array['male','female','unspecified'] loop
 foreach b in array array['male','female','unspecified'] loop
 foreach x in array array['male','female','any','hidden'] loop
 foreach y in array array['male','female','any','hidden'] loop
 update public.profiles set matching_gender=a,match_preference=x where id='00000000-0000-0000-0000-000000009901';
 update public.profiles set matching_gender=b,match_preference=y where id='00000000-0000-0000-0000-000000009902';
 expected := x<>'hidden' and y<>'hidden' and (x='any' or x=b) and (y='any' or y=a);
 return next is(private.match_preferences_allow('00000000-0000-0000-0000-000000009901','00000000-0000-0000-0000-000000009902'),expected,'matrix '||a||'/'||x||' : '||b||'/'||y);
 end loop; end loop; end loop; end loop;
end $$;
select * from pg_temp.check_match_matrix();
set local role anon;
select throws_ok($$select * from public.get_match_preferences()$$,'42501',null,'anonymous cannot read preferences');
select throws_ok($$select public.set_match_preferences('male','any')$$,'42501',null,'anonymous cannot save preferences');
reset role;
select * from finish();
rollback;

