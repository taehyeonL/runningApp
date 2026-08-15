-- 동의 상태 판정을 결정적으로 만든다.
--
-- consent_records는 수정하지 않고 이벤트로 쌓는 표라, "현재 동의 상태"는 항상
-- 가장 최근 행을 골라 판단한다. 그런데 정렬이 `captured_at desc, id desc`였고
-- id는 gen_random_uuid()다. captured_at 기본값은 now() = 트랜잭션 시각이므로,
-- 같은 트랜잭션에서 같은 유형의 동의와 철회가 기록되면 두 행의 captured_at이
-- 같아지고 승자가 uuid 난수로 갈렸다. 동의는 위치 수집을 여는 값이라
-- 비결정적으로 판정되어서는 안 된다.
--
-- 게다가 이 질의가 네 곳에 복사되어 있었다. 경로마다 다른 답을 낼 수 있다는
-- 뜻이라, 순서만 고치는 대신 판정을 한 함수로 모은다.
begin;

-- 삽입 순서를 보존하는 단조 증가 키. captured_at이 같을 때만 쓰이므로
-- 기존 의미(더 최근에 캡처된 동의가 이긴다)는 그대로다.
alter table public.consent_records
  add column recorded_seq bigint generated always as identity;

comment on column public.consent_records.recorded_seq is
  'captured_at이 같을 때 최신 동의를 가르는 결정적 순서. 표시용이 아니다.';

drop index if exists public.consent_records_user_type_idx;
create index consent_records_user_type_idx
  on public.consent_records(user_id, consent_type, captured_at desc, recorded_seq desc);

-- ---------------------------------------------------------------------------
-- 현재 동의 상태: 단일 판정 지점
-- ---------------------------------------------------------------------------
create or replace function private.consent_granted(
  p_user_id uuid,
  p_consent_type text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select cr.granted
      from public.consent_records cr
     where cr.user_id = p_user_id
       and cr.consent_type = p_consent_type
     order by cr.captured_at desc, cr.recorded_seq desc
     limit 1
  ), false);
$$;

comment on function private.consent_granted(uuid, text) is
  '해당 사용자의 현재 동의 여부. 동의 판정은 이 함수 하나만 쓴다.';

create or replace function public.has_current_consent(required_consent_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.consent_granted(auth.uid(), required_consent_type);
$$;

-- ---------------------------------------------------------------------------
-- 복사되어 있던 세 곳을 같은 함수로 돌린다
-- ---------------------------------------------------------------------------
create or replace function private.is_pair_visible(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and auth.uid() <> other_user_id
    and not public.is_blocked(other_user_id)
    and public.has_current_consent('terms')
    and public.has_current_consent('privacy')
    and public.has_current_consent('location')
    and exists (
      select 1
        from public.profiles me
        join public.profiles other on other.id = other_user_id
       where me.id = auth.uid()
         and me.age_verified_at is not null
         and me.discovery_enabled = true
         and other.age_verified_at is not null
         and other.discovery_enabled = true
         and other.profile_visibility in ('profile', 'matching')
    )
    and private.consent_granted(other_user_id, 'terms')
    and private.consent_granted(other_user_id, 'privacy')
    and private.consent_granted(other_user_id, 'location')
    and not private.has_active_moderation_action(
      auth.uid(), array['visibility_restriction', 'suspension', 'ban']
    )
    and not private.has_active_moderation_action(
      other_user_id, array['visibility_restriction', 'suspension', 'ban']
    );
$$;

create or replace function public.is_pair_visible(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and auth.uid() <> other_user_id
    and not public.is_blocked(other_user_id)
    and public.has_current_consent('terms')
    and public.has_current_consent('privacy')
    and public.has_current_consent('location')
    and exists (
      select 1
        from public.profiles me
        join public.profiles other on other.id = other_user_id
       where me.id = auth.uid()
         and me.age_verified_at is not null
         and me.discovery_enabled = true
         and other.age_verified_at is not null
         and other.discovery_enabled = true
         and other.profile_visibility in ('profile', 'matching')
    )
    and private.consent_granted(other_user_id, 'terms')
    and private.consent_granted(other_user_id, 'privacy')
    and private.consent_granted(other_user_id, 'location')
    and not exists (
      select 1
        from public.moderation_actions ma
       where ma.subject_id in (auth.uid(), other_user_id)
         and ma.starts_at <= now()
         and (ma.ends_at is null or ma.ends_at > now())
         and ma.action_type in ('visibility_restriction', 'suspension', 'ban')
    );
$$;

create or replace function private.worker_pair_is_discoverable(
  first_user_id uuid,
  second_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select first_user_id is not null
    and second_user_id is not null
    and first_user_id <> second_user_id
    and not exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = first_user_id and b.blocked_id = second_user_id)
          or (b.blocker_id = second_user_id and b.blocked_id = first_user_id)
    )
    and not private.has_active_moderation_action(
      first_user_id, array['visibility_restriction', 'suspension', 'ban']
    )
    and not private.has_active_moderation_action(
      second_user_id, array['visibility_restriction', 'suspension', 'ban']
    )
    and not exists (
      select 1
        from (values (first_user_id), (second_user_id)) as users(user_id)
        join public.profiles p on p.id = users.user_id
       where p.age_verified_at is null
          or p.discovery_enabled = false
          or p.profile_visibility not in ('profile', 'matching')
          or not private.consent_granted(users.user_id, 'terms')
          or not private.consent_granted(users.user_id, 'privacy')
          or not private.consent_granted(users.user_id, 'location')
    )
    and (
      select count(*) from public.profiles p
       where p.id in (first_user_id, second_user_id)
    ) = 2;
$$;

revoke execute on function private.consent_granted(uuid, text)
  from public, anon, authenticated;

commit;
