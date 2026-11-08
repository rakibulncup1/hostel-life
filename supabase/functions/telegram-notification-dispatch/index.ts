// Statement-batched Database Webhook target. One invocation processes up to
// 100 opted-in recipients from an existing inbox INSERT; there is no polling.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = 'hostel-life-telegram-dispatch-4';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type DeliveryStatus = 'delivered' | 'failed' | 'skipped';
type DeliveryResult = { id: string; status: DeliveryStatus; attempts: number; code: string | null; disableUser?: string };

function serverKey(): string {
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Use the legacy key below when present. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    || Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
    || '';
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function safeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function boundedTelegramText(title: unknown, body: unknown, hostelName: unknown, kind: unknown): string {
  const labels: Record<string, string> = {
    market_entry: 'বাজারের হিসাব', deposit: 'সদস্যের জমা', other_expense: 'মেসের অন্যান্য খরচ',
    ledger_adjustment: 'হিসাব সংশোধন', khala_money: 'খালার পারিশ্রমিক', month_closed: 'মাস বন্ধ',
    new_month: 'নতুন মাস', manager_change: 'ম্যানেজার পরিবর্তন', membership_change: 'সদস্য আপডেট',
    platform_message: 'Hostel Life বার্তা', system_notice: 'মেসের নোটিশ',
    manager_message: 'ম্যানেজারের বার্তা', meal_request_approved: 'মিল অনুরোধ অনুমোদন',
    meal_request_rejected: 'মিল অনুরোধ বাতিল', meal_request_update: 'মিল অনুরোধের আপডেট',
    archive_correction: 'বন্ধ মাসের হিসাব সংশোধন', archive_deleted: 'মেসের আর্কাইভ আপডেট', retention_updated: 'মেসের আর্কাইভ নীতি আপডেট',
  };
  const lines = [
    '🏠 Hostel Life',
    `🏡 মেস: ${String(hostelName || 'আপনার মেস')}`,
    `🔔 ${labels[String(kind || '')] || 'মেসের আপডেট'}`,
    ...[title, body].flatMap((value) => String(value || '').split(/\r?\n/).map((line) => line.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean)),
  ].map((line) => line.trim()).filter(Boolean);
  return Array.from(lines.join('\n')).slice(0, 3900).join('');
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<{ ok: boolean; attempts: number; code: string | null; blocked: boolean }> {
  let attempts = 0;
  let lastCode = 'TELEGRAM_SEND_FAILED';
  while (attempts < 3) {
    attempts += 1;
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      let result: Record<string, unknown> = {};
      try { result = await response.json(); } catch { result = {}; }
      if (response.ok && result.ok === true) return { ok: true, attempts, code: null, blocked: false };
      const errorCode = Number(result.error_code || response.status);
      lastCode = `TELEGRAM_${errorCode}`;
      if (errorCode === 403) return { ok: false, attempts, code: lastCode, blocked: true };
      const parameters = result.parameters as Record<string, unknown> | undefined;
      const retryAfter = Number(parameters?.retry_after || 0);
      if (errorCode === 429 && retryAfter > 0 && retryAfter <= 8 && attempts < 3) {
        await delay(retryAfter * 1000);
        continue;
      }
      if (response.status >= 500 && attempts < 3) {
        await delay(attempts * 400);
        continue;
      }
      return { ok: false, attempts, code: lastCode, blocked: false };
    } catch {
      lastCode = 'TELEGRAM_NETWORK_ERROR';
      if (attempts < 3) { await delay(attempts * 400); continue; }
    }
  }
  return { ok: false, attempts, code: lastCode, blocked: false };
}

Deno.serve(async (request) => {
  if (request.method === 'GET') return json({ ok: true, version: VERSION });
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  const expected = Deno.env.get('NOTIFICATION_DISPATCH_WEBHOOK_SECRET')?.trim() ?? '';
  const provided = request.headers.get('x-hostel-delivery-secret') ?? '';
  if (!safeEqual(expected, provided)) return json({ ok: false, code: 'WEBHOOK_UNAUTHORIZED' }, 401);

  const url = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
  const key = serverKey();
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  if (!url || !key || !botToken) return json({ ok: false, code: 'SERVER_CONFIGURATION_MISSING' }, 503);

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 65536) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    payload = JSON.parse(raw);
  } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400); }

  const record = (payload.record && typeof payload.record === 'object') ? payload.record as Record<string, unknown> : payload;
  const batchId = typeof record.id === 'string' ? record.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return json({ ok: false, code: 'BATCH_ID_MISSING' }, 400);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: batch, error: claimError } = await admin
    .from('notification_delivery_batches')
    .update({ status: 'processing', updated_at: new Date().toISOString(), last_error_code: null })
    .eq('id', batchId).eq('status', 'pending')
    .select('id,outbox_ids').maybeSingle();
  if (claimError) return json({ ok: false, code: 'BATCH_CLAIM_FAILED' }, 503);
  if (!batch) return json({ ok: true, skipped: true, reason: 'ALREADY_CLAIMED_OR_PROCESSED' });

  const outboxIds = Array.isArray(batch.outbox_ids) ? batch.outbox_ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  if (outboxIds.length < 1 || outboxIds.length > 100) {
    await admin.from('notification_delivery_batches').update({ status: 'failed', last_error_code: 'INVALID_BATCH_SIZE', updated_at: new Date().toISOString() }).eq('id', batchId);
    return json({ ok: false, code: 'INVALID_BATCH_SIZE' }, 200);
  }

  try {
    const { data: providerSettings, error: settingsError } = await admin
      .from('platform_notification_provider_settings').select('active_provider').eq('singleton', true).maybeSingle();
    if (settingsError) throw new Error('PROVIDER_SETTINGS_READ_FAILED');
    if (providerSettings?.active_provider !== 'telegram') {
      await admin.from('notification_delivery_outbox').update({ status: 'skipped', last_error_code: 'PROVIDER_DISABLED', updated_at: new Date().toISOString() }).in('id', outboxIds).eq('status', 'pending');
      await admin.from('notification_delivery_batches').update({ status: 'skipped', last_error_code: 'PROVIDER_DISABLED', updated_at: new Date().toISOString(), delivered_at: new Date().toISOString() }).eq('id', batchId);
      return json({ ok: true, skipped: true, reason: 'PROVIDER_DISABLED' });
    }

    const { data: outboxRows, error: outboxError } = await admin.from('notification_delivery_outbox')
      .select('id,notification_id,recipient_user_id,provider,status').in('id', outboxIds);
    if (outboxError) throw new Error('OUTBOX_READ_FAILED');
    const rows = Array.isArray(outboxRows) ? outboxRows : [];
    if (rows.length === 0) {
      await admin.from('notification_delivery_batches').update({ status: 'skipped', last_error_code: 'NO_OUTBOX_ROWS', delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', batchId);
      return json({ ok: true, skipped: true, reason: 'NO_OUTBOX_ROWS' });
    }
    const notificationIds = [...new Set(rows.map((row: any) => row.notification_id).filter(Boolean))];
    const userIds = [...new Set(rows.map((row: any) => row.recipient_user_id).filter(Boolean))];
    const [{ data: notifications, error: notificationError }, { data: channels, error: channelError }] = await Promise.all([
      notificationIds.length ? admin.from('notifications').select('id,title,body,recipient_user_id,deleted_at,hostel_id,notification_kind').in('id', notificationIds) : Promise.resolve({ data: [], error: null } as any),
      userIds.length ? admin.from('user_notification_channels').select('user_id,channel_address,enabled').eq('provider', 'telegram').in('user_id', userIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (notificationError || channelError) throw new Error('RECIPIENT_DATA_READ_FAILED');
    const hostelIds = [...new Set((notifications || []).map((item: any) => item.hostel_id).filter(Boolean))];
    const { data: hostels, error: hostelError } = hostelIds.length
      ? await admin.from('hostels').select('id,name').in('id', hostelIds)
      : { data: [], error: null } as any;
    if (hostelError) throw new Error('HOSTEL_LABEL_READ_FAILED');
    const hostelMap = new Map((hostels || []).map((item: any) => [item.id, item.name]));
    const notificationMap = new Map((notifications || []).map((item: any) => [item.id, item]));
    const channelMap = new Map((channels || []).map((item: any) => [item.user_id, item]));
    const results: DeliveryResult[] = [];

    // Sequential sends stay below Telegram's ordinary bot throughput limits and
    // avoid spiky traffic on a free Supabase plan.
    for (const row of rows) {
      if (row.status !== 'pending' || row.provider !== 'telegram') {
        results.push({ id: row.id, status: 'skipped', attempts: 0, code: 'OUTBOX_NOT_PENDING' });
        continue;
      }
      const notification = notificationMap.get(row.notification_id) as any;
      const channel = channelMap.get(row.recipient_user_id) as any;
      if (!notification || notification.deleted_at || notification.recipient_user_id !== row.recipient_user_id || !channel?.enabled || !channel.channel_address) {
        results.push({ id: row.id, status: 'skipped', attempts: 0, code: 'RECIPIENT_OR_NOTIFICATION_UNAVAILABLE' });
        continue;
      }
      const sent = await sendTelegram(botToken, channel.channel_address, boundedTelegramText(notification.title, notification.body, hostelMap.get(notification.hostel_id), notification.notification_kind));
      results.push({ id: row.id, status: sent.ok ? 'delivered' : 'failed', attempts: sent.attempts, code: sent.code, ...(sent.blocked ? { disableUser: row.recipient_user_id } : {}) });
      await delay(40);
    }

    // Update in small groups instead of one Database API call per recipient.
    const groups = new Map<string, DeliveryResult[]>();
    for (const item of results) {
      const key = `${item.status}|${item.attempts}|${item.code || ''}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const { error: outboxUpdateError } = await admin.from('notification_delivery_outbox').update({
        status: first.status,
        attempt_count: first.attempts,
        last_error_code: first.code,
        delivered_at: first.status === 'delivered' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).in('id', group.map((item) => item.id)).eq('status', 'pending');
      if (outboxUpdateError) throw new Error('OUTBOX_UPDATE_FAILED');
    }
    const disableIds = [...new Set(results.map((item) => item.disableUser).filter(Boolean))] as string[];
    if (disableIds.length) {
      const { error: disableError } = await admin.from('user_notification_channels').update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('provider', 'telegram').in('user_id', disableIds);
      if (disableError) throw new Error('CHANNEL_DISABLE_FAILED');
    }

    const delivered = results.filter((item) => item.status === 'delivered').length;
    const failed = results.filter((item) => item.status === 'failed').length;
    const skipped = results.length - delivered - failed;
    const status = results.length === 0 ? 'skipped' : delivered === results.length ? 'delivered' : delivered > 0 ? 'partial' : failed > 0 ? 'failed' : 'skipped';
    const code = status === 'delivered' ? null : failed > 0 ? (delivered > 0 ? 'PARTIAL_DELIVERY_FAILURE' : 'DELIVERY_FAILED') : 'NO_ELIGIBLE_RECIPIENTS';
    const { error: batchUpdateError } = await admin.from('notification_delivery_batches').update({
      status, last_error_code: code,
      delivered_at: status === 'delivered' || status === 'skipped' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', batchId);
    if (batchUpdateError) throw new Error('BATCH_UPDATE_FAILED');
    return json({ ok: true, delivered, failed, skipped, batch_status: status });
  } catch (error) {
    await admin.from('notification_delivery_outbox').update({ status: 'failed', last_error_code: 'DELIVERY_RUNTIME_ERROR', updated_at: new Date().toISOString() })
      .in('id', outboxIds).eq('status', 'pending');
    await admin.from('notification_delivery_batches').update({ status: 'failed', last_error_code: 'DELIVERY_RUNTIME_ERROR', updated_at: new Date().toISOString() }).eq('id', batchId);
    // Never log notification content, chat IDs, tokens or recipient identifiers.
    console.error('telegram notification batch failed', { code: 'DELIVERY_RUNTIME_ERROR' });
    return json({ ok: false, code: 'DELIVERY_RUNTIME_ERROR' }, 200);
  }
});
