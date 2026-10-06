export const THEME_KEY = 'hostel-life-theme';

export function applyTheme(theme) {
  const root = document.documentElement;
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  root.dataset.theme = effective;
  root.dataset.themePreference = theme;
}
