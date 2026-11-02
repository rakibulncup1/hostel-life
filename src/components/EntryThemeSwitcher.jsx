import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { applyTheme, getThemePreference, saveThemePreference } from '../app/theme';

const THEME_OPTIONS = [
  { value: 'system', label: 'সিস্টেম', icon: 'monitor' },
  { value: 'light', label: 'লাইট', icon: 'sun' },
  { value: 'dark', label: 'ডার্ক', icon: 'moon' },
  { value: 'blue', label: 'আকাশি নীল', icon: 'droplet' },
];

export function EntryThemeSwitcher() {
  const [theme, setTheme] = useState(getThemePreference);
  const detailsRef = useRef(null);
  const activeTheme = THEME_OPTIONS.find((option) => option.value === theme) || THEME_OPTIONS[2];

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncPreference = () => setTheme(getThemePreference());
    window.addEventListener('hostel-life-theme-change', syncPreference);
    window.addEventListener('storage', syncPreference);
    return () => {
      window.removeEventListener('hostel-life-theme-change', syncPreference);
      window.removeEventListener('storage', syncPreference);
    };
  }, []);

  useEffect(() => {
    if (theme !== 'system') return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => applyTheme('system');
    media?.addEventListener?.('change', updateSystemTheme);
    return () => media?.removeEventListener?.('change', updateSystemTheme);
  }, [theme]);

  const chooseTheme = (nextTheme) => {
    setTheme(nextTheme);
    saveThemePreference(nextTheme);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details className="entry-theme-switcher" ref={detailsRef}>
      <summary aria-label="রঙের থিম পরিবর্তন" title="থিম পরিবর্তন">
        <Icon name={activeTheme.icon} size={16} />
        <span>থিম</span>
        <strong>{activeTheme.label}</strong>
        <Icon name="chevron-down" size={14} className="entry-theme-chevron" />
      </summary>
      <div className="entry-theme-menu" role="group" aria-label="থিম নির্বাচন">
        <span className="entry-theme-menu-title">আপনার পছন্দ</span>
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`entry-theme-option ${theme === option.value ? 'selected' : ''}`}
            onClick={() => chooseTheme(option.value)}
            aria-pressed={theme === option.value}
          >
            <Icon name={option.icon} size={16} />
            <span>{option.label}</span>
            {theme === option.value && <Icon name="check" size={15} />}
          </button>
        ))}
      </div>
    </details>
  );
}
