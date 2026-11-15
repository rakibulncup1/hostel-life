import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Run49 meal-count mode state, manager save and dashboard conversion remain connected after Run63', async () => {
  const dashboard = await read('../src/features/dashboard/DashboardPage.jsx');
  const manager = await read('../src/features/manager/ManagerPages.jsx');
  const service = await read('../src/services/managerService.js');
  const helper = await read('../src/utils/mealCountModes.js');

  assert.match(dashboard, /normalizeMealCountModes\(membership\?\.meal_count_modes\)/);
  assert.match(dashboard, /getMealPeopleCount\(meal\.breakfast, mealCountModes\.breakfast\)/);
  assert.match(dashboard, /getMealPeopleCount\(meal\.lunch, mealCountModes\.lunch\)/);
  assert.match(dashboard, /getMealPeopleCount\(meal\.dinner, mealCountModes\.dinner\)/);
  assert.match(manager, /updateMealCountModes\(mealCountModes\)/);
  assert.match(service, /manager_update_meal_count_modes/);
  assert.match(helper, /DEFAULT_MEAL_COUNT_MODES/);
});

test('Run49 styling and Run63 display, responsive dialog styles both load without replacing each other', async () => {
  const main = await read('../src/main.jsx');
  const dashboard = await read('../src/features/dashboard/DashboardPage.jsx');
  const css49 = await read('../src/styles/run49-ui-refinement.css');
  const css63 = await read('../src/styles/run63_focused_fixes.css');

  assert.match(main, /import '\.\/styles\/run49-ui-refinement\.css';/);
  assert.match(main, /import '\.\/styles\/run63_focused_fixes\.css';/);
  assert.match(dashboard, /formatMeal\(value\)\}<small className="meal-unit-label"> জন<\/small>/);
  assert.match(dashboard, /signedMealDelta\(value\)\}<small className="meal-unit-label"> জন<\/small>/);
  assert.match(css49, /meal-count-mode-row/);
  assert.match(css63, /system-notice-dialog/);
});

test('In-app legal pages retain the canonical public content source and Run49 minimal headers', async () => {
  const menu = await read('../src/features/menu/MenuPages.jsx');
  const legal = await read('../src/content/legalDocuments.js');
  assert.match(menu, /LEGAL_DOCUMENTS\.privacy/);
  assert.match(menu, /LEGAL_DOCUMENTS\.terms/);
  assert.match(menu, /<PageHeader eyebrow="" title=\{document\.title\} \/>/);
  assert.match(legal, /export const LEGAL_DOCUMENTS/);
});
