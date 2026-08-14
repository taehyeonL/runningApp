// 첫 만남 안전 가이드. 기획서 §5 "오프라인 첫 만남 안내: 낮 시간, 공개된 러닝
// 장소, 지인에게 일정 공유"와 §7 이용약관 5항을 화면 문구로 옮긴 것이다.
// 내용을 여러 화면에 복사해 두면 한쪽만 고쳐져 서로 다른 안내가 나가므로
// 여기 한 곳에서만 정의한다.

export type SafetyGuideItem = {
  symbol: string;
  title: string;
  body: string;
};

export const firstMeetingGuideTitle = '처음 만나기 전에';

export const firstMeetingGuideSummary =
  '같이 뛰기로 했다면 아래 네 가지만 지켜도 대부분의 위험을 피할 수 있어요.';

export const firstMeetingGuideItems: ReadonlyArray<SafetyGuideItem> = [
  {
    symbol: '☀',
    title: '낮 시간에 만나요',
    body: '해가 떠 있는 시간대를 고르세요. 새벽·심야 러닝은 서로 충분히 알게 된 뒤에 정해도 늦지 않아요.',
  },
  {
    symbol: '◎',
    title: '사람이 있는 공개된 장소에서',
    body: '한강공원, 종합운동장, 도심 러닝 코스처럼 사람이 오가는 곳에서 만나세요. 인적 드문 산길이나 하천 둔치는 첫 만남에 적합하지 않아요.',
  },
  {
    symbol: '✓',
    title: '지인에게 일정을 공유해요',
    body: '누구와 언제 어디서 뛰는지 가족이나 친구에게 미리 알려두세요. 러닝이 끝나면 연락하기로 약속해 두면 더 좋아요.',
  },
  {
    symbol: '⊘',
    title: '집·직장은 알려주지 않아요',
    body: '집 근처를 출발지로 잡거나 직장 위치를 알려줄 필요는 없어요. 앱도 반복되는 출발·도착 지점을 자동으로 가려요.',
  },
];

export const firstMeetingGuideFooter =
  '조금이라도 불편하면 약속을 취소하거나 중간에 돌아가도 괜찮아요. 상대를 배려하느라 참을 이유가 없어요. 위협을 느끼면 즉시 112에 도움을 요청하고, 앱에서는 차단과 신고를 함께 이용하세요.';
