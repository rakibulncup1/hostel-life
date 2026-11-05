import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export function SystemNoticeDialog({
  kicker = 'HOSTEL LIFE',
  icon = 'bell',
  title,
  description = '',
  meta = '',
  children,
  actions,
  onClose,
  imageUrl = '',
  imageOnly = false,
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
    };
  }, []);

  return (
    <div className={`system-notice-backdrop${imageOnly ? ' system-notice-image-backdrop' : ''}`} role="presentation">
      <section ref={dialogRef} className={imageOnly ? 'system-notice-image-dialog' : 'system-notice-dialog'} role="dialog" aria-modal="true" aria-label={imageOnly ? 'Hostel Life বিজ্ঞপ্তির ব্যানার' : undefined} aria-labelledby={imageOnly ? undefined : 'system-notice-title'} tabIndex={-1}>
        <button ref={closeButtonRef} type="button" className="system-notice-close" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={18}/></button>
        {imageOnly ? <img src={imageUrl} alt="Hostel Life বিজ্ঞপ্তি" loading="eager" /> : <>
          <span className="system-notice-icon"><Icon name={icon} size={21}/></span>
          {kicker && <span className="system-notice-kicker">{kicker}</span>}
          <h2 id="system-notice-title">{title}</h2>
          {description && <p className="system-notice-description">{description}</p>}
          {children}
          {meta && <small className="system-notice-meta">{meta}</small>}
          {actions && <div className="system-notice-actions">{actions}</div>}
        </>}
      </section>
    </div>
  );
}
