import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMemberDirectory } from '../../services/diningService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { fetchAccountHistory, fetchArchivedMonthDetail, fetchMarketDetail, fetchMarketHistory, fetchPreviousMonths, fetchMyArchiveEditablePeriods } from '../../services/historyService';
import { adjustTransaction, updateMarketEntry, voidMarketEntry } from '../../services/managerService';
import { formatDateBangla, formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { printReport } from '../../services/reportService';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { ledgerRowIsEditable, ledgerRowIsPositive } from '../../utils/accounting';

const TABS = [
  { key: 'market', label: 'বাজার ইতিহাস', icon: 'dining' },
  { key: 'account', label: 'হিসাব ইতিহাস', icon: 'wallet' },
  { key: 'months', label: 'পূর্ববর্তী মাস', icon: 'history' },
];

export function HistoryPage() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [tab, setTab] = useState('market');
  const [selectedArchivePeriodId, setSelectedArchivePeriodId] = useState(() => new URLSearchParams(window.location.search).get('archive_period') || '');
  const [archiveEditPeriods, setArchiveEditPeriods] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [marketRows, setMarketRows] = useState([]);
  const [accountRows, setAccountRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [marketDetail, setMarketDetail] = useState(null);
  const [monthDetail, setMonthDetail] = useState(null);
  const { isManager, membership } = useAuth();
  const [accountFilter, setAccountFilter] = useState('');
  const [members, setMembers] = useState([]);
  const [accountType, setAccountType] = useState('all');
  const [marketEdit, setMarketEdit] = useState(null);
  const [marketVoid, setMarketVoid] = useState(null);
  const [transactionEdit, setTransactionEdit] = useState(null);
  const [managerBusy, setManagerBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [marketMemberFilter, setMarketMemberFilter] = useState('');
  const [marketDateFrom, setMarketDateFrom] = useState('');
  const [marketDateTo, setMarketDateTo] = useState('');

  const load = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      let editablePeriods = [];
      try {
        editablePeriods = await fetchMyArchiveEditablePeriods();
        setArchiveEditPeriods(editablePeriods);
      } catch (archiveError) {
        // History still remains usable when the optional archive-permission RPC has not yet been applied.
        console.warn('Archive edit options are unavailable:', archiveError);
      }
      const archivePermission = editablePeriods.some((period) => period.period_id === selectedArchivePeriodId);
      if (selectedArchivePeriodId && !archivePermission) {
        throw new Error('এই আর্কাইভ সম্পাদনার অনুমতি নেই বা মেয়াদ শেষ হয়েছে। আর্কাইভ মেনু থেকে বৈধ মাস নির্বাচন করুন।');
      }
      const periodId = selectedArchivePeriodId || null;
      const canEditVisibleRows = Boolean(selectedArchivePeriodId ? archivePermission : isManager);
      if (tab === 'market') {
        const [marketResult, memberResult] = await Promise.allSettled([
          fetchMarketHistory({ periodId, limit: 500 }),
          fetchMemberDirectory(),
        ]);
        if (marketResult.status === 'rejected') throw marketResult.reason;
        setMarketRows(Array.isArray(marketResult.value) ? marketResult.value : []);
        if (memberResult.status === 'fulfilled') setMembers(memberResult.value);
        else console.warn('Market filters could not load member names:', memberResult.reason);
      } else if (tab === 'account') {
        const accounts = await fetchAccountHistory({ periodId, memberId: canEditVisibleRows ? (accountFilter || null) : (membership?.membership_id || null), limit: 500 });
        setAccountRows(accounts);
        if (isManager || selectedArchivePeriodId) {
          try { setMembers(await fetchMemberDirectory()); }
          catch (memberError) { console.warn('Account member filter unavailable:', memberError); }
        }
      } else setPeriods(await fetchPreviousMonths());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'হিস্টরি লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [accountFilter, isManager, isOnline, membership?.membership_id, selectedArchivePeriodId, tab, toast]);

  useEffect(() => { load(); }, [load]);

  const chooseArchivePeriod = (periodId) => {
    setSelectedArchivePeriodId(periodId);
    const nextUrl = periodId
      ? `${window.location.pathname}?archive_period=${encodeURIComponent(periodId)}`
      : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
    setAccountFilter('');
  };
  const canEditVisibleRows = selectedArchivePeriodId
    ? archiveEditPeriods.some((period) => period.period_id === selectedArchivePeriodId)
    : isManager;
  const selectedArchivePeriod = archiveEditPeriods.find((period) => period.period_id === selectedArchivePeriodId);

  const accountGrouped = useMemo(() => {
    const rows = (Array.isArray(accountRows) ? accountRows : []).map((row) => ({ ...row, source: row.source || 'ledger' }));
    return accountType === 'all'
      ? rows
      : rows.filter((row) => (row.transaction_type_raw || row.transaction_type) === accountType);
  }, [accountRows, accountType]);

  const visibleMarketRows = useMemo(() => {
    return (Array.isArray(marketRows) ? marketRows : [])
      .filter((row) => !marketMemberFilter || String(row.buyer_membership_id || row.member_id || '') === marketMemberFilter)
      .filter((row) => !marketDateFrom || String(row.entry_date || '') >= marketDateFrom)
      .filter((row) => !marketDateTo || String(row.entry_date || '') <= marketDateTo)
      .sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [marketRows, marketMemberFilter, marketDateFrom, marketDateTo]);

  const marketTotal = useMemo(() => visibleMarketRows
    .filter((row) => row.status !== 'void')
    .reduce((sum, row) => sum + Number(row.total_amount || 0), 0), [visibleMarketRows]);
  const marketSerialById = useMemo(() => {
    const chronological = [...marketRows].sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return new Map(chronological.map((row, index) => [row.market_entry_id, index + 1]));
  }, [marketRows]);

  const exportCurrentTab = () => {
    setExportBusy(true);
    try {
      const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      if (tab === 'market') {
        const body = visibleMarketRows.map((row, index) => `<tr><td>${marketSerialById.get(row.market_entry_id) || visibleMarketRows.length - index}</td><td>${esc(formatDateWithWeekday(row.entry_date))}</td><td>${esc(row.buyer_name)}</td><td>${esc(formatCurrency(row.total_amount))}</td><td>${esc(row.status === 'void' ? 'বাতিল' : 'সক্রিয়')}</td><td>${esc((row.items || []).map((item) => item.item_name).join(', '))}</td></tr>`).join('');
        printReport('বাজার ইতিহাস', `ফিল্টার করা বাজার · ${visibleMarketRows.length}টি এন্ট্রি · মোট ${formatCurrency(marketTotal)}`, `<table><thead><tr><th>ক্রম</th><th>তারিখ</th><th>বাজারকারী</th><th>মোট</th><th>অবস্থা</th><th>আইটেম</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th colspan=3>সক্রিয় বাজারের মোট</th><th>${esc(formatCurrency(marketTotal))}</th><th colspan=2></th></tr></tfoot></table>`);
      } else if (tab === 'account') {
        const body = accountGrouped.map((row) => `<tr><td>${esc(formatDateWithWeekday(row.entry_date || row.created_at))}</td><td>${esc(row.member_name)}</td><td>${esc(row.transaction_type)}</td><td>${esc(formatCurrency(row.amount))}</td><td>${esc(row.description || '')}</td></tr>`).join('');
        printReport('হিসাব ইতিহাস', `লেনদেন ${accountGrouped.length}টি`, `<table><thead><tr><th>তারিখ</th><th>সদস্য</th><th>ধরন</th><th>পরিমাণ</th><th>বিবরণ</th></tr></thead><tbody>${body}</tbody></table>`);
      }
    } catch (error) {
      toast.error(error.message || 'PDF/প্রিন্ট খোলা যায়নি।');
    } finally {
      window.setTimeout(() => setExportBusy(false), 300);
    }
  };

  const openMarket = async (id) => {
    setDetailLoading(true);
    try { setMarketDetail(await fetchMarketDetail(id)); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'বাজারের বিস্তারিত খোলা যায়নি।')); }
    finally { setDetailLoading(false); }
  };

  const openMonth = async (period) => {
    setDetailLoading(true);
    try { setMonthDetail(await fetchArchivedMonthDetail(period.period_id)); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'মাসের বিস্তারিত খোলা যায়নি।')); }
    finally { setDetailLoading(false); }
  };

  if (!isOnline) return <div className="state-card state-card-warning"><Icon name="offline" size={28} /><div><h2>হিস্টরি দেখতে ইন্টারনেট চালু করুন</h2><p>হিস্টরি offline-এ রাখা হয় না।</p></div></div>;

  return (
    <div className="page-stack">
      <div className="page-title-row history-title-row">
        <div>
          <span className="eyebrow">স্বচ্ছ হিসাব</span>
          <h1>হিস্টরি</h1>
          <p>বাজার, হিসাব এবং আগের মাসের সংরক্ষিত তথ্য এক জায়গায়।</p>
        </div>
        <div className="history-title-actions"><button className="secondary-button compact" type="button" onClick={load} disabled={loading}><Icon name="refresh" size={15} /> রিফ্রেশ</button>{tab !== 'months' && <button className="secondary-button compact" type="button" onClick={exportCurrentTab} disabled={loading || exportBusy || !accountGrouped.length && tab === 'account' || !visibleMarketRows.length && tab === 'market'}><Icon name="download" size={15} /> PDF / প্রিন্ট</button>}</div>
      </div>

      {(archiveEditPeriods.length > 0 || selectedArchivePeriodId) && <section className={`card history-archive-scope ${selectedArchivePeriodId ? 'is-archive-scope' : ''}`}>
        <label className="field-label"><span>হিসাবের পরিসর</span><select value={selectedArchivePeriodId} onChange={(event) => chooseArchivePeriod(event.target.value)}>
          <option value="">বর্তমান / সাধারণ হিস্টরি</option>
          {archiveEditPeriods.map((period) => <option value={period.period_id} key={period.period_id}>{period.label} · {formatDateBangla(period.start_date)} – {formatDateBangla(period.end_date)}</option>)}
        </select></label>
        {selectedArchivePeriod && <div className="archive-scope-note"><Icon name="shield" size={16}/><span><strong>{selectedArchivePeriod.label}</strong> আর্কাইভ সম্পাদনা মোড · অনুমতি: {selectedArchivePeriod.access_kind}{selectedArchivePeriod.expires_at ? ` · মেয়াদ ${formatDateTime12(selectedArchivePeriod.expires_at)}` : ''}</span></div>}
      </section>}

      <div className="history-tabbar" role="tablist" aria-label="হিস্টরি বিভাগ">
        {TABS.map((item) => <button key={item.key} className={tab === item.key ? 'active' : ''} type="button" onClick={() => setTab(item.key)}><Icon name={item.icon} size={16} /> {item.label}</button>)}
      </div>

      {tab === 'account' && (
        <div className="card history-filter-card">
          <div><strong>হিসাব ফিল্টার</strong><small>{canEditVisibleRows ? 'প্রয়োজনে নির্দিষ্ট সদস্যের হিসাবও আলাদা করে দেখা যাবে।' : 'এখানে আপনার হিসাবের ইতিহাস দেখানো হবে।'}</small></div>
          <div className="history-filter-controls">

            <button type="button" className={`secondary-button compact ${accountType === 'all' ? 'active' : ''}`} onClick={() => setAccountType('all')}>সব হিসাব</button>
            {canEditVisibleRows && <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="সদস্য নির্বাচন"><option value="">সব সদস্য</option>{members.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select>}
          </div>
        </div>
      )}

      {tab === 'account' && !loading && (
        <AccountSummary rows={accountRows} selectedType={accountType} onSelect={setAccountType} />
      )}

      {loading ? <LoadingSpinner label="হিস্টরি লোড হচ্ছে..." /> : tab === 'market' ? (
        <><section className="card history-filter-card market-history-filters"><div><strong>বাজার ফিল্টার</strong><small>{visibleMarketRows.length}টি এন্ট্রি · সক্রিয় বাজারের মোট {formatCurrency(marketTotal)}</small></div><div className="history-filter-controls"><select value={marketMemberFilter} onChange={(event)=>setMarketMemberFilter(event.target.value)} aria-label="বাজারকারী সদস্য ফিল্টার"><option value="">সব বাজারকারী</option>{members.map((member)=><option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select><label className="field-label compact-field"><span>শুরু</span><input type="date" value={marketDateFrom} max={marketDateTo || undefined} onChange={(event)=>setMarketDateFrom(event.target.value)}/></label><label className="field-label compact-field"><span>শেষ</span><input type="date" value={marketDateTo} min={marketDateFrom || undefined} onChange={(event)=>setMarketDateTo(event.target.value)}/></label><button type="button" className="secondary-button compact" onClick={()=>{setMarketMemberFilter('');setMarketDateFrom('');setMarketDateTo('');}}>রিসেট</button></div></section><MarketHistoryList rows={visibleMarketRows} serialById={marketSerialById} onOpen={openMarket} /></>
      ) : tab === 'account' ? (
        <AccountHistoryList rows={accountGrouped} isManager={canEditVisibleRows} onEdit={(row) => setTransactionEdit(row)} />
      ) : (
        <PreviousMonthList rows={periods} onOpen={openMonth} />
      )}

      {detailLoading && <div className="modal-backdrop"><div className="modal-panel card"><LoadingSpinner label="বিস্তারিত লোড হচ্ছে..." /></div></div>}
      {marketDetail && !detailLoading && <MarketDetailModal detail={marketDetail} isManager={canEditVisibleRows} onEdit={() => setMarketEdit(marketDetail)} onVoid={() => setMarketVoid(marketDetail)} onClose={() => setMarketDetail(null)} />}
      {monthDetail && !detailLoading && <MonthDetailModal detail={monthDetail} onClose={() => setMonthDetail(null)} />}
      {marketEdit && <MarketEditModal detail={marketEdit} members={members} busy={managerBusy} onClose={() => setMarketEdit(null)} onSaved={async () => { setMarketEdit(null); setMarketDetail(null); await load(); }} onBusy={setManagerBusy} />}
      {marketVoid && <ReasonModal title="বাজার এন্ট্রি বাতিল" description="বাতিল করার কারণ লিখুন। ইতিহাস থাকবে, কিন্তু এটি আর active market হিসেবে গণনা হবে না।" busy={managerBusy} onClose={() => setMarketVoid(null)} onConfirm={async (reason) => { setManagerBusy(true); try { await voidMarketEntry(marketVoid.market_entry_id, reason); toast.success('বাজার এন্ট্রি সফলভাবে বাতিল হয়েছে।'); setMarketVoid(null); setMarketDetail(null); await load(); } catch (error) { toast.error(getFriendlySupabaseError(error, 'বাজার বাতিল করা যায়নি।')); } finally { setManagerBusy(false); } }} />}
      {transactionEdit && <TransactionEditModal row={transactionEdit} busy={managerBusy} onClose={() => setTransactionEdit(null)} onSaved={async () => { setTransactionEdit(null); await load(); }} onBusy={setManagerBusy} />}
          </div>
  );
}

function MarketHistoryList({ rows, serialById = new Map(), onOpen }) {
  if (!rows.length) return <EmptyHistory icon="dining" title="কোনো বাজার ইতিহাস নেই" text="এই ফিল্টারে কোনো বাজার এন্ট্রি পাওয়া যায়নি।" />;
  return <div className="history-list">{rows.map((row, index) => (
    <button className={`card history-item-card ${row.status === 'void' ? 'is-void' : ''}`} type="button" key={row.market_entry_id} onClick={() => onOpen(row.market_entry_id)}>
      <div className="history-leading-icon market-serial-badge"><span>{formatNumber(serialById.get(row.market_entry_id) || rows.length-index)}</span></div>
      <div className="history-item-copy"><strong>{row.buyer_name}</strong><small>{formatDateWithWeekday(row.entry_date)} · তৈরি {formatDateTime12(row.created_at)}</small><span>{Array.isArray(row.items) ? `${formatNumber(row.items.length)}টি আইটেম` : 'বাজারের বিস্তারিত'}{row.status === 'void' ? ' · বাতিল' : ''}</span></div>
      <div className="history-amount"><strong>{formatCurrency(row.total_amount)}</strong><small>{row.credit_to_buyer ? 'জমায় যুক্ত' : 'জমায় নয়'}</small></div>
      <Icon name="chevron" size={17} />
    </button>
  ))}</div>;
}

function AccountSummary({ rows, selectedType = 'all', onSelect }) {
  const amountFor = (type) => (rows || []).filter((row) => (row.transaction_type_raw || row.transaction_type) === type)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
  const cards = [
    { key: 'deposit', label: 'ডিপোজিট', description: 'সদস্যের জমা', value: amountFor('deposit'), tone: 'positive' },
    { key: 'market_deposit', label: 'বাজার ডিপোজিট', description: 'বাজার-সম্পর্কিত জমা', value: amountFor('market_deposit'), tone: 'market' },
    { key: 'other_expense', label: 'অন্যান্য খরচ', description: 'অন্যান্য খরচের হিসাব', value: amountFor('other_expense'), tone: 'negative' },
  ];
  return <section className="account-summary-grid account-summary-filter-grid" aria-label="লেনদেন অনুযায়ী হিসাব ফিল্টার">{cards.map((card)=><button key={card.key} type="button" aria-pressed={selectedType===card.key} className={`card account-summary-card ${card.tone} ${selectedType===card.key?'is-selected':''}`} onClick={()=>onSelect?.(selectedType===card.key?'all':card.key)}><span>{card.label}</span><strong>{formatCurrency(card.value)}</strong><small>{card.description} · চাপলে তালিকা ফিল্টার হবে</small></button>)}</section>;
}

function AccountHistoryList({ rows, isManager = false, onEdit, onKhalaVoid }) {
  if (!rows.length) return <EmptyHistory icon="wallet" title="কোনো হিসাব ইতিহাস নেই" text="এই সময়ে কোনো হিসাবের transaction পাওয়া যায়নি।" />;
  return <div className="history-list">{rows.map((row) => {
    const positive = ledgerRowIsPositive(row);
    const canEditLedger = isManager && row.source === 'ledger' && ledgerRowIsEditable(row);
    return <article className="card account-history-row manager-history-row" key={`${row.transaction_id}-${row.source}`}>
      <div className={`history-leading-icon ${positive ? 'positive' : 'negative'}`}><Icon name={positive ? 'plus' : 'minus'} size={18} /></div>
      <div className="history-item-copy"><strong>{row.member_name}</strong><small>{row.transaction_type} · এন্ট্রির তারিখ: {formatDateBangla(row.entry_date || row.created_at)} · {formatDateTime12(row.created_at)}</small><span>{row.description || 'কোনো বিবরণ দেওয়া হয়নি।'}</span></div>
      <strong className={`history-amount-value ${positive ? 'positive' : 'negative'}`}>{positive ? '+' : '-'}{formatCurrency(Math.abs(Number(row.amount || 0)))}</strong>
      {canEditLedger && <div className="history-row-actions"><button className="icon-button compact-icon" type="button" onClick={() => onEdit?.(row)} aria-label="হিসাব সংশোধন"><Icon name="edit" size={15} /> <span>সম্পাদনা</span></button></div>}
    </article>;
  })}</div>;
}

function PreviousMonthList({ rows, onOpen }) {
  if (!rows.length) return <EmptyHistory icon="history" title="কোনো পূর্ববর্তী মাস নেই" text="মেসে এখনো archive করা মাস পাওয়া যায়নি।" />;
  return <div className="archive-month-list">{rows.map((row) => <button className={`card archive-month-card ${row.detail_available ? 'detail-month' : 'summary-month'}`} type="button" key={row.period_id} onClick={() => onOpen(row)}><div className="archive-month-icon"><Icon name={row.detail_available ? 'file-text' : 'history'} size={20} /></div><div className="archive-month-copy"><strong>{row.label}</strong><small>{formatDateBangla(row.start_date)} → {formatDateBangla(row.end_date)}</small><span>{row.detail_available ? 'সম্পূর্ণ বিস্তারিত ডাটা' : 'শুধু সারসংক্ষেপ'}</span></div><Icon name="chevron" size={18} /></button>)}</div>;
}

function EmptyHistory({ icon, title, text }) {
  return <div className="empty-state-card"><Icon name={icon} size={28} /><strong>{title}</strong><span>{text}</span></div>;
}

function MarketDetailModal({ detail, isManager = false, onEdit, onVoid, onClose }) {
  const items = Array.isArray(detail.items) ? detail.items : [];
  return <div className="modal-backdrop"><div className="modal-panel card large-modal"><div className="modal-head"><div><span className="eyebrow">বাজারের বিস্তারিত</span><h2>{formatDateBangla(detail.entry_date)}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button></div><div className="market-detail-summary"><div><span>বাজারকারী</span><strong>{detail.buyer_name}</strong></div><div><span>মোট</span><strong>{formatCurrency(detail.total_amount)}</strong></div><div><span>জমায় যুক্ত</span><strong>{detail.credit_to_buyer ? 'হ্যাঁ' : 'না'}</strong></div></div><div className="detail-item-list">{items.map((item) => <div className="detail-item-row" key={item.serial_no}><b>{formatNumber(item.serial_no)}</b><div><strong>{item.item_name}</strong><small>{item.quantity || '—'}</small></div><strong>{formatCurrency(item.amount)}</strong></div>)}</div><div className="detail-total-bar"><span>মোট বাজার</span><strong>{formatCurrency(detail.total_amount)}</strong></div><div className="detail-created-note">এন্ট্রি হয়েছে: {formatDateTime12(detail.created_at)}{detail.updated_at && detail.updated_at !== detail.created_at ? ` · সর্বশেষ পরিবর্তন: ${formatDateTime12(detail.updated_at)}` : ''}</div>{detail.status === 'void' && <div className="inline-error"><Icon name="warning" size={16} /> এই বাজার এন্ট্রি বাতিল করা হয়েছে। {detail.void_reason ? `কারণ: ${detail.void_reason}` : ''}</div>}{isManager && detail.status !== 'void' && <div className="request-action-row manager-history-actions"><button className="secondary-button" type="button" onClick={onEdit}><Icon name="edit" size={15} /> সম্পাদনা</button><button className="secondary-button danger-outline" type="button" onClick={onVoid}><Icon name="trash" size={15} /> বাতিল</button></div>}</div></div>;
}


function ReasonModal({ title, description, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return <div className="modal-backdrop"><div className="modal-panel card confirmation-modal"><div className="modal-head"><div><span className="eyebrow">ম্যানেজার সংশোধন</span><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy}><Icon name="x" size={19} /></button></div><p className="confirm-description">{description}</p><label className="field-label"><span>কারণ</span><textarea rows="3" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="কেন এই পরিবর্তন করা হচ্ছে?" /></label><div className="confirm-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button><button className="primary-button danger-button" type="button" disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason.trim())}>{busy ? 'অপেক্ষা করুন...' : 'নিশ্চিত করুন'}</button></div></div></div>;
}

function TransactionEditModal({ row, busy, onClose, onSaved, onBusy }) {
  const toast = useToast();
  const original = row.transaction_type === 'অন্যান্য খরচ' ? Math.abs(Number(row.amount || 0)) : Number(row.amount || 0);
  const [amount, setAmount] = useState(String(original));
  const [description, setDescription] = useState(row.description || 'ম্যানেজার সংশোধন');
  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || (row.transaction_type === 'অন্যান্য খরচ' && value <= 0)) return toast.warning('সংশোধিত টাকার পরিমাণ সঠিকভাবে দিন।');
    onBusy(true);
    try { await adjustTransaction({ transactionId: row.transaction_id, newAmount: row.transaction_type === 'অন্যান্য খরচ' ? -value : value, description: description.trim() || 'ম্যানেজার সংশোধন' }); toast.success('হিসাবের পরিমাণ সফলভাবে সংশোধন হয়েছে।'); await onSaved(); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'হিসাব সংশোধন করা যায়নি।')); }
    finally { onBusy(false); }
  };
  return <div className="modal-backdrop"><div className="modal-panel card confirmation-modal"><div className="modal-head"><div><span className="eyebrow">ম্যানেজার সংশোধন</span><h2>{row.transaction_type}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy}><Icon name="x" size={19} /></button></div><p className="confirm-description">{row.member_name}-এর এই transaction সরাসরি মুছে না দিয়ে adjustment তৈরি হবে।</p><label className="field-label"><span>নতুন পরিমাণ</span><input type="number" min={row.transaction_type === 'অন্যান্য খরচ' ? '0.01' : '0'} step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} /></label><label className="field-label"><span>বিবরণ</span><input value={description} onChange={(e)=>setDescription(e.target.value)} /></label><div className="confirm-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button><button className="primary-button" type="button" onClick={save} disabled={busy}>সংশোধন সংরক্ষণ</button></div></div></div>;
}

function MarketEditModal({ detail, members, busy, onClose, onSaved, onBusy }) {
  const toast = useToast();
  const [date, setDate] = useState(String(detail.entry_date).slice(0,10));
  const [buyer, setBuyer] = useState(detail.buyer_membership_id || '');
  const [credit, setCredit] = useState(Boolean(detail.credit_to_buyer));
  const [reason, setReason] = useState('ম্যানেজার কর্তৃক বাজার সংশোধন');
  const [items, setItems] = useState((Array.isArray(detail.items) && detail.items.length ? detail.items : [{serial_no:1,item_name:'',quantity:'',amount:0}]).map((item)=>({item_name:item.item_name || '',quantity:item.quantity || '',amount:item.amount ?? ''})));
  const total=useMemo(()=>items.reduce((sum,item)=>sum+(Number(item.amount)>0?Number(item.amount):0),0),[items]);
  const update=(index,patch)=>setItems((current)=>current.map((item,i)=>i===index?{...item,...patch}:item));
  const add=()=>setItems((current)=>[...current,{item_name:'',quantity:'',amount:''}]);
  const remove=(index)=>setItems((current)=>current.length===1?current:current.filter((_,i)=>i!==index));
  const save=async()=>{
    const cleaned=items.map(item=>({item_name:item.item_name.trim(),quantity:item.quantity.trim(),amount:Number(item.amount)}));
    if(!date||!buyer) return toast.warning('তারিখ ও বাজারকারী নির্বাচন করুন।');
    if(cleaned.length===0||cleaned.some(item=>!item.item_name||!Number.isFinite(item.amount)||item.amount<0)||total<=0) return toast.warning('সব বাজার আইটেমের নাম ও সঠিক amount দিতে হবে।');
    onBusy(true);
    try{await updateMarketEntry({marketEntryId:detail.market_entry_id,entryDate:date,buyerMembershipId:buyer,items:cleaned,creditToBuyer:credit,reason});toast.success('বাজার এন্ট্রি সফলভাবে আপডেট হয়েছে।');await onSaved();}
    catch(error){toast.error(getFriendlySupabaseError(error,'বাজার এন্ট্রি আপডেট করা যায়নি।'));}
    finally{onBusy(false);}
  };
  return <div className="modal-backdrop"><div className="modal-panel card large-modal"><div className="modal-head"><div><span className="eyebrow">ম্যানেজার সংশোধন</span><h2>বাজার এন্ট্রি সম্পাদনা</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy}><Icon name="x" size={19}/></button></div><div className="form-grid-2"><label className="field-label"><span>তারিখ</span><input type="date" max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} value={date} onChange={(e)=>setDate(e.target.value)}/></label><label className="field-label"><span>বাজারকারী</span><select value={buyer} onChange={(e)=>setBuyer(e.target.value)}>{members.filter(m=>m.member_status==='active'||m.membership_id===buyer).map(m=><option key={m.membership_id} value={m.membership_id}>{m.member_name}</option>)}</select></label></div><div className="market-table-card"><div className="market-table-head"><span>ক্রম</span><span>আইটেম</span><span>পরিমাণ</span><span>Amount</span><span/></div><div className="market-item-list">{items.map((item,index)=><div className="market-item-row" key={`${index}-${item.item_name}`}><span className="market-serial">{formatNumber(index+1,{maximumFractionDigits:0})}</span><input className="market-input-item" value={item.item_name} onChange={(e)=>update(index,{item_name:e.target.value})} placeholder="চাল, ডাল..."/><input className="market-input-quantity" value={item.quantity} onChange={(e)=>update(index,{quantity:e.target.value})} placeholder="৫ কেজি"/><input className="market-input-amount" type="number" min="0" step="0.01" value={item.amount} onChange={(e)=>update(index,{amount:e.target.value})} /><button className="icon-button compact-icon" type="button" onClick={()=>remove(index)} disabled={items.length===1}><Icon name="x" size={15}/></button></div>)}</div><button className="secondary-button add-market-item" type="button" onClick={add}><Icon name="plus-circle" size={17}/> আরেকটি আইটেম</button><div className="market-total-row"><span>সর্বমোট</span><strong>{formatCurrency(total)}</strong></div></div><div className={`deposit-toggle-card ${credit?'enabled':''}`}><button type="button" className="toggle-control" onClick={()=>setCredit(v=>!v)} aria-pressed={credit}><span className="toggle-track"><span className="toggle-thumb"/></span><span><strong>বাজারের টাকা deposit হিসেবে যুক্ত থাকবে</strong><small>{credit?'ON — বাজারের মোট টাকা member-এর হিসাবে জমা থাকবে।':'OFF — বাজারের টাকা deposit হিসেবে যুক্ত হবে না।'}</small></span></button></div><label className="field-label"><span>সংশোধনের কারণ</span><textarea rows="2" value={reason} onChange={(e)=>setReason(e.target.value)} /></label><div className="confirm-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button><button className="primary-button" type="button" onClick={save} disabled={busy}>বাজার আপডেট করুন</button></div></div></div>;
}

function MonthDetailModal({ detail, onClose }) {
  const isDetail = Array.isArray(detail.markets);
  const markets = Array.isArray(detail.markets) ? detail.markets : [];
  const meals = Array.isArray(detail.meals) ? detail.meals : [];
  const ledger = Array.isArray(detail.ledger) ? detail.ledger : [];
  const activeMarkets = markets.filter((row) => row.status !== 'void');
  const totalMarket = activeMarkets.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalMeals = meals.reduce((sum, row) => sum + Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0), 0);
  const printArchive = () => {
    const marketRows = markets.map((row) => `<tr><td>${formatDateWithWeekday(row.entry_date)}</td><td>${row.member_name}</td><td>${formatCurrency(row.total)}</td><td>${row.status === 'void' ? 'বাতিল' : 'active'}</td></tr>`).join('');
    const mealRows = meals.map((row) => `<tr><td>${formatDateWithWeekday(row.date)}</td><td>${row.breakfast}</td><td>${row.lunch}</td><td>${row.dinner}</td><td>${Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0)}</td></tr>`).join('');
    printReport(`Hostel Life — ${detail.label}`, `${formatDateBangla(detail.start_date)} → ${formatDateBangla(detail.end_date)}`, `<h3>বাজার</h3><table><thead><tr><th>তারিখ</th><th>সদস্য</th><th>মোট</th><th>অবস্থা</th></tr></thead><tbody>${marketRows}</tbody></table><br/><h3>দৈনিক মিল</h3><table><thead><tr><th>তারিখ</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${mealRows}</tbody></table>`);
  };
  return <div className="modal-backdrop"><div className="modal-panel card large-modal"><div className="modal-head"><div><span className="eyebrow">পূর্ববর্তী মাস</span><h2>{detail.label}</h2><small>{formatDateBangla(detail.start_date)} → {formatDateBangla(detail.end_date)}</small></div><div className="modal-head-actions"><button className="secondary-button compact" type="button" onClick={printArchive}><Icon name="file-text" size={15} /> PDF / প্রিন্ট</button><button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button></div></div>{Array.isArray(detail.edit_audit) && detail.edit_audit.some((item) => /^(insert|update|delete):/.test(item.action || '')) && <div className="archive-last-edit-note"><Icon name="clock" size={16}/><span>শেষ সংশোধন: <strong>{detail.edit_audit.find((item) => /^(insert|update|delete):/.test(item.action || '')).actor_name}</strong> · {formatDateTime12(detail.edit_audit.find((item) => /^(insert|update|delete):/.test(item.action || '')).created_at)} — {detail.edit_audit.find((item) => /^(insert|update|delete):/.test(item.action || '')).summary}</span></div>}{isDetail ? <div className="archive-detail-body"><div className="archive-detail-grid"><div className="metric"><span>সক্রিয় বাজার</span><strong>{formatCurrency(totalMarket)}</strong></div><div className="metric"><span>মোট মিল</span><strong>{formatNumber(totalMeals)}</strong></div><div className="metric"><span>লেনদেন</span><strong>{formatNumber(ledger.length)}</strong></div></div><section className="archive-detail-section"><div className="section-heading"><h3>বাজার</h3><span>{formatNumber(markets.length)}টি</span></div>{markets.slice(0, 100).map((row) => <div className={`archive-list-row ${row.status === 'void' ? 'is-void' : ''}`} key={row.id}><div><strong>{row.member_name}</strong><small>{formatDateWithWeekday(row.entry_date)}</small></div><div><strong>{formatCurrency(row.total)}</strong><span className="member-badge subtle">{row.status === 'void' ? 'বাতিল' : 'active'}</span></div></div>)}</section><section className="archive-detail-section"><div className="section-heading"><h3>দৈনিক মিল</h3><span>{formatNumber(meals.length)} দিন</span></div>{meals.slice(0, 100).map((row) => <div className="archive-list-row" key={row.date}><div><strong>{formatDateWithWeekday(row.date)}</strong><small>ব্রেকফাস্ট {formatNumber(row.breakfast)} · লাঞ্চ {formatNumber(row.lunch)} · ডিনার {formatNumber(row.dinner)}</small></div><span className="member-badge subtle">{row.status}</span></div>)}</section></div> : <div className="archive-summary-grid"><div className="metric"><span>মোট জমা</span><strong>{formatCurrency(detail.total_deposit)}</strong></div><div className="metric"><span>মোট বাজার</span><strong>{formatCurrency(detail.total_market_expense)}</strong></div><div className="metric"><span>মোট খরচ</span><strong>{formatCurrency(Number(detail.total_market_expense || 0) + Number(detail.total_other_expense || 0))}</strong></div><div className="metric"><span>মোট মিল</span><strong>{formatNumber(detail.total_meals)}</strong></div><div className="metric"><span>মিল রেট</span><strong>৳{formatNumber(detail.meal_rate, { maximumFractionDigits: 4 })}</strong></div><div className="metric"><span>অবশিষ্ট ফান্ড</span><strong>{formatCurrency(detail.fund_remaining)}</strong></div></div>}</div></div>;
}
