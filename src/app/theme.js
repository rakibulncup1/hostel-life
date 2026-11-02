export const THEME_KEY = 'hostel-life-theme';

export const THEME_VALUES = Object.freeze(['system', 'light', 'dark', 'blue']);

export function getThemePreference() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return THEME_VALUES.includes(saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
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
