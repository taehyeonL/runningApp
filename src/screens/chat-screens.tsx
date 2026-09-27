import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { reportReasons, type ChatMessage, type ReportReason } from '../features/chat/chat-api';
import type { ChatController } from '../hooks/use-chat';
import { Back, Card, ChoiceGroup, Kicker, Notice, SafetyGuide, Section } from '../ui/components';
import { styles } from '../ui/styles';
import { conversationStarters } from '../features/chat/conversation-starters';
import { RunningAppointmentPanel } from './launch-experience';

function messageTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function threadTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? messageTime(value)
    : new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(date);
}

export function ChatListScreen({ chat, onBack, onOpenThread }: {
  chat: ChatController;
  onBack: () => void;
  onOpenThread: (partnerId: string) => void;
}) {
  return (
    <>
      <Back onPress={onBack} />
      <Kicker>대화</Kicker>
      <Text style={styles.pageTitle}>수락한 러너와의 대화</Text>
      <Text style={styles.pageSub}>요청을 서로 수락한 상대와만 대화할 수 있어요. 차단하면 대화가 닫히며, 신고는 운영 검토와 안전 조치로 이어져요.</Text>
      {chat.error ? <Notice text={chat.error} /> : null}

      {chat.threads.length === 0 ? (
        <Card compact>
          <View>
            <Text style={styles.listTitle}>{chat.isLoading ? '대화를 불러오는 중…' : '아직 열린 대화가 없어요'}</Text>
            <Text style={styles.caption}>발견 화면에서 요청을 보내고 서로 수락하면 대화가 열려요.</Text>
          </View>
        </Card>
      ) : null}

      {chat.threads.map((thread) => (
        <Pressable key={thread.partnerId} onPress={() => onOpenThread(thread.partnerId)}>
          <Card compact>
            <View style={styles.threadRow}>
              <View style={styles.avatar}><Text>{thread.partnerNickname.slice(0, 1)}</Text></View>
              <View style={styles.threadCopy}>
                <Text style={styles.listTitle}>{thread.partnerNickname}</Text>
                <Text style={styles.threadPreview} numberOfLines={1}>
                  {thread.lastMessageBody
                    ? `${thread.lastMessageMine ? '나: ' : ''}${thread.lastMessageBody}`
                    : '아직 주고받은 메시지가 없어요'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.threadTime}>{threadTime(thread.lastMessageAt)}</Text>
                {thread.unreadCount > 0 ? (
                  <View style={styles.unreadBadge}><Text style={styles.unreadText}>{thread.unreadCount}</Text></View>
                ) : null}
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

export function ChatThreadScreen({ chat, userId, onBack, onBlock }: {
  chat: ChatController;
  userId?: string;
  onBack: () => void;
  onBlock?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>('hate');
  const [reportDetails, setReportDetails] = useState('');
  const sendingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const partner = chat.openThreadSummary;
  const canCompose = Boolean(userId && partner && partner.partnerId === chat.openPartnerId && !chat.isLoading);
  const busy = chat.isSending || submitting;

  const submit = () => {
    if (!canCompose || busy || sendingRef.current || !draft.trim()) return;
    sendingRef.current = true;
    setSubmitting(true);
    const body = draft;
    setDraft('');
    void chat.send(body).catch(() => setDraft((current) => current || body)).finally(() => {
      sendingRef.current = false;
      setSubmitting(false);
    });
  };

  // 신고는 받은 메시지에만 열린다. 내가 쓴 말을 신고해 상대 기록을 더럽히는
  // 경로를 UI에서도 막아 둔다. 최종 판정은 서버가 다시 한다.
  const startReport = (message: ChatMessage) => {
    if (message.senderId === userId) return;
    setReportTarget(message);
    setReportReason('hate');
    setReportDetails('');
  };

  const confirmReport = () => {
    if (!reportTarget) return;
    Alert.alert(
      '이 메시지를 신고할까요?',
      '메시지 원문과 받은 시각이 증거로 함께 접수돼요. 신고 후에는 이 상대와의 대화가 닫힐 수 있어요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '신고',
          style: 'destructive',
          onPress: () => {
            void chat.report(reportTarget.id, reportReason, reportDetails)
              .then(() => setReportTarget(null))
              .catch(() => undefined);
          },
        },
      ],
    );
  };

  // 목록은 inverted로 그린다. 대화는 최신 메시지가 바닥에 있어야 하는데,
  // 일반 목록이면 열 때마다 맨 위(가장 오래된 메시지)에서 시작해 매번 끝까지
  // 스크롤해야 한다. inverted는 데이터를 뒤집어 자연스럽게 바닥에서 시작한다.
  const newestFirst = useMemo(() => [...chat.messages].reverse(), [chat.messages]);

  const intro = (
    <View style={styles.threadIntro}>
      <Back onPress={onBack} />
      <Kicker>대화</Kicker>
      <Text style={styles.pageTitle}>{partner?.partnerNickname ?? '대화'}</Text>
      {partner && onBlock ? <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onBlock}><Text style={styles.reportLinkText}>이 러너 차단하기</Text></Pressable> : null}
      <Text style={styles.pageSub}>정확한 위치나 집·직장을 묻는 메시지는 받지 않아도 돼요. 불편하면 메시지를 눌러 바로 신고할 수 있어요.</Text>

      {/* 약속을 잡는 자리가 바로 이 화면이므로 안전 가이드도 여기 둔다.
          아직 주고받은 메시지가 없으면 펼친 채로 보여준다. */}
      <SafetyGuide defaultExpanded={chat.messages.length === 0} />
      {canCompose && partner && userId ? <RunningAppointmentPanel key={partner.partnerId} partnerId={partner.partnerId} userId={userId} /> : null}

      {chat.notice ? <Notice text={chat.notice} /> : null}
      {chat.error ? <Notice text={chat.error} /> : null}

      {chat.messages.length === 0 && canCompose && !chat.error ? (
        <Card tone="mint">
          <Kicker>서로의 러닝을 알아가는 첫인사</Kicker>
          <Text style={styles.runQuestion}>같이 뛰기 전, 가볍게 인사해요</Text>
          <Text style={styles.cardText}>문구를 고르면 입력창에 담겨요. 내 말투로 고친 뒤 직접 전송해 주세요.</Text>
          {conversationStarters.map((starter) => <Pressable key={starter.id} accessibilityRole="button" accessibilityLabel={`${starter.label}, 입력창에 담기`} disabled={busy || Boolean(draft.trim())} onPress={() => setDraft(starter.body)} style={[styles.starterOption, (busy || Boolean(draft.trim())) && styles.buttonDisabled]}><Text style={styles.secondaryText}>{starter.label} ↗</Text></Pressable>)}
          {draft.trim() ? <Text style={styles.caption}>작성 중인 첫인사를 아래 입력창에서 확인해 주세요.</Text> : null}
          <Text style={styles.caption}>집·직장·정확한 러닝 경로 대신, 편한 페이스와 러닝 스타일부터 알아가요.</Text>
        </Card>
      ) : null}
      {chat.messages.length === 0 && chat.isLoading ? <Notice text="대화를 불러오는 중…" /> : null}
      {!chat.isLoading && !canCompose ? <Notice text="지금 대화할 수 있는 상대인지 확인하지 못했어요. 목록으로 돌아가 다시 확인해 주세요." /> : null}
      {chat.isLoadingOlder ? (
        <View style={styles.olderNotice}><Text style={styles.caption}>이전 대화를 불러오는 중…</Text></View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.threadList}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        style={styles.threadList}
        contentContainerStyle={styles.threadListContent}
        data={newestFirst}
        inverted
        keyExtractor={(message) => message.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // inverted라 목록의 "끝"은 가장 오래된 메시지 쪽이다. 거기 닿으면
        // 이전 대화를 이어 붙인다.
        onEndReached={() => void chat.loadOlder()}
        onEndReachedThreshold={0.4}
        // inverted에서 헤더는 화면 아래, 푸터는 화면 위에 그려진다.
        ListFooterComponent={intro}
        renderItem={({ item: message }) => {
          const mine = message.senderId === userId;
          const selected = reportTarget?.id === message.id;
          return (
            <Pressable
              onPress={() => (mine ? undefined : startReport(message))}
              style={[styles.bubbleRow, mine && styles.bubbleMineRow]}
            >
              <View style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                selected && styles.bubbleSelected,
              ]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
                <Text style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}>
                  {messageTime(message.createdAt)}{mine && message.readAt ? ' · 읽음' : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {reportTarget ? (
        <>
          <Section title="이 메시지 신고">
            <Card>
              <Text style={styles.caption}>신고 대상 메시지</Text>
              <Text style={styles.bubbleText} numberOfLines={3}>{reportTarget.body}</Text>
            </Card>
            <ChoiceGroup
              options={reportReasons.map((reason) => reason.label)}
              value={reportReasons.find((reason) => reason.key === reportReason)?.label ?? ''}
              onChange={(label) => {
                const found = reportReasons.find((reason) => reason.label === label);
                if (found) setReportReason(found.key);
              }}
            />
            <TextInput
              style={styles.detailsInput}
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder="상황을 더 알려주시면 검토에 도움이 돼요. (선택)"
              placeholderTextColor="#93A39E"
              multiline
              maxLength={2000}
            />
          </Section>
          <View style={styles.requestActions}>
            <Pressable style={styles.requestSecondary} onPress={() => setReportTarget(null)}>
              <Text style={styles.secondaryText}>취소</Text>
            </Pressable>
            <Pressable
              disabled={chat.isSending}
              style={[styles.requestPrimary, chat.isSending && styles.buttonDisabled]}
              onPress={confirmReport}
            >
              <Text style={styles.primaryText}>{chat.isSending ? '접수 중…' : '신고 접수'}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={draft}
            editable={canCompose && !busy}
            onChangeText={setDraft}
            placeholder="메시지를 입력하세요"
            placeholderTextColor="#93A39E"
            multiline
            maxLength={2000}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="메시지 전송"
            disabled={!canCompose || busy || draft.trim().length === 0}
            style={[styles.sendButton, (!canCompose || busy || draft.trim().length === 0) && styles.buttonDisabled]}
            onPress={submit}
          >
            <Text style={styles.primaryText}>{busy ? '…' : '전송'}</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
