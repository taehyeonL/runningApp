-- 원본 GPS 보관 기간·자동 마스킹·삭제 작업.
-- 기획서 §4: "원본 GPS는 매칭·러닝 기록에 필요한 최소 기간만 보관하고, 이후
-- 격자/세그먼트 기반의 비식별 요약으로 전환한다", "집·직장·반복 출발점/도착점
-- 인근은 자동 마스킹한다".
--
-- 파기 작업이 원본을 그냥 지우면 사용자는 자기 경로 이력을 통째로 잃는다.
-- 그래서 파기 시점에 (1) 격자 요약으로 전환하고 (2) 요약에서 끝점과 반복
-- 출발·도착 격자를 지운 뒤 (3) 원본을 삭제한다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 보관 기간을 한 곳에서 정의
-- ---------------------------------------------------------------------------
-- 보관 기간은 개인정보 처리방침에 고지하는 값이므로, 운영 중 임의로 바뀌지
-- 않도록 설정 테이블이 아니라 마이그레이션으로만 바뀌는 함수로 고정한다.
create or replace function public.raw_gps_retention_days()
returns integer
language sql
immutable
as $$ select 30 $$;

comment on function public.raw_gps_retention_days() is
  '원본 GPS 최대 보관 일수. 개인정보 처리방침 고지값과 반드시 일치해야 한다.';

-- 격자 한 변의 길이. 발견 카드가 "수백 m 단위로 뭉갠" 위치만 쓰도록 맞춘다.
create or replace function public.route_cell_size_meters()
returns integer
language sql
immutable
as $$ select 500 $$;

-- 세션 시작·종료 부근에서 잘라낼 거리. worker의 ENDPOINT_MASK_METERS와 같다.
create or replace function public.route_endpoint_mask_meters()
returns integer
language sql
immutable
as $$ select 200 $$;

-- ---------------------------------------------------------------------------
-- 2. 버려진 세션의 보관 기한 공백 메우기
-- ---------------------------------------------------------------------------
-- 지금까지 raw_points_purge_after는 세션이 정상 종료될 때만 채워졌다. 앱이
-- 죽거나 사용자가 러닝을 방치해 'recording'에 멈춘 세션은 기한이 null이라
-- 파기 대상에 영영 들어오지 않고 원본 GPS가 무기한 남았다. 생성 시점부터
-- 기한을 부여해 구멍을 막는다.
create or replace function private.set_default_raw_points_purge_after()
returns trigger
language plpgsql
as $$
begin
  if new.raw_points_purge_after is null then
    new.raw_points_purge_after :=
      new.started_at + make_interval(days => public.raw_gps_retention_days());
  end if;
  return new;
end;
$$;

create trigger running_sessions_default_purge_after
  before insert on public.running_sessions
  for each row execute function private.set_default_raw_points_purge_after();

-- 202608120005의 finalize는 raw_points_purge_after를 least(기존값, now()+30일)로
-- 좁히기만 하므로, 여기서 넣은 started_at 기준 기한이 항상 이긴다. 보관 기간을
-- 바꿀 때는 이 함수만 고치면 되고 finalize의 상한은 건드리지 않아도 된다.
--
-- 이미 쌓여 있던 세션도 같은 기준으로 메운다.
update public.running_sessions
   set raw_points_purge_after =
         started_at + make_interval(days => public.raw_gps_retention_days())
 where raw_points_purge_after is null;

alter table public.running_sessions
  add column raw_points_purged_at timestamptz;

comment on column public.running_sessions.raw_points_purged_at is
  '원본 GPS를 격자 요약으로 전환하고 삭제한 시각. null이면 아직 원본이 남아 있다.';

-- ---------------------------------------------------------------------------
-- 3. 격자 좌표 계산
-- ---------------------------------------------------------------------------
-- 위도 1도는 어디서나 약 111,320m지만 경도 1도는 위도에 따라 줄어든다.
-- 격자를 정사각형에 가깝게 유지하려면 경도 폭을 위도로 보정해야 한다.
create or replace function private.route_cell_key(
  p_latitude double precision,
  p_longitude double precision
)
returns text
language sql
immutable
as $$
  select format(
    '%s:%s',
    floor(p_latitude / (public.route_cell_size_meters() / 111320.0))::bigint,
    floor(
      p_longitude / greatest(
        public.route_cell_size_meters()
          / (111320.0 * cos(radians(greatest(least(p_latitude, 85), -85)))),
        0.000001
      )
    )::bigint
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. 반복 출발·도착 지점(집·직장) 앵커
-- ---------------------------------------------------------------------------
-- 한 세션의 끝점만 잘라내면, 여러 세션이 같은 곳으로 수렴한다는 사실은 여전히
-- 남는다. 사용자별로 출발·도착 격자의 등장 횟수를 세어 두고, 반복되는 격자는
-- 어떤 요약에서도 제거한다. 이 표 자체가 집·직장 후보이므로 private 스키마에
-- 두고 service_role만 접근한다.
create table private.user_location_anchors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cell_key text not null,
  hit_count integer not null default 1 check (hit_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, cell_key)
);

-- 2회 이상 출발·도착한 격자는 생활 반경으로 보고 마스킹한다.
create or replace function public.route_anchor_mask_threshold()
returns integer
language sql
immutable
as $$ select 2 $$;

-- ---------------------------------------------------------------------------
-- 5. 세션 경로 요약
-- ---------------------------------------------------------------------------
create table public.session_route_summaries (
  session_id uuid primary key references public.running_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cell_size_meters integer not null,
  cells jsonb not null default '[]'::jsonb,
  raw_point_count integer not null,
  masked_cell_count integer not null default 0,
  summarized_at timestamptz not null default now()
);
alter table public.session_route_summaries enable row level security;

create index session_route_summaries_user_idx
  on public.session_route_summaries(user_id, summarized_at desc);

-- 요약도 본인만 본다. 다른 사용자에게는 발견 카드의 범주형 문구만 노출한다.
create policy "owners read their route summary"
  on public.session_route_summaries for select
  using (user_id = auth.uid());

comment on table public.session_route_summaries is
  '원본 GPS 파기 후 남는 비식별 경로 요약. 끝점과 반복 출발·도착 격자는 제거된다.';

-- ---------------------------------------------------------------------------
-- 6. 요약 생성: 끝점 절단 → 앵커 갱신 → 반복 격자 제거
-- ---------------------------------------------------------------------------
create or replace function private.summarize_session_route(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  total_points integer;
  total_distance double precision;
  mask_meters integer := public.route_endpoint_mask_meters();
  start_cell text;
  end_cell text;
  kept_cells text[];
  masked_count integer := 0;
begin
  select user_id into owner_id from public.running_sessions where id = p_session_id;
  if owner_id is null then return; end if;

  -- 누적 거리를 구해 앞뒤 mask_meters 구간을 잘라낸다.
  with ordered as (
    select latitude, longitude, recorded_at,
           lag(latitude) over w as prev_lat,
           lag(longitude) over w as prev_lng
      from public.location_points
     where session_id = p_session_id
       and is_outlier = false
    window w as (order by recorded_at)
  ),
  stepped as (
    select latitude, longitude, recorded_at,
           coalesce(
             2 * 6371000 * asin(sqrt(
               sin(radians(latitude - prev_lat) / 2) ^ 2
               + cos(radians(prev_lat)) * cos(radians(latitude))
                 * sin(radians(longitude - prev_lng) / 2) ^ 2
             )),
             0
           ) as step_meters
      from ordered
  ),
  cumulative as (
    select latitude, longitude, recorded_at,
           sum(step_meters) over (order by recorded_at) as travelled
      from stepped
  )
  select count(*)::integer, coalesce(max(travelled), 0)
    into total_points, total_distance
    from cumulative;

  if total_points = 0 then
    insert into public.session_route_summaries (
      session_id, user_id, cell_size_meters, cells, raw_point_count, masked_cell_count
    )
    values (p_session_id, owner_id, public.route_cell_size_meters(), '[]'::jsonb, 0, 0)
    on conflict (session_id) do nothing;
    return;
  end if;

  -- 출발·도착 격자를 구한다. 거리 기준 절단(200m)만으로는 격자 한 변(500m)이
  -- 더 넓어 끝점이 같은 격자에 남을 수 있으므로, 두 격자는 이름으로 직접
  -- 제외해야 한다.
  select private.route_cell_key(latitude, longitude) into start_cell
    from public.location_points
   where session_id = p_session_id and is_outlier = false
   order by recorded_at asc limit 1;
  select private.route_cell_key(latitude, longitude) into end_cell
    from public.location_points
   where session_id = p_session_id and is_outlier = false
   order by recorded_at desc limit 1;

  -- 반복 여부는 이 카운트로만 알 수 있으므로 요약에서 빼기 전에 세어 둔다.
  insert into private.user_location_anchors (user_id, cell_key)
  select owner_id, cell_key
    from unnest(array[start_cell, end_cell]) as cell_key
   group by cell_key
  on conflict (user_id, cell_key) do update
     set hit_count = private.user_location_anchors.hit_count + 1,
         last_seen_at = now();

  -- 어떤 격자가 이제서야 임계값을 넘었다면, 그 격자는 예전 요약에도 남아 있다.
  -- 집·직장은 나중에야 반복으로 드러나므로 과거 요약까지 소급해 지워야 한다.
  update public.session_route_summaries s
     set cells = scrubbed.kept,
         masked_cell_count = s.masked_cell_count
           + (jsonb_array_length(s.cells) - jsonb_array_length(scrubbed.kept))
    from (
      select s2.session_id,
             coalesce(
               jsonb_agg(c.value order by c.ord) filter (where a.cell_key is null),
               '[]'::jsonb
             ) as kept
        from public.session_route_summaries s2
        cross join lateral jsonb_array_elements_text(s2.cells) with ordinality c(value, ord)
        left join private.user_location_anchors a
          on a.user_id = s2.user_id
         and a.cell_key = c.value
         and a.hit_count >= public.route_anchor_mask_threshold()
       where s2.user_id = owner_id
       group by s2.session_id
    ) scrubbed
   where s.session_id = scrubbed.session_id
     and s.cells <> scrubbed.kept;

  -- 끝점 구간을 잘라낸 중간 경로만 격자로 바꾸고, 반복 앵커 격자를 제거한다.
  with ordered as (
    select latitude, longitude, recorded_at,
           lag(latitude) over w as prev_lat,
           lag(longitude) over w as prev_lng
      from public.location_points
     where session_id = p_session_id
       and is_outlier = false
    window w as (order by recorded_at)
  ),
  stepped as (
    select latitude, longitude, recorded_at,
           coalesce(
             2 * 6371000 * asin(sqrt(
               sin(radians(latitude - prev_lat) / 2) ^ 2
               + cos(radians(prev_lat)) * cos(radians(latitude))
                 * sin(radians(longitude - prev_lng) / 2) ^ 2
             )),
             0
           ) as step_meters
      from ordered
  ),
  cumulative as (
    select latitude, longitude, recorded_at,
           sum(step_meters) over (order by recorded_at) as travelled
      from stepped
  ),
  trimmed as (
    select private.route_cell_key(latitude, longitude) as cell_key, recorded_at
      from cumulative
     where total_distance > mask_meters * 2
       and travelled >= mask_meters
       and travelled <= total_distance - mask_meters
  ),
  deduped as (
    -- 연속으로 같은 격자에 머무른 구간은 한 번만 남긴다.
    select cell_key, recorded_at
      from (
        select cell_key, recorded_at,
               lag(cell_key) over (order by recorded_at) as prev_cell
          from trimmed
      ) t
     where prev_cell is distinct from cell_key
  ),
  masked as (
    select d.cell_key, d.recorded_at,
           (d.cell_key in (start_cell, end_cell) or a.cell_key is not null) as is_masked
      from deduped d
      left join private.user_location_anchors a
        on a.user_id = owner_id
       and a.cell_key = d.cell_key
       and a.hit_count >= public.route_anchor_mask_threshold()
  )
  select array_agg(cell_key order by recorded_at) filter (where not is_masked),
         count(*) filter (where is_masked)::integer
    into kept_cells, masked_count
    from masked;

  insert into public.session_route_summaries (
    session_id, user_id, cell_size_meters, cells, raw_point_count, masked_cell_count
  )
  values (
    p_session_id,
    owner_id,
    public.route_cell_size_meters(),
    to_jsonb(coalesce(kept_cells, array[]::text[])),
    total_points,
    coalesce(masked_count, 0)
  )
  on conflict (session_id) do update
     set cells = excluded.cells,
         raw_point_count = excluded.raw_point_count,
         masked_cell_count = excluded.masked_cell_count,
         summarized_at = now();
end;
$$;

comment on function private.summarize_session_route(uuid) is
  '원본 GPS를 격자 요약으로 전환한다. 끝점 200m와 반복 출발·도착 격자는 빠진다.';

-- ---------------------------------------------------------------------------
-- 7. 파기 작업: 세션 단위로 요약한 뒤 원본 삭제
-- ---------------------------------------------------------------------------
-- 기존 함수는 포인트 단위 limit으로 잘라 지웠기 때문에, 한 세션이 여러 배치에
-- 걸치면 요약을 만들 수 없다. 세션 단위로 바꾼다.
create or replace function public.worker_purge_expired_location_points(p_limit integer default 10000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired record;
  deleted_count integer := 0;
  batch integer;
begin
  for expired in
    select s.id
      from public.running_sessions s
     where s.raw_points_purge_after <= now()
       and s.raw_points_purged_at is null
       and exists (select 1 from public.location_points lp where lp.session_id = s.id)
     order by s.raw_points_purge_after
     limit greatest(1, least(coalesce(p_limit, 10000), 50000))
  loop
    perform private.summarize_session_route(expired.id);

    delete from public.location_points where session_id = expired.id;
    get diagnostics batch = row_count;
    deleted_count := deleted_count + batch;

    update public.running_sessions
       set raw_points_purged_at = now()
     where id = expired.id;
  end loop;

  return deleted_count;
end;
$$;

comment on function public.worker_purge_expired_location_points(integer) is
  '보관 기간이 지난 세션의 원본 GPS를 격자 요약으로 전환하고 삭제한다. p_limit은 세션 수.';

-- ---------------------------------------------------------------------------
-- 8. 권한
-- ---------------------------------------------------------------------------
revoke all privileges on table private.user_location_anchors
  from public, anon, authenticated;
revoke all privileges on table public.session_route_summaries
  from public, anon, authenticated;
grant select on table public.session_route_summaries to authenticated;

revoke execute on function private.summarize_session_route(uuid)
  from public, anon, authenticated;
revoke execute on function private.set_default_raw_points_purge_after()
  from public, anon, authenticated;

commit;
