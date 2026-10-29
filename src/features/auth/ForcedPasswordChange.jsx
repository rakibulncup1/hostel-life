import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { BrandMark } from '../../components/BrandMark';

export function ForcedPasswordChange() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [reloginNeeded, setReloginNeeded] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (password.length < 12) { setError('অন্তত ১২ অক্ষরের নতুন পাসওয়ার্ড দিন।'); return; }
    if (password !== confirm) { setError('দুটি পাসওয়ার্ড মেলেনি।'); return; }
    setBusy(true);
    try {
      const { data, error: updateError } = await supabase.functions.invoke('complete-temporary-password', { body: { new_password: password } });
      if (updateError) {
        let payload = null; let raw = '';
        const context = updateError.context;
        if (context && typeof context.clone === 'function') {
          try { raw = await context.clone().text(); payload = raw ? JSON.parse(raw) : null; } catch { /* Use SDK error if response body is unavailable. */ }
        }
        const detail = payload?.message || payload?.error_description || payload?.error || raw || updateError.message;
        const status = context?.status ? ` (HTTP ${context.status})` : '';
        const requestId = payload?.request_id ? ` · Request ID: ${payload.request_id}` : '';
        throw new Error(`${detail}${status}${requestId}`);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('পাসওয়ার্ড পরিবর্তনের নিশ্চয়তা পাওয়া যায়নি।');
      // Admin updated Auth credentials on the server. The old JWT can still
      // contain must_change_password=true; refreshing that session may hang or
      // preserve stale metadata. Re-authenticate to obtain a new signed token.
      setDone(true);
      const email = user?.email;
      if (!email) {
        setReloginNeeded(true);
      } else {
        const result = await Promise.race([
          supabase.auth.signInWithPassword({ email, password }),
          new Promise(resolve => setTimeout(() => resolve({ error: new Error('সেশন আপডেটের সময়সীমা শেষ হয়েছে।') }), 12000)),
        ]);
        if (result.error || !result.data?.session) {
          setReloginNeeded(true);
        } else {
          window.location.replace('/app/dashboard');
          return;
        }
      }
    } catch (cause) { if (done) setReloginNeeded(true); else setError(cause?.message || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে।'); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="card forced-password-change" aria-label="পাসওয়ার্ড পরিবর্তন"><BrandMark size={64} /><h1>নতুন পাসওয়ার্ড নির্ধারণ করুন</h1><p>অস্থায়ী পাসওয়ার্ড দিয়ে লগইন করেছেন। নিরাপত্তার জন্য অ্যাপ ব্যবহারের আগে নতুন পাসওয়ার্ড দিন।</p><form className="form-stack" onSubmit={submit}><label className="field-label"><span>নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required /></label><label className="field-label"><span>আবার নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required /></label>{error && <p role="alert" className="inline-error">{error}</p>}{reloginNeeded && <p className="inline-success" role="status">নতুন পাসওয়ার্ড সংরক্ষিত হয়েছে। স্বয়ংক্রিয় প্রবেশ সম্পন্ন হয়নি; নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন।</p>}<button type="submit" className="primary-button" disabled={busy||done}>{busy?'পরিবর্তন হচ্ছে...':'পাসওয়ার্ড পরিবর্তন করুন'}</button>{reloginNeeded && <a className="secondary-button" href="/auth/login">লগইনে যান</a>}</form></section></main>;
}
