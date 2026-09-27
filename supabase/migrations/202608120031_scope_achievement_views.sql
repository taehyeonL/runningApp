-- 업적 보조 함수를 authenticated에 공개하면 다른 사용자의 업적을 임의 조회할 수 있다.
-- 따라서 관계 범위를 이미 강제하는 두 뷰 안에서만 집계해, 함수 실행 권한을 넓히지 않고
-- 소유자와 안전한 후보 관계에만 업적 코드를 제공한다.
begin;

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
         p.monthly_distance_km, p.completed_run_count, p.availability_slots,
         coalesce((
           select a.achievement_code from public.profile_achievements a
            where a.profile_id = p.id
            order by case a.achievement_code
              when 'hardcore' then 5 when 'veteran' then 4 when 'distance_100' then 3
              when 'consistent' then 2 else 1 end desc, a.unlocked_at asc
            limit 1
         ), 'beginner') as primary_achievement,
         coalesce((
           select array_agg(a.achievement_code order by a.unlocked_at, a.achievement_code)
             from public.profile_achievements a where a.profile_id = p.id
         ), '{}'::text[]) as achievement_codes
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
         coalesce((
           select a.achievement_code from public.profile_achievements a
            where a.profile_id = p.id
            order by case a.achievement_code
              when 'hardcore' then 5 when 'veteran' then 4 when 'distance_100' then 3
              when 'consistent' then 2 else 1 end desc, a.unlocked_at asc
            limit 1
         ), 'beginner') as primary_achievement,
         coalesce((
           select array_agg(a.achievement_code order by a.unlocked_at, a.achievement_code)
             from public.profile_achievements a where a.profile_id = p.id
         ), '{}'::text[]) as achievement_codes,
         (p.age_verified_at is not null) as age_verification_complete,
         public.has_current_consent('location') as location_consent_granted,
         public.has_current_consent('marketing') as marketing_consent_granted,
         d.requested_at as deletion_requested_at, d.purge_after as deletion_purge_after
    from public.profiles p
    left join public.account_deletion_requests d on d.user_id = p.id and d.cancelled_at is null and d.completed_at is null
   where p.id = auth.uid();

revoke all privileges on public.social_profiles from public, anon, authenticated;
revoke all privileges on public.my_privacy_status from public, anon, authenticated;
grant select on public.social_profiles, public.my_privacy_status to authenticated;

commit;
