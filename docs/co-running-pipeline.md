# Co-running detection: 서버 작업 인터페이스 초안

이번 MVP에는 GPS 기반 판정 로직을 구현하지 않는다. 앱은 `running_sessions`와 원본 `location_points`를 기록하고, 서버는 완료 세션마다 `detection_jobs`에 한 건을 넣는다.

## 작업 계약

```ts
type DetectionJob = {
  sessionId: string;
  trigger: 'run_completed' | 'watch_sync_completed';
  requestedAt: string;
};

type CandidateSummary = {
  viewerId: string;
  candidateProfileId: string;
  similarityLabel: 'good_match' | 'quite_good_match' | 'new_rhythm';
  reasons: string[]; // 예: '평균 페이스가 비슷해요'
  repeatEncounters30d: number;
  requestEligible: boolean; // 무료 요청: 유효 반복 교차 5회 이상
  safeOverlapSummary?: string; // '동선 일부가 비슷했어요' 같은 추상 문구만
};
```

## worker 순서

1. 서버 전용 권한으로 session의 원본 포인트를 읽고 `accuracy > 30m`, 비정상 속도, 시간 역전 포인트를 제외한다. `accuracy <= 15m`를 우선한다.
2. 3km 이상 완료 세션만 후보 비교 대상으로 둔다.
3. 시간 겹침(최소 30~60초), 보정 궤적 간 평균 거리(초기 20~35m), 겹친 구간 길이, 방향 차이, 속도/페이스 차이를 함께 점수화한다.
4. 단순한 10m 순간 접근, 교차로의 짧은 교차, GPS 품질이 낮은 구간은 후보에서 제외한다.
5. 검증된 결과만 `encounter_candidates`에 upsert한다. `location_points`, 정확한 시각, 최소 거리, 원본 route/segment ID는 결과에 절대 저장하지 않는다.
6. 집·직장으로 추정되는 반복 출발/도착 인근은 판정 전 자동 마스킹하고, 보관기한이 지난 원본 포인트는 삭제한 뒤 비식별 요약만 보존한다.

`detection_jobs` 잠금·재시도·실패 처리는 Edge Function 또는 별도 worker가 service role로 수행한다. service role 키는 모바일 앱에 넣지 않는다.
