import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { supabase } from '../../lib/supabase';
import { normalizePlatformOverview } from '../../utils/platformOverview';
import {
  fetchPlatformPublicSettings, platformAdminGenerateAccessCode, platformAdminGetOverview,
  platformAdminListHostelMembers, platformAdminListHostels, platformAdminSetGate,
  platformAdminSetHostelStatus, platformAdminSetUserBlocked, platformAdminUpdatePublicSettings,
  platformAdminSetHostelFlag, platformAdminSetUserFlag, platformAdminPermanentlyDeleteHostel,
  platformAdminPermanentlyDeleteMember, uploadDeveloperPhoto,
  platformAdminGetRetention, platformAdminUpdateRetention,
  platformAdminListExpiredArchives, platformAdminDeleteExpiredArchive,
  platformAdminFinalizeArchiveSummary, platformAdminVerifyArchiveSummary, platformAdminListSavedSummaries,
} from '../../services/platformService';

const EMPTY_SETTINGS = {
  announcement_enabled: false, announcement_title: '', announcement_body: '',
  registration_code_required: false, hostel_creation_code_required: false,
  developer_name: '', developer_title: '', developer_photo_url: '', developer_email: '',
  developer_phone: '', developer_portfolio_url: '',
};
const errorText = (error, fallback) => /platform_admin_|get_platform_public_settings|function .* does not exist|schema cache/i.test(String(error?.message || ''))
  ? 'Super Admin SQL এখনো প্রয়োগ করা হয়নি। প্রথমে নির্দেশিকার Phase 2 SQL চালিয়ে schema reload হওয়া পর্যন্ত অপেক্ষা করুন।'
  : (error?.message || fallback);

function Field({ label, value, onChange, type = 'text', maxLength, multiline = false }) {
  return <label className="field-label platform-field"><span>{label}</span>{multiline
    ? <textarea rows={4} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    : <input type={type} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}</label>;
}
function Stat({ label, value, icon }) {
  return <div className="platform-stat"><span className="platform-stat-icon"><Icon name={icon} size={19}/></span><div><small>{label}</small><strong>{value === undefined || value === null || value === '' ? '—' : Number(value).toLocaleString('en-US')}</strong></div></div>;
}

export function SuperAdminPage({ user }) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [gateError, setGateError] = useState('');
  const [password, setPassword] = useState('');
  const [reauthenticated, setReauthenticated] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState({});
  const [hostels, setHostels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [members, setMembers] = useState([]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState('1440');
  const [maxUses, setMaxUses] = useState('1');
  const [generated, setGenerated] = useState(null);
  const [hostelQuery, setHostelQuery] = useState('');
  const [hostelFilter, setHostelFilter] = useState('all');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');
  const [developerPhotoBusy, setDeveloperPhotoBusy] = useState(false);
  const developerPhotoInputRef = useRef(null);
  const [retention, setRetention] = useState(null);
  const [retentionDraft, setRetentionDraft] = useState({ detail: '2', summary: '6' });
  const [expiredArchives, setExpiredArchives] = useState([]);
  const [expiredArchivesLoaded, setExpiredArchivesLoaded] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState([]);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionError, setRetentionError] = useState('');
  const [hostelPage, setHostelPage] = useState(1);
  const [memberPage, setMemberPage] = useState(1);
  const [recoveryTarget, setRecoveryTarget] = useState(null);
  const [recoveryNote, setRecoveryNote] = useState('');
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const pageSize = 20;

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [summary, allHostels, publicSettings] = await Promise.all([
        platformAdminGetOverview(), platformAdminListHostels(), fetchPlatformPublicSettings({ force: true }),
      ]);
      setOverview(summary || {});
      setHostels(allHostels || []);
      setSettings({ ...EMPTY_SETTINGS, ...(Array.isArray(publicSettings) ? publicSettings[0] : publicSettings || {}) });
    } catch (cause) { setError(errorText(cause, 'Super Admin তথ্য লোড করা যায়নি।')); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase || !user?.id) { if (live) { setGateError('বৈধ লগইন সেশন পাওয়া যায়নি।'); setChecking(false); } return; }
      try {
        const { data, error: queryError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (queryError) throw queryError;
        if (!live) return;
        setAllowed(data?.role === 'super_admin');
        if (data?.role !== 'super_admin') setGateError('এই পৃষ্ঠাটি খোলা যাচ্ছে না।');
      } catch (cause) { if (live) setGateError('এই পৃষ্ঠাটি খোলা যাচ্ছে না।'); }
      finally { if (live) setChecking(false); }
    })();
    return () => { live = false; };
  }, [user?.id]);
  useEffect(() => { if (allowed && reauthenticated) refresh(); }, [allowed, reauthenticated, refresh]);

  const sortedMembers = useMemo(() => [...members]
    .filter((member) => !memberQuery || `${member.full_name || ''} ${member.phone || ''} ${member.user_id || ''}`.toLowerCase().includes(memberQuery.toLowerCase()))
    .filter((member) => memberFilter === 'all'
      || (memberFilter === 'favorite' && member.is_favorite)
      || (memberFilter === 'trusted' && member.is_trusted)
      || (memberFilter === 'blocked' && member.is_blocked))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'bn')),
  [members, memberQuery, memberFilter]);
  const filteredHostels = useMemo(() => [...hostels]
    .filter((hostel) => !hostelQuery || `${hostel.name || ''} ${hostel.hostel_id || ''}`.toLowerCase().includes(hostelQuery.toLowerCase()))
    .filter((hostel) => hostelFilter === 'all'
      || (hostelFilter === 'favorite' && hostel.is_favorite)
      || (hostelFilter === 'trusted' && hostel.is_trusted)
      || (hostelFilter === 'suspended' && hostel.platform_status === 'suspended')),
  [hostels, hostelQuery, hostelFilter]);
  useEffect(() => { setHostelPage(1); }, [hostelQuery, hostelFilter]);
  useEffect(() => { setMemberPage(1); }, [memberQuery, memberFilter, selected?.hostel_id]);
  const visibleHostels = filteredHostels.slice((hostelPage - 1) * pageSize, hostelPage * pageSize);
  const visibleMembers = sortedMembers.slice((memberPage - 1) * pageSize, memberPage * pageSize);

  const loadRetention = useCallback(async () => {
    setRetentionLoading(true); setRetentionError('');
    const results = await Promise.allSettled([
      platformAdminGetRetention(), platformAdminListExpiredArchives(), platformAdminListSavedSummaries(),
    ]);
    const failures = [];
    const [policyResult, queueResult, savedResult] = results;
    if (policyResult.status === 'fulfilled') {
      const policy = policyResult.value || {};
      setRetention(policy);
      setRetentionDraft({ detail: String(policy.detail_months ?? 2), summary: String(policy.summary_months ?? 6) });
    } else { setRetention(null); failures.push(`নীতি: ${errorText(policyResult.reason, 'লোড হয়নি')}`); }
    if (queueResult.status === 'fulfilled') {
      setExpiredArchives(Array.isArray(queueResult.value) ? queueResult.value : []);
      setExpiredArchivesLoaded(true);
    } else {
      setExpiredArchives([]); setExpiredArchivesLoaded(false);
      failures.push(`মেয়াদোত্তীর্ণ তালিকা: ${errorText(queueResult.reason, 'লোড হয়নি')}`);
    }
    if (savedResult.status === 'fulfilled') setSavedSummaries(Array.isArray(savedResult.value) ? savedResult.value : []);
    else { setSavedSummaries([]); failures.push(`সংরক্ষিত সামারি: ${errorText(savedResult.reason, 'লোড হয়নি')}`); }
    setRetentionError(failures.length ? `কিছু তথ্য লোড হয়নি; সফল তালিকা নিচে দেখা যাচ্ছে। ${failures.join(' · ')}` : '');
    setRetentionLoading(false);
  }, []);
  useEffect(() => { if (tab === 'retention' && reauthenticated) loadRetention(); }, [tab, reauthenticated, loadRetention]);

  const saveRetention = async (event) => {
    event.preventDefault();
    const detail = Number(retentionDraft.detail);
    const summary = Number(retentionDraft.summary);
    if (!Number.isInteger(detail) || !Number.isInteger(summary) || detail < 1 || detail > 24 || summary < 0 || summary > 60) {
      setRetentionError('বিস্তারিত ১–২৪ মাস এবং সামারি ০–৬০ মাসের মধ্যে দিন।'); return;
    }
    if (!window.confirm(`সব মেসে ${detail} মাস বিস্তারিত ও পরবর্তী ${summary} মাস সামারি রাখবেন? এতে এখন কোনো ডেটা মুছবে না।`)) return;
    setRetentionLoading(true); setRetentionError('');
    try {
      await platformAdminUpdateRetention(detail, summary);
      await loadRetention(); setNotice('সংরক্ষণ নীতি হালনাগাদ হয়েছে। কোনো তথ্য স্বয়ংক্রিয়ভাবে মুছে যায়নি।');
    } catch (cause) { setRetentionError(errorText(cause, 'সংরক্ষণ নীতি হালনাগাদ করা যায়নি।')); }
    finally { setRetentionLoading(false); }
  };
  const prepareArchiveSummary = async (entry) => {
    if (!window.confirm(`এই মাসের সারসংক্ষেপ সংরক্ষণ করবেন?\n${entry.period_label || entry.period_id}\nএতে মূল হিসাব মুছবে না।`)) return;
    setRetentionLoading(true); setRetentionError('');
    try {
      await platformAdminFinalizeArchiveSummary(entry.period_id);
      await loadRetention(); setNotice('সারসংক্ষেপ সংরক্ষণ হয়েছে। মূল হিসাব অপরিবর্তিত রয়েছে।');
    } catch (cause) { setRetentionError(errorText(cause, 'সারসংক্ষেপ সংরক্ষণ করা যায়নি।')); }
    finally { setRetentionLoading(false); }
  };
  const verifyArchiveSummary = async (entry) => {
    if (!savedSummaries.some((row) => row.period_id === entry.period_id && !row.purged_at)) { setRetentionError('প্রথমে এই মাসের সামারি সংরক্ষণ করুন।'); return; }
    const phrase = `VERIFY ${entry.period_id}`;
    const confirmation = window.prompt(`মূল হিসাবের সঙ্গে সংরক্ষিত সারসংক্ষেপ নিজে যাচাই করার পর নিচের বাক্যটি লিখুন:\n${phrase}`);
    if (confirmation !== phrase) return;
    setRetentionLoading(true); setRetentionError('');
    try {
      await platformAdminVerifyArchiveSummary(entry.period_id, confirmation);
      await loadRetention(); setNotice('সারসংক্ষেপ যাচাইয়ের অনুমোদন সংরক্ষিত হয়েছে।');
    } catch (cause) { setRetentionError(errorText(cause, 'সারসংক্ষেপ যাচাই করা যায়নি।')); }
    finally { setRetentionLoading(false); }
  };
  const deleteExpiredArchive = async (entry) => {
    if (!savedSummaries.some((row) => row.period_id === entry.period_id && !row.purged_at && row.verified_at)) { setRetentionError('এই মাসের সামারি সংরক্ষিত ও যাচাইকৃত হতে হবে। আগে সংরক্ষণ করে নিজে যাচাই করুন।'); return; }
    const title = `${entry.hostel_name || entry.hostel_id} — ${entry.period_label || entry.period_id}`;
    if (!window.confirm(`“${title}” স্থায়ীভাবে মুছে দিতে চান? সংরক্ষিত সারসংক্ষেপ থেকে মূল লেনদেন ফেরানো যাবে না। ব্যাকআপ নিশ্চিত করুন।`)) return;
    const expected = `DELETE ${entry.period_id}`;
    const confirmation = window.prompt(`সার্ভার যাচাই এবং ম্যানুয়াল সামারি অনুমোদনের পরেই এটি সম্ভব।\nনিশ্চিত করতে হুবহু লিখুন:\n${expected}`);
    if (confirmation !== expected) return;
    setRetentionLoading(true); setRetentionError('');
    try {
      await platformAdminDeleteExpiredArchive(entry.hostel_id, entry.period_id, confirmation);
      await loadRetention(); setNotice('আর্কাইভ অপসারণের অনুরোধ সফল হয়েছে; সারসংক্ষেপ সংরক্ষিত।');
    } catch (cause) { setRetentionError(errorText(cause, 'আর্কাইভ অপসারণ ব্যর্থ হয়েছে।')); }
    finally { setRetentionLoading(false); }
  };

  const metrics = useMemo(() => normalizePlatformOverview(overview), [overview]);
  const selectedStatus = selected?.platform_status || 'active';
  const reauthenticate = async (event) => {
    event.preventDefault(); setGateError(''); setReauthBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user?.email, password });
      if (authError) throw authError;
      setPassword(''); setReauthenticated(true); setNotice('পাসওয়ার্ড যাচাই সফল হয়েছে।');
    } catch { setGateError('পাসওয়ার্ড মিলেনি। আপনার মূল অ্যাকাউন্টের পাসওয়ার্ড যাচাই করুন।'); }
    finally { setReauthBusy(false); }
  };
  const openHostel = async (hostel) => {
    setSelected(hostel); setMembers([]); setReason(''); setBusy(true); setError('');
    try { setMembers(await platformAdminListHostelMembers(hostel.hostel_id)); }
    catch (cause) { setError(errorText(cause, 'সদস্য তালিকা লোড করা যায়নি।')); }
    finally { setBusy(false); }
  };
  const changeHostelStatus = async (status) => {
    if (!selected) return;
    const label = status === 'suspended' ? 'স্থগিত' : 'চালু';
    if (!window.confirm(`“${selected.name}” মেস ${label} করবেন? এই অ্যাকশন ডেটা মুছবে না। স্থায়ীভাবে মুছতে আলাদা Super Delete ব্যবহার করুন।`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetHostelStatus(selected.hostel_id, status, reason);
      setSelected((old) => ({ ...old, platform_status: status })); setNotice('মেসের স্ট্যাটাস আপডেট হয়েছে।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'মেসের স্ট্যাটাস বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const issueTemporaryPassword = async () => {
    if (!recoveryTarget || !recoveryVerified || recoveryNote.trim().length < 5) {
      setError('ব্যবহারকারীর পরিচয় ম্যানুয়ালি যাচাই করে অন্তত ৫ অক্ষরের কারণ লিখুন।'); return;
    }
    if (!window.confirm(`আপনি কি ${recoveryTarget.full_name || 'এই ব্যবহারকারী'}-এর পরিচয় যাচাই করেছেন? আগের পাসওয়ার্ড সঙ্গে সঙ্গে বাতিল হবে।`)) return;
    setRecoveryBusy(true); setError(''); setRecoveryResult('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-temporary-password', {
        body: { user_id: recoveryTarget.user_id, identity_verified: true, verification_note: recoveryNote.trim() },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      if (!data?.temporary_password) throw new Error('সার্ভার থেকে অস্থায়ী পাসওয়ার্ড পাওয়া যায়নি।');
      setRecoveryResult(data.temporary_password);
      if (data.warning) setNotice('পাসওয়ার্ড পরিবর্তিত হয়েছে, তবে সার্ভারের Audit Log যাচাই করতে হবে।');
    } catch (cause) { setError(cause?.message || 'Password Recovery ব্যর্থ হয়েছে। Edge Function Deploy করা আছে কি না পরীক্ষা করুন।'); }
    finally { setRecoveryBusy(false); }
  };
  const toggleBlock = async (member) => {
    const blocked = !member.is_blocked;
    if (!window.confirm(`${member.full_name || 'সদস্য'}-কে ${blocked ? 'ব্লক' : 'আনব্লক'} করবেন?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetUserBlocked(member.user_id, blocked, blocked ? 'Super Admin panel' : null);
      setMembers((old) => old.map((row) => row.user_id === member.user_id ? { ...row, is_blocked: blocked, status: blocked ? 'inactive' : row.status } : row));
      setNotice(`ব্যবহারকারী ${blocked ? 'ব্লক' : 'আনব্লক'} করা হয়েছে।`);
      await refresh();
      if (selected) setMembers(await platformAdminListHostelMembers(selected.hostel_id));
    } catch (cause) { setError(errorText(cause, 'ব্যবহারকারীর স্ট্যাটাস বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const toggleHostelFlag = async (hostel, flag) => {
    const property = flag === 'favorite' ? 'is_favorite' : 'is_trusted';
    const enabled = !Boolean(hostel[property]);
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetHostelFlag(hostel.hostel_id, flag, enabled);
      setHostels((old) => old.map((row) => row.hostel_id === hostel.hostel_id ? { ...row, [property]: enabled } : row));
      setSelected((old) => old?.hostel_id === hostel.hostel_id ? { ...old, [property]: enabled } : old);
      setNotice(`${flag === 'favorite' ? 'পছন্দের' : 'বিশ্বস্ত'} মেসের তালিকা আপডেট হয়েছে।`);
    } catch (cause) { setError(errorText(cause, 'মেসের লেবেল আপডেট করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const toggleMemberFlag = async (member, flag) => {
    const property = flag === 'favorite' ? 'is_favorite' : 'is_trusted';
    const enabled = !Boolean(member[property]);
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetUserFlag(member.user_id, flag, enabled);
      setMembers((old) => old.map((row) => row.user_id === member.user_id ? { ...row, [property]: enabled } : row));
      setNotice(`${flag === 'favorite' ? 'পছন্দের' : 'বিশ্বস্ত'} সদস্যের তালিকা আপডেট হয়েছে।`);
    } catch (cause) { setError(errorText(cause, 'সদস্যের লেবেল আপডেট করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const permanentlyDeleteHostel = async () => {
    if (!selected) return;
    const deleteMemberAccounts = window.confirm('এই মেসের সকল সদস্যের লগইন অ্যাকাউন্টও স্থায়ীভাবে মুছতে চান? Cancel চাপলে শুধু মেস ও তার অধীন ডেটা মুছবে, Auth account থাকবে।');
    if (!window.confirm(`সতর্কতা: “${selected.name}” এবং এর সব meal, বাজার, হিসাব ও সদস্য-সম্পর্কিত ডেটা স্থায়ীভাবে মুছে যাবে। এই কাজ ফেরানো যাবে না। চালিয়ে যাবেন?`)) return;
    const confirmation = window.prompt(`নিশ্চিত করতে হুবহু লিখুন: DELETE HOSTEL ${selected.hostel_id}`);
    if (confirmation !== `DELETE HOSTEL ${selected.hostel_id}`) { setNotice('নিশ্চিতকরণ মেলেনি; কোনো পরিবর্তন করা হয়নি।'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await platformAdminPermanentlyDeleteHostel(selected.hostel_id, deleteMemberAccounts, confirmation);
      setNotice(`মেস স্থায়ীভাবে মুছে ফেলা হয়েছে। ${Number(result?.member_accounts_deleted || 0)}টি Auth account মুছে ফেলা হয়েছে।`);
      setSelected(null); setMembers([]); setReason(''); await refresh();
    } catch (cause) { setError(errorText(cause, 'মেস স্থায়ীভাবে মুছে ফেলা যায়নি।')); }
    finally { setBusy(false); }
  };

  const permanentlyDeleteMember = async (member) => {
    if (!selected) return;
    if (!window.confirm(`${member.full_name || 'এই সদস্য'} এবং তার এই মেসের বাজার, মিল ও হিসাব-সম্পর্কিত ডেটা স্থায়ীভাবে মুছে ফেলবেন? এই কাজ ফেরানো যাবে না।`)) return;
    const deleteAuthAccount = window.confirm('সদস্যের লগইন/Auth অ্যাকাউন্টও মুছবেন? OK = অ্যাকাউন্টসহ, Cancel = শুধু সদস্য ও তার মেস-সম্পর্কিত ডেটা।');
    const confirmation = window.prompt(`নিশ্চিত করতে হুবহু লিখুন: DELETE MEMBER ${member.user_id}`);
    if (confirmation !== `DELETE MEMBER ${member.user_id}`) { setNotice('নিশ্চিতকরণ মেলেনি; কোনো পরিবর্তন করা হয়নি।'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminPermanentlyDeleteMember(selected.hostel_id, member.membership_id, deleteAuthAccount, confirmation);
      setNotice('সদস্য স্থায়ীভাবে মুছে ফেলা হয়েছে।');
      setMembers((old) => old.filter((row) => row.membership_id !== member.membership_id));
      await refresh();
    } catch (cause) { setError(errorText(cause, 'সদস্য স্থায়ীভাবে মুছে ফেলা যায়নি।')); }
    finally { setBusy(false); }
  };

  const handleDeveloperPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setDeveloperPhotoBusy(true); setError(''); setNotice('');
    try {
      const url = await uploadDeveloperPhoto(user?.id, file);
      setSettings((old) => ({ ...old, developer_photo_url: url }));
      setNotice('ছবি Supabase Storage-এ আপলোড হয়েছে। Developer Info-তে স্থায়ী করতে “সব সেটিংস সংরক্ষণ করুন” চাপুন।');
    } catch (cause) { setError(cause?.message || 'Developer-এর ছবি আপলোড করা যায়নি।'); }
    finally { setDeveloperPhotoBusy(false); }
  };

  const saveSettings = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminUpdatePublicSettings(settings);
      setNotice('সেটিংস সংরক্ষিত হয়েছে। অন্য ব্যবহারকারীদের public settings cache সর্বোচ্চ ৫ মিনিটের মধ্যে আপডেট হবে।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'সেটিংস সংরক্ষণ করা যায়নি।')); }
    finally { setBusy(false); }
  };
  const changeGate = async (purpose, required) => {
    setBusy(true); setError(''); setNotice(''); setGenerated(null);
    try {
      await platformAdminSetGate(purpose, required);
      const key = purpose === 'registration' ? 'registration_code_required' : 'hostel_creation_code_required';
      setSettings((old) => ({ ...old, [key]: required }));
      setNotice(`${purpose === 'registration' ? 'রেজিস্ট্রেশন' : 'মেস তৈরির'} কোড যাচাই ${required ? 'চালু' : 'বন্ধ'} হয়েছে।`);
    } catch (cause) { setError(errorText(cause, 'Security gate বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const generateCode = async (purpose) => {
    setBusy(true); setError(''); setNotice(''); setGenerated(null);
    try {
      setGenerated(await platformAdminGenerateAccessCode(purpose, Number(ttl), Number(maxUses)));
      setNotice('নতুন কোড তৈরি হয়েছে। এটি এখন একবারই দেখানো হবে—নিরাপদ স্থানে কপি করুন।');
    } catch (cause) { setError(errorText(cause, 'নতুন কোড তৈরি করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (checking) return <main className="platform-page"><LoadingSpinner label="Super Admin role যাচাই হচ্ছে..."/></main>;
  if (!allowed) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="shield" size={30}/></span><h1>পৃষ্ঠাটি খোলা যাচ্ছে না</h1><p>অনুরোধটি সম্পন্ন করা যায়নি।</p><button className="primary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরে যান</button></section></main>;
  if (!reauthenticated) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="lock" size={28}/></span><span className="eyebrow">অতিরিক্ত নিরাপত্তা</span><h1>Super Admin যাচাইকরণ</h1><p>প্যানেল খোলার আগে আপনার মূল অ্যাকাউন্টের পাসওয়ার্ড পুনরায় যাচাই হবে।</p><form className="form-stack" onSubmit={reauthenticate}><label className="field-label"><span>অ্যাকাউন্ট ইমেইল</span><input type="email" value={user?.email || ''} readOnly /></label><label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{gateError && <div className="inline-error">{gateError}</div>}<button className="primary-button large" type="submit" disabled={reauthBusy}>{reauthBusy ? 'যাচাই হচ্ছে...' : 'যাচাই করে প্রবেশ করুন'}</button><button type="button" className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>বাতিল</button></form></section></main>;

  return <main className="platform-page">
    <header className="platform-header"><div className="platform-brand"><span className="platform-brand-mark"><Icon name="shield" size={24}/></span><div><small>HOSTEL LIFE · PLATFORM CONTROL</small><h1>Super Admin</h1></div></div><div className="platform-header-actions"><span className="platform-auth-user">{user?.email}</span><button className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরুন</button></div></header>
    <div className="platform-intro"><div><span className="eyebrow">সিস্টেম ব্যবস্থাপনা</span><h2>মেস, নিরাপত্তা ও পাবলিক সেটিংস</h2><p>এই প্যানেলে মিলের রেকর্ড, লেনদেন বা আর্থিক তথ্য দেখানো হয় না।</p></div><button className="secondary-button" onClick={refresh} disabled={busy}><Icon name="refresh" size={16}/> রিফ্রেশ</button></div>
    {error && <div className="inline-error platform-alert"><Icon name="warning" size={17}/><span>{error}</span></div>}{notice && <div className="inline-success platform-alert"><Icon name="check-circle" size={17}/><span>{notice}</span></div>}
    <nav className="platform-tabs">{[['overview','ওভারভিউ'],['hostels','মেস ও সদস্য'],['settings','নোটিশ ও Developer Info'],['security','Security Codes'],['retention','ডেটা সংরক্ষণ']].map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <section className="platform-stats-grid"><Stat label="মোট মেস" value={metrics.hostels} icon="home"/><Stat label="মোট অ্যাকাউন্ট" value={metrics.users} icon="users"/><Stat label="সক্রিয় মেম্বারশিপ" value={metrics.activeMemberships} icon="user-plus"/><Stat label="স্থগিত মেস" value={metrics.suspendedHostels} icon="lock"/><Stat label="আগে বন্ধ করা মেস" value={metrics.softDeletedHostels} icon="file"/><Stat label="ব্লক করা ব্যবহারকারী" value={metrics.blockedUsers} icon="shield"/><div className="card platform-privacy-note"><Icon name="shield" size={22}/><div><strong>Privacy boundary</strong><p>মেস-মেম্বার API শুধু পরিচয় ও স্ট্যাটাস ফেরত দেয়; finance এবং meal data query করা হয় না।</p></div></div></section>}
    {tab === 'hostels' && <section className="platform-two-col platform-admin-workspace">
      <div className="card platform-panel">
        <div className="platform-panel-heading"><div><h3>মেস ডিরেক্টরি</h3><p>{filteredHostels.length} / {hostels.length}টি মেস · আর্থিক/মিলের তথ্য দেখানো হয় না</p></div></div>
        <Field label="মেস খুঁজুন (নাম বা ID)" value={hostelQuery} onChange={setHostelQuery} maxLength={120}/>
        <div className="platform-filter-pills" role="group" aria-label="মেস ফিল্টার">
          {[['all','সব'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত'],['suspended','স্থগিত']].map(([key,label])=><button type="button" key={key} className={hostelFilter===key?'active':''} onClick={()=>setHostelFilter(key)}>{label}</button>)}
        </div>
        {filteredHostels.length===0?<p className="platform-empty">এই ফিল্টারে কোনো মেস পাওয়া যায়নি।</p>:<div className="platform-hostel-list">{visibleHostels.map((hostel)=><div className={`platform-hostel-entry ${selected?.hostel_id===hostel.hostel_id?'selected':''}`} key={hostel.hostel_id}>
          <button className={`platform-hostel-row ${selected?.hostel_id===hostel.hostel_id?'selected':''}`} type="button" onClick={()=>openHostel(hostel)}>
            <span className="platform-hostel-icon"><Icon name="home" size={19}/></span><span className="platform-hostel-copy"><strong>{hostel.name}</strong><small>{hostel.member_count} জন সক্রিয় সদস্য · {hostel.created_at?new Date(hostel.created_at).toLocaleDateString():'—'}</small><small className="platform-hostel-id">{hostel.hostel_id}</small></span><span className={`platform-status status-${hostel.platform_status||'active'}`}>{hostel.platform_status==='soft_deleted'?'বন্ধ':hostel.platform_status==='suspended'?'স্থগিত':'সক্রিয়'}</span>
          </button>
          <div className="platform-quick-flags"><button type="button" title="পছন্দের মেস" aria-pressed={Boolean(hostel.is_favorite)} className={hostel.is_favorite?'flag-active':''} disabled={busy} onClick={()=>toggleHostelFlag(hostel,'favorite')}>⭐</button><button type="button" title="বিশ্বস্ত মেস" aria-pressed={Boolean(hostel.is_trusted)} className={hostel.is_trusted?'flag-active':''} disabled={busy} onClick={()=>toggleHostelFlag(hostel,'trusted')}>✓</button></div>
        </div>)}</div>}
        {filteredHostels.length > pageSize && <div className="platform-pagination"><button className="secondary-button compact" type="button" disabled={hostelPage === 1} onClick={() => setHostelPage(page => page - 1)}>আগের</button><span>{hostelPage} / {Math.ceil(filteredHostels.length / pageSize)}</span><button className="secondary-button compact" type="button" disabled={hostelPage * pageSize >= filteredHostels.length} onClick={() => setHostelPage(page => page + 1)}>পরের</button></div>}
      </div>
      <div className="card platform-panel">
        {selected?<>
          <div className="platform-panel-heading"><div><span className="eyebrow">মেস কন্ট্রোল</span><h3>{selected.name}</h3><p>মেস ID: <code>{selected.hostel_id}</code></p></div><button className="text-button" type="button" onClick={()=>{setSelected(null);setMembers([]);}}>বন্ধ করুন</button></div>
          <div className="platform-flag-actions"><button type="button" className={selected.is_favorite?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'favorite')}>⭐ {selected.is_favorite?'পছন্দে আছে':'পছন্দে রাখুন'}</button><button type="button" className={selected.is_trusted?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'trusted')}>✓ {selected.is_trusted?'বিশ্বস্ত চিহ্নিত':'বিশ্বস্ত হিসেবে চিহ্নিত'}</button></div>
          <Field label="অ্যাকশন নোট / কারণ (ঐচ্ছিক)" value={reason} onChange={setReason} maxLength={300}/>
          <div className="platform-action-row"><button className="secondary-button" disabled={busy||selectedStatus==='active'} type="button" onClick={()=>changeHostelStatus('active')}>চালু করুন</button><button className="secondary-button" disabled={busy||selectedStatus==='suspended'} type="button" onClick={()=>changeHostelStatus('suspended')}>স্থগিত করুন</button></div>
          <div className="platform-permanent-delete"><strong><Icon name="trash" size={16}/> স্থায়ীভাবে মুছে ফেলুন</strong><p>মেসের meal, বাজার, হিসাব, সদস্য ও সংশ্লিষ্ট ডেটা স্থায়ীভাবে মুছে যাবে। এটি ফেরানো যাবে না।</p><button className="danger-button" disabled={busy} type="button" onClick={permanentlyDeleteHostel}>{busy?'অপেক্ষা করুন...':'Super Delete · মেস ও সব ডেটা'}</button></div>
          <div className="platform-panel-heading platform-members-heading"><div><h3>সদস্য তালিকা</h3><p>শুধু পরিচয় ও স্ট্যাটাস · কোনো আর্থিক/মিলের রেকর্ড নয়</p></div></div>
          <Field label="সদস্য খুঁজুন (নাম, ফোন বা ID)" value={memberQuery} onChange={setMemberQuery} maxLength={120}/>
          <div className="platform-filter-pills" role="group" aria-label="সদস্য ফিল্টার">{[['all','সব'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত'],['blocked','ব্লক']].map(([key,label])=><button type="button" key={key} className={memberFilter===key?'active':''} onClick={()=>setMemberFilter(key)}>{label}</button>)}</div>
          {busy?<LoadingSpinner label="তথ্য আপডেট হচ্ছে..."/>:sortedMembers.length===0?<p className="platform-empty">এই ফিল্টারে কোনো সদস্য নেই।</p>:<div className="platform-members-list">{visibleMembers.map((member)=><div className="platform-member-row" key={member.membership_id}>
            <div className="platform-avatar">{member.avatar_url ? <img src={member.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : String(member.full_name||'স').slice(0,1)}</div><div className="platform-member-copy"><strong>{member.full_name||'নাম নেই'}</strong><small>{member.phone||'ফোন নেই'} · যোগদান {member.joined_at?new Date(member.joined_at).toLocaleDateString():'—'}</small>{member.email && <small className="platform-member-email">{member.email}</small>}<small className="platform-hostel-id">{member.user_id}</small><div className="platform-member-flags">{member.is_favorite&&<span>⭐ পছন্দের</span>}{member.is_trusted&&<span>✓ বিশ্বস্ত</span>}{member.is_blocked&&<span className="blocked-flag">ব্লক করা</span>}</div></div>
            <div className="platform-member-actions"><span className={`platform-status ${member.status==='active'?'status-active':'status-inactive'}`}>{member.status==='active'?'সক্রিয়':'নিষ্ক্রিয়'}</span><div className="platform-member-action-buttons"><button className={member.is_favorite?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="পছন্দের চিহ্ন" onClick={()=>toggleMemberFlag(member,'favorite')}>⭐</button><button className={member.is_trusted?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="বিশ্বস্ত চিহ্ন" onClick={()=>toggleMemberFlag(member,'trusted')}>✓</button><button className={member.is_blocked?'secondary-button':'danger-button'} disabled={busy||member.user_id===user?.id} type="button" onClick={()=>toggleBlock(member)}>{member.is_blocked?'আনব্লক':'ব্লক'}</button><button className="secondary-button compact" disabled={busy||recoveryBusy||member.user_id===user?.id} type="button" onClick={()=>{setRecoveryTarget(member);setRecoveryResult('');setRecoveryNote('');setRecoveryVerified(false);}}>পাসওয়ার্ড সহায়তা</button><button className="danger-button" disabled={busy||member.user_id===user?.id} type="button" onClick={()=>permanentlyDeleteMember(member)}>স্থায়ী ডিলিট</button></div></div>
          </div>)}</div>}
          {sortedMembers.length > pageSize && <div className="platform-pagination"><button className="secondary-button compact" type="button" disabled={memberPage === 1} onClick={() => setMemberPage(page => page - 1)}>আগের</button><span>{memberPage} / {Math.ceil(sortedMembers.length / pageSize)}</span><button className="secondary-button compact" type="button" disabled={memberPage * pageSize >= sortedMembers.length} onClick={() => setMemberPage(page => page + 1)}>পরের</button></div>}
        </>:<div className="platform-empty-state"><Icon name="users" size={28}/><strong>একটি মেস নির্বাচন করুন</strong><span>মেসের পরিচয় ও সদস্য-ব্যবস্থাপনা এখান থেকে করা যাবে।</span></div>}
      </div>
    </section>}

    {tab === 'hostels' && recoveryTarget && <section className="card platform-recovery-panel" role="region" aria-label="ম্যানুয়াল পাসওয়ার্ড সহায়তা">
      <h3>অস্থায়ী পাসওয়ার্ড — {recoveryTarget.full_name || 'সদস্য'}</h3>
      <p>ব্যবহারকারীর সঙ্গে সরাসরি কথা বলে পরিচয় যাচাই করুন। এই কাজের জন্য Supabase-এর নিরাপদ Edge Function Deploy করতে হবে। পুরোনো পাসওয়ার্ড দেখা সম্ভব নয়।</p>
      <label className="field-label"><span>যাচাইয়ের সংক্ষিপ্ত কারণ (পাসওয়ার্ড বা গোপন তথ্য লিখবেন না)</span><textarea rows={2} maxLength={300} value={recoveryNote} onChange={e=>setRecoveryNote(e.target.value)}/></label>
      <label className="platform-toggle"><span>আমি ব্যক্তিগতভাবে পরিচয় যাচাই করেছি</span><input type="checkbox" checked={recoveryVerified} onChange={e=>setRecoveryVerified(e.target.checked)}/></label>
      <div className="platform-action-row"><button type="button" className="primary-button" disabled={recoveryBusy||!recoveryVerified||recoveryNote.trim().length<5||Boolean(recoveryResult)} onClick={issueTemporaryPassword}>{recoveryBusy?'তৈরি হচ্ছে...':'অস্থায়ী পাসওয়ার্ড তৈরি'}</button><button type="button" className="secondary-button" onClick={()=>{setRecoveryTarget(null);setRecoveryResult('');setRecoveryNote('');}}>বন্ধ করুন</button></div>
      {recoveryResult && <div className="platform-generated-code"><strong>একবার দেখানো অস্থায়ী পাসওয়ার্ড</strong><code>{recoveryResult}</code><p>এটি নিরাপদ মাধ্যমে শুধু সংশ্লিষ্ট ব্যবহারকারীকে দিন। এখানে বা নোটিফিকেশনে সংরক্ষণ করবেন না। ব্যবহারকারী লগইন করলে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।</p><button type="button" className="secondary-button" onClick={()=>setRecoveryResult('')}>পাসওয়ার্ড স্ক্রিন থেকে সরান</button></div>}
    </section>}
    {tab === 'settings' && <form className="platform-settings-grid" onSubmit={saveSettings}>
      <section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Global announcement</h3><p>ড্যাশবোর্ডের ওপরে সবার জন্য ব্যানার নোটিশ</p></div></div><label className="platform-toggle"><span><strong>নোটিশ চালু</strong><small>চালু থাকলে অ্যাপের ব্যবহারকারীরা ব্যানার দেখবেন</small></span><input type="checkbox" checked={Boolean(settings.announcement_enabled)} onChange={(e)=>setSettings((old)=>({...old,announcement_enabled:e.target.checked}))}/></label><Field label="নোটিশ শিরোনাম" value={settings.announcement_title} onChange={(v)=>setSettings((old)=>({...old,announcement_title:v}))} maxLength={160}/><Field label="নোটিশের বিবরণ" value={settings.announcement_body} onChange={(v)=>setSettings((old)=>({...old,announcement_body:v}))} maxLength={3000} multiline/></section>
      <section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Developer Info</h3><p>তথ্য ও ছবি Supabase-এ সংরক্ষণ হবে</p></div></div><Field label="নাম" value={settings.developer_name} onChange={(v)=>setSettings((old)=>({...old,developer_name:v}))} maxLength={160}/><Field label="পরিচয় / পদবি" value={settings.developer_title} onChange={(v)=>setSettings((old)=>({...old,developer_title:v}))} maxLength={240}/>
        <div className="developer-photo-uploader"><div className="developer-photo-preview">{settings.developer_photo_url?<img src={settings.developer_photo_url} alt="Developer preview"/>:<span><Icon name="camera" size={24}/></span>}</div><div className="developer-photo-copy"><strong>Developer-এর ছবি</strong><small>JPG / PNG / WEBP · সর্বোচ্চ ৫ MB। আপলোড করলে Supabase Storage-এ ফাইল থাকবে।</small><input ref={developerPhotoInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handleDeveloperPhoto}/><button type="button" className="secondary-button compact" disabled={developerPhotoBusy||busy} onClick={()=>developerPhotoInputRef.current?.click()}><Icon name="camera" size={15}/>{developerPhotoBusy?'আপলোড হচ্ছে...':'ছবি আপলোড করুন'}</button></div></div>
        <Field label="ছবির Storage URL" value={settings.developer_photo_url} onChange={(v)=>setSettings((old)=>({...old,developer_photo_url:v}))} maxLength={1000}/><Field label="ইমেইল" type="email" value={settings.developer_email} onChange={(v)=>setSettings((old)=>({...old,developer_email:v}))} maxLength={240}/><Field label="ফোন" value={settings.developer_phone} onChange={(v)=>setSettings((old)=>({...old,developer_phone:v}))} maxLength={80}/><Field label="Portfolio URL" value={settings.developer_portfolio_url} onChange={(v)=>setSettings((old)=>({...old,developer_portfolio_url:v}))} maxLength={1000}/></section>
      <div className="platform-settings-footer"><button className="primary-button large" type="submit" disabled={busy||developerPhotoBusy}>{busy?'সংরক্ষণ হচ্ছে...':'সব সেটিংস সংরক্ষণ করুন'}</button></div>
    </form>}
    {tab === 'retention' && <section className="platform-settings-grid" aria-label="ডেটা সংরক্ষণ নীতি">
      <div className="card platform-panel">
        <div className="platform-panel-heading"><div><h3>ডেটা সংরক্ষণ নীতি</h3><p>সব মেসের জন্য একই নীতি। এই পৃষ্ঠা নিজে কোনো আর্কাইভ স্বয়ংক্রিয়ভাবে মুছে দেয় না।</p></div><button type="button" className="secondary-button compact" disabled={retentionLoading} onClick={loadRetention}>তালিকা রিফ্রেশ</button></div>
        {retentionError && <div className="inline-error" role="alert">{retentionError}</div>}
        {retentionLoading && <LoadingSpinner label="সংরক্ষণ নীতি লোড হচ্ছে..."/>}
        {retention && <form className="form-stack" onSubmit={saveRetention}>
          <Field label="বিস্তারিত ইতিহাস (মাস, ১–২৪)" type="number" value={retentionDraft.detail} onChange={(value) => setRetentionDraft(old => ({...old,detail:value}))}/>
          <Field label="এর পর সামারি (মাস, ০–৬০)" type="number" value={retentionDraft.summary} onChange={(value) => setRetentionDraft(old => ({...old,summary:value}))}/>
          <p className="platform-retention-hint">পরিবর্তনের পর ব্যবহারকারীদের নোটিফিকেশন দেওয়া এবং মেয়াদোত্তীর্ণ আর্কাইভ নির্ধারণ করা সার্ভারের দায়িত্ব।</p>
          <button type="submit" className="primary-button" disabled={retentionLoading}>নীতি সংরক্ষণ করুন</button>
        </form>}
      </div>
      <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>সংরক্ষিত চূড়ান্ত সামারি</h3><p>ডিলিটের আগে সামারি সংরক্ষণ ও তুলনা করতে হবে। মেয়াদ পার হলেও কোনো মাস স্বয়ংক্রিয়ভাবে মুছবে না।</p></div></div>
        {savedSummaries.length === 0 ? <p className="platform-empty">এখনো কোনো চূড়ান্ত সামারি নেই, অথবা তালিকা লোড করা যায়নি।</p> : <div className="platform-retention-list">{savedSummaries.map(row => <div className="platform-retention-row" key={`${row.hostel_id}-${row.period_id}`}><div><strong>{row.hostel_name ? `${row.hostel_name} · ` : ''}{row.period_label || row.period_id}</strong><small>{row.purged_at ? 'বিস্তারিত মুছে ফেলা হয়েছে; সামারি সংরক্ষিত' : 'বিস্তারিত এখনো রয়েছে'} · {row.end_date || ''} · {row.verified_at ? 'যাচাইকৃত' : 'যাচাই বাকি'}</small></div></div>)}</div>}
      </div>
      <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>মেয়াদোত্তীর্ণ আর্কাইভ ({expiredArchives.length})</h3><p>সংরক্ষণ নীতির বিস্তারিত ও সামারি—দুই মেয়াদ শেষ হওয়ার পর মাস এখানে আসবে। সার্ভার যাচাই, সামারি সংরক্ষণ ও ম্যানুয়াল যাচাই ছাড়া কোনো মাস স্থায়ীভাবে মোছা যাবে না।</p></div><button type="button" className="secondary-button compact" disabled={retentionLoading} onClick={loadRetention}>তালিকা রিফ্রেশ</button></div>
        {!expiredArchivesLoaded && !retentionLoading ? <p className="platform-empty">মেয়াদোত্তীর্ণ আর্কাইভের সার্ভার তালিকা লোড হয়নি। উপরের রিফ্রেশ ব্যবহার করে আবার চেষ্টা করুন।</p> :
          expiredArchivesLoaded && expiredArchives.length === 0 ? <p className="platform-empty">অপসারণের অপেক্ষায় কোনো আর্কাইভ নেই।</p> :
          <div className="platform-retention-list">{expiredArchives.map(entry => <div className="platform-retention-row" key={`${entry.hostel_id}-${entry.period_id}`}><div><strong>{entry.hostel_name || 'মেস'} · {entry.period_label || 'মাস'}</strong><small>মেয়াদ শেষ: {entry.expired_at || 'সার্ভার যাচাইকৃত'}</small></div><div className="platform-archive-actions"><button className="secondary-button compact" type="button" disabled={retentionLoading} onClick={() => prepareArchiveSummary(entry)}>সামারি সংরক্ষণ</button><button className="secondary-button compact" type="button" disabled={retentionLoading || !savedSummaries.some(row => row.period_id === entry.period_id && !row.purged_at) || savedSummaries.some(row => row.period_id === entry.period_id && Boolean(row.verified_at))} onClick={() => verifyArchiveSummary(entry)}>{savedSummaries.some(row => row.period_id === entry.period_id && row.verified_at) ? 'সামারি যাচাইকৃত' : 'সামারি যাচাই'}</button><button className="danger-button" type="button" disabled={retentionLoading || !savedSummaries.some(row => row.period_id === entry.period_id && !row.purged_at && row.verified_at)} onClick={() => deleteExpiredArchive(entry)}>স্থায়ীভাবে মুছুন</button></div></div>)}</div>}
      </div>
    </section>}
    {tab === 'security' && <section className="platform-settings-grid"><div className="card platform-panel"><div className="platform-panel-heading"><div><h3>Permission code controls</h3><p>নতুন কোড তৈরি হলে আগের কোড একই purpose-এ সঙ্গে সঙ্গে বাতিল হবে।</p></div></div><label className="platform-toggle"><span><strong>নতুন অ্যাকাউন্টে কোড বাধ্যতামূলক</strong><small>Registration page-এ কোড চাইবে</small></span><input type="checkbox" checked={Boolean(settings.registration_code_required)} disabled={busy} onChange={(e)=>changeGate('registration',e.target.checked)}/></label><label className="platform-toggle"><span><strong>মেস তৈরিতে কোড বাধ্যতামূলক</strong><small>নতুন মেস তৈরির আগে কোড যাচাই হবে</small></span><input type="checkbox" checked={Boolean(settings.hostel_creation_code_required)} disabled={busy} onChange={(e)=>changeGate('hostel_creation',e.target.checked)}/></label><Field label="কোডের মেয়াদ (মিনিট, ৫–১০০৮০)" type="number" value={ttl} onChange={setTtl}/><Field label="সর্বোচ্চ ব্যবহার (১–১০০০)" type="number" value={maxUses} onChange={setMaxUses}/><div className="platform-code-buttons"><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('registration')}>Registration code তৈরি</button><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('hostel_creation')}>Hostel creation code তৈরি</button></div>{generated&&<div className="platform-generated-code"><small>{generated.purpose==='registration'?'Registration':'Hostel creation'} · মেয়াদ {new Date(generated.expires_at).toLocaleString()}</small><code>{generated.code}</code><button className="primary-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(generated.code);setNotice('কোড কপি হয়েছে।');}catch{setNotice('কপি করা যায়নি—কোডটি হাতে কপি করুন।');}}}>কোড কপি করুন</button><p>এটি এখন একবারই দেখানো হয়েছে। নিরাপদ স্থানে রাখুন এবং সাধারণ নোটিশে প্রকাশ করবেন না।</p></div>}</div><div className="card platform-panel"><div className="platform-panel-heading"><div><h3>Security rules</h3><p>Role ও অ্যাক্সেস কোড</p></div></div><ul className="platform-security-list"><li>সাধারণ সাইন-আপের role সবসময় <code>user</code> হবে।</li><li>Super Admin role শুধু project owner Supabase SQL Editor থেকে সেট করবেন।</li><li>প্রতিটি admin RPC ডাটাবেজেই Super Admin role যাচাই করে।</li><li>এই প্যানেল কোনো আর্থিক বা meal data query করে না।</li></ul></div></section>}
    <footer className="platform-footer">Hostel Life · Platform administration · Access is enforced by database functions.</footer>
  </main>;
}
