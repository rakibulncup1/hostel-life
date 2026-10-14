/**
 * Calendar helpers for initializing the first Hostel Life period.
 * The application and database business dates use Asia/Dhaka, not the browser's
 * local timezone. All returned values are ISO date strings (YYYY-MM-DD).
 */
export function dhakaDateInputValue(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

export function firstDayOfMonth(dateValue) {
  const raw = String(dateValue ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return '';
  return `${raw.slice(0, 7)}-01`;
}

export function addIsoDays(dateValue, amount = 1) {
  const raw = String(dateValue ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isInteger(amount)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * If periods exist, the next period begins the day after the latest closed/archive
 * period. A brand-new hostel with no period history starts on day 1 of the current
 * Dhaka calendar month. Call this only after the backend has authoritatively confirmed
 * that there is no running period.
 */
export function deriveNextRequiredStartDate(periods, todayValue) {
  const rows = Array.isArray(periods) ? periods : [];
  const closedRows = rows
    .filter((item) => ['closed', 'archived'].includes(String(item?.status ?? '').toLowerCase()))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.end_date ?? '').slice(0, 10)))
    .sort((a, b) => String(b.end_date).slice(0, 10).localeCompare(String(a.end_date).slice(0, 10)));
  if (closedRows.length) return addIsoDays(String(closedRows[0].end_date).slice(0, 10), 1);
  return firstDayOfMonth(todayValue || dhakaDateInputValue());
}
