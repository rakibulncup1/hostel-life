import { Icon } from './Icon';
import { formatTime12 } from '../utils/time';

export function Header({ hostelName = 'Hostel Life', role = 'সদস্য', isOnline, unreadCount = 0, onMenu, onNotifications }) {
  return (
    <header className="app-header">
      <button className="icon-button menu-trigger" onClick={onMenu} aria-label="মেনু খুলুন">
        <Icon name="menu" size={23} />
      </button>

      <div className="brand-block">
        <div className="brand-name">{hostelName}</div>
        <span className="role-badge"><Icon name="shield" size={12} /> {role}</span>
      </div>

      <div className="header-actions">
        <span className={`network-pill ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'অনলাইন' : 'অফলাইন'}>
          <span className="network-dot" />
          <span className="network-text">{isOnline ? 'অনলাইন' : 'অফলাইন'}</span>
        </span>
        <button className="icon-button notification-trigger" onClick={onNotifications} aria-label="নোটিফিকেশন">
          <Icon name="bell" size={21} />
          {unreadCount > 0 && <span className="notification-count" aria-label={`${unreadCount}টি নতুন নোটিফিকেশন`}>{unreadCount > 9 ? '৯+' : unreadCount}</span>}
        </button>
      </div>
    </header>
  );
}

export function SyncTime({ value }) {
  return <span className="sync-time">শেষ সিঙ্ক: {formatTime12(value)}</span>;
}
