# Co-running detection worker

러닝 종료 시 `submit_running_session()`이 세션을 `processing`으로 바꾸고 `detection_jobs`에 내구성 있는 작업을 생성한다. 모바일 앱은 종료 직후 Edge Function을 깨우지만, HTTP 요청이 실패해도 작업은 DB에 남는다.

## 신뢰 경계

- 모바일이 보낸 거리·페이스·품질 요약은 신뢰하지 않는다.
- Edge Function만 service-role 클라이언트로 원본 `location_points`를 읽는다.
- 함수 호출은 Supabase secret key 또는 해당 `processing` 세션 소유자의 유효한 JWT만 허용한다.
- 원본 좌표·정확한 시각·최소 거리·세션 ID는 발견용 `encounter_candidates`에 저장하지 않는다.
- 내부 반복 교차 원장 `private.co_running_encounters`는 클라이언트 권한이 없으며 원본 좌표를 포함하지 않는다.

## 검증 기준

1. 세션 시간 밖, 시간 역전, 위치 정확도 누락 또는 30m 초과 포인트를 제외한다.
2. 보고 속도 또는 구간 추론 속도가 12m/s를 넘거나 포인트 간격이 120초를 넘는 구간을 제외한다.
3. 서버 재계산 거리가 3km 이상이고, 품질 포인트 10개 이상, 전체 품질 통과율 50% 이상이어야 매칭 가능하다.
4. 시작·종료 각각 200m를 경로 비교에서 마스킹한다.
5. 두 러닝은 포인트 시각 차이 8초 이하, 거리 35m 이하, 방향 차이 45도 이하, 페이스 차이 35% 이하여야 같은 구간 표본으로 본다.
6. 같은 조건이 30초·200m 이상 지속되고 confidence가 0.55 이상일 때만 유효 교차로 확정한다.

수치는 폐쇄 베타에서 false positive를 우선 줄이는 방향으로 조정해야 한다. 교차로의 순간 근접이나 반대 방향 러너는 후보가 되지 않는다.

## 상태와 재시도

- `queued/failed → processing → completed`
- claim은 PostgreSQL advisory lock과 `SKIP LOCKED`를 사용해 전역 한 작업씩 직렬 처리한다. 겹친 두 세션이 동시에 완료되어 서로를 놓치는 경쟁 조건을 피하기 위한 MVP 선택이다.
- 15분 이상 멈춘 `processing` 작업은 재점유할 수 있다.
- 실패 작업은 지수형 지연 후 최대 5회까지 재시도한다.
- Edge Function 한 번은 최대 3개의 대기 작업을 순차적으로 비운다.
- 성공 시 검증된 세션, 내부 교차 원장, 양방향 안전 후보, 프로필 러닝 통계, job 완료를 한 DB 트랜잭션으로 확정한다.

## 보관과 공개

- 검증 완료 시 원본 GPS 삭제 예정일을 최대 30일로 설정한다.
- worker가 호출될 때마다 만료된 포인트를 최대 10,000개씩 삭제한다.
- 사용자에게는 `잘 맞음/꽤 잘 맞음/새로운 리듬`, 안전한 이유 문구, 30일 반복 횟수만 제공한다.
- 정확한 거리 대신 `동선 일부가 비슷했어요`, `긴 구간에서 리듬이 비슷했어요`처럼 범주형 문구만 제공한다.

## 운영

배포 함수는 `detect-co-running`이다. Edge Functions에는 `SUPABASE_URL`과 secret key 환경변수가 기본 제공된다. 앱의 종료 호출 외에도 `detect-co-running-every-minute` Cron이 Vault의 `co_running_project_url`, `co_running_worker_key`를 읽어 1분마다 실패·대기 작업을 복구한다.

```json
{ "limit": 3 }
```

secret key는 앱, git, 일반 로그에 절대 기록하지 않는다.
