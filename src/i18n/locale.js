export function getUiLanguage() {
  try {
    const runtimeLanguage = window.HostelLifeI18n?.getLanguage?.();
    if (runtimeLanguage === 'en' || runtimeLanguage === 'bn') return runtimeLanguage;
  } catch { /* Continue with the early document language state. */ }

  try {
    return document.documentElement?.dataset?.language === 'en' ? 'en' : 'bn';
  } catch {
    return 'bn';
  }
}

export function getUiLocale() {
  return getUiLanguage() === 'en' ? 'en-US' : 'bn-BD';
}
