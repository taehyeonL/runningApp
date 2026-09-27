-- 가입 때 정한 러닝 목표·평소 페이스·넓은 활동 시간대와 완료 러닝에서만 파생되는
-- 업적을 추가한다. 업적은 클라이언트가 쓰지 못하며, 후보 프로필에는 관계가 허용된
-- 경우에만 제목·아이콘 코드와 넓은 시간대만 투영해 원본 경로·정확한 시각을 노출하지 않는다.
begin;

alter table public.profiles
  add column training_goal text not null default 'habit'
    check (training_goal in ('first_5k', 'habit', 'faster_5k', 'ten_k')),
  add column usual_pace_seconds integer
    check (usual_pace_seconds between 240 and 720),
  add column availability_slots text[] not null default '{}'
    check (cardinality(availability_slots) <= 3)
    check (availability_slots <@ array['weekday_morning', 'weekday_evening', 'weekend_morning']::text[]);

create table public.profile_achievements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  achievement_code text not null check (achievement_code in ('beginner', 'consistent', 'hardcore', 'distance_100', 'veteran')),
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, achievement_code)
);

create index profile_achievements_profile_unlocked_idx
  on public.profile_achievements (profile_id, unlocked_at);

create or replace function private.refresh_runner_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare completed_count integer;
declare active_days integer;
declare total_distance_meters numeric;
declare median_pace numeric;
begin
  if p_user_id is null then return; end if;

  select count(*) filter (where status = 'completed')::integer,
         count(distinct started_at::date) filter (where status = 'completed' and started_at >= now() - interval '30 days')::integer,
         coalesce(sum(distance_meters) filter (where status = 'completed'), 0),
         percentile_cont(0.5) within group (order by average_pace_seconds)
           filter (where status = 'completed' and average_pace_seconds is not null)
    into completed_count, active_days, total_distance_meters, median_pace
    from public.running_sessions
   where user_id = p_user_id;

  insert into public.profile_achievements (profile_id, achievement_code)
  values (p_user_id, 'beginner')
  on conflict do nothing;

  if completed_count >= 10 and active_days >= 6 then
    insert into public.profile_achievements (profile_id, achievement_code)
    values (p_user_id, 'consistent') on conflict do nothing;
  end if;
  if completed_count >= 20 and median_pace is not null and median_pace <= 330 then
    insert into public.profile_achievements (profile_id, achievement_code)
    values (p_user_id, 'hardcore') on conflict do nothing;
  end if;
  if total_distance_meters >= 100000 then
    insert into public.profile_achievements (profile_id, achievement_code)
    values (p_user_id, 'distance_100') on conflict do nothing;
  end if;
  if completed_count >= 50 then
    insert into public.profile_achievements (profile_id, achievement_code)
    values (p_user_id, 'veteran') on conflict do nothing;
  end if;
end;
$$;

create or replace function private.runner_achievement_codes(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.achievement_code order by a.unlocked_at, a.achievement_code), '{}'::text[])
    from public.profile_achievements a
   where a.profile_id = p_user_id
$$;

create or replace function private.primary_runner_achievement(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select a.achievement_code
      from public.profile_achievements a
     where a.profile_id = p_user_id
     order by case a.achievement_code
       when 'hardcore' then 5 when 'veteran' then 4 when 'distance_100' then 3
       when 'consistent' then 2 else 1 end desc, a.unlocked_at asc
     limit 1
  ), 'beginner')
$$;

create or replace function private.initialize_runner_achievements()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.refresh_runner_achievements(new.id);
  return new;
end;
$$;

create trigger profiles_initialize_runner_achievements
after insert on public.profiles
for each row execute function private.initialize_runner_achievements();

create or replace function private.refresh_runner_achievements_after_completion()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.refresh_runner_achievements(new.user_id);
  end if;
  return new;
end;
$$;

create trigger running_sessions_refresh_runner_achievements
after update of status on public.running_sessions
for each row execute function private.refresh_runner_achievements_after_completion();

create or replace function public.set_runner_preferences(
  p_training_goal text,
  p_usual_pace_seconds integer,
  p_availability_slots text[] default '{}'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare normalized_slots text[] := coalesce(p_availability_slots, '{}'::text[]);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_training_goal not in ('first_5k', 'habit', 'faster_5k', 'ten_k') then raise exception 'Invalid training goal' using errcode = '22023'; end if;
  if p_usual_pace_seconds not between 240 and 720 then raise exception 'Invalid usual pace' using errcode = '22023'; end if;
  if cardinality(normalized_slots) > 3
     or not (normalized_slots <@ array['weekday_morning', 'weekday_evening', 'weekend_morning']::text[]) then
    raise exception 'Invalid availability slots' using errcode = '22023';
  end if;
  update public.profiles
     set training_goal = p_training_goal,
         usual_pace_seconds = p_usual_pace_seconds,
         pace_min_seconds = greatest(120, p_usual_pace_seconds - 45),
         pace_max_seconds = least(1800, p_usual_pace_seconds + 45),
         availability_slots = array(select distinct value from unnest(normalized_slots) as slots(value) order by value)
   where id = auth.uid();
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

select private.refresh_runner_achievements(id) from public.profiles;

drop view public.social_profiles;
create view public.social_profiles
with (security_barrier = true)
as
  select p.id, p.nickname,
         case
           when p.birth_year is null then null
           when extract(year from now())::int - p.birth_year < 30 then '20대'
           when extract(year from now())::int - p.birth_year < 40 then '30대'
           when extract(year from now())::int - p.birth_year < 50 then '40대'
           else '50대 이상'
         end as age_band,
         p.relationship_intents, p.running_style_tags,
         p.avatar_path, p.pace_min_seconds, p.pace_max_seconds,
         p.monthly_distance_km, p.completed_run_count,
         p.availability_slots,
         private.primary_runner_achievement(p.id) as primary_achievement,
         private.runner_achievement_codes(p.id) as achievement_codes
    from public.profiles p
   where p.id <> auth.uid()
     and private.can_view_relationship(p.id)
     and (
       exists (select 1 from public.encounter_candidates c where c.viewer_id = auth.uid() and c.candidate_profile_id = p.id and c.expires_at > now())
       or exists (select 1 from public.connection_requests r where (r.requester_id = auth.uid() and r.recipient_id = p.id) or (r.recipient_id = auth.uid() and r.requester_id = p.id))
       or exists (select 1 from public.friendships f where (f.user_one_id = auth.uid() and f.user_two_id = p.id) or (f.user_two_id = auth.uid() and f.user_one_id = p.id))
     );

drop view public.my_privacy_status;
create view public.my_privacy_status
with (security_barrier = true) as
  select p.id as user_id, p.nickname, p.nickname_changed_at + interval '6 months' as nickname_change_available_at,
         p.discovery_enabled, p.profile_visibility, p.log_default_visibility,
         p.training_goal, p.usual_pace_seconds, p.availability_slots,
         private.primary_runner_achievement(p.id) as primary_achievement,
         private.runner_achievement_codes(p.id) as achievement_codes,
         (p.age_verified_at is not null) as age_verification_complete,
         public.has_current_consent('location') as location_consent_granted,
         public.has_current_consent('marketing') as marketing_consent_granted,
         d.requested_at as deletion_requested_at, d.purge_after as deletion_purge_after
    from public.profiles p
    left join public.account_deletion_requests d on d.user_id = p.id and d.cancelled_at is null and d.completed_at is null
   where p.id = auth.uid();

revoke all on public.profile_achievements from public, anon, authenticated;
revoke all on function private.refresh_runner_achievements(uuid) from public, anon, authenticated;
revoke all on function private.runner_achievement_codes(uuid) from public, anon, authenticated;
revoke all on function private.primary_runner_achievement(uuid) from public, anon, authenticated;
revoke all on function private.initialize_runner_achievements() from public, anon, authenticated;
revoke all on function private.refresh_runner_achievements_after_completion() from public, anon, authenticated;
revoke all on function public.set_runner_preferences(text, integer, text[]) from public, anon;
grant execute on function public.set_runner_preferences(text, integer, text[]) to authenticated;
revoke all privileges on public.social_profiles from public, anon, authenticated;
revoke all privileges on public.my_privacy_status from public, anon, authenticated;
grant select on public.social_profiles, public.my_privacy_status to authenticated;

commit;
