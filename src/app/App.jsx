import { useEffect, useState } from 'react';
import { AppShell, navigateTo } from './AppShell';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ArchiveCorrectionPage } from '../features/archive/ArchiveCorrectionPage';
import { DiningPage } from '../features/dining/DiningPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { AllMembersPage, KhalaMoneyViewPage, TopDepositorsPage, TopEatersPage, TopShoppersPage, DeveloperInfoPage, PrivacyPolicyPage, TermsPage, HowToUsePage, SendNotificationPage, PreviousMonthsPage } from '../features/menu/MenuPages';
import { NewMonthPage, CloseCurrentMonthPage, ChangeManagerPage, AssistantManagersPage, HostelSettingsPage, KhalaMoneyPage, MemberManagementPage, JoinRequestReviewPage, ReportsPage, MealSheetPage } from '../features/manager/ManagerPages';
import { AuthPage } from '../features/auth/AuthPage';
import { ForcedPasswordChange } from '../features/auth/ForcedPasswordChange';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import { InactiveMembershipPage } from '../features/account/InactiveMembershipPage';
import { IdentityErrorPage } from '../features/account/IdentityErrorPage';
import { SuperAdminPage } from '../features/platform/SuperAdminPage';
import { HostelInvitePage } from '../features/invites/HostelInvitePage';
import { getPendingHostelLinkToken } from '../utils/pendingHostelLink';
import { AppDownloadPage } from '../features/menu/AppDownloadPage';
import { TelegramConnectionPage } from '../features/telegram/TelegramConnectionPage';
import { fetchPlatformPublicSettings, PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT } from '../services/platformService';
import { THEME_KEY, THEME_VALUES, applyPlatformDefaultTheme } from './theme';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { PlatformCommunicationOverlays } from '../components/PlatformCommunicationOverlays';
import { useAuth } from '../contexts/AuthContext';

const SUPER_ADMIN_RETURN_KEY = 'hostel-life-super-admin-return-v1';
const SUPER_ADMIN_RETURN_TTL_MS = 10 * 60 * 1000;

function getPath() {
  const pathname = window.location.pathname || '/app/dashboard';
  // New invitation links keep the bearer token in the URL fragment. Fragments
  // are never sent in HTTP requests or ordinary Referer headers.
  if (pathname === '/invite' && /^#[0-9a-f]{64}$/.test(window.location.hash || '')) {
    return `/invite/${window.location.hash.slice(1)}`;
  }
  return pathname;
}

function resolveAppPage(pathname, isManager) {
  if (pathname === '/app/dining') return <DiningPage />;
  if (pathname === '/app/history') return <HistoryPage />;
  if (pathname === '/app/profile') return <ProfilePage />;
  if (pathname === '/app/menu/members') return <AllMembersPage />;
  if (pathname === '/app/menu/khala-money-view') return <KhalaMoneyViewPage />;
  if (pathname === '/app/menu/top-eater') return <TopEatersPage />;
  if (pathname === '/app/menu/top-shopper') return <TopShoppersPage />;
  if (pathname === '/app/menu/top-depositor') return <TopDepositorsPage />;
  if (pathname === '/app/menu/developer') return <DeveloperInfoPage />;
  if (pathname === '/app/menu/privacy-policy') return <PrivacyPolicyPage />;
  if (pathname === '/app/menu/terms') return <TermsPage />;
  if (pathname === '/app/menu/how-to-use') return <HowToUsePage />;
  if (pathname === '/app/menu/app-download') return <AppDownloadPage />;
  if (pathname === '/app/menu/telegram') return <TelegramConnectionPage />;
  if (pathname === '/app/menu/send-notification') return <SendNotificationPage />;
  if (pathname === '/app/menu/archive') return isManager ? <ArchiveCorrectionPage /> : <PreviousMonthsPage />;
  if (pathname === '/app/menu/reports') return <ReportsPage />;
  if (pathname === '/app/menu/meal-sheet') return <MealSheetPage />;
  // Legacy deep links now resolve to the single Archive entry.
  if (pathname === '/app/menu/archive-edit-access') return isManager ? <ArchiveCorrectionPage /> : <PreviousMonthsPage />;
  if (pathname === '/app/menu/current-month-close') return <CloseCurrentMonthPage />;
  if (pathname === '/app/menu/new-month') return <NewMonthPage />;
  if (pathname === '/app/menu/change-manager') return <ChangeManagerPage />;
  if (pathname === '/app/menu/assistant-managers') return <AssistantManagersPage />;
  if (pathname === '/app/menu/hostel-settings') return <HostelSettingsPage />;
  if (pathname === '/app/menu/khala-money') return <KhalaMoneyPage />;
  if (pathname === '/app/menu/member-management') return <MemberManagementPage />;
  if (pathname === '/app/menu/join-requests') return <JoinRequestReviewPage />;
  return <DashboardPage />;
}

export function App() {
  const [pathname, setPathname] = useState(getPath);
  const [publicSettings, setPublicSettings] = useState(null);
  const auth = useAuth();

  useEffect(() => {
    const update = () => setPathname(getPath());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  useEffect(() => {
    let active = true;
    let hasExplicitTheme = false;
    try { hasExplicitTheme = THEME_VALUES.includes(window.localStorage.getItem(THEME_KEY)); }
    catch { /* Browser storage may be restricted; use the platform default if available. */ }
    const loadSettings = (force = false) => fetchPlatformPublicSettings({ force }).then((settings) => {
      if (!active) return;
      setPublicSettings(settings || null);
      if (!hasExplicitTheme && THEME_VALUES.includes(settings?.default_theme)) {
        applyPlatformDefaultTheme(settings.default_theme);
      }
    }).catch(() => { /* Keep the safe local theme and continue without platform notices. */ });
    loadSettings();
    const refresh = () => { loadSettings(true); };
    window.addEventListener(PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT, refresh); };
  }, []);

  const withPublicCommunications = (content) => <>{content}<PlatformCommunicationOverlays communications={publicSettings?.communications} /></>;

  useEffect(() => {
    if (auth.authLoading || auth.user?.app_metadata?.must_change_password) return;
    if (pathname === '/super-admin') {
      if (!auth.isAuthenticated) {
        // Remember the requested protected route so a Super Admin who signs in
        // from localhost can return here. This does not grant or bypass access.
        try { window.sessionStorage.setItem(SUPER_ADMIN_RETURN_KEY, JSON.stringify({ path: '/super-admin', savedAt: Date.now() })); }
        catch { /* Session storage is optional; users can revisit the route manually. */ }
        navigateTo('/auth/login', true);
      }
      return;
    }

    const inAuth = pathname.startsWith('/auth/');
    const inApp = pathname.startsWith('/app/');
    const inOnboarding = pathname.startsWith('/onboarding');
    const inSharedLink = pathname.startsWith('/invite/');
    if (inSharedLink) return;

    if (auth.isAuthenticated && (inAuth || inOnboarding || pathname === '/')) {
      try {
        // Preserve a pending invitation through registration/email confirmation.
        // It is only an authenticated Join Request flow; it never opens dashboard data.
        const pendingToken = getPendingHostelLinkToken();
        if (pendingToken) {
          navigateTo(`/invite#${pendingToken}`, true);
          return;
        }
      } catch { /* Local storage is optional; continue with normal routing. */ }

      // Return to Super Admin only when the user explicitly requested that route
      // before login. The Super Admin page still performs its own role check and
      // mandatory password re-authentication after this navigation.
      if (inAuth && pathname !== '/auth/reset-password') {
        try {
          const saved = JSON.parse(window.sessionStorage.getItem(SUPER_ADMIN_RETURN_KEY) || 'null');
          window.sessionStorage.removeItem(SUPER_ADMIN_RETURN_KEY);
          if (saved?.path === '/super-admin' && Number.isFinite(saved.savedAt)
            && Date.now() - saved.savedAt >= 0 && Date.now() - saved.savedAt <= SUPER_ADMIN_RETURN_TTL_MS) {
            navigateTo('/super-admin', true);
            return;
          }
        } catch { /* Ignore malformed or unavailable session state. */ }
      }
    }

    if (!auth.isAuthenticated) {
      if (pathname === '/') navigateTo('/auth/login', true);
      else if (!inAuth) navigateTo('/auth/login', true);
      return;
    }

    if (pathname.startsWith('/auth/reset-password')) return;

    // A failed identity fetch is not proof that the user has no hostel membership.
    // Keep the current route/session and let the recovery screen handle the retry.
    if (auth.identityError) return;

    if (!auth.identityLoading && auth.membership?.status === 'inactive') {
      if (!pathname.startsWith('/account/inactive')) navigateTo('/account/inactive', true);
      return;
    }

    if (!auth.identityLoading && !auth.membership) {
      if (!inOnboarding) navigateTo('/onboarding', true);
      return;
    }

    if (auth.membership?.status === 'active' && (inAuth || inOnboarding || pathname.startsWith('/account/'))) {
      navigateTo('/app/dashboard', true);
    }

    if (!inApp && !inAuth && !inOnboarding && !pathname.startsWith('/account/')) {
      navigateTo('/app/dashboard', true);
    }
  }, [pathname, auth.authLoading, auth.isAuthenticated, auth.identityLoading, auth.identityError, auth.membership]);

  useEffect(() => {
    let title = 'Hostel Life';
    if (pathname.includes('/dining')) title = 'Hostel Life — ডাইনিং';
    else if (pathname.includes('/history')) title = 'Hostel Life — হিস্টরি';
    else if (pathname.includes('/profile')) title = 'Hostel Life — প্রোফাইল';
    else if (pathname.includes('/menu/top-eater')) title = 'Hostel Life — শীর্ষ খাদক';
    else if (pathname.includes('/menu/top-shopper')) title = 'Hostel Life — বেশি বাজারকারী';
    else if (pathname.includes('/menu/top-depositor')) title = 'Hostel Life — বেশি ডিপোজিটকারী';
    else if (pathname.includes('/menu/members')) title = 'Hostel Life — সকল সদস্য';
    else if (pathname.includes('/menu/khala-money-view')) title = 'Hostel Life — খালার টাকা';
    else if (pathname.includes('/menu/developer')) title = 'Hostel Life — হেল্প';
    else if (pathname.includes('/menu/privacy-policy')) title = 'Hostel Life — গোপনীয়তা ও নীতিমালা';
    else if (pathname.includes('/menu/terms')) title = 'Hostel Life — ব্যবহারের শর্তাবলী';
    else if (pathname.includes('/menu/how-to-use')) title = 'Hostel Life — কীভাবে ব্যবহার করব';
    else if (pathname.includes('/menu/app-download')) title = 'Hostel Life — অ্যাপ ডাউনলোড';
    else if (pathname.includes('/menu/telegram')) title = 'Hostel Life — টেলিগ্রাম সংযোগ';
    else if (pathname.includes('/menu/send-notification')) title = 'Hostel Life — নোটিফিকেশন';
    else if (pathname.includes('/menu/archive')) title = 'Hostel Life — আর্কাইভ';
    else if (pathname.includes('/menu/reports')) title = 'Hostel Life — রিপোর্ট';
    else if (pathname.includes('/menu/meal-sheet')) title = 'Hostel Life — মিল শিট';
    else if (pathname.includes('/menu/archive-edit-access')) title = 'Hostel Life — আর্কাইভ';
    else if (pathname.includes('/menu/current-month-close')) title = 'Hostel Life — বর্তমান মাস শেষ করুন';
    else if (pathname.includes('/menu/new-month')) title = 'Hostel Life — নতুন মাস';
    else if (pathname.includes('/menu/change-manager')) title = 'Hostel Life — ম্যানেজার পরিবর্তন';
    else if (pathname.includes('/menu/assistant-managers')) title = 'Hostel Life — সহকারী ম্যানেজার';
    else if (pathname.includes('/menu/hostel-settings')) title = 'Hostel Life — মেস সেটিংস';
    else if (pathname.includes('/menu/khala-money')) title = 'Hostel Life — খালার টাকা';
    else if (pathname.includes('/menu/member-management')) title = 'Hostel Life — সদস্য ব্যবস্থাপনা';
    else if (pathname.includes('/menu/join-requests')) title = 'Hostel Life — জয়েন রিকোয়েস্ট পর্যালোচনা';
    else if (pathname.includes('/menu/join-requests')) title = 'Hostel Life — জয়েন রিকোয়েস্ট পর্যালোচনা';
    else if (pathname.includes('/onboarding')) title = 'Hostel Life — মেস সেটআপ';
    else if (pathname === '/super-admin') title = 'Hostel Life — Super Admin';
    document.title = title;
  }, [pathname]);

  if (!auth.authLoading && auth.isAuthenticated && auth.user?.app_metadata?.must_change_password) return withPublicCommunications(<ForcedPasswordChange />);

  if (pathname.startsWith('/auth/') || pathname === '/auth') {
    if (auth.isAuthenticated && pathname !== '/auth/reset-password' && !auth.authLoading) {
      if (auth.identityLoading) return withPublicCommunications(<LoadingSpinner label="অ্যাকাউন্ট যাচাই হচ্ছে..." />);
    }
    return withPublicCommunications(<AuthPage pathname={pathname === '/auth' ? '/auth/login' : pathname} />);
  }

  if (auth.authLoading) return withPublicCommunications(<LoadingSpinner label="সেশন যাচাই হচ্ছে..." />);

  if (pathname.startsWith('/invite/')) {
    return withPublicCommunications(<HostelInvitePage pathname={pathname} />);
  }

  if (!auth.isAuthenticated) return withPublicCommunications(<AuthPage pathname="/auth/login" />);

  if (pathname === '/super-admin') return withPublicCommunications(<SuperAdminPage user={auth.user} />);

  if (auth.identityLoading) return withPublicCommunications(<LoadingSpinner label="আপনার মেসের তথ্য লোড হচ্ছে..." />);

  if (auth.identityError) return withPublicCommunications(<IdentityErrorPage />);

  if (pathname.startsWith('/account/inactive') || auth.membership?.status === 'inactive') {
    return withPublicCommunications(<InactiveMembershipPage />);
  }

  if (!auth.membership) return withPublicCommunications(<OnboardingPage />);

  if (pathname.startsWith('/onboarding')) return withPublicCommunications(<OnboardingPage />);

  return (
    <AppShell
      pathname={pathname}
      membership={auth.membership}
      profile={auth.profile}
      isManager={auth.isManager}
      user={auth.user}
    >
      {resolveAppPage(pathname, auth.isManager)}
    </AppShell>
  );
}
