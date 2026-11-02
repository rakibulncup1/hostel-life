import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo } from '../../app/AppShell';
import { EntryThemeSwitcher } from '../../components/EntryThemeSwitcher';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import {
  createHostelJoinRequestFromInvite,
  getHostelInviteLinkInfo,
  getMyHostelJoinRequestStatus,
} from '../../services/hostelInviteService';
import { clearPendingHostelLinkToken, setPendingHostelLinkToken } from '../../utils/pendingHostelLink';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function InviteStatus({ status, note }) {
  if (status === 'pending') return <div className="hostel-invite-status pending"><Icon name="clock" size={18}/><div><strong>অনুরোধ অপেক্ষমাণ</strong><span>ম্যানেজার বা অনুমোদিত সহকারী পর্যালোচনা করলে এখানে সদস্যপদের অবস্থা আপডেট হবে।</span></div></div>;
  if (status === 'rejected') return <div className="hostel-invite-status rejected"><Icon name="x-circle" size={18}/><div><strong>অনুরোধ অনুমোদিত হয়নি</strong><span>{note || 'আপনার অ্যাকাউন্ট অক্ষত আছে। চাইলে সাধারণ Join Code দিয়ে অন্য মেসে যুক্ত হতে বা নতুন মেস তৈরি করতে পারবেন।'}</span></div></div>;
  return null;
}

export function HostelInvitePage({ pathname }) {
  const auth = useAuth();
  const online = useOnlineStatus();
  const toast = useToast();
  const token = useMemo(() => String(pathname || '').split('/').filter(Boolean).at(-1) || '', [pathname]);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [busy, setBusy] = useState(false);

  const otherActiveHostel = auth.membership?.status === 'active' && info?.hostel_id
    && auth.membership?.hostel_id !== info.hostel_id;
  const sameActiveHostel = auth.membership?.status === 'active' && info?.hostel_id
    && auth.membership?.hostel_id === info.hostel_id;

  useEffect(() => {
    if (!TOKEN_PATTERN.test(token)) {
      setError('Invitation Link সঠিক নয়। ম্যানেজারের কাছ থেকে নতুন লিংক নিন।');
      setLoading(false);
      return;
    }
    setPendingHostelLinkToken(token);
    if (!auth.isAuthenticated || auth.authLoading || auth.identityLoading) {
      setLoading(false);
      return;
    }
    if (!online) {
      setError('Invitation যাচাই করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError('');
    Promise.allSettled([
      getHostelInviteLinkInfo(token),
      getMyHostelJoinRequestStatus(token),
    ]).then(([infoResult, statusResult]) => {
      if (!active) return;
      if (infoResult.status === 'fulfilled') setInfo(infoResult.value);
      else setError(getFriendlySupabaseError(infoResult.reason, 'Invitation Link যাচাই করা যায়নি। এটি মেয়াদোত্তীর্ণ বা বাতিল হতে পারে।'));
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
      else setError((old) => old || getFriendlySupabaseError(statusResult.reason, 'Join Request-এর অবস্থা যাচাই করা যায়নি।'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, auth.isAuthenticated, auth.authLoading, auth.identityLoading, online]);

  useEffect(() => {
    if (!sameActiveHostel || auth.identityLoading) return;
    clearPendingHostelLinkToken();
    navigateTo('/app/dashboard', true);
  }, [sameActiveHostel, auth.identityLoading]);

  useEffect(() => {
    if (status?.status !== 'approved' || !auth.isAuthenticated) return;
    let active = true;
    (async () => {
      try {
        const identity = await auth.refreshIdentity();
        if (!active) return;
        if (identity?.membership?.status === 'active' && identity.membership.hostel_id === info?.hostel_id) {
          clearPendingHostelLinkToken();
          navigateTo('/app/dashboard', true);
        }
      } catch { /* Keep the approval status visible while identity is retried. */ }
    })();
    return () => { active = false; };
  }, [status?.status, auth.isAuthenticated, auth.refreshIdentity, info?.hostel_id]);

  const submitRequest = useCallback(async () => {
    if (!auth.isAuthenticated || !online || busy || !TOKEN_PATTERN.test(token)) return;
    setBusy(true);
    setError('');
    try {
      const result = await createHostelJoinRequestFromInvite(token, requestNote);
      setStatus(result);
      if (result.status === 'already_member') {
        await auth.refreshIdentity();
        clearPendingHostelLinkToken();
        navigateTo('/app/dashboard', true);
      } else if (result.status === 'pending') {
        toast.success('Join Request পাঠানো হয়েছে। ম্যানেজার অনুমোদন করলে আপনি সদস্য হবেন।');
      }
    } catch (cause) {
      setError(getFriendlySupabaseError(cause, 'Join Request পাঠানো যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setBusy(false);
    }
  }, [auth.isAuthenticated, auth.refreshIdentity, online, busy, token, requestNote, toast]);

  const refreshStatus = async () => {
    if (!auth.isAuthenticated || !online || busy) return;
    setBusy(true); setError('');
    try { setStatus(await getMyHostelJoinRequestStatus(token)); }
    catch (cause) { setError(getFriendlySupabaseError(cause, 'Request-এর অবস্থা যাচাই করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const continueNormally = () => {
    clearPendingHostelLinkToken();
    navigateTo('/onboarding', true);
  };

  if (auth.authLoading || (auth.isAuthenticated && auth.identityLoading) || loading) {
    return <main className="hostel-invite-page"><LoadingSpinner label="Invitation যাচাই হচ্ছে..."/></main>;
  }

  return (
    <main className="hostel-invite-page">
      <header className="hostel-invite-topbar"><span><Icon name="shield-check" size={15}/> নিরাপদ সদস্য আমন্ত্রণ</span><EntryThemeSwitcher/></header>
      <section className="hostel-invite-card">
        <div className="hostel-invite-brand"><BrandMark size={56}/><span>HOSTEL LIFE</span></div>
        <span className="eyebrow">MEMBERSHIP INVITATION</span>
        <h1>মেসে যোগদানের আমন্ত্রণ</h1>
        {!auth.isAuthenticated ? <>
          <p className="hostel-invite-lead">এই লিংকটি একটি নির্দিষ্ট মেসে Join Request পাঠানোর জন্য। মেসের কোনো তথ্য বা ড্যাশবোর্ড দেখতে হলে আগে নিজের অ্যাকাউন্টে লগইন করতে হবে।</p>
          <div className="hostel-invite-security-note"><Icon name="lock" size={18}/><span>এই লিংক কাউকে স্বয়ংক্রিয়ভাবে সদস্য করে না এবং কোনো মেসের ব্যক্তিগত তথ্য প্রকাশ করে না। লগইন/রেজিস্ট্রেশনের পর সার্ভার লিংকটি যাচাই করবে।</span></div>
          <div className="hostel-invite-actions"><button className="primary-button large" type="button" onClick={() => navigateTo('/auth/login')}><Icon name="log-in" size={17}/> লগইন করুন</button><button className="secondary-button large" type="button" onClick={() => navigateTo('/auth/register')}><Icon name="user-plus" size={17}/> নতুন অ্যাকাউন্ট তৈরি করুন</button></div>
        </> : <>
          {info?.hostel_name && <div className="hostel-invite-hostel"><span>যে মেস থেকে আমন্ত্রণ এসেছে</span><strong><Icon name="home" size={18}/>{info.hostel_name}</strong><small>মেয়াদ শেষ: {new Date(info.expires_at).toLocaleString('bn-BD')}</small></div>}
          {error && <div className="hostel-invite-error" role="alert"><Icon name="alert-circle" size={18}/><span>{error}</span><button className="text-button" type="button" onClick={() => window.location.reload()}>আবার চেষ্টা</button></div>}
          {otherActiveHostel ? <div className="hostel-invite-security-note warning"><Icon name="shield-alert" size={18}/><span>আপনার অ্যাকাউন্ট বর্তমানে অন্য একটি মেসের সক্রিয় সদস্য। একই সময়ে একাধিক মেসে সক্রিয় সদস্যপদ অনুমোদিত নয়। আগে বর্তমান সদস্যপদ সমাধান করুন।</span></div> : null}
          {!otherActiveHostel && status?.status === 'pending' && <><InviteStatus status="pending"/><button className="secondary-button" type="button" disabled={busy || !online} onClick={refreshStatus}>অবস্থা যাচাই করুন</button></>}
          {!otherActiveHostel && status?.status === 'rejected' && <><InviteStatus status="rejected" note={status.review_note}/><button className="primary-button large" type="button" onClick={continueNormally}>সাধারণ মেস সেটআপে যান</button></>}
          {!otherActiveHostel && status?.status === 'approved' && <div className="hostel-invite-status approved"><Icon name="check-circle" size={18}/><div><strong>অনুরোধ অনুমোদিত</strong><span>সদস্যপদের তথ্য আপডেট হচ্ছে।</span></div></div>}
          {!otherActiveHostel && (status?.status === 'not_submitted' || !status) && info && <>
            <p className="hostel-invite-lead">এই মেসে যুক্ত হতে Join Code লাগবে না। নিচের বোতাম থেকে Join Request পাঠান। ম্যানেজার বা অনুমোদিত সহকারী যাচাই করে অনুমোদন দেবেন।</p>
            <label className="field-label"><span>ম্যানেজারের জন্য বার্তা (ঐচ্ছিক)</span><textarea rows={3} maxLength={500} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="নিজের পরিচয় বা প্রয়োজনীয় তথ্য লিখুন"/></label>
            <button className="primary-button large" type="button" disabled={busy || !online} onClick={submitRequest}>{busy ? 'অনুরোধ পাঠানো হচ্ছে...' : 'যোগদানের অনুরোধ পাঠান'}</button>
          </>}
          {!otherActiveHostel && !info && status?.status !== 'pending' && status?.status !== 'rejected' && status?.status !== 'approved' && <button className="secondary-button large" type="button" onClick={continueNormally}>সাধারণ মেস সেটআপে যান</button>}
        </>}
        <footer className="hostel-invite-footer"><Icon name="shield-check" size={16}/><span>সদস্যপদ সক্রিয় হবে শুধু সার্ভার যাচাই ও ম্যানেজারের অনুমোদনের পর।</span></footer>
      </section>
    </main>
  );
}
