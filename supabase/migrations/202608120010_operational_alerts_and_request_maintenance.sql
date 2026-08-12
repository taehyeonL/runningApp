begin;

create table public.operational_alerts (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,
  category text not null check (category in ('detection_job_exhausted', 'detection_job_stalled', 'cron_failed')),
  severity text not null check (severity in ('warning', 'critical')),
  entity_id uuid,
  message text not null check (char_length(message) between 1 and 1000),
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  delivered_at timestamptz,
  acknowledged_at timestamptz
);
create index operational_alerts_undelivered_idx
  on public.operational_alerts (last_detected_at desc)
  where delivered_at is null;
alter table public.operational_alerts enable row level security;

revoke all privileges on table public.operational_alerts from public, anon, authenticated;
grant select, insert, update on table public.operational_alerts to service_role;
grant usage, select on sequence public.operational_alerts_id_seq to service_role;

create or replace function public.worker_collect_operational_alerts()
returns setof public.operational_alerts
language plpgsql
security definer
set search_path = public, pg_catalog, cron
as $$
begin
  insert into public.operational_alerts (
    fingerprint, category, severity, entity_id, message, details
  )
  select 'detection_job_exhausted:' || j.id,
         'detection_job_exhausted', 'critical', j.id,
         'Co-running detection job exhausted all retries.',
         jsonb_build_object(
           'session_id', j.session_id,
           'attempts', j.attempts,
           'error', left(coalesce(j.error_message, 'Unknown worker error'), 500)
         )
    from public.detection_jobs j
   where j.status = 'failed' and j.attempts >= 5
  on conflict (fingerprint) do update
    set last_detected_at = now(), details = excluded.details;

  insert into public.operational_alerts (
    fingerprint, category, severity, entity_id, message, details
  )
  select 'detection_job_stalled:' || j.id,
         'detection_job_stalled', 'warning', j.id,
         'Co-running detection job remained locked beyond the recovery window.',
         jsonb_build_object('session_id', j.session_id, 'locked_at', j.locked_at, 'attempts', j.attempts)
    from public.detection_jobs j
   where j.status = 'processing'
     and j.locked_at < now() - interval '20 minutes'
  on conflict (fingerprint) do update
    set last_detected_at = now(), details = excluded.details;

  insert into public.operational_alerts (
    fingerprint, category, severity, message, details, first_detected_at, last_detected_at
  )
  select 'cron_failed:' || d.runid,
         'cron_failed', 'critical',
         'A critical Running Mate cron execution failed.',
         jsonb_build_object(
           'job_name', j.jobname,
           'run_id', d.runid,
           'status', d.status,
           'return_message', left(coalesce(d.return_message, ''), 500)
         ),
         d.start_time,
         coalesce(d.end_time, d.start_time)
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where j.jobname in (
     'detect-co-running-every-minute',
     'maintain-social-state-every-minute',
     'collect-running-alerts-every-five-minutes'
   )
     and d.status = 'failed'
     and d.start_time > now() - interval '24 hours'
  on conflict (fingerprint) do update
    set last_detected_at = excluded.last_detected_at, details = excluded.details;

  return query
    select a.*
      from public.operational_alerts a
     where a.delivered_at is null and a.acknowledged_at is null
     order by a.last_detected_at
     limit 20;
end;
$$;

create or replace function public.worker_mark_operational_alerts_delivered(p_alert_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.operational_alerts
     set delivered_at = now()
   where id = any(coalesce(p_alert_ids, '{}'::bigint[]))
     and delivered_at is null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.worker_collect_operational_alerts()
  from public, anon, authenticated;
revoke execute on function public.worker_mark_operational_alerts_delivered(bigint[])
  from public, anon, authenticated;
grant execute on function public.worker_collect_operational_alerts(),
  public.worker_mark_operational_alerts_delivered(bigint[])
to service_role;

select cron.schedule(
  'maintain-social-state-every-minute',
  '* * * * *',
  $cron$
    select public.expire_due_connection_requests(1000);
    select public.reconcile_restricted_connection_requests(1000);
  $cron$
);

select cron.schedule(
  'collect-running-alerts-every-five-minutes',
  '*/5 * * * *',
  $cron$select count(*) from public.worker_collect_operational_alerts();$cron$
);

comment on table public.operational_alerts is
  'Server-only deduplicated operational alert outbox; contains no raw GPS coordinates.';
comment on function public.worker_collect_operational_alerts() is
  'Collects exhausted/stalled detection jobs and failed critical cron runs for webhook delivery.';

commit;
