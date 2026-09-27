import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { conversationStarters } from '../src/features/chat/conversation-starters.ts';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/screens/chat-screens.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(overrides = {}) {
  const state = []; let index = 0; const sent = [];
  const hooks = {
    useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = index++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useMemo(fn) { return fn(); },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { ...Object.fromEntries(['Text','View','Pressable','FlatList','TextInput','KeyboardAvoidingView'].map((v) => [v,v])), Platform: { OS: 'android' } };
    if (name.endsWith('/components')) return new Proxy({}, { get: (_, key) => key });
    if (name.endsWith('/styles')) return { styles: {} };
    if (name.endsWith('conversation-starters')) return { conversationStarters };
    return {};
  }, module, module.exports);
  const chat = { openThreadSummary: { partnerId:'b', partnerNickname:'메이트' }, openPartnerId:'b', messages:[], isLoading:false, isSending:false, error:null, send:async (body) => sent.push(body), ...overrides };
  return { chat, sent, render() { index=0; return module.exports.ChatThreadScreen({ chat, userId:'a', onBack() {} }); } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children), ...nodes(node.props?.ListFooterComponent)];
}
const starters = (tree) => nodes(tree).filter((n) => n.props?.accessibilityLabel?.endsWith('입력창에 담기'));
const input = (tree) => nodes(tree).find((n) => n.type === 'TextInput');
const send = (tree) => nodes(tree).find((n) => n.props?.accessibilityLabel === '메시지 전송');
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('starter selection only fills editable draft, never automatically sends', async () => {
  const h = harness();
  assert.equal(starters(h.render()).length, 3);
  starters(h.render())[0].props.onPress();
  assert.equal(h.sent.length, 0);
  assert.equal(input(h.render()).props.value, conversationStarters[0].body);
  input(h.render()).props.onChangeText('내 말투로 수정한 인사');
  send(h.render()).props.onPress(); await tick();
  assert.deepEqual(h.sent, ['내 말투로 수정한 인사']);
});
test('no suggestions for loading, failed, missing, mismatched or already active conversation', () => {
  for (const overrides of [{ isLoading:true }, { error:'failed' }, { openThreadSummary:null }, { openPartnerId:'c' }, { messages:[{id:'1'}] }]) {
    assert.equal(starters(harness(overrides).render()).length, 0);
  }
});
test('existing draft disables replacement by suggested text', () => {
  const h = harness(); input(h.render()).props.onChangeText('작성 중');
  assert.ok(starters(h.render()).every((node) => node.props.disabled));
});
test('duplicate taps send once and failure restores the draft', async () => {
  let reject; let count = 0;
  const h = harness({ send: () => { count++; return new Promise((_, failure) => { reject = failure; }); } });
  starters(h.render())[1].props.onPress();
  const submit = send(h.render()).props.onPress;
  submit(); submit(); assert.equal(count, 1);
  reject({ message:'failed' }); await tick();
  assert.equal(input(h.render()).props.value, conversationStarters[1].body);
  assert.equal(send(h.render()).props.disabled, false);
});
test('unconfirmed partner cannot send even if callback is directly invoked', async () => {
  const h = harness({ openThreadSummary:null });
  input(h.render()).props.onChangeText('hello');
  send(h.render()).props.onPress(); await tick();
  assert.equal(h.sent.length, 0);
});
