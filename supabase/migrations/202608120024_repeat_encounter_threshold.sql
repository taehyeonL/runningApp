-- 요청 자격 기준을 반복 교차 5회에서 3회로 낮추고, 그 숫자를 한 곳에만 둔다.
--
-- "최근 30일 반복 교차 N회 이상이면 같이 뛰기를 요청할 수 있다"는 하나의 판단이
-- 지금까지 세 곳에 리터럴 5로 각각 박혀 있었다. private.is_request_eligible,
-- public.send_connection_request, 그리고 후보를 만드는 worker다. 셋 중 하나만
-- 고치면 발견 카드에는 "요청 가능"이 뜨는데 실제 전송은 42501로 막히거나, 반대로
-- 자격이 없는 상대에게 요청이 나가는 상태가 된다. 이 저장소에서 반복해서 나온
-- 결함이 정확히 이 모양이므로, 숫자를 public.repeat_encounter_threshold() 하나로
-- 옮기고 encounter_candidates.request_eligible은 트리거가 강제로 파생시킨다.
-- 이후 판정 지점들은 숫자를 다시 비교하지 않고 그 열만 읽는다.
--
-- 5회는 3km 러닝을 여러 번 완주해야 도달하는 값이라 초기 사용자가 아무도 만나지
-- 못한 채 이탈한다. 기획서 §3의 "러닝이 먼저다" 원칙은 유지하면서 진입 장벽만
-- 낮춘다. 상호 수락·차단·제재 판정은 전혀 건드리지 않는다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 기준값
-- ---------------------------------------------------------------------------
create or replace function public.repeat_encounter_threshold()
returns integer
language sql
immutable
as $$ select 3 $$;

comment on function public.repeat_encounter_threshold() is
  '같이 뛰기 요청이 열리는 최근 30일 반복 교차 최소 횟수. 이 값을 참조하지 말고 호출할 것.';

-- ---------------------------------------------------------------------------
-- 2. request_eligible 은 저장하되 계산하지 않는다
-- ---------------------------------------------------------------------------
-- 이 열은 repeat_encounters_30d 에서 파생되는 값인데, 지금까지는 worker가 직접
-- 계산해 넣었다. 쓰기 경로가 하나 더 생기면 다시 어긋나므로 트리거가 항상 덮어쓴다.
-- worker의 insert 는 그대로 두어도 결과가 같아진다.
create or replace function private.set_request_eligible()
returns trigger
language plpgsql
as $$
begin
  new.request_eligible := new.repeat_encounters_30d >= public.repeat_encounter_threshold();
  return new;
end;
$$;

drop trigger if exists encounter_candidates_derive_request_eligible
  on public.encounter_candidates;
create trigger encounter_candidates_derive_request_eligible
  before insert or update on public.encounter_candidates
  for each row execute function private.set_request_eligible();

revoke execute on function private.set_request_eligible()
  from public, anon, authenticated;

-- 기준을 낮추기만 하고 기존 행을 그대로 두면, 이미 3~4회 교차한 사용자는 다음
-- 러닝을 마칠 때까지 바뀐 규칙의 혜택을 받지 못한다.
update public.encounter_candidates
   set request_eligible = repeat_encounters_30d >= public.repeat_encounter_threshold()
 where request_eligible
       is distinct from (repeat_encounters_30d >= public.repeat_encounter_threshold());

-- ---------------------------------------------------------------------------
-- 3. 판정 지점은 파생된 열만 읽는다
-- ---------------------------------------------------------------------------
create or replace function private.is_request_eligible(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_pair_visible(target_user_id)
    and not private.has_active_moderation_action(
      auth.uid(), array['request_restriction', 'suspension', 'ban']
    )
    and exists (
      select 1
        from public.encounter_candidates c
       where c.viewer_id = auth.uid()
         and c.candidate_profile_id = target_user_id
         -- 횟수 비교는 encounter_candidates_derive_request_eligible 트리거가
         -- 이미 수행했다. 여기서 다시 세면 기준이 두 곳에 생긴다.
         and c.request_eligible = true
         and c.expires_at > now()
    );
$$;

create or replace function public.send_connection_request(
  p_target_user_id uuid,
  p_candidate_id uuid,
  p_template_key text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_template_key not in ('weekend_5k', 'after_work_jog', 'morning_run', 'custom') then
    raise exception 'Invalid request template' using errcode = '22023';
  end if;
  if p_message is not null and char_length(p_message) > 240 then
    raise exception 'Request message is too long' using errcode = '22001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(auth.uid(), p_target_user_id)::text || ':' || greatest(auth.uid(), p_target_user_id)::text,
      0
    )
  );

  update public.connection_requests
     set status = 'expired', resolution_reason = 'expired_timeout'
   where status = 'pending'
     and expires_at <= now()
     and (requester_id = auth.uid() or recipient_id = auth.uid());

  if not private.is_request_eligible(p_target_user_id) then
    raise exception 'Request is not eligible' using errcode = '42501';
  end if;
  -- 자격은 위에서 이미 판정했다. 여기서는 건네받은 카드가 그 상대의 것인지만
  -- 확인한다. 횟수를 다시 비교하면 기준이 또 한 벌 생긴다.
  if not exists (
    select 1 from public.encounter_candidates c
     where c.id = p_candidate_id
       and c.viewer_id = auth.uid()
       and c.candidate_profile_id = p_target_user_id
       and c.request_eligible = true
       and c.expires_at > now()
  ) then
    raise exception 'Candidate does not match this request' using errcode = '42501';
  end if;
  -- 아래 5는 반복 교차와 무관한 하루 요청 개수 상한이다.
  if (select count(*) from public.connection_requests r
       where r.requester_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Daily request limit reached' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.connection_requests r
     where (
       (r.requester_id = auth.uid() and r.recipient_id = p_target_user_id)
       or (r.requester_id = p_target_user_id and r.recipient_id = auth.uid())
     )
       and (r.status = 'pending' or r.created_at > now() - interval '7 days')
  ) then
    raise exception 'Request cooldown is active' using errcode = '23505';
  end if;

  insert into public.connection_requests (
    requester_id, recipient_id, candidate_id, template_key, message
  ) values (
    auth.uid(), p_target_user_id, p_candidate_id, p_template_key, p_message
  ) returning id into new_request_id;
  return new_request_id;
end;
$$;

commit;
