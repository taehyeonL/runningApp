-- A background task can be killed after PostgreSQL accepts a batch but before
-- the encrypted device queue is cleared. Make retries idempotent.
delete from public.location_points duplicate
using public.location_points original
where duplicate.session_id = original.session_id
  and duplicate.recorded_at = original.recorded_at
  and duplicate.id > original.id;

alter table public.location_points
  add constraint location_points_session_recorded_at_key
  unique (session_id, recorded_at);

comment on constraint location_points_session_recorded_at_key on public.location_points is
  'Makes encrypted offline/background GPS upload retries idempotent.';
