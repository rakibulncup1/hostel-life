import { supabase } from '../lib/supabase';

function recordAuthTelemetry(eventType, email, failureCode = 'other') {
  if (!supabase) return;
  // Best-effort only. Telemetry must never block or change the Supabase Auth result.
  try {
    Promise.resolve(supabase.functions.invoke('record-auth-event', {
      body: { event_type: eventType, email: typeof email === 'string' ? email.trim().toLowerCase() : '', failure_code: failureCode },
    })).catch(() => undefined);
  } catch {
    // A telemetry client error must never interrupt the primary Auth flow.
  }
}

function classifyAuthFailure(error, eventType) {
  const code = String(error?.code || error?.status || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code.includes('rate') || code === '429' || message.includes('rate limit')) return 'rate_limited';
  if (eventType === 'login_failed' && (code.includes('invalid') || message.includes('invalid login') || message.includes('credentials'))) return 'invalid_credentials';
  if (eventType === 'signup_failed' && (message.includes('already registered') || message.includes('already exists'))) return 'account_exists';
  if (eventType === 'signup_failed' && (message.includes('signup disabled') || message.includes('signups not allowed'))) return 'signup_disabled';
  return 'other';
}

export async function signIn({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (result.error) recordAuthTelemetry('login_failed', normalizedEmail, classifyAuthFailure(result.error, 'login_failed'));
  return result;
}

// Re-authentication prompts (profile password change / Super Admin confirmation)
// use the same monitoring path as the main login form.
export async function verifyPassword({ email, password }) {
  return signIn({ email, password });
}

export async function signUp({ fullName, phone, email, password, permissionCode = '' }) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        ...(permissionCode.trim() ? { permission_code: permissionCode.trim().toUpperCase() } : {}),
      },
    },
  });
  if (result.error) {
    recordAuthTelemetry('signup_failed', normalizedEmail, classifyAuthFailure(result.error, 'signup_failed'));
  } else if (result.data?.user) {
    // Supabase intentionally returns a user-shaped response with no identities
    // for some duplicate-email cases to prevent account enumeration.
    const duplicateIdentity = Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0;
    recordAuthTelemetry(duplicateIdentity ? 'signup_failed' : 'signup_submitted', normalizedEmail, duplicateIdentity ? 'account_exists' : 'other');
  }
  return result;
}

export async function requestPasswordReset(email) {
  const { data, error } = await supabase.functions.invoke('request-password-reset', {
    body: { email: email.trim().toLowerCase() },
  });

  if (!error) return { data, error: null };

  // Supabase FunctionsHttpError stores the non-2xx Response in `context`.
  // Normalize it so the page can show the server's safe, Bengali limit message.
  let details = null;
  const response = error.context;
  if (response instanceof Response) {
    try {
      details = await response.clone().json();
    } catch {
      details = null;
    }
  }

  recordAuthTelemetry('password_reset_failed', email, 'other');
  const normalized = new Error(details?.message || error.message || 'পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন করা যায়নি।');
  normalized.code = details?.code || error.name || 'PASSWORD_RESET_REQUEST_FAILED';
  normalized.status = response?.status || error.status || null;
  normalized.retryAt = details?.retry_at || null;
  return { data: null, error: normalized };
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}
