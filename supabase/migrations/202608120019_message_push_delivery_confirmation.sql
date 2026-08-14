-- 메시지 알림 유실 방지: 발송을 확인한 뒤에 완료 처리한다.
--
-- 202608120014의 worker_claim_message_pushes는 가져가는 순간 delivered_at을
-- 찍었다. Expo 호출이 실패하거나 worker가 중간에 죽으면 알림은 그대로 사라지고,
-- attempts 컬럼은 늘기만 할 뿐 재시도에 쓰이지 않았다.
--
-- 가져가기(claim)와 발송 확인(deliver)을 분리한다. 확인되지 않은 채 임대
-- 시간이 지나면 다시 발송 대상이 된다. 다만 무한 재시도는 하지 않는다.
-- 알림은 오래될수록 가치가 없고, 죽은 토큰으로 계속 두드리면 Expo 쪽에
-- 민폐이기도 하다.
begin;

alter table private.message_push_outbox
  add column claimed_at timestamptz,
  add column abandoned_at timestamptz,
  add column last_error text;

comment on column private.message_push_outbox.claimed_at is
  'worker가 가져간 시각. 임대 시간이 지나도록 확인되지 않으면 다시 대상이 된다.';
comment on column private.message_push_outbox.abandoned_at is
  '더 보낼 수 없다고 판단해 포기한 시각. 보낼 기기가 없거나 재시도를 다 쓴 경우.';

-- 인덱스는 테이블과 같은 private 스키마에 있다. 스키마를 붙이지 않으면
-- search_path의 public에서 찾다가 없다고 넘어가고, 곧바로 생성에서 충돌한다.
drop index if exists private.message_push_outbox_pending_idx;
create index message_push_outbox_pending_idx
  on private.message_push_outbox(created_at)
  where delivered_at is null and abandoned_at is null;

-- 임대 시간. worker는 1분 주기로 도므로, 이보다 넉넉히 잡아 정상 발송 중인
-- 알림을 다른 주기가 중복 발송하지 않게 한다.
create or replace function public.message_push_lease_minutes()
returns integer
language sql
immutable
as $$ select 5 $$;

-- 재시도 상한. 알림은 시의성이 전부라 오래 붙들고 있을 이유가 없다.
create or replace function public.message_push_max_attempts()
returns integer
language sql
immutable
as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- 1. 가져가기
-- ---------------------------------------------------------------------------
create or replace function public.worker_claim_message_pushes(p_limit integer default 100)
returns table (
  outbox_id bigint,
  token text,
  platform text,
  sender_nickname text,
  unread_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  lease interval := make_interval(mins => public.message_push_lease_minutes());
begin
  -- 보낼 수 없는 알림을 먼저 걷어낸다. 이 행들을 재시도 대상으로 두면 임대
  -- 시간마다 되살아나 큐가 영원히 비지 않는다.
  update private.message_push_outbox o
     set abandoned_at = now(),
         last_error = case
           when o.attempts >= public.message_push_max_attempts() then 'max_attempts_exhausted'
           when not exists (select 1 from public.push_tokens t where t.user_id = o.recipient_id)
             then 'no_registered_device'
           else 'conversation_closed'
         end
   where o.delivered_at is null
     and o.abandoned_at is null
     and (
       o.attempts >= public.message_push_max_attempts()
       or not exists (select 1 from public.push_tokens t where t.user_id = o.recipient_id)
       -- 차단·제재로 닫힌 대화의 알림은 보내지 않는다.
       or not private.can_pair_message(o.recipient_id, o.sender_id)
     );

  return query
  with claimed as (
    update private.message_push_outbox o
       set claimed_at = now(),
           attempts = o.attempts + 1
     where o.id in (
       select id from private.message_push_outbox
        where delivered_at is null
          and abandoned_at is null
          and (claimed_at is null or claimed_at < now() - lease)
        order by created_at
        limit greatest(1, least(coalesce(p_limit, 100), 100))
        for update skip locked
     )
    returning o.id, o.recipient_id, o.sender_id
  )
  select c.id,
         t.token,
         t.platform,
         p.nickname,
         (
           select count(*)::integer from public.messages m
            where m.recipient_id = c.recipient_id and m.read_at is null
         )
    from claimed c
    join public.push_tokens t on t.user_id = c.recipient_id
    join public.profiles p on p.id = c.sender_id;
end;
$$;

comment on function public.worker_claim_message_pushes(integer) is
  '보낼 메시지 알림을 가져간다. 발송 확인 전까지 완료 처리하지 않는다. 본문은 넘기지 않고, 차단·제재로 닫힌 대화는 제외한다.';

-- ---------------------------------------------------------------------------
-- 2. 발송 확인 · 실패 기록 · 포기
-- ---------------------------------------------------------------------------
create or replace function public.worker_mark_message_pushes_delivered(p_outbox_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update private.message_push_outbox
     set delivered_at = now(),
         last_error = null
   where id = any (coalesce(p_outbox_ids, array[]::bigint[]))
     and delivered_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- 실패는 기록만 한다. claimed_at 임대가 끝나면 자동으로 다시 대상이 되고,
-- 재시도 상한에 걸리면 다음 가져가기에서 포기 처리된다.
create or replace function public.worker_fail_message_pushes(
  p_outbox_ids bigint[],
  p_error text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update private.message_push_outbox
     set claimed_at = null,
         last_error = left(coalesce(p_error, 'unknown'), 500)
   where id = any (coalesce(p_outbox_ids, array[]::bigint[]))
     and delivered_at is null
     and abandoned_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.worker_abandon_message_pushes(
  p_outbox_ids bigint[],
  p_error text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update private.message_push_outbox
     set abandoned_at = now(),
         last_error = left(coalesce(p_error, 'unknown'), 500)
   where id = any (coalesce(p_outbox_ids, array[]::bigint[]))
     and delivered_at is null
     and abandoned_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- Expo가 DeviceNotRegistered를 돌려준 토큰은 더 두드리지 않는다. 사용자가 알림을
-- 다시 켜면 앱이 register_push_token으로 새로 등록한다.
create or replace function public.worker_drop_push_token(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.push_tokens where token = p_token;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 큐 정리
-- ---------------------------------------------------------------------------
-- 처리가 끝난 행을 계속 쌓아 둘 이유가 없다. 어떤 사용자가 누구에게 메시지를
-- 받았는지가 남는 표이므로 오래 보관하지 않는다.
create or replace function public.worker_prune_message_push_outbox(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from private.message_push_outbox
   where (delivered_at is not null or abandoned_at is not null)
     and created_at < now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.worker_mark_message_pushes_delivered(bigint[])
  from public, anon, authenticated;
revoke execute on function public.worker_fail_message_pushes(bigint[], text)
  from public, anon, authenticated;
revoke execute on function public.worker_abandon_message_pushes(bigint[], text)
  from public, anon, authenticated;
revoke execute on function public.worker_drop_push_token(text)
  from public, anon, authenticated;
revoke execute on function public.worker_prune_message_push_outbox(integer)
  from public, anon, authenticated;

grant execute on function public.worker_mark_message_pushes_delivered(bigint[]) to service_role;
grant execute on function public.worker_fail_message_pushes(bigint[], text) to service_role;
grant execute on function public.worker_abandon_message_pushes(bigint[], text) to service_role;
grant execute on function public.worker_drop_push_token(text) to service_role;
grant execute on function public.worker_prune_message_push_outbox(integer) to service_role;

commit;
