function asDateMs(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export function isCutoffPassed(day, now = Date.now()) {
  const cutoff = asDateMs(day?.cutoff_at);
  if (!Number.isFinite(cutoff)) return false;
  return cutoff <= (now instanceof Date ? now.getTime() : now);
}

export function canSubmitMealDay(day, now = Date.now()) {
  if (!day) return false;
  return day.status !== 'finalized' && !isCutoffPassed(day, now);
}

export function canCorrectMealDay(day, now = Date.now()) {
  if (!day) return false;
  return Boolean(day.meal_date) && isCutoffPassed(day, now);
}

export function getMealDayStatusText(day, now = Date.now()) {
  if (!day) return 'তারিখের তথ্য পাওয়া যায়নি';
  if (day.status === 'finalized') return 'ফাইনাল হয়েছে';
  if (day.status === 'locked') return isCutoffPassed(day, now) ? 'লকড' : 'লক হতে যাচ্ছে';
  return isCutoffPassed(day, now) ? 'কাট-অফ শেষ' : 'এখন দেওয়া যাবে';
}
