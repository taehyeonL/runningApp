@AGENTS.md

# 이 체크아웃의 개발 환경 (macOS)

프로젝트 규칙은 전부 `AGENTS.md`에 있습니다. 여기에는 이 머신에서만 겪는 문제를 적습니다.

## Xcode

### 시뮬레이터 목적지가 하나도 안 잡히면

`xcodebuild -showdestinations` 가 기기만 나열하고 시뮬레이터를 하나도 못 찾으면서
`iOS <버전> is not installed. Please download and install the platform` 이 나오는 경우입니다.

SDK(`iphonesimulator26.5`)는 Xcode에 들어 있어도 **플랫폼 런타임은 별도 다운로드**입니다.
`xcrun simctl` 에 옛 런타임(17.x, 18.0)이 보이고 부팅까지 되더라도 Xcode는 인정하지 않습니다.

```bash
xcodebuild -downloadPlatform iOS     # 약 8.5GB, sudo 불필요
```

받고 나면 옛 런타임까지 함께 eligible로 바뀝니다. 런타임이 낡아서 거부당한 게 아니라
iOS 플랫폼 자체가 없어서 iOS 대상 전체를 못 쓰던 것이기 때문입니다.

### `xcrun` / `xcodebuild` 가 죽으면

`git`, `python3` 등 `/usr/bin` 개발자 shim은 전부 `xcode-select`가 가리키는 툴체인을 거칩니다.
그 툴체인이 깨지면 관련 없는 명령까지 `Symbol not found: _XPCTypeBool` 로 실패합니다.
원인은 `/Library/Developer/PrivateFrameworks`의 구성요소가 설치된 Xcode·macOS보다 오래된 것입니다.
`xcode-select --install`은 해결책이 아닙니다 (Command Line Tools는 이미 설치되어 있습니다).

- 해결: Xcode.app을 한 번 실행해 추가 구성요소를 설치하거나 `sudo xcodebuild -runFirstLaunch`
- 그 전까지 git은 `/Library/Developer/CommandLineTools/usr/bin/git` 을 직접 호출

### Xcode 계정 확인

키체인이나 `~/Library/Developer/Xcode/UserData/` 를 봐도 안 나옵니다. 여기 있습니다.

```bash
defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier
# isFreeProvisioningTeam = 0 이면 유료 팀
```

## 시뮬레이터 조작

`simctl` 에는 탭 명령이 없고, 호스트 화면 캡처·손쉬운 사용 권한은 이 세션에 없습니다.
시뮬레이터 자체 API로 조작하는 `idb` 를 씁니다.

```bash
brew tap facebook/fb
brew trust --formula facebook/fb/idb-companion   # 서드파티 탭이라 신뢰 확인이 필요
brew install idb-companion
python3 -m venv <scratch>/idbenv && <scratch>/idbenv/bin/pip install fb-idb
```

```bash
idb ui tap --udid <UDID> <x> <y>          # 좌표는 포인트 단위
idb ui swipe --udid <UDID> x1 y1 x2 y2 --duration 0.4
idb screenshot --udid <UDID> out.png
```

- **좌표 변환**: 스크린샷은 픽셀(iPhone 17 Pro는 1206x2622), `ui tap`은 포인트입니다. **3으로 나누세요.**
- 스와이프는 `--duration` 없이 던지면 스크롤로 인식되지 않는 경우가 있습니다.
- 앱을 열 때 `simctl openurl` 로 딥링크를 쓰면 `'앱'에서 열겠습니까?` 시스템 확인 창이 뜹니다.
  탭할 수단이 없으면 갇히므로 `simctl launch <udid> <bundleId>` 를 쓰세요.
- GPS는 `xcrun simctl location <udid> set <lat>,<lon>` 으로 옮깁니다. 러너 페이스를 흉내 내려면
  약 36m를 6초 간격(≈6 m/s)으로 주면 됩니다. 12 m/s를 넘기면 앱의 품질 필터가 구간을 버립니다.

## 실기기

```
기기   IMNOTAHUMAN (iPhone 16 Pro)  UDID 00008140-00042D012633001C
팀     BA92679J95 (taehyeon lee, Individual, 유료)
```

- `expo run:ios --device` 는 `-allowProvisioningUpdates` 를 붙이지 않아 서명에서 멈춥니다.
  `xcodebuild ... -allowProvisioningUpdates` 로 직접 부르세요.
- 그래도 `Device isn't registered in your developer account` 가 나오면 **기기 등록은 커맨드라인에서
  안 됩니다.** `ios/app.xcworkspace` 를 열어 Signing & Capabilities에서 `Register Device` 를 한 번
  누르면 기기 등록·App ID·프로파일이 함께 만들어집니다. 그 뒤로는 CLI만으로 됩니다.
- 서명 팀은 `app.json` 의 `ios.appleTeamId` 에 둡니다. `ios/` 는 생성 폴더라 Xcode에서 고른 팀은
  다음 `prebuild --clean` 에 사라지지만, 이 키는 prebuild가 매번 다시 써 넣습니다.
- 설치·실행은 `xcrun devicectl device install app --device <udid> <path>` 와
  `... process launch --device <udid> <bundleId>`. 기기가 잠겨 있으면 실행이 거부됩니다.
- 유료 계정의 정식 개발 프로파일로 서명하면 **"신뢰할 수 없는 개발자" 절차가 없습니다.**
  설정에 개발자 앱 항목이 안 보이는 게 정상입니다.

### 밖에서 테스트하려면 Release

디버그 빌드는 Metro에서 JS를 받아오므로 Mac을 벗어나면 화면이 뜨지 않습니다.

```bash
npx expo run:ios --configuration Release --device <udid>
```

번들이 앱에 구워져 단독으로 돕니다. 확인은 Metro를 끈 채로 실행해 보면 됩니다.

## 커밋

`app.json`, `package.json`의 일부 변경은 `expo prebuild`가 자동 생성한 것입니다
(Android 권한 목록, `npm run android`의 `expo start` → `expo run:android`).
의도한 변경과 섞이므로, 커밋 전에 이 파일들의 diff는 한 줄씩 확인하세요.
