import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Run74 removes the duplicate app-header language control while Profile retains language settings', () => {
  const header = read('src/components/Header.jsx');
  assert.doesNotMatch(header, /LanguageSwitcher|app-header-language-control/);
  assert.match(read('src/features/profile/ProfilePage.jsx'), /LanguageSwitcher/);
});

test('Run74 removes duplicate language settings from the navigation drawer', () => {
  const drawer = read('src/components/MenuDrawer.jsx');
  assert.doesNotMatch(drawer, /LanguageSwitcher|drawer-language-control|drawer-language-row/);
});

test('Run70 reuses the existing local bilingual runtime without database or network dependencies', () => {
  const component = read('src/components/LanguageSwitcher.jsx');
  const main = read('src/main.jsx');
  assert.match(component, /window\.HostelLifeI18n\?\.setLanguage\?\./);
  assert.match(component, /shortLabel/);
  assert.match(main, /run69-language-system\.css/);
  const platform = read('src/features/platform/SuperAdminPage.jsx');
  assert.doesNotMatch(platform, /LanguageSwitcher|platform-language-control/);
  assert.doesNotMatch(component, /supabase|fetch\(/i);
  assert.doesNotMatch(main, /Run70.*migration/i);
  assert.match(read('public/service-worker.js'), /hostel-life-shell-v21/);
});
