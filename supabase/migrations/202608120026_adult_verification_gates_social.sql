-- 가입 시의 만 19세 이상 체크는 자가 확인 동의이며, 실제 성인 인증이 아니다.
-- 러닝 기록은 이 동의만으로 계속 사용할 수 있게 두되, 발견·요청·채팅은 서버가
-- 검증 제공사의 결과로 기록한 age_verified_at이 있을 때만 연다. 앞 migration이
-- 자가 확인을 이 필드에 복사했던 상태와 이미 만들어진 후보도 되돌린다.
begin;

create or replace function private.adult_social_access_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user_id
       and p.age_verified_at is not null
  );
$$;

comment on function private.adult_social_access_allowed(uuid) is
  '검증 제공사의 성인 인증 결과가 있는 사용자만 발견·요청·채팅을 이용한다. 가입 자가 확인 동의만으로는 true가 아니다.';

create or replace function private.pair_contact_allowed(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select user_a is not null
     and user_b is not null
     and private.adult_social_access_allowed(user_a)
     and private.adult_social_access_allowed(user_b)
     and not exists (
       select 1 from public.user_blocks
        where (blocker_id = user_a and blocked_id = user_b)
           or (blocker_id = user_b and blocked_id = user_a)
     )
     and not private.has_active_moderation_action(user_a, array['suspension', 'ban'])
     and not private.has_active_moderation_action(user_b, array['suspension', 'ban']);
$$;

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

create or replace function public.record_consent(consent_type text, policy_version text, granted boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare consent_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if consent_type not in ('adult_confirmation', 'terms', 'privacy', 'location', 'marketing', 'health_data') then raise exception 'Invalid consent type' using errcode = '22023'; end if;
  if policy_version is null or char_length(btrim(policy_version)) not between 1 and 100 then raise exception 'Invalid policy version' using errcode = '22023'; end if;
  insert into public.consent_records (user_id, consent_type, policy_version, granted)
  values (auth.uid(), consent_type, btrim(policy_version), granted) returning id into consent_id;
  if consent_type = 'location' and granted = false then
    update public.profiles set discovery_enabled = false where id = auth.uid();
    delete from public.encounter_candidates where viewer_id = auth.uid() or candidate_profile_id = auth.uid();
    update public.connection_requests set status = 'cancelled', resolution_reason = 'consent_withdrawn'
     where status = 'pending' and (requester_id = auth.uid() or recipient_id = auth.uid());
  end if;
  return consent_id;
end;
$$;

-- 이 서비스에는 아직 검증 제공사 callback이 없으므로 기존 timestamp는 자가
-- 확인에서 온 값이다. 실제 인증 callback만 앞으로 이 열을 쓸 수 있다.
update public.profiles set age_verified_at = null where age_verified_at is not null;
delete from public.encounter_candidates;

drop view public.my_privacy_status;
create view public.my_privacy_status
with (security_barrier = true) as
  select p.id as user_id, p.discovery_enabled, p.profile_visibility, p.log_default_visibility,
         (p.age_verified_at is not null) as age_verification_complete,
         public.has_current_consent('location') as location_consent_granted,
         public.has_current_consent('marketing') as marketing_consent_granted,
         d.requested_at as deletion_requested_at, d.purge_after as deletion_purge_after
    from public.profiles p
    left join public.account_deletion_requests d on d.user_id = p.id and d.cancelled_at is null and d.completed_at is null
   where p.id = auth.uid();

revoke execute on function private.adult_social_access_allowed(uuid) from public, anon, authenticated;
revoke all privileges on public.my_privacy_status from public, anon, authenticated;
grant select on public.my_privacy_status to authenticated;
commit;
