const REPORT_COLUMNS = [
  ['hostel_name', 'মেসের নাম'],
  ['platform_status', 'মেসের অবস্থা'],
  ['periods_in_range', 'নির্বাচিত সময়ে মাস'],
  ['detailed_periods', 'বিস্তারিত মাস'],
  ['snapshot_periods', 'সংরক্ষিত সামারি মাস'],
  ['snapshot_partial_excluded', 'আংশিক আর্কাইভ বাদ'],
  ['finalized_days', 'বিস্তারিত ডেটার চূড়ান্ত দিন'],
  ['breakfast', 'সকালের মিল'],
  ['lunch', 'দুপুরের মিল'],
  ['dinner', 'রাতের মিল'],
  ['total_meals', 'মোট মিল'],
  ['market_entry_count', 'বিস্তারিত ডেটার বাজার এন্ট্রি'],
  ['market_total', 'মোট বাজার'],
  ['cash_deposit', 'নগদ ডিপোজিট'],
  ['market_credit', 'বাজার ক্রেডিট'],
  ['other_expense', 'অন্যান্য খরচ'],
  ['khala_expense', 'খালার টাকা'],
  ['adjustment_net', 'নেট সমন্বয়'],
  ['operating_expense', 'মোট পরিচালন ব্যয়'],
  ['meal_rate', 'মিল রেট'],
  ['pending_requests', 'অপেক্ষমাণ মিল অনুরোধ'],
];

function safeCsvText(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formula execution for user-controlled text fields.
  const protectedValue = /^[\s\u0000-\u001f]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function csvNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '';
}

export function buildPlatformReportCsv(report) {
  if (!report || !Array.isArray(report.items)) throw new Error('রিপোর্টের তথ্য সঠিক নয়।');
  const totals = report.totals || {};
  const lines = [
    [safeCsvText('Hostel Life · Super Admin Aggregate Report')].join(','),
    [safeCsvText('শুরুর তারিখ'), safeCsvText(report.from_date || '')].join(','),
    [safeCsvText('শেষ তারিখ'), safeCsvText(report.to_date || '')].join(','),
    [safeCsvText('তৈরির সময়'), safeCsvText(report.generated_at || '')].join(','),
    '',
    [safeCsvText('সামগ্রিক সারসংক্ষেপ'), safeCsvText('পরিমাণ')].join(','),
    [safeCsvText('মোট মেস'), csvNumber(totals.hostel_count)].join(','),
    [safeCsvText('সক্রিয় মেস'), csvNumber(totals.active_hostel_count)].join(','),
    [safeCsvText('স্থগিত মেস'), csvNumber(totals.suspended_hostel_count)].join(','),
    [safeCsvText('নির্বাচিত সময়ে মাস'), csvNumber(totals.periods_in_range)].join(','),
    [safeCsvText('চূড়ান্ত দিন'), csvNumber(totals.finalized_days)].join(','),
    [safeCsvText('মোট মিল'), csvNumber(totals.total_meals)].join(','),
    [safeCsvText('মোট বাজার'), csvNumber(totals.market_total)].join(','),
    [safeCsvText('নগদ ডিপোজিট'), csvNumber(totals.cash_deposit)].join(','),
    [safeCsvText('বাজার ক্রেডিট'), csvNumber(totals.market_credit)].join(','),
    [safeCsvText('অন্যান্য খরচ'), csvNumber(totals.other_expense)].join(','),
    [safeCsvText('খালার টাকা'), csvNumber(totals.khala_expense)].join(','),
    [safeCsvText('মোট পরিচালন ব্যয়'), csvNumber(totals.operating_expense)].join(','),
    [safeCsvText('আংশিক আর্কাইভ মাসের তথ্য যোগ হয়নি'), csvNumber(totals.snapshot_partial_excluded)].join(','),
    '',
    REPORT_COLUMNS.map(([, label]) => safeCsvText(label)).join(','),
    ...report.items.map((item) => REPORT_COLUMNS.map(([key]) => {
      if (key === 'hostel_name' || key === 'platform_status') return safeCsvText(item?.[key] ?? '');
      return csvNumber(item?.[key]);
    }).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function getPlatformReportFilename(fromDate, toDate) {
  const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(fromDate || '') ? fromDate : 'from';
  const safeTo = /^\d{4}-\d{2}-\d{2}$/.test(toDate || '') ? toDate : 'end';
  return `hostel-life-platform-report-${safeFrom}-to-${safeTo}.csv`;
}
