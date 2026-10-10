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
  fetchMonthManagementContext,
  fetchPeriodAssistants,
  grantArchiveEditPermission,
  reactivateMember,
  reopenArchivedPeriod,
  regenerateJoinCode,
  revokeArchiveEditPermission,
  saveManagerMyMeal,
  setPeriodAssistants,
  setRunningPeriodEndDate,
  updateHostel,
  voidKhalaMoney,
} from '../../services/managerService';
import { fetchKhalaMoneyHistory, fetchPreviousMonths, fetchArchivedMonthDetail } from '../../services/historyService';
import { buildDailyMealRows, buildMemberSettlementRows, calculateMealTotals, downloadCsv, fetchCurrentReportBundle, getActiveMarketRows, getReportFilename, getVoidMarketRows, mergeFinancialRows, openPrintReportWindow, printReport, summarizeFinancialRows } from '../../services/reportService';
import { fetchManagerMemberDirectory, fetchMonthClosePreflight } from '../../services/diningService';
import { formatDateBangla, formatDateWithWeekday, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';


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

function PageHeader({ title, description, icon = 'shield' }) {
  return (
    <div className="page-title-row manager-page-title">
      <div>
        <button className="secondary-button compact back-button" type="button" onClick={() => navigateTo('/app/dashboard')}>
          <Icon name="arrow-left" size={15} /> ফিরে যান
        </button>
        <div className="manager-eyebrow"><Icon name={icon} size={13} /> ম্যানেজার ফিচার</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
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
  const [startDate, setStartDate] = useState(toDateInputValue());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMonthManagementContext();
      if (data) {
        setStartDate(data.next_required_start_date || toDateInputValue());
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নতুন মাসের তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="নতুন মাস শুরু করতে অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="নতুন মাসের নিয়ম যাচাই হচ্ছে..." />;

  const requiredStart = context?.next_required_start_date || '';
  const hasRunning = Boolean(context?.has_running_period);
  const canStart = Boolean(isPrimaryManager && !hasRunning && requiredStart && startDate === requiredStart);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await startNewMonth(startDate);
      setConfirmOpen(false);
      toast.success(`${result?.label || 'নতুন মাস'} সফলভাবে শুরু হয়েছে।`);
      await refresh();
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নতুন মাস শুরু করা যায়নি।'));
    } finally { setBusy(false); }
  };

  return (
    <PrimaryManagerGuard>
      <div className="page-stack">
        <PageHeader title="নতুন মাস শুরু" icon="calendar" description="বন্ধ হওয়া মাসের পরের দিন থেকে নতুন চলমান মাস শুরু হবে।" />
        <section className="card manager-form-card">
          {hasRunning ? (
            <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>আগের মাস এখনও চলমান।</strong><p>নতুন মাস শুরু করার আগে বর্তমান মাস বন্ধ করুন।</p></div></div>
          ) : (
            <>
              <div className="manager-current-period"><span>নতুন মাসের নির্ধারিত শুরুর তারিখ</span><strong>{formatDateBangla(requiredStart)}</strong><small>শুরুর তারিখ সিস্টেম নিজে নির্ধারণ করেছে। এটি পরিবর্তন করা যাবে না।</small></div>
              <label className="field-label"><span>শুরুর তারিখ</span><input type="date" value={startDate} min={requiredStart} max={requiredStart} readOnly /></label>
              <div className="form-hint"><Icon name="info" size={15} /> শেষ তারিখ আলাদা কোনো তারিখ দিয়ে এখানে দেওয়া হবে না। নতুন period-এর default end হবে ওই calendar month-এর শেষ দিন।</div>
              <button className="primary-button large" type="button" disabled={!canStart || busy} onClick={() => setConfirmOpen(true)}><Icon name="calendar" size={17} /> নতুন মাস শুরু করুন</button>
            </>
          )}
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
      const [data, preflightData] = await Promise.all([fetchMonthManagementContext(), fetchMonthClosePreflight().catch(() => null)]);
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
  }, [toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="মাস বন্ধ করতে অনলাইন সংযোগ প্রয়োজন।" />;
  if (loading) return <LoadingSpinner label="বর্তমান মাস লোড হচ্ছে..." />;
  if (!context?.has_running_period || !context?.period) {
    return <div className="state-card state-card-warning"><Icon name="calendar" size={27} /><div><h2>কোনো চলমান মাস নেই</h2><p>নতুন মাস শুরু করতে ৩ লাইনের মেনু থেকে নতুন মাস শুরু করুন ব্যবহার করুন।</p></div></div>;
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
      await refresh();
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
          {preflight?.running_period_count > 1 && <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>মেসে একাধিক running month পাওয়া গেছে।</strong><p>নতুন মাস শুরু করবেন না। আগে এই ডাটার অবস্থা যাচাই করতে হবে।</p></div></div>}
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
              return <label className={`assistant-choice-card ${checked ? 'selected' : ''}`} key={member.membership_id}><input type="checkbox" checked={checked} onChange={() => toggle(member.membership_id)} /><span className="assistant-choice-avatar">{member.member_name?.trim()?.[0] || 'স'}</span><span><strong>{member.member_name}</strong><small>{checked ? 'সহকারী ম্যানেজার' : 'সদস্য'}</small></span></label>;
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
  const [members, setMembers] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [rows, setRows] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState({ memberId: '', amount: '', paymentDate: toDateInputValue(), description: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, periodRows, khalaRows] = await Promise.all([
        fetchManagerMemberDirectory(),
        fetchKhalaPeriods(),
        fetchKhalaMoneyHistory({ limit: 300 }),
      ]);
      setMembers(memberRows);
      setPeriods(periodRows);
      const currentPeriod = context?.period?.period_id;
      setPeriodId((currentPeriod && periodRows.some((p) => p.period_id === currentPeriod)) ? currentPeriod : (periodRows[0]?.period_id || ''));
      setRows(khalaRows);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [context?.period?.period_id, toast]);

  useEffect(() => { if (online && isOperationalManager) load(); }, [online, isOperationalManager, load]);

  const activeMembers = useMemo(() => members.filter((m) => m.member_status === 'active'), [members]);
  const selectedPeriod = periods.find((p) => p.period_id === periodId) || null;
  const visibleRows = selectedPeriod ? rows.filter((row) => row.period_id === selectedPeriod.period_id) : rows;
  const total = visibleRows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  useEffect(() => {
    if (!form.memberId) setForm((current) => ({ ...current, memberId: activeMembers[0]?.membership_id || '' }));
  }, [activeMembers, form.memberId]);

  useEffect(() => {
    if (selectedPeriod) setForm((current) => ({ ...current, paymentDate: current.paymentDate || toDateInputValue() }));
  }, [selectedPeriod]);

  const save = async (event) => {
    event.preventDefault();
    if (!periodId) return toast.warning('কাজের মাস নির্বাচন করুন।');
    if (!form.memberId) return toast.warning('সদস্য নির্বাচন করুন।');
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.warning('টাকার পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!form.paymentDate) return toast.warning('প্রদানের তারিখ নির্বাচন করুন।');
    if (form.paymentDate > toDateInputValue()) return toast.warning('প্রদানের তারিখ ভবিষ্যতের হতে পারবে না।');
    setBusy(true);
    try {
      await addKhalaMoney({ periodId, memberId: form.memberId, amount, paymentDate: form.paymentDate, description: form.description.trim() || null });
      toast.success('খালার টাকার এন্ট্রি সফলভাবে যোগ হয়েছে।');
      setForm((current) => ({ ...current, amount: '', description: '' }));
      await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'খালার টাকার এন্ট্রি যোগ করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) return toast.warning('মুছে ফেলার কারণ লিখুন।');
    setBusy(true);
    try {
      await voidKhalaMoney(voidTarget.entry_id, voidReason.trim());
      toast.success('খালার টাকার এন্ট্রি সফলভাবে মুছে দেওয়া হয়েছে।');
      setVoidTarget(null); setVoidReason(''); await load();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'এন্ট্রিটি মুছে ফেলা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (!online) return <AccessNotice title="ইন্টারনেট চালু করুন" text="খালার টাকার তথ্য অনলাইনে দেখা ও যোগ করা যাবে।" />;
  if (!isOperationalManager) return <AccessNotice title="অনুমতি নেই" text="খালার টাকার entry ম্যানেজার বা সহকারী ম্যানেজারের জন্য।" />;
  if (loading) return <LoadingSpinner label="খালার টাকার তথ্য লোড হচ্ছে..." />;

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="খালার টাকা" icon="dining" description={isPrimaryManager ? 'কাজের মাস নির্বাচন করে খালার টাকার এন্ট্রি দিন।' : 'আপনার জন্য অনুমোদিত কাজের মাস অনুযায়ী খালার টাকার এন্ট্রি দিন।'} />
        {periods.length === 0 ? (
          <div className="empty-state-card"><Icon name="wallet" size={26} /><strong>এখনো কোনো কাজের মাস পাওয়া যায়নি</strong><span>বর্তমান বা নির্ধারিত পুরোনো মাস থাকলে এখানে দেখা যাবে।</span></div>
        ) : (
          <>
            <form className="card manager-form-card" onSubmit={save}>
              <div className="form-grid-2">
                <label className="field-label"><span>কাজের মাস</span><select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((period) => <option key={period.period_id} value={period.period_id}>{period.label}</option>)}</select></label>
                <label className="field-label"><span>প্রদানের তারিখ</span><input type="date" max={toDateInputValue()} min={selectedPeriod?.start_date || undefined} value={form.paymentDate} onChange={(e) => setForm((current) => ({ ...current, paymentDate: e.target.value }))} /></label>
              </div>
              {selectedPeriod && <div className="form-hint"><Icon name="info" size={15} /> কাজের মাস: <strong>{selectedPeriod.label}</strong> · প্রদানের তারিখ আলাদা হতে পারে, কিন্তু ভবিষ্যতের তারিখ দেওয়া যাবে না।</div>}
              <div className="form-grid-2">
                <label className="field-label"><span>সদস্য</span><select value={form.memberId} onChange={(e) => setForm((current) => ({ ...current, memberId: e.target.value }))}>{activeMembers.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select></label>
                <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))} placeholder="০" /></label>
              </div>
              <label className="field-label"><span>বিবরণ <em>(ঐচ্ছিক)</em></span><input value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} placeholder="যেমন: অক্টোবরের মাসিক টাকা" /></label>
              <button className="primary-button large" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'খালার টাকা যোগ করুন'}</button>
            </form>

            <section className="card manager-form-card">
              <div className="section-heading"><div><span className="eyebrow">নির্বাচিত কাজের মাস</span><h2>{selectedPeriod?.label || '—'}</h2></div><strong>{formatCurrency(total)}</strong></div>
              <div className="manager-list-stack">
                {visibleRows.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="wallet" size={24} /><strong>কোনো এন্ট্রি নেই</strong><span>এই কাজের মাসে এখনো খালার টাকার কোনো এন্ট্রি দেওয়া হয়নি।</span></div> : visibleRows.map((row) => (
                  <article className={`card manager-ledger-row ${row.status === 'void' ? 'void-row' : ''}`} key={row.entry_id}>
                    <div><strong>{row.member_name}</strong><small>{formatDateWithWeekday(row.entry_date)} · {formatDateTime12(row.created_at)}</small><span>{row.description || 'কোনো বিবরণ নেই'}</span></div>
                    <strong>{formatCurrency(row.amount)}</strong>
                    {row.status !== 'void' ? <button className="icon-button compact-icon danger-icon" type="button" disabled={busy} onClick={() => { setVoidTarget(row); setVoidReason(''); }} aria-label="মুছে দিন"><Icon name="trash" size={15} /></button> : <span className="member-badge inactive">বাতিল</span>}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        {voidTarget && <ConfirmModal danger title="এই এন্ট্রি মুছে দেবেন?" description={`${voidTarget.member_name}-এর ${formatCurrency(voidTarget.amount)} এন্ট্রি কার্যকর হিসাব থেকে বাদ যাবে। history-তে তার অবস্থার রেকর্ড থাকবে।`} confirmLabel="মুছে দিন" busy={busy} onClose={() => { setVoidTarget(null); setVoidReason(''); }} onConfirm={doVoid}><label className="field-label"><span>মুছে ফেলার কারণ</span><textarea rows="3" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="ভুল এন্ট্রি" /></label></ConfirmModal>}
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
            <button className="primary-button" type="submit" disabled={busy}>Closing manager-কে অনুমতি দিন</button>
          </form>}
      </section>
      <section className="card manager-form-card">
        <div className="section-heading"><div><h2>এই archive-এর access history</h2><small>{formatNumber(activePermissions.length)}টি কার্যকর temporary permission</small></div><button className="secondary-button compact" type="button" onClick={loadPermissions} disabled={permLoading}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
        {activePermissions.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="shield" size={24}/><strong>কোনো active temporary permission নেই</strong><span>Closing manager নিজে মাস বন্ধ করে থাকলে তার নিজের access-এর জন্য আলাদা grant দরকার নেই।</span></div> : <div className="permission-list">{activePermissions.map((permission) => <article className="permission-row" key={permission.id}><div><strong>{memberMap.get(permission.membership_id) || (permission.membership_id === selected?.manager_at_close_membership_id ? selected.manager_at_close_name : 'Closing manager')}</strong><small>দেওয়া হয়েছে: {formatDateTime12(permission.created_at)}</small><span>মেয়াদ: {permission.expires_at ? formatDateTime12(permission.expires_at) : 'মেয়াদ নেই'}</span>{permission.reason && <span>কারণ: {permission.reason}</span>}</div><button className="secondary-button compact danger-outline" type="button" disabled={busy} onClick={() => revoke(permission.id)}>বাতিল করুন</button></article>)}</div>}
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
  if (!bundle) return <div className="empty-state-card"><Icon name="calendar" size={28} /><strong>কোনো running month নেই</strong><span>মিল শিট তৈরি করার জন্য একটি চলমান মাস থাকতে হবে।</span></div>;

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

  const download = () => downloadCsv(`hostel-life-meal-sheet-${bundle.period.label}${selectedMember ? `-${selectedMember.member_name}` : ''}.csv`, [
    { label: 'তারিখ', value: (r) => formatDateWithWeekday(r.date) },
    { label: 'অবস্থা', value: (r) => r.status },
    { label: 'ব্রেকফাস্ট', value: (r) => r.breakfast },
    { label: 'লাঞ্চ', value: (r) => r.lunch },
    { label: 'ডিনার', value: (r) => r.dinner },
    { label: 'মোট', value: (r) => Number(r.breakfast) + Number(r.lunch) + Number(r.dinner) },
  ], filteredDailyTotals);

  const print = () => {
    setPrintBusy(true);
    try {
      const rows = filteredDailyTotals.map((r) => `<tr><td>${formatDateWithWeekday(r.date)}</td><td>${r.status}</td><td>${r.breakfast}</td><td>${r.lunch}</td><td>${r.dinner}</td><td>${r.breakfast+r.lunch+r.dinner}</td></tr>`).join('');
      const memberTotal = selectedMember ? memberTotals.find((row) => row.key === selectedMemberId) : null;
      const memberSummary = memberTotal ? `<p><strong>${memberTotal.name}</strong> — ব্রেকফাস্ট ${memberTotal.breakfast}, লাঞ্চ ${memberTotal.lunch}, ডিনার ${memberTotal.dinner}, মোট ${memberTotal.breakfast + memberTotal.lunch + memberTotal.dinner}</p>` : '<p>সব সদস্য</p>' ;
      printReport(`মিল শিট — ${bundle.period.label}${selectedMember ? ` — ${selectedMember.member_name}` : ''}`, `${formatDateBangla(bundle.period.start_date)} → ${formatDateBangla(bundle.period.end_date)}`, `${memberSummary}<table><thead><tr><th>তারিখ</th><th>অবস্থা</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${rows}</tbody></table>`);
    } catch (error) { toast.error(error.message || 'রিপোর্ট প্রিন্ট করা যায়নি।'); }
    finally { setPrintBusy(false); }
  };

  return (
    <div className="page-stack"><PageHeader title="মিল শিট" icon="history" description={`${bundle.period.label} — দৈনিক মিলের সারসংক্ষেপ এবং সদস্যভিত্তিক মোট হিসাব।`} />
      <section className="card report-toolbar"><div><strong>{bundle.period.label}</strong><small>{formatDateBangla(bundle.period.start_date)} → {formatDateBangla(bundle.period.end_date)}</small></div><div className="report-actions"><label className="field-label report-member-filter"><span>সদস্য</span><select value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}><option value="">সবাই</option>{bundle.members.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select></label><button className="secondary-button compact" type="button" onClick={download}><Icon name="download" size={15} /> CSV</button><button className="primary-button compact" type="button" disabled={printBusy} onClick={print}><Icon name="file-text" size={15} /> প্রিন্ট / PDF</button></div></section>
      <section className="card report-section-card"><div className="section-heading"><h2>দৈনিক মিল{selectedMember ? ` — ${selectedMember.member_name}` : ''}</h2><span>{formatNumber(filteredDailyTotals.length)} দিন</span></div><Table columns={[{key:'date',label:'তারিখ',render:(r)=>formatDateWithWeekday(r.date)},{key:'status',label:'অবস্থা'},{key:'breakfast',label:'ব্রেকফাস্ট',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'লাঞ্চ',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'ডিনার',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(Number(r.breakfast)+Number(r.lunch)+Number(r.dinner))}]} rows={filteredDailyTotals} /></section>
      <section className="card report-section-card"><div className="section-heading"><h2>সদস্যভিত্তিক মোট</h2><span>{formatNumber(memberTotals.length)} জন</span></div><Table columns={[{key:'name',label:'সদস্য'},{key:'breakfast',label:'ব্রেকফাস্ট',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'লাঞ্চ',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'ডিনার',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(r.breakfast+r.lunch+r.dinner)}]} rows={memberTotals} /></section>
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
  if (loading) return <LoadingSpinner label="রিপোর্ট ডাটা প্রস্তুত হচ্ছে..." />;
  if (!bundle) return <div className="empty-state-card"><Icon name="download" size={28} /><strong>রিপোর্টের জন্য running month নেই</strong><span>নতুন মাস শুরু হলে রিপোর্ট তৈরি করা যাবে।</span></div>;

  const meals = calculateMealTotals(bundle.mealRows);
  const dailyRows = buildDailyMealRows(bundle.days, bundle.mealRows);
  const members = buildMemberSettlementRows(bundle.members);
  const activeMarkets = getActiveMarketRows(bundle.marketRows);
  const voidMarkets = getVoidMarketRows(bundle.marketRows);
  const financialRows = mergeFinancialRows(bundle.accountRows, bundle.khalaRows);
  const finances = summarizeFinancialRows(financialRows);
  const totalMarket = activeMarkets.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const marketDeposit = activeMarkets.filter((row) => row.credit_to_buyer).reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const negativeBalances = members.filter((row) => row.balance < 0);
  const positiveBalances = members.filter((row) => row.balance > 0);

  const runExport = (callback) => {
    setExportBusy(true);
    try { callback(); } catch (error) { toast.error(error.message || 'রিপোর্ট তৈরি করা যায়নি।'); }
    finally { window.setTimeout(() => setExportBusy(false), 350); }
  };

  const downloadMeal = () => downloadCsv(`${getReportFilename('meals', bundle.period.label)}.csv`, [
    { label:'তারিখ', value:r=>formatDateWithWeekday(r.date) },
    { label:'সদস্য', value:r=>r.memberName },
    { label:'ব্রেকফাস্ট', value:r=>r.breakfast },
    { label:'লাঞ্চ', value:r=>r.lunch },
    { label:'ডিনার', value:r=>r.dinner },
    { label:'মোট', value:r=>Number(r.breakfast)+Number(r.lunch)+Number(r.dinner) },
    { label:'ফাইনাল', value:r=>r.finalized?'হ্যাঁ':'না' },
  ], bundle.mealRows.filter((r)=>r.date));

  const downloadMarket = () => downloadCsv(`${getReportFilename('market', bundle.period.label)}.csv`, [
    { label:'তারিখ', value:r=>formatDateWithWeekday(r.entry_date) },
    { label:'বাজারকারী', value:r=>r.buyer_name },
    { label:'মোট', value:r=>r.total_amount },
    { label:'অবস্থা', value:r=>r.status === 'void' ? 'বাতিল' : 'active' },
    { label:'ডিপোজিটে যুক্ত', value:r=>r.credit_to_buyer?'হ্যাঁ':'না' },
    { label:'আইটেম সংখ্যা', value:r=>Array.isArray(r.items)?r.items.length:0 },
  ], bundle.marketRows);

  const downloadAccount = () => downloadCsv(`${getReportFilename('account', bundle.period.label)}.csv`, [
    { label:'এন্ট্রির তারিখ', value:r=>formatDateWithWeekday(r.entry_date || r.created_at) },
    { label:'সদস্য', value:r=>r.member_name },
    { label:'ধরন', value:r=>r.transaction_type },
    { label:'পরিমাণ', value:r=>r.amount },
    { label:'বিবরণ', value:r=>r.description || '' },
  ], financialRows);

  const downloadSettlement = () => downloadCsv(`${getReportFilename('member-settlement', bundle.period.label)}.csv`, [
    { label:'সদস্য', value:r=>r.name },
    { label:'স্ট্যাটাস', value:r=>r.status === 'active' ? 'active' : 'inactive' },
    { label:'মোট মিল', value:r=>r.meals },
    { label:'ডিপোজিট', value:r=>r.deposit },
    { label:'মিল খরচ', value:r=>r.mealCost },
    { label:'অন্যান্য খরচ', value:r=>r.otherExpense },
    { label:'ব্যালেন্স', value:r=>r.balance },
  ], members);

  const printFullReport = (existingWindow = null) => {
    const memberRows = members.map((row)=>`<tr><td>${row.name}</td><td>${row.meals}</td><td>${formatCurrency(row.deposit)}</td><td>${formatCurrency(row.mealCost)}</td><td>${formatCurrency(row.otherExpense)}</td><td>${formatCurrency(row.balance)}</td></tr>`).join('');
    const daily = dailyRows.map((row)=>`<tr><td>${formatDateWithWeekday(row.date)}</td><td>${row.status}</td><td>${row.breakfast}</td><td>${row.lunch}</td><td>${row.dinner}</td><td>${row.breakfast+row.lunch+row.dinner}</td></tr>`).join('');
    const html = `<h2>মাসিক সারসংক্ষেপ</h2><table><tr><th>বিষয়</th><th>পরিমাণ</th></tr><tr><td>মোট মিল</td><td>${meals.total}</td></tr><tr><td>সক্রিয় বাজার</td><td>${formatCurrency(totalMarket)}</td></tr><tr><td>বাজার থেকে জমায় যুক্ত</td><td>${formatCurrency(marketDeposit)}</td></tr><tr><td>মোট ইনফ্লো</td><td>${formatCurrency(finances.inflow)}</td></tr><tr><td>মোট আউটফ্লো</td><td>${formatCurrency(finances.outflow)}</td></tr><tr><td>নেট</td><td>${formatCurrency(finances.net)}</td></tr><tr><td>মিল রেট</td><td>৳${formatNumber(bundle.period && meals.total > 0 ? totalMarket / meals.total : 0, { maximumFractionDigits: 4 })}</td></tr></table><br/><h2>সদস্যভিত্তিক settlement</h2><table><thead><tr><th>সদস্য</th><th>মিল</th><th>ডিপোজিট</th><th>মিল খরচ</th><th>অন্যান্য খরচ</th><th>ব্যালেন্স</th></tr></thead><tbody>${memberRows}</tbody></table><br/><h2>দৈনিক মিল</h2><table><thead><tr><th>তারিখ</th><th>অবস্থা</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${daily}</tbody></table>`;
    printReport(`Hostel Life — ${bundle.period.label} পূর্ণ রিপোর্ট`, `${formatDateBangla(bundle.period.start_date)} → ${formatDateBangla(bundle.period.end_date)}`, html, existingWindow);
  };

  const startPdfExport = () => {
    try {
      const printWindow = openPrintReportWindow();
      setExportBusy(true);
      printFullReport(printWindow);
    } catch (error) {
      toast.error(error.message || 'রিপোর্টের PDF উইন্ডো খোলা যায়নি।');
    } finally {
      window.setTimeout(() => setExportBusy(false), 350);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader title="রিপোর্ট কেন্দ্র" icon="download" description="বর্তমান মাসের মিল, বাজার, হিসাব ও সদস্যভিত্তিক settlement এক জায়গা থেকে CSV বা PDF হিসেবে নিন।" />
      <section className="report-kpi-grid">
        <div className="card report-kpi"><span>মোট মিল</span><strong>{formatNumber(meals.total)}</strong><small>ব্রেকফাস্ট {formatNumber(meals.breakfast)} · লাঞ্চ {formatNumber(meals.lunch)} · ডিনার {formatNumber(meals.dinner)}</small></div>
        <div className="card report-kpi"><span>সক্রিয় বাজার</span><strong>{formatCurrency(totalMarket)}</strong><small>{formatNumber(activeMarkets.length)}টি active · {formatNumber(voidMarkets.length)}টি বাতিল</small></div>
        <div className="card report-kpi"><span>মোট ইনফ্লো</span><strong>{formatCurrency(finances.inflow)}</strong><small>ডিপোজিট + adjustment</small></div>
        <div className="card report-kpi"><span>মোট আউটফ্লো</span><strong>{formatCurrency(finances.outflow)}</strong><small>খরচ + negative adjustment</small></div>
      </section>
      <section className="card report-health-card">
        <div><span className="eyebrow">হিসাবের অবস্থা</span><h2>মাসিক settlement overview</h2><p>{members.length} জন সদস্য · {negativeBalances.length} জনের due · {positiveBalances.length} জনের refund/credit।</p></div>
        <div className="report-health-metrics"><div><span>Net</span><strong>{formatCurrency(finances.net)}</strong></div><div><span>Market deposit</span><strong>{formatCurrency(marketDeposit)}</strong></div><div><span>Finalized rows</span><strong>{formatNumber(meals.finalizedRows)}</strong></div><div><span>Pending rows</span><strong>{formatNumber(meals.pendingRows)}</strong></div></div>
      </section>
      <div className="report-download-grid">
        <button className="card report-option" type="button" onClick={()=>runExport(downloadMeal)} disabled={exportBusy}><span className="report-option-icon"><Icon name="dining" size={21} /></span><strong>মিল রিপোর্ট</strong><small>প্রতিটি সদস্যের প্রতিদিনের মিল</small><b>CSV</b></button>
        <button className="card report-option" type="button" onClick={()=>runExport(downloadMarket)} disabled={exportBusy}><span className="report-option-icon"><Icon name="shopping-bag" size={21} /></span><strong>বাজার রিপোর্ট</strong><small>active ও বাতিল entry-সহ</small><b>CSV</b></button>
        <button className="card report-option" type="button" onClick={()=>runExport(downloadAccount)} disabled={exportBusy}><span className="report-option-icon"><Icon name="wallet" size={21} /></span><strong>হিসাব রিপোর্ট</strong><small>ডিপোজিট, খরচ, খালা ও adjustment</small><b>CSV</b></button>
        <button className="card report-option" type="button" onClick={()=>runExport(downloadSettlement)} disabled={exportBusy}><span className="report-option-icon"><Icon name="users" size={21} /></span><strong>সদস্য settlement</strong><small>মিল, খরচ ও ব্যালেন্স</small><b>CSV</b></button>
        <button className="card report-option" type="button" onClick={startPdfExport} disabled={exportBusy}><span className="report-option-icon"><Icon name="file-text" size={21} /></span><strong>পূর্ণ মাসিক রিপোর্ট</strong><small>সারসংক্ষেপ + settlement + daily meal</small><b>PDF</b></button>
      </div>
      <section className="card report-section-card"><div className="section-heading"><div><h2>সদস্য settlement</h2><small>বর্তমান month-এর server-calculated meal cost ও balance</small></div><span>{formatNumber(members.length)} জন</span></div><Table columns={[{key:'name',label:'সদস্য'},{key:'meals',label:'মিল',render:(r)=>formatNumber(r.meals)},{key:'deposit',label:'জমা',render:(r)=>formatCurrency(r.deposit)},{key:'mealCost',label:'মিল খরচ',render:(r)=>formatCurrency(r.mealCost)},{key:'otherExpense',label:'অন্যান্য',render:(r)=>formatCurrency(r.otherExpense)},{key:'balance',label:'ব্যালেন্স',render:(r)=>formatCurrency(r.balance)}]} rows={members} /></section>
      <section className="card report-section-card"><div className="section-heading"><div><h2>দৈনিক মিল</h2><small>final থাকলে final value, না থাকলে actual/planned fallback</small></div><span>{formatNumber(dailyRows.length)} দিন</span></div><Table columns={[{key:'date',label:'তারিখ',render:(r)=>formatDateWithWeekday(r.date)},{key:'status',label:'অবস্থা'},{key:'breakfast',label:'ব্রেকফাস্ট',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'লাঞ্চ',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'ডিনার',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(r.breakfast+r.lunch+r.dinner)}]} rows={dailyRows} /></section>
    </div>
  );
}
