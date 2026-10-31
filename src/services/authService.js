import { supabase } from '../lib/supabase';

export async function signIn({ email, password }) {
  return supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
}

export async function signUp({ fullName, phone, email, password, permissionCode = '' }) {
  return supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        ...(permissionCode.trim() ? { permission_code: permissionCode.trim().toUpperCase() } : {}),
      },
    },
  });
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

  const normalized = new Error(details?.message || error.message || 'পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন করা যায়নি।');
  normalized.code = details?.code || error.name || 'PASSWORD_RESET_REQUEST_FAILED';
  normalized.status = response?.status || error.status || null;
  normalized.retryAt = details?.retry_at || null;
  return { data: null, error: normalized };
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}
