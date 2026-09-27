import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as socialTypes from '../src/features/social/social-types.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/screens/social-screens.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(overrides = {}) {
  const state = []; let index = 0; const sent = []; const alerts = [];
  const hooks = {
    useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = value; }]; },
    useRef(initial) { const i = index++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { Text: 'Text', View: 'View', Pressable: 'Pressable', Alert: { alert: (...args) => alerts.push(args) } };
    if (name.endsWith('social-types')) return socialTypes;
    if (name.endsWith('/components')) return new Proxy({}, { get: (_, key) => key });
    if (name.endsWith('/styles')) return { styles: {} };
    return {};
  }, module, module.exports);
  const props = { candidate: { id: 'fixture', requestEligible: true, profile: { nickname: '예시러너' } }, sending: false, error: null, onBack() {}, onReport() {}, onSend: async (key) => sent.push(key), ...overrides };
  function render() { index = 0; return module.exports.RequestScreen(props); }
  return { render, sent, props, alerts };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const radios = (tree) => nodes(tree).filter((n) => n.props?.accessibilityRole === 'radio');
const button = (tree) => nodes(tree).find((n) => n.type === 'PrimaryButton');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('requires explicit choice and previews the same label received by the other user', async () => {
  for (let i = 0; i < 3; i++) {
    const h = harness();
    assert.equal(button(h.render()).props.disabled, true);
    radios(h.render())[i].props.onPress();
    const tree = h.render();
    assert.equal(radios(tree)[i].props.accessibilityState.checked, true);
    assert.ok(nodes(tree).some((n) => n.type === 'Text' && n.props.children === socialTypes.requestProposals[i].label));
    button(tree).props.onPress(); await tick();
    assert.deepEqual(h.sent, [socialTypes.requestProposals[i].key]);
    assert.equal(button(h.render()).props.disabled, true);
  }
});
test('ineligible candidates and sending state cannot invoke submission', async () => {
  for (const overrides of [{ candidate: { id: 'fixture', requestEligible: false, profile: { nickname: '예시' } } }, { sending: true }]) {
    const h = harness(overrides);
    radios(h.render())[0].props.onPress();
    assert.equal(button(h.render()).props.disabled, true);
    button(h.render()).props.onPress(); await tick();
    assert.equal(h.sent.length, 0);
  }
});
test('rapid repeat taps submit only once before parent state updates', async () => {
  let release; let count = 0;
  const h = harness({ onSend: () => { count++; return new Promise((resolve) => { release = resolve; }); } });
  radios(h.render())[0].props.onPress();
  const send = button(h.render()).props.onPress;
  send(); send(); assert.equal(count, 1);
  release(); await tick(); send(); assert.equal(count, 1);
});
test('failed request preserves selection and allows retry with visible server error', async () => {
  let count = 0;
  const h = harness({ onSend: async () => { count++; throw { message: 'server refused' }; } });
  radios(h.render())[1].props.onPress();
  button(h.render()).props.onPress(); await tick();
  h.props.error = '오늘 보낼 수 있는 요청 수를 모두 사용했어요.';
  const tree = h.render();
  assert.equal(radios(tree)[1].props.accessibilityState.checked, true);
  assert.ok(nodes(tree).some((n) => n.type === 'Notice' && n.props.text === h.props.error));
  button(tree).props.onPress(); await tick(); assert.equal(count, 2);
  assert.equal(h.alerts.length, 0);
});
test('missing candidate has no proposal or send controls; safety remains on regular screen', () => {
  assert.equal(radios(harness({ candidate: null }).render()).length, 0);
  const tree = harness().render();
  assert.ok(nodes(tree).some((n) => n.type === 'SafetyGuide'));
  assert.ok(nodes(tree).some((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'button'));
  assert.ok(!source.includes('반복 교차 5회'));
});
