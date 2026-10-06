import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { BottomNav } from '../components/BottomNav';
import { MenuDrawer } from '../components/MenuDrawer';
import { NotificationsPopover } from '../components/NotificationsPopover';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { OfflineState } from '../components/OfflineState';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { clearMealBundle } from '../services/mealOfflineStore';
import { fetchNotifications } from '../services/notificationService';

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
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('hostel-life-theme') || 'system');

  const active = pathToKey(pathname);

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

  useEffect(() => {
    let cancelled = false;
    let timer;
    const loadUnread = async () => {
      if (!isOnline) {
        setUnreadCount(0);
        return;
      }
      try {
        const items = await fetchNotifications(50);
        if (!cancelled) setUnreadCount(items.filter((item) => !item.is_seen).length);
      } catch (error) {
        if (!cancelled) console.warn('Notification badge could not load:', error);
      }
    };
    loadUnread();
    timer = window.setInterval(loadUnread, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOnline]);

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
        await clearMealBundle().catch((clearError) => console.warn('Offline meal cache could not be cleared:', clearError));
        await signOut();
        toast.success('সফলভাবে লগআউট হয়েছে।');
      } catch (error) {
        toast.error('লগআউট করা যায়নি। আবার চেষ্টা করুন।');
      }
      return;
    }

    if (!isOnline && key !== 'developer') {
      toast.warning('মেনুর এই কাজটি চালাতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }

    const routes = {
      members: '/app/menu/members',
      'top-eater': '/app/menu/top-eater',
      'top-shopper': '/app/menu/top-shopper',
      developer: '/app/menu/developer',
      'send-notification': '/app/menu/send-notification',
      'reports': '/app/menu/reports',
      'meal-sheet': '/app/menu/meal-sheet',
      'new-month': '/app/menu/new-month',
      'change-manager': '/app/menu/change-manager',
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
        role={isManager ? 'ম্যানেজার' : 'সদস্য'}
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
          <span>ইন্টারনেট সংযোগ নেই — শুধু ড্যাশবোর্ডের মিল কার্ড offline-এ রাখা হবে।</span>
        </div>
      )}

      {notificationsOpen && (
        <NotificationsPopover isManager={isManager} onUnreadChange={setUnreadCount} />
      )}

      <main className="app-main">
        {!isOnline && active !== 'dashboard' ? <OfflineState /> : children}
      </main>

      <BottomNav active={active} onNavigate={handleNavigate} />

      <MenuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isManager={isManager}
        canInstall={canInstall}
        onInstall={installApp}
        onAction={handleMenuAction}
        profile={profile}
        user={user}
        hostelName={membership?.hostel_name}
        role={isManager ? 'ম্যানেজার' : 'সদস্য'}
      />

      <div className="desktop-theme-bar" aria-label="থিম">
        <button className={theme === 'light' ? 'active' : ''} onClick={() => changeTheme('light')}>লাইট</button>
        <button className={theme === 'system' ? 'active' : ''} onClick={() => changeTheme('system')}>সিস্টেম</button>
        <button className={theme === 'dark' ? 'active' : ''} onClick={() => changeTheme('dark')}>ডার্ক</button>
      </div>
    </div>
  );
}
