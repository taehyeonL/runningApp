import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as presentation from '../src/features/social/runner-card-presentation.ts';
import * as achievements from '../src/features/running/runner-achievements.ts';

// Execute the real TSX with host element stubs: no app session or server data changes.
const require = createRequire(import.meta.url);
const module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../src/ui/components.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'module', 'exports', code)((name) => {
  if (name === 'react-native') return Object.fromEntries(['Pressable', 'SafeAreaView', 'ScrollView', 'Switch', 'Text', 'View'].map((key) => [key, key]));
  if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
  if (name === './styles') return { styles: {} };
  if (name.includes('safety-guide')) return {};
  if (name.includes('runner-card-presentation')) return presentation;
  if (name.includes('runner-achievements')) return achievements;
  return require(name);
}, module, module.exports);
const { RunnerCard } = module.exports;
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node !== 'object') return String(node);
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.props.children);
}
const candidate = {
  id: 'example-only', similarityLabel: 'quite_good_match', reasons: ['페이스가 비슷해요'],
  repeatEncounters30d: 2, requestEligible: false, safeOverlapSummary: null,
  generatedAt: 'EXACT_TIMESTAMP_MUST_NOT_RENDER', expiresAt: 'EXPIRY_MUST_NOT_RENDER',
  profile: { id: 'example', nickname: '예시러너', ageBand: null, primaryAchievement: 'consistent', completedRunCount: 12,
    runningStyleTags: ['beginner_friendly'], relationshipIntents: ['running_mate'],
    availabilitySlots: ['weekend_morning'], paceMinSeconds: 375, paceMaxSeconds: 465 },
};
test('expanded card foregrounds shared rhythm and pace before achievement/history', () => {
  const text = textOf(RunnerCard({ candidate, expanded: true, viewerAvailabilitySlots: ['weekend_morning'] }));
  assert.ok(text.indexOf('주말 오전, 러닝 리듬이 겹쳐요') < text.indexOf('꾸준한 러너'));
  assert.ok(text.indexOf('6:15–7:45 /km') < text.indexOf('최근 한 달'));
  assert.ok(text.includes('초보 환영'));
  assert.ok(text.includes('리듬이 조금 더 쌓이면 요청이 열려요'));
  assert.ok(!text.includes('EXACT_TIMESTAMP') && !text.includes('EXPIRY'));
});
test('compact card retains core running information without expanded history', () => {
  const text = textOf(RunnerCard({ candidate }));
  assert.ok(text.includes('6:15–7:45 /km') && text.includes('주말 오전'));
  assert.ok(!text.includes('최근 한 달'));
});
test('interactive card keeps the supplied action and accessible button semantics', () => {
  let pressed = 0;
  const card = RunnerCard({ candidate: { ...candidate, requestEligible: true }, expanded: true, onPress: () => pressed++ });
  assert.equal(card.props.accessibilityRole, 'button');
  card.props.onPress();
  assert.equal(pressed, 1);
  assert.ok(textOf(card).includes('가볍게 같이 뛰자고 제안하기'));
});
