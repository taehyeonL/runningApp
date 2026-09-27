import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/styles')) return { styles: {} };
    if (name.endsWith('/components')) return new Proxy({}, { get: (_, key) => key });
    if (name === 'react-native') return { Text: 'Text', View: 'View', Pressable: 'Pressable' };
    return mocks[name] ?? {};
  }, module, module.exports);
  return module.exports;
}
function nodes(n) { return Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : []; }

test('four match choices remain distinct from own gender; hidden warning and disabled state', () => {
  const api = load('../src/features/account/match-preferences.ts', {});
  const ui = load('../src/screens/match-preferences.tsx', { '../features/account/match-preferences': api });
  const selected = [];
  const value = { gender: 'unspecified', preference: 'any' };
  const tree = ui.MatchPreferenceFields({ value, onChange: v => selected.push(v) });
  const buttons = nodes(tree).filter(n => n.props?.accessibilityRole === 'radio');
  assert.equal(buttons.length, 7);
  for (const b of buttons.slice(3)) b.props.onPress();
  assert.deepEqual(selected.map(v => v.preference), ['male', 'female', 'any', 'hidden']);
  assert.ok(selected.every(v => v.gender === 'unspecified'));
  const hidden = ui.MatchPreferenceFields({ value: { ...value, preference: 'hidden' }, onChange() {}, disabled: true });
  assert.ok(nodes(hidden).some(n => n.props?.text?.includes('기존 친구·대화')));
  assert.ok(nodes(hidden).filter(n => n.props?.accessibilityRole === 'radio').every(n => n.props.disabled));
});

test('settings API uses owner RPC, preserves choice on save, and propagates plain-object errors', async () => {
  const calls = [];
  let failure = null;
  const supabase = { rpc(name, args) {
    calls.push([name, args]);
    if (name === 'get_match_preferences') return { single: async () => ({ data: { gender: 'female', preference: 'hidden' }, error: failure }) };
    return Promise.resolve({ data: true, error: failure });
  } };
  const api = load('../src/features/account/match-preferences.ts', { '../../lib/supabase': { supabase } });
  assert.deepEqual(await api.getMatchPreferences(), { gender: 'female', preference: 'hidden' });
  await api.saveMatchPreferences({ gender: 'male', preference: 'female' });
  assert.deepEqual(calls[1], ['set_match_preferences', { p_gender: 'male', p_preference: 'female' }]);
  failure = { message: 'network error', code: 'test' };
  await assert.rejects(api.saveMatchPreferences({ gender: 'male', preference: 'any' }), e => e === failure);
});

test('onboarding keeps discovery closed until match preferences and consent succeed', async () => {
  const calls = [];
  let fail = true;
  const supabase = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    insert: async row => { calls.push(['profile', row]); return {}; },
    update: row => ({ eq: async () => { calls.push(['discovery', row]); return {}; } }),
  }), rpc: async (name) => { calls.push([name]); return {}; } };
  const api = load('../src/lib/onboarding.ts', {
    './supabase': { supabase },
    '../features/account/match-preferences': { saveMatchPreferences: async value => { calls.push(['match', value]); if (fail) throw { message: 'save failed' }; } },
  });
  const input = { nickname: '테스트', intent: '러닝 메이트', runningStyle: '초보 환영', visibility: '매칭 공개', trainingGoal: 'habit', usualPaceSeconds: 420, availabilitySlots: [], matchPreferences: { gender: 'female', preference: 'hidden' } };
  await assert.rejects(api.saveOnboarding({ user: { id: 'test' } }, input));
  assert.equal(calls[0][1].discovery_enabled, false);
  assert.ok(!calls.some(c => c[0] === 'discovery'));
  calls.length = 0; fail = false;
  await api.saveOnboarding({ user: { id: 'test' } }, input);
  assert.deepEqual(calls.find(c => c[0] === 'match')[1], input.matchPreferences);
  assert.equal(calls.filter(c => c[0] === 'record_consent').length, 4);
  assert.equal(calls.at(-1)[0], 'discovery');
});
