import { supabase } from '../lib/supabase';

async function responseDetails(error) {
  const response = error?.context;
  if (!(response instanceof Response)) return null;
  try { return await response.clone().json(); } catch { return null; }
}

async function checkAppAuthGate() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('auth-security-gate', { body: {} });
    if (error) {
      const details = await responseDetails(error);
      const status = error.context?.status || error.status || null;
      if (status === 429 || details?.code === 'AUTH_IP_TEMPORARILY_BLOCKED') {
        const blocked = new Error(details?.message || 'নিরাপত্তার জন্য এই নেটওয়ার্ক থেকে Login ও Registration সাময়িকভাবে বন্ধ রাখা হয়েছে।');
        blocked.code = details?.code || 'AUTH_IP_TEMPORARILY_BLOCKED';
        blocked.status = 429;
        blocked.retryAt = details?.retry_at || null;
        return blocked;
      }
      if (details?.code === 'CLIENT_IP_UNAVAILABLE') {
        const unavailable = new Error(details?.message || 'নিরাপত্তা যাচাই করা যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন।');
        unavailable.code = details.code;
        unavailable.status = 503;
        return unavailable;
      }
      // The Auth service remains available if the optional gate function is not
      // deployed/temporarily unavailable. This is a documented fail-open path;
      // the application must deploy the gate function to enable this control.
      console.warn('[Hostel Life] Auth security gate unavailable:', details?.code || error.message || error.name || 'unknown_error');
      return null;
    }
    if (data?.blocked) {
      const blocked = new Error(data.message || 'নিরাপত্তার জন্য Login ও Registration সাময়িকভাবে বন্ধ রাখা হয়েছে।');
      blocked.code = data.code || 'AUTH_IP_TEMPORARILY_BLOCKED';
      blocked.status = 429;
      blocked.retryAt = data.retry_at || null;
      return blocked;
    }
    if (data?.protection_available === false) {
      console.warn('[Hostel Life] Auth gate received no trusted client IP; IP protection is unavailable for this request.');
    }
    return null;
  } catch (error) {
    // Preserve availability during edge/network outages; never invent a block.
    console.warn('[Hostel Life] Auth security gate request failed:', error?.message || 'network_error');
    return null;
  }
}

async function recordAuthTelemetry(eventType, email, failureCode = 'other') {
  if (!supabase) return;
  // Await the best-effort write (bounded to 1.5s) so consecutive failed attempts
  // are more likely to be counted before a user immediately retries.
  try {
    const delivery = Promise.resolve(supabase.functions.invoke('record-auth-event', {
      body: { event_type: eventType, email: typeof email === 'string' ? email.trim().toLowerCase() : '', failure_code: failureCode },
    })).then(({ data, error }) => {
      if (error) {
        console.warn('[Hostel Life] Security telemetry delivery failed:', error.message || error.name || 'unknown_error');
      } else if (data?.accepted === false) {
        console.warn('[Hostel Life] Security telemetry was not stored:', data.code || data.reason || 'not_accepted');
      }
    }).catch((error) => {
      console.warn('[Hostel Life] Security telemetry request failed:', error?.message || 'network_error');
    });
    await Promise.race([delivery, new Promise((resolve) => setTimeout(resolve, 1500))]);
  } catch {
    // Telemetry failure must never interrupt the primary Auth flow.
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
  const gateError = await checkAppAuthGate();
  if (gateError) return { data: null, error: gateError };
  const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (result.error) {
    await recordAuthTelemetry('login_failed', normalizedEmail, classifyAuthFailure(result.error, 'login_failed'));
  } else if (result.data?.user) {
    await recordAuthTelemetry('login_success', normalizedEmail, 'other');
  }
  return result;
}

// Re-authentication prompts (profile password change / Super Admin confirmation)
// use the same gate and monitoring path as the main login form.
export async function verifyPassword({ email, password }) {
  return signIn({ email, password });
}

export async function signUp({ fullName, phone, email, password, permissionCode = '', age18PlusConfirmed = false, ageConfirmationAt = null, termsAcceptedAt = null, privacyPolicyAcceptedAt = null, legalPolicyVersion = '' }) {
  if (age18PlusConfirmed !== true || !ageConfirmationAt || !termsAcceptedAt || !privacyPolicyAcceptedAt || !legalPolicyVersion) {
    return { data: null, error: new Error('রেজিস্ট্রেশনের আগে ১৮+ বয়স নিশ্চিত করে ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি দিতে হবে।') };
  }
  const normalizedEmail = email.trim().toLowerCase();
  const gateError = await checkAppAuthGate();
  if (gateError) return { data: null, error: gateError };
  const result = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        ...(permissionCode.trim() ? { permission_code: permissionCode.trim().toUpperCase() } : {}),
        age_18_plus_confirmed: age18PlusConfirmed === true,
        age_confirmation_at: ageConfirmationAt,
        terms_accepted_at: termsAcceptedAt,
        privacy_policy_accepted_at: privacyPolicyAcceptedAt,
        legal_policy_version: legalPolicyVersion,
      },
    },
  });
  if (result.error) {
    await recordAuthTelemetry('signup_failed', normalizedEmail, classifyAuthFailure(result.error, 'signup_failed'));
  } else if (result.data?.user) {
    // Supabase returns no identities for some duplicate-email cases to prevent
    // account enumeration. Keep the same privacy-preserving event behaviour.
    const duplicateIdentity = Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0;
    await recordAuthTelemetry(duplicateIdentity ? 'signup_failed' : 'signup_submitted', normalizedEmail, duplicateIdentity ? 'account_exists' : 'other');
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
  const details = await responseDetails(error);
  const response = error.context;
  await recordAuthTelemetry('password_reset_failed', email, 'other');
  const normalized = new Error(details?.message || error.message || 'পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন করা যায়নি।');
  normalized.code = details?.code || error.name || 'PASSWORD_RESET_REQUEST_FAILED';
  normalized.status = response?.status || error.status || null;
  normalized.retryAt = details?.retry_at || null;
  return { data: null, error: normalized };
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}
