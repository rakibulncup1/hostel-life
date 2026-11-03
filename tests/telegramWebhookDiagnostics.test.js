import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const webhook = read('supabase/functions/telegram-bot-webhook/index.ts');
const platform = read('src/features/platform/SuperAdminPage.jsx');

test('Telegram bot token format is checked before calling Telegram API', () => {
  assert.match(webhook, /!\/\^\\d\+:\[A-Za-z0-9_-\]\+\$\//);
  assert.match(webhook, /INVALID_TELEGRAM_BOT_TOKEN_FORMAT/);
  assert.match(webhook, /BotFather-এর raw token/);
});

test('Telegram API failures expose safe stage and upstream status without exposing token', () => {
  assert.match(webhook, /stage = method/);
  assert.match(webhook, /upstreamStatus/);
  assert.match(webhook, /telegramErrorCode/);
  assert.match(webhook, /currentStage = 'getMe'/);
  assert.match(webhook, /currentStage = 'setWebhook'/);
  assert.match(webhook, /currentStage = 'getWebhookInfo'/);
  assert.match(webhook, /upstream_http_status: upstreamStatus/);
  assert.match(webhook, /telegram_error_code: telegramErrorCode/);
  assert.match(webhook, /Do not log or return the request URL: it contains the bot token/);
  assert.match(webhook, /hostel-life-telegram-link-4-diagnostics/);
});

test('Super Admin renders actionable Telegram diagnostic stage, upstream status and hint', () => {
  assert.match(platform, /payload\?\.stage/);
  assert.match(platform, /payload\?\.upstream_http_status/);
  assert.match(platform, /payload\?\.telegram_error_code/);
  assert.match(platform, /payload\?\.hint/);
  assert.match(platform, /অনুপস্থিত Configuration/);
});
