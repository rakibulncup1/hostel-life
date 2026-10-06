import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useAuth } from '../../contexts/AuthContext';

export function IdentityErrorPage() {
  const { identityError, refreshIdentity, signOut } = useAuth();
  const online = useOnlineStatus();
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const retry = async () => {
    if (!online) {
      toast.warning('তথ্য লোড করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setRetrying(true);
    try {
      await refreshIdentity();
      toast.success('অ্যাকাউন্টের তথ্য আবার লোড হয়েছে।');
    } catch {
      toast.error('তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setRetrying(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      toast.error('লগআউট করা যায়নি।');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <main className="account-state-page">
      <section className="account-state-card card">
        <div className="state-icon"><Icon name={online ? 'warning' : 'offline'} size={28} /></div>
        <span className="eyebrow">অ্যাকাউন্ট যাচাই</span>
        <h1>{online ? 'অ্যাকাউন্টের তথ্য লোড করা যায়নি' : 'ইন্টারনেট সংযোগ নেই'}</h1>
        <p>{online ? (identityError || 'আপনার অ্যাকাউন্টের তথ্য এই মুহূর্তে পাওয়া যাচ্ছে না।') : 'লগইন সেশন পাওয়া গেছে, কিন্তু মেসের তথ্য যাচাই করতে ইন্টারনেট সংযোগ প্রয়োজন।'}</p>
        <div className="account-state-actions">
          <button className="primary-button" type="button" onClick={retry} disabled={retrying || !online}>
            {retrying ? 'আবার চেষ্টা হচ্ছে...' : 'আবার চেষ্টা করুন'}
          </button>
          <button className="secondary-button" type="button" onClick={logout} disabled={loggingOut}>
            {loggingOut ? 'লগআউট হচ্ছে...' : 'লগআউট'}
          </button>
        </div>
      </section>
    </main>
  );
}
