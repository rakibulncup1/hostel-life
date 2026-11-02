import { useEffect, useLayoutEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { supabase } from '../../lib/supabase';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo } from '../../app/AppShell';
import { fetchPlatformPublicSettings } from '../../services/platformService';
import { dhakaDateInputValue, firstDayOfMonth } from '../../utils/monthStart';
import { normalizeRunningPeriodPayload } from '../../utils/period';


function OnboardingBrand({ title, description }) {
  return (
    <header className="onboarding-brand-header">
      <div className="onboarding-brand-logo"><BrandMark size={62} /></div>
      <span className="onboarding-brand-wordmark">HOSTEL LIFE</span>
      <h1>{title}</h1>
      <p className="onboarding-brand-description">{description}</p>
    </header>
  );
}

function SetupCard({ icon, title, description, active, onClick, children }) {
  return (
    <article className={`setup-choice-card ${active ? 'active' : ''}`}>
      <button type="button" className="setup-choice-head" onClick={onClick} aria-expanded={active}>
        <span className="feature-icon"><Icon name={icon} size={22} /></span>
        <span className="setup-choice-copy">
          <strong>{title}</strong>
          <small className="setup-choice-description"><Icon name="info" size={13} /><span>{description}</span></small>
        </span>
        <Icon name={active ? 'chevron-up' : 'chevron'} size={18} />
      </button>
      {active && <div className="setup-choice-body">{children}</div>}
    </article>
  );
}

export function OnboardingPage() {
  const online = useOnlineStatus();
  const toast = useToast();
  const { profile, refreshIdentity, signOutLocal } = useAuth();
  const [mode, setMode] = useState('join');
  const [joinCode, setJoinCode] = useState('');
  const [hostelName, setHostelName] = useState('');
  const [hostelPermissionCode, setHostelPermissionCode] = useState('');
  const [hostelCodeRequired, setHostelCodeRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [createdHostel, setCreatedHostel] = useState(null);
  const [initialMonthStatus, setInitialMonthStatus] = useState('not-started');
  const [initialMonthError, setInitialMonthError] = useState('');

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themePreference = 'dark';
  }, []);

  useEffect(() => {
    let active = true;
    fetchPlatformPublicSettings().then((settings) => { if (active) setHostelCodeRequired(Boolean(settings?.hostel_creation_code_required)); }).catch(() => { /* Compatibility with pre-Phase-2 projects. */ });
    return () => { active = false; };
  }, []);

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
    if (code.length < 6) {
      toast.error('সঠিক Join Code দিন।');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('join_hostel', { p_join_code: code });
      if (error) throw error;
      toast.success('সফলভাবে মেসে যুক্ত হয়েছেন।');
      await refreshIdentity();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মেসে যুক্ত হওয়া যায়নি। Join Code যাচাই করুন।'));
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
      setCreatedHostel(newHostel);
      try {
        await ensureInitialRunningMonth();
        setInitialMonthStatus('started');
        setInitialMonthError('');
        toast.success(`“${newHostel?.name ?? hostelName.trim()}” মেস তৈরি হয়েছে এবং ${firstDayOfMonth(dhakaDateInputValue())} থেকে চলমান মাস শুরু হয়েছে।`);
      } catch (periodError) {
        setInitialMonthStatus('failed');
        setInitialMonthError(getFriendlySupabaseError(periodError, 'প্রথম মাস স্বয়ংক্রিয়ভাবে শুরু করা যায়নি।'));
        toast.warning('মেস তৈরি হয়েছে, কিন্তু প্রথম মাস শুরু হয়নি। নিচের “প্রথম মাস আবার শুরু করুন” বোতাম ব্যবহার করুন।');
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
            <OnboardingBrand title="মেস তৈরি সম্পন্ন" description="আপনার নতুন মেস প্রস্তুত। এখন সদস্যদের সঙ্গে যুক্ত হয়ে পরিচালনা শুরু করুন।" />
            <div className="creation-success-card">
              <div className="success-panel-icon"><Icon name="check" size={24} /></div>
              <span className="eyebrow">সেটআপ সম্পন্ন</span>
              <h2>“{createdHostel.name}” প্রস্তুত!</h2>
              <p>আপনি ম্যানেজার হিসেবে যুক্ত হয়েছেন। অন্য সদস্যদের এই Join Code দিন।</p>
              {initialMonthStatus === 'started' && <div className="inline-success"><Icon name="check-circle" size={17} /><span>চলতি মাসের ১ তারিখ থেকে প্রথম মাস চালু হয়েছে।</span></div>}
              {initialMonthStatus === 'failed' && <div className="inline-error"><Icon name="warning" size={17} /><span>মেস তৈরি হয়েছে, তবে প্রথম মাস চালু করা যায়নি। {initialMonthError || 'ইন্টারনেট ও Backend RPC যাচাই করে আবার চেষ্টা করুন।'}</span></div>}
              {initialMonthStatus === 'failed' && <button type="button" className="secondary-button" disabled={submitting || !online} onClick={retryInitialMonth}>{submitting ? 'চেষ্টা হচ্ছে...' : 'প্রথম মাস আবার শুরু করুন'}</button>}
              <div className="join-code-box">
                <span>Join Code</span>
                <strong>{createdHostel.join_code}</strong>
                <button type="button" className="secondary-button" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdHostel.join_code);
                    toast.success('Join Code কপি হয়েছে।');
                  } catch {
                    toast.info('Join Code কপি করা যায়নি। কোডটি হাতে কপি করুন।');
                  }
                }}>কপি করুন</button>
              </div>
              <button type="button" className="primary-button large" onClick={() => refreshIdentity()}>মেসে প্রবেশ করুন</button>
              <button type="button" className="onboarding-switch-account" onClick={switchAccount} disabled={switchingAccount || submitting}>{switchingAccount ? 'অ্যাকাউন্ট পরিবর্তন হচ্ছে...' : 'অন্য অ্যাকাউন্ট দিয়ে লগইন / রেজিস্ট্রেশন'}</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <div className="onboarding-main-card card">
          <OnboardingBrand
            title={`স্বাগতম, ${profile?.full_name?.split(' ')[0] || 'সদস্য'}!`}
            description="আপনার অ্যাকাউন্ট প্রস্তুত। এখন একটি মেসে যুক্ত হন অথবা নতুন মেস তৈরি করুন।"
          />

          <div className="onboarding-account-switch-row">
            <span>ভুল অ্যাকাউন্টে এসেছেন বা অন্য অ্যাকাউন্ট ব্যবহার করবেন?</span>
            <button type="button" className="onboarding-switch-account" onClick={switchAccount} disabled={switchingAccount || submitting}>
              <Icon name="logout" size={15} /> {switchingAccount ? 'অ্যাকাউন্ট পরিবর্তন হচ্ছে...' : 'লগইন / রেজিস্ট্রেশন পেজে ফিরুন'}
            </button>
          </div>

          <div className="onboarding-choice-intro">
            <span className="eyebrow">শুরু করার উপায়</span>
            <h2>আপনি কীভাবে শুরু করতে চান?</h2>
            <p>আপনার জন্য প্রযোজ্য একটি অপশন বেছে নিন।</p>
          </div>

          <div className="setup-choice-grid">
            <SetupCard
              icon="user-plus"
              title="মেসে যুক্ত হন"
              description="আপনার মেসের Join Code ব্যবহার করুন।"
              active={mode === 'join'}
              onClick={() => setMode('join')}
            >
              <form className="form-stack" onSubmit={join}>
                <label className="field-label">
                  <span>Join Code</span>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="যেমন: AB12CD34"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={12}
                    required
                  />
                </label>
                <button type="submit" className="primary-button large" disabled={submitting || !online}>
                  {submitting ? 'যুক্ত হচ্ছে...' : 'মেসে যুক্ত হন'}
                </button>
              </form>
            </SetupCard>

            <SetupCard
              icon="plus-circle"
              title="মেস তৈরি করুন"
              description="আপনার নিজের মেসের জন্য নতুন workspace তৈরি করুন।"
              active={mode === 'create'}
              onClick={() => setMode('create')}
            >
              <form className="form-stack" onSubmit={create}>
                <label className="field-label">
                  <span>মেসের নাম</span>
                  <input type="text" value={hostelName} onChange={(e) => setHostelName(e.target.value)} placeholder="যেমন: আল-আমিন মেস" maxLength={120} required />
                </label>
                {hostelCodeRequired && <label className="field-label"><span>মেস তৈরির অনুমতি কোড</span><input value={hostelPermissionCode} onChange={(e) => setHostelPermissionCode(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" required placeholder="Super Admin-এর দেওয়া কোড" /><small className="platform-form-help">কোডটি সার্ভারে যাচাই হবে এবং নির্দিষ্ট ব্যবহারের পর শেষ হবে।</small></label>}
                <button type="submit" className="primary-button large" disabled={submitting || !online}>
                  {submitting ? 'তৈরি হচ্ছে...' : 'মেস তৈরি করুন'}
                </button>
              </form>
            </SetupCard>
          </div>

          {!online && (
            <div className="inline-error onboarding-offline"><Icon name="offline" size={17} /><span>মেসে যুক্ত হওয়া বা নতুন মেস তৈরি করতে ইন্টারনেট সংযোগ চালু করুন।</span></div>
          )}

          <div className="onboarding-note">
            <Icon name="shield" size={17} />
            <span>একটি অ্যাকাউন্ট একসাথে শুধু একটি মেসের সঙ্গে যুক্ত থাকতে পারবে।</span>
          </div>
        </div>
      </section>
    </main>
  );

}
