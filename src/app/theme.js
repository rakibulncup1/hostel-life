export const THEME_KEY = 'hostel-life-theme';
export const THEME_DEFAULT_KEY = 'hostel-life-server-default-theme';
export const THEME_ROLLOUT_KEY = 'hostel-life-theme-rollout-v1';
export const THEME_ROLLOUT_VERSION = 'light-default-2026-11-v1';

export const THEME_VALUES = Object.freeze(['system', 'light', 'dark', 'blue']);

function readThemeKey(key) {
  try {
    const value = window.localStorage.getItem(key);
    return THEME_VALUES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * One-time release migration. Existing browser preferences are changed to Light
 * once; after the marker is written, the user's later personal selection wins.
 * This is device/browser-local because the app's theme preference is local today.
 */
export function migrateThemePreferenceToLightOnce() {
  try {
    if (window.localStorage.getItem(THEME_ROLLOUT_KEY) === THEME_ROLLOUT_VERSION) return false;
    window.localStorage.setItem(THEME_KEY, 'light');
    window.localStorage.setItem(THEME_DEFAULT_KEY, 'light');
    window.localStorage.setItem(THEME_ROLLOUT_KEY, THEME_ROLLOUT_VERSION);
    return true;
  } catch {
    // Storage may be unavailable. Callers still fall back to Light safely.
    return false;
  }
}

export function getThemePreference() {
  migrateThemePreferenceToLightOnce();
  return readThemeKey(THEME_KEY) || readThemeKey(THEME_DEFAULT_KEY) || 'light';
}

export function applyTheme(theme = getThemePreference()) {
  const preference = THEME_VALUES.includes(theme) ? theme : 'light';
  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const effective = preference === 'system'
    ? (media?.matches ? 'dark' : 'light')
    : preference;

  root.dataset.theme = effective;
  root.dataset.themePreference = preference;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    const browserThemeColor = effective === 'dark' ? '#09100d' : effective === 'blue' ? '#edf5fc' : '#f4f8f5';
    themeMeta.setAttribute('content', browserThemeColor);
  }
  return effective;
}

// Kept for compatibility with older imports, but the platform no longer controls
// members' appearance. Do not overwrite an explicit preference after rollout.
// The server default is stored as Light only.
export function applyPlatformDefaultTheme() {
  try {
    window.localStorage.setItem(THEME_DEFAULT_KEY, 'light');
  } catch {
    // Local preference still safely defaults to Light.
  }
  return applyTheme(getThemePreference());
}

export function saveThemePreference(theme) {
  const preference = THEME_VALUES.includes(theme) ? theme : 'light';
  try {
    window.localStorage.setItem(THEME_KEY, preference);
    window.localStorage.setItem(THEME_DEFAULT_KEY, 'light');
    window.localStorage.setItem(THEME_ROLLOUT_KEY, THEME_ROLLOUT_VERSION);
  } catch {
    // The current page can still use the selected theme if storage is blocked.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event('hostel-life-theme-change'));
  return preference;
}
