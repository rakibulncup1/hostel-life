import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
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
import { managerSendNotification } from '../../services/notificationService';
import { fetchTopEaters, fetchTopShoppers } from '../../services/rankingService';
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
                    <div>
                      <strong>খালার পারিশ্রমিক</strong>
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(shopper ? await fetchTopShoppers() : await fetchTopEaters());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'র‌্যাঙ্কিং লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [shopper, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="চলতি মাসের মজার হিসাব"
        title={shopper ? 'বেশি বাজারকারী' : 'শীর্ষ খাদক'}
        description={shopper ? 'চলতি মাসে বৈধ বাজার এন্ট্রির মোট টাকার ভিত্তিতে বেশি থেকে কম।' : 'চলতি মাসে final meal-এর মোট সংখ্যার ভিত্তিতে বেশি থেকে কম।'}
      />
      <section className="card ranking-card">
        <div className="ranking-card-head">
          <div className={`ranking-hero-icon ${shopper ? 'shopper' : 'eater'}`}><Icon name={shopper ? 'shopping-bag' : 'trophy'} size={25} /></div>
          <div>
            <span className="eyebrow">অগ্রাধিকার তালিকা</span>
            <h2>{shopper ? 'বাজারের সেরা ক্রেতারা' : 'এই মাসের শীর্ষ খাদকরা'}</h2>
          </div>
          <button className="icon-button compact-icon ghost" type="button" onClick={load} aria-label="রিফ্রেশ"><Icon name="refresh" size={17} /></button>
        </div>
        {loading ? <LoadingSpinner label="র‌্যাঙ্কিং লোড হচ্ছে..." /> : rows.length === 0 ? (
          <div className="empty-state-card compact-empty"><Icon name={shopper ? 'shopping-bag' : 'trophy'} size={25} /><strong>এখনো কোনো র‌্যাঙ্কিং নেই</strong><span>এই মাসের তথ্য যোগ হলে তালিকা এখানে দেখা যাবে।</span></div>
        ) : (
          <div className="ranking-list">
            {rows.map((row) => (
              <article className={`ranking-row ${row.is_first ? 'first-rank' : ''}`} key={row.membership_id}>
                <div className={`rank-number ${row.rank_no <= 3 ? `rank-${row.rank_no}` : ''}`}>{row.rank_no}</div>
                <div className="rank-avatar-wrap"><Avatar member={{ member_name: row.member_name }} />{row.is_first && <span className="rank-crown"><Icon name="crown" size={13} /></span>}</div>
                <div className="rank-copy"><strong>{row.rank_no <= 3 ? '🏆 ' : ''}{row.member_name}</strong><small>{row.is_first ? '🏆 সবার আগে' : `ক্রমিক ${formatNumber(row.rank_no)}`}</small></div>
                <div className="rank-value"><strong>{shopper ? formatCurrency(row.total_market_amount) : formatNumber(row.total_meals, { maximumFractionDigits: 1 })}</strong><span>{shopper ? 'বাজার' : 'মিল'}</span></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function TopEatersPage() { return <RankingPage kind="eater" />; }
export function TopShoppersPage() { return <RankingPage kind="shopper" />; }

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
  return <div className="page-stack"><PageHeader eyebrow="সিস্টেম তথ্য" title="গোপনীয়তার নীতি" description="Hostel Life ব্যবহারের সময় আপনার তথ্য কীভাবে ব্যবহৃত ও সুরক্ষিত রাখা হয়।" />
    <section className="card policy-content-card policy-document-card">
      <div className="policy-document-lead"><Icon name="shield" size={24}/><div><strong>আপনার তথ্যের গোপনীয়তা গুরুত্বপূর্ণ</strong><p>এই নীতিতে অ্যাপের সাধারণ তথ্য-ব্যবহার, অ্যাক্সেস ও নিরাপদ ব্যবহারের নীতিগুলো সহজ ভাষায় তুলে ধরা হয়েছে।</p></div></div>
      <h2>১. কোন তথ্য ব্যবহার করা হয়</h2><p>অ্যাকাউন্ট তৈরি ও অ্যাপ পরিচালনার জন্য নাম, যোগাযোগের তথ্য, মেসের সদস্যপদ এবং ব্যবহারকারীর দেওয়া মিল, বাজার, জমা ও খরচের রেকর্ড ব্যবহার করা হতে পারে। এসব তথ্য অ্যাপের কাজ সম্পন্ন করা, হিসাব দেখানো এবং অনুমোদিত কার্যক্রম পরিচালনার জন্য ব্যবহৃত হয়।</p>
      <h2>২. তথ্য কীভাবে দেখা যায়</h2><p>আপনার অ্যাকাউন্টের অনুমতি ও মেসের ভূমিকা অনুযায়ী তথ্য দেখানো হয়। সাধারণ সদস্য নিজের প্রাসঙ্গিক হিসাব দেখতে পারবেন; মেস পরিচালনার জন্য অনুমোদিত ম্যানেজার প্রয়োজনীয় সামগ্রিক রেকর্ড দেখতে পারবেন। সংবেদনশীল কাজের অনুমতি ভূমিকা ও নিরাপত্তা নিয়ম দ্বারা সীমিত থাকা উচিত।</p>
      <h2>৩. তথ্যের সঠিকতা</h2><p>মিল, বাজার, ডিপোজিট ও অন্যান্য রেকর্ড সঠিকভাবে দেওয়ার দায় ব্যবহারকারীর। কোনো ভুল চোখে পড়লে সংশ্লিষ্ট ম্যানেজারকে জানান এবং অ্যাপে থাকা অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন।</p>
      <h2>৪. তথ্য সুরক্ষায় আপনার ভূমিকা</h2><p>নিজের পাসওয়ার্ড ও লগইন-সুবিধা গোপন রাখুন, অন্য কাউকে নিজের অ্যাকাউন্ট ব্যবহার করতে দেবেন না এবং শেয়ার করা ডিভাইস ব্যবহার শেষে লগ আউট করুন। অচেনা লিংক বা সন্দেহজনক অনুরোধে ব্যক্তিগত তথ্য দেবেন না।</p>
      <h2>৫. তথ্য সংরক্ষণ ও অপসারণ</h2><p>মেসের হিসাবের ধারাবাহিকতা ও বিরোধ নিষ্পত্তির প্রয়োজনে কিছু রেকর্ড নির্দিষ্ট সময় ধরে রাখা হতে পারে। কোনো অ্যাকাউন্ট বা রেকর্ড সংশোধন/অপসারণের অনুরোধ থাকলে মেসের অনুমোদিত ম্যানেজার বা অ্যাপের নির্ধারিত সহায়তা-যোগাযোগের সঙ্গে যোগাযোগ করুন। আইনগত বা হিসাব-সংক্রান্ত কারণে কিছু রেকর্ড তাৎক্ষণিকভাবে অপসারণযোগ্য নাও হতে পারে।</p>
      <h2>৬. নীতির পরিবর্তন</h2><p>অ্যাপের ফিচার বা প্রযোজ্য প্রয়োজন বদলালে এই নীতির ভাষা হালনাগাদ হতে পারে। গুরুত্বপূর্ণ পরিবর্তনের পর নীতির নতুন সংস্করণ পর্যালোচনা করুন।</p>
      
    </section></div>;
}

export function TermsPage() {
  return <div className="page-stack"><PageHeader eyebrow="সিস্টেম তথ্য" title="ব্যবহারের শর্তাবলী" description="Hostel Life সুষ্ঠু ও দায়িত্বশীলভাবে ব্যবহারের নিয়ম।" />
    <section className="card policy-content-card policy-document-card">
      <div className="policy-document-lead"><Icon name="book-open" size={24}/><div><strong>সবার জন্য স্বচ্ছ হিসাব ও দায়িত্বশীল ব্যবহার</strong><p>অ্যাপ ব্যবহার করলে নিচের সাধারণ নিয়মগুলো মেনে চলতে সম্মত হওয়া প্রত্যাশিত।</p></div></div>
      <h2>১. অ্যাকাউন্টের দায়িত্ব</h2><p>অ্যাকাউন্টের তথ্য সঠিক রাখুন এবং নিজের লগইন-সুবিধা নিরাপদে সংরক্ষণ করুন। নিজের পরিচয়ে অন্য কাউকে ব্যবহার করতে দেওয়া বা অন্যের অ্যাকাউন্টে অননুমোদিত প্রবেশ করা যাবে না।</p>
      <h2>২. মিল ও আর্থিক রেকর্ড</h2><p>মিলের অনুরোধ, বাজার, জমা, খরচ ও অন্যান্য হিসাব বাস্তব তথ্য অনুযায়ী দিতে হবে। ইচ্ছাকৃতভাবে ভুল, বিভ্রান্তিকর বা অন্য সদস্যের ক্ষতি করে এমন তথ্য দেওয়া যাবে না।</p>
      <h2>৩. অনুমতি ও ভূমিকা</h2><p>শুধু নিজের ভূমিকার আওতায় থাকা কাজ করুন। ম্যানেজারের অনুমোদন প্রয়োজন এমন লেট অনুরোধ, সময়সীমা পার হওয়ার পরের সংশোধন অথবা বন্ধ মাসের পরিবর্তন অনুমোদিত প্রক্রিয়া ছাড়া চূড়ান্ত হবে না। Super Admin বা ম্যানেজারের ক্ষমতা ব্যক্তিগত সুবিধায় অপব্যবহার করা যাবে না।</p>
      <h2>৪. হিসাব যাচাই ও বিরোধ</h2><p>লেনদেন বা মিলের হিসাবে ভুল মনে হলে তারিখ, পরিমাণ ও সংশ্লিষ্ট বিবরণ দিয়ে মেসের ম্যানেজারকে জানান। অনুমোদিত পদ্ধতিতে সংশোধন করুন; হিসাবের ইতিহাস লুকানো বা ভুল তথ্য দিয়ে বদলানোর চেষ্টা করবেন না।</p>
      <h2>৫. গ্রহণযোগ্য ব্যবহার</h2><p>অ্যাপের নিরাপত্তা নষ্ট করা, স্বয়ংক্রিয়ভাবে অতিরিক্ত অনুরোধ পাঠানো, অন্যের তথ্য সংগ্রহের চেষ্টা করা বা অন্য ব্যবহারকারীর স্বাভাবিক ব্যবহার বাধাগ্রস্ত করা যাবে না। নিরাপত্তাজনিত সন্দেহ হলে অ্যাপের নির্ধারিত যোগাযোগের মাধ্যমে জানান।</p>
      <h2>৬. সেবা ও তথ্যের সীমা</h2><p>অ্যাপের প্রদর্শিত হিসাব প্রদত্ত ও সংরক্ষিত রেকর্ডের ওপর নির্ভরশীল। কোনো গুরুত্বপূর্ণ আর্থিক সিদ্ধান্তের আগে সংশ্লিষ্ট রেকর্ড মিলিয়ে নিন। নেটওয়ার্ক, ডিভাইস বা রক্ষণাবেক্ষণের কারণে সাময়িকভাবে সেবা ব্যাহত হতে পারে।</p>
      <h2>৭. শর্তাবলীর হালনাগাদ</h2><p>সেবা বা পরিচালনাপদ্ধতি বদলালে শর্তাবলী সংশোধন করা হতে পারে। অ্যাপ নিয়মিত ব্যবহার করার সময় হালনাগাদ সংস্করণ পর্যালোচনা করুন।</p>
    </section></div>;
}

export function HowToUsePage() {
  const steps = [
    ['অ্যাকাউন্ট তৈরি ও লগইন', 'রেজিস্ট্রেশনে নিজের তথ্য দিয়ে অ্যাকাউন্ট তৈরি করুন। ইমেইল যাচাই চাওয়া হলে যাচাই শেষ করুন; এরপর লগইন করুন। প্রতিষ্ঠান রেজিস্ট্রেশন কোড চালু রাখলে সঠিক কোড লাগবে।'],
    ['মেসে যোগদানের অনুরোধ', 'মেসের জয়েন কোড বা উপলব্ধ যোগদান-পদ্ধতি ব্যবহার করে অনুরোধ পাঠান। অনুরোধ অনুমোদিত না হওয়া পর্যন্ত সদস্য হিসেবে হিসাব ব্যবহার করা যাবে না।'],
    ['ম্যানেজারের অনুমোদন', 'ম্যানেজার সদস্যের অনুরোধ পরীক্ষা করে গ্রহণ বা প্রত্যাখ্যান করেন। অনুমোদন হয়ে গেলে সদস্য ড্যাশবোর্ড ও নিজের প্রাসঙ্গিক হিসাব দেখতে পারবেন।'],
    ['চলমান মাস শুরু', 'প্রধান ম্যানেজার আগের মাস বন্ধ হওয়ার পর নির্ধারিত পরদিন থেকে নতুন মাস চালু করবেন। মাস শুরু/বন্ধ ও ম্যানেজার বদলের সিদ্ধান্ত সবার সঙ্গে সমন্বয় করে নিন।'],
    ['দৈনিক মিল ও লেট রিকোয়েস্ট', 'ডাইনিং থেকে নিয়মিত মিলের তথ্য দিন। নির্ধারিত সময় পেরিয়ে গেলে লেট রিকোয়েস্ট পাঠানো যেতে পারে; সেটি ম্যানেজার গ্রহণ না করা পর্যন্ত অনুমোদিত মিল হিসেবে ধরবেন না।'],
    ['বাজার ও অর্থের হিসাব', 'বাজার এন্ট্রি করলে আইটেম, টাকা, তারিখ ও সংশ্লিষ্ট সদস্য যাচাই করুন। ডিপোজিট, অন্যান্য খরচ ও খালার টাকা আলাদা হিসাব হিসেবে দেখুন। ভুল হলে অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন।'],
    ['হিস্টরি ও রিপোর্ট', 'হিস্টরি থেকে চলমান মাসের বাজার এবং হিসাব দেখুন। পূর্ববর্তী মাসের বিস্তারিত/সামারি সংরক্ষণনীতি অনুযায়ী দেখানো হতে পারে। রিপোর্ট PDF হিসেবে সংরক্ষণের আগে মাস, মোট হিসাব ও পেজ পরীক্ষা করুন।'],
    ['সহকারী ও প্রধান ম্যানেজার', 'প্রধান ম্যানেজার অনুমোদিত সদস্যকে সহকারী হিসেবে নির্বাচন করতে পারেন। সহকারীর ক্ষমতা সীমিত; মূল ম্যানেজার পরিবর্তনের মতো কাজ কেবল অনুমোদিত ভূমিকা থেকেই সম্পন্ন হবে।'],
    ['মাস বন্ধ ও আর্কাইভ সংশোধন', 'মাস বন্ধ করার আগে মিল, বাজার, জমা ও খরচ যাচাই করুন। বন্ধ মাসে নির্দিষ্ট হিসাব সংশোধনের ক্ষমতা কেবল উপযুক্ত closing manager অথবা বৈধ সময়সীমার archive permission অনুযায়ী প্রযোজ্য।'],
    ['নোটিফিকেশন ও নিরাপত্তা', 'গুরুত্বপূর্ণ কাজের আপডেট নোটিফিকেশন ইনবক্সে দেখুন। পাসওয়ার্ড ও জয়েন কোড গোপন রাখুন। ভুল হিসাব বা অ্যাক্সেসের সমস্যা হলে ম্যানেজার বা অনুমোদিত অ্যাডমিনের সঙ্গে যোগাযোগ করুন।'],
  ];
  return <div className="page-stack"><PageHeader eyebrow="সহায়তা" title="ব্যবহার নির্দেশনা" description="অ্যাকাউন্ট তৈরি থেকে মাসের হিসাব সংরক্ষণ—ধাপে ধাপে ব্যবহারপদ্ধতি।" />
    <section className="card policy-content-card" aria-label="Hostel Life ব্যবহার নির্দেশনা">
      <div className="policy-document-lead"><Icon name="book-open" size={24}/><div><strong>নতুন ব্যবহারকারীর শুরু থেকে সম্পূর্ণ কাজের ধাপ</strong><p>আপনার ভূমিকা ও মেসের সেটিংস অনুযায়ী কিছু অপশন ভিন্ন হতে পারে।</p></div></div>
      {steps.map(([title, description], index) => <div className="policy-step" key={title}><span aria-hidden="true">{index + 1}</span><div><h2>{title}</h2><p>{description}</p></div></div>)}
      <div className="policy-note"><Icon name="info" size={18}/><span>কোনো সংরক্ষিত হিসাব স্থায়ীভাবে মুছে ফেলার আগে স্বাধীন ব্যাকআপ এবং চূড়ান্ত সামারি মিলিয়ে নিন। নোটিফিকেশন পেলেই সংশ্লিষ্ট কার্যক্রম সফল হয়েছে ধরে নেবেন না; হিস্টরিতে রেকর্ড যাচাই করুন।</span></div>
    </section></div>;
}

export function SendNotificationPage() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isManager) return <div className="state-card state-card-warning"><Icon name="shield" size={26} /><div><h2>ম্যানেজার অনুমতি প্রয়োজন</h2><p>এই ফিচার শুধু ম্যানেজারের জন্য।</p></div></div>;

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) return toast.warning('নোটিফিকেশনের শিরোনাম দিন।');
    if (!body.trim()) return toast.warning('নোটিফিকেশনের বার্তা দিন।');
    setBusy(true);
    try {
      await managerSendNotification(title.trim(), body.trim());
      setTitle('');
      setBody('');
      toast.success('নোটিফিকেশন সফলভাবে সবার কাছে পাঠানো হয়েছে।');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নোটিফিকেশন পাঠানো যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ম্যানেজার ফিচার" title="নোটিফিকেশন পাঠান" description="সব সক্রিয় সদস্যের নোটিফিকেশন ইনবক্সে একটি বার্তা পাঠান।" />
      <form className="card form-panel" onSubmit={submit}>
        <label className="field-label"><span>শিরোনাম</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="যেমন: আজ রাতের রান্নার সময়" /></label>
        <label className="field-label"><span>বার্তা</span><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={6} placeholder="সবার জন্য প্রয়োজনীয় তথ্য লিখুন..." /></label>
        <div className="form-hint"><Icon name="bell" size={15} /> পাঠানো হলে সক্রিয় সদস্যদের নোটিফিকেশন ইনবক্সে যাবে।</div>
        <button className="primary-button large" type="submit" disabled={busy}>{busy ? 'পাঠানো হচ্ছে...' : 'নোটিফিকেশন পাঠান'}</button>
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
