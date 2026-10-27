const MEAL_TIME_ZONE = 'Asia/Dhaka';

function partsForDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MEAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

function minutesInDhaka(parts) {
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

/** Normal member requests are accepted until 10:00 PM Bangladesh time. */
export function isNormalMealRequestWindowOpen(now = new Date()) {
  const parts = partsForDateTime(now);
  return minutesInDhaka(parts) < 22 * 60;
}

/** Late requests are available only from 10:00 PM onward and always target tomorrow. */
export function getLateMealRequestTargetDate(now = new Date()) {
  const parts = partsForDateTime(now);
  if (minutesInDhaka(parts) < 22 * 60) return null;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return shiftIsoDate(today, 1);
}

export function findActiveMealRequestForDate(requests, targetDate) {
  if (!targetDate || !Array.isArray(requests)) return null;
  return requests.find((request) =>
    ['submitted', 'approved'].includes(request?.status)
    && (request?.days || []).some((day) => String(day?.meal_date || '').slice(0, 10) === targetDate)
  ) || null;
}
