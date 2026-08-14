-- 차단·제재로 닫힌 대화에는 푸시 알림도 나가지 않는다.
--
-- messages 정책과 list_chat_threads는 private.can_send_message로 대화가 아직
-- 열려 있는지 판단하지만, worker_claim_message_pushes(202608120014)는 그 검사를
-- 하지 않았다. 그래서 상대를 차단한 뒤에도 차단 전에 도착해 있던 메시지의
-- 알림이 그대로 발송됐다. 받는 사람 화면에서는 이미 사라진 대화인데 잠금화면에는
-- 차단한 사람의 닉네임이 뜨고, 눌러도 열리지 않는다.
--
-- can_send_message는 auth.uid()를 쓰기 때문에 worker(service_role) 문맥에서는
-- 쓸 수 없다. 규칙을 worker용으로 다시 적으면 정책과 어긋나기 시작하므로,
-- 두 사용자를 명시적으로 받는 함수를 만들고 기존 함수들이 그것을 호출하게 한다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 두 사용자 사이의 접촉 가능 여부 (auth.uid()에 의존하지 않음)
-- ---------------------------------------------------------------------------
-- 차단과 정지·영구차단은 친구 여부와 무관하게 모든 접촉을 막는다.
create or replace function private.pair_contact_allowed(
  user_a uuid,
  user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select user_a is not null
     and user_b is not null
     and not exists (
       select 1 from public.user_blocks
        where (blocker_id = user_a and blocked_id = user_b)
           or (blocker_id = user_b and blocked_id = user_a)
     )
     and not private.has_active_moderation_action(user_a, array['suspension', 'ban'])
     and not private.has_active_moderation_action(user_b, array['suspension', 'ban']);
$$;

-- 메시지는 접촉 가능 + 상호 수락(친구) 두 조건을 모두 만족해야 한다.
create or replace function private.can_pair_message(
  user_a uuid,
  user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.pair_contact_allowed(user_a, user_b)
     and exists (
       select 1 from public.friendships
        where (user_one_id = user_a and user_two_id = user_b)
           or (user_one_id = user_b and user_two_id = user_a)
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. 기존 함수는 새 함수에 위임한다
-- ---------------------------------------------------------------------------
-- 규칙을 두 벌 유지하면 한쪽만 고쳐져 정책과 알림이 어긋난다. 시그니처와
-- 의미는 그대로라 이 함수들을 쓰는 RLS 정책은 손대지 않아도 된다.
create or replace function private.can_view_relationship(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and private.pair_contact_allowed(auth.uid(), other_user_id);
$$;

create or replace function private.can_send_message(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and private.can_pair_message(auth.uid(), other_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 3. 알림 발송 대상에서 닫힌 대화를 제외
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
begin
  return query
  with claimed as (
    update private.message_push_outbox o
       set delivered_at = now(),
           attempts = o.attempts + 1
     where o.id in (
       select id from private.message_push_outbox
        where delivered_at is null
        order by created_at
        limit greatest(1, least(coalesce(p_limit, 100), 1000))
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
    join public.profiles p on p.id = c.sender_id
   -- 차단하거나 제재로 닫힌 대화의 알림은 발송 대상에서 제외한다. outbox
   -- 행은 claimed에서 이미 소비되므로 나중에 되살아나지도 않는다.
   where private.can_pair_message(c.recipient_id, c.sender_id);
end;
$$;

comment on function public.worker_claim_message_pushes(integer) is
  '보낼 메시지 알림을 가져간다. 본문은 넘기지 않고, 차단·제재로 닫힌 대화는 제외한다.';

commit;
