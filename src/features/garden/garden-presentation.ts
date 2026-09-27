// Presentation only. Growth and collection completion are computed by the server.
export function growthStage(progress: number) {
  const safe = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  return Math.min(4, Math.floor(safe / 25));
}
export const growthStageNames = ['심은 자리', '작은 싹', '줄기와 잎', '꽃봉오리', '성장 완료'];
export function growthIcon(stage: number, matureIcon: string) {
  return ['🟤', '🌱', '🌿', '🌷', matureIcon][Math.max(0, Math.min(4, Math.floor(stage)))] ?? '🟤';
}
