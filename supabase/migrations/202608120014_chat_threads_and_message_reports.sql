-- 상호 수락 이후의 채팅: 대화 목록, 읽음 처리, 메시지 신고 진입점.
-- 기획서 §3: 채팅은 상호 수락 이후에만 열린다. 이 마이그레이션은 그 규칙을
-- 우회하는 경로를 만들지 않는다. 대화 목록도 friendships를 통해서만 만들어지고,
-- 메시지 조회는 기존 "friends read messages while permitted" 정책을 그대로 탄다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 대화 목록
-- ---------------------------------------------------------------------------
-- 클라이언트가 친구마다 메시지를 따로 조회하면 왕복이 늘고, 차단·제재로 대화가
-- 닫힌 상대를 목록에서 걸러내는 판단이 클라이언트로 새어 나간다. 서버가 한 번에
-- 계산해서 돌려준다.
create or replace function public.list_chat_threads()
returns table (
  partner_id uuid,
  partner_nickname text,
  last_message_body text,
  last_message_at timestamptz,
  last_message_mine boolean,
  unread_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select f.partner_id,
         partner.nickname,
         m.body,
         m.created_at,
         m.sender_id = auth.uid(),
         coalesce(u.unread_count, 0)::integer
    from (
      select case when user_one_id = auth.uid() then user_two_id else user_one_id end as partner_id
        from public.friendships
       where user_one_id = auth.uid() or user_two_id = auth.uid()
    ) f
    -- 차단·제재로 닫힌 대화는 목록에서도 사라져야 한다.
    join public.profiles partner on partner.id = f.partner_id
    join lateral (select private.can_send_message(f.partner_id) as allowed) perm on perm.allowed
    left join lateral (
      select body, created_at, sender_id
        from public.messages
       where (sender_id = auth.uid() and recipient_id = f.partner_id)
          or (sender_id = f.partner_id and recipient_id = auth.uid())
       order by created_at desc
       limit 1
    ) m on true
    left join lateral (
      select count(*) as unread_count
        from public.messages
       where sender_id = f.partner_id
         and recipient_id = auth.uid()
         and read_at is null
    ) u on true
   order by m.created_at desc nulls last;
$$;

comment on function public.list_chat_threads() is
  '상호 수락된 상대와의 대화 목록. 차단·제재로 닫힌 대화는 빠진다.';

-- ---------------------------------------------------------------------------
-- 2. 읽음 처리
-- ---------------------------------------------------------------------------
-- messages에는 authenticated UPDATE 권한이 없다. 읽음 표시만 할 수 있는 좁은
-- RPC를 여는 편이, 본문 수정까지 열리는 UPDATE 권한보다 안전하다.
create or replace function public.mark_messages_read(p_partner_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not private.can_send_message(p_partner_id) then
    return 0;
  end if;

  update public.messages
     set read_at = now()
   where recipient_id = auth.uid()
     and sender_id = p_partner_id
     and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

comment on function public.mark_messages_read(uuid) is
  '내가 받은 메시지만 읽음으로 표시한다. 본문은 어떤 경로로도 수정할 수 없다.';

-- ---------------------------------------------------------------------------
-- 3. 메시지 신고
-- ---------------------------------------------------------------------------
-- 클라이언트가 evidence를 직접 채워 넣으면 신고 증거를 조작할 수 있다. 신고
-- 대상 메시지의 본문·시각은 서버가 직접 복사한다. 신고자가 볼 수 있는
-- 메시지만 신고할 수 있고, 자기 메시지는 신고 대상이 아니다.
create or replace function public.report_message(
  p_message_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages%rowtype;
  report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reason not in ('sexual', 'stalking', 'fraud', 'hate', 'location_privacy', 'minor', 'other') then
    raise exception 'Invalid report reason' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 2000 then
    raise exception 'Details are too long' using errcode = '22023';
  end if;

  select * into target from public.messages where id = p_message_id;
  if target.id is null then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if target.recipient_id <> auth.uid() then
    raise exception 'Only the recipient can report a message' using errcode = '42501';
  end if;

  insert into public.reports (reporter_id, reported_id, reason, details, evidence)
  values (
    auth.uid(),
    target.sender_id,
    p_reason,
    p_details,
    jsonb_build_array(jsonb_build_object(
      'kind', 'message',
      'message_id', target.id,
      'body', target.body,
      'sent_at', target.created_at,
      'captured_at', now()
    ))
  )
  returning id into report_id;

  return report_id;
end;
$$;

comment on function public.report_message(uuid, text, text) is
  '메시지를 신고한다. 증거는 클라이언트 입력이 아니라 서버가 원문에서 복사한다.';

-- ---------------------------------------------------------------------------
-- 4. 푸시 알림 토큰
-- ---------------------------------------------------------------------------
-- 알림은 "새 메시지가 있다"까지만 알리고 본문은 서버가 골라 보낸다. 토큰은
-- 기기 단위로 저장하고, 로그아웃·계정 삭제 시 함께 사라진다.
create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
create index push_tokens_user_idx on public.push_tokens(user_id);

create policy "owners read their push tokens"
  on public.push_tokens for select
  using (user_id = auth.uid());

-- 토큰 등록은 upsert 의미가 필요하고, 다른 사람의 토큰을 빼앗아 자기 계정에
-- 붙이는 일도 막아야 하므로 RPC로만 연다.
create or replace function public.register_push_token(
  p_token text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) not between 1 and 255 then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
     set user_id = auth.uid(),
         platform = excluded.platform,
         last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

comment on function public.unregister_push_token(text) is
  '로그아웃한 기기로 알림이 계속 가지 않도록 토큰을 지운다.';

-- ---------------------------------------------------------------------------
-- 5. 메시지 알림 발송 대기열
-- ---------------------------------------------------------------------------
-- 트리거가 직접 HTTP를 호출하면 메시지 전송이 알림 서버 장애에 묶인다.
-- outbox에 쌓고 worker가 가져가게 한다. 본문은 담지 않는다.
create table private.message_push_outbox (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0
);
create index message_push_outbox_pending_idx
  on private.message_push_outbox(created_at)
  where delivered_at is null;

create or replace function private.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.message_push_outbox (message_id, recipient_id, sender_id)
  values (new.id, new.recipient_id, new.sender_id);
  return new;
end;
$$;

create trigger messages_enqueue_push
  after insert on public.messages
  for each row execute function private.enqueue_message_push();

-- worker가 보낼 대상을 가져간다. 본문 대신 보낸 사람 닉네임만 넘겨,
-- 알림 서버나 기기 잠금화면에 대화 내용이 남지 않게 한다.
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
    join public.profiles p on p.id = c.sender_id;
end;
$$;

comment on function public.worker_claim_message_pushes(integer) is
  '보낼 메시지 알림을 가져간다. 본문은 넘기지 않고 보낸 사람과 미읽음 수만 넘긴다.';

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
revoke all privileges on table public.push_tokens from public, anon, authenticated;
grant select on table public.push_tokens to authenticated;
revoke all privileges on table private.message_push_outbox from public, anon, authenticated;

revoke execute on function private.enqueue_message_push() from public, anon, authenticated;
revoke execute on function public.worker_claim_message_pushes(integer)
  from public, anon, authenticated;
grant execute on function public.worker_claim_message_pushes(integer) to service_role;

-- 새 함수는 기본적으로 PUBLIC에 EXECUTE가 붙으므로 로그인 사용자만 남긴다.
revoke execute on function public.list_chat_threads() from public, anon;
revoke execute on function public.mark_messages_read(uuid) from public, anon;
revoke execute on function public.report_message(uuid, text, text) from public, anon;
revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;

grant execute on function public.list_chat_threads() to authenticated;
grant execute on function public.mark_messages_read(uuid) to authenticated;
grant execute on function public.report_message(uuid, text, text) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

commit;
