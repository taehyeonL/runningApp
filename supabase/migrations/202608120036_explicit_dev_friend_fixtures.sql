-- 운영자만 기록할 수 있는 Auth app_metadata 테스트 표시가 양쪽에 있는 경우에만
-- 교차 횟수·요청 한도 없는 개발용 친구 연결을 허용한다. 표시를 migration으로
-- 부여하지 않으므로 기본 비활성이며 일반 사용자의 상호 수락 흐름은 바뀌지 않는다.
begin;
create function private.dev_social_test_enabled(p_user uuid) returns boolean
language sql stable security definer set search_path=public,private as $$
 select exists(select 1 from auth.users where id=p_user
   and raw_app_meta_data->'dev_social_test'->>'enabled'='true'
   and raw_app_meta_data->'dev_social_test'->>'source'='manual_test_not_pass');
$$;
create function private.dev_test_pair_allowed(p_other uuid) returns boolean
language sql stable security definer set search_path=public,private as $$
 select auth.uid() is not null and auth.uid()<>p_other
 and private.dev_social_test_enabled(auth.uid()) and private.dev_social_test_enabled(p_other)
 and private.pair_contact_allowed(auth.uid(),p_other)
 and private.consent_granted(auth.uid(),'terms') and private.consent_granted(auth.uid(),'privacy')
 and private.consent_granted(p_other,'terms') and private.consent_granted(p_other,'privacy')
 and not private.has_active_moderation_action(auth.uid(),array['visibility_restriction','request_restriction'])
 and not private.has_active_moderation_action(p_other,array['visibility_restriction','request_restriction'])
 and not exists(select 1 from public.account_deletion_requests where user_id in(auth.uid(),p_other) and cancelled_at is null and completed_at is null);
$$;
create function public.list_dev_test_runners() returns jsonb
language sql stable security definer set search_path=public,private as $$
 select case when private.dev_social_test_enabled(auth.uid()) then jsonb_build_object('enabled',true,'runners',
 coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,'connected',private.can_pair_message(auth.uid(),p.id)) order by p.nickname)
 from public.profiles p where private.dev_test_pair_allowed(p.id)),'[]'::jsonb))
 else jsonb_build_object('enabled',false,'runners','[]'::jsonb) end;
$$;
create function public.connect_dev_test_friend(p_other uuid) returns void
language plpgsql security definer set search_path=public,private as $$
begin
 if not coalesce(private.dev_test_pair_allowed(p_other),false) then
   raise exception '테스트 친구 연결 권한이 없거나 안전 제한이 적용되어 있어요.' using errcode='42501';
 end if;
 insert into public.friendships(user_one_id,user_two_id)
 values(least(auth.uid(),p_other),greatest(auth.uid(),p_other))
 on conflict(user_one_id,user_two_id) do nothing;
end $$;
revoke all on function private.dev_social_test_enabled(uuid),private.dev_test_pair_allowed(uuid),public.list_dev_test_runners(),public.connect_dev_test_friend(uuid) from public,anon,authenticated;
grant execute on function public.list_dev_test_runners(),public.connect_dev_test_friend(uuid) to authenticated;
comment on function public.connect_dev_test_friend(uuid) is 'Explicit operator-enabled test accounts only. Not evidence of a genuine mutual acceptance or PASS verification.';
commit;
