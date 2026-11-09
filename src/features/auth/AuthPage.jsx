import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { signIn, signUp, resendSignUpOtp, verifySignUpOtp, requestPasswordReset, updatePassword } from '../../services/authService';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPlatformPublicSettings } from '../../services/platformService';
import { applyTheme, getThemePreference } from '../../app/theme';
import { EntryThemeSwitcher } from '../../components/EntryThemeSwitcher';

function go(path, replace = false) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function formatOtpWait(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  const toBanglaDigits = (value) => String(value).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
  return `${toBanglaDigits(String(minutes).padStart(2, '0'))}:${toBanglaDigits(String(remainder).padStart(2, '0'))}`;
}

const authLinks = [
  { path: '/auth/login', label: 'লগইন' },
  { path: '/auth/register', label: 'রেজিস্ট্রেশন' },
];

const REGISTER_OTP_FLOW_KEY = 'hostel-life-register-otp-flow-v2';
const REGISTER_OTP_FLOW_MAX_AGE = 30 * 60 * 1000;

function readRegisterOtpFlow() {
  try {
    const raw = window.sessionStorage.getItem(REGISTER_OTP_FLOW_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const age = Date.now() - Number(value?.savedAt || 0);
    if (!value?.otpStep || !value?.email || !Number.isFinite(age) || age < 0 || age > REGISTER_OTP_FLOW_MAX_AGE) {
      window.sessionStorage.removeItem(REGISTER_OTP_FLOW_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function saveRegisterOtpFlow(value) {
  try { window.sessionStorage.setItem(REGISTER_OTP_FLOW_KEY, JSON.stringify({ ...value, savedAt: Date.now() })); }
  catch { /* OTP screen remains usable even when browser storage is unavailable. */ }
}

function clearRegisterOtpFlow() {
  try { window.sessionStorage.removeItem(REGISTER_OTP_FLOW_KEY); }
  catch { /* Browser storage can be restricted. */ }
}

function PasswordField({ value, onChange, placeholder = 'পাসওয়ার্ড', autoComplete = 'current-password' }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
      <button type="button" className="input-action" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}>
        <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
      </button>
    </div>
  );
}

function AuthFrame({ title, subtitle, children, compact = false, minimal = false }) {
  return (
    <main className={`auth-page ${minimal ? 'auth-page-verification' : ''}`}>
      <section className={`auth-shell ${compact ? 'auth-shell-compact' : ''} ${title === 'একটি অ্যাকাউন্ট তৈরি করুন' ? 'auth-shell-register' : ''} ${minimal ? 'auth-shell-verification' : ''}`}>
        <div className={`auth-brand-panel ${minimal ? 'auth-brand-panel-compact' : ''}`}>
          <div className="auth-brand-lockup">
            <div className="auth-brand-mark"><BrandMark size={64} /></div>
            <div className="auth-brand-identity">
              <span className="auth-eyebrow">HOSTEL LIFE</span>
              <small className="auth-brand-submark">MESS MANAGEMENT · MADE SIMPLE</small>
            </div>
          </div>
          {!minimal && <>
            <div className="auth-brand-highlight"><Icon name="sparkles" size={14} /> হিসাব ও ব্যবস্থাপনা, এক জায়গায়</div>
            <h1>হোস্টেল ব্যবস্থাপনা, সহজ ও গোছানো।</h1>
            <p>দৈনন্দিন হিসাব, সদস্য ও মেস পরিচালনা—সবকিছু এক জায়গায়।</p>
          </>}
        </div>
        <div className="auth-form-panel">
          <div className="auth-form-toolbar">
            <span className="auth-form-toolbar-label"><Icon name={minimal ? 'mail-check' : 'shield-check'} size={15} /> {minimal ? 'ইমেইল যাচাই' : 'নিরাপদ অ্যাকাউন্ট'}</span>
            <EntryThemeSwitcher />
          </div>
          <div className="auth-header">
            <div>
              {!minimal && <span className="eyebrow">{title === "আপনার অ্যাকাউন্টে প্রবেশ করুন" ? "আবারও স্বাগতম" : title === "একটি অ্যাকাউন্ট তৈরি করুন" ? "নতুন যাত্রা শুরু হোক" : "অ্যাকাউন্ট সহায়তা"}</span>}
              <h2>{title}</h2>
              {!minimal && <p>{subtitle}</p>}
            </div>
          </div>
          {children}
          {!minimal && <nav className="auth-legal-links" aria-label="আইনি তথ্য ও পরিচিতি">
            <a href="/about">Hostel Life সম্পর্কে</a>
            <a href="/privacy-policy">গোপনীয়তা</a>
            <a href="/terms-of-service">ব্যবহারের শর্ত</a>
          </nav>}
        </div>
      </section>
    </main>
  );
}

function LoginForm() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sessionPolicyNotice, setSessionPolicyNotice] = useState('');

  useEffect(() => {
    const readStoredNotice = () => {
      try {
        const message = window.sessionStorage.getItem('hostel-life-session-limit-notice-v1');
        if (message) {
          setSessionPolicyNotice(message);
          window.sessionStorage.removeItem('hostel-life-session-limit-notice-v1');
        }
      } catch { /* The inline message is best-effort when browser storage is unavailable. */ }
    };
    const onSessionLimitNotice = (event) => {
      const message = event?.detail?.message;
      if (typeof message === 'string' && message.trim()) setSessionPolicyNotice(message);
      else readStoredNotice();
    };
    window.addEventListener('hostel-life-session-limit-notice', onSessionLimitNotice);
    readStoredNotice();
    return () => window.removeEventListener('hostel-life-session-limit-notice', onSessionLimitNotice);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('লগইন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await signIn({ email, password });
      if (error) throw error;
      // Do not call refreshIdentity from this LoginForm render: its callback can
      // still close over the pre-login (null) session. AuthProvider observes the
      // SIGNED_IN event and performs exactly one identity load for that session.
      toast.success('সফলভাবে লগইন হয়েছে।');
    } catch (error) {
      if (error?.code === 'SESSION_LIMIT_EXCEEDED' || error?.code === 'SESSION_LIMIT_SIGNOUT_FAILED') {
        setSessionPolicyNotice(error.message);
      } else {
        toast.error(getFriendlySupabaseError(error, 'লগইন করা যায়নি। তথ্যগুলো আবার যাচাই করুন।'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="আপনার অ্যাকাউন্টে প্রবেশ করুন" subtitle="চালিয়ে যেতে আপনার তথ্য দিন।">
      {sessionPolicyNotice && <div className="auth-session-dialog-backdrop" role="presentation"><section className="auth-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="auth-session-dialog-title" aria-describedby="auth-session-dialog-description"><span className="auth-session-dialog-icon"><Icon name="shield-alert" size={25}/></span><h3 id="auth-session-dialog-title">নিরাপত্তার কারণে লগআউট</h3><p id="auth-session-dialog-description">{sessionPolicyNotice}</p><button type="button" className="primary-button large" onClick={() => setSessionPolicyNotice('')}>বুঝেছি, আবার লগইন করব</button></section></div>}
      <form className="form-stack" onSubmit={submit}>
        <label className="field-label">
          <span>ইমেইল</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="আপনার ইমেইল" autoComplete="email" required />
        </label>
        <label className="field-label">
          <span>পাসওয়ার্ড</span>
          <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="button" className="text-button align-end" onClick={() => go('/auth/forgot-password')}>পাসওয়ার্ড ভুলে গেছেন?</button>
        <button className="primary-button large" type="submit" disabled={submitting || !online}>
          {submitting ? 'লগইন হচ্ছে...' : 'অ্যাকাউন্টে প্রবেশ করুন'}
        </button>
      </form>
      <AuthSwitch current="login" />
    </AuthFrame>
  );
}

function RegisterForm() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [restoredOtpFlow] = useState(() => readRegisterOtpFlow());
  const [name, setName] = useState(() => restoredOtpFlow?.name || '');
  const [phone, setPhone] = useState(() => restoredOtpFlow?.phone || '');
  const [email, setEmail] = useState(() => restoredOtpFlow?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [permissionCode, setPermissionCode] = useState(() => restoredOtpFlow?.permissionCode || '');
  const [registrationCodeRequired, setRegistrationCodeRequired] = useState(false);
  const [eligibilityAccepted, setEligibilityAccepted] = useState(() => Boolean(restoredOtpFlow?.eligibilityAccepted));
  const [submitting, setSubmitting] = useState(false);
  const [otpStep, setOtpStep] = useState(() => Boolean(restoredOtpFlow?.otpStep));
  const [verificationCode, setVerificationCode] = useState('');
  const [resendUntil, setResendUntil] = useState(() => Number(restoredOtpFlow?.resendUntil) || 0);
  const [resendCountdown, setResendCountdown] = useState(() => Math.max(0, Math.ceil((Number(restoredOtpFlow?.resendUntil || 0) - Date.now()) / 1000)));

  useEffect(() => {
    if (!otpStep) return undefined;
    const refreshCountdown = () => setResendCountdown(Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000)));
    refreshCountdown();
    const timer = window.setInterval(refreshCountdown, 1000);
    window.addEventListener('pageshow', refreshCountdown);
    document.addEventListener('visibilitychange', refreshCountdown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pageshow', refreshCountdown);
      document.removeEventListener('visibilitychange', refreshCountdown);
    };
  }, [otpStep, resendUntil]);

  useEffect(() => {
    if (!otpStep) return;
    saveRegisterOtpFlow({
      otpStep: true,
      email,
      name,
      phone,
      permissionCode,
      eligibilityAccepted,
      resendUntil,
    });
  }, [otpStep, email, name, phone, permissionCode, eligibilityAccepted, resendUntil]);

  useEffect(() => {
    let active = true;
    fetchPlatformPublicSettings().then((settings) => {
      if (active) setRegistrationCodeRequired(Boolean(settings?.registration_code_required));
    }).catch(() => { /* Older installations have no platform settings RPC; DB remains authoritative. */ });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('রেজিস্ট্রেশন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (otpStep) {
      const code = verificationCode.replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) return toast.warning('ইমেইলে পাঠানো ছয় সংখ্যার কোডটি লিখুন।');
      setSubmitting(true);
      try {
        const { data, error } = await verifySignUpOtp(email, code);
        if (error) throw error;
        clearRegisterOtpFlow();
        if (data?.session) toast.success('ইমেইল যাচাই সম্পন্ন হয়েছে। আপনার অ্যাকাউন্ট প্রস্তুত।');
        else { toast.success('ইমেইল যাচাই হয়েছে। এখন লগইন করুন।'); go('/auth/login'); }
      } catch (error) {
        toast.error(getFriendlySupabaseError(error, 'ভেরিফিকেশন কোড সঠিক নয় বা মেয়াদ শেষ হয়েছে। আবার চেষ্টা করুন।'));
      } finally { setSubmitting(false); }
      return;
    }
    if (!eligibilityAccepted) {
      toast.error('রেজিস্ট্রেশনের আগে বয়স ও নীতিমালায় সম্মতি নিশ্চিত করুন।');
      return;
    }
    if (name.trim().length < 2) {
      toast.error('নাম কমপক্ষে ২ অক্ষরের হতে হবে।');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      toast.error('সঠিক মোবাইল নম্বর দিন (৮–১৫টি সংখ্যা)।');
      return;
    }

    if (password.length < 8) {
      toast.error('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের দিন।');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('দুইটি পাসওয়ার্ড একই নয়।');
      return;
    }

    setSubmitting(true);
    try {
      const acceptedAt = new Date().toISOString();
      const { data, error } = await signUp({
        fullName: name, phone, email, password, permissionCode,
        age18PlusConfirmed: true,
        ageConfirmationAt: acceptedAt,
        termsAcceptedAt: acceptedAt,
        privacyPolicyAcceptedAt: acceptedAt,
        legalPolicyVersion: '2026-11-04',
      });
      if (error) throw error;

      if (data.session) {
        clearRegisterOtpFlow();
        toast.success('অ্যাকাউন্ট তৈরি হয়েছে। এখন মেসে যুক্ত হন।');
      } else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট থাকতে পারে। লগইন বা পাসওয়ার্ড পুনরুদ্ধার ব্যবহার করুন।');
      } else {
        const nextResendUntil = Date.now() + (120 * 1000);
        saveRegisterOtpFlow({ otpStep: true, email, name, phone, permissionCode, eligibilityAccepted, resendUntil: nextResendUntil });
        setOtpStep(true);
        setVerificationCode('');
        setResendUntil(nextResendUntil);
        setResendCountdown(120);
        toast.success('ভেরিফিকেশন কোড পাঠানো হয়েছে। Inbox দেখুন।');
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রেজিস্ট্রেশন করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (!otpStep || resendCountdown > 0 || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await resendSignUpOtp(email);
      if (error) throw error;
      const nextResendUntil = Date.now() + (120 * 1000);
      setResendUntil(nextResendUntil);
      setResendCountdown(120);
      toast.success('নতুন কোড পাঠানো হয়েছে।');
    } catch (error) {
      if (error?.retryAt) {
        const retrySeconds = Math.ceil((new Date(error.retryAt).getTime() - Date.now()) / 1000);
        if (Number.isFinite(retrySeconds) && retrySeconds > 0) setResendUntil(Date.now() + (retrySeconds * 1000));
      }
      toast.error(getFriendlySupabaseError(error, 'কোড পুনরায় পাঠানো যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন.'));
    } finally { setSubmitting(false); }
  };

  return (
    <AuthFrame
      compact={otpStep}
      minimal={otpStep}
      title={otpStep ? 'ইমেইল যাচাই' : 'একটি অ্যাকাউন্ট তৈরি করুন'}
      subtitle={otpStep ? 'আপনার ইমেইলে পাঠানো ছয় সংখ্যার কোডটি লিখুন।' : 'কয়েকটি তথ্য দিয়ে নিরাপদে অ্যাকাউন্ট তৈরি করুন।'}
    >
      <form className={`form-stack auth-register-form ${otpStep ? 'auth-verification-form' : ''}`} onSubmit={submit}>
        {otpStep ? (
          <>
            <div className="auth-verification-email" aria-label={`কোড পাঠানো হয়েছে ${email} ঠিকানায়`}>
              <span className="auth-verification-email-icon"><Icon name="mail-check" size={19} /></span>
              <span className="auth-verification-email-copy">
                <small>ভেরিফিকেশন কোড পাঠানো হয়েছে</small>
                <strong>{email}</strong>
              </span>
            </div>
            <div className="auth-verification-mail-tip"><Icon name="mail" size={14} /><span>Inbox-এ না পেলে Spam বা Promotions ফোল্ডার দেখুন।</span></div>
            <label className="field-label auth-otp-field">
              <span>৬ সংখ্যার কোড</span>
              <input
                className="auth-otp-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                aria-label="ছয় সংখ্যার ভেরিফিকেশন কোড"
                required
              />
            </label>
            <button className="primary-button large auth-verification-submit" type="submit" disabled={submitting || !online || verificationCode.length !== 6}>
              {submitting ? 'যাচাই হচ্ছে...' : 'ইমেইল যাচাই করুন'}
            </button>
            <div className="auth-verification-actions">
              <div className="auth-otp-resend-cluster">
                <span className="auth-otp-countdown" aria-live="polite"><Icon name="clock" size={13} /> {resendCountdown > 0 ? `${formatOtpWait(resendCountdown)} পরে আবার পাঠানো যাবে` : 'কোড পাননি?'}</span>
                <button type="button" className="auth-otp-resend" onClick={resendCode} disabled={submitting || resendCountdown > 0 || !online}>
                  <Icon name="refresh-cw" size={14} /> কোড আবার পাঠান
                </button>
              </div>
              <button className="text-button auth-otp-edit" type="button" disabled={submitting} onClick={() => { clearRegisterOtpFlow(); setOtpStep(false); setVerificationCode(''); setResendUntil(0); setResendCountdown(0); }}>
                <Icon name="arrow-left" size={14} /> রেজিস্ট্রেশনে ফিরে যান
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="two-field-grid">
              <label className="field-label">
                <span>নাম</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="আপনার নাম" autoComplete="name" required />
              </label>
              <label className="field-label">
                <span>মোবাইল নম্বর</span>
                <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" autoComplete="tel" required minLength={8} maxLength={20} />
              </label>
            </div>
            <label className="field-label">
              <span>ইমেইল</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="আপনার ইমেইল" autoComplete="email" required />
              <small className="register-email-note"><Icon name="mail" size={13} /> অ্যাকাউন্ট যাচাই ও পাসওয়ার্ড পুনরুদ্ধারের জন্য সচল ইমেইল ব্যবহার করুন।</small>
            </label>
            <label className="field-label">
              <span>পাসওয়ার্ড</span>
              <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="কমপক্ষে ৮ অক্ষর" autoComplete="new-password" />
            </label>
            <label className="field-label">
              <span>পাসওয়ার্ড আবার দিন</span>
              <PasswordField value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="একই পাসওয়ার্ড আবার" autoComplete="new-password" />
            </label>
            {registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড</span><input value={permissionCode} onChange={(e) => setPermissionCode(e.target.value.toUpperCase())} autoCapitalize="characters" maxLength={20} required placeholder="Super Admin-এর দেওয়া কোড" /><small className="platform-form-help">নতুন অ্যাকাউন্ট খোলার অনুমতি যাচাই করতে কোডটি লাগবে।</small></label>}
            <label className="auth-legal-consent auth-combined-consent">
              <input type="checkbox" checked={eligibilityAccepted} onChange={(event) => setEligibilityAccepted(event.target.checked)} required />
              <span>আমি নিশ্চিত করছি, আমার বয়স কমপক্ষে ১৮ বছর এবং <a href="/terms-of-service" target="_blank" rel="noreferrer">ব্যবহারের শর্তাবলী</a> ও <a href="/privacy-policy" target="_blank" rel="noreferrer">গোপনীয়তা নীতি</a> মেনে নিচ্ছি।</span>
            </label>
            <button className="primary-button large" type="submit" disabled={submitting || !online || !eligibilityAccepted}>
              {submitting ? 'কোড পাঠানো হচ্ছে...' : 'ভেরিফিকেশন কোড পাঠান'}
            </button>
          </>
        )}
      </form>
      {!otpStep && <AuthSwitch current="register" />}
    </AuthFrame>
  );
}

function AuthSwitch({ current }) {
  return (
    <div className="auth-switch">
      <span>{current === 'login' ? 'এখনো অ্যাকাউন্ট নেই?' : 'ইতিমধ্যে অ্যাকাউন্ট আছে?'}</span>
      {authLinks.filter((link) => link.path !== `/auth/${current}`).map((link) => (
        <button type="button" className="text-button" key={link.path} onClick={() => go(link.path)}>{link.label}</button>
      ))}
    </div>
  );
}

function ForgotPasswordForm() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('পাসওয়ার্ড রিসেট করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setSubmitting(true);
    setSent(false);
    setLimitMessage('');
    try {
      const { error } = await requestPasswordReset(email);
      if (error) {
        if (error.code === 'PASSWORD_RESET_DAILY_LIMIT' || error.code === 'PASSWORD_RESET_MONTHLY_LIMIT') {
          setLimitMessage(error.message);
          toast.warning(error.message, { duration: 7000 });
          return;
        }
        if (error.code === 'SUPABASE_EMAIL_RATE_LIMIT') {
          toast.warning(error.message, { duration: 6500 });
          return;
        }
        throw error;
      }
      setLimitMessage('');
      setSent(true);
      toast.success('যদি এই ইমেইলে Hostel Life অ্যাকাউন্ট থাকে, রিসেট নির্দেশনা পাঠানো হলে ইনবক্স দেখুন।', { duration: 6500 });
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিসেট ইমেইল পাঠানো যায়নি।'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame compact title="পাসওয়ার্ড পুনরুদ্ধার" subtitle="ইমেইলে পাসওয়ার্ড পরিবর্তনের লিংক পাঠানো হবে।">
      <form className="form-stack" onSubmit={submit}>
        <label className="field-label">
          <span>ইমেইল</span>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setLimitMessage(''); setSent(false); }} placeholder="যে ইমেইলে অ্যাকাউন্ট আছে" autoComplete="email" required />
        </label>
        <aside className="password-reset-policy" role="note" aria-label="পাসওয়ার্ড রিসেটের সীমা">
          <div className="password-reset-policy-title"><Icon name="info" size={17} /><strong>পাসওয়ার্ড রিসেটের নিয়ম</strong></div>
          <p>নিরাপত্তার জন্য একটি ইমেইল থেকে দিনে সর্বোচ্চ ২ বার এবং প্রতি ক্যালেন্ডার মাসে সর্বোচ্চ ৫ বার রিসেটের অনুরোধ করা যাবে।</p>
          <p>মাসিক সীমা পূর্ণ হলে Help Section থেকে Hostel Life Support এ যোগাযোগ করুন। পরিচয় যাচাইয়ের পর Admin প্রয়োজনে Temporary Password দেবেন। সেটি দিয়ে লগইন করে বাধ্যতামূলকভাবে নতুন পাসওয়ার্ড তৈরি করতে হবে।</p>
        </aside>
        {limitMessage && <div className="inline-error" role="alert"><Icon name="warning" size={17} /><span>{limitMessage}</span></div>}
        {sent && <div className="inline-success"><Icon name="check" size={17} /><span>যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট নির্দেশনা পাঠানো হলে আপনার ইনবক্স দেখুন।</span></div>}
        <button className="primary-button large" type="submit" disabled={submitting || !online}>
          {submitting ? 'পাঠানো হচ্ছে...' : 'রিসেট লিংক পাঠান'}
        </button>
        <button type="button" className="secondary-button" onClick={() => go('/auth/login')}><Icon name="chevron" size={16} className="rotate-180" /> আগের পৃষ্ঠায় যান</button>
      </form>
    </AuthFrame>
  );
}

function ResetPasswordForm() {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const { session, authLoading } = useAuth();

  const canReset = useMemo(() => Boolean(session), [session]);

  const submit = async (event) => {
    event.preventDefault();
    if (!canReset) {
      toast.error('রিসেট লিংক সঠিক নয় অথবা মেয়াদ শেষ হয়েছে। আবার পাসওয়ার্ড পুনরুদ্ধার করুন।');
      return;
    }
    if (password.length < 8) {
      toast.error('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের দিন।');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('দুইটি পাসওয়ার্ড একই নয়।');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setDone(true);
      toast.success('পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'পাসওয়ার্ড পরিবর্তন করা যায়নি।'));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <AuthFrame compact title="পাসওয়ার্ড পুনরুদ্ধার" subtitle="নিরাপদভাবে যাচাই করা হচ্ছে..."><div className="loading-wrap auth-loading"><span className="spinner" /><span>যাচাই হচ্ছে...</span></div></AuthFrame>;
  }

  return (
    <AuthFrame compact title="নতুন পাসওয়ার্ড" subtitle="নতুন পাসওয়ার্ড নির্ধারণ করুন।">
      {!session && !done && (
        <div className="inline-error"><Icon name="warning" size={17} /><span>এই পৃষ্ঠায় পাসওয়ার্ড পরিবর্তনের বৈধ সেশন পাওয়া যায়নি।</span></div>
      )}
      {done ? (
        <div className="success-panel">
          <span className="success-panel-icon"><Icon name="check" size={24} /></span>
          <h3>পাসওয়ার্ড পরিবর্তন সম্পন্ন</h3>
          <p>এখন নতুন পাসওয়ার্ড দিয়ে লগইন করতে পারবেন।</p>
          <button className="primary-button" type="button" onClick={() => go('/auth/login', true)}>লগইনে যান</button>
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <label className="field-label">
            <span>নতুন পাসওয়ার্ড</span>
            <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="কমপক্ষে ৮ অক্ষর" autoComplete="new-password" />
          </label>
          <label className="field-label">
            <span>নতুন পাসওয়ার্ড আবার দিন</span>
            <PasswordField value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="একই পাসওয়ার্ড আবার" autoComplete="new-password" />
          </label>
          <button className="primary-button large" type="submit" disabled={submitting || !session}>
            {submitting ? 'পরিবর্তন হচ্ছে...' : 'পাসওয়ার্ড পরিবর্তন করুন'}
          </button>
          <button type="button" className="secondary-button" onClick={() => go('/auth/login')}><Icon name="chevron" size={16} className="rotate-180" /> আগের পৃষ্ঠায় যান</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function AuthPage({ pathname }) {
  useLayoutEffect(() => {
    // AppShell owns the signed-in theme. After logout it unmounts, so its last
    // data-theme value can otherwise leak into the public auth screen until a
    // full refresh. Apply the public palette before paint; the saved preference
    // is preserved and AppShell reapplies it after the next successful login.
    applyTheme(getThemePreference());
  }, [pathname]);

  useEffect(() => {
    document.title = pathname.endsWith('register') ? 'Hostel Life — রেজিস্ট্রেশন' : pathname.endsWith('forgot-password') ? 'Hostel Life — পাসওয়ার্ড পুনরুদ্ধার' : pathname.endsWith('reset-password') ? 'Hostel Life — নতুন পাসওয়ার্ড' : 'Hostel Life — লগইন';
  }, [pathname]);

  if (pathname === '/auth/register') return <RegisterForm />;
  if (pathname === '/auth/forgot-password') return <ForgotPasswordForm />;
  if (pathname === '/auth/reset-password') return <ResetPasswordForm />;
  return <LoginForm />;
}
