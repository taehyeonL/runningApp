/** Server/operator-only fixture controls. No service key is imported by the app.
 * node scripts/dev-social-test.mjs status|enable|connect|restore
 * This is a manual test exception, NOT evidence of PASS verification.
 */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEV_URL = 'https://jojaafhbuzahtrdpyzox.supabase.co';
const ACCOUNTS = [
  { id: '012273ba-c35c-4758-bfad-d3aef5c08f0e', email: 'lth3723@gmail.com' },
  { id: '428c1b90-d50a-488b-abca-1b8cd2b850f4', email: 'lthlthltlt@gmail.com' },
];
export function assertDevTarget(serverUrl, appUrl) {
  if (serverUrl !== DEV_URL || appUrl !== DEV_URL) throw new Error('Only the explicitly approved dev project is supported.');
}
export function assertTestAccount(user, expected) {
  if (!user || user.id !== expected.id || user.email !== expected.email) throw new Error('Test account identity mismatch.');
}
export function canRestore(profile, fixture) {
  return fixture?.enabled === true && fixture.source === 'manual_test_not_pass'
    && Number.isFinite(Date.parse(fixture.appliedAgeVerifiedAt))
    && Date.parse(profile.age_verified_at) === Date.parse(fixture.appliedAgeVerifiedAt);
}
function checked(result, stage) {
  if (result.error) throw new Error(`${stage} failed (${result.error.code ?? result.error.status ?? 'unknown'}).`);
  return result.data;
}
async function main() {
  const command = process.argv[2] ?? 'status';
  if (!['status', 'enable', 'connect', 'restore'].includes(command) || process.argv.length > 3) {
    throw new Error('Usage: node scripts/dev-social-test.mjs status|enable|connect|restore');
  }
  const env = parseEnv(await readFile(new URL('../supabase/.env', import.meta.url), 'utf8'));
  const app = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  assertDevTarget(env.SUPABASE_URL, app.EXPO_PUBLIC_SUPABASE_URL);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server-only credentials are required.');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const accounts = [];
  for (const expected of ACCOUNTS) {
    const { user } = checked(await db.auth.admin.getUserById(expected.id), 'Account lookup');
    assertTestAccount(user, expected);
    const profile = checked(await db.from('profiles').select('id,nickname,age_verified_at').eq('id', expected.id).single(), 'Profile lookup');
    accounts.push({ user, profile });
  }
  if (command === 'enable') {
    for (const { user, profile } of accounts) {
      let fixture = user.app_metadata.dev_social_test;
      if (!fixture?.enabled) {
        // Do not replace a genuine verification timestamp with a synthetic one.
        if (profile.age_verified_at) continue;
        fixture = { enabled: true, source: 'manual_test_not_pass', previousAgeVerifiedAt: null, appliedAgeVerifiedAt: new Date().toISOString() };
        checked(await db.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, dev_social_test: fixture } }), 'Record restore marker');
      }
      if (profile.age_verified_at) {
        if (!canRestore(profile, fixture)) throw new Error('Verification changed outside the fixture. Refusing to overwrite it.');
        continue;
      }
      const changed = checked(await db.from('profiles').update({ age_verified_at: fixture.appliedAgeVerifiedAt }).eq('id', user.id).is('age_verified_at', null).select('id'), 'Enable test verification');
      if (changed.length !== 1) throw new Error('Concurrent verification change; inspect fixture status.');
    }
  }
  if (command === 'restore') {
    for (const { user, profile } of accounts) {
      const fixture = user.app_metadata.dev_social_test;
      if (!fixture?.enabled) continue;
      if (canRestore(profile, fixture)) {
        const changed = checked(await db.from('profiles').update({ age_verified_at: fixture.previousAgeVerifiedAt ?? null }).eq('id', user.id).eq('age_verified_at', profile.age_verified_at).select('id'), 'Restore verification');
        if (changed.length !== 1) throw new Error('Concurrent verification change; restore stopped.');
      } else if (profile.age_verified_at) {
        throw new Error('A different verification exists; refusing to erase it.');
      }
      checked(await db.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, dev_social_test: { ...fixture, enabled: false, restoredAt: new Date().toISOString() } } }), 'Close restore marker');
    }
  }
  const ids = ACCOUNTS.map(a => a.id).sort();
  if (command === 'connect') {
    const blocks = checked(await db.from('user_blocks').select('blocker_id').in('blocker_id', ids).in('blocked_id', ids), 'Block check');
    const deleting = checked(await db.from('account_deletion_requests').select('user_id').in('user_id', ids).is('cancelled_at', null).is('completed_at', null), 'Deletion check');
    if (blocks.length || deleting.length) throw new Error('Blocked/deleting accounts will not be connected.');
    // Explicit operator fixture: no encounter count, request quota or cooldown.
    // Does not manufacture accepted requests, messages, GPS points or consents.
    checked(await db.from('friendships').upsert({ user_one_id: ids[0], user_two_id: ids[1] }, { onConflict: 'user_one_id,user_two_id', ignoreDuplicates: true }), 'Connect test pair');
  }
  const profiles = checked(await db.from('profiles').select('id,nickname,age_verified_at').in('id', ids), 'Verify profiles');
  const relationships = checked(await db.from('friendships').select('id').eq('user_one_id', ids[0]).eq('user_two_id', ids[1]), 'Verify friendship');
  console.log(JSON.stringify({ command, profiles: profiles.map(p => ({ id: p.id, nickname: p.nickname, adultGateOpen: Boolean(p.age_verified_at) })), friendshipCount: relationships.length, actualPassVerification: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
