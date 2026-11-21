import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const lockedVersion = lock.packages?.['node_modules/vite']?.version;
const match = typeof lockedVersion === 'string' ? lockedVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/) : null;

if (!match) {
  console.error('[security] Cannot determine the locked Vite version from package-lock.json.');
  process.exit(1);
}

const [, majorText, minorText, patchText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);

// Hostel Life currently tracks the Vite 6 line. GHSA-p4f5-76q4-ffq7 is
// fixed for that line in 6.4.6. Do not silently accept an older lockfile.
const fixedForCurrentMajor = major === 6 && (minor > 4 || (minor === 4 && patch >= 6));
if (!fixedForCurrentMajor) {
  console.error(`[security] Locked Vite ${lockedVersion} is below the required fixed Vite 6.4.6 baseline.`);
  console.error('[security] Run: npm install --save-dev vite@^6.4.6');
  process.exit(1);
}

console.log(`[security] Locked Vite ${lockedVersion} meets the Vite 6.4.6 security floor.`);
