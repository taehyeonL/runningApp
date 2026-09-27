# 앱 아이콘 — 같은 페이스, 나란한 두 흐름

## 브랜드 기준

- 핵심은 **달리는 짝을 찾는 러닝 메이트 앱**이다. 함께 달리면서 관계가 시작될 수 있는 은근한 설렘을 담는다.
- 홈 화면에서 보았을 때 노골적인 데이팅 앱으로 느껴지지 않도록 하트·커플 실루엣·성별 기호를 쓰지 않는다.
- 정원은 러닝의 성취감을 주는 보조 요소이며, 앱을 대표하는 아이콘의 주제가 아니다.
- 서로 다른 두 색의 나란한 곡선은 두 러너의 보폭과 함께 이어가는 경로를 추상화한다. 기존 UI의 짙은 초록과 라임을 유지하고 따뜻한 아이보리를 더한다.

## 자산·적용

- 제작: 이미지 생성 스킬의 내장 image_gen 도구. CLI/API 직접 호출 아님.
- 최종 이미지: `assets/icon-running-mates.png` (1024×1024 불투명 PNG).
- 앱·Android adaptive foreground·웹 favicon·iOS AppIcon에 적용한다.
- Android 단색 테마 아이콘은 별도 제공하지 않는다.
- 이전 새싹 시안 `assets/icon-run-sprout.png`는 보존하되 앱에서는 참조하지 않는다.
- 인증·매칭 판정·정원 기능·서버에는 변경이 없다.

## 최종 생성 프롬프트

```text
Use case: logo-brand. Create a single minimal premium app icon for a running-mate discovery app. Core identity: two people finding a shared pace, subtle chemistry through running, publicly comfortable as a sports app, never visibly a dating app. Full-bleed opaque deep forest teal background #123F32 matching the existing app UI. Central bold abstract symbol made of exactly two closely spaced parallel flowing forward strides, two synchronized curved running-track strokes leaning upward to the right, one warm ivory and one fresh lime #D5F279. The two strokes have equally important weight, rounded ends, a tiny stagger suggesting two runners moving together, friendly athletic energy and quiet connection. A memorable compact unified mark, not literal people. Extremely simple flat geometric vector-like raster with clean solid colors. Keep the entire mark inside the central 50 percent of the square canvas for Android circular adaptive icon masking. Square 1024x1024. No heart, no hidden heart outline, no romantic symbols, no couple silhouettes, no gender symbols, no faces, no leaves, no plants, no garden motifs, no map pin, no infinity symbol, no text, no letters, no border, no outer rounded square, no shadow, no gradient, no texture, no mockup. Show just one finished icon. Save the generated image and provide its local path.
```

## 기술 기준

- 검증: typecheck 통과, Android 개발 빌드·설치 성공, API 35 에뮬레이터 런처에서 새 아이콘 전체 표시 확인. 기존 로그인과 데이터는 유지했다.

[Expo SDK 57 app config](https://docs.expo.dev/versions/v57.0.0/config/app/)의 아이콘 설정과 기존 네이티브 프로젝트 리소스 교체 방식을 확인했다. iOS는 리소스 교체만 하며 이번 작업에서 실기기 빌드는 하지 않는다.
