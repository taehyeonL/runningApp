import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '../../lib/supabase';
import { authStorage } from '../../lib/auth-storage';

const deviceTokenKey = 'message-push-device-token';

// expo-notifications는 최상위에서 import하지 않는다. Expo Go(SDK 53+)에서는
// 이 모듈을 불러오는 것만으로 원격 푸시 미지원 예외를 던지는데, 그러면 아래의
// "Expo Go면 조용히 비활성화" 검사가 실행되기도 전에 앱 전체가 뜨지 않는다.
// 지원되는 환경으로 판별된 뒤에 동적으로 불러온다.
type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null = null;

async function loadNotifications(): Promise<NotificationsModule> {
  if (notificationsModule) return notificationsModule;
  const loaded = await import('expo-notifications');
  // 알림은 "새 메시지가 있다"까지만 알린다. 본문은 서버가 보내지 않으므로
  // 잠금화면이나 알림 서버에 대화 내용이 남지 않는다.
  loaded.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
  notificationsModule = loaded;
  return loaded;
}

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

export async function registerForMessagePush(requestPermission = true): Promise<PushRegistration> {
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

  const notifications = await loadNotifications();

  // Android 13 권한 요청 전에 채널이 존재해야 한다.
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('messages', {
      name: '메시지 알림',
      importance: notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await notifications.getPermissionsAsync();
  const permission = existing.granted
    ? existing
    : requestPermission ? await notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    }) : existing;
  if (!permission.granted) return { status: 'denied' };

  const token = await notifications.getExpoPushTokenAsync({ projectId: id });
  const previous = await authStorage.getItem(deviceTokenKey);
  if (previous && previous !== token.data) await unregisterMessagePush(previous);
  // Keep enough device-local state to revoke after an app restart. Save before
  // registration so a killed app cannot leave a registered token it cannot find.
  await authStorage.setItem(deviceTokenKey, token.data);
  const { error } = await requireClient().rpc('register_push_token', {
    p_token: token.data,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;

  return { status: 'registered', token: token.data };
}

// 실패를 호출자에게 전달한다. 해제되지 않은 상태를 성공으로 표시하지 않는다.
export async function unregisterMessagePush(token: string) {
  const { error } = await requireClient().rpc('unregister_push_token', { p_token: token });
  if (error) throw error;
}

export async function unregisterThisDevicePush(fallbackToken: string | null) {
  const token = await authStorage.getItem(deviceTokenKey) ?? fallbackToken;
  if (!token) return;
  await unregisterMessagePush(token);
  await authStorage.removeItem(deviceTokenKey);
}
