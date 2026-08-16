import { requireUuid } from '../../lib/ids';
import { supabase } from '../../lib/supabase';

export type RoutePoint = { latitude: number; longitude: number };

export type RunRoute =
  /** 원본 좌표가 남아 있어 경로를 그릴 수 있는 상태. */
  | { status: 'ready'; points: RoutePoint[]; center: RoutePoint; zoom: number }
  /** 보관 기한이 지나 파기됐거나, 사용자가 위치 동의를 철회해 지워진 상태. */
  | { status: 'purged'; reason: 'retention' | 'consent_withdrawn' }
  /** 아직 좌표가 없거나 전부 품질 필터에서 제외된 상태. */
  | { status: 'empty' };

// 지도는 카드 안에서만 보여주므로 대략적인 크기를 상수로 둔다. 뷰포트를 실제로
// 재는 것보다 오차가 크지만, 초기 카메라 위치를 정하는 용도라 이 정도면 충분하다.
const MAP_WIDTH_PX = 340;
const MAP_HEIGHT_PX = 220;
const TILE_SIZE = 256;

// 1초에 한 점씩 쌓이면 한 시간 러닝이 3,600점이 된다. 화면 폭이 340pt인 지도에서
// 그만큼의 정점은 구분되지 않으므로, 그리기 전에 일정 간격으로 솎아낸다.
const MAX_RENDERED_POINTS = 600;

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

function mercatorY(latitude: number) {
  const clamped = Math.min(Math.max(latitude, -85.05112878), 85.05112878);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function thin(points: RoutePoint[]) {
  if (points.length <= MAX_RENDERED_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_RENDERED_POINTS);
  const thinned = points.filter((_, index) => index % stride === 0);
  // 마지막 점은 반드시 남긴다. 없으면 경로가 실제 종료 지점보다 앞에서 끊긴다.
  const last = points[points.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

/** 경로 전체가 들어오는 카메라 중심과 확대 수준을 구한다. */
export function frameRoute(points: RoutePoint[]) {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const east = Math.max(...longitudes);
  const west = Math.min(...longitudes);

  const center = { latitude: (north + south) / 2, longitude: (east + west) / 2 };

  const longitudeFraction = (east - west) / 360;
  const latitudeFraction = Math.abs(mercatorY(north) - mercatorY(south));
  const zoomFor = (fraction: number, pixels: number) =>
    fraction > 0 ? Math.log2(pixels / TILE_SIZE / fraction) : Infinity;

  const fitted = Math.min(
    zoomFor(longitudeFraction, MAP_WIDTH_PX),
    zoomFor(latitudeFraction, MAP_HEIGHT_PX),
  );
  // 정확히 맞추면 경로가 가장자리에 닿으므로 반 단계 물러선다. 한 점짜리
  // 기록처럼 범위가 0인 경우에는 동네가 보일 정도로 고정한다.
  const zoom = Number.isFinite(fitted) ? Math.min(Math.max(fitted - 0.5, 2), 18) : 16;
  return { center, zoom };
}

/**
 * 내 러닝 한 건의 원본 경로를 가져온다.
 *
 * `location_points`는 RLS로 본인과 service role만 접근하며, 이 함수는 오직 내
 * 기록 화면에서만 쓴다. 다른 사용자에게 보여지는 어떤 화면도 이 데이터를
 * 읽어서는 안 된다. 발견·프로필 질의에 끌어다 쓰면 제품의 전제가 깨진다.
 */
export async function fetchRunRoute(sessionId: string): Promise<RunRoute> {
  const id = requireUuid(sessionId, '러닝 기록');
  const client = requireClient();

  const session = await client
    .from('running_sessions')
    .select('raw_points_purged_at,raw_points_purge_reason')
    .eq('id', id)
    .maybeSingle();
  if (session.error) throw session.error;
  if (session.data?.raw_points_purged_at) {
    return {
      status: 'purged',
      reason: session.data.raw_points_purge_reason === 'consent_withdrawn'
        ? 'consent_withdrawn'
        : 'retention',
    };
  }

  // 품질 필터에서 제외된 점은 그리지 않는다. 튀는 좌표 하나가 경로를 수 km
  // 밖으로 끌고 가면 지도가 읽을 수 없게 된다.
  const { data, error } = await client
    .from('location_points')
    .select('latitude,longitude')
    .eq('session_id', id)
    .eq('is_outlier', false)
    .order('recorded_at', { ascending: true });
  if (error) throw error;

  const points = (data ?? []).map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  }));
  if (points.length < 2) return { status: 'empty' };

  const rendered = thin(points);
  return { status: 'ready', points: rendered, ...frameRoute(rendered) };
}
