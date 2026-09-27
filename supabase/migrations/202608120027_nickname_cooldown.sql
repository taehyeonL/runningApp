-- 닉네임은 가입 때 사용자가 직접 정하고, 이후에는 6개월에 한 번만 바꾼다.
-- 클라이언트의 profiles 직접 UPDATE 권한에서 nickname을 빼고 이 RPC 하나가
-- 쿨다운과 정규화를 판정하게 해, 화면을 우회한 변경도 막는다.
begin;

alter table public.profiles add column nickname_changed_at timestamptz;

create or replace function public.set_nickname(p_nickname text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare normalized text := btrim(coalesce(p_nickname, ''));
declare next_change_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(normalized) not between 2 and 24 then raise exception 'Nickname must be 2 to 24 characters' using errcode = '22023'; end if;
  select nickname_changed_at + interval '6 months' into next_change_at from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  if next_change_at is not null and next_change_at > now() then raise exception 'Nickname can be changed once every 6 months' using errcode = '42501'; end if;
  update public.profiles set nickname = normalized, nickname_changed_at = now() where id = auth.uid();
  return now() + interval '6 months';
end;
$$;

revoke update (nickname) on public.profiles from authenticated;
grant execute on function public.set_nickname(text) to authenticated;

commit;
