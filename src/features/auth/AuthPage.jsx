import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { signIn, signUp, resendSignUpOtp, verifySignUpOtp, requestPasswordReset, updatePassword } from '../../services/authService';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPlatformPublicSettings } from '../../services/platformService';
import { applyTheme, getThemePreference } from '../../app/theme';
import { getUiLocale } from '../../i18n/locale.js';
import { GOOGLE_OAUTH_FEATURE_ENABLED, prepareGoogleOAuth, completeGoogleOAuthCredential, refreshPendingGoogleOAuthProfile, clearPendingGoogleOAuth } from '../../services/googleOAuthService';

function go(path, replace = false) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function formatOtpWait(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  const formatter = new Intl.NumberFormat(getUiLocale(), { minimumIntegerDigits: 2, useGrouping: false });
  return `${formatter.format(minutes)}:${formatter.format(remainder)}`;
}

function getGoogleConsentRequiredMessage() {
  return getUiLocale() === 'en-US'
    ? 'To continue with Google, confirm that you are at least 18 and check the box to accept the Terms of Service and Privacy Policy.'
    : 'Google-এর মাধ্যমে চালিয়ে যেতে আপনার বয়স কমপক্ষে ১৮ বছর—এটি নিশ্চিত করুন এবং ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি জানিয়ে বক্সে টিক দিন।';
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

function GoogleBrandMark() {
  return (
    <span className="google-signin-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation" focusable="false">
        <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.4-1.9 4.4-3.9 5.8l6.3 4.9c3.7-3.4 6.2-8.5 6.2-14.4Z"/>
        <path fill="#34A853" d="M24 44c5.4 0 10-1.8 13.4-5l-6.3-4.9c-1.7 1.1-4 1.8-7.1 1.8-5.4 0-10-3.6-11.6-8.5l-6.5 5C9.3 39.3 16 44 24 44Z"/>
        <path fill="#FBBC05" d="M12.4 27.4c-.4-1.1-.7-2.3-.7-3.6s.2-2.5.7-3.6l-6.5-5C4.7 17.6 3.8 20.6 3.8 23.8s.9 6.2 2.1 8.6l6.5-5Z"/>
        <path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.8 29.4 3.8 24 3.8c-8 0-14.7 4.7-18.1 11.4l6.5 5c1.6-4.9 6.2-8.4 11.6-8.4Z"/>
      </svg>
    </span>
  );
}

let googleIdentityServicesPromise = null;

function loadGoogleIdentityServices(locale = 'bn') {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleIdentityServicesPromise) {
    googleIdentityServicesPromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-hostel-google-identity]');
      if (script?.dataset.loaded === 'true' && window.google?.accounts?.id) {
        resolve();
        return;
      }
      const onLoad = () => {
        if (window.google?.accounts?.id) {
          script.dataset.loaded = 'true';
          resolve();
        } else {
          reject(new Error('Google Identity Services লোড হয়েছে, কিন্তু button API পাওয়া যায়নি।'));
        }
      };
      const onError = () => {
        if (script?.dataset.hostelGoogleIdentity === 'true') script.remove();
        reject(new Error('Google sign-in service লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।'));
      };
      if (!script) {
        script = document.createElement('script');
        // Google recommends the hl query parameter for localizing the GIS
        // library itself. renderButton.locale below keeps the button language
        // aligned with the in-app language after a consent change.
        const googleLanguage = locale === 'en' ? 'en' : 'bn';
        script.src = `https://accounts.google.com/gsi/client?hl=${googleLanguage}`;
        script.async = true;
        script.defer = true;
        script.dataset.hostelGoogleIdentity = 'true';
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', onError, { once: true });
        document.head.appendChild(script);
      } else {
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', onError, { once: true });
      }
    }).catch((error) => {
      googleIdentityServicesPromise = null;
      throw error;
    });
  }
  return googleIdentityServicesPromise;
}

function GoogleSignInButton({ mode = 'login', fullName = '', phone = '', disabled = false, consentAccepted = true, loading = false, onError, onSuccess, onLoading, onNeedConsent }) {
  const hostRef = useRef(null);
  const callbacksRef = useRef({});
  const renderButtonRef = useRef(null);
  const [uiState, setUiState] = useState(disabled ? 'disabled' : (consentAccepted ? 'loading' : 'awaiting-consent'));
  const [english, setEnglish] = useState(() => getUiLocale() === 'en-US');
  const [darkTheme, setDarkTheme] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const [retryCount, setRetryCount] = useState(0);
  callbacksRef.current = { onError, onSuccess, onLoading, onNeedConsent };

  useEffect(() => {
    const updateLocale = () => setEnglish(getUiLocale() === 'en-US');
    const updateTheme = () => setDarkTheme(document.documentElement.getAttribute('data-theme') === 'dark');
    window.addEventListener('hostel-life-language-changed', updateLocale);
    window.addEventListener('hostel-life-theme-change', updateTheme);
    return () => {
      window.removeEventListener('hostel-life-language-changed', updateLocale);
      window.removeEventListener('hostel-life-theme-change', updateTheme);
    };
  }, []);

  renderButtonRef.current = () => {
    const googleId = window.google?.accounts?.id;
    const host = hostRef.current;
    if (!googleId || !host) return;
    const width = Math.max(200, Math.min(400, Math.floor(host.getBoundingClientRect().width || 400)));
    host.replaceChildren();
    googleId.renderButton(host, {
      type: 'standard',
      theme: 'filled_blue',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'center',
      width,
      // Keep Google's official button label in the selected app language.
      locale: english ? 'en' : 'bn',
    });
  };

  useEffect(() => {
    let cancelled = false;
    if (disabled || !consentAccepted) {
      clearPendingGoogleOAuth();
      setUiState(disabled ? 'disabled' : 'awaiting-consent');
      if (hostRef.current) hostRef.current.replaceChildren();
      return undefined;
    }
    setUiState('loading');
    (async () => {
      const prepared = await prepareGoogleOAuth({
        mode,
        fullName,
        phone,
        eligibilityAccepted: true,
      });
      await loadGoogleIdentityServices(english ? 'en' : 'bn');
      if (cancelled || !hostRef.current) return;
      const googleId = window.google?.accounts?.id;
      if (!googleId) throw new Error('Google sign-in button প্রস্তুত করা যায়নি।');
      googleId.initialize({
        client_id: prepared.clientId,
        nonce: prepared.hashedNonce,
        context: mode === 'register' ? 'signup' : 'signin',
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
        callback: async (response) => {
          if (!response?.credential) {
            callbacksRef.current.onError?.(new Error('Google থেকে পরিচয় যাচাইয়ের তথ্য পাওয়া যায়নি। আবার চেষ্টা করুন।'));
            return;
          }
          callbacksRef.current.onLoading?.(true);
          try {
            await completeGoogleOAuthCredential(response.credential);
            callbacksRef.current.onSuccess?.();
          } catch (error) {
            clearPendingGoogleOAuth();
            callbacksRef.current.onError?.(error);
          } finally {
            callbacksRef.current.onLoading?.(false);
          }
        },
      });
      renderButtonRef.current?.();
      if (!cancelled) setUiState('ready');
    })().catch((error) => {
      if (!cancelled) {
        setUiState('error');
        callbacksRef.current.onError?.(error);
      }
    });
    return () => { cancelled = true; };
  }, [mode, disabled, consentAccepted, retryCount]);

  // Locale/theme changes re-render the official Google button without resetting
  // the credential callback and nonce configuration unnecessarily.
  useEffect(() => {
    if (uiState === 'ready') renderButtonRef.current?.();
  }, [english, darkTheme, uiState]);

  useEffect(() => {
    if (!disabled && consentAccepted) refreshPendingGoogleOAuthProfile({ fullName, phone });
  }, [fullName, phone, disabled, consentAccepted]);

  const awaitingConsent = !disabled && !consentAccepted;
  const retryAvailable = !disabled && consentAccepted && uiState === 'error';
  const usePlaceholder = disabled || awaitingConsent || uiState !== 'ready';
  const placeholderDisabled = disabled || loading || uiState === 'loading' || (!awaitingConsent && !retryAvailable);
  const placeholderLabel = loading
    ? (english ? 'Connecting to Google…' : 'Google-এ সংযোগ হচ্ছে…')
    : awaitingConsent
      ? (english ? 'Continue with Google' : 'Google দিয়ে চালিয়ে যান')
      : retryAvailable
        ? (english ? 'Try Google again' : 'আবার Google দিয়ে চেষ্টা করুন')
        : (english ? 'Continue with Google' : 'Google দিয়ে চালিয়ে যান');

  return (
    <div className={`google-signin-widget ${loading ? 'is-loading' : ''}`} aria-busy={loading || uiState === 'loading'}>
      <div ref={hostRef} className="google-signin-sdk-slot" hidden={usePlaceholder} />
      {usePlaceholder && (
        <button
          type="button"
          className="google-signin-button"
          disabled={placeholderDisabled}
          aria-disabled={placeholderDisabled ? 'true' : 'false'}
          onClick={() => {
            if (awaitingConsent) callbacksRef.current.onNeedConsent?.();
            else if (retryAvailable) setRetryCount((value) => value + 1);
          }}
        >
          <GoogleBrandMark />
          <span>{placeholderLabel}</span>
        </button>
      )}
      {retryAvailable && <p className="google-signin-help">{english ? 'Check your connection and Google Client ID / allowed origin, then retry.' : 'ইন্টারনেট, Google Client ID এবং অনুমোদিত website origin পরীক্ষা করে আবার চেষ্টা করুন।'}</p>}
      {loading && <span className="google-signin-progress" role="status">{english ? 'Connecting to Google…' : 'Google-এ সংযোগ হচ্ছে…'}</span>}
    </div>
  );
}

function GoogleSignInDivider() {
  const english = getUiLocale() === 'en-US';
  return <div className="google-signin-divider"><span>{english ? 'or' : 'অথবা'}</span></div>;
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
      <section className={`auth-shell ${compact ? 'auth-shell-compact' : ''} ${title === 'একটি অ্যাকাউন্ট তৈরি করুন' ? 'auth-shell-register' : title === 'অ্যাকাউন্টে প্রবেশ করুন' ? 'auth-shell-login' : ''} ${minimal ? 'auth-shell-verification' : ''}`}>
        <div className={`auth-brand-panel ${minimal ? 'auth-brand-panel-compact' : ''}`}>
          <div className="auth-brand-lockup">
            <div className="auth-brand-mark"><BrandMark size={64} /></div>
            <div className="auth-brand-identity">
              <span className="auth-brand-name">Hostel Life</span>
            </div>
          </div>
          {!minimal && <p className="auth-brand-quote">মিল, বাজার ও হিসাব—এক জায়গায়, স্বচ্ছতা ও আস্থার সঙ্গে।</p>}
          {!minimal && <div className="auth-brand-feature-list" aria-label="Hostel Life-এর সুবিধা">
            <span><Icon name="utensils" size={15} /> মিলের হিসাব</span>
            <span><Icon name="shopping-bag" size={15} /> বাজার ও জমা</span>
            <span><Icon name="activity" size={15} /> মাসিক রিপোর্ট</span>
          </div>}
        </div>
        <div className="auth-form-panel">
          {compact && !minimal && <div className="auth-compact-brand"><BrandMark size={34} /><span>Hostel Life</span></div>}
          <div className="auth-form-toolbar">
            <span className="auth-form-toolbar-label auth-toolbar-pill"><Icon name={minimal ? 'mail-check' : 'shield-check'} size={15} /> {minimal ? 'ইমেইল যাচাই' : 'নিরাপদ অ্যাকাউন্ট'}</span>
          </div>
          <div className="auth-header">
            <div className="auth-header-copy">
              {!minimal && <span className="eyebrow">{title === "অ্যাকাউন্টে প্রবেশ করুন" ? "আবারও স্বাগতম" : title === "একটি অ্যাকাউন্ট তৈরি করুন" ? "নতুন যাত্রা শুরু হোক" : "অ্যাকাউন্ট সহায়তা"}</span>}
              <h2 data-i18n-key={title === 'অ্যাকাউন্টে প্রবেশ করুন' ? 'auth.login.heading' : undefined}>{title}</h2>
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
  const [googleEligibilityAccepted, setGoogleEligibilityAccepted] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const googleConsentRef = useRef(null);

  const focusGoogleConsent = () => {
    googleConsentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    googleConsentRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

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
    <AuthFrame
      title="অ্যাকাউন্টে প্রবেশ করুন"
      subtitle="আপনার ইমেইল ও পাসওয়ার্ড দিয়ে নিরাপদে প্রবেশ করুন।"
    >
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
        <button className="primary-button large" type="submit" disabled={submitting || !online}>
          {submitting ? 'লগইন হচ্ছে...' : 'অ্যাকাউন্টে প্রবেশ করুন'}
        </button>
      </form>
      {GOOGLE_OAUTH_FEATURE_ENABLED && <div className="google-signin-section">
        <GoogleSignInDivider />
        <label ref={googleConsentRef} className="auth-legal-consent google-signin-consent">
          <input type="checkbox" checked={googleEligibilityAccepted} onChange={(event) => setGoogleEligibilityAccepted(event.target.checked)} />
          <span>আমি নিশ্চিত করছি, আমার বয়স কমপক্ষে ১৮ বছর এবং <a href="/terms-of-service" target="_blank" rel="noreferrer">ব্যবহারের শর্তাবলী</a> ও <a href="/privacy-policy" target="_blank" rel="noreferrer">গোপনীয়তা নীতি</a> মেনে নিচ্ছি।</span>
        </label>
        <GoogleSignInButton
          mode="login"
          disabled={!online}
          consentAccepted={googleEligibilityAccepted}
          onNeedConsent={() => {
            focusGoogleConsent();
            toast.error(getGoogleConsentRequiredMessage());
          }}
          loading={googleSubmitting}
          onLoading={setGoogleSubmitting}
          onSuccess={() => go('/auth/google-callback', true)}
          onError={(error) => toast.error(getFriendlySupabaseError(error, error?.message || 'Google দিয়ে প্রবেশ করা যায়নি।'))}
        />
      </div>}
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
  const [registrationPolicyStatus, setRegistrationPolicyStatus] = useState('loading');
  const [eligibilityAccepted, setEligibilityAccepted] = useState(() => Boolean(restoredOtpFlow?.eligibilityAccepted));
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const registerConsentRef = useRef(null);
  const focusRegisterConsent = () => {
    registerConsentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    registerConsentRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };
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
      if (!active) return;
      if (typeof settings?.registration_code_required !== 'boolean') {
        // Fail closed for email/password registration if the policy cannot be read.
        // Google registration is independent of this UI state; the database trigger
        // applies its provider-specific exception after validating Google's token.
        setRegistrationCodeRequired(true);
        setRegistrationPolicyStatus('unavailable');
        return;
      }
      setRegistrationCodeRequired(settings.registration_code_required);
      setRegistrationPolicyStatus('loaded');
    }).catch(() => {
      // Keep email/password registration fail-closed until the policy is known.
      // Google sign-up is separate and remains available after 18+ consent.
      if (active) {
        setRegistrationCodeRequired(true);
        setRegistrationPolicyStatus('unavailable');
      }
    });
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
        legalPolicyVersion: '2026-11-20',
      });
      if (error) throw error;

      if (data.session) {
        clearRegisterOtpFlow();
        toast.success('অ্যাকাউন্ট তৈরি হয়েছে। এখন মেসে যুক্ত হন।');
      } else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // Supabase intentionally returns an empty identities array for an existing
        // email. Always route to verification: a resend can be temporarily rate-limited,
        // but the user may still have a valid code in the inbox.
        const { error: resendError } = await resendSignUpOtp(email);
        const retryAt = resendError?.retryAt ? new Date(resendError.retryAt).getTime() : 0;
        const waitSeconds = Number.isFinite(retryAt) && retryAt > Date.now()
          ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) : 120;
        const nextResendUntil = Date.now() + (waitSeconds * 1000);
        saveRegisterOtpFlow({ otpStep: true, email, name, phone, permissionCode, eligibilityAccepted, resendUntil: nextResendUntil });
        setOtpStep(true);
        setVerificationCode('');
        setResendUntil(nextResendUntil);
        setResendCountdown(waitSeconds);
        if (resendError) {
          toast.warning('এই ইমেইলের যাচাই এখনো বাকি থাকতে পারে। আগে পাঠানো কোড দিন; সময় হলে নতুন কোড আবার পাঠাতে পারবেন।');
        } else {
          toast.success('এই ইমেইলের যাচাই অসম্পূর্ণ ছিল। নতুন কোড পাঠানো হয়েছে—Inbox ও Spam/Junk দেখুন।');
        }
      } else {
        const nextResendUntil = Date.now() + (120 * 1000);
        saveRegisterOtpFlow({ otpStep: true, email, name, phone, permissionCode, eligibilityAccepted, resendUntil: nextResendUntil });
        setOtpStep(true);
        setVerificationCode('');
        setResendUntil(nextResendUntil);
        setResendCountdown(120);
        toast.success('ভেরিফিকেশন কোড পাঠানো হয়েছে। Inbox-এ না পেলে Spam/Junk বা Promotions দেখুন।');
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
      subtitle={otpStep ? 'আপনার ইমেইলে পাঠানো ছয় সংখ্যার কোডটি লিখুন।' : 'নাম, মোবাইল ও ইমেইল দিয়ে অ্যাকাউন্ট তৈরি করুন।'}
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
            <div className="auth-verification-mail-tip"><Icon name="mail" size={14} /><span>Inbox-এ না পেলে Spam/Junk বা Promotions ফোল্ডার দেখুন।</span></div>
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
                <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01 234 567 890" autoComplete="tel" required minLength={8} maxLength={20} />
              </label>
            </div>
            <label className="field-label">
              <span>ইমেইল <small className="register-email-label-note">(সঠিক ইমেইল ব্যবহার করুন)</small></span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="আপনার ইমেইল" autoComplete="email" required />
            </label>
            <div className="two-field-grid auth-password-confirm-grid">
              <label className="field-label">
                <span>পাসওয়ার্ড</span>
                <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="কমপক্ষে ৮ অক্ষর" autoComplete="new-password" />
              </label>
              <label className="field-label">
                <span>পাসওয়ার্ড আবার দিন</span>
                <PasswordField value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="একই পাসওয়ার্ড আবার" autoComplete="new-password" />
              </label>
            </div>
            {registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড</span><input value={permissionCode} onChange={(e) => setPermissionCode(e.target.value.toUpperCase())} autoCapitalize="characters" maxLength={20} required placeholder="হোস্টেল লাইফের দেওয়া কোড" /></label>}
            <label ref={registerConsentRef} className="auth-legal-consent auth-combined-consent">
              <input type="checkbox" checked={eligibilityAccepted} onChange={(event) => setEligibilityAccepted(event.target.checked)} required />
              <span>আমি নিশ্চিত করছি, আমার বয়স কমপক্ষে ১৮ বছর এবং <a href="/terms-of-service" target="_blank" rel="noreferrer">ব্যবহারের শর্তাবলী</a> ও <a href="/privacy-policy" target="_blank" rel="noreferrer">গোপনীয়তা নীতি</a> মেনে নিচ্ছি।</span>
            </label>
            <button className="primary-button large" type="submit" disabled={submitting || !online || !eligibilityAccepted || registrationPolicyStatus === 'loading'}>
              {submitting ? 'রেজিস্ট্রেশন হচ্ছে...' : 'রেজিস্ট্রেশন করুন'}
            </button>
          </>
        )}
      </form>
      {!otpStep && GOOGLE_OAUTH_FEATURE_ENABLED && <div className="google-signin-section">
        <GoogleSignInDivider />
        <GoogleSignInButton
          mode="register"
          fullName={name}
          phone={phone}
          disabled={!online}
          consentAccepted={eligibilityAccepted}
          onNeedConsent={() => {
            focusRegisterConsent();
            toast.error(getGoogleConsentRequiredMessage());
          }}
          loading={googleSubmitting}
          onLoading={setGoogleSubmitting}
          onSuccess={() => go('/auth/google-callback', true)}
          onError={(error) => toast.error(getFriendlySupabaseError(error, error?.message || 'Google দিয়ে রেজিস্ট্রেশন করা যায়নি।'))}
        />
      </div>}
      {!otpStep && <AuthSwitch current="register" />}
    </AuthFrame>
  );
}

function AuthSwitch({ current }) {
  if (current === 'login') {
    const registerLink = authLinks.find((link) => link.path === '/auth/register');
    return (
      <div className="auth-switch auth-switch-login">
        <span className="auth-register-group">
          <span className="auth-switch-account-prompt">এখনো অ্যাকাউন্ট নেই?</span>
          {registerLink && <button type="button" className="text-button auth-register-inline" onClick={() => go(registerLink.path)}>{registerLink.label}</button>}
        </span>
        <button type="button" className="text-button auth-forgot-inline" onClick={() => go('/auth/forgot-password')}>
          পাসওয়ার্ড ভুলে গেছেন?
        </button>
      </div>
    );
  }
  return (
    <div className="auth-switch">
      <span className="auth-switch-prompt">
        <span>ইতিমধ্যে অ্যাকাউন্ট আছে?</span>
        {authLinks.filter((link) => link.path !== `/auth/${current}`).map((link) => (
          <button type="button" className="text-button" key={link.path} onClick={() => go(link.path)}>{link.label}</button>
        ))}
      </span>
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
