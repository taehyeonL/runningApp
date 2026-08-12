import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function readEnvFile() {
  try {
    const text = await readFile(resolve(process.cwd(), '.env'), 'utf8');
    return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return [];
      const separator = trimmed.indexOf('=');
      if (separator < 1) return [];
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      return [[key, value]];
    }));
  } catch {
    return {};
  }
}

const fileEnv = await readEnvFile();
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ?? fileEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!projectUrl || !publishableKey) {
  console.error('OAuth 점검 실패: .env에 Supabase URL과 publishable key가 필요합니다.');
  process.exitCode = 1;
  throw new Error('Supabase public configuration is missing.');
}

const response = await fetch(`${projectUrl.replace(/\/$/, '')}/auth/v1/settings`, {
  headers: { apikey: publishableKey },
});
if (!response.ok) {
  console.error(`OAuth 점검 실패: Auth settings가 HTTP ${response.status}를 반환했습니다.`);
  process.exitCode = 1;
  throw new Error('Supabase Auth settings request failed.');
}

const settings = await response.json();
const required = ['apple', 'kakao', 'google'];
const disabled = [];
for (const provider of required) {
  const enabled = settings?.external?.[provider] === true;
  console.log(`${provider}: ${enabled ? 'enabled' : 'disabled'}`);
  if (!enabled) disabled.push(provider);
}
console.log('앱 callback: runningmate://auth/callback');

if (disabled.length > 0) {
  console.error(`실계정 검증 전 설정 필요: ${disabled.join(', ')}`);
  process.exitCode = 2;
} else {
  console.log('세 provider가 모두 활성화되어 있습니다. development build에서 실계정 callback을 검증하세요.');
}
