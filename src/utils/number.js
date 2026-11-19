import { getUiLocale } from '../i18n/locale.js';

export function formatNumber(value, options = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return new Intl.NumberFormat(getUiLocale()).format(0);
  return new Intl.NumberFormat(getUiLocale(), {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(number);
}

export function formatCurrency(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return `৳${new Intl.NumberFormat(getUiLocale()).format(0)}`;
  return `৳${new Intl.NumberFormat(getUiLocale(), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(number)}`;
}
