# 같이뛰어 MVP

실제로 달리는 사람을 안전하게 발견하고, **상호 수락 뒤에만** 함께 달리기와 대화를 시작하는 React Native + Supabase 앱의 초기 MVP입니다.

## 바로 실행하기

요구 환경: Node.js 22.13 이상, npm, Expo Go 또는 Android/iOS 시뮬레이터. 이 프로젝트는 Expo SDK 57 / React Native 0.86 기반입니다.

```bash
cd C:\locDev2\running-mate
npm install
copy .env.example .env
npm start
```

환경변수를 아직 채우지 않아도 UI 데모는 실행됩니다. QR 코드를 Expo Go로 열거나, 터미널에서 `a`(Android), `i`(iOS), `w`(웹)를 누르세요.

## Supabase 연결

1. Supabase 프로젝트를 만듭니다.
2. `.env.example`을 `.env`로 복사하고 Dashboard의 Project URL 및 anon/publishable key를 채웁니다.
3. Supabase CLI를 연결한 뒤 migration을 적용합니다.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

모바일 앱에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`만 둡니다. **`SUPABASE_SERVICE_ROLE_KEY`는 절대로 앱·Expo public 환경변수·git에 넣지 마세요.** 원본 GPS 판정 worker와 운영 도구에서만 안전하게 사용합니다.

OAuth를 실제로 연결하려면 Supabase Dashboard에서 Apple / Kakao / Google provider를 활성화하고, 각 공급자 콘솔에 `runningmate://auth/callback` redirect URL과 client secret을 서버 설정으로 등록해야 합니다. 현재 [src/lib/auth.ts](src/lib/auth.ts)는 로그인 호출 구조와 TODO만 제공합니다.

## 현재 구현 범위

- Expo TypeScript 앱과 한국어, 밝고 차분한 러닝 UI
- Apple·카카오·Google 로그인 버튼 UI 및 Supabase OAuth 호출 구조 (키·provider 설정 전에는 데모 안내)
- 만 19세 이상, 이용약관, 개인정보, 개인위치정보 필수 동의가 포함된 온보딩
- 관계 의도, 러닝 스타일, 프로필 공개 범위 선택 UI
- 클릭 가능한 홈, 러닝 기록, 러닝 종료, 발견, 같이 뛰기 요청, 프로필/로그 공개 설정, 신고/차단 화면
- `profiles`, `running_sessions`, `location_points`, `encounter_candidates`, `connection_requests`, `friendships`, `reports`, `moderation_actions`, `consent_records`를 포함한 SQL migration
- 원본 GPS를 다른 사용자에게 보이지 않게 하는 RLS, 상호 수락 friendship 이후에만 메시지를 허용하는 chat 테이블/RLS 초안
- co-running을 실제 계산하지 않는 서버 작업 큐 계약 및 Edge Function stub

## 안전 설계 요약

- `location_points`는 본인과 service role 서버 처리만 접근합니다. 발견 UI에는 이 테이블을 절대 join하지 않습니다.
- 발견 결과 `encounter_candidates`에는 “잘 맞음”, 반복 교차 횟수, 추상화된 근거만 저장합니다. 정확 좌표·시각·원본 경로·최단거리는 저장하거나 노출하지 않습니다.
- 무료 사용자는 서버가 판정한 최근 30일 유효 반복 교차 **5회 이상** 후보에게 요청할 수 있습니다. 이 규칙은 `is_request_eligible()` RLS 검사에 반영했습니다.
- 요청이 수락되면 `accept_connection_request()`가 friendship을 만들며, 이후에만 `messages` 읽기/쓰기가 허용됩니다.
- 차단은 즉시 상호 발견·요청을 막도록 `user_blocks`에 별도로 모델링했습니다. 신고와 제재는 운영 검토를 전제로 합니다.
- 모든 러닝 로그는 소유자가 저장·삭제·공개 범위를 변경할 수 있도록 설계했으며, 기본 공개 범위는 비공개입니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| [App.tsx](App.tsx) | 외부 네비게이션 의존성 없이 화면 상태 전환으로 동작하는 UI 프로토타입 |
| [src/lib/supabase.ts](src/lib/supabase.ts) | 공개 환경변수 기반 Supabase 클라이언트 |
| [src/lib/auth.ts](src/lib/auth.ts) | OAuth 진입 구조 및 실제 연결 TODO |
| [initial migration](supabase/migrations/202608120001_initial_mvp.sql) | 스키마, RLS, 공개 프로필 projection, 상호 수락 chat 규칙 |
| [co-running 설계](docs/co-running-pipeline.md) | GPS quality·시간·궤적·방향·속도를 함께 고려하는 worker 계약 |
| [Edge Function stub](supabase/functions/detect-co-running/index.ts) | 아직 판정하지 않고 작업 접수만 표현한 서버 인터페이스 |

## 다음 단계 TODO

1. `expo-location`과 백그라운드 권한 안내를 추가해 실제 러닝 세션·GPS 업로드를 구현합니다. 권한은 러닝 시작 직전에 목적·보관·철회 방법을 다시 고지합니다.
2. Expo SecureStore 기반 세션 저장, OAuth deep-link 콜백, Apple·Kakao·Google 실 provider 설정을 완료합니다.
3. Supabase Edge Function/worker에서 포인트 품질 필터, 지도 매칭, 궤적 비교, 자동 마스킹, 보관기한 삭제를 구현하고 false positive 검증을 진행합니다.
4. 요청 일일 한도·쿨다운·차단 우회 탐지, 운영자 신고 검토 화면, 계정 삭제/데이터 내보내기를 추가합니다.
5. 실제 chat UI·알림과 함께, 이미지/링크/개인정보 요청 신고 진입점을 추가합니다.
6. Apple Watch 또는 Wear OS의 offline session sync를 `source`, `source_record_id`, `sync_metadata` 구조에 맞춰 구현합니다.

## 검증

```bash
npx tsc --noEmit
npx expo start
```

SQL은 연결한 Supabase 개발 프로젝트에서 migration으로 적용한 뒤, 일반 사용자 JWT로 RLS 테스트와 service role worker 테스트를 분리해 검증하세요. 실제 출시 전에는 국내 개인정보·위치정보 정책 및 약관을 전문 법률 검토 받아야 합니다.
