const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return toNumber(value);
  }
  return 0;
}

function dayForRow(row) {
  const relation = row?.daily_meal_days;
  return Array.isArray(relation) ? (relation[0] || null) : relation;
}

function getMealValue(row, meal, dayStatus) {
  const finalValue = row?.[`final_${meal}`];
  const actualValue = row?.[`actual_${meal}`];
  const plannedValue = row?.[`planned_${meal}`];

  if (dayStatus === 'finalized') return firstNumber(finalValue, actualValue, plannedValue);
  if (row?.finalization_source === 'emergency_override') return firstNumber(actualValue, plannedValue, finalValue);
  return firstNumber(plannedValue, actualValue, finalValue);
}

/**
 * Build seven date cards from read-only daily_meal_records rows.
 * These are server-applied meal records (approved/member-manager entries), not
 * unapproved request submissions. Rows are already constrained by the caller's
 * period filter and Supabase RLS.
 */
export function buildUpcomingMealDays(rows, dates, { periodStartDate = null, periodEndDate = null } = {}) {
  const requestedDates = Array.isArray(dates) ? dates : [];
  const totals = new Map(requestedDates.map((date) => [String(date).slice(0, 10), {
    meal_date: String(date).slice(0, 10),
    breakfast: 0,
    lunch: 0,
    dinner: 0,
    total: 0,
    within_period: (!periodStartDate || String(date).slice(0, 10) >= String(periodStartDate).slice(0, 10))
      && (!periodEndDate || String(date).slice(0, 10) <= String(periodEndDate).slice(0, 10)),
  }]));

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.cancelled) continue;
    const day = dayForRow(row);
    const date = String(day?.meal_date || '').slice(0, 10);
    const current = totals.get(date);
    if (!current) continue;

    for (const meal of MEAL_KEYS) {
      current[meal] += getMealValue(row, meal, day?.status);
    }
  }

  return [...totals.values()].map((day) => ({
    ...day,
    total: MEAL_KEYS.reduce((sum, meal) => sum + day[meal], 0),
  }));
}

/** Format an ISO calendar date in Bangladesh time without browser-local date shifts. */
export function formatUpcomingMealDate(dateValue) {
  const raw = String(dateValue || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '—';
  const date = new Date(`${raw}T12:00:00+06:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('bn-BD', {
    timeZone: 'Asia/Dhaka',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}
