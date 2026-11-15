export const DEFAULT_MEAL_COUNT_MODES = Object.freeze({
  breakfast: 'half',
  lunch: 'full',
  dinner: 'full',
});

/** Normalize the shared hostel setting without allowing malformed data into the UI. */
export function normalizeMealCountModes(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  return Object.fromEntries(Object.keys(DEFAULT_MEAL_COUNT_MODES).map((key) => [
    key,
    source?.[key] === 'full' || source?.[key] === 'half'
      ? source[key]
      : DEFAULT_MEAL_COUNT_MODES[key],
  ]));
}

/** Convert stored meal units to the people count displayed on the dashboard. */
export function getMealPeopleCount(value, mode = 'full') {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return amount * (mode === 'half' ? 2 : 1);
}
