(() => {
  'use strict';
  const THEME_KEY = 'hostel-life-theme';
  const DEFAULT_KEY = 'hostel-life-server-default-theme';
  const ROLLOUT_KEY = 'hostel-life-theme-rollout-v1';
  const ROLLOUT_VERSION = 'light-default-2026-11-v1';
  const VALUES = new Set(['system', 'light', 'dark', 'blue']);
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read(key) {
    try {
      const value = localStorage.getItem(key);
      return VALUES.has(value) ? value : null;
    } catch { return null; }
  }
  function migrateOnce() {
    try {
      if (localStorage.getItem(ROLLOUT_KEY) === ROLLOUT_VERSION) return;
      localStorage.setItem(THEME_KEY, 'light');
      localStorage.setItem(DEFAULT_KEY, 'light');
      localStorage.setItem(ROLLOUT_KEY, ROLLOUT_VERSION);
    } catch { /* Public pages remain usable when storage is unavailable. */ }
  }
  function preference() {
    migrateOnce();
    return read(THEME_KEY) || read(DEFAULT_KEY) || 'light';
  }
  function apply(next = preference()) {
    const selected = VALUES.has(next) ? next : 'light';
    const effective = selected === 'system' ? (media?.matches ? 'dark' : 'light') : selected;
    root.dataset.theme = effective;
    root.dataset.themePreference = selected;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective === 'dark' ? '#22292f' : effective === 'blue' ? '#edf5fc' : '#f4f8f5';
    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
      const active = button.getAttribute('data-theme-choice') === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  function save(next) {
    const selected = VALUES.has(next) ? next : 'light';
    try {
      localStorage.setItem(THEME_KEY, selected);
      localStorage.setItem(DEFAULT_KEY, 'light');
      localStorage.setItem(ROLLOUT_KEY, ROLLOUT_VERSION);
    } catch { /* The selected theme is still applied for this page view. */ }
    apply(selected);
    window.dispatchEvent(new CustomEvent('hostel-life-theme-change', { detail: { theme: selected } }));
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    event.preventDefault();
    save(button.getAttribute('data-theme-choice'));
    button.closest('details')?.removeAttribute('open');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === DEFAULT_KEY || event.key === null) apply();
  });
  media?.addEventListener?.('change', () => { if (preference() === 'system') apply('system'); });
  apply();
})();
