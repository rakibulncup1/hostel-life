import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const appShell = read('src/app/AppShell.jsx');
const authStyles = read('src/styles/ui-refresh.css');
const managerPage = read('src/features/menu/MenuPages.jsx');
const drawer = read('src/components/MenuDrawer.jsx');
const notifications = read('src/components/NotificationsPopover.jsx');

test('mobile public entry screens use a full-bleed outer frame while preserving rounded inner controls', () => {
  assert.match(authStyles, /@media \(max-width: 700px\)[\s\S]*?\.auth-shell\.auth-shell-compact[\s\S]*?border-radius: 0/);
  assert.match(authStyles, /\.onboarding-main-card[\s\S]*?border-radius: 0/);
  assert.match(authStyles, /\.auth-form-panel \.field-label input[\s\S]*?border-radius: 13px/);
  assert.match(authStyles, /env\(safe-area-inset-bottom\)/);
});

test('platform system announcement and hostel manager announcement have distinct identities', () => {
  assert.match(appShell, /global-system-announcement/);
  assert.match(appShell, /HOSTEL LIFE · SYSTEM NOTICE/);
  assert.match(appShell, /hostel-manager-announcement/);
  assert.match(appShell, /মেসের ম্যানেজারের বার্তা/);
  assert.match(authStyles, /\.global-system-announcement[\s\S]*?background:/);
  assert.match(authStyles, /\.hostel-manager-announcement[\s\S]*?background:/);
});

test('global and manager announcements span the viewport on desktop and mobile', () => {
  assert.match(authStyles, /\.global-announcement\s*\{[^}]*width: 100%;[^}]*max-width: none;/);
  assert.match(authStyles, /\.global-announcement-inner\s*\{[^}]*width: min\(1600px, 100%\)/);
  assert.match(authStyles, /@media \(max-width: 700px\)\s*\{\s*\.global-announcement-inner/);
});

test('manager-facing notice actions no longer expose the technical pinned wording', () => {
  assert.match(drawer, /label: 'মেস নোটিশ'/);
  assert.match(managerPage, /বর্তমান মেস নোটিশ/);
  assert.match(managerPage, /মেসে নোটিশ প্রকাশ করুন/);
  assert.doesNotMatch(managerPage, /পিন করা|পিন করুন|পিন করা হচ্ছে/);
});

test('notification inbox identifies hostel notices and manager messages with source badges', () => {
  assert.match(notifications, /notification-source-badge/);
  assert.match(notifications, /মেসের নোটিশ/);
  assert.match(notifications, /ম্যানেজারের বার্তা/);
  assert.match(authStyles, /\.notification-copy > \.notification-source-badge\.system/);
  assert.match(authStyles, /\.notification-copy > \.notification-source-badge\.hostel/);
  assert.doesNotMatch(notifications, /পিন করা/);
});
