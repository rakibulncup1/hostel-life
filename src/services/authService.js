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
  return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}
