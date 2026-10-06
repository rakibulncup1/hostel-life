import { Icon } from './Icon';

export function OfflineState({ title = 'ইন্টারনেট সংযোগ প্রয়োজন', description = 'এই অংশটি ব্যবহার করতে ডাটা বা Wi‑Fi চালু করুন।' }) {
  return (
    <section className="state-card state-card-warning">
      <div className="state-icon"><Icon name="offline" size={30} /></div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}
