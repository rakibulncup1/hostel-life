import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'src/features/platform/SuperAdminPage.jsx'), 'utf8');
const block = (start, end) => {
  const from = page.indexOf(start);
  assert.notEqual(from, -1, `missing block start: ${start}`);
  const to = page.indexOf(end, from);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return page.slice(from, to);
};

test('MFA factor discovery reads verified TOTP separately from all unverified factors', () => {
  const reload = block('const reloadMfaFactors = async () => {', 'const selectMfaFactorForChallenge');
  assert.match(reload, /Array\.isArray\(data\?\.all\)/);
  assert.match(reload, /data\?\.totp/);
  assert.match(reload, /factor\.factor_type === 'totp' && factor\.status !== 'verified'/);
});

test('password verification selects a factor without creating a time-sensitive challenge', () => {
  const prepare = block('const prepareSuperAdminMfa = async () => {', 'const verifySuperAdminMfa = async');
  assert.match(prepare, /selectMfaFactorForChallenge\(verified\[0\]\.id\)/);
  assert.doesNotMatch(prepare, /mfa\.challenge\(/);
});

test('each TOTP submission creates a fresh challenge immediately before verification', () => {
  const verify = block('const verifySuperAdminMfa = async (event) => {', 'const reauthenticate = async (event) => {');
  const challengeIndex = verify.indexOf('supabase.auth.mfa.challenge(');
  const verifyIndex = verify.indexOf('supabase.auth.mfa.verify(');
  assert.ok(challengeIndex >= 0 && verifyIndex > challengeIndex);
  assert.match(verify, /const challengeId = challengeData\?\.id/);
  assert.match(verify, /challengeId,\s*code,/);
});

test('only same-user AAL2 session is allowed through; stale AAL1 session is repaired conditionally', () => {
  const verify = block('const verifySuperAdminMfa = async (event) => {', 'const reauthenticate = async (event) => {');
  assert.match(verify, /verifiedUserId !== user\?\.id/);
  assert.match(verify, /getAuthenticatorAssuranceLevel\(aalToken\)/);
  assert.match(verify, /activeAssurance\?\.currentLevel !== 'aal2'/);
  assert.match(verify, /activeAssurance\?\.currentLevel !== 'aal2' && verifiedAccessToken && verifiedRefreshToken/);
});

test('AAL2 is checked for both the verification token and the active client session', () => {
  const verify = block('const verifySuperAdminMfa = async (event) => {', 'const reauthenticate = async (event) => {');
  assert.equal((verify.match(/currentLevel !== 'aal2'/g) || []).length, 3);
  assert.match(verify, /setSession\(\{\s*access_token: verifiedAccessToken,\s*refresh_token: verifiedRefreshToken/);
});

test('TOTP verification errors provide safe, actionable feedback without exposing secrets', () => {
  const verify = block('const verifySuperAdminMfa = async (event) => {', 'const reauthenticate = async (event) => {');
  assert.match(verify, /mfa_verification_failed/);
  assert.match(verify, /Set time automatically/);
  assert.doesNotMatch(verify, /console\.(?:log|debug)\([^)]*code/);
});
