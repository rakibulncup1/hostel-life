import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { updateMyProfile, uploadProfileAvatar, changePassword } from '../../services/profileService';
import { navigateTo } from '../../app/AppShell';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { verifyPassword } from '../../services/authService';
import { getThemePreference, saveThemePreference } from '../../app/theme';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

function initials(name) {
  return name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';
}

export function ProfilePage() {
  const { profile, membership, isManager, operationalRole, refreshIdentity, user } = useAuth();
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
  const [theme, setTheme] = useState(() => getThemePreference());

  useEffect(() => {
    setName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setAvatarUrl(profile?.avatar_url || '');
  }, [profile]);

  const displayName = profile?.full_name || name || 'ব্যবহারকারী';
  const isPrimaryManager = Boolean(isManager || operationalRole?.is_primary_manager);
  const isAssistantManager = Boolean(!isPrimaryManager && operationalRole?.is_assistant_manager);
  const role = isPrimaryManager ? 'ম্যানেজার' : isAssistantManager ? 'সহকারী ম্যানেজার' : 'সদস্য';
  const themeLabels = useMemo(() => ({ system: 'সিস্টেম অনুযায়ী', light: 'লাইট', dark: 'ডার্ক', blue: 'আকাশি নীল' }), []);

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

  const chooseAvatar = () => {
    // Reset before opening so choosing the same photo again still fires change.
    if (!fileRef.current || uploading) return;
    fileRef.current.value = '';
    fileRef.current.click();
  };

  const uploadAvatar = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const avatarUserId = user?.id || profile?.user_id;
    if (!avatarUserId) return toast.error('আপনার লগইন পরিচয় পাওয়া যায়নি। আবার লগইন করুন।');
    setUploading(true);
    try {
      const url = await uploadProfileAvatar(avatarUserId, file);
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
      const accountEmail = user?.email || profile?.email;
      if (!accountEmail) throw new Error('অ্যাকাউন্টের ইমেইল পাওয়া যায়নি।');
      const { error: verifyError } = await verifyPassword({ email: accountEmail, password: currentPassword });
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
    const saved = saveThemePreference(next);
    setTheme(saved);
    toast.success(`থিম “${themeLabels[saved]}” হিসেবে সংরক্ষণ হয়েছে।`);
  };

  return (
    <div className="page-stack profile-experience">
      <section className="card profile-overview-card profile-identity-card" aria-label="প্রোফাইল পরিচিতি">
        <div className="profile-avatar-wrap">
          {avatarUrl ? (
            <img className="profile-avatar-image" src={avatarUrl} alt="প্রোফাইল" onError={() => setAvatarUrl('')} />
          ) : (
            <div className="avatar avatar-xl">{initials(displayName)}</div>
          )}
          <button className={`avatar-camera-button ${uploading ? 'uploading' : ''}`} type="button" onClick={chooseAvatar} disabled={uploading} aria-label="প্রোফাইল ছবি পরিবর্তন">
            <Icon name={uploading ? 'loader-circle' : 'camera'} size={17} />
          </button>
          <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} />
        </div>
        <div className="profile-overview-copy">
          <span className="eyebrow profile-brand-eyebrow">HOSTEL LIFE <span aria-hidden="true">/</span> PROFILE</span>
          <h1>{displayName === 'ব্যবহারকারী' ? displayName : <span data-user-content>{displayName}</span>}</h1>
          <div className="profile-role-line">
            <span className={`member-badge active ${isAssistantManager ? 'assistant' : isPrimaryManager ? 'manager' : ''}`}>{role}</span>
            <span className="profile-identity-hostel"><Icon name="home" size={14} />{membership?.hostel_name ? <span data-user-content>{membership.hostel_name}</span> : 'মেস'}</span>
          </div>
          {uploading && <small className="profile-avatar-upload-status">ছবি আপলোড হচ্ছে…</small>}
        </div>
      </section>

      <div className="profile-settings-grid profile-primary-grid">
        <section className="card profile-section-card profile-personal-section">
          <div className="profile-section-head">
            <div className="profile-section-heading">
              <span className="profile-section-icon"><Icon name="user-round" size={18} /></span>
              <div><span className="eyebrow">অ্যাকাউন্ট</span><h2>ব্যক্তিগত তথ্য</h2></div>
            </div>
            <button className="secondary-button compact profile-section-action" type="button" aria-expanded={editingInfo} onClick={() => setEditingInfo((value) => !value)}>
              <Icon name={editingInfo ? 'x' : 'edit'} size={15} />{editingInfo ? 'বন্ধ করুন' : 'এডিট'}
            </button>
          </div>
          {editingInfo ? (
            <form id="profile-personal-form" className="profile-form" onSubmit={saveProfile}>
              <div className="profile-form-grid profile-personal-form-grid">
                <label className="field-label"><span>নাম</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" required /></label>
                <label className="field-label"><span>মোবাইল নম্বর</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" placeholder="ঐচ্ছিক" /></label>
              </div>
              <div className="profile-email-readonly">
                <span className="profile-readonly-icon"><Icon name="mail" size={17} /></span>
                <div><small>ইমেইল</small><strong>{profile?.email || user?.email || '—'}</strong><span>নিরাপত্তার কারণে ইমেইল পরিবর্তন করা যাবে না।</span></div>
              </div>
              <div className="profile-form-actions">
                <button className="primary-button" type="submit" disabled={savingInfo}>
                  <Icon name={savingInfo ? 'loader-circle' : 'check'} size={16} />{savingInfo ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন সংরক্ষণ'}
                </button>
              </div>
            </form>
          ) : (
            <div className="profile-detail-list profile-personal-details">
              <div><span>নাম</span><strong data-user-content>{profile?.full_name || '—'}</strong></div>
              <div><span>মোবাইল নম্বর</span><strong>{profile?.phone || 'যোগ করা হয়নি'}</strong></div>
              <div><span>ইমেইল</span><strong>{profile?.email || user?.email || '—'}</strong></div>
            </div>
          )}
        </section>

        <section className={`card profile-section-card profile-security-section ${passwordOpen ? 'is-expanded' : ''}`}>
          <div className="profile-section-head">
            <div className="profile-section-heading">
              <span className="profile-section-icon"><Icon name="shield-check" size={18} /></span>
              <div><span className="eyebrow">নিরাপত্তা</span><h2>পাসওয়ার্ড</h2></div>
            </div>
            <button className="secondary-button compact profile-section-action" type="button" aria-expanded={passwordOpen} onClick={() => setPasswordOpen((value) => !value)}>
              <Icon name={passwordOpen ? 'x' : 'lock'} size={15} />{passwordOpen ? 'বন্ধ করুন' : 'পরিবর্তন'}
            </button>
          </div>
          {!passwordOpen && <p className="profile-password-hint">নিরাপত্তার প্রয়োজনে যেকোনো সময় পাসওয়ার্ড হালনাগাদ করতে পারবেন।</p>}
          {passwordOpen && (
            <form id="profile-password-form" className="profile-form" onSubmit={savePassword}>
              <div className="profile-form-grid profile-password-form-grid">
                <label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
                <label className="field-label"><span>নতুন পাসওয়ার্ড</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required /></label>
                <label className="field-label"><span>নতুন পাসওয়ার্ড আবার</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required /></label>
              </div>
              <div className="profile-form-actions">
                <button className="primary-button" type="submit" disabled={savingPassword}>
                  <Icon name={savingPassword ? 'loader-circle' : 'lock'} size={16} />{savingPassword ? 'পাসওয়ার্ড পরিবর্তন হচ্ছে...' : 'পাসওয়ার্ড পরিবর্তন'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      <div className="profile-settings-grid profile-secondary-grid">
        <section className="card profile-section-card profile-hostel-section">
          <div className="profile-section-head">
            <div className="profile-section-heading">
              <span className="profile-section-icon"><Icon name="home" size={18} /></span>
              <div><span className="eyebrow">সদস্যতা</span><h2>মেসের তথ্য</h2></div>
            </div>
          </div>
          <div className="profile-detail-list profile-hostel-details">
            <div><span>মেসের নাম</span><strong>{membership?.hostel_name ? <span data-user-content>{membership.hostel_name}</span> : '—'}</strong></div>
            <div><span>Join Code</span><strong className="monospace-value">{membership?.join_code || '—'}</strong></div>
            <div><span>আমার ভূমিকা</span><strong>{role}</strong></div>
            <div><span>যুক্ত হওয়ার সময়</span><strong>{formatDateTime12(membership?.joined_at)}</strong></div>
          </div>
        </section>

        <section className="card profile-section-card profile-language-section">
          <div className="profile-section-head">
            <div className="profile-section-heading">
              <span className="profile-section-icon"><Icon name="globe" size={18} /></span>
              <div><span className="eyebrow">অভিজ্ঞতা</span><h2>ভাষা</h2></div>
            </div>
          </div>
          <p className="profile-language-description">অ্যাপের সব মেনু, পৃষ্ঠা ও নির্দেশনার ভাষা নির্বাচন করুন।</p>
          <div className="profile-language-options" role="group" aria-label="ভাষা নির্বাচন">
            <LanguageSwitcher variant="segmented" withLabel className="profile-language-control" />
          </div>
        </section>

        <section className="card profile-section-card profile-theme-section">
          <div className="profile-section-head">
            <div className="profile-section-heading">
              <span className="profile-section-icon"><Icon name="monitor" size={18} /></span>
              <div><span className="eyebrow">অভিজ্ঞতা</span><h2>থিম পছন্দ</h2></div>
            </div>
          </div>
          <div className="theme-choice-grid profile-theme-choice-grid">
            {Object.keys(themeLabels).map((key) => (
              <button className={`theme-choice theme-choice-${key} ${theme === key ? 'selected' : ''}`} key={key} type="button" onClick={() => setThemeChoice(key)} aria-pressed={theme === key}>
                <Icon name={key === 'dark' ? 'moon' : key === 'light' ? 'sun' : key === 'blue' ? 'droplet' : 'monitor'} size={18} />
                <span>{themeLabels[key]}</span>
                {theme === key && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="profile-footer-links">
        <button type="button" className="text-button profile-support-link" onClick={() => navigateTo('/app/menu/developer')}>
          <Icon name="heart-handshake" size={16} />হোস্টেল লাইফ সাপোর্ট<Icon name="arrow-right" size={14} />
        </button>
      </div>
    </div>
  );
}
