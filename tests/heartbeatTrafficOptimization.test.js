import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const authContext = fs.readFileSync(path.join(root, 'src/contexts/AuthContext.jsx'), 'utf8');
const presenceMigration = fs.readFileSync(path.join(root, 'supabase/migrations/Run47_ip_session_metadata_retention_30d.sql'), 'utf8');

test('Session-revocation checks remain once per minute while presence touches respect the server ten-minute throttle', () => {
  assert.match(authContext, /setInterval\(verifySessionPolicy, 60 \* 1000\)/);
  assert.match(authContext, /setInterval\(touchPresence, 11 \* 60 \* 1000\)/);
  assert.match(authContext, /PRESENCE_TOUCH_MIN_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(authContext, /now - lastPresenceTouchAt < PRESENCE_TOUCH_MIN_INTERVAL_MS/);
  assert.match(authContext, /20 \* 60 \* 1000/);
  assert.match(authContext, /document\.visibilityState !== 'hidden'/);
  assert.match(authContext, /if \(wasIdle\) heartbeat\(\)/);
  assert.match(presenceMigration, /last_seen_at < now\(\)-interval '10 minutes'/);
});
