import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dining = read('src/features/dining/DiningPage.jsx');
const diningCss = read('src/styles/dining-experience-v2.css');
const main = read('src/main.jsx');
const weekday = read('src/utils/weekdayMealExceptions.js');


test('Dining uses the Dashboard-aligned stylesheet after the shared theme layers', () => {
  assert.match(main, /import '\.\/styles\/dining-experience-v2\.css';/);
  assert.ok(main.indexOf("dashboard-reimagined-original.css") < main.indexOf("dining-experience-v2.css"));
  assert.match(diningCss, /:root\[data-theme="dark"\]/);
  assert.match(diningCss, /:root\[data-theme="blue"\]/);
});

test('manager Dining home uses two desktop columns and members retain their own smaller menu', () => {
  assert.match(diningCss, /@media \(min-width: 761px\)[\s\S]*?\.dining-action-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(diningCss, /@media \(max-width: 600px\)[\s\S]*?\.dining-action-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(dining, /canOperateDining && <DiningOptionCard icon="shield"/);
  assert.match(dining, /canOperateDining && <DiningOptionCard icon="calendar"/);
  assert.match(dining, /canOperateDining && <DiningOptionCard icon="wallet"/);
  assert.match(dining, /!isManager && !isAssistantManager && <DiningOptionCard icon="history"/);
});

test('Dining feature shortcuts keep icons left of titles on both desktop and mobile', () => {
  assert.match(diningCss, /\.request-choice-card \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\)/);
  assert.match(diningCss, /\.request-choice-card \.dining-option-icon \{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1 \/ span 2/);
  assert.match(diningCss, /@media \(max-width: 600px\)[\s\S]*?\.request-choice-card \{ min-height: 78px/);
});

test('new meal request automatically generates its inclusive date range without a generate button', () => {
  const editor = dining.slice(dining.indexOf('function MealRequestEditor'), dining.indexOf('function RequestHistory'));
  assert.match(editor, /if \(mode !== 'new'\) return;[\s\S]*?buildMealDaysForRange\(startDate, endDate, latestDefaultsRef\.current, current, weekdayExceptions\)/);
  assert.match(editor, /\[mode, startDate, endDate, weekdayExceptions\]/);
  assert.match(editor, /\{isEdit && <button className="secondary-button" type="button" onClick=\{regenerateDays\}/);
  assert.doesNotMatch(editor, /দিন তৈরি করুন/);
});

test('default meal values only overwrite generated days after the explicit apply-all action', () => {
  const editor = dining.slice(dining.indexOf('function MealRequestEditor'), dining.indexOf('function RequestHistory'));
  assert.match(editor, /onChange=\{\(e\) => setDefaults/);
  assert.match(editor, /const applyDefaults = \(\) => \{[\s\S]*?current\.map\(\(day\) => \(\{ \.\.\.day, \.\.\.defaults \}\)\)/);
  assert.match(editor, /onClick=\{applyDefaults\}>সব দিনে প্রয়োগ করুন/);
  assert.match(editor, /Defaults stay outside the dependency list/);
});

test('weekday exceptions allow one saved rule per weekday and apply all rules to payload days', () => {
  const editor = dining.slice(dining.indexOf('function MealRequestEditor'), dining.indexOf('function RequestHistory'));
  assert.match(weekday, /export const WEEKDAY_OPTIONS_BN/);
  assert.match(weekday, /export function applyWeekdayMealExceptions/);
  assert.match(weekday, /export function buildMealDaysForRange/);
  assert.match(editor, /weekdayExceptions\.length < 7/);
  assert.match(editor, /Number\(item\.weekday\) !== Number\(weekday\)/);
  assert.match(editor, /const payload = normalizeDays\(days\)/);
  assert.doesNotMatch(weekday, /supabase|\.rpc\(|\.from\(/);
});

test('adding a new weekday exception never resets Sunday when no rule is being edited', () => {
  const editor = dining.slice(dining.indexOf('function MealRequestEditor'), dining.indexOf('function RequestHistory'));
  assert.match(editor, /editingExceptionWeekday !== null[\s\S]*?editingExceptionWeekday !== undefined[\s\S]*?getMealWeekdayIndex\(day\.meal_date\) === Number\(editingExceptionWeekday\)/);
});

test('market row number is an overlay in the item-name field and is not saved as part of item_name', () => {
  const start = dining.indexOf('<div className="market-item-name-field">');
  const end = dining.indexOf('</div>', start);
  const markup = dining.slice(start, end);
  assert.match(markup, /market-item-index/);
  assert.match(markup, /<textarea/);
  assert.match(dining, /item_name: sanitizeMarketInput\(e\.target\.value\)/);
  assert.match(diningCss, /\.market-item-name-field \.market-input-item \{ min-height: 44px; padding-left: 42px;/);
});

test('request history scrolls to today only within the already-loaded request detail', () => {
  const history = dining.slice(dining.indexOf('function RequestHistory'), dining.indexOf('function MarketEntryForm'));
  assert.match(dining, /data-meal-date=\{String\(day\?\.meal_date/);
  assert.match(history, /const containsToday =/);
  assert.match(history, /requestAnimationFrame/);
  assert.match(history, /scrollIntoView/);
  const scrollEffect = history.slice(history.indexOf('const containsToday'), history.indexOf('if (loading)'));
  assert.doesNotMatch(scrollEffect, /fetch|\.rpc\(|\.from\(/);
});

test('market and meal detail layouts constrain nested cards to the available viewport width', () => {
  assert.match(diningCss, /\.mini-day-list \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 315px\), 1fr\)\)/);
  assert.match(diningCss, /\.meal-day-fields \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(diningCss, /@media \(max-width: 390px\)/);
  assert.match(diningCss, /max-width: 100%/);
});
