# 실제 기기 러닝 회귀 테스트

Expo Go가 아니라 Android/iOS development build에서 수행합니다. 원본 좌표나 화면 캡처는 이슈 트래커에 첨부하지 않습니다.

## 준비

1. 실제 OAuth 계정으로 로그인하고 온보딩 필수 동의를 완료합니다.
2. `npx.cmd expo run:android` 또는 macOS의 `npx expo run:ios`로 development build를 설치합니다.
3. 배터리 최적화 예외는 제품 기본 요구사항으로 강제하지 않습니다. OS 기본 상태와 예외 허용 상태를 각각 기록합니다.

## 60분 시나리오

1. 백그라운드 기록을 선택해 러닝을 시작하고 GPS 품질 포인트가 증가하는지 확인합니다.
2. 화면을 20분 이상 잠근 뒤 다시 열어 거리·시간·수집 포인트가 이어졌는지 확인합니다.
3. 일시정지 후 3분 이동하고 재개하여 일시정지 구간이 거리에 포함되지 않는지 확인합니다.
4. 네트워크를 5분 끊었다가 복구하여 `동기화 대기`가 증가한 뒤 0으로 복구되는지 확인합니다.
5. 앱을 강제 종료한 뒤 다시 열어 진행 중 러닝 복원과 백그라운드 수집 재개를 확인합니다.
6. 3km 이상에서 종료하고 `processing → completed` 전환 및 발견 후보 계산을 확인합니다.

## 판정 기준

- 위치 권한 거절·철회는 앱 종료가 아니라 이해 가능한 안내로 끝나야 합니다.
- 화면 잠금/복원 뒤 중복 세션이나 중복 GPS 포인트가 없어야 합니다.
- 정확도 30m 초과와 12m/s 초과 구간은 클라이언트 거리에서 제외되어야 합니다.
- 네트워크 복구 뒤 암호화 대기 큐가 모두 업로드되어야 종료할 수 있습니다.
- `running_sessions.sync_metadata.diagnostics`의 `backgroundTransitions`, `restoreCount`, `syncFailureCount`, `maxPendingPoints`로 재현 경로를 확인합니다.
- 서버가 재계산한 거리 3km 미만 또는 품질 미달 기록은 `is_match_eligible=false`여야 합니다.

## 안전한 진단 조회

Dashboard SQL Editor에서 테스트 계정 소유 세션 ID만 지정합니다. `location_points`의 좌표 열은 조회하거나 내보내지 않습니다.

```sql
select id, status, duration_seconds, distance_meters, is_match_eligible,
       gps_quality_summary, sync_metadata, created_at
  from public.running_sessions
 where id = 'TEST_SESSION_UUID';
```
