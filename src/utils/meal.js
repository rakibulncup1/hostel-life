import { formatNumber } from './number';

export function formatMeal(value) {
  return formatNumber(value, { maximumFractionDigits: 2 });
}

export function getMealDayDateKey(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}
