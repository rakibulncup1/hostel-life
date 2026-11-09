import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './contexts/AuthContext';
import { InstallPromptProvider } from './contexts/InstallPromptContext';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import './styles/global.css';
import './styles/ui-refresh.css';
import './styles/public-entry.css';
import './styles/platform-visual-refresh.css';
import './styles/app-download.css';
import './styles/invitation-experience.css';
import './styles/notification-center.css';
import './styles/super-admin-experience.css';
import './styles/experience-polish-v6.css';
import './styles/production-flow-finishing.css';
import './styles/ui-polish-v41.css';
import './styles/ui-polish-v42.css';
import './styles/ui-polish-v43.css';
import './styles/dining-auth-polish-v44.css';
import './styles/ui-polish-v45.css';
import './styles/auth-brand-center-v47.css';
import './styles/auth-brand-refinement-v48.css';

function AppWithInstallPrompt() {
  const installPrompt = useInstallPrompt();
  return <InstallPromptProvider value={installPrompt}><App /></InstallPromptProvider>;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AppWithInstallPrompt />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
);
