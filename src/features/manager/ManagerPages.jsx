import { confirmAction, confirmTypedAction } from '../../utils/actionDialogs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { InfoPanel } from '../../components/InfoPanel';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useManagementContext } from '../../hooks/useManagementContext';
import { navigateTo } from '../../app/AppShell';
import {
  addKhalaMoney,
  changeManager,
  closeCurrentMonth,
  deactivateMember,
  emergencyOverrideMyMeal,
  fetchArchiveManagementItems,
  fetchArchivePermissions,
  fetchKhalaEntryMembers,
  fetchKhalaPeriods,
  fetchMealRequestOverlapDetails,
  fetchPeriodAssistants,
  grantArchiveEditPermission,
  reactivateMember,
  reopenArchivedPeriod,
  regenerateJoinCode,
  revokeArchiveEditPermission,
  saveManagerMyMeal,
  setPeriodAssistants,
  startNewMonth,
  updateHostel,
  updateKhalaMoney,
  voidKhalaMoney,
} from '../../services/managerService';
import { fetchKhalaMoneyHistory, fetchPreviousMonths, fetchArchivedMonthDetail } from '../../services/historyService';
import { buildDailyMealRows, buildMemberSettlementRows, calculateMealTotals, fetchCurrentReportBundle, getActiveMarketRows, getVoidMarketRows, printReport } from '../../services/reportService';
import { fetchManagerMemberDirectory, fetchMonthClosePreflight } from '../../services/diningService';
import { formatDateBangla, formatDateWithWeekday, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { getPeriodAwareError, getPeriodStartNotice } from '../../utils/periodMessaging';
import {
  managerCreateHostelInviteLink,
  managerListHostelJoinRequests,
  managerReviewHostelJoinRequest,
} from '../../services/hostelInviteService';
import { deriveNextRequiredStartDate, dhakaDateInputValue } from '../../utils/monthStart';
import { canActivateNextPeriod, getDhakaDateTimeParts, getMemberDeactivationImpact, getNextPeriodActivationMessage } from '../../utils/monthLifecyclePolicy';


function FeatureStateNotice({ title, text, icon = 'info', children }) {
  return (
    <div className="state-card state-card-warning feature-state-with-back">
      <Icon name={icon} size={28} />
      <div className="feature-state-copy"><h2>{title}</h2><p>{text}</p>{children}
        <button className="secondary-button compact feature-state-back" type="button" onClick={() => navigateTo('/app/dashboard')}><Icon name="arrow-left" size={15}/> ড্যাশবোর্ডে ফিরে যান</button>
      </div>
    </div>
  );
}

function AccessNotice({ title, text }) {
  return <FeatureStateNotice title={title} text={text} icon="shield" />;
}

function ManagerGuard({ children }) {
  const { isManager } = useAuth();
  const { isOperationalManager } = useManagementContext();
  if (isManager || isOperationalManager) return children;
  return <AccessNotice title="ম্যানেজার অনুমতি প্রয়োজন" text="এই ফিচারটি ম্যানেজার বা সহকারী ম্যানেজার ব্যবহার করতে পারবেন।" />;
}

function PrimaryManagerGuard({ children }) {
  const { isManager } = useAuth();
  const { isPrimaryManager, period } = useManagementContext();
  const canManagePrimary = period ? Boolean(isPrimaryManager) : Boolean(isManager);
  if (canManagePrimary) return children;
  return <AccessNotice title="প্রধান ম্যানেজারের অনুমতি প্রয়োজন" text="এই কাজটি শুধু বর্তমান প্রধান ম্যানেজার করতে পারবেন।" />;
}

function currentPeriodRange(period) {
  const start = period?.start_date ? formatDateBangla(period.start_date) : 'তারিখ নেই';
  return period?.end_date
    ? `${start} → ${formatDateBangla(period.end_date)}`
    : `${start} থেকে চলমান`;
}

function PageHeader({ title, description, icon = 'shield', eyebrow = 'ম্যানেজার ফিচার' }) {
  const managerOnly = eyebrow === 'ম্যানেজার ফিচার';
  return (
    <div className="page-title-row manager-page-title card menu-page-intro-card">
      <div>
        <button className="secondary-button compact back-button" type="button" onClick={() => navigateTo('/app/dashboard')}>
          <Icon name="arrow-left" size={15} /> ফিরে যান
        </button>
        <div className={`manager-eyebrow ${managerOnly ? '' : 'neutral-page-eyebrow'}`}>{managerOnly && <Icon name={icon} size={13} />} {eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function escapeReportHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function reportStatusLabel(value) {
  const labels = {
    finalized: 'চূড়ান্ত', final: 'চূড়ান্ত', closed: 'বন্ধ', locked: 'বন্ধ', open: 'চলমান', pending: 'অপেক্ষমাণ',
    in_progress: 'চলমান', draft: 'খসড়া', reopened: 'পুনরায় চালু', active: 'সক্রিয়', inactive: 'নিষ্ক্রিয়',
    void: 'বাতিল', cancelled: 'বাতিল', completed: 'সম্পন্ন', approved: 'অনুমোদিত', rejected: 'প্রত্যাখ্যাত',
  };
  const normalized = String(value ?? '').trim().toLowerCase();
  return labels[normalized] || (value ? 'অন্যান্য অবস্থা' : '—');
}

function reportTransactionLabel(value) {
  const labels = {
    deposit: 'জমা', contribution: 'জমা', market_deposit: 'বাজার বাবদ জমা',
    other_expense: 'অন্যান্য খরচ', expense: 'খরচ', market: 'বাজার খরচ',
    market_entry: 'বাজার খরচ', meal_cost: 'মিলের খরচ', khala_money: 'খালার টাকা',
    correction: 'হিসাব সংশোধন', adjustment: 'হিসাব সমন্বয়', reversal: 'বাতিলের সমন্বয়',
    market_reversal: 'বাজার বাতিলের সমন্বয়', refund: 'ফেরত', withdrawal: 'উত্তোলন',
  };
  const raw = String(value ?? '').trim();
  if (!raw) return 'অন্যান্য';
  const normalized = raw.toLowerCase().replace(/[ -]+/g, '_');
  return labels[normalized] || 'অন্যান্য লেনদেন';
}

function ConfirmModal({ title, description, confirmLabel = 'নিশ্চিত করুন', danger = false, busy = false, onConfirm, onClose, children, className = '' }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className={`modal-panel card confirmation-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div><span className="eyebrow">নিশ্চিতকরণ</span><h2>{title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button>
        </div>
        <p className="confirm-description">{description}</p>
        {children}
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button>
          <button className={`primary-button ${danger ? 'danger-button' : ''}`} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'অপেক্ষা করুন...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

async function copyText(value) {
  if (!value) throw new Error('কপি করার মতো কোড নেই।');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('কপি করা যায়নি।');
}

function SelectMember({ members, value, onChange, includeInactive = false }) {
  const rows = includeInactive ? members : members.filter((m) => m.member_status === 'active');
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">সদস্য নির্বাচন করুন</option>
      {rows.map((member) => <option value={member.membership_id} key={member.membership_id}>{member.member_name}{member.member_status === 'inactive' ? ' — নিষ্ক্রিয়' : ''}</option>)}
    </select>
  );
}

export function NewMonthPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { context, refresh, isPrimaryManager } = useManagementContext();
  const [startDate, setStartDate] = useState('');
  const [derivedRequiredStart, setDerivedRequiredStart] = useState('');
  const [periodDateError, setPeriodDateError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setPeriodDateError('');
    try {
      const data = await refresh({ force: true });
      if (!data) {
        setDerivedRequiredStart('');
        setPeriodDateError('মাসের তথ্য সার্ভার থেকে নিশ্চিত করা যায়নি। সংযোগ যাচাই করে আবার চেষ্টা করুন।');
        return;
      }
      if (data.has_running_period === true) {
        setDerivedRequiredStart('');
        setStartDate('');
        return;
      }
      if (data.has_running_period !== false) {
        setDerivedRequiredStart('');
        setPeriodDateError('মাসের অবস্থা নিশ্চিত করা যায়নি। নিরাপত্তার জন্য নতুন মাস শুরুর তারিখ নির্ধারণ বন্ধ রাখা হয়েছে।');
        return;
      }

      let requiredStart = /^\d{4}-\d{2}-\d{2}$/.test(String(data.next_required_start_date || ''))
        ? data.next_required_start_date
        : '';
      // The bundled Master SQL's management-context RPC doesn't expose this field.
      // Derive it from the read-only archive RPC: latest closed end + 1; if there is
      // no history, use day 1 of the current Asia/Dhaka calendar month.
      if (!requiredStart) {
        const archives = await fetchArchiveManagementItems();
        requiredStart = deriveNextRequiredStartDate(archives, data.today || dhakaDateInputValue());
      }
      if (!requiredStart) throw new Error('পরবর্তী মাসের শুরুর তারিখ নির্ধারণ করা যায়নি।');
      setDerivedRequiredStart(requiredStart);
      setStartDate(requiredStart);
    } catch (error) {
      setDerivedRequiredStart('');
      setPeriodDateError(getFriendlySupabaseError(error, 'নতুন মাসের শুরুর তারিখ নির্ধারণ করা যায়নি।'));
      toast.error(getFriendlySupabaseError(error, 'নতুন মাসের তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [refresh, toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="নতুন মাস শুরু করতে অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="নতুন মাসের নিয়ম যাচাই হচ্ছে..." />;

  const requiredStart = context?.next_required_start_date || derivedRequiredStart || '';
  const periodStatusKnown = typeof context?.has_running_period === 'boolean';
  const hasRunning = context?.has_running_period === true;
  // Rule A: if the next period starts tomorrow, it may be opened from 8 PM
  // on the closing date. If activation is delayed until the start date, it can
  // still be opened; the ordinary 10 PM request deadline remains unchanged.
  const dhakaClock = getDhakaDateTimeParts(clockNow);
  const canActivateByTime = requiredStart ? canActivateNextPeriod(requiredStart, clockNow) : false;
  const canStart = Boolean(periodStatusKnown && isPrimaryManager && !hasRunning && requiredStart && startDate === requiredStart && !periodDateError && canActivateByTime);
  const activationMessage = requiredStart ? getNextPeriodActivationMessage(requiredStart, clockNow) : '';

  const submit = async () => {
    if (!canActivateNextPeriod(startDate, new Date())) {
      toast.warning(getNextPeriodActivationMessage(startDate, new Date()));
      return;
    }
    setBusy(true);
    try {
      const result = await startNewMonth(startDate);
      setConfirmOpen(false);
      toast.success(`${result?.label || 'নতুন মাস'} সফলভাবে শুরু হয়েছে।`);
      await load();
      await refresh({ force: true });
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নতুন মাস শুরু করা যায়নি।'));
    } finally { setBusy(false); }
  };

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="নতুন মাস শুরু" icon="calendar" description="বন্ধ হওয়া মাসের পরের দিন হবে নতুন মাসের প্রথম মিলের দিন। বন্ধের দিন রাত ৮টার পর নতুন মাস চালু করা যাবে; সাধারণ মিল অনুরোধ রাত ১০টা পর্যন্ত দেওয়া যাবে।" />
        <InfoPanel icon="calendar-check">নতুন মাস শুরু করলে আগের মাসের হিসাব আর্কাইভে সংরক্ষিত থাকবে। তারিখ সিস্টেম নির্ধারণ করে; কোনো অসামঞ্জস্য থাকলে বোতাম বন্ধ থাকবে—আগের মাস যাচাই না করে জোর করে শুরু করবেন না।</InfoPanel>
        <section className="card manager-form-card">
          {periodDateError && <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>নতুন মাসের তারিখ যাচাই করা যায়নি।</strong><p>{periodDateError}</p><button className="secondary-button compact" type="button" onClick={load}>আবার যাচাই করুন</button></div></div>}
          {!periodStatusKnown ? (
            <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>মাসের অবস্থা যাচাই করা যায়নি।</strong><p>নিরাপত্তার জন্য নতুন মাস শুরুর বোতাম বন্ধ রাখা হয়েছে। আবার যাচাই করুন।</p><button className="secondary-button compact" type="button" onClick={load}>আবার যাচাই করুন</button></div></div>
          ) : hasRunning ? (
            <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>আগের মাস এখনও চলমান।</strong><p>নতুন মাস শুরু করার আগে বর্তমান মাস বন্ধ করুন।</p></div></div>
          ) : !periodDateError && requiredStart ? (
            <>
              <div className="manager-current-period"><span>নতুন মাসের নির্ধারিত শুরুর তারিখ</span><strong>{formatDateBangla(requiredStart)}</strong><small>{derivedRequiredStart && !context?.next_required_start_date ? 'পূর্ববর্তী মাসের ইতিহাস অথবা প্রথম মাসের নিয়ম থেকে তারিখ নির্ধারণ করা হয়েছে।' : 'শুরুর তারিখ সিস্টেম নিজে নির্ধারণ করেছে। এটি পরিবর্তন করা যাবে না।'}</small></div>
              <label className="field-label"><span>শুরুর তারিখ</span><input type="date" value={startDate} min={requiredStart} max={requiredStart} readOnly /></label>
              <div className="form-hint"><Icon name="info" size={15} /> প্রথম মাস হলে চলতি বাংলাদেশি ক্যালেন্ডার মাসের ১ তারিখ থেকে শুরু হবে। পূর্ববর্তী মাস থাকলে তার শেষ দিনের পরের দিন হবে নতুন মাসের প্রথম মিলের দিন।</div>
              <div className={`inline-info ${canActivateByTime ? '' : 'is-warning'}`} role="status"><Icon name={canActivateByTime ? 'calendar-check' : 'clock'} size={15} /> {activationMessage} <span>বাংলাদেশ সময় এখন {String(dhakaClock.hour).padStart(2, '0')}:{String(dhakaClock.minute).padStart(2, '0')}।</span></div>
              <button className="primary-button large" type="button" disabled={!canStart || busy} onClick={() => setConfirmOpen(true)}><Icon name="calendar" size={17} /> নতুন মাস শুরু করুন</button>
            </>
          ) : null}
        </section>
        {confirmOpen && <ConfirmModal title="নতুন মাস শুরু করবেন?" description={`${formatDateBangla(startDate)} হবে নতুন মাসের প্রথম মিলের দিন। ${activationMessage} আগের মাসের ফাইনাল হিসাব ও ইতিহাস অক্ষত থাকবে।`} confirmLabel="হ্যাঁ, নতুন মাস চালু করুন" busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={submit} />}
      </div>
    </PrimaryManagerGuard>
  );
}

export function CloseCurrentMonthPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { context, refresh } = useManagementContext();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [futureWarning, setFutureWarning] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [overlaps, setOverlaps] = useState([]);
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, preflightData] = await Promise.all([
        refresh({ force: true }),
        fetchMonthClosePreflight().catch(() => null),
      ]);
      setPreflight(preflightData);
      if (preflightData?.overlap_pair_count > 0 && data?.period?.period_id) {
        setOverlaps(await fetchMealRequestOverlapDetails(data.period.period_id).catch(() => []));
      } else {
        setOverlaps([]);
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'বর্তমান মাসের তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [refresh, toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="মাস বন্ধ করতে অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="বর্তমান মাস লোড হচ্ছে..." />;
  if (context?.has_running_period !== true || !context?.period) {
    if (context?.has_running_period === false) {
      return <FeatureStateNotice title="কোনো চলমান মাস নেই" text="নতুন মাস শুরু করতে মেনু থেকে “নতুন মাস শুরু” ব্যবহার করুন।" icon="calendar"><button className="secondary-button compact" type="button" onClick={() => navigateTo('/app/menu/new-month')}>নতুন মাস শুরু</button></FeatureStateNotice>;
    }
    return <FeatureStateNotice title="চলমান মাসের অবস্থা যাচাই করা যায়নি" text="ভুল করে মাস নেই ধরে নেওয়া হচ্ছে না। ইন্টারনেট ও সার্ভার সংযোগ যাচাই করে আবার চেষ্টা করুন।" icon="warning"><button className="secondary-button compact" type="button" onClick={load}>আবার যাচাই করুন</button></FeatureStateNotice>;
  }

  const today = getDhakaDateTimeParts(clockNow).today || context.today || toDateInputValue();
  const futureRequestCount = Number(preflight?.future_active_request_count ?? preflight?.future_request_count ?? 0);
  const futureDayCount = Number(preflight?.future_day_count ?? 0);
  const pendingSpecialCount = Number(preflight?.pending_special_request_count ?? 0);
  const futureFinancialCount = Number(preflight?.future_financial_entry_count ?? 0);
  const requiresImpactConfirmation = futureRequestCount > 0 || futureDayCount > 0 || pendingSpecialCount > 0;
  const preflightKnown = typeof preflight?.can_close === 'boolean';
  const cannotCloseYet = !preflightKnown || preflight.can_close === false || futureFinancialCount > 0;
  const showGenericCloseBlock = !preflightKnown || preflight.can_close === false || futureFinancialCount > 0;
  const closeMonth = async (confirmCancel = false) => {
    const closingDate = dhakaDateInputValue() || today;
    setBusy(true);
    try {
      const result = await closeCurrentMonth(confirmCancel);
      const finalizedDays = Number(result?.finalized_days ?? 0);
      const actualClosingDate = result?.closing_date || closingDate;
      const cancelledRequests = Number(result?.cancelled_requests ?? 0);
      const cancelledRecords = Number(result?.cancelled_meal_records ?? 0);
      toast.success(`${context.period.label} বন্ধ হয়েছে। ${formatDateBangla(actualClosingDate)} পর্যন্ত হিসাব সঙ্গে সঙ্গেই চূড়ান্ত হয়েছে${finalizedDays ? ` (${finalizedDays}টি মিল-দিন)` : ''}। ${cancelledRequests}টি অনুরোধ ও ${cancelledRecords}টি ভবিষ্যৎ মিল রেকর্ড বাতিল হয়েছে।`);
      setFutureWarning(false);
      setConfirmOpen(false);
      await load();
      await refresh({ force: true });
    } catch (error) {
      const message = getFriendlySupabaseError(error, 'মাস বন্ধ করা যায়নি।');
      if (!confirmCancel && /ভবিষ্যৎ|বিশেষ|অপেক্ষমাণ|অনুরোধ|রিকোয়েস্ট|request|সতর্কতা|প্রভাবিত|নিশ্চিত/i.test(message)) {
        const latestPreflight = await fetchMonthClosePreflight().catch(() => null);
        if (latestPreflight) setPreflight(latestPreflight);
        setFutureWarning(true);
        setConfirmOpen(true);
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader
          title="বর্তমান মাস শেষ করুন"
          icon="calendar"
          description="মাস যেকোনো সময় বন্ধ করা যাবে। বন্ধ করার সঙ্গে সঙ্গেই আজ পর্যন্ত সব মিলের হিসাব চূড়ান্ত হবে; আজকের পরের তারিখের অনুরোধ ও রেকর্ড বাতিল হবে।"
        />
        <InfoPanel tone="warning" icon="alert-triangle">মাস বন্ধ করা চূড়ান্ত প্রশাসনিক কাজ। বন্ধের আগে ভবিষ্যৎ মিল অনুরোধ, অপেক্ষমাণ সংশোধন ও আর্থিক এন্ট্রি যাচাই করুন; বন্ধ করার পর নতুন সাধারণ অনুরোধ নেওয়া হবে না।</InfoPanel>
        <section className="card manager-form-card">
          <div className="manager-current-period">
            <span>চলমান মাস</span>
            <strong>{context.period.label}</strong>
            <small>{formatDateBangla(context.period.start_date)} থেকে · বন্ধ করলে {formatDateBangla(today)} শেষ দিন হবে</small>
            <em>বন্ধ করার সঙ্গে সঙ্গেই আজকের হিসাবও চূড়ান্ত হবে; রাত ৯টার জন্য অপেক্ষা করতে হবে না।</em>
          </div>
          {showGenericCloseBlock && <div className="manager-warning-box" role="alert"><Icon name="clock" size={18} /><div><strong>{preflightKnown ? 'এই মাসটি এখনই বন্ধ করা যাবে না।' : 'মাস বন্ধের আগে যাচাই সম্পন্ন হয়নি।'}</strong><p>{preflight?.message || 'মিলের অনুরোধ, আর্থিক এন্ট্রি ও তারিখের অবস্থা সার্ভার থেকে যাচাই করা যায়নি। নিরাপত্তার জন্য মাস বন্ধের বোতাম বন্ধ রাখা হয়েছে।'}</p>{futureFinancialCount > 0 && <small>ভবিষ্যৎ তারিখের আর্থিক এন্ট্রি আগে ঠিক করুন।</small>}<button className="secondary-button compact" type="button" onClick={load}>আবার যাচাই করুন</button></div></div>}
          {preflight?.running_period_count > 1 && <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>মেসে একাধিক চলমান মাস পাওয়া গেছে।</strong><p>নতুন মাস শুরু করবেন না। আগে এই তথ্যের অবস্থা যাচাই করতে হবে।</p></div></div>}
          {requiresImpactConfirmation && <div className="manager-warning-box" role="alert"><Icon name="warning" size={18} /><div><strong>মাস বন্ধ করলে কিছু অনুরোধ/রেকর্ড বাতিল হবে।</strong><p>{futureRequestCount}টি ভবিষ্যৎ সক্রিয় অনুরোধ, {futureDayCount}টি ভবিষ্যৎ মিল-দিন এবং {pendingSpecialCount}টি অপেক্ষমাণ লেট/সংশোধন অনুরোধ পাওয়া গেছে। নিশ্চিত করলে এগুলো বাতিল হবে; আজ পর্যন্ত অনুমোদিত মিলের হিসাব চূড়ান্ত হবে।</p></div></div>}
          <div className="inline-info" role="status"><Icon name="info" size={16} /> মাস বন্ধ করার দিন রাত ৯টার আগেও বন্ধ করলে আজকের অনুমোদিত মিল সঙ্গে সঙ্গে চূড়ান্ত হবে। কোনো অপেক্ষমাণ লেট/সংশোধন অনুরোধ থাকলে সেটি নিশ্চিতকরণের মাধ্যমে বাতিল হবে।</div>
          {preflight && preflight.overlap_pair_count > 0 && <div className="form-hint"><Icon name="info" size={16} /> {preflight.overlap_pair_count}টি পুরোনো overlapping normal request pair আছে। এগুলো মাস বন্ধের বাধা নয়; নতুন request দেওয়ার সময় conflict protection কাজ করবে।</div>}
          {overlaps.length > 0 && <div className="manager-overlap-list"><strong>ঐতিহাসিক overlap-এর বিবরণ</strong>{overlaps.map((item) => <div className="manager-overlap-row" key={`${item.request_id_a}-${item.request_id_b}`}><span>{item.member_name_a || 'সদস্য'} · {formatDateBangla(item.start_date_a)} → {formatDateBangla(item.end_date_a)}</span><span>{item.member_name_b || 'সদস্য'} · {formatDateBangla(item.start_date_b)} → {formatDateBangla(item.end_date_b)}</span></div>)}</div>}
          <div className="archive-period-close-summary">
            <div><span>মাস শুরু</span><strong>{formatDateBangla(context.period.start_date)}</strong></div>
            <div><span>শেষ দিন</span><strong>{formatDateBangla(today)}</strong><small>শুধু বন্ধ করার সময় নির্ধারিত হবে</small></div>
          </div>
          <button className="primary-button large" type="button" disabled={busy || cannotCloseYet || preflight?.running_period_count > 1} onClick={() => {
            setFutureWarning(requiresImpactConfirmation);
            setConfirmOpen(true);
          }}>
            <Icon name="calendar" size={17} /> {busy ? 'হিসাব চূড়ান্ত ও মাস বন্ধ হচ্ছে...' : 'আজই হিসাব চূড়ান্ত করে মাস বন্ধ করুন'}
          </button>
        </section>
        {confirmOpen && <ConfirmModal
          className="month-close-confirmation"
          title="মাস বন্ধের আগে নিশ্চিত করুন"
          description="নিচের তথ্যগুলো একবার দেখে নিশ্চিত করুন। মাস বন্ধ হলে এই মাসে নতুন সাধারণ মিল অনুরোধ আর নেওয়া হবে না।"
          confirmLabel="হ্যাঁ, হিসাব চূড়ান্ত করে মাস বন্ধ করুন"
          danger={futureWarning}
          busy={busy}
          onClose={() => { setConfirmOpen(false); setFutureWarning(false); }}
          onConfirm={() => closeMonth(futureWarning)}
        >
          <div className="month-close-confirm-summary">
            <div><span>বন্ধ হওয়া মাস</span><strong>{context.period.label}</strong></div>
            <div><span>চূড়ান্ত তারিখ</span><strong>{formatDateBangla(today)}</strong></div>
          </div>
          <div className={`month-close-confirm-impact ${futureWarning ? 'has-cancellations' : ''}`} role="note">
            <div className="month-close-confirm-impact-title"><Icon name={futureWarning ? 'warning' : 'info'} size={18} /><strong>{futureWarning ? 'যে তথ্যগুলো প্রভাবিত হবে' : 'মাস বন্ধ হলে যা হবে'}</strong></div>
            <div className="month-close-confirm-counts">
              <div><strong>{formatNumber(futureRequestCount)}</strong><span>ভবিষ্যৎ সক্রিয় অনুরোধ</span></div>
              <div><strong>{formatNumber(futureDayCount)}</strong><span>ভবিষ্যৎ মিল-দিন</span></div>
              <div><strong>{formatNumber(pendingSpecialCount)}</strong><span>অপেক্ষমাণ বিশেষ অনুরোধ</span></div>
            </div>
            <p>আজ পর্যন্ত বাতিল না হওয়া অনুমোদিত মিলের হিসাব সঙ্গে সঙ্গেই চূড়ান্ত হবে—রাত ৯টার জন্য অপেক্ষা করতে হবে না। আজকের পরের তারিখের সক্রিয় অনুরোধ ও রেকর্ড এবং অপেক্ষমাণ লেট/সংশোধন অনুরোধ বাতিল হবে।</p>
            <small>আগের দিনের চূড়ান্ত হিসাব ও আর্থিক ইতিহাস মুছে ফেলা বা পরিবর্তন করা হবে না।</small>
          </div>
        </ConfirmModal>}
      </div>
    </PrimaryManagerGuard>
  );
}

export function ChangeManagerPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { membership, profile, refreshIdentity } = useAuth();
  const { period } = useManagementContext();
  const futurePeriodNotice = getPeriodStartNotice(period, 'বাজার ও আর্থিক এন্ট্রি');
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMembers(await fetchManagerMemberDirectory()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  const currentName = profile?.full_name || 'বর্তমান ম্যানেজার';
  const candidates = members.filter((m) => m.membership_id !== membership?.membership_id && m.member_status === 'active');

  const submit = async () => {
    setBusy(true);
    try {
      await changeManager(selected);
      setConfirmOpen(false);
      toast.success('ম্যানেজার সফলভাবে পরিবর্তন হয়েছে। আপনার account এখন সাধারণ সদস্য হিসেবে থাকবে।');
      await refreshIdentity();
      navigateTo('/app/dashboard', true);
    } catch (error) {
      toast.error(getPeriodAwareError(error, 'ম্যানেজার পরিবর্তন করা যায়নি।', period, 'ম্যানেজার-সম্পর্কিত এন্ট্রি'));
    } finally { setBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="ম্যানেজার পরিবর্তনের জন্য অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="ম্যানেজার পরিবর্তনের সদস্য তালিকা লোড হচ্ছে..." />;

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="ম্যানেজার পরিবর্তন" icon="shield" description="নতুন ম্যানেজার নির্বাচন করলে আপনার বর্তমান ম্যানেজার ক্ষমতা সঙ্গে সঙ্গে চলে যাবে।" />
        <InfoPanel tone="warning" icon="shield-alert">পরিবর্তন নিশ্চিত করার পর আপনার ম্যানেজার ক্ষমতা সঙ্গে সঙ্গে শেষ হবে। নতুন ম্যানেজার নির্বাচন করার আগে তাঁর সঙ্গে দায়িত্ব ও চলমান হিসাব বুঝিয়ে নিন।</InfoPanel>
        <div className="form-hint" role="note">ম্যানেজার পরিবর্তন একটি আলাদা অনুমতি-নিয়ন্ত্রিত কাজ; এটি বাজার বা ডিপোজিটের মতো তারিখভিত্তিক হিসাব এন্ট্রি নয়। তাই নতুন মাসের প্রথম দিনের আগে বাজার/ডিপোজিট/অন্যান্য আর্থিক এন্ট্রি বন্ধ থাকলেও, বর্তমান প্রধান ম্যানেজারের অনুমতি থাকলে ম্যানেজার পরিবর্তন করা যায়।</div>
        {futurePeriodNotice && <div className="form-hint period-start-notice"><Icon name="info" size={15} /> {futurePeriodNotice} ম্যানেজার পরিবর্তনের এই কাজটি এখনই করা যাবে।</div>}
        <section className="card manager-form-card">
          <div className="manager-role-hero"><div className="role-person"><span>বর্তমান</span><strong>{currentName}</strong><small>ম্যানেজার</small></div><Icon name="arrow-right" size={24} /><div className="role-person"><span>নতুন</span><strong>{selected ? members.find((m) => m.membership_id === selected)?.member_name : 'নির্বাচন করুন'}</strong><small>ম্যানেজার হবে</small></div></div>
          <label className="field-label"><span>নতুন ম্যানেজার নির্বাচন করুন</span><select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">সদস্য নির্বাচন করুন</option>{candidates.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select></label>
          {!candidates.length && <div className="empty-state-card compact-empty"><Icon name="users" size={24} /><strong>ম্যানেজার করার মতো সক্রিয় সদস্য নেই</strong><span>মেসে অন্য অন্তত একজন সক্রিয় সদস্য থাকতে হবে।</span></div>}
          <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>পরিবর্তনের পরে আপনি সাধারণ সদস্য হবেন।</strong><p>আপনার পুরোনো ইতিহাস, জমা ও মিলের তথ্য অক্ষত থাকবে। শুধু ক্ষমতা পরিবর্তিত হবে।</p></div></div>
          <button className="primary-button large" type="button" disabled={!selected || busy} onClick={() => setConfirmOpen(true)}><Icon name="shield" size={17} /> ম্যানেজার পরিবর্তন করুন</button>
        </section>
        {confirmOpen && <ConfirmModal title="ম্যানেজার পরিবর্তন নিশ্চিত করুন" description={`${members.find((m) => m.membership_id === selected)?.member_name || 'নির্বাচিত সদস্য'}-কে নতুন ম্যানেজার করা হবে এবং ${currentName}-এর ম্যানেজার ক্ষমতা চলে যাবে।`} confirmLabel="পরিবর্তন নিশ্চিত করুন" busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={submit} />}
      </div>
    </PrimaryManagerGuard>
  );
}


export function AssistantManagersPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { membership } = useAuth();
  const { context, refresh, isPrimaryManager } = useManagementContext();
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, assistantRows] = await Promise.all([
        fetchManagerMemberDirectory(),
        fetchPeriodAssistants(context?.period?.period_id || null),
      ]);
      setMembers(memberRows.filter((member) => member.member_status === 'active' && member.membership_id !== membership?.membership_id && member.role !== 'manager').sort((a, b) => String(a.member_name || '').localeCompare(String(b.member_name || ''), 'bn')));
      setSelected(assistantRows.map((row) => row.membership_id));
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'সহকারী ম্যানেজারের তালিকা লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [context?.period?.period_id, membership?.membership_id, toast]);

  useEffect(() => { if (online && isPrimaryManager) load(); }, [online, isPrimaryManager, load]);

  const toggle = (membershipId) => {
    setSelected((current) => current.includes(membershipId) ? current.filter((id) => id !== membershipId) : [...current, membershipId]);
  };

  const save = async () => {
    if (!context?.period?.period_id) return toast.warning('চলমান মাস পাওয়া যায়নি।');
    setBusy(true);
    try {
      await setPeriodAssistants(selected, context.period.period_id);
      toast.success('সহকারী ম্যানেজারের তালিকা সফলভাবে আপডেট হয়েছে।');
      await refresh();
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'সহকারী ম্যানেজারের তালিকা আপডেট করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="সহকারী ম্যানেজার পরিচালনার জন্য অনলাইন সংযোগ প্রয়োজন।" />;
  if (!isPrimaryManager) return <AccessNotice title="প্রধান ম্যানেজারের অনুমতি প্রয়োজন" text="সহকারী ম্যানেজার শুধু বর্তমান প্রধান ম্যানেজার নির্ধারণ করতে পারবেন।" />;
  if (loading) return <LoadingSpinner label="সহকারী ম্যানেজারের তালিকা লোড হচ্ছে..." />;

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="সহকারী ম্যানেজার" icon="users" description="চলতি মাসের দৈনন্দিন কাজের জন্য একাধিক সহকারী ম্যানেজার নির্ধারণ করুন।" />
        <InfoPanel icon="shield-check">শুধু সক্রিয় সদস্যকে সহকারী ম্যানেজার করা যায়। সহকারীরা নির্ধারিত দৈনন্দিন কাজ করবেন; মাস শুরু/বন্ধ ও মূল ম্যানেজার পরিবর্তনের ক্ষমতা প্রধান ম্যানেজারের কাছেই থাকবে।</InfoPanel>
        <section className="card manager-form-card">
          <div className="manager-warning-box"><Icon name="info" size={18} /><div><strong>সহকারী ম্যানেজার শুধু দৈনন্দিন কাজের ক্ষমতা পাবেন।</strong><p>মাস শুরু/শেষ, সদস্য নিষ্ক্রিয় করা এবং ম্যানেজার পরিবর্তন শুধু প্রধান ম্যানেজার করতে পারবেন।</p></div></div>
          <div className="assistant-selection-heading">
            <div><strong>সক্রিয় সদস্য নির্বাচন</strong><small>চেক করে সহকারী ম্যানেজার করুন; নির্বাচন তুলে নিলে সহকারীর ক্ষমতা সরে যাবে।</small></div>
            <span className="assistant-selection-count"><Icon name="shield-check" size={15} /> {selected.length} জন নির্বাচিত</span>
          </div>
          <div className="assistant-grid" role="group" aria-label="সহকারী ম্যানেজার নির্বাচন">
            {members.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="users" size={24} /><strong>সহকারী দেওয়ার মতো সক্রিয় সদস্য নেই।</strong></div> : members.map((member) => {
              const checked = selected.includes(member.membership_id);
              return <label className={`assistant-choice-card ${checked ? 'selected' : ''}`} key={member.membership_id}>
                <input type="checkbox" checked={checked} onChange={() => toggle(member.membership_id)} aria-label={`${member.member_name} ${checked ? 'সহকারী ম্যানেজার থেকে বাদ দিন' : 'সহকারী ম্যানেজার হিসেবে নির্বাচন করুন'}`} />
                <span className="assistant-choice-avatar" aria-hidden="true"><Icon name={checked ? 'shield-check' : 'user-round'} size={18} /></span>
                <span className="assistant-choice-copy"><strong>{member.member_name}</strong><small>{checked ? 'সহকারী ম্যানেজার' : 'সাধারণ সদস্য'}</small></span>
                <span className="assistant-choice-state" aria-hidden="true"><Icon name={checked ? 'check-circle-2' : 'circle'} size={18} /></span>
              </label>;
            })}
          </div>
          <button className="primary-button large assistant-save-button" type="button" disabled={busy} onClick={save}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'সহকারী তালিকা সংরক্ষণ করুন'}</button>
        </section>
      </div>
    </PrimaryManagerGuard>
  );
}

export function HostelSettingsPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { membership, refreshIdentity } = useAuth();
  const [name, setName] = useState(membership?.hostel_name || '');
  const [joinCode, setJoinCode] = useState(membership?.join_code || '');
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState(false);
  const [inviteLinkBusy, setInviteLinkBusy] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState('');

  const createInviteLink = async () => {
    setInviteLinkBusy(true);
    try {
      const result = await managerCreateHostelInviteLink('সদস্য আমন্ত্রণ');
      if (!result?.token || !/^[0-9a-f]{64}$/.test(result.token)) throw new Error('সার্ভার থেকে বৈধ Invitation Token পাওয়া যায়নি। Run29 Migration প্রয়োগ হয়েছে কি না যাচাই করুন।');
      setCreatedInviteUrl(`${window.location.origin}/invite#${result.token}`);
      toast.success('নতুন আমন্ত্রণ লিংক তৈরি হয়েছে। আগের লিংকটি আর কাজ করবে না।');
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'Invitation Link তৈরি করা যায়নি।')); }
    finally { setInviteLinkBusy(false); }
  };

  const copyAndShareInvite = async () => {
    if (!createdInviteUrl) return;
    const hostelName = membership?.hostel_name || 'Hostel Life মেস';
    const shareData = {
      title: `${hostelName} — যোগদানের আমন্ত্রণ`,
      text: `${hostelName}-এ যোগ দেওয়ার জন্য আপনাকে আমন্ত্রণ জানানো হয়েছে। লিংকটি খুলে অ্যাকাউন্ট তৈরি করে Join Request পাঠান।`,
      url: createdInviteUrl,
    };
    // Start both APIs in the same user-activation turn: Web Share often requires
    // transient activation, while clipboard permission may resolve asynchronously.
    let shareTask = null;
    try { if (typeof navigator.share === 'function') shareTask = navigator.share(shareData); }
    catch (error) { shareTask = Promise.reject(error); }
    const clipboardPayload = shareTask ? createdInviteUrl : `${shareData.text}\n${createdInviteUrl}`;
    const copyTask = copyText(clipboardPayload);
    const [shareResult, copyResult] = await Promise.allSettled([
      shareTask || Promise.resolve(null),
      copyTask,
    ]);
    if (copyResult.status === 'fulfilled') {
      if (shareTask && shareResult.status === 'fulfilled') toast.success('লিংক কপি হয়েছে এবং শেয়ার অপশন সম্পন্ন হয়েছে।');
      else if (shareResult.status === 'rejected' && shareResult.reason?.name !== 'AbortError') toast.info('লিংক কপি হয়েছে। এই ব্রাউজারে শেয়ার অপশন পাওয়া যায়নি।');
      else toast.success(shareTask ? 'আমন্ত্রণ লিংক কপি হয়েছে।' : 'আমন্ত্রণ বার্তা ও লিংক কপি হয়েছে।');
    } else if (shareResult.status === 'fulfilled' && shareTask) {
      toast.info('শেয়ার করা হয়েছে; তবে লিংক কপি করা যায়নি।');
    } else {
      toast.error('লিংক কপি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।');
    }
  };

  const saveName = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) return toast.warning('মেসের নাম কমপক্ষে ২ অক্ষরের হতে হবে।');
    setBusy(true);
    try {
      await updateHostel(name.trim());
      await refreshIdentity();
      toast.success('মেসের নাম সফলভাবে আপডেট হয়েছে।');
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'মেসের নাম আপডেট করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const regen = async () => {
    setCodeBusy(true);
    try {
      const code = await regenerateJoinCode();
      setJoinCode(code);
      await refreshIdentity();
      toast.success('নতুন যুক্ত হওয়ার কোড সফলভাবে তৈরি হয়েছে।');
      setConfirmCode(false);
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'নতুন যুক্ত হওয়ার কোড তৈরি করা যায়নি।')); }
    finally { setCodeBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="মেস সেটিংস পরিবর্তনের জন্য অনলাইন সংযোগ প্রয়োজন।" />;

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="মেস সেটিংস" icon="lock" description="মেসের পরিচয় এবং যুক্ত হওয়ার কোড পরিচালনা করুন।" />
        <InfoPanel icon="link">Join Code ও Invitation Link কেবল নতুন সদস্যের সঙ্গে ব্যক্তিগতভাবে শেয়ার করুন। নতুন কোড বা লিংক তৈরি করলে আগেরটি অকার্যকর হতে পারে।</InfoPanel>
        <form className="card manager-form-card" onSubmit={saveName}>
          <label className="field-label"><span>মেসের নাম</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'মেসের নাম সংরক্ষণ করুন'}</button>
        </form>
        <section className="card manager-form-card">
          <div className="panel-header"><div><span className="eyebrow">যুক্ত হওয়ার কোড</span><h2>মেসে সদস্য যুক্ত করার কোড</h2><p>নতুন সদস্যকে এই কোড দিন। নতুন কোড তৈরি করলে আগের কোডটি আর কাজ করবে না।</p></div></div>
          <div className="join-code-display"><strong>{joinCode || '—'}</strong><button className="secondary-button compact" type="button" onClick={async () => { try { await copyText(joinCode); toast.success('যুক্ত হওয়ার কোড কপি হয়েছে।'); } catch { toast.warning('কপি করা যায়নি।'); } }}>কপি</button></div>
          <button className="secondary-button" type="button" disabled={codeBusy} onClick={() => setConfirmCode(true)}><Icon name="refresh" size={15} /> নতুন যুক্ত হওয়ার কোড তৈরি করুন</button>
        </section>
        <section className="card manager-form-card manager-invite-card" aria-labelledby="manager-invite-title">
          <div className="manager-invite-heading">
            <span className="manager-invite-icon"><Icon name="mail-plus" size={20}/></span>
            <div><span className="eyebrow">সদস্য আমন্ত্রণ</span><h2 id="manager-invite-title">লিংক দিয়ে সদস্য যুক্ত করুন</h2><p>নতুন লিংক তৈরি করলে আগেরটি স্বয়ংক্রিয়ভাবে বাতিল হবে।</p></div>
          </div>
          {!createdInviteUrl ? (
            <button className="primary-button manager-invite-create" type="button" disabled={inviteLinkBusy} onClick={createInviteLink}>
              <Icon name="link" size={17}/>{inviteLinkBusy ? 'লিংক তৈরি হচ্ছে...' : 'আমন্ত্রণ লিংক তৈরি করুন'}
            </button>
          ) : (
            <div className="manager-invite-created" role="status">
              <div className="manager-invite-ready">
                <span className="manager-invite-ready-icon"><Icon name="check" size={17}/></span>
                <div><strong>আমন্ত্রণ লিংক সক্রিয়</strong><small>৭ দিন বৈধ · আগের লিংক বাতিল</small></div>
              </div>
              <button className="primary-button manager-invite-share" type="button" onClick={copyAndShareInvite}>
                <Icon name="copy" size={17}/> কপি ও শেয়ার করুন
              </button>
              <button className="manager-invite-regenerate" type="button" disabled={inviteLinkBusy} onClick={createInviteLink}>
                <Icon name="refresh" size={14}/>{inviteLinkBusy ? 'নতুন লিংক তৈরি হচ্ছে...' : 'নতুন লিংক তৈরি করুন'}
              </button>
            </div>
          )}
          <p className="manager-invite-footnote"><Icon name="shield-check" size={14}/> অ্যাকাউন্ট তৈরি ও ম্যানেজারের অনুমোদনের পর সদস্যপদ চালু হবে।</p>
        </section>
        {confirmCode && <ConfirmModal title="নতুন যুক্ত হওয়ার কোড তৈরি করবেন?" description="নতুন কোড তৈরি করলে আগের যুক্ত হওয়ার কোড দিয়ে আর নতুন সদস্য যুক্ত হতে পারবে না।" confirmLabel="নতুন কোড তৈরি করুন" busy={codeBusy} onClose={() => setConfirmCode(false)} onConfirm={regen} />}
      </div>
    </ManagerGuard>
  );
}

function JoinRequestQueue() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await managerListHostelJoinRequests()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'Join Request-এর তালিকা লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { if (online) load(); }, [online, load]);
  const review = async (row, approve) => {
    const ok = await confirmAction({
      title: approve ? `${row.full_name}–কে মেসে যুক্ত করবেন?` : 'Join Request বাতিল করবেন?',
      message: approve ? 'অনুমোদন দিলে সদস্যটি এই মেসের সক্রিয় সদস্য হবে। অন্য মেসের সক্রিয় সদস্য কি না সার্ভার যাচাই করবে।' : 'বাতিল করলে এই Request দিয়ে ব্যবহারকারী মেসে যুক্ত হতে পারবেন না। তাঁর অ্যাকাউন্ট থাকবে এবং পরে সাধারণ পদ্ধতি ব্যবহার করতে পারবেন।',
      confirmLabel: approve ? 'অনুমোদন করুন' : 'বাতিল করুন', danger: !approve,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await managerReviewHostelJoinRequest(row.id, approve, reviewNote);
      toast.success(approve ? `${row.full_name} এখন মেসের সদস্য।` : `${row.full_name}-এর অনুরোধ বাতিল হয়েছে।`);
      setReviewNote('');
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'Join Request পর্যালোচনা করা যায়নি।')); }
    finally { setBusyId(''); }
  };
  return <section className="card manager-join-request-panel">
    <div className="manager-request-heading">
      <div>
        <span className="eyebrow">MEMBERSHIP APPROVAL</span>
        <h2>অপেক্ষমাণ অনুরোধ</h2>
        <p>যাচাই করে সদস্যপদ অনুমোদন দিন।</p>
      </div>
      <button className="secondary-button compact manager-request-refresh" type="button" disabled={loading || !online} onClick={load}>
        <Icon name="refresh" size={15}/> রিফ্রেশ
      </button>
    </div>
    <div className="manager-request-note-row">
      <label className="field-label"><span>সিদ্ধান্তের নোট <small>(ঐচ্ছিক)</small></span><input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={500} placeholder="প্রয়োজন হলে সংক্ষিপ্ত কারণ লিখুন"/></label>
    </div>
    {loading ? <LoadingSpinner label="অনুরোধ লোড হচ্ছে..."/> : rows.length === 0 ? (
      <div className="manager-request-empty"><span><Icon name="user-check" size={25}/></span><strong>নতুন কোনো অনুরোধ নেই</strong><p>নতুন সদস্যের অনুরোধ এলে এখানে দেখা যাবে।</p></div>
    ) : <div className="manager-join-request-list">
      {rows.map((row) => {
        const displayName = String(row.full_name || 'নতুন সদস্য').trim();
        const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1)).join('').toLocaleUpperCase('bn-BD') || 'HL';
        return <article className="manager-join-request-row" key={row.id}>
          <div className="manager-request-person">
            <span className="manager-request-avatar" aria-hidden="true">{initials}</span>
            <div className="manager-request-person-copy">
              <strong>{displayName}</strong>
              <small><Icon name="clock" size={13}/> {formatDateTime12(row.created_at)}</small>
            </div>
            <span className="manager-request-status">অপেক্ষমাণ</span>
          </div>
          {row.request_note ? <p className="manager-request-message">{row.request_note}</p> : <p className="manager-request-message muted">কোনো অতিরিক্ত বার্তা দেওয়া হয়নি।</p>}
          <div className="manager-join-request-actions">
            <button className="primary-button compact" type="button" disabled={Boolean(busyId)} onClick={() => review(row, true)}>
              {busyId === row.id ? 'প্রক্রিয়াধীন...' : <><Icon name="check" size={15}/> অনুমোদন</>}
            </button>
            <button className="danger-button manager-request-reject" type="button" disabled={Boolean(busyId)} onClick={() => review(row, false)}>
              <Icon name="x" size={15}/> বাতিল
            </button>
          </div>
        </article>;
      })}
    </div>}
  </section>;
}

export function JoinRequestReviewPage() {
  const online = useOnlineStatus();
  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="Join Request পর্যালোচনার জন্য অনলাইন সংযোগ প্রয়োজন।" />;
  return <ManagerGuard><div className="page-stack">
    <PageHeader title="জয়েন রিকোয়েস্ট পর্যালোচনা" icon="user-check" description="নতুন সদস্যের অনুরোধ পর্যালোচনা করুন।" eyebrow="ম্যানেজার ফিচার" />
    <InfoPanel icon="user-check">সদস্যের পরিচয় ও বার্তা যাচাই করে অনুমোদন বা প্রত্যাখ্যান করুন। অনুমোদনের আগে মেসের সদস্য তালিকা ও বর্তমান সদস্যসংখ্যা বিবেচনা করুন।</InfoPanel>
    <JoinRequestQueue />
  </div></ManagerGuard>;
}

export function MemberManagementPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  const { membership } = useAuth();
  const { context } = useManagementContext();

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const deactivationImpact = getMemberDeactivationImpact(clockNow, context?.period?.start_date);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMembers(await fetchManagerMemberDirectory()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { if (online) load(); }, [online, load]);

  const runAction = async () => {
    if (!action) return;
    try {
      if (action.type === 'deactivate') {
        const result = await deactivateMember(action.member.membership_id);
        const impactText = result?.today_meal_rule === 'cancel'
          ? 'আজকের খোলা মিল ও ভবিষ্যতের মিল রেকর্ড/অনুরোধ বাতিল হয়েছে।'
          : result?.today_meal_rule === 'preserve'
            ? 'আজকের চূড়ান্ত মিল অক্ষত আছে; ভবিষ্যতের মিল রেকর্ড/অনুরোধ বাতিল হয়েছে।'
            : result?.today_meal_rule === 'not_in_period'
              ? 'বর্তমান মাসের প্রথম দিন এখনো আসেনি; ভবিষ্যতের মিল রেকর্ড/অনুরোধ বাতিল হয়েছে।'
              : 'সদস্য নিষ্ক্রিয় হয়েছে; পুরোনো হিসাব অক্ষত আছে।';
        const cancelledRequests = Number(result?.cancelled_request_count ?? 0);
        const cancelledRecords = Number(result?.cancelled_meal_record_count ?? 0);
        toast.success(`${action.member.member_name} এখন নিষ্ক্রিয় সদস্য। ${impactText} মোট ${cancelledRequests}টি অনুরোধ ও ${cancelledRecords}টি মিল রেকর্ড বাতিল হয়েছে।`);
      } else {
        await reactivateMember(action.member.membership_id);
        toast.success(`${action.member.member_name} আবার সক্রিয় হয়েছে।`);
      }
      setAction(null);
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'সদস্যের status পরিবর্তন করা যায়নি।')); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="সদস্য ব্যবস্থাপনার জন্য অনলাইন সংযোগ প্রয়োজন।" />;

  return (
    <>
      <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="সদস্য ব্যবস্থাপনা" icon="users" description="মেস ছেড়ে যাওয়া সদস্যকে নিষ্ক্রিয় করুন; প্রয়োজন হলে পরে আবার সক্রিয় করুন।" />
        <InfoPanel icon="users">সদস্য নিষ্ক্রিয় করার আগে তাঁর চলমান মিল ও অনুরোধের প্রভাব যাচাই করুন। পুরোনো হিসাব ও আর্কাইভের ইতিহাস অক্ষত থাকবে।</InfoPanel>
        {loading ? <LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..." /> : <div className="manager-member-list">
          {members.map((member) => {
            const isSelf = member.membership_id === membership?.membership_id;
            const inactive = member.member_status === 'inactive';
            return (
              <article className={`card manager-member-row ${inactive ? 'manager-member-inactive' : ''}`} key={member.membership_id}>
                <div className="manager-member-main"><span className="avatar">{member.member_name?.split(/\s+/).slice(0,2).map((x) => x[0]).join('').toUpperCase()}</span><div><strong>{member.member_name}</strong><div className="member-badge-row"><span className={`member-badge ${inactive ? 'inactive' : 'active'}`}>{inactive ? 'নিষ্ক্রিয়' : 'সক্রিয় সদস্য'}</span>{Boolean(member.is_primary_manager ?? (member.role === 'manager')) && <span className="member-badge manager">ম্যানেজার</span>}{member.is_assistant_manager && <span className="member-badge assistant">সহকারী ম্যানেজার</span>}</div><small>{member.meal_activity || 'এই মাসে মিল নেই'}</small></div></div>
                <div className="manager-member-actions">{inactive ? <button className="secondary-button compact" type="button" onClick={() => setAction({ type: 'reactivate', member })}>আবার সক্রিয়</button> : <button className="secondary-button compact danger-outline" type="button" disabled={isSelf || Boolean(member.is_primary_manager ?? member.role === 'manager')} onClick={() => { setClockNow(new Date()); setAction({ type: 'deactivate', member }); }}>{isSelf ? 'নিজেকে নয়' : Boolean(member.is_primary_manager ?? (member.role === 'manager')) ? 'আগে Manager Change' : 'নিষ্ক্রিয় করুন'}</button>}</div>
              </article>
            );
          })}
        </div>}
        {action && <ConfirmModal
          danger={action.type === 'deactivate'}
          title={action.type === 'deactivate' ? 'সদস্য নিষ্ক্রিয় করবেন?' : 'সদস্য আবার সক্রিয় করবেন?'}
          description={action.type === 'deactivate'
            ? `${action.member.member_name}-কে নিষ্ক্রিয় করলে তাঁর নতুন অনুরোধ বন্ধ হবে। ${deactivationImpact.rule === 'cancel'
              ? 'এখন বাংলাদেশ সময় রাত ৯টার আগে: আজকের খোলা মিলের রেকর্ড (থাকলে), আজকের অপেক্ষমাণ লেট/সংশোধন অনুরোধ এবং পরবর্তী সব দিনের তাঁর সক্রিয় অনুরোধ/মিল রেকর্ড বাতিল হবে। আগের দিনের চূড়ান্ত হিসাব অক্ষত থাকবে।'
              : deactivationImpact.rule === 'preserve'
                ? 'এখন বাংলাদেশ সময় রাত ৯টা বা পরে: আজকের চূড়ান্ত মিল অক্ষত থাকবে। আজকের অপেক্ষমাণ লেট/সংশোধন অনুরোধ এবং আগামী দিনের তাঁর সক্রিয় অনুরোধ/মিল রেকর্ড বাতিল হবে; আগের হিসাবও অক্ষত থাকবে।'
                : deactivationImpact.rule === 'not_in_period'
                  ? 'নতুন মাসের প্রথম মিলের দিন এখনো আসেনি। ওই মাসের ভবিষ্যৎ অনুরোধ ও রেকর্ড (থাকলে) বাতিল হবে; পূর্ববর্তী মাসের ইতিহাস অক্ষত থাকবে।'
                  : 'এই মুহূর্তে কোনো চলমান মাস নেই। পুরোনো হিসাব অক্ষত থাকবে।'}`
            : `${action.member.member_name} আবার সক্রিয় সদস্য হিসেবে নতুন মিল অনুরোধ ও অনুমোদিত কাজ করতে পারবে।`}
          confirmLabel={action.type === 'deactivate' ? 'হ্যাঁ, সদস্য নিষ্ক্রিয় করুন' : 'আবার সক্রিয় করুন'}
          onClose={() => setAction(null)}
          onConfirm={runAction}
        />}
      </div>
      </PrimaryManagerGuard>
    </>
  );
}


export function KhalaMoneyPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { context, isPrimaryManager, isOperationalManager, hasClosedMonthAccess } = useManagementContext();
  const [periods, setPeriods] = useState([]);
  const [rows, setRows] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState({ amount: '', memberId: '', paymentDate: toDateInputValue(), description: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [editingTarget, setEditingTarget] = useState(null);
  const [eligibleMembers, setEligibleMembers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const periodRows = await fetchKhalaPeriods();
      const historyByPeriod = await Promise.all(periodRows.map((period) => fetchKhalaMoneyHistory({ periodId: period.period_id, limit: 300 })));
      const khalaRows = historyByPeriod.flat().sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPeriods(periodRows);
      const currentPeriod = context?.period?.period_id;
      // Keep the user's selected historical period when refreshing after an edit.
      // Fall back to the running period (or first available period) only when it disappeared.
      setPeriodId((previous) => periodRows.some((p) => p.period_id === previous)
        ? previous
        : ((currentPeriod && periodRows.some((p) => p.period_id === currentPeriod))
          ? currentPeriod
          : (periodRows[0]?.period_id || '')));
      setRows(khalaRows);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [context?.period?.period_id, toast]);

  useEffect(() => { if (online && (isOperationalManager || hasClosedMonthAccess)) load(); }, [online, isOperationalManager, hasClosedMonthAccess, load]);

  const selectedPeriod = periods.find((p) => p.period_id === periodId) || null;
  const periodStartNotice = getPeriodStartNotice(selectedPeriod, 'খালার টাকার এন্ট্রি');
  const visibleRows = selectedPeriod ? rows.filter((row) => row.period_id === selectedPeriod.period_id) : rows;
  const total = visibleRows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  useEffect(() => {
    let active = true;
    if (!online || !selectedPeriod?.period_id) { setEligibleMembers([]); return undefined; }
    fetchKhalaEntryMembers(selectedPeriod.period_id)
      .then((members) => { if (active) setEligibleMembers(Array.isArray(members) ? members : []); })
      .catch((error) => { if (active) { setEligibleMembers([]); toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।')); } });
    return () => { active = false; };
  }, [online, selectedPeriod?.period_id, toast]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setForm((current) => ({
      ...current,
      paymentDate: periodStartNotice ? String(selectedPeriod.start_date).slice(0, 10) : (current.paymentDate || toDateInputValue()),
    }));
  }, [selectedPeriod?.period_id, selectedPeriod?.start_date, periodStartNotice]);

  const save = async (event) => {
    event.preventDefault();
    if (!periodId) return toast.warning('কাজের মাস নির্বাচন করুন।');
    if (periodStartNotice) return toast.info(periodStartNotice);
    if (!form.memberId) return toast.warning('সংশ্লিষ্ট সদস্য নির্বাচন করুন।');
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.warning('টাকার পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!form.paymentDate) return toast.warning('প্রদানের তারিখ নির্বাচন করুন।');
    if (form.paymentDate > toDateInputValue()) return toast.warning('প্রদানের তারিখ ভবিষ্যতের হতে পারবে না।');
    if (selectedPeriod?.start_date && form.paymentDate < selectedPeriod.start_date) return toast.warning('প্রদানের তারিখ নির্বাচিত মাসের শুরুর আগের হতে পারবে না।');
    if (selectedPeriod?.end_date && form.paymentDate > selectedPeriod.end_date) return toast.warning('প্রদানের তারিখ নির্বাচিত মাসের শেষের পরের হতে পারবে না।');
    setBusy(true);
    try {
      const payload = { periodId, memberId: form.memberId, amount, paymentDate: form.paymentDate, description: form.description.trim() || null };
      if (editingTarget?.entry_id) {
        await updateKhalaMoney({ ...payload, entryId: editingTarget.entry_id });
        toast.success('খালার টাকার এন্ট্রি সংশোধন হয়েছে।');
      } else {
        await addKhalaMoney(payload);
        toast.success('খালার টাকার এন্ট্রি আলাদা হিসাব হিসেবে সংরক্ষণ হয়েছে।');
      }
      setEditingTarget(null);
      setForm((current) => ({ ...current, amount: '', description: '' }));
      await load();
    } catch (error) { toast.error(getPeriodAwareError(error, editingTarget ? 'খালার টাকার এন্ট্রি সংশোধন করা যায়নি।' : 'খালার টাকার এন্ট্রি যোগ করা যায়নি।', selectedPeriod, 'খালার টাকার এন্ট্রি')); }
    finally { setBusy(false); }
  };

  const startEdit = (row) => {
    if (!row || row.status === 'void') return;
    setEditingTarget(row);
    setForm({
      amount: String(row.amount ?? ''),
      memberId: row.member_id || '',
      paymentDate: String(row.payment_date || row.entry_date || '').slice(0, 10),
      description: row.description || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingTarget(null);
    setForm({ amount: '', memberId: '', paymentDate: toDateInputValue(), description: '' });
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) return toast.warning('বাতিলের কারণ লিখুন।');
    setBusy(true);
    try {
      await voidKhalaMoney(voidTarget.entry_id, voidReason.trim());
      toast.success('খালার টাকার এন্ট্রি বাতিল হয়েছে।');
      setVoidTarget(null); setVoidReason(''); await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'এন্ট্রিটি বাতিল করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="খালার টাকার তথ্য অনলাইনে দেখা ও যোগ করা যাবে।" />;
  if (!isOperationalManager && !hasClosedMonthAccess) return <AccessNotice title="অনুমতি নেই" text="খালার টাকার এই অংশটি শুধু অনুমোদিত মাসের দায়িত্বপ্রাপ্ত ম্যানেজার দেখতে পারবেন।" />;
  if (loading) return <LoadingSpinner label="খালার টাকার তথ্য লোড হচ্ছে..." />;

  return (
    <div className="page-stack">
        <PageHeader title="খালার টাকা" icon="wallet" description={isOperationalManager ? 'প্রতিটি এন্ট্রি সংশ্লিষ্ট কাজের মাসের সঙ্গে সংযুক্ত থাকবে।' : 'আপনি যে মাসটি বন্ধ করেছিলেন, শুধু সেই মাসের খালার টাকার তথ্য দেখতে ও সংশোধন করতে পারবেন।'} />
        <InfoPanel icon="wallet">প্রতিটি খালার টাকার এন্ট্রি নির্দিষ্ট কাজের মাস ও সদস্যের সঙ্গে যুক্ত থাকে। সংরক্ষণের আগে মাস, সদস্য, প্রদানের তারিখ ও পরিমাণ মিলিয়ে নিন।</InfoPanel>
        {periods.length === 0 ? (
          <div className="empty-state-card"><Icon name="wallet" size={26} /><strong>এখনো কোনো কাজের মাস পাওয়া যায়নি</strong><span>বর্তমান বা নির্ধারিত পুরোনো মাস থাকলে এখানে দেখা যাবে।</span></div>
        ) : (
          <>
            <form className="card manager-form-card khala-entry-form" onSubmit={save}>
              {periodStartNotice && <div className="form-hint period-start-notice"><Icon name="info" size={15} /> {periodStartNotice}</div>}
              <div className="form-grid-2">
                <label className="field-label"><span>কাজের মাস</span><select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((period) => <option key={period.period_id} value={period.period_id}>{period.label}{period.status !== 'running' ? ` · ${period.manager_at_close_name || 'বন্ধ মাস'}` : ' · চলমান'}</option>)}</select></label>
                <label className="field-label"><span>প্রদানের তারিখ</span><input type="date" max={toDateInputValue()} min={selectedPeriod?.start_date || undefined} value={form.paymentDate} onChange={(e) => setForm((current) => ({ ...current, paymentDate: e.target.value }))} disabled={Boolean(periodStartNotice)} required /></label>
              </div>
              <label className="field-label"><span>যে সদস্যের নামে খালার পারিশ্রমিকটি নথিভুক্ত হবে</span>
                <select value={form.memberId} required onChange={(e) => setForm((current) => ({ ...current, memberId: e.target.value }))}>
                  <option value="">সদস্য নির্বাচন করুন</option>
                  {eligibleMembers.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name || member.full_name || 'সদস্য'}</option>)}
                </select>
                {!eligibleMembers.length && <small>সদস্য তালিকা পাওয়া যায়নি। তালিকা লোড না হওয়া পর্যন্ত এন্ট্রি করা যাবে না।</small>}
              </label>
              {selectedPeriod && <div className="form-hint"><Icon name="info" size={15} /> এই খরচটি খালার আলাদা হিসাব হবে; কোনো সদস্যের ব্যক্তিগত ব্যালেন্স বা অন্যান্য খরচে যোগ হবে না।</div>}
              <div className="form-grid-2">
                <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))} placeholder="০" required /></label>
                <label className="field-label"><span>বিবরণ <em>(ঐচ্ছিক)</em></span><input value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} placeholder="যেমন: মাসিক পারিশ্রমিক" /></label>
              </div>
              <div className="form-actions-inline"><button className="primary-button large" type="submit" disabled={busy || Boolean(periodStartNotice) || !eligibleMembers.length}>{busy ? 'সংরক্ষণ হচ্ছে...' : editingTarget ? 'পরিবর্তন সংরক্ষণ করুন' : 'খালার টাকা যোগ করুন'}</button>{editingTarget && <button className="secondary-button" type="button" disabled={busy} onClick={cancelEdit}>সম্পাদনা বাতিল</button>}</div>
            </form>

            <section className="card manager-form-card">
              <div className="section-heading"><div><span className="eyebrow">নির্বাচিত কাজের মাস</span><h2>{selectedPeriod?.label || '—'}</h2></div><div className="khala-total-heading"><small>মোট কার্যকর পারিশ্রমিক</small><strong>{formatCurrency(total)}</strong></div></div>
              <div className="manager-list-stack">
                {visibleRows.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="wallet" size={24} /><strong>কোনো এন্ট্রি নেই</strong><span>এই কাজের মাসে এখনো খালার টাকার কোনো এন্ট্রি দেওয়া হয়নি।</span></div> : visibleRows.map((row) => (
                  <article className={`card manager-ledger-row ${row.status === 'void' ? 'void-row' : ''}`} key={row.entry_id}>
                    <div className="khala-ledger-copy">
                      <div className="khala-ledger-recipient"><span>সদস্যের নাম</span><strong>{row.recipient_name || (row.member_name && row.member_name !== 'খালার পারিশ্রমিক' ? row.member_name : 'সদস্যের নাম পাওয়া যায়নি')}</strong></div>
                      <span className="khala-entry-kind">খালার পারিশ্রমিক</span>
                      <small>{formatDateWithWeekday(row.entry_date)} · {formatDateTime12(row.created_at)}</small>
                      <span className="khala-ledger-description">{row.description || 'খালার টাকা'}</span>
                      <small className="khala-entry-actor">এন্ট্রি করেছেন: {row.created_by_name || row.creator_name || 'নাম পাওয়া যায়নি'}</small>
                      {row.updated_by_name && <small className="khala-entry-actor">শেষ সম্পাদনা: {row.updated_by_name}{row.updated_at ? ` · ${formatDateTime12(row.updated_at)}` : ''}</small>}
                    </div>
                    <strong>{formatCurrency(row.amount)}</strong>
                    {row.status !== 'void' ? <div className="khala-row-actions"><button className="icon-button compact-icon" type="button" disabled={busy} onClick={() => startEdit(row)} aria-label="এন্ট্রি সম্পাদনা করুন" title="সম্পাদনা"><Icon name="edit" size={15} /></button><button className="icon-button compact-icon danger-icon" type="button" disabled={busy} onClick={() => { setVoidTarget(row); setVoidReason(''); }} aria-label="এন্ট্রি বাতিল করুন"><Icon name="trash" size={15} /></button></div> : <span className="member-badge inactive">বাতিল</span>}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        {voidTarget && <ConfirmModal danger title="এই এন্ট্রি বাতিল করবেন?" description={`${formatCurrency(voidTarget.amount)} খালার পারিশ্রমিক কার্যকর হিসাব থেকে বাদ যাবে। ইতিহাসে বাতিলের রেকর্ড থাকবে।`} confirmLabel="এন্ট্রি বাতিল করুন" busy={busy} onClose={() => { setVoidTarget(null); setVoidReason(''); }} onConfirm={doVoid}><label className="field-label"><span>বাতিলের কারণ</span><textarea rows="3" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="ভুল এন্ট্রি" /></label></ConfirmModal>}
      </div>
  );
}

export function ArchiveManagerPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [months, setMonths] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permLoading, setPermLoading] = useState(false);
  const [grantForm, setGrantForm] = useState({ expiresAt: '', reason: '' });
  const [busy, setBusy] = useState(false);

  const loadMonths = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchArchiveManagementItems(), fetchManagerMemberDirectory(),
      ]);
      if (results[0].status === 'rejected') throw results[0].reason;
      const managementRows = results[0].value;
      const safeRows = Array.isArray(managementRows) ? managementRows : [];
      setMonths(safeRows);
      if (results[1].status === 'fulfilled') {
        setMembers(Array.isArray(results[1].value) ? results[1].value : []);
      }
      setSelectedPeriod(current => safeRows.some(row => String(row.period_id) === String(current))
        ? current : String(safeRows[0]?.period_id || ''));
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'আর্কাইভের তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [toast]);

  const loadPermissions = useCallback(async () => {
    if (!selectedPeriod) { setPermissions([]); return; }
    setPermLoading(true);
    try { setPermissions(await fetchArchivePermissions(selectedPeriod)); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'আর্কাইভ অনুমতি লোড করা যায়নি।')); }
    finally { setPermLoading(false); }
  }, [selectedPeriod, toast]);

  useEffect(() => { if (online) loadMonths(); }, [online, loadMonths]);
  useEffect(() => { if (online) loadPermissions(); }, [online, loadPermissions]);

  const selected = months.find((month) => month.period_id === selectedPeriod) || null;
  const closer = selected ? members.find((member) => member.membership_id === selected.manager_at_close_membership_id) : null;
  const memberMap = new Map(members.map((member) => [member.membership_id, member.member_name]));
  const activePermissions = permissions.filter((permission) => !permission.revoked_at && (!permission.expires_at || new Date(permission.expires_at) > new Date()));

  const grant = async (event) => {
    event.preventDefault();
    if (!selected) return toast.warning('একটি আর্কাইভ করা মাস নির্বাচন করুন।');
    if (!selected.can_grant_closer_edit || !selected.manager_at_close_membership_id) return toast.warning('এই মাসের closing manager-কে নতুন অনুমতি দেওয়ার অবস্থা নেই।');
    if (!grantForm.expiresAt) return toast.warning('অনুমতির মেয়াদ শেষ হওয়ার সময় দিন।');
    const expiresAt = new Date(grantForm.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) return toast.warning('ভবিষ্যতের একটি বৈধ মেয়াদ দিন।');
    setBusy(true);
    try {
      await grantArchiveEditPermission({
        periodId: selected.period_id,
        membershipId: selected.manager_at_close_membership_id,
        expiresAt: expiresAt.toISOString(),
        reason: grantForm.reason.trim() || null,
      });
      toast.success(`${selected.manager_at_close_name || 'আগের ম্যানেজার'}-কে এই আর্কাইভ সম্পাদনার অনুমতি দেওয়া হয়েছে।`);
      setGrantForm({ expiresAt: '', reason: '' });
      await Promise.all([loadMonths(), loadPermissions()]);
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'আর্কাইভ সম্পাদনার অনুমতি দেওয়া যায়নি।')); }
    finally { setBusy(false); }
  };

  const revoke = async (permissionId) => {
    setBusy(true);
    try { await revokeArchiveEditPermission(permissionId); toast.success('আর্কাইভ সম্পাদনার অনুমতি বাতিল হয়েছে।'); await loadPermissions(); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'Permission বাতিল করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!selected?.can_reopen) return;
    const ok = await confirmAction(`“${selected.label}” আবার চালু করা হবে। মাস বন্ধ করার সময় বাতিল হওয়া ভবিষ্যতের request স্বয়ংক্রিয়ভাবে ফেরত আসবে না। আপনি কি নিশ্চিত?`);
    if (!ok) return;
    setBusy(true);
    try {
      const result = await reopenArchivedPeriod(selected.period_id);
      toast.success(`${result?.label || selected.label} আবার চালু হয়েছে। বাতিল হওয়া future request প্রয়োজন হলে পুনরায় জমা দিতে হবে।`);
      await loadMonths();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'মাস পুনরায় চালু করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="আর্কাইভ ব্যবস্থাপনা অনলাইনেই পরিচালিত হয়।" />;
  if (loading) return <LoadingSpinner label="Archive management প্রস্তুত হচ্ছে..." />;

  return <PrimaryManagerGuard><div className="page-stack">
    <PageHeader title="আর্কাইভ" icon="history" description="প্রতিটি আর্কাইভের closing manager, temporary edit access ও নিরাপদ accidental-close recovery এখানে পরিচালনা করুন।" />
    <InfoPanel icon="archive">প্রতিটি মাসের Closing Manager ও সংশোধনের অনুমতি আলাদাভাবে যাচাই করুন। Reopen করলে ভবিষ্যতের বাতিল হওয়া অনুরোধ নিজে থেকে ফিরবে না; প্রয়োজন হলে নতুন করে যাচাই করুন।</InfoPanel>
    <div className="archive-refresh-row"><button type="button" className="secondary-button compact" disabled={loading} onClick={loadMonths}>আর্কাইভ রিফ্রেশ</button></div>
    {months.length === 0 ? <div className="empty-state-card"><Icon name="history" size={28} /><strong>সংরক্ষিত মাস পাওয়া যায়নি</strong><span>হিস্টরিতে বন্ধ মাস থাকলে রিফ্রেশ করে দেখুন।</span><button type="button" className="secondary-button compact" onClick={loadMonths}>আবার লোড করুন</button></div> : <>
      <section className="card manager-form-card">
        <label className="field-label"><span>আর্কাইভ করা মাস</span><select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>{months.map((month) => <option value={month.period_id} key={month.period_id}>{month.label} — {formatDateBangla(month.start_date)} → {formatDateBangla(month.end_date)}</option>)}</select></label>
        {selected && <div className="archive-manager-detail-grid">
          <div><span>মাস বন্ধ করেছেন</span><strong>{selected.manager_at_close_name || 'রেকর্ড নেই'}</strong></div>
          <div><span>অবস্থা</span><strong>{selected.closer_is_active ? 'Closing manager সক্রিয়' : 'Closing manager বর্তমানে inactive'}</strong></div>
          <div><span>শেষ পরিবর্তন</span><strong>{selected.last_edit_by ? `${selected.last_edit_by} · ${selected.last_edit_at ? formatDateTime12(selected.last_edit_at) : ''}` : 'এখনো কোনো edit audit নেই'}</strong><small>{selected.last_edit_summary || ''}</small></div>
        </div>}
        {selected?.archive_read_only && <div className="state-card state-card-warning"><Icon name="info" size={17}/><div><strong>এই মাসটি শুধু দেখার জন্য পাওয়া গেছে</strong><p>ব্যবস্থাপনার অনুমতি সার্ভার থেকে পাওয়া যায়নি। নিরাপত্তার জন্য Reopen ও Edit Permission বন্ধ রাখা হয়েছে।</p></div></div>}
        {selected?.can_reopen && <div className="archive-reopen-warning"><Icon name="alert-circle" size={18}/><div><strong>ভুলবশত বন্ধ হয়ে থাকলে মাস আবার চালু করতে পারবেন</strong><p>শুধু একই calendar month-এ, নতুন period তৈরি না হলে এবং কোনো running period না থাকলে এটি সম্ভব। আগেই বাতিল হওয়া future request স্বয়ংক্রিয়ভাবে ফিরবে না।</p><button className="secondary-button compact" type="button" disabled={busy} onClick={reopen}>মাস আবার চালু করুন</button></div></div>}
      </section>

      <section className="card manager-form-card">
        <div className="panel-header"><div><span className="eyebrow">Closing-manager-only</span><h2>আগের মাসের ম্যানেজারকে সম্পাদনার অনুমতি দিন</h2><p>অন্য কোনো সদস্যকে এই permission দেওয়া যাবে না। অনুমতি শুধু নির্বাচিত archive-এ এবং নির্ধারিত সময় পর্যন্ত থাকবে।</p></div></div>
        {!selected?.manager_at_close_membership_id ? <div className="inline-error">এই archive-এর closing manager রেকর্ড নেই; নিরাপত্তার জন্য edit permission দেওয়া বন্ধ রাখা হয়েছে।</div>
          : selected.current_manager_is_closer ? <div className="inline-success"><Icon name="check-circle" size={17}/> আপনি নিজেই এই মাস বন্ধ করেছিলেন। আলাদা permission ছাড়াই আপনার archive-edit access থাকবে।</div>
          : !selected.can_grant_closer_edit ? <div className="state-card state-card-warning"><Icon name="shield" size={18}/><div><strong>এখন permission দেওয়া যাচ্ছে না</strong><p>Closing manager-কে active থাকতে হবে এবং বর্তমান account-এ প্রধান ম্যানেজারের অনুমতি থাকতে হবে।</p></div></div>
          : <form onSubmit={grant}>
            <div className="archive-closer-target"><Icon name="user-check" size={18}/><div><strong>{selected.manager_at_close_name || closer?.member_name || 'আগের মাসের ম্যানেজার'}</strong><small>শুধু এই সদস্যের কাছেই অনুমতি যাবে</small></div></div>
            <div className="form-grid-2"><label className="field-label"><span>অনুমতি শেষ হবে <em>(বাধ্যতামূলক)</em></span><input type="datetime-local" required value={grantForm.expiresAt} onChange={(event) => setGrantForm((form) => ({ ...form, expiresAt: event.target.value }))}/></label><label className="field-label"><span>কারণ</span><input value={grantForm.reason} onChange={(event) => setGrantForm((form) => ({ ...form, reason: event.target.value }))} placeholder="যেমন: আগের মাসের বাজারের ভুল সংশোধন"/></label></div>
            <button className="primary-button" type="submit" disabled={busy}>মাস বন্ধ করা ম্যানেজারকে অনুমতি দিন</button>
          </form>}
      </section>
      <section className="card manager-form-card">
        <div className="section-heading"><div><h2>এই সংরক্ষিত মাসের অনুমতির ইতিহাস</h2><small>{formatNumber(activePermissions.length)}টি কার্যকর সাময়িক অনুমতি</small></div><button className="secondary-button compact" type="button" onClick={loadPermissions} disabled={permLoading}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
        {activePermissions.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="shield" size={24}/><strong>কোনো active সাময়িক অনুমতি নেই</strong><span>যিনি নিজে মাস বন্ধ করেছেন, তাঁর নিজের প্রবেশাধিকারের জন্য আলাদা অনুমতি দরকার নেই।</span></div> : <div className="permission-list">{activePermissions.map((permission) => <article className="permission-row" key={permission.id}><div><strong>{memberMap.get(permission.membership_id) || (permission.membership_id === selected?.manager_at_close_membership_id ? selected.manager_at_close_name : 'Closing manager')}</strong><small>দেওয়া হয়েছে: {formatDateTime12(permission.created_at)}</small><span>মেয়াদ: {permission.expires_at ? formatDateTime12(permission.expires_at) : 'মেয়াদ নেই'}</span>{permission.reason && <span>কারণ: {permission.reason}</span>}</div><button className="secondary-button compact danger-outline" type="button" disabled={busy} onClick={() => revoke(permission.id)}>বাতিল করুন</button></article>)}</div>}
      </section>
    </>}
  </div></PrimaryManagerGuard>;
}

function Table({ columns, rows }) {
  return <div className="report-table-wrap"><table className="report-table"><thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.key || index}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}</tr>) : <tr><td colSpan={columns.length}><div className="table-empty">কোনো তথ্য পাওয়া যায়নি</div></td></tr>}</tbody></table></div>;
}

export function MealSheetPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printBusy, setPrintBusy] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setBundle(await fetchCurrentReportBundle()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'মিল শিট লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="মিল শিট দেখতে ইন্টারনেট চালু করুন" text="রিপোর্ট অফলাইনে রাখা হয় না।" />;
  if (loading) return <LoadingSpinner label="মিল শিট তৈরি হচ্ছে..." />;
  if (!bundle) return <FeatureStateNotice title="কোনো চলমান মাস নেই" text="মিল শিট তৈরি করতে একটি চলমান মাস থাকতে হবে।" icon="calendar" />;

  const finalizedDays = bundle.days.filter((day) => day.status === 'finalized');
  const dailyTotals = finalizedDays.map((day) => {
    const rows = bundle.mealRows.filter((r) => r.date === day.meal_date);
    return { key: day.meal_date, date: day.meal_date, status: day.status, breakfast: rows.reduce((s, r) => s + Number(r.breakfast || 0), 0), lunch: rows.reduce((s, r) => s + Number(r.lunch || 0), 0), dinner: rows.reduce((s, r) => s + Number(r.dinner || 0), 0) };
  });

  const memberTotals = bundle.members.map((member) => {
    const rows = bundle.mealRows.filter((r) => r.memberId === member.membership_id);
    return { key: member.membership_id, name: member.member_name, breakfast: rows.reduce((s,r)=>s+Number(r.breakfast||0),0), lunch: rows.reduce((s,r)=>s+Number(r.lunch||0),0), dinner: rows.reduce((s,r)=>s+Number(r.dinner||0),0) };
  }).filter((r) => r.breakfast + r.lunch + r.dinner > 0);

  const selectedMember = selectedMemberId ? bundle.members.find((member) => member.membership_id === selectedMemberId) : null;
  const filteredMealRows = selectedMemberId ? bundle.mealRows.filter((row) => row.memberId === selectedMemberId) : bundle.mealRows;
  const filteredDays = finalizedDays.filter((day) => filteredMealRows.some((row) => row.date === day.meal_date));
  const filteredDailyTotals = filteredDays.map((day) => {
    const rows = filteredMealRows.filter((r) => r.date === day.meal_date);
    return { key: day.meal_date, date: day.meal_date, status: day.status, breakfast: rows.reduce((s, r) => s + Number(r.breakfast || 0), 0), lunch: rows.reduce((s, r) => s + Number(r.lunch || 0), 0), dinner: rows.reduce((s, r) => s + Number(r.dinner || 0), 0) };
  });

  const print = () => {
    setPrintBusy(true);
    try {
      const rows = filteredDailyTotals.map((r) => `<tr><td>${escapeReportHtml(formatDateWithWeekday(r.date))}</td><td>${reportStatusLabel(r.status)}</td><td>${r.breakfast}</td><td>${r.lunch}</td><td>${r.dinner}</td><td>${r.breakfast+r.lunch+r.dinner}</td></tr>`).join('');
      // All-members export uses one column per actual period day, not one row per day.
      // Never infer dates from the calendar month: mess periods can cross month boundaries.
      const allDays = finalizedDays.slice().sort((a, b) => String(a.meal_date).localeCompare(String(b.meal_date)));
      const recordLookup = new Map(bundle.mealRows.map((row) => [`${row.memberId}:${row.date}`, row]));
      const compact = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
      const matrixHead = `<tr><th>সদস্য</th>${allDays.map((day) => `<th title="${escapeReportHtml(day.meal_date)}">${escapeReportHtml(String(Number(day.meal_date.slice(-2))))}</th>`).join('')}</tr>`;
      const matrixBody = bundle.members.map((member) => `<tr><td>${escapeReportHtml(member.member_name || 'সদস্য')}</td>${allDays.map((day) => {
        const meal = recordLookup.get(`${member.membership_id}:${day.meal_date}`);
        return `<td>${meal ? `${compact(meal.breakfast)}+${compact(meal.lunch)}+${compact(meal.dinner)}` : '—'}</td>`;
      }).join('')}</tr>`).join('');
      const matrix = `<p class="report-note">প্রতি ঘরে: সকাল + দুপুর + রাত · তারিখের পূর্ণ মাস উপরের শিরোনামে রয়েছে।</p><table class="meal-matrix"><thead>${matrixHead}</thead><tbody>${matrixBody}</tbody></table>`;
      const memberTotal = selectedMember ? memberTotals.find((row) => row.key === selectedMemberId) : null;
      const memberSummary = memberTotal ? `<p><strong>${escapeReportHtml(memberTotal.name)}</strong> — সকালের মিল ${memberTotal.breakfast}, দুপুরের মিল ${memberTotal.lunch}, রাতের মিল ${memberTotal.dinner}, মোট ${memberTotal.breakfast + memberTotal.lunch + memberTotal.dinner}</p>` : '<p>সব সদস্য</p>' ;
      const reportManager = (bundle.members || []).find((member) => member.is_primary_manager || member.role === 'manager');
      const personalTable = `<table><thead><tr><th>তারিখ</th><th>অবস্থা</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${rows}</tbody></table>`;
      printReport(`মিল শিট — ${bundle.period.label}${selectedMember ? ` — ${selectedMember.member_name}` : ''}`, currentPeriodRange(bundle.period), selectedMember ? `${memberSummary}${personalTable}` : matrix, null, { periodLabel: bundle.period.label, managerName: reportManager?.member_name || '', managerPhone: reportManager?.phone || '', pageOrientation: selectedMember ? 'portrait' : 'landscape' });
    } catch (error) { toast.error(error.message || 'রিপোর্ট প্রিন্ট করা যায়নি।'); }
    finally { setPrintBusy(false); }
  };

  return (
    <div className="page-stack"><PageHeader title="মিল শিট" icon="history" eyebrow="মিলের বিস্তারিত" description={`${bundle.period.label} — শুধু ফাইনাল হওয়া দিনের দৈনিক মিলের সারসংক্ষেপ এবং সদস্যভিত্তিক মোট হিসাব। অপেক্ষমাণ অনুরোধ চূড়ান্ত মিল হিসেবে গণনা হয় না।`} />
      <InfoPanel icon="book-open">মিল শিটে শুধু ফাইনাল হওয়া দিনের তথ্য দেখানো হয়। সদস্য নির্বাচন করে ব্যক্তিগত হিসাব দেখুন; PDF সংরক্ষণের আগে তারিখ ও মোট মিল মিলিয়ে নিন।</InfoPanel>
      <section className="card report-toolbar"><div><strong>{bundle.period.label}</strong><small>{currentPeriodRange(bundle.period)}</small></div><div className="report-actions"><label className="field-label report-member-filter"><span>সদস্য</span><select value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}><option value="">সবাই</option>{bundle.members.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select></label><button className="secondary-button compact report-pdf-button" type="button" disabled={printBusy} onClick={print}><Icon name="file-text" size={15} /> পিডিএফ সংরক্ষণ</button></div></section>
      <section className="card report-section-card"><div className="section-heading"><h2>দৈনিক মিল{selectedMember ? ` — ${selectedMember.member_name}` : ''}</h2><span>{formatNumber(filteredDailyTotals.length)} দিন</span></div><Table columns={[{key:'date',label:'তারিখ',render:(r)=>formatDateWithWeekday(r.date)},{key:'status',label:'অবস্থা',render:(r)=>reportStatusLabel(r.status)},{key:'breakfast',label:'সকালের মিল',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'দুপুরের মিল',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'রাতের মিল',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(Number(r.breakfast)+Number(r.lunch)+Number(r.dinner))}]} rows={filteredDailyTotals} /></section>
      <section className="card report-section-card"><div className="section-heading"><h2>সদস্যভিত্তিক মোট</h2><span>{formatNumber(memberTotals.length)} জন</span></div><Table columns={[{key:'name',label:'সদস্য'},{key:'breakfast',label:'সকালের মিল',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'দুপুরের মিল',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'রাতের মিল',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(r.breakfast+r.lunch+r.dinner)}]} rows={memberTotals} /></section>
    </div>
  );
}

export function ReportsPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBundle(await fetchCurrentReportBundle()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'রিপোর্টের তথ্য লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="রিপোর্ট দেখতে ইন্টারনেট চালু করুন" text="রিপোর্ট অনলাইনেই তৈরি হয়।" />;
  if (loading) return <LoadingSpinner label="রিপোর্টের তথ্য প্রস্তুত হচ্ছে..." />;
  if (!bundle) return <FeatureStateNotice title="রিপোর্টের জন্য কোনো চলমান মাস নেই" text="নতুন মাস শুরু হলে রিপোর্ট তৈরি করা যাবে।" icon="download" />;

  const meals = calculateMealTotals(bundle.mealRows);
  const dailyRows = buildDailyMealRows(bundle.days, bundle.mealRows).filter((row) => row.status === 'finalized');
  const members = buildMemberSettlementRows(bundle.members);
  const activeMarkets = getActiveMarketRows(bundle.marketRows);
  const allMarkets = Array.isArray(bundle.marketRows) ? bundle.marketRows : [];
  const activeKhalaRows = (bundle.khalaRows || []).filter((row) => row.status !== 'void');
  const totalMarket = activeMarkets.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const depositRows = (bundle.accountRows || []).filter((row) => {
    const type = row.transaction_type_raw || row.ledger_type || row.transaction_type || '';
    return ['deposit', 'market_deposit'].includes(type) && row.status !== 'void' && Number(row.amount || 0) > 0;
  }).map((row) => ({ ...row, member_name: row.member_name || members.find((member) => member.membershipId === row.member_id)?.name || 'সদস্য' }));
  const otherExpenses = (bundle.accountRows || []).filter((row) => (row.transaction_type_raw || row.ledger_type || '') === 'other_expense' && row.status !== 'void')
    .reduce((sum, row) => sum + Math.abs(Math.min(Number(row.amount || 0), 0)), 0);
  const totalDeposit = depositRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalKhala = activeKhalaRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const fundRemaining = totalDeposit - totalMarket - otherExpenses - totalKhala;
  const mealRate = meals.total > 0 ? totalMarket / meals.total : 0;
  const manager = (bundle.members || []).find((member) => member.is_primary_manager || member.role === 'manager');
  const pdfMeta = {
    periodLabel: bundle.period.label,
    managerName: manager?.member_name || manager?.full_name || '',
    managerPhone: manager?.phone || manager?.phone_number || manager?.mobile || '',
  };

  const money = (value) => escapeReportHtml(formatCurrency(value));
  const date = (value) => escapeReportHtml(value ? formatDateWithWeekday(value) : '—');
  const cellTable = (columns, rows) => {
    const head = columns.map((column) => `<th>${escapeReportHtml(column.label)}</th>`).join('');
    const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeReportHtml(column.value(row) ?? '—')}</td>`).join('')}</tr>`).join('');
    return `<div class="report-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">কোনো তথ্য পাওয়া যায়নি</td></tr>`}</tbody></table></div>`;
  };
  const summaryTable = `<table class="report-summary"><tbody><tr>
    <td><small>মোট মিল</small><strong>${escapeReportHtml(formatNumber(meals.total))}</strong></td>
    <td><small>মোট বাজার</small><strong>${money(totalMarket)}</strong></td>
    <td><small>মিল রেট</small><strong>${money(mealRate)}</strong></td>
    <td><small>মেসের অবশিষ্ট</small><strong>${money(fundRemaining)}</strong></td>
  </tr></tbody></table>`;

  const finalAccountRows = members.map((member) => ({
    ...member,
    totalCost: Number(member.mealCost || 0) + Number(member.otherExpense || 0),
  }));
  const finalAccountTable = cellTable([
    { label: 'সদস্যের নাম', value: (row) => row.name },
    { label: 'মোট জমা', value: (row) => formatCurrency(row.deposit) },
    { label: 'মোট মিল', value: (row) => formatNumber(row.meals) },
    { label: 'মোট খরচ', value: (row) => formatCurrency(row.totalCost) },
    { label: 'বকেয়া / অবশিষ্ট', value: (row) => Number(row.balance) < 0 ? `বকেয়া ${formatCurrency(Math.abs(Number(row.balance)))}` : `অবশিষ্ট ${formatCurrency(row.balance)}` },
  ], finalAccountRows);

  const marketRows = allMarkets.map((row) => ({ ...row, itemCount: Array.isArray(row.items) ? row.items.length : 0 }));
  const marketTable = cellTable([
    { label: 'তারিখ', value: (row) => formatDateWithWeekday(row.entry_date) },
    { label: 'বাজারকারী', value: (row) => row.buyer_name || row.member_name || 'সদস্য' },
    { label: 'টাকার পরিমাণ', value: (row) => formatCurrency(row.total_amount) },
    { label: 'আইটেম সংখ্যা', value: (row) => formatNumber(row.itemCount) },
    { label: 'অবস্থা', value: (row) => row.status === 'void' ? 'বাতিল' : 'কার্যকর' },
  ], marketRows);
  const marketTableWithTotal = marketTable.replace('</tbody></table>', `</tbody><tfoot><tr><th colspan="2">মোট কার্যকর বাজার</th><th>${money(totalMarket)}</th><th>${formatNumber(activeMarkets.reduce((sum, row) => sum + (Array.isArray(row.items) ? row.items.length : 0), 0))} আইটেম</th><th></th></tr></tfoot></table>`);

  const depositsByMember = new Map();
  for (const row of depositRows) {
    const key = row.member_id || row.member_name || 'unknown';
    if (!depositsByMember.has(key)) depositsByMember.set(key, { name: row.member_name || 'সদস্য', entries: [], total: 0 });
    const group = depositsByMember.get(key);
    group.entries.push(row);
    group.total += Number(row.amount || 0);
  }
  const depositGroups = [...depositsByMember.values()].map((group) => ({
    ...group,
    entries: group.entries.sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || ''))),
  })).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  const maxDeposits = Math.max(1, ...depositGroups.map((group) => group.entries.length));
  const depositHead = `<th>সদস্যের নাম</th>${Array.from({ length: maxDeposits }, (_, i) => `<th>জমা ${i + 1}</th>`).join('')}<th>মোট জমা</th>`;
  const depositBody = depositGroups.map((group) => `<tr><td>${escapeReportHtml(group.name)}</td>${Array.from({ length: maxDeposits }, (_, i) => {
    const entry = group.entries[i];
    return `<td>${entry ? `<small>${date(entry.entry_date)}</small><br><strong>${money(entry.amount)}</strong><br><small>${entry.transaction_type_raw === 'market_deposit' ? 'বাজার বাবদ' : 'জমা'}</small>` : '—'}</td>`;
  }).join('')}<td><strong>${money(group.total)}</strong></td></tr>`).join('');
  const depositTable = `<div class="report-table-wrap"><table><thead><tr>${depositHead}</tr></thead><tbody>${depositBody || `<tr><td colspan="${maxDeposits + 2}">কোনো জমার তথ্য নেই</td></tr>`}</tbody><tfoot><tr><th colspan="${maxDeposits + 1}">সর্বমোট জমা</th><th>${money(totalDeposit)}</th></tr></tfoot></table></div>`;

  const khalaRows = activeKhalaRows.map((row) => ({ date: row.entry_date || row.payment_date, amount: Number(row.amount || 0), description: row.description || 'খালার পারিশ্রমিক' }));
  const khalaTable = cellTable([
    { label: 'প্রদানের তারিখ', value: (row) => formatDateWithWeekday(row.date) },
    { label: 'বিবরণ', value: (row) => row.description },
    { label: 'পরিমাণ', value: (row) => formatCurrency(row.amount) },
  ], khalaRows).replace('</tbody></table>', `</tbody><tfoot><tr><th colspan="2">খালার টাকার মোট</th><th>${money(totalKhala)}</th></tr></tfoot></table>`);

  const dailyTable = cellTable([
    { label: 'তারিখ', value: (row) => formatDateWithWeekday(row.date) },
    { label: 'সকালের মিল', value: (row) => formatNumber(row.breakfast) },
    { label: 'দুপুরের মিল', value: (row) => formatNumber(row.lunch) },
    { label: 'রাতের মিল', value: (row) => formatNumber(row.dinner) },
    { label: 'মোট মিল', value: (row) => formatNumber(Number(row.breakfast) + Number(row.lunch) + Number(row.dinner)) },
  ], dailyRows);

  const openPdf = (title, subtitle, content) => {
    const pageOrientation = 'portrait';
    printReport(title, subtitle, content, null, { ...pdfMeta, pageOrientation });
  };
  const runExport = (callback) => {
    setExportBusy(true);
    try { callback(); } catch (error) { toast.error(error.message || 'রিপোর্ট তৈরি করা যায়নি।'); }
    finally { window.setTimeout(() => setExportBusy(false), 350); }
  };
  const reportSubtitle = `${currentPeriodRange(bundle.period)} · ${bundle.period.label}`;
  const downloadFinalAccount = () => openPdf('ফাইনাল হিসাব', reportSubtitle, `${summaryTable}<h2 class="report-section-title">সদস্যভিত্তিক ফাইনাল হিসাব</h2>${finalAccountTable}<p class="report-note">বকেয়া/অবশিষ্ট হলো প্রত্যেক সদস্যের নিজস্ব জমা, মিলের খরচ ও অন্যান্য ব্যক্তিগত খরচ অনুযায়ী হিসাব। খালার পারিশ্রমিক সদস্যের ব্যালেন্সে অন্তর্ভুক্ত নয়।</p>`);
  const downloadMarket = () => openPdf('বাজার হিসাব', reportSubtitle, `${summaryTable}<h2 class="report-section-title">বাজারের বিবরণ</h2>${marketTableWithTotal}`);
  const downloadDeposits = () => openPdf('ডিপোজিট হিসাব', reportSubtitle, `${summaryTable}<h2 class="report-section-title">সদস্যভিত্তিক জমা</h2>${depositTable}`);
  const downloadFullMonthly = () => openPdf('পূর্ণ মাসিক প্রতিবেদন', reportSubtitle,
    `${summaryTable}<h2 class="report-section-title">১. সদস্যভিত্তিক ফাইনাল হিসাব</h2>${finalAccountTable}` +
    `<h2 class="report-section-title">২. বাজার হিসাব</h2>${marketTableWithTotal}` +
    `<h2 class="report-section-title">৩. ডিপোজিট হিসাব</h2>${depositTable}` +
    `<h2 class="report-section-title">৪. খালার পারিশ্রমিক — পৃথক হিসাব</h2>${khalaTable}` +
    `<h2 class="report-section-title">৫. দৈনিক মিলের সারসংক্ষেপ</h2>${dailyTable}`);

  return (
    <div className="page-stack reports-page">
      <PageHeader title="রিপোর্ট কেন্দ্র" icon="download" eyebrow="রিপোর্ট" description="সহজ ও পরিষ্কার ফরম্যাটে মাসিক হিসাব দেখুন এবং PDF হিসেবে সংরক্ষণ করুন।" />
      <InfoPanel icon="download">প্রতিটি PDF নির্বাচিত চলমান মাসের তথ্য থেকে তৈরি হয়। ডাউনলোডের আগে মাস, সদস্য সংখ্যা, জমা, বাজার ও মিলের সারসংক্ষেপ যাচাই করুন। অপেক্ষমাণ অনুরোধ ফাইনাল মিল হিসেবে গণনা হয় না।</InfoPanel>
      <section className="report-summary-strip card" aria-label="মাসের সারসংক্ষেপ">
        <div><small>মোট মিল</small><strong>{formatNumber(meals.total)}</strong></div>
        <div><small>মোট বাজার</small><strong>{formatCurrency(totalMarket)}</strong></div>
        <div><small>মিল রেট</small><strong>{formatCurrency(mealRate)}</strong></div>
        <div><small>মেসের অবশিষ্ট</small><strong>{formatCurrency(fundRemaining)}</strong></div>
      </section>
      <section className="report-download-grid report-download-grid-four">
        <button className="card report-option" type="button" onClick={() => runExport(downloadFinalAccount)} disabled={exportBusy}><span className="report-option-icon"><Icon name="users" size={21} /></span><strong>ফাইনাল হিসাব</strong><small>সদস্য, জমা, মিল, খরচ ও বকেয়া/অবশিষ্ট</small><b>PDF</b></button>
        <button className="card report-option" type="button" onClick={() => runExport(downloadMarket)} disabled={exportBusy}><span className="report-option-icon"><Icon name="shopping-bag" size={21} /></span><strong>বাজার হিসাব</strong><small>তারিখ, বাজারকারী, টাকার পরিমাণ ও আইটেম সংখ্যা</small><b>PDF</b></button>
        <button className="card report-option" type="button" onClick={() => runExport(downloadDeposits)} disabled={exportBusy}><span className="report-option-icon"><Icon name="wallet" size={21} /></span><strong>ডিপোজিট হিসাব</strong><small>সদস্যপ্রতি জমার তারিখ, পরিমাণ ও সর্বমোট</small><b>PDF</b></button>
        <button className="card report-option" type="button" onClick={() => runExport(downloadFullMonthly)} disabled={exportBusy}><span className="report-option-icon"><Icon name="file-text" size={21} /></span><strong>পূর্ণ মাসিক প্রতিবেদন</strong><small>ফাইনাল হিসাব, বাজার, ডিপোজিট, খালা ও দৈনিক মিল একসঙ্গে</small><b>PDF</b></button>
      </section>
      <section className="card report-section-card report-final-preview">
        <div className="section-heading"><div><h2>ফাইনাল হিসাবের প্রিভিউ</h2><small>{bundle.period.label} · {formatNumber(members.length)} জন সদস্য</small></div><button className="secondary-button compact report-preview-download" type="button" onClick={() => runExport(downloadFinalAccount)} disabled={exportBusy}><Icon name="download" size={15}/> PDF সংরক্ষণ</button></div>
        <Table columns={[{ key:'name', label:'সদস্যের নাম' },{ key:'deposit', label:'জমা', render:(r)=>formatCurrency(r.deposit) },{ key:'meals', label:'মিল', render:(r)=>formatNumber(r.meals) },{ key:'totalCost', label:'মোট খরচ', render:(r)=>formatCurrency(r.totalCost) },{ key:'balance', label:'বকেয়া / অবশিষ্ট', render:(r)=>Number(r.balance)<0?`বকেয়া ${formatCurrency(Math.abs(Number(r.balance)))}`:`অবশিষ্ট ${formatCurrency(r.balance)}` }]} rows={finalAccountRows.map((row) => ({ ...row, key: row.key || row.membershipId }))} />
      </section>
      <InfoPanel icon="info" className="report-page-note">মিলের হিসাবে শুধু ফাইনাল হওয়া দিনের তথ্য অন্তর্ভুক্ত। অপেক্ষমাণ অনুরোধ ও ভবিষ্যৎ দিনের planned মিল চূড়ান্ত মিল নয়। খালার পারিশ্রমিক মেসের আলাদা খরচ; এটি কোনো সদস্যের ব্যক্তিগত ব্যালেন্সে যোগ হয় না।</InfoPanel>
    </div>
  );
}
