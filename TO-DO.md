# 같이뛰어 MVP 작업 목록

이 문서는 [기획 기준](docs/product-spec.md)을 실행 가능한 개발 단위로 나눈 목록입니다. 완료 기준은 기능 구현뿐 아니라 위치정보 안전·상호 동의·RLS 검증을 포함합니다.

## 완료

- [x] Expo SDK 57 + React Native TypeScript 프로젝트 기반 구성
- [x] Supabase 공개 환경변수 예시와 클라이언트 초기화 구조
- [x] Apple·카카오·Google 로그인 UI 및 OAuth 연동 TODO
- [x] 성인 확인, 필수 동의, 관계 의도, 러닝 스타일, 공개 범위 온보딩 UI
- [x] 홈·러닝 기록·종료·발견·요청·공개 설정·신고/차단 클릭형 프로토타입
- [x] 앱 셸, 도메인 화면, 공용 UI·스타일·러닝 표시 로직 구조화
- [x] Supabase 초기 스키마와 RLS 초안
- [x] 원본 GPS 비공개, 상호 수락 이후 채팅 허용 DB 규칙 초안
- [x] co-running worker/job queue 인터페이스와 설계 문서
- [x] README 실행 방법·구현 범위·후속 단계 정리

## 다음 우선순위

### P0 — 출시 전 안전 기반

- [ ] Supabase 개발 프로젝트 생성·migration 적용·일반 사용자 JWT와 service role RLS 분리 테스트
- [x] OAuth PKCE deep-link 콜백, Expo SecureStore 세션 저장·복원·foreground 갱신 구현
- [ ] Apple / Kakao / Google 실제 provider client ID/secret 및 redirect allow list 설정과 실계정 검증
- [x] 온보딩 정보를 `profiles`, `consent_records`에 저장하는 인증 후 플로우 구현
- [x] 계정 삭제, 위치 동의 철회, 러닝 로그 개별 삭제/공개 범위 변경 API와 UI 구현
- [x] 차단 시 후보·요청·채팅을 즉시 제외하는 DB 정책과 pgTAP 통합 테스트
- [x] 요청 일일 한도·쿨다운·양방향 중복 방지 및 단방향 상태 머신 구현
- [x] 요청 수락·거절·취소 목록을 실제 앱 UI와 데이터에 연결
- [x] 만료 요청·예약 제재 reconciliation 함수를 운영 Cron에 연결

### P1 — 실제 러닝 기록과 안전한 발견

- [x] `expo-location` 위치 권한 안내, 시작·일시정지·재개·종료, 백그라운드/전경 폴백, 암호화 GPS 재전송 큐 구현
- [x] 3km 완료·비정상 속도·GPS accuracy 서버 최종 검증과 클라이언트 30m/12mps 사전 필터 구현
- [ ] 원본 GPS 보관 기간, 자동 마스킹, 삭제 작업 정의 및 운영 테스트
- [x] server-only co-running worker 구현·배포: 서버 거리 검증, 끝점 마스킹, 시간·궤적·방향·속도·accuracy 판정, 원자적 후보 생성
- [x] 실패 detection job 복구용 Supabase Cron + Vault 1분 주기 호출 설정
- [x] detection job 5회 최종 실패, Cron SQL 실패, worker timeout·non-2xx server-only alert outbox
- [ ] 외부 운영 webhook endpoint 설정과 실제 장애 알림 수신 검증
- [ ] false positive 검증용 폐쇄 베타 데이터셋·임계값·운영 대시보드 정의
- [x] `encounter_candidates`와 관계 범위 최소 프로필을 실제 발견 카드에 연결
- [ ] 실제 계정 후보 데이터로 정확 위치·시각 비노출 회귀 테스트

### P2 — 상호 동의 소셜 경험

- [x] 같이 뛰기 요청의 작성·수락·거절·취소·만료 데이터 연동
- [ ] 수락 뒤에만 생성되는 chat UI, 푸시 알림, 메시지 신고 진입점 구현
- [ ] 신고 증거 제출, 운영자 검토, 노출 제한·제재 이력 관리 도구 구현
- [ ] 공개 장소·낮 시간·지인 공유를 안내하는 첫 만남 안전 가이드 추가

### P3 — 워치와 제품 고도화

- [ ] Apple Watch 또는 Wear OS 한 플랫폼의 오프라인 기록·동기화 MVP
- [ ] `source_record_id` 기반 중복 동기화·부분 업로드·배터리 종료 복구 테스트
- [ ] 주간 목표, 기본 러닝 인사이트, 로그 통계 카드 구현
- [ ] Plus/Pro 과금 전, 무료 요청·차단·신고·로그 삭제 권리가 유지되는지 정책 검토

## 작업 원칙

- 원본 GPS, 정확한 시각, 원본 경로는 사용자 간 절대 노출하지 않는다.
- 매칭·채팅은 상호 수락을 우회할 수 없다.
- 무료 사용자의 로그 저장·삭제·공개 범위 변경과 안전 기능은 제한하지 않는다.
- 실제 출시 전 개인정보·위치정보 처리방침 및 약관은 국내 전문 법률 검토를 거친다.
