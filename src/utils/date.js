export function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateBangla(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('bn-BD', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatDateWithWeekday(value = new Date()) {
  const raw = String(value).slice(0, 10);
  const date = value instanceof Date ? value : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('bn-BD', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatDayShort(value = new Date()) {
  const raw = String(value).slice(0, 10);
  const date = value instanceof Date ? value : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('bn-BD', { weekday: 'long' }).format(date);
}

export function isBangladeshWeekend(value) {
  const raw = String(value).slice(0, 10);
  const date = value instanceof Date ? value : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 5 || day === 6;
}

export function addDays(dateValue, amount) {
  const raw = String(dateValue).slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}
