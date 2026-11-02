export const THEME_KEY = 'hostel-life-theme';
export const THEME_DEFAULT_KEY = 'hostel-life-server-default-theme';

export const THEME_VALUES = Object.freeze(['system', 'light', 'dark', 'blue']);

function readThemeKey(key) {
  try {
    const value = window.localStorage.getItem(key);
    return THEME_VALUES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function getThemePreference() {
  // An explicit choice made by the user always wins over the platform default.
  return readThemeKey(THEME_KEY) || readThemeKey(THEME_DEFAULT_KEY) || 'dark';
}

export function applyTheme(theme = getThemePreference()) {
  const preference = THEME_VALUES.includes(theme) ? theme : 'dark';
  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const effective = preference === 'system'
    ? (media?.matches ? 'dark' : 'light')
    : preference;

  root.dataset.theme = effective;
  root.dataset.themePreference = preference;
  return effective;
}

export function applyPlatformDefaultTheme(theme) {
  if (!THEME_VALUES.includes(theme)) return getThemePreference();
  try {
    window.localStorage.setItem(THEME_DEFAULT_KEY, theme);
  } catch {
    // The active page can still use the server default if storage is blocked.
  }
  // Do not overwrite an explicit preference made by this user on this device.
  const explicitPreference = readThemeKey(THEME_KEY);
  const effective = explicitPreference || theme;
  applyTheme(effective);
  window.dispatchEvent(new Event('hostel-life-theme-change'));
  return effective;
}

export function saveThemePreference(theme) {
  const preference = THEME_VALUES.includes(theme) ? theme : 'dark';
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // The current page can still use the selected theme if storage is blocked.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event('hostel-life-theme-change'));
  return preference;
}
