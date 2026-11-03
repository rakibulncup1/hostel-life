import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/Run32_telegram_delivery_health.sql');
const webhook = read('supabase/functions/telegram-bot-webhook/index.ts');
const dispatch = read('supabase/functions/telegram-notification-dispatch/index.ts');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');
const telegramPage = read('src/features/telegram/TelegramConnectionPage.jsx');
const telegramLogo = read('src/components/TelegramLogo.jsx');
const adminCss = read('src/styles/platform-visual-refresh.css');

test('Telegram webhook setup is Super Admin-authorized and validates the configured bot identity', () => {
  assert.match(webhook, /access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version'/);
  assert.match(webhook, /platform_admin_get_notification_settings/);
  assert.match(webhook, /configure_webhook/);
  assert.match(webhook, /telegramApi\(token, 'getMe'\)/);
  assert.match(webhook, /usernameMatches/);
  assert.match(webhook, /telegramApi\(token, 'setWebhook'/);
  assert.match(webhook, /secret_token: webhookSecret/);
  assert.match(webhook, /telegramApi\(token, 'getWebhookInfo'\)/);
  assert.match(webhook, /BOT_USERNAME_MISMATCH/);
  assert.doesNotMatch(webhook, /TELEGRAM_BOT_TOKEN.{0,80}return json\(\{[^}]*token/i);
});

test('Telegram dispatcher supports the current Supabase secret-key environment and does not change delivery authorization', () => {
  assert.match(dispatch, /SUPABASE_SECRET_KEYS/);
  assert.match(dispatch, /NOTIFICATION_DISPATCH_WEBHOOK_SECRET/);
  assert.match(dispatch, /x-hostel-delivery-secret/);
  assert.match(dispatch, /\.eq\('status', 'pending'\)/);
  assert.match(dispatch, /user_notification_channels/);
});

test('Run32 is additive, requires Run31 and provides Super Admin-only aggregate diagnostics', () => {
  assert.match(migration, /Run32 preflight failed: apply Run31/);
  assert.match(migration, /Run32 preflight failed: Run31 tables exist but required columns do not match/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_get_telegram_delivery_health\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_list_telegram_delivery_batches/);
  assert.match(migration, /private\.is_super_admin\(\)/);
  assert.match(migration, /supabase_functions/);
  assert.match(migration, /tgtype::integer & 4/);
  assert.match(migration, /notification_delivery_batches/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_admin_list_telegram_delivery_batches\(text, integer, integer\) TO authenticated/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.(notifications|user_notification_channels|notification_delivery_batches)/i);
  const batchList = migration.split('CREATE OR REPLACE FUNCTION public.platform_admin_list_telegram_delivery_batches')[1];
  assert.doesNotMatch(batchList, /channel_address|provider_user_id|chat_id|notification_title|message_body/i);
});

test('Super Admin Telegram page exposes actionable incoming webhook and outgoing delivery diagnostics', () => {
  assert.match(service, /platform_admin_get_telegram_delivery_health/);
  assert.match(service, /platform_admin_list_telegram_delivery_batches/);
  assert.match(service, /functions\.invoke\('telegram-bot-webhook'/);
  assert.match(platform, /Webhook সেট \/ মেরামত/);
  assert.match(platform, /Database Webhook সেটআপ প্রয়োজন/);
  assert.match(platform, /telegramDeliveryFilter/);
  assert.match(platform, /platform-health-item-action/);
  assert.match(platform, /healthIssueFilter/);
  assert.match(platform, /onClick=\{\(\) => openSecurityEvents\('login_failed'\)\}/);
  assert.match(adminCss, /platform-telegram-admin-grid/);
  assert.match(adminCss, /platform-refresh-spin/);
});

test('Telegram user connection uses the Telegram mark and verifies automatically on return from Telegram', () => {
  assert.match(telegramLogo, /#229ED9/);
  assert.match(telegramPage, /TelegramLogo/);
  assert.match(telegramPage, /visibilitychange/);
  assert.match(telegramPage, /refreshAfterTelegram/);
  assert.doesNotMatch(telegramPage, /Icon name="send"/);
});
