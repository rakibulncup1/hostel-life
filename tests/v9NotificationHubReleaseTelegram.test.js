import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/Run31_notification_hub_and_telegram_delivery.sql');
const shell = read('src/app/AppShell.jsx');
const release = read('vite.config.js');
const releaseModule = read('src/app/release.js');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const platformService = read('src/services/platformService.js');
const telegramPage = read('src/features/telegram/TelegramConnectionPage.jsx');
const telegramService = read('src/services/telegramService.js');
const botWebhook = read('supabase/functions/telegram-bot-webhook/index.ts');
const delivery = read('supabase/functions/telegram-notification-dispatch/index.ts');
const config = read('supabase/config.toml');
const privacy = read('src/features/menu/MenuPages.jsx');
const css = read('src/styles/notification-center.css');
const notificationPopover = read('src/components/NotificationsPopover.jsx');

 test('release update notice uses build-time metadata and no database log or polling', () => {
  assert.match(release, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(release, /new Date\(\)\.toISOString\(\)/);
  assert.match(release, /__HOSTEL_LIFE_RELEASE__/);
  assert.match(releaseModule, /__HOSTEL_LIFE_RELEASE__/);
  assert.match(shell, /hostel-life-last-seen-release-v1:\$\{user\.id\}/);
  assert.match(shell, /APP_RELEASE\.id/);
  assert.match(shell, /APP_RELEASE\.builtAt/);
  assert.match(shell, /এখনই রিফ্রেশ করুন/);
  assert.match(shell, /window\.location\.reload\(\)/);
  assert.doesNotMatch(shell, /setInterval\(/);
  assert.doesNotMatch(migration, /release_notice_log|deployment_history/i);
});

test('platform messages reuse the existing notification inbox and show one-time priority popups', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS notification_kind text NOT NULL DEFAULT 'activity'/);
  assert.match(migration, /platform_admin_send_targeted_message/);
  assert.match(migration, /'platform_message'/);
  assert.match(migration, /'system_notice'/);
  assert.match(migration, /notification_kind', n\.notification_kind/);
  assert.match(shell, /fetchNotifications\(50\)/);
  assert.match(shell, /\['platform_message', 'system_notice'\]/);
  assert.match(shell, /markNotificationSeen\(id\)/);
  assert.match(shell, /useRealtimeRefresh\([\s\S]*tables: \['notifications'\]/);
  assert.match(migration, /notification_kind IN \('platform_message', 'system_notice'\) AND seen_at IS NULL/);
  assert.match(notificationPopover, /notification_type: item\.notification_type \\|\| item\.notification_kind/);
  assert.doesNotMatch(shell, /setInterval\(/);
  assert.match(platform, /platformAdminSendTargetedMessage/);
  assert.match(platformService, /platform_admin_send_targeted_message/);
  assert.match(platform, /confirmAction\(`বার্তাটি/);
  assert.match(migration, /private\.is_super_admin\(\)/);
  assert.match(migration, /m\.status = 'active'/);
  assert.match(migration, /NOT COALESCE\(p\.is_blocked, false\)/);
  assert.match(migration, /recipient_count', v_sent/);
});

test('targeted message SQL validates recipient membership before any insert', () => {
  const functionBody = migration.split('CREATE OR REPLACE FUNCTION public.platform_admin_send_targeted_message')[1].split('$function$;')[0];
  assert.match(functionBody, /IF NOT private\.is_super_admin\(\)/);
  assert.match(functionBody, /p_recipient_user_ids IS NOT NULL/);
  assert.match(functionBody, /v_eligible <> v_requested/);
  assert.ok(functionBody.indexOf('v_eligible <> v_requested') < functionBody.indexOf('INSERT INTO public.notifications'));
  assert.match(functionBody, /notification_kind\)[\s\S]*'platform_message'/);
  assert.match(functionBody, /p_title[\s\S]*160/);
  assert.match(functionBody, /p_body[\s\S]*3000/);
});

test('Telegram linking is optional, authenticated, one-time and stores only a token hash', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.user_notification_channels/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_link_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_delivery_outbox/);
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/);
  assert.match(migration, /extensions\.digest\(convert_to\(v_token, 'UTF8'\), 'sha256'\)/);
  assert.match(migration, /expires_at timestamptz NOT NULL/);
  assert.match(migration, /DELETE FROM public\.notification_link_tokens WHERE expires_at <= now\(\) OR user_id = auth\.uid\(\)/);
  assert.match(migration, /REVOKE ALL ON public\.user_notification_channels FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON public\.notification_link_tokens FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_telegram_notification_link\(text,text,text,text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /IF auth\.role\(\) <> 'service_role'/);
  assert.match(telegramPage, /টেলিগ্রাম সংযোগ করুন/);
  assert.match(telegramPage, /সংযোগ বিচ্ছিন্ন/);
  assert.match(telegramService, /create_my_telegram_link/);
  assert.doesNotMatch(telegramPage, /SUPABASE_SERVICE_ROLE_KEY|user_notification_channels|password/i);
  assert.match(shell, /টেলিগ্রাম সংযোগ করুন/);
  assert.match(shell, /hostel-life-telegram-nudge-v1/);
});

test('Telegram first-time prompt waits behind release, install and priority dialogs and uses the cached public feature flag', () => {
  assert.match(migration, /'telegram_enabled', EXISTS/);
  assert.match(migration, /public\.platform_notification_provider_settings/);
  assert.match(shell, /platformSettings\?\.telegram_enabled !== true/);
  assert.match(shell, /getMyTelegramNotificationStatus\(\)/);
  assert.match(shell, /status\?\.connected/);
  assert.match(shell, /releaseNoticeOpen \|\| installNudgeOpen \|\| priorityMessages\.length > 0/);
  assert.match(shell, /status\?\.connected !== false/);
  assert.match(telegramPage, /status\?\.connected/);
  assert.match(shell, /পরে করব/);
  assert.match(css, /\.telegram-nudge-dialog/);
});

test('a single notification INSERT hook covers current and future notification kinds without storing message bodies in the outbox', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.hl_enqueue_notification_delivery\(\)/);
  assert.match(migration, /AFTER INSERT ON public\.notifications/);
  assert.match(migration, /REFERENCING NEW TABLE AS new_notifications/);
  assert.match(migration, /GROUP BY chunk\.batch_number/);
  assert.match(migration, /cardinality\(outbox_ids\) BETWEEN 1 AND 100/);
  assert.match(migration, /notification_id, recipient_user_id, provider/);
  assert.match(migration, /ON CONFLICT \(notification_id, provider\) DO NOTHING/);
  const outboxBlock = migration.split('CREATE TABLE IF NOT EXISTS public.notification_delivery_outbox')[1].split(');')[0];
  assert.doesNotMatch(outboxBlock, /title|body|message_content|chat_id/i);
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /outbox_pruned_at < now\(\) - interval '1 day'/);
  assert.match(migration, /notification_link_tokens WHERE expires_at <= now\(\)/);
  assert.match(migration, /status IN \('delivered','failed','skipped'\)/);
});

test('Telegram bot webhook is private-chat-only, protected by Telegram secret header and never logs bot/chat credentials', () => {
  assert.match(botWebhook, /x-telegram-bot-api-secret-token/);
  assert.match(botWebhook, /TELEGRAM_WEBHOOK_SECRET/);
  assert.match(botWebhook, /chat\?\.type !== 'private'/);
  assert.match(botWebhook, /complete_telegram_notification_link/);
  assert.match(botWebhook, /sha256Hex\(token\.toLowerCase\(\)\)/);
  assert.match(botWebhook, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(botWebhook, /console\.(log|error).*chatId|console\.(log|error).*botToken/);
  assert.match(config, /\[functions\.telegram-bot-webhook\][\s\S]*verify_jwt = false/);
});

test('Telegram dispatcher only sends for explicitly linked users and validates its dedicated webhook secret', () => {
  assert.match(delivery, /NOTIFICATION_DISPATCH_WEBHOOK_SECRET/);
  assert.match(delivery, /notification_delivery_batches/);
  assert.match(delivery, /NO_OUTBOX_ROWS/);
  assert.match(delivery, /OUTBOX_UPDATE_FAILED/);
  assert.match(delivery, /outbox_ids/);
  assert.match(delivery, /BATCH_ID_MISSING/);
  assert.match(delivery, /x-hostel-delivery-secret/);
  assert.match(delivery, /providerSettings\?\.active_provider !== 'telegram'/);
  assert.match(delivery, /channel\?\.enabled/);
  assert.match(delivery, /api\.telegram\.org\/bot/);
  assert.match(delivery, /sendMessage/);
  assert.match(delivery, /retry_after/);
  assert.match(delivery, /TELEGRAM_\$\{errorCode\}/);
  assert.doesNotMatch(delivery, /console\.(log|error).*telegramText|console\.(log|error).*channel_address/);
  assert.match(config, /\[functions\.telegram-notification-dispatch\][\s\S]*verify_jwt = false/);
});

test('public platform settings expose only Telegram enabled status, not bot secrets or recipient identities', () => {
  const fn = migration.split('CREATE OR REPLACE FUNCTION public.get_platform_public_settings()')[1].split('$$;')[0];
  assert.match(fn, /'telegram_enabled', EXISTS/);
  assert.doesNotMatch(fn, /telegram_bot_username|channel_address|provider_user_id|token_hash|TELEGRAM_BOT_TOKEN/i);
  assert.match(migration, /platform_notification_provider_settings FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /hostel_pinned_announcements/);
});

test('manager pinned notice behavior is preserved and tagged for the shared notification provider', () => {
  const fn = migration.split('CREATE OR REPLACE FUNCTION public.manager_send_notification')[1].split('$function$;')[0];
  assert.match(fn, /private\.assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(fn, /hostel_pinned_announcements/);
  assert.match(fn, /pg_advisory_xact_lock/);
  assert.match(fn, /announcement_batch_id/);
  assert.match(fn, /'manager_message'/);
  assert.match(fn, /IF v_count = 0 THEN/);
});

test('privacy policy explains Telegram identity data and how to disconnect', () => {
  assert.match(privacy, /ঐচ্ছিক টেলিগ্রাম সংযোগ/);
  assert.match(privacy, /টেলিগ্রাম চ্যাট আইডি/);
  assert.match(privacy, /বিজ্ঞপ্তির শিরোনাম ও বার্তার লেখা সংযুক্ত টেলিগ্রাম অ্যাকাউন্টে পাঠানো হয়/);
  assert.match(privacy, /যেকোনো সময় বিচ্ছিন্ন/);
});
