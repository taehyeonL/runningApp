create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'detect-co-running-every-minute',
  '* * * * *',
  $cron$
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
    ) as request_id;
  $cron$
);

comment on extension pg_cron is
  'Runs the durable co-running queue recovery worker every minute.';
