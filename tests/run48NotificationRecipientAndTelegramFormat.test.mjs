import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/Run48_notification_recipient_policy_and_telegram_format.sql');
const dispatcher = read('supabase/functions/telegram-notification-dispatch/index.ts');
const run39 = read('supabase/migrations/Run39_targeted_hostel_life_improvements.sql');
const run17 = read('supabase/migrations/Run17.sql');
const run2 = read('supabase/migrations/Run2.sql');
const run31 = read('supabase/migrations/Run31_notification_hub_and_telegram_delivery.sql');
const run40 = read('supabase/migrations/Run40_notification_meal_audit_and_signup_otp_guard.sql');
const diningCss = read('src/styles/dining-experience-v2.css');

function functionBody(source, name) {
  const marker = `CREATE OR REPLACE FUNCTION ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf('$function$;', start);
  assert.notEqual(end, -1, `${name} must have a function terminator`);
  return source.slice(start, end + '$function$;'.length);
}

test('Run48 is additive, transactional, and preflighted before schema changes', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /SET LOCAL lock_timeout/);
  assert.match(migration, /SET LOCAL statement_timeout/);
  assert.match(migration, /DO \$run48_preflight\$/);
  assert.match(migration, /hl_enqueue_notification_delivery_trg/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /COMMIT;/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\.notifications|UPDATE public\.notifications/i);
});

test('cash deposit notification is inserted only for its resolved member account', () => {
  const body = functionBody(migration, 'private.hl_notify_ledger_insert()');
  const depositBranch = body.slice(body.indexOf("IF NEW.ledger_type = 'deposit' THEN"), body.indexOf("IF NEW.ledger_type = 'other_expense' THEN"));
  assert.match(depositBranch, /IF v_member_user_id IS NULL THEN RETURN NEW; END IF/);
  assert.match(depositBranch, /INSERT INTO public\.notifications[\s\S]*?VALUES\s*\(\s*NEW\.hostel_id,\s*v_member_user_id/);
  assert.doesNotMatch(depositBranch, /FROM public\.hostel_memberships m[\s\S]*?SELECT NEW\.hostel_id, m\.user_id/);
  assert.match(depositBranch, /period_total_deposit/);
});

test('other expense and ledger adjustment keep their existing hostel-wide recipient policy', () => {
  const body = functionBody(migration, 'private.hl_notify_ledger_insert()');
  const sharedBranch = body.slice(body.indexOf("IF NEW.ledger_type = 'other_expense' THEN"));
  assert.match(sharedBranch, /FROM public\.hostel_memberships m[\s\S]*?WHERE m\.hostel_id = NEW\.hostel_id[\s\S]*?m\.status = 'active'/);
  assert.match(sharedBranch, /'other_expense'/);
  assert.match(sharedBranch, /'ledger_adjustment'/);
});

test('khala payment notification is private to the named member', () => {
  const body = functionBody(migration, 'private.hl_notify_khala_insert()');
  assert.match(body, /NEW\.member_id IS NULL THEN/);
  assert.match(body, /IF v_member_user_id IS NULL THEN RETURN NEW/);
  assert.match(body, /VALUES\s*\(\s*NEW\.hostel_id,\s*v_member_user_id/);
  assert.doesNotMatch(body, /SELECT NEW\.hostel_id, m\.user_id/);
  assert.match(body, /v_title := 'খালার পারিশ্রমিক এন্ট্রি'/);
  assert.match(body, /আপনার হিসাবে ৳/);
});

test('market notification remains hostel-wide and captures ordered share items only for Telegram', () => {
  const body = functionBody(migration, 'private.hl_notify_market_insert()');
  assert.match(body, /jsonb_agg[\s\S]*ORDER BY i\.serial_no/);
  assert.match(body, /'items', v_items/);
  assert.match(body, /FROM public\.hostel_memberships m[\s\S]*JOIN public\.profiles p/);
  assert.match(body, /m\.status = 'active'/);
  assert.match(body, /'market_entry'/);
  assert.match(body, /'credit_to_buyer', COALESCE\(NEW\.credit_to_buyer, false\)/);
  assert.match(body, /v_title := 'নতুন বাজার এন্ট্রি'/);
  assert.match(body, /বাজারকারী: ' \|\| v_buyer/);
});

test('Telegram dispatch reads provider metadata and builds structured market/deposit/khala messages', () => {
  assert.match(dispatcher, /notification_kind,delivery_metadata/);
  assert.match(dispatcher, /formatTelegramNotification\(notification/);
  assert.match(dispatcher, /case|market_entry/);
  assert.match(dispatcher, /টোটাল বাজার/);
  assert.match(dispatcher, /বাজারের টাকা সদস্যের হিসাবে যুক্ত হয়েছে/);
  assert.match(dispatcher, /এই মাসে মোট জমা/);
  assert.match(dispatcher, /খালার পারিশ্রমিক/);
  assert.match(dispatcher, /HOSTEL - LIFE/);
  assert.match(dispatcher, /maxChars = 3900/);
  assert.match(dispatcher, /Preserve the product footer/);
  assert.match(dispatcher, /function telegramCategory/);
  assert.match(dispatcher, /লেট\\s\*মিল\\s\*অনুরোধ/);
});

test('Telegram truncation retains the Hostel Life footer and legacy meal-request activity receives a useful category', () => {
  assert.match(dispatcher, /const suffix = hasFooter \? `\\n\\n\$\{footer\}` : ''/);
  assert.match(dispatcher, /return `\$\{Array\.from\(body\)[\s\S]*HOSTEL - LIFE/);
  assert.match(dispatcher, /telegramCategory\(notification\)/);
});

test('in-app inbox does not expose provider-only market metadata', () => {
  const inbox = functionBody(run31, 'public.get_notifications(p_limit integer DEFAULT 50)');
  assert.doesNotMatch(inbox, /delivery_metadata/);
  assert.match(inbox, /notification_kind/);
  assert.match(read('supabase/verify/Verify_Run48_notification_recipient_policy.sql'), /telegram_outbox_trigger_enabled/);
});

test('existing late-request manager routing and approval-to-member path are preserved', () => {
  assert.match(run17, /perform private\.notify_meal_request_managers\(v_req\)/);
  assert.match(run2, /primary_manager_membership_id/);
  assert.match(run2, /period_assistant_managers/);
  const eventBody = functionBody(run39, 'private.hl_notify_important_event()');
  assert.match(eventBody, /'meal_request_'\s*\|\|\s*NEW\.status/);
  assert.match(eventBody, /NEW\.membership_id/);
});

test('manager broadcast, membership, month lifecycle and archive correction remain untouched', () => {
  assert.match(run31, /'manager_message'/);
  assert.match(run39, /'membership_change'/);
  assert.match(run39, /'month_closed'/);
  assert.match(run39, /'manager_change'/);
  assert.match(run39, /archive correction/i);
});

test('market and financial notification triggers stay insert/first-total only, so edits do not notify again', () => {
  assert.match(run40, /CREATE TRIGGER hl_market_notification_total_upd[\s\S]*?AFTER UPDATE OF total_amount[\s\S]*?WHEN \(OLD\.total_amount IS NOT DISTINCT FROM 0 AND NEW\.total_amount > 0/);
  assert.match(run40, /CREATE TRIGGER hl_ledger_notification_ins AFTER INSERT ON public\.ledger_transactions/);
  assert.match(run39, /CREATE TRIGGER hl_khala_notification_ins AFTER INSERT ON public\.khala_money_entries/);
});

test('new meal request cards keep all three controls within narrow mobile day cards', () => {
  assert.match(diningCss, /Mobile meal-request cards/);
  assert.match(diningCss, /@media \(max-width: 600px\)[\s\S]*?\.meal-day-fields > \.meal-stepper-row[\s\S]*?flex-direction: column/);
  assert.match(diningCss, /grid-template-columns: 22px minmax\(16px, 1fr\) 22px/);
  assert.match(diningCss, /@media \(max-width: 360px\)/);
});

test('Telegram delivery remains statement-batched with no new polling path', () => {
  const enqueue = functionBody(run31, 'private.hl_enqueue_notification_delivery()');
  assert.match(enqueue, /notification_delivery_outbox/);
  assert.match(run31, /CREATE TRIGGER hl_enqueue_notification_delivery_trg[\s\S]*?AFTER INSERT ON public\.notifications[\s\S]*?FOR EACH STATEMENT/);
  assert.match(dispatcher, /await delay\(40\)/);
  assert.doesNotMatch(dispatcher, /setInterval\s*\(/);
  assert.doesNotMatch(dispatcher, /while\s*\(\s*true\s*\)/);
});
