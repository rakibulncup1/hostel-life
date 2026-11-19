export function getUiLocale() {
  try { return window.HostelLifeI18n?.getLanguage?.() === 'en' ? 'en-US' : 'bn-BD'; }
  catch { return 'bn-BD'; }
}

export function getUiLanguage() {
  return getUiLocale() === 'en-US' ? 'en' : 'bn';
}
