-- 계정 화면은 닉네임을 직접 profiles에서 읽지 않는다. 내 계정 전용 상태 뷰에만
-- 현재 닉네임과 서버가 계산한 다음 변경 가능 시각을 더해, 6개월 쿨다운의 판정을
-- public.set_nickname(text) 한 곳에 그대로 둔다.
begin;

drop view public.my_privacy_status;
create view public.my_privacy_status
with (security_barrier = true) as
  select p.id as user_id,
         p.nickname,
         p.nickname_changed_at + interval '6 months' as nickname_change_available_at,
         p.discovery_enabled,
         p.profile_visibility,
         p.log_default_visibility,
         (p.age_verified_at is not null) as age_verification_complete,
         public.has_current_consent('location') as location_consent_granted,
         public.has_current_consent('marketing') as marketing_consent_granted,
         d.requested_at as deletion_requested_at,
         d.purge_after as deletion_purge_after
    from public.profiles p
    left join public.account_deletion_requests d
      on d.user_id = p.id and d.cancelled_at is null and d.completed_at is null
   where p.id = auth.uid();

revoke all privileges on public.my_privacy_status from public, anon, authenticated;
grant select on public.my_privacy_status to authenticated;
commit;
