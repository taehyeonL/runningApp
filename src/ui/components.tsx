import { StatusBar } from 'expo-status-bar';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Pressable,
  Platform,
  StatusBar as NativeStatusBar,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  firstMeetingGuideFooter,
  firstMeetingGuideItems,
  firstMeetingGuideSummary,
  firstMeetingGuideTitle,
} from '../features/safety/safety-guide';
import type { DiscoveryCandidate } from '../features/social/social-types';
import { achievementInfo } from '../features/running/runner-achievements';
import { runnerCardPresentation } from '../features/social/runner-card-presentation';
import type { MainTab, Screen } from '../navigation/routes';
import { styles } from './styles';

export function AppShell({
  children,
  screen,
  showNavigation,
  scrollable = true,
  onNavigate,
}: PropsWithChildren<{
  screen: Screen;
  showNavigation: boolean;
  // 화면이 스스로 가상화 목록을 관리해야 하면 껍데기 ScrollView를 비운다.
  // ScrollView 안에 같은 방향의 FlatList를 넣으면 가상화가 무력화된다.
  scrollable?: boolean;
  onNavigate: (screen: Screen) => void;
}>) {
  return (
    <SafeAreaView style={[styles.safe, Platform.OS === 'android' && { paddingTop: NativeStatusBar.currentHeight ?? 0, paddingBottom: 16 }]}>
      <StatusBar style="dark" />
      {scrollable ? (
        <ScrollView key={screen} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.shellPlain}>{children}</View>
      )}
      {showNavigation ? (
        <BottomNavigation activeScreen={screen} onNavigate={onNavigate} />
      ) : null}
    </SafeAreaView>
  );
}

function BottomNavigation({
  activeScreen,
  onNavigate,
}: {
  activeScreen: Screen;
  onNavigate: (screen: MainTab) => void;
}) {
  const items: Array<{ screen: MainTab; icon: string; label: string }> = [
    { screen: 'home', icon: 'home', label: '홈' },
    { screen: 'discover', icon: 'discover', label: '발견' },
    { screen: 'friends', icon: 'friends', label: '친구' },
    { screen: 'profile', icon: 'profile', label: '프로필' },
  ];
  return (
    <View style={styles.navBar}>
      {items.map((item) => {
        const selected = activeScreen === item.screen;
        return (
          <Pressable key={item.screen} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected }} onPress={() => onNavigate(item.screen)} style={styles.navItem}>
            <NavigationGlyph name={item.screen} selected={selected} />
            <Text style={[styles.navText, selected && styles.navSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Dependency-free outline icons; labels remain the accessible tab names.
function NavigationGlyph({ name, selected }: { name: MainTab; selected: boolean }) {
  const color = selected ? '#202A24' : '#717A72';
  const stroke = { borderColor: color, borderWidth: 1.7 };
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.navGlyph}>
    {name === 'home' ? <>
      <View style={[stroke, { position: 'absolute', top: 3, width: 14, height: 14, transform: [{ rotate: '45deg' }], borderBottomWidth: 0, borderRightWidth: 0 }]} />
      <View style={[stroke, { position: 'absolute', bottom: 1, width: 16, height: 13, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }]} />
    </> : name === 'discover' ? <>
      <View style={[stroke, { width: 21, height: 21, borderRadius: 11 }]} />
      <View style={{ position: 'absolute', width: 5, height: 12, borderRadius: 2, backgroundColor: color, transform: [{ rotate: '35deg' }] }} />
    </> : <>
      <View style={[stroke, { position: 'absolute', top: 1, left: name === 'friends' ? 2 : 8, width: 8, height: 8, borderRadius: 4 }]} />
      <View style={[stroke, { position: 'absolute', bottom: 1, left: name === 'friends' ? 0 : 4, width: 16, height: 10, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 0 }]} />
      {name === 'friends' ? <>
        <View style={[stroke, { position: 'absolute', top: 3, right: 0, width: 7, height: 7, borderRadius: 4 }]} />
        <View style={[stroke, { position: 'absolute', bottom: 1, right: 0, width: 7, height: 10, borderTopRightRadius: 8, borderBottomWidth: 0, borderLeftWidth: 0 }]} />
      </> : null}
    </>}
  </View>;
}

export function SocialButton({ label, symbol, dark, yellow, disabled, onPress }: {
  label: string;
  symbol: string;
  dark?: boolean;
  yellow?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.socialButton,
        dark && styles.socialDark,
        yellow && styles.socialYellow,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.socialSymbol, dark && styles.socialDarkText]}>{symbol}</Text>
      <Text style={[styles.socialLabel, dark && styles.socialDarkText]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, (disabled || pressed) && styles.buttonDisabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.back}>
      <Text style={styles.backText}>‹</Text>
      <Text style={styles.backLabel}>뒤로</Text>
    </Pressable>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function Notice({ text }: { text: string }) {
  return <View style={styles.notice}><Text style={styles.noticeText}>{text}</Text></View>;
}

export function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

export function Card({ children, tone, compact = false }: PropsWithChildren<{
  tone?: 'mint' | 'dark' | 'yellow';
  compact?: boolean;
}>) {
  return (
    <View style={[
      styles.card,
      tone === 'mint' && styles.mintCard,
      tone === 'dark' && styles.darkCard,
      tone === 'yellow' && styles.yellowCard,
      compact && styles.compactCard,
    ]}>
      {children}
    </View>
  );
}

// 첫 만남 안전 가이드. 대화 화면에서는 접힌 상태로 시작해 대화를 가리지 않되,
// 완전히 숨기지는 않는다. 안전 안내는 사용자가 찾아 들어가야 하는 정보가 아니라
// 약속을 잡는 자리에 늘 보여야 하는 정보이기 때문이다.
export function SafetyGuide({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Card tone="yellow">
      <Pressable onPress={() => setExpanded(!expanded)}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.listTitle}>{firstMeetingGuideTitle}</Text>
            <Text style={styles.cardText}>{firstMeetingGuideSummary}</Text>
          </View>
          <Text style={styles.arrow}>{expanded ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          {firstMeetingGuideItems.map((item) => (
            <View key={item.title} style={styles.guideItem}>
              <Text style={styles.guideSymbol}>{item.symbol}</Text>
              <View style={styles.guideCopy}>
                <Text style={styles.guideTitle}>{item.title}</Text>
                <Text style={styles.cardText}>{item.body}</Text>
              </View>
            </View>
          ))}
          <View style={styles.divider} />
          <Text style={styles.cardText}>{firstMeetingGuideFooter}</Text>
        </>
      ) : null}
    </Card>
  );
}

export function Metric({ label, value, unit, dark }: {
  label: string;
  value: string;
  unit: string;
  dark?: boolean;
}) {
  return (
    <View>
      <Text style={[styles.metricValue, dark && styles.metricDark]}>
        {value}<Text style={[styles.metricUnit, dark && styles.metricDarkLabel]}>{unit}</Text>
      </Text>
      <Text style={[styles.metricLabel, dark && styles.metricDarkLabel]}>{label}</Text>
    </View>
  );
}

export function CheckRow({ label, checked, onPress, required }: {
  label: string;
  checked: boolean;
  onPress: () => void;
  required?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        <Text style={styles.checkText}>{checked ? '✓' : ''}</Text>
      </View>
      <Text style={styles.checkLabel}>
        {label}{required ? <Text style={styles.required}> (필수)</Text> : null}
      </Text>
    </Pressable>
  );
}

export function ChoiceGroup({ options, value, onChange }: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.choiceGroup}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.chip, value === option && styles.chipSelected]}
        >
          <Text style={[styles.chipText, value === option && styles.chipTextSelected]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ToggleRow({ title, description, value, onChange }: {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.listTitle}>{title}</Text>
        <Text style={styles.caption}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#D8E1E5', true: '#1FAF8B' }}
      />
    </View>
  );
}

const similarityLabels: Record<DiscoveryCandidate['similarityLabel'], string> = {
  good_match: '잘 맞음',
  quite_good_match: '꽤 잘 맞음',
  new_rhythm: '새로운 리듬',
};
export function RunnerCard({ candidate, expanded = false, onPress, viewerAvailabilitySlots = [] }: {
  candidate: DiscoveryCandidate;
  expanded?: boolean;
  onPress?: () => void;
  viewerAvailabilitySlots?: string[];
}) {
  const presentation = runnerCardPresentation(candidate, viewerAvailabilitySlots);
  const title = achievementInfo(candidate.profile.primaryAchievement);
  const body = (
    <Card>
      <View style={styles.runnerTop}>
        <View style={styles.blurAvatar}><Text style={styles.emptySymbol}>{title.icon}</Text></View>
        <View style={styles.runnerInfo}>
          <Text style={styles.listTitle}>{candidate.profile.nickname}</Text>
          <Text style={styles.caption}>{candidate.profile.ageBand ?? '연령대 비공개'}</Text>
        </View>
      </View>
      <View style={styles.mateHighlight}>
        <Text style={styles.cardEyebrow}>{presentation.commonActivity ? '우리의 공통 리듬' : '함께 달리기 전, 알아볼까요'}</Text>
        <Text style={styles.mateHeadline}>{presentation.headline}</Text>
        <Text style={styles.caption}>러닝 궁합 · {similarityLabels[candidate.similarityLabel]}</Text>
      </View>
      <View style={styles.mateFacts}>
        <View style={styles.mateFact}><Text style={styles.caption}>페이스 범위</Text><Text style={styles.listTitle}>{presentation.pace}</Text></View>
        <View style={styles.mateFact}><Text style={styles.caption}>{presentation.commonActivity ? '나와 겹치는 활동 시간대' : '주로 달리는 시간대'}</Text><Text style={styles.listTitle}>{presentation.commonActivity ?? presentation.activity}</Text></View>
      </View>
      {presentation.styles.length ? <View style={styles.tagRow}>{presentation.styles.map((tag) => <Tag key={tag} label={tag} />)}</View> : null}
      {expanded ? (
        <>
          {presentation.reasons.length ? <View style={styles.reasonList}>{presentation.reasons.map((reason) => <Text key={reason} style={styles.cardText}>· {reason}</Text>)}</View> : null}
          <View style={styles.runnerLine} />
          {candidate.profile.bio ? <Text style={styles.cardText}>{candidate.profile.bio}</Text> : null}
          {candidate.profile.conversationPreference === 'chatty' ? <Text style={styles.caption}>이야기하며 달려요</Text> : candidate.profile.conversationPreference === 'quiet' ? <Text style={styles.caption}>러닝에 집중해요</Text> : null}
          {candidate.profile.preferredDistance && candidate.profile.preferredDistance !== 'any' ? <Text style={styles.caption}>편한 거리 · {candidate.profile.preferredDistance === 'short' ? '3km 안팎' : candidate.profile.preferredDistance === '5k' ? '5km 정도' : '10km 정도'}</Text> : null}
          <Text style={styles.caption}>{title.title} · 완료 {candidate.profile.completedRunCount}회</Text>
          {candidate.repeatEncounters30d > 0 ? <Text style={styles.caption}>최근 한 달, 러닝 리듬이 {candidate.repeatEncounters30d}회 겹쳤어요.</Text> : null}
          {candidate.safeOverlapSummary ? <Text style={styles.caption}>{candidate.safeOverlapSummary}</Text> : null}
          {presentation.intents.length ? <Text style={styles.caption}>기대하는 관계 · {presentation.intents.join(' · ')}</Text> : null}
          <Text style={styles.cardCta}>{candidate.requestEligible ? '가볍게 같이 뛰자고 제안하기 →' : '리듬이 조금 더 쌓이면 요청이 열려요'}</Text>
          <Text style={styles.caption}>정확한 장소와 시각은 서로에게 보이지 않아요.</Text>
        </>
      ) : null}
    </Card>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityHint="같이 뛰기 요청 화면을 열어요" onPress={onPress}>{body}</Pressable> : body;
}

function Tag({ label }: { label: string }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>;
}
