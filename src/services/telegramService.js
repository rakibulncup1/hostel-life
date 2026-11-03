import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function getMyTelegramNotificationStatus() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_my_telegram_notification_status');
  if (error) throw error;
  return data || { telegram_enabled: false, connected: false, bot_username: '' };
}

export async function createMyTelegramLink() {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_my_telegram_link');
  if (error) throw error;
  if (!data?.token || !data?.bot_username) throw new Error('টেলিগ্রাম সংযোগ লিংক তৈরি করা যায়নি।');
  return { ...data, url: `https://t.me/${data.bot_username}?start=${data.token}` };
}

export async function unlinkMyTelegram() {
  assertSupabase();
  const { data, error } = await supabase.rpc('unlink_my_telegram_notification');
  if (error) throw error;
  return data;
}
