// Private Telegram account-link webhook. A user must start the bot with a
// one-time token generated from an authenticated Hostel Life session.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = 'hostel-life-telegram-link-1';

function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return typeof parsed?.default === 'string' ? parsed.default.trim() : '';
  } catch { return ''; }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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

async function sendBotMessage(botToken: string, chatId: string | number, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`TELEGRAM_SEND_HTTP_${response.status}`);
}

Deno.serve(async (request) => {
  if (request.method === 'GET') {
    return json({ ok: true, version: VERSION, configured: Boolean(Deno.env.get('TELEGRAM_BOT_TOKEN') && Deno.env.get('TELEGRAM_WEBHOOK_SECRET')) });
  }
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() ?? '';
  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(expectedSecret, providedSecret)) return json({ ok: false, code: 'WEBHOOK_UNAUTHORIZED' }, 401);

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  const url = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
  const key = serverKey();
  if (!botToken || !url || !key) return json({ ok: false, code: 'SERVER_CONFIGURATION_MISSING' }, 503);

  let update: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 65536) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    update = JSON.parse(raw);
  } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400); }

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
