import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

/** Accessible, dependency-free searchable option picker for admin directories. */
export function SearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'নির্বাচন করুন',
  searchPlaceholder = 'নাম লিখে খুঁজুন…',
  disabled = false,
  ariaLabel = 'তালিকা থেকে নির্বাচন',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();
  const normalizedOptions = Array.isArray(options) ? options : [];
  const selected = normalizedOptions.find((option) => String(option.value) === String(value));
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return normalizedOptions;
    return normalizedOptions.filter((option) => String(option.label ?? '').toLocaleLowerCase().includes(needle));
  }, [normalizedOptions, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const choose = (option) => {
    onChange?.(String(option.value));
    setQuery('');
    setOpen(false);
  };

  return (
    <div className={`sa-searchable-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="sa-searchable-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label || placeholder}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      {open && (
        <div className="sa-searchable-select-popover">
          <label className="sa-searchable-select-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              maxLength={100}
              placeholder={searchPlaceholder}
              aria-label={`${ariaLabel} খুঁজুন`}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="sa-searchable-select-options" id={listId} role="listbox" aria-label={ariaLabel}>
            {filtered.length ? filtered.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={String(option.value) === String(value)}
                className={String(option.value) === String(value) ? 'is-selected' : ''}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {String(option.value) === String(value) && <Icon name="check" size={15} />}
              </button>
            )) : <p className="sa-searchable-select-empty">কোনো মিল পাওয়া যায়নি।</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
