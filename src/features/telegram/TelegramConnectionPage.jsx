import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { TelegramLogo } from '../../components/TelegramLogo';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import {
  createMyTelegramLink,
  getMyTelegramNotificationStatus,
  unlinkMyTelegram,
} from '../../services/telegramService';
import { confirmAction } from '../../utils/actionDialogs';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

function rememberConnectionStatus(next, userId) {
  if (!userId) return;
  const key = `hostel-life-telegram-connected-v1:${userId}`;
  try { if (next?.connected) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* Optional local reminder only. */ }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });
}

export function TelegramConnectionPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await getMyTelegramNotificationStatus();
      setStatus(next);
      rememberConnectionStatus(next, user?.id);
    }
    catch (cause) { setError(getFriendlySupabaseError(cause, 'টেলিগ্রাম সংযোগের তথ্য আনা যায়নি।')); }
    finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // When the user returns from টেলিগ্রাম after pressing শুরু, silently refresh
  // the authoritative connection state instead of requiring a manual reload.
  useEffect(() => {
    if (!link) return undefined;
    let checking = false;
    const refreshAfterTelegram = async () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      try {
        const next = await getMyTelegramNotificationStatus();
        setStatus(next);
        rememberConnectionStatus(next, user?.id);
        if (next.connected) {
          setLink(null);
          toast.success('আপনার টেলিগ্রাম অ্যাকাউন্ট সফলভাবে যুক্ত হয়েছে।');
        }
      } catch { /* Manual verification remains available when the network is unavailable. */ }
      finally { checking = false; }
    };
    window.addEventListener('focus', refreshAfterTelegram);
    document.addEventListener('visibilitychange', refreshAfterTelegram);
    return () => {
      window.removeEventListener('focus', refreshAfterTelegram);
      document.removeEventListener('visibilitychange', refreshAfterTelegram);
    };
  }, [link?.token, user?.id, toast]);

  const connect = async () => {
    setBusy(true); setError(''); setLink(null);
    try { setLink(await createMyTelegramLink()); }
    catch (cause) { setError(getFriendlySupabaseError(cause, 'টেলিগ্রাম সংযোগের লিংক তৈরি করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError('');
    try {
      const next = await getMyTelegramNotificationStatus();
      setStatus(next);
      rememberConnectionStatus(next, user?.id);
      if (next.connected) { setLink(null); toast.success('আপনার টেলিগ্রাম অ্যাকাউন্ট সফলভাবে যুক্ত হয়েছে।'); }
      else toast.info('বটে শুরু বোতাম চাপার পর আবার যাচাই করুন।');
    } catch (cause) { setError(getFriendlySupabaseError(cause, 'সংযোগ যাচাই করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!await confirmAction('টেলিগ্রাম সংযোগ বিচ্ছিন্ন করবেন? এরপর নতুন বিজ্ঞপ্তি টেলিগ্রামে যাবে না।')) return;
    setBusy(true); setError('');
    try { await unlinkMyTelegram(); if (user?.id) { try { localStorage.removeItem(`hostel-life-telegram-connected-v1:${user.id}`); } catch { /* Optional local reminder only. */ } } setStatus((current) => ({ ...current, connected: false, connected_at: null, provider_username: null })); setLink(null); toast.success('টেলিগ্রাম সংযোগ বিচ্ছিন্ন হয়েছে।'); }
    catch (cause) { setError(getFriendlySupabaseError(cause, 'টেলিগ্রাম সংযোগ বিচ্ছিন্ন করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link.url); toast.success('টেলিগ্রাম সংযোগ লিংক কপি হয়েছে।'); }
    catch { toast.warning('লিংকটি কপি করা যায়নি। টেলিগ্রাম বোতাম ব্যবহার করুন।'); }
  };

  if (loading) return <main className="page-container telegram-page"><LoadingSpinner label="টেলিগ্রাম সংযোগ যাচাই হচ্ছে..."/></main>;

  return (
    <main className="page-container telegram-page">
      <header className="page-heading telegram-heading">
        <span className="eyebrow">ব্যক্তিগত বিজ্ঞপ্তি</span>
        <h1>টেলিগ্রাম সংযোগ</h1>
        <p>Hostel Life-এর গুরুত্বপূর্ণ বিজ্ঞপ্তি টেলিগ্রামে পেতে সংযোগ করুন।</p>
      </header>

      <section className="card telegram-connection-card">
        <div className="telegram-card-hero">
          <span className="telegram-brand-icon"><TelegramLogo size={52}/></span>
          <span className={`telegram-state ${status?.connected ? 'is-connected' : 'is-offline'}`}>{status?.connected ? 'সংযুক্ত' : 'সংযুক্ত নয়'}</span>
          <span className="eyebrow">ব্যক্তিগত সংযোগ</span>
          <h2>{status?.connected ? 'আপনার টেলিগ্রাম যুক্ত আছে' : 'টেলিগ্রামে বিজ্ঞপ্তি পান'}</h2>
          <p>Hostel Life-এর গুরুত্বপূর্ণ বার্তা আপনার টেলিগ্রামে পৌঁছাবে।</p>
        </div>

        {status?.connected ? (
          <div className="telegram-connected-summary">
            <div><span>টেলিগ্রাম ব্যবহারকারীর নাম</span><strong>{status.provider_username ? `@${status.provider_username.replace(/^@/, '')}` : 'সংযুক্ত অ্যাকাউন্ট'}</strong></div>
            <div><span>সংযুক্তির সময়</span><strong>{formatDate(status.connected_at)}</strong></div>
            <p>অ্যাপের গুরুত্বপূর্ণ বিজ্ঞপ্তি ও মেসের বার্তা এই টেলিগ্রামে পাঠানো হবে।</p>
            <div className="telegram-actions"><button type="button" className="secondary-button" disabled={busy} onClick={verify}><Icon name="refresh" size={16}/> সংযোগ যাচাই</button><button type="button" className="danger-button" disabled={busy} onClick={disconnect}>সংযোগ বিচ্ছিন্ন</button></div>
          </div>
        ) : (
          <div className="telegram-connect-content">
            {status?.telegram_enabled ? <>
              <div className="telegram-steps"><span><b>১</b> সংযোগ লিংক তৈরি করুন</span><span><b>২</b> টেলিগ্রামে বট খুলে <strong>শুরু</strong> চাপুন</span><span><b>৩</b> এখানে ফিরে যাচাই করুন</span></div>
              <button type="button" className="primary-button telegram-connect-button" disabled={busy} onClick={connect}><TelegramLogo size={20}/> {busy ? 'তৈরি হচ্ছে...' : 'টেলিগ্রাম সংযোগ করুন'}</button>
            </> : <div className="telegram-unavailable"><Icon name="info" size={19}/><span>টেলিগ্রাম সংযোগ এখনো চালু করা হয়নি। সেটআপ সম্পন্ন হলে এখানে সংযোগ করতে পারবেন।</span></div>}
          </div>
        )}

        {link && <div className="telegram-link-result">
          <div><strong>সংযোগ লিংক তৈরি হয়েছে</strong><small>লিংকটি ১০ মিনিটের মধ্যে ব্যবহার করুন। এটি একবারই কার্যকর।</small></div>
          <a className="primary-button" href={link.url} target="_blank" rel="noopener noreferrer"><TelegramLogo size={19}/> টেলিগ্রাম খুলুন</a>
          <button type="button" className="secondary-button" onClick={copyLink}>লিংক কপি</button>
          <button type="button" className="text-button" disabled={busy} onClick={verify}>শুরু চাপার পর যাচাই করুন</button>
        </div>}
        {error && <div className="inline-error telegram-error" role="alert">{error}</div>}
      </section>

      <p className="telegram-privacy-note"><Icon name="shield-check" size={16}/> সংযোগটি ঐচ্ছিক। আপনি যেসব অ্যাপ নোটিফিকেশন পান, কেবল সেগুলোর বার্তাই টেলিগ্রামে পাঠানো হবে। পাসওয়ার্ড, লগইন কোড বা গোপন নিরাপত্তা তথ্য পাঠানো হয় না। অ্যাকাউন্টের গোপনীয়তা টেলিগ্রামের নিজস্ব নীতির অধীন।</p>
    </main>
  );
}
