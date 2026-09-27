import { useEffect, useRef, useState } from 'react';
import { DevFriendsPanel } from './dev-friends-panel';
import { MatchPreferencesSettings } from './match-preferences';
import { DiscoveryEmptyState, RunnerIntroductionSettings } from './launch-experience';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import type { LogVisibility } from '../features/account/account-api';
import type { RunListItem } from '../features/running/run-types';
import {
  reportReasonOptions,
  type ModerationNotice,
  type ProfileReportReason,
} from '../features/social/moderation-api';
import {
  requestProposals,
  type ConnectionRequestSummary,
  type DiscoveryCandidate,
  type RequestStatus,
  type RequestTemplateKey,
} from '../features/social/social-types';
import type { PrivacyController } from '../hooks/use-privacy';
import { achievementInfo } from '../features/running/runner-achievements';
import type { SocialController } from '../hooks/use-social';
import { Back, Card, ChoiceGroup, Kicker, Notice, PrimaryButton, RunnerCard, SafetyGuide, Section, ToggleRow } from '../ui/components';
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

export function DiscoverScreen({ userId, social, chatUnreadCount, viewerAvailabilitySlots, adultVerified, onOpenProfile, onRequest, onVisitGarden, onReport, onOpenChat, onStartPlan }: {
  userId?: string;
  social: SocialController;
  chatUnreadCount: number;
  viewerAvailabilitySlots: string[];
  adultVerified: boolean;
  onOpenProfile: () => void;
  onRequest: (candidate: DiscoveryCandidate) => void;
  onVisitGarden: (id: string) => void;
  onReport: () => void;
  onOpenChat: () => void;
  onStartPlan: () => void;
}) {
  if (!adultVerified) {
    return (
      <>
        <Kicker>안전한 발견</Kicker>
        <Text style={styles.pageTitle}>성인 인증 후 러닝 메이트를 찾아요</Text>
        <Text style={styles.pageSub}>러닝 기록은 계속 저장할 수 있어요. 다른 러너의 발견·요청·채팅은 휴대폰 본인확인으로 성인 인증을 마친 뒤에 열립니다.</Text>
        <Card tone="yellow">
          <Text style={styles.listTitle}>성인 인증이 필요해요</Text>
          <Text style={styles.cardText}>가입 때의 만 19세 이상 확인은 실제 인증을 대신하지 않아요. 현재 본인확인 제공사 연동을 준비 중이며, 연동 전에는 메이트 기능이 열리지 않아요.</Text>
          <PrimaryButton label="프로필에서 성인 인증 확인하기" onPress={onOpenProfile} />
        </Card>
        <Card>
          <Text style={styles.listTitle}>내 러닝 기록은 그대로예요</Text>
          <Text style={styles.cardText}>러닝 시작·저장·삭제와 공개 범위 변경은 성인 인증 여부와 관계없이 사용할 수 있습니다.</Text>
          <PrimaryButton label="나를 위한 러닝 계획 보기 →" onPress={onStartPlan} />
        </Card>
      </>
    );
  }
  return (
    <>
      <Kicker>안전한 발견</Kicker>
      <Text style={styles.pageTitle}>러닝 메이트</Text>
      <Text style={styles.pageSub}>비슷한 페이스, 함께 달릴 사람.</Text>
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
      {!social.isLoading && !social.error && social.candidates.length === 0 ? (
        <DiscoveryEmptyState onSettings={onOpenProfile} onRun={onStartPlan} onRefresh={() => void social.refresh()} />
      ) : null}
      {social.candidates.map((candidate) => (
        <View key={candidate.id}>
        <RunnerCard
          key={candidate.id}
          candidate={candidate}
          expanded
          viewerAvailabilitySlots={viewerAvailabilitySlots}
          onPress={candidate.requestEligible ? () => onRequest(candidate) : undefined}
        />
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={() => onVisitGarden(candidate.profile.id)}><Text style={styles.secondaryText}>공개한 정원 구경하기 →</Text></Pressable>
        </View>
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
          onSafetyCheckin={() => void social.safetyCheckin(request.id, request.safetyCheckin).catch(() => undefined)}
        />
      ))}
      <Pressable onPress={onReport} style={styles.reportLink}><Text style={styles.reportLinkText}>안전 문제를 신고하거나 차단하기</Text></Pressable>
      <DevFriendsPanel key={userId} onConnected={() => void social.refresh()} onOpenChat={onOpenChat} />
    </>
  );
}

function RequestCard({ request, userId, busy, onAccept, onDecline, onCancel, onSafetyCheckin }: {
  request: ConnectionRequestSummary;
  userId?: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onSafetyCheckin: () => void;
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
      {request.status === 'accepted' ? <><Text style={styles.cardText}>상호 수락이 완료되어 채팅을 열 수 있는 상태예요.</Text><Card tone="yellow"><Text style={styles.listTitle}>첫 러닝 안전 체크</Text><Text style={styles.cardText}>{request.safetyCheckin?.status === 'completed' ? '오늘의 안전 체크를 마쳤어요. 정확한 장소·실시간 위치는 상대에게 공유되지 않아요.' : request.safetyCheckin ? '약속 전 체크를 기록했어요. 러닝을 마친 뒤 안전 체크 완료를 눌러 주세요.' : '약속 전 안전 수칙을 확인하고, 러닝을 마친 뒤 내 상태를 직접 확인해 주세요.'}</Text>{request.safetyCheckin?.status !== 'completed' ? <PrimaryButton label={busy ? '처리 중…' : request.safetyCheckin ? '러닝 종료 안전 체크 완료' : '약속 전 안전 체크'} disabled={busy} onPress={onSafetyCheckin} /> : null}</Card></> : null}
    </Card>
  );
}

export function RequestScreen({ candidate, sending, error, onBack, onSend, onReport }: {
  candidate: DiscoveryCandidate | null;
  sending: boolean;
  error: string | null;
  onBack: () => void;
  onSend: (template: RequestTemplateKey) => Promise<void>;
  onReport: (candidate: DiscoveryCandidate) => void;
}) {
  const [proposalKey, setProposalKey] = useState<RequestTemplateKey | null>(null);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const proposal = requestProposals.find((item) => item.key === proposalKey);
  if (!candidate) {
    return <><Back onPress={onBack} /><Kicker>같이 뛰기 요청</Kicker><Text style={styles.pageTitle}>선택한 러너가 없어요</Text><PrimaryButton label="발견 화면으로 돌아가기" onPress={onBack} /></>;
  }
  const submit = async () => {
    if (!proposal || !candidate.requestEligible || sending || sent || inFlight.current) return;
    inFlight.current = true;
    try {
      await onSend(proposal.key);
      setSent(true);
      Alert.alert('같이 뛰기 제안을 보냈어요', '상대도 함께하고 싶다면 수락할 거예요. 대화는 수락한 뒤에 열립니다.');
    } catch {
      // The hook exposes a safe error message in this screen.
      inFlight.current = false;
    }
  };
  return (
    <>
      <Back onPress={onBack} />
      <Kicker>같이 뛰기 요청</Kicker>
      <Text style={styles.pageTitle}>어떤 러닝으로{`\n`}말을 건네볼까요?</Text>
      <Text style={styles.pageSub}>긴 첫인사 대신, 함께하고 싶은 러닝 하나만 골라요.</Text>
      <Card compact><View style={styles.recordCopy}><Text style={styles.caption}>제안을 받을 러너</Text><Text style={styles.listTitle}>{candidate.profile.nickname}님</Text></View><Text style={styles.listMetric}>↗</Text></Card>
      <Section title="함께하고 싶은 러닝">
        {requestProposals.map((item) => (
          <Pressable key={item.key} accessibilityRole="radio" accessibilityState={{ checked: proposalKey === item.key, disabled: sending || sent }} disabled={sending || sent} onPress={() => setProposalKey(item.key)} style={[styles.proposalOption, proposalKey === item.key && styles.proposalOptionSelected, (sending || sent) && styles.buttonDisabled]}>
            <View style={styles.recordCopy}><Text style={styles.listTitle}>{item.title}</Text><Text style={styles.cardText}>{item.description}</Text></View><Text style={styles.listMetric}>{proposalKey === item.key ? '●' : '○'}</Text>
          </Pressable>
        ))}
      </Section>
      <Card tone="mint">
        <Kicker>상대에게 보이는 제안</Kicker>
        <Text style={styles.runQuestion}>{proposal ? proposal.label : '위에서 러닝 하나를 선택해 주세요'}</Text>
        <Text style={styles.cardText}>지금은 함께 뛸 의향만 물어봐요. 자세한 시간과 장소는 서로 수락한 뒤 대화로 정해요.</Text>
      </Card>
      {!candidate.requestEligible ? <Notice text="아직 이 러너에게 제안할 수 없어요. 발견 화면에서 최신 상태를 확인해 주세요." /> : <Text style={styles.caption}>요청은 무료예요. 전송할 때 서버가 요청 자격·한도·최근 요청 여부를 다시 확인해요.</Text>}
      <SafetyGuide />
      {error ? <Notice text={error} /> : null}
      <PrimaryButton label={sent ? '제안을 보냈어요' : sending ? '제안 보내는 중…' : '이 러닝 함께하자고 제안하기'} disabled={sending || sent || !proposal || !candidate.requestEligible} onPress={() => void submit()} />
      <Text style={styles.caption}>상대가 수락해야 대화가 열려요. 응답을 재촉하지 않고 기다려 주세요.</Text>
      <Pressable accessibilityRole="button" style={styles.reportLink} onPress={() => onReport(candidate)}>
        <Text style={styles.reportLinkText}>이 러너를 신고하거나 차단하기</Text>
      </Pressable>
    </>
  );
}

export function ProfileScreen({ recentRuns, privacy, moderationNotices, signedIn, onOpenRun, onOpenAccount, onLogout }: {
  recentRuns: RunListItem[];
  privacy: PrivacyController;
  moderationNotices: ModerationNotice[];
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
      <Text style={styles.pageTitle}>프로필과 설정</Text>
      <Text style={styles.pageSub}>내 기록과 발견 참여는 언제든 내가 결정해요.</Text>
      {signedIn ? <MatchPreferencesSettings /> : null}
      {signedIn ? <RunnerIntroductionSettings /> : null}

      {privacy.isLoading && !status ? <Notice text="공개 설정을 불러오고 있어요…" /> : null}
      {privacy.notice ? <Notice text={privacy.notice} /> : null}
      {privacy.error ? <Notice text={privacy.error} /> : null}

      {status && !status.ageVerificationComplete ? (
        <Card tone="yellow">
          <Text style={styles.listTitle}>러닝 메이트 기능은 성인 인증 후 열려요</Text>
          <Text style={styles.cardText}>실제 본인확인 제공사 연동을 준비하고 있어요. 가입 시 성인 확인만으로 인증이 완료되지는 않으며, 연동 전에는 발견·요청·채팅이 제한돼요.</Text>
          <PrimaryButton label="인증 상태 다시 확인" disabled={privacy.isLoading} onPress={() => void privacy.refresh()} />
          <Text style={styles.caption}>러닝 기록 저장·삭제와 공개 범위 변경은 계속 사용할 수 있어요.</Text>
        </Card>
      ) : null}

      {status ? (
        <>
          <Text style={styles.sectionTitle}>나의 러닝 업적</Text>
          <Card tone="mint">
            <Text style={styles.listTitle}>{achievementInfo(status.primaryAchievement).icon} {achievementInfo(status.primaryAchievement).title}</Text>
            <Text style={styles.cardText}>{achievementInfo(status.primaryAchievement).description}</Text>
            <View style={styles.tagRow}>
              {status.achievementCodes.map((code) => {
                const achievement = achievementInfo(code);
                return <View key={code} style={styles.tag}><Text style={styles.tagText}>{achievement.icon} {achievement.title}</Text></View>;
              })}
            </View>
          </Card>
        </>
      ) : null}

      {/* 제재를 받았다면 사유·기간·이의제기 방법을 본인에게 알려야 한다.
          신고자와 내부 메모는 뷰 자체가 노출하지 않는다. */}
      {moderationNotices.map((item) => (
        <Card key={item.id} tone="yellow">
          <Text style={styles.listTitle}>이용 제한 안내</Text>
          <Text style={styles.cardText}>{item.userNotice ?? '운영 검토에 따라 일부 기능이 제한되었어요.'}</Text>
          <Text style={styles.caption}>
            {formatRunDate(item.startsAt)} 시작
            {item.endsAt ? ` · ${formatRunDate(item.endsAt)} 해제 예정` : ' · 해제 시점은 검토 결과에 따라 안내돼요'}
          </Text>
        </Card>
      ))}

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

export function ReportScreen({ target, busy, notice, error, onBack, onSubmit, onBlock }: {
  target: { id: string; nickname: string } | null;
  busy: boolean;
  notice: string | null;
  error: string | null;
  onBack: () => void;
  onSubmit: (reason: ProfileReportReason, details: string) => void;
  onBlock: () => void;
}) {
  const [reason, setReason] = useState<ProfileReportReason>('stalking');
  const [details, setDetails] = useState('');

  const confirmBlock = () => {
    if (!target) return;
    Alert.alert(
      `${target.nickname}님을 차단할까요?`,
      '서로의 발견 카드와 요청, 대화에서 즉시 제외됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '차단', style: 'destructive', onPress: onBlock },
      ],
    );
  };

  return (
    <>
      <Back onPress={onBack} />
      <Kicker>안전 센터</Kicker>
      <Text style={styles.pageTitle}>신고 또는 차단</Text>
      <Text style={styles.pageSub}>
        {target ? `${target.nickname}님에 대한 신고예요. ` : ''}차단하면 서로의 발견 카드와 요청에서 즉시 제외됩니다.
      </Text>
      <Card tone="yellow"><Text style={styles.listTitle}>긴급한 위험이 있나요?</Text><Text style={styles.cardText}>즉시 112 등 긴급 도움을 요청하세요. 서비스 신고는 안전 대응을 위한 보조 수단입니다.</Text></Card>
      <SafetyGuide />

      {notice ? <Notice text={notice} /> : null}
      {error ? <Notice text={error} /> : null}

      {target ? (
        <>
          <Section title="신고 사유">
            <ChoiceGroup
              options={reportReasonOptions.map((option) => option.label)}
              value={reportReasonOptions.find((option) => option.key === reason)?.label ?? ''}
              onChange={(label) => {
                const found = reportReasonOptions.find((option) => option.label === label);
                if (found) setReason(found.key);
              }}
            />
          </Section>
          <TextInput
            style={styles.detailsInput}
            value={details}
            onChangeText={setDetails}
            placeholder="어떤 일이 있었는지 알려주세요. (선택)"
            placeholderTextColor="#93A39E"
            multiline
            maxLength={2000}
          />
          <Text style={styles.caption}>접수 시 조회 가능한 프로필 소개와 러닝 성향을 서버가 보존해요. 이미 차단·숨김 처리된 경우 현재 본문은 수집하지 않으니 어떤 일이 있었는지 적어 주세요. 신고자 정보는 상대에게 공개되지 않아요.</Text>
          <PrimaryButton
            label={busy ? '접수 중…' : '신고 제출하기'}
            disabled={busy}
            onPress={() => onSubmit(reason, details)}
          />
          <Pressable style={styles.blockButton} onPress={confirmBlock}>
            <Text style={styles.blockText}>이 사용자 차단하기</Text>
          </Pressable>
        </>
      ) : (
        <Card>
          <Text style={styles.listTitle}>신고할 상대를 먼저 선택해 주세요</Text>
          <Text style={styles.cardText}>발견 카드나 대화에서 신고할 상대를 고르면 사유를 선택할 수 있어요.</Text>
        </Card>
      )}
    </>
  );
}
