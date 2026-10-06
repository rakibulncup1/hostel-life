import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { LoadingSpinner } from './LoadingSpinner';
import { useToast } from './Toast';
import { deleteMyNotification, fetchNotifications, managerDeleteNotification, markNotificationSeen } from '../services/notificationService';
import { formatDateTime12 } from '../utils/time';
import { getFriendlySupabaseError } from '../utils/supabaseErrors';

function typeLabel(type) {
  if (type === 'manager_message') return 'ম্যানেজারের বার্তা';
  if (type === 'market_entry') return 'বাজার আপডেট';
  return 'সিস্টেম নোটিফিকেশন';
}

export function NotificationsPopover({ isManager = false, onUnreadChange }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchNotifications(50);
      setItems(next);
      onUnreadChange?.(next.filter((item) => !item.is_seen).length);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange, toast]);

  useEffect(() => { load(); }, [load]);

  const unreadCount = useMemo(() => items.filter((item) => !item.is_seen).length, [items]);

  const seen = async (item) => {
    if (item.is_seen) return;
    setBusyId(item.notification_id);
    try {
      await markNotificationSeen(item.notification_id);
      setItems((current) => current.map((row) => row.notification_id === item.notification_id ? { ...row, is_seen: true, seen_at: new Date().toISOString() } : row));
      onUnreadChange?.(Math.max(0, unreadCount - 1));
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন দেখা হিসেবে চিহ্নিত করা যায়নি।'));
    } finally {
      setBusyId('');
    }
  };

  const markAllSeen = async () => {
    const unseen = items.filter((item) => !item.is_seen);
    if (!unseen.length) return toast.info('সব নোটিফিকেশন আগেই দেখা হয়েছে।');
    setBusyId('all');
    try {
      await Promise.all(unseen.map((item) => markNotificationSeen(item.notification_id)));
      setItems((current) => current.map((row) => ({ ...row, is_seen: true, seen_at: row.seen_at || new Date().toISOString() })));
      onUnreadChange?.(0);
      toast.success('সব নোটিফিকেশন দেখা হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'সব নোটিফিকেশন দেখা হিসেবে চিহ্নিত করা যায়নি।'));
    } finally {
      setBusyId('');
    }
  };

  const remove = async (item) => {
    if (isManager && !window.confirm('এই নোটিফিকেশনটি সব সদস্যের জন্য মুছে দিতে চান?')) return;
    setBusyId(item.notification_id);
    try {
      if (isManager) await managerDeleteNotification(item.notification_id);
      else await deleteMyNotification(item.notification_id);
      setItems((current) => current.filter((row) => row.notification_id !== item.notification_id));
      onUnreadChange?.(items.filter((row) => row.notification_id !== item.notification_id && !row.is_seen).length);
      toast.success('নোটিফিকেশন মুছে দেওয়া হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন মুছে দেওয়া যায়নি।'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="notification-panel-card card" role="dialog" aria-label="নোটিফিকেশন">
      <div className="notification-panel-head">
        <div>
          <span className="eyebrow">আপনার আপডেট</span>
          <h2>নোটিফিকেশন</h2>
        </div>
        <div className="notification-panel-actions">
          {unreadCount > 0 && <button className="text-button" type="button" disabled={busyId === 'all'} onClick={markAllSeen}>সব দেখা</button>}
          <button className="icon-button ghost" type="button" onClick={load} aria-label="রিফ্রেশ"><Icon name="refresh" size={17} /></button>
        </div>
      </div>

      {loading ? <div className="notification-loading"><LoadingSpinner label="নোটিফিকেশন লোড হচ্ছে..." /></div> : items.length === 0 ? (
        <div className="empty-state-card compact-empty"><Icon name="bell" size={24} /><strong>কোনো নোটিফিকেশন নেই</strong><span>নতুন আপডেট এলে এখানে দেখা যাবে।</span></div>
      ) : (
        <div className="notification-list">
          {items.map((item) => (
            <article className={`notification-item ${item.is_seen ? 'seen' : 'unseen'}`} key={item.notification_id}>
              <button className="notification-main" type="button" onClick={() => seen(item)} disabled={busyId === item.notification_id}>
                <span className="notification-icon"><Icon name={item.notification_type === 'market_entry' ? 'dining' : item.notification_type === 'manager_message' ? 'bell' : 'info'} size={17} /></span>
                <span className="notification-copy">
                  <strong>{item.title}</strong>
                  <small>{typeLabel(item.notification_type)} · {formatDateTime12(item.created_at)}</small>
                  <span>{item.body}</span>
                </span>
              </button>
              <button className="icon-button compact-icon ghost notification-delete" type="button" disabled={busyId === item.notification_id} onClick={() => remove(item)} aria-label="নোটিফিকেশন মুছুন"><Icon name="trash" size={16} /></button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
