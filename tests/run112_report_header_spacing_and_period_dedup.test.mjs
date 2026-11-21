import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const report = fs.readFileSync('src/services/reportService.js', 'utf8');

test('Run112 uses exact 96-DPI PNG dimensions for the physical one-inch page header', () => {
  assert.match(report, /const REPORT_HEADER_HEIGHT_MM = 25\.4/);
  assert.match(report, /const REPORT_HEADER_DPI = 96/);
  assert.match(report, /const REPORT_HEADER_PIXELS_PER_MM = REPORT_HEADER_DPI \/ 25\.4/);
  assert.match(report, /const width = Math\.round\(printableWidthMm \* pixelsPerMm\)/);
  assert.match(report, /const height = Math\.round\(REPORT_HEADER_HEIGHT_MM \* pixelsPerMm\)/);
  assert.match(report, /return canvas\.toDataURL\('image\/png'\)/);
  assert.doesNotMatch(report, /data:image\/svg\+xml;base64,/);
});

test('Run112 preserves the exact half-inch side margins and separates the top border from the one-inch header band', () => {
  assert.match(report, /@page\{size:\$\{pageSize\};margin:50\.8mm 12\.7mm 38\.1mm/);
  assert.match(report, /@top-center\{content:\$\{headerContent\};vertical-align:top;padding-top:12\.7mm/);
  assert.doesNotMatch(report, /@top-center\{[^}]*width:100%;height:25\.4mm/);
  assert.match(report, /printableWidthMm = \(pageOrientation === 'landscape' \? 297 : 210\) - 25\.4/);
});

test('Run112 prints the Bengali slogan in Bangla UI and English slogan in English UI', () => {
  assert.match(report, /tagline: isEnglish \? 'Simple, transparent and organised management\.' : 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা'/);
  assert.match(report, /isEnglish \? 'Simple, transparent and organised management\.' : 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা'/);
});

test('Run112 removes only period-only/date-range subtitles already represented in the header', () => {
  assert.match(report, /function normalizeReportText\(/);
  assert.match(report, /function isDuplicatePeriodSubtitle\(/);
  assert.match(report, /normalizedText === normalizedLabel/);
  assert.match(report, /hasDateRangeMarker && hasPeriodDate/);
  assert.match(report, /const duplicatePeriodSubtitle = isDuplicatePeriodSubtitle\(/);
  assert.match(report, /reportSubtitle && !duplicatePeriodSubtitle/);
  assert.match(report, /const hasReportDetails = \/মোট\|total\|এন্ট্রি\|entries\|লেনদেন\|transaction\|বাজার\|market\|৳/);
});

test('Run112 leaves useful filtered-history summaries visible and retains the established footer branding', () => {
  assert.match(report, /hasReportDetails/);
  assert.match(report, /Copyright © \$\{currentYear\} Hostel-Life\. All rights reserved\./);
  assert.match(report, /Designed & Developed by Rakibul Islam Samrat/);
  assert.match(report, /@bottom-center\{content:\$\{pageFooter\}/);
  assert.match(report, /width:calc\(100% - 25\.4mm\);height:25\.4mm;margin:0 auto;padding:1\.2mm 0 0;border-top:\.8pt solid/);
});

test('Run112 subtitle guard hides duplicate period-only date text but keeps meaningful report summaries', () => {
  const start = report.indexOf('function normalizeReportText(');
  const end = report.indexOf('\nexport function printReport(', start);
  assert.ok(start >= 0 && end > start, 'period subtitle helpers must remain defined before printReport');
  const helpers = report.slice(start, end);
  const isDuplicatePeriodSubtitle = new Function(`${helpers}; return isDuplicatePeriodSubtitle;`)();

  assert.equal(isDuplicatePeriodSubtitle('১ নভেম্বর, ২০২৬ থেকে চলমান · Nov 2026', {
    periodLabel: 'Nov 2026', periodStart: '2026-11-01', periodEnd: '',
  }), true);
  assert.equal(isDuplicatePeriodSubtitle('Nov 2026', {
    periodLabel: 'Nov 2026', periodStart: '2026-11-01', periodEnd: '',
  }), true);
  assert.equal(isDuplicatePeriodSubtitle('Filtered market · 12 entries · Total ৳8,450', {
    periodLabel: 'Nov 2026', periodStart: '2026-11-01', periodEnd: '2026-11-30',
  }), false);
  assert.equal(isDuplicatePeriodSubtitle('', { periodLabel: 'Nov 2026' }), false);
});
