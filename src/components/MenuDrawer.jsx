import { Icon } from './Icon';
import { TelegramLogo } from './TelegramLogo';

const commonItems = [
  { key: 'meal-sheet', label: 'মিল শিট', icon: 'calendar-check', tone: 'blue' },
  { key: 'archive', label: 'বন্ধ মাসসমূহ', icon: 'archive', tone: 'slate' },
  { key: 'reports', label: 'রিপোর্ট ডাউনলোড', icon: 'file-text', tone: 'violet' },
  { key: 'members', label: 'সকল সদস্য', icon: 'users', tone: 'cyan' },
  { key: 'khala-money-view', label: 'খালার টাকা', icon: 'wallet', tone: 'amber' },
  { key: 'top-eater', label: 'শীর্ষ খাদক', icon: 'trophy', tone: 'rose' },
  { key: 'top-shopper', label: 'বেশি বাজারকারী', icon: 'shopping-basket', tone: 'teal' },
  { key: 'top-depositor', label: 'বেশি ডিপোজিটকারী', icon: 'hand-coins', tone: 'green' },
];

const systemItems = [
  { key: 'privacy-policy', label: 'গোপনীয়তা ও নীতিমালা', icon: 'shield-check', tone: 'slate' },
  { key: 'terms', label: 'ব্যবহারের শর্তাবলী', icon: 'file-text', tone: 'slate' },
  { key: 'how-to-use', label: 'কীভাবে ব্যবহার করব', icon: 'book-open', tone: 'blue' },
  { key: 'app-download', label: 'অ্যাপ ডাউনলোড', icon: 'smartphone', tone: 'violet' },
  { key: 'telegram', label: 'টেলিগ্রাম সংযোগ', icon: 'send', tone: 'blue' },
  { key: 'developer', label: 'হেল্প', icon: 'message-circle', tone: 'amber' },
];

const primaryItems = [
  { key: 'current-month-close', label: 'বর্তমান মাস শেষ করুন', icon: 'calendar-check', tone: 'amber' },
  { key: 'new-month', label: 'নতুন মাস শুরু', icon: 'plus-circle', tone: 'green' },
  { key: 'change-manager', label: 'ম্যানেজার পরিবর্তন', icon: 'shield-check', tone: 'violet' },
  { key: 'assistant-managers', label: 'সহকারী ম্যানেজার', icon: 'users', tone: 'cyan' },
  { key: 'hostel-settings', label: 'মেস সেটিংস', icon: 'lock', tone: 'slate' },
  { key: 'send-notification', label: 'মেস নোটিশ', icon: 'bell', tone: 'blue' },
  { key: 'khala-money', label: 'খালার টাকা', icon: 'wallet', tone: 'amber' },
  { key: 'join-requests', label: 'জয়েন রিকোয়েস্ট পর্যালোচনা', icon: 'user-check', tone: 'teal' },
  { key: 'member-management', label: 'সদস্য ব্যবস্থাপনা', icon: 'user-round', tone: 'cyan' },
];

const assistantItems = [
  { key: 'dining-operations', label: 'ডাইনিং ব্যবস্থাপনা', icon: 'cooking-pot', tone: 'amber' },
  { key: 'hostel-settings', label: 'মেস সেটিংস', icon: 'lock', tone: 'slate' },
  { key: 'join-requests', label: 'জয়েন রিকোয়েস্ট পর্যালোচনা', icon: 'user-check', tone: 'teal' },
  { key: 'khala-money', label: 'খালার টাকা', icon: 'wallet', tone: 'amber' },
];

function itemPath(key) {
  if (key === 'dining-operations') return '/app/dining';
  if (key === 'archive-edit-access') return '/app/menu/archive';
  return `/app/menu/${key}`;
}

function MenuRows({ items, currentPath, onSelect, manager = false }) {
  return items.map((item) => {
    const path = itemPath(item.key);
    const active = currentPath === path || currentPath.startsWith(`${path}/`);
    return (
      <button
        className={`menu-row ${manager ? 'manager-menu-row' : ''} ${active ? 'is-active' : ''}`.trim()}
        key={item.key}
        type="button"
        onClick={() => onSelect(item.key)}
        aria-current={active ? 'page' : undefined}
      >
        <span className={`menu-row-icon tone-${item.tone || 'slate'}`} aria-hidden="true">
          {item.key === 'telegram' ? <TelegramLogo size={18} monochrome /> : <Icon name={item.icon} size={19} />}
        </span>
        <span className="menu-row-label">{item.label}</span>
        <Icon name="chevron-right" size={16} className="menu-chevron" />
      </button>
    );
  });
}

export function MenuDrawer({ open, onClose, isManager = false, isPrimaryManager = false, isOperationalManager = false, hasClosedMonthAccess = false, onAction, profile, hostelName, role }) {
  if (!open) return null;

  const click = (key) => {
    onAction?.(key);
    onClose();
  };

  const initials = profile?.full_name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';
  const effectivePrimaryManager = Boolean(isManager || isPrimaryManager);
  const effectiveOperationalManager = Boolean(isManager || isOperationalManager);
  const managerItems = effectivePrimaryManager ? primaryItems : effectiveOperationalManager ? assistantItems : [];
  const currentPath = window.location.pathname || '';

  return (
    <>
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="মেনু বন্ধ করুন" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-user">
        <header className="drawer-header">
          <div className="drawer-identity-card">
            <div className="drawer-brand-row">
              {profile?.avatar_url ? (
                <img className="drawer-avatar-image" src={profile.avatar_url} alt="" />
              ) : (
                <span className="avatar drawer-avatar-fallback" aria-hidden="true">{initials}</span>
              )}
              <div className="drawer-identity-copy">
                <div className="drawer-title" id="drawer-title">{hostelName ? <span data-user-content>{hostelName}</span> : 'Hostel Life'}</div>
                <div className="drawer-subtitle" id="drawer-user">{profile?.full_name ? <span data-user-content>{profile.full_name}</span> : 'ব্যবহারকারী'}</div>
                <span className={`drawer-role-pill ${effectiveOperationalManager ? 'is-manager' : ''}`}>
                  <Icon name={effectiveOperationalManager ? 'shield-check' : 'user-round'} size={12} />
                  {role || 'সদস্য'}
                </span>
              </div>
            </div>
          </div>
          <button className="icon-button drawer-close" type="button" onClick={onClose} aria-label="মেনু বন্ধ করুন">
            <Icon name="x" size={20} />
          </button>
        </header>

        <nav className="drawer-navigation" aria-label="অ্যাপ মেনু">
          <section className="menu-group" aria-labelledby="menu-group-common">
            <div className="menu-group-title" id="menu-group-common">হিসাব ও সদস্য</div>
            <MenuRows items={commonItems.filter((item) => !(effectiveOperationalManager && item.key === 'khala-money-view'))} currentPath={currentPath} onSelect={click} />
          </section>

          <section className="menu-group system-group" aria-labelledby="menu-group-system">
            <div className="menu-group-title" id="menu-group-system">সিস্টেম তথ্য</div>
            <MenuRows items={systemItems} currentPath={currentPath} onSelect={click} />
          </section>

          {effectiveOperationalManager && (
            <section className="menu-group manager-group" aria-labelledby="menu-group-manager">
              <div className="menu-group-title manager-title" id="menu-group-manager">
                <span className="menu-group-title-icon"><Icon name="shield-check" size={14} /></span>
                {effectivePrimaryManager ? 'ম্যানেজার ফিচার' : 'সহকারী ম্যানেজার'}
              </div>
              <MenuRows items={managerItems} currentPath={currentPath} onSelect={click} manager />
            </section>
          )}
        </nav>

        <footer className="drawer-footer">
          <button className="menu-row logout-row" type="button" onClick={() => click('logout')}>
            <span className="menu-row-icon danger-icon" aria-hidden="true"><Icon name="logout" size={18} /></span>
            <span className="menu-row-label">লগআউট</span>
            <Icon name="chevron-right" size={16} className="menu-chevron" />
          </button>
        </footer>
      </aside>
    </>
  );
}
