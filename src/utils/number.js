export function formatNumber(value, options = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '০';
  return new Intl.NumberFormat('bn-BD', {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(number);
}

export function formatCurrency(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '৳০';
  return `৳${new Intl.NumberFormat('bn-BD', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(number)}`;
}
