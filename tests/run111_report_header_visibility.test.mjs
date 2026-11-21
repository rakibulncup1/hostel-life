import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const report = fs.readFileSync('src/services/reportService.js', 'utf8');

test('Run111 renders the global report header as generated image content, not a print background', () => {
  assert.match(report, /@top-center\{content:\$\{headerContent\};vertical-align:top;padding-top:12\.7mm;/);
  assert.doesNotMatch(report, /background-image:url/);
  assert.match(report, /createReportHeaderImageDataUri\(/);
  assert.match(report, /canvas\.toDataURL\('image\/png'\)/);
  assert.match(report, /REPORT_HEADER_DPI = 96/);
  assert.match(report, /REPORT_HEADER_PIXELS_PER_MM = REPORT_HEADER_DPI \/ 25\.4/);
  assert.doesNotMatch(report, /data:image\/svg\+xml;base64,/);
});

test('Run111 embeds the exact project logo asset and has a visual fallback if the asset fails to load', () => {
  assert.match(report, /new URL\('\/icons\/hostel-life-mark\.svg', window\.location\.origin\)/);
  assert.match(report, /context\.drawImage\(logoImage/);
  assert.match(report, /drawReportLogoFallback\(context/);
});

test('Run111 includes the full requested left and right header hierarchy', () => {
  for (const fragment of [
    "appName: 'Hostel Life'",
    "tagline: isEnglish ? 'Simple, transparent and organised management.' : 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা'",
    'reportTitle: reportHeading',
    'dateRange: periodDateRange',
    'managerName,',
    'managerPhone,',
    'periodLabel: reportPeriodLabel',
    'generatedBy,',
    'generatedAt,',
    'labels: headerLabels',
  ]) assert.ok(report.includes(fragment), `missing header field: ${fragment}`);
  assert.match(report, /labels\.manager\}: \$\{managerName \|\| '—'\}[\s\S]*labels\.contact\}: \$\{managerPhone \|\| '—'\}/);
});

test('Run111 reserves the one-inch header plus half-inch top and post-header spacing for both A4 orientations', () => {
  assert.match(report, /REPORT_HEADER_HEIGHT_MM = 25\.4/);
  assert.match(report, /pageOrientation === 'landscape' \? 297 : 210/);
  assert.match(report, /const printableWidthMm = .* - 25\.4/);
  assert.match(report, /REPORT_HEADER_DPI = 96/);
  assert.match(report, /margin:50\.8mm 12\.7mm 38\.1mm/);
  assert.match(report, /vertical-align:top;padding-top:12\.7mm/);
});

test('Run111 leaves the established repeated footer branding and reserved content area intact', () => {
  assert.match(report, /Copyright © \$\{currentYear\} Hostel-Life\. All rights reserved\./);
  assert.match(report, /Designed & Developed by Rakibul Islam Samrat/);
  assert.match(report, /@bottom-center\{content:\$\{pageFooter\}/);
  assert.match(report, /width:calc\(100% - 25\.4mm\);height:25\.4mm;margin:0 auto;padding:1\.2mm 0 0;border-top:\.8pt solid/);
});

test('Run111 keeps the print window user-initiated and falls back to visible text when canvas output is unavailable', () => {
  assert.match(report, /const win = existingWindow \|\| window\.open\(/);
  assert.match(report, /const fallbackHeaderContent = cssContentString\(/);
  assert.match(report, /void pageHeaderReady\.then\(writeReportDocument\)\.catch\(\(\) => writeReportDocument\(''\)\)/);
});
