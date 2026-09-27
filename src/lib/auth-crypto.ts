import { Platform } from 'react-native';

// auth-js otherwise silently falls back to Math.random + a plain PKCE challenge.
// This is a narrow PKCE adapter, not a general WebCrypto implementation.
export async function ensureAuthCrypto() {
  if (typeof globalThis.crypto?.getRandomValues === 'function' && typeof globalThis.crypto?.subtle?.digest === 'function' && typeof TextEncoder !== 'undefined') return;
  if (Platform.OS === 'web') throw new Error('안전한 로그인은 HTTPS 환경에서 이용해 주세요.');
  const native = await import('expo-crypto');
  const target = (globalThis.crypto ?? {}) as Crypto;
  if (!target.getRandomValues) {
    Object.defineProperty(target, 'getRandomValues', { configurable: true, value: native.getRandomValues });
  }
  if (!target.subtle) {
    Object.defineProperty(target, 'subtle', { configurable: true, value: {
      digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        if (name.toUpperCase() !== 'SHA-256') throw new Error('Unsupported authentication digest');
        return native.digest(native.CryptoDigestAlgorithm.SHA256, data);
      },
    } });
  }
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: target });
  if (!target.subtle?.digest || typeof TextEncoder === 'undefined') {
    throw new Error('안전한 로그인 모듈을 사용할 수 없어요. 앱을 업데이트해 주세요.');
  }
}
