import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { ToastProvider } from './components/Toast';
import { AppRouteErrorBoundary } from './components/AppRouteErrorBoundary';
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
import './styles/app-route-recovery.css';
import './styles/run50-ui-finish.css';
import './styles/run52-ui-security-polish.css';
import './styles/run53_info_box_icon_cleanup.css';
import './styles/platform-admin-final-polish.css';
import './styles/app-finish-polish-v61.css';
import './styles/menu-experience-v1.css';
import './styles/dashboard-reimagined-original.css';
import './styles/dining-experience-v2.css';
import './styles/dining-finish-v13.css';
import './styles/history-finish-v13.css';
import './styles/profile-experience-v1.css';
import './styles/profile-finish-v13.css';
import './styles/menu-interior-experience-v14.css';
import './styles/finishing-polish-v15.css';
import './styles/run49-ui-refinement.css';
import './styles/run63_focused_fixes.css';
import './styles/run65-entry-windows.css';
import './styles/run66-theme-exception-fit.css';
import './styles/run67-menu-telegram-invite-finish.css';
import './styles/run69-language-system.css';
import './styles/run73-professional-refinement.css';
import './styles/run74-professional-polish.css';
import './styles/run76-readability-graphite.css';
import './styles/run77-balanced-dark-and-wrap.css';

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
    <AppRouteErrorBoundary onReturnToDashboard={() => window.location.assign('/app/dashboard')}>
      <ToastProvider>
        <AuthProvider>
          <AppWithInstallPrompt />
        </AuthProvider>
      </ToastProvider>
    </AppRouteErrorBoundary>
  </React.StrictMode>,
);

import './styles/run78-visual-correction.css';

import './styles/run79-cohesive-theme-and-layout.css';
import './styles/run80-focused-profile-auth.css';

import './styles/run81-theme-stability-and-compact-auth.css';

import './styles/run86-public-entry-compact.css';
import './styles/run87-public-entry-compact.css';
import './styles/run88-auth-brand-and-forgot-layout.css';
import './styles/run89-member-detail-and-final-meal-search.css';

import './styles/google-oauth-auth-ui.css';
import './styles/run94-focused-fixes.css';
import './styles/run98-professional-visual-polish.css';
import './styles/run99-auth-member-followup.css';
import './styles/run100-final-ui-refinement.css';
