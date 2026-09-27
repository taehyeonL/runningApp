// 동의 레코드에 남는 정책 버전. 약관·개인정보·위치정보 문구가 바뀌면 올리고,
// has_current_consent()는 현재 동의 여부만 판정한다. 정식 약관 확정 시 기존
// 가입자의 버전별 재동의 정책/서버 rollout이 별도로 필요하다.
export const POLICY_VERSION = 'draft-2026-09-24';
