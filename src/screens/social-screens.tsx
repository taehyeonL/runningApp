import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import type { LogVisibility } from '../features/account/account-api';
import type { RunListItem } from '../features/running/run-types';
import {
  requestProposals,
  type ConnectionRequestSummary,
  type DiscoveryCandidate,
  type RequestStatus,
  type RequestTemplateKey,
} from '../features/social/social-types';
import type { PrivacyController } from '../hooks/use-privacy';
import type { SocialController } from '../hooks/use-social';
import { Back, Card, ChoiceGroup, Kicker, Notice, PrimaryButton, RunnerCard, Section, ToggleRow } from '../ui/components';
import { styles } from '../ui/styles';
import {
  formatDistance,
  formatRunDate,
  visibilityFromLabel,
  visibilityLabels,
  visibilityOptions,
} from '../utils/run-format';

type PrivacyDraft = {
  discoveryEnabled: boolean;
  profileVisibility: LogVisibility;
  logDefaultVisibility: LogVisibility;
};

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

export function DiscoverScreen({ userId, social, chatUnreadCount, onRequest, onReport, onOpenChat }: {
  userId?: string;
  social: SocialController;
  chatUnreadCount: number;
  onRequest: (candidate: DiscoveryCandidate) => void;
  onReport: () => void;
  onOpenChat: () => void;
}) {
  return (
    <>
      <Kicker>안전한 발견</Kicker>
      <Text style={styles.pageTitle}>오늘 스친 러너</Text>
      <Text style={styles.pageSub}>완료한 러닝의 안전한 요약을 바탕으로 보여드려요.</Text>
      <Pressable onPress={onOpenChat}>
        <Card compact>
          <View>
            <Text style={styles.listTitle}>대화</Text>
            <Text style={styles.caption}>서로 수락한 러너와 이야기해요</Text>
          </View>
          {chatUnreadCount > 0
            ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{chatUnreadCount}</Text></View>
            : <Text style={styles.arrow}>›</Text>}
        </Card>
      </Pressable>
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

export function ProfileScreen({ recentRuns, privacy, signedIn, onOpenRun, onOpenAccount, onLogout }: {
  recentRuns: RunListItem[];
  privacy: PrivacyController;
  signedIn: boolean;
  onOpenRun: (run: RunListItem) => void;
  onOpenAccount: () => void;
  onLogout: () => void;
}) {
  const status = privacy.status;
  const [draft, setDraft] = useState<PrivacyDraft | null>(null);

  // 서버가 유일한 진실이다. 저장하지 않은 편집이 없을 때만 최신 상태를 반영한다.
  useEffect(() => {
    if (status && !draft) {
      setDraft({
        discoveryEnabled: status.discoveryEnabled,
        profileVisibility: status.profileVisibility,
        logDefaultVisibility: status.logDefaultVisibility,
      });
    }
  }, [draft, status]);

  const dirty = Boolean(status && draft && (
    draft.discoveryEnabled !== status.discoveryEnabled
    || draft.profileVisibility !== status.profileVisibility
    || draft.logDefaultVisibility !== status.logDefaultVisibility
  ));

  const save = () => {
    if (!draft) return;
    void privacy.savePrivacy(draft).then(() => setDraft(null)).catch(() => undefined);
  };

  return (
    <>
      <Kicker>나의 설정</Kicker>
      <Text style={styles.pageTitle}>공개 범위와 러닝 로그</Text>
      <Text style={styles.pageSub}>내 기록과 발견 참여는 언제든 내가 결정해요.</Text>

      {privacy.isLoading && !status ? <Notice text="공개 설정을 불러오고 있어요…" /> : null}
      {privacy.notice ? <Notice text={privacy.notice} /> : null}
      {privacy.error ? <Notice text={privacy.error} /> : null}

      {draft ? (
        <>
          <Card>
            <ToggleRow
              title="발견에 내 프로필 표시"
              description="끄면 이미 노출된 발견 카드도 즉시 회수돼요."
              value={draft.discoveryEnabled}
              onChange={(value) => setDraft({ ...draft, discoveryEnabled: value })}
            />
          </Card>
          <Section title="프로필 공개 범위">
            <ChoiceGroup
              options={visibilityOptions}
              value={visibilityLabels[draft.profileVisibility]}
              onChange={(value) => setDraft({ ...draft, profileVisibility: visibilityFromLabel(value) })}
            />
          </Section>
          <Section title="새 러닝 로그 기본 공개 범위">
            <ChoiceGroup
              options={visibilityOptions}
              value={visibilityLabels[draft.logDefaultVisibility]}
              onChange={(value) => setDraft({ ...draft, logDefaultVisibility: visibilityFromLabel(value) })}
            />
          </Section>
          {dirty ? (
            <PrimaryButton
              label={privacy.isBusy ? '저장 중…' : '공개 설정 저장'}
              disabled={privacy.isBusy}
              onPress={save}
            />
          ) : null}
        </>
      ) : null}

      <Text style={styles.sectionTitle}>러닝 기록</Text>
      {recentRuns.length === 0 ? (
        <Card compact><View><Text style={styles.cardText}>아직 저장된 러닝 기록이 없어요.</Text></View></Card>
      ) : null}
      {recentRuns.slice(0, 5).map((run) => (
        <Pressable key={run.id} onPress={() => onOpenRun(run)}>
          <Card compact>
            <View>
              <Text style={styles.listTitle}>{formatRunDate(run.startedAt)}</Text>
              <Text style={styles.caption}>
                {formatDistance(run.distanceMeters)}km · {run.status === 'processing' ? '검증 중' : '저장됨'} · {visibilityLabels[run.visibility]}
              </Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </Card>
        </Pressable>
      ))}
      <Text style={styles.caption}>기록을 눌러 로그별 공개 범위를 바꾸거나 삭제할 수 있어요.</Text>

      <Pressable onPress={onOpenAccount}>
        <Card compact>
          <View>
            <Text style={styles.listTitle}>계정과 데이터</Text>
            <Text style={styles.caption}>위치 동의 철회, 계정 삭제</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </Card>
      </Pressable>
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
