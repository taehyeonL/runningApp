// Render only evidence fields intended for review. User text must not execute
// terminal control sequences; unknown payloads are not dumped wholesale.
function text(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    : '';
}
function tags(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : '';
}
const conversation = { any: '상관없음', chatty: '이야기하며 달리기', quiet: '러닝 집중' };
const distance = { any: '유연하게 맞춤', short: '3km 안팎', '5k': '5km 정도', '10k': '10km 정도' };
export function renderEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return '  (없음)';
  return evidence.map(item => {
    if (!item || typeof item !== 'object') return '  (알 수 없는 증거 형식)';
    if (item.kind === 'message') return `  [메시지] ${text(item.sent_at)}\n    ${text(item.body)}`;
    if (item.kind !== 'profile') return '  (지원하지 않는 증거 형식)';
    if (item.snapshot_status === 'unavailable') return '  [프로필] 접수 당시 조회 불가 — 현재 본문 미수집. 이전 신고 증거와 신고자 설명을 별도로 확인하세요.';
    return [
      `  [프로필] 닉네임 ${text(item.nickname)}`,
      `    러닝 스타일: ${tags(item.running_style_tags) || '미설정'}`,
      `    관계 의도: ${tags(item.relationship_intents) || '미설정'}`,
      `    소개: ${Object.hasOwn(item, 'bio') ? text(item.bio) || '(비어 있음)' : '(구버전 증거: 수집하지 않음)'}`,
      `    대화 스타일: ${Object.hasOwn(conversation, item.conversation_preference) ? conversation[item.conversation_preference] : '미수집'}`,
      `    편한 거리: ${Object.hasOwn(distance, item.preferred_distance) ? distance[item.preferred_distance] : '미수집'}`,
      `    서버 수집 시각: ${text(item.captured_at) || '미수집'}`,
    ].join('\n');
  }).join('\n');
}
