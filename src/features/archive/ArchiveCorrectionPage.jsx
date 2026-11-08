import { confirmAction, confirmTypedAction } from '../../utils/actionDialogs';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useManagementContext } from '../../hooks/useManagementContext';
import { useToast } from '../../components/Toast';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { fetchArchiveManagementItems, reopenArchivedPeriod } from '../../services/managerService';
import { fetchArchivedMonthDetail, fetchMyArchiveEditablePeriods, fetchPreviousMonths } from '../../services/historyService';
import { getArchiveCorrectionBundle, applyArchiveCorrection, isCorrectionBackendMissing } from '../../services/archiveCorrectionService';
import { navigateTo } from '../../app/AppShell';
import { formatDateBangla, formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import './archive-correction.css';

const EDIT_KINDS = [
  ['final_meal', 'ফাইনাল মিল'], ['market', 'বাজার'], ['deposit', 'জমা'],
  ['other_expense', 'অন্যান্য খরচ'], ['khala', 'খালার টাকা'],
];
const FIELDS = {
  final_meal: [['final_breakfast', 'ব্রেকফাস্ট'], ['final_lunch', 'লাঞ্চ'], ['final_dinner', 'ডিনার']],
  market: [['total_amount', 'মোট টাকা']],
  deposit: [['amount', 'টাকার পরিমাণ']],
  other_expense: [['amount', 'টাকার পরিমাণ']],
  khala: [['amount', 'টাকার পরিমাণ']],
};
const MAX_REASON = 500;
function isFiniteNumber(value) { return value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
function arr(value) { return Array.isArray(value) ? value : []; }
function dateOf(row, kind) { return String(row?.meal_date || row?.entry_date || row?.payment_date || '').slice(0, 10); }
function rowTitle(row, kind) {
  if (kind === 'final_meal') return row?.member_name || 'সদস্য';
  if (kind === 'market') return row?.name || row?.buyer_name || 'বাজার এন্ট্রি';
  if (kind === 'deposit') return row?.member_name || 'জমা';
  if (kind === 'other_expense') return row?.description || 'অন্যান্য খরচ';
  if (kind === 'khala') return row?.description || row?.member_name || 'খালার টাকা';
  return row?.member_name || row?.description || row?.name || 'এন্ট্রি';
}
function rowSubtitle(row, kind) {
  const date = dateOf(row, kind);
  if (kind === 'final_meal') {
    const total = Number(row.final_breakfast || 0) + Number(row.final_lunch || 0) + Number(row.final_dinner || 0);
    return `${date ? formatDateWithWeekday(date) : 'তারিখ নেই'} · ব্রেকফাস্ট ${formatNumber(row.final_breakfast)} + লাঞ্চ ${formatNumber(row.final_lunch)} + ডিনার ${formatNumber(row.final_dinner)} = ${formatNumber(total)} মিল`;
  }
  const amount = kind === 'market' ? row.total_amount : row.amount;
  const amountText = amount == null ? '' : ` · ${formatCurrency(amount)}`;
  const countText = kind === 'market' && row.item_count != null ? ` · ${formatNumber(row.item_count)}টি আইটেম` : '';
  return `${date ? formatDateWithWeekday(date) : 'তারিখ নেই'}${amountText}${countText}`;
}
function Section({ title, children, className = '' }) {
  return <section className={`card archive-correction-section ${className}`}><h2>{title}</h2>{children}</section>;
}
function SummaryMetrics({ detail }) {
  if (!detail || typeof detail !== 'object') return null;
  const hasDetails = Array.isArray(detail.markets) || Array.isArray(detail.meals) || Array.isArray(detail.ledger);
  const markets = arr(detail.markets).filter(row => row.status !== 'void');
  const meals = arr(detail.meals);
  const totalMarket = markets.reduce((sum, row) => sum + Number(row.total || row.total_amount || 0), 0);
  const totalMeals = meals.reduce((sum, row) => sum + Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0), 0);
  if (hasDetails) return <div className="archive-correction-metrics">
    <div className="metric"><span>মোট বাজার</span><strong>{formatCurrency(totalMarket)}</strong></div>
    <div className="metric"><span>মোট মিল</span><strong>{formatNumber(totalMeals)}</strong></div>
    <div className="metric"><span>লেনদেন</span><strong>{formatNumber(arr(detail.ledger).length)}</strong></div>
  </div>;
  return <div className="archive-correction-metrics">
    <div className="metric"><span>মোট জমা</span><strong>{formatCurrency(detail.total_deposit)}</strong></div>
    <div className="metric"><span>মোট বাজার</span><strong>{formatCurrency(detail.total_market_expense)}</strong></div>
    <div className="metric"><span>মোট মিল</span><strong>{formatNumber(detail.total_meals)}</strong></div>
    <div className="metric"><span>মিল রেট</span><strong>{formatCurrency(detail.meal_rate)}</strong></div>
    <div className="metric"><span>অবশিষ্ট ফান্ড</span><strong>{formatCurrency(detail.fund_remaining)}</strong></div>
  </div>;
}
function ReadOnlyReport({ detail }) {
  const [activeTab, setActiveTab] = useState('overview');
  useEffect(() => { setActiveTab('overview'); }, [detail?.period_id, detail?.label, detail?.start_date, detail?.end_date]);
  if (!detail) return <div className="state-card state-card-warning"><Icon name="info" size={20}/><div><strong>রিপোর্টের বিস্তারিত পাওয়া যায়নি</strong><p>মাসের তালিকা আছে, কিন্তু এই মাসের বিস্তারিত রিপোর্ট RPC থেকে পাওয়া যায়নি। পরে আবার চেষ্টা করুন।</p></div></div>;
  const markets = arr(detail.markets);
  const meals = arr(detail.meals);
  const ledger = arr(detail.ledger);
  const visibleAudit = arr(detail.edit_audit).slice(0, 10);
  const detailed = Array.isArray(detail.markets) || Array.isArray(detail.meals) || Array.isArray(detail.ledger);
  const tabs = [
    ['overview', 'সারাংশ', null],
    ...(detailed ? [['market', 'বাজার', markets.length], ['meals', 'ফাইনাল মিল', meals.length], ['ledger', 'লেনদেন', ledger.length]] : []),
    ...(visibleAudit.length ? [['audit', 'সংশোধন ইতিহাস', visibleAudit.length]] : []),
  ];
  const Empty = ({ title, description }) => <div className="archive-category-empty"><span><Icon name="check-circle" size={19}/></span><div><strong>{title}</strong><p>{description}</p></div></div>;
  return <div className="archive-readonly-content">
    <nav className="archive-kind-tabs" aria-label="আর্কাইভ রিপোর্টের বিভাগ">
      {tabs.map(([key, label, count]) => <button type="button" key={key} className={activeTab === key ? 'is-active' : ''} aria-pressed={activeTab === key} onClick={() => setActiveTab(key)}><span>{label}</span>{count != null && <b>{formatNumber(count)}</b>}</button>)}
    </nav>
    {activeTab === 'overview' && <>
      <SummaryMetrics detail={detail}/>
      {detailed ? <Section title="এই মাসের রিপোর্ট"><div className="archive-correction-metrics archive-readonly-counts"><div className="metric"><span>বাজার এন্ট্রি</span><strong>{formatNumber(markets.length)}</strong></div><div className="metric"><span>মিলের দিন</span><strong>{formatNumber(meals.length)}</strong></div><div className="metric"><span>লেনদেন</span><strong>{formatNumber(ledger.length)}</strong></div></div><p className="form-hint">বিস্তারিত দেখতে উপরের বিভাগ নির্বাচন করুন। এটি শুধু দেখার রিপোর্ট; এখান থেকে কোনো হিসাব পরিবর্তন করা যাবে না।</p></Section> : <div className="state-card"><Icon name="file-text" size={20}/><div><strong>মাসের সারসংক্ষেপ</strong><p>এই মাসের বিস্তারিত লেনদেন সংরক্ষণনীতি অনুযায়ী সীমিত হতে পারে।</p></div></div>}
      {visibleAudit.length > 0 && <Section title="সাম্প্রতিক সংশোধন"><div className="archive-correction-records">{visibleAudit.slice(0, 3).map((entry, index) => <article className="archive-correction-record archive-audit-record" key={entry.id || index}><span className="archive-record-kind-icon"><Icon name="history" size={18}/></span><div className="archive-record-main"><strong>{entry.summary || entry.action || 'হিসাব সংশোধন'}</strong><small>{entry.actor_name || 'ম্যানেজার'} · {entry.created_at ? formatDateTime12(entry.created_at) : ''}</small></div></article>)}</div></Section>}
    </>}
    {activeTab === 'market' && <Section title={`বাজার (${formatNumber(markets.length)}টি)`}>
      {markets.length ? <div className="archive-correction-records">{markets.map((row, index) => <article className="archive-correction-record" key={row.id || index}><span className="archive-record-kind-icon"><Icon name="shopping-basket" size={18}/></span><div className="archive-record-main"><strong>{row.member_name || row.buyer_name || row.name || 'বাজার এন্ট্রি'}</strong><small>{formatDateWithWeekday(row.entry_date || row.date)} · {formatCurrency(row.total ?? row.total_amount ?? 0)} · {row.status === 'void' ? 'বাতিল' : 'কার্যকর'}</small></div></article>)}</div> : <Empty title="এই মাসে বাজার এন্ট্রি নেই" description="নির্বাচিত মাসে বাজারের কোনো রেকর্ড পাওয়া যায়নি।"/>}
    </Section>}
    {activeTab === 'meals' && <Section title={`দৈনিক ফাইনাল মিল (${formatNumber(meals.length)} দিন)`}>
      {meals.length ? <div className="archive-correction-records">{meals.map((row, index) => <article className="archive-correction-record" key={row.date || row.meal_date || index}><span className="archive-record-kind-icon"><Icon name="utensils" size={18}/></span><div className="archive-record-main"><strong>{formatDateWithWeekday(row.date || row.meal_date)}</strong><small>ব্রেকফাস্ট {formatNumber(row.breakfast)} + লাঞ্চ {formatNumber(row.lunch)} + ডিনার {formatNumber(row.dinner)} = {formatNumber(Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0))} মিল</small></div></article>)}</div> : <Empty title="ফাইনাল মিলের তথ্য নেই" description="এই মাসের জন্য বিস্তারিত মিলের রেকর্ড পাওয়া যায়নি।"/>}
    </Section>}
    {activeTab === 'ledger' && <Section title={`লেনদেন (${formatNumber(ledger.length)}টি)`}>
      {ledger.length ? <div className="archive-correction-records">{ledger.map((row, index) => <article className="archive-correction-record" key={row.id || index}><span className="archive-record-kind-icon"><Icon name="receipt" size={18}/></span><div className="archive-record-main"><strong>{row.member_name || row.description || row.ledger_type || 'লেনদেন'}</strong><small>{formatDateWithWeekday(row.entry_date || row.payment_date || row.date)} · {formatCurrency(row.amount ?? row.total_amount ?? 0)}</small></div></article>)}</div> : <Empty title="লেনদেন নেই" description="এই মাসের বিস্তারিত লেনদেন পাওয়া যায়নি।"/>}
    </Section>}
    {activeTab === 'audit' && <Section title="সাম্প্রতিক সংশোধন ইতিহাস"><div className="archive-correction-records">{visibleAudit.map((entry, index) => <article className="archive-correction-record archive-audit-record" key={entry.id || index}><span className="archive-record-kind-icon"><Icon name="history" size={18}/></span><div className="archive-record-main"><strong>{entry.summary || entry.action || 'হিসাব সংশোধন'}</strong><small>{entry.actor_name || 'ম্যানেজার'} · {entry.created_at ? formatDateTime12(entry.created_at) : ''}</small>{entry.reason && <p>{entry.reason}</p>}</div></article>)}</div></Section>}
  </div>;
}

export function ArchiveCorrectionPage() {
  const toast = useToast();
  const { isManager } = useAuth();
  const { isPrimaryManager, period } = useManagementContext();
  const primary = period ? Boolean(isPrimaryManager) : Boolean(isManager);
  const [months, setMonths] = useState([]);
  const [editablePeriods, setEditablePeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [detail, setDetail] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [backendMissing, setBackendMissing] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState('');
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeKind, setActiveKind] = useState('all');

  const reloadMonths = useCallback(async () => {
    setLoadingMonths(true);
    try {
      const [rows, editableRows] = await Promise.all([
        primary ? fetchArchiveManagementItems() : fetchPreviousMonths(),
        fetchMyArchiveEditablePeriods().catch(() => []),
      ]);
      const editableIds = new Set((Array.isArray(editableRows) ? editableRows : [])
        .map((row) => String(row?.period_id || row?.id || '')).filter(Boolean));
      setEditablePeriods(Array.isArray(editableRows) ? editableRows : []);
      const unique = new Map();
      for (const row of [...(Array.isArray(rows) ? rows : []), ...(Array.isArray(editableRows) ? editableRows : [])]) {
        const id = row?.period_id || row?.id;
        if (id && ['closed', 'archived'].includes(row.status || 'closed')) {
          const key = String(id);
          const previous = unique.get(key) || {};
          unique.set(key, { ...previous, ...row, period_id: id, can_edit: Boolean(primary || editableIds.has(key)) });
        }
      }
      const safe = [...unique.values()].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
      setMonths(safe);
    } catch (error) {
      toast.error(error.message || 'আর্কাইভ লোড করা যায়নি।');
    } finally { setLoadingMonths(false); }
  }, [primary, toast]);

  useEffect(() => { reloadMonths(); }, [reloadMonths]);

  const openMonth = useCallback(async (row) => {
    const id = String(row?.period_id || row?.id || '');
    if (!id) return;
    setSelectedPeriodId(id);
    setActiveKind('all');
    setDetail(null); setBundle(null); setEditing(null); setBackendMissing(false); setReadOnlyReason('');
    setLoadingDetail(true);
    try {
      const reportPromise = fetchArchivedMonthDetail(id).then(value => ({ ok: true, value })).catch(error => ({ ok: false, error }));
      // Always ask the server for the exact period grant. Only the backend can
      // decide whether this user is its recorded closer or an authorized manager.
      const correctionPromise = (primary || editablePeriods.some((item) => String(item.period_id || item.id) === id))
        ? getArchiveCorrectionBundle(id).then(value => ({ ok: true, value })).catch(error => ({ ok: false, error }))
        : Promise.resolve({ ok: false, readonly: true });
      const [reportResult, correctionResult] = await Promise.all([reportPromise, correctionPromise]);
      if (reportResult.ok) setDetail(reportResult.value);
      else if (!correctionResult.ok) toast.error(reportResult.error?.message || 'এই মাসের রিপোর্ট লোড করা যায়নি।');
      if (correctionResult.ok) setBundle(correctionResult.value);
      else if (correctionResult.readonly) {
        setReadOnlyReason('এই অ্যাকাউন্টে শুধু দেখার অনুমতি আছে। কোনো হিসাব পরিবর্তন করা যাবে না।');
      } else if (isCorrectionBackendMissing(correctionResult.error)) {
        setBackendMissing(true);
        setReadOnlyReason('Archive Correction-এর SQL মডিউল ইনস্টল নেই। তাই এখন মাসটি শুধু দেখা যাবে; পুরোনো Restore বা Permission API দিয়ে পরিবর্তন করা হবে না।');
      } else {
        setReadOnlyReason('এই অ্যাকাউন্টে এই মাসের সংশোধন অনুমোদিত নয়। রিপোর্ট দেখা যাবে, কিন্তু পরিবর্তন করা যাবে না।');
      }
    } finally { setLoadingDetail(false); }
  }, [primary, editablePeriods, toast]);

  const restoreMonth = async () => {
    if (!selected?.can_reopen || busy) return;
    if (!await confirmAction(`“${selected.label}” পুনরায় চলমান করবেন? বন্ধ করার সময় বাতিল হয়ে যাওয়া অনুরোধ স্বয়ংক্রিয়ভাবে ফিরবে না।`)) return;
    setBusy(true);
    try {
      await reopenArchivedPeriod(selected.period_id);
      toast.success('মাসটি পুনরায় চালু হয়েছে। এখন নতুন মাস শুরুর আগে চলমান মাস যাচাই করুন।');
      setSelectedPeriodId(''); setDetail(null); setBundle(null);
      await reloadMonths();
    } catch (error) { toast.error(error?.message || 'মাস পুনরায় চালু করা যায়নি।'); }
    finally { setBusy(false); }
  };
  const selected = months.find(row => String(row.period_id) === String(selectedPeriodId));
  const filteredMonths = months.filter((row) => {
    const query = searchTerm.trim().toLocaleLowerCase();
    if (!query) return true;
    return [row.label, row.start_date, row.end_date].some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  const correctionCounts = Object.fromEntries(EDIT_KINDS.map(([kind]) => [kind, arr(bundle?.[kind] || bundle?.[`${kind}_entries`]).length]));
  const correctionTotal = Object.values(correctionCounts).reduce((sum, value) => sum + value, 0);
  const canEditSelected = Boolean(primary || editablePeriods.some((item) => String(item.period_id || item.id) === String(selectedPeriodId)));
  const closerAccess = Boolean(editablePeriods.some((item) => String(item.period_id || item.id) === String(selectedPeriodId) && item.access_kind === 'closed_by'));
  const detailLabel = selected?.label || bundle?.period?.label || detail?.label || 'আর্কাইভ';
  const detailStart = selected?.start_date || detail?.start_date || bundle?.period?.start_date;
  const detailEnd = selected?.end_date || detail?.end_date || bundle?.period?.end_date;
  const beginEdit = (kind, row) => {
    const initial = Object.fromEntries(FIELDS[kind].map(([key]) => [key, row?.[key] ?? '']));
    setEditing({ kind, targetId: row.id, title: rowTitle(row, kind), itemCount: Number(row.item_count ?? 0) });
    setValues(initial); setReason('');
  };
  const save = async (event) => {
    event.preventDefault();
    if (!editing || busy || !bundle || !canEditSelected) return;
    if (editing.kind === 'market' && editing.itemCount !== 1) return toast.warning('এই বাজার এন্ট্রিতে আইটেমের সংখ্যা এক নয়। মোট টাকা বদলালে আইটেম/জমার হিসাব অসংগত হতে পারে; এটি এখানে সংশোধন করা যাবে না।');
    if (!FIELDS[editing.kind].every(([key]) => isFiniteNumber(values[key]))) return toast.warning('সব ঘরে সঠিক শূন্য বা ধনাত্মক সংখ্যা দিন।');
    if (reason.trim().length < 8 || reason.trim().length > MAX_REASON) return toast.warning('সংশোধনের কারণ ৮–৫০০ অক্ষরের হতে হবে।');
    if (!await confirmAction(`“${selected?.label || ''}” মাসের “${editing.title}” সংশোধন করবেন? আগের ও নতুন মান অডিট লগে থাকবে এবং সদস্যদের জানানো হবে।`)) return;
    setBusy(true);
    try {
      await applyArchiveCorrection({ periodId: selectedPeriodId, kind: editing.kind, targetId: editing.targetId,
        changes: Object.fromEntries(FIELDS[editing.kind].map(([key]) => [key, Number(values[key])])), reason: reason.trim() });
      toast.success('সংশোধন সংরক্ষিত হয়েছে।');
      await openMonth(selected);
    } catch (error) {
      toast.error(isCorrectionBackendMissing(error) ? 'Correction Mode-এর SQL মডিউল ইনস্টল নেই।' : error.message || 'সংশোধন সংরক্ষণ করা যায়নি।');
    } finally { setBusy(false); }
  };



  return <div className="page-stack archive-correction-page">
    <header className="card archive-correction-header">
      <div className="archive-hero-main">
        <div className="archive-hero-mark"><Icon name="history" size={25}/></div>
        <div className="archive-hero-copy">
          <span className="archive-eyebrow">সংরক্ষিত হিসাব</span>
          <h1>আর্কাইভ</h1>
          <p>বন্ধ মাসের রিপোর্ট, দৈনিক মিল ও লেনদেন এক জায়গায় দেখুন। {primary ? 'প্রধান ম্যানেজারের জন্য অনুমোদিত হিসাব-সংশোধনও এখানে রয়েছে।' : 'আপনি যে মাসটি বন্ধ করেছেন, সেই নির্দিষ্ট মাসে অনুমোদিত সংশোধন করতে পারবেন; অন্য মাস শুধু দেখা যাবে।'}</p>
        </div>
      </div>
      <div className="archive-hero-actions">
        <button type="button" className="secondary-button compact" onClick={() => navigateTo('/app/dashboard')}><Icon name="arrow-left" size={15}/> ড্যাশবোর্ড</button>
        <button type="button" className="secondary-button compact" onClick={reloadMonths} disabled={loadingMonths}><Icon name="refresh-cw" size={15}/> {loadingMonths ? 'লোড হচ্ছে...' : 'রিফ্রেশ'}</button>
      </div>
      <div className="archive-hero-stats">
        <div className="archive-hero-stat"><span>সংরক্ষিত মাস</span><strong>{formatNumber(months.length)}</strong><small>বন্ধ হিসাব</small></div>
        <div className="archive-hero-stat"><span>বর্তমান দৃশ্য</span><strong>{selectedPeriodId ? 'রিপোর্ট' : 'তালিকা'}</strong><small>{selectedPeriodId ? 'একটি মাস নির্বাচিত' : 'মাস বেছে নিন'}</small></div>
        <div className="archive-hero-stat"><span>অ্যাক্সেস</span><strong>{primary ? 'সংশোধন' : editablePeriods.length ? 'সীমিত সংশোধন' : 'শুধু দেখা'}</strong><small>{primary ? 'অনুমোদিত সীমার মধ্যে' : editablePeriods.length ? 'নিজের বন্ধ করা মাসে' : 'রিড-অনলি'}</small></div>
      </div>
    </header>

    {!selectedPeriodId && <section className="card archive-list-section">
      <div className="archive-list-heading">
        <div><span className="archive-eyebrow">মাসের তালিকা</span><h2>সংরক্ষিত মাস</h2><p>যে মাসের হিসাব দেখতে চান সেটি খুলুন। পুরোনো মাসের তারিখ বা স্ট্যাটাস এখানে বদলানো হয় না।</p></div>
        <span className="archive-count-pill">{formatNumber(filteredMonths.length)} / {formatNumber(months.length)} মাস</span>
      </div>
      <label className="archive-search-field"><Icon name="search" size={18}/><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="মাসের নাম বা তারিখ লিখে খুঁজুন" aria-label="আর্কাইভের মাস খুঁজুন"/><span>{searchTerm ? 'ফিল্টার চালু' : 'অনুসন্ধান'}</span></label>
      {loadingMonths ? <div className="archive-loading-wrap"><LoadingSpinner label="আর্কাইভের মাস লোড হচ্ছে..."/></div> : months.length === 0 ? <div className="archive-empty-state"><span className="archive-empty-icon"><Icon name="history" size={27}/></span><strong>এখনো কোনো বন্ধ মাস নেই</strong><p>একটি মাস বন্ধ হলে সেটি এখানে সংরক্ষিত হবে।</p><button type="button" className="secondary-button compact" onClick={reloadMonths}>আবার লোড করুন</button></div> : filteredMonths.length === 0 ? <div className="archive-empty-state"><span className="archive-empty-icon"><Icon name="search" size={25}/></span><strong>এই অনুসন্ধানে কোনো মাস পাওয়া যায়নি</strong><p>অন্য মাসের নাম বা তারিখ দিয়ে চেষ্টা করুন।</p><button type="button" className="secondary-button compact" onClick={() => setSearchTerm('')}>অনুসন্ধান মুছুন</button></div> : <div className="archive-month-list">{filteredMonths.map((row, index) => <button key={row.period_id} className="archive-month-card" type="button" onClick={() => openMonth(row)}>
        <span className="archive-month-index">{formatNumber(index + 1)}</span>
        <span className="archive-month-copy"><strong>{row.label || 'সংরক্ষিত মাস'}</strong><small>{formatDateBangla(row.start_date)} – {formatDateBangla(row.end_date)}</small><span><i className="archive-status-dot"/> বন্ধ মাস · রিপোর্ট দেখতে খুলুন</span></span>
        <span className="archive-month-open">রিপোর্ট দেখুন <Icon name="chevron-right" size={17}/></span>
      </button>)}</div>}
    </section>}

    {selectedPeriodId && <>
      <div className="archive-detail-toolbar">
        <button type="button" className="secondary-button compact" onClick={() => { setSelectedPeriodId(''); setDetail(null); setBundle(null); setEditing(null); setActiveKind('all'); }}><Icon name="arrow-left" size={15}/> সব মাস</button>
        <div className="archive-detail-title"><span className="archive-eyebrow">নির্বাচিত মাসের হিসাব</span><h2>{detailLabel}</h2><p>{formatDateBangla(detailStart)} – {formatDateBangla(detailEnd)}</p></div>
        <span className="archive-correction-status"><i className="archive-status-dot"/> মাস বন্ধ</span>
      {primary && selected?.can_reopen && <button type="button" className="primary-button compact" onClick={restoreMonth} disabled={busy}><Icon name="refresh-cw" size={16}/> ভুলবশত বন্ধ? আবার চালু করুন</button>}
      {primary && selected && !selected.can_reopen && !selected.archive_read_only && <small className="archive-reopen-hint">এই মাস পুনরায় চালুর শর্ত পূরণ হচ্ছে না। শুধু সর্বশেষ বন্ধ মাস, একই ক্যালেন্ডার মাসে এবং নতুন মাস শুরুর আগে ফেরানো যায়।</small>}
      </div>
      {loadingDetail && <section className="card archive-correction-section"><LoadingSpinner label="নির্বাচিত মাসের তথ্য লোড হচ্ছে..."/></section>}
      {!loadingDetail && readOnlyReason && <div className="state-card state-card-warning archive-readonly-warning"><Icon name={backendMissing ? 'info' : 'shield'} size={20}/><div><strong>{backendMissing ? 'এখন শুধু রিপোর্ট দেখা যাবে' : 'সংশোধন বন্ধ আছে'}</strong><p>{readOnlyReason}</p></div></div>}
      {!loadingDetail && bundle && <>
        <div className="archive-correction-access-note"><span className="archive-note-icon"><Icon name="shield" size={18}/></span><div><strong>{canEditSelected ? (closerAccess && !primary ? 'আপনার বন্ধ করা মাস · সীমিত সংশোধন' : 'সংশোধন মোড প্রস্তুত') : 'রিড-অনলি রিপোর্ট'}</strong><p>সংশোধনের কারণ লিখতে হবে। প্রতিটি পরিবর্তনের আগের ও নতুন মান অডিট লগে থাকবে। মাসের তারিখ, স্ট্যাটাস ও ম্যানেজার ইতিহাস পরিবর্তন করা যাবে না।</p></div></div>
        <SummaryMetrics detail={detail}/>
        <nav className="archive-kind-tabs" aria-label="আর্কাইভ রিপোর্ট বিভাগ">
          <button type="button" className={activeKind === 'all' ? 'is-active' : ''} aria-pressed={activeKind === 'all'} onClick={() => setActiveKind('all')}><span>সব বিভাগ</span><b>{formatNumber(correctionTotal)}</b></button>
          {EDIT_KINDS.map(([kind, label]) => <button type="button" key={kind} className={activeKind === kind ? 'is-active' : ''} aria-pressed={activeKind === kind} onClick={() => setActiveKind(kind)}><span>{label}</span><b>{formatNumber(correctionCounts[kind])}</b></button>)}
          <button type="button" className={activeKind === 'audit' ? 'is-active' : ''} aria-pressed={activeKind === 'audit'} onClick={() => setActiveKind('audit')}><span>সংশোধন ইতিহাস</span><b>{formatNumber(arr(bundle.audit).length)}</b></button>
        </nav>
        <div className="archive-section-stack">
          {EDIT_KINDS.filter(([kind]) => activeKind === 'all' || activeKind === kind).map(([kind, label]) => {
            const rows = arr(bundle[kind] || bundle[`${kind}_entries`]);
            return <Section key={kind} title={label} className="archive-kind-section">
              <div className="archive-section-subhead"><span>{rows.length ? `${formatNumber(rows.length)}টি এন্ট্রি` : 'কোনো এন্ট্রি নেই'}</span>{canEditSelected && rows.length > 0 && <small>এই মাসে অনুমোদিত সংশোধন</small>}</div>
              {rows.length ? <div className="archive-correction-records">{rows.map((row, index) => {
                const cannotEditMarket = kind === 'market' && Number(row.item_count ?? 0) !== 1;
                return <article className="archive-correction-record" key={row.id || `${kind}-${index}`}>
                  <span className="archive-record-kind-icon"><Icon name={kind === 'final_meal' ? 'utensils' : kind === 'market' ? 'shopping-basket' : kind === 'deposit' ? 'wallet' : kind === 'khala' ? 'hand-coins' : 'receipt'} size={18}/></span>
                  <div className="archive-record-main"><strong>{rowTitle(row, kind)}</strong><small>{rowSubtitle(row, kind)}</small>{cannotEditMarket && <span className="archive-record-safety-note">একাধিক/শূন্য আইটেম থাকায় মোট টাকা পরিবর্তন বন্ধ</span>}</div>
                  {canEditSelected && <button type="button" className="secondary-button compact archive-edit-button" onClick={() => beginEdit(kind, row)} disabled={busy || cannotEditMarket}><Icon name="pencil" size={14}/> সংশোধন</button>}
                </article>;
              })}</div> : <div className="archive-category-empty"><span><Icon name="check-circle" size={19}/></span><div><strong>এই বিভাগে এন্ট্রি নেই</strong><p>নির্বাচিত মাসে {label} বিভাগের কোনো সংশোধনযোগ্য এন্ট্রি সংরক্ষিত নেই।</p></div></div>}
            </Section>;
          })}
          {(activeKind === 'all' || activeKind === 'audit') && <Section title="সংশোধনের ইতিহাস" className="archive-kind-section archive-audit-section">
            <div className="archive-section-subhead"><span>{formatNumber(arr(bundle.audit).length)}টি লগ</span><small>কে, কখন এবং কেন পরিবর্তন করেছেন</small></div>
            {arr(bundle.audit).length ? <div className="archive-correction-records">{bundle.audit.map((entry, index) => <article className="archive-correction-record archive-audit-record" key={entry.id || index}><span className="archive-record-kind-icon"><Icon name="history" size={18}/></span><div className="archive-record-main"><strong>{entry.summary || entry.action || 'সংশোধন'}</strong><small>{entry.actor_name || 'ম্যানেজার'}{entry.created_at ? ` · ${formatDateTime12(entry.created_at)}` : ''}</small>{entry.reason && <p>{entry.reason}</p>}</div></article>)}</div> : <div className="archive-category-empty"><span><Icon name="history" size={19}/></span><div><strong>এখনো সংশোধন করা হয়নি</strong><p>পরবর্তী সংশোধনগুলো এখানে অডিট লগ হিসেবে দেখা যাবে।</p></div></div>}
          </Section>}
        </div>
      </>}
      {!loadingDetail && !bundle && <div className="archive-readonly-report"><ReadOnlyReport detail={detail}/></div>}
    </>}

    {editing && bundle && <div className="archive-correction-overlay" role="presentation"><form className="card archive-correction-dialog" onSubmit={save} role="dialog" aria-modal="true" aria-label="আর্কাইভ এন্ট্রি সংশোধন">
      <div className="archive-dialog-heading"><span className="archive-dialog-icon"><Icon name="pencil" size={19}/></span><div><span className="archive-eyebrow">হিসাব সংশোধন</span><h2>{editing.title}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)} disabled={busy} aria-label="সংলাপ বন্ধ করুন"><Icon name="x" size={19}/></button></div>
      <p>শুধু {selected?.label || 'নির্বাচিত'} বন্ধ মাসের এই এন্ট্রি পরিবর্তিত হবে। মাসের তারিখ ও স্ট্যাটাস অপরিবর্তিত থাকবে।</p>
      {FIELDS[editing.kind].map(([key, label]) => <label className="field-label" key={key}><span>{label}</span><input type="number" inputMode="decimal" min="0" step={editing.kind === 'final_meal' ? '0.5' : '0.01'} required value={values[key] ?? ''} onChange={event => setValues(value => ({ ...value, [key]: event.target.value }))}/></label>)}
      <label className="field-label"><span>সংশোধনের কারণ (বাধ্যতামূলক)</span><textarea required minLength={8} maxLength={MAX_REASON} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="কেন এই হিসাব সংশোধন করা হচ্ছে?"/><small className="archive-reason-counter">{formatNumber(reason.length)} / {MAX_REASON} অক্ষর · অন্তত ৮ অক্ষর লিখুন</small></label>
      <div className="archive-correction-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)} disabled={busy}>বাতিল</button><button className="primary-button" type="submit" disabled={busy}><Icon name="check" size={16}/>{busy ? 'সংরক্ষণ হচ্ছে...' : 'নিশ্চিত করে সংরক্ষণ'}</button></div>
    </form></div>}
  </div>;
}
