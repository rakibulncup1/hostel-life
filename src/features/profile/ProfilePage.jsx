import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { updateMyProfile, uploadProfileAvatar, changePassword } from '../../services/profileService';
import { navigateTo } from '../../app/AppShell';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

const THEME_KEY = 'hostel-life-theme';

function initials(name) {
  return name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';
}

export function ProfilePage() {
  const { profile, membership, isManager, refreshIdentity } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [name, setName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'system');

  useEffect(() => {
    setName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setAvatarUrl(profile?.avatar_url || '');
  }, [profile]);

  const displayName = profile?.full_name || name || 'ব্যবহারকারী';
  const role = isManager ? 'ম্যানেজার' : 'সদস্য';
  const themeLabels = useMemo(() => ({ system: 'সিস্টেম অনুযায়ী', light: 'লাইট', dark: 'ডার্ক' }), []);

  const saveProfile = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) return toast.warning('নাম কমপক্ষে ২ অক্ষরের হতে হবে।');
    setSavingInfo(true);
    try {
      await updateMyProfile({ fullName: name.trim(), phone: phone.trim() || null, avatarUrl: avatarUrl || null });
      await refreshIdentity();
      setEditingInfo(false);
      toast.success('প্রোফাইল সফলভাবে আপডেট হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'প্রোফাইল আপডেট করা যায়নি।'));
    } finally {
      setSavingInfo(false);
    }
  };

  const chooseAvatar = () => fileRef.current?.click();

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !profile?.user_id) return;
    setUploading(true);
    try {
      const url = await uploadProfileAvatar(profile.user_id, file);
      setAvatarUrl(url);
      await updateMyProfile({ fullName: name.trim() || profile.full_name, phone: phone.trim() || null, avatarUrl: url });
      await refreshIdentity();
      toast.success('প্রোফাইল ছবি সফলভাবে আপলোড হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'প্রোফাইল ছবি আপলোড করা যায়নি।')); 
    } finally {
      setUploading(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword) return toast.warning('বর্তমান পাসওয়ার্ড দিন।');
    if (newPassword.length < 8) return toast.warning('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
    if (newPassword !== confirmPassword) return toast.warning('নতুন পাসওয়ার্ড দুটো একই নয়।');
    setSavingPassword(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
      if (!profile?.email) throw new Error('অ্যাকাউন্টের ইমেইল পাওয়া যায়নি।');
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: profile.email, password: currentPassword });
      if (verifyError) throw verifyError;
      await changePassword(newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
      toast.success('পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'পাসওয়ার্ড পরিবর্তন করা যায়নি।'));
    } finally {
      setSavingPassword(false);
    }
  };

  const setThemeChoice = (next) => {
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    document.documentElement.dataset.theme = next === 'system' ? (media?.matches ? 'dark' : 'light') : next;
    document.documentElement.dataset.themePreference = next;
    window.dispatchEvent(new Event('hostel-life-theme-change'));
    toast.success(`থিম “${themeLabels[next]}” হিসেবে সংরক্ষণ হয়েছে।`);
  };

  return (
    <div className="page-stack">
      <div className="card profile-overview-card">
        <div className="profile-avatar-wrap">
          {avatarUrl ? <img className="profile-avatar-image" src={avatarUrl} alt="প্রোফাইল" /> : <div className="avatar avatar-xl">{initials(displayName)}</div>}
          <button className="avatar-camera-button" type="button" onClick={chooseAvatar} disabled={uploading} aria-label="প্রোফাইল ছবি পরিবর্তন"><Icon name="camera" size={16} /></button>
          <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} />
        </div>
        <div className="profile-overview-copy"><span className="eyebrow">আপনার অ্যাকাউন্ট</span><h1>{displayName}</h1><div className="profile-role-line"><span className="member-badge active">{role}</span><span>{membership?.hostel_name || 'মেস'}</span></div><small>প্রোফাইল ছবি: JPG/PNG/WEBP, সর্বোচ্চ ২ MB</small></div>
      </div>

      <section className="card profile-section-card">
        <div className="profile-section-head"><div><span className="eyebrow">ব্যক্তিগত তথ্য</span><h2>আমার তথ্য</h2></div><button className="secondary-button compact" type="button" onClick={() => setEditingInfo((value) => !value)}><Icon name={editingInfo ? 'x' : 'edit'} size={15} /> {editingInfo ? 'বন্ধ করুন' : 'এডিট'}</button></div>
        {editingInfo ? (
          <form className="profile-form" onSubmit={saveProfile}>
            <label className="field-label"><span>নাম</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
            <label className="field-label"><span>মোবাইল নম্বর</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} placeholder="ঐচ্ছিক" /></label>
            <div className="profile-email-readonly"><Icon name="mail" size={16} /><div><small>ইমেইল</small><strong>{profile?.email || '—'}</strong><span>নিরাপত্তার কারণে ইমেইল পরিবর্তন করা যাবে না।</span></div></div>
            <button className="primary-button" type="submit" disabled={savingInfo}>{savingInfo ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন সংরক্ষণ করুন'}</button>
          </form>
        ) : (
          <div className="profile-detail-list"><div><span>নাম</span><strong>{profile?.full_name || '—'}</strong></div><div><span>মোবাইল</span><strong>{profile?.phone || 'যোগ করা হয়নি'}</strong></div><div><span>ইমেইল</span><strong>{profile?.email || '—'}</strong></div></div>
        )}
      </section>

      <section className="card profile-section-card">
        <div className="profile-section-head"><div><span className="eyebrow">নিরাপত্তা</span><h2>পাসওয়ার্ড</h2></div><button className="secondary-button compact" type="button" onClick={() => setPasswordOpen((value) => !value)}><Icon name="lock" size={15} /> {passwordOpen ? 'বন্ধ করুন' : 'পরিবর্তন করুন'}</button></div>
        {passwordOpen ? <form className="profile-form" onSubmit={savePassword}><label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label><label className="field-label"><span>নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required /></label><label className="field-label"><span>নতুন পাসওয়ার্ড আবার</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required /></label><div className="form-hint"><Icon name="info" size={15} /> Forgot Password প্রয়োজন হলে লগইন পেজ থেকে ব্যবহার করতে পারবেন।</div><button className="primary-button" type="submit" disabled={savingPassword}>{savingPassword ? 'পাসওয়ার্ড পরিবর্তন হচ্ছে...' : 'পাসওয়ার্ড পরিবর্তন করুন'}</button></form> : <div className="profile-inline-note"><Icon name="shield" size={17} /><span>পাসওয়ার্ড পরিবর্তনের সময় বর্তমান পাসওয়ার্ড যাচাই করা হবে।</span></div>}
      </section>

      <section className="card profile-section-card">
        <div className="profile-section-head"><div><span className="eyebrow">মেস তথ্য</span><h2>মেসের তথ্য</h2></div></div>
        <div className="profile-detail-list"><div><span>মেসের নাম</span><strong>{membership?.hostel_name || '—'}</strong></div><div><span>Join Code</span><strong className="monospace-value">{membership?.join_code || '—'}</strong></div><div><span>আমার ভূমিকা</span><strong>{role}</strong></div><div><span>যুক্ত হওয়ার সময়</span><strong>{formatDateTime12(membership?.joined_at)}</strong></div></div>
      </section>

      <section className="card profile-section-card">
        <div className="profile-section-head"><div><span className="eyebrow">ব্যক্তিগত পছন্দ</span><h2>থিম</h2></div></div>
        <div className="theme-choice-grid">{Object.keys(themeLabels).map((key) => <button className={`theme-choice ${theme === key ? 'selected' : ''}`} key={key} type="button" onClick={() => setThemeChoice(key)}><Icon name={key === 'dark' ? 'moon' : key === 'light' ? 'sun' : 'monitor'} size={18} /><span>{themeLabels[key]}</span>{theme === key && <Icon name="check" size={16} />}</button>)}</div>
      </section>

      <div className="profile-footer-links"><button type="button" className="text-button" onClick={() => navigateTo('/app/menu/developer')}>ডেভেলপার ইনফো দেখুন <Icon name="arrow-right" size={14} /></button></div>
    </div>
  );
}
