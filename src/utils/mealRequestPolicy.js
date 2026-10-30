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

/** Late window: 22:00 on the preceding date until 21:00 on the meal date (Dhaka). */
export function getLateMealRequestTargetDate(now = new Date()) {
  const parts = partsForDateTime(now);
  const minutes = minutesInDhaka(parts);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (minutes >= 22 * 60) return shiftIsoDate(today, 1);
  if (minutes < 21 * 60) return today;
  return null; // 21:00–21:59: no eligible meal date
}

/** A normal approved request's target date needs a manager-approved correction
 * only after 22:00 the previous day and before the meal date's 21:00 finalization.
 * Past/finalized dates cannot be reopened by a member correction request. */
export function isCorrectionWindowForMealDate(date, now = new Date()) {
  return Boolean(date) && getLateMealRequestTargetDate(now) === date;
}

/**
 * A correction can be submitted only for the currently targeted meal date,
 * after its previous-night 10 PM cutoff and before its 9 PM finalization.
 * Missing day metadata is deliberately ineligible: the server must not be
 * asked to correct a date whose authoritative state could not be verified.
 */
export function isCorrectionDayEligible(mealDate, dayState, now = new Date()) {
  const date = String(mealDate || '').slice(0, 10);
  if (!date || !dayState || String(dayState.meal_date || '').slice(0, 10) !== date) return false;
  if (!isCorrectionWindowForMealDate(date, now)) return false;
  if (!['open', 'locked'].includes(dayState.status)) return false;

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const cutoffMs = Date.parse(dayState.cutoff_at || '');
  const finalizesMs = Date.parse(dayState.finalizes_at || '');
  if (![nowMs, cutoffMs, finalizesMs].every(Number.isFinite)) return false;

  return cutoffMs <= nowMs && finalizesMs > nowMs;
}

export function canDirectEditMealDate(date, now = new Date()) {
  if (!date) return false;
  const parts = partsForDateTime(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return date > today && !isCorrectionWindowForMealDate(date, now);
}

export function findActiveMealRequestForDate(requests, targetDate) {
  if (!targetDate || !Array.isArray(requests)) return null;
  return requests.find((request) =>
    ['submitted', 'approved'].includes(request?.status)
    && (request?.days || []).some((day) => String(day?.meal_date || '').slice(0, 10) === targetDate)
  ) || null;
}
