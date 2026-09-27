-- 매칭 선호와 본인 성별을 본인 전용으로 저장한다. 신규 발견/요청/worker는 같은
-- 양방향 판정을 사용하고 조건 변경으로 닫힌 대기 요청은 취소한다. 이미 상호 수락한
-- 친구·메시지·알림 권한은 기존 안전 판정을 유지하며 성별/선호를 타인 응답에 추가하지 않는다.
begin;
alter table public.profiles
  add column matching_gender text not null default 'unspecified' check (matching_gender in ('male','female','unspecified')),
  add column match_preference text not null default 'any' check (match_preference in ('male','female','any','hidden'));
-- profiles의 기존 컬럼 단위 grant는 그대로다. 새 컬럼의 쓰기는 본인 RPC로만 허용한다.

create function private.match_preferences_allow(user_a uuid, user_b uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles a join public.profiles b on b.id=user_b
    where a.id=user_a and a.id<>b.id
      and a.match_preference<>'hidden' and b.match_preference<>'hidden'
      and (a.match_preference='any' or a.match_preference=b.matching_gender)
      and (b.match_preference='any' or b.match_preference=a.matching_gender)
  );
$$;
revoke all on function private.match_preferences_allow(uuid,uuid) from public,anon,authenticated;

create function public.get_match_preferences()
returns table(gender text, preference text)
language sql stable security definer set search_path=public as $$
  select p.matching_gender, p.match_preference from public.profiles p where p.id=auth.uid();
$$;
create function public.set_match_preferences(p_gender text,p_preference text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_gender is null or p_gender not in ('male','female','unspecified')
     or p_preference is null or p_preference not in ('male','female','any','hidden') then
    raise exception 'Invalid matching preference' using errcode='22023';
  end if;
  update public.profiles set matching_gender=p_gender, match_preference=p_preference where id=auth.uid();
  return found;
end;
$$;
revoke all on function public.get_match_preferences(),public.set_match_preferences(text,text) from public,anon,authenticated;
grant execute on function public.get_match_preferences(),public.set_match_preferences(text,text) to authenticated;

create function private.cancel_incompatible_match_requests()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.matching_gender is distinct from old.matching_gender or new.match_preference is distinct from old.match_preference then
    update public.connection_requests r set status='cancelled',resolution_reason='consent_withdrawn'
    where r.status='pending' and (r.requester_id=new.id or r.recipient_id=new.id)
      and not private.match_preferences_allow(r.requester_id,r.recipient_id);
  end if;
  return new;
end;
$$;
revoke all on function private.cancel_incompatible_match_requests() from public,anon,authenticated;
create trigger profiles_cancel_incompatible_match_requests after update of matching_gender,match_preference on public.profiles
for each row execute function private.cancel_incompatible_match_requests();

create or replace function private.is_pair_visible(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select auth.uid() is not null
    and auth.uid() <> other_user_id
    and private.adult_social_access_allowed(auth.uid())
    and private.adult_social_access_allowed(other_user_id)
    and not public.is_blocked(other_user_id)
    and public.has_current_consent('terms')
    and public.has_current_consent('privacy')
    and public.has_current_consent('location')
    and exists (
      select 1 from public.profiles me
      join public.profiles other on other.id = other_user_id
       where me.id = auth.uid()
         and private.match_preferences_allow(me.id, other.id)
         and me.discovery_enabled = true
         and other.discovery_enabled = true
         and other.profile_visibility in ('profile', 'matching')
    )
    and private.consent_granted(other_user_id, 'terms')
    and private.consent_granted(other_user_id, 'privacy')
    and private.consent_granted(other_user_id, 'location')
    and not private.has_active_moderation_action(auth.uid(), array['visibility_restriction', 'suspension', 'ban'])
    and not private.has_active_moderation_action(other_user_id, array['visibility_restriction', 'suspension', 'ban']);
$$;

create or replace function private.worker_pair_is_discoverable(first_user_id uuid, second_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select first_user_id is not null
    and second_user_id is not null
    and first_user_id <> second_user_id
    and private.match_preferences_allow(first_user_id, second_user_id)
    and private.adult_social_access_allowed(first_user_id)
    and private.adult_social_access_allowed(second_user_id)
    and not exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = first_user_id and b.blocked_id = second_user_id)
          or (b.blocker_id = second_user_id and b.blocked_id = first_user_id)
    )
    and not private.has_active_moderation_action(first_user_id, array['visibility_restriction', 'suspension', 'ban'])
    and not private.has_active_moderation_action(second_user_id, array['visibility_restriction', 'suspension', 'ban'])
    and not exists (
      select 1
        from (values (first_user_id), (second_user_id)) as users(user_id)
        join public.profiles p on p.id = users.user_id
       where p.discovery_enabled = false
          or p.profile_visibility not in ('profile', 'matching')
          or not private.consent_granted(users.user_id, 'terms')
          or not private.consent_granted(users.user_id, 'privacy')
          or not private.consent_granted(users.user_id, 'location')
    );
$$;


create or replace view public.social_profiles
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
       exists (select 1 from public.encounter_candidates c where c.viewer_id = auth.uid() and c.candidate_profile_id = p.id and c.expires_at > now() and private.is_pair_visible(p.id))
       or exists (select 1 from public.connection_requests r where (r.requester_id = auth.uid() and r.recipient_id = p.id) or (r.recipient_id = auth.uid() and r.requester_id = p.id))
       or exists (select 1 from public.friendships f where (f.user_one_id = auth.uid() and f.user_two_id = p.id) or (f.user_two_id = auth.uid() and f.user_one_id = p.id))
     );


create or replace function public.accept_connection_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.connection_requests;
begin
  select * into request_row
    from public.connection_requests
   where id = request_id and status = 'pending'
   for update;
  if request_row.id is null then return false; end if;
  if request_row.recipient_id <> auth.uid() then return false; end if;
  if request_row.expires_at <= now() then
    update public.connection_requests
       set status = 'expired', resolution_reason = 'expired_timeout'
     where id = request_row.id;
    return false;
  end if;
  if private.has_active_moderation_action(
       request_row.requester_id,
       array['request_restriction', 'visibility_restriction', 'suspension', 'ban']
     )
     or private.has_active_moderation_action(
       request_row.recipient_id,
       array['visibility_restriction', 'suspension', 'ban']
     ) then
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'moderation_restricted'
     where id = request_row.id;
    return false;
  end if;
  if not private.match_preferences_allow(request_row.requester_id, request_row.recipient_id) then return false; end if;
  if not private.can_view_relationship(request_row.requester_id) then return false; end if;

  update public.connection_requests
     set status = 'accepted', resolution_reason = 'accepted'
   where id = request_row.id;
  insert into public.friendships (user_one_id, user_two_id, accepted_request_id)
  values (
    least(request_row.requester_id, request_row.recipient_id),
    greatest(request_row.requester_id, request_row.recipient_id),
    request_row.id
  ) on conflict (user_one_id, user_two_id) do nothing;
  return true;
end;
$$;
commit;

