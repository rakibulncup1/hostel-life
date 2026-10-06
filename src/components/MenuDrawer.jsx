import { Icon } from './Icon';

const commonItems = [
  { key: 'meal-sheet', label: 'মিল শিট', icon: 'history' },
  { key: 'reports', label: 'রিপোর্ট ডাউনলোড', icon: 'download' },
  { key: 'members', label: 'সকল সদস্য', icon: 'user' },
  { key: 'top-eater', label: 'শীর্ষ খাদক', icon: 'dining' },
  { key: 'top-shopper', label: 'বেশি বাজারকারী', icon: 'dining' },
  { key: 'developer', label: 'ডেভেলপার ইনফো', icon: 'user' },
];

const managerItems = [
  { key: 'new-month', label: 'নতুন মাস শুরু', icon: 'history' },
  { key: 'change-manager', label: 'ম্যানেজার পরিবর্তন', icon: 'shield' },
  { key: 'hostel-settings', label: 'মেস সেটিংস', icon: 'lock' },
  { key: 'archive', label: 'আর্কাইভ', icon: 'history' },
  { key: 'send-notification', label: 'নোটিফিকেশন পাঠান', icon: 'bell' },
  { key: 'khala-money', label: 'খালার টাকা', icon: 'dining' },
  { key: 'member-management', label: 'সদস্য ব্যবস্থাপনা', icon: 'user' },
];

export function MenuDrawer({ open, onClose, isManager = false, canInstall, onInstall, onAction, profile, hostelName, role }) {
  if (!open) return null;

  const click = (key) => {
    onAction?.(key);
    onClose();
  };

  const initials = profile?.full_name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';

  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="মেনু বন্ধ করুন" />
      <aside className="drawer" aria-label="সাইড মেনু">
        <div className="drawer-header">
          <div className="drawer-brand-row">
            {profile?.avatar_url ? (
              <img className="drawer-avatar-image" src={profile.avatar_url} alt="প্রোফাইল" />
            ) : (
              <span className="avatar">{initials}</span>
            )}
            <div>
              <div className="drawer-title">{hostelName || 'Hostel Life'}</div>
              <div className="drawer-subtitle">{profile?.full_name || 'ব্যবহারকারী'} · {role}</div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={21} /></button>
        </div>

        {canInstall && (
          <button className="install-card" onClick={onInstall}>
            <span className="install-card-icon"><Icon name="download" size={19} /></span>
            <span>
              <strong>অ্যাপ ইনস্টল করুন</strong>
              <small>হোম স্ক্রিন থেকে অ্যাপের মতো খুলুন</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        )}

        <div className="menu-group">
          <div className="menu-group-title">সাধারণ</div>
          {commonItems.map((item) => (
            <button className="menu-row" key={item.key} onClick={() => click(item.key)}>
              <span className="menu-row-icon"><Icon name={item.icon} size={18} /></span>
              <span>{item.label}</span>
              <Icon name="chevron" size={16} className="menu-chevron" />
            </button>
          ))}
        </div>

        {isManager && (
          <div className="menu-group manager-group">
            <div className="menu-group-title manager-title"><Icon name="shield" size={13} /> ম্যানেজার ফিচার</div>
            {managerItems.map((item) => (
              <button className="menu-row" key={item.key} onClick={() => click(item.key)}>
                <span className="menu-row-icon manager-icon"><Icon name={item.icon} size={18} /></span>
                <span>{item.label}</span>
                <span className="power-badge">পাওয়ার</span>
              </button>
            ))}
          </div>
        )}

        <div className="menu-group logout-group">
          <button className="menu-row logout-row" onClick={() => click('logout')}>
            <span className="menu-row-icon danger-icon"><Icon name="logout" size={18} /></span>
            <span>লগআউট</span>
            <Icon name="chevron" size={16} className="menu-chevron" />
          </button>
        </div>
      </aside>
    </>
  );
}
