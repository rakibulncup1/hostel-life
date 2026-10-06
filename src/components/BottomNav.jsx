import { Icon } from './Icon';

const items = [
  { key: 'dashboard', label: 'ড্যাশবোর্ড', icon: 'home' },
  { key: 'dining', label: 'ডাইনিং', icon: 'dining' },
  { key: 'history', label: 'হিস্টরি', icon: 'history' },
  { key: 'profile', label: 'প্রোফাইল', icon: 'user' },
];

export function BottomNav({ active, onNavigate, disabled = false }) {
  return (
    <nav className="bottom-nav" aria-label="প্রধান নেভিগেশন">
      {items.map((item) => (
        <button
          key={item.key}
          className={`nav-item ${active === item.key ? 'active' : ''}`}
          onClick={() => onNavigate(item.key)}
          disabled={disabled}
        >
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
