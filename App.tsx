import * as Linking from 'expo-linking';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform } from 'react-native';

import type { RunListItem } from './src/features/running/run-types';
import type { DiscoveryCandidate, RequestTemplateKey } from './src/features/social/social-types';
import { useAuthSession } from './src/hooks/use-auth-session';
import { useRunRecorder } from './src/hooks/use-run-recorder';
import { useSocial } from './src/hooks/use-social';
import {
  beginSocialLogin,
  completeSocialLogin,
  isAuthCallbackUrl,
  signOut,
  type SocialProvider,
} from './src/lib/auth';
import { hasCompletedOnboarding, saveOnboarding } from './src/lib/onboarding';
import { hasSupabaseConfig } from './src/lib/supabase';
import { screensWithBottomNavigation, type Screen } from './src/navigation/routes';
import { LoginScreen, OnboardingScreen, type OnboardingSubmission } from './src/screens/auth-screens';
import { HomeScreen, RunCompleteScreen, RunScreen } from './src/screens/running-screens';
import { DiscoverScreen, ProfileScreen, ReportScreen, RequestScreen } from './src/screens/social-screens';
import { AppShell } from './src/ui/components';

export default function App() {
  const { session, isLoading: isSessionLoading, error: sessionError } = useAuthSession();
  const runRecorder = useRunRecorder(session?.user.id);
  const social = useSocial(session?.user.id);
  const callbackUrl = Linking.useLinkingURL();
  const hadAuthenticatedSession = useRef(false);
  const [screen, setScreen] = useState<Screen>('login');
  const [notice, setNotice] = useState('');
  const [authenticatingProvider, setAuthenticatingProvider] = useState<SocialProvider | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<DiscoveryCandidate | null>(null);

  const go = (next: Screen) => {
    setNotice('');
    setScreen(next);
  };

  useEffect(() => {
    if (!callbackUrl || !hasSupabaseConfig || !isAuthCallbackUrl(callbackUrl)) return;

    let active = true;
    void completeSocialLogin(callbackUrl).then((result) => {
      if (!active) return;
      if (result.status === 'success') setNotice('로그인이 완료되었습니다.');
      if (result.status === 'error') setNotice(result.error);
    });
    return () => {
      active = false;
    };
  }, [callbackUrl]);

  useEffect(() => {
    if (!hasSupabaseConfig || isSessionLoading) return;
    let active = true;
    if (session) {
      hadAuthenticatedSession.current = true;
      if (screen === 'login') {
        void hasCompletedOnboarding(session.user.id).then((completed) => {
          if (!active) return;
          setNotice('저장된 로그인 세션을 복원했어요.');
          setScreen(completed ? 'home' : 'onboarding');
        }).catch((error) => {
          if (!active) return;
          setNotice(error instanceof Error ? error.message : '온보딩 상태를 확인하지 못했습니다.');
          setScreen('onboarding');
        });
      }
    } else if (hadAuthenticatedSession.current) {
      hadAuthenticatedSession.current = false;
      setNotice('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      setScreen('login');
    }
    return () => {
      active = false;
    };
  }, [isSessionLoading, screen, session]);

  useEffect(() => {
    if (sessionError && screen === 'login') setNotice(sessionError);
  }, [screen, sessionError]);

  useEffect(() => {
    if (screen === 'discover' && session) void social.refresh();
  }, [screen, session, social.refresh]);

  const socialLogin = async (provider: SocialProvider) => {
    setAuthenticatingProvider(provider);
    setNotice('');
    try {
      const result = await beginSocialLogin(provider);
      if (result.status === 'error') setNotice(result.error);
      if (result.status === 'cancelled') setNotice('로그인이 취소되었습니다.');
      if (result.status === 'success') setNotice('로그인이 완료되었습니다.');
    } finally {
      setAuthenticatingProvider(null);
    }
  };

  const logout = async () => {
    if (runRecorder.activeRun) {
      go('run');
      setNotice('진행 중인 러닝을 종료하거나 삭제한 뒤 로그아웃해 주세요.');
      return;
    }
    const { error } = await signOut();
    if (error) {
      setNotice(error.message);
      return;
    }
    go('login');
    setNotice('이 기기의 로그인 세션에서 로그아웃했습니다.');
  };

  const finishOnboarding = async (input: OnboardingSubmission) => {
    if (!input.adult || !input.terms || !input.privacy || !input.location) {
      setNotice('만 19세 이상 확인과 필수 약관·개인정보·위치정보 동의가 필요해요.');
      return;
    }
    if (!session) {
      setNotice('실제 러닝 기록을 사용하려면 먼저 소셜 로그인해 주세요.');
      return;
    }
    setSavingOnboarding(true);
    setNotice('');
    try {
      await saveOnboarding(session, input);
      go('home');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '온보딩 정보를 저장하지 못했습니다.');
    } finally {
      setSavingOnboarding(false);
    }
  };

  const startRun = (preferBackground: boolean) => {
    void runRecorder.start(preferBackground).then((state) => {
      go('run');
      if (preferBackground && state.trackingMode === 'foreground') {
        setNotice('현재 실행 환경은 백그라운드 기록을 지원하지 않아 앱이 열린 동안만 기록해요. 개발 빌드에서는 화면이 꺼져도 기록할 수 있어요.');
      }
    }).catch((error) => {
      setNotice(error instanceof Error ? error.message : '러닝을 시작하지 못했습니다.');
    });
  };

  const promptRunStart = () => {
    if (runRecorder.activeRun) {
      go('run');
      return;
    }
    if (!session) {
      go('login');
      setNotice('러닝을 기록하려면 먼저 로그인과 필수 동의를 완료해 주세요.');
      return;
    }
    if (Platform.OS === 'web') {
      startRun(false);
      return;
    }
    Alert.alert(
      '러닝 중 위치 사용',
      '거리·시간·페이스와 안전한 동선 유사도 검증에 사용합니다. 원본 좌표와 정확한 시각은 다른 사용자에게 공개하지 않아요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '앱을 보는 동안', onPress: () => startRun(false) },
        { text: '화면이 꺼져도 기록', onPress: () => startRun(true) },
      ],
    );
  };

  const finishActiveRun = () => {
    void runRecorder.finish().then(() => {
      setSelectedRun(null);
      go('complete');
    }).catch(() => undefined);
  };

  const leaveRunScreen = () => {
    if (!runRecorder.activeRun) {
      go('home');
      return;
    }
    Alert.alert('러닝 기록 중이에요', '홈으로 가도 기록은 계속됩니다.', [
      { text: '계속 달리기', style: 'cancel' },
      { text: '홈으로 이동', onPress: () => go('home') },
    ]);
  };

  const openRun = (run: RunListItem) => {
    setSelectedRun(run);
    go('complete');
  };

  const openRequest = (candidate: DiscoveryCandidate) => {
    setSelectedCandidate(candidate);
    go('request');
  };

  const sendRequest = async (template: RequestTemplateKey) => {
    if (!selectedCandidate) throw new Error('선택한 발견 후보가 없습니다.');
    await social.send(selectedCandidate, template);
    go('discover');
  };

  let content: ReactNode;
  switch (screen) {
    case 'login':
      content = <LoginScreen authenticatingProvider={authenticatingProvider} isSessionLoading={isSessionLoading} notice={notice} onLogin={(provider) => void socialLogin(provider)} onPreviewOnboarding={() => go('onboarding')} />;
      break;
    case 'onboarding':
      content = <OnboardingScreen saving={savingOnboarding} notice={notice} onBack={() => go('login')} onSubmit={(input) => void finishOnboarding(input)} />;
      break;
    case 'home':
      content = <HomeScreen recorder={runRecorder} notice={notice} onStart={promptRunStart} onDiscover={() => go('discover')} onOpenRun={openRun} />;
      break;
    case 'run':
      content = <RunScreen recorder={runRecorder} notice={notice} onBack={leaveRunScreen} onHome={() => go('home')} onFinish={finishActiveRun} />;
      break;
    case 'complete':
      content = <RunCompleteScreen recorder={runRecorder} selectedRun={selectedRun} onHome={() => go('home')} onDiscover={() => go('discover')} />;
      break;
    case 'discover':
      content = <DiscoverScreen userId={session?.user.id} social={social} onRequest={openRequest} onReport={() => go('report')} />;
      break;
    case 'request':
      content = <RequestScreen candidate={selectedCandidate} sending={social.actionRequestId === selectedCandidate?.id} error={social.error} onBack={() => go('discover')} onSend={sendRequest} />;
      break;
    case 'profile':
      content = <ProfileScreen latestRun={runRecorder.recentRuns[0]} signedIn={Boolean(session)} onOpenRun={openRun} onLogout={() => void logout()} />;
      break;
    case 'report':
      content = <ReportScreen onBack={() => go('discover')} />;
      break;
  }

  return (
    <AppShell screen={screen} showNavigation={screensWithBottomNavigation.has(screen)} onNavigate={go}>
      {content}
    </AppShell>
  );
}
