import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '../../lib/supabase';

// 알림은 "새 메시지가 있다"까지만 알린다. 본문은 서버가 보내지 않으므로
// 잠금화면이나 알림 서버에 대화 내용이 남지 않는다.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export type PushRegistration =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string };

function projectId() {
  const config = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return config?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

export async function registerForMessagePush(): Promise<PushRegistration> {
  // 웹에서는 별도의 푸시 설정이 필요하고, Expo Go는 SDK 53부터 원격 푸시를
  // 지원하지 않는다. 두 경우 모두 조용히 실패하지 않고 이유를 돌려준다.
  if (Platform.OS === 'web') {
    return { status: 'unsupported', reason: '웹에서는 푸시 알림을 사용할 수 없어요.' };
  }
  if (Constants.appOwnership === 'expo') {
    return {
      status: 'unsupported',
      reason: 'Expo Go에서는 원격 푸시를 받을 수 없어요. 개발 빌드에서 확인해 주세요.',
    };
  }

  const id = projectId();
  if (!id) {
    return {
      status: 'unsupported',
      reason: 'EAS 프로젝트 ID가 없어 푸시 토큰을 발급받을 수 없어요.',
    };
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  if (!permission.granted) return { status: 'denied' };

  // Android 8.0부터 모든 알림은 채널에 속해야 한다.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: '메시지 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await requireClient().rpc('register_push_token', {
    p_token: token.data,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });

  return { status: 'registered', token: token.data };
}

// 로그아웃한 기기로 알림이 계속 가지 않도록 토큰을 지운다. 실패해도 로그아웃
// 자체를 막지는 않는다.
export async function unregisterMessagePush(token: string) {
  await requireClient().rpc('unregister_push_token', { p_token: token });
}
