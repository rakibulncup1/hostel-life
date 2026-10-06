import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { navigateTo } from '../../app/AppShell';
import { fetchMemberDirectory, fetchRunningPeriod } from '../../services/diningService';
import {
  addKhalaMoney,
  changeManager,
  deactivateMember,
  fetchArchivePermissions,
  grantArchiveEditPermission,
  reactivateMember,
  regenerateJoinCode,
  revokeArchiveEditPermission,
  startNewMonth,
  updateHostel,
  updateKhalaMoney,
  voidKhalaMoney,
} from '../../services/managerService';
import { fetchKhalaMoneyHistory, fetchPreviousMonths, fetchArchivedMonthDetail } from '../../services/historyService';
import { downloadCsv, fetchCurrentReportBundle, printReport } from '../../services/reportService';
import { formatDateBangla, formatDateWithWeekday, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

function ManagerGuard({ children }) {
  const { isManager } = useAuth();
  if (isManager) return children;
  return (
    <div className="state-card state-card-warning">
      <Icon name="shield" size={28} />
      <div><h2>ম্যানেজার অনুমতি প্রয়োজন</h2><p>এই ফিচারটি শুধু বর্তমান ম্যানেজার ব্যবহার করতে পারবেন।</p></div>
    </div>
  );
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

function SelectMember({ members, value, onChange, includeInactive = false }) {
  const rows = includeInactive ? members : members.filter((m) => m.member_status === 'active');
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">সদস্য নির্বাচন করুন</option>
      {rows.map((member) => <option value={member.membership_id} key={member.membership_id}>{member.member_name}{member.member_status === 'inactive' ? ' — নিষ্ক্রিয়' : ''}</option>)}
    </select>
  );
}

export function NewMonthPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [period, setPeriod] = useState(null);
  const [startDate, setStartDate] = useState(toDateInputValue());
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await fetchRunningPeriod();
      setPeriod(current);
      const today = toDateInputValue();
      setStartDate(today);
      if (current?.end_date) {
        const next = new Date(`${current.end_date}T00:00:00`);
        next.setDate(next.getDate() + 1);
        const year = next.getFullYear();
        const month = String(next.getMonth() + 1).padStart(2, '0');
        const day = String(next.getDate()).padStart(2, '0');
        setStartDate(`${year}-${month}-${day}` === today ? today : today);
      }
      if (!endDate) {
        const nextMonthEnd = new Date(`${today.slice(0, 7)}-01T00:00:00`);
        nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 2, 0);
        const y = nextMonthEnd.getFullYear();
        const m = String(nextMonthEnd.getMonth() + 1).padStart(2, '0');
        const d = String(nextMonthEnd.getDate()).padStart(2, '0');
        setEndDate(`${y}-${m}-${d}`);
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'চলমান মাসের তথ্য লোড করা যায়নি।'));
    } finally { setLoading(false); }
  }, [endDate, toast]);

  useEffect(() => { if (online) load(); }, [online, load]);

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>নতুন মাস শুরু করতে অনলাইন সংযোগ প্রয়োজন।</p></div></div>;
  if (loading) return <LoadingSpinner label="চলমান মাস যাচাই হচ্ছে..." />;

  const canStart = startDate === toDateInputValue() && Boolean(endDate) && endDate >= startDate;

  const submit = async () => {
    setBusy(true);
    try {
      const result = await startNewMonth(startDate, endDate);
      setConfirmOpen(false);
      toast.success(`নতুন মাস সফলভাবে শুরু হয়েছে। ${formatDateBangla(result?.new_start_date || startDate)} থেকে হিসাব চলবে।`);
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'নতুন মাস শুরু করা যায়নি।'));
    } finally { setBusy(false); }
  };

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="নতুন মাস শুরু" icon="calendar" description="বর্তমান মাস আর্কাইভ করে নতুন চলমান মাস চালু করুন।" />
        <section className="card manager-form-card">
          <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>এটি একটি গুরুত্বপূর্ণ হিসাব পরিবর্তন।</strong><p>বর্তমান মাস আর্কাইভ হবে এবং নতুন মাসের জন্য নতুন মিল ও হিসাবের সময়কাল শুরু হবে।</p></div></div>
          <div className="manager-current-period">
            <span>বর্তমান চলমান মাস</span>
            <strong>{period?.label || '—'}</strong>
            <small>{period ? `${formatDateBangla(period.start_date)} → ${formatDateBangla(period.end_date)}` : 'কোনো চলমান মাস নেই'}</small>
          </div>
          <div className="form-grid-2">
            <label className="field-label"><span>নতুন মাসের শুরুর তারিখ</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <label className="field-label"><span>নতুন মাসের শেষ তারিখ</span><input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          </div>
          <div className="form-hint"><Icon name="info" size={15} /> সিস্টেমের নিয়ম অনুযায়ী নতুন মাস আজকের তারিখ থেকে শুরু হতে হবে এবং আগের মাসের শেষ তারিখ নতুন মাসের আগের দিন হতে হবে।</div>
          <button className="primary-button large" type="button" disabled={!canStart || busy} onClick={() => setConfirmOpen(true)}><Icon name="calendar" size={17} /> নতুন মাস শুরু করুন</button>
        </section>
        {confirmOpen && <ConfirmModal title="নতুন মাস শুরু করবেন?" description={`বর্তমান ${period?.label || 'মাস'} archive হবে এবং ${formatDateBangla(startDate)} থেকে নতুন হিসাব শুরু হবে।`} confirmLabel="হ্যাঁ, নতুন মাস শুরু করুন" busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={submit} />}
      </div>
    </ManagerGuard>
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
    try { setMembers(await fetchMemberDirectory()); }
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
    <ManagerGuard>
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
    </ManagerGuard>
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
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="মেস সেটিংস" icon="lock" description="মেসের পরিচয় এবং যুক্ত হওয়ার কোড পরিচালনা করুন।" />
        <form className="card manager-form-card" onSubmit={saveName}>
          <label className="field-label"><span>মেসের নাম</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'মেসের নাম সংরক্ষণ করুন'}</button>
        </form>
        <section className="card manager-form-card">
          <div className="panel-header"><div><span className="eyebrow">যুক্ত হওয়ার কোড</span><h2>মেসে সদস্য যুক্ত করার কোড</h2><p>নতুন সদস্যকে এই কোড দিন। নতুন কোড তৈরি করলে আগের কোডটি আর কাজ করবে না।</p></div></div>
          <div className="join-code-display"><strong>{joinCode || '—'}</strong><button className="secondary-button compact" type="button" onClick={() => navigator.clipboard?.writeText(joinCode).then(() => toast.success('যুক্ত হওয়ার কোড কপি হয়েছে।')).catch(() => toast.warning('কপি করা যায়নি।'))}>কপি</button></div>
          <button className="secondary-button" type="button" disabled={codeBusy} onClick={() => setConfirmCode(true)}><Icon name="refresh" size={15} /> নতুন যুক্ত হওয়ার কোড তৈরি করুন</button>
        </section>
        {confirmCode && <ConfirmModal title="নতুন যুক্ত হওয়ার কোড তৈরি করবেন?" description="নতুন কোড তৈরি করলে আগের যুক্ত হওয়ার কোড দিয়ে আর নতুন সদস্য যুক্ত হতে পারবে না।" confirmLabel="নতুন কোড তৈরি করুন" busy={codeBusy} onClose={() => setConfirmCode(false)} onConfirm={regen} />}
      </div>
    </ManagerGuard>
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
    try { setMembers(await fetchMemberDirectory()); }
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
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="সদস্য ব্যবস্থাপনা" icon="users" description="মেস ছেড়ে যাওয়া সদস্যকে নিষ্ক্রিয় করুন; প্রয়োজন হলে পরে আবার সক্রিয় করুন।" />
        {loading ? <LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..." /> : <div className="manager-member-list">
          {members.map((member) => {
            const isSelf = member.membership_id === membership?.membership_id;
            const inactive = member.member_status === 'inactive';
            return (
              <article className={`card manager-member-row ${inactive ? 'manager-member-inactive' : ''}`} key={member.membership_id}>
                <div className="manager-member-main"><span className="avatar">{member.member_name?.split(/\s+/).slice(0,2).map((x) => x[0]).join('').toUpperCase()}</span><div><strong>{member.member_name}</strong><div className="member-badge-row"><span className={`member-badge ${inactive ? 'inactive' : 'active'}`}>{inactive ? 'নিষ্ক্রিয়' : 'সক্রিয় সদস্য'}</span>{member.role === 'manager' && <span className="member-badge manager">ম্যানেজার</span>}</div><small>{member.meal_activity || 'এই মাসে মিল নেই'}</small></div></div>
                <div className="manager-member-actions">{inactive ? <button className="secondary-button compact" type="button" onClick={() => setAction({ type: 'reactivate', member })}>আবার সক্রিয়</button> : <button className="secondary-button compact danger-outline" type="button" disabled={isSelf || member.role === 'manager'} onClick={() => setAction({ type: 'deactivate', member })}>{isSelf ? 'নিজেকে নয়' : member.role === 'manager' ? 'আগে Manager Change' : 'নিষ্ক্রিয় করুন'}</button>}</div>
              </article>
            );
          })}
        </div>}
        {action && <ConfirmModal danger={action.type === 'deactivate'} title={action.type === 'deactivate' ? 'সদস্য নিষ্ক্রিয় করবেন?' : 'সদস্য আবার সক্রিয় করবেন?'} description={action.type === 'deactivate' ? `${action.member.member_name}-এর নতুন meal request/active operation বন্ধ হবে, তবে পুরোনো সব হিসাব অক্ষত থাকবে।` : `${action.member.member_name} আবার active member হিসেবে নতুন কাজ করতে পারবে।`} confirmLabel={action.type === 'deactivate' ? 'নিষ্ক্রিয় করুন' : 'আবার সক্রিয় করুন'} onClose={() => setAction(null)} onConfirm={runAction} />}
      </div>
    </ManagerGuard>
  );
}

export function KhalaMoneyPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [members, setMembers] = useState([]);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    id: null,
    memberId: '',
    amount: '',
    date: toDateInputValue(),
    description: '',
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, khalaRows] = await Promise.all([
        fetchMemberDirectory(),
        fetchKhalaMoneyHistory({ limit: 250 }),
      ]);
      setMembers(memberRows);
      setRows(khalaRows);

      if (!form.memberId) {
        setForm((current) => ({
          ...current,
          memberId: memberRows.find((m) => m.member_status === 'active')?.membership_id || '',
        }));
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [form.memberId, toast]);

  useEffect(() => {
    if (online) load();
  }, [online, load]);

  const activeMemberId = useMemo(
    () => members.find((member) => member.member_status === 'active')?.membership_id || '',
    [members],
  );

  const total = useMemo(
    () => rows
      .filter((row) => row.status !== 'void')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows],
  );

  const resetForm = () => {
    setForm({
      id: null,
      memberId: activeMemberId,
      amount: '',
      date: toDateInputValue(),
      description: '',
    });
  };

  const save = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.memberId) return toast.warning('সদস্য নির্বাচন করুন।');
    if (!(amount > 0)) return toast.warning('টাকার পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!form.date) return toast.warning('তারিখ নির্বাচন করুন।');

    setBusy(true);
    try {
      if (form.id) {
        await updateKhalaMoney({
          এন্ট্রিId: form.id,
          memberId: form.memberId,
          amount,
          date: form.date,
          description: form.description.trim() || null,
        });
        toast.success('খালার টাকার এন্ট্রি সফলভাবে আপডেট হয়েছে।');
      } else {
        await addKhalaMoney({
          memberId: form.memberId,
          amount,
          date: form.date,
          description: form.description.trim() || null,
        });
        toast.success('খালার টাকার এন্ট্রি সফলভাবে যোগ হয়েছে।');
      }
      resetForm();
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'খালার টাকার এন্ট্রি সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await voidKhalaMoney(voidTarget.এন্ট্রি_id, 'ম্যানেজার কর্তৃক বাতিল করা হয়েছে');
      toast.success('খালার টাকার এন্ট্রি সফলভাবে বাতিল হয়েছে।');
      setVoidTarget(null);
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'এন্ট্রি বাতিল করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row) => {
    setForm({
      id: row.এন্ট্রি_id,
      memberId: row.member_id,
      amount: String(row.amount),
      date: row.এন্ট্রি_date,
      description: row.description || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!online) {
    return (
      <div className="state-card state-card-warning">
        <Icon name="offline" size={27} />
        <div>
          <h2>ইন্টারনেট চালু করুন</h2>
          <p>খালার টাকার হিসাব অনলাইনেই পরিচালনা করা হয়।</p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSpinner label="খালার টাকার তথ্য লোড হচ্ছে..." />;

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader
          title="খালার টাকা"
          icon="wallet"
          description="এই হিসাব মিল রেটের বাইরে আলাদাভাবে রাখা হয়। সদস্যরা দেখতে পারবে, এন্ট্রি শুধু ম্যানেজার করতে পারবেন।"
        />

        <section className="card manager-total-hero">
          <div>
            <span>এই মাসের মোট</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <span className="member-badge manager">ম্যানেজার এন্ট্রি</span>
        </section>

        <form className="card manager-form-card" onSubmit={save}>
          <div className="panel-header">
            <div>
              <span className="eyebrow">এন্ট্রি</span>
              <h2>{form.id ? 'খালার টাকার এন্ট্রি সম্পাদনা' : 'নতুন খালার টাকার এন্ট্রি'}</h2>
            </div>
            {form.id && (
              <button className="secondary-button compact" type="button" onClick={resetForm} disabled={busy}>
                নতুন এন্ট্রি
              </button>
            )}
          </div>

          <div className="form-grid-2">
            <label className="field-label">
              <span>সদস্য</span>
              <SelectMember
                members={members}
                value={form.memberId}
                onChange={(value) => setForm((current) => ({ ...current, memberId: value }))}
              />
            </label>
            <label className="field-label">
              <span>তারিখ</span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              />
            </label>
          </div>

          <div className="form-grid-2">
            <label className="field-label">
              <span>টাকার পরিমাণ</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="০"
              />
            </label>
            <label className="field-label">
              <span>বিবরণ <em>(ঐচ্ছিক)</em></span>
              <input
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="খালার মাসিক টাকা"
              />
            </label>
          </div>

          <button className="primary-button large" type="submit" disabled={busy}>
            {busy ? 'সংরক্ষণ হচ্ছে...' : form.id ? 'পরিবর্তন সংরক্ষণ করুন' : 'খালার টাকা যোগ করুন'}
          </button>
        </form>

        <section className="manager-list-stack">
          <div className="section-heading">
            <h2>এন্ট্রি তালিকা</h2>
            <span>{formatNumber(rows.length)}টি</span>
          </div>

          {rows.length === 0 ? (
            <div className="empty-state-card">
              <Icon name="wallet" size={26} />
              <strong>কোনো এন্ট্রি নেই</strong>
              <span>এই মাসে এখনো খালার টাকার কোনো এন্ট্রি দেওয়া হয়নি।</span>
            </div>
          ) : (
            rows.map((row) => (
              <article
                className={`card manager-ledger-row ${row.status === 'void' ? 'void-row' : ''}`}
                key={row.এন্ট্রি_id}
              >
                <div>
                  <strong>{row.member_name}</strong>
                  <small>{formatDateWithWeekday(row.এন্ট্রি_date)} · {formatDateTime12(row.created_at)}</small>
                  <span>{row.description || 'কোনো বিবরণ নেই'}</span>
                </div>

                <strong>{formatCurrency(row.amount)}</strong>

                <div className="row-actions">
                  {row.status !== 'void' && (
                    <>
                      <button
                        className="icon-button compact-icon"
                        type="button"
                        onClick={() => startEdit(row)}
                        aria-label="সম্পাদনা"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="icon-button compact-icon danger-icon"
                        type="button"
                        onClick={() => setVoidTarget(row)}
                        aria-label="বাতিল"
                        disabled={busy}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>

                <span className={`member-badge ${row.status === 'void' ? 'inactive' : 'active'}`}>
                  {row.status === 'void' ? 'বাতিল' : 'সক্রিয়'}
                </span>
              </article>
            ))
          )}
        </section>

        {voidTarget && (
          <ConfirmModal
            danger
            title="খালার টাকার এন্ট্রি বাতিল করবেন?"
            description={`${voidTarget.member_name}-এর ${formatCurrency(voidTarget.amount)} এন্ট্রিটি history-তে থাকবে, কিন্তু হিসাবের সক্রিয় মোট-এ আর গণনা হবে না।`}
            confirmLabel="বাতিল করুন"
            busy={busy}
            onClose={() => setVoidTarget(null)}
            onConfirm={doVoid}
          />
        )}
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
  const [অনুমতিs, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permLoading, setPermLoading] = useState(false);
  const [grantForm, setGrantForm] = useState({ membershipId: '', expiresAt: '', reason: '' });
  const [busy, setBusy] = useState(false);

  const loadMonths = useCallback(async () => {
    setLoading(true);
    try {
      const [monthRows, memberRows] = await Promise.all([fetchPreviousMonths(), fetchMemberDirectory()]);
      setMonths(monthRows.filter((row) => row.detail_available)); setMembers(memberRows);
      if (!selectedPeriod && monthRows.some((row) => row.detail_available)) setSelectedPeriod(monthRows.find((row) => row.detail_available).period_id);
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'আর্কাইভের তথ্য লোড করা যায়নি।')); }
    finally { setLoading(false); }
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

  const grant = async (event) => {
    event.preventDefault();
    if (!selectedPeriod) return toast.warning('একটি আর্কাইভ করা মাস নির্বাচন করুন।');
    if (!grantForm.membershipId) return toast.warning('যে সদস্যকে অনুমতি দেবেন তাকে নির্বাচন করুন।');
    setBusy(true);
    try {
      await grantArchiveEditPermission({ periodId: selectedPeriod, membershipId: grantForm.membershipId, expiresAt: grantForm.expiresAt ? new Date(grantForm.expiresAt).toISOString() : null, reason: grantForm.reason.trim() || null });
      toast.success('আর্কাইভ সম্পাদনার অনুমতি সফলভাবে দেওয়া হয়েছে।');
      setGrantForm({ membershipId: '', expiresAt: '', reason: '' }); await loadPermissions();
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'আর্কাইভ সম্পাদনার অনুমতি দেওয়া যায়নি।')); }
    finally { setBusy(false); }
  };

  const revoke = async (অনুমতিId) => {
    setBusy(true);
    try { await revokeArchiveEditPermission(অনুমতিId); toast.success('আর্কাইভ সম্পাদনার অনুমতি বাতিল হয়েছে।'); await loadPermissions(); }
    catch (error) { toast.error(getFriendlySupabaseError(error, 'Permission বাতিল করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const selectedLabel = months.find((m) => m.period_id === selectedPeriod);
  const memberMap = new Map(members.map((m) => [m.membership_id, m.member_name]));

  if (!online) return <div className="state-card state-card-warning"><Icon name="offline" size={27} /><div><h2>ইন্টারনেট চালু করুন</h2><p>আর্কাইভ ব্যবস্থাপনা অনলাইনেই পরিচালিত হয়।</p></div></div>;
  if (loading) return <LoadingSpinner label="Archive management প্রস্তুত হচ্ছে..." />;

  return (
    <ManagerGuard>
      <div className="page-stack">
        <PageHeader title="আর্কাইভ" icon="history" description="পুরোনো মাসের বিস্তারিত দেখুন এবং প্রয়োজনে scoped temporary edit অনুমতি দিন।" />
        {months.length === 0 ? <div className="empty-state-card"><Icon name="history" size={28} /><strong>বিস্তারিত archive পাওয়া যায়নি</strong><span>সর্বশেষ ৩টি archive বিস্তারিত হিসেবে সংরক্ষিত থাকবে।</span></div> : <>
          <section className="card manager-form-card"><label className="field-label"><span>সম্পাদনার জন্য আর্কাইভ করা মাস</span><select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>{months.map((m) => <option key={m.period_id} value={m.period_id}>{m.label} — {formatDateBangla(m.start_date)} → {formatDateBangla(m.end_date)}</option>)}</select></label><div className="form-hint"><Icon name="info" size={15} /> বর্তমান Manager আর্কাইভ করা মাস-এর নিজের ক্ষমতা অনুযায়ী edit করতে পারবেন। অন্য কাউকে temporary অনুমতি দিলে সেটি নির্দিষ্ট month-এই সীমাবদ্ধ থাকবে।</div></section>
          <form className="card manager-form-card" onSubmit={grant}>
            <div className="panel-header"><div><span className="eyebrow">Temporary Permission</span><h2>আর্কাইভ সম্পাদনার অনুমতি দিন</h2></div></div>
            <div className="form-grid-2"><label className="field-label"><span>সদস্য</span><SelectMember members={members} value={grantForm.membershipId} onChange={(value) => setGrantForm((f) => ({ ...f, membershipId: value }))} /></label><label className="field-label"><span>মেয়াদ শেষ <em>(ঐচ্ছিক)</em></span><input type="datetime-local" value={grantForm.expiresAt} onChange={(e) => setGrantForm((f) => ({ ...f, expiresAt: e.target.value }))} /></label></div>
            <label className="field-label"><span>কারণ <em>(ঐচ্ছিক)</em></span><textarea rows="3" value={grantForm.reason} onChange={(e) => setGrantForm((f) => ({ ...f, reason: e.target.value }))} placeholder="পুরোনো মাসের হিসাব সংশোধনের প্রয়োজন" /></label>
            <button className="primary-button" type="submit" disabled={busy}>অনুমতি দিন</button>
          </form>
          <section className="card manager-form-card"><div className="section-heading"><div><h2>{selectedLabel?.label || 'Archive'}-এর বর্তমান অনুমতি</h2><small>{formatNumber(অনুমতিs.filter((p) => !p.revoked_at).length)}টি active অনুমতি</small></div><button className="secondary-button compact" type="button" onClick={loadPermissions} disabled={permLoading}><Icon name="refresh" size={15} /> রিফ্রেশ</button></div>{অনুমতিs.filter((p) => !p.revoked_at).length === 0 ? <div className="empty-state-card compact-empty"><Icon name="shield" size={24} /><strong>কোনো temporary অনুমতি নেই</strong><span>প্রয়োজনে উপরের form থেকে দিন।</span></div> : <div className="অনুমতি-list">{অনুমতিs.filter((p) => !p.revoked_at).map((p) => <article className="অনুমতি-row" key={p.id}><div><strong>{memberMap.get(p.membership_id) || 'সদস্য'}</strong><small>দেওয়া হয়েছে: {formatDateTime12(p.created_at)}</small><span>{p.expires_at ? `মেয়াদ: ${formatDateTime12(p.expires_at)}` : 'মেয়াদ নির্দিষ্ট নয়'}</span>{p.reason && <span>কারণ: {p.reason}</span>}</div><button className="secondary-button compact danger-outline" type="button" disabled={busy} onClick={() => revoke(p.id)}>বাতিল করুন</button></article>)}</div>}</section>
        </>}
      </div>
    </ManagerGuard>
  );
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

  const download = () => downloadCsv(`hostel-life-meal-sheet-${bundle.period.label}.csv`, [
    { label: 'তারিখ', value: (r) => formatDateWithWeekday(r.date) },
    { label: 'অবস্থা', value: (r) => r.status },
    { label: 'ব্রেকফাস্ট', value: (r) => r.breakfast },
    { label: 'লাঞ্চ', value: (r) => r.lunch },
    { label: 'ডিনার', value: (r) => r.dinner },
    { label: 'মোট', value: (r) => Number(r.breakfast) + Number(r.lunch) + Number(r.dinner) },
  ], dailyTotals);

  const print = () => {
    setPrintBusy(true);
    try {
      const rows = dailyTotals.map((r) => `<tr><td>${formatDateWithWeekday(r.date)}</td><td>${r.status}</td><td>${r.breakfast}</td><td>${r.lunch}</td><td>${r.dinner}</td><td>${r.breakfast+r.lunch+r.dinner}</td></tr>`).join('');
      printReport(`মিল শিট — ${bundle.period.label}`, `${formatDateBangla(bundle.period.start_date)} → ${formatDateBangla(bundle.period.end_date)}`, `<table><thead><tr><th>তারিখ</th><th>অবস্থা</th><th>ব্রেকফাস্ট</th><th>লাঞ্চ</th><th>ডিনার</th><th>মোট</th></tr></thead><tbody>${rows}</tbody></table>`);
    } catch (error) { toast.error(error.message || 'রিপোর্ট প্রিন্ট করা যায়নি।'); }
    finally { setPrintBusy(false); }
  };

  return (
    <div className="page-stack"><PageHeader title="মিল শিট" icon="history" description={`${bundle.period.label} — দৈনিক মিলের সারসংক্ষেপ এবং সদস্যভিত্তিক মোট হিসাব।`} />
      <section className="card report-toolbar"><div><strong>{bundle.period.label}</strong><small>{formatDateBangla(bundle.period.start_date)} → {formatDateBangla(bundle.period.end_date)}</small></div><div className="report-actions"><button className="secondary-button compact" type="button" onClick={download}><Icon name="download" size={15} /> CSV</button><button className="primary-button compact" type="button" disabled={printBusy} onClick={print}><Icon name="file-text" size={15} /> প্রিন্ট / PDF</button></div></section>
      <section className="card report-section-card"><div className="section-heading"><h2>দৈনিক মিল</h2><span>{formatNumber(dailyTotals.length)} দিন</span></div><Table columns={[{key:'date',label:'তারিখ',render:(r)=>formatDateWithWeekday(r.date)},{key:'status',label:'অবস্থা'},{key:'breakfast',label:'ব্রেকফাস্ট',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'লাঞ্চ',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'ডিনার',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(Number(r.breakfast)+Number(r.lunch)+Number(r.dinner))}]} rows={dailyTotals} /></section>
      <section className="card report-section-card"><div className="section-heading"><h2>সদস্যভিত্তিক মোট</h2><span>{formatNumber(memberTotals.length)} জন</span></div><Table columns={[{key:'name',label:'সদস্য'},{key:'breakfast',label:'ব্রেকফাস্ট',render:(r)=>formatNumber(r.breakfast)},{key:'lunch',label:'লাঞ্চ',render:(r)=>formatNumber(r.lunch)},{key:'dinner',label:'ডিনার',render:(r)=>formatNumber(r.dinner)},{key:'total',label:'মোট',render:(r)=>formatNumber(r.breakfast+r.lunch+r.dinner)}]} rows={memberTotals} /></section>
    </div>
  );
}

export function ReportsPage() {
  const toast = useToast();
  const online = useOnlineStatus();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const totalMeals = bundle.mealRows.reduce((s, r) => s + Number(r.breakfast||0)+Number(r.lunch||0)+Number(r.dinner||0), 0);
  const totalMarket = bundle.marketRows.reduce((s, r) => s + Number(r.total_amount||0), 0);
  const totalCredit = bundle.marketRows.filter((r) => r.credit_to_buyer).reduce((s, r) => s + Number(r.total_amount||0), 0);

  const downloadMarket = () => downloadCsv(`hostel-life-market-${bundle.period.label}.csv`, [
    {label:'তারিখ',value:r=>formatDateWithWeekday(r.এন্ট্রি_date)}, {label:'বাজারকারী',value:r=>r.buyer_name}, {label:'মোট',value:r=>r.total_amount}, {label:'ডিপোজিটে যুক্ত',value:r=>r.credit_to_buyer?'হ্যাঁ':'না'}, {label:'আইটেম সংখ্যা',value:r=>Array.isArray(r.items)?r.items.length:0}
  ], bundle.marketRows);
  const downloadAccount = () => downloadCsv(`hostel-life-account-${bundle.period.label}.csv`, [
    {label:'তারিখ/সময়',value:r=>formatDateTime12(r.created_at)}, {label:'সদস্য',value:r=>r.member_name}, {label:'ধরন',value:r=>r.transaction_type}, {label:'পরিমাণ',value:r=>r.amount}, {label:'বিবরণ',value:r=>r.description||''}
  ], bundle.accountRows);
  const downloadMeal = () => downloadCsv(`hostel-life-meals-${bundle.period.label}.csv`, [
    {label:'তারিখ',value:r=>formatDateWithWeekday(r.date)}, {label:'সদস্য',value:r=>r.memberName}, {label:'ব্রেকফাস্ট',value:r=>r.breakfast}, {label:'লাঞ্চ',value:r=>r.lunch}, {label:'ডিনার',value:r=>r.dinner}, {label:'মোট',value:r=>Number(r.breakfast)+Number(r.lunch)+Number(r.dinner)}, {label:'ফাইনাল',value:r=>r.finalized?'হ্যাঁ':'না'}
  ], bundle.mealRows.filter(r=>r.date));

  const printSummary = () => {
    const html = `<table><tr><th>বিষয়</th><th>পরিমাণ</th></tr><tr><td>মোট মিল</td><td>${formatNumber(totalMeals)}</td></tr><tr><td>মোট বাজার</td><td>${formatCurrency(totalMarket)}</td></tr><tr><td>বাজার থেকে জমায় যুক্ত</td><td>${formatCurrency(totalCredit)}</td></tr><tr><td>হিসাব transaction</td><td>${formatNumber(bundle.accountRows.length)}</td></tr><tr><td>খালার টাকার এন্ট্রি</td><td>${formatNumber(bundle.khalaRows.length)}</td></tr></table>`;
    try { printReport(`Hostel Life — ${bundle.period.label} রিপোর্ট`, `${formatDateBangla(bundle.period.start_date)} → ${formatDateBangla(bundle.period.end_date)}`, html); }
    catch (error) { toast.error(error.message || 'রিপোর্ট প্রিন্ট করা যায়নি।'); }
  };

  return (
    <div className="page-stack"><PageHeader title="রিপোর্ট ডাউনলোড" icon="download" description="বর্তমান চলমান মাস-এর প্রয়োজনীয় রিপোর্ট CSV বা প্রিন্ট/PDF হিসেবে নিন।" />
      <section className="report-kpi-grid"><div className="card report-kpi"><span>মোট মিল</span><strong>{formatNumber(totalMeals)}</strong></div><div className="card report-kpi"><span>মোট বাজার</span><strong>{formatCurrency(totalMarket)}</strong></div><div className="card report-kpi"><span>বাজার ডিপোজিট</span><strong>{formatCurrency(totalCredit)}</strong></div><div className="card report-kpi"><span>লেনদেন</span><strong>{formatNumber(bundle.accountRows.length)}</strong></div></section>
      <div className="report-download-grid">
        <button className="card report-option" type="button" onClick={downloadMeal}><span className="report-option-icon"><Icon name="dining" size={21} /></span><strong>মিল রিপোর্ট</strong><small>প্রতিটি সদস্যের প্রতিদিনের মিল</small><b>CSV ডাউনলোড</b></button>
        <button className="card report-option" type="button" onClick={downloadMarket}><span className="report-option-icon"><Icon name="shopping-bag" size={21} /></span><strong>বাজার রিপোর্ট</strong><small>বাজারকারী, পরিমাণ ও জমার অবস্থা</small><b>CSV ডাউনলোড</b></button>
        <button className="card report-option" type="button" onClick={downloadAccount}><span className="report-option-icon"><Icon name="wallet" size={21} /></span><strong>হিসাব রিপোর্ট</strong><small>জমা, খরচ ও সংশোধন</small><b>CSV ডাউনলোড</b></button>
        <button className="card report-option" type="button" onClick={printSummary}><span className="report-option-icon"><Icon name="file-text" size={21} /></span><strong>মাসিক সারসংক্ষেপ</strong><small>সাধারণ সারসংক্ষেপ — প্রিন্ট/PDF</small><b>প্রিন্ট করুন</b></button>
      </div>
    </div>
  );
}
