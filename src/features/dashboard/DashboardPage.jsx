import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { fetchDashboardData, fetchMealDetails } from '../../services/dashboardService';
import { useMealOffline } from '../../hooks/useMealOffline';
import { formatDateTime12, formatTime12 } from '../../utils/time';
import { formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatMeal } from '../../utils/meal';

function safeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function initials(name) {
  return name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';
}

function statusClass(status) {
  return status === 'active' ? 'member-badge active' : 'member-badge inactive';
}

function ActivityBadge({ activity }) {
  const hasMeals = activity === 'এই মাসে মিল আছে';
  return (
    <span className={`activity-badge ${hasMeals ? 'has-meals' : 'no-meals'}`}>
      <span className="activity-dot" />
      {hasMeals ? 'এই মাসে মিল আছে' : 'এই মাসে মিল নেই'}
    </span>
  );
}

function MealStat({ label, value, accent }) {
  return (
    <div className={`meal-stat meal-stat-${accent}`}>
      <span>{label}</span>
      <strong>{formatMeal(value)}</strong>
    </div>
  );
}

function MealCard({ meal, isOnline, lastSync, onDetails, loading, cachedError }) {
  if (loading && !meal) {
    return (
      <section className="card meal-card hero-card meal-card-loading" aria-busy="true">
        <div className="card-topline">
          <span className="eyebrow">ড্যাশবোর্ড</span>
          <span className="status-chip"><span className="pulse-dot" /> লোড হচ্ছে</span>
        </div>
        <div className="meal-loading-lines">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  if (!meal) {
    return (
      <section className="card meal-card hero-card meal-empty-card">
        <div className="card-topline">
          <span className="eyebrow">ড্যাশবোর্ড</span>
          <span className={`status-chip ${isOnline ? 'live-chip' : 'offline-chip'}`}>
            <span className="pulse-dot" />
            {isOnline ? 'অনলাইন' : 'অফলাইন'}
          </span>
        </div>
        <div className="meal-card-heading">
          <div>
            <h1>মিলের তথ্য পাওয়া যায়নি</h1>
            <p>{isOnline ? 'Meal Card-এর তথ্য এখনো পাওয়া যায়নি।' : 'এই ডিভাইসে এই সময়ের জন্য সংরক্ষিত meal data নেই।'}</p>
          </div>
          <div className="hero-icon"><Icon name="dining" size={26} /></div>
        </div>
        <div className="meal-empty-note">
          <Icon name={isOnline ? 'warning' : 'offline'} size={18} />
          <span>{cachedError || (isOnline ? 'আবার চেষ্টা করুন।' : 'নেট চালু করলে সর্বশেষ meal data sync হবে।')}</span>
        </div>
        {lastSync && (
          <div className="sync-placeholder">
            <span className="sync-label"><span className="network-dot offline-dot" /> শেষ সিঙ্ক</span>
            <span>{formatDateTime12(lastSync)}</span>
          </div>
        )}
      </section>
    );
  }

  const isOffline = !isOnline;
  return (
    <section
      className={`card meal-card hero-card ${isOffline ? 'meal-card-offline' : ''}`}
      role="button"
      tabIndex={isOnline ? 0 : undefined}
      onClick={isOnline ? onDetails : undefined}
      onKeyDown={(event) => {
        if (!isOnline) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onDetails();
        }
      }}
      aria-label={isOnline ? `${meal.label} বিস্তারিত দেখুন` : undefined}
    >
      <div className="card-topline">
        <div>
          <span className="eyebrow">ড্যাশবোর্ড</span>
          <span className="meal-date-line">{formatDateWithWeekday(meal.meal_date)}</span>
        </div>
        <span className={`status-chip ${isOffline ? 'offline-chip' : 'live-chip'}`}>
          <span className="pulse-dot" />
          {isOffline ? 'সংরক্ষিত' : 'লাইভ'}
        </span>
      </div>

      <div className="meal-card-heading">
        <div>
          <h1>{meal.label}</h1>
          <p>{isOffline ? 'ইন্টারনেট ছাড়াই সর্বশেষ সংরক্ষিত meal data দেখা যাচ্ছে।' : 'রান্নার জন্য বর্তমান meal count এক নজরে দেখুন।'}</p>
        </div>
        <div className="hero-icon"><Icon name="dining" size={26} /></div>
      </div>

      <div className="meal-grid">
        <MealStat label="ব্রেকফাস্ট" value={meal.breakfast} accent="breakfast" />
        <MealStat label="লাঞ্চ" value={meal.lunch} accent="lunch" />
        <MealStat label="ডিনার" value={meal.dinner} accent="dinner" />
      </div>

      <div className="meal-total-row">
        <span>মোট মিল</span>
        <strong>{formatMeal(meal.total)}</strong>
      </div>

      <div className="sync-placeholder">
        <span className="sync-label">
          <span className={`network-dot ${isOffline ? 'offline-dot' : 'online-dot'}`} />
          শেষ সিঙ্ক
        </span>
        <span>{lastSync ? formatDateTime12(lastSync) : 'এখনও হয়নি'}</span>
      </div>

      {isOffline && (
        <div className="offline-meal-note">
          <Icon name="offline" size={15} />
          <span>অফলাইন কপি • বিস্তারিত দেখতে ইন্টারনেট চালু করুন</span>
        </div>
      )}

      {isOnline && (
        <div className="meal-detail-hint">
          <span>বিস্তারিত দেখুন</span>
          <Icon name="chevron" size={17} />
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function MyAccountCard({ account }) {
  return (
    <section className="card my-account-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">আমার হিসাব</span>
          <h2>{account?.name || 'আমার হিসাব'}</h2>
        </div>
        <div className="avatar avatar-large">{initials(account?.name)}</div>
      </div>
      <div className="account-grid">
        <div><span>জমা</span><strong>{formatCurrency(account?.deposit)}</strong></div>
        <div><span>মোট মিল</span><strong>{formatMeal(account?.meals)}</strong></div>
        <div><span>মিল খরচ</span><strong>{formatCurrency(account?.meal_cost)}</strong></div>
        <div><span>অন্যান্য খরচ</span><strong>{formatCurrency(account?.other_expense)}</strong></div>
      </div>
      <div className="account-balance-row">
        <span>বর্তমান অবশিষ্ট</span>
        <strong>{formatCurrency(account?.balance)}</strong>
      </div>
    </section>
  );
}

function MemberCard({ member }) {
  return (
    <article className={`card member-card detailed-member-card ${member?.status === 'inactive' ? 'member-inactive-card' : ''}`}>
      <div className="member-card-top">
        <div className="avatar">{initials(member?.name)}</div>
        <div className="member-copy">
          <h3>{member?.name || 'সদস্য'}</h3>
          <div className="member-badge-row">
            <span className={statusClass(member?.status)}>{member?.status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</span>
            {member?.role === 'manager' && <span className="role-mini-badge"><Icon name="shield" size={11} /> ম্যানেজার</span>}
          </div>
        </div>
      </div>
      <ActivityBadge activity={member?.meal_activity} />
      <div className="member-stats-grid">
        <div><span>জমা</span><strong>{formatCurrency(member?.deposit)}</strong></div>
        <div><span>মিল</span><strong>{formatMeal(member?.meals)}</strong></div>
        <div><span>মিল খরচ</span><strong>{formatCurrency(member?.meal_cost)}</strong></div>
        <div><span>অবশিষ্ট</span><strong>{formatCurrency(member?.balance)}</strong></div>
      </div>
    </article>
  );
}

function MealDetailsModal({ date, rows, loading, onClose }) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    breakfast: acc.breakfast + safeNumber(row.breakfast),
    lunch: acc.lunch + safeNumber(row.lunch),
    dinner: acc.dinner + safeNumber(row.dinner),
  }), { breakfast: 0, lunch: 0, dinner: 0 }), [rows]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card meal-details-modal" role="dialog" aria-modal="true" aria-labelledby="meal-detail-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">মিলের বিস্তারিত</span>
            <h2 id="meal-detail-title">{formatDateWithWeekday(date)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={20} /></button>
        </div>

        {loading ? (
          <div className="loading-wrap"><span className="spinner" /><span>মিলের সদস্যভিত্তিক তথ্য লোড হচ্ছে...</span></div>
        ) : (
          <>
            <div className="detail-total-strip">
              <div><span>ব্রেকফাস্ট</span><strong>{formatMeal(totals.breakfast)}</strong></div>
              <div><span>লাঞ্চ</span><strong>{formatMeal(totals.lunch)}</strong></div>
              <div><span>ডিনার</span><strong>{formatMeal(totals.dinner)}</strong></div>
              <div className="grand"><span>মোট</span><strong>{formatMeal(totals.breakfast + totals.lunch + totals.dinner)}</strong></div>
            </div>
            <div className="meal-detail-list">
              {rows.length === 0 ? (
                <div className="empty-state-card">
                  <Icon name="user" size={23} />
                  <strong>এই দিনের জন্য কোনো সদস্যভিত্তিক meal data নেই।</strong>
                </div>
              ) : rows.map((row) => (
                <article className="meal-member-row" key={row.membership_id}>
                  <div className="avatar">{initials(row.member_name)}</div>
                  <div className="meal-member-name">
                    <strong>{row.member_name}</strong>
                    <small>{row.membership_status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</small>
                  </div>
                  <div className="meal-member-values">
                    <span>B {formatMeal(row.breakfast)}</span>
                    <span>L {formatMeal(row.lunch)}</span>
                    <span>D {formatMeal(row.dinner)}</span>
                    <strong>{formatMeal(row.total_meals)}</strong>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function DashboardPage() {
  const online = useOnlineStatus();
  const toast = useToast();
  const { membership } = useAuth();
  const hostelId = membership?.hostel_id;
  const { offlineMealCard, offlineRecord, offlineLoading, offlineError, sync } = useMealOffline({ hostelId, isOnline: online });

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [detailsDate, setDetailsDate] = useState(null);
  const [detailsRows, setDetailsRows] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!online || !hostelId) return;
    setLoading(true);
    setDashboardError(null);
    try {
      const data = await fetchDashboardData();
      setDashboard(data);
      await sync();
    } catch (error) {
      console.error('Dashboard load failed:', error);
      setDashboardError(error?.message || 'ড্যাশবোর্ডের তথ্য লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  }, [hostelId, online, sync]);

  useEffect(() => {
    if (!hostelId) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    if (online) loadDashboard();
    else setLoading(false);
  }, [hostelId, online, loadDashboard]);

  useEffect(() => {
    if (!online) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadDashboard();
      }
    };
    window.addEventListener('focus', loadDashboard);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', loadDashboard);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadDashboard, online]);

  const openDetails = useCallback(async () => {
    if (!online) {
      toast.warning('মিলের বিস্তারিত দেখতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    const date = dashboard?.meal_card?.meal_date;
    if (!date) return;
    setDetailsDate(date);
    setDetailsRows([]);
    setDetailsLoading(true);
    try {
      const rows = await fetchMealDetails(date);
      setDetailsRows(rows);
    } catch (error) {
      toast.error(error?.message || 'মিলের বিস্তারিত লোড করা যায়নি।');
      setDetailsDate(null);
    } finally {
      setDetailsLoading(false);
    }
  }, [dashboard?.meal_card?.meal_date, online, toast]);

  const mealCard = online ? dashboard?.meal_card : offlineMealCard;
  const lastSync = offlineRecord?.clientSyncedAt || null;
  const summary = dashboard?.summary;
  const account = dashboard?.my_account;
  const members = dashboard?.members ?? [];

  return (
    <div className="page-stack dashboard-stack">
      <MealCard
        meal={mealCard}
        isOnline={online}
        lastSync={lastSync}
        onDetails={openDetails}
        loading={online ? loading : offlineLoading}
        cachedError={offlineError?.message}
      />

      {online ? (
        dashboardError ? (
          <section className="state-card state-card-error">
            <div className="state-icon"><Icon name="warning" size={28} /></div>
            <div>
              <h2>ড্যাশবোর্ড লোড করা যায়নি</h2>
              <p>{dashboardError}</p>
              <button className="secondary-button compact" onClick={loadDashboard}>আবার চেষ্টা করুন</button>
            </div>
          </section>
        ) : (
          <>
            <section className="card summary-card">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">চলমান মাস</span>
                  <h2>মেসের সারসংক্ষেপ</h2>
                </div>
                <span className="status-chip"><span className="pulse-dot" /> আপডেটেড</span>
              </div>
              <div className="metric-grid four-grid">
                <MetricCard label="মোট জমা" value={formatCurrency(summary?.total_deposit)} />
                <MetricCard label="মোট খরচ" value={formatCurrency(summary?.total_expense)} />
                <MetricCard label="মোট মিল" value={formatNumber(summary?.total_meals)} />
                <MetricCard label="অবশিষ্ট ফান্ড" value={formatCurrency(summary?.fund_remaining)} />
              </div>
              <div className="rate-strip">
                <div>
                  <span>বর্তমান মিল রেট</span>
                  <small>খাবারের বাজার ÷ ফাইনাল মিল</small>
                </div>
                <strong>{formatCurrency(summary?.meal_rate)}</strong>
              </div>
            </section>

            <MyAccountCard account={account} />

            <section className="section-block">
              <div className="section-heading outside">
                <div>
                  <span className="eyebrow">এই মেসের সদস্য</span>
                  <h2>সদস্য তালিকা</h2>
                </div>
                <span className="count-badge">{formatNumber(members.length)} জন</span>
              </div>
              {members.length === 0 ? (
                <div className="empty-state-card">
                  <Icon name="user" size={24} />
                  <strong>আপনি ছাড়া আর কোনো সদস্য নেই।</strong>
                </div>
              ) : (
                <div className="member-preview-grid member-detail-grid">
                  {members.map((member) => <MemberCard member={member} key={member.membership_id} />)}
                </div>
              )}
            </section>
          </>
        )
      ) : (
        <section className="card dashboard-offline-lock">
          <div className="state-icon"><Icon name="offline" size={25} /></div>
          <div>
            <span className="eyebrow">অফলাইন মোড</span>
            <h2>ড্যাশবোর্ডের বাকি তথ্য দেখতে ইন্টারনেট চালু করুন</h2>
            <p>শুধু উপরের meal card-টি এই ডিভাইসে offline-এ রাখা হয়েছে, যাতে রান্নার সময় মিল গোনা যায়।</p>
          </div>
        </section>
      )}

      {detailsDate && (
        <MealDetailsModal
          date={detailsDate}
          rows={detailsRows}
          loading={detailsLoading}
          onClose={() => setDetailsDate(null)}
        />
      )}
    </div>
  );
}
