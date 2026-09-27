begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000291', 'checkin-a@example.test'),
  ('00000000-0000-0000-0000-000000000292', 'checkin-b@example.test');
insert into public.profiles (id, nickname, age_verified_at) values
  ('00000000-0000-0000-0000-000000000291', '안전가', now()),
  ('00000000-0000-0000-0000-000000000292', '안전나', now());
insert into public.consent_records (user_id, consent_type, policy_version, granted, captured_at)
select user_id, consent_type, 'checkin-test-v1', true, now() - interval '1 day'
  from (values
    ('00000000-0000-0000-0000-000000000291'::uuid),
    ('00000000-0000-0000-0000-000000000292'::uuid)
  ) as users(user_id)
  cross join (values ('terms'), ('privacy'), ('location')) as consents(consent_type);
insert into public.connection_requests (
  id, requester_id, recipient_id, template_key, status, responded_at, expires_at, resolution_reason
) values (
  '00000000-0000-0000-0000-000000000299',
  '00000000-0000-0000-0000-000000000291',
  '00000000-0000-0000-0000-000000000292',
  'weekend_5k', 'accepted', now(), now() + interval '7 days', 'accepted'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000291', true);
set local role authenticated;
select isnt(public.prepare_run_safety_checkin('00000000-0000-0000-0000-000000000299'), null, 'only an accepted request participant can prepare a safety checkin');
select is((select status from public.my_run_safety_checkins), 'prepared', 'the owner sees only their prepared checkin');
select ok(public.complete_run_safety_checkin((select id from public.my_run_safety_checkins)), 'the owner can mark their own safety checkin complete');
select is((select status from public.my_run_safety_checkins), 'completed', 'completion is persisted without any location data');
reset role;
select ok(not has_table_privilege('authenticated', 'public.run_safety_checkins', 'SELECT'), 'checkin rows are not a user-readable directory');
select * from finish();
rollback;
