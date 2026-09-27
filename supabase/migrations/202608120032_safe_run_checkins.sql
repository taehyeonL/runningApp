-- 첫 러닝 약속의 안전 체크인은 상호 수락된 관계 안에서만 본인이 만들고 완료한다.
-- 상대·광고·푸시에 정확한 장소·시각·위치를 전달하지 않으며, 같은 private 관계 판정을
-- 생성 시 호출해 차단·제재·성인 확인을 우회할 수 없게 한다.
begin;

create table public.run_safety_checkins (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'prepared' check (status in ('prepared', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (request_id, owner_id),
  check ((status = 'prepared' and completed_at is null) or (status = 'completed' and completed_at is not null))
);

create index run_safety_checkins_owner_created_idx on public.run_safety_checkins (owner_id, created_at desc);

create or replace function public.prepare_run_safety_checkin(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare request_row public.connection_requests%rowtype;
declare counterpart_id uuid;
declare checkin_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into request_row from public.connection_requests where id = p_request_id and status = 'accepted';
  if not found then raise exception 'Accepted request not found' using errcode = 'P0002'; end if;
  if auth.uid() not in (request_row.requester_id, request_row.recipient_id) then raise exception 'Not a request participant' using errcode = '42501'; end if;
  counterpart_id := case when request_row.requester_id = auth.uid() then request_row.recipient_id else request_row.requester_id end;
  if not private.pair_contact_allowed(auth.uid(), counterpart_id) then raise exception 'Safe contact is not allowed' using errcode = '42501'; end if;
  insert into public.run_safety_checkins (request_id, owner_id)
  values (p_request_id, auth.uid())
  on conflict (request_id, owner_id) do update set status = public.run_safety_checkins.status
  returning id into checkin_id;
  return checkin_id;
end;
$$;

create or replace function public.complete_run_safety_checkin(p_checkin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.run_safety_checkins
     set status = 'completed', completed_at = now()
   where id = p_checkin_id and owner_id = auth.uid() and status = 'prepared';
  return found;
end;
$$;

create view public.my_run_safety_checkins
with (security_barrier = true) as
  select id, request_id, status, created_at, completed_at
    from public.run_safety_checkins
   where owner_id = auth.uid();

revoke all privileges on public.run_safety_checkins from public, anon, authenticated;
revoke all privileges on public.my_run_safety_checkins from public, anon, authenticated;
revoke all on function public.prepare_run_safety_checkin(uuid) from public, anon;
revoke all on function public.complete_run_safety_checkin(uuid) from public, anon;
grant select on public.my_run_safety_checkins to authenticated;
grant execute on function public.prepare_run_safety_checkin(uuid), public.complete_run_safety_checkin(uuid) to authenticated;

commit;
