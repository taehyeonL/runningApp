-- 같이뛰어 MVP: 위치 안전과 상호 동의를 우선하는 초기 스키마
-- 서비스 역할(service_role)은 RLS를 우회하며 co-running 처리와 운영 도구에만 사용합니다.
create extension if not exists pgcrypto;

create type public.profile_visibility as enum ('private', 'friends', 'profile', 'matching');
create type public.run_source as enum ('phone', 'apple_watch', 'wear_os', 'import');
create type public.run_status as enum ('recording', 'completed', 'discarded', 'processing');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'expired');
create type public.moderation_status as enum ('open', 'under_review', 'actioned', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  birth_year smallint check (birth_year between 1900 and extract(year from now())::smallint),
  age_verified_at timestamptz,
  bio text check (char_length(bio) <= 300),
  relationship_intents text[] not null default array['running_mate']::text[],
  running_style_tags text[] not null default '{}',
  profile_visibility public.profile_visibility not null default 'matching',
  log_default_visibility public.profile_visibility not null default 'private',
  discovery_enabled boolean not null default true,
  avatar_path text,
  pace_min_seconds integer,
  pace_max_seconds integer,
  monthly_distance_km numeric(7,2) not null default 0,
  completed_run_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pace_min_seconds is null or pace_min_seconds between 120 and 1800),
  check (pace_max_seconds is null or pace_max_seconds between 120 and 1800)
);

-- 원본 경로의 메타데이터는 session에, 원본 GPS는 location_points에 분리한다.
-- source_record_id / sync_metadata는 워치 오프라인 동기화, 중복 방지와 부분 업로드를 수용한다.
create table public.running_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source public.run_source not null default 'phone',
  source_record_id text,
  status public.run_status not null default 'recording',
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  distance_meters numeric(10,2) not null default 0 check (distance_meters >= 0),
  average_pace_seconds integer,
  moving_seconds integer,
  calories numeric(8,2),
  average_heart_rate integer,
  gps_quality_summary jsonb not null default '{}'::jsonb,
  raw_points_purge_after timestamptz,
  visibility public.profile_visibility not null default 'private',
  is_match_eligible boolean not null default false,
  sync_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_record_id),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0)
);

-- 절대 다른 이용자에게 select로 노출하지 않는 원본 GPS 테이블.
create table public.location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.running_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters real,
  altitude_meters real,
  speed_mps real,
  heading_degrees real,
  is_outlier boolean not null default false,
  created_at timestamptz not null default now(),
  check (accuracy_meters is null or accuracy_meters >= 0),
  check (speed_mps is null or speed_mps >= 0),
  check (heading_degrees is null or heading_degrees between 0 and 360)
);
create index location_points_session_recorded_at_idx on public.location_points(session_id, recorded_at);
create index running_sessions_user_started_at_idx on public.running_sessions(user_id, started_at desc);

-- 서버 판정 결과. 원본 좌표, 정확한 시각, 원본 route id를 저장/전달하지 않는다.
create table public.encounter_candidates (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  candidate_profile_id uuid not null references public.profiles(id) on delete cascade,
  similarity_label text not null check (similarity_label in ('good_match', 'quite_good_match', 'new_rhythm')),
  reasons jsonb not null default '[]'::jsonb,
  repeat_encounters_30d smallint not null default 0 check (repeat_encounters_30d >= 0),
  request_eligible boolean not null default false,
  safe_overlap_summary text,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (viewer_id, candidate_profile_id),
  check (viewer_id <> candidate_profile_id)
);
create index encounter_candidates_viewer_expiry_idx on public.encounter_candidates(viewer_id, expires_at desc);

create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  candidate_id uuid references public.encounter_candidates(id) on delete set null,
  template_key text not null check (template_key in ('weekend_5k', 'after_work_jog', 'morning_run', 'custom')),
  message text check (char_length(message) <= 240),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> recipient_id)
);
create unique index connection_requests_one_pending_pair_idx
  on public.connection_requests(requester_id, recipient_id) where status = 'pending';

-- accepted friendship only: chat 허용 여부의 단일 근거다.
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references public.profiles(id) on delete cascade,
  user_two_id uuid not null references public.profiles(id) on delete cascade,
  accepted_request_id uuid unique references public.connection_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  check (user_one_id < user_two_id),
  unique (user_one_id, user_two_id)
);

-- 차단은 신고와 별개로 즉시 작동한다.
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- 메시지는 상호 수락 friendship이 존재하는 두 사용자 사이에서만 읽고 쓴다.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index messages_pair_created_at_idx on public.messages(sender_id, recipient_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('sexual', 'stalking', 'fraud', 'hate', 'location_privacy', 'minor', 'other')),
  details text check (char_length(details) <= 2000),
  evidence jsonb not null default '[]'::jsonb,
  status public.moderation_status not null default 'open',
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check (action_type in ('warning', 'remove_content', 'request_restriction', 'visibility_restriction', 'suspension', 'ban', 'dismissed')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  internal_notes text,
  user_notice text,
  created_at timestamptz not null default now()
);

-- 법정/정책 동의는 수정하지 않고 버전별 이벤트로 남긴다. 철회도 새 레코드로 기록한다.
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null check (consent_type in ('adult_confirmation', 'terms', 'privacy', 'location', 'marketing', 'health_data')),
  policy_version text not null,
  granted boolean not null,
  captured_at timestamptz not null default now(),
  source text not null default 'mobile_app',
  metadata jsonb not null default '{}'::jsonb
);
create index consent_records_user_type_idx on public.consent_records(user_id, consent_type, captured_at desc);

-- 서버가 session 완료 이벤트를 큐에 넣고 Edge Function/worker가 처리한다.
create table public.detection_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.running_sessions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts smallint not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger running_sessions_set_updated_at before update on public.running_sessions for each row execute function public.set_updated_at();

create or replace function public.are_friends(other_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where (user_one_id = auth.uid() and user_two_id = other_user_id)
       or (user_two_id = auth.uid() and user_one_id = other_user_id)
  );
$$;

create or replace function public.is_blocked(other_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = auth.uid() and blocked_id = other_user_id)
       or (blocked_id = auth.uid() and blocker_id = other_user_id)
  );
$$;

-- 무료 사용자는 최근 30일 내 유효 반복 교차 5회 이상 후보에 요청할 수 있다.
-- 유료 요청 규칙이 도입되면 이 함수만 server-side entitlement 검사로 확장한다.
create or replace function public.is_request_eligible(target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.encounter_candidates c
    where c.viewer_id = auth.uid()
      and c.candidate_profile_id = target_user_id
      and c.request_eligible = true
      and c.repeat_encounters_30d >= 5
      and c.expires_at > now()
  ) and not public.is_blocked(target_user_id);
$$;

-- 수락을 원자적으로 처리해 friendship을 만들며, 이 시점 전에는 messages RLS를 통과할 수 없다.
create or replace function public.accept_connection_request(request_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare request_row public.connection_requests;
begin
  update public.connection_requests
     set status = 'accepted', responded_at = now()
   where id = request_id and recipient_id = auth.uid() and status = 'pending'
   returning * into request_row;
  if request_row.id is null then return false; end if;
  insert into public.friendships (user_one_id, user_two_id, accepted_request_id)
  values (least(request_row.requester_id, request_row.recipient_id), greatest(request_row.requester_id, request_row.recipient_id), request_row.id)
  on conflict (user_one_id, user_two_id) do nothing;
  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.running_sessions enable row level security;
alter table public.location_points enable row level security;
alter table public.encounter_candidates enable row level security;
alter table public.connection_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.consent_records enable row level security;
alter table public.detection_jobs enable row level security;

create policy "users manage only their profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "owners manage their sessions" on public.running_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- GPS: 본인과 service_role(서버 처리)만 접근. 타 사용자 SELECT 정책은 의도적으로 없다.
create policy "owners manage their own raw GPS points" on public.location_points for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users read their candidate cards" on public.encounter_candidates for select using (viewer_id = auth.uid() and expires_at > now());
create policy "requester reads own requests" on public.connection_requests for select using (requester_id = auth.uid() or recipient_id = auth.uid());
create policy "eligible users send requests" on public.connection_requests for insert with check (requester_id = auth.uid() and public.is_request_eligible(recipient_id));
create policy "requester cancels pending requests" on public.connection_requests for update using (requester_id = auth.uid() and status = 'pending') with check (requester_id = auth.uid() and status = 'cancelled');
create policy "recipient declines pending requests" on public.connection_requests for update using (recipient_id = auth.uid() and status = 'pending') with check (recipient_id = auth.uid() and status = 'declined');
create policy "friends see their relationship" on public.friendships for select using (user_one_id = auth.uid() or user_two_id = auth.uid());
create policy "users manage their blocks" on public.user_blocks for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "friends read messages only" on public.messages for select using ((sender_id = auth.uid() and public.are_friends(recipient_id)) or (recipient_id = auth.uid() and public.are_friends(sender_id)));
create policy "friends send messages only" on public.messages for insert with check (sender_id = auth.uid() and public.are_friends(recipient_id) and not public.is_blocked(recipient_id));
create policy "reporter creates and reads their reports" on public.reports for select using (reporter_id = auth.uid());
create policy "reporter submits report" on public.reports for insert with check (reporter_id = auth.uid());
create policy "subject sees their own action notice" on public.moderation_actions for select using (subject_id = auth.uid());
create policy "users read their consent history" on public.consent_records for select using (user_id = auth.uid());
create policy "users append their own consent" on public.consent_records for insert with check (user_id = auth.uid());
-- detection_jobs는 서버가 관리하며 클라이언트에는 노출하지 않는다.

-- 안전한 공개 프로필 projection. exact location/time/route/raw GPS fields are not present.
create view public.public_profiles with (security_barrier = true) as
  select id, nickname,
         case
           when birth_year is null then null
           when extract(year from now())::int - birth_year < 30 then '20대'
           when extract(year from now())::int - birth_year < 40 then '30대'
           when extract(year from now())::int - birth_year < 50 then '40대'
           else '50대 이상'
         end as age_band,
         relationship_intents, running_style_tags,
         avatar_path, pace_min_seconds, pace_max_seconds, monthly_distance_km, completed_run_count
  from public.profiles
  where discovery_enabled = true and profile_visibility in ('profile', 'matching');
grant select on public.public_profiles to authenticated;
grant execute on function public.accept_connection_request(uuid) to authenticated;

comment on table public.location_points is 'Raw GPS only: owner + server processing. Never join this table into client discovery queries.';
comment on table public.encounter_candidates is 'Safe, server-generated discovery summary. No exact coordinate, time, path or segment identifiers.';
comment on table public.messages is 'Read/write allowed only after accepted friendship generated from mutual request acceptance.';
