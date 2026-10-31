import { Icon } from './Icon';

export function OfflineState({ title = 'ইন্টারনেট সংযোগ প্রয়োজন', description = 'এই অংশটি ব্যবহার করতে ডাটা বা Wi‑Fi চালু করুন।', onBack }) {
  return (
    <section className="state-card state-card-warning offline-recovery-state" role="status">
      <div className="state-icon"><Icon name="offline" size={30} /></div>
      <div className="offline-recovery-copy">
        <h2>{title}</h2>
        <p>{description} সংযোগ ফিরে এলে আবার চেষ্টা করুন। ড্যাশবোর্ডে সর্বশেষ সংরক্ষিত তথ্য দেখা যেতে পারে।</p>
        <div className="offline-recovery-actions">
          <button className="secondary-button compact" type="button" onClick={() => window.location.reload()}>
            <Icon name="refresh" size={15} /> আবার চেষ্টা করুন
          </button>
          <span>ওয়েবসাইটের ঠিকানা:</span>
          <a href="https://hostellife-bd.vercel.app/" target="_blank" rel="noreferrer">hostellife-bd.vercel.app <Icon name="external-link" size={13} /></a>
          {onBack && <button className="secondary-button compact" type="button" onClick={onBack}><Icon name="arrow-left" size={15}/> ড্যাশবোর্ডে ফিরে যান</button>}
        </div>
      </div>
    </section>
  );
}
