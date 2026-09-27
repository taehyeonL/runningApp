import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';

import type { SocialProvider } from '../lib/auth';
import type { OnboardingInput } from '../lib/onboarding';
import { MatchPreferenceFields } from './match-preferences';
import { LegalLinks } from './legal-center';
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
  onPreviewGarden,
}: {
  authenticatingProvider: SocialProvider | null;
  isSessionLoading: boolean;
  notice: string;
  onLogin: (provider: SocialProvider) => void;
  onPreviewOnboarding: () => void;
  onPreviewGarden: () => void;
}) {
  const loginDisabled = Boolean(authenticatingProvider) || isSessionLoading;
  const [showPreview, setShowPreview] = useState(false);
  return (
    <View style={styles.loginWrap}>
      <Image source={require('../../assets/icon-running-mates.png')} style={styles.loginMark} accessible={false} />
      <Text style={styles.brand}>같이뛰어</Text>
      <Text style={styles.loginTitle}>달리다 보면,{`\n`}함께 뛸 사람.</Text>
      <Text style={styles.loginSub}>러닝을 기록하고{`\n`}나와 페이스가 맞는 메이트를 찾아요.</Text>
      <View style={styles.loginPromise}>
        <Text style={styles.caption}>정확한 위치는 비공개 · 대화는 서로 수락한 뒤</Text>
      </View>
      <View style={styles.socialGroup}>
        <SocialButton label={authenticatingProvider === 'apple' ? 'Apple 로그인 중…' : 'Apple로 계속하기'} symbol="●" dark disabled={loginDisabled} onPress={() => onLogin('apple')} />
        <SocialButton label={authenticatingProvider === 'kakao' ? '카카오 로그인 중…' : '카카오로 계속하기'} symbol="K" yellow disabled={loginDisabled} onPress={() => onLogin('kakao')} />
        <SocialButton label={authenticatingProvider === 'google' ? 'Google 로그인 중…' : 'Google로 계속하기'} symbol="G" disabled={loginDisabled} onPress={() => onLogin('google')} />
      </View>
      {isSessionLoading ? <Text style={styles.sessionStatus}>저장된 로그인 세션을 확인하고 있어요…</Text> : null}
      {notice ? <Notice text={notice} /> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPreview }} onPress={() => setShowPreview(!showPreview)} style={styles.quietButton}><Text style={styles.caption}>{showPreview ? '미리보기 접기 −' : '가입 전 화면 미리보기 +'}</Text></Pressable>
      {showPreview ? <View style={styles.loginPreviews}>
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onPreviewOnboarding}><Text style={styles.secondaryText}>러닝 프로필 미리보기</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onPreviewGarden}><Text style={styles.caption}>작은 러닝 보상 · 정원 체험</Text></Pressable>
      </View> : null}
      <Text style={styles.legal}>로그인 후 가입 화면에서 필수 안내를 확인하고 동의해 주세요.</Text>
      <LegalLinks />
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
  const [matchPreferences, setMatchPreferences] = useState<OnboardingInput['matchPreferences']>({ gender: 'unspecified', preference: 'any' });
  const [runningStyle, setRunningStyle] = useState('기록보다 꾸준함');
  const [visibility, setVisibility] = useState<OnboardingInput['visibility']>('매칭 공개');
  const [nickname, setNickname] = useState('');
  const [trainingGoal, setTrainingGoal] = useState<OnboardingInput['trainingGoal']>('habit');
  const [usualPaceSeconds, setUsualPaceSeconds] = useState(420);
  const [availabilitySlots, setAvailabilitySlots] = useState<OnboardingInput['availabilitySlots']>(['weekday_evening']);

  const toggleAvailability = (slot: OnboardingInput['availabilitySlots'][number]) => {
    setAvailabilitySlots((current) => current.includes(slot)
      ? current.filter((item) => item !== slot)
      : current.length < 3 ? [...current, slot] : current);
  };

  return (
    <>
      <Back onPress={onBack} />
      <Kicker>시작하기 · 1/1</Kicker>
      <Text style={styles.pageTitle}>내 러닝 프로필</Text>
      <Text style={styles.pageSub}>공개 범위와 의도는 언제든 바꿀 수 있어요.</Text>

      <Section title="닉네임">
        <TextInput value={nickname} onChangeText={setNickname} maxLength={8} placeholder="한글 2~8자" style={styles.detailsInput} />
        <Text style={styles.caption}>한글 2~8자로 정해요. 가입 뒤에는 6개월에 한 번만 바꿀 수 있어요.</Text>
      </Section>

      <Section title="필수 확인">
        <LegalLinks />
        <CheckRow label="본인은 만 19세 이상입니다" checked={adult} onPress={() => setAdult(!adult)} required />
        <CheckRow label="서비스 이용약관에 동의합니다" checked={terms} onPress={() => setTerms(!terms)} required />
        <CheckRow label="개인정보 수집·이용에 동의합니다" checked={privacy} onPress={() => setPrivacy(!privacy)} required />
        <CheckRow label="개인위치정보 수집·이용에 동의합니다" checked={location} onPress={() => setLocation(!location)} required />
      </Section>
      <Text style={styles.helper}>러닝 중 수집한 위치는 기록과 안전한 동선 유사도 계산에만 쓰며, 다른 사람에게 정확한 좌표·시각·경로를 보여주지 않아요.</Text>

      <Section title="어떤 관계를 기대하나요?">
        <ChoiceGroup options={['친구', '러닝 메이트', '연애 가능', '상관없음']} value={intent} onChange={(value) => setIntent(value as OnboardingInput['intent'])} />
      </Section>
      <Section title="나의 러닝 스타일">
        <ChoiceGroup options={['기록보다 꾸준함', '대화 없이 러닝 집중', '주말 러닝 메이트', '초보 환영']} value={runningStyle} onChange={setRunningStyle} />
      </Section>
      <MatchPreferenceFields value={matchPreferences} onChange={setMatchPreferences} disabled={saving} />
      <Section title="이번 러닝 목표">
        <ChoiceGroup options={['첫 5km 완주', '주 3회 꾸준히', '5km 기록 향상', '10km 도전']} value={{ first_5k: '첫 5km 완주', habit: '주 3회 꾸준히', faster_5k: '5km 기록 향상', ten_k: '10km 도전' }[trainingGoal]} onChange={(value) => setTrainingGoal(({ '첫 5km 완주': 'first_5k', '주 3회 꾸준히': 'habit', '5km 기록 향상': 'faster_5k', '10km 도전': 'ten_k' } as Record<string, OnboardingInput['trainingGoal']>)[value] ?? 'habit')} />
      </Section>
      <Section title="평소 페이스">
        <ChoiceGroup options={['7분 30초 이상 /km', '6분 30초~7분 30초 /km', '5분 30초~6분 30초 /km', '5분 30초 미만 /km']} value={({ 450: '7분 30초 이상 /km', 420: '6분 30초~7분 30초 /km', 360: '5분 30초~6분 30초 /km', 300: '5분 30초 미만 /km' } as Record<number, string>)[usualPaceSeconds]} onChange={(value) => setUsualPaceSeconds(({ '7분 30초 이상 /km': 450, '6분 30초~7분 30초 /km': 420, '5분 30초~6분 30초 /km': 360, '5분 30초 미만 /km': 300 } as Record<string, number>)[value])} />
      </Section>
      <Section title="주로 달리는 시간대">
        <Text style={styles.caption}>정확한 시간은 공개하지 않아요. 매칭에만 넓은 시간대를 사용합니다.</Text>
        <View style={styles.choiceGroup}>
          {([{ key: 'weekday_morning', label: '평일 아침' }, { key: 'weekday_evening', label: '평일 저녁' }, { key: 'weekend_morning', label: '주말 오전' }] as const).map((slot) => (
            <Pressable key={slot.key} onPress={() => toggleAvailability(slot.key)} style={[styles.chip, availabilitySlots.includes(slot.key) && styles.chipSelected]}>
              <Text style={[styles.chipText, availabilitySlots.includes(slot.key) && styles.chipTextSelected]}>{slot.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="프로필 공개 범위">
        <ChoiceGroup options={['비공개', '친구 공개', '프로필 공개', '매칭 공개']} value={visibility} onChange={(value) => setVisibility(value as OnboardingInput['visibility'])} />
        <Text style={styles.caption}>기본값은 블러 사진·연령대·페이스 범위·의도 태그만 보이는 ‘매칭 공개’예요.</Text>
      </Section>
      {notice ? <Notice text={notice} /> : null}
      <PrimaryButton
        label={saving ? '저장 중…' : '러닝 시작할 준비 완료'}
        disabled={saving}
        onPress={() => onSubmit({ nickname, adult, terms, privacy, location, intent, runningStyle, visibility, trainingGoal, usualPaceSeconds, availabilitySlots, matchPreferences })}
      />
    </>
  );
}
