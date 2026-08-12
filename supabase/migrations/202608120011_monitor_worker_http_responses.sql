begin;

alter table public.operational_alerts
  drop constraint operational_alerts_category_check;
alter table public.operational_alerts
  add constraint operational_alerts_category_check check (
    category in (
      'detection_job_exhausted',
      'detection_job_stalled',
      'cron_failed',
      'worker_http_failed'
    )
  );

create table public.worker_http_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);
alter table public.worker_http_requests enable row level security;
revoke all privileges on table public.worker_http_requests from public, anon, authenticated;
grant select, insert, delete on table public.worker_http_requests to service_role;

create or replace function public.worker_collect_http_response_alerts()
returns integer
language plpgsql
security definer
set search_path = public, net
as $$
declare
  affected integer;
begin
  insert into public.operational_alerts (
    fingerprint, category, severity, message, details, first_detected_at, last_detected_at
  )
  select 'worker_http_failed:' || request_log.request_id,
         'worker_http_failed', 'critical',
         'The scheduled co-running Edge Function request failed.',
         jsonb_build_object(
           'request_id', request_log.request_id,
           'status_code', response.status_code,
           'timed_out', coalesce(response.timed_out, false),
           'error', left(coalesce(response.error_msg, 'No HTTP response was recorded'), 500)
         ),
         request_log.requested_at,
         coalesce(response.created, request_log.requested_at)
    from public.worker_http_requests request_log
    left join net._http_response response on response.id = request_log.request_id
   where request_log.requested_at between now() - interval '15 minutes' and now() - interval '1 minute'
     and (
       response.id is null
       or response.timed_out
       or response.error_msg is not null
       or response.status_code not between 200 and 299
     )
  on conflict (fingerprint) do update
    set last_detected_at = excluded.last_detected_at,
        details = excluded.details;
  get diagnostics affected = row_count;

  delete from public.worker_http_requests
   where requested_at < now() - interval '24 hours';
  return affected;
end;
$$;

revoke execute on function public.worker_collect_http_response_alerts()
  from public, anon, authenticated;
grant execute on function public.worker_collect_http_response_alerts()
  to service_role;

select cron.unschedule('detect-co-running-every-minute');
select cron.schedule(
  'detect-co-running-every-minute',
  '* * * * *',
  $cron$
    insert into public.worker_http_requests (request_id)
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'co_running_project_url'
      ) || '/functions/v1/detect-co-running',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'co_running_worker_key'
        )
      ),
      body := '{"limit":3}'::jsonb,
      timeout_milliseconds := 10000
    );
  $cron$
);

select cron.unschedule('collect-running-alerts-every-five-minutes');
select cron.schedule(
  'collect-running-alerts-every-five-minutes',
  '*/5 * * * *',
  $cron$
    select public.worker_collect_http_response_alerts();
    select count(*) from public.worker_collect_operational_alerts();
  $cron$
);

comment on table public.worker_http_requests is
  'Server-only correlation between scheduled worker requests and pg_net responses.';
comment on function public.worker_collect_http_response_alerts() is
  'Records missing, timed-out, errored, and non-2xx co-running worker HTTP responses.';

commit;
