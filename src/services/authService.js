import { createClient } from '@supabase/supabase-js';
import { supabase, securityGeoProxyEnabled } from '../lib/supabase';

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
      // With the signed Cloudflare Worker enabled, a gate failure must not
      // silently fall through to direct Supabase Auth (which would skip the
      // app-level IP check). Remove VITE_HOSTEL_SECURITY_WORKER_URL to return
      // deliberately to the documented direct-Supabase/fail-open mode.
      if (securityGeoProxyEnabled) {
        const unavailable = new Error(details?.message || 'নিরাপত্তা যাচাই সেবা অনুপলব্ধ। কিছুক্ষণ পরে আবার চেষ্টা করুন।');
        unavailable.code = details?.code || 'SECURITY_GATE_UNAVAILABLE';
        unavailable.status = status || 503;
        return unavailable;
      }
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
      if (securityGeoProxyEnabled) {
        const unavailable = new Error('নিরাপত্তা যাচাইয়ের জন্য Visitor IP পাওয়া যায়নি। পরে আবার চেষ্টা করুন।');
        unavailable.code = 'CLIENT_IP_UNAVAILABLE';
        unavailable.status = 503;
        return unavailable;
      }
      console.warn('[Hostel Life] Auth gate received no trusted client IP; IP protection is unavailable for this request.');
    }
    return null;
  } catch (error) {
    // A configured Worker is part of the required IP-gate path. Do not fall
    // through to Supabase Auth if that signed proxy cannot be reached.
    if (securityGeoProxyEnabled) {
      const unavailable = new Error('নিরাপত্তা যাচাই সেবা পাওয়া যাচ্ছে না। সংযোগ ঠিক করে আবার চেষ্টা করুন।');
      unavailable.code = 'SECURITY_GATE_UNAVAILABLE';
      unavailable.status = 503;
      return unavailable;
    }
    console.warn('[Hostel Life] Auth security gate request failed:', error?.message || 'network_error');
    return null;
  }
}

async function recordAuthTelemetry(eventType, email, failureCode = 'other', accessToken = null) {
  if (!supabase) return;
  // Await the best-effort write (bounded to 1.5s) so consecutive failed attempts
  // are more likely to be counted before a user immediately retries.
  try {
    const delivery = Promise.resolve(supabase.functions.invoke('record-auth-event', {
      body: { event_type: eventType, email: typeof email === 'string' ? email.trim().toLowerCase() : '', failure_code: failureCode },
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
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

export async function signIn({ email, password, trackSuccessfulLogin = true }) {
  const normalizedEmail = email.trim().toLowerCase();
  const gateError = await checkAppAuthGate();
  if (gateError) return { data: null, error: gateError };
  const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (result.error) {
    await recordAuthTelemetry('login_failed', normalizedEmail, classifyAuthFailure(result.error, 'login_failed'));
  } else if (result.data?.user && trackSuccessfulLogin) {
    // Attach the access token returned by this exact sign-in. The telemetry Edge
    // Function verifies it with Supabase Auth before storing the account identity.
    await recordAuthTelemetry('login_success', normalizedEmail, 'other', result.data.session?.access_token || null);
  }
  return result;
}

// Verify the current account password without replacing the application's
// active Supabase session. Calling signIn() on the main client created a second
// Auth session, fired SIGNED_IN, re-ran the device-limit policy and could revoke
// the very session being used to open Super Admin. It also ran the pre-auth IP
// gate for an already-authenticated step-up check.
export async function verifyPassword({ email, password }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const suppliedPassword = typeof password === 'string' ? password : '';
  const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

  if (!supabase || !projectUrl || !publishableKey || !normalizedEmail || !suppliedPassword) {
    return { data: null, error: new Error('বর্তমান অ্যাকাউন্ট যাচাই করা যাচ্ছে না। আবার চেষ্টা করুন।') };
  }

  // Bind the password check to the already-authenticated account. A caller
  // cannot use the re-authentication form to verify a different account.
  const { data: currentResult, error: currentError } = await supabase.auth.getUser();
  const currentUser = currentResult?.user;
  if (currentError || !currentUser?.id) {
    return { data: null, error: currentError || new Error('আগে আপনার অ্যাকাউন্টে লগইন করুন।') };
  }
  if (String(currentUser.email || '').trim().toLowerCase() !== normalizedEmail) {
    return { data: null, error: new Error('যে অ্যাকাউন্টে লগইন করা আছে, সেই অ্যাকাউন্টের ইমেইল ব্যবহার করুন।') };
  }

  // This one-off client has memory-only auth state. It cannot overwrite the
  // primary browser session or emit SIGNED_IN to AuthProvider. Supabase Auth's
  // native password endpoint continues to apply its own rate limits.
  const verifier = createClient(projectUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  try {
    const result = await verifier.auth.signInWithPassword({ email: normalizedEmail, password: suppliedPassword });
    if (result.error) {
      await recordAuthTelemetry('login_failed', normalizedEmail, classifyAuthFailure(result.error, 'login_failed'));
      return { data: null, error: result.error };
    }
    if (result.data?.user?.id !== currentUser.id) {
      return { data: null, error: new Error('পাসওয়ার্ডটি বর্তমানে লগইন করা অ্যাকাউন্টের সঙ্গে মেলেনি।') };
    }
    return { data: { user: currentUser }, error: null };
  } catch (error) {
    return { data: null, error };
  } finally {
    // Revoke the verifier's temporary refresh session; the main app session
    // remains untouched because this is a different Supabase client instance.
    try { await verifier.auth.signOut({ scope: 'local' }); } catch { /* best-effort cleanup */ }
  }
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
