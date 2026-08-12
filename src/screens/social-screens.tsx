import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import type { RunListItem } from '../features/running/run-types';
import {
  requestProposals,
  type ConnectionRequestSummary,
  type DiscoveryCandidate,
  type RequestStatus,
  type RequestTemplateKey,
} from '../features/social/social-types';
import type { SocialController } from '../hooks/use-social';
import { Back, Card, ChoiceGroup, Kicker, Notice, PrimaryButton, RunnerCard, Section, ToggleRow } from '../ui/components';
import { styles } from '../ui/styles';
import { formatDistance, visibilityLabels, type VisibilityLabel } from '../utils/run-format';

const reportReasons = ['성희롱·성적 불쾌감', '스토킹·원치 않는 접촉', '사칭·사기', '혐오·폭언', '위치·개인정보 노출', '미성년자 의심', '기타'];
const requestStatusLabels: Record<RequestStatus, string> = {
  pending: '응답 대기',
  accepted: '수락됨',
  declined: '거절됨',
  cancelled: '취소됨',
  expired: '만료됨',
};

function proposalLabel(key: ConnectionRequestSummary['templateKey']) {
  return requestProposals.find((proposal) => proposal.key === key)?.label ?? '직접 작성한 러닝 제안';
}

export function DiscoverScreen({ userId, social, onRequest, onReport }: {
  userId?: string;
  social: SocialController;
  onRequest: (candidate: DiscoveryCandidate) => void;
  onReport: () => void;
}) {
  return (
    <>
      <Kicker>안전한 발견</Kicker>
      <Text style={styles.pageTitle}>오늘 스친 러너</Text>
      <Text style={styles.pageSub}>완료한 러닝의 안전한 요약을 바탕으로 보여드려요.</Text>
      {social.isLoading ? <Notice text="발견 후보와 요청 상태를 불러오고 있어요…" /> : null}
      {social.error ? <Notice text={social.error} /> : null}
      {!social.isLoading && social.candidates.length === 0 ? (
        <Card><Text style={styles.listTitle}>아직 발견된 러너가 없어요</Text><Text style={styles.cardText}>서버 검증을 통과한 러닝끼리 같은 리듬이 확인되면 정확한 위치 없이 이곳에 표시됩니다.</Text><PrimaryButton label="다시 확인하기" onPress={() => void social.refresh()} /></Card>
      ) : null}
      {social.candidates.map((candidate) => (
        <RunnerCard
          key={candidate.id}
          candidate={candidate}
          expanded
          onPress={candidate.requestEligible ? () => onRequest(candidate) : undefined}
        />
      ))}
      <Card>
        <Text style={styles.listTitle}>발견 기준</Text>
        <Text style={styles.cardText}>3km 이상 완료, 위치 품질, 시간·궤적·방향·속도를 함께 고려해 서버에서 판정합니다. 순간적인 근접만으로 표시하지 않아요.</Text>
      </Card>

      <Text style={styles.sectionTitle}>같이 뛰기 요청</Text>
      {social.requests.length === 0 ? <Card compact><Text style={styles.cardText}>받거나 보낸 요청이 아직 없어요.</Text></Card> : null}
      {social.requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          userId={userId}
          busy={social.actionRequestId === request.id}
          onAccept={() => void social.accept(request.id).catch(() => undefined)}
          onDecline={() => void social.decline(request.id).catch(() => undefined)}
          onCancel={() => void social.cancel(request.id).catch(() => undefined)}
        />
      ))}
      <Pressable onPress={onReport} style={styles.reportLink}><Text style={styles.reportLinkText}>안전 문제를 신고하거나 차단하기</Text></Pressable>
    </>
  );
}

function RequestCard({ request, userId, busy, onAccept, onDecline, onCancel }: {
  request: ConnectionRequestSummary;
  userId?: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  const incoming = request.recipientId === userId;
  return (
    <Card>
      <View style={styles.requestHeader}>
        <View style={styles.toggleCopy}>
          <Text style={styles.listTitle}>{request.counterpart?.nickname ?? '러너'} · {incoming ? '받은 요청' : '보낸 요청'}</Text>
          <Text style={styles.caption}>{proposalLabel(request.templateKey)}</Text>
        </View>
        <Text style={styles.requestStatus}>{requestStatusLabels[request.status]}</Text>
      </View>
      {request.status === 'pending' ? (
        <View style={styles.requestActions}>
          {incoming ? (
            <>
              <Pressable disabled={busy} onPress={onDecline} style={[styles.requestSecondary, busy && styles.buttonDisabled]}><Text style={styles.secondaryText}>거절</Text></Pressable>
              <Pressable disabled={busy} onPress={onAccept} style={[styles.requestPrimary, busy && styles.buttonDisabled]}><Text style={styles.primaryText}>{busy ? '처리 중…' : '수락'}</Text></Pressable>
            </>
          ) : (
            <Pressable disabled={busy} onPress={onCancel} style={[styles.requestSecondary, busy && styles.buttonDisabled]}><Text style={styles.secondaryText}>{busy ? '처리 중…' : '요청 취소'}</Text></Pressable>
          )}
        </View>
      ) : null}
      {request.status === 'accepted' ? <Text style={styles.cardText}>상호 수락이 완료되어 채팅을 열 수 있는 상태예요.</Text> : null}
    </Card>
  );
}

export function RequestScreen({ candidate, sending, error, onBack, onSend }: {
  candidate: DiscoveryCandidate | null;
  sending: boolean;
  error: string | null;
  onBack: () => void;
  onSend: (template: RequestTemplateKey) => Promise<void>;
}) {
  const [proposal, setProposal] = useState(requestProposals[0].label);
  if (!candidate) {
    return <><Back onPress={onBack} /><Kicker>같이 뛰기 요청</Kicker><Text style={styles.pageTitle}>선택한 러너가 없어요</Text><PrimaryButton label="발견 화면으로 돌아가기" onPress={onBack} /></>;
  }
  const submit = async () => {
    const template = requestProposals.find((item) => item.label === proposal)?.key ?? 'weekend_5k';
    try {
      await onSend(template);
      Alert.alert('요청을 보냈어요', '상대가 수락해야만 채팅이 열립니다.');
    } catch {
      // The hook exposes a safe error message in this screen.
    }
  };
  return (
    <>
      <Back onPress={onBack} />
      <Kicker>같이 뛰기 요청</Kicker>
      <Text style={styles.pageTitle}>가볍게 제안해 보세요</Text>
      <Text style={styles.pageSub}>수락 전에는 연락처나 세부 일정이 공유되지 않아요.</Text>
      <RunnerCard candidate={candidate} />
      <Section title="제안할 러닝"><ChoiceGroup options={requestProposals.map((item) => item.label)} value={proposal} onChange={setProposal} /></Section>
      <Card tone="yellow"><Text style={styles.listTitle}>무료 요청 가능</Text><Text style={styles.cardText}>서버가 최근 30일 유효한 반복 교차 5회 이상을 확인한 후보에게만 요청할 수 있어요.</Text></Card>
      {error ? <Notice text={error} /> : null}
      <PrimaryButton label={sending ? '요청 보내는 중…' : '같이 뛰기 요청 보내기'} disabled={sending} onPress={() => void submit()} />
    </>
  );
}

export function ProfileScreen({ latestRun, signedIn, onOpenRun, onLogout }: {
  latestRun?: RunListItem;
  signedIn: boolean;
  onOpenRun: (run: RunListItem) => void;
  onLogout: () => void;
}) {
  const [discoverable, setDiscoverable] = useState(true);
  const [shareLogs, setShareLogs] = useState(true);
  const [visibility, setVisibility] = useState<VisibilityLabel>('매칭 공개');
  return (
    <>
      <Kicker>나의 설정</Kicker>
      <Text style={styles.pageTitle}>공개 범위와 러닝 로그</Text>
      <Text style={styles.pageSub}>내 기록과 발견 참여는 언제든 내가 결정해요.</Text>
      <Card><ToggleRow title="발견에 내 프로필 표시" description="조건을 충족한 러너에게만 추상화된 카드로 보여요." value={discoverable} onChange={setDiscoverable} /><View style={styles.divider} /><ToggleRow title="러닝 로그 공개 허용" description="정확한 경로·출발/도착 시각은 공개하지 않아요." value={shareLogs} onChange={setShareLogs} /></Card>
      <Section title="새 러닝 로그 기본 공개 범위"><ChoiceGroup options={['비공개', '친구 공개', '프로필 공개', '매칭 공개']} value={visibility} onChange={(value) => setVisibility(value as VisibilityLabel)} /></Section>
      {latestRun ? <Pressable onPress={() => onOpenRun(latestRun)}><Card compact><View><Text style={styles.listTitle}>최근 러닝 기록</Text><Text style={styles.caption}>{formatDistance(latestRun.distanceMeters)}km · {latestRun.status === 'processing' ? '검증 중' : '저장됨'} · {visibilityLabels[latestRun.visibility]}</Text></View><Text style={styles.arrow}>›</Text></Card></Pressable> : null}
      <Pressable onPress={() => Alert.alert('데모 안내', '러닝 로그 삭제는 모든 사용자에게 무료로 제공되어야 합니다. 실제 연결 단계에서 삭제 API를 추가하세요.')}><Text style={styles.destructiveText}>러닝 로그 삭제 기능 안내</Text></Pressable>
      {signedIn ? <Pressable onPress={onLogout}><Text style={styles.logoutText}>로그아웃</Text></Pressable> : null}
    </>
  );
}

export function ReportScreen({ onBack }: { onBack: () => void }) {
  const [selectedReport, setSelectedReport] = useState(reportReasons[0]);
  return (
    <>
      <Back onPress={onBack} />
      <Kicker>안전 센터</Kicker>
      <Text style={styles.pageTitle}>신고 또는 차단</Text>
      <Text style={styles.pageSub}>차단하면 서로의 발견 카드와 요청에서 즉시 제외됩니다.</Text>
      <Card tone="yellow"><Text style={styles.listTitle}>긴급한 위험이 있나요?</Text><Text style={styles.cardText}>즉시 112 등 긴급 도움을 요청하세요. 서비스 신고는 안전 대응을 위한 보조 수단입니다.</Text></Card>
      <Section title="신고 사유"><ChoiceGroup options={reportReasons} value={selectedReport} onChange={setSelectedReport} /></Section>
      <PrimaryButton label="신고 제출하기" onPress={() => Alert.alert('신고가 접수되었어요', '운영 검토를 위해 증거와 반복성을 확인합니다. 신고자 정보는 상대에게 공개되지 않아요.')} />
      <Pressable style={styles.blockButton} onPress={() => Alert.alert('차단했어요', '이제 이 사용자는 내 발견 카드와 요청에서 제외됩니다.')}><Text style={styles.blockText}>이 사용자 차단하기</Text></Pressable>
    </>
  );
}
