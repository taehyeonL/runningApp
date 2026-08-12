// Interface-only Edge Function. Do not add detection math here until it has
// false-positive, privacy, retention and abuse-review criteria approved.
type DetectionRequest = {
  sessionId: string;
  trigger: 'run_completed' | 'watch_sync_completed';
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = (await request.json()) as Partial<DetectionRequest>;
  if (!body.sessionId || (body.trigger !== 'run_completed' && body.trigger !== 'watch_sync_completed')) {
    return Response.json({ error: 'sessionId and a valid trigger are required' }, { status: 400 });
  }

  // TODO(server only): authenticate the caller, claim detection_jobs row,
  // load raw points with service_role, run quality/trajectory scoring, then
  // upsert ONLY safe CandidateSummary data into encounter_candidates.
  return Response.json({ accepted: true, sessionId: body.sessionId, status: 'queued' }, { status: 202 });
});
