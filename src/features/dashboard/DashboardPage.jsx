import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../components/Toast';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useAuth } from '../../contexts/AuthContext';
import { fetchDashboardData, fetchMealDetails, fetchUpcomingMealOverview } from '../../services/dashboardService';
import { invalidateRequestCache } from '../../lib/requestCache';
import { fetchMemberDirectory, fetchRunningPeriod } from '../../services/diningService';
import { useDashboardOffline } from '../../hooks/useDashboardOffline';
import { formatDateTime12, formatTime12 } from '../../utils/time';
import { formatDateWithWeekday } from '../../utils/date';
import { useManagementContext } from '../../hooks/useManagementContext';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatMeal } from '../../utils/meal';
import { getMealPartsTotal } from '../../utils/mealTotals';
import { navigateTo } from '../../app/AppShell';
import { dashboardNeedsPeriodFallback, resolveDashboardPeriodStatus } from '../../utils/period';
import { clearSevenDayMeals, getSevenDates, readSevenDayMeals, saveSevenDayMeals } from '../../services/sevenDayMealStore';
import { formatUpcomingMealDate } from '../../utils/sevenDayMeals';
import { getDhakaDateTimeParts } from '../../utils/monthLifecyclePolicy';

function safeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

// Some deployed get_meal_details versions return only breakfast/lunch/dinner
// and omit total_meals. Derive the visible total from those three values when
// the aggregate is missing or inconsistent; accounting data is not modified.
export function getDisplayedDailyMealTotal(meal) {
  if (!meal) return 0;
  const sum = getMealPartsTotal(meal);
  // get_meal_details currently returns the three meal fields but may omit
  // total_meals; older payloads may instead expose `total`. Accept either only
  // when it agrees with the visible components, otherwise derive the total.
  const returned = Number(meal.total ?? meal.total_meals);
  return Number.isFinite(returned) && returned >= 0 && Math.abs(returned - sum) < 0.00001 ? returned : sum;
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

function MealCard({ meal, isOnline, hasOfflineDetails = false, hasUpcomingMeals = false, lastSync, onDetails, loading, cachedError, noRunningPeriod = false, pendingPeriodStartDate = null }) {
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
    // The next period may be activated after 8 PM on the previous day. Until its
    // first meal date the server deliberately returns no meal_card; this is not
    // a missing account or a lost meal record.
    const isBeforeFirstDay = Boolean(pendingPeriodStartDate);
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
            <h1>{isBeforeFirstDay ? 'নতুন মাসের মিল আগামীকাল থেকে' : 'মিলের তথ্য পাওয়া যায়নি'}</h1>
            <p>{isBeforeFirstDay
              ? `নতুন মাস চালু হয়েছে। প্রথম মিলের তারিখ ${formatDateWithWeekday(pendingPeriodStartDate)}। ওই দিন শুরু হলে এই কার্ডে মিলের হিসাব দেখা যাবে।`
              : (isOnline ? 'এই দিনের মিলের সার্ভার তথ্য এখনো পাওয়া যায়নি।' : 'এই সময়ের জন্য এই ডিভাইসে সংরক্ষিত মিল নেই।')}</p>
          </div>
          <div className="hero-icon"><Icon name="dining" size={26} /></div>
        </div>
        <div className="meal-empty-note">
          <Icon name={isOnline ? 'warning' : 'offline'} size={18} />
          <span>{isBeforeFirstDay ? 'প্রথম দিনের মিল অনুরোধ ডাইনিং সেকশন থেকে দেওয়া যাবে।' : (cachedError || (isOnline ? 'মাস চালু থাকার পরও এমন দেখালে ডাটাবেসে ওই দিনের meal day রেকর্ড ও Supabase RPC যাচাই করুন।' : 'নেট চালু করলে সর্বশেষ মিলের তথ্য আবার সিঙ্ক হবে।'))}</span>
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
      tabIndex={isOnline || hasOfflineDetails || hasUpcomingMeals ? 0 : undefined}
      onClick={(isOnline || hasOfflineDetails || hasUpcomingMeals) ? onDetails : undefined}
      onKeyDown={(event) => {
        if (!isOnline && !hasOfflineDetails && !hasUpcomingMeals) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onDetails();
        }
      }}
      aria-label={(isOnline || hasOfflineDetails || hasUpcomingMeals) ? `${meal.label} বিস্তারিত দেখুন` : undefined}
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
        <strong>{formatMeal(getDisplayedDailyMealTotal(meal))}</strong>
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
          <span>{hasOfflineDetails ? 'অফলাইন কপি • সদস্যভিত্তিক বিস্তারিতও সংরক্ষিত আছে' : hasUpcomingMeals ? 'অফলাইন কপি • আগামী সাত দিনের মিলও সংরক্ষিত আছে' : 'অফলাইন কপি • বিস্তারিত দেখতে ইন্টারনেট চালু করুন'}</span>
        </div>
      )}

      {(isOnline || hasOfflineDetails || hasUpcomingMeals) && (
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
    <section className="card my-account-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">আমার হিসাব</span>
          <h2><button className="dashboard-member-name" type="button" onClick={onClick}>{account?.name || 'আমার হিসাব'}</button></h2>
        </div>
        <div className="avatar avatar-large">{account?.avatar_url ? <img className="member-avatar-photo" src={account.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : initials(account?.name)}</div>
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
    <article className={`card member-card detailed-member-card ${member?.status === 'inactive' ? 'member-inactive-card' : ''}`}>
      <div className="member-card-top">
        <div className="avatar">{initials(member?.name)}</div>
        <div className="member-copy">
          <h3><button className="dashboard-member-name" type="button" onClick={onClick}>{member?.name || 'সদস্য'}</button></h3>
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

export function MemberPeriodDetailsModal({ detail, loading, memberName, onClose }) {
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
        <section className="archive-detail-section"><div className="section-heading"><h3>প্রতিদিনের চূড়ান্ত মিল</h3><span>{formatNumber(meals.length)} দিন</span></div>{meals.length ? meals.map((row)=><div className="archive-list-row" key={row.date}><div><strong>{formatDateWithWeekday(row.date)}</strong><small>ব্রেকফাস্ট {formatMeal(row.breakfast)} · লাঞ্চ {formatMeal(row.lunch)} · ডিনার {formatMeal(row.dinner)}</small></div><strong>মোট {formatMeal(row.total)}</strong></div>) : <div className="empty-state-card"><span>এই সময়কালে কোনো চূড়ান্ত মিলের তথ্য নেই।</span></div>}</section>
        <section className="archive-detail-section"><div className="section-heading"><h3>লেনদেনের ইতিহাস</h3><span>{formatNumber(transactions.length)}টি</span></div>{transactions.length ? transactions.map((row)=><div className="archive-list-row" key={row.transaction_id}><div><strong>{row.transaction_type}</strong><small>{formatDateWithWeekday(row.entry_date)} · {row.description || 'বিবরণ নেই'}</small></div><strong className={Number(row.amount)>=0?'positive':'negative'}>{formatCurrency(row.amount)}</strong></div>) : <div className="empty-state-card"><span>কোনো লেনদেন নেই।</span></div>}</section>
        <section className="archive-detail-section"><div className="section-heading"><h3>সদস্যের নামে বাজার</h3><span>{formatNumber(markets.length)}টি</span></div>{markets.length ? markets.map((row)=><div className="archive-list-row" key={row.market_entry_id}><div><strong>{formatDateWithWeekday(row.entry_date)}</strong><small>{(row.items||[]).map((item)=>item.name).join(', ') || 'বাজারের আইটেম'}</small></div><strong>{formatCurrency(row.total_amount)}</strong></div>) : <div className="empty-state-card"><span>এই period-এ এই সদস্যের নামে বাজার নেই।</span></div>}</section>
      </>}
    </section>
  </div>;
}

function UpcomingMealOverview({ record, isOnline, syncing, error }) {
  const days = Array.isArray(record?.days) ? record.days : [];
  return (
    <section className="upcoming-meal-overview" aria-label="আগামী সাত দিনের মিলের সারসংক্ষেপ">
      <div className="upcoming-meal-sync-row">
        <span className={`status-chip ${isOnline ? 'live-chip' : 'offline-chip'}`}>
          <span className="pulse-dot" /> {isOnline ? (syncing ? 'সিঙ্ক হচ্ছে' : error ? 'সর্বশেষ সংরক্ষিত কপি' : 'সার্ভারের তথ্য') : 'অফলাইন কপি'}
        </span>
        <small>{record?.savedAt ? `শেষ সিঙ্ক ${formatDateTime12(record.savedAt)}` : 'এখনো কোনো অফলাইন কপি নেই'}</small>
      </div>
      {error && !days.length && <div className="empty-state-card"><Icon name="warning" size={20}/><span>{error}</span></div>}
      {error && days.length > 0 && <p className="upcoming-meal-footnote">সর্বশেষ সংরক্ষিত তথ্য দেখানো হচ্ছে; নতুন সিঙ্ক হয়নি।</p>}
      {!days.length && syncing && <div className="loading-wrap"><span className="spinner"/><span>আগামী সাত দিনের মিলের তথ্য সিঙ্ক হচ্ছে...</span></div>}
      {!days.length && !syncing && !error && <div className="empty-state-card"><Icon name="offline" size={22}/><strong>আগামী সাত দিনের কোনো সংরক্ষিত তথ্য নেই।</strong><span>ইন্টারনেট চালু রেখে ড্যাশবোর্ডে প্রবেশ করলে তথ্য সিঙ্ক হবে।</span></div>}
      {days.length > 0 && (
        <>
          <div className="upcoming-meal-days">
            {days.map((day) => (
              <article className={`upcoming-meal-day-card ${day.within_period === false ? 'outside-period' : ''}`} key={day.meal_date}>
                <div className="upcoming-meal-day-heading">
                  <strong>{formatUpcomingMealDate(day.meal_date)}</strong>
                  {day.within_period === false && <span className="upcoming-period-note">মাসের বাইরে</span>}
                </div>
                <div className="upcoming-meal-day-stats">
                  <div><span>ব্রেকফাস্ট</span><strong>{formatMeal(day.breakfast)}</strong></div>
                  <div><span>লাঞ্চ</span><strong>{formatMeal(day.lunch)}</strong></div>
                  <div><span>ডিনার</span><strong>{formatMeal(day.dinner)}</strong></div>
                </div>
                <div className="upcoming-meal-day-total"><span>মোট মিল</span><strong>{formatMeal(day.total)}</strong></div>
              </article>
            ))}
          </div>
          <p className="upcoming-meal-footnote">সার্ভারে কার্যকর/অনুমোদিত মিলের হিসাব দেখানো হচ্ছে। অপেক্ষমাণ অনুরোধ অনুমোদিত হলে পরবর্তী সিঙ্কে যুক্ত হবে।</p>
        </>
      )}
    </section>
  );
}

function MealDetailsModal({ date, rows, loading, onClose, upcomingRecord, upcomingLoading, upcomingError, isOnline }) {
  const [activeView, setActiveView] = useState('today');

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
      <section className={`modal-card meal-details-modal ${activeView === 'upcoming' ? 'is-upcoming' : ''}`} role="dialog" aria-modal="true" aria-labelledby="meal-detail-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">{activeView === 'today' ? 'মিলের বিস্তারিত' : 'সামনের দিনের পরিকল্পনা'}</span>
            <h2 id="meal-detail-title">{activeView === 'today' ? formatDateWithWeekday(date) : 'আগামী ৭ দিন'}</h2>
          </div>
          <div className="meal-detail-header-actions">
            <button className="secondary-button compact upcoming-meal-toggle" type="button" onClick={() => setActiveView((view) => view === 'today' ? 'upcoming' : 'today')}>
              {activeView === 'today' ? <><Icon name="calendar" size={15}/> আগামী ৭ দিন</> : <><Icon name="arrow-left" size={15}/> আজকের মিল</>}
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={20} /></button>
          </div>
        </div>

        {activeView === 'upcoming' ? (
          <UpcomingMealOverview record={upcomingRecord} isOnline={isOnline} syncing={upcomingLoading} error={upcomingError}/>
        ) : loading ? (
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
                  </div>
                  <div className="meal-member-values meal-member-values-readable">
                    <span><small>ব্রেকফাস্ট</small><strong>{formatMeal(row.breakfast)}</strong></span>
                    <span><small>লাঞ্চ</small><strong>{formatMeal(row.lunch)}</strong></span>
                    <span><small>ডিনার</small><strong>{formatMeal(row.dinner)}</strong></span>
                    <span className="meal-member-total"><small>মোট</small><strong>{formatMeal(getDisplayedDailyMealTotal(row))}</strong></span>
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
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
      <p className="late-request-compact-note"><Icon name="info" size={15} /> +/− হলো মূল মিলের সঙ্গে যোগ-বিয়োগ; নতুন মোট নয়।</p>
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
    <p className="late-request-counting-compact"><Icon name="warning" size={15} /> খালাকে হিসাব জানানোর আগে আজকের মিলের সঙ্গে এই সমন্বয় যোগ করুন।</p>
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

  return <div className="modal-backdrop late-request-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card meal-details-modal late-request-details-modal" role="dialog" aria-modal="true" aria-labelledby="late-request-detail-title">
      <div className="modal-header">
        <div><span className="eyebrow">অনুমোদিত মিল সংশোধন</span><h2 id="late-request-detail-title">{date ? formatDateWithWeekday(date) : 'লেট রিকোয়েস্টের বিস্তারিত'}</h2><p>প্রতিটি মান = নতুন অনুরোধ − আগের মিল। সবুজ মান যোগ হবে, লাল মান কমাতে হবে।</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={20} /></button>
      </div>
      <div className="late-request-detail-totals">
        {mealItems.map(([key, label]) => <LateDeltaStat key={key} label={label} value={totals[key]} />)}
      </div>
      <div className="late-request-detail-list" tabIndex={0} role="region" aria-label="লেট রিকোয়েস্টের সদস্য তালিকা">
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
    avatar_url: row.avatar_url || row.photo_url || row.profile_photo_url || null,
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
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [detailsDate, setDetailsDate] = useState(null);
  const [detailsRows, setDetailsRows] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [upcomingMealRecord, setUpcomingMealRecord] = useState(null);
  const [upcomingMealLoading, setUpcomingMealLoading] = useState(false);
  const [upcomingMealError, setUpcomingMealError] = useState(null);
  const upcomingScopeRef = useRef(`${userId || ''}:${hostelId || ''}`);
  const upcomingRequestVersionRef = useRef(0);

  useEffect(() => {
    upcomingScopeRef.current = `${userId || ''}:${hostelId || ''}`;
    upcomingRequestVersionRef.current += 1;
    setUpcomingMealRecord(readSevenDayMeals(userId, hostelId));
    setUpcomingMealError(null);
  }, [userId, hostelId]);

  const syncUpcomingMeals = useCallback(async (period) => {
    if (!userId || !hostelId || !online) return null;
    const scopeKey = `${userId}:${hostelId}`;
    if (upcomingScopeRef.current !== scopeKey) return null;
    const requestVersion = ++upcomingRequestVersionRef.current;
    const periodId = period?.period_id || period?.id;
    if (!periodId) {
      clearSevenDayMeals(userId, hostelId);
      setUpcomingMealRecord(null);
      setUpcomingMealError(null);
      setUpcomingMealLoading(false);
      return null;
    }

    setUpcomingMealLoading(true);
    try {
      const days = await fetchUpcomingMealOverview({
        periodId,
        dates: getSevenDates(),
        periodStartDate: period?.start_date || null,
        periodEndDate: period?.end_date || null,
      });
      if (upcomingScopeRef.current !== scopeKey || upcomingRequestVersionRef.current !== requestVersion) return null;
      const record = saveSevenDayMeals({ userId, hostelId, periodId, days })
        || { userId, hostelId, periodId, days, savedAt: new Date().toISOString() };
      setUpcomingMealRecord(record);
      setUpcomingMealError(null);
      return record;
    } catch (error) {
      if (upcomingScopeRef.current === scopeKey && upcomingRequestVersionRef.current === requestVersion) setUpcomingMealError(error?.message || 'আগামী সাত দিনের মিল সিঙ্ক করা যায়নি।');
      return null;
    } finally {
      if (upcomingScopeRef.current === scopeKey && upcomingRequestVersionRef.current === requestVersion) setUpcomingMealLoading(false);
    }
  }, [hostelId, online, userId]);

  const loadInFlightRef = useRef(null);
  const lastLoadStartedAtRef = useRef(0);
  const latestDashboardRef = useRef(null);
  const latestCachedDashboardRef = useRef(null);
  // The deployed RPC payload may not include member/period detail in older schema versions.
  // Do not call both fallback RPCs on every realtime event; refresh them at most every 5 minutes.
  const lastFallbackRefreshAtRef = useRef(0);

  useEffect(() => { latestDashboardRef.current = dashboard; }, [dashboard]);
  useEffect(() => { latestCachedDashboardRef.current = cachedDashboard; }, [cachedDashboard]);

  const loadDashboard = useCallback(async (silent = false, options = {}) => {
    if (!online || !hostelId || !navigator.onLine) return null;
    if (!options.force && (document.visibilityState !== 'visible' || !document.hasFocus())) return null;
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const now = Date.now();
    // Focus, visibility, and realtime callbacks often happen together. Coalesce
    // automatic refreshes; the explicit retry button remains available to users.
    if (silent && !options.force && now - lastLoadStartedAtRef.current < 15000) return null;
    lastLoadStartedAtRef.current = now;

    const task = (async () => {
      if (!silent) setLoading(true);
      setDashboardError(null);
      try {
        const previous = latestDashboardRef.current || latestCachedDashboardRef.current;
        const fullRead = !silent || !previous;
        let dashboardResult;
        let periodResult = { status: 'fulfilled', value: null };
        let directoryResult = { status: 'fulfilled', value: [] };
        let periodWasResolved = false;

        if (fullRead) {
          // The first page load (or a resume before any cache exists) performs the full fallback-safe read.
          [dashboardResult, periodResult, directoryResult] = await Promise.allSettled([
            fetchDashboardData(),
            fetchRunningPeriod({ force: Boolean(options.force || options.forcePeriodCheck) }),
            fetchMemberDirectory({ force: Boolean(options.force) }),
          ]);
          periodWasResolved = true;
        } else {
          // For realtime/foreground updates, fetch the dashboard RPC first. A bare
          // `has_running_period: false` from an older RPC is ambiguous, so verify it
          // against the canonical period endpoint rather than hiding the current month.
          [dashboardResult] = await Promise.allSettled([fetchDashboardData()]);
          const quickData = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
          const hasPeriodObject = Boolean(quickData?.period?.period_id || quickData?.period?.id);
          const hasPeriodShape = quickData?.has_running_period === true || hasPeriodObject;
          const hasMembersShape = Array.isArray(quickData?.members);
          const reportedNoPeriod = dashboardNeedsPeriodFallback(quickData);

          const fallbackNeeded = dashboardResult.status === 'rejected' || !hasPeriodShape || !hasMembersShape;
          const fallbackRefreshDue = !previous
            || Boolean(options.force)
            || Boolean(options.forcePeriodCheck)
            || now - lastFallbackRefreshAtRef.current >= 5 * 60 * 1000
            || (reportedNoPeriod && (previous?.has_running_period === true || !previous?.period_status));

          if (fallbackNeeded && fallbackRefreshDue) {
            lastFallbackRefreshAtRef.current = now;
            [periodResult, directoryResult] = await Promise.allSettled([
              fetchRunningPeriod({ force: Boolean(options.force || options.forcePeriodCheck) }),
              fetchMemberDirectory({ force: Boolean(options.force) }),
            ]);
            periodWasResolved = true;
          } else if (fallbackNeeded) {
            // Preserve the last known state instead of trusting a stale negative flag.
            periodResult = { status: 'fulfilled', value: previous?.period ?? null };
            directoryResult = { status: 'fulfilled', value: [] };
          } else {
            periodResult = {
              status: 'fulfilled',
              value: quickData?.period ?? previous?.period ?? null,
            };
          }
        }

        const data = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
        const resolvedPeriod = periodResult.status === 'fulfilled'
          ? periodResult.value
          : (data?.period || previous?.period || null);
        const periodStatus = resolveDashboardPeriodStatus({
          periodWasResolved,
          periodResultStatus: periodResult.status,
          resolvedPeriod,
          data,
          previous,
        });
        const hasRunningPeriod = periodStatus === 'running';
        const directoryRows = directoryResult.status === 'fulfilled' && Array.isArray(directoryResult.value)
          ? directoryResult.value
          : [];
        const directoryMap = new Map(directoryRows.map((row) => [row.membership_id, row]));
        const previousMemberMap = new Map((Array.isArray(previous?.members) ? previous.members : [])
          .map((member) => [member.membership_id || member.id, member]));
        const fromDirectory = directoryRows.map((row) => mapDirectoryMember(row, hasRunningPeriod));
        const fromDashboard = (Array.isArray(data?.members) ? data.members : []).map((member) => {
          const id = member.membership_id || member.id;
          const directory = directoryMap.get(id);
          const prior = previousMemberMap.get(id);
          return {
            ...member,
            membership_id: id,
            name: member.name || directory?.member_name || prior?.name || 'সদস্য',
            avatar_url: null,
            status: directory?.member_status || member.status || prior?.status || 'active',
            role: member.role || directory?.role || prior?.role || 'member',
            is_assistant_manager: Boolean(member.is_assistant_manager ?? directory?.is_assistant_manager ?? prior?.is_assistant_manager),
            is_primary_manager: Boolean(member.is_primary_manager ?? directory?.is_primary_manager ?? prior?.is_primary_manager ?? (directory?.role === 'manager')),
            meal_activity: hasRunningPeriod
              ? (member.meal_activity || directory?.meal_activity || prior?.meal_activity || 'এই মাসে মিল নেই')
              : 'এখনো মাস শুরু হয়নি',
            meals: hasRunningPeriod ? safeNumber(member.meals ?? directory?.final_meals ?? prior?.meals) : 0,
            deposit: hasRunningPeriod ? safeNumber(member.deposit ?? directory?.deposit ?? prior?.deposit) : 0,
            meal_cost: hasRunningPeriod ? safeNumber(member.meal_cost ?? directory?.meal_cost ?? prior?.meal_cost) : 0,
            other_expense: hasRunningPeriod ? safeNumber(member.other_expense ?? directory?.other_expense ?? prior?.other_expense) : 0,
            balance: hasRunningPeriod ? safeNumber(member.balance ?? directory?.balance ?? prior?.balance) : 0,
          };
        });

        let nextMembers;
        if (!hasRunningPeriod) {
          nextMembers = fromDirectory.length ? fromDirectory : (Array.isArray(data?.members) ? fromDashboard : (previous?.members || []));
        } else if (fromDashboard.length || Array.isArray(data?.members)) {
          nextMembers = fromDashboard;
        } else {
          nextMembers = fromDirectory.length ? fromDirectory : (previous?.members || []);
        }

        nextMembers = nextMembers.filter((member) => member.status !== 'inactive' && member.member_status !== 'inactive');

        if (!data && !directoryRows.length) {
          // Keep a previously rendered/cached dashboard during a transient silent
          // refresh failure; do not retry-log or blank the UI in a background loop.
          if (silent && previous) return previous;
          throw dashboardResult.status === 'rejected'
            ? dashboardResult.reason
            : (directoryResult.status === 'rejected' ? directoryResult.reason : new Error('ড্যাশবোর্ডের তথ্য পাওয়া যায়নি।'));
        }

        const ownDirectoryRow = directoryRows.find((row) => row.membership_id === membership?.membership_id);
        const mappedOwn = ownDirectoryRow
          ? mapDirectoryMember(ownDirectoryRow, hasRunningPeriod)
          : nextMembers.find((member) => member.membership_id === membership?.membership_id) || null;
        const normalized = {
          ...(data || previous || {}),
          period: hasRunningPeriod ? (resolvedPeriod || data?.period || previous?.period || null) : null,
          has_running_period: hasRunningPeriod,
          period_status: periodStatus,
          members: nextMembers,
          // Never carry the old period's card into a newly opened month.
          meal_card: hasRunningPeriod
            ? (data?.meal_card || ((previous?.period?.period_id || previous?.period?.id) === (resolvedPeriod?.period_id || resolvedPeriod?.id) ? previous?.meal_card : null) || null)
            : null,
          summary: hasRunningPeriod ? (data?.summary || previous?.summary || null) : null,
          my_account: hasRunningPeriod
            ? (data?.my_account ? { ...data.my_account, avatar_url: data.my_account.avatar_url || mappedOwn?.avatar_url || null } : previous?.my_account ? { ...previous.my_account, avatar_url: mappedOwn?.avatar_url || previous.my_account.avatar_url || null } : (mappedOwn ? {
                name: mappedOwn.name || mappedOwn.member_name,
                avatar_url: mappedOwn.avatar_url || null,
                meals: mappedOwn.meals ?? mappedOwn.final_meals ?? 0,
                deposit: mappedOwn.deposit ?? 0,
                meal_cost: mappedOwn.meal_cost ?? 0,
                other_expense: mappedOwn.other_expense ?? 0,
                balance: mappedOwn.balance ?? 0,
              } : null))
            : (mappedOwn ? { name: mappedOwn.name || mappedOwn.member_name, avatar_url: mappedOwn.avatar_url || null, meals: 0, deposit: 0, meal_cost: 0, other_expense: 0, balance: 0 } : (data?.my_account || previous?.my_account)),
        };
        latestDashboardRef.current = normalized;
        setDashboard(normalized);
        if (hasRunningPeriod && normalized.period) {
          // One cached, read-only SELECT hydrates the seven-day offline view. It does
          // not call finalization RPCs or write meal/audit/lock history.
          void syncUpcomingMeals(normalized.period);
        } else if (periodStatus === 'none') {
          void syncUpcomingMeals(null);
        }
        if (dashboardResult.status === 'rejected') {
          setDashboardError('ড্যাশবোর্ডের সারসংক্ষেপ সাময়িকভাবে লোড হয়নি; সদস্য তালিকা ও মাসের অবস্থা আলাদাভাবে লোড করা হয়েছে।');
        }
        const refreshMealBundle = options.refreshMealBundle ?? !silent;
        await syncOfflineSnapshot(normalized, { refreshMealBundle, forceMealBundle: Boolean(options.force) });
        return normalized;
      } catch (error) {
        if (!silent) {
          console.error('Dashboard load failed:', error);
          setDashboardError(error?.message || 'ড্যাশবোর্ডের তথ্য লোড করা যায়নি।');
        } else if (!latestDashboardRef.current && !latestCachedDashboardRef.current) {
          setDashboardError(error?.message || 'ড্যাশবোর্ডের তথ্য লোড করা যায়নি।');
        }
        return null;
      } finally {
        setLoading(false);
      }
    })();

    loadInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (loadInFlightRef.current === task) loadInFlightRef.current = null;
    }
  }, [hostelId, online, syncOfflineSnapshot, syncUpcomingMeals, membership?.membership_id]);

  useEffect(() => {
    if (!hostelId) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    if (online) {
      loadDashboard(false, { refreshMealBundle: true });
    } else {
      setDashboard(cachedDashboard);
      setLoading(false);
    }
  }, [hostelId, online, loadDashboard]);

  // Cache hydration is local-only. It must never trigger another online dashboard
  // fetch, otherwise each IndexedDB write can cause an RPC/render loop.
  useEffect(() => {
    if (!online && hostelId && !offlineLoading) {
      setDashboard(cachedDashboard);
      setLoading(false);
    }
  }, [cachedDashboard, offlineLoading, online, hostelId]);

  useRealtimeRefresh({
    enabled: online,
    minRefreshIntervalMs: 15000,
    immediateTables: ['monthly_periods'],
    hostelId,
    tables: ['meal_late_overrides', 'daily_meal_snapshots', 'meal_requests', 'market_entries', 'ledger_transactions', 'khala_money_entries', 'monthly_periods'],
    onRefresh: ({ tables = [], reason = 'realtime' } = {}) => {
      const mealDataChanged = tables.some((table) => ['meal_late_overrides', 'daily_meal_snapshots', 'meal_requests'].includes(table));
      invalidateRequestCache('dashboard:data', 'dining:memberDirectory', 'dining:runningPeriod');
      if (mealDataChanged) invalidateRequestCache('dashboard:offlineMealBundle', 'dashboard:upcoming-seven:');
      return loadDashboard(true, {
        force: false,
        forcePeriodCheck: tables.includes('monthly_periods'),
        refreshMealBundle: mealDataChanged,
      });
    },
  });

  const effectiveDashboard = online ? (dashboard || cachedDashboard) : cachedDashboard;
  // While the first live lookup is still loading, a cached false flag is not proof
  // that the current month is closed. Render a loading/error state instead of a false banner.
  const dashboardPeriodStatus = online && loading && !dashboard
    ? 'unknown'
    : (effectiveDashboard?.period_status || ((effectiveDashboard?.has_running_period ?? Boolean(effectiveDashboard?.period?.period_id || effectiveDashboard?.period?.id)) ? 'running' : 'none'));
  const dashboardHasRunningPeriod = dashboardPeriodStatus === 'running';
  // Offline cache has no period ID. Never present it as the live period's card
  // while a new running period has already been verified online.
  const mealCard = dashboardHasRunningPeriod
    ? (online ? dashboard?.meal_card || null : (offlineMealCard || cachedDashboard?.meal_card))
    : null;
  const dhakaToday = getDhakaDateTimeParts().today;
  const periodStartDate = String(effectiveDashboard?.period?.start_date || '').slice(0, 10);
  const pendingPeriodStartDate = dashboardHasRunningPeriod && periodStartDate > dhakaToday ? periodStartDate : null;
  const lastSync = snapshot?.savedAt || null;
  const summary = effectiveDashboard?.summary;
  // Older dashboard RPC payloads expose total_market/other_expense, while newer
  // payloads may expose total_expense/fund_remaining. Keep the UI correct with either.
  const dashboardMarketCost = Number(summary?.total_market ?? summary?.total_market_expense ?? 0) || 0;
  const dashboardOtherExpense = Number(summary?.other_expense ?? summary?.total_other_expense ?? 0) || 0;
  const dashboardKhalaMoney = Number(summary?.khala_money ?? summary?.total_khala_money ?? 0) || 0;
  const dashboardTotalExpense = Number(summary?.total_expense ?? (dashboardMarketCost + dashboardOtherExpense + dashboardKhalaMoney)) || 0;
  const dashboardFundRemaining = Number(summary?.fund_remaining ?? (Number(summary?.total_deposit || 0) - dashboardTotalExpense)) || 0;
  const account = effectiveDashboard?.my_account;
  const members = effectiveDashboard?.members ?? [];
  const visibleMembers = useMemo(() => {
    const query = memberSearchTerm.trim().normalize('NFKC').toLocaleLowerCase();
    if (!query) return members;
    return members.filter((member) => String(member?.name || member?.member_name || member?.full_name || '')
      .normalize('NFKC').toLocaleLowerCase().includes(query));
  }, [members, memberSearchTerm]);

  const openDetails = useCallback(async () => {
    const selectedMeal = online ? mealCard : (offlineMealCard || cachedDashboard?.meal_card);
    const date = selectedMeal?.meal_date;
    if (!date) return;

    if (!online) {
      const cachedRows = Array.isArray(selectedMeal?.member_details) ? selectedMeal.member_details : [];
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

  const openMember = useCallback((memberId) => {
    if (!memberId) return;
    if (!online) { toast.warning('সদস্যের পূর্ণ হিসাব দেখতে ইন্টারনেট চালু করুন।'); return; }
    navigateTo(`/app/menu/members?member_id=${encodeURIComponent(memberId)}`);
  }, [online, toast]);

  const hasCachedDashboard = Boolean(cachedDashboard);
  const activePeriodId = effectiveDashboard?.period?.period_id || effectiveDashboard?.period?.id || null;
  const scopedUpcomingMealRecord = upcomingMealRecord?.userId === userId
    && upcomingMealRecord?.hostelId === hostelId
    && (!online || !activePeriodId || upcomingMealRecord.periodId === activePeriodId)
    ? upcomingMealRecord : null;
  const hasCachedUpcomingMeals = Array.isArray(scopedUpcomingMealRecord?.days) && scopedUpcomingMealRecord.days.length === 7;

  return (
    <div className="page-stack dashboard-stack">
      {dashboardHasRunningPeriod ? <>
        <MealCard
          meal={mealCard}
          isOnline={online}
          hasOfflineDetails={Array.isArray(mealCard?.member_details) && mealCard.member_details.length > 0}
          hasUpcomingMeals={hasCachedUpcomingMeals}
          lastSync={lastSync}
          onDetails={openDetails}
          loading={online ? loading && !effectiveDashboard : offlineLoading}
          cachedError={dashboardError || offlineError?.message}
          pendingPeriodStartDate={pendingPeriodStartDate}
        />
        <LateRequestCard meal={mealCard} isOnline={online} lastSync={lastSync} />
      </> : dashboardPeriodStatus === 'none' && effectiveDashboard ? <MealCard meal={null} noRunningPeriod isOnline={online} /> : <MealCard
        meal={mealCard}
        isOnline={online}
        hasOfflineDetails={false}
        hasUpcomingMeals={hasCachedUpcomingMeals}
        lastSync={lastSync}
        onDetails={openDetails}
        loading={online ? loading && dashboardPeriodStatus === 'unknown' : offlineLoading}
        cachedError={dashboardError || (dashboardPeriodStatus === 'unknown' ? 'চলমান মাসের অবস্থা যাচাই করা যায়নি। আবার চেষ্টা করুন।' : offlineError?.message)}
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
              <MetricCard label="মোট খরচ" value={formatCurrency(dashboardTotalExpense)} />
              <MetricCard label="মোট মিল" value={formatNumber(summary?.total_meals)} />
              <MetricCard label="অবশিষ্ট ফান্ড" value={formatCurrency(dashboardFundRemaining)} />
            </div>
            <div className="rate-strip">
              <div>
                <span>বর্তমান মিল রেট</span>
                <small>বাজার {formatCurrency(dashboardMarketCost)} ÷ চূড়ান্ত মিল</small>
              </div>
              <strong>{formatCurrency(summary?.meal_rate)}</strong>
            </div>
            {!online && (
              <div className="offline-snapshot-note">
                <Icon name="offline" size={15} /> সর্বশেষ সংরক্ষিত তথ্য · {lastSync ? formatDateTime12(lastSync) : 'সময় পাওয়া যায়নি'}
              </div>
            )}
          </section> : dashboardPeriodStatus === 'none' ? null : <div className="state-card state-card-warning"><Icon name="warning" size={18}/><div><strong>মাসের অবস্থা যাচাই করা যায়নি</strong><p>সার্ভার থেকে চলমান মাসের নিশ্চয়তা পাওয়া যায়নি, তাই ভুল করে “মাস শুরু হয়নি” দেখানো হচ্ছে না।</p><button className="secondary-button compact" type="button" onClick={() => loadDashboard(false, { force: true, refreshMealBundle: true })}>আবার যাচাই করুন</button></div></div>}

          {online && <MyAccountCard account={account} onClick={() => openMember(membership?.membership_id)} />}

          {online && <section className="section-block">
            <div className="section-heading outside dashboard-member-toolbar">
              <div className="dashboard-member-title">
                <span className="eyebrow">এই মেসের সদস্যরা</span>
                <h2>সদস্য তালিকা</h2>
              </div>
              <div className="dashboard-member-tools">
                {members.length > 0 && <label className="dashboard-member-search">
                  <Icon name="search" size={17}/>
                  <input
                    type="search"
                    value={memberSearchTerm}
                    onChange={(event) => setMemberSearchTerm(event.target.value)}
                    placeholder="নাম দিয়ে খুঁজুন"
                    aria-label="সদস্যের নাম দিয়ে খুঁজুন"
                  />
                  {memberSearchTerm && <button type="button" onClick={() => setMemberSearchTerm('')} aria-label="সদস্য অনুসন্ধান মুছুন"><Icon name="x" size={15}/></button>}
                </label>}
                <span className="count-badge">{memberSearchTerm.trim() ? `${formatNumber(visibleMembers.length)} / ${formatNumber(members.length)} জন` : `${formatNumber(members.length)} জন`}</span>
              </div>
            </div>
            {members.length === 0 ? (
              <div className="empty-state-card">
                <Icon name="user" size={24} />
                <strong>সদস্যের তালিকা দেখানো যাচ্ছে না</strong>
                <span>{dashboardHasRunningPeriod ? 'সদস্য তালিকা পুনরায় লোড করুন বা ইন্টারনেট সংযোগ পরীক্ষা করুন।' : dashboardPeriodStatus === 'none' ? 'মাস বন্ধ হলেও মেসের সদস্যরা থেকে যান। নতুন মাস শুরু না হওয়া পর্যন্ত বর্তমান হিসাব শূন্য দেখানো হচ্ছে।' : 'মাসের অবস্থা যাচাই করা যাচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন।'}</span>
              </div>
            ) : visibleMembers.length === 0 ? (
              <div className="empty-state-card dashboard-member-search-empty">
                <Icon name="search" size={23}/>
                <strong>এই নামে কোনো সদস্য পাওয়া যায়নি</strong>
                <span>নামের বানান পরিবর্তন করে আবার খুঁজুন।</span>
                <button type="button" className="secondary-button compact" onClick={() => setMemberSearchTerm('')}>অনুসন্ধান মুছুন</button>
              </div>
            ) : (
              <div className="member-preview-grid member-detail-grid">
                {visibleMembers.map((member) => <MemberCard member={member} key={member.membership_id} onClick={() => openMember(member.membership_id)} />)}
              </div>
            )}
          </section>}
        </>
      ) : online && dashboardError ? (
        <section className="state-card state-card-error">
          <div className="state-icon"><Icon name="warning" size={28} /></div>
          <div>
            <h2>ড্যাশবোর্ড লোড করা যায়নি</h2>
            <p>{dashboardError}</p>
            {hasCachedDashboard ? (
              <p className="muted-note">আগের সংরক্ষিত তথ্য থাকলে উপরের অংশে সেটি দেখানো হবে।</p>
            ) : (
              <button className="secondary-button compact" onClick={() => loadDashboard(false, { force: true, refreshMealBundle: true })}>আবার চেষ্টা করুন</button>
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


      {detailsDate && (
        <MealDetailsModal
          date={detailsDate}
          rows={detailsRows}
          loading={detailsLoading}
          onClose={() => setDetailsDate(null)}
          upcomingRecord={scopedUpcomingMealRecord}
          upcomingLoading={upcomingMealLoading}
          upcomingError={upcomingMealError}
          isOnline={online}
        />
      )}
    </div>
  );
}
