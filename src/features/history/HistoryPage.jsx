import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMemberDirectory } from '../../services/diningService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { fetchAccountHistory, fetchArchivedMonthDetail, fetchKhalaMoneyHistory, fetchMarketDetail, fetchMarketHistory, fetchPreviousMonths } from '../../services/historyService';
import { adjustTransaction, updateKhalaMoney, updateMarketEntry, voidKhalaMoney, voidMarketEntry } from '../../services/managerService';
import { formatDateBangla, formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

const TABS = [
  { key: 'market', label: 'বাজার ইতিহাস', icon: 'dining' },
  { key: 'account', label: 'হিসাব ইতিহাস', icon: 'wallet' },
  { key: 'months', label: 'পূর্ববর্তী মাস', icon: 'history' },
];

export function HistoryPage() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [tab, setTab] = useState('market');
  const [periods, setPeriods] = useState([]);
  const [marketRows, setMarketRows] = useState([]);
  const [accountRows, setAccountRows] = useState([]);
  const [khalaRows, setKhalaRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [marketDetail, setMarketDetail] = useState(null);
  const [monthDetail, setMonthDetail] = useState(null);
  const { isManager } = useAuth();
  const [accountFilter, setAccountFilter] = useState('');
  const [members, setMembers] = useState([]);
  const [accountType, setAccountType] = useState('all');
  const [marketEdit, setMarketEdit] = useState(null);
  const [marketVoid, setMarketVoid] = useState(null);
  const [transactionEdit, setTransactionEdit] = useState(null);
  const [khalaEdit, setKhalaEdit] = useState(null);
  const [khalaVoid, setKhalaVoid] = useState(null);
  const [managerBusy, setManagerBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      if (tab === 'market') {
        setMarketRows(await fetchMarketHistory({ limit: 150 }));
        if (isManager) setMembers(await fetchMemberDirectory());
      } else if (tab === 'account') {
        const [accounts, khala] = await Promise.all([
          fetchAccountHistory({ memberId: isManager ? (accountFilter || null) : null, limit: 200 }),
          fetchKhalaMoneyHistory({ limit: 200 }),
        ]);
        setAccountRows(accounts);
        setKhalaRows(khala);
        if (isManager) setMembers(await fetchMemberDirectory());
      } else setPeriods(await fetchPreviousMonths());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'হিস্টরি লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [accountFilter, isManager, isOnline, tab, toast]);

  useEffect(() => { load(); }, [load]);

  const accountGrouped = useMemo(() => {
    const result = [];
    for (const row of accountRows) result.push({ ...row, source: 'ledger' });
    for (const row of khalaRows) result.push({
      transaction_id: row.entry_id,
      member_id: row.member_id,
      member_name: row.member_name,
      transaction_type: 'খালার টাকা',
      amount: Number(row.amount || 0),
      description: row.description,
      created_at: row.created_at,
      reference_type: 'khala_money',
      reference_id: row.entry_id,
      source: 'khala',
    });
    const filtered = accountType === 'all' ? result : result.filter((row) => accountType === 'khala' ? row.source === 'khala' : row.source === 'ledger' && row.transaction_type === accountType);
    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [accountRows, accountType, khalaRows]);

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
        <button className="secondary-button compact" type="button" onClick={load} disabled={loading}><Icon name="refresh" size={15} /> রিফ্রেশ</button>
      </div>

      <div className="history-tabbar" role="tablist" aria-label="হিস্টরি বিভাগ">
        {TABS.map((item) => <button key={item.key} className={tab === item.key ? 'active' : ''} type="button" onClick={() => setTab(item.key)}><Icon name={item.icon} size={16} /> {item.label}</button>)}
      </div>

      {tab === 'account' && (
        <div className="card history-filter-card">
          <div><strong>হিসাব ফিল্টার</strong><small>{isManager ? 'প্রয়োজনে নির্দিষ্ট সদস্যের হিসাবও আলাদা করে দেখা যাবে।' : 'এখানে মেসের প্রাসঙ্গিক হিসাবের ইতিহাস দেখানো হবে।'}</small></div>
          <div className="history-filter-controls">
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)} aria-label="হিসাবের ধরন">
              <option value="all">সব হিসাব</option>
              <option value="ডিপোজিট">ডিপোজিট</option>
              <option value="বাজার ডিপোজিট">বাজার ডিপোজিট</option>
              <option value="অন্যান্য খরচ">অন্যান্য খরচ</option>
              <option value="সংশোধন">সংশোধন</option>
              <option value="খালার টাকা">খালার টাকা</option>
            </select>
            {isManager && <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="সদস্য নির্বাচন"><option value="">সব সদস্য</option>{members.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}</select>}
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner label="হিস্টরি লোড হচ্ছে..." /> : tab === 'market' ? (
        <MarketHistoryList rows={marketRows} onOpen={openMarket} />
      ) : tab === 'account' ? (
        <AccountHistoryList rows={accountGrouped} isManager={isManager} onEdit={(row) => setTransactionEdit(row)} onKhalaEdit={(row) => setKhalaEdit(row)} onKhalaVoid={(row) => setKhalaVoid(row)} />
      ) : (
        <PreviousMonthList rows={periods} onOpen={openMonth} />
      )}

      {detailLoading && <div className="modal-backdrop"><div className="modal-panel card"><LoadingSpinner label="বিস্তারিত লোড হচ্ছে..." /></div></div>}
      {marketDetail && !detailLoading && <MarketDetailModal detail={marketDetail} isManager={isManager} onEdit={() => setMarketEdit(marketDetail)} onVoid={() => setMarketVoid(marketDetail)} onClose={() => setMarketDetail(null)} />}
      {monthDetail && !detailLoading && <MonthDetailModal detail={monthDetail} onClose={() => setMonthDetail(null)} />}
      {marketEdit && <MarketEditModal detail={marketEdit} members={members} busy={managerBusy} onClose={() => setMarketEdit(null)} onSaved={async () => { setMarketEdit(null); setMarketDetail(null); await load(); }} onBusy={setManagerBusy} />}
      {marketVoid && <ReasonModal title="বাজার এন্ট্রি বাতিল" description="বাতিল করার কারণ লিখুন। ইতিহাস থাকবে, কিন্তু এটি আর active market হিসেবে গণনা হবে না।" busy={managerBusy} onClose={() => setMarketVoid(null)} onConfirm={async (reason) => { setManagerBusy(true); try { await voidMarketEntry(marketVoid.market_entry_id, reason); toast.success('বাজার এন্ট্রি সফলভাবে বাতিল হয়েছে।'); setMarketVoid(null); setMarketDetail(null); await load(); } catch (error) { toast.error(getFriendlySupabaseError(error, 'বাজার বাতিল করা যায়নি।')); } finally { setManagerBusy(false); } }} />}
      {transactionEdit && <TransactionEditModal row={transactionEdit} busy={managerBusy} onClose={() => setTransactionEdit(null)} onSaved={async () => { setTransactionEdit(null); await load(); }} onBusy={setManagerBusy} />}
      {khalaEdit && <KhalaEditModal row={khalaEdit} members={members} busy={managerBusy} onClose={() => setKhalaEdit(null)} onSaved={async () => { setKhalaEdit(null); await load(); }} onBusy={setManagerBusy} />}
      {khalaVoid && <ReasonModal title="খালার টাকার এন্ট্রি বাতিল" description="বাতিল করার কারণ লিখুন। এন্ট্রিটি history-তে থাকবে, কিন্তু active total-এ গণনা হবে না।" busy={managerBusy} onClose={() => setKhalaVoid(null)} onConfirm={async (reason) => { setManagerBusy(true); try { await voidKhalaMoney(khalaVoid.entry_id, reason); toast.success('খালার টাকার এন্ট্রি সফলভাবে বাতিল হয়েছে।'); setKhalaVoid(null); await load(); } catch (error) { toast.error(getFriendlySupabaseError(error, 'এন্ট্রি বাতিল করা যায়নি।')); } finally { setManagerBusy(false); } }} />}
    </div>
  );
}

function MarketHistoryList({ rows, onOpen }) {
  if (!rows.length) return <EmptyHistory icon="dining" title="কোনো বাজার ইতিহাস নেই" text="এই মাসে এখনো কোনো বৈধ বাজার এন্ট্রি নেই।" />;
  return <div className="history-list">{rows.map((row) => (
    <button className="card history-item-card" type="button" key={row.market_entry_id} onClick={() => onOpen(row.market_entry_id)}>
      <div className="history-leading-icon"><Icon name="dining" size={18} /></div>
      <div className="history-item-copy"><strong>{row.buyer_name}</strong><small>{formatDateWithWeekday(row.entry_date)} · {formatDateTime12(row.created_at)}</small><span>{Array.isArray(row.items) ? `${formatNumber(row.items.length)}টি আইটেম` : 'বাজারের বিস্তারিত'}</span></div>
      <div className="history-amount"><strong>{formatCurrency(row.total_amount)}</strong><small>{row.credit_to_buyer ? 'জমায় যুক্ত' : 'জমায় নয়'}</small></div>
      <Icon name="chevron" size={17} />
    </button>
  ))}</div>;
}

function AccountHistoryList({ rows, isManager = false, onEdit, onKhalaEdit, onKhalaVoid }) {
  if (!rows.length) return <EmptyHistory icon="wallet" title="কোনো হিসাব ইতিহাস নেই" text="এই সময়ে কোনো হিসাবের transaction পাওয়া যায়নি।" />;
  return <div className="history-list">{rows.map((row) => {
    const positive = ['ডিপোজিট', 'বাজার ডিপোজিট'].includes(row.transaction_type) || (row.transaction_type === 'সংশোধন' && Number(row.amount) > 0);
    const canEditLedger = isManager && row.source === 'ledger' && ['ডিপোজিট', 'অন্যান্য খরচ'].includes(row.transaction_type) && !row.parent_transaction_id;
    const canEditKhala = isManager && row.source === 'khala' && row.status !== 'void';
    return <article className="card account-history-row manager-history-row" key={`${row.transaction_id}-${row.source}`}>
      <div className={`history-leading-icon ${positive ? 'positive' : 'negative'}`}><Icon name={positive ? 'plus' : 'minus'} size={18} /></div>
      <div className="history-item-copy"><strong>{row.member_name}</strong><small>{row.transaction_type} · {formatDateTime12(row.created_at)}</small><span>{row.description || 'কোনো বিবরণ দেওয়া হয়নি।'}</span></div>
      <strong className={`history-amount-value ${positive ? 'positive' : 'negative'}`}>{positive ? '+' : ''}{formatCurrency(row.amount)}</strong>
      {(canEditLedger || canEditKhala) && <div className="history-row-actions">{canEditLedger && <button className="icon-button compact-icon" type="button" onClick={() => onEdit?.(row)} aria-label="হিসাব সংশোধন"><Icon name="edit" size={15} /></button>}{canEditKhala && <><button className="icon-button compact-icon" type="button" onClick={() => onKhalaEdit?.(row)} aria-label="খালার টাকা সম্পাদনা"><Icon name="edit" size={15} /></button><button className="icon-button compact-icon danger-icon" type="button" onClick={() => onKhalaVoid?.(row)} aria-label="খালার টাকা বাতিল"><Icon name="trash" size={15} /></button></>}</div>}
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
  return <div className="modal-backdrop"><div className="modal-panel card large-modal"><div className="modal-head"><div><span className="eyebrow">ম্যানেজার সংশোধন</span><h2>বাজার এন্ট্রি সম্পাদনা</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy}><Icon name="x" size={19}/></button></div><div className="form-grid-2"><label className="field-label"><span>তারিখ</span><input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></label><label className="field-label"><span>বাজারকারী</span><select value={buyer} onChange={(e)=>setBuyer(e.target.value)}>{members.filter(m=>m.member_status==='active'||m.membership_id===buyer).map(m=><option key={m.membership_id} value={m.membership_id}>{m.member_name}</option>)}</select></label></div><div className="market-table-card"><div className="market-table-head"><span>ক্রম</span><span>আইটেম</span><span>পরিমাণ</span><span>Amount</span><span/></div><div className="market-item-list">{items.map((item,index)=><div className="market-item-row" key={`${index}-${item.item_name}`}><span className="market-serial">{formatNumber(index+1,{maximumFractionDigits:0})}</span><input className="market-input-item" value={item.item_name} onChange={(e)=>update(index,{item_name:e.target.value})} placeholder="চাল, ডাল..."/><input className="market-input-quantity" value={item.quantity} onChange={(e)=>update(index,{quantity:e.target.value})} placeholder="৫ কেজি"/><input className="market-input-amount" type="number" min="0" step="0.01" value={item.amount} onChange={(e)=>update(index,{amount:e.target.value})} /><button className="icon-button compact-icon" type="button" onClick={()=>remove(index)} disabled={items.length===1}><Icon name="x" size={15}/></button></div>)}</div><button className="secondary-button add-market-item" type="button" onClick={add}><Icon name="plus-circle" size={17}/> আরেকটি আইটেম</button><div className="market-total-row"><span>সর্বমোট</span><strong>{formatCurrency(total)}</strong></div></div><div className={`deposit-toggle-card ${credit?'enabled':''}`}><button type="button" className="toggle-control" onClick={()=>setCredit(v=>!v)} aria-pressed={credit}><span className="toggle-track"><span className="toggle-thumb"/></span><span><strong>বাজারের টাকা deposit হিসেবে যুক্ত থাকবে</strong><small>{credit?'ON — বাজারের মোট টাকা member-এর হিসাবে জমা থাকবে।':'OFF — বাজারের টাকা deposit হিসেবে যুক্ত হবে না।'}</small></span></button></div><label className="field-label"><span>সংশোধনের কারণ</span><textarea rows="2" value={reason} onChange={(e)=>setReason(e.target.value)} /></label><div className="confirm-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button><button className="primary-button" type="button" onClick={save} disabled={busy}>বাজার আপডেট করুন</button></div></div></div>;
}

function KhalaEditModal({ row, members, busy, onClose, onSaved, onBusy }) {
  const toast=useToast();
  const [memberId,setMemberId]=useState(row.member_id); const [amount,setAmount]=useState(String(row.amount)); const [date,setDate]=useState(row.entry_date); const [description,setDescription]=useState(row.description||'');
  const save=async()=>{const n=Number(amount);if(!memberId||!(n>0)||!date)return toast.warning('সদস্য, তারিখ ও সঠিক amount দিন।');onBusy(true);try{await updateKhalaMoney({entryId:row.entry_id,memberId,amount:n,date,description:description.trim()||null});toast.success('খালার টাকার এন্ট্রি সফলভাবে আপডেট হয়েছে।');await onSaved();}catch(error){toast.error(getFriendlySupabaseError(error,'খালার টাকার এন্ট্রি আপডেট করা যায়নি।'));}finally{onBusy(false);}};
  return <div className="modal-backdrop"><div className="modal-panel card confirmation-modal"><div className="modal-head"><div><span className="eyebrow">ম্যানেজার সংশোধন</span><h2>খালার টাকার এন্ট্রি</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy}><Icon name="x" size={19}/></button></div><div className="form-grid-2"><label className="field-label"><span>সদস্য</span><select value={memberId} onChange={(e)=>setMemberId(e.target.value)}>{members.filter(m=>m.member_status==='active'||m.membership_id===memberId).map(m=><option key={m.membership_id} value={m.membership_id}>{m.member_name}</option>)}</select></label><label className="field-label"><span>তারিখ</span><input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></label></div><label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)}/></label><label className="field-label"><span>বিবরণ</span><input value={description} onChange={(e)=>setDescription(e.target.value)}/></label><div className="confirm-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>বাতিল</button><button className="primary-button" type="button" onClick={save} disabled={busy}>সংরক্ষণ</button></div></div></div>;
}

function MonthDetailModal({ detail, onClose }) {
  const isDetail = Array.isArray(detail.markets);
  const markets = Array.isArray(detail.markets) ? detail.markets : [];
  const meals = Array.isArray(detail.meals) ? detail.meals : [];
  const ledger = Array.isArray(detail.ledger) ? detail.ledger : [];
  return <div className="modal-backdrop"><div className="modal-panel card large-modal"><div className="modal-head"><div><span className="eyebrow">পূর্ববর্তী মাস</span><h2>{detail.label}</h2><small>{formatDateBangla(detail.start_date)} → {formatDateBangla(detail.end_date)}</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button></div>{isDetail ? <div className="archive-detail-body"><div className="archive-detail-grid"><div className="metric"><span>বাজার</span><strong>{formatCurrency(markets.reduce((sum, row) => sum + Number(row.total || 0), 0))}</strong></div><div className="metric"><span>মোট মিল</span><strong>{formatNumber(meals.reduce((sum, row) => sum + Number(row.breakfast || 0) + Number(row.lunch || 0) + Number(row.dinner || 0), 0))}</strong></div><div className="metric"><span>লেনদেন</span><strong>{formatNumber(ledger.length)}</strong></div></div><section className="archive-detail-section"><div className="section-heading"><h3>বাজার</h3><span>{formatNumber(markets.length)}টি</span></div>{markets.slice(0, 60).map((row) => <div className="archive-list-row" key={row.id}><div><strong>{row.member_name}</strong><small>{formatDateWithWeekday(row.entry_date)}</small></div><strong>{formatCurrency(row.total)}</strong></div>)}</section><section className="archive-detail-section"><div className="section-heading"><h3>দৈনিক মিল</h3><span>{formatNumber(meals.length)} দিন</span></div>{meals.slice(0, 90).map((row) => <div className="archive-list-row" key={row.date}><div><strong>{formatDateWithWeekday(row.date)}</strong><small>ব্রেকফাস্ট {formatNumber(row.breakfast)} · লাঞ্চ {formatNumber(row.lunch)} · ডিনার {formatNumber(row.dinner)}</small></div><span className="member-badge subtle">{row.status}</span></div>)}</section></div> : <div className="archive-summary-grid"><div className="metric"><span>মোট জমা</span><strong>{formatCurrency(detail.total_deposit)}</strong></div><div className="metric"><span>মোট বাজার</span><strong>{formatCurrency(detail.total_market_expense)}</strong></div><div className="metric"><span>মোট খরচ</span><strong>{formatCurrency(Number(detail.total_market_expense || 0) + Number(detail.total_other_expense || 0))}</strong></div><div className="metric"><span>মোট মিল</span><strong>{formatNumber(detail.total_meals)}</strong></div><div className="metric"><span>মিল রেট</span><strong>৳{formatNumber(detail.meal_rate, { maximumFractionDigits: 4 })}</strong></div><div className="metric"><span>অবশিষ্ট ফান্ড</span><strong>{formatCurrency(detail.fund_remaining)}</strong></div></div>}</div></div>;
}
