import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { hasSupabaseConfig, supabase } from './supabase';

export type SocialProvider = 'apple' | 'kakao' | 'google';

export type AuthActionResult =
  | { status: 'success'; session: Session }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

const nativeAuthRedirectUrl = 'runningmate://auth/callback';
const callbackPromises = new Map<string, Promise<AuthActionResult>>();

// Completes a popup auth session when the web build itself is loaded as the
// callback page. It is a no-op on native platforms.
WebBrowser.maybeCompleteAuthSession();

export function getAuthRedirectUrl() {
  return Platform.OS === 'web'
    ? Linking.createURL('auth/callback')
    : nativeAuthRedirectUrl;
}

export function isAuthCallbackUrl(url: string) {
  try {
    const actual = new URL(url);
    const expected = new URL(getAuthRedirectUrl());
    return actual.protocol === expected.protocol
      && actual.host === expected.host
      && actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function callbackError(url: URL) {
  return url.searchParams.get('error_description')
    ?? url.searchParams.get('error')
    ?? '로그인 제공자가 인증을 완료하지 못했습니다.';
}

async function exchangeCallback(url: string): Promise<AuthActionResult> {
  if (!supabase || !hasSupabaseConfig) {
    return { status: 'error', error: 'Supabase 환경변수가 설정되지 않았습니다.' };
  }
  if (!isAuthCallbackUrl(url)) {
    return { status: 'error', error: '허용되지 않은 로그인 콜백 주소입니다.' };
  }

  const callbackUrl = new URL(url);
  if (callbackUrl.searchParams.has('error')) {
    return { status: 'error', error: callbackError(callbackUrl) };
  }

  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    return { status: 'error', error: '로그인 콜백에 인증 코드가 없습니다.' };
  }

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { status: 'error', error: error.message };
    return { status: 'success', session: data.session };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : '로그인 세션을 저장하지 못했습니다.',
    };
  }
}

export function completeSocialLogin(url: string) {
  const existing = callbackPromises.get(url);
  if (existing) return existing;

  // Keep the completed promise for this app process as replay protection. The
  // same deep link can be delivered both by openAuthSessionAsync and Linking.
  const pending = exchangeCallback(url);
  callbackPromises.set(url, pending);
  return pending;
}

export async function beginSocialLogin(provider: SocialProvider): Promise<AuthActionResult> {
  if (!hasSupabaseConfig || !supabase) {
    return { status: 'error', error: 'Supabase 환경변수가 아직 설정되지 않았습니다. UI 데모 모드로 계속할 수 있어요.' };
  }

  try {
    const redirectTo = getAuthRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { status: 'error', error: error.message };
    if (!data.url) return { status: 'error', error: '로그인 주소를 만들지 못했습니다.' };

    const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
      preferEphemeralSession: false,
    });
    if (browserResult.type !== 'success') return { status: 'cancelled' };
    return completeSocialLogin(browserResult.url);
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : '로그인 창을 열지 못했습니다.',
    };
  }
}

export async function signOut() {
  if (!supabase) return { error: null };
  return supabase.auth.signOut({ scope: 'local' });
}
