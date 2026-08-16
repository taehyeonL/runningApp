@AGENTS.md

# 이 체크아웃의 개발 환경 (macOS)

프로젝트 규칙은 전부 `AGENTS.md`에 있습니다. 여기에는 이 머신에서만 겪는 문제를 적습니다.

## `xcrun` / `xcodebuild` 가 죽으면

`git`, `python3` 등 `/usr/bin` 개발자 shim은 전부 `xcode-select`가 가리키는 툴체인을 거칩니다.
그 툴체인이 깨지면 관련 없는 명령까지 아래처럼 실패합니다.

```
Symbol not found: _XPCTypeBool
  Referenced from: /Library/Developer/PrivateFrameworks/CoreDevice.framework/.../CoreDevice
xcode-select: Failed to locate 'git', requesting installation of command line developer tools.
```

원인은 `/Library/Developer/PrivateFrameworks`의 구성요소가 설치된 Xcode·macOS보다 오래된 것입니다.
`xcode-select --install`은 해결책이 아닙니다 (Command Line Tools는 이미 설치되어 있습니다).

- 근본 해결: Xcode.app을 한 번 실행해 추가 구성요소를 설치하거나 `sudo xcodebuild -runFirstLaunch`
- 그 전까지의 우회: git은 `/Library/Developer/CommandLineTools/usr/bin/git`을 직접 호출
- 이 상태에서는 iOS 시뮬레이터를 쓸 수 없습니다. Android 에뮬레이터로 검증하세요.
  Metro 로그의 `Unable to run simctl ... exited with non-zero code: 72`가 같은 원인입니다.

## 커밋

`app.json`, `package.json`의 일부 변경은 `expo prebuild`가 자동 생성한 것입니다
(Android 권한 목록, `android.package`, `npm run android`의 `expo start` → `expo run:android`).
의도한 변경과 섞이므로, 커밋 전에 이 파일들의 diff는 한 줄씩 확인하세요.
