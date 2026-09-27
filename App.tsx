import * as Linking from 'expo-linking';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform } from 'react-native';

import { deleteRun, setRunVisibility } from './src/features/account/account-api';
import { registerForMessagePush, unregisterThisDevicePush } from './src/features/chat/push';
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
import { useRunCoach } from './src/hooks/use-run-coach';
import { useWatchRunImport } from './src/hooks/use-watch-run-import';
import { useWatchRunSync } from './src/hooks/use-watch-run-sync';
import type { RunPlan } from './src/features/running/run-plans';
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
import { GardenScreen } from './src/screens/garden-screen';
import { LiveGardenScreen } from './src/screens/live-garden-screen';
import { NotificationSettings } from './src/screens/notification-settings';
import { ChatListScreen, ChatThreadScreen } from './src/screens/chat-screens';
import { FriendsScreen } from './src/screens/friends-screen';
import { LoginScreen, OnboardingScreen, type OnboardingSubmission } from './src/screens/auth-screens';
import { HomeScreen, PlanRunScreen, RunCompleteScreen, RunScreen } from './src/screens/running-screens';
import { DiscoverScreen, ProfileScreen, ReportScreen, RequestScreen } from './src/screens/social-screens';
import { errorMessage } from './src/lib/errors';
import { AppShell } from './src/ui/components';

const isValidNickname = (nickname: string) => /^[가-힣]{2,8}$/.test(nickname);

export default function App() {
  const { session, isLoading: isSessionLoading, error: sessionError } = useAuthSession();
  const runRecorder = useRunRecorder(session?.user.id);
  const [runPlan, setRunPlan] = useState<RunPlan | null>(null);
  const social = useSocial(session?.user.id);
  const privacy = usePrivacy(session?.user.id);
  const runCoach = useRunCoach(runRecorder.activeRun, runRecorder.metrics, runPlan, privacy.status?.usualPaceSeconds ?? null);
  const chat = useChat(session?.user.id);
  const callbackUrl = Linking.useLinkingURL();
  const hadAuthenticatedSession = useRef(false);
  const pushToken = useRef<string | null>(null);
  const pushPending = useRef<Promise<void> | null>(null);
  const [pushStatus, setPushStatus] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const updatePush = (ask = true) => {
    if (pushPending.current || !session) return;
    setPushBusy(true);
    const pending = registerForMessagePush(ask).then(result => {
      if (result.status === 'registered') {
        pushToken.current = result.token;
        setPushStatus('이 기기의 알림 토큰을 등록했어요. 실제 수신은 서버 전송 설정과 기기 상태에 따라 달라요.');
      } else setPushStatus(result.status === 'denied' ? '알림 권한이 꺼져 있어요. 기기 설정에서 허용 후 다시 확인해 주세요.' : result.reason);
    }).catch(reason => setPushStatus(errorMessage(reason, '알림 등록에 실패했어요. 다시 시도해 주세요.')))
      .finally(() => { pushPending.current = null; setPushBusy(false); });
    pushPending.current = pending;
  };
  const [screen, setScreen] = useState<Screen>('login');
  const [notice, setNotice] = useState('');
  const [authenticatingProvider, setAuthenticatingProvider] = useState<SocialProvider | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null);
  const [gardenOwner, setGardenOwner] = useState<string | null>(null);
  const [gardenReturn, setGardenReturn] = useState<Screen>('home');
  const [chatReturn, setChatReturn] = useState<Screen>('chat');
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
          setNotice(errorMessage(error, '온보딩 상태를 확인하지 못했습니다.'));
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

  // 가입 직후 권한 팝업을 띄우지 않는다. 사용자가 설정에서 직접 활성화한다.
  useEffect(() => {
    setPushStatus('');
    if (session) updatePush(false);
  }, [session?.user.id]);

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
    await pushPending.current;
    try {
      await unregisterThisDevicePush(pushToken.current);
      pushToken.current = null;
    } catch (reason) {
      setNotice(errorMessage(reason, '이 기기의 알림 연결을 해제하지 못했어요. 네트워크 연결 후 로그아웃을 다시 시도해 주세요.'));
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
    if (!isValidNickname(input.nickname.trim())) {
      setNotice('닉네임은 한글 2~8자로 입력해 주세요.');
      return;
    }
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
      setNotice(errorMessage(error, '온보딩 정보를 저장하지 못했습니다.'));
    } finally {
      setSavingOnboarding(false);
    }
  };

  const startRun = (preferBackground: boolean, plan: RunPlan | null = null) => {
    setRunPlan(plan);
    void runRecorder.start(preferBackground).then((state) => {
      go('run');
      if (preferBackground && state.trackingMode === 'foreground') {
        setNotice('현재 실행 환경은 백그라운드 기록을 지원하지 않아 앱이 열린 동안만 기록해요. 개발 빌드에서는 화면이 꺼져도 기록할 수 있어요.');
      }
    }).catch((error) => {
      setRunPlan(null);
      setNotice(errorMessage(error, '러닝을 시작하지 못했습니다.'));
    });
  };

  const promptRunStart = (plan: RunPlan | null = null) => {
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
      startRun(false, plan);
      return;
    }
    Alert.alert(
      '러닝 중 위치 사용',
      '거리·시간·페이스와 안전한 동선 유사도 검증에 사용합니다. 원본 좌표와 정확한 시각은 다른 사용자에게 공개하지 않아요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '앱을 보는 동안', onPress: () => startRun(false, plan) },
        { text: '화면이 꺼져도 기록', onPress: () => startRun(true, plan) },
      ],
    );
  };

  const finishActiveRun = () => {
    void runRecorder.finish().then(() => {
      setSelectedRun(null);
      go('complete');
    }).catch(() => undefined);
  };

  useWatchRunSync(runRecorder, () => startRun(true), finishActiveRun);

  // 워치가 단독으로 기록한 러닝을 서버로 올린다. 좌표는 폰 러닝과 같은
  // location_points로 들어가므로 새 노출 경로가 생기지 않는다.
  const watchImport = useWatchRunImport(session?.user.id, () => {
    void runRecorder.refreshHistory();
  });

  useEffect(() => {
    if (watchImport.lastImported.length === 0) return;
    const kilometers = watchImport.lastImported
      .reduce((total, run) => total + run.distanceMeters, 0) / 1000;
    const recovered = watchImport.lastImported.some((run) => run.recovered);
    setNotice(recovered
      ? `애플워치 러닝 ${watchImport.lastImported.length}건을 가져왔어요. 워치 앱이 중간에 종료돼 마지막 좌표까지만 남은 기록이 있어요.`
      : `애플워치 러닝 ${watchImport.lastImported.length}건(${kilometers.toFixed(2)}km)을 가져왔어요.`);
    watchImport.dismiss();
  }, [watchImport.dismiss, watchImport.lastImported]);

  useEffect(() => {
    if (watchImport.error) setNotice(watchImport.error);
  }, [watchImport.error]);

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
      .catch((error) => setLogNotice(errorMessage(error)))
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
      .catch((error) => setLogNotice(errorMessage(error)))
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
        setReportNotice('신고를 접수했어요. 조회 가능한 프로필 내용은 서버가 보존하며, 이미 숨겨진 내용은 추가 수집하지 않아요. 신고자 정보는 상대에게 공개되지 않아요.');
        await social.refresh();
      })
      .catch((error) => setReportError(errorMessage(error)))
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
      .catch((error) => setReportError(errorMessage(error)))
      .finally(() => setReportBusy(false));
  };

  const openChatThread = (partnerId: string) => {
    setChatReturn(screen === 'friends' ? 'friends' : 'chat');
    void chat.openThread(partnerId);
    go('chatThread');
  };

  const leaveChatThread = () => {
    chat.closeThread();
    go(chatReturn);
  };

  const openGarden = (owner: string | null) => {
    setGardenReturn(screen);
    setGardenOwner(owner);
    go('garden');
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
      content = <LoginScreen authenticatingProvider={authenticatingProvider} isSessionLoading={isSessionLoading} notice={notice} onLogin={(provider) => void socialLogin(provider)} onPreviewOnboarding={() => go('onboarding')} onPreviewGarden={() => go('garden')} />;
      break;
    case 'onboarding':
      content = <OnboardingScreen saving={savingOnboarding} notice={notice} onBack={() => go('login')} onSubmit={(input) => void finishOnboarding(input)} />;
      break;
    case 'home':
      content = <HomeScreen recorder={runRecorder} notice={notice} trainingGoal={privacy.status?.trainingGoal} onStart={() => promptRunStart()} onStartPlan={() => go('plan')} onDiscover={() => go('discover')} onOpenRun={openRun} onOpenGarden={() => openGarden(null)} />;
      break;
    case 'garden':
      content = session ? <LiveGardenScreen key={`${session.user.id}:${gardenOwner ?? session.user.id}`} userId={session.user.id} ownerId={gardenOwner ?? session.user.id} onBack={() => { setGardenOwner(null); go(gardenReturn); }} onVisit={setGardenOwner} /> : <GardenScreen onBack={() => go('login')} onStartRun={() => go('login')} />;
      break;
    case 'run':
      content = <RunScreen recorder={runRecorder} coach={runCoach} plan={runPlan} notice={notice} onBack={leaveRunScreen} onHome={() => go('home')} onFinish={finishActiveRun} />;
      break;
    case 'plan':
      content = <PlanRunScreen trainingGoal={privacy.status?.trainingGoal} usualPaceSeconds={privacy.status?.usualPaceSeconds ?? null} onBack={() => go('home')} onStart={(plan) => promptRunStart(plan)} />;
      break;
    case 'complete':
      content = <RunCompleteScreen recorder={runRecorder} selectedRun={selectedRun} logBusy={logBusy} logNotice={logNotice} onHome={() => go('home')} onDiscover={() => go('discover')} onGarden={() => openGarden(null)} onChangeVisibility={changeRunVisibility} onDeleteRun={removeRun} />;
      break;
    case 'discover':
      content = <DiscoverScreen userId={session?.user.id} social={social} chatUnreadCount={chat.totalUnread} viewerAvailabilitySlots={privacy.status?.availabilitySlots ?? []} adultVerified={privacy.status?.ageVerificationComplete === true} onOpenProfile={() => go('profile')} onRequest={openRequest} onVisitGarden={openGarden} onReport={() => go('report')} onOpenChat={() => go('chat')} onStartPlan={() => go(runRecorder.activeRun ? 'run' : 'plan')} />;
      break;
    case 'friends':
      content = <FriendsScreen key={session?.user.id ?? 'guest'} userId={session?.user.id} adultVerified={privacy.status?.ageVerificationComplete === true} onDiscover={() => go('discover')} onAccount={() => go(session ? 'account' : 'login')} onChat={openChatThread} onGarden={openGarden} />;
      break;
    case 'request':
      content = <RequestScreen key={selectedCandidate?.id ?? 'no-candidate'} candidate={selectedCandidate} sending={social.actionRequestId === selectedCandidate?.id} error={social.error} onBack={() => go('discover')} onSend={sendRequest} onReport={openReport} />;
      break;
    case 'profile':
      content = <><ProfileScreen recentRuns={runRecorder.recentRuns} privacy={privacy} moderationNotices={moderationNotices} signedIn={Boolean(session)} onOpenRun={openRun} onOpenAccount={() => go('account')} onLogout={() => void logout()} />{session ? <NotificationSettings status={pushStatus} busy={pushBusy} onEnable={() => updatePush()} /> : null}</>;
      break;
    case 'account':
      content = <AccountScreen privacy={privacy} onBack={() => go('profile')} />;
      break;
    case 'chat':
      content = <ChatListScreen chat={chat} onBack={() => go('discover')} onOpenThread={openChatThread} />;
      break;
    case 'chatThread':
      content = <ChatThreadScreen key={`${session?.user.id ?? 'guest'}:${chat.openPartnerId ?? 'none'}`} chat={chat} userId={session?.user.id} onBack={leaveChatThread} onBlock={() => {
        const partnerId = chat.openPartnerId;
        if (!session || !partnerId) return;
        Alert.alert('이 러너를 차단할까요?', '서로의 발견·요청·대화와 메시지 알림이 차단돼요.', [{ text: '취소', style: 'cancel' }, { text: '차단', style: 'destructive', onPress: () => {
          void blockUser(session.user.id, partnerId).then(async () => {
            chat.closeThread(); go('chat'); await Promise.all([social.refresh(), chat.refreshThreads()]);
          }).catch(reason => Alert.alert('차단하지 못했어요', errorMessage(reason)));
        } }]);
      }} />;
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
