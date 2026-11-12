import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { InfoPanel } from '../../components/InfoPanel';
import { confirmAction } from '../../utils/actionDialogs';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useToast } from '../../components/Toast';
import { navigateTo } from '../../app/AppShell';
import { fetchMemberDirectory, fetchRunningPeriod } from '../../services/diningService';
import { fetchKhalaPeriods } from '../../services/managerService';
import { fetchMemberPeriodDetails } from '../../services/dashboardService';
import { MemberPeriodDetailsModal } from '../dashboard/DashboardPage';
import { fetchKhalaMoneyHistory, fetchPreviousMonths, fetchMyArchiveEditablePeriods } from '../../services/historyService';
import { fetchPinnedManagerAnnouncement, managerClearHostelPinnedAnnouncement, managerSendNotification } from '../../services/notificationService';
import { fetchTopDepositors, fetchTopEaters, fetchTopShoppers } from '../../services/rankingService';
import { formatDateBangla, formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { fetchPlatformPublicSettings } from '../../services/platformService';

function PageHeader({ eyebrow = 'হোস্টেল লাইফ', title, description, back = true }) {
  return (
    <div className="page-title-row menu-page-title card menu-page-intro-card">
      <div className="menu-page-title-copy">
        {back && <button className="secondary-button compact back-button" type="button" onClick={() => navigateTo('/app/dashboard')}><Icon name="arrow-left" size={15} /> ফিরে যান</button>}
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function Avatar({ member, large = false }) {
  const initials = member?.member_name?.trim()?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HL';
  return <span className={`avatar ${large ? 'avatar-large' : ''}`}>{initials}</span>;
}

export function AllMembersPage() {
  const toast = useToast();
  const { membership } = useAuth();
  const online = useOnlineStatus();
  const [members, setMembers] = useState([]);
  const [hasRunningPeriod, setHasRunningPeriod] = useState(true);
  const [runningPeriodId, setRunningPeriodId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberDetail, setMemberDetail] = useState(null);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [requestedMemberId] = useState(() => new URLSearchParams(window.location.search).get('member_id') || '');
  const loadInFlightRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!online || !navigator.onLine || document.visibilityState !== 'visible' || !document.hasFocus()) return null;
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const task = (async () => {
      if (!silent) setLoading(true);
      try {
        const [directoryResult, periodResult] = await Promise.allSettled([fetchMemberDirectory(), fetchRunningPeriod()]);
        if (directoryResult.status === 'rejected') throw directoryResult.reason;
        setMembers(Array.isArray(directoryResult.value) ? directoryResult.value : []);
        if (periodResult.status === 'fulfilled') {
          const period = periodResult.value;
          setHasRunningPeriod(Boolean(period?.period_id || period?.id));
          setRunningPeriodId(period?.period_id || period?.id || null);
        }
      } catch (error) {
        if (!silent) toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।'));
      } finally {
        if (!silent) setLoading(false);
      }
    })();
    loadInFlightRef.current = task;
    try { return await task; }
    finally { if (loadInFlightRef.current === task) loadInFlightRef.current = null; }
  }, [online, toast]);

  useEffect(() => {
    if (online) load();
    else setLoading(false);
  }, [load, online]);

  useRealtimeRefresh({
    enabled: online,
    hostelId: membership?.hostel_id,
    tables: ['hostel_memberships'],
    onRefresh: () => load({ silent: true }),
  });

  useEffect(() => {
    if (loading || !requestedMemberId || !members.length) return;
    const target = members.find((member) => member.membership_id === requestedMemberId);
    if (!target) return;
    window.setTimeout(() => document.getElementById(`member-card-${requestedMemberId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [loading, members, requestedMemberId]);

  const openMemberDetails = async (memberId) => {
    setSelectedMemberId(memberId);
    setMemberDetail(null);
    setMemberDetailLoading(true);
    try { setMemberDetail(await fetchMemberPeriodDetails(memberId, runningPeriodId)); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'সদস্যের বিস্তারিত হিসাব লোড করা যায়নি।')); }
    finally { setMemberDetailLoading(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="মেসের সবাই" title="সকল সদস্য" description="সদস্য ও তাঁদের হিসাব।" />
      {!hasRunningPeriod && <div className="no-active-period-inline"><Icon name="calendar" size={18} /><div><strong>এখনো নতুন মাস শুরু হয়নি</strong><span>সদস্য তালিকা অক্ষত আছে। নতুন মাস শুরু হলে হিসাব আবার দেখানো হবে।</span></div></div>}
      {loading ? <LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..." /> : members.length === 0 ? (
        <div className="empty-state-card"><Icon name="users" size={28} /><strong>কোনো সদস্য পাওয়া যায়নি</strong><span>মেসে এখনো কোনো সদস্যের তথ্য নেই।</span></div>
      ) : (
        <div className="menu-member-grid">
          {members.map((member) => (
            <article id={`member-card-${member.membership_id}`} className={`card all-member-card ${requestedMemberId === member.membership_id ? 'requested-member-card' : ''} ${member.member_status === 'inactive' ? 'member-inactive-card' : ''}`} key={member.membership_id}>
              <div className="all-member-head">
                <Avatar member={member} />
                <div className="all-member-copy">
                  <button type="button" className="member-name-detail-trigger" onClick={() => openMemberDetails(member.membership_id)}>{member.member_name}</button>
                  <div className="member-badge-row">
                    <span className={`member-badge ${member.member_status === 'active' ? 'active' : 'inactive'}`}>{member.member_status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</span>
                    <span className="member-badge subtle">{hasRunningPeriod ? (member.meal_activity || 'এই মাসে মিল নেই') : 'এখনো মাস শুরু হয়নি'}</span>
                    {Boolean(member.is_primary_manager ?? (member.role === 'manager')) && <span className="member-badge manager">ম্যানেজার</span>}
                    {member.is_assistant_manager && <span className="member-badge assistant">সহকারী ম্যানেজার</span>}
                  </div>
                </div>
              </div>
              <div className="member-stats-grid">
                <div><span>জমা</span><strong>{formatCurrency(hasRunningPeriod ? member.deposit : 0)}</strong></div>
                <div><span>মোট মিল</span><strong>{formatNumber(hasRunningPeriod ? member.final_meals : 0)}</strong></div>
                <div><span>মিল খরচ</span><strong>{formatCurrency(hasRunningPeriod ? member.meal_cost : 0)}</strong></div>
                <div><span>অন্যান্য খরচ</span><strong>{formatCurrency(hasRunningPeriod ? member.other_expense : 0)}</strong></div>
              </div>
              <div className={`member-balance-row ${Number(hasRunningPeriod ? member.balance : 0) < 0 ? 'balance-negative' : 'balance-positive'}`}>
                <span>{hasRunningPeriod && Number(member.balance || 0) < 0 ? 'বর্তমান বকেয়া' : 'বর্তমান অবশিষ্ট'}</span>
                <strong>{formatCurrency(Math.abs(Number(hasRunningPeriod ? member.balance : 0)))}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
      {selectedMemberId && <MemberPeriodDetailsModal detail={memberDetail} loading={memberDetailLoading} memberName={members.find((item) => item.membership_id === selectedMemberId)?.member_name || 'সদস্য'} onClose={() => { setSelectedMemberId(''); setMemberDetail(null); }} />}
    </div>
  );
}


export function KhalaMoneyViewPage() {
  const toast = useToast();
  const [periods, setPeriods] = useState([]);
  const [rows, setRows] = useState([]);
  const [editablePeriodIds, setEditablePeriodIds] = useState([]);
  const [activeTab, setActiveTab] = useState('previous');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [currentPeriod, previousPeriods, writablePeriods] = await Promise.all([
        fetchRunningPeriod().catch(() => null),
        fetchPreviousMonths(),
        fetchKhalaPeriods().catch(() => []),
      ]);
      const currentId = currentPeriod?.period_id || currentPeriod?.id || '';
      const periodRows = [
        ...(currentPeriod?.period_id || currentPeriod?.id ? [{ ...currentPeriod, period_id: currentId, status: 'running' }] : []),
        ...(Array.isArray(previousPeriods) ? previousPeriods : []),
      ].filter((period, index, all) => period?.period_id && all.findIndex((item) => item.period_id === period.period_id) === index)
        .slice(0, 36);
      const safeWritablePeriods = (Array.isArray(writablePeriods) ? writablePeriods : [])
        .filter((period) => period?.status === 'running' || period?.access_kind === 'closed_by');
      const editableIds = new Set(safeWritablePeriods
        .map((period) => String(period?.period_id || period?.id || '')).filter(Boolean));
      const periodById = new Map(safeWritablePeriods
        .map((period) => [String(period?.period_id || period?.id || ''), period]));
      const decoratedPeriods = periodRows.map((period) => {
        const access = periodById.get(String(period.period_id));
        return {
          ...period,
          can_manage_khala: editableIds.has(String(period.period_id)),
          manager_at_close_name: period.manager_at_close_name || access?.manager_at_close_name || '',
          access_kind: access?.access_kind || '',
        };
      });
      const responses = await Promise.all(
        periodRows.map((period) => fetchKhalaMoneyHistory({ periodId: period.period_id, limit: 300 }))
      );
      const nextRows = [];
      responses.forEach((data, index) => {
        const period = periodRows[index];
        for (const row of Array.isArray(data) ? data : []) {
          nextRows.push({ ...row, period_id: period.period_id, period_label: period.label || period.name || 'কাজের মাস' });
        }
      });
      setPeriods(decoratedPeriods);
      setEditablePeriodIds([...editableIds]);
      setRows(nextRows);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য দেখা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const byPeriod = new Map(periods.map((period) => [String(period.period_id), {
      ...period,
      rows: [],
      total: 0,
      count: 0,
    }]));
    for (const row of rows) {
      const key = String(row.period_id || 'unknown');
      if (!byPeriod.has(key)) {
        byPeriod.set(key, { period_id: key, label: row.period_label || row.period_name || 'মাস', rows: [], total: 0, count: 0, can_manage_khala: false });
      }
      byPeriod.get(key).rows.push(row);
    }
    return [...byPeriod.values()].map((group) => {
      const activeRows = group.rows.filter((row) => row.status !== 'void');
      return {
        ...group,
        rows: [...group.rows].sort((a, b) => String(b.entry_date || b.created_at || '').localeCompare(String(a.entry_date || a.created_at || ''))),
        total: activeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        count: activeRows.length,
      };
    }).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
  }, [periods, rows]);

  const visibleGroups = useMemo(() => grouped.filter((group) => {
    if (activeTab === 'current') return group.status === 'running';
    if (activeTab === 'previous') return group.status !== 'running';
    return true;
  }), [activeTab, grouped]);
  const totalKhalaPaid = rows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const activeEntryCount = rows.filter((row) => row.status !== 'void').length;

  const tabs = [
    { key: 'previous', label: 'পূর্ববর্তী মাস', count: grouped.filter((group) => group.status !== 'running').length },
    { key: 'current', label: 'বর্তমান মাস', count: grouped.filter((group) => group.status === 'running').length },
    { key: 'all', label: 'সকল মাস', count: grouped.length },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="মেসের স্বচ্ছতা" title="খালার টাকা" description="সব মাসের পারিশ্রমিক দেখুন; সংশোধন শুধু অনুমোদিত মাসে করা যাবে।" />
      <section className="card khala-view-hero">
        <div>
          <span className="eyebrow">খালার আলাদা হিসাব</span>
          <h2>{formatCurrency(totalKhalaPaid)} মোট কার্যকর পারিশ্রমিক</h2>
          <p>এটি মেসের আলাদা খরচ; সদস্যের ব্যক্তিগত ব্যালেন্সে যোগ হয় না।</p>
          <div className="khala-view-hero-metrics"><div><span>কার্যকর এন্ট্রি</span><strong>{formatNumber(activeEntryCount)}টি</strong></div><div><span>অন্তর্ভুক্ত মাস</span><strong>{formatNumber(grouped.length)}টি</strong></div></div>
        </div>
        <button className="secondary-button compact" type="button" onClick={load} disabled={loading}><Icon name="refresh" size={15} /> রিফ্রেশ</button>
      </section>
      <div className="khala-period-tabs" role="tablist" aria-label="খালার টাকার মাস নির্বাচন">
        {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? 'is-active' : ''} onClick={() => setActiveTab(tab.key)}><span>{tab.label}</span><b>{formatNumber(tab.count)}</b></button>)}
      </div>
      {loading ? <LoadingSpinner label="খালার টাকার হিসাব লোড হচ্ছে..." /> : visibleGroups.length === 0 ? (
        <div className="empty-state-card"><Icon name="wallet" size={28} /><strong>{activeTab === 'previous' ? 'কোনো পূর্ববর্তী মাস নেই' : activeTab === 'current' ? 'কোনো চলমান মাস নেই' : 'এখনো কোনো খালার টাকার মাস নেই'}</strong><span>অন্য ট্যাবে মাস নির্বাচন করে দেখতে পারেন।</span></div>
      ) : visibleGroups.map((group) => (
        <section className="card khala-view-section" key={group.period_id}>
          <div className="section-heading khala-period-heading">
            <div><span className="eyebrow">কাজের মাস</span><h2>{group.label}</h2><div className="khala-period-badge-row">
              {group.status === 'running' ? <span className="khala-period-badge is-current">চলমান মাস</span> : group.can_manage_khala ? <span className="khala-period-badge is-editable">সম্পাদনার অনুমতি</span> : <span className="khala-period-badge is-locked"><Icon name="lock" size={12}/> শুধু দেখা · লক</span>}
              {group.manager_at_close_name && group.status !== 'running' && <small>বন্ধ করেছেন: {group.manager_at_close_name}</small>}
            </div></div>
            <div className="khala-period-total"><strong>{formatCurrency(group.total)}</strong><small>{formatNumber(group.count)}টি কার্যকর এন্ট্রি</small></div>
          </div>
          {group.can_manage_khala && <div className="khala-period-action"><span>এই মাসে আপনার খালার টাকার ব্যবস্থাপনার অনুমতি আছে।</span><button className="secondary-button compact" type="button" onClick={() => navigateTo(`/app/menu/khala-money?period_id=${encodeURIComponent(group.period_id)}`)}>এন্ট্রি পরিচালনা <Icon name="chevron-right" size={15}/></button></div>}
          {group.rows.length === 0 ? <div className="empty-state-card compact-empty"><Icon name="wallet" size={23}/><strong>এই মাসে কোনো এন্ট্রি নেই</strong><span>খালার পারিশ্রমিকের তথ্য যোগ হলে এখানে দেখা যাবে।</span></div> : <div className="khala-public-list">
            {group.rows.map((row) => (
              <article className={`khala-public-row ${row.status === 'void' ? 'is-void' : ''}`} key={row.entry_id}>
                <div className="khala-public-person"><span className="khala-ledger-mark"><Icon name="wallet" size={17}/></span><div className="khala-public-person-copy">
                  <div className="khala-ledger-recipient"><span>যাঁর নামে নথিভুক্ত</span><strong>{row.member_name && row.member_name !== 'খালার পারিশ্রমিক' ? row.member_name : row.recipient_name || 'সদস্যের নাম পাওয়া যায়নি'}</strong></div>
                  <strong className="khala-public-entry-kind">খালার পারিশ্রমিক</strong><small>পরিশোধ করেছেন: {row.created_by_name || row.actor_name || row.manager_name || row.entered_by_name || 'নাম পাওয়া যায়নি'}</small><small>প্রকৃত প্রদানের তারিখ: {formatDateWithWeekday(row.entry_date)}{row.description ? ` · ${row.description}` : ''}</small>
                </div></div>
                <div className="khala-public-amount"><strong>{formatCurrency(row.amount)}</strong><span className={`member-badge ${row.status === 'void' ? 'inactive' : 'subtle'}`}>{row.status === 'void' ? 'বাতিল' : 'পরিশোধিত'}</span></div>
              </article>
            ))}
          </div>}
        </section>
      ))}
    </div>
  );
}

function RankingPage({ kind }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const shopper = kind === 'shopper';
  const depositor = kind === 'depositor';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(shopper ? await fetchTopShoppers() : depositor ? await fetchTopDepositors() : await fetchTopEaters());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'র‌্যাঙ্কিং লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [depositor, shopper, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="চলতি মাসের মজার হিসাব"
        title={depositor ? 'বেশি ডিপোজিটকারী' : shopper ? 'বেশি বাজারকারী' : 'শীর্ষ খাদক'}
        description={depositor ? 'সদস্যের নামে জমা হওয়া মোট টাকা।' : shopper ? 'কার্যকর বাজারের মোট টাকার তালিকা।' : 'চূড়ান্ত হওয়া মোট মিলের তালিকা।'}
      />
      <InfoPanel className="finance-context-note" icon="activity">{depositor
        ? 'সদস্যের নামে জমা হওয়া মোট টাকা দেখানো হয়।'
        : shopper
          ? 'মোট বাজারের ভিত্তিতে তালিকা; বাজারকারী ও এন্ট্রিকারী আলাদা হতে পারেন।'
          : 'শুধু চূড়ান্ত হওয়া মিল গণনা করা হয়।'}</InfoPanel>
      <section className="card ranking-card">
        <div className="ranking-card-head">
          <div className={`ranking-hero-icon ${depositor ? 'depositor' : shopper ? 'shopper' : 'eater'}`}><Icon name={depositor ? 'wallet' : shopper ? 'shopping-bag' : 'trophy'} size={25} /></div>
          <div>
            <span className="eyebrow">অগ্রাধিকার তালিকা</span>
            <h2>{depositor ? 'এই মাসের বেশি ডিপোজিটকারীরা' : shopper ? 'বাজারের সেরা ক্রেতারা' : 'এই মাসের শীর্ষ খাদকরা'}</h2>
          </div>
          <button className="icon-button compact-icon ghost" type="button" onClick={load} aria-label="রিফ্রেশ"><Icon name="refresh" size={17} /></button>
        </div>
        {loading ? <LoadingSpinner label="র‌্যাঙ্কিং লোড হচ্ছে..." /> : rows.length === 0 ? (
          <div className="empty-state-card compact-empty"><Icon name={depositor ? 'wallet' : shopper ? 'shopping-bag' : 'trophy'} size={25} /><strong>এখনো কোনো র‌্যাঙ্কিং নেই</strong><span>এই মাসের তথ্য যোগ হলে তালিকা এখানে দেখা যাবে।</span></div>
        ) : (
          <div className="ranking-list">
            {rows.map((row, index) => {
              // The existing RPC contract returns rank/meals/total_market.
              // Keep compatibility with newer aliases without changing server order.
              const rankNo = Number(row.rank_no ?? row.rank ?? index + 1);
              const safeRank = Number.isFinite(rankNo) && rankNo > 0 ? rankNo : index + 1;
              const memberName = row.member_name || row.full_name || 'নাম নেই';
              const amount = depositor
                ? (row.total_deposit ?? row.deposit ?? row.amount ?? 0)
                : shopper
                  ? (row.total_market_amount ?? row.total_market ?? row.amount ?? 0)
                  : (row.total_meals ?? row.meals ?? 0);
              const firstRank = Boolean(row.is_first) || safeRank === 1;
              return (
                <article className={`ranking-row ${firstRank ? 'first-rank' : ''}`} key={row.membership_id || row.member_id || `${memberName}-${safeRank}`}>
                  <div className={`rank-number ${safeRank <= 3 ? `rank-${safeRank}` : ''}`} aria-label={`ক্রমিক ${safeRank}`}>{formatNumber(safeRank, { maximumFractionDigits: 0 })}</div>
                  <div className="rank-avatar-wrap"><Avatar member={{ member_name: memberName }} />{firstRank && <span className="rank-crown"><Icon name="crown" size={13} /></span>}</div>
                  <div className="rank-copy"><strong>{safeRank <= 3 ? '🏆 ' : ''}{memberName}</strong><small>{firstRank ? '🏆 সবার আগে' : `ক্রমিক ${formatNumber(safeRank, { maximumFractionDigits: 0 })}`}</small></div>
                  <div className="rank-value"><strong>{shopper || depositor ? formatCurrency(amount) : formatNumber(amount, { maximumFractionDigits: 1 })}</strong><span>{depositor ? 'ডিপোজিট' : shopper ? 'বাজার' : 'মিল'}</span></div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function TopEatersPage() { return <RankingPage kind="eater" />; }
export function TopShoppersPage() { return <RankingPage kind="shopper" />; }
export function TopDepositorsPage() { return <RankingPage kind="depositor" />; }

export function DeveloperInfoPage() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetchPlatformPublicSettings().then((settings) => { if (active) setInfo(settings || {}); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const phoneDigits = String(info?.developer_phone || '').replace(/[^0-9+]/g, '');
  const photo = info?.developer_photo_url || '';
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Hostel Life" title="হেল্প" description="সহায়তা ও যোগাযোগ।" />
      <section className="card developer-card">
        {photo ? <img className="developer-photo-placeholder developer-photo-image" src={photo} alt={info?.developer_name || 'ডেভেলপার'} loading="lazy" /> : <div className="developer-photo-placeholder" aria-label="ডেভেলপার"><Icon name="user" size={42} /></div>}
        <div className="developer-name">{loading ? 'তথ্য লোড হচ্ছে…' : info?.developer_name || 'Hostel Life Support'}</div>
        {info?.developer_title && <div className="developer-subtitle">{info.developer_title}</div>}
        {failed && <div className="developer-note">ডেভেলপার তথ্য লোড করা যায়নি। ডাটাবেজের Phase 2 public settings migration যাচাই করুন।</div>}
        <div className="developer-contact-list">
          {info?.developer_email && <a className="developer-contact" href={`mailto:${info.developer_email}`}><span className="developer-contact-icon"><Icon name="mail" size={18} /></span><span><small>ইমেইল</small><strong>{info.developer_email}</strong></span><Icon name="external-link" size={16} /></a>}
          {info?.developer_phone && <a className="developer-contact" href={`https://wa.me/${phoneDigits.replace(/^\+/, '')}`} target="_blank" rel="noreferrer"><span className="developer-contact-icon"><Icon name="phone" size={18} /></span><span><small>ফোন / হোয়াটসঅ্যাপ</small><strong>{info.developer_phone}</strong></span><Icon name="external-link" size={16} /></a>}
          {info?.developer_portfolio_url && <a className="developer-contact" href={info.developer_portfolio_url} target="_blank" rel="noreferrer"><span className="developer-contact-icon"><Icon name="external-link" size={18} /></span><span><small>Portfolio</small><strong>{info.developer_portfolio_url.replace(/^https?:\/\//, '')}</strong></span><Icon name="external-link" size={16} /></a>}
          {!loading && !failed && !info?.developer_email && !info?.developer_phone && !info?.developer_portfolio_url && <div className="developer-note">যোগাযোগের তথ্য এখনো সেট করা হয়নি।</div>}
        </div>
      </section>
    </div>
  );
}

export function PrivacyPolicyPage() {
  const sections = [
    ['কোন তথ্য ব্যবহৃত হয়', 'অ্যাকাউন্ট পরিচালনার জন্য আপনার নাম, ইমেইল, মোবাইল নম্বর ও প্রোফাইল ছবি ব্যবহার হতে পারে। মেস পরিচালনার জন্য সদস্যতা, ভূমিকা, মিল, বাজার, জমা-খরচ, ব্যালেন্স, হিসাব ইতিহাস, ঐতিহাসিক রেকর্ড, আর্কাইভ, অনুরোধ, নোটিশ ও সংশ্লিষ্ট রেকর্ড সংরক্ষিত হয়। নিরাপত্তার জন্য IP address, লগইন বা নিবন্ধনের সময় দেওয়া ইমেইল, ঘটনার সময়, ডিভাইস/ব্রাউজার-সংক্রান্ত তথ্য, অনুরোধের উৎস এবং সীমিত HMAC fingerprint-ও ব্যবহৃত হতে পারে। অ্যাপ GPS বা ডিভাইসের সুনির্দিষ্ট অবস্থান চায় না; দেশ, শহর বা অঞ্চল শনাক্ত করার তথ্যও বর্তমান নিরাপত্তা-লগে ব্যবহার করা হয় না।'],
    ['তথ্য কী কাজে ব্যবহার হয়', 'অ্যাকাউন্ট ও সদস্যতা পরিচালনা, মিল ও বাজারের হিসাব, জমা-খরচের রেকর্ড, রিপোর্ট, নোটিফিকেশন, সহায়তা এবং অননুমোদিত প্রবেশ বা অপব্যবহার শনাক্ত করতে প্রয়োজনীয় তথ্য ব্যবহার করা হয়।'],
    ['কারা কোন তথ্য দেখতে পারেন', 'একই মেসের সদস্যরা তাঁদের ভূমিকা ও অনুমতি অনুযায়ী সদস্য তালিকা, মিল, বাজার, জমা-খরচ ও সংশ্লিষ্ট রেকর্ড দেখতে পারেন। ম্যানেজার ও অনুমোদিত সহকারীর দৃশ্যমানতা এবং সম্পাদনার ক্ষমতা সাধারণ সদস্যের চেয়ে বিস্তৃত হতে পারে। প্ল্যাটফর্ম পরিচালনাকারীরা দৈনন্দিন ব্যক্তিগত হিসাব পর্যালোচনা করেন না; সহায়তা বা নিরাপত্তা তদন্তে প্রয়োজন হলে অনুমোদিত সীমিত প্রবেশাধিকার প্রযোজ্য হতে পারে।'],
    ['তথ্য শেয়ার ও সংযুক্ত সেবা', 'হোস্টিং, ডেটাবেজ, নিরাপদ নেটওয়ার্ক ও অ্যাপ সচল রাখার জন্য সংশ্লিষ্ট প্রযুক্তিগত সেবাদাতা প্রয়োজনীয় তথ্য প্রক্রিয়া করতে পারে। Google Sign-In সংযুক্ত নেই; Google অ্যাকাউন্টের তথ্য সংগ্রহ বা ব্যবহার করা হয় না। ব্যবহারকারীর তথ্য বিক্রি বা ভাড়া দেওয়া হয় না।'],
    ['তথ্য সংরক্ষণ ও মেয়াদ', 'নিরাপত্তা ও লগইন-সংক্রান্ত রেকর্ড এবং অ্যাপের সেশন তথ্যে থাকা IP address ও ব্রাউজার/ডিভাইস-সংক্রান্ত তথ্য ৩০ দিনের মেয়াদ পূর্ণ হলে নির্ধারিত দৈনিক স্বয়ংক্রিয় cleanup-এ মুছে ফেলা হয়। Password Reset-এর IP-ভিত্তিক সাময়িক প্রচেষ্টার তথ্য সর্বোচ্চ ৪৮ ঘণ্টা থাকে। পাসওয়ার্ড রিসেটের মাসিক সীমা রক্ষা করতে ইমেইলের একটি ফেরত-নির্ণয় করা যায় না এমন যাচাই-চিহ্ন সর্বোচ্চ ৩৫ দিন রাখা হতে পারে। কোনো IP block সক্রিয় থাকা পর্যন্ত সংশ্লিষ্ট IP রাখা হয়; মেয়াদ শেষ হলে block record পরিষ্কার হয়। হোস্টিং ও প্রমাণীকরণ-সেবাদাতার নিজস্ব অবকাঠামোতে তাদের নীতি অনুযায়ী কিছু প্রযুক্তিগত তথ্য প্রক্রিয়া হতে পারে; সেটি Hostel Life-এর নিজস্ব লগ সংরক্ষণ থেকে আলাদা। প্ল্যাটফর্মের প্রশাসনিক নিরীক্ষা-রেকর্ড আলাদা সংরক্ষণ ব্যবস্থায় রাখা হয়। অ্যাকাউন্ট, মেসের হিসাব ও আর্কাইভের তথ্য তাদের নিজস্ব পরিচালনাগত ও সংরক্ষণ নীতি অনুযায়ী থাকে।'],
    ['নিরাপত্তা ও আপনার নিয়ন্ত্রণ', 'Password, OTP code বা Authenticator secret Security Event-এ সংরক্ষণ করা হয় না। নিজের পাসওয়ার্ড ও Join Code গোপন রাখুন, শেয়ার করা ডিভাইস থেকে লগআউট করুন এবং ভুল তথ্য সংশোধনে অ্যাপের অনুমোদিত পদ্ধতি বা মেসের ম্যানেজারের সহায়তা নিন। কোনো তথ্য মুছে ফেললে যৌথ হিসাব ও অন্য সদস্যের রেকর্ডে প্রভাব পড়তে পারে; তাই অনুরোধ যাচাই করে ব্যবস্থা নেওয়া হয়।'],
    ['ঐচ্ছিক টেলিগ্রাম সংযোগ', 'ঐচ্ছিক টেলিগ্রাম সংযোগ স্বেচ্ছামূলক। সংযুক্ত করলে টেলিগ্রাম চ্যাট আইডি, ইউজার আইডি এবং পাওয়া গেলে ইউজারনেম সংরক্ষিত হতে পারে। বিজ্ঞপ্তির শিরোনাম ও বার্তার লেখা সংযুক্ত টেলিগ্রাম অ্যাকাউন্টে পাঠানো হয়। মেনু থেকে যেকোনো সময় বিচ্ছিন্ন করা যাবে; এরপর নতুন বিজ্ঞপ্তি আর পাঠানো হবে না।'],
    ['বয়স-যোগ্যতা ও নীতির পরিবর্তন', 'বর্তমানে অ্যাকাউন্ট তৈরি করতে বয়স কমপক্ষে ১৮ বছর হতে হবে। সেবার কার্যপ্রণালি বা নিরাপত্তা ব্যবস্থা বদলালে এই নীতি হালনাগাদ হতে পারে। গোপনীয়তা বা অ্যাকাউন্ট-সংক্রান্ত প্রশ্নে Hostel Life Support-এর সঙ্গে যোগাযোগ করুন।'],
  ];
  return (
    <div className="page-stack">
      <PageHeader eyebrow="সিস্টেম তথ্য" title="গোপনীয়তা নীতি" />
      <p className="policy-public-full-link"><a href="/privacy-policy">প্রকাশ্য গোপনীয়তা নীতি</a></p>
      <section className="card policy-content-card policy-document-card">
        <div className="policy-document-lead"><Icon name="shield-check" size={24}/><div><strong>আপনার তথ্য প্রয়োজন অনুযায়ী ব্যবহৃত ও ভূমিকা অনুযায়ী দেখানো হয়</strong><p>অ্যাকাউন্ট, মেসের হিসাব এবং নিরাপত্তা-সংক্রান্ত তথ্যের ব্যবহার ও সংরক্ষণের নিয়ম নিচে দেওয়া হলো।</p></div></div>
        {sections.map(([title, description], index) => (
          <div className="policy-section-block" key={title}>
            <h2>{formatNumber(index + 1, { maximumFractionDigits: 0 })}. {title}</h2>
            <p>{description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

export function TermsPage() {
  const terms = [
    ['সেবার উদ্দেশ্য', 'Hostel Life মেসের সদস্য, মিল, বাজার, জমা-খরচ, নোটিশ ও সংশ্লিষ্ট হিসাবের রেকর্ড গুছিয়ে রাখতে সহায়তা করে। এটি হিসাব ব্যবস্থাপনার মাধ্যম; অ্যাপটি নিজে পেমেন্ট গেটওয়ে নয় এবং সরাসরি টাকা গ্রহণ বা স্থানান্তর করে না।'],
    ['ব্যবহারের যোগ্যতা', 'বর্তমানে অ্যাকাউন্ট তৈরি ও ব্যবহার করতে বয়স কমপক্ষে ১৮ বছর হতে হবে। বর্তমানে এই অ্যাপে Google Sign-In নেই; নির্ধারিত নিবন্ধন-পদ্ধতি ব্যবহার করুন। নিবন্ধনের সময় সঠিক তথ্য দিন এবং এই যোগ্যতা পূরণ না হলে অ্যাকাউন্ট তৈরি করবেন না।'],
    ['অ্যাকাউন্ট ও নিরাপত্তা', 'নিজের অ্যাকাউন্ট, পাসওয়ার্ড ও OTP গোপন রাখুন। অন্যের অ্যাকাউন্ট অনুমতি ছাড়া ব্যবহার করবেন না। ব্যক্তিগত আমন্ত্রণের Join Code ও Invitation Link সুরক্ষিত রাখুন। ব্যক্তিগত Join Code ও Invitation Link কেবল অনুমোদিত ব্যক্তির সঙ্গে ব্যক্তিগতভাবে ভাগ করুন; প্রকাশ্যে দেবেন না। ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়। ঐচ্ছিক Telegram সংযোগ যেকোনো সময় বিচ্ছিন্ন করা যাবে।'],
    ['ভূমিকা ও অনুমতি', 'সাধারণ সদস্য, সহকারী ম্যানেজার ও প্রধান ম্যানেজারের ক্ষমতা আলাদা। নিজের অনুমতির বাইরে কোনো রেকর্ড দেখা, পরিবর্তন, মুছে ফেলা বা অন্যকে অনুমতি দেওয়ার চেষ্টা করা যাবে না। সম্পাদনার ক্ষমতা সংশ্লিষ্ট ভূমিকা ও সার্ভার-যাচাইকৃত অনুমতির মধ্যে সীমিত।'],
    ['দায়িত্বশীল ব্যবহার', 'মিলের অনুরোধ সময়মতো দিন এবং Late Request বা Correction-এর ক্ষেত্রে অনুমোদন ও সময়সীমা মেনে চলুন। বাজার, জমা, খরচ ও খালার পারিশ্রমিকের তথ্য বাস্তব অনুযায়ী লিখুন। ভুয়া অ্যাকাউন্ট তৈরি, ভুয়া/ডুপ্লিকেট এন্ট্রি, প্রতারণা, হয়রানি, অননুমোদিত প্রবেশ, অন্যের তথ্য অপব্যবহার বা সেবা ব্যাহত করা নিষিদ্ধ।'],
    ['হিসাব ও রেকর্ডের দায়িত্ব', 'অ্যাপের হিসাব ব্যবহারকারীদের দেওয়া তথ্যের ভিত্তিতে তৈরি হয়। গুরুত্বপূর্ণ এন্ট্রি ও রিপোর্ট যাচাই করুন। ভুল রেকর্ড হলে অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন। বন্ধ মাসের রেকর্ডে সম্পাদনার অধিকার কেবল সার্ভার-অনুমোদিত ব্যক্তির থাকে; সংশোধনের কারণ অডিটে সংরক্ষিত হতে পারে। গুরুত্বপূর্ণ হিসাবের নিজস্ব কপি রাখুন।'],
    ['সেবার প্রাপ্যতা ও পরিবর্তন', 'নেটওয়ার্ক, ডিভাইস বা রক্ষণাবেক্ষণের কারণে কিছু ফিচার সাময়িকভাবে ব্যাহত হতে পারে। অফলাইনে দেখা তথ্য সর্বশেষ সংরক্ষিত কপি হতে পারে; ইন্টারনেট ছাড়া সব পরিবর্তন জমা হয়েছে ধরে নেবেন না। সেবার কার্যপ্রণালি বা শর্তাবলী পরিবর্তিত হলে হালনাগাদ সংস্করণ প্রকাশ করা হবে।'],
  ];
  return (
    <div className="page-stack">
      <PageHeader eyebrow="সিস্টেম তথ্য" title="ব্যবহারের শর্তাবলী" />
      <p className="policy-public-full-link"><a href="/terms-of-service">প্রকাশ্য ব্যবহারের শর্তাবলী</a></p>
      <section className="card policy-content-card policy-document-card">
        <div className="policy-document-lead"><Icon name="book-open" size={24}/><div><strong>অ্যাপ ব্যবহারের নিয়ম</strong><p>অ্যাকাউন্ট, মেসের হিসাব এবং অন্য সদস্যের তথ্য ব্যবহারের সময় নিচের শর্তগুলো প্রযোজ্য।</p></div></div>
        {terms.map(([title, description], index) => (
          <div className="policy-section-block" key={title}>
            <h2>{formatNumber(index + 1, { maximumFractionDigits: 0 })}. {title}</h2>
            <p>{description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

const HOW_TO_USE_GROUPS = [
  {
    id: 'getting-started', icon: 'user-plus', title: 'শুরু ও মেসে যুক্ত হওয়া', description: 'অ্যাকাউন্ট, ১২ অক্ষরের Join Code, Invitation Link এবং নতুন মেস তৈরির ধাপ।',
    items: [
      ['নতুন অ্যাকাউন্ট কীভাবে তৈরি করব?', 'লগইন পেজে “রেজিস্ট্রেশন” নির্বাচন করে নিজের নাম, ইমেইল ও প্রয়োজনীয় তথ্য দিন। প্রয়োজন হলে ইমেইল যাচাই সম্পন্ন করুন। অ্যাকাউন্ট তৈরি হলেও কোনো মেসে যুক্ত না থাকলে অ্যাপ আপনাকে মেসে যোগদান বা নতুন মেস তৈরির পেজে নিয়ে যাবে।'],
      ['আগে থেকেই থাকা মেসে কীভাবে যুক্ত হব?', 'ম্যানেজারের কাছ থেকে পাওয়া ১২ অক্ষরের বড় হাতের Hex Join Code নিন। মেস সেটআপ পেজে “মেসে যুক্ত হন” নির্বাচন করে কোড লিখুন। কোড সঠিক হলে সদস্যতা সক্রিয় হবে এবং ড্যাশবোর্ডে যেতে পারবেন। পুরোনো ৮ অক্ষরের কোড Run28 Migration-এর পর আর কাজ করবে না।'],
      ['Invitation Link দিয়ে কীভাবে যুক্ত হব?', 'ম্যানেজার বা অনুমোদিত সহকারীর কাছ থেকে ব্যক্তিগত Invitation Link নিন। লিংক খুলে অ্যাকাউন্ট তৈরি বা লগইন করে Join Request পাঠান। ম্যানেজার বা সহকারী অনুমোদন করলে সদস্যতা সক্রিয় হবে; Join Code দিতে হবে না। বাতিল হলে আপনার অ্যাকাউন্ট থাকবে এবং চাইলে পরে সাধারণ Join Code ব্যবহার করতে পারবেন।'],
      ['Invitation Link দিয়ে কীভাবে নিরাপদে যুক্ত হব?', 'ম্যানেজার বা অনুমোদিত সহকারীর কাছ থেকে পাওয়া ব্যক্তিগত Invitation Link খুলে আগে নিজের অ্যাকাউন্টে লগইন বা রেজিস্ট্রেশন করুন। এরপর সার্ভার লিংক ও অ্যাকাউন্ট যাচাই করবে। Join Request পাঠানোর পর ম্যানেজার বা সহকারী অনুমোদন করলে সদস্যপদ সক্রিয় হবে। এই লিংক দিয়ে লগইন ছাড়া কোনো মেসের ড্যাশবোর্ড বা ব্যক্তিগত তথ্য দেখা যায় না।'],
      ['নিজের মেস কীভাবে তৈরি করব?', 'মেস সেটআপ পেজে “মেস তৈরি করুন” নির্বাচন করে মেসের নাম লিখুন। সিস্টেমে মেস তৈরির অনুমতি-কোড চালু থাকলে সেটিও দিতে হবে। মেস তৈরি হলে আপনি ম্যানেজার হবেন এবং একটি Join Code পাবেন। কোডটি কেবল নির্দিষ্ট সদস্যকে ব্যক্তিগতভাবে দিন—প্রকাশ্যে নয়।'],
      ['রেজিস্ট্রেশনের পর কেন মেস সেটআপ পেজে থাকি?', 'আপনার অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু এখনো কোনো মেসের সদস্যতা নেই—তাই ড্যাশবোর্ড খালি না দেখিয়ে আগে মেসে যোগদান বা নতুন মেস তৈরির সুযোগ দেখানো হয়। অন্য অ্যাকাউন্ট ব্যবহার করতে চাইলে ওই পেজের “লগইন / রেজিস্ট্রেশন পেজে ফিরুন” বোতাম ব্যবহার করুন।'],
      ['অন্য অ্যাকাউন্ট ব্যবহার করতে চাইলে কী করব?', 'মেস সেটআপ পেজের “অন্য অ্যাকাউন্ট ব্যবহার করুন” বোতাম থেকে বর্তমান ডিভাইসের সেশন বন্ধ করে নতুন অ্যাকাউন্ট দিয়ে লগইন করুন।'],
      ['মেসের সকল সদস্য ও তাঁদের বর্তমান হিসাব কোথায় দেখব?', 'থ্রি-লাইন মেনু → “সকল সদস্য” খুলুন। এখানে মেসের সদস্য তালিকা, ভূমিকা এবং চলতি মাস চালু থাকলে সদস্যভিত্তিক জমা, মিল, খরচ ও বকেয়া/অবশিষ্টের সারাংশ দেখতে পারবেন। কারও নাম চাপলে তাঁর উপলভ্য মাসিক বিস্তারিত খুলবে।'],
    ],
  },
  {
    id: 'meal-requests', icon: 'calendar', title: 'মিল অনুরোধ, Late Request ও সংশোধন', description: 'সাধারণ অনুরোধ, দৈনিক ফাইনাল এবং অনুমোদনের নিয়ম।',
    items: [
      ['সাধারণ মিল অনুরোধ কীভাবে দেব?', 'ডাইনিং → “আমার মিল” বা “মিল অনুরোধ” → “নতুন মিল অনুরোধ” খুলুন। একটি দিন বা তারিখের পরিসর নির্বাচন করে প্রতিদিনের ব্রেকফাস্ট, লাঞ্চ ও ডিনারের মিলের পরিমাণ ঠিক করুন, তারপর জমা দিন। সফল সাধারণ অনুরোধ স্বয়ংক্রিয়ভাবে অনুমোদিত হয়; পরে “অনুরোধের ইতিহাস” থেকে স্ট্যাটাস দেখুন।'],
      ['সাধারণ মিল অনুরোধের শেষ সময় কখন?', 'যে দিনের মিল চান, তার আগের দিন বাংলাদেশ সময় রাত ১০টার আগে সাধারণ অনুরোধ জমা দিতে হবে। রাত ১০টার কাট-অফ পেরিয়ে গেলে ওই দিনের জন্য Late Request-এর নিয়ম প্রযোজ্য হয়।'],
      ['Late Request কখন ও কোথা থেকে দেব?', 'সাধারণ কাট-অফ—আগের দিনের রাত ১০টা—পেরিয়ে গেলে মিলের তারিখের রাত ৯টার ফাইনাল হওয়ার আগ পর্যন্ত Late Request দেওয়া যায়। ডাইনিং → “মিল অনুরোধ” → “লেট অনুরোধ” খুলে তারিখ ও মিলের তথ্য দিন। এটি স্বয়ংক্রিয়ভাবে অনুমোদিত হয় না; ম্যানেজার বা অনুমোদিত সহকারী ম্যানেজারের অনুমোদন লাগবে।'],
      ['আগের দেওয়া মিল কীভাবে সংশোধনের আবেদন করব?', 'ডাইনিং → “মিল অনুরোধ” → “অনুরোধের ইতিহাস” খুলুন। সংশ্লিষ্ট অনুরোধের বিস্তারিত খুলে “সংশোধনের আবেদন” অপশন থাকলে সেটি ব্যবহার করুন, কারণ লিখুন এবং নতুন মিলের তথ্য দিন। আবেদন কেবল প্রযোজ্য তারিখের সময়সীমায় করা যায় এবং অনুমোদন না হওয়া পর্যন্ত সংশোধিত মিল চূড়ান্ত নয়।'],
      ['মিল কখন ফাইনাল হয়?', 'প্রতিদিন বাংলাদেশ সময় রাত ৯টায় ওই দিনের মিল ফাইনাল হয়। ফাইনাল হওয়ার পর সদস্য নিজে সাধারণ বা Late/Correction অনুরোধ দিয়ে সেই দিনের হিসাব বদলাতে পারবেন না। অনুমোদিত ম্যানেজারের বিশেষ প্রশাসনিক ক্ষমতা আলাদা নিয়মে কাজ করে।'],
      ['আমার অনুরোধ জমা হয়েছে কি না কীভাবে বুঝব?', 'ডাইনিং → “মিল অনুরোধ” → “অনুরোধের ইতিহাস” খুলে সংশ্লিষ্ট তারিখ ও স্ট্যাটাস দেখুন। শুধু বোতাম চাপা বা নোটিফিকেশন দেখা যথেষ্ট নয়; “অনুমোদিত”, “অপেক্ষমাণ” বা “বাতিল” অবস্থা যাচাই করুন।'],
    ],
  },
  {
    id: 'dining-money', icon: 'cooking-pot', title: 'বাজার ও টাকার হিসাব', description: 'বাজার এন্ট্রি, জমা, অন্যান্য খরচ ও খালার পারিশ্রমিক।',
    items: [
      ['বাজার এন্ট্রি কীভাবে করব?', 'ডাইনিং → “বাজার এন্ট্রি” খুলুন। বাজারের তারিখ, বাজারকারীর নাম এবং প্রতিটি আইটেম, পরিমাণ ও টাকার অঙ্ক লিখুন। সর্বমোট দেখে সংরক্ষণ করুন। সদস্য সাধারণত নিজের নামে বাজার দিতে পারবেন; ম্যানেজার অনুমতি অনুযায়ী অন্য সদস্যের নামেও এন্ট্রি দিতে পারেন।'],
      ['“বাজারের টাকা ডিপোজিট হিসেবে যুক্ত করুন” অপশনটি কী?', 'এই অপশন ON করলে ওই বাজার এন্ট্রির সম্পূর্ণ মোট টাকা নির্বাচিত সদস্যের হিসাবে বাজার-ডিপোজিট হিসেবে যোগ হবে। OFF থাকলে বাজারের মোট টাকা ওই সদস্যের ডিপোজিটে যোগ হবে না। সংরক্ষণের আগে অপশনের ON/OFF অবস্থা ও বাজারকারীর নাম যাচাই করুন।'],
      ['ডিপোজিট ও অন্যান্য খরচ কোথায় দেব?', 'অনুমোদিত ম্যানেজার/সহকারী ম্যানেজার ডাইনিং-এর “ডিপোজিট” থেকে সদস্যের জমা যোগ করতে এবং “অন্যান্য খরচ” থেকে বিবরণসহ খরচ লিখতে পারেন। সঠিক সদস্য, তারিখ ও পরিমাণ নির্বাচন করে সংরক্ষণ করুন।'],
      ['ড্যাশবোর্ডে আমার বকেয়া বা অবশিষ্ট কীভাবে বুঝব?', 'ড্যাশবোর্ডের “আমার হিসাব” কার্ডে জমা, মোট মিল, মিল খরচ ও অন্যান্য খরচ দেখুন। “বর্তমান বকেয়া” দেখালে ওই পরিমাণ পরিশোধ বাকি; “বর্তমান অবশিষ্ট” দেখালে ওই পরিমাণ জমা/হিসাবের পর অবশিষ্ট আছে। বিস্তারিত বুঝতে কার্ডে নিজের নাম চাপুন।'],
      ['খালার টাকা কোথায় যোগ হয় এবং হিসাব কীভাবে দেখা যায়?', 'ম্যানেজার মেনুর “খালার টাকা” থেকে পারিশ্রমিকের তারিখ, বিবরণ ও পরিমাণ আলাদা করে লিখুন। এটি সদস্যের ব্যক্তিগত মিল-খরচ বা ব্যালেন্সের অংশ নয়। থ্রি-লাইন মেনুর “খালার টাকা” অংশে মাসভিত্তিক এন্ট্রিগুলো দেখা যায়।'],
      ['বাজার বা টাকার এন্ট্রিতে ভুল হলে কী করব?', 'এন্ট্রির তারিখ, নাম ও পরিমাণ যাচাই করে হিস্টরি থেকে সংশ্লিষ্ট রেকর্ড খুলুন। যেসব সংশোধন-অপশন আপনার ভূমিকার জন্য দেখানো হয়, শুধু সেগুলো ব্যবহার করুন। প্রয়োজন হলে ম্যানেজারকে কারণসহ জানান; পুরোনো এন্ট্রি গোপনে বদলানো বা ডুপ্লিকেট এন্ট্রি দেবেন না।'],
    ],
  },
  {
    id: 'history-reports', icon: 'history', title: 'হিস্টরি, পূর্ববর্তী মাস ও রিপোর্ট', description: 'বাজারের রেকর্ড, ব্যক্তিগত হিসাব এবং PDF রিপোর্ট।',
    items: [
      ['হিস্টরিতে কী কী পাওয়া যায়?', 'হিস্টরি পেজে “বাজার ইতিহাস”, “হিসাব ইতিহাস” এবং “পূর্ববর্তী মাস”—এই তিনটি বিভাগ আছে। বাজার ইতিহাসে তারিখ/বাজারকারী অনুযায়ী রেকর্ড ফিল্টার করতে পারবেন; হিসাব ইতিহাসে লেনদেনের বিবরণ দেখবেন; পূর্ববর্তী মাসে বন্ধ মাসের সংরক্ষিত তথ্য পাবেন।'],
      ['আমি কি অন্য সদস্যের হিসাব দেখতে পারব?', 'সাধারণ সদস্য হিসাব ইতিহাসে নিজের প্রাসঙ্গিক হিসাব দেখতে পারেন। ম্যানেজার বা অনুমোদিত ব্যবস্থাপনা-ভূমিকা প্রয়োজন অনুযায়ী সদস্য নির্বাচন করে হিসাব দেখতে পারেন। মেসের কিছু বাজার/মিলের রেকর্ড সবার জন্য দৃশ্যমান হতে পারে, তবে সম্পাদনার অনুমতি সীমিত।'],
      ['পূর্ববর্তী মাসের বিস্তারিত কোথায় পাব?', 'হিস্টরি → “পূর্ববর্তী মাস” খুলুন। যে মাস দেখতে চান সেটি নির্বাচন করুন। আর্কাইভে বিস্তারিত হিসাব বা সংরক্ষিত চূড়ান্ত সারসংক্ষেপ—যেটি উপলব্ধ—সেটি দেখা যাবে। সংরক্ষণ নীতির পরিসর একই অংশে দেখানো হয়।'],
      ['PDF বা প্রিন্ট কীভাবে করব?', 'হিস্টরির বর্তমান বিভাগে “PDF / প্রিন্ট” বোতাম চাপুন। পূর্ববর্তী মাসের বিস্তারিত খুললে সেখানকার PDF/প্রিন্ট বোতাম ব্যবহার করুন। রিপোর্ট সংরক্ষণের আগে নির্বাচিত মাস, তারিখ, সদস্য ও মোট হিসাব মিলিয়ে নিন।'],
      ['মিল শিট কোথায় পাব?', 'থ্রি-লাইন মেনু → “মিল শিট” খুলুন। চলমান মাসের দৈনিক ও সদস্যভিত্তিক মিলের সারাংশ দেখুন। সদস্য নির্বাচন করে তাঁর বিস্তারিত মিলও দেখা যায় এবং উপরের PDF/প্রিন্ট অপশন দিয়ে সংরক্ষণ করা যায়।'],
      ['রিপোর্ট ডাউনলোড কীভাবে করব?', 'থ্রি-লাইন মেনু → “রিপোর্ট ডাউনলোড” বা “রিপোর্ট কেন্দ্র” খুলুন। অনুমতি ও চলমান মাসের তথ্য উপলভ্য থাকলে ফাইনাল হিসাব, বাজার, ডিপোজিট এবং পূর্ণ মাসিক প্রতিবেদন আলাদা PDF হিসেবে তৈরি করতে পারবেন। রিপোর্ট তৈরির আগে মাস ও হিসাব মিলিয়ে নিন।'],
      ['শীর্ষ খাদক, বেশি বাজারকারী ও বেশি ডিপোজিটকারীর তালিকা কীভাবে তৈরি হয়?', 'থ্রি-লাইন মেনুর “শীর্ষ খাদক” তালিকায় চলতি মাসের ফাইনাল হওয়া মিলের মোট পরিমাণ অনুযায়ী, “বেশি বাজারকারী” তালিকায় কার্যকর বাজার এন্ট্রির মোট টাকার ভিত্তিতে এবং “বেশি ডিপোজিটকারী” তালিকায় সদস্যের নামে জমা হওয়া মোট ডিপোজিটের ভিত্তিতে ক্রম দেখানো হয়। ডিপোজিটে নগদ জমা ও বাজার বাবদ জমা—দুটিই অন্তর্ভুক্ত। এগুলো র‍্যাঙ্কিং; সদস্যের ব্যক্তিগত পুরস্কার বা পাওনা নয়।'],
      ['পুরোনো হিসাব কি বদলানো যায়?', 'বন্ধ মাসের রেকর্ড স্বাভাবিকভাবে আর্কাইভে সংরক্ষিত থাকে। সংশোধন কেবল সেই কাজের জন্য অনুমোদিত ম্যানেজার বা বৈধ Archive Edit Permission থাকলে করা যায়। সংশোধনের কারণ ও অডিট তথ্য সংরক্ষিত হতে পারে।'],
    ],
  },
  {
    id: 'manager-month', icon: 'shield-check', title: 'ম্যানেজার ও মাস পরিচালনা', description: 'সদস্য ব্যবস্থাপনা, মাস বন্ধ/শুরু এবং অনুমোদনের কাজ।',
    items: [
      ['Late ও Correction Request কে অনুমোদন করেন?', 'ম্যানেজার মেনুর “মিল অনুরোধ”/ডাইনিং-এর ম্যানেজার অনুরোধ অংশে অপেক্ষমাণ আবেদন দেখা যায়। ম্যানেজার বা অনুমোদিত সহকারী আবেদন যাচাই করে গ্রহণ বা প্রত্যাখ্যান করতে পারেন। অনুমোদনের আগে আবেদনকে চূড়ান্ত মিল হিসেবে গণনা করবেন না।'],
      ['সহকারী ম্যানেজার কি ফাইনাল মিল যোগ বা সংশোধন করতে পারবেন?', 'হ্যাঁ। চলমান মাসে যাঁকে সহকারী ম্যানেজার হিসেবে নির্ধারণ করা হয়েছে, তিনি ডাইনিং → এডমিন এন্ট্রি → “ফাইনাল মিল যোগ ও সংশোধন” ব্যবহার করতে পারবেন। শুধু ইতিমধ্যে চূড়ান্ত হওয়া দিনের মিল যোগ বা সংশোধন করা যাবে; আজ বা ভবিষ্যতের দিন নয়। এই সুবিধার জন্য Supabase-এ Run22 অনুমতি-আপডেট Migration প্রয়োগ থাকতে হবে। বন্ধ মাসের আর্কাইভ সংশোধন আলাদা অনুমতি এবং আগের নিয়ম অনুযায়ী থাকবে।'],
      ['মেস সেটিংস কে ব্যবহার করতে পারবেন?', 'বর্তমান প্রধান ম্যানেজার এবং চলমান মাসে নির্ধারিত সহকারী ম্যানেজার মেস সেটিংস থেকে মেসের নাম পরিবর্তন ও নতুন যুক্ত হওয়ার কোড তৈরি করতে পারবেন। নতুন কোড তৈরি করলে আগের কোড দিয়ে নতুন সদস্য যুক্ত হওয়া যাবে না। সহকারীর অনুমতি চলমান মাসে তাঁর নির্ধারিত দায়িত্বের সঙ্গে যুক্ত।'],
      ['Invitation Link দিয়ে কীভাবে নতুন সদস্য যুক্ত করব?', 'মেস সেটিংস থেকে ম্যানেজার বা অনুমোদিত সহকারী নতুন আমন্ত্রণ লিংক তৈরি করে শেয়ার করতে পারবেন। আমন্ত্রিত ব্যক্তি অ্যাকাউন্ট তৈরি করে Join Request পাঠাবেন; অনুমোদনের পরই সদস্যপদ চালু হবে। নতুন লিংক তৈরি করলে আগের লিংক বাতিল হবে।'],
      ['বর্তমান মাস কীভাবে বন্ধ করব?', 'ম্যানেজার মেনু → “বর্তমান মাস শেষ করুন” খুলুন। সার্ভারের প্রি-ফ্লাইট সতর্কতা, ভবিষ্যৎ তারিখের এন্ট্রি ও অপেক্ষমাণ অনুরোধ দেখে নিন। নিশ্চিত করলে বন্ধের দিন পর্যন্ত মিল সঙ্গে সঙ্গে ফাইনাল হবে; ভবিষ্যতের সক্রিয় অনুরোধ/মিল রেকর্ড এবং অপেক্ষমাণ বিশেষ আবেদন নিয়ম অনুযায়ী বাতিল হবে। পুরোনো ফাইনাল ইতিহাস অক্ষত থাকে।'],
      ['বন্ধের দিনেই কি নতুন মাস শুরু করা যায়?', 'হ্যাঁ। বর্তমান মাস বন্ধ হওয়ার দিন বাংলাদেশ সময় রাত ৮টার পর নতুন মাস চালু করা যায়। নতুন মাসের প্রথম মিলের তারিখ হবে পরের ক্যালেন্ডার দিন। প্রথম দিনের সাধারণ মিল অনুরোধ রাত ১০টা পর্যন্ত দেওয়া যাবে; এই সময় পেরিয়ে গেলে Late Request-এর নিয়ম প্রযোজ্য হবে।'],
      ['নতুন মাসের প্রথম তারিখ কে নির্ধারণ করেন?', 'প্রধান ম্যানেজার “নতুন মাস শুরু” পেজে যান। সিস্টেম পূর্ববর্তী মাসের শেষ দিনের পরের দিন নির্ধারণ করে; তারিখটি সাধারণত পরিবর্তন করা যায় না। অনুমোদিত সময় হলে “নতুন মাস শুরু করুন” চাপুন এবং নিশ্চিত করুন।'],
      ['কোনো সদস্যকে নিষ্ক্রিয় করলে মিলের কী হয়?', 'ম্যানেজার মেনু → “সদস্য ব্যবস্থাপনা” থেকে সদস্য নিষ্ক্রিয় করুন। বাংলাদেশ সময় রাত ৯টার আগে হলে আজকের এখনো ফাইনাল না হওয়া মিলসহ ভবিষ্যতের সক্রিয় অনুরোধ/রেকর্ড বাতিল হয়। রাত ৯টার পর আজকের ফাইনাল মিল অক্ষত থাকে; ভবিষ্যতের সক্রিয় অনুরোধ/রেকর্ড বাতিল হয়। আগের ফাইনাল ইতিহাস বদলানো হয় না।'],
      ['সহকারী ম্যানেজার কীভাবে নির্ধারণ করব?', 'প্রধান ম্যানেজার মেনুর “সহকারী ম্যানেজার” অংশে গিয়ে সক্রিয় সদস্য নির্বাচন করে দায়িত্ব দিতে বা সরাতে পারেন। সহকারীর ক্ষমতা সীমিত; স্ক্রিনে যে কাজের অনুমতি দেওয়া আছে, সেটির মধ্যেই কাজ করবেন।'],
      ['সদস্যদের সবাইকে নোটিশ বা ঘোষণা কীভাবে পাঠাব?', 'প্রধান ম্যানেজার থ্রি-লাইন মেনু → “নোটিফিকেশন পাঠান” খুলে শিরোনাম ও বার্তা লিখে পাঠাতে পারেন। পাঠানো বার্তা সক্রিয় সদস্যদের নোটিফিকেশন ইনবক্সে যায়। পাঠানোর আগে তারিখ, সময় ও নির্দেশনা যাচাই করুন; এটি ব্যক্তিগত মিল অনুরোধ বা হিসাব এন্ট্রির বিকল্প নয়।'],
      ['নিষ্ক্রিয় সদস্যকে আবার সক্রিয় করা যায়?', 'প্রধান ম্যানেজার “সদস্য ব্যবস্থাপনা” থেকে নিষ্ক্রিয় সদস্য নির্বাচন করে পুনরায় সক্রিয় করার অপশন ব্যবহার করতে পারেন। সদস্য সক্রিয় করার আগে পরিচয়, মেসে যোগদানের অধিকার এবং প্রয়োজনীয় তথ্য যাচাই করুন।'],
    ],
  },
  {
    id: 'profile-security', icon: 'user', title: 'প্রোফাইল, নোটিফিকেশন ও সহায়তা', description: 'নিজের তথ্য, পাসওয়ার্ড ও সংযোগ সমস্যার করণীয়।',
    items: [
      ['প্রোফাইলের নাম, নম্বর বা ছবি কীভাবে বদলাব?', 'নিচের “প্রোফাইল” ট্যাব খুলুন। “আমার তথ্য” অংশে এডিট চাপুন; নাম ও মোবাইল নম্বর পরিবর্তন করুন। প্রোফাইল ছবির ক্যামেরা বোতাম থেকে JPG, PNG বা WEBP ছবি নির্বাচন করুন। সংরক্ষণ সফল হয়েছে কি না বার্তা দেখে নিশ্চিত করুন।'],
      ['পাসওয়ার্ড কীভাবে পরিবর্তন করব?', 'প্রোফাইল → “পাসওয়ার্ড” → “পরিবর্তন করুন” খুলুন। বর্তমান পাসওয়ার্ড যাচাই করে নতুন পাসওয়ার্ড দুইবার লিখে সংরক্ষণ করুন। ভুলে গেলে লগইন পেজের Forgot Password ব্যবহার করুন।'],
      ['নোটিফিকেশন কোথায় পাব?', 'অ্যাপের উপরের Bell আইকনে চাপুন। নতুন নোটিফিকেশন খুলে পড়তে পারবেন এবং ইনবক্সের নিয়ন্ত্রণ থেকে দেখা/সরানোর কাজ করতে পারবেন। নোটিফিকেশন পেলেই সংশ্লিষ্ট হিসাব সফল হয়েছে ধরে না নিয়ে প্রয়োজন হলে রেকর্ড যাচাই করুন।'],
      ['ইন্টারনেট না থাকলে কী করব?', 'উপরে Offline অবস্থা দেখালে কিছু সর্বশেষ সংরক্ষিত তথ্য দেখা যেতে পারে, কিন্তু নতুন অনলাইন কাজ বা পরিবর্তন সম্পন্ন নাও হতে পারে। ইন্টারনেট ফিরে এলে “আবার চেষ্টা করুন” চাপুন। কাজ সফল হয়েছে কি না হিস্টরি বা সংশ্লিষ্ট পেজে যাচাই করুন।'],
      ['পেজ বা অ্যাপ খুলছে না—কীভাবে চেষ্টা করব?', 'প্রথমে ইন্টারনেট সংযোগ যাচাই করুন। পরে “আবার চেষ্টা করুন” বা “পেজ রিলোড” ব্যবহার করুন। সমস্যা থাকলে ব্রাউজারের Address Bar-এ `https://hostellife-bd.vercel.app/` লিখে সরাসরি ওয়েবসাইট খুলুন। লগআউট করার আগে সমস্যাটি সত্যিই সেশন-সম্পর্কিত কি না নিশ্চিত হোন।'],
      ['Hostel Life অ্যাপ কীভাবে ইনস্টল করব?', 'থ্রি-লাইন মেনু → “অ্যাপ ডাউনলোড” খুলে “এখনই ইনস্টল করুন” চাপুন। আপনার ব্রাউজার সরাসরি ইনস্টল সুবিধা দিলে সেখানেই ইনস্টল সম্পন্ন হবে। কিছু ব্রাউজার নিরাপত্তা নীতির কারণে ওয়েবসাইট থেকে সরাসরি ইনস্টল অনুমতি দেয় না। ইনস্টল হলে একই অ্যাকাউন্ট ও মেসের তথ্য ব্যবহার হবে।'],
      ['আরও সহায়তা কোথায় পাব?', 'থ্রি-লাইন মেনুর “হেল্প” অথবা প্রোফাইলের নিচের “হোস্টেল লাইফ সাপোর্ট” লিংক ব্যবহার করুন। মেসের হিসাব-সংক্রান্ত বিষয় হলে তারিখ, রেকর্ড ও সমস্যার বিবরণসহ ম্যানেজারকে জানান।'],
    ],
  },
];

export function HowToUsePage() {
  return (
    <div className="page-stack howto-page">
      <PageHeader eyebrow="সহায়তা কেন্দ্র" title="কীভাবে ব্যবহার করব" description="প্রয়োজনীয় প্রশ্নের উত্তর খুঁজুন।" />

      <section className="card howto-timing-panel" aria-label="গুরুত্বপূর্ণ সময়সীমা">
        <div className="howto-timing-topline">
          <div className="howto-timing-heading">
            <span className="howto-timing-pin"><Icon name="calendar-check" size={19}/></span>
            <div><span className="eyebrow">সময় মনে রাখুন</span><h2>মিল অনুরোধ ও মাস পরিচালনার সময়</h2><p>সব সময় বাংলাদেশ সময় অনুযায়ী।</p></div>
          </div>
          <span className="howto-timezone-pill"><Icon name="clock" size={14}/> বাংলাদেশ সময়</span>
        </div>
        <div className="howto-time-grid">
          <article className="howto-time-card howto-time-card-request"><div className="howto-time-card-top"><span className="howto-time-step">০১</span><span>সাধারণ মিল অনুরোধ</span></div><strong>রাত ১০টা</strong><small>মিলের আগের দিন এই সময়ের আগে সাধারণ অনুরোধ দিন।</small></article>
          <article className="howto-time-card is-final"><div className="howto-time-card-top"><span className="howto-time-step">০২</span><span>দৈনিক মিল ফাইনাল</span></div><strong>রাত ৯টা</strong><small>মিলের দিন রাত ৯টায় হিসাব চূড়ান্ত হয়।</small></article>
          <article className="howto-time-card is-late"><div className="howto-time-card-top"><span className="howto-time-step">০৩</span><span>Late / Correction</span></div><strong>১০টা → ৯টা</strong><small>আগের রাত ১০টার পর থেকে মিলের দিন রাত ৯টার আগে; অনুমোদন প্রয়োজন।</small></article>
          <article className="howto-time-card is-month"><div className="howto-time-card-top"><span className="howto-time-step">০৪</span><span>নতুন মাস চালু</span></div><strong>রাত ৮টার পর</strong><small>মাস বন্ধের দিন এই সময়ের পর; নতুন মাস শুরু হবে পরের দিন।</small></article>
        </div>
        <div className="howto-timing-footnote"><Icon name="info" size={16}/><span>মাস বন্ধ করলে রাত ৯টার অপেক্ষা না করেই বন্ধের দিনের অনুমোদিত মিল সঙ্গে সঙ্গে ফাইনাল হয়। প্রথম দিনের সাধারণ অনুরোধ রাত ১০টা পর্যন্ত দেওয়া যায়।</span></div>
      </section>

      <section className="howto-faq-intro">
        <div><span className="eyebrow">বিষয়ভিত্তিক প্রশ্নোত্তর</span><h2>যে বিষয়ে জানতে চান সেটি খুলুন</h2><p>প্রথমে বিষয় নির্বাচন করুন, তারপর পছন্দের প্রশ্ন খুলে উত্তর দেখুন।</p></div>
        <span className="howto-faq-count">{formatNumber(HOW_TO_USE_GROUPS.reduce((sum, group) => sum + group.items.length, 0))}টি প্রশ্ন</span>
      </section>

      <div className="howto-faq-groups">
        {HOW_TO_USE_GROUPS.map((group, groupIndex) => (
          <details className="card howto-faq-group" key={group.id}>
            <summary className="howto-faq-group-heading">
              <span className="howto-faq-group-icon"><Icon name={group.icon} size={21}/></span>
              <div><span className="eyebrow">বিভাগ {formatNumber(groupIndex + 1, { maximumFractionDigits: 0 })}</span><h2>{group.title}</h2><p>{group.description}</p></div>
              <span className="howto-faq-group-count">{formatNumber(group.items.length)}টি প্রশ্ন</span>
              <span className="howto-faq-group-chevron"><Icon name="chevron" size={18}/></span>
            </summary>
            <div className="howto-faq-list">
              {group.items.map(([question, answer], index) => (
                <details className="howto-faq-item" key={question}>
                  <summary>
                    <span className="howto-faq-index">{formatNumber(index + 1, { maximumFractionDigits: 0 })}</span>
                    <span className="howto-faq-question">{question}</span>
                    <span className="howto-faq-chevron"><Icon name="chevron" size={17}/></span>
                  </summary>
                  <div className="howto-faq-answer"><p>{answer}</p></div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="policy-note howto-final-note"><Icon name="shield-check" size={18}/><span>যে কাজ আপনার স্ক্রিনে নেই, সেটি আপনার বর্তমান ভূমিকার জন্য উপলব্ধ নাও হতে পারে। হিসাব বা অনুরোধের ক্ষেত্রে চূড়ান্ত স্ট্যাটাস যাচাই না করে কাজ সম্পন্ন হয়েছে ধরে নেবেন না।</span></div>
    </div>
  );
}

export function SendNotificationPage() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [currentPinned, setCurrentPinned] = useState(null);
  const [loadingPinned, setLoadingPinned] = useState(true);
  const [pinFeatureReady, setPinFeatureReady] = useState(false);
  const [pinFeatureError, setPinFeatureError] = useState('');
  const [clearBusy, setClearBusy] = useState(false);

  const loadPinned = useCallback(async () => {
    setLoadingPinned(true);
    try {
      setCurrentPinned(await fetchPinnedManagerAnnouncement());
      setPinFeatureReady(true);
      setPinFeatureError('');
    } catch (error) {
      setCurrentPinned(null);
      setPinFeatureReady(false);
      const missingMigration = error?.code === 'PGRST202' || /could not find the function|schema cache/i.test(error?.message || '');
      setPinFeatureError(missingMigration
        ? 'মেস নোটিশ চালু করতে Supabase SQL Editor-এ Run21 মাইগ্রেশন একবার প্রয়োগ করুন।'
        : getFriendlySupabaseError(error, 'বর্তমান মেস নোটিশ যাচাই করা যায়নি। ইন্টারনেট ও Supabase সংযোগ পরীক্ষা করুন।'));
    } finally { setLoadingPinned(false); }
  }, []);

  useEffect(() => { if (isManager) loadPinned(); }, [isManager, loadPinned]);

  if (!isManager) return <div className="page-stack"><PageHeader eyebrow="ম্যানেজার ফিচার" title="মেস নোটিশ" description="এই ফিচারটি শুধু ম্যানেজারের জন্য উপলভ্য।" /><div className="state-card state-card-warning"><Icon name="shield" size={26} /><div><h2>ম্যানেজার অনুমতি প্রয়োজন</h2><p>এই ফিচার শুধু ম্যানেজারের জন্য।</p></div></div></div>;

  const submit = async (event) => {
    event.preventDefault();
    if (!pinFeatureReady) return toast.warning(pinFeatureError || 'মেস নোটিশ ফিচার চালু করতে ডাটাবেস আপডেট প্রয়োজন।');
    if (!title.trim()) return toast.warning('নোটিশের শিরোনাম দিন।');
    if (!body.trim()) return toast.warning('নোটিশের বার্তা দিন।');
    setBusy(true);
    try {
      await managerSendNotification(title.trim(), body.trim());
      setTitle('');
      setBody('');
      await loadPinned();
      toast.success('নোটিশটি এই মেসের সক্রিয় সদস্যদের সামনে প্রকাশ করা হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিশ প্রকাশ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  const clearPinned = async () => {
    if (!currentPinned) return;
    if (!await confirmAction('এই নোটিশটি এই মেসের সব সদস্যের অ্যাপের ওপর থেকে এবং নোটিফিকেশন ইনবক্স থেকে সরিয়ে দেবেন?')) return;
    setClearBusy(true);
    try {
      await managerClearHostelPinnedAnnouncement();
      setCurrentPinned(null);
      toast.success('মেসের নোটিশ সরানো হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মেসের নোটিশ সরানো যায়নি।'));
    } finally { setClearBusy(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ম্যানেজার ফিচার" title="মেস নোটিশ" description="সদস্যদের জন্য নোটিশ প্রকাশ করুন।" />
      {!loadingPinned && !pinFeatureReady && <div className="state-card state-card-warning"><Icon name="info" size={20} /><div><strong>মেস নোটিশের ডাটাবেস আপডেট বাকি</strong><p>{pinFeatureError || 'Supabase-এ Run21 migration প্রয়োগের পর এই ফিচার ব্যবহার করা যাবে।'}</p></div></div>}
      {loadingPinned ? <div className="loading-wrap"><span className="spinner" /><span>বর্তমান নোটিশ যাচাই হচ্ছে...</span></div> : currentPinned && (
        <section className="card current-hostel-notice-card">
          <div className="current-hostel-notice-head"><span><Icon name="bell" size={17} /> বর্তমান মেস নোটিশ</span><span className="current-hostel-notice-live">সক্রিয়</span></div>
          <strong>{currentPinned.title}</strong>
          <p>{currentPinned.body}</p>
          <button className="secondary-button danger-outline" type="button" onClick={clearPinned} disabled={clearBusy}>{clearBusy ? 'সরানো হচ্ছে...' : 'সবার সামনে থেকে নোটিশ সরান'}</button>
        </section>
      )}
      <form className="card form-panel" onSubmit={submit}>
        <label className="field-label"><span>শিরোনাম</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="যেমন: আজ রাতের রান্নার সময়" /></label>
        <label className="field-label"><span>বার্তা</span><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={6} placeholder="সবার জন্য প্রয়োজনীয় তথ্য লিখুন..." /></label>
        <div className="form-hint"><Icon name="info" size={15} /> নোটিশটি সদস্যদের অ্যাপ ও ইনবক্সে দেখাবে; SMS নয়। নতুন নোটিশে আগেরটি প্রতিস্থাপিত হবে।</div>
        <button className="primary-button large" type="submit" disabled={busy || !pinFeatureReady}>{busy ? 'প্রকাশ করা হচ্ছে...' : 'মেসে নোটিশ প্রকাশ করুন'}</button>
      </form>
    </div>
  );
}

export function PlaceholderMenuPage({ title, description }) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="" title={title} description={description} />
      <div className="card empty-state-card module-placeholder"><Icon name="clock" size={28} /><strong>এই ফিচারটি এখনো প্রস্তুত নয়</strong><span></span></div>
    </div>
  );
}

export function PreviousMonthsPage() {
  const toast = useToast();
  const [months, setMonths] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchPreviousMonths();
      setMonths(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'পূর্ববর্তী মাসগুলো লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openMonth = (item) => {
    const periodId = String(item?.period_id || item?.id || '');
    if (!periodId) return;
    navigateTo(`/app/menu/archive?period_id=${encodeURIComponent(periodId)}`);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="সংরক্ষিত হিসাব" title="বন্ধ মাসসমূহ" />
      {loading ? <LoadingSpinner label="পূর্ববর্তী মাস লোড হচ্ছে..." /> : months.length === 0 ? (
        <div className="empty-state-card"><Icon name="history" size={28} /><strong>কোনো পূর্ববর্তী মাস নেই</strong></div>
      ) : (
        <div className="archive-month-list">
          {months.map((item) => <button className={`card archive-month-card ${item.detail_available ? 'detail-month' : 'summary-month'}`} type="button" key={item.period_id || item.id} onClick={() => openMonth(item)}>
            <div className="archive-month-icon"><Icon name={item.detail_available ? 'file-text' : 'history'} size={20} /></div>
            <div className="archive-month-copy">
              <strong>{item.label}</strong>
              <small>{formatDateBangla(item.start_date)} → {formatDateBangla(item.end_date)}</small>
              <span>{item.detail_available ? 'বিস্তারিত রিপোর্ট' : 'মাসিক সারসংক্ষেপ'}</span>
            </div>
            <Icon name="chevron" size={18} />
          </button>)}
        </div>
      )}
    </div>
  );
}

export function ArchiveEditAccessPage() {
  const toast = useToast();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    try {
      const rows = await fetchMyArchiveEditablePeriods();
      setPeriods((Array.isArray(rows) ? rows : []).filter((period) => period?.access_kind === 'closed_by'));
    }
    catch (error) {
      setPeriods([]);
      setErrorText(getFriendlySupabaseError(error, 'আর্কাইভের অনুমতিগুলো লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="page-stack">
    <PageHeader eyebrow="বন্ধ মাসের অনুমতি" title="বন্ধ মাসের সম্পাদনা" description="শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে, সেই অ্যাকাউন্ট সংশোধন করতে পারবে।" />
    {loading ? <LoadingSpinner label="আর্কাইভের অনুমতি যাচাই হচ্ছে..." /> : errorText ? <div className="state-card state-card-warning"><Icon name="warning" size={24} /><div><h2>আর্কাইভ লোড করা যায়নি</h2><p>{errorText}</p><button className="secondary-button compact" type="button" onClick={load}>আবার চেষ্টা করুন</button></div></div> : periods.length === 0 ? <div className="empty-state-card"><Icon name="shield" size={28} /><strong>আপনি এখনো কোনো মাস বন্ধ করেননি</strong><span>আপনি যে মাসগুলো বন্ধ করবেন, শুধু সেগুলোর সংশোধনের সুবিধা এখানে দেখা যাবে। অন্য বন্ধ মাসগুলো ইতিহাস ও বন্ধ মাসসমূহ থেকে দেখা যাবে।</span></div> : <div className="archive-month-list">{periods.map((period) => <article className="card archive-month-card detail-month" key={period.period_id}><div className="archive-month-icon"><Icon name="history" size={20} /></div><div className="archive-month-copy"><strong>{period.label}</strong><small>{formatDateBangla(period.start_date)} → {formatDateBangla(period.end_date)}</small><span>{period.access_kind}{period.expires_at ? ` · মেয়াদ ${formatDateWithWeekday(period.expires_at)}` : ''}</span><span>মাস বন্ধ করেছিলেন: {period.manager_at_close_name}</span></div><button className="primary-button compact" type="button" onClick={() => navigateTo(`/app/history?archive_period=${encodeURIComponent(period.period_id)}`)}>হিসাব খুলুন</button></article>)}</div>}
  </div>;
}
