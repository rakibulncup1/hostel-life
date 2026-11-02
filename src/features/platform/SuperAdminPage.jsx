import { confirmAction, confirmTypedAction } from '../../utils/actionDialogs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { supabase } from '../../lib/supabase';
import { normalizePlatformOverview } from '../../utils/platformOverview';
import { buildPlatformReportCsv, getPlatformReportFilename } from '../../utils/platformReportCsv';
import {
  fetchPlatformPublicSettings, platformAdminGenerateAccessCode, platformAdminGetOverview,
  platformAdminListHostelMembers, platformAdminListHostelRoleBadges, platformAdminListHostels, platformAdminSetGate,
  platformAdminSetHostelStatus, platformAdminSetUserBlocked, platformAdminUpdatePublicSettings,
  platformAdminSetHostelFlag, platformAdminSetUserFlag, platformAdminPermanentlyDeleteHostel,
  platformAdminPermanentlyDeleteMember, uploadDeveloperPhoto,
  platformAdminListClosedPeriods, platformAdminGetRetention, platformAdminUpdateRetention,
  platformAdminListExpiredArchives, platformAdminDeleteExpiredArchive,
  platformAdminFinalizeArchiveSummary, platformAdminVerifyArchiveSummary, platformAdminListSavedSummaries,
  platformAdminListAuditLogs, platformAdminListAccessCodeHistory, platformAdminGetHostelInsights,
  platformAdminGetSystemHealth, platformAdminListNoticeMonitoring, platformAdminGetPlatformReport,
} from '../../services/platformService';

const EMPTY_SETTINGS = {
  announcement_enabled: false, announcement_title: '', announcement_body: '',
  registration_code_required: false, hostel_creation_code_required: false,
  developer_name: '', developer_title: '', developer_photo_url: '', developer_email: '',
  developer_phone: '', developer_portfolio_url: '',
};
const errorText = (error, fallback) => /platform_admin_|get_platform_public_settings|function .* does not exist|schema cache/i.test(String(error?.message || ''))
  ? 'Super Admin SQL এখনো প্রয়োগ করা হয়নি। প্রথমে প্রয়োজনীয় Super Admin SQL Migration চালিয়ে schema reload হওয়া পর্যন্ত অপেক্ষা করুন।'
  : (error?.message || fallback);

async function edgeInvokeErrorText(error) {
  let payload = null;
  let raw = '';
  const context = error?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const response = context.clone();
      raw = await response.text();
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    } catch { /* Fall back to the SDK error text. */ }
  }
  const detail = payload?.message || payload?.error_description || payload?.error || payload?.details || '';
  const status = context?.status;
  const requestId = payload?.request_id;
  const base = detail || error?.message || raw || 'Edge Function অনুরোধ ব্যর্থ হয়েছে।';
  return `${base}${status ? ` (HTTP ${status})` : ''}${requestId ? ` · Request ID: ${requestId}` : ''}`;
}

function Field({ label, value, onChange, type = 'text', maxLength, multiline = false }) {
  return <label className="field-label platform-field"><span>{label}</span>{multiline
    ? <textarea rows={4} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    : <input type={type} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}</label>;
}
function Stat({ label, value, icon }) {
  return <div className="platform-stat"><span className="platform-stat-icon"><Icon name={icon} size={19}/></span><div><small>{label}</small><strong>{value === undefined || value === null || value === '' ? '—' : Number(value).toLocaleString('en-US')}</strong></div></div>;
}
function InsightStat({ label, value, icon, format = 'number', hint = '' }) {
  let display = '—';
  if (value !== null && value !== undefined && value !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (format === 'currency') display = `৳${numeric.toLocaleString('bn-BD', { maximumFractionDigits: 2 })}`;
      else if (format === 'percent') display = `${numeric.toLocaleString('bn-BD', { maximumFractionDigits: 1 })}%`;
      else display = numeric.toLocaleString('bn-BD', { maximumFractionDigits: 2 });
    }
  }
  return <article className="platform-insight-stat"><span className="platform-insight-stat-icon"><Icon name={icon} size={19}/></span><div className="platform-insight-stat-copy"><small>{label}</small><strong>{display}</strong>{hint && <span>{hint}</span>}</div></article>;
}
function periodStatusLabel(status) {
  return ({ running: 'চলমান', closed: 'বন্ধ', archived: 'আর্কাইভ', saved_summary: 'সংরক্ষিত সামারি' })[status] || 'অন্যান্য';
}

const AUDIT_ACTION_LABELS = {
  hostel_created: 'নতুন মেস তৈরি',
  hostel_status_changed: 'মেসের স্ট্যাটাস পরিবর্তন',
  user_blocked: 'অ্যাকাউন্ট ব্লক',
  user_unblocked: 'অ্যাকাউন্ট আনব্লক',
  public_settings_updated: 'পাবলিক সেটিংস পরিবর্তন',
  platform_gate_changed: 'Security Gate পরিবর্তন',
  access_code_generated: 'নতুন Access Code তৈরি',
  hostel_flag_changed: 'মেসের লেবেল পরিবর্তন',
  user_flag_changed: 'অ্যাকাউন্টের লেবেল পরিবর্তন',
  hostel_permanently_deleted: 'মেস স্থায়ীভাবে মুছে ফেলা',
  member_permanently_deleted: 'সদস্য স্থায়ীভাবে মুছে ফেলা',
  retention_policy_updated: 'ডেটা সংরক্ষণ নীতি পরিবর্তন',
  archive_summary_saved: 'আর্কাইভ সামারি সংরক্ষণ',
  archive_summary_verified: 'আর্কাইভ সামারি যাচাই',
  archive_period_purged: 'আর্কাইভের বিস্তারিত অপসারণ',
};
const AUDIT_TARGET_LABELS = {
  hostel: 'মেস', user: 'অ্যাকাউন্ট', member: 'সদস্য', access_code: 'Security Code',
  platform_settings: 'প্ল্যাটফর্ম সেটিংস', platform_retention_policy: 'সংরক্ষণ নীতি', monthly_periods: 'মাসের আর্কাইভ',
};
const AUDIT_DETAIL_LABELS = {
  purpose: 'কোডের ধরন', required: 'বাধ্যতামূলক', max_uses: 'ব্যবহারসীমা', expires_at: 'মেয়াদ', verified: 'যাচাইকৃত',
  member_accounts_deleted: 'মুছে ফেলা Auth অ্যাকাউন্ট', auth_account_deleted: 'Auth অ্যাকাউন্ট মুছে ফেলা',
  final_summary_preserved: 'সামারি সংরক্ষিত', flag: 'লেবেল', enabled: 'চালু', previous: 'আগের অবস্থা',
  detail_months: 'বিস্তারিত রাখার মাস', summary_months: 'সামারি রাখার মাস', period_label: 'মাস',
  end_date: 'শেষ তারিখ', retention_expiry: 'সংরক্ষণ মেয়াদ',
};
function formatPlatformDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });
}
function auditActionLabel(action) { return AUDIT_ACTION_LABELS[action] || String(action || 'অন্যান্য কার্যক্রম').replaceAll('_', ' '); }
function auditTargetLabel(target) { return AUDIT_TARGET_LABELS[target] || target || 'অনির্দিষ্ট'; }
function codePurposeLabel(purpose) { return purpose === 'registration' ? 'Registration' : purpose === 'hostel_creation' ? 'মেস তৈরি' : 'অনির্দিষ্ট'; }
function codeStatusLabel(status) {
  return ({ available: 'মেয়াদ ও ব্যবহারসীমা আছে', expired: 'মেয়াদ শেষ', revoked: 'বাতিল', exhausted: 'ব্যবহারসীমা শেষ' })[status] || 'অজানা';
}
function dhakaDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
function systemIssueLabel(code) {
  return ({
    hostel_suspended: 'মেস স্থগিত',
    missing_running_period: 'চলমান মাস নেই',
    no_active_members: 'সক্রিয় সদস্য নেই',
    primary_manager_unavailable: 'প্রধান ম্যানেজার অনুপস্থিত/নিষ্ক্রিয়',
    stale_activity: 'দীর্ঘদিন কার্যক্রম নেই',
    pending_request_backlog: 'অনেক মিল অনুরোধ অপেক্ষমাণ',
  })[code] || String(code || 'অন্যান্য সমস্যা').replaceAll('_', ' ');
}
function systemSeverityLabel(value) {
  return ({ critical: 'জরুরি', warning: 'পর্যালোচনা দরকার', info: 'তথ্য', healthy: 'স্বাভাবিক' })[value] || 'অন্যান্য';
}
function formatReportCurrency(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `৳${numeric.toLocaleString('bn-BD', { maximumFractionDigits: 2 })}` : '—';
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
  const [memberListLoadedHostelId, setMemberListLoadedHostelId] = useState('');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState('1440');
  const [maxUses, setMaxUses] = useState('1');
  const [generated, setGenerated] = useState(null);
  const [hostelQuery, setHostelQuery] = useState('');
  const [hostelFilter, setHostelFilter] = useState('all');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');
  const [memberRoles, setMemberRoles] = useState({});
  const [developerPhotoBusy, setDeveloperPhotoBusy] = useState(false);
  const developerPhotoInputRef = useRef(null);
  const [retention, setRetention] = useState(null);
  const [retentionDraft, setRetentionDraft] = useState({ detail: '2', summary: '6' });
  const [expiredArchives, setExpiredArchives] = useState([]);
  const [expiredArchivesLoaded, setExpiredArchivesLoaded] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState([]);
  const [closedPeriods, setClosedPeriods] = useState([]);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionError, setRetentionError] = useState('');
  const [hostelPage, setHostelPage] = useState(1);
  const [memberPage, setMemberPage] = useState(1);
  const [recoveryTarget, setRecoveryTarget] = useState(null);
  const [recoveryNote, setRecoveryNote] = useState('');
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCheckBusy, setRecoveryCheckBusy] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteAccounts, setDeleteAccounts] = useState(false);
  const [orphanAccounts, setOrphanAccounts] = useState([]);
  const [orphanPage, setOrphanPage] = useState(1);
  const [orphanMore, setOrphanMore] = useState(false);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [orphanError, setOrphanError] = useState('');
  const [orphanScanInfo, setOrphanScanInfo] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditTargetFilter, setAuditTargetFilter] = useState('all');
  const [auditSearchDraft, setAuditSearchDraft] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [codeHistoryRows, setCodeHistoryRows] = useState([]);
  const [codeHistoryTotal, setCodeHistoryTotal] = useState(0);
  const [codeHistoryPage, setCodeHistoryPage] = useState(0);
  const [codeHistoryPurpose, setCodeHistoryPurpose] = useState('all');
  const [codeHistoryLoading, setCodeHistoryLoading] = useState(false);
  const [codeHistoryError, setCodeHistoryError] = useState('');
  const [codeHistoryReload, setCodeHistoryReload] = useState(0);
  const [insightsHostelId, setInsightsHostelId] = useState('');
  const [insightsPeriodId, setInsightsPeriodId] = useState('');
  const [insightsData, setInsightsData] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const insightsRequestRef = useRef(0);
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [healthStaleDays, setHealthStaleDays] = useState('14');
  const [noticeMonitorData, setNoticeMonitorData] = useState(null);
  const [noticeMonitorRows, setNoticeMonitorRows] = useState([]);
  const [noticeMonitorTotal, setNoticeMonitorTotal] = useState(0);
  const [noticeMonitorPage, setNoticeMonitorPage] = useState(0);
  const [noticeMonitorSearchDraft, setNoticeMonitorSearchDraft] = useState('');
  const [noticeMonitorSearch, setNoticeMonitorSearch] = useState('');
  const [noticeMonitorLoading, setNoticeMonitorLoading] = useState(false);
  const [noticeMonitorError, setNoticeMonitorError] = useState('');
  const [reportFromDate, setReportFromDate] = useState(() => `${dhakaDateValue().slice(0, 7)}-01`);
  const [reportToDate, setReportToDate] = useState(() => dhakaDateValue());
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

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
  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true); setAuditError('');
    try {
      const result = await platformAdminListAuditLogs({
        limit: pageSize, offset: auditPage * pageSize,
        action: auditActionFilter === 'all' ? null : auditActionFilter,
        targetType: auditTargetFilter === 'all' ? null : auditTargetFilter,
        search: auditSearch || null,
      });
      setAuditRows(Array.isArray(result?.items) ? result.items : []);
      setAuditTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setAuditRows([]); setAuditTotal(0);
      setAuditError(errorText(cause, 'Audit Log লোড করা যায়নি।'));
    } finally { setAuditLoading(false); }
  }, [auditPage, auditActionFilter, auditTargetFilter, auditSearch]);

  const loadCodeHistory = useCallback(async () => {
    setCodeHistoryLoading(true); setCodeHistoryError('');
    try {
      const result = await platformAdminListAccessCodeHistory({
        limit: pageSize, offset: codeHistoryPage * pageSize,
        purpose: codeHistoryPurpose === 'all' ? null : codeHistoryPurpose,
      });
      setCodeHistoryRows(Array.isArray(result?.items) ? result.items : []);
      setCodeHistoryTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setCodeHistoryRows([]); setCodeHistoryTotal(0);
      setCodeHistoryError(errorText(cause, 'Security Code History লোড করা যায়নি।'));
    } finally { setCodeHistoryLoading(false); }
  }, [codeHistoryPage, codeHistoryPurpose]);

  const loadSystemHealth = useCallback(async () => {
    setHealthLoading(true); setHealthError('');
    try {
      const result = await platformAdminGetSystemHealth(Number(healthStaleDays) || 14);
      setHealthData(result || null);
    } catch (cause) {
      setHealthData(null);
      setHealthError(errorText(cause, 'System Health লোড করা যায়নি।'));
    } finally { setHealthLoading(false); }
  }, [healthStaleDays]);

  const loadNoticeMonitoring = useCallback(async () => {
    setNoticeMonitorLoading(true); setNoticeMonitorError('');
    try {
      const result = await platformAdminListNoticeMonitoring({
        limit: pageSize, offset: noticeMonitorPage * pageSize, search: noticeMonitorSearch || null,
      });
      setNoticeMonitorData(result || null);
      setNoticeMonitorRows(Array.isArray(result?.items) ? result.items : []);
      setNoticeMonitorTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setNoticeMonitorData(null); setNoticeMonitorRows([]); setNoticeMonitorTotal(0);
      setNoticeMonitorError(errorText(cause, 'নোটিশের তালিকা লোড করা যায়নি।'));
    } finally { setNoticeMonitorLoading(false); }
  }, [noticeMonitorPage, noticeMonitorSearch]);

  const generatePlatformReport = useCallback(async () => {
    setReportLoading(true); setReportError(''); setReportData(null);
    try {
      const result = await platformAdminGetPlatformReport(reportFromDate, reportToDate);
      setReportData(result || null);
    } catch (cause) {
      setReportError(errorText(cause, 'প্ল্যাটফর্ম রিপোর্ট তৈরি করা যায়নি।'));
    } finally { setReportLoading(false); }
  }, [reportFromDate, reportToDate]);

  const downloadPlatformReport = useCallback(() => {
    if (!reportData) return;
    try {
      const csv = buildPlatformReportCsv(reportData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = getPlatformReportFilename(reportData.from_date, reportData.to_date);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Aggregate রিপোর্ট CSV ডাউনলোড শুরু হয়েছে।');
    } catch (cause) { setReportError(cause?.message || 'রিপোর্ট ডাউনলোড করা যায়নি।'); }
  }, [reportData]);

  const loadHostelInsights = useCallback(async (hostelId, periodId = null) => {
    if (!hostelId) return;
    const requestId = ++insightsRequestRef.current;
    setInsightsLoading(true); setInsightsError('');
    try {
      const result = await platformAdminGetHostelInsights(hostelId, periodId || null);
      if (requestId !== insightsRequestRef.current) return;
      setInsightsData(result || null);
      if (!periodId && result?.selected_period_id) {
        const nextPeriodId = String(result.selected_period_id);
        setInsightsPeriodId((current) => current === nextPeriodId ? current : nextPeriodId);
      }
    } catch (cause) {
      if (requestId === insightsRequestRef.current) {
        setInsightsData(null);
        setInsightsError(errorText(cause, 'মেসের সারসংক্ষেপ লোড করা যায়নি।'));
      }
    } finally {
      if (requestId === insightsRequestRef.current) setInsightsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hostels.length) return;
    const stillExists = hostels.some((hostel) => String(hostel.hostel_id) === String(insightsHostelId));
    if (!insightsHostelId || !stillExists) {
      const preferred = hostels.find((hostel) => hostel.platform_status === 'active') || hostels[0];
      setInsightsHostelId(String(preferred.hostel_id));
      setInsightsPeriodId('');
      setInsightsData(null);
    }
  }, [hostels, insightsHostelId]);

  useEffect(() => {
    if (tab === 'insights' && reauthenticated && insightsHostelId) {
      loadHostelInsights(insightsHostelId, insightsPeriodId || null);
    }
  }, [tab, reauthenticated, insightsHostelId, insightsPeriodId, loadHostelInsights]);

  useEffect(() => { if (tab === 'audit' && reauthenticated) loadAuditLog(); }, [tab, reauthenticated, loadAuditLog]);
  useEffect(() => { if (tab === 'security' && reauthenticated) loadCodeHistory(); }, [tab, reauthenticated, loadCodeHistory, codeHistoryReload]);
  useEffect(() => { if (tab === 'health' && reauthenticated) loadSystemHealth(); }, [tab, reauthenticated, loadSystemHealth]);
  useEffect(() => { if (tab === 'notices' && reauthenticated) loadNoticeMonitoring(); }, [tab, reauthenticated, loadNoticeMonitoring]);

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
      || (memberFilter === 'manager' && memberRoles[member.membership_id]?.primary)
      || (memberFilter === 'assistant' && memberRoles[member.membership_id]?.assistant)
      || (memberFilter === 'member' && memberRoles[member.membership_id] && !memberRoles[member.membership_id].primary && !memberRoles[member.membership_id].assistant)
      || (memberFilter === 'favorite' && member.is_favorite)
      || (memberFilter === 'trusted' && member.is_trusted)
      || (memberFilter === 'blocked' && member.is_blocked))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'bn')),
  [members, memberQuery, memberFilter, memberRoles]);
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
      platformAdminGetRetention(), platformAdminListExpiredArchives(), platformAdminListSavedSummaries(), platformAdminListClosedPeriods(),
    ]);
    const failures = [];
    const [policyResult, queueResult, savedResult, closedResult] = results;
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
    if (closedResult.status === 'fulfilled') setClosedPeriods(Array.isArray(closedResult.value) ? closedResult.value : []);
    else {setClosedPeriods([]);failures.push(`বন্ধ মাসের তালিকা: ${errorText(closedResult.reason,'লোড হয়নি')}`);}
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
    if (!await confirmAction(`সব মেসে ${detail} মাস বিস্তারিত ও পরবর্তী ${summary} মাস সামারি রাখবেন? এতে এখন কোনো ডেটা মুছবে না।`)) return;
    setRetentionLoading(true); setRetentionError('');
    try {
      await platformAdminUpdateRetention(detail, summary);
      await loadRetention(); setNotice('সংরক্ষণ নীতি হালনাগাদ হয়েছে। কোনো তথ্য স্বয়ংক্রিয়ভাবে মুছে যায়নি।');
    } catch (cause) { setRetentionError(errorText(cause, 'সংরক্ষণ নীতি হালনাগাদ করা যায়নি।')); }
    finally { setRetentionLoading(false); }
  };
  const prepareArchiveSummary = async (entry) => {
    if (!await confirmAction(`এই মাসের সারসংক্ষেপ সংরক্ষণ করবেন?\n${entry.period_label || entry.period_id}\nএতে মূল হিসাব মুছবে না।`)) return;
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
    const confirmation = await confirmTypedAction(`মূল হিসাবের সঙ্গে সংরক্ষিত সারসংক্ষেপ নিজে যাচাই করার পর নিচের বাক্যটি লিখুন:`, phrase);
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
    if (!await confirmAction(`“${title}” স্থায়ীভাবে মুছে দিতে চান? সংরক্ষিত সারসংক্ষেপ থেকে মূল লেনদেন ফেরানো যাবে না। ব্যাকআপ নিশ্চিত করুন।`)) return;
    const expected = `DELETE ${entry.period_id}`;
    const confirmation = await confirmTypedAction(`সার্ভার যাচাই এবং ম্যানুয়াল সামারি অনুমোদনের পরেই এটি সম্ভব।`, expected);
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
    setSelected(hostel); setMembers([]); setMemberListLoadedHostelId(''); setMemberRoles({}); setReason(''); setBusy(true); setError('');
    try {
      const list = await platformAdminListHostelMembers(hostel.hostel_id);
      if (!Array.isArray(list)) throw new Error('সদস্য তালিকার সঠিক ফলাফল পাওয়া যায়নি।');
      setMembers(list);
      setMemberListLoadedHostelId(hostel.hostel_id);
      try { setMemberRoles(await platformAdminListHostelRoleBadges(hostel.hostel_id)); }
      catch { setMemberRoles({}); setNotice('সদস্য তালিকা এসেছে, তবে ম্যানেজার পরিচয় পেতে নতুন SQL migration চালাতে হবে।'); }
    }
    catch (cause) { setError(errorText(cause, 'সদস্য তালিকা লোড করা যায়নি।')); }
    finally { setBusy(false); }
  };
  const changeHostelStatus = async (status) => {
    if (!selected) return;
    const label = status === 'suspended' ? 'স্থগিত' : 'চালু';
    if (!await confirmAction(`“${selected.name}” মেস ${label} করবেন? এই অ্যাকশন ডেটা মুছবে না। স্থায়ীভাবে মুছতে আলাদা Super Delete ব্যবহার করুন।`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetHostelStatus(selected.hostel_id, status, reason);
      setSelected((old) => ({ ...old, platform_status: status })); setNotice('মেসের স্ট্যাটাস আপডেট হয়েছে।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'মেসের স্ট্যাটাস বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const checkTemporaryPasswordFunction = async () => {
    setRecoveryCheckBusy(true); setError(''); setNotice('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-temporary-password', { body: { action: 'healthcheck' } });
      if (invokeError) throw new Error(await edgeInvokeErrorText(invokeError));
      if (!data?.ok) throw new Error(data?.message || data?.error || 'Function health-check সফল হয়নি।');
      setNotice(`Password-help Function ঠিকভাবে চলছে · সংস্করণ ${data.version || 'অজানা'} · Super Admin যাচাই সফল${data.request_id ? ` · Request ID: ${data.request_id}` : ''}`);
    } catch (cause) {
      setError(`${cause?.message || 'Password-help Function যাচাই ব্যর্থ হয়েছে।'} Supabase → Edge Functions → admin-temporary-password → Logs-এ একই সময়ের error দেখুন।`);
    } finally { setRecoveryCheckBusy(false); }
  };

  const issueTemporaryPassword = async () => {
    if (!recoveryTarget || !recoveryVerified || recoveryNote.trim().length < 5) {
      setError('ব্যবহারকারীর পরিচয় ম্যানুয়ালি যাচাই করে অন্তত ৫ অক্ষরের কারণ লিখুন।'); return;
    }
    if (!await confirmAction(`আপনি কি ${recoveryTarget.full_name || 'এই ব্যবহারকারী'}-এর পরিচয় যাচাই করেছেন? আগের পাসওয়ার্ড সঙ্গে সঙ্গে বাতিল হবে।`)) return;
    setRecoveryBusy(true); setError(''); setRecoveryResult('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-temporary-password', {
        body: { user_id: recoveryTarget.user_id, identity_verified: true, verification_note: recoveryNote.trim() },
      });
      if (invokeError) throw new Error(await edgeInvokeErrorText(invokeError));
      if (data?.error) throw new Error(data.error);
      if (!data?.temporary_password) throw new Error('সার্ভার থেকে অস্থায়ী পাসওয়ার্ড পাওয়া যায়নি।');
      setRecoveryResult(data.temporary_password);
      if (data.warning) setNotice('পাসওয়ার্ড পরিবর্তিত হয়েছে, তবে সার্ভারের Audit Log যাচাই করতে হবে।');
    } catch (cause) { setError(cause?.message || 'Password Recovery ব্যর্থ হয়েছে। Edge Function Deploy করা আছে কি না পরীক্ষা করুন।'); }
    finally { setRecoveryBusy(false); }
  };
  const toggleBlock = async (member) => {
    const blocked = !member.is_blocked;
    if (!await confirmAction(`${member.full_name || 'সদস্য'}-কে ${blocked ? 'ব্লক' : 'আনব্লক'} করবেন?`)) return;
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

  const loadOrphanAccounts = async (page = 1) => {
    setOrphanBusy(true); setOrphanError('');
    try {
      const {data,error:fnError} = await supabase.functions.invoke('admin-delete-unlinked-user', {body:{action:'list',page}});
      if (fnError) throw new Error(await edgeInvokeErrorText(fnError));
      if (data?.error) throw new Error(data.message || data.error);
      setOrphanAccounts(Array.isArray(data?.items) ? data.items : []);
      setOrphanPage(Number(data?.page) || page);
      setOrphanMore(Boolean(data?.has_more));
      setOrphanScanInfo({
        scannedUsers: Number(data?.scanned_users) || 0,
        pagesScanned: Number(data?.auth_pages_scanned) || 0,
        authPageStart: Number(data?.auth_page_start) || 0,
        authPageEnd: Number(data?.auth_page_end) || 0,
        message: data?.message || '',
        requestId: data?.request_id || '',
      });
    } catch (cause) {setOrphanError(cause?.message || 'Auth তালিকা আনা যায়নি।');}
    finally {setOrphanBusy(false);}
  };
  const removeOrphanAccount = async (account) => {
    const expected = `DELETE AUTH ${account.id}`;
    const typed = await confirmTypedAction(`এই Auth account অন্য কোনো মেসে নেই, তা সার্ভারে আবার যাচাই করে মুছবে। এটি ফেরানো যাবে না: ${account.email || account.id}`, expected);
    if (typed !== expected) return;
    setOrphanBusy(true);setOrphanError('');
    try {
      const {data,error:fnError}=await supabase.functions.invoke('admin-delete-unlinked-user',{body:{user_id:account.id,confirmation:expected}});
      if (fnError) throw new Error(await edgeInvokeErrorText(fnError));
      if (data?.error || !data?.deleted) throw new Error(data?.message || data?.error || 'Auth মুছতে পারেনি।');
      setOrphanAccounts(old=>old.filter(row=>row.id!==account.id));
      setNotice('Auth account স্থায়ীভাবে মুছে ফেলা হয়েছে।');
    } catch(cause){setOrphanError(cause?.message || 'Auth মুছতে পারেনি।');}
    finally {setOrphanBusy(false);}
  };

  const permanentlyDeleteHostel = async () => {
    if (!selected || !deleteDialog || deleteDialog.kind !== 'hostel') return;
    const confirmation = deleteConfirmation.trim();
    if (confirmation !== `DELETE HOSTEL ${selected.hostel_id}`) { setError('নিচের নিশ্চিতকরণ বাক্যটি হুবহু লিখুন।'); return; }

    // Auth cleanup is optional and happens only after the hostel RPC succeeds.
    // The deployed Run14+ RPC deliberately leaves Auth users to the guarded Edge Function.
    const shouldDeleteMemberAccounts = Boolean(deleteAccounts);
    if (shouldDeleteMemberAccounts && memberListLoadedHostelId !== selected.hostel_id) {
      setError('সদস্য তালিকা সম্পূর্ণভাবে যাচাই করা যায়নি। Auth account মুছতে চাইলে মেসটি আবার নির্বাচন করে সদস্য তালিকা লোড করুন।');
      return;
    }
    const formerMemberUserIds = shouldDeleteMemberAccounts
      ? [...new Set(members.map((member) => String(member?.user_id || '').trim()).filter((id) => id && id !== user?.id))]
      : [];

    setBusy(true); setError(''); setNotice('');
    try {
      // Always preserve Auth in the DB RPC. Each candidate is re-checked by the Edge Function.
      await platformAdminPermanentlyDeleteHostel(selected.hostel_id, false, confirmation);

      let authDeleted = 0;
      let authKeptOrUnverified = shouldDeleteMemberAccounts && members.some((member) => String(member?.user_id || '') === String(user?.id)) ? 1 : 0;
      let auditWarnings = 0;
      if (shouldDeleteMemberAccounts) {
        for (const userId of formerMemberUserIds) {
          try {
            const expected = `DELETE AUTH ${userId}`;
            const { data, error: cleanupError } = await supabase.functions.invoke('admin-delete-unlinked-user', {
              body: { user_id: userId, confirmation: expected },
            });
            if (cleanupError || data?.error || !data?.deleted) {
              // Shared-hostel, protected, or unverifiable accounts are deliberately retained.
              authKeptOrUnverified += 1;
              continue;
            }
            authDeleted += 1;
            if (data?.audit_warning) auditWarnings += 1;
          } catch {
            authKeptOrUnverified += 1;
          }
        }
      }

      setDeleteDialog(null); setDeleteConfirmation(''); setDeleteAccounts(false);
      setSelected(null); setMembers([]); setMemberListLoadedHostelId(''); setReason('');
      await refresh();

      if (!shouldDeleteMemberAccounts) {
        setNotice('মেস স্থায়ীভাবে মুছে ফেলা হয়েছে। Auth login account-গুলো অপরিবর্তিত রাখা হয়েছে।');
      } else {
        setNotice(`মেস স্থায়ীভাবে মুছে ফেলা হয়েছে। ${authDeleted}টি Auth account মুছে ফেলা হয়েছে; ${authKeptOrUnverified}টি অন্য মেসে যুক্ত, সুরক্ষিত অথবা সার্ভার থেকে নিশ্চিত করা যায়নি বলে রাখা হয়েছে.${auditWarnings ? ` ${auditWarnings}টি account-এর Audit Log যাচাই প্রয়োজন।` : ''}`);
      }
    } catch (cause) { setError(errorText(cause, 'মেস স্থায়ীভাবে মুছে ফেলা যায়নি।')); }
    finally { setBusy(false); }
  };

  const permanentlyDeleteMember = async (member) => {
    if (!selected || !member) return;
    const deleteAuthAccount = deleteAccounts;
    const confirmation = deleteConfirmation.trim();
    if (confirmation !== `DELETE MEMBER ${member.user_id}`) { setError('নিচের নিশ্চিতকরণ বাক্যটি হুবহু লিখুন।'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      // Always preserve Auth in the database RPC; the Edge Function performs a second membership check before it can delete Auth.
      const result = await platformAdminPermanentlyDeleteMember(selected.hostel_id, member.membership_id, false, confirmation);
      let authDeleted = Boolean(result?.auth_account_deleted);
      let warning = '';
      if (deleteAuthAccount && !authDeleted) {
        try {
          const {data:cleanup, error:cleanupError} = await supabase.functions.invoke('admin-delete-unlinked-user', {
            body: {user_id: member.user_id, confirmation: `DELETE AUTH ${member.user_id}`},
          });
          if (cleanupError) throw new Error(await edgeInvokeErrorText(cleanupError));
          if (cleanup?.error) throw new Error(cleanup.message || cleanup.error);
          authDeleted = Boolean(cleanup?.deleted);
          if (cleanup?.audit_warning) warning = ' Auth মুছেছে, কিন্তু Audit Log যাচাই করুন।';
          if (!authDeleted) warning = ' Auth account মোছা হয়েছে কি না সার্ভার নিশ্চিত করেনি; Edge Function logs যাচাই করুন।';
        } catch (cleanupError) {
          const detail = String(cleanupError?.message || 'Edge Function failure');
          warning = /still linked|membership|অন্য.*মেস|সদস্যপদ/i.test(detail)
            ? ` Auth account অন্য কোনো মেসে যুক্ত থাকতে পারে, তাই নিরাপত্তার জন্য রাখা হয়েছে। কারণ: ${detail}`
            : ` মেস থেকে সদস্য সরানো হয়েছে, কিন্তু Auth account মোছা যায়নি। কারণ: ${detail}`;
        }
      }
      setNotice(authDeleted ? `সদস্য ও Auth account স্থায়ীভাবে মুছে ফেলা হয়েছে।${warning}` : `সদস্য মেস থেকে সরানো হয়েছে।${warning || (deleteAuthAccount ? ' Auth account অন্য মেসে ব্যবহৃত হলে তা থাকবে।' : ' Auth account রাখা হয়েছে।')}`);
      setDeleteDialog(null); setDeleteConfirmation(''); setMembers((old) => old.filter((row) => row.membership_id !== member.membership_id));
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
      setCodeHistoryPage(0); setCodeHistoryPurpose('all'); setCodeHistoryReload((value) => value + 1);
      setNotice('নতুন কোড তৈরি হয়েছে। এটি এখন একবারই দেখানো হবে—নিরাপদ স্থানে কপি করুন।');
    } catch (cause) { setError(errorText(cause, 'নতুন কোড তৈরি করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (checking) return <main className="platform-page"><LoadingSpinner label="Super Admin role যাচাই হচ্ছে..."/></main>;
  if (!allowed) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="shield" size={30}/></span><h1>পৃষ্ঠাটি খোলা যাচ্ছে না</h1><p>অনুরোধটি সম্পন্ন করা যায়নি।</p><button className="primary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরে যান</button></section></main>;
  if (!reauthenticated) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="lock" size={28}/></span><span className="eyebrow">অতিরিক্ত নিরাপত্তা</span><h1>Super Admin যাচাইকরণ</h1><p>প্যানেল খোলার আগে আপনার মূল অ্যাকাউন্টের পাসওয়ার্ড পুনরায় যাচাই হবে।</p><form className="form-stack" onSubmit={reauthenticate}><label className="field-label"><span>অ্যাকাউন্ট ইমেইল</span><input type="email" value={user?.email || ''} readOnly /></label><label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{gateError && <div className="inline-error">{gateError}</div>}<button className="primary-button large" type="submit" disabled={reauthBusy}>{reauthBusy ? 'যাচাই হচ্ছে...' : 'যাচাই করে প্রবেশ করুন'}</button><button type="button" className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>বাতিল</button></form></section></main>;

  return <main className="platform-page">
    <header className="platform-header"><div className="platform-brand"><span className="platform-brand-mark"><BrandMark size={49}/></span><div><small>HOSTEL LIFE · PLATFORM CONTROL</small><h1>Super Admin</h1></div></div><div className="platform-header-actions"><span className="platform-auth-user">{user?.email}</span><button className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরুন</button></div></header>
    <div className="platform-intro"><div><span className="eyebrow">সিস্টেম ব্যবস্থাপনা</span><h2>মেস, নিরাপত্তা ও পাবলিক সেটিংস</h2><p>এই প্যানেলে ব্যক্তিগত মিল বা আর্থিক লেনদেনের বিস্তারিত দেখানো হয় না; পর্যবেক্ষণে সীমিত সামারি ব্যবহার করা হয়।</p></div><button className="secondary-button" onClick={refresh} disabled={busy}><Icon name="refresh" size={16}/> রিফ্রেশ</button></div>
    {error && <div className="inline-error platform-alert"><Icon name="warning" size={17}/><span>{error}</span></div>}{notice && <div className="inline-success platform-alert"><Icon name="check-circle" size={17}/><span>{notice}</span></div>}
    <nav className="platform-tabs">{[['overview','ওভারভিউ'],['insights','মেস ইনসাইটস'],['health','System Health'],['notices','নোটিশ পর্যবেক্ষণ'],['reports','রিপোর্ট এক্সপোর্ট'],['backup','Backup & Recovery'],['audit','Audit Log'],['hostels','মেস ও সদস্য'],['settings','নোটিশ ও Developer Info'],['security','Security Codes'],['retention','ডেটা সংরক্ষণ']].map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <section className="platform-stats-grid">
      <Stat label="মোট মেস" value={metrics.hostels} icon="home"/>
      <Stat label="সক্রিয় মেস" value={metrics.activeHostels} icon="home"/>
      <Stat label="স্থগিত মেস" value={metrics.suspendedHostels} icon="lock"/>
      <Stat label="মোট অ্যাকাউন্ট" value={metrics.users} icon="users"/>
      <Stat label="সক্রিয় মেম্বারশিপ" value={metrics.activeMemberships} icon="user-plus"/>
      <Stat label="নিষ্ক্রিয় মেম্বারশিপ" value={metrics.inactiveMemberships} icon="user"/>
      <Stat label="গত ৩০ দিনে তৈরি মেস" value={metrics.recentHostels} icon="calendar"/>
      <Stat label="ব্লক করা অ্যাকাউন্ট" value={metrics.blockedUsers} icon="shield"/>
      <Stat label="Super Admin" value={metrics.superAdmins} icon="shield-check"/>
      <div className="card platform-privacy-note"><Icon name="shield" size={22}/><div><strong>Privacy boundary</strong><p>এই Overview-তে শুধু সামগ্রিক সংখ্যা দেখানো হয়। ব্যক্তিগত সদস্যের আর্থিক বা মিলের বিস্তারিত এখানে দেখানো হয় না।</p></div></div>
    </section>}
    {tab === 'insights' && <section className="card platform-panel platform-insights-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">HOSTEL INTELLIGENCE</span><h3>মেসভিত্তিক বিস্তারিত সারসংক্ষেপ</h3><p>নির্বাচিত মেসের মাসভিত্তিক মিল, বাজার ও আর্থিক Aggregate দেখা যাবে। ব্যক্তিগত সদস্যের লেনদেন এখানে প্রকাশ করা হয় না।</p></div><button type="button" className="secondary-button compact" disabled={insightsLoading || !insightsHostelId} onClick={()=>loadHostelInsights(insightsHostelId,insightsPeriodId||null)}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <div className="platform-insights-toolbar">
        <label className="field-label"><span>মেস নির্বাচন</span><select value={insightsHostelId} onChange={(event)=>{setInsightsHostelId(event.target.value);setInsightsPeriodId('');setInsightsData(null);}}><option value="">মেস নির্বাচন করুন</option>{hostels.map((hostel)=><option key={hostel.hostel_id} value={hostel.hostel_id}>{hostel.name} · {hostel.platform_status==='suspended'?'স্থগিত':'সক্রিয়'}</option>)}</select></label>
        <label className="field-label"><span>মাস নির্বাচন</span><select value={insightsPeriodId} onChange={(event)=>setInsightsPeriodId(event.target.value)} disabled={!insightsHostelId || !(insightsData?.periods || []).length}><option value="">স্বয়ংক্রিয়ভাবে সর্বশেষ মাস</option>{(insightsData?.periods || []).map((period)=><option key={period.id} value={period.id}>{period.label} · {periodStatusLabel(period.status)}</option>)}</select></label>
      </div>
      {insightsError && <div className="inline-error platform-alert"><Icon name="warning" size={16}/>{insightsError}</div>}
      {insightsLoading ? <div className="platform-empty"><LoadingSpinner label="মেসের সারসংক্ষেপ লোড হচ্ছে..."/></div> : insightsError ? null : !insightsHostelId ? <div className="platform-empty-state"><Icon name="home" size={28}/><strong>কোনো মেস নির্বাচন করা হয়নি</strong><span>প্রথমে মেস নির্বাচন করুন।</span></div> : !insightsData?.period ? <div className="platform-empty-state"><Icon name="calendar" size={28}/><strong>এই মেসে এখনো কোনো মাস তৈরি হয়নি</strong><span>মাস তৈরি হলে তার সারসংক্ষেপ এখানে দেখা যাবে।</span></div> : <>
        <div className="platform-insights-period-head"><div><span className="eyebrow">{insightsData.hostel?.name || 'নির্বাচিত মেস'}</span><h4>{insightsData.period.label}</h4><p>{insightsData.period.start_date} — {insightsData.period.end_date}</p><p className="platform-insights-manager-meta">প্রধান ম্যানেজার: {insightsData.summary.primary_manager_assigned===null?'তথ্য নেই':insightsData.summary.primary_manager_assigned?'নিযুক্ত':'নিযুক্ত নেই'}</p></div><span className={`platform-status ${insightsData.period.status==='running'?'status-active':insightsData.period.snapshot_only?'status-inactive':'status-period-closed'}`}>{periodStatusLabel(insightsData.period.status)}</span></div>
        {insightsData.summary?.snapshot_only && <div className="platform-insights-snapshot-note"><Icon name="archive" size={17}/><span>এই মাসের বিস্তারিত রেকর্ড সংরক্ষণ নীতিমালা অনুযায়ী মুছে ফেলা হয়েছে। এখানে সর্বশেষ সংরক্ষিত Aggregate Summary দেখানো হচ্ছে; কিছু দৈনিক ও সদস্যসংক্রান্ত তথ্য আর উপলভ্য নয়।</span></div>}
        <div className="platform-insights-section"><div className="platform-insights-section-title"><h4>মাস ও সদস্য</h4><span>মাসের সময়সীমা ও সদস্য অবস্থা</span></div><div className="platform-insights-grid">
          <InsightStat label="এই মাসে সদস্য" value={insightsData.summary.period_members} icon="users"/>
          <InsightStat label="বর্তমানে সক্রিয় সদস্য" value={insightsData.summary.active_members_now} icon="user-check"/>
          <InsightStat label="সহকারী ম্যানেজার" value={insightsData.summary.assistant_manager_count} icon="users"/>
          <InsightStat label="অপেক্ষমাণ মিল অনুরোধ" value={insightsData.summary.pending_meal_requests} icon="clock"/>
        </div></div>
        <div className="platform-insights-section"><div className="platform-insights-section-title"><h4>মিলের অগ্রগতি</h4><span>{insightsData.summary.snapshot_only?'আর্কাইভে সংরক্ষিত মিল':'শুধু চূড়ান্ত হওয়া দিনের হিসাব'}</span></div><div className="platform-insights-grid">
          <InsightStat label={insightsData.summary.snapshot_only?'সংরক্ষিত সকালের মিল':'চূড়ান্ত সকালের মিল'} value={insightsData.summary.finalized_breakfast} icon="sun"/>
          <InsightStat label={insightsData.summary.snapshot_only?'সংরক্ষিত দুপুরের মিল':'চূড়ান্ত দুপুরের মিল'} value={insightsData.summary.finalized_lunch} icon="sun"/>
          <InsightStat label={insightsData.summary.snapshot_only?'সংরক্ষিত রাতের মিল':'চূড়ান্ত রাতের মিল'} value={insightsData.summary.finalized_dinner} icon="moon"/>
          <InsightStat label={insightsData.summary.snapshot_only?'মোট সংরক্ষিত মিল':'মোট চূড়ান্ত মিল'} value={insightsData.summary.finalized_meals_total} icon="utensils"/>
          <InsightStat label="মোট ক্যালেন্ডার দিন" value={insightsData.summary.period_days} icon="calendar"/>
          <InsightStat label="চূড়ান্ত হওয়া দিন" value={insightsData.summary.finalized_days} icon="calendar-check"/>
          <InsightStat label="বাতিল দিন" value={insightsData.summary.cancelled_days} icon="calendar"/>
          <InsightStat label="চূড়ান্ত দিনের অনুপাত" value={insightsData.summary.finalized_days_percent} format="percent" icon="calendar-check"/>
        </div></div>
        <div className="platform-insights-section"><div className="platform-insights-section-title"><h4>বাজার ও আর্থিক সারসংক্ষেপ</h4><span>ব্যক্তিগত লেনদেন নয়, মেসের মোট হিসাব · নগদ ও বাজার ক্রেডিট আলাদা</span></div><div className="platform-insights-grid">
          <InsightStat label="মোট বাজার" value={insightsData.summary.market_total} format="currency" icon="shopping-basket"/>
          <InsightStat label="বাজার এন্ট্রি" value={insightsData.summary.market_entry_count} icon="receipt"/>
          <InsightStat label="নগদ ডিপোজিট" value={insightsData.summary.cash_deposit_total} format="currency" icon="wallet"/>
          <InsightStat label="বাজার বাবদ ক্রেডিট" value={insightsData.summary.market_credit_total} format="currency" icon="hand-coins"/>
          <InsightStat label="অন্যান্য খরচ" value={insightsData.summary.other_expense_total} format="currency" icon="receipt"/>
          <InsightStat label="খালার টাকা" value={insightsData.summary.khala_expense_total} format="currency" icon="hand-coins"/>
          <InsightStat label="নেট সমন্বয়" value={insightsData.summary.adjustment_net} format="currency" icon="info"/>
          <InsightStat label="মোট পরিচালন ব্যয়" value={insightsData.summary.operating_expense_total} format="currency" icon="file-text"/>
          <InsightStat label="মিল রেট" value={insightsData.summary.meal_rate} format="currency" icon="trophy"/>
        </div></div>
        <div className="platform-insights-footer"><span><Icon name="shield-check" size={15}/> শুধু Aggregate তথ্য · সদস্যভিত্তিক হিসাব গোপন</span><small>তথ্য তৈরি: {formatPlatformDate(insightsData.generated_at)}</small></div>
      </>}
    </section>}

    {tab === 'audit' && <section className="card platform-panel platform-audit-panel">
      <div className="platform-panel-heading"><div><h3>প্ল্যাটফর্ম Audit Log</h3><p>গুরুত্বপূর্ণ প্রশাসনিক কাজের সময়, কর্মী ও লক্ষ্য রেকর্ড। সংবেদনশীল কোড বা ব্যক্তিগত তথ্য দেখানো হয় না।</p></div><button type="button" className="secondary-button compact" disabled={auditLoading} onClick={loadAuditLog}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <form className="platform-audit-filters" onSubmit={(event)=>{event.preventDefault();setAuditPage(0);setAuditSearch(auditSearchDraft.trim());}}>
        <label className="field-label"><span>কাজের ধরন</span><select value={auditActionFilter} onChange={(event)=>{setAuditPage(0);setAuditActionFilter(event.target.value);}}><option value="all">সব কাজ</option>{Object.entries(AUDIT_ACTION_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field-label"><span>লক্ষ্যের ধরন</span><select value={auditTargetFilter} onChange={(event)=>{setAuditPage(0);setAuditTargetFilter(event.target.value);}}><option value="all">সব</option>{Object.entries(AUDIT_TARGET_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field-label platform-audit-search"><span>খুঁজুন</span><input value={auditSearchDraft} maxLength={120} onChange={(event)=>setAuditSearchDraft(event.target.value)} placeholder="কাজ, ID, কারণ বা অ্যাডমিন"/></label>
        <button className="primary-button" type="submit" disabled={auditLoading}>খুঁজুন</button>
        {(auditSearch || auditActionFilter !== 'all' || auditTargetFilter !== 'all') && <button className="secondary-button" type="button" disabled={auditLoading} onClick={()=>{setAuditSearchDraft('');setAuditSearch('');setAuditActionFilter('all');setAuditTargetFilter('all');setAuditPage(0);}}>ফিল্টার মুছুন</button>}
      </form>
      {auditError && <div className="inline-error platform-alert">{auditError}</div>}
      {auditLoading ? <div className="platform-empty"><LoadingSpinner label="Audit Log লোড হচ্ছে..."/></div> : auditRows.length === 0 ? <div className="platform-empty-state"><Icon name="history" size={28}/><strong>কোনো কার্যক্রম পাওয়া যায়নি</strong><span>ফিল্টার পরিবর্তন করুন অথবা পরে আবার রিফ্রেশ করুন।</span></div> : <div className="platform-audit-list">{auditRows.map((row)=><article className="platform-audit-item" key={row.id}>
        <div className="platform-audit-top"><div><strong>{auditActionLabel(row.action)}</strong><small>{auditTargetLabel(row.target_type)} · {row.target_id || '—'}</small></div><time>{formatPlatformDate(row.created_at)}</time></div>
        <div className="platform-audit-actor"><Icon name="user" size={14}/>{row.actor_name || 'অজানা অ্যাকাউন্ট'}</div>
        {row.reason && <p className="platform-audit-reason">কারণ: {row.reason}</p>}
        {row.details && Object.entries(row.details).length > 0 && <div className="platform-audit-details">{Object.entries(row.details).map(([key,value])=><span key={key}>{AUDIT_DETAIL_LABELS[key] || key}: {typeof value === 'boolean' ? (value ? 'হ্যাঁ' : 'না') : String(value)}</span>)}</div>}
      </article>)}</div>}
      <div className="platform-history-pager"><span>{auditTotal.toLocaleString('bn-BD')}টি রেকর্ড · পৃষ্ঠা {auditTotal ? auditPage + 1 : 0} / {Math.max(1,Math.ceil(auditTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={auditLoading || auditPage===0} onClick={()=>setAuditPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={auditLoading || (auditPage+1)*pageSize>=auditTotal} onClick={()=>setAuditPage(value=>value+1)}>পরের</button></div></div>
    </section>}
    {tab === 'health' && <section className="card platform-panel platform-phase3-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">PLATFORM HEALTH</span><h3>মেসের কার্যক্রম ও সিস্টেম স্বাস্থ্য</h3><p>মেসভিত্তিক অপারেশনাল সংকেত। এগুলো সম্ভাব্য সমস্যা শনাক্ত করে; কোনো মেসে স্বয়ংক্রিয় পরিবর্তন করে না।</p></div><button type="button" className="secondary-button compact" disabled={healthLoading} onClick={loadSystemHealth}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <div className="platform-phase3-toolbar"><label className="field-label"><span>কত দিনের নিষ্ক্রিয়তাকে সতর্কতা ধরবে</span><select value={healthStaleDays} onChange={(event)=>setHealthStaleDays(event.target.value)}><option value="7">৭ দিন</option><option value="14">১৪ দিন</option><option value="30">৩০ দিন</option><option value="60">৬০ দিন</option></select></label><span className="platform-phase3-note">শুধু পর্যবেক্ষণ · নতুন মেসে ৪৮ ঘণ্টা ছাড় · ৮+ অপেক্ষমাণ অনুরোধে সতর্কতা · কোনো অটোমেটিক ব্লক নয়</span></div>
      {healthError && <div className="inline-error platform-alert">{healthError}</div>}
      {healthLoading ? <div className="platform-empty"><LoadingSpinner label="মেসের স্বাস্থ্য পরীক্ষা হচ্ছে..."/></div> : healthData ? <>
        <div className="platform-phase3-stat-grid">
          <Stat label="মোট মেস" value={healthData.totals?.hostel_count} icon="home"/>
          <Stat label="স্বাভাবিক" value={healthData.totals?.healthy_hostel_count} icon="check-circle"/>
          <Stat label="জরুরি সমস্যা" value={healthData.totals?.critical_hostel_count} icon="warning"/>
          <Stat label="পর্যালোচনা দরকার" value={healthData.totals?.warning_hostel_count} icon="alert-circle"/>
          <Stat label="তথ্য" value={healthData.totals?.info_hostel_count} icon="info"/>
        </div>
        <div className="platform-phase3-breakdown">
          <span>চলমান মাস নেই: <b>{Number(healthData.totals?.missing_running_period_count||0).toLocaleString('bn-BD')}</b></span>
          <span>সক্রিয় সদস্য নেই: <b>{Number(healthData.totals?.no_active_members_count||0).toLocaleString('bn-BD')}</b></span>
          <span>প্রধান ম্যানেজার সমস্যা: <b>{Number(healthData.totals?.primary_manager_unavailable_count||0).toLocaleString('bn-BD')}</b></span>
          <span>দীর্ঘদিন কার্যক্রম নেই: <b>{Number(healthData.totals?.stale_activity_count||0).toLocaleString('bn-BD')}</b></span>
          <span>অপেক্ষমাণ অনুরোধ: <b>{Number(healthData.totals?.pending_request_backlog_count||0).toLocaleString('bn-BD')}</b></span>
        </div>
        <div className="platform-phase3-list-heading"><h4>যেসব মেসে নজর দেওয়া দরকার</h4><small>{Number(healthData.items?.length||0).toLocaleString('bn-BD')}টি মেস · {healthData.stale_days} দিনের নিষ্ক্রিয়তা সীমা</small></div>
        {!healthData.items?.length ? <div className="platform-empty-state"><Icon name="shield-check" size={28}/><strong>কোনো উল্লেখযোগ্য সমস্যা পাওয়া যায়নি</strong><span>এই মুহূর্তে মেসগুলোর জন্য কোনো Health Alert নেই।</span></div> : <div className="platform-health-list">{healthData.items.map((row)=><article className="platform-health-item" key={row.hostel_id}>
          <div className="platform-health-item-top"><div><strong>{row.hostel_name}</strong><small>{row.running_period_label || (row.running_period_id?'চলমান মাস':'চলমান মাস নেই')} · {row.platform_status==='suspended'?'স্থগিত মেস':'সক্রিয় মেস'}</small></div><span className={`platform-health-severity severity-${row.severity}`}>{systemSeverityLabel(row.severity)}</span></div>
          <div className="platform-health-issues">{(row.issue_codes||[]).map(code=><span key={code}>{systemIssueLabel(code)}</span>)}</div>
          <div className="platform-health-meta"><span>সক্রিয় সদস্য: <b>{Number(row.active_members||0).toLocaleString('bn-BD')}</b></span><span>অপেক্ষমাণ অনুরোধ: <b>{Number(row.pending_requests||0).toLocaleString('bn-BD')}</b></span><span>সর্বশেষ কার্যক্রম: <b>{(row.last_activity_at ? formatPlatformDate(row.last_activity_at) : 'কোনো এন্ট্রি রেকর্ড নেই')}</b></span></div>
        </article>)}</div>}
        <div className="platform-insights-footer"><span><Icon name="shield-check" size={15}/> Health check শুধু পড়ে; কোনো ডেটা পরিবর্তন করে না</span><small>তথ্য তৈরি: {formatPlatformDate(healthData.generated_at)}</small></div>
      </> : <div className="platform-empty-state"><Icon name="activity" size={28}/><strong>Health তথ্য এখনো লোড হয়নি</strong><span>রিফ্রেশ করে আবার চেষ্টা করুন।</span></div>}
    </section>}

    {tab === 'notices' && <section className="card platform-panel platform-phase3-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">NOTICE MONITORING</span><h3>Global ও মেস নোটিশ পর্যবেক্ষণ</h3><p>প্ল্যাটফর্মের বর্তমান Global Notice এবং প্রতিটি মেসের বর্তমানে প্রকাশিত Manager Notice। এখান থেকে নোটিশ সম্পাদনা বা মুছে ফেলা হয় না।</p></div><button type="button" className="secondary-button compact" disabled={noticeMonitorLoading} onClick={loadNoticeMonitoring}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      {noticeMonitorError && <div className="inline-error platform-alert">{noticeMonitorError}</div>}
      {noticeMonitorLoading && !noticeMonitorData ? <div className="platform-empty"><LoadingSpinner label="নোটিশের তথ্য লোড হচ্ছে..."/></div> : <>
        <div className={`platform-global-monitor ${noticeMonitorData?.global_notice?.enabled?'is-enabled':'is-disabled'}`}>
          <div className="platform-global-monitor-head"><span><Icon name="shield-check" size={17}/> HOSTEL LIFE · SYSTEM NOTICE</span><span className={`platform-health-severity ${noticeMonitorData?.global_notice?.enabled?'severity-healthy':'severity-info'}`}>{noticeMonitorData?.global_notice?.enabled?'প্রকাশিত':'বন্ধ'}</span></div>
          <h4>{noticeMonitorData?.global_notice?.title || 'কোনো Global Notice সেট করা নেই'}</h4>
          {noticeMonitorData?.global_notice?.body && <p>{noticeMonitorData.global_notice.body}</p>}
          <small>সর্বশেষ পরিবর্তন: {formatPlatformDate(noticeMonitorData?.global_notice?.updated_at)} · {noticeMonitorData?.global_notice?.updated_by_name || 'অজানা অ্যাকাউন্ট'}</small>
        </div>
        <div className="platform-phase3-list-heading"><div><h4>মেসের বর্তমান নোটিশ</h4><small>{noticeMonitorTotal.toLocaleString('bn-BD')}টি সক্রিয় মেস নোটিশ</small></div></div>
        <form className="platform-phase3-search" onSubmit={(event)=>{event.preventDefault();setNoticeMonitorPage(0);setNoticeMonitorSearch(noticeMonitorSearchDraft.trim());}}>
          <label className="field-label"><span>মেস বা নোটিশ খুঁজুন</span><input value={noticeMonitorSearchDraft} maxLength={120} onChange={(event)=>setNoticeMonitorSearchDraft(event.target.value)} placeholder="মেসের নাম, শিরোনাম বা নোটিশের লেখা"/></label>
          <button className="primary-button" type="submit" disabled={noticeMonitorLoading}>খুঁজুন</button>
          {(noticeMonitorSearch || noticeMonitorSearchDraft) && <button className="secondary-button" type="button" disabled={noticeMonitorLoading} onClick={()=>{setNoticeMonitorSearchDraft('');setNoticeMonitorSearch('');setNoticeMonitorPage(0);}}>মুছুন</button>}
        </form>
        {noticeMonitorLoading ? <div className="platform-empty"><LoadingSpinner label="মেস নোটিশ লোড হচ্ছে..."/></div> : noticeMonitorRows.length===0 ? <div className="platform-empty-state"><Icon name="bell-off" size={28}/><strong>কোনো মেস নোটিশ পাওয়া যায়নি</strong><span>এই মুহূর্তে কোনো মেসে সক্রিয় নোটিশ নেই অথবা সার্চে মেলেনি।</span></div> : <div className="platform-notice-monitor-list">{noticeMonitorRows.map((row)=><article className="platform-notice-monitor-item" key={row.hostel_id}>
          <div className="platform-notice-monitor-top"><div><span className="platform-notice-hostel-tag">{row.hostel_name}</span><strong>{row.title}</strong></div><span className={`platform-status ${row.hostel_status==='active'?'status-active':'status-inactive'}`}>{row.hostel_status==='active'?'সক্রিয় মেস':'স্থগিত মেস'}</span></div>
          <p>{row.body}</p>
          <div className="platform-notice-monitor-meta"><span>প্রকাশ করেছেন: <b>{row.created_by_name||'অজানা অ্যাকাউন্ট'}</b></span><span>সদস্য: <b>{Number(row.active_member_count||0).toLocaleString('bn-BD')}</b></span><span>প্রকাশ: <b>{formatPlatformDate(row.created_at)}</b></span><span>সর্বশেষ পরিবর্তন: <b>{formatPlatformDate(row.updated_at)}</b></span></div>
        </article>)}</div>}
        <div className="platform-history-pager"><span>{noticeMonitorTotal.toLocaleString('bn-BD')}টি নোটিশ · পৃষ্ঠা {noticeMonitorTotal ? noticeMonitorPage+1 : 0} / {Math.max(1,Math.ceil(noticeMonitorTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={noticeMonitorLoading||noticeMonitorPage===0} onClick={()=>setNoticeMonitorPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={noticeMonitorLoading||(noticeMonitorPage+1)*pageSize>=noticeMonitorTotal} onClick={()=>setNoticeMonitorPage(value=>value+1)}>পরের</button></div></div>
      </>}
    </section>}

    {tab === 'reports' && <section className="card platform-panel platform-phase3-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">PLATFORM REPORT EXPORT</span><h3>প্ল্যাটফর্মের সামগ্রিক রিপোর্ট</h3><p>নির্বাচিত সময়ে প্রতিটি মেসের Aggregate মিল ও আর্থিক সারসংক্ষেপ CSV হিসেবে ডাউনলোড করা যাবে। সদস্যভিত্তিক ব্যক্তিগত তথ্য অন্তর্ভুক্ত নয়।</p></div></div>
      <form className="platform-report-toolbar" onSubmit={(event)=>{event.preventDefault();generatePlatformReport();}}>
        <label className="field-label"><span>শুরুর তারিখ</span><input type="date" value={reportFromDate} max={reportToDate||undefined} onChange={(event)=>{setReportFromDate(event.target.value);setReportData(null);}} required/></label>
        <label className="field-label"><span>শেষ তারিখ</span><input type="date" value={reportToDate} min={reportFromDate||undefined} onChange={(event)=>{setReportToDate(event.target.value);setReportData(null);}} required/></label>
        <button className="primary-button" type="submit" disabled={reportLoading||!reportFromDate||!reportToDate}><Icon name="file-text" size={16}/>{reportLoading?'রিপোর্ট তৈরি হচ্ছে...':'রিপোর্ট তৈরি করুন'}</button>
      </form>
      <div className="platform-report-range-note"><Icon name="info" size={16}/> সর্বোচ্চ ৩৬৭ দিনের সময়সীমা নির্বাচন করা যাবে। আংশিকভাবে নির্বাচিত সংরক্ষিত Archive Summary-এর হিসাব ভুল এড়াতে যোগ করা হবে না—সেগুলো আলাদা গণনায় দেখানো হবে।</div>
      {reportError && <div className="inline-error platform-alert">{reportError}</div>}
      {reportLoading && <div className="platform-empty"><LoadingSpinner label="Aggregate রিপোর্ট তৈরি হচ্ছে..."/></div>}
      {reportData && !reportLoading && <>
        <div className="platform-report-header"><div><span className="eyebrow">REPORT PERIOD</span><h4>{reportData.from_date} — {reportData.to_date}</h4><small>তৈরি: {formatPlatformDate(reportData.generated_at)}</small></div><button className="primary-button" type="button" onClick={downloadPlatformReport}><Icon name="download" size={16}/> CSV ডাউনলোড</button></div>
        {Number(reportData.totals?.snapshot_periods||0)>0 && <div className="platform-report-range-note"><Icon name="archive" size={16}/>{reportData.snapshot_note || 'সংরক্ষিত আর্কাইভ সামারি রিপোর্টে অন্তর্ভুক্ত।'} বাজার এন্ট্রি সংখ্যা ও চূড়ান্ত দিনের গণনা কেবল বিস্তারিত রেকর্ড থাকা মাসের জন্য।</div>}
        <div className="platform-phase3-stat-grid">
          <Stat label="মোট মেস" value={reportData.totals?.hostel_count} icon="home"/>
          <Stat label="সক্রিয় মেস" value={reportData.totals?.active_hostel_count} icon="check-circle"/>
          <Stat label="মোট মাস" value={reportData.totals?.periods_in_range} icon="calendar"/>
          <Stat label="চূড়ান্ত দিন (বিস্তারিত ডেটা)" value={reportData.totals?.finalized_days} icon="calendar-check"/>
          <Stat label="মোট মিল" value={reportData.totals?.total_meals} icon="utensils"/>
          <Stat label="বাজার এন্ট্রি" value={reportData.totals?.market_entry_count} icon="receipt"/>
        </div>
        <div className="platform-report-total-grid">
          <div><small>মোট বাজার</small><strong>{formatReportCurrency(reportData.totals?.market_total)}</strong></div>
          <div><small>নগদ ডিপোজিট</small><strong>{formatReportCurrency(reportData.totals?.cash_deposit)}</strong></div>
          <div><small>বাজার ক্রেডিট</small><strong>{formatReportCurrency(reportData.totals?.market_credit)}</strong></div>
          <div><small>অন্যান্য খরচ</small><strong>{formatReportCurrency(reportData.totals?.other_expense)}</strong></div>
          <div><small>খালার টাকা</small><strong>{formatReportCurrency(reportData.totals?.khala_expense)}</strong></div>
          <div><small>মোট পরিচালন ব্যয়</small><strong>{formatReportCurrency(reportData.totals?.operating_expense)}</strong></div>
        </div>
        {Number(reportData.totals?.snapshot_partial_excluded||0)>0 && <div className="platform-report-warning"><Icon name="archive" size={16}/> {Number(reportData.totals.snapshot_partial_excluded).toLocaleString('bn-BD')}টি সংরক্ষিত মাস তারিখের পরিসরের সঙ্গে আংশিকভাবে মিলে যাওয়ায় অর্থ ও মিলের পরিমাণ যোগ করা হয়নি। পূর্ণ মাস অন্তর্ভুক্ত করে আবার রিপোর্ট তৈরি করলে সংরক্ষিত সামারি যুক্ত হবে।</div>}
        <div className="platform-report-table-wrap"><table className="platform-report-table"><thead><tr><th>মেস</th><th>অবস্থা</th><th>মাস</th><th>মোট মিল</th><th>বাজার</th><th>নগদ ডিপোজিট</th><th>বাজার ক্রেডিট</th><th>পরিচালন ব্যয়</th></tr></thead><tbody>{(reportData.items||[]).map((row)=><tr key={row.hostel_id}><td>{row.hostel_name}</td><td>{row.platform_status==='active'?'সক্রিয়':'স্থগিত'}</td><td>{Number(row.periods_in_range||0).toLocaleString('bn-BD')}</td><td>{Number(row.total_meals||0).toLocaleString('bn-BD')}</td><td>{formatReportCurrency(row.market_total)}</td><td>{formatReportCurrency(row.cash_deposit)}</td><td>{formatReportCurrency(row.market_credit)}</td><td>{formatReportCurrency(row.operating_expense)}</td></tr>)}</tbody></table></div>
        <div className="platform-insights-footer"><span><Icon name="shield-check" size={15}/> মেসভিত্তিক Aggregate · ব্যক্তিগত লেনদেন অন্তর্ভুক্ত নয়</span><small>{(reportData.items||[]).length.toLocaleString('bn-BD')}টি মেস</small></div>
      </>}
    </section>}

    {tab === 'backup' && <section className="card platform-panel platform-backup-center">
      <div className="platform-panel-heading">
        <div><span className="eyebrow">LOCAL BACKUP · ENCRYPTED</span><h3>Backup & Recovery Center</h3><p>সম্পূর্ণ সিস্টেম অথবা নির্বাচিত মেসের Backup আপনার নিজের কম্পিউটারে তৈরি করুন। Backup কোনো Supabase Bucket-এ পাঠানো হয় না।</p></div>
        <span className="platform-backup-shield"><Icon name="shield-check" size={25}/></span>
      </div>
      <div className="platform-backup-notice"><Icon name="lock" size={18}/><div><strong>Secret Browser-এ ব্যবহার করবেন না</strong><p>Database Password, Service Role Key বা Encryption Password এই Web Page-এ দিতে হবে না। এগুলো শুধু আলাদা Windows Backup Assistant-এ স্থানীয়ভাবে দিতে হবে; Utility-ও এগুলো Backup History বা Log-এ সংরক্ষণ করে না।</p></div></div>
      <div className="platform-backup-options">
        <article className="platform-backup-option">
          <span className="platform-backup-option-icon"><Icon name="database" size={22}/></span>
          <div><h4>Full Master Backup</h4><p>Database Roles, Schema, Data, Auth User/Identity, Storage File, SQL Migration, Edge Function Source এবং Website Source একত্রে এনক্রিপ্টেড Backup।</p><ul><li>নতুন Supabase Project-এ পূর্ণ Restore-এর ভিত্তি</li><li>AES-256-GCM এনক্রিপশন ও SHA-256 যাচাই</li><li>একটি আলাদা `.hlbackup` ফাইল</li></ul></div>
        </article>
        <article className="platform-backup-option">
          <span className="platform-backup-option-icon"><Icon name="home" size={22}/></span>
          <div><h4>Selected Hostel Backup</h4><p>শুধু নির্বাচিত মেসের সদস্যপদ, মাস, মিল, বাজার, জমা-খরচ, নোটিশ এবং সংশ্লিষ্ট সদস্যদের Avatar-এর Logical Export।</p><ul><li>অন্য মেসের তথ্য অন্তর্ভুক্ত নয়</li><li>Auth Account বা Global Settings অন্তর্ভুক্ত নয়</li><li>সামঞ্জস্যপূর্ণ Hostel Life Schema প্রয়োজন</li></ul></div>
        </article>
        <article className="platform-backup-option">
          <span className="platform-backup-option-icon"><Icon name="file-text" size={22}/></span>
          <div><h4>Verify Existing Backup</h4><p>আগে তৈরি করা Backup-এর Password দিয়ে AES-GCM Authentication, ZIP Structure ও প্রতিটি ফাইলের SHA-256 যাচাই করুন।</p><ul><li>শুধু Read/Verify</li><li>Live Database পরিবর্তন করে না</li></ul></div>
        </article>
        <article className="platform-backup-option">
          <span className="platform-backup-option-icon"><Icon name="shield-check" size={22}/></span>
          <div><h4>Restore & Disaster Recovery</h4><p>আলাদা Windows Assistant-এর Restore Tab থেকে Backup যাচাই, Target Project পরীক্ষা এবং ধাপে ধাপে Restore/Resume করুন।</p><ul><li>Master Restore শুধু নতুন/খালি Project-এ</li><li>Hostel Restore-এ Schema ও ID Conflict Check</li><li>Dry Run ও `RESTORE` Confirmation বাধ্যতামূলক</li></ul></div>
        </article>
      </div>
      <div className="platform-backup-download">
        <div><strong>Hostel Life Backup Assistant</strong><p>Windows 10/11-এর জন্য Portable Python Utility। প্রথমবার চালাতে Python Package, Supabase CLI, Docker Desktop ও PostgreSQL Client Tool লাগবে।</p></div>
        <a className="primary-button" href="/downloads/Hostel_Life_Backup_Assistant_Windows_Package.zip" download><Icon name="download" size={16}/> Assistant Download</a>
      </div>
      <div className="platform-backup-policy">
        <div><Icon name="calendar" size={18}/><span><strong>প্রস্তাবিত সময়সূচি</strong><small>সপ্তাহে একবার Master Backup এবং বড় SQL Migration-এর আগে আরেকটি Backup। মাস বন্ধের আগে/পরে প্রয়োজনমতো Hostel Backup।</small></span></div>
        <div><Icon name="folder" size={18}/><span><strong>দুটি আলাদা কপি রাখুন</strong><small>একটি কম্পিউটারে, আরেকটি আলাদা USB বা নিরাপদ অন্য ডিভাইসে। শুধু একই Supabase Project-এর Storage-এ Backup রাখবেন না।</small></span></div>
        <div><Icon name="lock" size={18}/><span><strong>Encryption Password হারাবেন না</strong><small>Password ছাড়া AES-256-GCM Backup খোলা যাবে না। Password আলাদা নিরাপদ স্থানে রাখুন।</small></span></div>
      </div>
      <div className="platform-backup-local-note"><Icon name="info" size={16}/><span>এই Web Panel আপনার কম্পিউটারের Local Folder বা Backup History পড়তে পারে না। Backup Assistant-এর History ও Restore Journal শুধু আপনার কম্পিউটারে থাকবে। Restore কাজ আলাদা Windows Assistant-এ Dry Run ও Confirmation-এর পর চালাতে হবে; এই Web Panel নিজে Live Database Restore করে না। Cron Job/Edge Function স্বয়ংক্রিয়ভাবে চালু বা Deploy করা হয় না।</span></div>
    </section>}

    {tab === 'hostels' && <section className="platform-two-col platform-admin-workspace">
      <div className="card platform-panel">
        <div className="platform-panel-heading"><div><h3>মেস ডিরেক্টরি</h3><p>{filteredHostels.length} / {hostels.length}টি মেস · আর্থিক/মিলের তথ্য দেখানো হয় না</p></div></div>
        <Field label="মেস খুঁজুন (নাম বা ID)" value={hostelQuery} onChange={setHostelQuery} maxLength={120}/>
        <div className="platform-filter-pills" role="group" aria-label="মেস ফিল্টার">
          {[['all','সব'],['manager','প্রধান ম্যানেজার'],['assistant','সহকারী'],['member','সাধারণ সদস্য'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত'],['suspended','স্থগিত']].map(([key,label])=><button type="button" key={key} className={hostelFilter===key?'active':''} onClick={()=>setHostelFilter(key)}>{label}</button>)}
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
          <div className="platform-panel-heading"><div><span className="eyebrow">মেস কন্ট্রোল</span><h3>{selected.name}</h3><p>মেস ID: <code>{selected.hostel_id}</code></p></div><button className="text-button" type="button" onClick={()=>{setSelected(null);setMembers([]);setMemberListLoadedHostelId('');}}>বন্ধ করুন</button></div>
          <div className="platform-flag-actions"><button type="button" className={selected.is_favorite?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'favorite')}>⭐ {selected.is_favorite?'পছন্দে আছে':'পছন্দে রাখুন'}</button><button type="button" className={selected.is_trusted?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'trusted')}>✓ {selected.is_trusted?'বিশ্বস্ত চিহ্নিত':'বিশ্বস্ত হিসেবে চিহ্নিত'}</button></div>
          <Field label="অ্যাকশন নোট / কারণ (ঐচ্ছিক)" value={reason} onChange={setReason} maxLength={300}/>
          <div className="platform-action-row"><button className="secondary-button" disabled={busy||selectedStatus==='active'} type="button" onClick={()=>changeHostelStatus('active')}>চালু করুন</button><button className="secondary-button" disabled={busy||selectedStatus==='suspended'} type="button" onClick={()=>changeHostelStatus('suspended')}>স্থগিত করুন</button></div>
          <div className="platform-permanent-delete"><strong><Icon name="trash" size={16}/> স্থায়ীভাবে মুছে ফেলুন</strong><p>মেসের meal, বাজার, হিসাব, সদস্য ও সংশ্লিষ্ট ডেটা স্থায়ীভাবে মুছে যাবে। এটি ফেরানো যাবে না।</p><button className="danger-button" disabled={busy} type="button" onClick={() => { setDeleteDialog({kind:'hostel'}); setDeleteConfirmation(''); setDeleteAccounts(false); setError(''); }}>{busy?'অপেক্ষা করুন...':'Super Delete · মেস ও সব ডেটা'}</button></div>
          <div className="platform-panel-heading platform-members-heading"><div><h3>সদস্য তালিকা</h3><p>শুধু পরিচয় ও স্ট্যাটাস · কোনো আর্থিক/মিলের রেকর্ড নয়</p></div></div>
          <Field label="সদস্য খুঁজুন (নাম, ফোন বা ID)" value={memberQuery} onChange={setMemberQuery} maxLength={120}/>
          <div className="platform-filter-pills" role="group" aria-label="সদস্য ফিল্টার">{[['all','সব'],['manager','প্রধান ম্যানেজার'],['assistant','সহকারী'],['member','সাধারণ সদস্য'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত'],['blocked','ব্লক']].map(([key,label])=><button type="button" key={key} className={memberFilter===key?'active':''} onClick={()=>setMemberFilter(key)}>{label}</button>)}</div>
          {busy?<LoadingSpinner label="তথ্য আপডেট হচ্ছে..."/>:sortedMembers.length===0?<p className="platform-empty">এই ফিল্টারে কোনো সদস্য নেই।</p>:<div className="platform-members-list">{visibleMembers.map((member)=><div className="platform-member-row" key={member.membership_id}>
            <div className="platform-avatar">{member.avatar_url ? <img src={member.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : String(member.full_name||'স').slice(0,1)}</div><div className="platform-member-copy"><strong>{member.full_name||'নাম নেই'}</strong><div className="platform-role-badges">{memberRoles[member.membership_id]?.primary && <span className="primary">প্রধান ম্যানেজার</span>}{memberRoles[member.membership_id]?.assistant && <span className="assistant">সহকারী ম্যানেজার</span>}{memberRoles[member.membership_id] && !memberRoles[member.membership_id].primary && !memberRoles[member.membership_id].assistant && <span>সাধারণ সদস্য</span>}</div><small>{member.phone||'ফোন নেই'} · যোগদান {member.joined_at?new Date(member.joined_at).toLocaleDateString():'—'}</small>{member.email && <small className="platform-member-email">{member.email}</small>}<small className="platform-hostel-id">{member.user_id}</small><div className="platform-member-flags">{member.is_favorite&&<span>⭐ পছন্দের</span>}{member.is_trusted&&<span>✓ বিশ্বস্ত</span>}{member.is_blocked&&<span className="blocked-flag">ব্লক করা</span>}</div></div>
            <div className="platform-member-actions"><span className={`platform-status ${member.status==='active'?'status-active':'status-inactive'}`}>{member.status==='active'?'সক্রিয়':'নিষ্ক্রিয়'}</span><div className="platform-member-action-buttons"><button className={member.is_favorite?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="পছন্দের চিহ্ন" onClick={()=>toggleMemberFlag(member,'favorite')}>⭐</button><button className={member.is_trusted?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="বিশ্বস্ত চিহ্ন" onClick={()=>toggleMemberFlag(member,'trusted')}>✓</button><button className={member.is_blocked?'secondary-button':'danger-button'} disabled={busy||member.user_id===user?.id} type="button" onClick={()=>toggleBlock(member)}>{member.is_blocked?'আনব্লক':'ব্লক'}</button><button className="secondary-button compact" disabled={busy||recoveryBusy||member.user_id===user?.id} type="button" onClick={()=>{setRecoveryTarget(member);setRecoveryResult('');setRecoveryNote('');setRecoveryVerified(false);}}>পাসওয়ার্ড সহায়তা</button><button className="danger-button" disabled={busy||member.user_id===user?.id} type="button" onClick={() => { setDeleteDialog({kind:'member', member}); setDeleteConfirmation(''); setDeleteAccounts(false); setError(''); }}>স্থায়ী ডিলিট</button></div></div>
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
      <div className="platform-action-row"><button type="button" className="primary-button" disabled={recoveryBusy||recoveryCheckBusy||!recoveryVerified||recoveryNote.trim().length<5||Boolean(recoveryResult)} onClick={issueTemporaryPassword}>{recoveryBusy?'তৈরি হচ্ছে...':'অস্থায়ী পাসওয়ার্ড তৈরি'}</button><button type="button" className="secondary-button" disabled={recoveryBusy||recoveryCheckBusy} onClick={checkTemporaryPasswordFunction}>{recoveryCheckBusy?'যাচাই হচ্ছে...':'Function সংযোগ পরীক্ষা'}</button><button type="button" className="secondary-button" onClick={()=>{setRecoveryTarget(null);setRecoveryResult('');setRecoveryNote('');}}>বন্ধ করুন</button></div>
      {recoveryResult && <div className="platform-generated-code"><strong>একবার দেখানো অস্থায়ী পাসওয়ার্ড</strong><code>{recoveryResult}</code><p>এটি নিরাপদ মাধ্যমে শুধু সংশ্লিষ্ট ব্যবহারকারীকে দিন। এখানে বা নোটিফিকেশনে সংরক্ষণ করবেন না। ব্যবহারকারী লগইন করলে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।</p><button type="button" className="secondary-button" onClick={()=>setRecoveryResult('')}>পাসওয়ার্ড স্ক্রিন থেকে সরান</button></div>}
    </section>}
    {tab === 'settings' && <form className="platform-settings-grid" onSubmit={saveSettings}>
      <section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Global announcement</h3><p>ড্যাশবোর্ডের ওপরে সবার জন্য ব্যানার নোটিশ</p></div></div><label className="platform-toggle"><span><strong>নোটিশ চালু</strong><small>চালু থাকলে অ্যাপের ব্যবহারকারীরা ব্যানার দেখবেন</small></span><input type="checkbox" checked={Boolean(settings.announcement_enabled)} onChange={(e)=>setSettings((old)=>({...old,announcement_enabled:e.target.checked}))}/></label><Field label="নোটিশ শিরোনাম" value={settings.announcement_title} onChange={(v)=>setSettings((old)=>({...old,announcement_title:v}))} maxLength={160}/><Field label="নোটিশের বিবরণ" value={settings.announcement_body} onChange={(v)=>setSettings((old)=>({...old,announcement_body:v}))} maxLength={3000} multiline/></section>
      <section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Developer Info</h3><p>তথ্য ও ছবি Supabase-এ সংরক্ষণ হবে</p></div></div><Field label="নাম" value={settings.developer_name} onChange={(v)=>setSettings((old)=>({...old,developer_name:v}))} maxLength={160}/><Field label="পরিচয় / পদবি" value={settings.developer_title} onChange={(v)=>setSettings((old)=>({...old,developer_title:v}))} maxLength={240}/>
        <div className="developer-photo-uploader"><div className="developer-photo-preview">{settings.developer_photo_url?<img src={settings.developer_photo_url} alt="Developer preview"/>:<span><Icon name="camera" size={24}/></span>}</div><div className="developer-photo-copy"><strong>Developer-এর ছবি</strong><small>JPG / PNG / WEBP · সর্বোচ্চ ৫ MB। আপলোড করলে Supabase Storage-এ ফাইল থাকবে।</small><input ref={developerPhotoInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handleDeveloperPhoto}/><button type="button" className="secondary-button compact" disabled={developerPhotoBusy||busy} onClick={()=>developerPhotoInputRef.current?.click()}><Icon name="camera" size={15}/>{developerPhotoBusy?'আপলোড হচ্ছে...':'ছবি আপলোড করুন'}</button></div></div>
        <Field label="ছবির Storage URL" value={settings.developer_photo_url} onChange={(v)=>setSettings((old)=>({...old,developer_photo_url:v}))} maxLength={1000}/><Field label="ইমেইল" type="email" value={settings.developer_email} onChange={(v)=>setSettings((old)=>({...old,developer_email:v}))} maxLength={240}/><Field label="ফোন" value={settings.developer_phone} onChange={(v)=>setSettings((old)=>({...old,developer_phone:v}))} maxLength={80}/><Field label="Portfolio URL" value={settings.developer_portfolio_url} onChange={(v)=>setSettings((old)=>({...old,developer_portfolio_url:v}))} maxLength={1000}/></section>
      <div className="platform-settings-footer"><button className="primary-button large" type="submit" disabled={busy||developerPhotoBusy}>{busy?'সংরক্ষণ হচ্ছে...':'সব সেটিংস সংরক্ষণ করুন'}</button></div>
    </form>}
    {tab === 'hostels' && <section className="card platform-panel" aria-label="মেস-বিহীন Auth account">
      <div className="platform-panel-heading"><div><h3>মেস-বিহীন Auth account</h3><p>প্রতি ধাপে সর্বোচ্চ ৫০০টি Auth account পরীক্ষা হয়। কোনো account-এর যেকোনো membership row থাকলে নিরাপত্তার জন্য সেটি এখানে দেখানো হবে না।</p></div><button className="secondary-button compact" disabled={orphanBusy} type="button" onClick={()=>loadOrphanAccounts(1)}>তালিকা রিফ্রেশ</button></div>
      {orphanError && <p role="alert" className="inline-error">{orphanError}</p>}
      {orphanScanInfo && <p className="platform-retention-hint">{orphanScanInfo.message} {orphanScanInfo.scannedUsers ? `· ${orphanScanInfo.scannedUsers.toLocaleString('en-US')}টি account পরীক্ষা · Auth পৃষ্ঠা ${orphanScanInfo.authPageStart}–${orphanScanInfo.authPageEnd}` : ''}{orphanScanInfo.requestId ? ` · Request ID: ${orphanScanInfo.requestId}` : ''}</p>}
      {orphanAccounts.length===0 && <p className="platform-empty">{orphanScanInfo ? (orphanMore ? 'এই ধাপে মেস-বিহীন account পাওয়া যায়নি। আরও Auth account পরীক্ষা করতে “পরের ধাপ” চাপুন।' : 'Auth তালিকার শেষ পর্যন্ত পরীক্ষা হয়েছে। এই পরীক্ষিত account-গুলোর মধ্যে নিরাপদে মুছে ফেলার যোগ্য মেস-বিহীন account পাওয়া যায়নি।') : 'তালিকা দেখতে “তালিকা রিফ্রেশ” চাপুন।'}</p>}
      <div className="platform-retention-list">{orphanAccounts.map(account=><div className="platform-retention-row" key={account.id}><div><strong>{account.email || 'ইমেইল নেই'}</strong><small>{account.id}</small></div><button type="button" className="danger-button" disabled={orphanBusy} onClick={()=>removeOrphanAccount(account)}>Auth স্থায়ী ডিলিট</button></div>)}</div>
      <div className="platform-action-row"><button type="button" className="secondary-button compact" disabled={orphanBusy || orphanPage===1} onClick={()=>loadOrphanAccounts(orphanPage-1)}>আগের পৃষ্ঠা</button><span>ধাপ {orphanPage} · প্রতিটি ধাপে সর্বোচ্চ ৫০০ account</span><button type="button" className="secondary-button compact" disabled={orphanBusy || !orphanMore} onClick={()=>loadOrphanAccounts(orphanPage+1)}>পরের ধাপ</button></div>
      <p className="platform-retention-hint">মেস থেকে সরানোর পর Auth মুছতে এই অপশন। যাচাই না করে ডিলিট করবেন না; নতুন নিবন্ধিত কিন্তু এখনও মেসে যোগ না দেওয়া account-ও এখানে থাকতে পারে।</p>
    </section>}
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
      <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>সব বন্ধ মাস ({closedPeriods.length})</h3><p>এখানে বন্ধ হওয়া সব মাস দেখাবে, মেয়াদ শেষ না হলেও। ১–২ দিনের মাসও থাকবে। এই তালিকা থেকে মুছে ফেলার অনুমতি নেই।</p></div></div>
        {closedPeriods.length===0 ? <p className="platform-empty">বন্ধ মাস নেই অথবা তালিকা লোড হয়নি।</p> : <div className="platform-retention-list">{closedPeriods.map(row=><div className="platform-retention-row" key={row.period_id}><div><strong>{row.hostel_name} · {row.period_label}</strong><small>{row.start_date} — {row.end_date}</small><small>বিস্তারিত সংরক্ষণ: {row.detail_until} পর্যন্ত · ডিলিটের যোগ্যতা: {row.delete_eligible_after}-এর পর</small></div><span className="platform-status">শুধু দেখুন</span></div>)}</div>}
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
    {tab === 'security' && <>
      <section className="platform-settings-grid">
        <div className="card platform-panel">
          <div className="platform-panel-heading"><div><h3>Permission code controls</h3><p>নতুন কোড তৈরি হলে আগের কোড একই purpose-এ সঙ্গে সঙ্গে বাতিল হবে।</p></div></div>
          <label className="platform-toggle"><span><strong>নতুন অ্যাকাউন্টে কোড বাধ্যতামূলক</strong><small>Registration page-এ কোড চাইবে</small></span><input type="checkbox" checked={Boolean(settings.registration_code_required)} disabled={busy} onChange={(e)=>changeGate('registration',e.target.checked)}/></label>
          <label className="platform-toggle"><span><strong>মেস তৈরিতে কোড বাধ্যতামূলক</strong><small>নতুন মেস তৈরির আগে কোড যাচাই হবে</small></span><input type="checkbox" checked={Boolean(settings.hostel_creation_code_required)} disabled={busy} onChange={(e)=>changeGate('hostel_creation',e.target.checked)}/></label>
          <Field label="কোডের মেয়াদ (মিনিট, ৫–১০০৮০)" type="number" value={ttl} onChange={setTtl}/>
          <Field label="সর্বোচ্চ ব্যবহার (১–১০০০)" type="number" value={maxUses} onChange={setMaxUses}/>
          <div className="platform-code-buttons"><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('registration')}>Registration code তৈরি</button><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('hostel_creation')}>Hostel creation code তৈরি</button></div>
          {generated&&<div className="platform-generated-code"><small>{generated.purpose==='registration'?'Registration':'Hostel creation'} · মেয়াদ {formatPlatformDate(generated.expires_at)}</small><code>{generated.code}</code><button className="primary-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(generated.code);setNotice('কোড কপি হয়েছে।');}catch{setNotice('কপি করা যায়নি—কোডটি হাতে কপি করুন।');}}}>কোড কপি করুন</button><p>এটি এখন একবারই দেখানো হয়েছে। নিরাপদ স্থানে রাখুন এবং সাধারণ নোটিশে প্রকাশ করবেন না।</p></div>}
        </div>
        <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>Security rules</h3><p>Role ও অ্যাক্সেস কোড</p></div></div><ul className="platform-security-list"><li>সাধারণ সাইন-আপের role সবসময় <code>user</code> হবে।</li><li>Super Admin role শুধু project owner Supabase SQL Editor থেকে সেট করবেন।</li><li>প্রতিটি admin RPC ডাটাবেজেই Super Admin role যাচাই করে।</li><li>কোডের আসল মান বা hash ইতিহাসে দেখানো হয় না।</li></ul></div>
      </section>
      <section className="card platform-panel platform-code-history-panel">
        <div className="platform-panel-heading"><div><h3>Access Code History</h3><p>আগে তৈরি হওয়া কোডের মেয়াদ, ব্যবহার ও বাতিলের অবস্থা। আসল কোড বা Hash কখনো দেখানো হয় না।</p></div><button type="button" className="secondary-button compact" disabled={codeHistoryLoading} onClick={loadCodeHistory}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
        <div className="platform-code-history-toolbar"><label className="field-label"><span>কোডের ধরন</span><select value={codeHistoryPurpose} onChange={(event)=>{setCodeHistoryPage(0);setCodeHistoryPurpose(event.target.value);}}><option value="all">সব কোড</option><option value="registration">Registration</option><option value="hostel_creation">মেস তৈরি</option></select></label></div>
        {codeHistoryError && <div className="inline-error platform-alert">{codeHistoryError}</div>}
        {codeHistoryLoading ? <div className="platform-empty"><LoadingSpinner label="কোডের ইতিহাস লোড হচ্ছে..."/></div> : codeHistoryRows.length === 0 ? <div className="platform-empty-state"><Icon name="lock" size={26}/><strong>কোনো কোডের ইতিহাস নেই</strong><span>নতুন কোড তৈরি হলে সেটির ইতিহাস এখানে দেখা যাবে।</span></div> : <div className="platform-code-history-list">{codeHistoryRows.map((row)=><article className="platform-code-history-item" key={row.id}>
          <div className="platform-audit-top"><div><strong>{codePurposeLabel(row.purpose)}</strong><small>তৈরি করেছেন: {row.created_by_name || 'অজানা অ্যাকাউন্ট'}</small></div><span className={`platform-code-state state-${row.status}`}>{codeStatusLabel(row.status)}</span></div>
          <div className="platform-code-history-metrics"><span>ব্যবহার <b>{Number(row.use_count)||0} / {Number(row.max_uses)||0}</b></span><span>তৈরি <b>{formatPlatformDate(row.created_at)}</b></span><span>মেয়াদ <b>{formatPlatformDate(row.expires_at)}</b></span>{row.revoked_at && <span>বাতিল <b>{formatPlatformDate(row.revoked_at)}</b></span>}</div>
        </article>)}</div>}
        <div className="platform-history-pager"><span>{codeHistoryTotal.toLocaleString('bn-BD')}টি কোড · পৃষ্ঠা {codeHistoryTotal ? codeHistoryPage + 1 : 0} / {Math.max(1,Math.ceil(codeHistoryTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={codeHistoryLoading || codeHistoryPage===0} onClick={()=>setCodeHistoryPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={codeHistoryLoading || (codeHistoryPage+1)*pageSize>=codeHistoryTotal} onClick={()=>setCodeHistoryPage(value=>value+1)}>পরের</button></div></div>
      </section>
    </>}
     {deleteDialog && selected && (() => {
      const member = deleteDialog.kind === 'member' ? deleteDialog.member : null;
      const required = member ? `DELETE MEMBER ${member.user_id}` : `DELETE HOSTEL ${selected.hostel_id}`;
      return <div className="modal-backdrop" role="presentation"><section className="card platform-delete-dialog" role="dialog" aria-modal="true" aria-label="স্থায়ী ডিলিট নিশ্চিতকরণ">
        <div className="modal-head"><div><span className="eyebrow">Super Admin · অপরিবর্তনীয় কাজ</span><h2>স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ</h2></div><button className="icon-button" type="button" disabled={busy} aria-label="বন্ধ করুন" onClick={() => setDeleteDialog(null)}><Icon name="x" size={19}/></button></div>
        <p className="platform-delete-warning">{member ? `“${member.full_name || 'সদস্য'}”-এর মেস-সম্পর্কিত সব ডেটা স্থায়ীভাবে মুছে যাবে।` : `“${selected.name}” মেস এবং তার সব সদস্য, মিল ও আর্থিক ডেটা স্থায়ীভাবে মুছে যাবে।`} এই পরিবর্তন ফেরানো যাবে না। আগে ব্যাকআপ নিশ্চিত করুন।</p>
        <label className="platform-toggle platform-delete-auth-toggle">
          <span>
            <strong>{member ? 'সদস্যের Auth লগইন অ্যাকাউন্টও মুছুন' : 'এই মেসের সদস্যদের Auth account-ও মুছুন'}</strong>
            <small>{member ? 'অন্য মেসে যুক্ত থাকলে বা সুরক্ষিত অ্যাকাউন্ট হলে সেটি অক্ষত থাকবে।' : (memberListLoadedHostelId === selected.hostel_id ? `${members.length}টি সদস্য-রেকর্ডের account server-side যাচাই করা হবে। অন্য মেসে যুক্ত বা Super Admin account মুছবে না।` : 'সদস্য তালিকা যাচাই না হওয়া পর্যন্ত এই বিকল্প ব্যবহার করা যাবে না।')}</small>
          </span>
          <input type="checkbox" checked={Boolean(deleteAccounts)} onChange={event => setDeleteAccounts(event.target.checked)} disabled={busy || (!member && memberListLoadedHostelId !== selected.hostel_id)}/>
        </label>
        <label className="field-label"><span>নিচের বাক্যটি হুবহু লিখুন</span><code className="platform-delete-phrase">{required}</code><input type="text" autoComplete="off" spellCheck={false} value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder="DELETE ..." disabled={busy}/></label>
        {error && <div className="inline-error">{error}</div>}
        <div className="confirm-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setDeleteDialog(null)}>বাতিল</button><button className="danger-button" type="button" disabled={busy || deleteConfirmation.trim() !== required} onClick={() => member ? permanentlyDeleteMember(member) : permanentlyDeleteHostel()}>{busy ? 'মুছে ফেলা হচ্ছে...' : 'বুঝেছি, স্থায়ীভাবে মুছুন'}</button></div>
      </section></div>;
    })()}
    <footer className="platform-footer">Hostel Life · Platform administration · Access is enforced by database functions.</footer>
  </main>;
}
