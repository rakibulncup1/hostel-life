export function getFriendlySupabaseError(error, fallback = 'কাজটি সম্পন্ন করা যায়নি।') {
  const message = String(error?.message ?? error ?? '').trim();
  const normalized = message.toLowerCase();

  const exactMap = [
    ['invalid login credentials', 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।'],
    ['email not confirmed', 'আপনার ইমেইল এখনো ভেরিফাই করা হয়নি। ইমেইল ইনবক্স দেখুন।'],
    ['user already registered', 'এই ইমেইল দিয়ে আগে থেকেই একটি অ্যাকাউন্ট রয়েছে।'],
    ['password should be at least', 'পাসওয়ার্ডটি আরও শক্তিশালী হতে হবে।'],
    ['signup is disabled', 'এই মুহূর্তে নতুন রেজিস্ট্রেশন বন্ধ রয়েছে।'],
    ['email rate limit exceeded', 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।'],
    ['same_hostel', 'এই অ্যাকাউন্ট ইতিমধ্যে একটি মেসের সঙ্গে যুক্ত আছে।'],
    ['jwt expired', 'আপনার সেশন শেষ হয়েছে। আবার লগইন করুন।'],
    ['network request failed', 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।'],
    ['failed to fetch', 'ইন্টারনেট সংযোগে সমস্যা হয়েছে।'],
  ];

  for (const [needle, translated] of exactMap) {
    if (normalized.includes(needle)) return translated;
  }

  if (message.includes('Join Code সঠিক নয়।')) return 'Join Code সঠিক নয়।';
  if (message.includes('এই অ্যাকাউন্ট ইতিমধ্যে একটি মেসের সঙ্গে যুক্ত আছে।')) return 'এই অ্যাকাউন্ট ইতিমধ্যে একটি মেসের সঙ্গে যুক্ত আছে।';
  if (message.includes('প্রথমে একটি মেসে যুক্ত হন।')) return 'প্রথমে একটি মেসে যুক্ত হন।';
  if (message.includes('লগইন করা প্রয়োজন।')) return 'লগইন করা প্রয়োজন।';

  // Most protected Hostel Life RPCs intentionally return user-facing Bengali
  // reasons (cutoff, permission, validation, missing record, etc.). Keep those
  // messages instead of replacing them with a vague generic error. For raw
  // PostgREST/PostgreSQL messages, fall back to the safe Bengali message above.
  if (/[\u0980-\u09FF]/.test(message) && message.length <= 260) return message;

  return fallback;
}
