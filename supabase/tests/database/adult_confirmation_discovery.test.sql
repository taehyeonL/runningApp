begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- 가입 자가 확인은 러닝 기록 접근을 열되 소셜 접근을 열지 않는다. 검증
-- 제공사 callback을 흉내 낸 서버 갱신 뒤에만 앱이 읽는 후보 표면이 열린다.
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000251', 'adult-a@example.test'),
  ('00000000-0000-0000-0000-000000000252', 'adult-b@example.test');

insert into public.profiles (id, nickname, birth_year, discovery_enabled, profile_visibility)
values
  ('00000000-0000-0000-0000-000000000251', '성인가', 1990, true, 'matching'),
  ('00000000-0000-0000-0000-000000000252', '성인나', 1991, true, 'matching');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000251', true);
set local role authenticated;
select lives_ok($$ select public.record_consent('adult_confirmation', 'adult-test-v1', true) $$,
  'an adult self-confirmation can be recorded at onboarding');
select lives_ok($$ select public.record_consent('terms', 'adult-test-v1', true) $$);
select lives_ok($$ select public.record_consent('privacy', 'adult-test-v1', true) $$);
select lives_ok($$ select public.record_consent('location', 'adult-test-v1', true) $$);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000252', true);
set local role authenticated;
select lives_ok($$ select public.record_consent('adult_confirmation', 'adult-test-v1', true) $$);
select lives_ok($$ select public.record_consent('terms', 'adult-test-v1', true) $$);
select lives_ok($$ select public.record_consent('privacy', 'adult-test-v1', true) $$);
select lives_ok($$ select public.record_consent('location', 'adult-test-v1', true) $$);
reset role;

select ok(
  (select age_verified_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000251')
  and (select age_verified_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000252'),
  'self-confirmation never becomes a verified adult status'
);

insert into public.encounter_candidates (viewer_id, candidate_profile_id, similarity_label, repeat_encounters_30d, expires_at)
values ('00000000-0000-0000-0000-000000000251', '00000000-0000-0000-0000-000000000252',
        'good_match', public.repeat_encounter_threshold(), now() + interval '1 day');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000251', true);
set local role authenticated;
select is((select count(*)::integer from public.encounter_candidates), 0,
  'unverified adults cannot read discovery candidates');
reset role;

-- 실제 구현에서는 검증 제공사의 server-to-server callback만 이 갱신을 수행한다.
update public.profiles set age_verified_at = now()
 where id in ('00000000-0000-0000-0000-000000000251', '00000000-0000-0000-0000-000000000252');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000251', true);
set local role authenticated;
select is((select count(*)::integer from public.encounter_candidates), 1,
  'a verified adult pair can read the app discovery surface');
reset role;

update public.profiles set age_verified_at = null where id = '00000000-0000-0000-0000-000000000252';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000251', true);
set local role authenticated;
select is((select count(*)::integer from public.encounter_candidates), 0,
  'removing verified adult status immediately closes discovery again');

select * from finish();
rollback;
