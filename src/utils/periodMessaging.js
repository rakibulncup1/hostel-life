import { formatDateBangla } from './date.js';
import { getFriendlySupabaseError } from './supabaseErrors.js';

/**
 * Returns the Bangladesh (Asia/Dhaka) calendar date used by the period lifecycle.
 * Do not use the browser's local timezone for a business-date decision.
 */
export function getDhakaBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
}

/**
 * A period can be marked `running` from 8 PM on its predecessor's closing day,
 * although its first business date is tomorrow. Give that state a useful notice
 * instead of letting users discover it through a generic database date error.
 */
export function getPeriodStartNotice(period, actionLabel = 'এন্ট্রি', today = getDhakaBusinessDate()) {
  const startDate = String(period?.start_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !today || startDate <= today) return '';
  const displayDate = formatDateBangla(startDate);
  return `নতুন মাস ${displayDate} থেকে শুরু হবে। ${actionLabel} ${displayDate} থেকে করা যাবে।`;
}

/**
 * Translate only date/period-boundary failures when the selected running period
 * is known to start in the future. Permission, validation and unrelated errors
 * must keep their original messages.
 */
export function getPeriodAwareError(error, fallback, period, actionLabel = 'এন্ট্রি', today = getDhakaBusinessDate()) {
  const message = String(error?.message ?? error ?? '');
  const isPeriodBoundaryError = /(?:তারিখ|এন্ট্রি).*(?:চলমান মাস|সংশ্লিষ্ট মাস|মাসের সীমা)|(?:চলমান মাস|সংশ্লিষ্ট মাস).*(?:তারিখ|সীমা)|(?:date|entry).{0,45}(?:within|between|period|range)|(?:running|current)\s+period.{0,45}(?:date|start)|period.{0,30}(?:date|start)/i.test(message);
  const notice = isPeriodBoundaryError ? getPeriodStartNotice(period, actionLabel, today) : '';
  if (notice) return notice;
  return getFriendlySupabaseError(error, fallback);
}
