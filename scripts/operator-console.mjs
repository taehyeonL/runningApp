#!/usr/bin/env node
/**
 * 운영자 콘솔.
 *
 * 신고 검토와 제재는 service_role 권한이 필요하다. 그 키는 브라우저나 앱에
 * 절대 들어갈 수 없으므로, 콘솔은 운영자 기기에서 도는 CLI로 만든다. 웹 화면이
 * 필요해지면 서버에서 키를 쥐고 운영자 로그인을 검증하는 계층을 따로 두어야
 * 하며, 이 스크립트가 쓰는 RPC를 그대로 재사용하면 된다.
 *
 * 필요한 환경변수 (.env 또는 셸):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPERATOR_ID
 *
 * 사용법:
 *   node scripts/operator-console.mjs queue [상태] [개수]
 *   node scripts/operator-console.mjs show <report_id>
 *   node scripts/operator-console.mjs history <user_id>
 *   node scripts/operator-console.mjs resolve <report_id> <조치> [--days N] [--notice "..."] [--note "..."]
 *
 * 조치: warning | remove_content | request_restriction | visibility_restriction
 *       | suspension | ban | dismissed
 */
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { renderEvidence } from './operator-evidence.mjs';

const ACTIONS = new Set([
  'warning', 'remove_content', 'request_restriction',
  'visibility_restriction', 'suspension', 'ban', 'dismissed',
]);

// 되돌리기 어려운 조치는 실행 전에 사람이 한 번 더 확인한다.
const HEAVY_ACTIONS = new Set(['suspension', 'ban']);

async function readEnvFile() {
  try {
    const text = await readFile(resolvePath(process.cwd(), '.env'), 'utf8');
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

async function config() {
  const env = { ...(await readEnvFile()), ...process.env };
  const url = env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const operatorId = env.OPERATOR_ID;
  const missing = [
    !url && 'SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
    !operatorId && 'OPERATOR_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`환경변수가 없습니다: ${missing.join(', ')}`);
  }
  return { url: url.replace(/\/$/, ''), key, operatorId };
}

async function rpc(name, body) {
  const { url, key } = await config();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).message ?? text;
    } catch { /* 원문 그대로 보여준다 */ }
    throw new Error(`${name} 실패 (HTTP ${response.status}): ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

function line(char = '─', width = 68) {
  return char.repeat(width);
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

function renderQueueRow(row) {
  const flags = [
    row.currently_restricted ? '노출중지중' : null,
    row.confirmed_violations_90d > 0 ? `확정위반 ${row.confirmed_violations_90d}건/90일` : null,
  ].filter(Boolean).join(' · ');
  return [
    `${row.reason.padEnd(16)} ${row.subject_nickname}`,
    `  report  ${row.report_id}`,
    `  subject ${row.subject_id}`,
    `  접수 ${formatDate(row.reported_at)} · 서로 다른 신고자 ${row.distinct_reporters_30d}명/30일${flags ? ` · ${flags}` : ''}`,
  ].join('\n');
}

async function commandQueue(args) {
  const { operatorId } = await config();
  const status = args[0] ?? 'under_review';
  const limit = Number(args[1] ?? 50);
  const rows = await rpc('operator_review_queue', {
    p_operator_id: operatorId,
    p_status: status,
    p_limit: Number.isFinite(limit) ? limit : 50,
  });
  if (rows.length === 0) {
    console.log(`'${status}' 상태의 신고가 없습니다.`);
    return;
  }
  console.log(`\n${status} · ${rows.length}건\n${line()}`);
  for (const row of rows) {
    console.log(renderQueueRow(row));
    console.log(line('·'));
  }
  console.log('\n증거를 보려면: show <report_id>');
}

async function commandShow(args) {
  const { operatorId } = await config();
  const reportId = args[0];
  if (!reportId) throw new Error('report_id가 필요합니다.');

  // 큐 RPC가 상태별 조회라 상태를 돌며 찾는다. 검토 대상은 많아야 수백 건이다.
  for (const status of ['under_review', 'open', 'actioned', 'dismissed']) {
    const rows = await rpc('operator_review_queue', {
      p_operator_id: operatorId, p_status: status, p_limit: 200,
    });
    const found = rows.find((row) => row.report_id === reportId);
    if (!found) continue;

    console.log(`\n${line()}`);
    console.log(`신고 ${found.report_id} (${found.status})`);
    console.log(`대상 ${found.subject_nickname} · ${found.subject_id}`);
    console.log(`사유 ${found.reason} · 접수 ${formatDate(found.reported_at)}`);
    console.log(`서로 다른 신고자 ${found.distinct_reporters_30d}명/30일 · 확정위반 ${found.confirmed_violations_90d}건/90일`);
    console.log(`현재 노출 제한: ${found.currently_restricted ? '예' : '아니오'}`);
    console.log(line('·'));
    console.log('신고 내용:');
    console.log(found.details ? `  ${found.details}` : '  (없음)');
    console.log('증거 (서버가 원문에서 복사한 것):');
    console.log(renderEvidence(found.evidence));
    console.log(line());
    return;
  }
  console.log('해당 신고를 찾지 못했습니다.');
}

async function commandHistory(args) {
  const { operatorId } = await config();
  const subjectId = args[0];
  if (!subjectId) throw new Error('user_id가 필요합니다.');
  const rows = await rpc('operator_sanction_history', {
    p_operator_id: operatorId,
    p_subject_id: subjectId,
  });
  if (rows.length === 0) {
    console.log('제재 이력이 없습니다.');
    return;
  }
  console.log(`\n제재 이력 ${rows.length}건\n${line()}`);
  for (const row of rows) {
    const who = row.origin === 'auto' ? '자동(검토 대기 신호)' : `운영자 ${row.decided_by_label ?? '-'}`;
    const active = row.resolved_at ? `해제됨 ${formatDate(row.resolved_at)}` : '유효';
    console.log(`${row.action_type} · ${who}`);
    console.log(`  ${formatDate(row.starts_at)} ~ ${row.ends_at ? formatDate(row.ends_at) : '무기한'} · ${active}`);
    if (row.report_reason) console.log(`  신고 사유: ${row.report_reason}`);
    if (row.internal_notes) console.log(`  내부 메모: ${row.internal_notes}`);
    console.log(line('·'));
  }
}

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--days') { flags.days = Number(args[i + 1]); i += 1; continue; }
    if (args[i] === '--notice') { flags.notice = args[i + 1]; i += 1; continue; }
    if (args[i] === '--note') { flags.note = args[i + 1]; i += 1; continue; }
    rest.push(args[i]);
  }
  return { flags, rest };
}

async function commandResolve(args) {
  const { operatorId } = await config();
  const { flags, rest } = parseFlags(args);
  const [reportId, actionType] = rest;
  if (!reportId || !actionType) {
    throw new Error('사용법: resolve <report_id> <조치> [--days N] [--notice "..."] [--note "..."]');
  }
  if (!ACTIONS.has(actionType)) {
    throw new Error(`알 수 없는 조치: ${actionType}\n가능: ${[...ACTIONS].join(', ')}`);
  }
  // 제재 대상에게 사유와 기간을 알려야 한다. 기각이 아니면 안내문을 요구한다.
  if (actionType !== 'dismissed' && !flags.notice) {
    throw new Error('제재를 확정하려면 --notice 로 당사자 안내문을 적어야 합니다. 사유·기간·이의제기 방법을 포함하세요.');
  }

  if (HEAVY_ACTIONS.has(actionType)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `${actionType}은(는) 계정 이용을 끊는 조치입니다. 증거를 확인했습니까? 계속하려면 '${actionType}' 을 그대로 입력하세요: `,
    );
    rl.close();
    if (answer.trim() !== actionType) {
      console.log('취소했습니다.');
      return;
    }
  }

  const actionId = await rpc('operator_resolve_report', {
    p_operator_id: operatorId,
    p_report_id: reportId,
    p_action_type: actionType,
    p_duration_days: Number.isFinite(flags.days) ? flags.days : null,
    p_user_notice: flags.notice ?? null,
    p_internal_notes: flags.note ?? null,
  });

  if (actionType === 'dismissed') {
    console.log('신고를 기각했습니다. 자동으로 걸려 있던 노출 제한도 해제했습니다.');
  } else {
    console.log(`조치를 확정했습니다. action_id=${actionId}`);
    console.log('당사자에게는 안내문만 보이고, 신고자 신원과 내부 메모는 노출되지 않습니다.');
  }
}

const COMMANDS = {
  queue: commandQueue,
  show: commandShow,
  history: commandHistory,
  resolve: commandResolve,
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.log(`사용 가능한 명령: ${Object.keys(COMMANDS).join(', ')}`);
    console.log('자세한 사용법은 이 파일 상단 주석을 참고하세요.');
    process.exitCode = command ? 1 : 0;
    return;
  }
  await handler(args);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
