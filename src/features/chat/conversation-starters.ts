// Generic, optional drafts: never derived from GPS, exact activity times or private profiles.
export const conversationStarters = [
  { id: 'hello', label: '반갑게 인사하기', body: '반가워요! 같이 뛰게 되어 기뻐요. 편한 페이스로 맞춰봐요.' },
  { id: 'pace', label: '편한 페이스 물어보기', body: '평소에 어느 정도 페이스로 달리는 게 편하세요?' },
  { id: 'style', label: '러닝 스타일 알아가기', body: '달릴 때 가볍게 대화하는 편이세요, 러닝에 집중하는 편이세요?' },
] as const;
