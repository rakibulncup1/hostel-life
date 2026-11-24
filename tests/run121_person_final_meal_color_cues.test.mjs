import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles/dining-experience-v2.css', import.meta.url), 'utf8');
const run121 = css.slice(css.indexOf('Run121: subtle meal-specific color cues'));

test('person-based final meal cards have separate breakfast, lunch and dinner colors', () => {
  assert.match(run121, /member-final-day-meals\s*>\s*div:nth-child\(1\) \.meal-stepper-row[\s\S]*?background:\s*#f0f8f3/);
  assert.match(run121, /member-final-day-meals\s*>\s*div:nth-child\(2\) \.meal-stepper-row[\s\S]*?background:\s*#f0f6fc/);
  assert.match(run121, /member-final-day-meals\s*>\s*div:nth-child\(3\) \.meal-stepper-row[\s\S]*?background:\s*#f5f2fb/);
});

test('meal-specific labels use matching colors in light and dark themes', () => {
  for (const token of ['#397a5b', '#426f9d', '#72639d', '#a7d3ba', '#aec7e3', '#c1b5e2']) {
    assert.ok(run121.includes(token), `Missing meal label color ${token}`);
  }
  assert.match(run121, /data-theme="dark"[\s\S]*?member-final-day-meals/);
});

test('color-only patch does not override layout, sizing or stepper geometry', () => {
  assert.doesNotMatch(run121, /grid-template-columns|grid-template-rows|display\s*:|width\s*:|height\s*:|padding\s*:|gap\s*:/);
  assert.match(run121, /member-final-day-meals/);
});
