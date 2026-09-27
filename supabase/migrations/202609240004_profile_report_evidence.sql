-- 새 소개/러닝 성향을 신고 순간 서버가 보존해 사후 수정으로 증거가 바뀌지 않게 한다.
-- 신고 접수 자격은 private 한 곳에서 판정하고, 실제 본문 복사는 앱과 같은 안전 뷰만
-- 사용한다. 차단/과거 관계의 안전 신고는 계속 받되 현재 비공개 프로필을 다시 읽지 않는다.
begin;

-- RLS alone does not prevent a reporter forging their own evidence. Remove both
-- table and legacy column grants; report submission now goes through server RPCs.
revoke all privileges on public.reports from public,anon,authenticated;
revoke all privileges (id,reporter_id,reported_id,reason,details,evidence,status,created_at,reporter_digest)
 on public.reports from public,anon,authenticated;
grant select(id,reported_id,reason,details,status,created_at) on public.reports to authenticated;

create function private.profile_report_allowed(p_other uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and auth.uid()<>p_other
 and exists(select 1 from public.profiles where id=auth.uid())
 and (
   exists(select 1 from public.social_profiles where id=p_other)
   or exists(select 1 from public.user_blocks where blocker_id=auth.uid() and blocked_id=p_other)
   or exists(select 1 from public.friendships where
     (user_one_id=auth.uid() and user_two_id=p_other) or (user_two_id=auth.uid() and user_one_id=p_other))
   or exists(select 1 from public.connection_requests where
     (requester_id=auth.uid() and recipient_id=p_other) or (recipient_id=auth.uid() and requester_id=p_other))
   or exists(select 1 from public.messages where recipient_id=auth.uid() and sender_id=p_other)
   or exists(select 1 from public.reports where reporter_id=auth.uid() and reported_id=p_other)
 );
$$;
revoke all on function private.profile_report_allowed(uuid) from public,anon,authenticated;

create or replace function public.report_profile(p_reported_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; report_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_reported_id=auth.uid() then raise exception 'You cannot report yourself' using errcode='22023'; end if;
 if p_reason is null or p_reason not in('sexual','stalking','fraud','hate','location_privacy','minor','other') then
   raise exception 'Invalid report reason' using errcode='22023'; end if;
 if p_details is not null and char_length(p_details)>2000 then
   raise exception 'Details are too long' using errcode='22023'; end if;
 if not coalesce(private.profile_report_allowed(p_reported_id),false) then
   raise exception 'Reportable relationship required' using errcode='42501'; end if;

 -- Explicit allowlist: never to_jsonb(profiles), never join location_points.
 select jsonb_build_object(
   'kind','profile','schema_version',2,'snapshot_status','captured',
   'nickname',p.nickname,'relationship_intents',p.relationship_intents,
   'running_style_tags',p.running_style_tags,'bio',d.bio,
   'conversation_preference',d.conversation_preference,'preferred_distance',d.preferred_distance,
   'captured_at',now()
 ) into snapshot from public.social_profiles p join public.social_runner_details d on d.id=p.id
 where p.id=p_reported_id;
 if snapshot is null then
   snapshot:=jsonb_build_object('kind','profile','schema_version',2,'snapshot_status','unavailable','captured_at',now());
 end if;
 insert into public.reports(reporter_id,reported_id,reason,details,evidence)
 values(auth.uid(),p_reported_id,p_reason,p_details,jsonb_build_array(snapshot)) returning id into report_id;
 return report_id;
end;
$$;
revoke all on function public.report_profile(uuid,text,text) from public,anon,authenticated;
grant execute on function public.report_profile(uuid,text,text) to authenticated;
comment on function public.report_profile(uuid,text,text) is
 '현재 조회 가능한 프로필의 허용 필드를 서버가 보존한다. 차단/과거 관계 신고는 접수하되 조회 불가 시 본문을 복사하지 않는다. 화면에서 과거에 본 버전의 보존은 별도 후속이다.';
commit;
