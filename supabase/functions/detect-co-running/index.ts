import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';

import {
  detectEncounter,
  type EncounterEvidence,
  type LocationPointRow,
  type SessionRow,
  validateRun,
} from './scoring.ts';

type DetectionRequest = {
  sessionId?: string;
  limit?: number;
};

type ClaimedJob = { job_id: string; session_id: string };

const SESSION_COLUMNS = 'id,user_id,status,started_at,ended_at,duration_seconds,distance_meters,average_pace_seconds';
const POINT_COLUMNS = 'recorded_at,latitude,longitude,accuracy_meters,speed_mps';
const POINT_PAGE_SIZE = 1000;
const MAX_POINT_PAGES = 20;
const MAX_CANDIDATE_SESSIONS = 30;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function secretKeys() {
  const keys = new Set<string>();
  const encoded = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as Record<string, unknown>;
      Object.values(parsed).forEach((value) => {
        if (typeof value === 'string' && value.length > 0) keys.add(value);
      });
    } catch {
      // A malformed platform secret should fail closed below.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.add(legacy);
  return keys;
}

function publishableKey() {
  const encoded = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof parsed.default === 'string') return parsed.default;
    } catch {
      // Fall through to legacy/local environment names.
    }
  }
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? null;
}

function adminKey() {
  return [...secretKeys()][0] ?? null;
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function authenticateSecret(request: Request) {
  const presented = request.headers.get('apikey') ?? '';
  return [...secretKeys()].some((key) => constantTimeEqual(presented, key));
}

async function authenticateUser(request: Request, supabaseUrl: string, sessionId?: string) {
  const authorization = request.headers.get('authorization');
  const key = publishableKey();
  if (!authorization?.startsWith('Bearer ') || !key || !sessionId) return false;
  const userClient = createClient(supabaseUrl, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(
    authorization.slice('Bearer '.length),
  );
  if (userError || !userData.user) return false;
  const { data, error } = await userClient
    .from('running_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userData.user.id)
    .eq('status', 'processing')
    .maybeSingle();
  return !error && Boolean(data);
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

async function loadPoints(client: SupabaseClient, sessionId: string) {
  const points: LocationPointRow[] = [];
  for (let page = 0; page < MAX_POINT_PAGES; page += 1) {
    const from = page * POINT_PAGE_SIZE;
    const { data, error } = await client
      .from('location_points')
      .select(POINT_COLUMNS)
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true })
      .range(from, from + POINT_PAGE_SIZE - 1);
    if (error) throw error;
    points.push(...(data as LocationPointRow[]));
    if ((data?.length ?? 0) < POINT_PAGE_SIZE) return points;
  }
  throw new Error(`Point limit exceeded for session ${sessionId}`);
}

async function candidateSessions(client: SupabaseClient, session: SessionRow) {
  const { data, error } = await client
    .from('running_sessions')
    .select(SESSION_COLUMNS)
    .eq('status', 'completed')
    .eq('is_match_eligible', true)
    .neq('user_id', session.user_id)
    .lt('started_at', session.ended_at!)
    .gt('ended_at', session.started_at)
    .order('started_at', { ascending: false })
    .limit(MAX_CANDIDATE_SESSIONS);
  if (error) throw error;
  return data as SessionRow[];
}

async function processJob(client: SupabaseClient, job: ClaimedJob) {
  const { data, error } = await client
    .from('running_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', job.session_id)
    .single();
  if (error) throw error;
  const session = data as SessionRow;
  if (session.status !== 'processing' || !session.ended_at) {
    throw new Error('Claimed session is not ready for validation');
  }

  const points = await loadPoints(client, session.id);
  const validated = validateRun(session, points);
  const encounters: EncounterEvidence[] = [];
  if (validated.valid) {
    for (const otherSession of await candidateSessions(client, session)) {
      const otherPoints = await loadPoints(client, otherSession.id);
      const otherValidated = validateRun(otherSession, otherPoints);
      const encounter = detectEncounter(validated, otherValidated, otherSession.id);
      if (encounter) encounters.push(encounter);
    }
  }

  const { data: finalized, error: finalizeError } = await client.rpc(
    'worker_finalize_detection_job',
    {
      p_job_id: job.job_id,
      p_valid: validated.valid,
      p_distance_meters: validated.distanceMeters,
      p_duration_seconds: validated.durationSeconds,
      p_moving_seconds: validated.movingSeconds,
      p_average_pace_seconds: validated.averagePaceSeconds,
      p_gps_quality_summary: {
        total_points: validated.totalPoints,
        accepted_points: validated.acceptedPoints,
        rejected_points: validated.rejectedPoints,
        average_accuracy_meters: validated.averageAccuracyMeters,
        preferred_accuracy_points: validated.preferredAccuracyPoints,
        endpoint_mask_meters: 200,
        rejection_reasons: validated.rejectionReasons,
      },
      p_encounters: encounters,
    },
  );
  if (finalizeError) throw finalizeError;
  if (!finalized) throw new Error('Detection job lost its processing lease');

  return {
    sessionId: session.id,
    valid: validated.valid,
    distanceMeters: validated.distanceMeters,
    acceptedPoints: validated.acceptedPoints,
    rejectedPoints: validated.rejectedPoints,
    encounterCount: encounters.length,
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secret = adminKey();
  if (!supabaseUrl || !secret) return json({ error: 'Worker environment is incomplete' }, 500);
  let body: DetectionRequest;
  try {
    body = await request.json() as DetectionRequest;
  } catch {
    body = {};
  }
  if (body.sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sessionId)) {
    return json({ error: 'sessionId must be a UUID' }, 400);
  }
  const serviceRequest = authenticateSecret(request);
  if (!serviceRequest && !await authenticateUser(request, supabaseUrl, body.sessionId)) {
    return json({ error: 'A secret key or the session owner JWT is required' }, 401);
  }
  const client = createClient(supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const results: unknown[] = [];
  let claimed = 0;
  const limit = Math.max(1, Math.min(Number.isInteger(body.limit) ? body.limit! : 3, 3));
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await client.rpc('worker_claim_detection_jobs', {
      p_limit: 1,
      p_session_id: index === 0 ? body.sessionId ?? null : null,
    });
    if (error) return json({ error: error.message }, 500);
    const job = (data as ClaimedJob[] | null)?.[0];
    if (!job) break;
    claimed += 1;
    try {
      results.push(await processJob(client, job));
    } catch (workerError) {
      const failure = message(workerError);
      await client.rpc('worker_fail_detection_job', {
        p_job_id: job.job_id,
        p_error_message: failure,
      });
      results.push({ sessionId: job.session_id, error: failure });
    }
  }

  const purge = await client.rpc('worker_purge_expired_location_points', { p_limit: 10000 });
  const [expiredRequests, reconciledRequests, alertResult] = await Promise.all([
    client.rpc('expire_due_connection_requests', { batch_size: 1000 }),
    client.rpc('reconcile_restricted_connection_requests', { batch_size: 1000 }),
    client.rpc('worker_collect_operational_alerts'),
  ]);
  const webhookUrl = Deno.env.get('OPERATIONS_ALERT_WEBHOOK_URL');
  const alerts = Array.isArray(alertResult.data) ? alertResult.data : [];
  let deliveredAlerts = 0;
  let alertDeliveryError: string | null = null;
  if (webhookUrl && alerts.length > 0) {
    try {
      const alertResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'running-mate', alerts }),
      });
      if (!alertResponse.ok) throw new Error(`Alert webhook returned HTTP ${alertResponse.status}`);
      const alertIds = alerts
        .map((alert) => typeof alert === 'object' && alert !== null && 'id' in alert ? alert.id : null)
        .filter((id): id is number => typeof id === 'number');
      if (alertIds.length > 0) {
        const marked = await client.rpc('worker_mark_operational_alerts_delivered', {
          p_alert_ids: alertIds,
        });
        deliveredAlerts = Number(marked.data ?? 0);
      }
    } catch (alertError) {
      alertDeliveryError = message(alertError);
    }
  }
  if (!serviceRequest) {
    return json({
      accepted: true,
      sessionId: body.sessionId,
      result: results.find((result) =>
        typeof result === 'object' && result !== null && 'sessionId' in result
        && result.sessionId === body.sessionId) ?? 'queued',
    });
  }
  return json({
    claimed,
    results,
    purgedPoints: purge.data ?? 0,
    expiredRequests: expiredRequests.data ?? 0,
    reconciledRequests: reconciledRequests.data ?? 0,
    pendingAlerts: alerts.length,
    deliveredAlerts,
    alertDeliveryError,
    maintenanceErrors: [purge.error, expiredRequests.error, reconciledRequests.error, alertResult.error]
      .filter(Boolean)
      .map((error) => error?.message),
  });
});
