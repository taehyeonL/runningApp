begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000281', 'achievements@example.test');
insert into public.profiles (id, nickname)
values ('00000000-0000-0000-0000-000000000281', '업적러너');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000281', true);
set local role authenticated;
select lives_ok(
  $$ select public.set_runner_preferences('habit', 420, array['weekday_evening', 'weekend_morning']) $$,
  'a runner can save a goal, usual pace, and only broad availability slots'
);
select is(
  (select primary_achievement from public.my_privacy_status),
  'beginner',
  'every new runner receives the beginner title'
);
select is(
  (select availability_slots from public.my_privacy_status),
  array['weekday_evening', 'weekend_morning']::text[],
  'the owner reads the selected broad availability slots'
);
select throws_ok(
  $$ select public.set_runner_preferences('habit', 420, array['monday_0715']) $$,
  '22023', 'Invalid availability slots',
  'exact or unsupported time slots are rejected'
);
reset role;

insert into public.running_sessions (
  user_id, status, started_at, ended_at, duration_seconds, distance_meters, average_pace_seconds
)
select '00000000-0000-0000-0000-000000000281'::uuid, 'processing',
       now() - (day_number || ' days')::interval,
       now() - (day_number || ' days')::interval + interval '30 minutes',
       1800, 5000, 360
  from generate_series(0, 9) as day_number;
update public.running_sessions
   set status = 'completed'
 where user_id = '00000000-0000-0000-0000-000000000281';

select ok(
  exists (
    select 1 from public.profile_achievements
     where profile_id = '00000000-0000-0000-0000-000000000281'
       and achievement_code = 'consistent'
  ),
  'only completed runs unlock the consistent runner title'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_achievements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profile_achievements', 'SELECT'),
  'clients cannot forge or enumerate achievement rows directly'
);
select * from finish();
rollback;
