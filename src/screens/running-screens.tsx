import { useState } from 'react';
import { GardenRunReward } from './live-garden-screen';
import { useRunCompletion } from '../hooks/use-run-completion';
import { completionState } from '../features/running/completion-state';
import { Alert, Pressable, Text, View } from 'react-native';
import { filterRunHistory, weeklyRhythm } from '../features/running/run-insights';

import type { RunListItem } from '../features/running/run-types';
import type { RunRecorderController } from '../hooks/use-run-recorder';
import type { RunCoachController } from '../hooks/use-run-coach';
import { recommendedRunPlan, runPlans, type RunPlan } from '../features/running/run-plans';
import { Back, Card, ChoiceGroup, Kicker, Metric, Notice, PrimaryButton, Section, ToggleRow } from '../ui/components';
import { RunRouteMap } from '../ui/run-route-map';
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

export function HomeScreen({ recorder, notice, trainingGoal, onStart, onStartPlan, onDiscover, onOpenRun, onOpenGarden }: {
  recorder: RunRecorderController;
  notice: string;
  trainingGoal?: string;
  onStart: () => void;
  onStartPlan: () => void;
  onDiscover: () => void;
  onOpenRun: (run: RunListItem) => void;
  onOpenGarden: () => void;
}) {
  const today = new Date();
  const thisMonthRuns = recorder.recentRuns.filter((run) => {
    const date = new Date(run.startedAt);
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  });
  const thisMonthDistance = thisMonthRuns.reduce((total, run) => total + run.distanceMeters, 0);
  const [period, setPeriod] = useState('이번 달');
  const [showAll, setShowAll] = useState(false);
  const rhythm = weeklyRhythm(recorder.recentRuns);
  const filteredRuns = filterRunHistory(recorder.recentRuns, period);
  const visibleRuns = showAll ? filteredRuns : filteredRuns.slice(0, 3);

  return (
    <>
      <View style={styles.header}><Text style={styles.homeBrand}>같이뛰어</Text><Text style={styles.caption}>{currentDateLabel()}</Text></View>
      <View style={[styles.editorialHero, styles.homeHero]}>
        <Text style={styles.heroEyebrow}>{recorder.activeRun ? '진행 중인 러닝' : '오늘의 러닝'}</Text>
        <Text style={styles.homeHeroTitle}>{recorder.activeRun ? '이어서 달리기' : '가볍게,\n한 번 달릴까요.'}</Text>
        <Text style={styles.heroCopy}>거리도 속도도 내 페이스대로.</Text>
        <Pressable accessibilityRole="button" disabled={recorder.isBusy} onPress={onStart} style={[styles.heroAction, recorder.isBusy && styles.buttonDisabled]}><Text style={styles.heroActionText}>{recorder.isBusy ? '준비하는 중…' : recorder.activeRun ? '진행 중인 러닝 이어보기 →' : '자유 러닝 시작 →'}</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="러닝 메이트 발견하기" onPress={onDiscover}>
        <View style={styles.mateEntry}>
          <View style={styles.sectionHeader}><Text style={styles.mateEntryTitle}>함께 달릴 사람 찾기</Text><Text style={styles.arrow}>↗</Text></View>
          <Text style={styles.cardText}>페이스와 러닝 스타일이 맞는 메이트.</Text>
          <Text style={styles.caption}>정확한 위치는 비공개 · 대화는 서로 수락한 뒤</Text>
        </View>
      </Pressable>
      {notice ? <Notice text={notice} /> : null}
      <Text style={styles.sectionTitle}>나의 러닝 기록</Text>
      <View style={styles.flatSection}>
        <View style={styles.sectionHeader}><Text style={styles.listTitle}>이번 주</Text><Text style={styles.listMetric}>{rhythm.count}회</Text></View>
        <View style={styles.weekRow}>{rhythm.days.map((day) => <View key={day.key} style={styles.weekDay}><Text style={styles.caption}>{day.label}</Text><View accessibilityLabel={`${day.label}요일 ${day.count}회 완료${day.today ? ', 오늘' : ''}`} style={[styles.dayDot, day.count > 0 && styles.dayDone, day.today && styles.dayToday]}><Text style={[styles.dayMark, day.count > 0 && styles.dayMarkDone]}>{day.count > 0 ? '✓' : day.today ? '·' : '–'}</Text></View></View>)}</View>
        {trainingGoal === 'habit' ? <><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: Math.min(rhythm.count, 3) }} style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(rhythm.count / 3, 1) * 100}%` }]} /></View><Text style={styles.cardText}>{rhythm.count >= 3 ? '주 3회 목표 달성! 나만의 리듬을 잘 만들고 있어요.' : `주 3회 목표까지 ${3 - rhythm.count}회. 쉬는 날도 나의 페이스예요.`}</Text></> : <Text style={styles.cardText}>{rhythm.count ? `이번 주 ${formatDistance(rhythm.distance)}km를 달렸어요. 작은 꾸준함이 쌓이고 있어요.` : '이번 주 첫 발자국을 남겨볼까요?'}</Text>}
        <Text style={styles.caption}>불러온 최근 50개 중 검증 완료 기록 기준</Text>
      </View>
      <Card tone="mint">
        <Text style={styles.cardEyebrow}>이번 달 · 최근 50개 기록 기준</Text>
        <View style={styles.summaryRow}><Metric label="달린 거리" value={(thisMonthDistance / 1000).toFixed(1)} unit="km" /><Metric label="러닝" value={String(thisMonthRuns.length)} unit="회" /><Metric label="연속" value={String(runStreak(recorder.recentRuns))} unit="일" /></View>
      </Card>
      <Text style={styles.sectionTitle}>목표가 있는 날에는</Text>
      <Card>
        <Kicker>나를 위한 추천</Kicker>
        <Text style={styles.runQuestion}>{recommendedRunPlan(trainingGoal).title}</Text>
        <Text style={styles.cardText}>{recommendedRunPlan(trainingGoal).description}</Text>
        <PrimaryButton label={recorder.activeRun ? '진행 중인 러닝으로 돌아가기' : '오늘의 계획 둘러보기 →'} disabled={recorder.isBusy} onPress={recorder.activeRun ? onStart : onStartPlan} />
      </Card>
      <Text style={styles.sectionTitle}>나의 러닝 모음</Text>
      <ChoiceGroup options={['이번 주', '이번 달', '최근 50개']} value={period} onChange={(value) => { setPeriod(value); setShowAll(false); }} />
      <Card>
        {visibleRuns.map((run) => <Pressable accessibilityRole="button" key={run.id} onPress={() => onOpenRun(run)} style={styles.recordRow}><View style={styles.recordIcon}><Text style={styles.listMetric}>↗</Text></View><View style={styles.recordCopy}><Text style={styles.listTitle}>{formatDistance(run.distanceMeters)} km <Text style={styles.caption}>· {formatPace(run.averagePaceSeconds)} /km</Text></Text><Text style={styles.caption}>{formatRunDate(run.startedAt)} · {run.status === 'processing' ? '검증 중' : visibilityLabels[run.visibility]}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
        {!visibleRuns.length ? <><Text style={styles.listTitle}>{recorder.isHistoryLoading ? '기록을 불러오는 중…' : '이 기간의 기록이 아직 없어요'}</Text><Text style={styles.cardText}>오늘의 러닝으로 첫 페이지를 채워보세요.</Text></> : null}
        {filteredRuns.length > 3 ? <Pressable accessibilityRole="button" onPress={() => setShowAll(!showAll)} style={styles.quietButton}><Text style={styles.secondaryText}>{showAll ? '접기' : `기록 ${filteredRuns.length}개 모두 보기`}</Text></Pressable> : null}
        <Text style={styles.caption}>최근 50개 기록 안에서 찾아요.</Text>
      </Card>
      <Pressable accessibilityRole="button" accessibilityLabel="작은 러닝 보상, 나의 정원 열기" onPress={onOpenGarden}>
        <Card compact><View style={styles.recordCopy}><Text style={styles.listTitle}>작은 러닝 보상 · 나의 정원</Text><Text style={styles.caption}>달린 만큼 쌓이는 소소한 즐거움</Text></View><Text style={styles.arrow}>›</Text></Card>
      </Pressable>
    </>
  );
}

export function RunScreen({ recorder, coach, plan, notice, onBack, onHome, onFinish }: {
  recorder: RunRecorderController;
  coach: RunCoachController;
  plan: RunPlan | null;
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
      {plan ? <Card tone="yellow">
        <ToggleRow
          title="적응형 음성 코칭"
          description={coach.enabled
            ? `${coach.phase === 'warmup' ? '워밍업' : coach.phase === 'fast' ? '훈련 구간' : '회복 구간'} 안내 중 · 불편하면 바로 끄세요.`
            : plan.coachSummary}
          value={coach.enabled}
          onChange={coach.toggle}
        />
        <Text style={styles.caption}>의료·건강 진단이 아닌 운동 보조 안내입니다. 통증·어지러움이 있으면 즉시 멈추세요.</Text>
      </Card> : null}
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

export function PlanRunScreen({ trainingGoal, usualPaceSeconds, onBack, onStart }: { trainingGoal?: string; usualPaceSeconds: number | null; onBack: () => void; onStart: (plan: RunPlan) => void }) {
  const recommended = recommendedRunPlan(trainingGoal);
  const [selectedId, setSelectedId] = useState(recommended.id);
  const selected = runPlans.find((plan) => plan.id === selectedId) ?? recommended;
  const pace = usualPaceSeconds ? `${Math.floor(usualPaceSeconds / 60)}분 ${usualPaceSeconds % 60}초/km` : '아직 설정하지 않음';
  return <><Back onPress={onBack} /><Kicker>오늘의 러닝 메뉴</Kicker><Text style={styles.pageTitle}>오늘은 어떤 리듬인가요?</Text><Text style={styles.pageSub}>계획을 골라 살펴보고, 준비되면 시작하세요.</Text><Card tone="mint"><Text style={styles.listTitle}>내게 추천 · {recommended.title}</Text><Text style={styles.cardText}>가입 목표에 맞춰 골랐어요. 내 평소 페이스는 {pace}예요.</Text></Card>{[recommended, ...runPlans.filter((plan) => plan.id !== recommended.id)].map((plan, index) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected.id === plan.id }} key={plan.id} onPress={() => setSelectedId(plan.id)} style={selected.id === plan.id ? styles.planSelected : styles.planUnselected}><Card><View style={styles.sectionHeader}><Kicker>0{index + 1} {plan.id === recommended.id ? '· 추천' : ''}</Kicker><Text style={styles.listMetric}>{selected.id === plan.id ? '●' : '○'}</Text></View><Text style={styles.runQuestion}>{plan.title}</Text><Text style={styles.cardText}>{plan.description}</Text></Card></Pressable>)}<Card tone="dark"><Text style={styles.heroEyebrow}>오늘 선택한 계획</Text><Text style={[styles.runQuestion, styles.metricDark]}>{selected.title}</Text><Text style={styles.heroCopy}>{selected.coachSummary} 음성 안내는 달리는 중에도 켜고 끌 수 있어요.</Text></Card><PrimaryButton label="이 계획으로 러닝 시작 →" onPress={() => onStart(selected)} /><Text style={styles.caption}>몸 상태에 맞춰 언제든 쉬어가세요. 목표에 도달해도 기록은 직접 종료할 때까지 이어집니다.</Text></>;
}

export function RunCompleteScreen({ recorder, selectedRun, logBusy, logNotice, onHome, onDiscover, onGarden, onChangeVisibility, onDeleteRun }: {
  recorder: RunRecorderController;
  selectedRun: RunListItem | null;
  logBusy: boolean;
  logNotice: string | null;
  onGarden: () => void;
  onHome: () => void;
  onDiscover: () => void;
  onChangeVisibility: (run: RunListItem, visibility: RunListItem['visibility']) => void;
  onDeleteRun: (run: RunListItem) => void;
}) {
  const summary = selectedRun ? null : recorder.lastRun;
  // 방금 끝낸 러닝과 목록에서 다시 연 기록 모두 같은 세션 id로 경로를 그린다.
  const routeSessionId = selectedRun?.id ?? summary?.sessionId ?? null;
  const completion = useRunCompletion(routeSessionId);
  const { distance, duration, pace, processing } = completionState(selectedRun, summary, completion.run);

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
      <View style={styles.editorialHero}>
        <View pointerEvents="none" accessibilityElementsHidden style={styles.trackArt} />
        <Text style={styles.heroEyebrow}>ONE MORE RUN, ALL YOURS</Text>
        <Text style={styles.heroTitle}>오늘의 나에게, 박수.</Text>
        <Text style={styles.celebrationNumber}>{formatDistance(distance)}<Text style={styles.distanceUnit}> km</Text></Text>
        <Text style={styles.heroCopy}>달린 만큼 쌓였어요. 이 리듬은 온전히 나의 것.</Text>
        <View style={styles.runStats}><Metric dark label="러닝 시간" value={formatDuration(duration)} unit="" /><Metric dark label="평균 페이스" value={formatPace(pace)} unit="/km" /></View>
      </View>
      <Text style={styles.pageSub}>{processing ? '기록 업로드를 마쳤고 서버에서 GPS 품질과 매칭 가능 여부를 확인하고 있어요.' : '서버 검증을 완료한 러닝 기록이에요.'}</Text>
      {completion.error ? <Notice text={completion.error} /> : null}
      {routeSessionId ? <GardenRunReward key={routeSessionId} sessionId={routeSessionId} onGarden={onGarden} /> : null}
      {routeSessionId ? (
        <>
          <Text style={styles.sectionTitle}>내가 달린 경로</Text>
          <RunRouteMap sessionId={routeSessionId} />
          <Text style={styles.caption}>이 지도는 나만 볼 수 있어요. 다른 사용자에게는 공개 로그에서도 정확한 경로와 출발·도착 지점을 보여주지 않아요. 원본 좌표는 러닝 시작으로부터 30일이 지나면 파기돼요.</Text>
        </>
      ) : null}
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
