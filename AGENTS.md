# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

기억에 남은 Expo API는 대부분 낡았습니다. SDK 57 / React Native 0.86 / React 19.2 / TypeScript 6.0 기준이며,
`expo-notifications`처럼 Expo Go에서 동작이 달라진 모듈이 있습니다.

# Product context

Before planning or changing product behavior, read `docs/product-spec.md` and `TO-DO.md` completely.
Keep the product safety rules, privacy boundaries, and completion status in those files synchronized with implementation changes.

# 절대 규칙

기획서에서 파생된 것이 아니라, 이 규칙이 깨지면 제품이 존재할 이유가 없습니다. 새 코드가 이 중 하나라도
우회할 수 있으면 그 코드는 틀린 것입니다.

- 원본 GPS, 정확한 시각, 원본 경로는 사용자 간에 절대 노출하지 않는다. `location_points`는 본인과
  service role만 접근하며, 발견·프로필 어떤 질의에도 join하지 않는다.
- 매칭과 채팅은 상호 수락을 우회할 수 없다. 조회·쓰기·**알림**까지 모두 같은 판정을 따른다.
  차단·제재는 읽기만 막는 것으로 충분하지 않다.
- 무료 사용자의 로그 저장·삭제·공개 범위 변경과 안전 기능(신고·차단·안전 가이드)은 제한하지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`는 앱, `EXPO_PUBLIC_*`, 브라우저, git 어디에도 넣지 않는다.
  Edge Function·운영 스크립트·CI에서만 쓴다.

# 코드 위치

| 영역 | 위치 |
| --- | --- |
| 앱 진입점·화면 전환 | `App.tsx`, `src/navigation/routes.ts` |
| 화면 | `src/screens/*.tsx` (auth / running / social / chat / account) |
| 도메인 API·상태 | `src/features/<domain>/*.ts`, `src/hooks/use-*.ts` |
| Supabase 클라이언트·세션 | `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/auth-storage.ts` |
| 공용 UI·스타일 | `src/ui/components.tsx`, `src/ui/styles.ts` |
| 스키마·RLS·RPC | `supabase/migrations/*.sql` (append-only) |
| DB 회귀 테스트 | `supabase/tests/database/*.test.sql` (pgTAP) |
| 서버 전용 판정 | `supabase/functions/detect-co-running/index.ts` |
| 운영 도구 | `scripts/operator-console.mjs` |
| 공용 유틸 | `src/lib/errors.ts`(오류 문구), `src/lib/ids.ts`(UUID 검증) |

권한 판정 로직은 `private` 스키마 함수에 한 번만 두고 나머지는 그것을 호출합니다
(`private.pair_contact_allowed`, `private.can_pair_message`, `private.consent_granted` 등).
새 규칙을 뷰나 RPC에 직접 인라인하지 마세요.

같은 원칙이 상수에도 적용됩니다. 요청 자격 기준은 `public.repeat_encounter_threshold()`
한 곳에만 있고, `encounter_candidates.request_eligible`은 트리거가 거기서 파생시킵니다.
판정 지점들은 횟수를 다시 세지 않고 그 열만 읽습니다.

# 오류 처리

Supabase가 던지는 `PostgrestError`·`AuthError`는 **`Error` 인스턴스가 아니라 평범한 객체**입니다.
`reason instanceof Error ? reason.message : String(reason)` 를 직접 쓰지 말고
`errorMessage(reason, '기본 문구')` 를 호출하세요. 앞의 식은 항상 두 번째 갈래로 빠져
화면에 `[object Object]` 를 띄우거나 진짜 원인을 일반 문구로 덮어씁니다.
실제로 `use-social.ts`가 서버 메시지를 매칭해 요청 거절 사유를 안내하고 있었는데,
`[object Object]`와 비교하고 있어서 **그 분기들이 한 번도 실행되지 않았습니다.**

# 검증

```bash
npm run typecheck
npx supabase test db          # 로컬 스택이 떠 있어야 함 (supabase start)
```

`supabase test db`의 출력은 신뢰해서 읽어야 합니다. 파일이 중간에 에러로 죽어도
`All N subtests passed`가 함께 찍히므로, **`Dubious` / `Failed` 줄이 있는지 반드시 확인**하세요.
실제로 이 착시 때문에 러닝 시작이 전부 실패하는 결함(INSERT grant 누락)이 한동안 통과로 보였습니다.

# 마이그레이션 규칙

- 파일은 추가만 합니다. 기존 마이그레이션을 고치지 않고 새 파일에서 `drop`/`create or replace` 합니다.
- 파일 맨 위에 **무엇을 왜 바꾸는지**를 한 문단으로 적습니다. 기존 파일들의 형식을 따르세요.
- `drop index`/`drop function`은 스키마를 명시합니다. `private`의 객체를 수식어 없이 지우면
  `public`에서 찾다가 조용히 실패하고, 다음 `create`에서 충돌합니다.
- 새 테이블·뷰는 `revoke all` 후 필요한 컬럼만 `grant` 합니다. RLS 정책만 쓰고 grant를 빠뜨리면
  정책이 통과해도 42501이 납니다. 반대로 grant만 넓게 주면 RLS 밖 컬럼이 새어 나갑니다.
- 스키마를 바꾸면 같은 커밋에서 pgTAP을 함께 고칩니다.

# 반복해서 나온 결함 패턴

이 저장소에서 발견된 심각한 결함은 거의 전부 같은 모양이었습니다.
**하나의 결정이 두 곳에 적혀 있고 한 곳만 고쳐진 상태.** 제재 알림 뷰 2개, 차단 검사 2벌,
동의 조회 4벌, 죽은 가시성 함수 3개, 반복 교차 임계값 3벌, 오류 문구 추출 22벌이 그랬습니다.

- 같은 판단을 두 번째로 쓰게 되면, 복사하지 말고 기존 정의를 호출하세요.
- 테스트는 **성질**을 고정하세요. `my_moderation_notices`가 안전하다는 테스트는 통과했지만
  앱이 실제로 읽는 `user_moderation_notices`는 새고 있었습니다.
  "앱이 읽는 모든 표면에서 자동 보류가 보이지 않는다"로 썼다면 잡혔을 결함입니다.
- 고치기 전에 결함을 **재현**하세요. 이 저장소의 수정 대부분은 "그리드 셀 7개가 생성됨",
  "푸시 1건이 큐에 쌓임", "100회 중 42회 오답" 같은 측정에서 출발했습니다.

# 네이티브 모듈

네이티브 뷰나 네이티브 권한이 필요한 모듈은 **최상위에서 import하지 않습니다.**
Expo Go와 웹에서는 불러오는 것만으로 예외가 나서, "이 환경에서 쓸 수 있는가" 판정이
실행되기도 전에 앱 전체가 죽습니다. `expo-notifications`(`src/features/chat/push.ts`)와
`expo-maps`(`src/ui/run-route-map.tsx`)가 같은 이유로 동적 import를 씁니다.

- 지도는 iOS(Apple Maps)에서 추가 설정 없이 동작하지만 **Android는 Google Maps API 키**가
  `app.json`의 `android.config.googleMaps.apiKey`에 있어야 합니다. 키가 없으면 빈 회색
  사각형만 나오므로, 렌더링 대신 이유를 보여줍니다.
- **경로 지도는 본인 전용입니다.** `location_points`는 본인과 service role만 접근하며,
  이 컴포넌트는 이미 소유자인 기록 화면에서만 엽니다. 발견·프로필·상대 기록 등
  타인에게 보이는 화면에 가져다 쓰면 제품의 전제가 깨집니다.

# 서버 환경

두 벌입니다. **하나의 `supabase/.env`가 둘 다 먹입니다.**

| | 주소 | 쓰는 곳 |
| --- | --- | --- |
| 로컬 스택 | `http://127.0.0.1:54321` | 시뮬레이터·에뮬레이터, `supabase test db` |
| 호스티드(dev) | `https://<ref>.supabase.co` | 실기기 |

- 실기기는 로컬 스택에 닿을 수 없습니다. 기기에서 `127.0.0.1`은 기기 자신이고, Mac의 LAN IP를
  쓰면 Supabase가 Google에 넘기는 `redirect_uri`가 사설 IP가 되어 Google이 거부합니다.
- 그래서 **OAuth 클라이언트 하나에 콜백 두 개**를 등록합니다
  (`https://<ref>.supabase.co/auth/v1/callback`, `http://127.0.0.1:54321/auth/v1/callback`).
  `config.toml`이 `env()`로 값을 하나만 받으므로 환경별로 다른 클라이언트를 쓸 수 없습니다.
  운영에 들어가면 그때 분리합니다.
- `supabase config push`는 **로컬에 적지 않은 값을 CLI 기본값으로 간주해 원격에 씁니다.**
  Google provider만 올렸는데 원격의 이메일 확인이 꺼지고 OTP 길이가 8에서 6으로 내려간 적이
  있습니다. `[auth.email]` 처럼 건드릴 섹션은 전부 명시적으로 적어 두세요.
- 원격에 마이그레이션을 올린 뒤에는 익명 클라이언트로 새는 곳이 없는지 확인하세요.
  `location_points`·`profiles` 조회가 42501이어야 정상입니다.

# 로컬 실행

```bash
supabase start                       # supabase/.env 의 값이 config.toml 의 env() 로 주입됨
adb reverse tcp:54321 tcp:54321      # Android 에뮬레이터 → 호스트
npm run android                      # expo run:android (개발 빌드)
```

- 에뮬레이터에서 `10.0.2.2`를 쓰면 앱은 호스트에 닿지만 OAuth가 깨집니다(위와 같은 이유).
  `adb reverse`가 양쪽을 같은 주소로 맞춥니다. iOS 시뮬레이터는 호스트와 루프백을 공유하므로
  이런 조치가 필요 없습니다.
- **소셜 로그인과 원격 푸시는 Expo Go에서 검증할 수 없습니다.** 커스텀 스킴이 등록되지 않고,
  원격 푸시는 SDK 53부터 빠졌습니다. 반드시 개발 빌드에서 확인하세요.
- `supabase db reset` 후에는 기기의 SecureStore에 옛 세션이 남아 앱이 로그인 상태로 보입니다.
  `adb shell pm clear <package>` 로 정리하세요.
- **OAuth 클라이언트를 바꾸면 Google이 주는 `sub`도 바뀌므로 기존 계정은 이어지지 않습니다.**
  시크릿만 교체하면 클라이언트 ID가 그대로라 계정이 유지됩니다.

# 비밀정보

- 실제 provider 키는 `supabase/.env`(gitignore, `chmod 600`)에만 둡니다.
  `supabase/config.toml`은 저장소에 올라가므로 `env(...)` 참조만 적습니다.
- 대화나 로그에 시크릿이 한 번이라도 노출되면 해당 값은 폐기하고 교체합니다.
- 인증서·프로파일도 저장소에 두지 않습니다(`*.cer`, `*.p8`, `*.p12`, `*.mobileprovision` 무시).
  키체인에 넣고 나면 파일은 남길 이유가 없습니다.

# 2026-08-18 세션: 3개 기능 구현 및 배포 완료

## 구현된 기능
1. **상관없음(무관심) 관계 의도** — onboarding에서 4번째 옵션 추가
2. **repeat_encounter_threshold 5→3** — 매칭 자격 조건 완화
3. **경로 지도 렌더링** — 기록 상세에서 location_points로 polyline 표시

## 테스트 현황
- ✅ 실기기(iPhone 16 Pro) Release 빌드 배포
- ✅ 지도 렌더링 확인 (2026-08-17 기록, 819개 포인트)
- ✅ encounter_candidates 생성 (2개 양방향)
- ✅ location_points 919개 (기존 + 테스트)

## 매칭 테스트 데이터
- **lth3723@gmail.com**: 2026-08-17 12:11 러닝 5.2km, 819포인트
- **lthlthltlt@gmail.com**: 2026-08-17 12:20 러닝 5km, 100포인트 (시간 겹침)
- encounter_candidates: 양방향 eligible=true, repeat=3 설정

## 남은 확인사항
⏳ 앱 발견 화면에서 매칭 카드 실제 표시 확인 필요 (encounter_candidates DB에는 데이터 있음)

# 2026-08-19 세션: 온보딩·업적·안전 체크 및 운영 화면 방향

## 구현·배포 완료

- 가입 온보딩에 러닝 목표(`첫 5km / 주 3회 습관 / 5km 기록 향상 / 10km 도전`), 평소 페이스, 넓은 활동 시간대(`평일 아침 / 평일 저녁 / 주말 오전`)를 추가했다. 정확한 약속 시각은 저장·공개하지 않는다.
- 완료·검증된 러닝만으로 서버가 업적을 누적한다. `러닝 초심자`, `꾸준한 러너`, `하드코어 러너`, `100km 클럽`, `베테랑 러너`를 해제하며, 후보 카드에는 대표 타이틀·아이콘만 보인다.
- 계획 러닝은 가입 목표와 평소 페이스를 바탕으로 추천하고, 자유 러닝은 기존 기록 흐름을 유지한다.
- 상호 수락된 같이 뛰기 요청에 한해 첫 러닝 안전 체크(약속 전 준비 / 종료 후 본인 확인)를 제공한다. 체크인은 본인에게만 보이며 상대·광고·푸시에 실시간 위치, 정확한 시각, 장소를 절대 보내지 않는다.
- 원격 Supabase에 `202608120030`~`032` 마이그레이션을 적용했고, `npm run typecheck` 및 `npx supabase test db`(263 tests)를 통과했다.
- iPhone Debug 빌드는 설치했다. 기기가 잠겨 있어 자동 실행만 거부됐으므로, 잠금 해제 뒤 기기에서 수동 실행하면 된다.

## 매칭이 없어도 남는 경험

발견 후보가 없어도 러닝 앱으로서 가치가 남도록, 종료 기록 축하·개인 기록·업적/타이틀·개인 목표 기반 계획 러닝을 제공한다. 활동 가능 시간대는 후보 카드의 넓은 시간대 공통점만 보여주는 보조 신호이며, 후보 생성·정렬을 바꾸는 알고리즘은 아직 아니다.

## 운영자 신고 모니터링

- 현재 `scripts/operator-console.mjs`가 등록·활성 운영자만 쓸 수 있는 CLI 검토 도구다. 신고 큐, 서버 보존 증거, 제재 이력, 기각/경고/제한/정지 처리, 감사 기록을 제공한다.
- 다음 단계의 **관리자 웹 화면**은 별도 서버 계층에서 운영자 로그인을 검증하고 같은 `operator_*` RPC를 호출해야 한다. `SUPABASE_SERVICE_ROLE_KEY`는 브라우저·모바일 앱·공개 환경변수에 절대 넣지 않는다.
- 기본 화면에는 신고 목록·사유·증거·대상 제재 이력·처리 UI·감사 로그를 둔다. 신고자 신원은 기본으로 노출하지 않고, 필요한 경우에도 최소 내부 식별 정보와 집계치만 다룬다.
