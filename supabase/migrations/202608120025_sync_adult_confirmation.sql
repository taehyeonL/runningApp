-- 성인 확인 동의와 발견 RLS가 서로 다른 상태를 읽어, 온보딩을 마친 계정도
-- age_verified_at이 비어 발견 카드에서 조용히 제외됐다. 성인 확인 동의를 기록하는
-- 서버 RPC가 이 시각을 함께 갱신하게 하고, 이미 동의한 기존 계정도 최신 동의 시각으로
-- 보정한다. 클라이언트가 성인 확인 상태를 직접 쓰지 못하게 해 두 판정이 다시 갈라지지 않는다.
begin;

create or replace function public.record_consent(
  consent_type text,
  policy_version text,
  granted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  consent_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if consent_type not in ('adult_confirmation', 'terms', 'privacy', 'location', 'marketing', 'health_data') then
    raise exception 'Invalid consent type' using errcode = '22023';
  end if;
  if policy_version is null or char_length(btrim(policy_version)) not between 1 and 100 then
    raise exception 'Invalid policy version' using errcode = '22023';
  end if;

  insert into public.consent_records (user_id, consent_type, policy_version, granted)
  values (auth.uid(), consent_type, btrim(policy_version), granted)
  returning id into consent_id;

  if consent_type = 'adult_confirmation' then
    update public.profiles
       set age_verified_at = case when granted then now() else null end
     where id = auth.uid();
  end if;

  if consent_type = 'location' and granted = false then
    update public.profiles set discovery_enabled = false where id = auth.uid();
    delete from public.encounter_candidates
     where viewer_id = auth.uid() or candidate_profile_id = auth.uid();
    update public.connection_requests
       set status = 'cancelled', resolution_reason = 'consent_withdrawn'
     where status = 'pending'
       and (requester_id = auth.uid() or recipient_id = auth.uid());
  end if;
  return consent_id;
end;
$$;

-- 기존에는 adult_confirmation 이벤트만 남고 profiles의 성인 확인 시각은 비어
-- 있었다. 최신 이벤트가 동의인 계정만 보정한다. 과거에 별도 검증 시각이 있는
-- 계정은 건드리지 않아, 이 변경이 더 약한 확인 상태로 덮어쓰지 않는다.
with current_adult_confirmations as (
  select distinct on (cr.user_id) cr.user_id, cr.captured_at
    from public.consent_records cr
   where cr.consent_type = 'adult_confirmation'
     and cr.granted = true
     and private.consent_granted(cr.user_id, 'adult_confirmation')
   order by cr.user_id, cr.captured_at desc, cr.recorded_seq desc
)
update public.profiles p
   set age_verified_at = current_adult_confirmations.captured_at
  from current_adult_confirmations
 where p.id = current_adult_confirmations.user_id
   and p.age_verified_at is null;

commit;
