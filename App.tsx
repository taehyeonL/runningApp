import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { beginSocialLogin, type SocialProvider } from './src/lib/auth';

type Screen = 'login' | 'onboarding' | 'home' | 'run' | 'complete' | 'discover' | 'request' | 'profile' | 'report';
type Intent = '친구' | '러닝 메이트' | '연애 가능';
type Visibility = '비공개' | '친구 공개' | '프로필 공개' | '매칭 공개';

const discoveryReasons = ['평균 페이스가 비슷해요', '주로 5~7km를 달려요', '활동 리듬이 비슷해요'];
const reportReasons = [
  '성희롱·성적 불쾌감',
  '스토킹·원치 않는 접촉',
  '사칭·사기',
  '혐오·폭언',
  '위치·개인정보 노출',
  '미성년자 의심',
  '기타',
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [notice, setNotice] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [location, setLocation] = useState(false);
  const [intent, setIntent] = useState<Intent>('러닝 메이트');
  const [runningStyle, setRunningStyle] = useState('기록보다 꾸준함');
  const [visibility, setVisibility] = useState<Visibility>('매칭 공개');
  const [runActive, setRunActive] = useState(false);
  const [shareLogs, setShareLogs] = useState(true);
  const [discoverable, setDiscoverable] = useState(true);
  const [selectedReport, setSelectedReport] = useState(reportReasons[0]);

  const go = (next: Screen) => {
    setNotice('');
    setScreen(next);
  };

  const socialLogin = async (provider: SocialProvider) => {
    const result = await beginSocialLogin(provider);
    if (result.error) {
      setNotice(typeof result.error === 'string' ? result.error : '로그인 설정을 확인해 주세요.');
      return;
    }
    setNotice(`${provider === 'apple' ? 'Apple' : provider === 'kakao' ? '카카오' : 'Google'} 로그인으로 이동합니다.`);
  };

  const finishOnboarding = () => {
    if (!adult || !terms || !privacy || !location) {
      setNotice('만 19세 이상 확인과 필수 약관·개인정보·위치정보 동의가 필요해요.');
      return;
    }
    go('home');
  };

  const nav = (target: Screen) => (
    <Pressable onPress={() => go(target)} style={styles.navItem}>
      <Text style={[styles.navIcon, screen === target && styles.navSelected]}>
        {target === 'home' ? '⌂' : target === 'discover' ? '◌' : '◎'}
      </Text>
      <Text style={[styles.navText, screen === target && styles.navSelected]}>
        {target === 'home' ? '홈' : target === 'discover' ? '발견' : '프로필'}
      </Text>
    </Pressable>
  );

  const withLayout = (content: React.ReactNode, showNav = true) => (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
      {showNav && (
        <View style={styles.navBar}>
          {nav('home')}
          {nav('discover')}
          {nav('profile')}
        </View>
      )}
    </SafeAreaView>
  );

  if (screen === 'login') {
    return withLayout(
      <View style={styles.loginWrap}>
        <View style={styles.sun}><Text style={styles.sunText}>같이</Text></View>
        <Text style={styles.brand}>같이뛰어</Text>
        <Text style={styles.loginTitle}>오늘도 같은 리듬으로{`\n`}달린 사람이 있었어요.</Text>
        <Text style={styles.loginSub}>러닝을 완주한 뒤에만 열리는 안전한 연결</Text>
        <View style={styles.socialGroup}>
          <SocialButton label="Apple로 계속하기" symbol="●" dark onPress={() => socialLogin('apple')} />
          <SocialButton label="카카오로 계속하기" symbol="K" yellow onPress={() => socialLogin('kakao')} />
          <SocialButton label="Google로 계속하기" symbol="G" onPress={() => socialLogin('google')} />
        </View>
        {notice ? <Notice text={notice} /> : null}
        <Pressable onPress={() => go('onboarding')}><Text style={styles.link}>온보딩 UI 미리보기</Text></Pressable>
        <Text style={styles.legal}>계속하면 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</Text>
      </View>,
      false,
    );
  }

  if (screen === 'onboarding') {
    return withLayout(
      <>
        <Back onPress={() => go('login')} />
        <Kicker>시작하기 · 1/1</Kicker>
        <Text style={styles.pageTitle}>나답게, 안전하게{`\n`}함께 달릴 준비</Text>
        <Text style={styles.pageSub}>공개 범위와 의도는 언제든 바꿀 수 있어요.</Text>

        <Section title="필수 확인">
          <CheckRow label="본인은 만 19세 이상입니다" checked={adult} onPress={() => setAdult(!adult)} required />
          <CheckRow label="서비스 이용약관에 동의합니다" checked={terms} onPress={() => setTerms(!terms)} required />
          <CheckRow label="개인정보 수집·이용에 동의합니다" checked={privacy} onPress={() => setPrivacy(!privacy)} required />
          <CheckRow label="개인위치정보 수집·이용에 동의합니다" checked={location} onPress={() => setLocation(!location)} required />
        </Section>
        <Text style={styles.helper}>러닝 중 수집한 위치는 기록과 안전한 동선 유사도 계산에만 쓰며, 다른 사람에게 정확한 좌표·시각·경로를 보여주지 않아요.</Text>

        <Section title="어떤 관계를 기대하나요?">
          <ChoiceGroup options={['친구', '러닝 메이트', '연애 가능']} value={intent} onChange={(value) => setIntent(value as Intent)} />
        </Section>
        <Section title="나의 러닝 스타일">
          <ChoiceGroup options={['기록보다 꾸준함', '대화 없이 러닝 집중', '주말 러닝 메이트', '초보 환영']} value={runningStyle} onChange={setRunningStyle} />
        </Section>
        <Section title="프로필 공개 범위">
          <ChoiceGroup options={['비공개', '친구 공개', '프로필 공개', '매칭 공개']} value={visibility} onChange={(value) => setVisibility(value as Visibility)} />
          <Text style={styles.caption}>기본값은 블러 사진·연령대·페이스 범위·의도 태그만 보이는 ‘매칭 공개’예요.</Text>
        </Section>
        {notice ? <Notice text={notice} /> : null}
        <PrimaryButton label="러닝 시작할 준비 완료" onPress={finishOnboarding} />
      </>,
      false,
    );
  }

  if (screen === 'home') {
    return withLayout(
      <>
        <View style={styles.header}><View><Kicker>수요일, 8월 12일</Kicker><Text style={styles.hello}>안녕하세요, 러너 👋</Text></View><View style={styles.avatar}><Text>나</Text></View></View>
        <Card tone="mint">
          <Text style={styles.cardEyebrow}>이번 달</Text>
          <View style={styles.summaryRow}><Metric label="달린 거리" value="42.6" unit="km" /><Metric label="러닝" value="8" unit="회" /><Metric label="연속" value="4" unit="일" /></View>
        </Card>
        <Text style={styles.sectionTitle}>오늘의 러닝</Text>
        <Card>
          <Text style={styles.runQuestion}>어떤 리듬으로 달려볼까요?</Text>
          <Text style={styles.cardText}>러닝을 시작하면 위치 권한 사용 목적을 다시 알려드려요.</Text>
          <PrimaryButton label="◉  오늘의 러닝 시작" onPress={() => { setRunActive(true); go('run'); }} />
        </Card>
        <Text style={styles.sectionTitle}>최근 기록</Text>
        <Pressable onPress={() => go('complete')}><Card compact><View><Text style={styles.listTitle}>어제 저녁 러닝</Text><Text style={styles.caption}>8월 11일 · 개인 기록</Text></View><Text style={styles.listMetric}>5.2 km</Text></Card></Pressable>
        <Pressable onPress={() => go('discover')}><Card compact><View><Text style={styles.listTitle}>오늘 스친 러너</Text><Text style={styles.caption}>안전하게 추상화된 러닝 궁합을 확인해요</Text></View><Text style={styles.arrow}>›</Text></Card></Pressable>
      </>,
    );
  }

  if (screen === 'run') {
    return withLayout(
      <>
        <Back onPress={() => go('home')} />
        <Kicker>{runActive ? '러닝 진행 중' : '러닝 기록'}</Kicker>
        <Text style={styles.pageTitle}>{runActive ? '나의 리듬을 따라 달려요' : '러닝 기록'}</Text>
        <Card tone="dark">
          <Text style={styles.liveLabel}>LIVE · 위치는 나와 안전한 서버 처리만 확인해요</Text>
          <Text style={styles.distance}>3.28<Text style={styles.distanceUnit}> km</Text></Text>
          <View style={styles.runStats}><Metric dark label="시간" value="21:07" unit="" /><Metric dark label="평균 페이스" value={'6\'26"'} unit="/km" /></View>
        </Card>
        <Card>
          <Text style={styles.listTitle}>기록 품질 안내</Text>
          <Text style={styles.cardText}>GPS accuracy가 낮은 포인트는 동선 유사도 판정에서 제외될 수 있어요. 원본 경로는 타인에게 공개되지 않아요.</Text>
        </Card>
        <PrimaryButton label={runActive ? '러닝 종료하기' : '러닝 이어하기'} onPress={() => { setRunActive(false); go('complete'); }} />
      </>,
      false,
    );
  }

  if (screen === 'complete') {
    return withLayout(
      <>
        <Back onPress={() => go('home')} />
        <View style={styles.completeMark}><Text style={styles.completeIcon}>✓</Text></View>
        <Kicker>러닝 완료</Kicker>
        <Text style={styles.pageTitle}>5.2km 완주했어요!</Text>
        <Text style={styles.pageSub}>지난주보다 18초 빨라졌어요. 좋은 리듬이었어요.</Text>
        <Card tone="mint"><View style={styles.summaryRow}><Metric label="거리" value="5.2" unit="km" /><Metric label="시간" value="33:14" unit="" /><Metric label="평균 페이스" value={'6\'23"'} unit="/km" /></View></Card>
        <Text style={styles.sectionTitle}>오늘 같은 리듬으로 달린 러너</Text>
        <Pressable onPress={() => go('request')}><RunnerCard /></Pressable>
        <Text style={styles.helper}>정확한 장소·시각·거리·원본 경로는 보여주지 않아요. 요청을 수락한 뒤에만 대화가 열려요.</Text>
        <PrimaryButton label="발견 화면에서 더 보기" onPress={() => go('discover')} />
      </>,
    );
  }

  if (screen === 'discover') {
    return withLayout(
      <>
        <Kicker>안전한 발견</Kicker>
        <Text style={styles.pageTitle}>오늘 스친 러너</Text>
        <Text style={styles.pageSub}>완료한 러닝의 안전한 요약을 바탕으로 보여드려요.</Text>
        <RunnerCard expanded onPress={() => go('request')} />
        <Card>
          <Text style={styles.listTitle}>발견 기준</Text>
          <Text style={styles.cardText}>3km 이상 완료, 위치 품질, 시간·궤적·방향·속도를 함께 고려해 서버에서 판정합니다. 순간적인 근접만으로 표시하지 않아요.</Text>
        </Card>
        <Pressable onPress={() => go('report')} style={styles.reportLink}><Text style={styles.reportLinkText}>안전 문제를 신고하거나 차단하기</Text></Pressable>
      </>,
    );
  }

  if (screen === 'request') {
    return withLayout(
      <>
        <Back onPress={() => go('discover')} />
        <Kicker>같이 뛰기 요청</Kicker>
        <Text style={styles.pageTitle}>가볍게 제안해 보세요</Text>
        <Text style={styles.pageSub}>수락 전에는 연락처나 세부 일정이 공유되지 않아요.</Text>
        <RunnerCard />
        <Section title="제안할 러닝">
          <ChoiceGroup options={['다음 주말에 5km 가볍게', '퇴근 후 30분 조깅', '이번 주 아침 러닝']} value="다음 주말에 5km 가볍게" onChange={() => undefined} />
        </Section>
        <Card tone="yellow"><Text style={styles.listTitle}>무료 요청 가능</Text><Text style={styles.cardText}>최근 30일 내 유효한 반복 교차가 5회 이상인 러너에게는 무료로 요청할 수 있어요.</Text></Card>
        <PrimaryButton label="같이 뛰기 요청 보내기" onPress={() => { Alert.alert('요청을 보냈어요', '상대가 수락해야만 채팅이 열립니다.'); go('discover'); }} />
      </>,
      false,
    );
  }

  if (screen === 'profile') {
    return withLayout(
      <>
        <Kicker>나의 설정</Kicker>
        <Text style={styles.pageTitle}>공개 범위와 러닝 로그</Text>
        <Text style={styles.pageSub}>내 기록과 발견 참여는 언제든 내가 결정해요.</Text>
        <Card><ToggleRow title="발견에 내 프로필 표시" description="조건을 충족한 러너에게만 추상화된 카드로 보여요." value={discoverable} onChange={setDiscoverable} /><View style={styles.divider} /><ToggleRow title="러닝 로그 공개 허용" description="정확한 경로·출발/도착 시각은 공개하지 않아요." value={shareLogs} onChange={setShareLogs} /></Card>
        <Section title="새 러닝 로그 기본 공개 범위"><ChoiceGroup options={['비공개', '친구 공개', '프로필 공개', '매칭 공개']} value={visibility} onChange={(value) => setVisibility(value as Visibility)} /></Section>
        <Pressable onPress={() => go('run')}><Card compact><View><Text style={styles.listTitle}>오늘의 러닝 기록</Text><Text style={styles.caption}>5.2km · 저장됨 · {visibility}</Text></View><Text style={styles.arrow}>›</Text></Card></Pressable>
        <Pressable onPress={() => Alert.alert('데모 안내', '러닝 로그 삭제는 모든 사용자에게 무료로 제공되어야 합니다. 실제 연결 단계에서 삭제 API를 추가하세요.')}><Text style={styles.destructiveText}>러닝 로그 삭제 기능 안내</Text></Pressable>
      </>,
    );
  }

  return withLayout(
    <>
      <Back onPress={() => go('discover')} />
      <Kicker>안전 센터</Kicker>
      <Text style={styles.pageTitle}>신고 또는 차단</Text>
      <Text style={styles.pageSub}>차단하면 서로의 발견 카드와 요청에서 즉시 제외됩니다.</Text>
      <Card tone="yellow"><Text style={styles.listTitle}>긴급한 위험이 있나요?</Text><Text style={styles.cardText}>즉시 112 등 긴급 도움을 요청하세요. 서비스 신고는 안전 대응을 위한 보조 수단입니다.</Text></Card>
      <Section title="신고 사유"><ChoiceGroup options={reportReasons} value={selectedReport} onChange={setSelectedReport} /></Section>
      <PrimaryButton label="신고 제출하기" onPress={() => Alert.alert('신고가 접수되었어요', '운영 검토를 위해 증거와 반복성을 확인합니다. 신고자 정보는 상대에게 공개되지 않아요.')} />
      <Pressable style={styles.blockButton} onPress={() => Alert.alert('차단했어요', '이제 이 사용자는 내 발견 카드와 요청에서 제외됩니다.')}><Text style={styles.blockText}>이 사용자 차단하기</Text></Pressable>
    </>,
    false,
  );
}

function SocialButton({ label, symbol, dark, yellow, onPress }: { label: string; symbol: string; dark?: boolean; yellow?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.socialButton, dark && styles.socialDark, yellow && styles.socialYellow]}><Text style={[styles.socialSymbol, dark && styles.socialDarkText]}>{symbol}</Text><Text style={[styles.socialLabel, dark && styles.socialDarkText]}>{label}</Text></Pressable>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.primaryButton}><Text style={styles.primaryText}>{label}</Text></Pressable>;
}

function Back({ onPress }: { onPress: () => void }) { return <Pressable onPress={onPress} style={styles.back}><Text style={styles.backText}>‹</Text><Text style={styles.backLabel}>뒤로</Text></Pressable>; }
function Kicker({ children }: { children: React.ReactNode }) { return <Text style={styles.kicker}>{children}</Text>; }
function Notice({ text }: { text: string }) { return <View style={styles.notice}><Text style={styles.noticeText}>{text}</Text></View>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function Card({ children, tone, compact = false }: { children: React.ReactNode; tone?: 'mint' | 'dark' | 'yellow'; compact?: boolean }) { return <View style={[styles.card, tone === 'mint' && styles.mintCard, tone === 'dark' && styles.darkCard, tone === 'yellow' && styles.yellowCard, compact && styles.compactCard]}>{children}</View>; }
function Metric({ label, value, unit, dark }: { label: string; value: string; unit: string; dark?: boolean }) { return <View><Text style={[styles.metricValue, dark && styles.metricDark]}>{value}<Text style={styles.metricUnit}>{unit}</Text></Text><Text style={[styles.metricLabel, dark && styles.metricDarkLabel]}>{label}</Text></View>; }
function CheckRow({ label, checked, onPress, required }: { label: string; checked: boolean; onPress: () => void; required?: boolean }) { return <Pressable onPress={onPress} style={styles.checkRow}><View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.checkText}>{checked ? '✓' : ''}</Text></View><Text style={styles.checkLabel}>{label}{required ? <Text style={styles.required}> (필수)</Text> : null}</Text></Pressable>; }
function ChoiceGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) { return <View style={styles.choiceGroup}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={[styles.chip, value === option && styles.chipSelected]}><Text style={[styles.chipText, value === option && styles.chipTextSelected]}>{option}</Text></Pressable>)}</View>; }
function ToggleRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.listTitle}>{title}</Text><Text style={styles.caption}>{description}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: '#D8E1E5', true: '#1FAF8B' }} /></View>; }

function RunnerCard({ expanded = false, onPress }: { expanded?: boolean; onPress?: () => void }) {
  const body = <Card><View style={styles.runnerTop}><View style={styles.blurAvatar}><Text style={styles.blurText}>●</Text></View><View style={styles.runnerInfo}><Text style={styles.listTitle}>도담 러너</Text><Text style={styles.caption}>20대 후반 · 블러 프로필</Text><View style={styles.tagRow}><Tag label="기록보다 꾸준함" /><Tag label="러닝 메이트" /></View></View><Text style={styles.compatibility}>잘 맞음</Text></View><View style={styles.runnerLine} /><Text style={styles.matchTitle}>평균 페이스가 비슷해요</Text><Text style={styles.cardText}>최근 한 달 유효한 반복 교차 <Text style={styles.bold}>5회</Text> · 정확한 장소와 시각은 표시하지 않아요.</Text>{expanded ? <><View style={styles.reasonList}>{discoveryReasons.map((reason) => <Text key={reason} style={styles.reason}>• {reason}</Text>)}</View><Text style={styles.cardCta}>카드를 눌러 같이 뛰기 요청하기 →</Text></> : null}</Card>;
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}
function Tag({ label }: { label: string }) { return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FCFEFD' }, scroll: { padding: 22, paddingBottom: 38, gap: 14 },
  loginWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 44 }, sun: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#D9F5E9', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }, sunText: { fontSize: 23, fontWeight: '800', color: '#127C64' }, brand: { fontSize: 21, fontWeight: '800', color: '#153731', marginBottom: 28 }, loginTitle: { fontSize: 28, lineHeight: 38, letterSpacing: -1, fontWeight: '800', color: '#163932', textAlign: 'center' }, loginSub: { fontSize: 14, color: '#6B807A', marginTop: 12, textAlign: 'center' }, socialGroup: { width: '100%', gap: 10, marginTop: 42 }, socialButton: { height: 54, borderRadius: 15, borderWidth: 1, borderColor: '#D9E3E0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' }, socialDark: { backgroundColor: '#202321', borderColor: '#202321' }, socialYellow: { backgroundColor: '#FBE94E', borderColor: '#FBE94E' }, socialSymbol: { position: 'absolute', left: 18, fontWeight: '800', fontSize: 17, color: '#263430' }, socialLabel: { fontWeight: '700', color: '#263430' }, socialDarkText: { color: '#FFF' }, link: { color: '#168A70', fontSize: 14, fontWeight: '700', marginTop: 22 }, legal: { color: '#8A9894', fontSize: 11, textAlign: 'center', marginTop: 18, lineHeight: 17 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#D9F5E9', justifyContent: 'center', alignItems: 'center' }, hello: { fontSize: 21, fontWeight: '800', color: '#173A33', marginTop: 3 }, kicker: { color: '#19856C', fontSize: 12, letterSpacing: .6, fontWeight: '800', textTransform: 'uppercase' }, pageTitle: { fontSize: 27, lineHeight: 35, letterSpacing: -.8, fontWeight: '800', color: '#173A33', marginTop: -4 }, pageSub: { color: '#677B75', fontSize: 14, lineHeight: 21, marginTop: -6 }, section: { gap: 10, marginTop: 8 }, sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1A3932', marginTop: 10 }, card: { backgroundColor: '#FFF', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#E4ECE9', gap: 9 }, compactCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 }, mintCard: { backgroundColor: '#E7F8F0', borderColor: '#E7F8F0' }, darkCard: { backgroundColor: '#153B34', borderColor: '#153B34', padding: 22 }, yellowCard: { backgroundColor: '#FFF8D8', borderColor: '#FFF2BE' }, cardEyebrow: { color: '#38816E', fontSize: 12, fontWeight: '700' }, cardText: { fontSize: 13, lineHeight: 20, color: '#637872' }, summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }, metricValue: { fontSize: 22, fontWeight: '800', color: '#173A33', letterSpacing: -.7 }, metricUnit: { fontSize: 12, fontWeight: '600', color: '#5E766F' }, metricLabel: { fontSize: 12, color: '#688077', marginTop: 3 }, metricDark: { color: '#FFF' }, metricDarkLabel: { color: '#B8D3CB' }, runQuestion: { fontSize: 18, fontWeight: '800', color: '#1A3932' }, primaryButton: { backgroundColor: '#168A70', height: 55, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, primaryText: { color: '#FFF', fontWeight: '800', fontSize: 15 }, listTitle: { fontSize: 15, fontWeight: '800', color: '#1A3932' }, listMetric: { fontSize: 17, fontWeight: '800', color: '#168A70' }, arrow: { fontSize: 27, color: '#7B918B' }, caption: { color: '#70847E', fontSize: 12, lineHeight: 18 }, helper: { color: '#778A84', fontSize: 12, lineHeight: 19, marginTop: -5 },
  navBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#E8EFEC', backgroundColor: '#FFF' }, navItem: { alignItems: 'center', minWidth: 72, gap: 2 }, navIcon: { fontSize: 22, color: '#93A39E' }, navText: { fontSize: 11, color: '#93A39E' }, navSelected: { color: '#168A70', fontWeight: '800' }, back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -6, marginBottom: 2 }, backText: { fontSize: 33, lineHeight: 30, color: '#25433C' }, backLabel: { color: '#25433C', fontSize: 13, marginLeft: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 33, gap: 10 }, checkbox: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, borderColor: '#B9CAC4', alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#168A70', borderColor: '#168A70' }, checkText: { color: '#FFF', fontWeight: '800', fontSize: 13 }, checkLabel: { fontSize: 13, color: '#314C45', fontWeight: '600' }, required: { color: '#D66148', fontSize: 11 }, choiceGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderRadius: 18, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#F1F5F3', borderWidth: 1, borderColor: '#E4ECE9' }, chipSelected: { backgroundColor: '#DDF5EB', borderColor: '#47B596' }, chipText: { color: '#557069', fontWeight: '700', fontSize: 12 }, chipTextSelected: { color: '#127C64' }, notice: { backgroundColor: '#FFF5DD', borderRadius: 12, padding: 12, width: '100%' }, noticeText: { color: '#725A1C', fontSize: 12, lineHeight: 18 },
  liveLabel: { color: '#BDE2D7', fontSize: 11, fontWeight: '700' }, distance: { color: '#FFF', fontSize: 58, fontWeight: '800', letterSpacing: -2, textAlign: 'center', marginVertical: 24 }, distanceUnit: { color: '#D1E9E2', fontSize: 18, letterSpacing: 0 }, runStats: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: '#3B645B', paddingTop: 15 }, completeMark: { width: 62, height: 62, backgroundColor: '#DDF5EB', borderRadius: 31, justifyContent: 'center', alignItems: 'center', marginTop: 8 }, completeIcon: { color: '#168A70', fontSize: 31, fontWeight: '800' },
  runnerTop: { flexDirection: 'row', alignItems: 'flex-start' }, blurAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#C7D7D1', marginRight: 12, justifyContent: 'center', alignItems: 'center', shadowColor: '#54756A', shadowOpacity: .25, shadowRadius: 7 }, blurText: { color: '#EAF2EF', fontSize: 28 }, runnerInfo: { flex: 1, gap: 3 }, compatibility: { color: '#168A70', backgroundColor: '#DDF5EB', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, fontSize: 11, fontWeight: '800' }, tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 }, tag: { backgroundColor: '#F0F5F3', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 6 }, tagText: { color: '#527168', fontSize: 10, fontWeight: '700' }, runnerLine: { height: 1, backgroundColor: '#E6EEEA', marginVertical: 4 }, matchTitle: { color: '#1C5D4E', fontSize: 16, fontWeight: '800' }, bold: { fontWeight: '800', color: '#1C5D4E' }, reasonList: { gap: 3, marginTop: 4 }, reason: { color: '#56736A', fontSize: 12 }, cardCta: { color: '#168A70', fontSize: 12, fontWeight: '800', marginTop: 5 }, reportLink: { padding: 7, alignItems: 'center' }, reportLinkText: { color: '#A85A46', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, toggleCopy: { flex: 1, gap: 4 }, divider: { height: 1, backgroundColor: '#E6EEEA', marginVertical: 7 }, destructiveText: { color: '#B35A49', textAlign: 'center', fontSize: 13, fontWeight: '700', marginTop: 8 }, blockButton: { height: 54, borderRadius: 16, borderWidth: 1, borderColor: '#E8B9AE', justifyContent: 'center', alignItems: 'center', marginTop: 4 }, blockText: { color: '#B45441', fontSize: 15, fontWeight: '800' },
});
