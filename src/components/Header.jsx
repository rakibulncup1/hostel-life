import { Icon } from './Icon';
import { formatTime12 } from '../utils/time';

export function Header({ hostelName = 'Hostel Life', profileName = null, role = 'সদস্য', periodLabel = null, isOnline, unreadCount = 0, onMenu, onNotifications }) {
  return (
    <header className="app-header">
      <button className="icon-button menu-trigger" type="button" onClick={onMenu} aria-label="মেনু খুলুন">
        <Icon name="menu" size={23} />
      </button>

      <div className="brand-block">
        <div className="brand-name-row">
          <div className="brand-name">{hostelName}</div>
          {periodLabel && <span className="period-badge header-period-badge"><Icon name="calendar" size={11} /> {periodLabel}</span>}
        </div>
        <div className="header-context-row">
          {profileName && <span className="header-name-badge" title={profileName}>{profileName}</span>}
          <span className="role-badge"><Icon name="shield" size={12} /> {role}</span>
          {!periodLabel && <span className="no-period-badge"><Icon name="calendar" size={11} /> এখনো মাস শুরু হয়নি</span>}
        </div>
      </div>

      <div className="header-actions">
        <span className={`network-pill ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'অনলাইন' : 'অফলাইন'}>
          <span className="network-dot" />
          <span className="network-text">{isOnline ? 'অনলাইন' : 'অফলাইন'}</span>
        </span>
        <button className="icon-button notification-trigger" type="button" onClick={onNotifications} aria-label="নোটিফিকেশন">
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
