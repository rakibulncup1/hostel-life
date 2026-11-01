import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { confirmAction } from '../../utils/actionDialogs';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useToast } from '../../components/Toast';
import { navigateTo } from '../../app/AppShell';
import { fetchMemberDirectory, fetchRunningPeriod } from '../../services/diningService';
import { fetchMemberPeriodDetails } from '../../services/dashboardService';
import { MemberPeriodDetailsModal } from '../dashboard/DashboardPage';
import { fetchArchivedMonthDetail, fetchKhalaMoneyHistory, fetchPreviousMonths, fetchMyArchiveEditablePeriods } from '../../services/historyService';
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
      <PageHeader eyebrow="মেসের সবাই" title="সকল সদস্য" description="সদস্যের পরিচয় ও বর্তমান হিসাব দেখুন।" />
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [currentPeriod, previousPeriods] = await Promise.all([
        fetchRunningPeriod(),
        fetchPreviousMonths(),
      ]);

      const periodRows = [
        ...(currentPeriod?.period_id ? [currentPeriod] : []),
        ...(Array.isArray(previousPeriods) ? previousPeriods : []),
      ].filter((period, index, all) => period?.period_id && all.findIndex((item) => item.period_id === period.period_id) === index)
        .slice(0, 24);

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

      setRows(nextRows);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য দেখা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const row of rows) {
      const key = row.period_id || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          period_id: key,
          label: row.period_label || row.period_name || 'মাস',
          rows: [],
        });
      }
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => String(b.entry_date || b.created_at || '').localeCompare(String(a.entry_date || a.created_at || ''))),
      total: group.rows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0),
      count: group.rows.filter((row) => row.status !== 'void').length,
    }));
  }, [rows]);

  const totalKhalaPaid = rows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const activeEntryCount = rows.filter((row) => row.status !== 'void').length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="মেসের স্বচ্ছতা"
        title="খালার টাকা"
        description="প্রতিটি মাসে খালার পারিশ্রমিকের পৃথক হিসাব দেখুন। এটি কোনো সদস্যের ব্যক্তিগত হিসাব নয়।"
      />

      <section className="card khala-view-hero">
        <div>
          <span className="eyebrow">খালার আলাদা হিসাব</span>
          <h2>{formatCurrency(totalKhalaPaid)} মোট কার্যকর পারিশ্রমিক</h2>
          <p>এই তালিকার কোনো এন্ট্রি সদস্যের ব্যক্তিগত ব্যালেন্স, মিল বা অন্যান্য ব্যক্তিগত খরচের অংশ নয়।</p>
          <div className="khala-view-hero-metrics"><div><span>কার্যকর এন্ট্রি</span><strong>{formatNumber(activeEntryCount)}টি</strong></div><div><span>অন্তর্ভুক্ত মাস</span><strong>{formatNumber(grouped.length)}টি</strong></div></div>
        </div>
        <button className="secondary-button compact" type="button" onClick={load} disabled={loading}>
          <Icon name="refresh" size={15} /> রিফ্রেশ
        </button>
      </section>

      {loading ? (
        <LoadingSpinner label="খালার টাকার হিসাব লোড হচ্ছে..." />
      ) : grouped.length === 0 ? (
        <div className="empty-state-card">
          <Icon name="wallet" size={28} />
          <strong>এখনো কোনো খালার টাকার তথ্য নেই</strong>
          <span>ম্যানেজার এন্ট্রি যোগ করলে এখানেই সবার জন্য দেখা যাবে।</span>
        </div>
      ) : (
        grouped.map((group) => (
          <section className="card khala-view-section" key={group.period_id}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">কাজের মাস</span>
                <h2>{group.label}</h2>
              </div>
              <strong>{formatCurrency(group.total)}</strong>
            </div>

            <div className="khala-public-list">
              {group.rows.map((row) => (
                <article className={`khala-public-row ${row.status === 'void' ? 'is-void' : ''}`} key={row.entry_id}>
                  <div className="khala-public-person">
                    <span className="khala-ledger-mark"><Icon name="wallet" size={17} /></span>
                    <div className="khala-public-person-copy">
                      <div className="khala-ledger-recipient">
                        <span>যাঁর নামে নথিভুক্ত</span>
                        <strong>{row.member_name && row.member_name !== 'খালার পারিশ্রমিক' ? row.member_name : row.recipient_name || 'সদস্যের নাম পাওয়া যায়নি'}</strong>
                      </div>
                      <strong className="khala-public-entry-kind">খালার পারিশ্রমিক</strong>
                      <small>পরিশোধ করেছেন: {row.created_by_name || row.actor_name || row.manager_name || row.entered_by_name || 'নাম পাওয়া যায়নি'}</small>
                      <small>{formatDateWithWeekday(row.entry_date)}{row.description ? ` · ${row.description}` : ''}</small>
                    </div>
                  </div>
                  <div className="khala-public-amount">
                    <strong>{formatCurrency(row.amount)}</strong>
                    <span className={`member-badge ${row.status === 'void' ? 'inactive' : 'subtle'}`}>
                      {row.status === 'void' ? 'বাতিল' : 'পরিশোধিত'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
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
        description={depositor ? 'চলতি মাসে সদস্যের নামে জমা হওয়া মোট ডিপোজিটের ভিত্তিতে বেশি থেকে কম।' : shopper ? 'চলতি মাসে বৈধ বাজার এন্ট্রির মোট টাকার ভিত্তিতে বেশি থেকে কম।' : 'চলতি মাসে final meal-এর মোট সংখ্যার ভিত্তিতে বেশি থেকে কম.'}
      />
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
      <PageHeader eyebrow="Hostel Life" title="হেল্প" />
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
  return (
    <div className="page-stack">
      <PageHeader eyebrow="সিস্টেম তথ্য" title="গোপনীয়তা ও নীতিমালা" description="Hostel Life-এ আপনার পরিচয়, মেসের সদস্যতা ও দৈনন্দিন হিসাবের তথ্য কীভাবে ব্যবহৃত হয়—সহজ ভাষায় জানুন।" />
      <section className="card policy-content-card policy-document-card">
        <div className="policy-document-lead">
          <Icon name="shield-check" size={24} />
          <div><strong>আপনার তথ্যের ব্যবহার সীমিত, প্রয়োজনভিত্তিক ও ভূমিকা-নিয়ন্ত্রিত</strong><p>Hostel Life-এর কাজ চালানো, মেসের হিসাব রাখা এবং সদস্যদের মধ্যে প্রয়োজনীয় সমন্বয়ের জন্যই অ্যাপে দেওয়া তথ্য ব্যবহার করা হয়।</p></div>
        </div>
        <div className="policy-section-block">
          <h2>১. কী ধরনের তথ্য ব্যবহৃত হয়</h2>
          <p>অ্যাকাউন্টের নাম, ইমেইল, মোবাইল নম্বর ও প্রোফাইল ছবি; মেসের সদস্যতা ও ভূমিকা; মিলের অনুরোধ ও দৈনিক মিলের পরিমাণ; বাজারের তারিখ, আইটেম, পরিমাণ ও টাকা; জমা, অন্যান্য খরচ, খালার পারিশ্রমিক, নোটিফিকেশন এবং মাসিক/পূর্ববর্তী হিসাবের রেকর্ড—ফিচার ব্যবহারের প্রয়োজন অনুযায়ী সংরক্ষিত বা প্রদর্শিত হতে পারে।</p>
        </div>
        <div className="policy-section-block">
          <h2>২. তথ্য কী কাজে ব্যবহার হয়</h2>
          <p>অ্যাকাউন্ট শনাক্ত করা, মেসে যোগদান পরিচালনা, মিলের অনুরোধ ও দৈনিক হিসাব তৈরি, বাজার ও অর্থের হিসাব দেখানো, হিস্টরি/রিপোর্ট প্রস্তুত, নোটিফিকেশন পাঠানো এবং অনুমোদিত ব্যবস্থাপনা কার্যক্রম সম্পন্ন করতে তথ্য ব্যবহার হয়। অপ্রয়োজনীয় ব্যক্তিগত তথ্য চাওয়া উচিত নয়।</p>
        </div>
        <div className="policy-section-block">
          <h2>৩. কারা কোন তথ্য দেখতে পারেন</h2>
          <p>Hostel Life-কে সম্পূর্ণ ব্যক্তিগত ডায়েরি হিসেবে বিবেচনা করবেন না। একই মেসের সদস্যরা সদস্য তালিকা, চলতি মাসের কিছু সদস্যভিত্তিক হিসাব ও ব্যালেন্স, মিল-সংক্রান্ত তথ্য, বাজারের রেকর্ড, র‍্যাঙ্কিং এবং খালার টাকার হিসাব দেখতে পারেন। সাধারণ সদস্যের “হিসাব ইতিহাসে” নিজের প্রাসঙ্গিক লেনদেন দেখানো হয়; ম্যানেজার বা অনুমোদিত সহকারী তাঁদের ভূমিকার সীমার মধ্যে প্রয়োজন অনুযায়ী সদস্য নির্বাচন করে হিসাব দেখতে ও অনুমোদিত রেকর্ড পরিচালনা করতে পারেন। কারও তথ্য দেখা এবং সেটি সম্পাদনা করার অনুমতি এক বিষয় নয়—সম্পাদনার ক্ষমতা সংশ্লিষ্ট ভূমিকা ও ফিচারের অনুমতির মধ্যে সীমিত।</p>
        </div>
        <div className="policy-section-block">
          <h2>৪. আপনার তথ্যের দায়িত্ব ও নিয়ন্ত্রণ</h2>
          <p>প্রোফাইল থেকে নিজের নাম, মোবাইল নম্বর ও ছবি হালনাগাদ করতে পারবেন; নিরাপত্তা অংশ থেকে পাসওয়ার্ড পরিবর্তন এবং থিম নির্বাচন করতে পারবেন। ভুল সদস্য-তথ্য বা হিসাব চোখে পড়লে সংশ্লিষ্ট ম্যানেজারকে জানান এবং অ্যাপে থাকা অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন।</p>
        </div>
        <div className="policy-section-block">
          <h2>৫. তথ্যের নিরাপত্তা</h2>
          <p>নিজের পাসওয়ার্ড, লগইন সেশন ও মেসের Join Code গোপন রাখুন। অন্যের অ্যাকাউন্ট ব্যবহার করবেন না, শেয়ার করা ডিভাইস ব্যবহারের পর লগ আউট করুন এবং অপরিচিত কারও কাছে ব্যক্তিগত বা আর্থিক তথ্য পাঠাবেন না। অনুমতি ছাড়া অন্য সদস্যের তথ্য সংগ্রহ, কপি বা বাইরে ছড়াবেন না।</p>
        </div>
        <div className="policy-section-block">
          <h2>৬. হিসাব ও পুরোনো তথ্য সংরক্ষণ</h2>
          <p>মেসের আর্থিক স্বচ্ছতা, মাসিক হিসাব ও বিরোধ যাচাইয়ের জন্য বাজার, জমা-খরচ, মিল এবং বন্ধ মাসের কিছু রেকর্ড আর্কাইভে রাখা হতে পারে। পূর্ববর্তী মাস বিভাগে যে বিস্তারিত ও সারসংক্ষেপ সংরক্ষণ-নীতি দেখানো হয়, সেটিই সংশ্লিষ্ট সময়ের জন্য প্রযোজ্য। কোনো সদস্যকে নিষ্ক্রিয় করা বা মেস থেকে সরানো হলেও হিসাবের ধারাবাহিকতা ও পুরোনো মাসের যাচাইয়ের জন্য সংশ্লিষ্ট ঐতিহাসিক রেকর্ড আর্কাইভে থাকতে পারে।</p>
        </div>
        <div className="policy-section-block">
          <h2>৭. সহায়তা ও নীতির পরিবর্তন</h2>
          <p>তথ্যের ভুল, অননুমোদিত ব্যবহার বা গোপনীয়তা-সংক্রান্ত প্রশ্ন থাকলে মেসের ম্যানেজার অথবা থ্রি-লাইন মেনুর “হেল্প” অংশে দেওয়া Hostel Life Support-এর সঙ্গে যোগাযোগ করুন। অ্যাপের কার্যপ্রণালি বদলালে এই নীতিও হালনাগাদ হতে পারে।</p>
        </div>
        <div className="policy-note"><Icon name="info" size={18}/><span>মনে রাখবেন: একই মেসের সদস্যদের মধ্যে কিছু মিল ও হিসাবের তথ্য শেয়ার হয়। তাই রেকর্ডে অপ্রয়োজনীয় ব্যক্তিগত তথ্য লিখবেন না।</span></div>
      </section>
    </div>
  );
}

export function TermsPage() {
  const terms = [
    ['ওয়েবসাইটের লিংক প্রকাশ্যে শেয়ার নিষিদ্ধ', 'Hostel Life-এর ওয়েবসাইট/অ্যাপের লিংক, প্রবেশের ঠিকানা বা আমন্ত্রণ-লিংক সামাজিক যোগাযোগমাধ্যম, পাবলিক গ্রুপ, ওয়েবসাইট বা অন্য কোনো উন্মুক্ত স্থানে প্রকাশ্যে শেয়ার করা সম্পূর্ণ নিষিদ্ধ। মেসের প্রয়োজন হলে কেবল নির্দিষ্ট ও উদ্দেশ্যপ্রণোদিত সদস্যকে ব্যক্তিগতভাবে লিংক দিন। Join Code-ও প্রকাশ্যে দেবেন না।'],
    ['সঠিক পরিচয়ে অ্যাকাউন্ট ব্যবহার', 'নিজের প্রকৃত পরিচয়ে অ্যাকাউন্ট ব্যবহার করুন। ভুয়া পরিচয়, অন্যের পরিচয় নকল, প্রতারণামূলক বা বিভ্রান্তিকর অ্যাকাউন্ট, এবং একাধিক অ্যাকাউন্ট দিয়ে নিয়ম এড়ানোর চেষ্টা করা যাবে না।'],
    ['ভুয়া বা অপব্যবহারকারী অ্যাকাউন্ট অপসারণ', 'ভুয়া, প্রতারণামূলক, অননুমোদিত বা নিয়মভঙ্গকারী অ্যাকাউন্ট শনাক্ত হলে Hostel Life কর্তৃপক্ষ/অনুমোদিত Super Admin প্রয়োজন অনুযায়ী যেকোনো সময় সেটি স্থগিত বা মুছে দিতে পারবেন। গুরুতর নিরাপত্তা বা অপব্যবহারের ক্ষেত্রে আগাম নোটিশ ছাড়াও ব্যবস্থা নেওয়া হতে পারে।'],
    ['মেসে যোগদান ও মেস তৈরি', 'Join Code শুধু সংশ্লিষ্ট মেসের অনুমোদিত সদস্যের সঙ্গে ব্যক্তিগতভাবে ভাগ করুন। অন্য মেসের কোড ব্যবহার, অনুমতি ছাড়া প্রবেশের চেষ্টা বা মেস তৈরির অনুমতি-কোড অন্যকে দেওয়া যাবে না। মেস তৈরি বা যোগদানের সময় সঠিক তথ্য দিন।'],
    ['মিলের অনুরোধ ও সময়সীমা', 'সাধারণ মিল অনুরোধ নির্ধারিত কাট-অফের আগে জমা দিতে হবে। সাধারণ সময় পেরিয়ে গেলে Late Request বা Correction Request-এর নির্ধারিত সময় ও অনুমোদন-প্রক্রিয়া প্রযোজ্য হবে। অনুরোধ জমা দিলেই বিশেষ/লেট/সংশোধন আবেদন অনুমোদিত হয়েছে ধরে নেওয়া যাবে না; স্ট্যাটাস যাচাই করতে হবে।'],
    ['বাজার ও আর্থিক রেকর্ডের সঠিকতা', 'বাজারের আইটেম, পরিমাণ, তারিখ, বাজারকারী, জমা, অন্যান্য খরচ এবং খালার পারিশ্রমিক বাস্তব তথ্য অনুযায়ী লিখুন। ইচ্ছাকৃত ভুল, ডুপ্লিকেট এন্ট্রি, ভুয়া লেনদেন বা অন্য সদস্যের হিসাব ক্ষতিগ্রস্ত করার চেষ্টা নিষিদ্ধ।'],
    ['অনুমতি ও ব্যবস্থাপনার সীমা', 'সাধারণ সদস্য, সহকারী ম্যানেজার, প্রধান ম্যানেজার ও Super Admin-এর ক্ষমতা এক নয়। নিজের অনুমতির বাইরে কোনো রেকর্ড দেখা, বদলানো, মুছে ফেলা বা অন্যকে অনুমতি দেওয়ার চেষ্টা করা যাবে না। ম্যানেজারও ব্যক্তিগত সুবিধার জন্য ক্ষমতা ব্যবহার করতে পারবেন না।'],
    ['হিস্টরি, সংশোধন ও আর্কাইভ', 'হিস্টরির রেকর্ড যাচাই করুন এবং ভুল হলে অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন। বন্ধ মাসের চূড়ান্ত হিসাব বা পুরোনো রেকর্ড অনুমতি ছাড়া বদলানো যাবে না। সংশোধনের কারণ চাইলে সত্য ও পূর্ণাঙ্গ কারণ লিখতে হবে।'],
    ['নিরাপত্তা ও গ্রহণযোগ্য ব্যবহার', 'অ্যাপের নিরাপত্তা এড়ানো, অননুমোদিত প্রবেশ, অন্যের তথ্য সংগ্রহ/কপি, স্বয়ংক্রিয়ভাবে অস্বাভাবিক অনুরোধ পাঠানো, সেবা ব্যাহত করা বা ক্ষতিকর কোড/লিংক ব্যবহার নিষিদ্ধ। নিজের পাসওয়ার্ড ও অ্যাকাউন্ট অন্যকে ব্যবহার করতে দেবেন না।'],
    ['ইন্টারনেট, অফলাইন তথ্য ও সংরক্ষণের নিশ্চয়তা', 'অফলাইনে দেখা কিছু তথ্য সর্বশেষ সংরক্ষিত কপি হতে পারে। ইন্টারনেট ছাড়া সব পরিবর্তন জমা বা সিঙ্ক হয়েছে ধরে নেওয়া যাবে না। কোনো কাজ সফল হয়েছে বলে দেখালেও প্রয়োজন হলে হিস্টরি/রেকর্ডে যাচাই করুন। গুরুত্বপূর্ণ আর্থিক রেকর্ডের নিজস্ব ব্যাকআপ ও যাচাইয়ের দায় মেস পরিচালনাকারীদের।'],
    ['সেবা পরিবর্তন ও শর্তাবলী', 'নেটওয়ার্ক, ডিভাইস, রক্ষণাবেক্ষণ বা অনিবার্য কারণে সেবা সাময়িক ব্যাহত হতে পারে। ফিচার বা পরিচালনাপদ্ধতি বদলালে এই শর্তাবলী হালনাগাদ হতে পারে। অ্যাপ ব্যবহার অব্যাহত রাখার আগে নতুন শর্ত পড়ে নিন।'],
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="সিস্টেম তথ্য" title="ব্যবহারের শর্তাবলী" description="Hostel Life-এর নিরাপদ, ব্যক্তিগত ও সুশৃঙ্খল ব্যবহারের জন্য প্রয়োজনীয় নিয়ম।" />
      <section className="card policy-content-card policy-document-card">
        <div className="policy-document-lead"><Icon name="book-open" size={24}/><div><strong>অ্যাপ ব্যবহার করার আগে নিয়মগুলো পড়ুন</strong><p>মেসের তথ্য, সদস্যদের হিসাব ও অ্যাক্সেস সুরক্ষিত রাখতে প্রত্যেক ব্যবহারকারীর জন্য এই নিয়মগুলো প্রযোজ্য।</p></div></div>
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
    id: 'getting-started', icon: 'user-plus', title: 'শুরু ও মেসে যুক্ত হওয়া', description: 'অ্যাকাউন্ট, লগইন, Join Code এবং নতুন মেস তৈরির ধাপ।',
    items: [
      ['নতুন অ্যাকাউন্ট কীভাবে তৈরি করব?', 'লগইন পেজে “রেজিস্ট্রেশন” নির্বাচন করে নিজের নাম, ইমেইল ও প্রয়োজনীয় তথ্য দিন। প্রয়োজন হলে ইমেইল যাচাই সম্পন্ন করুন। অ্যাকাউন্ট তৈরি হলেও কোনো মেসে যুক্ত না থাকলে অ্যাপ আপনাকে মেসে যোগদান বা নতুন মেস তৈরির পেজে নিয়ে যাবে।'],
      ['আগে থেকেই থাকা মেসে কীভাবে যুক্ত হব?', 'মেস তৈরির সময় ম্যানেজার যে Join Code দিয়েছেন সেটি নিন। মেস সেটআপ পেজে “মেসে যুক্ত হন” খুলে কোড লিখে জমা দিন। কোড সঠিক হলে সদস্যতা সক্রিয় হয়ে যাবে এবং অ্যাপের ড্যাশবোর্ডে যেতে পারবেন।'],
      ['নিজের মেস কীভাবে তৈরি করব?', 'মেস সেটআপ পেজে “মেস তৈরি করুন” নির্বাচন করে মেসের নাম লিখুন। সিস্টেমে মেস তৈরির অনুমতি-কোড চালু থাকলে সেটিও দিতে হবে। মেস তৈরি হলে আপনি ম্যানেজার হবেন এবং একটি Join Code পাবেন। কোডটি কেবল নির্দিষ্ট সদস্যকে ব্যক্তিগতভাবে দিন—প্রকাশ্যে নয়।'],
      ['রেজিস্ট্রেশনের পর কেন মেস সেটআপ পেজে থাকি?', 'আপনার অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু এখনো কোনো মেসের সদস্যতা নেই—তাই ড্যাশবোর্ড খালি না দেখিয়ে আগে মেসে যোগদান বা নতুন মেস তৈরির সুযোগ দেখানো হয়। অন্য অ্যাকাউন্ট ব্যবহার করতে চাইলে ওই পেজের “লগইন / রেজিস্ট্রেশন পেজে ফিরুন” বোতাম ব্যবহার করুন।'],
      ['ভুল অ্যাকাউন্টে লগইন করলে কী করব?', 'মেস সেটআপ পেজে “অন্য অ্যাকাউন্ট ব্যবহার করবেন?” অংশের বোতাম চাপুন। এতে এই ডিভাইসের বর্তমান সেশন থেকে বের হয়ে লগইন/রেজিস্ট্রেশন পেজে যেতে পারবেন।'],
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
      ['মেস সেটিংস কে ব্যবহার করতে পারবেন?', 'বর্তমান প্রধান ম্যানেজার এবং চলমান মাসে নির্ধারিত সহকারী ম্যানেজার মেস সেটিংস থেকে মেসের নাম পরিবর্তন ও নতুন যুক্ত হওয়ার কোড তৈরি করতে পারবেন। নতুন কোড তৈরি করলে আগের কোড দিয়ে নতুন সদস্য যুক্ত হওয়া যাবে না। সহকারীর অনুমতি চলমান মাসে তাঁর নির্ধারিত দায়িত্বের সঙ্গে যুক্ত।']
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
      ['আরও সহায়তা কোথায় পাব?', 'থ্রি-লাইন মেনুর “হেল্প” অথবা প্রোফাইলের নিচের “হোস্টেল লাইফ সাপোর্ট” লিংক ব্যবহার করুন। মেসের হিসাব-সংক্রান্ত বিষয় হলে তারিখ, রেকর্ড ও সমস্যার বিবরণসহ ম্যানেজারকে জানান।'],
    ],
  },
];

export function HowToUsePage() {
  return (
    <div className="page-stack howto-page">
      <PageHeader eyebrow="সহায়তা কেন্দ্র" title="কীভাবে ব্যবহার করব" description="প্রশ্ন নির্বাচন করুন, উত্তর খুলে ধাপে ধাপে Hostel Life ব্যবহার শিখুন।" />

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
      <PageHeader eyebrow="ম্যানেজার ফিচার" title="মেস নোটিশ" description="আপনার মেসের সক্রিয় ও নতুন যুক্ত হওয়া সদস্যদের অ্যাপের শীর্ষে একটি গুরুত্বপূর্ণ বার্তা প্রকাশ করুন।" />
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
        <div className="form-hint"><Icon name="info" size={15} /> নোটিশটি শুধু এই মেসের সদস্যদের অ্যাপের শীর্ষে দেখানো হবে এবং নোটিফিকেশন ইনবক্সেও থাকবে। এটি SMS নয়। নতুন নোটিশ প্রকাশ করলে আগের নোটিশটি প্রতিস্থাপিত হবে।</div>
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

function MonthSummaryCard({ item, onClick }) {
  const detail = item.detail_available;
  return (
    <button className={`card archive-month-card ${detail ? 'detail-month' : 'summary-month'}`} type="button" onClick={onClick}>
      <div className="archive-month-icon"><Icon name={detail ? 'file-text' : 'history'} size={20} /></div>
      <div className="archive-month-copy">
        <strong>{item.label}</strong>
        <small>{formatDateBangla(item.start_date)} → {formatDateBangla(item.end_date)}</small>
        <span>{detail ? 'বিস্তারিত ডাটা উপলব্ধ' : 'শুধু মাসিক সারসংক্ষেপ'}</span>
      </div>
      <Icon name="chevron" size={18} />
    </button>
  );
}

export function PreviousMonthsPage() {
  const toast = useToast();
  const [months, setMonths] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMonths(await fetchPreviousMonths()); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'পূর্ববর্তী মাসগুলো লোড করা যায়নি।')); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const open = async (item) => {
    setDetailLoading(true);
    try { setDetail(await fetchArchivedMonthDetail(item.period_id)); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'এই মাসের তথ্য খোলা যায়নি।')); }
    finally { setDetailLoading(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Archive" title="আর্কাইভ" description="বন্ধ মাসগুলোর রিপোর্ট দেখুন। সাধারণ সদস্যরা শুধু দেখতে পারবেন; সংশোধনের সুবিধা কেবল বর্তমান প্রধান ম্যানেজারের জন্য।" />
      {loading ? <LoadingSpinner label="পূর্ববর্তী মাস লোড হচ্ছে..." /> : months.length === 0 ? (
        <div className="empty-state-card"><Icon name="history" size={28} /><strong>কোনো পূর্ববর্তী মাস নেই</strong><span>মেসে এখনো archive করা মাস পাওয়া যায়নি।</span></div>
      ) : (
        <div className="archive-month-list">
          {months.map((item) => <MonthSummaryCard key={item.period_id} item={item} onClick={() => open(item)} />)}
        </div>
      )}
      {detailLoading && <div className="modal-backdrop"><div className="modal-panel card"><LoadingSpinner label="মাসের বিস্তারিত লোড হচ্ছে..." /></div></div>}
      {detail && !detailLoading && <ArchiveDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ArchiveDetailModal({ detail, onClose }) {
  const markets = Array.isArray(detail.markets) ? detail.markets : [];
  const meals = Array.isArray(detail.meals) ? detail.meals : [];
  const ledger = Array.isArray(detail.ledger) ? detail.ledger : [];
  const isDetail = Array.isArray(detail.markets);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel card large-modal" role="dialog" aria-modal="true" aria-label="মাসের বিস্তারিত">
        <div className="modal-head"><div><span className="eyebrow">{detail.label}</span><h2>{formatDateBangla(detail.start_date)} → {formatDateBangla(detail.end_date)}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button></div>
        {isDetail ? (
          <>
            <div className="archive-detail-grid">
              <div className="metric"><span>বাজার</span><strong>{formatCurrency(markets.reduce((s, m) => s + Number(m.total || 0), 0))}</strong></div>
              <div className="metric"><span>মিল দিন</span><strong>{formatNumber(meals.length)}</strong></div>
              <div className="metric"><span>লেনদেন</span><strong>{formatNumber(ledger.length)}</strong></div>
            </div>
            <section className="archive-detail-section"><div className="section-heading"><h3>বাজার</h3><span>{formatNumber(markets.length)}টি</span></div>{markets.slice(0, 50).map((market) => <div className="archive-list-row" key={market.id}><div><strong>{market.member_name}</strong><small>{formatDateWithWeekday(market.entry_date)}</small></div><strong>{formatCurrency(market.total)}</strong></div>)}</section>
            <section className="archive-detail-section"><div className="section-heading"><h3>মিল</h3><span>{formatNumber(meals.length)} দিন</span></div>{meals.slice(0, 60).map((meal) => <div className="archive-list-row" key={meal.date}><div><strong>{formatDateWithWeekday(meal.date)}</strong><small>ব্রেকফাস্ট {formatNumber(meal.breakfast)} · লাঞ্চ {formatNumber(meal.lunch)} · ডিনার {formatNumber(meal.dinner)}</small></div><span className="member-badge subtle">{meal.status}</span></div>)}</section>
          </>
        ) : (
          <div className="archive-summary-grid">
            <div className="metric"><span>মোট জমা</span><strong>{formatCurrency(detail.total_deposit)}</strong></div>
            <div className="metric"><span>মোট বাজার</span><strong>{formatCurrency(detail.total_market_expense)}</strong></div>
            <div className="metric"><span>মোট মিল</span><strong>{formatNumber(detail.total_meals)}</strong></div>
            <div className="metric"><span>মিল রেট</span><strong>{formatCurrency(detail.meal_rate)}</strong></div>
            <div className="metric"><span>অন্যান্য খরচ</span><strong>{formatCurrency(detail.total_other_expense)}</strong></div>
            <div className="metric"><span>অবশিষ্ট ফান্ড</span><strong>{formatCurrency(detail.fund_remaining)}</strong></div>
          </div>
        )}
      </div>
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
    try { setPeriods(await fetchMyArchiveEditablePeriods()); }
    catch (error) {
      setPeriods([]);
      setErrorText(getFriendlySupabaseError(error, 'আর্কাইভের অনুমতিগুলো লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="page-stack">
    <PageHeader eyebrow="নির্দিষ্ট মাসের অনুমতি" title="আর্কাইভ সম্পাদনা" description="শুধু যে আর্কাইভের জন্য তোমার বৈধ অনুমতি আছে, সেগুলোই এখানে দেখানো হবে।" />
    {loading ? <LoadingSpinner label="আর্কাইভের অনুমতি যাচাই হচ্ছে..." /> : errorText ? <div className="state-card state-card-warning"><Icon name="warning" size={24} /><div><h2>আর্কাইভ লোড করা যায়নি</h2><p>{errorText}</p><button className="secondary-button compact" type="button" onClick={load}>আবার চেষ্টা করুন</button></div></div> : periods.length === 0 ? <div className="empty-state-card"><Icon name="shield" size={28} /><strong>এখনো কোনো আর্কাইভ সম্পাদনার অনুমতি নেই</strong><span>যে ম্যানেজার মাসটি বন্ধ করেছেন, বর্তমান প্রধান ম্যানেজার তাকে ওই নির্দিষ্ট মাসের জন্য অস্থায়ী অনুমতি দিতে পারবেন।</span></div> : <div className="archive-month-list">{periods.map((period) => <article className="card archive-month-card detail-month" key={period.period_id}><div className="archive-month-icon"><Icon name="history" size={20} /></div><div className="archive-month-copy"><strong>{period.label}</strong><small>{formatDateBangla(period.start_date)} → {formatDateBangla(period.end_date)}</small><span>{period.access_kind}{period.expires_at ? ` · মেয়াদ ${formatDateWithWeekday(period.expires_at)}` : ''}</span><span>মাস বন্ধ করেছিলেন: {period.manager_at_close_name}</span></div><button className="primary-button compact" type="button" onClick={() => navigateTo(`/app/history?archive_period=${encodeURIComponent(period.period_id)}`)}>হিসাব খুলুন</button></article>)}</div>}
  </div>;
}
