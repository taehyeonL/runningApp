-- Serialize claims across Edge Function instances. This prevents two
-- overlapping processing sessions from both being finalized before either is
-- available as a validated comparison candidate.
create or replace function public.worker_claim_detection_jobs(
  p_limit integer default 1,
  p_session_id uuid default null
)
returns table(job_id uuid, session_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  selected_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('running-mate-co-running-worker', 0));

  if exists (
    select 1 from public.detection_jobs
     where status = 'processing'
       and locked_at >= now() - interval '15 minutes'
  ) then
    return;
  end if;

  select j.id into selected_id
    from public.detection_jobs j
    join public.running_sessions s on s.id = j.session_id
   where (p_session_id is null or j.session_id = p_session_id)
     and (
       (j.status in ('queued', 'failed') and j.available_at <= now())
       or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
     )
     and j.attempts < 5
     and s.status = 'processing'
   order by j.available_at, j.created_at
   for update of j skip locked
   limit greatest(1, least(coalesce(p_limit, 1), 1));

  if selected_id is null then return; end if;

  return query
    update public.detection_jobs j
       set status = 'processing', attempts = j.attempts + 1,
           locked_at = now(), error_message = null
     where j.id = selected_id
    returning j.id, j.session_id;
end;
$$;

revoke execute on function public.worker_claim_detection_jobs(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.worker_claim_detection_jobs(integer, uuid)
  to service_role;

alter function public.set_updated_at() set search_path = public;

comment on function public.worker_claim_detection_jobs(integer, uuid) is
  'Claims at most one detection job globally so overlapping sessions cannot miss each other through concurrent finalization.';
