import * as Linking from 'expo-linking';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform } from 'react-native';

import { deleteRun, setRunVisibility } from './src/features/account/account-api';
import { registerForMessagePush, unregisterMessagePush } from './src/features/chat/push';
import type { RunListItem } from './src/features/running/run-types';
import {
  blockUser,
  fetchModerationNotices,
  reportProfile,
  type ModerationNotice,
  type ProfileReportReason,
} from './src/features/social/moderation-api';
import type { DiscoveryCandidate, RequestTemplateKey } from './src/features/social/social-types';
import { useAuthSession } from './src/hooks/use-auth-session';
import { useChat } from './src/hooks/use-chat';
import { usePrivacy } from './src/hooks/use-privacy';
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
import { AccountScreen } from './src/screens/account-screens';
import { ChatListScreen, ChatThreadScreen } from './src/screens/chat-screens';
import { LoginScreen, OnboardingScreen, type OnboardingSubmission } from './src/screens/auth-screens';
import { HomeScreen, RunCompleteScreen, RunScreen } from './src/screens/running-screens';
import { DiscoverScreen, ProfileScreen, ReportScreen, RequestScreen } from './src/screens/social-screens';
import { AppShell } from './src/ui/components';

export default function App() {
  const { session, isLoading: isSessionLoading, error: sessionError } = useAuthSession();
  const runRecorder = useRunRecorder(session?.user.id);
  const social = useSocial(session?.user.id);
  const privacy = usePrivacy(session?.user.id);
  const chat = useChat(session?.user.id);
  const callbackUrl = Linking.useLinkingURL();
  const hadAuthenticatedSession = useRef(false);
  const pushToken = useRef<string | null>(null);
  const [screen, setScreen] = useState<Screen>('login');
  const [notice, setNotice] = useState('');
  const [authenticatingProvider, setAuthenticatingProvider] = useState<SocialProvider | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; nickname: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [moderationNotices, setModerationNotices] = useState<ModerationNotice[]>([]);

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

  useEffect(() => {
    if (screen === 'chat' && session) void chat.refreshThreads();
  }, [screen, session, chat.refreshThreads]);

  useEffect(() => {
    if (screen !== 'profile' || !session) return;
    let active = true;
    void fetchModerationNotices()
      .then((notices) => {
        if (active) setModerationNotices(notices);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [screen, session]);

  // 푸시 등록 실패는 대화 자체를 막지 않는다. 권한을 거부했거나 Expo Go처럼
  // 원격 푸시를 지원하지 않는 환경이면 알림만 조용히 비활성화된다.
  useEffect(() => {
    if (!session) return;
    let active = true;
    void registerForMessagePush().then((result) => {
      if (active && result.status === 'registered') pushToken.current = result.token;
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [session]);

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
    if (pushToken.current) {
      await unregisterMessagePush(pushToken.current).catch(() => undefined);
      pushToken.current = null;
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
    setLogNotice(null);
    go('complete');
  };

  const changeRunVisibility = (run: RunListItem, visibility: RunListItem['visibility']) => {
    setLogBusy(true);
    setLogNotice(null);
    void setRunVisibility(run.id, visibility)
      .then(async () => {
        setSelectedRun({ ...run, visibility });
        setLogNotice('이 기록의 공개 범위를 저장했어요.');
        await runRecorder.refreshHistory();
      })
      .catch((error) => setLogNotice(error instanceof Error ? error.message : String(error)))
      .finally(() => setLogBusy(false));
  };

  const removeRun = (run: RunListItem) => {
    setLogBusy(true);
    setLogNotice(null);
    void deleteRun(run.id)
      .then(async () => {
        setSelectedRun(null);
        await runRecorder.refreshHistory();
        await social.refresh();
        go('home');
        setNotice('러닝 기록과 원본 GPS를 삭제했어요.');
      })
      .catch((error) => setLogNotice(error instanceof Error ? error.message : String(error)))
      .finally(() => setLogBusy(false));
  };

  const openReport = (candidate: DiscoveryCandidate) => {
    setReportTarget({ id: candidate.profile.id, nickname: candidate.profile.nickname });
    setReportNotice(null);
    setReportError(null);
    go('report');
  };

  const submitReport = (reason: ProfileReportReason, details: string) => {
    if (!reportTarget) return;
    setReportBusy(true);
    setReportError(null);
    void reportProfile(reportTarget.id, reason, details)
      .then(async () => {
        setReportNotice('신고를 접수했어요. 신고 시점 프로필이 증거로 함께 저장되며, 신고자 정보는 상대에게 공개되지 않아요.');
        await social.refresh();
      })
      .catch((error) => setReportError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReportBusy(false));
  };

  const blockFromReport = () => {
    if (!reportTarget || !session) return;
    setReportBusy(true);
    setReportError(null);
    void blockUser(session.user.id, reportTarget.id)
      .then(async () => {
        setReportNotice('차단했어요. 서로의 발견 카드와 요청, 대화에서 즉시 제외됩니다.');
        await social.refresh();
        await chat.refreshThreads();
      })
      .catch((error) => setReportError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReportBusy(false));
  };

  const openChatThread = (partnerId: string) => {
    void chat.openThread(partnerId);
    go('chatThread');
  };

  const leaveChatThread = () => {
    chat.closeThread();
    go('chat');
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
      content = <RunCompleteScreen recorder={runRecorder} selectedRun={selectedRun} logBusy={logBusy} logNotice={logNotice} onHome={() => go('home')} onDiscover={() => go('discover')} onChangeVisibility={changeRunVisibility} onDeleteRun={removeRun} />;
      break;
    case 'discover':
      content = <DiscoverScreen userId={session?.user.id} social={social} chatUnreadCount={chat.totalUnread} onRequest={openRequest} onReport={() => go('report')} onOpenChat={() => go('chat')} />;
      break;
    case 'request':
      content = <RequestScreen candidate={selectedCandidate} sending={social.actionRequestId === selectedCandidate?.id} error={social.error} onBack={() => go('discover')} onSend={sendRequest} onReport={openReport} />;
      break;
    case 'profile':
      content = <ProfileScreen recentRuns={runRecorder.recentRuns} privacy={privacy} moderationNotices={moderationNotices} signedIn={Boolean(session)} onOpenRun={openRun} onOpenAccount={() => go('account')} onLogout={() => void logout()} />;
      break;
    case 'account':
      content = <AccountScreen privacy={privacy} onBack={() => go('profile')} />;
      break;
    case 'chat':
      content = <ChatListScreen chat={chat} onBack={() => go('discover')} onOpenThread={openChatThread} />;
      break;
    case 'chatThread':
      content = <ChatThreadScreen chat={chat} userId={session?.user.id} onBack={leaveChatThread} />;
      break;
    case 'report':
      content = <ReportScreen target={reportTarget} busy={reportBusy} notice={reportNotice} error={reportError} onBack={() => go('discover')} onSubmit={submitReport} onBlock={blockFromReport} />;
      break;
  }

  return (
    <AppShell
      screen={screen}
      showNavigation={screensWithBottomNavigation.has(screen)}
      // 대화 화면은 자체 가상화 목록을 쓰므로 껍데기 스크롤을 비운다.
      scrollable={screen !== 'chatThread'}
      onNavigate={go}
    >
      {content}
    </AppShell>
  );
}
