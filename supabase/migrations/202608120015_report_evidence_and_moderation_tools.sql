-- 신고 증거 제출, 운영자 검토, 노출 제한·제재 이력 도구.
-- 기획서 §5 "신고·제재 운영 정책"을 그대로 옮긴다:
--   - 신고 수만으로 자동 영구정지하지 않는다. 누적은 우선 "노출 제한" 신호다.
--   - 중대 사안(스토킹·성적 침해·미성년·위치 노출)은 1건이라도 즉시 조치한다.
--   - 최종 제재는 운영자가 증거와 반복성을 보고 결정한다.
--   - 제재 대상에게 사유·기간·이의제기 방법을 안내하되 신고자는 공개하지 않는다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 자동 조치와 운영자 조치를 구분
-- ---------------------------------------------------------------------------
-- 자동 노출 제한은 "검토 대기" 신호일 뿐 확정 제재가 아니다. 이력에서 둘을
-- 구분하지 못하면 나중에 누적 위반 횟수를 셀 때 자동 조치까지 위반으로 세게
-- 되어, 허위 신고가 곧바로 영구 정지로 이어진다.
alter table public.moderation_actions
  add column origin text not null default 'operator'
    check (origin in ('auto', 'operator'));

alter table public.moderation_actions
  add column resolved_at timestamptz;

-- 제한 여부를 판단하는 기존 함수들(can_view_relationship, can_send_message,
-- has_active_moderation_action)은 모두 starts_at/ends_at만 본다. 따라서 제한을
-- 푸는 유일한 방법은 ends_at을 지금으로 당기는 것이다. resolved_at은 "누가
-- 언제 풀었나"를 남기는 감사 기록이지 집행 신호가 아니다.
--
-- 기존 제약은 ends_at > starts_at이라, 걸자마자 푸는 경우(허위 신고 즉시 기각)를
-- 표현할 수 없었다. 같은 시각으로 끝나는 조치 = "즉시 해제"를 허용한다.
alter table public.moderation_actions drop constraint moderation_actions_time_range_check;
alter table public.moderation_actions
  add constraint moderation_actions_time_range_check
  check (ends_at is null or ends_at >= starts_at);

comment on column public.moderation_actions.origin is
  'auto = 누적/중대 신고로 자동 걸린 임시 노출 제한, operator = 운영자 확정 제재.';

create index moderation_actions_subject_idx
  on public.moderation_actions(subject_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. 당사자에게 보여줄 제재 안내
-- ---------------------------------------------------------------------------
-- internal_notes와 report_id는 당사자에게 보이면 안 되므로 테이블 정책이 아니라
-- 뷰로 노출한다. RLS는 행 단위라 컬럼을 가릴 수 없기 때문이다.
create or replace view public.my_moderation_notices
with (security_barrier = true) as
  select m.id,
         m.action_type,
         m.origin,
         m.starts_at,
         m.ends_at,
         m.user_notice,
         m.created_at
    from public.moderation_actions m
   where m.subject_id = auth.uid()
     and m.origin = 'operator'
   order by m.created_at desc;

comment on view public.my_moderation_notices is
  '내게 내려진 제재 안내. 신고자·내부 메모는 절대 포함하지 않는다.';

-- ---------------------------------------------------------------------------
-- 3. 프로필 신고: 증거는 서버가 만든다
-- ---------------------------------------------------------------------------
-- 메시지 신고(202608120014)와 같은 원칙이다. 클라이언트가 evidence를 채우면
-- 증거를 지어낼 수 있으므로, 신고 시점의 프로필 스냅샷을 서버가 복사한다.
create or replace function public.report_profile(
  p_reported_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  subject public.profiles%rowtype;
  report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reported_id = auth.uid() then
    raise exception 'You cannot report yourself' using errcode = '22023';
  end if;
  if p_reason not in ('sexual', 'stalking', 'fraud', 'hate', 'location_privacy', 'minor', 'other') then
    raise exception 'Invalid report reason' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 2000 then
    raise exception 'Details are too long' using errcode = '22023';
  end if;

  select * into subject from public.profiles where id = p_reported_id;
  if subject.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.reports (reporter_id, reported_id, reason, details, evidence)
  values (
    auth.uid(),
    p_reported_id,
    p_reason,
    p_details,
    jsonb_build_array(jsonb_build_object(
      'kind', 'profile',
      'nickname', subject.nickname,
      'relationship_intents', subject.relationship_intents,
      'running_style_tags', subject.running_style_tags,
      'captured_at', now()
    ))
  )
  returning id into report_id;

  return report_id;
end;
$$;

comment on function public.report_profile(uuid, text, text) is
  '프로필을 신고한다. 증거는 신고 시점 프로필 스냅샷을 서버가 복사한다.';

-- ---------------------------------------------------------------------------
-- 4. 누적 신고 → 자동 노출 제한
-- ---------------------------------------------------------------------------
-- 기획서 기준: 서로 다른 이용자로부터 최근 30일 내 2건 이상이면 발견에서
-- 임시 제외하고 검토한다. "서로 다른 이용자"가 핵심이다. 한 사람이 같은 상대를
-- 반복 신고해 노출을 끊는 보복 신고를 막아야 하기 때문이다.
create or replace function public.report_accumulation_threshold()
returns integer
language sql
immutable
as $$ select 2 $$;

create or replace function public.report_accumulation_window_days()
returns integer
language sql
immutable
as $$ select 30 $$;

-- 중대 사안은 1건이라도 즉시 노출을 멈춘다. 다만 자동으로 계정을 정지하지는
-- 않는다. 미검토 신고 1건으로 계정을 끊으면 허위·보복 신고가 그대로 무기가
-- 된다. 계정 정지는 증거를 본 운영자만 내릴 수 있다.
create or replace function public.severe_report_reasons()
returns text[]
language sql
immutable
as $$ select array['stalking', 'sexual', 'minor', 'location_privacy'] $$;

create or replace function private.evaluate_report_accumulation(p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters integer;
  has_severe boolean;
  already_restricted boolean;
  trigger_reason text;
begin
  select count(distinct reporter_id)
    into distinct_reporters
    from public.reports
   where reported_id = p_subject_id
     and created_at >= now()
       - make_interval(days => public.report_accumulation_window_days())
     and status in ('open', 'under_review', 'actioned');

  select exists (
    select 1 from public.reports
     where reported_id = p_subject_id
       and reason = any (public.severe_report_reasons())
       and created_at >= now()
         - make_interval(days => public.report_accumulation_window_days())
       and status in ('open', 'under_review', 'actioned')
  ) into has_severe;

  if not has_severe and distinct_reporters < public.report_accumulation_threshold() then
    return;
  end if;

  -- 이미 노출이 막혀 있으면 다시 걸지 않는다. 신고가 들어올 때마다 제재
  -- 이력이 쌓이면 운영자가 실제 위반 횟수를 셀 수 없게 된다.
  select exists (
    select 1 from public.moderation_actions
     where subject_id = p_subject_id
       and action_type in ('visibility_restriction', 'suspension', 'ban')
       and starts_at <= now()
       and (ends_at is null or ends_at > now())
       and resolved_at is null
  ) into already_restricted;
  if already_restricted then return; end if;

  trigger_reason := case
    when has_severe then '중대 신고가 접수되어 검토가 끝날 때까지 발견 노출을 멈췄어요.'
    else '서로 다른 이용자의 신고가 누적되어 검토가 끝날 때까지 발견 노출을 멈췄어요.'
  end;

  insert into public.moderation_actions (
    subject_id, action_type, origin, user_notice, internal_notes
  )
  values (
    p_subject_id,
    'visibility_restriction',
    'auto',
    trigger_reason,
    format('auto: distinct_reporters=%s severe=%s', distinct_reporters, has_severe)
  );

  -- 검토 대기 상태로 올려 운영자 큐에 뜨게 한다.
  update public.reports
     set status = 'under_review'
   where reported_id = p_subject_id
     and status = 'open';
end;
$$;

create or replace function private.on_report_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.evaluate_report_accumulation(new.reported_id);
  return new;
end;
$$;

create trigger reports_evaluate_accumulation
  after insert on public.reports
  for each row execute function private.on_report_inserted();

-- ---------------------------------------------------------------------------
-- 5. 운영자 검토 도구
-- ---------------------------------------------------------------------------
-- 운영 화면은 service_role로만 접근한다. 앱 사용자 역할에는 어떤 형태로도
-- 열지 않는다. 신고자 신원은 큐에 싣지 않되, 같은 사람이 반복 신고하는지는
-- 판단해야 하므로 "서로 다른 신고자 수"만 넘긴다.
create or replace function public.operator_review_queue(
  p_status text default 'under_review',
  p_limit integer default 50
)
returns table (
  report_id uuid,
  subject_id uuid,
  subject_nickname text,
  reason text,
  details text,
  evidence jsonb,
  status public.moderation_status,
  reported_at timestamptz,
  distinct_reporters_30d integer,
  confirmed_violations_90d integer,
  currently_restricted boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.reported_id,
         p.nickname,
         r.reason,
         r.details,
         r.evidence,
         r.status,
         r.created_at,
         (
           select count(distinct r2.reporter_id)::integer from public.reports r2
            where r2.reported_id = r.reported_id
              and r2.created_at >= now() - interval '30 days'
         ),
         -- 확정 위반만 센다. 자동 노출 제한은 아직 위반이 아니다.
         (
           select count(*)::integer from public.moderation_actions m
            where m.subject_id = r.reported_id
              and m.origin = 'operator'
              and m.action_type <> 'dismissed'
              and m.created_at >= now() - interval '90 days'
         ),
         exists (
           select 1 from public.moderation_actions m
            where m.subject_id = r.reported_id
              and m.action_type in ('visibility_restriction', 'suspension', 'ban')
              and m.starts_at <= now()
              and (m.ends_at is null or m.ends_at > now())
              and m.resolved_at is null
         )
    from public.reports r
    join public.profiles p on p.id = r.reported_id
   where r.status::text = coalesce(p_status, 'under_review')
   order by r.created_at
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.operator_review_queue(text, integer) is
  '운영자 검토 큐. 신고자 신원은 싣지 않고 서로 다른 신고자 수만 넘긴다.';

-- 운영자가 증거를 보고 내리는 확정 조치. 조치와 신고 상태 변경을 한 번에
-- 처리해, 조치만 남고 신고가 열린 채로 방치되는 상태를 만들지 않는다.
create or replace function public.operator_resolve_report(
  p_report_id uuid,
  p_action_type text,
  p_duration_days integer default null,
  p_user_notice text default null,
  p_internal_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.reports%rowtype;
  action_id uuid;
begin
  if p_action_type not in (
    'warning', 'remove_content', 'request_restriction',
    'visibility_restriction', 'suspension', 'ban', 'dismissed'
  ) then
    raise exception 'Invalid action type' using errcode = '22023';
  end if;

  select * into target from public.reports where id = p_report_id;
  if target.id is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  if p_action_type = 'dismissed' then
    -- 기각하면 자동으로 걸려 있던 노출 제한을 풀어준다. 허위 신고로 끊긴
    -- 노출이 운영자 판단 뒤에도 남아 있으면 신고가 그대로 무기가 된다.
    update public.moderation_actions
       set resolved_at = now(),
           ends_at = greatest(now(), starts_at)
     where subject_id = target.reported_id
       and origin = 'auto'
       and resolved_at is null;
    update public.reports set status = 'dismissed' where id = p_report_id;
    return null;
  end if;

  insert into public.moderation_actions (
    report_id, subject_id, action_type, origin, ends_at, user_notice, internal_notes
  )
  values (
    p_report_id,
    target.reported_id,
    p_action_type,
    'operator',
    case when p_duration_days is null then null
         else now() + make_interval(days => p_duration_days) end,
    p_user_notice,
    p_internal_notes
  )
  returning id into action_id;

  -- 운영자 판단이 자동 제한을 대체한다. ends_at까지 당기지 않으면, 운영자가
  -- '경고'처럼 가벼운 조치를 내려도 자동으로 걸렸던 무기한 노출 제한이 그대로
  -- 남아 사실상 영구 제재가 된다.
  update public.moderation_actions
     set resolved_at = now(),
         ends_at = greatest(now(), starts_at)
   where subject_id = target.reported_id
     and origin = 'auto'
     and resolved_at is null;

  update public.reports set status = 'actioned' where id = p_report_id;
  return action_id;
end;
$$;

comment on function public.operator_resolve_report(uuid, text, integer, text, text) is
  '운영자 확정 조치. 기각하면 자동으로 걸렸던 노출 제한을 함께 해제한다.';

create or replace function public.operator_sanction_history(p_subject_id uuid)
returns table (
  action_id uuid,
  action_type text,
  origin text,
  starts_at timestamptz,
  ends_at timestamptz,
  resolved_at timestamptz,
  internal_notes text,
  report_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.action_type, m.origin, m.starts_at, m.ends_at, m.resolved_at,
         m.internal_notes, r.reason
    from public.moderation_actions m
    left join public.reports r on r.id = m.report_id
   where m.subject_id = p_subject_id
   order by m.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
grant select on public.my_moderation_notices to authenticated;

revoke execute on function public.report_profile(uuid, text, text) from public, anon;
grant execute on function public.report_profile(uuid, text, text) to authenticated;

revoke execute on function private.evaluate_report_accumulation(uuid)
  from public, anon, authenticated;
revoke execute on function private.on_report_inserted()
  from public, anon, authenticated;

revoke execute on function public.operator_review_queue(text, integer)
  from public, anon, authenticated;
revoke execute on function public.operator_resolve_report(uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.operator_sanction_history(uuid)
  from public, anon, authenticated;

grant execute on function public.operator_review_queue(text, integer) to service_role;
grant execute on function public.operator_resolve_report(uuid, text, integer, text, text) to service_role;
grant execute on function public.operator_sanction_history(uuid) to service_role;

commit;
