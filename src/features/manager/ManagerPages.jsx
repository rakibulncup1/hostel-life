import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
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
  setRunningPeriodEndDate,
  startNewMonth,
  updateHostel,
  voidKhalaMoney,
} from '../../services/managerService';
import { fetchKhalaMoneyHistory, fetchPreviousMonths, fetchArchivedMonthDetail } from '../../services/historyService';
import { buildDailyMealRows, buildMemberSettlementRows, calculateMealTotals, fetchCurrentReportBundle, getActiveMarketRows, getVoidMarketRows, printReport } from '../../services/reportService';
import { fetchManagerMemberDirectory, fetchMonthClosePreflight } from '../../services/diningService';
import { formatDateBangla, formatDateWithWeekday, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { deriveNextRequiredStartDate, dhakaDateInputValue } from '../../utils/monthStart';


function AccessNotice({ title, text }) {
  return (
    <div className="state-card state-card-warning">
      <Icon name="shield" size={28} />
      <div><h2>{title}</h2><p>{text}</p></div>
    </div>
  );
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

function ConfirmModal({ title, description, confirmLabel = 'নিশ্চিত করুন', danger = false, busy = false, onConfirm, onClose, children }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel card confirmation-modal" role="dialog" aria-modal="true" aria-label={title}>
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

function calendarMonthEnd(dateValue) {
  if (!dateValue) return '';
  const [year, month] = String(dateValue).slice(0, 7).split('-').map(Number);
  if (!year || !month) return '';
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
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
  // Do not activate a future period before its first day (Dhaka date).
  // Database authorization must enforce the same boundary in Module B.
  const todayForStart = context?.today || dhakaDateInputValue();
  const isFutureStart = Boolean(requiredStart && requiredStart > todayForStart);
  const canStart = Boolean(periodStatusKnown && isPrimaryManager && !hasRunning && requiredStart && startDate === requiredStart && !periodDateError && !isFutureStart);

  const submit = async () => {
    if (startDate > dhakaDateInputValue()) { toast.warning('নির্ধারিত শুরুর দিন না আসা পর্যন্ত নতুন মাস চালু করা যাবে না।'); return; }
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
        <PageHeader title="নতুন মাস শুরু" icon="calendar" description="বন্ধ হওয়া মাসের পরের দিন থেকে নতুন চলমান মাস শুরু হবে। কোনো পূর্ববর্তী মাস না থাকলে চলতি ক্যালেন্ডার মাসের প্রথম দিন থেকে শুরু হবে।" />
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
              <div className="form-hint"><Icon name="info" size={15} /> প্রথম মাস হলে চলতি বাংলাদেশি ক্যালেন্ডার মাসের ১ তারিখ থেকে শুরু হবে। পূর্ববর্তী মাস থাকলে তার শেষ দিনের পরের দিন থেকে শুরু হবে।</div>
              {isFutureStart && <div className="inline-info" role="status">নির্ধারিত তারিখ {formatDateBangla(requiredStart)} আসার আগে নতুন মাস চালু করা যাবে না। এতে পুরোনো মাসের মিল রেকর্ডের সঙ্গে সংঘর্ষ এড়ানো যায়।</div>}
              <button className="primary-button large" type="button" disabled={!canStart || busy} onClick={() => setConfirmOpen(true)}><Icon name="calendar" size={17} /> নতুন মাস শুরু করুন</button>
            </>
          ) : null}
        </section>
        {confirmOpen && <ConfirmModal title="নতুন মাস শুরু করবেন?" description={`${formatDateBangla(startDate)} থেকে নতুন মাস শুরু হবে। এর আলাদা period ID তৈরি হবে এবং আগের মাসের history অক্ষত থাকবে।`} confirmLabel="হ্যাঁ, শুরু করুন" busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={submit} />}
      </div>
    </PrimaryManagerGuard>
  );
}

export function CloseCurrentMonthPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { context, refresh } = useManagementContext();
  const [selectedEnd, setSelectedEnd] = useState(toDateInputValue());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [futureWarning, setFutureWarning] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [overlaps, setOverlaps] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, preflightData] = await Promise.all([refresh({ force: true }), fetchMonthClosePreflight().catch(() => null)]);
      if (data?.period?.start_date) {
        const todayValue = data.today || toDateInputValue();
        const naturalEnd = calendarMonthEnd(data.period.start_date);
        const firstLegal = data.period.start_date;
        const defaultEnd = todayValue < firstLegal
          ? firstLegal
          : todayValue <= naturalEnd
            ? todayValue
            : naturalEnd;
        setSelectedEnd(defaultEnd);
      }
      setPreflight(preflightData);
      if (preflightData?.overlap_pair_count > 0 && data?.period?.period_id) {
        setOverlaps(await fetchMealRequestOverlapDetails(data.period.period_id).catch(() => []));
      } else {
        setOverlaps([]);
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'বর্তমান মাসের তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [refresh, toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="মাস বন্ধ করতে অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="বর্তমান মাস লোড হচ্ছে..." />;
  if (context?.has_running_period !== true || !context?.period) {
    if (context?.has_running_period === false) {
      return <div className="state-card state-card-warning"><Icon name="calendar" size={27} /><div><h2>কোনো চলমান মাস নেই</h2><p>নতুন মাস শুরু করতে ৩ লাইনের মেনু থেকে নতুন মাস শুরু করুন ব্যবহার করুন।</p></div></div>;
    }
    return <div className="state-card state-card-warning"><Icon name="warning" size={27} /><div><h2>চলমান মাসের অবস্থা যাচাই করা যায়নি</h2><p>ভুল করে মাস নেই ধরে নেওয়া হচ্ছে না। ইন্টারনেট ও ডাটাবেজ সংযোগ যাচাই করে আবার চেষ্টা করুন।</p><button className="secondary-button compact" type="button" onClick={load}>আবার যাচাই করুন</button></div></div>;
  }

  const today = context.today || toDateInputValue();
  const minEnd = context.period.start_date;
  const maxEnd = calendarMonthEnd(context.period.start_date);
  const monthAlreadyPassed = Boolean(maxEnd && today > maxEnd);
  const isToday = selectedEnd === today;
  const isBeforeToday = selectedEnd < today;
  const isAfterToday = selectedEnd > today;
  const closeNow = isToday || (monthAlreadyPassed && selectedEnd === maxEnd);
  const selectablePastClose = monthAlreadyPassed && selectedEnd === maxEnd;
  const invalidPastSelection = isBeforeToday && !selectablePastClose;
  const inputMin = monthAlreadyPassed ? maxEnd : (today > minEnd ? today : minEnd);

  const applyEndDate = async (confirmCancel = false) => {
    setBusy(true);
    try {
      if (closeNow) {
        await closeCurrentMonth(confirmCancel);
        toast.success(`${context.period.label} সফলভাবে বন্ধ হয়েছে।`);
      } else {
        await setRunningPeriodEndDate(selectedEnd, confirmCancel);
        toast.success(`মাসের শেষ তারিখ ${formatDateBangla(selectedEnd)} করা হয়েছে।`);
      }
      setFutureWarning(false);
      setConfirmOpen(false);
      await load();
    } catch (error) {
      const message = getFriendlySupabaseError(error, 'মাসের শেষ তারিখ পরিবর্তন করা যায়নি।');
      if (!confirmCancel && /ভবিষ্যৎ|রিকোয়েস্ট|সতর্কতা/.test(message)) {
        setFutureWarning(true);
        setConfirmOpen(true);
      } else {
        toast.error(message);
      }
    } finally { setBusy(false); }
  };


  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="বর্তমান মাস শেষ করুন" icon="calendar" description="আজকের তারিখ default থাকবে। প্রয়োজনে আগে বর্তমান মাসের শেষ তারিখ সামঞ্জস্য করুন।" />
        <section className="card manager-form-card">
          <div className="manager-current-period"><span>চলমান মাস</span><strong>{context.period.label}</strong><small>{formatDateBangla(context.period.start_date)} → {formatDateBangla(context.period.end_date)}</small>{context.period.is_current_for_today === false && <em>এই period-এর সীমা আজকের তারিখের সঙ্গে মেলেনি; সিস্টেম recovery boundary প্রয়োগ করেছে।</em>}</div>
          {preflight?.running_period_count > 1 && <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>মেসে একাধিক চলমান মাস পাওয়া গেছে।</strong><p>নতুন মাস শুরু করবেন না। আগে এই তথ্যের অবস্থা যাচাই করতে হবে।</p></div></div>}
          {preflight && preflight.future_active_request_count > 0 && <div className="manager-warning-box"><Icon name="info" size={18} /><div><strong>{preflight.future_active_request_count}টি ভবিষ্যৎ active meal request আছে।</strong><p>আজ মাস বন্ধ করলে নিশ্চিত করার পরে এগুলো বাতিল হবে।</p></div></div>}
          {preflight && preflight.overlap_pair_count > 0 && <div className="form-hint"><Icon name="info" size={16} /> {preflight.overlap_pair_count}টি পুরোনো overlapping normal request pair আছে। এগুলো মাস বন্ধের বাধা নয়; নতুন request দেওয়ার সময় শুধু conflict protection কাজ করবে।</div>}
          {overlaps.length > 0 && <div className="manager-overlap-list"><strong>ঐতিহাসিক overlap-এর বিবরণ</strong>{overlaps.map((item) => <div className="manager-overlap-row" key={`${item.request_id_a}-${item.request_id_b}`}><span>{item.member_name_a || 'সদস্য'} · {formatDateBangla(item.start_date_a)} → {formatDateBangla(item.end_date_a)}</span><span>{item.member_name_b || 'সদস্য'} · {formatDateBangla(item.start_date_b)} → {formatDateBangla(item.end_date_b)}</span></div>)}</div>}
          <label className="field-label"><span>মাসের শেষ তারিখ</span><input type="date" min={inputMin} max={maxEnd || undefined} value={selectedEnd} onChange={(e) => setSelectedEnd(e.target.value)} /></label>
          <div className="form-hint"><Icon name="info" size={15} /> আজকের তারিখ দিলে মাস আজই বন্ধ হবে। ভবিষ্যতের তারিখ দিলে শুধু নির্ধারিত শেষ তারিখ বদলাবে; মাস এখনই archive হবে না। অতীতের তারিখ নির্বাচন করা যাবে না; calendar month-এর শেষ দিনের পরেও নেওয়া যাবে না।</div>
          {isAfterToday && <div className="manager-warning-box"><Icon name="calendar" size={18} /><div><strong>{formatDateBangla(selectedEnd)} পর্যন্ত মাস চলবে।</strong><p>এই তারিখের আগে মাস বন্ধ হবে না।</p></div></div>}
          <button className="primary-button large" type="button" disabled={busy || invalidPastSelection || selectedEnd < minEnd || selectedEnd > maxEnd} onClick={() => {
            if (closeNow && preflight?.future_active_request_count > 0) setFutureWarning(true);
            setConfirmOpen(true);
          }}>
            <Icon name="calendar" size={17} /> {closeNow ? 'মাস বন্ধ করুন' : isAfterToday ? 'শেষ তারিখ নির্ধারণ করুন' : 'মাস শেষ করুন'}
          </button>
        </section>
        {confirmOpen && (
          <ConfirmModal
            title={closeNow ? 'মাস বন্ধ করবেন?' : 'শেষ তারিখ পরিবর্তন করবেন?'}
            description={futureWarning ? 'এই মাসের ভবিষ্যতের সক্রিয় মিল রিকোয়েস্টগুলো বাতিল হবে। নিশ্চিত করলে বর্তমান মাস বন্ধ/আপডেট হবে।' : closeNow ? `${formatDateBangla(selectedEnd)} তারিখে বর্তমান মাস বন্ধ হবে। নির্ধারিত শেষ তারিখের পরে চলে গেলে calendar month-এর শেষ দিনই কার্যকর close date হবে।` : `${formatDateBangla(selectedEnd)}-কে বর্তমান মাসের নির্ধারিত শেষ তারিখ করা হবে।`}
            confirmLabel={closeNow ? 'হ্যাঁ, মাস বন্ধ করুন' : 'নিশ্চিত করুন'}
            danger={closeNow || futureWarning}
            busy={busy}
            onClose={() => { setConfirmOpen(false); setFutureWarning(false); }}
            onConfirm={() => applyEndDate(closeNow || futureWarning)}
          />
        )}
      </div>
    </PrimaryManagerGuard>
  );
}

export function ChangeManagerPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { membership, profile, refreshIdentity } = useAuth();
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
      toast.error(getFriendlySupabaseError(error, 'ম্যানেজার পরিবর্তন করা যায়নি।'));
    } finally { setBusy(false); }
  };

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>ম্যানেজার পরিবর্তনের জন্য অনলাইন সংযোগ প্রয়োজন।</p></div></div>;
  if (loading) return <LoadingSpinner label="ম্যানেজার পরিবর্তনের সদস্য তালিকা লোড হচ্ছে..." />;

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="ম্যানেজার পরিবর্তন" icon="shield" description="নতুন ম্যানেজার নির্বাচন করলে আপনার বর্তমান ম্যানেজার ক্ষমতা সঙ্গে সঙ্গে চলে যাবে।" />
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
      setMembers(memberRows.filter((member) => member.member_status === 'active' && member.membership_id !== membership?.membership_id && member.role !== 'manager'));
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
        <section className="card manager-form-card">
          <div className="manager-warning-box"><Icon name="info" size={18} /><div><strong>সহকারী ম্যানেজার শুধু দৈনন্দিন কাজের ক্ষমতা পাবেন।</strong><p>মাস শুরু/শেষ, সদস্য নিষ্ক্রিয় করা এবং ম্যানেজার পরিবর্তন শুধু প্রধান ম্যানেজার করতে পারবেন।</p></div></div>
          <div className="assistant-grid">
            {members.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="users" size={24} /><strong>সহকারী দেওয়ার মতো সক্রিয় সদস্য নেই।</strong></div> : members.map((member) => {
              const checked = selected.includes(member.membership_id);
              return <label className={`assistant-choice-card ${checked ? 'selected' : ''}`} key={member.membership_id}><input type="checkbox" checked={checked} onChange={() => toggle(member.membership_id)} /><span className="assistant-choice-avatar" aria-hidden="true"><Icon name="users" size={16} /></span><span><strong>{member.member_name}</strong><small>{checked ? 'সহকারী ম্যানেজার' : 'সদস্য'}</small></span></label>;
            })}
          </div>
          <button className="primary-button large" type="button" disabled={busy} onClick={save}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'সহকারী তালিকা সংরক্ষণ করুন'}</button>
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

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>মেস সেটিংস পরিবর্তনের জন্য online connection প্রয়োজন।</p></div></div>;

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="মেস সেটিংস" icon="lock" description="মেসের পরিচয় এবং যুক্ত হওয়ার কোড পরিচালনা করুন।" />
        <form className="card manager-form-card" onSubmit={saveName}>
          <label className="field-label"><span>মেসের নাম</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'মেসের নাম সংরক্ষণ করুন'}</button>
        </form>
        <section className="card manager-form-card">
          <div className="panel-header"><div><span className="eyebrow">যুক্ত হওয়ার কোড</span><h2>মেসে সদস্য যুক্ত করার কোড</h2><p>নতুন সদস্যকে এই কোড দিন। নতুন কোড তৈরি করলে আগের কোডটি আর কাজ করবে না।</p></div></div>
          <div className="join-code-display"><strong>{joinCode || '—'}</strong><button className="secondary-button compact" type="button" onClick={async () => { try { await copyText(joinCode); toast.success('যুক্ত হওয়ার কোড কপি হয়েছে।'); } catch { toast.warning('কপি করা যায়নি।'); } }}>কপি</button></div>
          <button className="secondary-button" type="button" disabled={codeBusy} onClick={() => setConfirmCode(true)}><Icon name="refresh" size={15} /> নতুন যুক্ত হওয়ার কোড তৈরি করুন</button>
        </section>
        {confirmCode && <ConfirmModal title="নতুন যুক্ত হওয়ার কোড তৈরি করবেন?" description="নতুন কোড তৈরি করলে আগের যুক্ত হওয়ার কোড দিয়ে আর নতুন সদস্য যুক্ত হতে পারবে না।" confirmLabel="নতুন কোড তৈরি করুন" busy={codeBusy} onClose={() => setConfirmCode(false)} onConfirm={regen} />}
      </div>
    </PrimaryManagerGuard>
  );
}

export function MemberManagementPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const { membership } = useAuth();

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
        await deactivateMember(action.member.membership_id);
        toast.success(`${action.member.member_name} এখন নিষ্ক্রিয় সদস্য।`);
      } else {
        await reactivateMember(action.member.membership_id);
        toast.success(`${action.member.member_name} আবার সক্রিয় হয়েছে।`);
      }
      setAction(null);
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'সদস্যের status পরিবর্তন করা যায়নি।')); }
  };

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>সদস্য ব্যবস্থাপনার জন্য online connection প্রয়োজন।</p></div></div>;

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="সদস্য ব্যবস্থাপনা" icon="users" description="মেস ছেড়ে যাওয়া সদস্যকে নিষ্ক্রিয় করুন; প্রয়োজন হলে পরে আবার সক্রিয় করুন।" />
        {loading ? <LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..." /> : <div className="manager-member-list">
          {members.map((member) => {
            const isSelf = member.membership_id === membership?.membership_id;
            const inactive = member.member_status === 'inactive';
            return (
              <article className={`card manager-member-row ${inactive ? 'manager-member-inactive' : ''}`} key={member.membership_id}>
                <div className="manager-member-main"><span className="avatar">{member.member_name?.split(/\s+/).slice(0,2).map((x) => x[0]).join('').toUpperCase()}</span><div><strong>{member.member_name}</strong><div className="member-badge-row"><span className={`member-badge ${inactive ? 'inactive' : 'active'}`}>{inactive ? 'নিষ্ক্রিয়' : 'সক্রিয় সদস্য'}</span>{Boolean(member.is_primary_manager ?? (member.role === 'manager')) && <span className="member-badge manager">ম্যানেজার</span>}{member.is_assistant_manager && <span className="member-badge assistant">সহকারী ম্যানেজার</span>}</div><small>{member.meal_activity || 'এই মাসে মিল নেই'}</small></div></div>
                <div className="manager-member-actions">{inactive ? <button className="secondary-button compact" type="button" onClick={() => setAction({ type: 'reactivate', member })}>আবার সক্রিয়</button> : <button className="secondary-button compact danger-outline" type="button" disabled={isSelf || Boolean(member.is_primary_manager ?? member.role === 'manager')} onClick={() => setAction({ type: 'deactivate', member })}>{isSelf ? 'নিজেকে নয়' : Boolean(member.is_primary_manager ?? (member.role === 'manager')) ? 'আগে Manager Change' : 'নিষ্ক্রিয় করুন'}</button>}</div>
              </article>
            );
          })}
        </div>}
        {action && <ConfirmModal danger={action.type === 'deactivate'} title={action.type === 'deactivate' ? 'সদস্য নিষ্ক্রিয় করবেন?' : 'সদস্য আবার সক্রিয় করবেন?'} description={action.type === 'deactivate' ? `${action.member.member_name}-এর নতুন meal request/active operation বন্ধ হবে, তবে পুরোনো সব হিসাব অক্ষত থাকবে।` : `${action.member.member_name} আবার active member হিসেবে নতুন কাজ করতে পারবে।`} confirmLabel={action.type === 'deactivate' ? 'নিষ্ক্রিয় করুন' : 'আবার সক্রিয় করুন'} onClose={() => setAction(null)} onConfirm={runAction} />}
      </div>
    </PrimaryManagerGuard>
  );
}


export function KhalaMoneyPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const { context, isPrimaryManager, isOperationalManager } = useManagementContext();
  const [periods, setPeriods] = useState([]);
  const [rows, setRows] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState({ amount: '', paymentDate: toDateInputValue(), description: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const periodRows = await fetchKhalaPeriods();
      const historyByPeriod = await Promise.all(periodRows.map((period) => fetchKhalaMoneyHistory({ periodId: period.period_id, limit: 300 })));
      const khalaRows = historyByPeriod.flat().sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPeriods(periodRows);
      const currentPeriod = context?.period?.period_id;
      setPeriodId((currentPeriod && periodRows.some((p) => p.period_id === currentPeriod)) ? currentPeriod : (periodRows[0]?.period_id || ''));
      setRows(khalaRows);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [context?.period?.period_id, toast]);

  useEffect(() => { if (online && isOperationalManager) load(); }, [online, isOperationalManager, load]);

  const selectedPeriod = periods.find((p) => p.period_id === periodId) || null;
  const visibleRows = selectedPeriod ? rows.filter((row) => row.period_id === selectedPeriod.period_id) : rows;
  const total = visibleRows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  useEffect(() => {
    if (selectedPeriod) setForm((current) => ({ ...current, paymentDate: current.paymentDate || toDateInputValue() }));
  }, [selectedPeriod]);

  const save = async (event) => {
    event.preventDefault();
    if (!periodId) return toast.warning('কাজের মাস নির্বাচন করুন।');
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.warning('টাকার পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!form.paymentDate) return toast.warning('প্রদানের তারিখ নির্বাচন করুন।');
    if (form.paymentDate > toDateInputValue()) return toast.warning('প্রদানের তারিখ ভবিষ্যতের হতে পারবে না।');
    if (selectedPeriod?.start_date && form.paymentDate < selectedPeriod.start_date) return toast.warning('প্রদানের তারিখ নির্বাচিত মাসের শুরুর আগের হতে পারবে না।');
    if (selectedPeriod?.end_date && form.paymentDate > selectedPeriod.end_date) return toast.warning('প্রদানের তারিখ নির্বাচিত মাসের শেষের পরের হতে পারবে না।');
    setBusy(true);
    try {
      await addKhalaMoney({ periodId, memberId: null, amount, paymentDate: form.paymentDate, description: form.description.trim() || null });
      toast.success('খালার টাকার এন্ট্রি আলাদা হিসাব হিসেবে সংরক্ষণ হয়েছে।');
      setForm((current) => ({ ...current, amount: '', description: '' }));
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'খালার টাকার এন্ট্রি যোগ করা যায়নি।')); }
    finally { setBusy(false); }
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
  if (!isOperationalManager) return <AccessNotice title="অনুমতি নেই" text="খালার টাকার entry ম্যানেজার বা সহকারী ম্যানেজারের জন্য।" />;
  if (loading) return <LoadingSpinner label="খালার টাকার তথ্য লোড হচ্ছে..." />;

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="খালার টাকা" icon="wallet" description={isPrimaryManager ? 'মাসের বাজার বা সদস্যের ব্যক্তিগত খরচের সঙ্গে না মিশিয়ে খালার পারিশ্রমিক আলাদাভাবে লিখুন।' : 'অনুমোদিত কাজের মাসে খালার পারিশ্রমিকের আলাদা হিসাব যোগ করুন।'} />
        {periods.length === 0 ? (
          <div className="empty-state-card"><Icon name="wallet" size={26} /><strong>এখনো কোনো কাজের মাস পাওয়া যায়নি</strong><span>বর্তমান বা নির্ধারিত পুরোনো মাস থাকলে এখানে দেখা যাবে।</span></div>
        ) : (
          <>
            <form className="card manager-form-card khala-entry-form" onSubmit={save}>
              <div className="form-grid-2">
                <label className="field-label"><span>কাজের মাস</span><select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((period) => <option key={period.period_id} value={period.period_id}>{period.label}</option>)}</select></label>
                <label className="field-label"><span>প্রদানের তারিখ</span><input type="date" max={toDateInputValue()} min={selectedPeriod?.start_date || undefined} value={form.paymentDate} onChange={(e) => setForm((current) => ({ ...current, paymentDate: e.target.value }))} required /></label>
              </div>
              {selectedPeriod && <div className="form-hint"><Icon name="info" size={15} /> এই খরচটি খালার আলাদা হিসাব হবে; কোনো সদস্যের ব্যক্তিগত ব্যালেন্স বা অন্যান্য খরচে যোগ হবে না।</div>}
              <div className="form-grid-2">
                <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))} placeholder="০" required /></label>
                <label className="field-label"><span>বিবরণ <em>(ঐচ্ছিক)</em></span><input value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} placeholder="যেমন: মাসিক পারিশ্রমিক" /></label>
              </div>
              <button className="primary-button large" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'খালার টাকা যোগ করুন'}</button>
            </form>

            <section className="card manager-form-card">
              <div className="section-heading"><div><span className="eyebrow">নির্বাচিত কাজের মাস</span><h2>{selectedPeriod?.label || '—'}</h2></div><div className="khala-total-heading"><small>মোট কার্যকর পারিশ্রমিক</small><strong>{formatCurrency(total)}</strong></div></div>
              <div className="manager-list-stack">
                {visibleRows.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="wallet" size={24} /><strong>কোনো এন্ট্রি নেই</strong><span>এই কাজের মাসে এখনো খালার টাকার কোনো এন্ট্রি দেওয়া হয়নি।</span></div> : visibleRows.map((row) => (
                  <article className={`card manager-ledger-row ${row.status === 'void' ? 'void-row' : ''}`} key={row.entry_id}>
                    <div><strong>খালার পারিশ্রমিক</strong><small>{formatDateWithWeekday(row.entry_date)} · {formatDateTime12(row.created_at)}</small><span>{row.description || 'খালার টাকা'}</span></div>
                    <strong>{formatCurrency(row.amount)}</strong>
                    {row.status !== 'void' ? <button className="icon-button compact-icon danger-icon" type="button" disabled={busy} onClick={() => { setVoidTarget(row); setVoidReason(''); }} aria-label="এন্ট্রি বাতিল করুন"><Icon name="trash" size={15} /></button> : <span className="member-badge inactive">বাতিল</span>}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        {voidTarget && <ConfirmModal danger title="এই এন্ট্রি বাতিল করবেন?" description={`${formatCurrency(voidTarget.amount)} খালার পারিশ্রমিক কার্যকর হিসাব থেকে বাদ যাবে। ইতিহাসে বাতিলের রেকর্ড থাকবে।`} confirmLabel="এন্ট্রি বাতিল করুন" busy={busy} onClose={() => { setVoidTarget(null); setVoidReason(''); }} onConfirm={doVoid}><label className="field-label"><span>বাতিলের কারণ</span><textarea rows="3" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="ভুল এন্ট্রি" /></label></ConfirmModal>}
      </div>
    </ManagerGuard>
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
      const [managementRows, memberRows] = await Promise.all([
        fetchArchiveManagementItems(),
        fetchManagerMemberDirectory(),
      ]);
      setMonths(Array.isArray(managementRows) ? managementRows : []);
      setMembers(Array.isArray(memberRows) ? memberRows : []);
      if (selectedPeriod && !managementRows.some((row) => row.period_id === selectedPeriod)) setSelectedPeriod('');
      if (!selectedPeriod && managementRows.length) setSelectedPeriod(managementRows[0].period_id);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'আর্কাইভের তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [selectedPeriod, toast]);

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
    const ok = window.confirm(`“${selected.label}” আবার চালু করা হবে। মাস বন্ধ করার সময় বাতিল হওয়া ভবিষ্যতের request স্বয়ংক্রিয়ভাবে ফেরত আসবে না। আপনি কি নিশ্চিত?`);
    if (!ok) return;
    setBusy(true);
    try {
      const result = await reopenArchivedPeriod(selected.period_id);
      toast.success(`${result?.label || selected.label} আবার চালু হয়েছে। বাতিল হওয়া future request প্রয়োজন হলে পুনরায় জমা দিতে হবে।`);
      await loadMonths();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'মাস পুনরায় চালু করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>আর্কাইভ ব্যবস্থাপনা অনলাইনেই পরিচালিত হয়।</p></div></div>;
  if (loading) return <LoadingSpinner label="Archive management প্রস্তুত হচ্ছে..." />;

  return <PrimaryManagerGuard><div className="page-stack">
    <PageHeader title="আর্কাইভ" icon="history" description="প্রতিটি আর্কাইভের closing manager, temporary edit access ও নিরাপদ accidental-close recovery এখানে পরিচালনা করুন।" />
    {months.length === 0 ? <div className="empty-state-card"><Icon name="history" size={28} /><strong>এখনো কোনো archive নেই</strong><span>মাস বন্ধ হলে তা এখানে দেখা যাবে।</span></div> : <>
      <section className="card manager-form-card">
        <label className="field-label"><span>আর্কাইভ করা মাস</span><select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>{months.map((month) => <option value={month.period_id} key={month.period_id}>{month.label} — {formatDateBangla(month.start_date)} → {formatDateBangla(month.end_date)}</option>)}</select></label>
        {selected && <div className="archive-manager-detail-grid">
          <div><span>মাস বন্ধ করেছেন</span><strong>{selected.manager_at_close_name || 'রেকর্ড নেই'}</strong></div>
          <div><span>অবস্থা</span><strong>{selected.closer_is_active ? 'Closing manager সক্রিয়' : 'Closing manager বর্তমানে inactive'}</strong></div>
          <div><span>শেষ পরিবর্তন</span><strong>{selected.last_edit_by ? `${selected.last_edit_by} · ${selected.last_edit_at ? formatDateTime12(selected.last_edit_at) : ''}` : 'এখনো কোনো edit audit নেই'}</strong><small>{selected.last_edit_summary || ''}</small></div>
        </div>}
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

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>মিল শিট দেখতে ইন্টারনেট চালু করুন</h2><p>রিপোর্ট অফলাইনে রাখা হয় না।</p></div></div>;
  if (loading) return <LoadingSpinner label="মিল শিট তৈরি হচ্ছে..." />;
  if (!bundle) return <div className="empty-state-card"><Icon name="calendar" size={28} /><strong>কোনো চলমান মাস নেই</strong><span>মিল শিট তৈরি করতে একটি চলমান মাস থাকতে হবে।</span></div>;

  const dailyTotals = bundle.days.map((day) => {
    const rows = bundle.mealRows.filter((r) => r.date === day.meal_date);
    return { key: day.meal_date, date: day.meal_date, status: day.status, breakfast: rows.reduce((s, r) => s + Number(r.breakfast || 0), 0), lunch: rows.reduce((s, r) => s + Number(r.lunch || 0), 0), dinner: rows.reduce((s, r) => s + Number(r.dinner || 0), 0) };
  });

  const memberTotals = bundle.members.map((member) => {
    const rows = bundle.mealRows.filter((r) => r.memberId === member.membership_id);
    return { key: member.membership_id, name: member.member_name, breakfast: rows.reduce((s,r)=>s+Number(r.breakfast||0),0), lunch: rows.reduce((s,r)=>s+Number(r.lunch||0),0), dinner: rows.reduce((s,r)=>s+Number(r.dinner||0),0) };
  }).filter((r) => r.breakfast + r.lunch + r.dinner > 0);

  const selectedMember = selectedMemberId ? bundle.members.find((member) => member.membership_id === selectedMemberId) : null;
  const filteredMealRows = selectedMemberId ? bundle.mealRows.filter((row) => row.memberId === selectedMemberId) : bundle.mealRows;
  const filteredDays = bundle.days.filter((day) => filteredMealRows.some((row) => row.date === day.meal_date));
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
      const allDays = [...bundle.days].sort((a, b) => String(a.meal_date).localeCompare(String(b.meal_date)));
      const recordLookup = new Map(bundle.mealRows.map((row) => [`${row.memberId}:${row.date}`, row]));
      const compact = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
      const matrixHead = `<tr><th>সদস্য</th>${allDays.map((day) => `<th title="${escapeReportHtml(day.meal_date)}">${escapeReportHtml(String(Number(day.meal_date.slice(-2))))}</th>`).join('')}</tr>`;
      const matrixBody = bundle.members.map((member) => `<tr><td>${escapeReportHtml(member.member_name || 'সদস্য')}</td>${allDays.map((day) => {
        const meal = recordLookup.get(`${member.membership_id}:${day.meal_date}`);
        return `<td>${meal ? `${compact(meal.breakfast)}/${compact(meal.lunch)}/${compact(meal.dinner)}` : '—'}</td>`;
      }).join('')}</tr>`).join('');
      const matrix = `<p class="report-note">প্রতি ঘরে: সকাল / দুপুর / রাত · উপরের কলামে দিনের তারিখ।</p><table class="meal-matrix"><thead>${matrixHead}</thead><tbody>${matrixBody}</tbody></table>`;
      const memberTotal = selectedMember ? memberTotals.find((row) => row.key === selectedMemberId) : null;
      const memberSummary = memberTotal ? `<p><strong>${escapeReportHtml(memberTotal.name)}</strong> — সকালের মিল ${memberTotal.breakfast}, দুপুরের মিল ${memberTotal.lunch}, রাতের মিল ${memberTotal.dinner}, মোট ${memberTotal.breakfast + memberTotal.lunch + memberTotal.dinner}</p>` : '<p>সব সদস্য</p>' ;
      const reportManager = (bundle.members || []).find((member) => member.is_primary_manager || member.role === 'manager');
      const personalTable = `<table><thead><tr><th>তারিখ</th><th>অবস্থা</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${rows}</tbody></table>`;
      printReport(`মিল শিট — ${bundle.period.label}${selectedMember ? ` — ${selectedMember.member_name}` : ''}`, `${formatDateBangla(bundle.period.start_date)} → ${formatDateBangla(bundle.period.end_date)}`, selectedMember ? `${memberSummary}${personalTable}` : matrix, null, { periodLabel: bundle.period.label, managerName: reportManager?.member_name || '', managerPhone: reportManager?.phone || '', pageOrientation: selectedMember ? 'portrait' : 'landscape' });
    } catch (error) { toast.error(error.message || 'রিপোর্ট প্রিন্ট করা যায়নি।'); }
    finally { setPrintBusy(false); }
  };

  return (
    <div className="page-stack"><PageHeader title="মিল শিট" icon="history" eyebrow="মিলের বিস্তারিত" description={`${bundle.period.label} — দৈনিক মিলের সারসংক্ষেপ এবং সদস্যভিত্তিক মোট হিসাব।`} />
      <section className="card report-toolbar"><div><strong>{bundle.period.label}</strong><small>{formatDateBangla(bundle.period.start_date)} → {formatDateBangla(bundle.period.end_date)}</small></div><div className="report-actions"><label className="field-label report-member-filter"><span>সদস্য</span><select value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}><option value="">সবাই</option>{bundle.members.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select></label><button className="secondary-button compact report-pdf-button" type="button" disabled={printBusy} onClick={print}><Icon name="file-text" size={15} /> পিডিএফ সংরক্ষণ</button></div></section>
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

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>রিপোর্ট দেখতে ইন্টারনেট চালু করুন</h2><p>রিপোর্ট অনলাইনেই তৈরি হয়।</p></div></div>;
  if (loading) return <LoadingSpinner label="রিপোর্টের তথ্য প্রস্তুত হচ্ছে..." />;
  if (!bundle) return <div className="empty-state-card"><Icon name="download" size={28} /><strong>রিপোর্টের জন্য কোনো চলমান মাস নেই</strong><span>নতুন মাস শুরু হলে রিপোর্ট তৈরি করা যাবে।</span></div>;

  const meals = calculateMealTotals(bundle.mealRows);
  const dailyRows = buildDailyMealRows(bundle.days, bundle.mealRows);
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
  const reportSubtitle = `${formatDateBangla(bundle.period.start_date)} থেকে ${formatDateBangla(bundle.period.end_date)} পর্যন্ত · ${bundle.period.label}`;
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
      <p className="report-page-note">সব রিপোর্টে প্রতিবেদন প্রস্তুতের তারিখ ও সময় এবং বর্তমান বছর অনুযায়ী কপিরাইট দেখানো হয়। খালার পারিশ্রমিক মেসের আলাদা খরচ; এটি কোনো সদস্যের ব্যক্তিগত ব্যালেন্সে যোগ হয় না।</p>
    </div>
  );
}
