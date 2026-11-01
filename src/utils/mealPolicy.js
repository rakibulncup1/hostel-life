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
  if (!day || !day.meal_date || !['open', 'locked'].includes(day.status)) return false;
  const currentMs = now instanceof Date ? now.getTime() : now;
  const finalizesMs = asDateMs(day.finalizes_at);
  return isCutoffPassed(day, currentMs) && Number.isFinite(finalizesMs) && finalizesMs > currentMs;
}

export function getMealDayStatusText(day, now = Date.now()) {
  if (!day) return 'তারিখের তথ্য পাওয়া যায়নি';
  if (day.status === 'finalized') return 'ফাইনাল হয়েছে';
  if (day.status === 'locked') return isCutoffPassed(day, now) ? 'লকড' : 'লক হতে যাচ্ছে';
  return isCutoffPassed(day, now) ? 'কাট-অফ শেষ' : 'এখন দেওয়া যাবে';
}

/** Returns true only for the current Bangladesh calendar day at/after its 21:00 finalization time. */
export function isDhakaFinalizationDue(mealDate, now = new Date()) {
  if (!mealDate) return false;
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const minutes = Number(values.hour || 0) * 60 + Number(values.minute || 0);
  return String(mealDate).slice(0, 10) === today && minutes >= (21 * 60);
}
