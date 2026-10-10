import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../components/Toast';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useAuth } from '../../contexts/AuthContext';
import { fetchDashboardData, fetchMealDetails, fetchMemberPeriodDetails } from '../../services/dashboardService';
import { fetchMemberDirectory, fetchRunningPeriod } from '../../services/diningService';
import { useDashboardOffline } from '../../hooks/useDashboardOffline';
import { formatDateTime12, formatTime12 } from '../../utils/time';
import { formatDateWithWeekday } from '../../utils/date';
import { useManagementContext } from '../../hooks/useManagementContext';
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
  const noPeriod = activity === 'এখনো মাস শুরু হয়নি';
  const hasMeals = activity === 'এই মাসে মিল আছে';
  return (
    <span className={`activity-badge ${noPeriod ? 'no-period-activity' : hasMeals ? 'has-meals' : 'no-meals'}`}>
      <span className="activity-dot" />
      {noPeriod ? 'এখনো মাস শুরু হয়নি' : hasMeals ? 'এই মাসে মিল আছে' : 'এই মাসে মিল নেই'}
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

function MealCard({ meal, isOnline, hasOfflineDetails = false, lastSync, onDetails, loading, cachedError, noRunningPeriod = false }) {
  if (noRunningPeriod) {
    return <section className="card meal-card hero-card no-running-meal-card">
      <div className="card-topline"><span className="eyebrow">মাসের অবস্থা</span><span className="status-chip offline-chip"><span className="pulse-dot"/> মাস শুরু হয়নি</span></div>
      <div className="meal-card-heading"><div><h1>বর্তমানে কোনো রানিং মাস নেই</h1><p>প্রধান ম্যানেজার নতুন মাস শুরু করলে আজকের মিলের তথ্য এখানে স্বয়ংক্রিয়ভাবে দেখা যাবে।</p></div><div className="hero-icon"><Icon name="calendar" size={26}/></div></div>
      <div className="meal-grid"><MealStat label="ব্রেকফাস্ট" value={0} accent="breakfast"/><MealStat label="লাঞ্চ" value={0} accent="lunch"/><MealStat label="ডিনার" value={0} accent="dinner"/></div>
      <div className="meal-total-row"><span>মোট মিল</span><strong>{formatMeal(0)}</strong></div>
    </section>;
  }
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
            <p>{isOnline ? 'উপরের মিলের তথ্য এখনো পাওয়া যায়নি।' : 'এই সময়ের জন্য এই ডিভাইসে সংরক্ষিত মিল নেই।'}</p>
          </div>
          <div className="hero-icon"><Icon name="dining" size={26} /></div>
        </div>
        <div className="meal-empty-note">
          <Icon name={isOnline ? 'warning' : 'offline'} size={18} />
          <span>{cachedError || (isOnline ? 'আবার চেষ্টা করুন।' : 'নেট চালু করলে সর্বশেষ মিলের তথ্য আবার সিঙ্ক হবে।')}</span>
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
      tabIndex={isOnline || hasOfflineDetails ? 0 : undefined}
      onClick={(isOnline || hasOfflineDetails) ? onDetails : undefined}
      onKeyDown={(event) => {
        if (!isOnline && !hasOfflineDetails) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onDetails();
        }
      }}
      aria-label={(isOnline || hasOfflineDetails) ? `${meal.label} বিস্তারিত দেখুন` : undefined}
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
          <p>{isOffline ? 'ইন্টারনেট না থাকলেও সর্বশেষ সংরক্ষিত মিলের তথ্য দেখা যাচ্ছে।' : 'রান্নার জন্য বর্তমান মিল এক নজরে দেখুন।'}</p>
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
          <span>{hasOfflineDetails ? 'অফলাইন কপি • সদস্যভিত্তিক বিস্তারিতও সংরক্ষিত আছে' : 'অফলাইন কপি • বিস্তারিত দেখতে ইন্টারনেট চালু করুন'}</span>
        </div>
      )}

      {(isOnline || hasOfflineDetails) && (
        <div className="meal-detail-hint">
          <span>{isOffline ? 'অফলাইনে বিস্তারিত দেখুন' : 'বিস্তারিত দেখুন'}</span>
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

function BalanceLabel({ value }) {
  const amount = safeNumber(value);
  const negative = amount < 0;
  const zero = amount === 0;
  return (
    <div className={`account-balance-row ${negative ? 'balance-negative' : 'balance-positive'}`}>
      <span>{negative ? 'বর্তমান বকেয়া' : 'বর্তমান অবশিষ্ট'}</span>
      <strong>{formatCurrency(Math.abs(amount))}</strong>
    </div>
  );
}

function MyAccountCard({ account, onClick }) {
  return (
    <section className="card my-account-card dashboard-clickable-card" role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}>
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
      <BalanceLabel value={account?.balance} />
    </section>
  );
}

function MemberCard({ member, onClick }) {
  return (
    <article className={`card member-card detailed-member-card dashboard-clickable-card ${member?.status === 'inactive' ? 'member-inactive-card' : ''}`} role="button" tabIndex={0} onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick?.(); } }}>
      <div className="member-card-top">
        <div className="avatar">{initials(member?.name)}</div>
        <div className="member-copy">
          <h3>{member?.name || 'সদস্য'}</h3>
          <div className="member-badge-row">
            <span className={statusClass(member?.status)}>{member?.status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</span>
            {Boolean(member?.is_primary_manager ?? (member?.role === 'manager')) && <span className="role-mini-badge"><Icon name="shield" size={11} /> ম্যানেজার</span>}
            {member?.is_assistant_manager && <span className="role-mini-badge assistant"><Icon name="users" size={11} /> সহকারী ম্যানেজার</span>}
          </div>
        </div>
      </div>
      <ActivityBadge activity={member?.meal_activity} />
      <div className="member-stats-grid">
        <div><span>জমা</span><strong>{formatCurrency(member?.deposit)}</strong></div>
        <div><span>মোট মিল</span><strong>{formatMeal(member?.meals)}</strong></div>
        <div><span>মিল খরচ</span><strong>{formatCurrency(member?.meal_cost)}</strong></div>
        <div><span>অন্যান্য খরচ</span><strong>{formatCurrency(member?.other_expense)}</strong></div>
      </div>
      <div className={`member-balance-row ${safeNumber(member?.balance) < 0 ? 'balance-negative' : 'balance-positive'}`}>
        <span>{safeNumber(member?.balance) < 0 ? 'বর্তমান বকেয়া' : 'বর্তমান অবশিষ্ট'}</span>
        <strong>{formatCurrency(Math.abs(safeNumber(member?.balance)))}</strong>
      </div>
    </article>
  );
}

function MemberPeriodDetailsModal({ detail, loading, memberName, onClose }) {
  const summary = detail?.summary || {};
  const meals = Array.isArray(detail?.daily_meals) ? detail.daily_meals : [];
  const transactions = Array.isArray(detail?.transactions) ? detail.transactions : [];
  const markets = Array.isArray(detail?.market_entries) ? detail.market_entries : [];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-panel card large-modal member-period-detail-modal" role="dialog" aria-modal="true" aria-label={`${memberName || 'সদস্য'}-এর বিস্তারিত হিসাব`}>
      <div className="modal-head"><div><span className="eyebrow">সদস্যভিত্তিক বিস্তারিত</span><h2>{detail?.member?.name || memberName || 'সদস্যের হিসাব'}</h2><small>{detail?.period?.label || 'বর্তমানে কোনো রানিং মাস নেই'}</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={19}/></button></div>
      {loading ? <div className="loading-wrap"><span className="spinner"/><span>সদস্যের হিসাব লোড হচ্ছে...</span></div> : <>
        <div className="member-period-summary-grid"><MetricCard label="মোট ফাইনাল মিল" value={formatMeal(summary.final_meals)}/><MetricCard label="মোট জমা" value={formatCurrency(summary.total_deposit)}/><MetricCard label="মিল খরচ" value={formatCurrency(summary.meal_cost)}/><MetricCard label="বাজারের মোট" value={formatCurrency(summary.total_market)}/><MetricCard label="অন্যান্য খরচ" value={formatCurrency(summary.other_expense)}/><MetricCard label="মিল রেট" value={formatCurrency(summary.meal_rate)}/></div>
        <div className={`member-period-balance ${safeNumber(summary.balance)<0?'balance-negative':'balance-positive'}`}><span>{safeNumber(summary.balance)<0?'বর্তমান বকেয়া':'বর্তমান অবশিষ্ট'}</span><strong>{formatCurrency(Math.abs(safeNumber(summary.balance)))}</strong></div>
        <section className="archive-detail-section"><div className="section-heading"><h3>প্রতিদিনের ফাইনাল মিল</h3><span>{formatNumber(meals.length)} দিন</span></div>{meals.length ? meals.map((row)=><div className="archive-list-row" key={row.date}><div><strong>{formatDateWithWeekday(row.date)}</strong><small>ব্রেকফাস্ট {formatMeal(row.breakfast)} · লাঞ্চ {formatMeal(row.lunch)} · ডিনার {formatMeal(row.dinner)}</small></div><strong>মোট {formatMeal(row.total)}</strong></div>) : <div className="empty-state-card"><span>এই period-এ কোনো final meal record নেই।</span></div>}</section>
        <section className="archive-detail-section"><div className="section-heading"><h3>লেনদেনের ইতিহাস</h3><span>{formatNumber(transactions.length)}টি</span></div>{transactions.length ? transactions.map((row)=><div className="archive-list-row" key={row.transaction_id}><div><strong>{row.transaction_type}</strong><small>{formatDateWithWeekday(row.entry_date)} · {row.description || 'বিবরণ নেই'}</small></div><strong className={Number(row.amount)>=0?'positive':'negative'}>{formatCurrency(row.amount)}</strong></div>) : <div className="empty-state-card"><span>কোনো লেনদেন নেই।</span></div>}</section>
        <section className="archive-detail-section"><div className="section-heading"><h3>সদস্যের নামে বাজার</h3><span>{formatNumber(markets.length)}টি</span></div>{markets.length ? markets.map((row)=><div className="archive-list-row" key={row.market_entry_id}><div><strong>{formatDateWithWeekday(row.entry_date)}</strong><small>{(row.items||[]).map((item)=>item.name).join(', ') || 'বাজারের আইটেম'}</small></div><strong>{formatCurrency(row.total_amount)}</strong></div>) : <div className="empty-state-card"><span>এই period-এ এই সদস্যের নামে বাজার নেই।</span></div>}</section>
      </>}
    </section>
  </div>;
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
                  <strong>এই দিনের জন্য কোনো সদস্যভিত্তিক মিলের তথ্য নেই।</strong>
                </div>
              ) : rows.map((row) => (
                <article className="meal-member-row" key={row.membership_id}>
                  <div className="avatar">{initials(row.member_name)}</div>
                  <div className="meal-member-name">
                    <strong>{row.member_name}</strong>
                    <small>{row.membership_status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</small>
                  </div>
                  <div className="meal-member-values meal-member-values-readable">
                    <span><small>ব্রেকফাস্ট</small><strong>{formatMeal(row.breakfast)}</strong></span>
                    <span><small>লাঞ্চ</small><strong>{formatMeal(row.lunch)}</strong></span>
                    <span><small>ডিনার</small><strong>{formatMeal(row.dinner)}</strong></span>
                    <span className="meal-member-total"><small>মোট</small><strong>{formatMeal(row.total_meals)}</strong></span>
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


function lateRequestVisibleUntil(visibleUntil = null) {
  if (!visibleUntil) return true;
  const time = new Date(visibleUntil).getTime();
  return Number.isFinite(time) && Date.now() < time;
}

function dhakaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function signedMealDelta(value) {
  const amount = safeNumber(value);
  const magnitude = formatMeal(Math.abs(amount));
  if (amount > 0) return `+${magnitude}`;
  if (amount < 0) return `−${magnitude}`;
  return formatMeal(0);
}

function deltaTone(value) {
  return safeNumber(value) > 0 ? 'positive' : safeNumber(value) < 0 ? 'negative' : 'neutral';
}

function LateDeltaStat({ label, value }) {
  return <div className={`late-delta-stat ${deltaTone(value)}`}>
    <span>{label}</span>
    <strong>{signedMealDelta(value)}</strong>
  </div>;
}

function LateRequestCard({ meal, isOnline, lastSync }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rows = (Array.isArray(meal?.late_requests) ? meal.late_requests : [])
    .filter((row) => lateRequestVisibleUntil(row.visible_until));

  const currentMembers = Array.isArray(meal?.member_details) ? meal.member_details : [];
  const memberMap = new Map(currentMembers.map((row) => [
    row.membership_id || row.member_id || row.memberId,
    row,
  ]));

  const preparedRows = rows.map((row) => {
    const previous = memberMap.get(row.membership_id || row.member_id) || null;
    const before = {
      breakfast: safeNumber(previous?.breakfast ?? previous?.final_breakfast ?? previous?.planned_breakfast),
      lunch: safeNumber(previous?.lunch ?? previous?.final_lunch ?? previous?.planned_lunch),
      dinner: safeNumber(previous?.dinner ?? previous?.final_dinner ?? previous?.planned_dinner),
    };
    const requested = {
      breakfast: safeNumber(row.breakfast),
      lunch: safeNumber(row.lunch),
      dinner: safeNumber(row.dinner),
    };
    const delta = {
      breakfast: requested.breakfast - before.breakfast,
      lunch: requested.lunch - before.lunch,
      dinner: requested.dinner - before.dinner,
    };
    return {
      ...row,
      before,
      requested,
      delta,
      deltaTotal: delta.breakfast + delta.lunch + delta.dinner,
      hadPreviousMealRecord: Boolean(previous),
    };
  });

  if (!preparedRows.length) return null;

  const totals = preparedRows.reduce((sum, row) => ({
    breakfast: sum.breakfast + row.delta.breakfast,
    lunch: sum.lunch + row.delta.lunch,
    dinner: sum.dinner + row.delta.dinner,
  }), { breakfast: 0, lunch: 0, dinner: 0 });
  const targetDate = String(meal?.meal_date || preparedRows[0]?.target_meal_date || preparedRows[0]?.meal_date || '').slice(0, 10);
  const dayTitle = targetDate === dhakaToday() ? 'আজকের' : 'আগামীকালের';
  const syncTime = lastSync || meal?.server_snapshot_at || null;

  return <>
    <section
      className="card late-request-card late-request-summary-card"
      role="button"
      tabIndex={0}
      onClick={() => setDetailsOpen(true)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailsOpen(true); } }}
      aria-label={`${dayTitle} অনুমোদিত লেট রিকোয়েস্টের বিস্তারিত দেখুন`}
    >
      <div className="late-request-head">
        <div className="late-request-title">
          <span className="late-request-icon"><Icon name="clock" size={18} /></span>
          <div><span className="eyebrow">মিল সংশোধন</span><h2>{dayTitle} অনুমোদিত লেট রিকোয়েস্ট</h2></div>
        </div>
        <span className="count-badge">{formatNumber(preparedRows.length)} জন</span>
      </div>
      <p className="late-request-summary">{formatNumber(preparedRows.length)} জনের অনুমোদিত লেট মিলের পরিবর্তন মূল মিলের সঙ্গে সমন্বয় করতে হবে। নিচের মানগুলো নতুন মোট নয়—আগের মিলের তুলনায় কম-বেশি।</p>
      <div className="late-request-delta-grid">
        <LateDeltaStat label="ব্রেকফাস্ট" value={totals.breakfast} />
        <LateDeltaStat label="লাঞ্চ" value={totals.lunch} />
        <LateDeltaStat label="ডিনার" value={totals.dinner} />
      </div>
      <div className="meal-total-row late-request-net-total">
        <span>মোট নেট সমন্বয়</span>
        <strong className={deltaTone(totals.breakfast + totals.lunch + totals.dinner)}>{signedMealDelta(totals.breakfast + totals.lunch + totals.dinner)}</strong>
      </div>
      <div className="sync-placeholder late-request-sync">
        <span className="sync-label"><span className={`network-dot ${isOnline ? 'online-dot' : 'offline-dot'}`} />শেষ সিঙ্ক</span>
        <span>{syncTime ? formatDateTime12(syncTime) : 'সময় সংরক্ষিত নেই'}</span>
      </div>
      <div className="meal-detail-hint"><span>{isOnline ? 'ব্যক্তিভিত্তিক বিস্তারিত দেখুন' : 'সংরক্ষিত বিস্তারিত দেখুন'}</span><Icon name="chevron" size={17} /></div>
    </section>
    <p className="late-request-counting-warning"><Icon name="warning" size={15} /> মিল গণনার সময় আজকের মিল কার্ডের তথ্যের সঙ্গে এই লেট রিকোয়েস্টের +/− সমন্বয় করে ফলাফল খালাকে জানাবেন।</p>
    {detailsOpen && <LateRequestDetailsModal
      date={targetDate}
      rows={preparedRows}
      totals={totals}
      onClose={() => setDetailsOpen(false)}
    />}
  </>;
}

function LateRequestDetailsModal({ date, rows, totals, onClose }) {
  useEffect(() => {
    const handler = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const mealItems = [
    ['breakfast', 'ব্রেকফাস্ট'],
    ['lunch', 'লাঞ্চ'],
    ['dinner', 'ডিনার'],
  ];

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card meal-details-modal late-request-details-modal" role="dialog" aria-modal="true" aria-labelledby="late-request-detail-title">
      <div className="modal-header">
        <div><span className="eyebrow">অনুমোদিত মিল সংশোধন</span><h2 id="late-request-detail-title">{date ? formatDateWithWeekday(date) : 'লেট রিকোয়েস্টের বিস্তারিত'}</h2><p>প্রতিটি মান = নতুন অনুরোধ − আগের মিল। সবুজ মান বাড়তি, লাল মান কমাতে হবে।</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={20} /></button>
      </div>
      <div className="late-request-detail-totals">
        {mealItems.map(([key, label]) => <LateDeltaStat key={key} label={label} value={totals[key]} />)}
      </div>
      <div className="late-request-detail-list">
        {rows.map((row, index) => <article className="late-request-detail-member" key={`${row.override_id || row.request_id || row.membership_id}-${index}`}>
          <div className="late-request-detail-member-head">
            <div><strong>{row.name || row.member_name || 'সদস্য'}</strong><small>{row.source === 'member_correction' ? 'সংশোধিত মিল' : 'লেট মিল রিকোয়েস্ট'}</small></div>
            <span className={`late-delta-pill ${deltaTone(row.deltaTotal)}`}>{signedMealDelta(row.deltaTotal)} মোট</span>
          </div>
          <div className="late-request-member-meals">
            {mealItems.map(([key, label]) => <div className="late-request-member-meal" key={key}>
              <span>{label}</span>
              <small>{formatMeal(row.before[key])} → {formatMeal(row.requested[key])}</small>
              <strong className={deltaTone(row.delta[key])}>{signedMealDelta(row.delta[key])}</strong>
            </div>)}
          </div>
          {!row.hadPreviousMealRecord && <p className="late-request-member-note">আগের মিল কার্ডে এই সদস্যের রেকর্ড ছিল না; তাই অনুরোধকৃত মিলকে পুরোটা বাড়তি হিসেবে ধরা হয়েছে।</p>}
          {row.reason && <p className="late-request-member-reason"><strong>কারণ:</strong> {row.reason}</p>}
          {row.approved_at && <small className="late-request-approved-at">অনুমোদন: {formatDateTime12(row.approved_at)}</small>}
        </article>)}
      </div>
      <div className="late-request-modal-warning"><Icon name="warning" size={17}/><span>এই +/− মানগুলো মূল মিলের সঙ্গে সমন্বয় করুন। একই মিল আবার পুরোপুরি যোগ করলে বা বাদ দিলে হিসাব ভুল হতে পারে।</span></div>
    </section>
  </div>;
}

function mapDirectoryMember(row, hasRunningPeriod = true) {
  return {
    membership_id: row.membership_id,
    name: row.member_name || 'সদস্য',
    status: row.member_status || 'active',
    role: row.role || 'member',
    is_assistant_manager: Boolean(row.is_assistant_manager),
    is_primary_manager: Boolean(row.is_primary_manager ?? (row.role === 'manager')),
    meal_activity: hasRunningPeriod ? (row.meal_activity || 'এই মাসে মিল নেই') : 'এখনো মাস শুরু হয়নি',
    meals: hasRunningPeriod ? safeNumber(row.final_meals) : 0,
    deposit: hasRunningPeriod ? safeNumber(row.deposit) : 0,
    meal_cost: hasRunningPeriod ? safeNumber(row.meal_cost) : 0,
    other_expense: hasRunningPeriod ? safeNumber(row.other_expense) : 0,
    balance: hasRunningPeriod ? safeNumber(row.balance) : 0,
  };
}

function NoActivePeriodCard() {
  return (
    <section className="card no-active-period-hero">
      <div className="no-active-period-icon"><Icon name="calendar" size={24} /></div>
      <div><span className="eyebrow">মাসের অবস্থা</span><h1>এখনো নতুন মাস শুরু হয়নি</h1><p>মেসের সদস্য ও পুরোনো হিসাব সংরক্ষিত আছে। প্রধান ম্যানেজার নতুন মাস শুরু করলে আজকের মিল ও বর্তমান মাসের সারসংক্ষেপ এখানে দেখা যাবে।</p></div>
    </section>
  );
}

export function DashboardPage() {
  const online = useOnlineStatus();
  const toast = useToast();
  const { membership, user } = useAuth();
  const hostelId = membership?.hostel_id;
  const userId = user?.id;
  const {
    snapshot,
    dashboard: cachedDashboard,
    offlineMealCard,
    loading: offlineLoading,
    error: offlineError,
    sync: syncOfflineSnapshot,
  } = useDashboardOffline({ userId, hostelId, isOnline: online });

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [detailsDate, setDetailsDate] = useState(null);
  const [detailsRows, setDetailsRows] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberDetail, setMemberDetail] = useState(null);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!online || !hostelId) return;
    if (!silent) setLoading(true);
    setDashboardError(null);
    try {
      // Load the member directory and period independently from the dashboard summary.
      // If get_dashboard_data fails while no period is running, members must still render.
      const [dashboardResult, periodResult, directoryResult] = await Promise.allSettled([
        fetchDashboardData(),
        fetchRunningPeriod(),
        fetchMemberDirectory(),
      ]);
      const data = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
      const resolvedPeriod = periodResult.status === 'fulfilled' ? periodResult.value : (data?.period || null);
      const hasRunningPeriod = periodResult.status === 'fulfilled'
        ? Boolean(resolvedPeriod?.period_id || resolvedPeriod?.id)
        : (typeof data?.has_running_period === 'boolean'
          ? data.has_running_period
          : Boolean(data?.period?.period_id || data?.period?.id));
      const directoryRows = directoryResult.status === 'fulfilled' && Array.isArray(directoryResult.value)
        ? directoryResult.value
        : [];
      const directoryMap = new Map(directoryRows.map((row) => [row.membership_id, row]));
      const fromDirectory = directoryRows.map((row) => mapDirectoryMember(row, hasRunningPeriod));
      const fromDashboard = (Array.isArray(data?.members) ? data.members : []).map((member) => {
        const id = member.membership_id || member.id;
        const directory = directoryMap.get(id);
        return {
          ...member,
          membership_id: id,
          name: member.name || directory?.member_name || 'সদস্য',
          status: member.status || directory?.member_status || 'active',
          role: member.role || directory?.role || 'member',
          is_assistant_manager: Boolean(member.is_assistant_manager ?? directory?.is_assistant_manager),
          is_primary_manager: Boolean(member.is_primary_manager ?? directory?.is_primary_manager ?? (directory?.role === 'manager')),
          meal_activity: hasRunningPeriod
            ? (member.meal_activity || directory?.meal_activity || 'এই মাসে মিল নেই')
            : 'এখনো মাস শুরু হয়নি',
          meals: hasRunningPeriod ? safeNumber(member.meals ?? directory?.final_meals) : 0,
          deposit: hasRunningPeriod ? safeNumber(member.deposit ?? directory?.deposit) : 0,
          meal_cost: hasRunningPeriod ? safeNumber(member.meal_cost ?? directory?.meal_cost) : 0,
          other_expense: hasRunningPeriod ? safeNumber(member.other_expense ?? directory?.other_expense) : 0,
          balance: hasRunningPeriod ? safeNumber(member.balance ?? directory?.balance) : 0,
        };
      });
      let nextMembers;
      if (!hasRunningPeriod) {
        nextMembers = fromDirectory.length ? fromDirectory : fromDashboard;
      } else if (fromDashboard.length) {
        nextMembers = fromDashboard;
      } else {
        nextMembers = fromDirectory;
      }

      if (!data && !directoryRows.length) {
        throw dashboardResult.status === 'rejected'
          ? dashboardResult.reason
          : (directoryResult.status === 'rejected' ? directoryResult.reason : new Error('ড্যাশবোর্ডের তথ্য পাওয়া যায়নি।'));
      }

      const ownDirectoryRow = directoryRows.find((row) => row.membership_id === membership?.membership_id);
      const mappedOwn = ownDirectoryRow
        ? mapDirectoryMember(ownDirectoryRow, hasRunningPeriod)
        : nextMembers.find((member) => member.membership_id === membership?.membership_id) || null;
      const normalized = {
        ...(data || {}),
        period: hasRunningPeriod ? (resolvedPeriod || data?.period || null) : null,
        has_running_period: hasRunningPeriod,
        members: nextMembers,
        meal_card: hasRunningPeriod ? data?.meal_card || null : null,
        summary: hasRunningPeriod ? data?.summary || null : null,
        my_account: hasRunningPeriod
          ? (data?.my_account || (mappedOwn ? {
              name: mappedOwn.name || mappedOwn.member_name,
              meals: mappedOwn.meals ?? mappedOwn.final_meals ?? 0,
              deposit: mappedOwn.deposit ?? 0,
              meal_cost: mappedOwn.meal_cost ?? 0,
              other_expense: mappedOwn.other_expense ?? 0,
              balance: mappedOwn.balance ?? 0,
            } : null))
          : (mappedOwn ? { name: mappedOwn.name || mappedOwn.member_name, meals: 0, deposit: 0, meal_cost: 0, other_expense: 0, balance: 0 } : data?.my_account),
      };
      setDashboard(normalized);
      if (dashboardResult.status === 'rejected') {
        setDashboardError('ড্যাশবোর্ডের সারসংক্ষেপ সাময়িকভাবে লোড হয়নি; সদস্য তালিকা ও মাসের অবস্থা আলাদাভাবে লোড করা হয়েছে।');
      }
      await syncOfflineSnapshot(normalized);
    } catch (error) {
      console.error('Dashboard load failed:', error);
      setDashboardError(error?.message || 'ড্যাশবোর্ডের তথ্য লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  }, [hostelId, online, syncOfflineSnapshot, membership?.membership_id]);

  useEffect(() => {
    if (!hostelId) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    if (online) loadDashboard();
    else {
      setDashboard(cachedDashboard);
      setLoading(false);
    }
  }, [cachedDashboard, hostelId, online, loadDashboard]);

  useEffect(() => {
    if (!online) return undefined;
    const onOnline = () => loadDashboard(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadDashboard(true);
    };
    const timer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) loadDashboard(true);
    }, 600000);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    const onFocus = () => loadDashboard(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadDashboard, online]);

  useRealtimeRefresh({
    enabled: online,
    hostelId,
    tables: ['meal_late_overrides', 'daily_meal_snapshots', 'meal_requests', 'market_entries', 'ledger_transactions', 'khala_money_entries', 'monthly_periods', 'notifications'],
    onRefresh: () => loadDashboard(true),
  });

  useEffect(() => {
    if (!online) return undefined;
    let timer = null;
    const scheduleNextBoundary = () => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
      const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
      const targets = [21 * 60, 22 * 60];
      let deltaMinutes = Infinity;
      for (const target of targets) {
        let delta = target - nowMinutes;
        if (delta <= 0) delta += 24 * 60;
        deltaMinutes = Math.min(deltaMinutes, delta);
      }
      timer = window.setTimeout(() => {
        loadDashboard(true).finally(scheduleNextBoundary);
      }, Math.max(15000, Math.ceil(deltaMinutes * 60 * 1000)));
    };
    scheduleNextBoundary();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [loadDashboard, online]);

  const effectiveDashboard = online ? (dashboard || cachedDashboard) : cachedDashboard;
  const dashboardHasRunningPeriod = effectiveDashboard?.has_running_period ?? Boolean(effectiveDashboard?.period?.period_id || effectiveDashboard?.period?.id);
  const mealCard = dashboardHasRunningPeriod
    ? (online ? (dashboard?.meal_card || cachedDashboard?.meal_card) : (offlineMealCard || cachedDashboard?.meal_card))
    : null;
  const lastSync = snapshot?.savedAt || null;
  const summary = effectiveDashboard?.summary;
  const account = effectiveDashboard?.my_account;
  const members = effectiveDashboard?.members ?? [];

  const openDetails = useCallback(async () => {
    const selectedMeal = online ? mealCard : (offlineMealCard || cachedDashboard?.meal_card);
    const date = selectedMeal?.meal_date;
    if (!date) return;

    if (!online) {
      const cachedRows = Array.isArray(selectedMeal?.member_details) ? selectedMeal.member_details : [];
      if (!cachedRows.length) {
        toast.warning('এই সংরক্ষিত কপিতে সদস্যভিত্তিক বিস্তারিত নেই। ইন্টারনেট চালু করুন।');
        return;
      }
      setDetailsDate(date);
      setDetailsRows(cachedRows);
      setDetailsLoading(false);
      return;
    }

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
  }, [cachedDashboard?.meal_card, mealCard, offlineMealCard, online, toast]);

  const openMember = useCallback(async (memberId) => {
    if (!memberId) return;
    if (!online) { toast.warning('সদস্যের পূর্ণ হিসাব দেখতে ইন্টারনেট চালু করুন।'); return; }
    setSelectedMemberId(memberId); setMemberDetail(null); setMemberDetailLoading(true);
    try { setMemberDetail(await fetchMemberPeriodDetails(memberId, effectiveDashboard?.period?.period_id || effectiveDashboard?.period?.id || null)); }
    catch (error) { toast.error(error?.message || 'সদস্যের বিস্তারিত হিসাব লোড করা যায়নি।'); setSelectedMemberId(null); }
    finally { setMemberDetailLoading(false); }
  }, [effectiveDashboard?.period?.id, effectiveDashboard?.period?.period_id, online, toast]);

  const hasCachedDashboard = Boolean(cachedDashboard);

  return (
    <div className="page-stack dashboard-stack">
      {dashboardHasRunningPeriod ? <>
        <MealCard
          meal={mealCard}
          isOnline={online}
          hasOfflineDetails={Array.isArray(mealCard?.member_details) && mealCard.member_details.length > 0}
          lastSync={lastSync}
          onDetails={openDetails}
          loading={online ? loading && !effectiveDashboard : offlineLoading}
          cachedError={dashboardError || offlineError?.message}
        />
        <LateRequestCard meal={mealCard} isOnline={online} lastSync={lastSync} />
      </> : effectiveDashboard ? <MealCard meal={null} noRunningPeriod isOnline={online} /> : <MealCard
        meal={mealCard}
        isOnline={online}
        hasOfflineDetails={false}
        lastSync={lastSync}
        onDetails={openDetails}
        loading={online ? loading && !effectiveDashboard : offlineLoading}
        cachedError={dashboardError || offlineError?.message}
      />}

      {effectiveDashboard ? (
        <>
          {dashboardHasRunningPeriod ? <section className="card summary-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">চলমান মাস</span>
                <h2>মেসের সারসংক্ষেপ</h2>
              </div>
              <span className={`status-chip ${online ? 'live-chip' : 'offline-chip'}`}>
                <span className="pulse-dot" /> {online ? 'আপডেটেড' : 'সংরক্ষিত'}
              </span>
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
            {!online && (
              <div className="offline-snapshot-note">
                <Icon name="offline" size={15} /> সর্বশেষ সংরক্ষিত snapshot · {lastSync ? formatDateTime12(lastSync) : 'সময় পাওয়া যায়নি'}
              </div>
            )}
          </section> : <div className="no-period-summary-note"><Icon name="info" size={16} /> নতুন মাস শুরু না হওয়া পর্যন্ত এই মাসের deposit, meal ও expense summary দেখানো হবে না।</div>}

          <MyAccountCard account={account} onClick={() => openMember(membership?.membership_id)} />

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
                <strong>সদস্যের তালিকা দেখানো যাচ্ছে না</strong>
                <span>{dashboardHasRunningPeriod ? 'সদস্য তালিকা পুনরায় লোড করুন বা ইন্টারনেট সংযোগ পরীক্ষা করুন।' : 'মাস বন্ধ হলেও মেসের সদস্যরা থেকে যান। নতুন মাস শুরু না হওয়া পর্যন্ত বর্তমান হিসাব শূন্য দেখানো হচ্ছে।'}</span>
              </div>
            ) : (
              <div className="member-preview-grid member-detail-grid">
                {members.map((member) => <MemberCard member={member} key={member.membership_id} onClick={() => openMember(member.membership_id)} />)}
              </div>
            )}
          </section>
        </>
      ) : online && dashboardError ? (
        <section className="state-card state-card-error">
          <div className="state-icon"><Icon name="warning" size={28} /></div>
          <div>
            <h2>ড্যাশবোর্ড লোড করা যায়নি</h2>
            <p>{dashboardError}</p>
            {hasCachedDashboard ? (
              <p className="muted-note">পুরোনো সংরক্ষিত snapshot থাকলে উপরের তথ্য সেখান থেকে দেখানো হবে।</p>
            ) : (
              <button className="secondary-button compact" onClick={loadDashboard}>আবার চেষ্টা করুন</button>
            )}
          </div>
        </section>
      ) : !online ? (
        <section className="card dashboard-offline-lock">
          <div className="state-icon"><Icon name="offline" size={25} /></div>
          <div>
            <span className="eyebrow">অফলাইন মোড</span>
            <h2>আপনার সর্বশেষ সংরক্ষিত ড্যাশবোর্ড প্রস্তুত</h2>
            <p>এই ডিভাইসে আগে online-এ সংরক্ষিত তথ্য এখানে দেখা যাচ্ছে। নতুন তথ্য পেতে ইন্টারনেট চালু করুন।</p>
          </div>
        </section>
      ) : null}

      {selectedMemberId && <MemberPeriodDetailsModal detail={memberDetail} loading={memberDetailLoading} memberName={members.find((item) => item.membership_id === selectedMemberId)?.name || account?.name} onClose={() => { setSelectedMemberId(null); setMemberDetail(null); }} />}

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
