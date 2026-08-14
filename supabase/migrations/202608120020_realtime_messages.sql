-- 대화 실시간 갱신.
--
-- 지금까지 메시지는 화면을 열거나 직접 보낼 때만 다시 읽었다. 상대가 보낸
-- 메시지는 대화를 나갔다 들어와야 보였다.
--
-- postgres_changes는 구독자의 JWT로 해당 테이블의 RLS를 그대로 평가한다.
-- messages의 SELECT 정책이 이미 "상호 수락 + 차단·제재 없음"을 요구하므로,
-- 실시간 경로가 기존 접근 규칙을 우회하지 않는다. 정책을 새로 만들지 않고
-- 발행에만 추가하는 이유다.
begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- UPDATE 이벤트에서 RLS를 평가하려면 변경 전 행 전체가 필요하다. 기본값
-- (기본키만)으로는 읽음 표시 변경이 구독자에게 전달되지 않는다.
alter table public.messages replica identity full;

commit;
