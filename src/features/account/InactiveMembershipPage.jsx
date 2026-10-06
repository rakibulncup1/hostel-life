import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';

export function InactiveMembershipPage() {
  const { membership, signOut } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const logout = async () => {
    setLoading(true);
    try {
      await signOut();
    } catch (error) {
      toast.error('লগআউট করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="account-state-page">
      <section className="account-state-card card">
        <div className="state-icon"><Icon name="lock" size={28} /></div>
        <span className="eyebrow">অ্যাকাউন্ট স্ট্যাটাস</span>
        <h1>আপনার সদস্যতা বর্তমানে নিষ্ক্রিয়</h1>
        <p>
          {membership?.hostel_name ? `“${membership.hostel_name}” মেসে আপনার সদস্যতা বর্তমানে নিষ্ক্রিয় রয়েছে।` : 'আপনার মেস সদস্যতা বর্তমানে নিষ্ক্রিয় রয়েছে।'}
        </p>
        <p className="muted-note">আবার মেসে যোগ দিতে হলে বর্তমান ম্যানেজারের মাধ্যমে আপনাকে পুনরায় সক্রিয় করতে হবে।</p>
        <button className="primary-button" type="button" onClick={logout} disabled={loading}>
          {loading ? 'লগআউট হচ্ছে...' : 'লগআউট'}
        </button>
      </section>
    </main>
  );
}
