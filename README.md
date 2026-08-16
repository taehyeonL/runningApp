# 같이뛰어 MVP

실제로 달리는 사람을 안전하게 발견하고, **상호 수락 뒤에만** 함께 달리기와 대화를 시작하는 React Native + Supabase 앱의 초기 MVP입니다.

## 바로 실행하기

요구 환경: Node.js 22.13 이상, npm, Expo Go 또는 Android/iOS 시뮬레이터. 이 프로젝트는 Expo SDK 57 / React Native 0.86 기반입니다. Expo Go에서는 전경 GPS만 검증할 수 있고, 화면 잠금 중 백그라운드 기록은 development build가 필요합니다.

```bash
cd C:\locDev2\running-mate
npm install
copy .env.example .env
npm start
```

환경변수를 아직 채우지 않아도 UI 데모는 실행됩니다. QR 코드를 Expo Go로 열거나, 터미널에서 `a`(Android), `i`(iOS), `w`(웹)를 누르세요.

실제 백그라운드 러닝은 네이티브 권한과 foreground service 설정이 포함되어야 하므로 개발 빌드에서 확인합니다.

```bash
npx.cmd expo run:android
# macOS에서는 npx expo run:ios
```

Android 11 이상에서 백그라운드 위치를 선택하면 OS 설정 화면으로 이동할 수 있습니다. 앱은 그 전에 사용 목적을 안내하며, 허용하지 않으면 앱이 열린 동안만 기록합니다. 자세한 플랫폼 제약은 [Expo Location SDK 57 문서](https://docs.expo.dev/versions/v57.0.0/sdk/location/)를 따릅니다.

## Supabase 연결

1. Supabase 프로젝트를 만듭니다.
2. `.env.example`을 `.env`로 복사하고 Dashboard의 Project URL 및 publishable key를 채웁니다.
3. Supabase CLI를 연결한 뒤 migration을 적용합니다.

```bash
npx.cmd supabase login
npx.cmd supabase link --project-ref YOUR_PROJECT_REF
npx.cmd supabase db push
```

모바일 앱에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 둡니다. 레거시 `EXPO_PUBLIC_SUPABASE_ANON_KEY`도 호환하지만, **`SUPABASE_SERVICE_ROLE_KEY`는 절대로 앱·Expo public 환경변수·git에 넣지 마세요.** 원본 GPS 판정 worker와 운영 도구에서만 안전하게 사용합니다.

OAuth를 실제로 연결하려면 다음 설정이 필요합니다.

1. Supabase Dashboard의 Authentication → Providers에서 Apple / Kakao / Google을 활성화합니다.
2. 각 공급자 콘솔에는 Supabase가 안내하는 callback URL인 `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`을 등록합니다.
3. Supabase Authentication → URL Configuration의 Redirect URLs에는 앱 callback인 `runningmate://auth/callback`을 추가합니다. 웹도 사용할 경우 실제 웹의 `/auth/callback` URL을 별도로 추가합니다.
4. 앱은 PKCE authorization-code flow를 사용하며, 네이티브 세션은 Expo SecureStore에 암호화 저장합니다. OAuth custom scheme은 Expo Go에서 안정적으로 동작하지 않으므로 development build 또는 배포 빌드로 검증하세요.

## 현재 구현 범위

- Expo TypeScript 앱과 한국어, 밝고 차분한 러닝 UI
- Apple·카카오·Google 로그인 버튼 UI 및 Supabase OAuth 호출 구조 (키·provider 설정 전에는 데모 안내)
- 만 19세 이상, 이용약관, 개인정보, 개인위치정보 필수 동의가 포함된 온보딩
- 관계 의도, 러닝 스타일, 프로필 공개 범위 선택 UI
- 인증 후 `profiles`와 필수 `consent_records`를 저장하는 온보딩
- 실제 GPS 러닝 시작·일시정지·재개·종료, 거리·시간·평균 페이스와 품질 카운터
- development build 백그라운드 기록 및 Expo Go/웹 전경 기록 자동 폴백
- 네트워크 실패 GPS를 네이티브 SecureStore 암호화 큐에 보관하고 idempotent 재전송한 뒤 서버 검증 큐에 제출
- 소유자 RLS 범위의 실제 러닝 이력으로 홈 월간 거리·횟수·연속 일수와 완료 상세 표시
- 본인만 볼 수 있는 러닝 경로 지도 (iOS Apple Maps / Android Google Maps, 파기 후에는 사유 안내)
- 클릭 가능한 홈, 러닝 종료, 발견, 같이 뛰기 요청, 프로필/로그 공개 설정, 신고/차단 화면
- 앱 조정 계층, 인증·러닝·소셜 화면, 공용 UI·스타일·표시 포맷을 분리한 화면 구조
- `profiles`, `running_sessions`, `location_points`, `encounter_candidates`, `connection_requests`, `friendships`, `reports`, `moderation_actions`, `consent_records`를 포함한 SQL migration
- 원본 GPS를 다른 사용자에게 보이지 않게 하는 RLS, 상호 수락 friendship 이후에만 메시지를 허용하는 chat 테이블/RLS 초안
- 서버 재계산 3km/GPS 품질 검증, 시작·종료 마스킹, 시간·거리·방향·페이스 기반 co-running Edge Function
- 실제 발견 후보·안전 프로필 조회와 같이 뛰기 요청 전송·수락·거절·취소 UI/RPC 연동
- 요청 만료·예약 제재 Cron과 worker 재시도 소진·Cron·HTTP 실패 운영 alert outbox
- 실기기 러닝 진단 메타데이터와 OAuth provider 공개 설정 점검 스크립트

## 안전 설계 요약

- `location_points`는 본인과 service role 서버 처리만 접근합니다. 발견 UI에는 이 테이블을 절대 join하지 않습니다. 경로 지도(`src/ui/run-route-map.tsx`)는 이 규칙의 예외가 아니라 그 안입니다. 내 기록 화면에서만 열리며, 타인에게 보이는 어떤 화면에도 붙이지 않습니다.
- 발견 결과 `encounter_candidates`에는 “잘 맞음”, 반복 교차 횟수, 추상화된 근거만 저장합니다. 정확 좌표·시각·원본 경로·최단거리는 저장하거나 노출하지 않습니다.
- 무료 사용자는 서버가 판정한 최근 30일 유효 반복 교차 **3회 이상** 후보에게 요청할 수 있습니다. 기준값은 `public.repeat_encounter_threshold()` 한 곳에만 있고, `encounter_candidates.request_eligible`은 트리거가 그 값에서 파생시킵니다. `private.is_request_eligible()`과 `send_connection_request()`는 횟수를 다시 세지 않고 그 열만 읽습니다.
- 요청이 수락되면 `accept_connection_request()`가 friendship을 만들며, 이후에만 `messages` 읽기/쓰기가 허용됩니다.
- 차단은 즉시 상호 발견·요청을 막도록 `user_blocks`에 별도로 모델링했습니다. 신고와 제재는 운영 검토를 전제로 합니다.
- 요청은 `pending`에서 `accepted / declined / cancelled / expired`로만 한 번 전이하며, 모든 변경은 서버 전용 `connection_request_events`에 기록합니다.
- 앱은 내부 차단·제재 사유를 제외한 `connection_request_summaries` view로 요청 상태를 조회합니다.
- 운영 Cron은 `expire_due_connection_requests()`와 `reconcile_restricted_connection_requests()`를 매분 호출해 만료 요청과 예약 제재를 정리합니다.
- 모든 러닝 로그는 소유자가 저장·삭제·공개 범위를 변경할 수 있도록 설계했으며, 기본 공개 범위는 비공개입니다.
- 앱 거리 계산은 accuracy 30m 초과와 12m/s 초과 구간을 제외하지만 신뢰 경계는 서버입니다. 종료된 세션은 클라이언트가 직접 완료 처리하지 않고 `submit_running_session()`으로 `processing` 전환 후 worker 검증을 기다립니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| [제품 기획서](docs/product-spec.md) | 러닝 우선·위치 비공개·상호 동의 원칙과 전체 제품 요구사항 |
| [작업 목록](TO-DO.md) | 구현 완료 상태와 다음 우선순위 |
| [App.tsx](App.tsx) | 인증 세션·러닝 수명주기·화면 전환을 조정하는 앱 진입점 |
| [src/navigation/routes.ts](src/navigation/routes.ts) | 화면·하단 탭 타입과 앱 셸 표시 규칙 |
| [src/screens](src/screens) | 인증·온보딩, 실제 러닝, 발견·요청·프로필·신고 화면 |
| [src/ui/components.tsx](src/ui/components.tsx) | 앱 셸, 하단 탐색, 카드·버튼·선택 등 공용 UI |
| [src/ui/styles.ts](src/ui/styles.ts) | 화면 전반의 공용 React Native 스타일 |
| [src/utils/run-format.ts](src/utils/run-format.ts) | 거리·시간·페이스·기록 날짜·연속 러닝 표시 로직 |
| [src/lib/supabase.ts](src/lib/supabase.ts) | SecureStore 영속화·PKCE·foreground 토큰 갱신을 적용한 Supabase 클라이언트 |
| [src/lib/auth.ts](src/lib/auth.ts) | OAuth 브라우저 세션, callback 검증, PKCE 코드 교환, 로그아웃 |
| [src/lib/auth-storage.ts](src/lib/auth-storage.ts) | 긴 세션 값도 안전하게 교체하는 SecureStore 청크 저장소 |
| [src/features/running/run-recorder.ts](src/features/running/run-recorder.ts) | 위치 권한, GPS 수집·품질 필터, 업로드 재시도, 러닝 상태 머신과 종료 RPC |
| [src/hooks/use-run-recorder.ts](src/hooks/use-run-recorder.ts) | 실행 중 기록 복원과 UI용 실시간 거리·시간·페이스 상태 |
| [src/features/social/social-api.ts](src/features/social/social-api.ts) | 안전 후보·요청 조회와 요청 상태 머신 RPC 호출 |
| [src/hooks/use-social.ts](src/hooks/use-social.ts) | 발견 후보와 요청 목록·전이의 앱 상태 |
| [initial migration](supabase/migrations/202608120001_initial_mvp.sql) | 스키마, RLS, 공개 프로필 projection, 상호 수락 chat 규칙 |
| [RLS hardening migration](supabase/migrations/202608120002_rls_and_integrity_hardening.sql) | 서버 관리 열 보호, GPS 소유권 무결성, 후보 범위 공개 프로필, 요청 RPC, 차단·제재 강제 |
| [요청 상태 머신 migration](supabase/migrations/202608120003_block_moderation_request_state_machine.sql) | 단방향 상태 전이, 변경 감사 로그, 양방향 중복 방지, 차단·제재·만료 자동 취소 |
| [GPS 중복 방지 migration](supabase/migrations/202608120004_running_location_idempotency.sql) | 백그라운드 업로드 응답 유실 시 같은 시각 포인트의 안전한 재전송 보장 |
| [co-running worker migration](supabase/migrations/202608120005_co_running_worker_contract.sql) | 서버 전용 job claim·재시도·원자적 검증 완료·안전 후보·GPS 보관기한 계약 |
| [social projection migration](supabase/migrations/202608120009_social_profile_projection.sql) | 후보·요청·친구 관계에만 제한된 최소 프로필 projection |
| [운영 alert migration](supabase/migrations/202608120010_operational_alerts_and_request_maintenance.sql) | 요청 정리 Cron과 server-only 운영 alert outbox |
| [worker HTTP monitor migration](supabase/migrations/202608120011_monitor_worker_http_responses.sql) | pg_net worker 요청과 응답을 연결해 timeout·non-2xx 감지 |
| [co-running 설계](docs/co-running-pipeline.md) | GPS quality·시간·궤적·방향·속도를 함께 고려하는 worker 계약 |
| [co-running Edge Function](supabase/functions/detect-co-running/index.ts) | 원본 GPS 서버 검증, 지속 겹침 판정, DB worker RPC 조정 |
| [실기기 테스트](docs/real-device-run-test.md) | 화면 잠금·네트워크 단절·강제 종료를 포함한 60분 회귀 절차 |
| [OAuth 테스트](docs/oauth-real-account-test.md) | provider 활성화 자동 점검과 실계정 callback 검증 절차 |
| [운영 알림](docs/operations-alerting.md) | alert outbox, webhook 설정, 외부 uptime monitor 경계 |

## 다음 단계 TODO

1. 폐쇄 베타 실제 GPS로 co-running 임계값과 false positive를 검증하고, 필요하면 지도 도로 보정 단계를 추가합니다.
2. 운영 webhook endpoint를 정한 뒤 `OPERATIONS_ALERT_WEBHOOK_URL` secret을 설정하고 실제 장애 알림을 확인합니다.
3. 실제 기기 development build에서 준비된 60분 시나리오로 화면 잠금, 권한 거절·철회, 네트워크 단절·복귀, 앱 강제 종료 복구를 검증합니다.
4. 현재 비활성인 Apple·Kakao·Google provider의 client ID/secret과 redirect allow list를 설정하고 development build에서 실계정 로그인을 검증합니다.
5. 차단 우회 탐지, 운영자 신고 검토 화면, 계정 삭제/데이터 내보내기를 추가합니다.
6. 수락 후 실제 chat UI·푸시 알림과 이미지/링크/개인정보 요청 신고 진입점을 추가합니다.
7. Apple Watch 또는 Wear OS의 offline session sync를 `source`, `source_record_id`, `sync_metadata` 구조에 맞춰 구현합니다.

## 검증

```bash
npm run typecheck
npx.cmd expo start
npx.cmd supabase test db
```

`supabase test db`는 로컬 Supabase를 시작한 환경에서 [DB 회귀 테스트 모음](supabase/tests/database/)을 실행합니다. 연결한 개발 프로젝트에서도 migration을 적용한 뒤 일반 사용자 JWT의 RLS 테스트와 service role worker 테스트를 분리해 검증하세요. 실제 출시 전에는 국내 개인정보·위치정보 정책 및 약관을 전문 법률 검토 받아야 합니다.
