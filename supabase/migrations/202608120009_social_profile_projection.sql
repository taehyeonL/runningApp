begin;

-- Candidate cards and request/friend state need the same deliberately small
-- profile shape. This view never becomes a general user directory: a row is
-- visible only while there is a current safe product relationship.
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
         p.monthly_distance_km, p.completed_run_count
    from public.profiles p
   where p.id <> auth.uid()
     and private.can_view_relationship(p.id)
     and (
       exists (
         select 1 from public.encounter_candidates c
          where c.viewer_id = auth.uid()
            and c.candidate_profile_id = p.id
            and c.expires_at > now()
       )
       or exists (
         select 1 from public.connection_requests r
          where (r.requester_id = auth.uid() and r.recipient_id = p.id)
             or (r.recipient_id = auth.uid() and r.requester_id = p.id)
       )
       or exists (
         select 1 from public.friendships f
          where (f.user_one_id = auth.uid() and f.user_two_id = p.id)
             or (f.user_two_id = auth.uid() and f.user_one_id = p.id)
       )
     );

revoke all privileges on table public.social_profiles from public, anon, authenticated;
grant select on table public.social_profiles to authenticated;

comment on view public.social_profiles is
  'Safe profile projection scoped to active candidates, request participants, or friends; never a user directory.';

commit;
