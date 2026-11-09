import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, type = 'success', options = {}) => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const duration = Math.min(3600, Math.max(1600, Number(options.duration) || (type === 'error' ? 2800 : 2300)));
    const toast = { id, message, type, duration };
    setToasts((current) => [...current, toast].slice(-3));
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((current) => current.filter((item) => item.id !== id));
    }, duration);
    timers.current.set(id, timer);
    return id;
  }, []);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const api = useMemo(() => ({
    success: (message, options) => push(message, 'success', options),
    error: (message, options) => push(message, 'error', options),
    info: (message, options) => push(message, 'info', options),
    warning: (message, options) => push(message, 'warning', options),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const isError = toast.type === 'error' || toast.type === 'warning';
          return (
            <div key={toast.id} className={`toast ${isError ? 'toast-error' : 'toast-success'}`} role={isError ? 'alert' : 'status'}>
              <span className="toast-icon"><Icon name={isError ? 'alert-circle' : 'check-circle-2'} size={18} /></span>
              <span className="toast-message">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
