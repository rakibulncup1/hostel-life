// Telegram account-link webhook plus a Super Admin-only setup/status action.
// The browser never receives TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = 'hostel-life-telegram-link-4-diagnostics';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-max-age': '86400',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};

function serverKey(): string {
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Use the legacy key below when present. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    || Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
    || '';
}

function publishableKey(): string {
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Use the legacy key below when present. */ }
  return Deno.env.get('SUPABASE_ANON_KEY')?.trim()
    || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
    || '';
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

type TelegramFailure = Error & {
  stage?: string;
  kind?: 'telegram_api' | 'telegram_network';
  upstreamStatus?: number;
  telegramErrorCode?: number;
};

async function telegramApi(
  botToken: string,
  method: string,
  payload?: Record<string, unknown>,
  stage = method,
) {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    const error = new Error('Telegram Bot API-তে সংযোগ করা যায়নি। নেটওয়ার্ক বা API availability পরীক্ষা করুন।') as TelegramFailure;
    error.stage = stage;
    error.kind = 'telegram_network';
    throw error;
  }

  let result: Record<string, unknown> = {};
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok || result.ok !== true) {
    const description = typeof result.description === 'string'
      ? result.description.slice(0, 400)
      : `Telegram API HTTP ${response.status}`;
    const error = new Error(description) as TelegramFailure;
    error.stage = stage;
    error.kind = 'telegram_api';
    error.upstreamStatus = response.status;
    error.telegramErrorCode = Number(result.error_code || response.status);
    throw error;
  }
  return result.result as Record<string, unknown>;
}

function telegramFailureHint(stage: string, upstreamStatus: number | undefined, kind: string | undefined): string {
  if (kind === 'telegram_network') {
    return 'Supabase Edge Function থেকে api.telegram.org-এ সংযোগ হচ্ছে না। Function Logs-এ timeout/network error পরীক্ষা করুন।';
  }
  if (upstreamStatus === 401 || upstreamStatus === 404) {
    return 'প্রথমে TELEGRAM_BOT_TOKEN যাচাই করুন। Secret-এ BotFather-এর দেওয়া কাঁচা token দিন—শুধু সংখ্যা:অক্ষর-সংখ্যার token; bot prefix, @username, সম্পূর্ণ API URL, quote বা extra text নয়। Token revoke হয়ে গেলে BotFather থেকে নতুন token নিয়ে Secret update ও Function redeploy করুন।';
  }
  if (upstreamStatus === 429) {
    return 'Telegram API rate limit করেছে। কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।';
  }
  if (stage === 'setWebhook' && upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500) {
    return 'Telegram Webhook configuration গ্রহণ করেনি। Webhook URL HTTPS কি না এবং TELEGRAM_WEBHOOK_SECRET-এ শুধু A-Z, a-z, 0-9, underscore বা hyphen আছে কি না যাচাই করুন।';
  }
  if (upstreamStatus && upstreamStatus >= 500) {
    return 'Telegram Bot API সাময়িকভাবে ব্যর্থ। কিছুক্ষণ পরে পুনরায় চেষ্টা করুন এবং Telegram API status পরীক্ষা করুন।';
  }
  return 'এই ধাপের Telegram API response যাচাই করুন। Supabase Function Logs-এ একই সময়ের invocation দেখুন।';
}

async function handleSuperAdminAction(request: Request, payload: Record<string, unknown>): Promise<Response> {
  const action = String(payload.action || '');
  if (!['webhook_status', 'configure_webhook'].includes(action)) return json({ ok: false, code: 'UNKNOWN_ACTION' }, 400);

  const url = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() ?? '';
  const authHeader = request.headers.get('authorization') ?? '';
  const key = publishableKey();
  if (!url || !token || !webhookSecret || !key) {
    const missing = [
      !url ? 'SUPABASE_URL' : null,
      !token ? 'TELEGRAM_BOT_TOKEN' : null,
      !webhookSecret ? 'TELEGRAM_WEBHOOK_SECRET' : null,
      !key ? 'SUPABASE publishable/anon key' : null,
    ].filter(Boolean);
    return json({ ok: false, code: 'SERVER_CONFIGURATION_MISSING', message: 'Edge Function-এর server configuration অসম্পূর্ণ।', missing }, 503);
  }
  // Telegram Bot API tokens are supplied as the raw BotFather token, not as
  // a URL, username, or a value prefixed with the word "bot".
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return json({
      ok: false,
      code: 'INVALID_TELEGRAM_BOT_TOKEN_FORMAT',
      stage: 'token_format',
      message: 'TELEGRAM_BOT_TOKEN-এর format সঠিক নয়। BotFather-এর raw token দিন; bot prefix, @username বা API URL দেবেন না।',
      hint: 'সঠিক format-এর উদাহরণ: 123456789:AA_example_token (এটি কেবল format example, বাস্তব token নয়)।',
    }, 400);
  }
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ ok: false, code: 'ADMIN_AUTH_REQUIRED' }, 401);

  // This RPC enforces Super Admin inside PostgreSQL; the client key is publishable
  // and the caller's JWT remains subject to the existing database permission check.
  const userClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: settings, error: permissionError } = await userClient.rpc('platform_admin_get_notification_settings');
  if (permissionError || !settings) return json({ ok: false, code: 'SUPER_ADMIN_REQUIRED', message: 'এই কাজের জন্য Super Admin অনুমতি প্রয়োজন।' }, 403);

  let currentStage = 'getMe';
  try {
    const bot = await telegramApi(token, 'getMe');
    const actualUsername = typeof bot?.username === 'string' ? bot.username : '';
    const configuredUsername = String(settings.telegram_bot_username || '').replace(/^@/, '').trim();
    const usernameMatches = Boolean(actualUsername && configuredUsername && actualUsername.toLowerCase() === configuredUsername.toLowerCase());
    const webhookUrl = `${url.replace(/\/+$/, '')}/functions/v1/telegram-bot-webhook`;

    if (action === 'configure_webhook') {
      if (!usernameMatches) {
        return json({ ok: false, code: 'BOT_USERNAME_MISMATCH', message: `Supabase-এ সংরক্ষিত Bot Username (@${configuredUsername || '—'}) এবং Token-এর Bot (@${actualUsername || '—'}) এক নয়। সঠিক Token বা Username দিন।` }, 409);
      }
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
        return json({ ok: false, code: 'INVALID_TELEGRAM_WEBHOOK_SECRET', message: 'TELEGRAM_WEBHOOK_SECRET-এ শুধু ইংরেজি অক্ষর, সংখ্যা, _ এবং - ব্যবহার করুন (১–২৫৬ অক্ষর)।' }, 400);
      }
      currentStage = 'setWebhook';
      await telegramApi(token, 'setWebhook', {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message'],
        max_connections: 10,
        drop_pending_updates: false,
      });
    }

    currentStage = 'getWebhookInfo';
    const webhook = await telegramApi(token, 'getWebhookInfo');
    const remoteUrl = typeof webhook?.url === 'string' ? webhook.url : '';
    return json({
      ok: true,
      version: VERSION,
      action,
      bot: { username: actualUsername, configured_username: configuredUsername, username_matches: usernameMatches },
      webhook: {
        configured: Boolean(remoteUrl),
        url_matches: remoteUrl === webhookUrl,
        pending_update_count: Number(webhook?.pending_update_count || 0),
        last_error_date: Number(webhook?.last_error_date || 0) || null,
        last_error_message: typeof webhook?.last_error_message === 'string' ? webhook.last_error_message.slice(0, 500) : null,
        max_connections: Number(webhook?.max_connections || 0) || null,
        allowed_updates: Array.isArray(webhook?.allowed_updates) ? webhook.allowed_updates : [],
      },
    });
  } catch (cause) {
    const failure = cause as TelegramFailure;
    const stage = failure?.stage || currentStage;
    const upstreamStatus = Number(failure?.upstreamStatus || 0) || null;
    const telegramErrorCode = Number(failure?.telegramErrorCode || 0) || null;
    const kind = failure?.kind || 'telegram_network';
    const message = cause instanceof Error ? cause.message : 'Telegram Bot API অনুরোধ ব্যর্থ হয়েছে।';
    const hint = telegramFailureHint(stage, upstreamStatus || undefined, kind);
    // Do not log or return the request URL: it contains the bot token.
    console.error('[telegram-bot-webhook] Telegram API step failed', {
      stage, kind, upstreamStatus, telegramErrorCode,
    });
    return json({
      ok: false,
      code: 'TELEGRAM_API_ERROR',
      stage,
      kind,
      upstream_http_status: upstreamStatus,
      telegram_error_code: telegramErrorCode,
      message: message.slice(0, 400),
      hint,
      edge_http_status: 502,
    }, 502);
  }
}

async function sendBotMessage(botToken: string, chatId: string | number, text: string): Promise<void> {
  await telegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method === 'GET') {
    return json({
      ok: true,
      version: VERSION,
      configured: Boolean(Deno.env.get('TELEGRAM_BOT_TOKEN') && Deno.env.get('TELEGRAM_WEBHOOK_SECRET')),
    });
  }
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  let update: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 65536) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    update = JSON.parse(raw);
  } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400); }

  // Browser-originated setup actions require a real signed-in Super Admin.
  // Telegram-originated updates follow the separate secret-header path below.
  if (typeof update.action === 'string') return await handleSuperAdminAction(request, update);

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() ?? '';
  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(expectedSecret, providedSecret)) return json({ ok: false, code: 'WEBHOOK_UNAUTHORIZED' }, 401);

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  const url = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
  const key = serverKey();
  if (!botToken || !url || !key) return json({ ok: false, code: 'SERVER_CONFIGURATION_MISSING' }, 503);

  const message = update.message as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;
  const from = message?.from as Record<string, unknown> | undefined;
  const chatId = chat?.id;
  if (!message || chat?.type !== 'private' || (typeof chatId !== 'number' && typeof chatId !== 'string')) {
    // Telegram groups/channels are deliberately not accepted as account destinations.
    return json({ ok: true, ignored: true });
  }

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const start = /^\/start(?:\s+([A-Za-z0-9_-]{1,64}))?$/.exec(text);
  if (!start || !start[1]) {
    try { await sendBotMessage(botToken, chatId, 'Hostel Life Notification Bot\n\nআপনার অ্যাকাউন্ট যুক্ত করতে Hostel Life অ্যাপের Telegram সংযোগ পেজ থেকে নতুন সংযোগ লিংক তৈরি করে এখানে Start চাপুন।'); }
    catch { /* Telegram webhook is acknowledged; no secret or chat data is logged. */ }
    return json({ ok: true });
  }

  const token = start[1];
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    try { await sendBotMessage(botToken, chatId, 'সংযোগ লিংকটি সঠিক নয়। Hostel Life অ্যাপ থেকে নতুন লিংক তৈরি করুন।'); } catch { /* ignore */ }
    return json({ ok: true });
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const username = typeof from?.username === 'string' ? from.username : null;
  const telegramUserId = from?.id === undefined ? String(chatId) : String(from.id);
  const { data, error } = await admin.rpc('complete_telegram_notification_link', {
    p_token_hash: await sha256Hex(token.toLowerCase()),
    p_chat_id: String(chatId),
    p_telegram_user_id: telegramUserId,
    p_username: username,
  });

  let confirmation = 'আপনার Telegram সংযোগ সফল হয়েছে। এখন থেকে আপনার জন্য তৈরি Hostel Life নোটিফিকেশন এখানে পাঠানো হবে।';
  if (error) confirmation = error.code === '23505'
    ? 'এই Telegram অ্যাকাউন্টটি অন্য একটি Hostel Life অ্যাকাউন্টের সঙ্গে যুক্ত আছে। আগে সেই অ্যাকাউন্ট থেকে সংযোগ বিচ্ছিন্ন করুন।'
    : 'সংযোগ সম্পন্ন করা যায়নি। লিংকটির মেয়াদ শেষ বা এটি আগেই ব্যবহার করা হয়েছে। Hostel Life অ্যাপ থেকে নতুন লিংক তৈরি করুন।';
  else if (!data?.linked) confirmation = 'সংযোগ লিংকটির মেয়াদ শেষ অথবা এটি আগেই ব্যবহার করা হয়েছে। Hostel Life অ্যাপ থেকে নতুন লিংক তৈরি করুন।';

  try { await sendBotMessage(botToken, chatId, confirmation); }
  catch { /* Linking has already been committed; app-side status refresh is authoritative. */ }
  return json({ ok: true, linked: Boolean(data?.linked && !error) });
});
