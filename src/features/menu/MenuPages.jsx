import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useAuth } from '../../contexts/AuthContext';
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
  const [members, setMembers] = useState([]);
  const [hasRunningPeriod, setHasRunningPeriod] = useState(true);
  const [runningPeriodId, setRunningPeriodId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberDetail, setMemberDetail] = useState(null);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [requestedMemberId] = useState(() => new URLSearchParams(window.location.search).get('member_id') || '');

  const load = useCallback(async () => {
    setLoading(true);
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
      toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(refreshIfVisible, 300000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  useRealtimeRefresh({
    enabled: true,
    hostelId: membership?.hostel_id,
    tables: ['hostel_memberships'],
    onRefresh: () => load(),
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
  const { membership } = useAuth();
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
      rows: [...group.rows].sort((a, b) => {
        const aMine = a.membership_id === membership?.membership_id ? 0 : 1;
        const bMine = b.membership_id === membership?.membership_id ? 0 : 1;
        if (aMine !== bMine) return aMine - bMine;
        return String(b.entry_date || b.created_at || '').localeCompare(String(a.entry_date || a.created_at || ''));
      }),
      total: group.rows.filter((row) => row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0),
    }));
  }, [rows, membership?.membership_id]);

  const myCount = rows.filter((row) => row.membership_id === membership?.membership_id && row.status !== 'void').length;
  const myTotal = rows.filter((row) => row.membership_id === membership?.membership_id && row.status !== 'void').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="মেসের স্বচ্ছতা"
        title="খালার টাকা"
        description="প্রতিটি মাসে কার কত টাকা জমা হয়েছে দেখুন। আপনার এন্ট্রি আগে থাকবে; এই পেজটি শুধু দেখার জন্য।"
      />

      <section className="card khala-view-hero">
        <div>
          <span className="eyebrow">আপনার হিসাব</span>
          <h2>{myCount ? `${formatCurrency(myTotal)} জমা` : 'আপনার নামে এখনো কোনো এন্ট্রি নেই'}</h2>
          <p>{myCount ? `সকল উপলভ্য মাসে ${formatNumber(myCount)}টি কার্যকর এন্ট্রি` : 'ম্যানেজার আপনার নামে এন্ট্রি যোগ করলে সেটি এখানে ও নিচের ইতিহাসে দেখা যাবে।'}</p>
          <div className="khala-view-hero-metrics"><div><span>আপনার কার্যকর এন্ট্রি</span><strong>{formatNumber(myCount)}টি</strong></div><div><span>আপনার মোট অবদান</span><strong>{formatCurrency(myTotal)}</strong></div></div>
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
              {group.rows.map((row) => {
                const isMine = row.membership_id === membership?.membership_id;
                return (
                  <article className={`khala-public-row ${isMine ? 'is-mine' : ''} ${row.status === 'void' ? 'is-void' : ''}`} key={row.entry_id}>
                    <div className="khala-public-person">
                      <Avatar member={{ member_name: row.member_name }} />
                      <div>
                        <strong>{isMine ? 'আপনি' : row.member_name || 'সদস্য'}</strong>
                        <small>{formatDateWithWeekday(row.entry_date)}{row.description ? ` · ${row.description}` : ''}</small>
                      </div>
                    </div>
                    <div className="khala-public-amount">
                      <strong>{formatCurrency(row.amount)}</strong>
                      <span className={`member-badge ${row.status === 'void' ? 'inactive' : isMine ? 'active' : 'subtle'}`}>
                        {row.status === 'void' ? 'বাতিল' : isMine ? 'আপনার এন্ট্রি' : 'পরিশোধিত'}
                      </span>
                    </div>
                  </article>
                );
              })}
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
                <div className="rank-copy"><strong>{row.member_name}</strong><small>{row.is_first ? '🏆 সবার আগে' : `ক্রমিক ${formatNumber(row.rank_no)}`}</small></div>
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
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Hostel Life" title="ডেভেলপার ইনফো" />
      <section className="card developer-card">
        <div className="developer-photo-placeholder" aria-label="ডেভেলপার"><Icon name="user" size={42} /></div>
        <div className="developer-name">RAKIBUL ISLAM SAMRAT</div>
        <div className="developer-subtitle">ময়মনসিংহ সরকারি পলিটেকনিক ইনস্টিটিউটের শিক্ষার্থী</div>
        <div className="developer-contact-list">
          <a className="developer-contact" href="mailto:support.sec1.info@gmail.com">
            <span className="developer-contact-icon"><Icon name="mail" size={18} /></span>
            <span><small>ইমেইল</small><strong>support.sec1.info@gmail.com</strong></span>
            <Icon name="external-link" size={16} />
          </a>
          <a className="developer-contact" href="https://wa.me/8801965787790" target="_blank" rel="noreferrer">
            <span className="developer-contact-icon"><Icon name="phone" size={18} /></span>
            <span><small>হোয়াটসঅ্যাপ</small><strong>01965787790</strong></span>
            <Icon name="external-link" size={16} />
          </a>
          <a className="developer-contact" href="https://rakibul-sec1.vercel.app/" target="_blank" rel="noreferrer">
            <span className="developer-contact-icon"><Icon name="external-link" size={18} /></span>
            <span><small>পোর্টফোলিও</small><strong>rakibul-sec1.vercel.app</strong></span>
            <Icon name="external-link" size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return <div className="page-stack"><PageHeader eyebrow="সিস্টেম তথ্য" title="গোপনীয়তা ও নীতিমালা" description="Hostel Life-এ তথ্য ব্যবহারের প্রাথমিক ধারণা। পূর্ণ নীতিমালা পরবর্তী সংস্করণে বিস্তারিত করা হবে।" />
    <section className="card policy-content-card"><div className="policy-note"><Icon name="info" size={18}/><span>এটি প্রাথমিক নমুনা লেখা—প্রকাশের আগে চূড়ান্ত নীতিমালা যাচাই করে হালনাগাদ করতে হবে।</span></div>
      <h2>কোন তথ্য ব্যবহৃত হয়</h2><p>অ্যাপটি মেসের সদস্যপরিচয়, মিলের রেকর্ড, জমা, বাজার, খরচ ও সংশ্লিষ্ট হিসাব পরিচালনার জন্য প্রয়োজনীয় তথ্য ব্যবহার করে।</p>
      <h2>তথ্যের গোপনীয়তা</h2><p>ব্যবহারকারীর অ্যাক্সেস অ্যাপের অনুমতি ও মেসের ব্যবস্থাপনা-নিয়মের মধ্যে সীমাবদ্ধ থাকা উচিত। লগইন তথ্য, পাসওয়ার্ড বা ব্যক্তিগত অ্যাক্সেস লিংক অন্যের সঙ্গে ভাগ করবেন না।</p>
      <h2>সঠিক তথ্য ও সহায়তা</h2><p>কোনো হিসাব ভুল মনে হলে অনুমোদিত ম্যানেজারকে জানান। চূড়ান্ত নীতিমালায় তথ্য সংরক্ষণ, মুছে ফেলা ও যোগাযোগের পদ্ধতি পরে স্পষ্ট করা হবে।</p>
    </section></div>;
}

export function TermsPage() {
  return <div className="page-stack"><PageHeader eyebrow="সিস্টেম তথ্য" title="ব্যবহারের শর্তাবলী" description="অ্যাপ ব্যবহারের প্রাথমিক নিয়মের নমুনা। বিস্তারিত শর্তাবলী পরে চূড়ান্ত করা হবে।" />
    <section className="card policy-content-card"><div className="policy-note"><Icon name="info" size={18}/><span>এটি ডেমো কনটেন্ট; চূড়ান্ত ব্যবহারের আগে আপনার প্রয়োজন অনুযায়ী সম্পাদনা করতে হবে।</span></div>
      <h2>সঠিকভাবে ব্যবহার</h2><p>মিল, বাজার, জমা ও খরচের তথ্য যথাসম্ভব সঠিকভাবে দিন। ভুল তথ্য ধরা পড়লে অনুমোদিত সংশোধনের প্রক্রিয়া অনুসরণ করুন।</p>
      <h2>অনুমতি ও দায়িত্ব</h2><p>কোনো কাজ কেবল নিজের অ্যাকাউন্টের অনুমতি অনুযায়ী করবেন। অনুমোদন-প্রয়োজনীয় অনুরোধ ম্যানেজারের পর্যালোচনা ছাড়া চূড়ান্ত বলে গণ্য হবে না।</p>
      <h2>হিসাব যাচাই</h2><p>অ্যাপে প্রদর্শিত হিসাব নিয়ে প্রশ্ন থাকলে সংশ্লিষ্ট রেকর্ড ও তারিখসহ ম্যানেজারকে জানান। এই পৃষ্ঠাটি পূর্ণ চুক্তির বিকল্প নয়।</p>
    </section></div>;
}

export function HowToUsePage() {
  return <div className="page-stack"><PageHeader eyebrow="সহায়তা" title="কীভাবে ব্যবহার করব" description="Hostel Life-এর সাধারণ কাজগুলো করার সংক্ষিপ্ত নির্দেশিকা।" />
    <section className="card policy-content-card"><div className="policy-step"><span>১</span><div><h2>ড্যাশবোর্ড</h2><p>আজকের ও পরবর্তী দিনের মিল, সদস্যদের সারসংক্ষেপ এবং প্রযোজ্য অনুমোদিত লেট রিকোয়েস্ট দেখুন।</p></div></div>
      <div className="policy-step"><span>২</span><div><h2>ডাইনিং</h2><p>নিজের মিলের অনুরোধ দিন, অনুরোধের ইতিহাস দেখুন এবং অনুমোদিত কাজের মধ্যে বাজার বা অন্যান্য এন্ট্রি পরিচালনা করুন।</p></div></div>
      <div className="policy-step"><span>৩</span><div><h2>হিস্টরি</h2><p>বাজার ইতিহাস, জমা-খরচের লেনদেন এবং আগের মাসের তথ্য দেখুন। অনুমতি থাকলেই কেবল লেনদেন সম্পাদনা করা যাবে।</p></div></div>
      <div className="policy-step"><span>৪</span><div><h2>রিপোর্ট ও মিল শিট</h2><p>প্রয়োজনীয় মাস বা সদস্য বেছে রিপোর্ট তৈরি করুন। PDF সংরক্ষণের জন্য প্রিন্ট উইন্ডোতে “Save as PDF / PDF হিসেবে সংরক্ষণ” নির্বাচন করুন।</p></div></div>
      <div className="policy-note"><Icon name="info" size={18}/><span>অ্যাপের কিছু নির্দেশনা বর্তমানে সংক্ষিপ্ত নমুনা হিসেবে আছে; পরবর্তী পর্যায়ে আরও বিস্তারিত করা হবে।</span></div>
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
      <PageHeader eyebrow="Archive" title="পূর্ববর্তী মাস" description="শেষ ৩ মাস বিস্তারিত এবং তার আগের ১২ মাসের সারসংক্ষেপ।" />
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
    <p className="muted-note">অনুমতি শুধু নির্দিষ্ট আর্কাইভের জন্য কার্যকর। মেয়াদ শেষ বা অনুমতি বাতিল হলে সার্ভার থেকে সম্পাদনা আটকে যাবে।</p>
  </div>;
}
