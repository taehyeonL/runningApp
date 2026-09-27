// Read-only source checks. Never loads server credentials or writes remote state.
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const findings = [];
const entry = read('index.ts');
if (/LOCAL_SOCIAL_QA|local-social-qa|QaApp/.test(entry)) findings.push('임시 QA 진입점이 앱에 연결돼 있습니다.');
if (/draft-2026|베타 검토용 초안/.test(read('src/lib/legal-documents.ts'))) findings.push('약관이 아직 초안입니다. 실제 사업자/이전/보존 정보와 정식 동의 버전을 확정하세요.');
const env = existsSync(new URL('.env', root)) ? parseEnv(read('.env')) : {};
const email = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) findings.push('운영자 공개 문의 이메일이 없습니다.');
if (Object.keys(env).some(key => key.startsWith('EXPO_PUBLIC_') && /SERVICE_ROLE|SECRET|PRIVATE_KEY/.test(key))) findings.push('공개 환경변수의 비밀 키 의심 항목을 제거하고 노출 여부를 점검하세요.');
for (const finding of findings) console.error(`BLOCK: ${finding}`);
console.log('원격 배포·성인 인증·로그인 제공사·실제 푸시·실기기 QA는 docs/launch-readiness.md에서 별도 확인해야 합니다.');
process.exitCode = findings.length ? 1 : 0;
