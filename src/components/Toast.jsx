import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Icon } from './Icon';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, type = 'success', options = {}) => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const toast = { id, message, type, duration: options.duration ?? 3600 };
    setToasts((current) => [...current, toast].slice(-4));
    window.setTimeout(() => remove(id), toast.duration);
    return id;
  }, [remove]);

  const api = useMemo(() => ({ success: (message, options) => push(message, 'success', options), error: (message, options) => push(message, 'error', options), info: (message, options) => push(message, 'info', options), warning: (message, options) => push(message, 'warning', options) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`} role="status">
            <span className="toast-icon">
              <Icon name={toast.type === 'success' ? 'check' : toast.type === 'warning' ? 'warning' : toast.type === 'error' ? 'x' : 'wifi'} size={18} />
            </span>
            <span className="toast-message">{toast.message}</span>
            <button className="icon-button ghost" onClick={() => remove(toast.id)} aria-label="বন্ধ করুন">
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
