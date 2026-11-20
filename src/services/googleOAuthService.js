import { supabase, supabaseConfigReady } from '../lib/supabase';

export const GOOGLE_OAUTH_FEATURE_FLAG = import.meta.env?.VITE_GOOGLE_OAUTH_ENABLED === 'true';
export const GOOGLE_OAUTH_CLIENT_ID = String(import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
export const GOOGLE_OAUTH_FEATURE_ENABLED = GOOGLE_OAUTH_FEATURE_FLAG && Boolean(GOOGLE_OAUTH_CLIENT_ID);
export const GOOGLE_OAUTH_PENDING_KEY = 'hostel-life-google-oauth-pending-v2';
export const GOOGLE_OAUTH_POLICY_VERSION = '2026-11-20';
export const GOOGLE_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000;

function normalizePhone(value) {
  return normalizeGooglePhone(value);
}

export function normalizeGooglePhone(value) {
  return String(value || '').trim()
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function isValidGooglePhone(value) {
  const digits = normalizeGooglePhone(value).replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

export function sanitizeGoogleAvatarUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function makeNonce() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error('এই ব্রাউজারে নিরাপদ Google sign-in চালু করা যাচ্ছে না। আপডেট করা HTTPS browser ব্যবহার করুন।');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

async function hashNonce(nonce) {
  const encoded = new TextEncoder().encode(nonce);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildGoogleOAuthPending({ mode = 'login', fullName = '', phone = '', nonce = '', acceptedAt = new Date().toISOString(), startedAt = Date.now(), status = 'ready' } = {}) {
  if (!['login', 'register'].includes(mode)) throw new Error('Google sign-in mode is invalid.');
  return {
    version: 2,
    mode,
    fullName: String(fullName || '').trim(),
    phone: normalizePhone(phone),
    nonce: String(nonce || ''),
    acceptedAt,
    startedAt: Number(startedAt),
    status: status === 'exchanging' ? 'exchanging' : 'ready',
    legalPolicyVersion: GOOGLE_OAUTH_POLICY_VERSION,
  };
}

export function validateGoogleOAuthPending(value, now = Date.now()) {
  if (!value || value.version !== 2 || !['login', 'register'].includes(value.mode)) return false;
  if (typeof value.acceptedAt !== 'string' || !Number.isFinite(Date.parse(value.acceptedAt))) return false;
  if (typeof value.nonce !== 'string' || value.nonce.length < 32 || value.nonce.length > 128) return false;
  if (!Number.isFinite(value.startedAt) || value.startedAt > now + 60_000) return false;
  const age = now - value.startedAt;
  if (age < 0 || age > GOOGLE_OAUTH_PENDING_TTL_MS) return false;
  if (value.legalPolicyVersion !== GOOGLE_OAUTH_POLICY_VERSION) return false;
  if (!['ready', 'exchanging'].includes(value.status)) return false;
  return true;
}

export function readPendingGoogleOAuth(now = Date.now()) {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(GOOGLE_OAUTH_PENDING_KEY) || 'null');
    if (!validateGoogleOAuthPending(value, now)) {
      window.sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearPendingGoogleOAuth() {
  try { window.sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY); } catch { /* best effort */ }
}

export function isGoogleOAuthExchanging(now = Date.now()) {
  return readPendingGoogleOAuth(now)?.status === 'exchanging';
}

export function refreshPendingGoogleOAuthProfile({ fullName = '', phone = '' } = {}) {
  const pending = readPendingGoogleOAuth();
  if (!pending || pending.status !== 'ready') return false;
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_PENDING_KEY, JSON.stringify({
      ...pending,
      fullName: String(fullName || '').trim(),
      phone: normalizePhone(phone),
    }));
    return true;
  } catch {
    return false;
  }
}

export function isGoogleOAuthIdentity(user) {
  const appProviders = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return user?.app_metadata?.provider === 'google'
    || appProviders.includes('google')
    || identities.some((identity) => identity?.provider === 'google');
}

export function isNewGoogleOAuthAccount(user, pending) {
  const createdAt = Date.parse(user?.created_at || '');
  if (!Number.isFinite(createdAt) || !Number.isFinite(pending?.startedAt)) return false;
  return createdAt >= pending.startedAt - 120_000 && createdAt <= Date.now() + 60_000;
}

export function buildGoogleConsentMetadata(pending, existingMetadata = {}) {
  return {
    ...existingMetadata,
    age_18_plus_confirmed: true,
    age_confirmation_at: pending.acceptedAt,
    terms_accepted_at: pending.acceptedAt,
    privacy_policy_accepted_at: pending.acceptedAt,
    legal_policy_version: pending.legalPolicyVersion,
    ...(pending.fullName ? { full_name: pending.fullName } : {}),
    ...(pending.phone ? { phone: pending.phone } : {}),
  };
}

export async function prepareGoogleOAuth({ mode = 'login', fullName = '', phone = '', eligibilityAccepted = false } = {}) {
  if (!GOOGLE_OAUTH_FEATURE_ENABLED || !GOOGLE_OAUTH_CLIENT_ID) throw new Error('Google Sign-In এখনো কনফিগার করা হয়নি।');
  if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');
  if (!eligibilityAccepted) throw new Error('Google sign-in-এর আগে ১৮+ বয়স ও নীতিমালায় সম্মতি নিশ্চিত করুন।');
  const nonce = makeNonce();
  const hashedNonce = await hashNonce(nonce);
  const pending = buildGoogleOAuthPending({ mode, fullName, phone, nonce });
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new Error('এই ব্রাউজারে নিরাপদভাবে Google sign-in প্রস্তুত করা যাচ্ছে না। Private browsing/storage settings পরীক্ষা করুন।');
  }
  return { clientId: GOOGLE_OAUTH_CLIENT_ID, hashedNonce };
}

export async function completeGoogleOAuthCredential(credential) {
  if (!GOOGLE_OAUTH_FEATURE_ENABLED || !GOOGLE_OAUTH_CLIENT_ID) throw new Error('Google Sign-In এখনো কনফিগার করা হয়নি।');
  if (!supabaseConfigReady || !supabase) throw new Error('Supabase configuration is missing.');
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 16_384) {
    clearPendingGoogleOAuth();
    throw new Error('Google থেকে বৈধ পরিচয় যাচাইয়ের তথ্য পাওয়া যায়নি। আবার চেষ্টা করুন।');
  }
  const pending = readPendingGoogleOAuth();
  if (!pending || pending.status !== 'ready') {
    clearPendingGoogleOAuth();
    throw new Error('Google sign-in অনুরোধের সময়সীমা শেষ হয়েছে। আবার চেষ্টা করুন।');
  }

  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_PENDING_KEY, JSON.stringify({ ...pending, status: 'exchanging' }));
  } catch {
    clearPendingGoogleOAuth();
    throw new Error('Google sign-in-এর নিরাপদ session state সংরক্ষণ করা যায়নি।');
  }

  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
      nonce: pending.nonce,
    });
    if (error) throw error;
    if (!data?.user || !data?.session) throw new Error('Supabase Google identity থেকে session তৈরি করতে পারেনি।');
    return data;
  } catch (error) {
    clearPendingGoogleOAuth();
    throw error;
  }
}
