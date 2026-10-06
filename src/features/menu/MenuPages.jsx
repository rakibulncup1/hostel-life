import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { navigateTo } from '../../app/AppShell';
import { fetchMemberDirectory } from '../../services/diningService';
import { fetchArchivedMonthDetail, fetchPreviousMonths } from '../../services/historyService';
import { managerSendNotification } from '../../services/notificationService';
import { fetchTopEaters, fetchTopShoppers } from '../../services/rankingService';
import { formatDateBangla, formatDateWithWeekday } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

function PageHeader({ eyebrow = 'হোস্টেল লাইফ', title, description, back = true }) {
  return (
    <div className="page-title-row menu-page-title">
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
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await fetchMemberDirectory());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'সদস্য তালিকা লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="মেসের সবাই" title="সকল সদস্য" description="সক্রিয় ও নিষ্ক্রিয় সদস্যের বর্তমান মাসের হিসাব দেখুন।" />
      {loading ? <LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..." /> : members.length === 0 ? (
        <div className="empty-state-card"><Icon name="users" size={28} /><strong>কোনো সদস্য পাওয়া যায়নি</strong><span>মেসে এখনো কোনো সদস্যের তথ্য নেই।</span></div>
      ) : (
        <div className="menu-member-grid">
          {members.map((member) => (
            <article className={`card all-member-card ${member.member_status === 'inactive' ? 'member-inactive-card' : ''}`} key={member.membership_id}>
              <div className="all-member-head">
                <Avatar member={member} />
                <div className="all-member-copy">
                  <strong>{member.member_name}</strong>
                  <div className="member-badge-row">
                    <span className={`member-badge ${member.member_status === 'active' ? 'active' : 'inactive'}`}>{member.member_status === 'active' ? 'সক্রিয় সদস্য' : 'নিষ্ক্রিয়'}</span>
                    <span className="member-badge subtle">{member.meal_activity || 'এই মাসে মিল নেই'}</span>
                    {member.role === 'manager' && <span className="member-badge manager">ম্যানেজার</span>}
                  </div>
                </div>
              </div>
              <div className="member-stats-grid">
                <div><span>ডিপোজিট</span><strong>{formatCurrency(member.deposit)}</strong></div>
                <div><span>মিল</span><strong>{formatNumber(member.final_meals)}</strong></div>
                <div><span>মিল খরচ</span><strong>{formatCurrency(member.meal_cost)}</strong></div>
                <div><span>ব্যালেন্স</span><strong>{formatCurrency(member.balance)}</strong></div>
              </div>
            </article>
          ))}
        </div>
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
          <div className="empty-state-card compact-empty"><Icon name={shopper ? 'shopping-bag' : 'trophy'} size={25} /><strong>এখনো কোনো র‌্যাঙ্কিং নেই</strong><span>বর্তমান মাসে যথেষ্ট valid data যোগ হলে তালিকা দেখা যাবে।</span></div>
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
      <PageHeader eyebrow="Hostel Life" title="ডেভেলপার ইনফো" description="এই অ্যাপের নির্মাতা ও যোগাযোগের তথ্য।" />
      <section className="card developer-card">
        <div className="developer-photo-placeholder" aria-label="ডেভেলপারের ছবি পরে যুক্ত হবে"><Icon name="user" size={42} /></div>
        <div className="developer-name">RAKIBUL ISLAM SAMRAT</div>
        <div className="developer-subtitle">Student Of Mymensingh Government Polytechnic Institute</div>
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
        </div>
        <div className="developer-note">ডেভেলপারের ছবি পরে সরাসরি এই কার্ডের উপরের অংশে যুক্ত করা হবে।</div>
      </section>
    </div>
  );
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
      <PageHeader eyebrow="পরবর্তী module" title={title} description={description} />
      <div className="card empty-state-card module-placeholder"><Icon name="clock" size={28} /><strong>এই ফিচারটি পরের module-এ সম্পূর্ণ হবে</strong><span>বর্তমান Module 05-এর অন্যান্য অংশ প্রস্তুত আছে।</span></div>
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
