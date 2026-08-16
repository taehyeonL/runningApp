/**
 * 사용자에게 보여줄 오류 문구를 뽑아낸다.
 *
 * `reason instanceof Error ? reason.message : String(reason)` 를 각자 쓰면 안 된다.
 * Supabase가 던지는 PostgrestError·AuthError는 Error 인스턴스가 아니라 평범한
 * 객체라서, 그 식은 항상 두 번째 갈래로 빠진다. 결과는 화면에 "[object Object]"
 * 가 뜨거나, 호출부가 적어둔 일반 문구로 덮여 실제 원인이 사라지는 것이다.
 * 실제로 온보딩 상태 조회가 실패했을 때 "온보딩 상태를 확인하지 못했습니다"만
 * 보이고 42501인지 네트워크 오류인지 알 수 없었다.
 */
export function errorMessage(error: unknown, fallback = '알 수 없는 오류가 발생했습니다.') {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message ?? '');
    if (message.trim()) return message;
  }
  return fallback;
}
