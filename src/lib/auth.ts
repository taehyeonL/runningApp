import { hasSupabaseConfig, supabase } from './supabase';

export type SocialProvider = 'apple' | 'kakao' | 'google';

/**
 * TODO(인증):
 * - Supabase Dashboard에서 Apple, Kakao, Google OAuth provider를 활성화한다.
 * - 각 공급자의 client ID/secret 및 runningmate://auth/callback redirect URL을 등록한다.
 * - 네이티브 빌드에서 deep link 완료 처리를 추가하고 SecureStore 기반 세션 저장소를 적용한다.
 */
export async function beginSocialLogin(provider: SocialProvider) {
  if (!hasSupabaseConfig || !supabase) {
    return { error: 'Supabase 환경변수가 아직 설정되지 않았습니다. UI 데모 모드로 계속할 수 있어요.' };
  }

  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: 'runningmate://auth/callback', skipBrowserRedirect: false },
  });
}
