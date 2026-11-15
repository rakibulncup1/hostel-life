const MEAL_KEYS = Object.freeze(['breakfast', 'lunch', 'dinner']);

export const WEEKDAY_OPTIONS_BN = Object.freeze([
  { value: 0, label: 'রবিবার' },
  { value: 1, label: 'সোমবার' },
  { value: 2, label: 'মঙ্গলবার' },
  { value: 3, label: 'বুধবার' },
  { value: 4, label: 'বৃহস্পতিবার' },
  { value: 5, label: 'শুক্রবার' },
  { value: 6, label: 'শনিবার' },
]);

function clampMealValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(50, Math.round(numeric * 2) / 2));
}

/** Uses the calendar date itself, independent of the device timezone. */
export function getMealWeekdayIndex(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || '').slice(0, 10));
  if (!match) return -1;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return -1;
  return date.getUTCDay();
}

/** Applies saved weekday rules to an already-generated day list. Does not mutate inputs. */
export function applyWeekdayMealExceptions(days = [], exceptions = []) {
  const rules = new Map();
  for (const rule of exceptions || []) {
    const weekday = Number(rule?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    rules.set(weekday, rule);
  }

  return (days || []).map((day) => {
    const rule = rules.get(getMealWeekdayIndex(day?.meal_date));
    if (!rule) return { ...day };
    const next = { ...day };
    for (const key of MEAL_KEYS) {
      if (rule[key] !== undefined) next[key] = clampMealValue(rule[key]);
    }
    return next;
  });
}

/** Generates a range, preserving edits for dates already present, then applies weekday rules. */
export function buildMealDaysForRange(startDate, endDate, defaults, existingDays = [], exceptions = []) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof startDate !== 'string' || typeof endDate !== 'string'
    || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) return [];
  const startParts = startDate.split('-').map(Number);
  const endParts = endDate.split('-').map(Number);
  const [startYear, startMonth, startDay] = startParts;
  const [endYear, endMonth, endDay] = endParts;
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const startDateValue = new Date(start);
  const endDateValue = new Date(end);
  const startIsValid = Number.isInteger(startYear) && startDateValue.getUTCFullYear() === startYear
    && startDateValue.getUTCMonth() === startMonth - 1 && startDateValue.getUTCDate() === startDay;
  const endIsValid = Number.isInteger(endYear) && endDateValue.getUTCFullYear() === endYear
    && endDateValue.getUTCMonth() === endMonth - 1 && endDateValue.getUTCDate() === endDay;
  if (!startIsValid || !endIsValid || !Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];

  const existing = new Map((existingDays || []).map((day) => [String(day?.meal_date || '').slice(0, 10), day]));
  const baseDefaults = Object.fromEntries(MEAL_KEYS.map((key) => [key, clampMealValue(defaults?.[key])]));
  const generated = [];

  for (let cursor = start; cursor <= end; cursor += 86400000) {
    const mealDate = new Date(cursor).toISOString().slice(0, 10);
    const previous = existing.get(mealDate);
    generated.push(previous ? {
      meal_date: mealDate,
      ...Object.fromEntries(MEAL_KEYS.map((key) => [key, clampMealValue(previous[key])])),
    } : { meal_date: mealDate, ...baseDefaults });
  }

  return applyWeekdayMealExceptions(generated, exceptions);
}
