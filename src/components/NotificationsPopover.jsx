import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { LoadingSpinner } from './LoadingSpinner';
import { useToast } from './Toast';
import { deleteAllMyNotifications, deleteMyNotification, fetchNotifications, managerDeleteNotification, markNotificationSeen } from '../services/notificationService';
import { formatDateTime12 } from '../utils/time';
import { getFriendlySupabaseError } from '../utils/supabaseErrors';

function typeLabel(type) {
  if (type === 'manager_message') return 'ম্যানেজারের বার্তা';
  if (type === 'market_entry') return 'বাজার আপডেট';
  if (['new_month', 'month_started', 'period_started'].includes(type)) return 'নতুন মাস';
  if (['manager_change', 'manager_changed'].includes(type)) return 'ম্যানেজার পরিবর্তন';
  if (['membership_change', 'member_added', 'member_status'].includes(type)) return 'সদস্য আপডেট';
  if (['meal_request_approved', 'meal_request_rejected', 'meal_request_update'].includes(type)) return 'মিল অনুরোধ';
  if (['archive_deleted', 'retention_updated'].includes(type)) return 'আর্কাইভ ও সংরক্ষণ নীতি';
  return 'সিস্টেম নোটিফিকেশন';
}

export function NotificationsPopover({ isManager = false, onUnreadChange, onClose }) {
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

  useEffect(() => {
    load();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [load, onClose]);

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
    const successes = new Set();
    try {
      // Small batches avoid a burst of 50 simultaneous Supabase writes on Free plan.
      // Each successful acknowledgement is preserved even if a later request fails.
      for (let offset = 0; offset < unseen.length; offset += 4) {
        const batch = unseen.slice(offset, offset + 4);
        const results = await Promise.allSettled(batch.map((item) => markNotificationSeen(item.notification_id)));
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') successes.add(batch[index].notification_id);
        });
      }
      setItems((current) => current.map((row) => successes.has(row.notification_id)
        ? { ...row, is_seen: true, seen_at: row.seen_at || new Date().toISOString() } : row));
      onUnreadChange?.(items.filter((row) => !row.is_seen && !successes.has(row.notification_id)).length);
      if (successes.size === unseen.length) toast.success('সব নোটিফিকেশন দেখা হয়েছে।');
      else toast.warning(`${successes.size}টি দেখা হয়েছে, ${unseen.length - successes.size}টি বাকি। পরে আবার চেষ্টা করুন।`);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন আপডেট করা যায়নি।'));
    } finally {
      setBusyId('');
    }
  };

  // Delete only the current recipient's inbox copy. The manager RPC still applies
  // its manager permission check and is restricted to recipient_user_id = auth.uid().
  const removeAllMine = async () => {
    if (!items.length || !window.confirm('আপনার ইনবক্সের সব নোটিফিকেশন সার্ভার থেকে স্থায়ীভাবে মুছে ফেলবেন? এই কাজ ফিরিয়ে নেওয়া যাবে না। অন্য সদস্যদের ইনবক্স অক্ষত থাকবে।')) return;
    setBusyId('delete-all');
    try {
      await deleteAllMyNotifications();
      setItems([]);
      onUnreadChange?.(0);
      toast.success('আপনার নোটিফিকেশন স্থায়ীভাবে মুছে ফেলা হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'সব নোটিফিকেশন সরানো যায়নি।'));
    } finally { setBusyId(''); }
  };

  const remove = async (item) => {
    if (!window.confirm('এই নোটিফিকেশনটি আপনার ইনবক্স থেকে সার্ভারসহ স্থায়ীভাবে মুছে ফেলবেন? এই কাজ ফিরিয়ে নেওয়া যাবে না।')) return;
    setBusyId(item.notification_id);
    try {
      if (isManager) await managerDeleteNotification(item.notification_id);
      else await deleteMyNotification(item.notification_id);
      setItems((current) => current.filter((row) => row.notification_id !== item.notification_id));
      onUnreadChange?.(items.filter((row) => row.notification_id !== item.notification_id && !row.is_seen).length);
      toast.success('নোটিফিকেশন স্থায়ীভাবে মুছে ফেলা হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন মুছে দেওয়া যায়নি।'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <>
      <button
        className="notification-outside-backdrop"
        type="button"
        aria-label="নোটিফিকেশন বন্ধ করুন"
        onClick={onClose}
      />
      <div className="notification-panel-card card" role="dialog" aria-label="নোটিফিকেশন" aria-modal="false">
      <div className="notification-panel-head">
        <div>
          <span className="eyebrow">আপনার আপডেট</span>
          <h2>নোটিফিকেশন</h2>
        </div>
        <div className="notification-panel-actions">
          {unreadCount > 0 && <button className="text-button" type="button" disabled={busyId === 'all'} onClick={markAllSeen}>সব দেখা</button>}
          {items.length > 0 && <button className="text-button" type="button" disabled={Boolean(busyId)} onClick={removeAllMine}>সব ডিলিট</button>}
          <button className="icon-button ghost" type="button" onClick={load} aria-label="রিফ্রেশ"><Icon name="refresh" size={17} /></button>
        </div>
      </div>

      {loading ? <div className="notification-loading"><LoadingSpinner label="নোটিফিকেশন লোড হচ্ছে..." /></div> : items.length === 0 ? (
        <div className="empty-state-card compact-empty"><Icon name="bell" size={24} /><strong>কোনো নোটিফিকেশন নেই</strong><span>নতুন আপডেট এলে এখানে দেখা যাবে।</span></div>
      ) : (
        <div className="notification-list">
          {items.map((item) => (
            <article className={`notification-item ${item.is_seen ? 'seen' : 'unseen'}`} key={item.notification_id}>
              <button className="notification-main" type="button" onClick={() => seen(item)} disabled={Boolean(busyId)}>
                <span className="notification-icon"><Icon name={item.notification_type === 'market_entry' ? 'dining' : item.notification_type === 'manager_message' ? 'bell' : 'info'} size={17} /></span>
                <span className="notification-copy">
                  <strong>{item.title}</strong>
                  <small>{typeLabel(item.notification_type)} · {formatDateTime12(item.created_at)}</small>
                  <span>{item.body}</span>
                </span>
              </button>
              <button className="icon-button compact-icon ghost notification-delete" type="button" disabled={Boolean(busyId)} onClick={() => remove(item)} aria-label="নোটিফিকেশন মুছুন"><Icon name="trash" size={16} /></button>
            </article>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
