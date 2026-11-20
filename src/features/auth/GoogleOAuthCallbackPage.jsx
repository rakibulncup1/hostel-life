import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  GOOGLE_OAUTH_POLICY_VERSION,
  buildGoogleConsentMetadata,
  clearPendingGoogleOAuth,
  isGoogleOAuthIdentity,
  isNewGoogleOAuthAccount,
  isValidGooglePhone,
  normalizeGooglePhone,
  readPendingGoogleOAuth,
  sanitizeGoogleAvatarUrl,
} from '../../services/googleOAuthService';

function navigate(path) {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function readOAuthError() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  return query.get('error_description') || query.get('error') || hash.get('error_description') || hash.get('error') || '';
}

function safeOAuthErrorMessage(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.includes('registration') || value.includes('অনুমতি কোড')) {
    return 'এই সিস্টেমে নতুন অ্যাকাউন্টের জন্য অনুমতি কোড আবশ্যক। অনুমতি কোডসহ সাধারণ রেজিস্ট্রেশন ব্যবহার করুন।';
  }
  if (value.includes('access_denied') || value.includes('cancel')) return 'Google sign-in বাতিল করা হয়েছে। চাইলে আবার চেষ্টা করুন।';
  if (value.includes('provider') || value.includes('client_id') || value.includes('client id')) return 'Google provider এখনো সম্পূর্ণভাবে কনফিগার করা হয়নি। Google Client ID, Supabase Google provider এবং অনুমোদিত website origin যাচাই করুন।';
  return 'Google দিয়ে প্রবেশ সম্পন্ন করা যায়নি। Google Cloud ও Supabase-এর OAuth configuration যাচাই করে আবার চেষ্টা করুন।';
}

function hasCurrentLegalConsent(metadata = {}) {
  return metadata.age_18_plus_confirmed === true
    && metadata.legal_policy_version === GOOGLE_OAUTH_POLICY_VERSION
    && Number.isFinite(Date.parse(metadata.age_confirmation_at || ''))
    && Number.isFinite(Date.parse(metadata.terms_accepted_at || ''))
    && Number.isFinite(Date.parse(metadata.privacy_policy_accepted_at || ''));
}

function makeLegalConsentMetadata() {
  const acceptedAt = new Date().toISOString();
  return {
    age_18_plus_confirmed: true,
    age_confirmation_at: acceptedAt,
    terms_accepted_at: acceptedAt,
    privacy_policy_accepted_at: acceptedAt,
    legal_policy_version: GOOGLE_OAUTH_POLICY_VERSION,
  };
}

function providerNameFrom(user, profile) {
  const profileName = String(profile?.full_name || '').trim();
  if (profileName.length >= 2 && !['সদস্য', 'Member'].includes(profileName)) return profileName;
  const metadata = user?.user_metadata || {};
  return String(metadata.full_name || metadata.name || '').trim();
}

function providerAvatarFrom(user, profile) {
  // Preserve a user-selected Hostel Life avatar. Only accept Google-hosted
  // profile image URLs when importing a provider image.
  const savedAvatar = String(profile?.avatar_url || '').trim();
  if (savedAvatar) return savedAvatar;
  const metadata = user?.user_metadata || {};
  return sanitizeGoogleAvatarUrl(metadata.avatar_url || metadata.picture);
}

export function GoogleOAuthCallbackPage() {
  const auth = useAuth();
  const handledRef = useRef(false);
  const pendingRef = useRef(readPendingGoogleOAuth());
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('Google account যাচাই করা হচ্ছে...');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [legalConsentRequired, setLegalConsentRequired] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    document.title = 'Hostel Life — Google Sign-In';
  }, []);

  useEffect(() => {
    if (auth.authLoading || !auth.identityReady || auth.identityLoading || handledRef.current) return;
    const pending = pendingRef.current;
    const providerError = readOAuthError();

    if (providerError) {
      handledRef.current = true;
      clearPendingGoogleOAuth();
      setMessage(safeOAuthErrorMessage(providerError));
      setStatus('error');
      return;
    }

    if (!auth.user) {
      handledRef.current = true;
      clearPendingGoogleOAuth();
      setMessage('Google sign-in session পাওয়া যায়নি। আবার Login পেজ থেকে চেষ্টা করুন।');
      setStatus('error');
      return;
    }

    if (!isGoogleOAuthIdentity(auth.user)) {
      handledRef.current = true;
      clearPendingGoogleOAuth();
      setMessage('এই পৃষ্ঠার জন্য বৈধ Google পরিচয় পাওয়া যায়নি। আবার Login পেজ থেকে শুরু করুন।');
      setStatus('error');
      supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return;
    }

    handledRef.current = true;
    const user = auth.user;
    const metadata = user.user_metadata || {};
    const newlyCreated = pending ? isNewGoogleOAuthAccount(user, pending) : false;
    const initialName = pending?.fullName || providerNameFrom(user, auth.profile);
    const initialPhone = auth.profile?.phone || metadata.phone || pending?.phone || '';
    const initialAvatar = providerAvatarFrom(user, auth.profile);
    const consentAlreadyStored = hasCurrentLegalConsent(metadata);
    const needsLegalConsent = !pending && !consentAlreadyStored;

    (async () => {
      if (pending) {
        const consentMetadata = buildGoogleConsentMetadata(pending, metadata);
        const { error: metadataError } = await supabase.auth.updateUser({ data: consentMetadata });
        if (metadataError) throw metadataError;
      }

      setFullName(initialName);
      setPhone(initialPhone);
      setAvatarUrl(initialAvatar);
      setLegalConsentRequired(needsLegalConsent);

      const profileIsComplete = initialName.trim().length >= 2 && isValidGooglePhone(initialPhone);
      if (!profileIsComplete || needsLegalConsent) {
        setMessage(newlyCreated
          ? 'Google থেকে পাওয়া নাম, ইমেইল ও প্রোফাইল ছবি প্রস্তুত। অ্যাপ ব্যবহারের আগে মোবাইল নম্বর দিন।'
          : 'অ্যাকাউন্ট সম্পূর্ণ করতে আপনার মোবাইল নম্বর নিশ্চিত করুন।');
        setStatus('profile');
        return;
      }

      // Also backfill a missing provider name/avatar on an older Google account,
      // without overwriting an existing Hostel Life profile or chosen avatar.
      await saveGoogleProfile({ fullName: initialName, phone: initialPhone, avatarUrl: initialAvatar });
      await finishSignIn();
    })().catch((error) => {
      console.error('[Hostel Life] Google sign-in finalization failed:', error?.message || 'unknown_error');
      setMessage(error?.message || 'Google sign-in সম্পন্ন হয়েছে, কিন্তু profile প্রস্তুত করা যায়নি। আবার চেষ্টা করুন।');
      setStatus('error');
    });
  }, [auth.authLoading, auth.identityReady, auth.identityLoading, auth.user?.id, auth.profile?.phone, auth.profile?.full_name, auth.profile?.avatar_url]);

  async function saveGoogleProfile(values, consentMetadata = null) {
    const normalizedName = String(values.fullName || '').trim();
    const normalizedPhone = normalizeGooglePhone(values.phone);
    if (normalizedName.length < 2 || normalizedName.length > 100) throw new Error('নাম ২ থেকে ১০০ অক্ষরের মধ্যে হতে হবে।');
    if (!isValidGooglePhone(normalizedPhone)) throw new Error('সঠিক মোবাইল নম্বর দিন (৮–১৫টি সংখ্যা)।');

    const { data: currentResult, error: currentError } = await supabase.auth.getUser();
    if (currentError || !currentResult?.user) throw currentError || new Error('Google account পাওয়া যায়নি।');
    const currentUser = currentResult.user;
    const currentMetadata = currentUser.user_metadata || {};
    const safeProviderAvatar = sanitizeGoogleAvatarUrl(values.avatarUrl || currentMetadata.avatar_url || currentMetadata.picture);
    const existingAvatar = String(auth.profile?.avatar_url || '').trim();
    const nextAvatar = existingAvatar || safeProviderAvatar || null;
    const nextMetadata = {
      ...currentMetadata,
      full_name: normalizedName,
      phone: normalizedPhone,
      ...(nextAvatar ? { avatar_url: nextAvatar } : {}),
      ...(consentMetadata || {}),
    };
    const { error: metadataError } = await supabase.auth.updateUser({ data: nextMetadata });
    if (metadataError) throw metadataError;

    const { error: profileError } = await supabase.rpc('update_my_profile', {
      p_full_name: normalizedName,
      p_phone: normalizedPhone,
      p_avatar_url: nextAvatar,
    });
    if (profileError) throw profileError;
  }

  async function finishSignIn() {
    const identity = await auth.refreshIdentity();
    if (!isValidGooglePhone(identity?.profile?.phone)) {
      throw new Error('মোবাইল নম্বর সংরক্ষণ নিশ্চিত করা যায়নি। আবার নম্বর দিয়ে চেষ্টা করুন।');
    }
    clearPendingGoogleOAuth();
    const membership = identity?.membership || null;
    if (membership?.status === 'inactive') navigate('/account/inactive');
    else if (membership?.status === 'active') navigate('/app/dashboard');
    else navigate('/onboarding');
  }

  async function completeProfile(event) {
    event.preventDefault();
    if (savingProfile) return;
    if (legalConsentRequired && !legalAccepted) {
      setMessage('চালিয়ে যেতে ১৮+ বয়স, ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি দিন।');
      return;
    }
    setSavingProfile(true);
    setMessage('অ্যাকাউন্টের তথ্য সংরক্ষণ করা হচ্ছে...');
    try {
      const consentMetadata = legalConsentRequired ? makeLegalConsentMetadata() : null;
      await saveGoogleProfile({ fullName, phone, avatarUrl }, consentMetadata);
      await finishSignIn();
    } catch (error) {
      setMessage(error?.message || 'প্রোফাইল সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।');
      setStatus('profile');
    } finally {
      setSavingProfile(false);
    }
  }

  const isEnglish = window.HostelLifeI18n?.getLanguage?.() === 'en';
  const displayEmail = auth.user?.email || '';

  return (
    <main className="google-oauth-callback-page">
      <section className="google-oauth-callback-card" aria-live="polite">
        <div className="google-oauth-callback-brand"><BrandMark size={38} /><strong>Hostel Life</strong></div>
        {status === 'checking' && <div className="google-oauth-callback-status"><span className="spinner"/><h1>{isEnglish ? 'Verifying your Google account' : 'Google account যাচাই করা হচ্ছে'}</h1><p>{message}</p></div>}
        {status === 'profile' && (
          <form className="google-oauth-profile-form" onSubmit={completeProfile}>
            <div className="google-oauth-profile-heading">
              {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="google-oauth-profile-avatar"><Icon name="user" size={22}/></span>}
              <div><h1>{isEnglish ? 'Complete your account' : 'অ্যাকাউন্ট সম্পূর্ণ করুন'}</h1><p>{fullName || displayEmail}</p>{displayEmail && <small>{displayEmail}</small>}</div>
            </div>
            <p>{message}</p>
            {fullName.trim().length < 2 && <label className="field-label"><span>{isEnglish ? 'Full name' : 'নাম'}</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" minLength={2} maxLength={100} required /></label>}
            <label className="field-label"><span>{isEnglish ? 'Mobile number' : 'মোবাইল নম্বর'}</span><input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" maxLength={20} placeholder={isEnglish ? 'Enter your mobile number' : 'আপনার মোবাইল নম্বর লিখুন'} required /><small>{isEnglish ? 'Google does not provide your mobile number. It will be saved to your Hostel Life profile. This step does not send an SMS verification code.' : 'Google আপনার মোবাইল নম্বর দেয় না। নম্বরটি আপনার Hostel Life profile-এ সংরক্ষণ করা হবে। এই ধাপে SMS OTP যাচাই করা হবে না।'}</small></label>
            {legalConsentRequired && <label className="auth-legal-consent google-profile-legal-consent"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} /><span>{isEnglish ? 'I confirm that I am at least 18 and accept the ' : 'আমি নিশ্চিত করছি, আমার বয়স কমপক্ষে ১৮ বছর এবং '}<a href="/terms-of-service" target="_blank" rel="noreferrer">{isEnglish ? 'Terms of Service' : 'ব্যবহারের শর্তাবলী'}</a>{isEnglish ? ' and ' : ' ও '}<a href="/privacy-policy" target="_blank" rel="noreferrer">{isEnglish ? 'Privacy Policy' : 'গোপনীয়তা নীতি'}</a>.</span></label>}
            <button className="primary-button large" type="submit" disabled={savingProfile || fullName.trim().length < 2 || fullName.trim().length > 100 || !isValidGooglePhone(phone) || (legalConsentRequired && !legalAccepted)}>{savingProfile ? (isEnglish ? 'Saving...' : 'সংরক্ষণ হচ্ছে...') : (isEnglish ? 'Continue' : 'চালিয়ে যান')}</button>
          </form>
        )}
        {status === 'error' && <div className="google-oauth-callback-status google-oauth-callback-error"><span className="google-oauth-callback-error-icon"><Icon name="alert-circle" size={22}/></span><h1>{isEnglish ? 'Google sign-in could not be completed' : 'Google sign-in সম্পন্ন হয়নি'}</h1><p>{message}</p><button className="primary-button" type="button" onClick={() => navigate('/auth/login')}>{isEnglish ? 'Back to sign in' : 'লগইন পেজে ফিরুন'}</button></div>}
      </section>
    </main>
  );
}
