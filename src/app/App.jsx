import { useEffect, useState } from 'react';
import { AppShell, navigateTo } from './AppShell';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DiningPage } from '../features/dining/DiningPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { AllMembersPage, TopEatersPage, TopShoppersPage, DeveloperInfoPage, SendNotificationPage, PreviousMonthsPage } from '../features/menu/MenuPages';
import { NewMonthPage, ChangeManagerPage, HostelSettingsPage, ArchiveManagerPage, KhalaMoneyPage, MemberManagementPage, ReportsPage, MealSheetPage } from '../features/manager/ManagerPages';
import { AuthPage } from '../features/auth/AuthPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import { InactiveMembershipPage } from '../features/account/InactiveMembershipPage';
import { IdentityErrorPage } from '../features/account/IdentityErrorPage';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';

function getPath() {
  return window.location.pathname || '/app/dashboard';
}

function resolveAppPage(pathname, isManager) {
  if (pathname === '/app/dining') return <DiningPage />;
  if (pathname === '/app/history') return <HistoryPage />;
  if (pathname === '/app/profile') return <ProfilePage />;
  if (pathname === '/app/menu/members') return <AllMembersPage />;
  if (pathname === '/app/menu/top-eater') return <TopEatersPage />;
  if (pathname === '/app/menu/top-shopper') return <TopShoppersPage />;
  if (pathname === '/app/menu/developer') return <DeveloperInfoPage />;
  if (pathname === '/app/menu/send-notification') return <SendNotificationPage />;
  if (pathname === '/app/menu/archive') return isManager ? <ArchiveManagerPage /> : <PreviousMonthsPage />;
  if (pathname === '/app/menu/reports') return <ReportsPage />;
  if (pathname === '/app/menu/meal-sheet') return <MealSheetPage />;
  if (pathname === '/app/menu/new-month') return <NewMonthPage />;
  if (pathname === '/app/menu/change-manager') return <ChangeManagerPage />;
  if (pathname === '/app/menu/hostel-settings') return <HostelSettingsPage />;
  if (pathname === '/app/menu/khala-money') return <KhalaMoneyPage />;
  if (pathname === '/app/menu/member-management') return <MemberManagementPage />;
  return <DashboardPage />;
}

export function App() {
  const [pathname, setPathname] = useState(getPath);
  const auth = useAuth();

  useEffect(() => {
    const update = () => setPathname(getPath());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  useEffect(() => {
    if (auth.authLoading) return;

    const inAuth = pathname.startsWith('/auth/');
    const inApp = pathname.startsWith('/app/');
    const inOnboarding = pathname.startsWith('/onboarding');

    if (!auth.isAuthenticated) {
      if (pathname === '/') navigateTo('/auth/login', true);
      else if (!inAuth) navigateTo('/auth/login', true);
      return;
    }

    if (pathname.startsWith('/auth/reset-password')) return;

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
  }, [pathname, auth.authLoading, auth.isAuthenticated, auth.identityLoading, auth.membership]);

  useEffect(() => {
    let title = 'Hostel Life';
    if (pathname.includes('/dining')) title = 'Hostel Life — ডাইনিং';
    else if (pathname.includes('/history')) title = 'Hostel Life — হিস্টরি';
    else if (pathname.includes('/profile')) title = 'Hostel Life — প্রোফাইল';
    else if (pathname.includes('/menu/top-eater')) title = 'Hostel Life — শীর্ষ খাদক';
    else if (pathname.includes('/menu/top-shopper')) title = 'Hostel Life — বেশি বাজারকারী';
    else if (pathname.includes('/menu/members')) title = 'Hostel Life — সকল সদস্য';
    else if (pathname.includes('/menu/developer')) title = 'Hostel Life — ডেভেলপার ইনফো';
    else if (pathname.includes('/menu/send-notification')) title = 'Hostel Life — নোটিফিকেশন';
    else if (pathname.includes('/menu/archive')) title = 'Hostel Life — আর্কাইভ';
    else if (pathname.includes('/menu/reports')) title = 'Hostel Life — রিপোর্ট';
    else if (pathname.includes('/menu/meal-sheet')) title = 'Hostel Life — মিল শিট';
    else if (pathname.includes('/menu/new-month')) title = 'Hostel Life — নতুন মাস';
    else if (pathname.includes('/menu/change-manager')) title = 'Hostel Life — ম্যানেজার পরিবর্তন';
    else if (pathname.includes('/menu/hostel-settings')) title = 'Hostel Life — মেস সেটিংস';
    else if (pathname.includes('/menu/khala-money')) title = 'Hostel Life — খালার টাকা';
    else if (pathname.includes('/menu/member-management')) title = 'Hostel Life — সদস্য ব্যবস্থাপনা';
    else if (pathname.includes('/onboarding')) title = 'Hostel Life — মেস সেটআপ';
    document.title = title;
  }, [pathname]);

  if (pathname.startsWith('/auth/') || pathname === '/auth') {
    if (auth.isAuthenticated && pathname !== '/auth/reset-password' && !auth.authLoading) {
      if (auth.identityLoading) return <LoadingSpinner label="অ্যাকাউন্ট যাচাই হচ্ছে..." />;
    }
    return <AuthPage pathname={pathname === '/auth' ? '/auth/login' : pathname} />;
  }

  if (auth.authLoading) return <LoadingSpinner label="সেশন যাচাই হচ্ছে..." />;

  if (!auth.isAuthenticated) return <AuthPage pathname="/auth/login" />;

  if (auth.identityLoading) return <LoadingSpinner label="আপনার মেসের তথ্য লোড হচ্ছে..." />;

  if (auth.identityError) return <IdentityErrorPage />;

  if (pathname.startsWith('/account/inactive') || auth.membership?.status === 'inactive') {
    return <InactiveMembershipPage />;
  }

  if (!auth.membership) return <OnboardingPage />;

  if (pathname.startsWith('/onboarding')) return <OnboardingPage />;

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
