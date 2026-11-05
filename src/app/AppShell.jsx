import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { BottomNav } from '../components/BottomNav';
import { MenuDrawer } from '../components/MenuDrawer';
import { NotificationsPopover } from '../components/NotificationsPopover';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInstallPromptContext } from '../contexts/InstallPromptContext';
import { getThemePreference, saveThemePreference } from './theme';
import { OfflineState } from '../components/OfflineState';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useManagementContext } from '../hooks/useManagementContext';
import { fetchNotifications, fetchPinnedManagerAnnouncement, markNotificationSeen } from '../services/notificationService';
import { APP_RELEASE } from './release';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { fetchPlatformPublicSettings, PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT } from '../services/platformService';
import { getMyTelegramNotificationStatus } from '../services/telegramService';
import { TelegramLogo } from '../components/TelegramLogo';
import { PlatformCommunicationOverlays } from '../components/PlatformCommunicationOverlays';
import { SystemNoticeDialog } from '../components/SystemNoticeDialog';

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
  const { canInstall, installed, install } = useInstallPromptContext();
  const { signOut } = useAuth();
  const { context: managementContext, period, isPrimaryManager, isAssistantManager, isOperationalManager, refresh: refreshManagementContext } = useManagementContext();
  const hasRunningPeriod = Boolean(period?.period_id || period?.id);
  const effectivePrimaryManager = hasRunningPeriod ? Boolean(isPrimaryManager) : Boolean(isManager);
  const effectiveOperationalManager = Boolean(effectivePrimaryManager || isAssistantManager || (!hasRunningPeriod && isManager));
  const toast = useToast();

  // Keep the header's running-month label and manager guards synced when another
  // browser/device starts or closes a period or changes manager assignments.
  useRealtimeRefresh({
    enabled: isOnline,
    hostelId: membership?.hostel_id,
    tables: ['monthly_periods', 'hostel_memberships'],
    immediateTables: ['monthly_periods', 'hostel_memberships'],
    onRefresh: () => refreshManagementContext({ force: true }),
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pinnedManagerNotice, setPinnedManagerNotice] = useState(null);
  const [platformSettings, setPlatformSettings] = useState(null);
  const [platformSettingsReadyForUser, setPlatformSettingsReadyForUser] = useState('');
  const unreadFetchInFlightRef = useRef(null);
  const platformSettingsRefreshAtRef = useRef(0);
  const [theme, setTheme] = useState(() => getThemePreference());
  const [installNudgeOpen, setInstallNudgeOpen] = useState(false);
  const [releaseNoticeOpen, setReleaseNoticeOpen] = useState(false);
  const [telegramNudgeOpen, setTelegramNudgeOpen] = useState(false);
  const [priorityMessages, setPriorityMessages] = useState([]);
  const priorityMessageIdsRef = useRef(new Set());
  const telegramNudgeCheckedUserRef = useRef('');

  const active = pathToKey(pathname);
  const systemAnnouncementVisible = Boolean(platformSettings?.announcement_enabled
    && (String(platformSettings.announcement_title || '').trim() || String(platformSettings.announcement_body || '').trim()));
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  useEffect(() => {
    let active = true;
    const loadSettings = (force = false) => fetchPlatformPublicSettings({ force }).then((settings) => {
      if (active) {
        setPlatformSettings(settings || null);
        setPlatformSettingsReadyForUser(user?.id || '');
      }
    }).catch(() => {
      // Release prompting may proceed with a compact notice if the public settings
      // endpoint is unavailable; never wait indefinitely or show stale feature text.
      if (active) { setPlatformSettings(null); setPlatformSettingsReadyForUser(user?.id || ''); }
    });
    loadSettings(true);
    const refreshLocal = () => { loadSettings(true); };
    const refreshWhenVisible = () => {
      const now = Date.now();
      // Refresh only when a user returns to the app; no background polling or Realtime channel.
      if (now - platformSettingsRefreshAtRef.current < 30_000) return;
      platformSettingsRefreshAtRef.current = now;
      loadSettings(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenVisible();
    };
    window.addEventListener(PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT, refreshLocal);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener(PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT, refreshLocal);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user?.id]);

  useEffect(() => {
    const syncTheme = () => setTheme(getThemePreference());
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
    if (!user?.id || !APP_RELEASE?.id || platformSettingsReadyForUser !== user.id) return;
    const deviceKey = 'hostel-life-device-last-seen-release-v2';
    const legacyUserKey = `hostel-life-last-seen-release-v1:${user.id}`;
    let lastDeviceRelease = '';
    let legacyRelease = '';
    try {
      lastDeviceRelease = localStorage.getItem(deviceKey) || '';
      legacyRelease = localStorage.getItem(legacyUserKey) || '';
    } catch {
      try { lastDeviceRelease = sessionStorage.getItem(deviceKey) || ''; legacyRelease = sessionStorage.getItem(legacyUserKey) || ''; }
      catch { /* Without storage, avoid repeatedly interrupting a new device. */ }
    }

    // Migrate the old account-scoped marker when present. If neither marker exists,
    // this is a first visit on this browser/device: record the current build silently.
    if (!lastDeviceRelease && legacyRelease) lastDeviceRelease = legacyRelease;
    if (!lastDeviceRelease) {
      try { localStorage.setItem(deviceKey, APP_RELEASE.id); }
      catch { try { sessionStorage.setItem(deviceKey, APP_RELEASE.id); } catch { /* best effort */ } }
      return;
    }
    if (lastDeviceRelease !== APP_RELEASE.id) setReleaseNoticeOpen(true);
  }, [user?.id, platformSettingsReadyForUser]);

  const markReleaseSeen = () => {
    const key = 'hostel-life-device-last-seen-release-v2';
    try { localStorage.setItem(key, APP_RELEASE.id); }
    catch { try { sessionStorage.setItem(key, APP_RELEASE.id); } catch { /* no persistent storage available */ } }
    setReleaseNoticeOpen(false);
  };

  const dismissReleaseNotice = markReleaseSeen;

  const refreshForRelease = () => {
    try { localStorage.setItem('hostel-life-device-last-seen-release-v2', APP_RELEASE.id); }
    catch { try { sessionStorage.setItem('hostel-life-device-last-seen-release-v2', APP_RELEASE.id); } catch { /* ignore */ } }
    window.location.reload();
  };

  useEffect(() => {
    if (installed || !canInstall || releaseNoticeOpen || priorityMessages.length > 0) {
      setInstallNudgeOpen(false);
      return undefined;
    }
    let seen = false;
    try { seen = localStorage.getItem('hostel-life-install-nudge-v1') === '1'; } catch { /* Show once per app session when storage is unavailable. */ }
    if (seen) return undefined;
    const timer = window.setTimeout(() => setInstallNudgeOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [canInstall, installed, user?.id, releaseNoticeOpen, priorityMessages.length]);

  useEffect(() => {
    if (!user?.id || !membership?.hostel_id || platformSettings?.telegram_enabled !== true
      || releaseNoticeOpen || installNudgeOpen || priorityMessages.length > 0) {
      setTelegramNudgeOpen(false);
      return undefined;
    }
    if (telegramNudgeCheckedUserRef.current === user.id) return undefined;
    const dismissedKey = `hostel-life-telegram-nudge-v1:${user.id}`;
    let dismissed = false;
    try { dismissed = localStorage.getItem(dismissedKey) === '1'; }
    catch { try { dismissed = sessionStorage.getItem(dismissedKey) === '1'; } catch { /* best effort */ } }
    if (dismissed) {
      telegramNudgeCheckedUserRef.current = user.id;
      return undefined;
    }

    // Server status is authoritative. On a status/RPC failure, fail closed and do
    // not interrupt a user who may already be linked on another device.
    telegramNudgeCheckedUserRef.current = user.id;
    let cancelled = false;
    let timer = null;
    getMyTelegramNotificationStatus()
      .then((status) => {
        if (cancelled || status?.telegram_enabled !== true || status?.connected !== false) return;
        timer = window.setTimeout(() => { if (!cancelled) setTelegramNudgeOpen(true); }, 900);
      })
      .catch(() => { /* Keep the app quiet when the account connection state is unknown. */ });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [user?.id, membership?.hostel_id, platformSettings?.telegram_enabled, releaseNoticeOpen, installNudgeOpen, priorityMessages.length]);

  const dismissTelegramNudge = () => {
    const key = `hostel-life-telegram-nudge-v1:${user?.id || 'session'}`;
    try { localStorage.setItem(key, '1'); }
    catch { try { sessionStorage.setItem(key, '1'); } catch { /* Dismiss for this render only. */ } }
    setTelegramNudgeOpen(false);
  };

  const openTelegramSettings = () => {
    dismissTelegramNudge();
    navigateTo('/app/menu/telegram');
  };

  const loadUnread = useCallback(async () => {
    if (!isOnline || document.visibilityState !== 'visible' || !document.hasFocus() || !navigator.onLine) {
      if (!isOnline) setUnreadCount(0);
      return null;
    }
    if (unreadFetchInFlightRef.current) return unreadFetchInFlightRef.current;
    const task = (async () => {
      const [inboxResult, pinnedResult] = await Promise.allSettled([
        fetchNotifications(50),
        fetchPinnedManagerAnnouncement(),
      ]);
      if (inboxResult.status === 'fulfilled') {
        const inbox = inboxResult.value;
        setUnreadCount(inbox.filter((item) => !item.is_seen).length);
        const priority = inbox
          .filter((item) => !item.is_seen && ['platform_message', 'system_notice'].includes(item.notification_kind))
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        if (priority.length) {
          setPriorityMessages((current) => {
            const next = [...current];
            for (const item of priority) {
              const id = item.notification_id || item.id;
              if (id && !priorityMessageIdsRef.current.has(id)) {
                priorityMessageIdsRef.current.add(id);
                next.push(item);
              }
            }
            return next;
          });
        }
      }
      if (pinnedResult.status === 'fulfilled') {
        setPinnedManagerNotice(pinnedResult.value || null);
      }
      // Both background reads are silent on older deployments until Run21 is applied.
      return inboxResult.status === 'fulfilled' ? inboxResult.value : null;
    })();
    unreadFetchInFlightRef.current = task;
    try { return await task; }
    finally { if (unreadFetchInFlightRef.current === task) unreadFetchInFlightRef.current = null; }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline) loadUnread();
    else setUnreadCount(0);
  }, [isOnline, loadUnread]);

  const dismissPriorityMessage = async () => {
    const current = priorityMessages[0];
    if (!current) return;
    const id = current.notification_id || current.id;
    setPriorityMessages((rows) => rows.slice(1));
    if (!current.is_seen && id && isOnline) {
      try {
        await markNotificationSeen(id);
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch { /* The item remains in the inbox; do not block dismissing the modal. */ }
    }
  };

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
        const result = await signOut();
        if (result?.remoteRevocationConfirmed === false && result?.activityRecorded === false) {
          toast.info('এই ডিভাইস থেকে লগআউট সম্পন্ন হয়েছে। তবে Logout History ও সার্ভার সেশন বাতিলের নিশ্চিতকরণ পাওয়া যায়নি।');
        } else if (result?.remoteRevocationConfirmed === false) {
          toast.info('এই ডিভাইস থেকে লগআউট সম্পন্ন হয়েছে। তবে সার্ভার সেশন বাতিলের নিশ্চিতকরণ পাওয়া যায়নি।');
        } else if (result?.activityRecorded === false) {
          toast.info('এই ডিভাইস থেকে লগআউট হয়েছে, তবে Logout History সার্ভারে রেকর্ড করা যায়নি।');
        } else {
          toast.success('এই ডিভাইস থেকে সফলভাবে লগআউট হয়েছে। অন্য ডিভাইসের সেশন চালু থাকবে।');
        }
      } catch (error) {
        toast.error('লগআউট করা যায়নি। আবার চেষ্টা করুন।');
      }
      return;
    }

    if (!isOnline && !['developer', 'privacy-policy', 'terms', 'how-to-use', 'app-download'].includes(key)) {
      toast.warning('মেনুর এই কাজটি চালাতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }

    const routes = {
      'dining-operations': '/app/dining',
      members: '/app/menu/members',
      'khala-money-view': '/app/menu/khala-money-view',
      'top-eater': '/app/menu/top-eater',
      'top-shopper': '/app/menu/top-shopper',
      'top-depositor': '/app/menu/top-depositor',
      developer: '/app/menu/developer',
      'privacy-policy': '/app/menu/privacy-policy',
      terms: '/app/menu/terms',
      'how-to-use': '/app/menu/how-to-use',
      'app-download': '/app/menu/app-download',
      telegram: '/app/menu/telegram',
      'send-notification': '/app/menu/send-notification',
      'reports': '/app/menu/reports',
      'meal-sheet': '/app/menu/meal-sheet',
      'archive-edit-access': '/app/menu/archive',
      'current-month-close': '/app/menu/current-month-close',
      'new-month': '/app/menu/new-month',
      'change-manager': '/app/menu/change-manager',
      'assistant-managers': '/app/menu/assistant-managers',
      'hostel-settings': '/app/menu/hostel-settings',
      archive: '/app/menu/archive',
      'khala-money': '/app/menu/khala-money',
      'member-management': '/app/menu/member-management',
      'join-requests': '/app/menu/join-requests',
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
    saveThemePreference(next);
    toast.success('থিম পছন্দ সংরক্ষণ হয়েছে।');
  };

  const dismissInstallNudge = () => {
    try { localStorage.setItem('hostel-life-install-nudge-v1', '1'); } catch { /* session-level dismissal still applies */ }
    setInstallNudgeOpen(false);
  };

  const handleNudgeInstall = async () => {
    if (!canInstall) return;
    await installApp();
    dismissInstallNudge();
  };

  return (
    <div className="app-shell">
      <Header
        hostelName={membership?.hostel_name || 'Hostel Life'}
        profileName={profile?.full_name || null}
        role={effectivePrimaryManager ? 'ম্যানেজার' : isAssistantManager ? 'সহকারী ম্যানেজার' : 'সদস্য'}
        periodLabel={period?.label || (managementContext?.has_running_period === false ? null : 'মাসের অবস্থা যাচাই হচ্ছে')}
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
      {systemAnnouncementVisible && (
        <section className="global-announcement global-system-announcement" role="region" aria-label="Hostel Life-এর গুরুত্বপূর্ণ ঘোষণা">
          <div className="global-announcement-inner">
            <span className="global-announcement-icon"><Icon name="shield-check" size={19} /></span>
            <div className="global-announcement-copy">
              <span className="global-announcement-label">HOSTEL LIFE · SYSTEM NOTICE</span>
              <strong>{platformSettings.announcement_title || 'Hostel Life ঘোষণা'}</strong>
              {platformSettings.announcement_body && <p>{platformSettings.announcement_body}</p>}
            </div>
          </div>
        </section>
      )}
      {pinnedManagerNotice && (pinnedManagerNotice.title || pinnedManagerNotice.body) && (
        <section className="global-announcement hostel-manager-announcement" role="status" aria-live="polite">
          <div className="global-announcement-inner">
            <span className="global-announcement-icon"><Icon name="bell" size={19} /></span>
            <div className="global-announcement-copy">
              <span className="hostel-manager-announcement-label">মেসের ম্যানেজারের বার্তা</span>
              <strong>{pinnedManagerNotice.title || 'মেসের নোটিশ'}</strong>
              {pinnedManagerNotice.body && <p>{pinnedManagerNotice.body}</p>}
            </div>
          </div>
        </section>
      )}

      {notificationsOpen && (
        <NotificationsPopover isManager={isManager} onUnreadChange={setUnreadCount} onClose={closeNotifications} />
      )}

      <main className="app-main">
        {!isOnline && active !== 'dashboard' && !pathname.startsWith('/app/menu/privacy-policy') && !pathname.startsWith('/app/menu/terms') && !pathname.startsWith('/app/menu/how-to-use') && !pathname.startsWith('/app/menu/developer') && !pathname.startsWith('/app/menu/app-download') ? <OfflineState onBack={() => navigateTo('/app/dashboard')} /> : children}
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
        <button className={theme === 'blue' ? 'active' : ''} onClick={() => changeTheme('blue')}>আকাশি</button>
      </div>

      {installNudgeOpen && canInstall && !installed && <div className="install-nudge-backdrop" role="presentation">
        <section className="install-nudge-dialog" role="dialog" aria-modal="true" aria-labelledby="install-nudge-title">
          <button className="install-nudge-close" type="button" onClick={dismissInstallNudge} aria-label="বন্ধ করুন">×</button>
          <span className="install-nudge-icon"><Icon name="smartphone" size={27}/></span>
          <span className="eyebrow">HOSTEL LIFE · APP EXPERIENCE</span>
          <h2 id="install-nudge-title">মোবাইলে Hostel Life ব্যবহার আরও সহজ করুন</h2>
          <p>হোম স্ক্রিনে অ্যাপটি যোগ করলে এক ট্যাপেই খুলতে পারবেন। বারবার ব্রাউজারে খুঁজতে হবে না।</p>
          <div className="install-nudge-actions"><button type="button" className="primary-button large" onClick={handleNudgeInstall}>অ্যাপ ইনস্টল করুন</button><button type="button" className="secondary-button" onClick={dismissInstallNudge}>পরে দেখব</button></div>
        </section>
      </div>}

      {telegramNudgeOpen && <div className="telegram-nudge-backdrop" role="presentation">
        <section className="telegram-nudge-dialog" role="dialog" aria-modal="true" aria-labelledby="telegram-nudge-title">
          <button type="button" className="release-notice-close" onClick={dismissTelegramNudge} aria-label="বন্ধ করুন">×</button>
          <span className="telegram-nudge-icon"><TelegramLogo size={30} /></span>
          <span className="eyebrow">HOSTEL LIFE · বিজ্ঞপ্তি</span>
          <h2 id="telegram-nudge-title">টেলিগ্রামে নোটিশ পান</h2>
          <p>মেসের গুরুত্বপূর্ণ নোটিশ সরাসরি টেলিগ্রামে পেতে সংযোগ করুন। এটি ঐচ্ছিক।</p>
          <div className="telegram-nudge-actions"><button type="button" className="primary-button" onClick={openTelegramSettings}>টেলিগ্রাম সংযোগ করুন</button><button type="button" className="secondary-button" onClick={dismissTelegramNudge}>পরে করব</button></div>
        </section>
      </div>}

      {releaseNoticeOpen && (() => {
        const communications = platformSettings?.communications;
        const releaseNotes = communications?.release_notes_published === true && Array.isArray(communications?.release_notes)
          ? communications.release_notes.filter((line) => String(line || '').trim()) : [];
        const hasPublishedNotes = releaseNotes.length > 0;
        return <SystemNoticeDialog
          kicker="HOSTEL LIFE · নতুন সংস্করণ"
          icon="refresh-cw"
          title={hasPublishedNotes ? 'এই আপডেটে যা নতুন' : 'সিস্টেম আপডেট হয়েছে'}
          description={hasPublishedNotes ? 'আপনার ব্যবহারের সুবিধায় নতুন পরিবর্তনগুলো দেখে নিন।' : 'নতুন সংস্করণ ব্যবহার করতে একবার রিফ্রেশ করুন।'}
          meta={`সংস্করণ প্রকাশ: ${new Date(APP_RELEASE.builtAt).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' })}`}
          onClose={dismissReleaseNotice}
          actions={<>
            <button type="button" className="primary-button" onClick={refreshForRelease}>এখনই রিফ্রেশ করুন</button>
            <button type="button" className="secondary-button" onClick={dismissReleaseNotice}>পরে করব</button>
          </>}
        >
          {hasPublishedNotes && <div className="system-notice-feature-list">{releaseNotes.map((feature, index) => <article className="system-notice-feature" key={`${index}-${feature}`}><span><Icon name="check-circle" size={17}/></span><p>{feature}</p></article>)}</div>}
        </SystemNoticeDialog>;
      })()}

      {priorityMessages.length > 0 && !releaseNoticeOpen && !installNudgeOpen && <SystemNoticeDialog
        kicker="HOSTEL LIFE · গুরুত্বপূর্ণ বার্তা"
        icon="bell"
        title={priorityMessages[0].title || 'আপনার জন্য একটি বার্তা'}
        description={priorityMessages[0].body}
        meta={new Date(priorityMessages[0].created_at).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' })}
        onClose={dismissPriorityMessage}
        actions={<button type="button" className="primary-button" onClick={dismissPriorityMessage}>বুঝেছি</button>}
      />}

      <PlatformCommunicationOverlays
        communications={platformSettings?.communications}
        blocked={releaseNoticeOpen || installNudgeOpen || telegramNudgeOpen || priorityMessages.length > 0}
      />
    </div>
  );
}
