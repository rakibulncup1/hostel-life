import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { signIn, signUp, requestPasswordReset, updatePassword } from '../../services/authService';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { useAuth } from '../../contexts/AuthContext';

function go(path, replace = false) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const authLinks = [
  { path: '/auth/login', label: 'লগইন' },
  { path: '/auth/register', label: 'রেজিস্ট্রেশন' },
];

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

function AuthFrame({ title, subtitle, children, compact = false }) {
  return (
    <main className="auth-page">
      <section className={`auth-shell ${compact ? 'auth-shell-compact' : ''}`}>
        <div className="auth-brand-panel">
          <div className="auth-brand-mark"><Icon name="home" size={28} /></div>
          <span className="auth-eyebrow">HOSTEL LIFE</span>
          <h1>আপনার মেস, আপনার হিসাব।</h1>
          <p>সদস্য, মিল, বাজার ও হিসাব — সবকিছু এক জায়গায়।</p>
        </div>
        <div className="auth-form-panel">
          <div className="auth-header">
            <div>
              <span className="eyebrow">স্বাগতম</span>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function LoginForm() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { refreshIdentity } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      await refreshIdentity().catch(() => undefined);
      toast.success('সফলভাবে লগইন হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'লগইন করা যায়নি। তথ্যগুলো আবার যাচাই করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="লগইন করুন" subtitle="আপনার Hostel Life অ্যাকাউন্টে প্রবেশ করুন।">
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
          {submitting ? 'লগইন হচ্ছে...' : 'লগইন'}
        </button>
      </form>
      <AuthSwitch current="login" />
    </AuthFrame>
  );
}

function RegisterForm() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('রেজিস্ট্রেশন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (name.trim().length < 2) {
      toast.error('নাম কমপক্ষে ২ অক্ষরের হতে হবে।');
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
      const { data, error } = await signUp({ fullName: name, phone, email, password });
      if (error) throw error;

      if (data.session) {
        toast.success('অ্যাকাউন্ট তৈরি হয়েছে। এখন মেসে যুক্ত হন।');
      } else {
        toast.success('রেজিস্ট্রেশন সফল হয়েছে। ইমেইল ভেরিফাই করে আবার লগইন করুন।', { duration: 5600 });
        go('/auth/login');
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রেজিস্ট্রেশন করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="রেজিস্ট্রেশন করুন" subtitle="নতুন অ্যাকাউন্ট তৈরি করে Hostel Life শুরু করুন।">
      <form className="form-stack" onSubmit={submit}>
        <div className="two-field-grid">
          <label className="field-label">
            <span>নাম</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="আপনার নাম" autoComplete="name" required />
          </label>
          <label className="field-label">
            <span>মোবাইল নম্বর <em>(ঐচ্ছিক)</em></span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" autoComplete="tel" />
          </label>
        </div>
        <label className="field-label">
          <span>ইমেইল</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="আপনার ইমেইল" autoComplete="email" required />
        </label>
        <label className="field-label">
          <span>পাসওয়ার্ড</span>
          <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="কমপক্ষে ৮ অক্ষর" autoComplete="new-password" />
        </label>
        <label className="field-label">
          <span>পাসওয়ার্ড আবার দিন</span>
          <PasswordField value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="একই পাসওয়ার্ড আবার" autoComplete="new-password" />
        </label>
        <button className="primary-button large" type="submit" disabled={submitting || !online}>
          {submitting ? 'অ্যাকাউন্ট তৈরি হচ্ছে...' : 'রেজিস্ট্রেশন করুন'}
        </button>
      </form>
      <AuthSwitch current="register" />
    </AuthFrame>
  );
}

function AuthSwitch({ current }) {
  return (
    <div className="auth-switch">
      <span>{current === 'login' ? 'নতুন অ্যাকাউন্ট?' : 'আগে থেকেই অ্যাকাউন্ট আছে?'}</span>
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

  const submit = async (event) => {
    event.preventDefault();
    if (!online) {
      toast.warning('পাসওয়ার্ড রিসেট করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await requestPasswordReset(email);
      if (error) throw error;
      setSent(true);
      toast.success('পাসওয়ার্ড রিসেটের নির্দেশনা ইমেইলে পাঠানো হয়েছে।', { duration: 5200 });
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিসেট ইমেইল পাঠানো যায়নি।'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame compact title="পাসওয়ার্ড পুনরুদ্ধার" subtitle="আপনার ইমেইলে একটি নিরাপদ reset link পাঠানো হবে।">
      <form className="form-stack" onSubmit={submit}>
        <label className="field-label">
          <span>ইমেইল</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="যে ইমেইলে অ্যাকাউন্ট আছে" autoComplete="email" required />
        </label>
        {sent && <div className="inline-success"><Icon name="check" size={17} /><span>ইমেইল পাঠানো হয়েছে। Inbox/Spam folder দেখুন।</span></div>}
        <button className="primary-button large" type="submit" disabled={submitting || !online}>
          {submitting ? 'পাঠানো হচ্ছে...' : 'রিসেট লিংক পাঠান'}
        </button>
        <button type="button" className="secondary-button" onClick={() => go('/auth/login')}><Icon name="chevron" size={16} className="rotate-180" /> লগইনে ফিরে যান</button>
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
      toast.error('Reset link সঠিক নয় অথবা মেয়াদ শেষ হয়েছে। আবার password reset করুন।');
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
    return <AuthFrame compact title="পাসওয়ার্ড পুনরুদ্ধার" subtitle="নিরাপদ session যাচাই করা হচ্ছে..."><div className="loading-wrap auth-loading"><span className="spinner" /><span>যাচাই হচ্ছে...</span></div></AuthFrame>;
  }

  return (
    <AuthFrame compact title="নতুন পাসওয়ার্ড" subtitle="নতুন পাসওয়ার্ড সেট করে আপনার অ্যাকাউন্ট সুরক্ষিত করুন।">
      {!session && !done && (
        <div className="inline-error"><Icon name="warning" size={17} /><span>এই page-এ valid password reset session পাওয়া যায়নি।</span></div>
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
          <button type="button" className="secondary-button" onClick={() => go('/auth/login')}><Icon name="chevron" size={16} className="rotate-180" /> লগইনে ফিরে যান</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function AuthPage({ pathname }) {
  useEffect(() => {
    document.title = pathname.endsWith('register') ? 'Hostel Life — রেজিস্ট্রেশন' : pathname.endsWith('forgot-password') ? 'Hostel Life — পাসওয়ার্ড পুনরুদ্ধার' : pathname.endsWith('reset-password') ? 'Hostel Life — নতুন পাসওয়ার্ড' : 'Hostel Life — লগইন';
  }, [pathname]);

  if (pathname === '/auth/register') return <RegisterForm />;
  if (pathname === '/auth/forgot-password') return <ForgotPasswordForm />;
  if (pathname === '/auth/reset-password') return <ResetPasswordForm />;
  return <LoginForm />;
}
