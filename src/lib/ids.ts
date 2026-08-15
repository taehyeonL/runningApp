const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 값을 PostgREST/Realtime 필터 문자열에 넣기 전에 형식을 확인한다.
 *
 * 두 API 모두 필터를 문자열로 받으므로, 값에 콤마·괄호·점이 섞이면 의도한
 * 조건이 아니라 다른 조건으로 해석될 수 있다. RLS가 결과 범위를 막아 주긴
 * 하지만, 접근 제어 한 겹에만 기대는 대신 질의 자체가 변형되지 않게 한다.
 */
export function requireUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new Error(`${label}이(가) 올바른 식별자가 아닙니다.`);
  }
  return value;
}
