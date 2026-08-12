import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SocialProvider } from '../lib/auth';
import type { OnboardingInput } from '../lib/onboarding';
import {
  Back,
  CheckRow,
  ChoiceGroup,
  Kicker,
  Notice,
  PrimaryButton,
  Section,
  SocialButton,
} from '../ui/components';
import { styles } from '../ui/styles';

export type OnboardingSubmission = OnboardingInput & {
  adult: boolean;
  terms: boolean;
  privacy: boolean;
  location: boolean;
};

export function LoginScreen({
  authenticatingProvider,
  isSessionLoading,
  notice,
  onLogin,
  onPreviewOnboarding,
}: {
  authenticatingProvider: SocialProvider | null;
  isSessionLoading: boolean;
  notice: string;
  onLogin: (provider: SocialProvider) => void;
  onPreviewOnboarding: () => void;
}) {
  const loginDisabled = Boolean(authenticatingProvider) || isSessionLoading;
  return (
    <View style={styles.loginWrap}>
      <View style={styles.sun}><Text style={styles.sunText}>같이</Text></View>
      <Text style={styles.brand}>같이뛰어</Text>
      <Text style={styles.loginTitle}>오늘도 같은 리듬으로{`\n`}달린 사람이 있었어요.</Text>
      <Text style={styles.loginSub}>러닝을 완주한 뒤에만 열리는 안전한 연결</Text>
      <View style={styles.socialGroup}>
        <SocialButton label={authenticatingProvider === 'apple' ? 'Apple 로그인 중…' : 'Apple로 계속하기'} symbol="●" dark disabled={loginDisabled} onPress={() => onLogin('apple')} />
        <SocialButton label={authenticatingProvider === 'kakao' ? '카카오 로그인 중…' : '카카오로 계속하기'} symbol="K" yellow disabled={loginDisabled} onPress={() => onLogin('kakao')} />
        <SocialButton label={authenticatingProvider === 'google' ? 'Google 로그인 중…' : 'Google로 계속하기'} symbol="G" disabled={loginDisabled} onPress={() => onLogin('google')} />
      </View>
      {isSessionLoading ? <Text style={styles.sessionStatus}>저장된 로그인 세션을 확인하고 있어요…</Text> : null}
      {notice ? <Notice text={notice} /> : null}
      <Pressable onPress={onPreviewOnboarding}><Text style={styles.link}>온보딩 UI 미리보기</Text></Pressable>
      <Text style={styles.legal}>계속하면 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</Text>
    </View>
  );
}

export function OnboardingScreen({
  saving,
  notice,
  onBack,
  onSubmit,
}: {
  saving: boolean;
  notice: string;
  onBack: () => void;
  onSubmit: (input: OnboardingSubmission) => void;
}) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [location, setLocation] = useState(false);
  const [intent, setIntent] = useState<OnboardingInput['intent']>('러닝 메이트');
  const [runningStyle, setRunningStyle] = useState('기록보다 꾸준함');
  const [visibility, setVisibility] = useState<OnboardingInput['visibility']>('매칭 공개');

  return (
    <>
      <Back onPress={onBack} />
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
        <ChoiceGroup options={['친구', '러닝 메이트', '연애 가능']} value={intent} onChange={(value) => setIntent(value as OnboardingInput['intent'])} />
      </Section>
      <Section title="나의 러닝 스타일">
        <ChoiceGroup options={['기록보다 꾸준함', '대화 없이 러닝 집중', '주말 러닝 메이트', '초보 환영']} value={runningStyle} onChange={setRunningStyle} />
      </Section>
      <Section title="프로필 공개 범위">
        <ChoiceGroup options={['비공개', '친구 공개', '프로필 공개', '매칭 공개']} value={visibility} onChange={(value) => setVisibility(value as OnboardingInput['visibility'])} />
        <Text style={styles.caption}>기본값은 블러 사진·연령대·페이스 범위·의도 태그만 보이는 ‘매칭 공개’예요.</Text>
      </Section>
      {notice ? <Notice text={notice} /> : null}
      <PrimaryButton
        label={saving ? '저장 중…' : '러닝 시작할 준비 완료'}
        disabled={saving}
        onPress={() => onSubmit({ adult, terms, privacy, location, intent, runningStyle, visibility })}
      />
    </>
  );
}
