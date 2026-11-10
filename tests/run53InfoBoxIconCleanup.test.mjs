import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('shared InfoPanel renders full-width text without an icon column', () => {
  const source = read('src/components/InfoPanel.jsx');
  assert.doesNotMatch(source, /from ['"]\.\/Icon['"]/);
  assert.doesNotMatch(source, /info-panel-icon/);
  assert.match(source, /className="info-panel-copy"/);
  assert.match(source, /role="note"/);
});

test('closed-month landing guidance is theme-token based and responsive', () => {
  const css = read('src/styles/run53_info_box_icon_cleanup.css');
  assert.match(css, /\.closed-month-guidance-panel/);
  assert.match(css, /var\(--primary-soft\)/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /display:\s*block\s*!important/);
});

test('archive and history custom guidance boxes no longer render leading icons', () => {
  const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
  const history = read('src/features/history/HistoryPage.jsx');
  assert.match(archive, /className="archive-hero-guidance"><p>/);
  assert.doesNotMatch(archive, /archive-hero-guidance"><Icon/);
  assert.match(history, /history-intro-guidance-box"><span>/);
  assert.doesNotMatch(history, /history-intro-guidance-box"><Icon/);
});

test('manual Dining info panel uses the same icon-free text layout', () => {
  const dining = read('src/features/dining/DiningPage.jsx');
  assert.match(dining, /className="info-panel info-panel-warning"><div className="info-panel-copy">/);
  assert.doesNotMatch(dining, /className="info-panel-icon"/);
});

test('known informational and warning cards suppress decorative leading icons', () => {
  const css = read('src/styles/run53_info_box_icon_cleanup.css');
  for (const selector of [
    '.manager-warning-box > svg', '.meal-policy-note > svg', '.market-paste-hint > svg',
    '.hostel-invite-security-note > svg', '.platform-report-range-note > svg',
    '.platform-report-warning > svg', '.platform-backup-notice > svg',
    '.platform-health-runtime-warning > svg', '.month-close-finalization-guidance > svg'
  ]) assert.ok(css.includes(selector), `missing ${selector}`);
});

test('new stylesheet is loaded after earlier UI style layers', () => {
  const main = read('src/main.jsx');
  const prior = main.indexOf("import './styles/run52-ui-security-polish.css';");
  const current = main.indexOf("import './styles/run53_info_box_icon_cleanup.css';");
  assert.ok(prior >= 0 && current > prior);
});
