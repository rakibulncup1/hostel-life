import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const authContext = fs.readFileSync(path.join(root, 'src/contexts/AuthContext.jsx'), 'utf8');
const presenceMigration = fs.readFileSync(path.join(root, 'supabase/migrations/Run27_activity_presence_security_monitoring.sql'), 'utf8');

test('Session-revocation checks remain once per minute while presence touches run every five minutes', () => {
  assert.match(authContext, /setInterval\(verifySessionPolicy, 60 \* 1000\)/);
  assert.match(authContext, /setInterval\(touchPresence, 5 \* 60 \* 1000\)/);
  assert.match(authContext, /20 \* 60 \* 1000/);
  assert.match(authContext, /document\.visibilityState !== 'hidden'/);
  assert.match(authContext, /if \(wasIdle\) heartbeat\(\)/);
  assert.match(presenceMigration, /last_seen_at < now\(\)-interval '10 minutes'/);
});
