const KEY_PREFIX = 'hl:seven-day:v2';

function storageKey(userId, hostelId) {
  return `${KEY_PREFIX}:${userId}:${hostelId}`;
}

function getDhakaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Returns the next seven Bangladesh calendar dates, excluding today. */
export function getSevenDates(now = new Date()) {
  const base = new Date(`${getDhakaDate(now)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + index + 1);
    return date.toISOString().slice(0, 10);
  });
}

export function saveSevenDayMeals({ userId, hostelId, periodId, days }) {
  if (!userId || !hostelId || !periodId || !Array.isArray(days)) return null;
  const record = {
    version: 2,
    userId,
    hostelId,
    periodId,
    savedAt: new Date().toISOString(),
    days,
  };
  try {
    localStorage.setItem(storageKey(userId, hostelId), JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function readSevenDayMeals(userId, hostelId) {
  if (!userId || !hostelId || typeof localStorage === 'undefined') return null;
  try {
    const record = JSON.parse(localStorage.getItem(storageKey(userId, hostelId)) || 'null');
    if (record?.version !== 2 || record.userId !== userId || record.hostelId !== hostelId
      || !record.periodId || !Array.isArray(record.days) || record.days.length !== 7) return null;
    return record;
  } catch {
    return null;
  }
}

export function clearSevenDayMeals(userId, hostelId) {
  if (!userId || !hostelId || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(storageKey(userId, hostelId)); } catch { /* storage may be unavailable */ }
}
