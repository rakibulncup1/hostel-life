import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlatformReportCsv, getPlatformReportFilename } from '../src/utils/platformReportCsv.js';

test('platform report CSV includes UTF-8 BOM, date range, aggregate columns and hostel rows', () => {
  const csv = buildPlatformReportCsv({
    from_date: '2026-11-01', to_date: '2026-11-30', generated_at: '2026-11-30T18:00:00Z',
    totals: { hostel_count: 2, market_total: 2500, total_meals: 55 },
    items: [{ hostel_name: 'মেস আলফা', platform_status: 'active', periods_in_range: 1, market_total: 1500, total_meals: 30 }],
  });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /2026-11-01/);
  assert.match(csv, /মেসের নাম/);
  assert.match(csv, /মেস আলফা/);
  assert.match(csv, /১৫০০|1500/);
});

test('platform report CSV protects spreadsheet formula injection in user-controlled hostel names', () => {
  const csv = buildPlatformReportCsv({ items: [{ hostel_name: '=HYPERLINK("https://bad.example")', platform_status: 'active' }] });
  assert.match(csv, /'=/);
});

test('platform report filename accepts only ISO date values', () => {
  assert.equal(getPlatformReportFilename('2026-11-01', '2026-11-30'), 'hostel-life-platform-report-2026-11-01-to-2026-11-30.csv');
  assert.equal(getPlatformReportFilename('../bad', 'nope'), 'hostel-life-platform-report-from-to-end.csv');
});
