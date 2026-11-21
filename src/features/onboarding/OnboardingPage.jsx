import { useEffect, useLayoutEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useInstallPromptContext } from '../../contexts/InstallPromptContext';
import { supabase } from '../../lib/supabase';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo } from '../../app/AppShell';
import { fetchPlatformPublicSettings } from '../../services/platformService';
import { dhakaDateInputValue, firstDayOfMonth } from '../../utils/monthStart';
import { normalizeRunningPeriodPayload } from '../../utils/period';
import { applyTheme, getThemePreference } from '../../app/theme';
import { EntryThemeSwitcher } from '../../components/EntryThemeSwitcher';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { createHostelJoinRequestFromInvite as createHostelJoinRequestFromLink, getHostelInviteLinkInfo as getHostelAccessLinkInfo, getMyHostelJoinRequestStatus } from '../../services/hostelInviteService';
import { clearPendingHostelLinkToken, getPendingHostelLinkToken } from '../../utils/pendingHostelLink';


function OnboardingBrand({ title, description }) {
  return (
    <header className="onboarding-brand-header">
      <div className="onboarding-brand-logo"><BrandMark size={62} /></div>
      <span className="onboarding-brand-wordmark">HOSTEL LIFE</span>
      {title && <h1>{title}</h1>}
      {description && <p className="onboarding-brand-description">{description}</p>}
    </header>
  );
}

function OnboardingTopbar() {
  return (
    <div className="onboarding-topbar">
      <span className="onboarding-account-setup-chip"><Icon name="shield-check" size={15} /> অ্যাকাউন্ট সেটআপ</span>
      <div className="entry-toolbar-actions"><LanguageSwitcher compact /><EntryThemeSwitcher /></div>
    </div>
  );
}

export function OnboardingPage() {
  const online = useOnlineStatus();
  const toast = useToast();
  const { canInstall, installed, install } = useInstallPromptContext();
  const [installNudgeOpen, setInstallNudgeOpen] = useState(false);
  const { refreshIdentity, signOutLocal } = useAuth();
  const [mode, setMode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [hostelName, setHostelName] = useState('');
  const [hostelPermissionCode, setHostelPermissionCode] = useState('');
  const [hostelCodeRequired, setHostelCodeRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [createdHostel, setCreatedHostel] = useState(null);
  const [initialMonthStatus, setInitialMonthStatus] = useState('not-started');
  const [initialMonthError, setInitialMonthError] = useState('');
  const [pendingLinkToken, setPendingLinkToken] = useState(() => getPendingHostelLinkToken());
  const [pendingLinkInfo, setPendingLinkInfo] = useState(null);
  const [pendingLinkError, setPendingLinkError] = useState('');
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  const [joinRequestNote, setJoinRequestNote] = useState('');
  const [joinRequestBusy, setJoinRequestBusy] = useState(false);

  useLayoutEffect(() => {
    applyTheme(getThemePreference());
  }, []);

  useEffect(() => {
    let active = true;
    fetchPlatformPublicSettings().then((settings) => { if (active) setHostelCodeRequired(Boolean(settings?.hostel_creation_code_required)); }).catch(() => { /* Compatibility with pre-Phase-2 projects. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (installed || !canInstall || pendingLinkToken) return undefined;
    let alreadySeen = false;
    try { alreadySeen = localStorage.getItem('hostel-life-install-nudge-v1') === '1'; } catch { /* Session-level reminder is still acceptable when storage is unavailable. */ }
    if (alreadySeen) return undefined;
    const timer = window.setTimeout(() => setInstallNudgeOpen(true), 2600);
    return () => window.clearTimeout(timer);
  }, [canInstall, installed, pendingLinkToken]);

  const dismissInstallNudge = () => {
    try { localStorage.setItem('hostel-life-install-nudge-v1', '1'); } catch { /* The prompt remains dismissible for this page session. */ }
    setInstallNudgeOpen(false);
  };

  const handleInstallNudge = async () => {
    if (!canInstall) {
      dismissInstallNudge();
      return;
    }
    try {
      const accepted = await install();
      if (accepted) toast.success('Hostel Life ইনস্টল করার অনুরোধ গ্রহণ করা হয়েছে।');
      dismissInstallNudge();
    } catch (error) {
      console.error('Install prompt failed:', error);
      toast.error('অ্যাপ ইনস্টল করা যায়নি। ব্রাউজারের Install App অপশন ব্যবহার করুন।');
      dismissInstallNudge();
    }
  };

  useEffect(() => {
    if (!pendingLinkToken || !online) return undefined;
    let active = true;
    setPendingLinkError('');
    Promise.allSettled([
      getHostelAccessLinkInfo(pendingLinkToken),
      getMyHostelJoinRequestStatus(pendingLinkToken),
    ]).then(async ([infoResult, statusResult]) => {
      if (!active) return;
      if (infoResult.status === 'fulfilled') setPendingLinkInfo(infoResult.value);
      else setPendingLinkError(statusResult.status === 'fulfilled' && statusResult.value?.status === 'pending'
        ? 'লিংকটি আর নতুন অনুরোধ নিচ্ছে না, তবে আপনার আগের অনুরোধ এখনো অপেক্ষমাণ। ম্যানেজারের সিদ্ধান্তের জন্য অপেক্ষা করুন।'
        : getFriendlySupabaseError(infoResult.reason, 'আমন্ত্রণ লিংক-এর তথ্য পাওয়া যায়নি।'));
      if (statusResult.status === 'fulfilled') {
        setJoinRequestStatus(statusResult.value);
        if (statusResult.value?.status === 'approved') {
          clearPendingHostelLinkToken();
          await refreshIdentity();
          navigateTo('/app/dashboard', true);
        }
      } else if (statusResult.reason?.code !== 'PGRST202') setPendingLinkError((old) => old || getFriendlySupabaseError(statusResult.reason, 'যোগদানের অনুরোধ-এর অবস্থা যাচাই করা যায়নি।'));
    });
    return () => { active = false; };
  }, [pendingLinkToken, online, refreshIdentity]);

  const submitLinkedJoinRequest = async () => {
    if (!pendingLinkToken || !online || joinRequestBusy) return;
    setJoinRequestBusy(true); setPendingLinkError('');
    try {
      const result = await createHostelJoinRequestFromLink(pendingLinkToken, joinRequestNote);
      setJoinRequestStatus(result);
      if (result.status === 'already_member') {
        await refreshIdentity();
        navigateTo('/app/dashboard', true);
      } else if (result.status === 'pending') {
        toast.success('যোগদানের অনুরোধ ম্যানেজারের কাছে পাঠানো হয়েছে। অনুমোদন না পাওয়া পর্যন্ত আপনি শুধু অনুরোধের অবস্থা দেখতে পারবেন।');
      }
    } catch (error) {
      setPendingLinkError(getFriendlySupabaseError(error, 'যোগদানের অনুরোধ পাঠানো যায়নি।'));
    } finally { setJoinRequestBusy(false); }
  };

  const refreshLinkedRequestStatus = async () => {
    if (!pendingLinkToken || joinRequestBusy) return;
    setJoinRequestBusy(true); setPendingLinkError('');
    try {
      const status = await getMyHostelJoinRequestStatus(pendingLinkToken);
      setJoinRequestStatus(status);
      if (status.status === 'approved') {
        await refreshIdentity();
        navigateTo('/app/dashboard', true);
      }
      if (status.status === 'rejected') toast.info('আপনার যোগদানের অনুরোধ অনুমোদিত হয়নি। চাইলে অন্য মেসে সাধারণ যুক্ত হওয়ার কোড ব্যবহার করতে পারেন।');
    } catch (error) { setPendingLinkError(getFriendlySupabaseError(error, 'অনুরোধের অবস্থা পাওয়া যায়নি।')); }
    finally { setJoinRequestBusy(false); }
  };

  const clearPendingLink = () => {
    clearPendingHostelLinkToken();
    setPendingLinkToken(''); setPendingLinkInfo(null); setJoinRequestStatus(null); setPendingLinkError('');
  };

  const switchAccount = async () => {
    if (switchingAccount || submitting) return;
    setSwitchingAccount(true);
    try {
      const result = await signOutLocal();
      if (result?.remoteRevocationConfirmed === false) {
        toast.info('এই ডিভাইস থেকে লগআউট সম্পন্ন হয়েছে। তবে সার্ভার সংযোগের কারণে সেশন বাতিলের নিশ্চিতকরণ পাওয়া যায়নি।');
      }
      navigateTo('/auth/login', true);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'এই ডিভাইস থেকে অ্যাকাউন্ট পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSwitchingAccount(false);
    }
  };

  const join = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('মেসে যুক্ত হতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    const code = joinCode.trim().toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(code)) {
      toast.error('১২ অক্ষরের সঠিক যুক্ত হওয়ার কোড দিন।');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('join_hostel', { p_join_code: code });
      if (error) throw error;
      toast.success('সফলভাবে মেসে যুক্ত হয়েছেন।');
      clearPendingHostelLinkToken(); setPendingLinkToken(''); setPendingLinkInfo(null); setJoinRequestStatus(null);
      await refreshIdentity();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মেসে যুক্ত হওয়া যায়নি। যুক্ত হওয়ার কোড যাচাই করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  const create = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('মেস তৈরি করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (hostelName.trim().length < 2) {
      toast.error('মেসের নাম কমপক্ষে ২ অক্ষরের দিন।');
      return;
    }
    setSubmitting(true);
    try {
      let { data, error } = await supabase.rpc('create_hostel_secure', { p_name: hostelName.trim(), p_permission_code: hostelPermissionCode.trim().toUpperCase() || null });
      if (error && (error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message || ''))) {
        if (hostelCodeRequired) throw new Error('অনুমতি কোড যাচাই করার backend migration অনুপস্থিত। Super Admin Phase 2 SQL প্রয়োগ করুন।');
        ({ data, error } = await supabase.rpc('create_hostel', { p_name: hostelName.trim() }));
      }
      if (error) throw error;

      // Hostel creation has succeeded. A failure to initialize its first period must
      // not falsely tell the user that hostel creation itself failed.
      const newHostel = data ?? { name: hostelName.trim() };
      clearPendingHostelLinkToken(); setPendingLinkToken(''); setPendingLinkInfo(null); setJoinRequestStatus(null);
      setCreatedHostel(newHostel);
      try {
        await ensureInitialRunningMonth();
        setInitialMonthStatus('started');
        setInitialMonthError('');
        toast.success(`“${newHostel?.name ?? hostelName.trim()}” মেস তৈরি হয়েছে এবং ${firstDayOfMonth(dhakaDateInputValue())} থেকে চলমান মাস শুরু হয়েছে।`);
      } catch (periodError) {
        setInitialMonthStatus('failed');
        setInitialMonthError(getFriendlySupabaseError(periodError, 'প্রথম মাস স্বয়ংক্রিয়ভাবে শুরু করা যায়নি।'));
        toast.warning('মেস তৈরি হয়েছে, কিন্তু প্রথম মাস শুরু হয়নি। নিচের বোতাম থেকে আবার চেষ্টা করুন।');
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মেস তৈরি করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  async function ensureInitialRunningMonth() {
    if (!supabase) throw new Error('Supabase সংযোগ সেট করা নেই।');

    // Check first to avoid duplicate periods, including a previous request whose
    // database commit succeeded but whose response was interrupted by the network.
    const current = await supabase.rpc('get_running_period_context');
    if (!current.error) {
      const payload = current.data;
      if (payload?.has_running_period === true || normalizeRunningPeriodPayload(payload)) return payload;
    }

    const startDate = firstDayOfMonth(dhakaDateInputValue());
    if (!startDate) throw new Error('বাংলাদেশের সময় অনুযায়ী মাসের শুরুর তারিখ নির্ধারণ করা যায়নি।');
    const { error } = await supabase.rpc('start_new_month', { p_start_date: startDate });
    if (error) {
      const verification = await supabase.rpc('get_running_period_context');
      if (!verification.error && (verification.data?.has_running_period === true || normalizeRunningPeriodPayload(verification.data))) {
        return verification.data;
      }
      throw error;
    }
    return true;
  }

  const retryInitialMonth = async () => {
    setSubmitting(true);
    try {
      await ensureInitialRunningMonth();
      setInitialMonthStatus('started');
      setInitialMonthError('');
      toast.success('চলমান মাস সফলভাবে শুরু হয়েছে।');
    } catch (error) {
      const message = getFriendlySupabaseError(error, 'প্রথম মাস শুরু করা যায়নি।');
      setInitialMonthStatus('failed');
      setInitialMonthError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (createdHostel) {
    return (
      <main className="onboarding-page">
        <section className="onboarding-shell onboarding-shell-success">
          <div className="onboarding-main-card card">
            <OnboardingTopbar />
            <OnboardingBrand title="মেস তৈরি সম্পন্ন" />
            <div className="creation-success-card">
              <div className="success-panel-icon"><Icon name="check" size={24} /></div>
              <h2>{createdHostel.name}</h2>
              {initialMonthStatus === 'started' && <div className="creation-success-verification" role="status" aria-live="polite"><span className="creation-success-verification-icon"><Icon name="check" size={18} /></span><span className="creation-success-verification-copy"><strong>মেস তৈরি হয়েছে</strong><small>প্রথম মাস চালু হয়ে গেছে।</small></span><span className="creation-success-verification-mark">যাচাইকৃত</span></div>}
              {initialMonthStatus === 'failed' && <div className="inline-error"><Icon name="warning" size={17} /><span>মেস তৈরি হয়েছে, তবে প্রথম মাস চালু হয়নি। {initialMonthError}</span></div>}
              {initialMonthStatus === 'failed' && <button type="button" className="secondary-button" disabled={submitting || !online} onClick={retryInitialMonth}>{submitting ? 'চেষ্টা হচ্ছে...' : 'প্রথম মাস চালু করুন'}</button>}

              <button type="button" className="primary-button large" onClick={() => refreshIdentity()}>মেসে প্রবেশ করুন</button>
              <button type="button" className="onboarding-switch-account" onClick={switchAccount} disabled={switchingAccount || submitting}>{switchingAccount ? 'অ্যাকাউন্ট পরিবর্তন হচ্ছে...' : 'অন্য অ্যাকাউন্ট ব্যবহার করুন'}</button>
            </div>
          </div>
        </section>
      {installNudgeOpen && canInstall && !installed && !pendingLinkToken && <div className="install-nudge-backdrop" role="presentation">
        <section className="install-nudge-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-install-title">
          <button className="install-nudge-close" type="button" onClick={dismissInstallNudge} aria-label="বন্ধ করুন">×</button>
          <span className="install-nudge-icon"><Icon name="smartphone" size={27}/></span>
          <span className="eyebrow">HOSTEL LIFE · APP EXPERIENCE</span>
          <h2 id="onboarding-install-title">অ্যাপটি ইনস্টল করে আরও সহজে ব্যবহার করুন</h2>
          <p>একবার ইনস্টল করুন—এরপর হোম স্ক্রিন থেকেই Hostel Life খুলতে পারবেন।</p>
          <div className="install-nudge-actions"><button type="button" className="primary-button large" onClick={handleInstallNudge}>অ্যাপ ইনস্টল করুন</button><button type="button" className="secondary-button" onClick={dismissInstallNudge}>পরে দেখব</button></div>
        </section>
      </div>}
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <div className="onboarding-main-card card">
          <OnboardingTopbar />
          <OnboardingBrand />

          {pendingLinkToken && <section className="onboarding-linked-request card" aria-label="আমন্ত্রণ লিংক দিয়ে মেসে যোগদান">
            <div className="onboarding-linked-request-icon"><Icon name="mail-plus" size={22}/></div>
            <div className="onboarding-linked-request-copy">
              <span className="eyebrow">সদস্য আমন্ত্রণ</span>
              <h2>{pendingLinkInfo?.hostel_name ? <span data-user-content>{pendingLinkInfo.hostel_name}</span> : 'আমন্ত্রিত মেসে যোগদান'}</h2>
              <p>{pendingLinkError || (pendingLinkInfo ? 'এই মেসে যুক্ত হতে অনুরোধ পাঠান। অনুমোদনের পর সদস্যপদ চালু হবে।' : 'আমন্ত্রণ যাচাই করা হচ্ছে...')}</p>
              {joinRequestStatus?.status === 'pending' && <div className="inline-success"><Icon name="clock" size={16}/> আপনার অনুরোধ অপেক্ষমাণ। অনুমোদনের পর মেসে প্রবেশ করতে পারবেন।</div>}
              {joinRequestStatus?.status === 'rejected' && <div className="inline-error"><Icon name="info" size={16}/> এই অনুরোধটি অনুমোদিত হয়নি। চাইলে নিচে সাধারণ যুক্ত হওয়ার কোড বা নতুন মেস তৈরির পদ্ধতি ব্যবহার করুন। {joinRequestStatus.review_note || ''}</div>}
              {joinRequestStatus?.status === 'approved' && <div className="inline-success"><Icon name="check-circle" size={16}/> অনুরোধ অনুমোদিত হয়েছে। অ্যাকাউন্ট যাচাই করা হচ্ছে...</div>}
              {(!joinRequestStatus || joinRequestStatus.status === 'not_submitted' || joinRequestStatus.status === 'rejected') && <>
                <label className="field-label"><span>ম্যানেজারের জন্য বার্তা (ঐচ্ছিক)</span><textarea rows={2} maxLength={500} value={joinRequestNote} onChange={(e) => setJoinRequestNote(e.target.value)} placeholder="নিজের পরিচয় বা যোগদানের কারণ লিখুন"/></label>
                <button type="button" className="primary-button large" disabled={!online || joinRequestBusy || !pendingLinkInfo} onClick={submitLinkedJoinRequest}>{joinRequestBusy ? 'অনুরোধ পাঠানো হচ্ছে...' : 'মেসে যোগদানের অনুরোধ পাঠান'}</button>
              </>}
              {joinRequestStatus?.status === 'pending' && <button type="button" className="secondary-button" disabled={joinRequestBusy} onClick={refreshLinkedRequestStatus}>{joinRequestBusy ? 'যাচাই হচ্ছে...' : 'অনুরোধের অবস্থা যাচাই করুন'}</button>}
              <button type="button" className="onboarding-switch-account onboarding-invite-exit" onClick={clearPendingLink}>পরে করবেন</button>
            </div>
          </section>}

          {joinRequestStatus?.status !== 'pending' && <>
          <div className="onboarding-choice-intro">
            <span className="eyebrow">শুরু করুন</span>
            <h2>কীভাবে শুরু করবেন?</h2>
          </div>

          <div className="onboarding-mode-picker" role="group" aria-label="মেসে যুক্ত হওয়া অথবা নতুন মেস তৈরি করা">
            <button type="button" className={`onboarding-mode-option ${mode === 'join' ? 'active' : ''}`} onClick={() => setMode((current) => current === 'join' ? '' : 'join')} aria-pressed={mode === 'join'} aria-expanded={mode === 'join'} aria-controls="onboarding-action-panel">
              <span className="onboarding-mode-icon"><Icon name="user-plus" size={20} /></span>
              <span className="onboarding-mode-copy"><strong>মেসে যুক্ত হন</strong><small>কোড দিয়ে</small></span>
              <span className="onboarding-mode-check">{mode === 'join' && <Icon name="check-circle" size={18} />}</span>
            </button>
            <button type="button" className={`onboarding-mode-option ${mode === 'create' ? 'active' : ''}`} onClick={() => setMode((current) => current === 'create' ? '' : 'create')} aria-pressed={mode === 'create'} aria-expanded={mode === 'create'} aria-controls="onboarding-action-panel">
              <span className="onboarding-mode-icon"><Icon name="plus-circle" size={20} /></span>
              <span className="onboarding-mode-copy"><strong>নতুন মেস তৈরি</strong><small>নতুন মেস খুলুন</small></span>
              <span className="onboarding-mode-check">{mode === 'create' && <Icon name="check-circle" size={18} />}</span>
            </button>
          </div>

          {mode && <section id="onboarding-action-panel" className={`onboarding-action-panel onboarding-action-panel-${mode}`} aria-live="polite" aria-labelledby="onboarding-action-title">
            <div className="onboarding-action-heading">
              <h3 id="onboarding-action-title" className={mode === 'join' ? 'visually-hidden' : undefined}>{mode === 'join' ? 'কোড দিয়ে মেসে যুক্ত হন' : 'নতুন মেস তৈরি'}</h3>
            </div>
            {mode === 'join' ? (
              <form className="form-stack onboarding-entry-form" onSubmit={join}>
                <label className="field-label onboarding-join-code-field">
                  <span className="visually-hidden">যোগদানের কোড</span>
                  <input
                    type="text"
                    aria-label="যোগদানের কোড"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="A1B2C3D4E5F6"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={12}
                    minLength={12}
                    required
                  />
                </label>
                <button type="submit" className="primary-button large" disabled={submitting || !online}>
                  {submitting ? 'যুক্ত হচ্ছে...' : 'মেসে যুক্ত হন'}
                </button>
              </form>
            ) : (
              <form className={`form-stack onboarding-entry-form onboarding-entry-form-create ${hostelCodeRequired ? 'has-permission-code' : 'no-permission-code'}`} onSubmit={create}>
                <label className="field-label onboarding-hostel-name-field">
                  <span className="run63-visually-hidden">মেসের নাম</span>
                  <input type="text" value={hostelName} onChange={(e) => setHostelName(e.target.value)} placeholder="যেমন: নিজামুদ্দিন ছাত্রাবাস" aria-label="মেসের নাম" maxLength={120} required />
                </label>
                {hostelCodeRequired && (
                  <label className="field-label">
                    <span>মেস তৈরির অনুমতি কোড</span>
                    <input value={hostelPermissionCode} onChange={(e) => setHostelPermissionCode(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" required placeholder="অ্যাডমিনের দেওয়া কোড" />
                    <small className="platform-form-help">সুপার অ্যাডমিনের দেওয়া অনুমতি কোড লিখুন।</small>
                  </label>
                )}
                <button type="submit" className="primary-button large" disabled={submitting || !online}>
                  {submitting ? 'তৈরি হচ্ছে...' : 'মেস তৈরি করুন'}
                </button>
              </form>
            )}
          </section>}
          </>}

          {!online && (
            <div className="inline-error onboarding-offline"><Icon name="offline" size={17} /><span>মেসে যুক্ত হওয়া বা নতুন মেস তৈরি করতে ইন্টারনেট সংযোগ চালু করুন।</span></div>
          )}

          <div className="onboarding-note">
            <Icon name="shield" size={17} />
            <span>একটি অ্যাকাউন্ট একবারে একটি মেসের সঙ্গে যুক্ত থাকে।</span>
          </div>
          <div className="onboarding-account-switch-row">
            <button type="button" className="onboarding-switch-account" onClick={switchAccount} disabled={switchingAccount || submitting}>
              <Icon name="logout" size={15} /> {switchingAccount ? 'অ্যাকাউন্ট পরিবর্তন হচ্ছে...' : 'অন্য অ্যাকাউন্ট ব্যবহার করুন'}
            </button>
          </div>
        </div>
      </section>
      {installNudgeOpen && canInstall && !installed && !pendingLinkToken && <div className="install-nudge-backdrop" role="presentation">
        <section className="install-nudge-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-install-title">
          <button className="install-nudge-close" type="button" onClick={dismissInstallNudge} aria-label="বন্ধ করুন">×</button>
          <span className="install-nudge-icon"><Icon name="smartphone" size={27}/></span>
          <span className="eyebrow">HOSTEL LIFE · APP EXPERIENCE</span>
          <h2 id="onboarding-install-title">অ্যাপটি ইনস্টল করে আরও সহজে ব্যবহার করুন</h2>
          <p>একবার ইনস্টল করুন—এরপর হোম স্ক্রিন থেকেই Hostel Life খুলতে পারবেন।</p>
          <div className="install-nudge-actions"><button type="button" className="primary-button large" onClick={handleInstallNudge}>অ্যাপ ইনস্টল করুন</button><button type="button" className="secondary-button" onClick={dismissInstallNudge}>পরে দেখব</button></div>
        </section>
      </div>}
    </main>
  );

}
