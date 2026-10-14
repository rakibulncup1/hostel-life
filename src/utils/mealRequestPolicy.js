const MEAL_TIME_ZONE = 'Asia/Dhaka';

function partsForDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MEAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value instanceof Date ? value : new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shiftIsoDate(dateString, amount) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function getLateMealRequestTargetDate(now = new Date()) {
  const parts = partsForDateTime(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const currentMinutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);

  // The day's normal card freezes at 9 PM. The next late-request window starts at 10 PM.
  if (currentMinutes >= 21 * 60 && currentMinutes < 22 * 60) return null;
  return currentMinutes >= 22 * 60 ? shiftIsoDate(today, 1) : today;
}

export function findActiveMealRequestForDate(requests, targetDate) {
  if (!targetDate || !Array.isArray(requests)) return null;
  return requests.find((request) =>
    ['submitted', 'approved'].includes(request?.status)
    && (request?.days || []).some((day) => String(day?.meal_date || '').slice(0, 10) === targetDate)
  ) || null;
}
