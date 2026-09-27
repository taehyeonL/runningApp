export type RequestTemplateKey = 'weekend_5k' | 'after_work_jog' | 'morning_run';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export const requestProposals: ReadonlyArray<{ key: RequestTemplateKey; label: string; title: string; description: string }> = [
  { key: 'weekend_5k', label: '다음 주말에 5km 가볍게', title: '가볍게 5km', description: '다음 주말, 함께 달릴 한 번의 러닝' },
  { key: 'after_work_jog', label: '퇴근 후 30분 조깅', title: '퇴근 후 짧은 조깅', description: '하루 끝에 30분, 부담 없는 러닝 제안' },
  { key: 'morning_run', label: '이번 주 아침 러닝', title: '아침을 여는 러닝', description: '이번 주 아침, 함께 시작하는 하루' },
];

export type SocialProfile = {
  id: string;
  nickname: string;
  ageBand: string | null;
  relationshipIntents: string[];
  runningStyleTags: string[];
  paceMinSeconds: number | null;
  paceMaxSeconds: number | null;
  monthlyDistanceKm: number;
  completedRunCount: number;
  availabilitySlots: string[];
  primaryAchievement: string;
  achievementCodes: string[];
  bio?: string | null;
  conversationPreference?: string;
  preferredDistance?: string;
};

export type DiscoveryCandidate = {
  id: string;
  profile: SocialProfile;
  similarityLabel: 'good_match' | 'quite_good_match' | 'new_rhythm';
  reasons: string[];
  repeatEncounters30d: number;
  requestEligible: boolean;
  safeOverlapSummary: string | null;
  generatedAt: string;
  expiresAt: string;
};

export type ConnectionRequestSummary = {
  id: string;
  requesterId: string;
  recipientId: string;
  candidateId: string | null;
  templateKey: RequestTemplateKey | 'custom';
  message: string | null;
  status: RequestStatus;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string;
  counterpart: SocialProfile | null;
  safetyCheckin: { id: string; status: 'prepared' | 'completed' } | null;
};

export type SocialSnapshot = {
  candidates: DiscoveryCandidate[];
  requests: ConnectionRequestSummary[];
};
