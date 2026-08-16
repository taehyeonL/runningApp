import { StatusBar } from 'expo-status-bar';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Pressable,
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
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {scrollable ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
    { screen: 'home', icon: '⌂', label: '홈' },
    { screen: 'discover', icon: '◌', label: '발견' },
    { screen: 'profile', icon: '◎', label: '프로필' },
  ];
  return (
    <View style={styles.navBar}>
      {items.map((item) => {
        const selected = activeScreen === item.screen;
        return (
          <Pressable key={item.screen} onPress={() => onNavigate(item.screen)} style={styles.navItem}>
            <Text style={[styles.navIcon, selected && styles.navSelected]}>{item.icon}</Text>
            <Text style={[styles.navText, selected && styles.navSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
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
        {value}<Text style={styles.metricUnit}>{unit}</Text>
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
const tagLabels: Record<string, string> = {
  consistency_first: '기록보다 꾸준함',
  quiet_focus: '러닝 집중',
  weekend_runner: '주말 러너',
  beginner_friendly: '초보 환영',
  friends: '친구',
  running_mate: '러닝 메이트',
  dating_open: '연애 가능',
  no_preference: '상관없음',
};

export function RunnerCard({ candidate, expanded = false, onPress }: {
  candidate: DiscoveryCandidate;
  expanded?: boolean;
  onPress?: () => void;
}) {
  const tags = [...candidate.profile.runningStyleTags, ...candidate.profile.relationshipIntents]
    .slice(0, 3)
    .map((tag) => tagLabels[tag] ?? tag);
  const body = (
    <Card>
      <View style={styles.runnerTop}>
        <View style={styles.blurAvatar}><Text style={styles.blurText}>●</Text></View>
        <View style={styles.runnerInfo}>
          <Text style={styles.listTitle}>{candidate.profile.nickname}</Text>
          <Text style={styles.caption}>{candidate.profile.ageBand ?? '연령대 비공개'} · 블러 프로필 · 완료 {candidate.profile.completedRunCount}회</Text>
          <View style={styles.tagRow}>{tags.map((tag) => <Tag key={tag} label={tag} />)}</View>
        </View>
        <Text style={styles.compatibility}>{similarityLabels[candidate.similarityLabel]}</Text>
      </View>
      <View style={styles.runnerLine} />
      <Text style={styles.matchTitle}>{candidate.safeOverlapSummary ?? candidate.reasons[0] ?? '러닝 리듬이 비슷해요'}</Text>
      <Text style={styles.cardText}>
        최근 한 달 유효한 반복 교차 <Text style={styles.bold}>{candidate.repeatEncounters30d}회</Text> · 정확한 장소와 시각은 표시하지 않아요.
      </Text>
      {expanded ? (
        <>
          <View style={styles.reasonList}>
            {candidate.reasons.map((reason) => <Text key={reason} style={styles.reason}>• {reason}</Text>)}
          </View>
          <Text style={styles.cardCta}>{candidate.requestEligible ? '카드를 눌러 같이 뛰기 요청하기 →' : '반복 교차 5회부터 요청할 수 있어요'}</Text>
        </>
      ) : null}
    </Card>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

function Tag({ label }: { label: string }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>;
}
