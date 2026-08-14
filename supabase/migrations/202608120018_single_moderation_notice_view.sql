-- 제재 안내 창구를 하나로 합치고, 뷰 권한을 SELECT로 좁힌다.
--
-- 202608120015가 my_moderation_notices를 새로 만들었지만, 202608120002에 이미
-- 같은 목적의 user_moderation_notices가 있었다. 둘 다 authenticated에게 열려
-- 있었고 옛 뷰에는 origin 필터가 없어서, "자동 노출 제한은 확정 제재가 아니므로
-- 당사자에게 보여주지 않는다"는 규칙이 옛 뷰를 통해 그대로 뚫려 있었다.
-- 015의 테스트는 새 뷰만 확인했기 때문에 통과하면서도 규칙은 깨져 있었다.
--
-- 같은 사실을 두 곳에서 보여주면 결국 한쪽만 고쳐진다. 창구를 하나로 남긴다.
begin;

drop view if exists public.my_moderation_notices;

create or replace view public.user_moderation_notices
with (security_barrier = true) as
  select m.id,
         m.action_type,
         m.starts_at,
         m.ends_at,
         m.user_notice,
         m.created_at
    from public.moderation_actions m
   where m.subject_id = auth.uid()
     -- 자동으로 걸린 임시 노출 제한은 검토 대기 신호이지 확정 제재가 아니다.
     -- 확정되지 않은 조치를 제재로 안내하면, 허위 신고를 당한 사용자가 자신이
     -- 제재받았다고 오해하게 된다.
     and m.origin = 'operator'
   order by m.created_at desc;

comment on view public.user_moderation_notices is
  '내게 확정된 제재 안내. 신고자·내부 메모·자동 임시 제한은 포함하지 않는다.';

-- Supabase 기본 권한은 새 뷰·테이블에 ALL을 부여한다. 이 저장소의 다른
-- 객체들처럼 먼저 회수하고 필요한 것만 준다. 202608120012의 my_privacy_status와
-- 202608120015의 뷰가 이 절차를 빠뜨려 anon에게 불필요한 권한이 남아 있었다.
revoke all privileges on public.user_moderation_notices from public, anon, authenticated;
grant select on public.user_moderation_notices to authenticated;

revoke all privileges on public.my_privacy_status from public, anon, authenticated;
grant select on public.my_privacy_status to authenticated;

commit;
