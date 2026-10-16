import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export function ForcedPasswordChange() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (password.length < 12) { setError('অন্তত ১২ অক্ষরের নতুন পাসওয়ার্ড দিন।'); return; }
    if (password !== confirm) { setError('দুটি পাসওয়ার্ড মেলেনি।'); return; }
    setBusy(true);
    try {
      const { data, error: updateError } = await supabase.functions.invoke('complete-temporary-password', { body: { new_password: password } });
      if (updateError) throw updateError;
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('পাসওয়ার্ড পরিবর্তনের নিশ্চয়তা পাওয়া যায়নি।');
      await supabase.auth.refreshSession();
      setDone(true);
      window.location.replace('/app/dashboard');
    } catch (cause) { setError(cause?.message || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে।'); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="card forced-password-change" aria-label="পাসওয়ার্ড পরিবর্তন"><h1>নতুন পাসওয়ার্ড নির্ধারণ করুন</h1><p>অস্থায়ী পাসওয়ার্ড দিয়ে লগইন করেছেন। নিরাপত্তার জন্য অ্যাপ ব্যবহারের আগে নতুন পাসওয়ার্ড দিন।</p><form className="form-stack" onSubmit={submit}><label className="field-label"><span>নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required /></label><label className="field-label"><span>আবার নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required /></label>{error && <p role="alert" className="inline-error">{error}</p>}<button type="submit" className="primary-button" disabled={busy||done}>{busy?'পরিবর্তন হচ্ছে...':'পাসওয়ার্ড পরিবর্তন করুন'}</button></form></section></main>;
}
