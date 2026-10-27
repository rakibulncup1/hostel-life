function isoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function calendarMonthEnd(dateString) {
  const value = isoDate(dateString);
  if (!value) return null;
  const [year, month] = value.split('-').map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A month split in the middle of a calendar month should normally run through
 * that calendar month's last day. Only suggest repair when the target request
 * is inside that same month and is blocked solely by an unexpectedly short end.
 * This never mutates data; callers must show an explicit confirmation before
 * calling the existing manager end-date RPC.
 */
export function getSplitPeriodBoundaryRepair(period, requestedDate) {
  const startDate = isoDate(period?.start_date);
  const endDate = isoDate(period?.end_date);
  const targetDate = isoDate(requestedDate);
  const monthEnd = calendarMonthEnd(startDate);
  const startDay = startDate ? Number(startDate.slice(8, 10)) : null;
  const needsRepair = Boolean(
    period && startDate && endDate && targetDate && monthEnd &&
    startDay > 1 && startDate.slice(0, 7) === monthEnd.slice(0, 7) &&
    endDate < monthEnd && targetDate > endDate && targetDate <= monthEnd
  );
  return { needsRepair, startDate, endDate, targetDate, monthEnd };
}
