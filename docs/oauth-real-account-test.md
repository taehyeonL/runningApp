# OAuth 실계정 검증

## 자동 설정 점검

Windows PowerShell에서 다음 명령을 실행합니다.

```powershell
npm run check:oauth
```

이 명령은 공개 Auth settings만 조회하며 publishable key 값을 출력하지 않습니다. Apple, Kakao, Google 중 비활성 provider가 있으면 종료 코드 2를 반환합니다.

## 공급자별 사전 설정

1. 공급자 콘솔에는 Supabase callback `https://iqzmanpktxpggzfpnums.supabase.co/auth/v1/callback`을 등록합니다.
2. Supabase Authentication → Providers에 각 client ID/secret을 저장합니다. secret은 앱 `.env`에 넣지 않습니다.
3. Supabase Authentication → URL Configuration의 Redirect URLs에 `runningmate://auth/callback`을 등록합니다.
4. custom scheme callback은 Expo Go가 아닌 development build 또는 배포 빌드에서 검증합니다.

## 실계정 시나리오

각 provider마다 로그인 성공, 사용자 취소, 공급자 오류를 한 번씩 확인합니다.

- 성공: 앱으로 돌아와 세션이 저장되고, 앱 재시작 후 세션과 온보딩 상태가 복원됩니다.
- 취소: 로그인 화면에 취소 안내가 나오며 이전 세션을 덮어쓰지 않습니다.
- 오류: callback의 임의 `code`/`state`나 다른 scheme은 세션으로 교환되지 않아야 합니다.
- 로그아웃: 현재 기기의 세션만 제거되고 진행 중 러닝이 있으면 먼저 종료하도록 안내합니다.
- 계정 연결: 같은 이메일의 provider 계정이 자동으로 한 사용자로 합쳐진다고 가정하지 말고 Supabase의 계정 연결 정책을 별도 검증합니다.
