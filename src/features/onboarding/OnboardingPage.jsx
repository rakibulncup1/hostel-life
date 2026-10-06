import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { Icon } from '../../components/Icon';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { supabase } from '../../lib/supabase';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';

function SetupCard({ icon, title, description, active, onClick, children }) {
  return (
    <article className={`setup-choice-card ${active ? 'active' : ''}`}>
      <button type="button" className="setup-choice-head" onClick={onClick} aria-expanded={active}>
        <span className="feature-icon"><Icon name={icon} size={22} /></span>
        <span className="setup-choice-copy">
          <strong>{title}</strong>
          <small>{description}</small>
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
  const { profile, refreshIdentity } = useAuth();
  const [mode, setMode] = useState('join');
  const [joinCode, setJoinCode] = useState('');
  const [hostelName, setHostelName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdHostel, setCreatedHostel] = useState(null);

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
      const { data, error } = await supabase.rpc('create_hostel', { p_name: hostelName.trim() });
      if (error) throw error;
      setCreatedHostel(data ?? null);
      toast.success(`“${data?.name ?? hostelName.trim()}” মেস সফলভাবে তৈরি হয়েছে।`);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মেস তৈরি করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  if (createdHostel) {
    return (
      <main className="onboarding-page">
        <section className="onboarding-shell">
          <div className="creation-success-card card">
            <div className="success-panel-icon"><Icon name="check" size={24} /></div>
            <span className="eyebrow">মেস তৈরি সম্পন্ন</span>
            <h1>“{createdHostel.name}” প্রস্তুত!</h1>
            <p>আপনি ম্যানেজার হিসেবে যুক্ত হয়েছেন। অন্য সদস্যদের এই Join Code দিন।</p>
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
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <div className="onboarding-hero">
          <div className="auth-brand-mark"><Icon name="home" size={26} /></div>
          <span className="auth-eyebrow">HOSTEL LIFE</span>
          <h1>স্বাগতম, {profile?.full_name?.split(' ')[0] || 'সদস্য'}!</h1>
          <p>আপনার অ্যাকাউন্ট প্রস্তুত। এখন একটি মেসে যুক্ত হন অথবা নতুন মেস তৈরি করুন।</p>
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
      </section>
    </main>
  );
}
