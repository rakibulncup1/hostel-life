import { supabase } from '../lib/supabase';

const BUCKET = 'hostel_documents';
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function updateMyProfile({ fullName, phone = null, avatarUrl = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_full_name: fullName,
    p_phone: phone || null,
    p_avatar_url: avatarUrl || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function uploadProfileAvatar(userId, file) {
  assertSupabase();
  if (!userId) throw new Error('ব্যবহারকারীর পরিচয় পাওয়া যায়নি।');
  if (!(file instanceof File)) throw new Error('একটি ছবি নির্বাচন করুন।');
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('শুধু JPG, PNG বা WEBP ছবি ব্যবহার করুন।');
  if (file.size > MAX_FILE_SIZE) throw new Error('ছবির সর্বোচ্চ সাইজ ২ MB হতে হবে।');

  const path = `${userId}/profile-avatar`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('ছবির লিংক তৈরি করা যায়নি।');
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function changePassword(newPassword) {
  assertSupabase();
  if (!newPassword || newPassword.length < 8) {
    throw new Error('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
