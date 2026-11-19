import { useEffect, useState } from 'react';
import { Icon } from './Icon';

function readLanguage() {
  try {
    const current = window.HostelLifeI18n?.getLanguage?.() || localStorage.getItem('hostel-life-language-v1');
    return current === 'en' ? 'en' : 'bn';
  } catch { return 'bn'; }
}

export function LanguageSwitcher({
  compact = false,
  className = '',
  shortLabel = false,
  variant = 'toggle',
  withLabel = false,
}) {
  const [language, setLanguage] = useState(readLanguage);

  useEffect(() => {
    const unsubscribe = window.HostelLifeI18n?.subscribe?.((next) => setLanguage(next));
    return () => unsubscribe?.();
  }, []);

  const chooseLanguage = (next) => {
    const actual = window.HostelLifeI18n?.setLanguage?.(next);
    setLanguage(actual || next);
  };

  if (variant === 'segmented') {
    return (
      <div
        className={`language-switcher-group ${compact ? 'language-switcher-group-compact' : ''} ${className}`.trim()}
        role="group"
        aria-label={language === 'bn' ? 'ভাষা নির্বাচন' : 'Language selection'}
      >
        {withLabel && <span className="language-switcher-label">ভাষা</span>}
        <div className="language-switcher-segmented">
          <button
            type="button"
            className={`language-switcher-option ${language === 'bn' ? 'is-active' : ''}`}
            onClick={() => chooseLanguage('bn')}
            aria-pressed={language === 'bn'}
            data-no-translate
          >
            বাংলা
          </button>
          <button
            type="button"
            className={`language-switcher-option ${language === 'en' ? 'is-active' : ''}`}
            onClick={() => chooseLanguage('en')}
            aria-pressed={language === 'en'}
            data-no-translate
          >
            English
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`language-switcher ${compact ? 'language-switcher-compact' : ''} ${className}`.trim()}
      onClick={() => chooseLanguage(language === 'bn' ? 'en' : 'bn')}
      aria-label={language === 'bn' ? 'Switch language to English' : 'ভাষা বাংলায় পরিবর্তন করুন'}
      aria-pressed={language === 'en'}
      title={language === 'bn' ? 'Switch to English' : 'বাংলায় পরিবর্তন করুন'}
    >
      <Icon name="globe" size={compact ? 14 : 16} />
      <span>{language === 'bn' ? (shortLabel ? 'EN' : 'English') : 'বাংলা'}</span>
    </button>
  );
}
