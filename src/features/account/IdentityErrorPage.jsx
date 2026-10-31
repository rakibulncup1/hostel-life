import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useAuth } from '../../contexts/AuthContext';

export function IdentityErrorPage() {
  const { identityError, refreshIdentity } = useAuth();
  const online = useOnlineStatus();
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);

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

  return (
    <main className="account-state-page">
      <section className="account-state-card card">
        <div className="state-icon"><Icon name={online ? 'warning' : 'offline'} size={28} /></div>
        <span className="eyebrow">সংযোগ ও সেশন</span>
        <h1>{online ? 'Hostel Life-এ সাময়িক সমস্যা হচ্ছে' : 'ইন্টারনেট সংযোগ নেই'}</h1>
        <p>{online ? 'আপনার লগইন সেশন এই ডিভাইসে আছে, কিন্তু এই মুহূর্তে সার্ভার থেকে মেসের তথ্য যাচাই করা যাচ্ছে না। এটি সাময়িক নেটওয়ার্ক বা সার্ভার সমস্যাও হতে পারে।' : 'আপনার লগইন সেশন এই ডিভাইসে আছে। ইন্টারনেট ফিরে এলে আবার চেষ্টা করুন; শুধু এই কারণে লগআউট করার দরকার নেই।'}</p>
        {identityError && <div className="identity-recovery-error" role="status">{identityError}</div>}
        <div className="identity-recovery-note">
          <strong>ওয়েবসাইট সরাসরি খুলুন</strong>
          <p>পেজ না খুললে ব্রাউজারের Address Bar-এ নিচের ঠিকানাটি লিখে খুলুন:</p>
          <a href="https://hostellife-bd.vercel.app/" target="_blank" rel="noreferrer">hostellife-bd.vercel.app <Icon name="external-link" size={14} /></a>
        </div>
        <div className="account-state-actions identity-recovery-actions">
          <button className="primary-button" type="button" onClick={retry} disabled={retrying || !online}>
            {retrying ? 'আবার চেষ্টা হচ্ছে...' : 'আবার চেষ্টা করুন'}
          </button>
          <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
            <Icon name="refresh" size={15} /> পেজ রিলোড করুন
          </button>
        </div>
      </section>
    </main>
  );
}
