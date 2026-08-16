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

권한 판정 로직은 `private` 스키마 함수에 한 번만 두고 나머지는 그것을 호출합니다
(`private.pair_contact_allowed`, `private.can_pair_message`, `private.consent_granted` 등).
새 규칙을 뷰나 RPC에 직접 인라인하지 마세요.

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
동의 조회 4벌, 죽은 가시성 함수 3개가 그랬습니다.

- 같은 판단을 두 번째로 쓰게 되면, 복사하지 말고 기존 정의를 호출하세요.
- 테스트는 **성질**을 고정하세요. `my_moderation_notices`가 안전하다는 테스트는 통과했지만
  앱이 실제로 읽는 `user_moderation_notices`는 새고 있었습니다.
  "앱이 읽는 모든 표면에서 자동 보류가 보이지 않는다"로 썼다면 잡혔을 결함입니다.
- 고치기 전에 결함을 **재현**하세요. 이 저장소의 수정 대부분은 "그리드 셀 7개가 생성됨",
  "푸시 1건이 큐에 쌓임", "100회 중 42회 오답" 같은 측정에서 출발했습니다.

# 로컬 실행

```bash
supabase start                       # supabase/.env 의 값이 config.toml 의 env() 로 주입됨
adb reverse tcp:54321 tcp:54321      # Android 에뮬레이터 → 호스트
npm run android                      # expo run:android (개발 빌드)
```

- 앱의 `.env`는 `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`을 씁니다. `10.0.2.2`를 쓰면
  앱은 호스트에 닿지만 OAuth가 깨집니다. Supabase가 Google에 넘기는 `redirect_uri`가 `127.0.0.1`인데
  Google은 사설 IP를 리디렉션 주소로 받지 않기 때문입니다. `adb reverse`가 양쪽을 같은 주소로 맞춥니다.
- **소셜 로그인과 원격 푸시는 Expo Go에서 검증할 수 없습니다.** 커스텀 스킴이 등록되지 않고,
  원격 푸시는 SDK 53부터 빠졌습니다. 반드시 개발 빌드에서 확인하세요.
- `supabase db reset` 후에는 기기의 SecureStore에 옛 세션이 남아 앱이 로그인 상태로 보입니다.
  `adb shell pm clear <package>` 로 정리하세요.
- OAuth 클라이언트를 바꾸면 Google이 주는 `sub`도 바뀌므로 기존 계정은 이어지지 않습니다.

# 비밀정보

- 실제 provider 키는 `supabase/.env`(gitignore, `chmod 600`)에만 둡니다.
  `supabase/config.toml`은 저장소에 올라가므로 `env(...)` 참조만 적습니다.
- 대화나 로그에 시크릿이 한 번이라도 노출되면 해당 값은 폐기하고 교체합니다.
