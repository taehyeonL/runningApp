import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in mocks)) throw Error(`Missing mock ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('native auth uses secure random bytes and SHA-256; missing native crypto never silently downgrades', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    let randomCalls = 0;
    const auth = load('../src/lib/auth-crypto.ts', {
      'react-native': { Platform: { OS: 'android' } },
      'expo-crypto': { getRandomValues: array => { randomCalls++; return webcrypto.getRandomValues(array); }, CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data) },
    });
    await auth.ensureAuthCrypto();
    crypto.getRandomValues(new Uint32Array(56)); assert.equal(randomCalls, 1);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    assert.equal(Buffer.from(digest).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.throws(() => crypto.subtle.digest('MD5', new Uint8Array()), /Unsupported/);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
});
test('Android notification channel precedes permission prompt and RPC errors are not success', async () => {
  const calls = [];
  const plainError = { message: 'registration denied' };
  const push = load('../src/features/chat/push.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } },
    'react-native': { Platform: { OS: 'android' } },
    '../../lib/supabase': { supabase: { rpc: async () => ({ error: plainError }) } },
    '../../lib/auth-storage': { authStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
    'expo-notifications': { setNotificationHandler() {}, AndroidImportance: { DEFAULT: 3 }, setNotificationChannelAsync: async () => calls.push('channel'), getPermissionsAsync: async () => ({ granted: false }), requestPermissionsAsync: async () => { calls.push('permission'); return { granted: true }; }, getExpoPushTokenAsync: async () => ({ data: 'test-token' }) },
  });
  await assert.rejects(push.registerForMessagePush(), error => error === plainError);
  assert.deepEqual(calls, ['channel', 'permission']);
  await assert.rejects(push.unregisterMessagePush('test-token'), error => error === plainError);
});
function chatHarness() {
  const slots = []; let index = 0; let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const hooks = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const pending = [];
  let allowed = [{ partnerId: 'b', unreadCount: 0 }, { partnerId: 'c', unreadCount: 0 }];
  const { useChat } = load('../src/hooks/use-chat.ts', {
    'react-native': { AppState: { currentState: 'background', addEventListener: () => ({ remove() {} }) } },
    react: hooks, '../lib/supabase': { supabase: {} }, '../lib/errors': { errorMessage: e => e.message },
    '../features/chat/chat-realtime': { subscribeToChat: () => () => {} },
    '../features/chat/chat-api': { fetchChatThreads: async () => allowed, fetchMessages: (...args) => new Promise(resolve => pending.push({ args, resolve })), markMessagesRead: async () => 0, reportMessage: async () => {}, sendMessage: async () => {} },
  });
  return { pending, restrict() { allowed = []; }, render(user = 'a') { index = 0; const result = useChat(user); const current = effects; effects = []; current.forEach(fn => fn()); return result; } };
}
test('device token survives restart and is removed only after confirmed server unregister', async () => {
  let stored = 'persisted-device-token'; let failing = true; const calls = [];
  const push = load('../src/features/chat/push.ts', {
    'expo-constants': { __esModule: true, default: {} },
    'react-native': { Platform: { OS: 'android' } },
    '../../lib/auth-storage': { authStorage: { getItem: async () => stored, removeItem: async () => { stored = null; }, setItem: async (_, value) => { stored = value; } } },
    '../../lib/supabase': { supabase: { rpc: async (name, args) => { calls.push([name, args]); return { error: failing ? { message: 'offline' } : null }; } } },
  });
  await assert.rejects(push.unregisterThisDevicePush(null), error => error.message === 'offline');
  assert.equal(stored, 'persisted-device-token');
  failing = false; await push.unregisterThisDevicePush(null);
  assert.equal(stored, null);
  assert.deepEqual(calls[1], ['unregister_push_token', { p_token: 'persisted-device-token' }]);
});
test('switching or closing a conversation rejects late message results', async () => {
  const h = chatHarness(); h.render(); await tick();
  const first = h.render().openThread('b');
  const second = h.render().openThread('c');
  h.pending[1].resolve({ messages: [{ id: 'c-message' }], hasMore: false }); await second;
  h.pending[0].resolve({ messages: [{ id: 'b-private' }], hasMore: false }); await first;
  assert.deepEqual(h.render().messages.map(x => x.id), ['c-message']);
  const late = h.render().openThread('b'); h.render().closeThread();
  h.pending[2].resolve({ messages: [{ id: 'closed-private' }], hasMore: true }); await late;
  assert.deepEqual(h.render().messages, []); assert.equal(h.render().openPartnerId, null);
  h.render(null);
});
test('logout and revoked relationship remove cached messages and composer access', async () => {
  const h = chatHarness(); h.render(); await tick();
  const opening = h.render().openThread('b');
  h.pending[0].resolve({ messages: [{ id: 'private' }], hasMore: false }); await opening;
  assert.equal(h.render().messages.length, 1);
  h.restrict(); await h.render().refreshThreads();
  assert.equal(h.render().openPartnerId, null); assert.deepEqual(h.render().messages, []);
  const late = h.render().openThread('b'); h.render(null);
  h.pending[1].resolve({ messages: [{ id: 'old-account' }], hasMore: false }); await late;
  assert.deepEqual(h.render(null).messages, []);
});
test('legal texts remain explicitly drafts and cover consent, safety and location boundaries', () => {
  const { legalDocuments, legalDraftNotice } = load('../src/lib/legal-documents.ts', {});
  assert.deepEqual(Object.keys(legalDocuments), ['terms', 'privacy', 'location']);
  assert.match(legalDraftNotice, /초안/);
  for (const doc of Object.values(legalDocuments)) { assert.ok(doc.sections.length >= 8); assert.ok(doc.sections.every(section => section.title && section.body.length > 30)); }
});
