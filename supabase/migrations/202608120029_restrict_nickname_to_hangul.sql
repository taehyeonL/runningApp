-- 닉네임 정책을 한글 음절 2~8자로 좁힌다. 기존 사용자의 이름을 임의로 바꾸거나
-- 프로필의 다른 설정 변경을 막지 않기 위해, 신규 가입과 닉네임 변경 시점에만 같은
-- private 검증 함수를 트리거와 RPC에서 호출해 강제한다.
begin;

alter table public.profiles drop constraint profiles_nickname_check;

create or replace function private.nickname_is_valid(p_nickname text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_nickname ~ '^[가-힣]{2,8}$'
$$;

create or replace function private.enforce_nickname_format()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.nickname_is_valid(new.nickname) then
    raise exception 'Nickname must be 2 to 8 Korean characters' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_nickname_format
before insert or update of nickname on public.profiles
for each row execute function private.enforce_nickname_format();

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
  if not private.nickname_is_valid(normalized) then raise exception 'Nickname must be 2 to 8 Korean characters' using errcode = '22023'; end if;
  select nickname_changed_at + interval '6 months' into next_change_at from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  if next_change_at is not null and next_change_at > now() then raise exception 'Nickname can be changed once every 6 months' using errcode = '42501'; end if;
  update public.profiles set nickname = normalized, nickname_changed_at = now() where id = auth.uid();
  return now() + interval '6 months';
end;
$$;

revoke all on function private.nickname_is_valid(text) from public, anon, authenticated;
revoke all on function private.enforce_nickname_format() from public, anon, authenticated;

commit;
