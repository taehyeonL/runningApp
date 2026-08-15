-- 운영자 신원과 감사 기록.
--
-- 202608120015의 operator_* 함수는 service_role 키만 있으면 누구든 호출할 수
-- 있고, 누가 어떤 판단을 내렸는지 아무 데도 남지 않았다. 기획서 §5는 운영
-- 화면에 제재 이력을 남기고 접근 권한을 최소화하라고 요구한다. 사람을 정지시키는
-- 도구에 책임 소재가 없으면 실제 운영에 쓸 수 없다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 운영자 명부
-- ---------------------------------------------------------------------------
-- service_role 키를 가진 것만으로는 부족하다. 등록된 운영자만 판단을 내릴 수
-- 있게 하고, 퇴사·권한 회수는 active로 즉시 끊는다.
create table public.operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.operators enable row level security;

comment on table public.operators is
  '운영 도구를 쓸 수 있는 계정. 앱 사용자에게는 어떤 형태로도 노출하지 않는다.';

-- ---------------------------------------------------------------------------
-- 2. 감사 기록
-- ---------------------------------------------------------------------------
-- 운영자 계정이 지워져도 "누가 이 제재를 내렸는가"는 남아야 하므로, 명부를
-- 참조하지 않고 판단 시점의 신원을 스냅샷으로 복사한다. reports 보존 설계와
-- 같은 이유다.
create table public.moderation_audit_log (
  id bigint generated always as identity primary key,
  operator_id uuid not null,
  operator_label text not null,
  action text not null check (action in ('resolved_report', 'viewed_sanction_history')),
  report_id uuid,
  subject_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.moderation_audit_log enable row level security;

create index moderation_audit_log_operator_idx
  on public.moderation_audit_log(operator_id, created_at desc);
create index moderation_audit_log_subject_idx
  on public.moderation_audit_log(subject_id, created_at desc);

-- 확정 제재에는 누가 내렸는지를 함께 남긴다.
alter table public.moderation_actions
  add column decided_by uuid,
  add column decided_by_label text;

comment on column public.moderation_actions.decided_by is
  '이 조치를 확정한 운영자. 자동 조치(origin=auto)에서는 비어 있다.';

-- ---------------------------------------------------------------------------
-- 3. 운영자 확인
-- ---------------------------------------------------------------------------
create or replace function private.require_operator(p_operator_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  operator_label text;
begin
  select o.label into operator_label
    from public.operators o
   where o.user_id = p_operator_id and o.active;
  if operator_label is null then
    raise exception 'Not an active operator' using errcode = '42501';
  end if;
  return operator_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 운영 도구를 운영자 신원과 함께 다시 정의
-- ---------------------------------------------------------------------------
-- 인자가 바뀌므로 예전 시그니처는 남기지 않는다. 남겨 두면 신원 없이 제재를
-- 내리는 경로가 그대로 열려 있게 된다.
drop function if exists public.operator_review_queue(text, integer);
drop function if exists public.operator_resolve_report(uuid, text, integer, text, text);
drop function if exists public.operator_sanction_history(uuid);

create or replace function public.operator_review_queue(
  p_operator_id uuid,
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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 큐 조회는 운영자 확인만 하고 감사 기록을 남기지 않는다. 콘솔이 주기적으로
  -- 새로고침하는 화면이라 기록해 봐야 잡음만 쌓이고, 정작 중요한 항목(특정
  -- 사용자를 겨냥한 조회와 실제 판단)이 묻힌다.
  perform private.require_operator(p_operator_id);

  return query
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
end;
$$;

comment on function public.operator_review_queue(uuid, text, integer) is
  '운영자 검토 큐. 신고자 신원은 싣지 않고 서로 다른 신고자 수만 넘긴다.';

create or replace function public.operator_resolve_report(
  p_operator_id uuid,
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
  operator_label text := private.require_operator(p_operator_id);
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

  insert into public.moderation_audit_log (
    operator_id, operator_label, action, report_id, subject_id, detail
  )
  values (
    p_operator_id, operator_label, 'resolved_report', p_report_id, target.reported_id,
    jsonb_build_object('action_type', p_action_type, 'duration_days', p_duration_days)
  );

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
    report_id, subject_id, action_type, origin, ends_at,
    user_notice, internal_notes, decided_by, decided_by_label
  )
  values (
    p_report_id,
    target.reported_id,
    p_action_type,
    'operator',
    case when p_duration_days is null then null
         else now() + make_interval(days => p_duration_days) end,
    p_user_notice,
    p_internal_notes,
    p_operator_id,
    operator_label
  )
  returning id into action_id;

  -- 운영자 판단이 자동 제한을 대체한다. ends_at까지 당기지 않으면, 가벼운
  -- 조치를 내려도 자동으로 걸렸던 무기한 노출 제한이 그대로 남는다.
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

comment on function public.operator_resolve_report(uuid, uuid, text, integer, text, text) is
  '운영자 확정 조치. 누가 내렸는지 기록하고, 기각하면 자동 노출 제한을 함께 해제한다.';

create or replace function public.operator_sanction_history(
  p_operator_id uuid,
  p_subject_id uuid
)
returns table (
  action_id uuid,
  action_type text,
  origin text,
  starts_at timestamptz,
  ends_at timestamptz,
  resolved_at timestamptz,
  decided_by_label text,
  internal_notes text,
  report_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  operator_label text := private.require_operator(p_operator_id);
begin
  -- 특정 사용자를 겨냥한 조회다. 내부 메모까지 보이므로 누가 언제 누구를
  -- 열어봤는지 남긴다.
  insert into public.moderation_audit_log (
    operator_id, operator_label, action, subject_id
  )
  values (p_operator_id, operator_label, 'viewed_sanction_history', p_subject_id);

  return query
  select m.id, m.action_type, m.origin, m.starts_at, m.ends_at, m.resolved_at,
         m.decided_by_label, m.internal_notes, r.reason
    from public.moderation_actions m
    left join public.reports r on r.id = m.report_id
   where m.subject_id = p_subject_id
   order by m.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 권한
-- ---------------------------------------------------------------------------
revoke all privileges on table public.operators from public, anon, authenticated;
revoke all privileges on table public.moderation_audit_log from public, anon, authenticated;

revoke execute on function private.require_operator(uuid)
  from public, anon, authenticated;
revoke execute on function public.operator_review_queue(uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.operator_resolve_report(uuid, uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.operator_sanction_history(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.operator_review_queue(uuid, text, integer) to service_role;
grant execute on function public.operator_resolve_report(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.operator_sanction_history(uuid, uuid) to service_role;

commit;
