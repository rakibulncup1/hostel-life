import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { BottomNav } from '../components/BottomNav';
import { MenuDrawer } from '../components/MenuDrawer';
import { NotificationsPopover } from '../components/NotificationsPopover';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { OfflineState } from '../components/OfflineState';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useManagementContext } from '../hooks/useManagementContext';
import { fetchNotifications } from '../services/notificationService';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { fetchPlatformPublicSettings } from '../services/platformService';

export function keyToPath(key) {
  return `/app/${key}`;
}

export function pathToKey(pathname) {
  if (pathname === '/app/dining') return 'dining';
  if (pathname === '/app/history') return 'history';
  if (pathname === '/app/profile') return 'profile';
  return 'dashboard';
}

export function navigateTo(keyOrPath, replace = false) {
  const path = keyOrPath.startsWith('/') ? keyOrPath : keyToPath(keyOrPath);
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AppShell({ pathname, children, membership, profile, isManager, user }) {
  const isOnline = useOnlineStatus();
  const { canInstall, install } = useInstallPrompt();
  const { signOut } = useAuth();
  const { period, isPrimaryManager, isAssistantManager, isOperationalManager } = useManagementContext();
  const hasRunningPeriod = Boolean(period?.period_id || period?.id);
  const effectivePrimaryManager = hasRunningPeriod ? Boolean(isPrimaryManager) : Boolean(isManager);
  const effectiveOperationalManager = Boolean(effectivePrimaryManager || isAssistantManager || (!hasRunningPeriod && isManager));
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [platformSettings, setPlatformSettings] = useState(null);
  const unreadFetchInFlightRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('hostel-life-theme') || 'system');

  const active = pathToKey(pathname);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  useEffect(() => {
    let active = true;
    fetchPlatformPublicSettings().then((settings) => {
      if (active) setPlatformSettings(settings || null);
    }).catch(() => { /* Older database deployments have no platform settings endpoint yet. */ });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    const syncTheme = () => setTheme(localStorage.getItem('hostel-life-theme') || 'system');
    window.addEventListener('hostel-life-theme-change', syncTheme);
    return () => window.removeEventListener('hostel-life-theme-change', syncTheme);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = effective;
      document.documentElement.dataset.themePreference = theme;
    };
    apply();
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme]);

  const loadUnread = useCallback(async () => {
    if (!isOnline || document.visibilityState !== 'visible' || !document.hasFocus() || !navigator.onLine) {
      if (!isOnline) setUnreadCount(0);
      return null;
    }
    if (unreadFetchInFlightRef.current) return unreadFetchInFlightRef.current;
    const task = (async () => {
      try {
        const items = await fetchNotifications(50);
        setUnreadCount(items.filter((item) => !item.is_seen).length);
        return items;
      } catch {
        // The notification panel has an explicit refresh action; background refresh
        // errors are intentionally silent to avoid repetitive console noise.
        return null;
      }
    })();
    unreadFetchInFlightRef.current = task;
    try { return await task; }
    finally { if (unreadFetchInFlightRef.current === task) unreadFetchInFlightRef.current = null; }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline) loadUnread();
    else setUnreadCount(0);
  }, [isOnline, loadUnread]);

  // No five-minute notification polling. Refresh the badge only for visible,
  // active sessions when the notifications table changes or the app resumes.
  useRealtimeRefresh({
    enabled: isOnline,
    hostelId: membership?.hostel_id,
    tables: ['notifications'],
    onRefresh: () => loadUnread(),
  });

  const handleNavigate = (key) => {
    if (!isOnline && key !== 'dashboard') {
      toast.warning('এই অংশটি ব্যবহার করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setNotificationsOpen(false);
    navigateTo(key);
  };

  const handleMenuAction = async (key) => {
    if (key === 'logout') {
      try {
        await signOut();
        toast.success('সফলভাবে লগআউট হয়েছে।');
      } catch (error) {
        toast.error('লগআউট করা যায়নি। আবার চেষ্টা করুন।');
      }
      return;
    }

    if (!isOnline && !['developer', 'privacy-policy', 'terms', 'how-to-use'].includes(key)) {
      toast.warning('মেনুর এই কাজটি চালাতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }

    const routes = {
      'dining-operations': '/app/dining',
      members: '/app/menu/members',
      'khala-money-view': '/app/menu/khala-money-view',
      'top-eater': '/app/menu/top-eater',
      'top-shopper': '/app/menu/top-shopper',
      developer: '/app/menu/developer',
      'privacy-policy': '/app/menu/privacy-policy',
      terms: '/app/menu/terms',
      'how-to-use': '/app/menu/how-to-use',
      'send-notification': '/app/menu/send-notification',
      'reports': '/app/menu/reports',
      'meal-sheet': '/app/menu/meal-sheet',
      'archive-edit-access': '/app/menu/archive-edit-access',
      'current-month-close': '/app/menu/current-month-close',
      'new-month': '/app/menu/new-month',
      'change-manager': '/app/menu/change-manager',
      'assistant-managers': '/app/menu/assistant-managers',
      'hostel-settings': '/app/menu/hostel-settings',
      archive: '/app/menu/archive',
      'khala-money': '/app/menu/khala-money',
      'member-management': '/app/menu/member-management',
    };
    const path = routes[key];
    if (path) navigateTo(path);
    else toast.info('এই ফিচারটি পরবর্তী ধাপে সম্পূর্ণ হবে।');
  };

  const installApp = async () => {
    try {
      const accepted = await install();
      if (accepted) toast.success('Hostel Life ইনস্টল করার অনুরোধ গ্রহণ করা হয়েছে।');
    } catch (error) {
      console.error('Install prompt failed:', error);
      toast.error('অ্যাপ ইনস্টল করা যায়নি। আবার চেষ্টা করুন।');
    }
  };

  const changeTheme = (next) => {
    setTheme(next);
    localStorage.setItem('hostel-life-theme', next);
    window.dispatchEvent(new Event('hostel-life-theme-change'));
    toast.success('থিম পছন্দ সংরক্ষণ হয়েছে।');
  };

  return (
    <div className="app-shell">
      <Header
        hostelName={membership?.hostel_name || 'Hostel Life'}
        profileName={profile?.full_name || null}
        role={effectivePrimaryManager ? 'ম্যানেজার' : isAssistantManager ? 'সহকারী ম্যানেজার' : 'সদস্য'}
        periodLabel={period?.label || null}
        isOnline={isOnline}
        unreadCount={unreadCount}
        onMenu={() => setDrawerOpen(true)}
        onNotifications={() => {
          if (!isOnline) {
            toast.warning('নোটিফিকেশন দেখতে ইন্টারনেট সংযোগ প্রয়োজন।');
            return;
          }
          setNotificationsOpen((open) => !open);
        }}
      />

      {!isOnline && (
        <div className="offline-banner" role="status">
          <span className="offline-banner-dot" />
          <span>ইন্টারনেট সংযোগ নেই — সর্বশেষ সংরক্ষিত ড্যাশবোর্ড, মিল ও লেট রিকোয়েস্ট দেখা যাবে।</span>
        </div>
      )}
      {platformSettings?.announcement_enabled && (platformSettings.announcement_title || platformSettings.announcement_body) && (
        <div className="global-announcement" role="status" aria-live="polite">
          <span className="global-announcement-icon"><Icon name="info" size={18} /></span>
          <div><strong>{platformSettings.announcement_title || 'Hostel Life ঘোষণা'}</strong>{platformSettings.announcement_body && <p>{platformSettings.announcement_body}</p>}</div>
        </div>
      )}

      {notificationsOpen && (
        <NotificationsPopover isManager={isManager} onUnreadChange={setUnreadCount} onClose={closeNotifications} />
      )}

      <main className="app-main">
        {!isOnline && active !== 'dashboard' && !pathname.startsWith('/app/menu/privacy-policy') && !pathname.startsWith('/app/menu/terms') && !pathname.startsWith('/app/menu/how-to-use') && !pathname.startsWith('/app/menu/developer') ? <OfflineState /> : children}
        <footer className="app-copyright-footer">
          <span>Copyright © {new Date().getFullYear()} Hostel-Life. All rights reserved.</span>
          <span>Designed &amp; Developed by <a href="https://rakibul-sec1.vercel.app/" target="_blank" rel="noreferrer">Rakibul Islam Samrat</a></span>
        </footer>
      </main>

      <BottomNav active={active} onNavigate={handleNavigate} />

      <MenuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isManager={effectivePrimaryManager}
        isPrimaryManager={effectivePrimaryManager}
        isOperationalManager={effectiveOperationalManager}
        canInstall={canInstall}
        onInstall={installApp}
        onAction={handleMenuAction}
        profile={profile}
        user={user}
        hostelName={membership?.hostel_name}
        role={effectivePrimaryManager ? 'ম্যানেজার' : isAssistantManager ? 'সহকারী ম্যানেজার' : 'সদস্য'}
      />

      <div className="desktop-theme-bar" aria-label="থিম">
        <button className={theme === 'light' ? 'active' : ''} onClick={() => changeTheme('light')}>লাইট</button>
        <button className={theme === 'system' ? 'active' : ''} onClick={() => changeTheme('system')}>সিস্টেম</button>
        <button className={theme === 'dark' ? 'active' : ''} onClick={() => changeTheme('dark')}>ডার্ক</button>
      </div>
    </div>
  );
}
