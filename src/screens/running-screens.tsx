import { Alert, Pressable, Text, View } from 'react-native';

import type { RunListItem } from '../features/running/run-types';
import type { RunRecorderController } from '../hooks/use-run-recorder';
import { Back, Card, ChoiceGroup, Kicker, Metric, Notice, PrimaryButton, Section } from '../ui/components';
import { styles } from '../ui/styles';
import {
  currentDateLabel,
  formatDistance,
  formatDuration,
  formatPace,
  formatRunDate,
  runStreak,
  visibilityFromLabel,
  visibilityLabels,
  visibilityOptions,
} from '../utils/run-format';

export function HomeScreen({ recorder, notice, onStart, onDiscover, onOpenRun }: {
  recorder: RunRecorderController;
  notice: string;
  onStart: () => void;
  onDiscover: () => void;
  onOpenRun: (run: RunListItem) => void;
}) {
  const today = new Date();
  const thisMonthRuns = recorder.recentRuns.filter((run) => {
    const date = new Date(run.startedAt);
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  });
  const thisMonthDistance = thisMonthRuns.reduce((total, run) => total + run.distanceMeters, 0);
  const latestRun = recorder.recentRuns[0];

  return (
    <>
      <View style={styles.header}><View><Kicker>{currentDateLabel()}</Kicker><Text style={styles.hello}>안녕하세요, 러너 👋</Text></View><View style={styles.avatar}><Text>나</Text></View></View>
      <Card tone="mint">
        <Text style={styles.cardEyebrow}>이번 달</Text>
        <View style={styles.summaryRow}><Metric label="달린 거리" value={(thisMonthDistance / 1000).toFixed(1)} unit="km" /><Metric label="러닝" value={String(thisMonthRuns.length)} unit="회" /><Metric label="연속" value={String(runStreak(recorder.recentRuns))} unit="일" /></View>
      </Card>
      <Text style={styles.sectionTitle}>오늘의 러닝</Text>
      <Card>
        <Text style={styles.runQuestion}>어떤 리듬으로 달려볼까요?</Text>
        <Text style={styles.cardText}>러닝을 시작하면 위치 권한 사용 목적을 다시 알려드려요.</Text>
        <PrimaryButton label={recorder.activeRun ? '◉  진행 중인 러닝으로 돌아가기' : recorder.isBusy ? '러닝 준비 중…' : '◉  오늘의 러닝 시작'} disabled={recorder.isBusy} onPress={onStart} />
      </Card>
      {notice ? <Notice text={notice} /> : null}
      <Text style={styles.sectionTitle}>최근 기록</Text>
      {latestRun ? (
        <Pressable onPress={() => onOpenRun(latestRun)}><Card compact><View><Text style={styles.listTitle}>{latestRun.status === 'processing' ? '서버 검증 중인 러닝' : '완료한 러닝'}</Text><Text style={styles.caption}>{formatRunDate(latestRun.startedAt)} · {visibilityLabels[latestRun.visibility]}</Text></View><Text style={styles.listMetric}>{formatDistance(latestRun.distanceMeters)} km</Text></Card></Pressable>
      ) : (
        <Card compact><View><Text style={styles.listTitle}>{recorder.isHistoryLoading ? '기록을 불러오는 중…' : '아직 완료한 러닝이 없어요'}</Text><Text style={styles.caption}>첫 러닝을 시작해 나의 리듬을 기록해 보세요.</Text></View></Card>
      )}
      <Pressable onPress={onDiscover}><Card compact><View><Text style={styles.listTitle}>오늘 스친 러너</Text><Text style={styles.caption}>안전하게 추상화된 러닝 궁합을 확인해요</Text></View><Text style={styles.arrow}>›</Text></Card></Pressable>
    </>
  );
}

export function RunScreen({ recorder, notice, onBack, onHome, onFinish }: {
  recorder: RunRecorderController;
  notice: string;
  onBack: () => void;
  onHome: () => void;
  onFinish: () => void;
}) {
  const activeRun = recorder.activeRun;
  if (!activeRun) {
    return (
      <>
        <Back onPress={onHome} />
        <Kicker>러닝 기록</Kicker>
        <Text style={styles.pageTitle}>진행 중인 러닝이 없어요</Text>
        <Text style={styles.pageSub}>홈에서 위치 사용 방식을 확인하고 러닝을 시작해 주세요.</Text>
        {recorder.error ? <Notice text={recorder.error} /> : null}
        <PrimaryButton label="홈으로 돌아가기" onPress={onHome} />
      </>
    );
  }

  const isPaused = activeRun.status === 'paused';
  const isFinishing = activeRun.status === 'finishing';
  const discard = () => Alert.alert(
    '기록을 삭제할까요?',
    '서버에 전송된 GPS 포인트와 세션도 함께 삭제되며 복구할 수 없습니다.',
    [
      { text: '취소', style: 'cancel' },
      { text: '기록 삭제', style: 'destructive', onPress: () => void recorder.discard().then(onHome).catch(() => undefined) },
    ],
  );

  return (
    <>
      <Back onPress={onBack} />
      <Kicker>{isFinishing ? '동기화 대기' : isPaused ? '러닝 일시정지' : '러닝 진행 중'}</Kicker>
      <Text style={styles.pageTitle}>{isPaused ? '잠시 숨을 고르세요' : '나의 리듬을 따라 달려요'}</Text>
      <Card tone="dark">
        <Text style={styles.liveLabel}>{activeRun.trackingMode === 'background' ? 'BACKGROUND' : 'FOREGROUND'} · 위치는 나와 안전한 서버 처리만 확인해요</Text>
        <Text style={styles.distance}>{formatDistance(recorder.metrics.distanceMeters)}<Text style={styles.distanceUnit}> km</Text></Text>
        <View style={styles.runStats}><Metric dark label="시간" value={formatDuration(recorder.metrics.elapsedSeconds)} unit="" /><Metric dark label="평균 페이스" value={formatPace(recorder.metrics.averagePaceSeconds)} unit="/km" /></View>
      </Card>
      <Card>
        <Text style={styles.listTitle}>기록 품질 안내</Text>
        <Text style={styles.cardText}>수집 {recorder.metrics.totalPoints}개 · 품질 통과 {recorder.metrics.acceptedPoints}개 · 제외 {recorder.metrics.rejectedPoints}개{recorder.metrics.pendingPoints > 0 ? ` · 동기화 대기 ${recorder.metrics.pendingPoints}개` : ''}</Text>
        <Text style={styles.cardText}>정확도 30m 초과 또는 비정상 속도 구간은 앱 거리 계산에서 제외하며, 최종 3km·GPS 품질 판정은 서버가 다시 수행해요.</Text>
      </Card>
      {notice ? <Notice text={notice} /> : null}
      {recorder.error ? <Notice text={recorder.error} /> : null}
      <View style={styles.runControls}>
        <Pressable disabled={recorder.isBusy || isFinishing} onPress={() => void (isPaused ? recorder.resume() : recorder.pause()).catch(() => undefined)} style={[styles.secondaryButton, (recorder.isBusy || isFinishing) && styles.buttonDisabled]}><Text style={styles.secondaryText}>{isPaused ? '러닝 이어하기' : '일시정지'}</Text></Pressable>
        <Pressable disabled={recorder.isBusy} onPress={onFinish} style={[styles.finishButton, recorder.isBusy && styles.buttonDisabled]}><Text style={styles.primaryText}>{recorder.isBusy ? '처리 중…' : isFinishing ? '종료 다시 시도' : '러닝 종료'}</Text></Pressable>
      </View>
      <Pressable onPress={discard}><Text style={styles.destructiveText}>이 러닝 기록 삭제</Text></Pressable>
    </>
  );
}

export function RunCompleteScreen({ recorder, selectedRun, logBusy, logNotice, onHome, onDiscover, onChangeVisibility, onDeleteRun }: {
  recorder: RunRecorderController;
  selectedRun: RunListItem | null;
  logBusy: boolean;
  logNotice: string | null;
  onHome: () => void;
  onDiscover: () => void;
  onChangeVisibility: (run: RunListItem, visibility: RunListItem['visibility']) => void;
  onDeleteRun: (run: RunListItem) => void;
}) {
  const summary = selectedRun ? null : recorder.lastRun;
  const distance = summary?.distanceMeters ?? selectedRun?.distanceMeters ?? 0;
  const duration = summary?.durationSeconds ?? selectedRun?.durationSeconds ?? 0;
  const pace = summary?.averagePaceSeconds ?? selectedRun?.averagePaceSeconds ?? null;
  const processing = summary?.serverStatus === 'processing' || selectedRun?.status === 'processing';

  const confirmDelete = () => {
    if (!selectedRun) return;
    Alert.alert(
      '이 러닝 기록을 삭제할까요?',
      '원본 GPS와 이 기록으로 만들어진 발견 근거까지 함께 삭제되며 복구할 수 없어요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => onDeleteRun(selectedRun) },
      ],
    );
  };

  return (
    <>
      <Back onPress={onHome} />
      <View style={styles.completeMark}><Text style={styles.completeIcon}>✓</Text></View>
      <Kicker>러닝 완료</Kicker>
      <Text style={styles.pageTitle}>{formatDistance(distance)}km 기록했어요!</Text>
      <Text style={styles.pageSub}>{processing ? '기록 업로드를 마쳤고 서버에서 GPS 품질과 매칭 가능 여부를 확인하고 있어요.' : '서버 검증을 완료한 러닝 기록이에요.'}</Text>
      <Card tone="mint"><View style={styles.summaryRow}><Metric label="거리" value={formatDistance(distance)} unit="km" /><Metric label="시간" value={formatDuration(duration)} unit="" /><Metric label="평균 페이스" value={formatPace(pace)} unit="/km" /></View></Card>
      <Text style={styles.sectionTitle}>기록 처리 상태</Text>
      <Card><Text style={styles.listTitle}>{processing ? '서버 검증 중' : '검증 완료'}</Text><Text style={styles.cardText}>{processing ? `3km 이상, 비정상 속도, GPS 정확도를 다시 검증한 뒤 유효한 경우에만 발견 후보를 계산해요.${summary ? ` 수집 ${summary.totalPoints}개 중 클라이언트 품질 통과 ${summary.acceptedPoints}개예요.` : ''}` : '매칭 가능한 기록인지 서버 판정을 마쳤어요. 발견 화면에는 정확한 경로나 시각을 노출하지 않습니다.'}</Text></Card>

      {/* 공개 범위 변경과 삭제는 저장된 기록에만 적용한다. 방금 끝낸 러닝은
          서버가 아직 세션을 처리 중이라 목록에서 다시 열어야 한다. */}
      {selectedRun ? (
        <>
          <Section title="이 기록의 공개 범위">
            <ChoiceGroup
              options={visibilityOptions}
              value={visibilityLabels[selectedRun.visibility]}
              onChange={(label) => onChangeVisibility(selectedRun, visibilityFromLabel(label))}
            />
          </Section>
          <Text style={styles.caption}>공개 로그도 원본 경로와 출발·도착 지점은 표시하지 않고 거리·페이스 요약만 보여줘요.</Text>
          {logNotice ? <Notice text={logNotice} /> : null}
          <Pressable disabled={logBusy} onPress={confirmDelete}>
            <Text style={styles.destructiveText}>{logBusy ? '처리 중…' : '이 러닝 기록 삭제'}</Text>
          </Pressable>
        </>
      ) : null}

      <PrimaryButton label={processing ? '홈으로 돌아가기' : '발견 결과 확인하기'} onPress={processing ? onHome : onDiscover} />
    </>
  );
}
