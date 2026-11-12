import { confirmAction, confirmTypedAction } from '../../utils/actionDialogs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { TelegramLogo } from '../../components/TelegramLogo';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { SearchableSelect } from '../../components/SearchableSelect';
import { supabase } from '../../lib/supabase';
import { verifyPassword } from '../../services/authService';
import { normalizePlatformOverview } from '../../utils/platformOverview';
import { buildPlatformReportCsv, getPlatformReportFilename } from '../../utils/platformReportCsv';
import {
  fetchPlatformPublicSettings, platformAdminGenerateAccessCode, platformAdminGetOverview,
  platformAdminListHostelMembers, platformAdminListHostelRoleBadges, platformAdminListHostels, platformAdminSetGate,
  platformAdminSetHostelStatus, platformAdminSetUserBlocked, platformAdminUpdatePublicSettings,
  platformAdminSetDefaultTheme, platformAdminGetSessionPolicy, platformAdminSetSessionPolicy,
  platformAdminSetHostelFlag, platformAdminSetUserFlag, platformAdminPermanentlyDeleteHostel,
  platformAdminPermanentlyDeleteMember, uploadDeveloperPhoto,
  platformAdminListClosedPeriods, platformAdminGetRetention, platformAdminUpdateRetention,
  platformAdminListExpiredArchives, platformAdminDeleteExpiredArchive,
  platformAdminFinalizeArchiveSummary, platformAdminVerifyArchiveSummary, platformAdminListSavedSummaries,
  platformAdminListAuditLogs, platformAdminListAccessCodeHistory, platformAdminGetHostelInsights,
  platformAdminGetSystemHealth, platformAdminGetDatabaseRuntimeHealth, platformAdminListNoticeMonitoring, platformAdminGetPlatformReport,
  platformAdminListActivity, platformAdminListActivityV2, platformAdminGetMemberActivityOverview, platformAdminListMemberActivity, platformAdminListMemberSessions,
  platformAdminGetSecurityOverview, platformAdminListSecurityEvents, platformAdminGetSecurityOverviewV2, platformAdminListSecurityEventsV4, platformAdminListSecurityIpBlocks, platformAdminCheckSecurityTelemetry,
  platformAdminGetSecurityAnalytics30d, platformAdminAddSecurityIpBlock, platformAdminReleaseSecurityIpBlock,
  platformAdminListActiveSessions, platformAdminRevokeActiveSession,
  platformAdminGetNotificationSettings, platformAdminUpdateNotificationSettings, platformAdminSendTargetedMessage,
  platformAdminGetTelegramDeliveryHealth, platformAdminListTelegramDeliveryBatches, platformAdminGetTelegramWebhookStatus, platformAdminConfigureTelegramWebhook,
  platformAdminListTelegramConnections, platformAdminDisconnectTelegramUser,
  platformAdminGetCommunications, platformAdminSaveCommunications, uploadPlatformNoticeImage,
} from '../../services/platformService';

const EMPTY_SETTINGS = {
  announcement_enabled: false, announcement_title: '', announcement_body: '',
  registration_code_required: false, hostel_creation_code_required: false,
  developer_name: '', developer_title: '', developer_photo_url: '', developer_email: '',
  developer_phone: '', developer_portfolio_url: '', default_theme: 'dark', max_devices_per_user: 10, session_timeout_minutes: 0,
};

const EMPTY_COMMUNICATION_DRAFT = {
  release_notes_text: '',
  release_notes_published: false,
  window_notice: { enabled: false, title: '', body: '', starts_at: '', ends_at: '', frequency: 'once_per_device' },
  site_notice: { enabled: false, mode: 'message', title: '', body: '', starts_at: '', ends_at: '', frequency: 'once_per_device' },
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
  const diagnostics = [];
  if (payload?.stage) diagnostics.push(`ধাপ: ${payload.stage}`);
  if (payload?.upstream_http_status) diagnostics.push(`টেলিগ্রাম HTTP:  ${payload.upstream_http_status}`);
  if (payload?.telegram_error_code) diagnostics.push(`টেলিগ্রাম ত্রুটি কোড: ${payload.telegram_error_code}`);
  if (payload?.kind === 'telegram_network') diagnostics.push('ধরন: Network/Timeout');
  if (payload?.hint) diagnostics.push(payload.hint);
  if (Array.isArray(payload?.missing) && payload.missing.length) diagnostics.push(`অনুপস্থিত Configuration: ${payload.missing.join(', ')}`);
  return [base, ...diagnostics, status ? `Edge Function HTTP: ${status}` : '', requestId ? `Request ID: ${requestId}` : ''].filter(Boolean).join(' · ');
}

function Field({ label, value, onChange, type = 'text', maxLength, multiline = false }) {
  return <label className="field-label platform-field"><span>{label}</span>{multiline
    ? <textarea rows={4} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    : <input type={type} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}</label>;
}
function DateTimeField({ id, label, value, onChange, min }) {
  const setCurrentTime = () => onChange(toDhakaDateTimeInput(new Date()));
  return (
    <div className="field-label platform-field platform-datetime-field">
      <div className="platform-datetime-label-row"><label htmlFor={id}>{label}</label><small>বাংলাদেশ সময় · UTC+06:00</small></div>
      <div className="platform-datetime-control">
        <input id={id} type="datetime-local" step="60" value={value || ''} min={min || undefined} onChange={(event) => onChange(event.target.value)} />
        <div className="platform-datetime-actions">
          <button type="button" className="secondary-button compact" onClick={setCurrentTime} title="বর্তমান বাংলাদেশ সময় বসান">এখন</button>
          <button type="button" className="text-button platform-datetime-clear" onClick={() => onChange('')} disabled={!value}>মুছুন</button>
        </div>
      </div>
    </div>
  );
}
function Stat({ label, value, icon, onClick, active = false }) {
  const content = <><span className="platform-stat-icon"><Icon name={icon} size={20}/></span><div><small>{label}</small><strong>{value === undefined || value === null || value === '' ? '—' : Number(value).toLocaleString('bn-BD')}</strong>{onClick && <span className="platform-stat-action-hint">বিস্তারিত <Icon name="chevron-right" size={13}/></span>}</div></>;
  return onClick
    ? <button type="button" className={`platform-stat platform-stat-action${active ? ' is-active' : ''}`} onClick={onClick}>{content}</button>
    : <div className="platform-stat">{content}</div>;
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
function timeZoneOffsetMinutes(date, timeZone = 'Asia/Dhaka') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  return Math.round((representedAsUtc - date.getTime()) / 60000);
}
function toDhakaDateTimeInput(date) {
  const shifted = new Date(date.getTime() + timeZoneOffsetMinutes(date) * 60000);
  return shifted.toISOString().slice(0, 16);
}
function fromDhakaDateTimeInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let timestamp = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMinutes(new Date(timestamp));
    const next = localAsUtc - offset * 60000;
    if (next === timestamp) break;
    timestamp = next;
  }
  return new Date(timestamp);
}
function addCalendarDaysToDateInput(value, days = 1) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match || !Number.isInteger(days) || Math.abs(days) > 366) return '';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function presenceLabel(member) {
  if (!member?.last_seen_at) return 'সক্রিয়তার তথ্য নেই';
  return member.is_online ? 'সাম্প্রতিক সক্রিয়' : 'এখন সক্রিয় নয়';
}
const ACTIVITY_EVENT_LABELS = {
  'auth.login': 'সফল লগইন', 'auth.logout': 'লগআউট', 'notification.sent': 'নোটিফিকেশন পাঠানো হয়েছে', 'profiles.update': 'প্রোফাইল তথ্য পরিবর্তন',
  'membership.insert': 'সদস্য যুক্ত হয়েছে', 'membership.update': 'সদস্যপদ পরিবর্তন', 'membership.delete': 'সদস্যপদ মুছে ফেলা',
  'period.insert': 'নতুন মাস তৈরি', 'period.update': 'মাসের সেটিংস পরিবর্তন', 'period.delete': 'মাস মুছে ফেলা',
  'meal_day.insert': 'মিলের দিন তৈরি', 'meal_day.update': 'মিলের দিনের অবস্থা পরিবর্তন', 'meal_day.delete': 'মিলের দিন মুছে ফেলা',
  'meal_record.insert': 'মিল রেকর্ড তৈরি', 'meal_record.update': 'মিল রেকর্ড পরিবর্তন', 'meal_record.delete': 'মিল রেকর্ড মুছে ফেলা',
  'meal_request.insert': 'মিল অনুরোধ তৈরি', 'meal_request.update': 'মিল অনুরোধ পর্যালোচনা/পরিবর্তন', 'meal_request.delete': 'মিল অনুরোধ মুছে ফেলা',
  'market_entry.insert': 'বাজার এন্ট্রি তৈরি', 'market_entry.update': 'বাজার এন্ট্রি পরিবর্তন', 'market_entry.delete': 'বাজার এন্ট্রি মুছে ফেলা',
  'market_item.insert': 'বাজারের আইটেম যোগ', 'market_item.update': 'বাজারের আইটেম পরিবর্তন', 'market_item.delete': 'বাজারের আইটেম বাদ',
  'ledger_entry.insert': 'হিসাব এন্ট্রি তৈরি', 'ledger_entry.update': 'হিসাব এন্ট্রি পরিবর্তন', 'ledger_entry.delete': 'হিসাব এন্ট্রি মুছে ফেলা',
  'khala_payment.insert': 'খালার টাকা এন্ট্রি', 'khala_payment.update': 'খালার টাকা এন্ট্রি পরিবর্তন', 'khala_payment.delete': 'খালার টাকা এন্ট্রি মুছে ফেলা',
  'assistant_manager.insert': 'সহকারী ম্যানেজার নিযুক্ত', 'assistant_manager.delete': 'সহকারী ম্যানেজার বাতিল',
  'archive_permission.insert': 'আর্কাইভ সম্পাদনার অনুমতি', 'archive_permission.update': 'আর্কাইভ অনুমতি পরিবর্তন', 'archive_permission.delete': 'আর্কাইভ অনুমতি বাতিল',
};
const ARCHIVE_ACTIVITY_LABELS = {
  'archive.insert:market_entry': 'বাজার এন্ট্রি যোগ',
  'archive.update:market_entry': 'বাজার এন্ট্রি সংশোধন',
  'archive.update:market_void': 'বাজার এন্ট্রি বাতিল',
  'archive.insert:deposit': 'সদস্যের জমা যোগ',
  'archive.insert:other_expense': 'অন্যান্য খরচ যোগ',
  'archive.update:transaction': 'হিসাব সংশোধন',
  'archive.insert:khala_money': 'খালার টাকা এন্ট্রি',
  'archive.update:khala_void': 'খালার টাকা এন্ট্রি বাতিল',
  'archive.update:meal_request': 'মিল অনুরোধ সংশোধন',
  'archive.update:correction_approved': 'মিল সংশোধন অনুমোদন',
  'archive.update:correction_rejected': 'মিল সংশোধন প্রত্যাখ্যান',
  'archive.update:late_meal_approved': 'লেট মিল অনুমোদন',
  'archive.update:late_meal_rejected': 'লেট মিল প্রত্যাখ্যান',
  'archive.update:manager_meal_edit': 'ম্যানেজারের মিল সম্পাদনা',
  'archive.update:emergency_override': 'জরুরি মিল পরিবর্তন',
  'archive.update:final_meal': 'চূড়ান্ত মিল সংশোধন',
};
function activityEventLabel(eventType) {
  if (ACTIVITY_EVENT_LABELS[eventType]) return ACTIVITY_EVENT_LABELS[eventType];
  if (ARCHIVE_ACTIVITY_LABELS[eventType]) return ARCHIVE_ACTIVITY_LABELS[eventType];
  if (String(eventType || '').startsWith('platform.')) {
    const action = String(eventType).slice(9);
    return AUDIT_ACTION_LABELS[action] || `প্রশাসনিক কাজ · ${action.replaceAll('_', ' ')}`;
  }
  if (String(eventType || '').startsWith('archive.')) return 'আর্কাইভ কার্যক্রম';
  return String(eventType || 'অন্যান্য কার্যক্রম').replaceAll('.', ' · ').replaceAll('_', ' ');
}
function securityEventLabel(eventType) {
  return ({ login_failed: 'ব্যর্থ লগইন চেষ্টা', login_success: 'সফল Login', signup_failed: 'ব্যর্থ রেজিস্ট্রেশন', signup_submitted: 'রেজিস্ট্রেশন অনুরোধ জমা', signup_verified: 'ইমেইল OTP যাচাই সম্পন্ন', signup_otp_resend: 'ইমেইল OTP পুনরায় পাঠানোর অনুরোধ', password_reset_failed: 'ব্যর্থ পাসওয়ার্ড রিসেট', password_reset_requested: 'Reset email পাঠানোর অনুরোধ গ্রহণ' })[eventType] || eventType || 'অন্যান্য';
}
function activityChangedFields(metadata) {
  const fields = Array.isArray(metadata?.changed_fields) ? metadata.changed_fields : [];
  const labels = {
    status: 'স্ট্যাটাস', role: 'ভূমিকা', primary_manager_membership_id: 'প্রধান ম্যানেজার',
    end_date: 'শেষ তারিখ', start_date: 'শুরুর তারিখ', actual_breakfast: 'সকালের মিল', actual_lunch: 'দুপুরের মিল',
    actual_dinner: 'রাতের মিল', planned_breakfast: 'সকালের পরিকল্পনা', planned_lunch: 'দুপুরের পরিকল্পনা',
    planned_dinner: 'রাতের পরিকল্পনা', final_breakfast: 'চূড়ান্ত সকালের মিল', final_lunch: 'চূড়ান্ত দুপুরের মিল',
    final_dinner: 'চূড়ান্ত রাতের মিল', entry_date: 'এন্ট্রির তারিখ', total_amount: 'মোট পরিমাণ',
    amount: 'পরিমাণ', ledger_type: 'হিসাবের ধরন', buyer_membership_id: 'ক্রেতা', membership_id: 'সদস্য',
    revoked_at: 'অনুমতি বাতিল', expires_at: 'মেয়াদ',
  };
  return fields.map((field) => labels[field] || field.replaceAll('_', ' ')).join(' · ');
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

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes.toLocaleString('bn-BD')} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toLocaleString('bn-BD', { maximumFractionDigits: 2 })} ${units[index]}`;
}

function toWhatsAppUrl(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('0')) digits = `88${digits}`;
  if (digits.length < 10 || digits.length > 15) return '';
  return `https://wa.me/${digits}`;
}

function toTelegramUrl(username) {
  const value = String(username || '').replace(/^@/, '').trim();
  return /^[A-Za-z0-9_]{5,32}$/.test(value) ? `https://t.me/${value}` : '';
}

function communicationRowToDraft(row) {
  const dateInput = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? toDhakaDateTimeInput(date) : '';
  };
  return {
    release_notes_text: Array.isArray(row?.release_notes) ? row.release_notes.join('\n') : '',
    release_notes_published: Boolean(row?.release_notes_published),
    window_notice: {
      enabled: Boolean(row?.window_notice_enabled),
      title: row?.window_notice_title || '',
      body: row?.window_notice_body || '',
      starts_at: dateInput(row?.window_notice_starts_at),
      ends_at: dateInput(row?.window_notice_ends_at),
      frequency: row?.window_notice_frequency || 'once_per_device',
    },
    site_notice: {
      enabled: Boolean(row?.site_notice_enabled),
      mode: row?.site_notice_mode || 'message',
      title: row?.site_notice_title || '',
      body: row?.site_notice_body || '',
      starts_at: dateInput(row?.site_notice_starts_at),
      ends_at: dateInput(row?.site_notice_ends_at),
      frequency: row?.site_notice_frequency || 'once_per_device',
      image_url: row?.site_notice_image_url || '',
      image_path: row?.site_notice_image_path || '',
      image_updated_at: row?.site_notice_image_updated_at || '',
    },
  };
}

export function SuperAdminPage({ user }) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [gateError, setGateError] = useState('');
  const [password, setPassword] = useState('');
  const [reauthEmailVisible, setReauthEmailVisible] = useState(false);
  const [reauthenticated, setReauthenticated] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [mfaStage, setMfaStage] = useState('idle');
  const [mfaFactors, setMfaFactors] = useState([]);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaQrCode, setMfaQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFriendlyName, setMfaFriendlyName] = useState('Hostel Life Super Admin');
  const [mfaPurpose, setMfaPurpose] = useState('primary');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState('');
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsSavedRef = useRef(null);
  const [sessionPolicyLoaded, setSessionPolicyLoaded] = useState(false);
  const [defaultThemeBusy, setDefaultThemeBusy] = useState(false);
  const [deviceLimitBusy, setDeviceLimitBusy] = useState(false);
  const [activeSessions, setActiveSessions] = useState([]);
  const [activeSessionTotal, setActiveSessionTotal] = useState(0);
  const [activeSessionSearchDraft, setActiveSessionSearchDraft] = useState('');
  const [activeSessionSearch, setActiveSessionSearch] = useState('');
  const [activeSessionPage, setActiveSessionPage] = useState(0);
  const [activeSessionLoading, setActiveSessionLoading] = useState(false);
  const [activeSessionError, setActiveSessionError] = useState('');
  const [activeSessionBusyRef, setActiveSessionBusyRef] = useState('');
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
  const [communicationsDraft, setCommunicationsDraft] = useState(EMPTY_COMMUNICATION_DRAFT);
  const communicationsSavedDraftRef = useRef(null);
  const [communicationsLoading, setCommunicationsLoading] = useState(false);
  // The blank draft is never considered safe to save until the server row loaded successfully.
  const [communicationsLoaded, setCommunicationsLoaded] = useState(false);
  const [communicationsBusy, setCommunicationsBusy] = useState(false);
  const [communicationsError, setCommunicationsError] = useState('');
  const [communicationsImageBusy, setCommunicationsImageBusy] = useState(false);
  const communicationsImageInputRef = useRef(null);
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
  const [orphanSelectedIds, setOrphanSelectedIds] = useState([]);
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
  const [activityView, setActivityView] = useState('timeline');
  const [activityRows, setActivityRows] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(0);
  const [activityHostelFilter, setActivityHostelFilter] = useState('all');
  const [activityEventFilter, setActivityEventFilter] = useState('all');
  const [activityFromDate, setActivityFromDate] = useState('');
  const [activityToDate, setActivityToDate] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [securityOverview, setSecurityOverview] = useState(null);
  const [securityAnalytics30d, setSecurityAnalytics30d] = useState(null);
  const [securityRows, setSecurityRows] = useState([]);
  const [securityTotal, setSecurityTotal] = useState(0);
  const [securityPage, setSecurityPage] = useState(0);
  const [securityEventFilter, setSecurityEventFilter] = useState('all');
  const [securityIpSearchDraft, setSecurityIpSearchDraft] = useState('');
  const [securityIpSearch, setSecurityIpSearch] = useState('');
  const [securityFromDate, setSecurityFromDate] = useState('');
  const [securityToDate, setSecurityToDate] = useState('');
  const [securityIpBlocks, setSecurityIpBlocks] = useState([]);
  const [securityIpBlocksError, setSecurityIpBlocksError] = useState('');
  const [securityBlockIp, setSecurityBlockIp] = useState('');
  const [securityBlockScope, setSecurityBlockScope] = useState('both');
  const [securityBlockDuration, setSecurityBlockDuration] = useState('360');
  const [securityBlockReason, setSecurityBlockReason] = useState('');
  const [securityBlockBusy, setSecurityBlockBusy] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [securityTelemetryStatus, setSecurityTelemetryStatus] = useState(null);
  const [memberActivityTarget, setMemberActivityTarget] = useState(null);
  const [memberActivityOverview, setMemberActivityOverview] = useState(null);
  const [memberActivityRows, setMemberActivityRows] = useState([]);
  const [memberSessionRows, setMemberSessionRows] = useState([]);
  const [memberSessionTotal, setMemberSessionTotal] = useState(0);
  const [memberSessionPage, setMemberSessionPage] = useState(0);
  const [memberSessionLoading, setMemberSessionLoading] = useState(false);
  const [memberSessionError, setMemberSessionError] = useState('');
  const memberSessionRequestRef = useRef(0);
  const [memberActivityTotal, setMemberActivityTotal] = useState(0);
  const [memberActivityPage, setMemberActivityPage] = useState(0);
  const [memberActivityLoading, setMemberActivityLoading] = useState(false);
  const [memberActivityError, setMemberActivityError] = useState('');
  const memberActivityRequestRef = useRef(0);
  // Ignore late responses when filters, pages, or selected hostel change quickly.
  const refreshRequestRef = useRef(0);
  const hostelMembersRequestRef = useRef(0);
  const auditRequestRef = useRef(0);
  const activityRequestRef = useRef(0);
  const securityRequestRef = useRef(0);
  const codeHistoryRequestRef = useRef(0);
  const healthRequestRef = useRef(0);
  const noticeMonitorRequestRef = useRef(0);
  const retentionRequestRef = useRef(0);
  const reportRequestRef = useRef(0);
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
  const [databaseHealthData, setDatabaseHealthData] = useState(null);
  const [databaseHealthError, setDatabaseHealthError] = useState('');
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
  const [telegramAdminSettings, setTelegramAdminSettings] = useState({ active_provider: 'disabled', telegram_enabled: false, telegram_bot_username: '', connected_users: 0 });
  const [telegramAdminLoading, setTelegramAdminLoading] = useState(false);
  const [telegramAdminBusy, setTelegramAdminBusy] = useState(false);
  const [telegramAdminError, setTelegramAdminError] = useState('');
  const [telegramWebhookStatus, setTelegramWebhookStatus] = useState(null);
  const [telegramWebhookError, setTelegramWebhookError] = useState('');
  const [telegramWebhookBusy, setTelegramWebhookBusy] = useState(false);
  const [telegramDeliveryHealth, setTelegramDeliveryHealth] = useState(null);
  const [telegramDeliveryError, setTelegramDeliveryError] = useState('');
  const [telegramBatchError, setTelegramBatchError] = useState('');
  const [telegramDeliveryRows, setTelegramDeliveryRows] = useState([]);
  const [telegramDeliveryTotal, setTelegramDeliveryTotal] = useState(0);
  const [telegramDeliveryFilter, setTelegramDeliveryFilter] = useState('all');
  const [telegramDeliveryPage, setTelegramDeliveryPage] = useState(0);
  const [telegramDeliveryLoading, setTelegramDeliveryLoading] = useState(false);
  const [telegramConnections, setTelegramConnections] = useState([]);
  const [telegramConnectionSearchDraft, setTelegramConnectionSearchDraft] = useState('');
  const [telegramConnectionSearch, setTelegramConnectionSearch] = useState('');
  const [telegramConnectionPage, setTelegramConnectionPage] = useState(0);
  const [telegramConnectionTotal, setTelegramConnectionTotal] = useState(0);
  const [telegramConnectionLoading, setTelegramConnectionLoading] = useState(false);
  const [telegramConnectionError, setTelegramConnectionError] = useState('');
  const [telegramConnectionBusyUserId, setTelegramConnectionBusyUserId] = useState('');
  const [refreshingWorkspace, setRefreshingWorkspace] = useState(false);
  const [lastWorkspaceRefresh, setLastWorkspaceRefresh] = useState(null);
  const [healthSeverityFilter, setHealthSeverityFilter] = useState('all');
  const [healthIssueFilter, setHealthIssueFilter] = useState('all');
  const [messageHostelId, setMessageHostelId] = useState('');
  const [messageMembers, setMessageMembers] = useState([]);
  const [messageMembersLoading, setMessageMembersLoading] = useState(false);
  const [messageMembersError, setMessageMembersError] = useState('');
  const [messageRecipientMode, setMessageRecipientMode] = useState('all');
  const [messageSelectedUsers, setMessageSelectedUsers] = useState([]);
  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const messageMembersRequestRef = useRef(0);

  const pageSize = 20;

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    setBusy(true); setError('');
    setSettingsLoaded(false); settingsSavedRef.current = null; setSessionPolicyLoaded(false);
    const results = await Promise.allSettled([
      platformAdminGetOverview(), platformAdminListHostels(), fetchPlatformPublicSettings({ force: true }), platformAdminGetSessionPolicy(),
    ]);
    if (requestId !== refreshRequestRef.current) return;
    const failures = [];
    const [summary, allHostels, publicSettings, sessionPolicy] = results;
    if (summary.status === 'fulfilled') setOverview(summary.value || {});
    else failures.push(`Overview: ${errorText(summary.reason, 'তথ্য লোড হয়নি')}`);
    if (allHostels.status === 'fulfilled') setHostels(Array.isArray(allHostels.value) ? allHostels.value : []);
    else failures.push(`মেস তালিকা: ${errorText(allHostels.reason, 'তথ্য লোড হয়নি')}`);
    if (publicSettings.status === 'fulfilled') {
      const settingsValue = Array.isArray(publicSettings.value) ? publicSettings.value[0] : publicSettings.value || {};
      const nextSettings = {
        ...EMPTY_SETTINGS,
        ...settingsValue,
        max_devices_per_user: sessionPolicy.status === 'fulfilled'
          ? Number(sessionPolicy.value?.max_devices_per_user) || 10
          : EMPTY_SETTINGS.max_devices_per_user,
        session_timeout_minutes: sessionPolicy.status === 'fulfilled'
          ? Number(sessionPolicy.value?.session_timeout_minutes) || 0
          : EMPTY_SETTINGS.session_timeout_minutes,
      };
      setSettings(nextSettings);
      // Keep the last server-confirmed values so each Settings tab saves only its own fields.
      settingsSavedRef.current = { ...settingsValue };
      setSettingsLoaded(true);
    } else failures.push(`প্ল্যাটফর্ম সেটিংস: ${errorText(publicSettings.reason, 'তথ্য লোড হয়নি')}`);
    if (sessionPolicy.status === 'fulfilled') setSessionPolicyLoaded(true);
    else failures.push(`Device Policy: ${errorText(sessionPolicy.reason, 'তথ্য লোড হয়নি')}`);
    setError(failures.length ? `কিছু Super Admin তথ্য লোড হয়নি; সফল তথ্যগুলো ব্যবহার করা যাবে। ${failures.join(' · ')}` : '');
    setBusy(false);
  }, []);

  const loadAuditLog = useCallback(async () => {
    const requestId = ++auditRequestRef.current;
    setAuditLoading(true); setAuditError('');
    try {
      const result = await platformAdminListAuditLogs({
        limit: pageSize, offset: auditPage * pageSize,
        action: auditActionFilter === 'all' ? null : auditActionFilter,
        targetType: auditTargetFilter === 'all' ? null : auditTargetFilter,
        search: auditSearch || null,
      });
      if (requestId !== auditRequestRef.current) return;
      setAuditRows(Array.isArray(result?.items) ? result.items : []);
      setAuditTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      if (requestId === auditRequestRef.current) setAuditError(errorText(cause, 'Audit Log রিফ্রেশ করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    } finally { if (requestId === auditRequestRef.current) setAuditLoading(false); }
  }, [auditPage, auditActionFilter, auditTargetFilter, auditSearch]);

  const loadActivity = useCallback(async () => {
    const requestId = ++activityRequestRef.current;
    setActivityLoading(true); setActivityError('');
    try {
      const activityFrom = activityFromDate ? fromDhakaDateTimeInput(`${activityFromDate}T00:00`).toISOString() : null;
      const activityTo = activityToDate ? fromDhakaDateTimeInput(`${addCalendarDaysToDateInput(activityToDate)}T00:00`).toISOString() : null;
      const result = await platformAdminListActivityV2({
        hostelId: activityHostelFilter === 'all' ? null : activityHostelFilter,
        eventType: activityEventFilter === 'all' ? null : activityEventFilter,
        from: activityFrom, to: activityTo,
        limit: pageSize, offset: activityPage * pageSize,
      });
      if (requestId !== activityRequestRef.current) return;
      setActivityRows(Array.isArray(result?.items) ? result.items : []);
      setActivityTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      if (requestId === activityRequestRef.current) setActivityError(errorText(cause, 'Activity Log রিফ্রেশ করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    } finally { if (requestId === activityRequestRef.current) setActivityLoading(false); }
  }, [activityHostelFilter, activityEventFilter, activityPage, activityFromDate, activityToDate]);

  const loadSecurityMonitor = useCallback(async () => {
    const requestId = ++securityRequestRef.current;
    setSecurityLoading(true); setSecurityError(''); setSecurityTelemetryStatus(null); setSecurityIpBlocksError('');
    const securityFrom = securityFromDate ? fromDhakaDateTimeInput(`${securityFromDate}T00:00`).toISOString() : null;
    const securityTo = securityToDate ? fromDhakaDateTimeInput(`${addCalendarDaysToDateInput(securityToDate)}T00:00`).toISOString() : null;
    const results = await Promise.allSettled([
      platformAdminGetSecurityOverviewV2(),
      platformAdminGetSecurityAnalytics30d(),
      platformAdminListSecurityEventsV4({
        eventType: securityEventFilter === 'all' ? null : securityEventFilter,
        ipSearch: securityIpSearch || null,
        from: securityFrom, to: securityTo,
        limit: pageSize, offset: securityPage * pageSize,
      }),
      platformAdminCheckSecurityTelemetry(),
      platformAdminListSecurityIpBlocks({ limit: 30, offset: 0 }),
    ]);
    if (requestId !== securityRequestRef.current) return;
    const failures = [];
    const [overviewResult, analyticsResult, listResult, telemetryResult, blocksResult] = results;
    if (overviewResult.status === 'fulfilled') setSecurityOverview(overviewResult.value || {});
    else failures.push(`Security Summary: ${errorText(overviewResult.reason, 'লোড হয়নি')}`);
    if (analyticsResult.status === 'fulfilled') setSecurityAnalytics30d(analyticsResult.value || {});
    else failures.push(`৩০ দিনের Review Center: ${errorText(analyticsResult.reason, 'লোড হয়নি')}`);
    if (listResult.status === 'fulfilled') {
      setSecurityRows(Array.isArray(listResult.value?.items) ? listResult.value.items : []);
      setSecurityTotal(Number(listResult.value?.total_count) || 0);
    } else failures.push(`Security Event List: ${errorText(listResult.reason, 'লোড হয়নি')}`);
    if (telemetryResult.status === 'fulfilled') {
      setSecurityTelemetryStatus(telemetryResult.value || { ready: false, code: 'EMPTY_HEALTH_RESPONSE' });
    } else {
      const message = await edgeInvokeErrorText(telemetryResult.reason);
      if (requestId !== securityRequestRef.current) return;
      setSecurityTelemetryStatus({ ready: false, message });
    }
    if (blocksResult.status === 'fulfilled') setSecurityIpBlocks(Array.isArray(blocksResult.value?.items) ? blocksResult.value.items : []);
    else { setSecurityIpBlocks([]); setSecurityIpBlocksError(errorText(blocksResult.reason, 'সক্রিয় IP Block তালিকা লোড হয়নি।')); }
    setSecurityError(failures.length ? `কিছু Security তথ্য লোড হয়নি; সফল অংশটি দেখা যাচ্ছে। ${failures.join(' · ')}` : '');
    setSecurityLoading(false);
  }, [securityEventFilter, securityIpSearch, securityFromDate, securityToDate, securityPage]);
  const submitSecurityIpBlock = async (event) => {
    event.preventDefault();
    const ip = securityBlockIp.trim();
    if (!ip || securityBlockReason.trim().length < 3) {
      setSecurityIpBlocksError('IP ঠিকানা ও কমপক্ষে ৩ অক্ষরের কারণ লিখুন।');
      return;
    }
    const confirm = await confirmTypedAction(
      `নির্বাচিত IP ${ip} নির্দিষ্ট সময়ের জন্য ${securityBlockScope === 'both' ? 'Login/Registration এবং Password Reset' : securityBlockScope === 'auth' ? 'Login/Registration' : 'Password Reset'} থেকে সব অ্যাকাউন্টের জন্য ব্লক হবে। এটি Manual Global Block; স্বয়ংক্রিয় ভুল-চেষ্টার Block শুধু IP ও চেষ্টা করা ইমেইলের জোড়ায় প্রযোজ্য। নিশ্চিত করতে IP-টি হুবহু লিখুন।`,
      ip,
    );
    if (!confirm) return;
    setSecurityBlockBusy(true); setSecurityIpBlocksError(''); setError(''); setNotice('');
    try {
      const result = await platformAdminAddSecurityIpBlock(ip, securityBlockScope, Number(securityBlockDuration), securityBlockReason.trim());
      setSecurityBlockReason('');
      setSecurityBlockIp('');
      setNotice(`${result?.ip_address || ip} IP Block করা হয়েছে · মেয়াদ ${Number(securityBlockDuration)===43200?'৩০ দিন':Number(securityBlockDuration)===10080?'৭ দিন':Number(securityBlockDuration)===1440?'২৪ ঘণ্টা':Number(securityBlockDuration)===360?'৬ ঘণ্টা':Number(securityBlockDuration)===60?'১ ঘণ্টা':'১৫ মিনিট'}।`);
      await loadSecurityMonitor();
    } catch (cause) {
      setSecurityIpBlocksError(errorText(cause, 'IP Block করা যায়নি। AAL2 যাচাই এবং Run44 Migration পরীক্ষা করুন।'));
    } finally { setSecurityBlockBusy(false); }
  };

  const releaseSecurityIpBlock = async (block) => {
    const scopeLabel = block.scope === 'auth' ? 'Login/Registration' : 'Password Reset';
    const targetLabel = block.attempt_email ? `${block.attempt_email} অ্যাকাউন্ট` : 'এই IP-এর সব অ্যাকাউন্ট';
    if (!await confirmAction(`${block.ip_address} থেকে ${targetLabel}-এর ${scopeLabel} Block তুলে দেবেন? এটি Audit Log-এ সংরক্ষিত হবে।`)) return;
    setSecurityBlockBusy(true); setSecurityIpBlocksError('');
    try {
      await platformAdminReleaseSecurityIpBlock(block.ip_address, block.scope, block.attempt_email || null);
      setNotice(`${block.ip_address} থেকে ${scopeLabel} Block তুলে দেওয়া হয়েছে।`);
      await loadSecurityMonitor();
    } catch (cause) {
      setSecurityIpBlocksError(errorText(cause, 'IP Block তোলা যায়নি।'));
    } finally { setSecurityBlockBusy(false); }
  };

  const setSecurityDateRange = (days) => {
    const today = toDhakaDateTimeInput(new Date()).slice(0, 10);
    setSecurityFromDate(addCalendarDaysToDateInput(today, -(Math.max(1, Number(days) || 30) - 1)));
    setSecurityToDate(today);
    setSecurityPage(0);
  };

  const loadMemberActivity = useCallback(async (member, page = 0) => {
    if (!member?.hostel_id || !member?.user_id) return;
    const requestId = ++memberActivityRequestRef.current;
    setMemberActivityLoading(true); setMemberActivityError('');
    const results = await Promise.allSettled([
      platformAdminGetMemberActivityOverview(member.hostel_id, member.user_id),
      platformAdminListMemberActivity(member.hostel_id, member.user_id, pageSize, page * pageSize),
    ]);
    if (requestId !== memberActivityRequestRef.current) return;
    const failures = [];
    const [overviewResult, listResult] = results;
    if (overviewResult.status === 'fulfilled') setMemberActivityOverview(overviewResult.value || {});
    else failures.push(`সদস্যের উপস্থিতি: ${errorText(overviewResult.reason, 'লোড হয়নি')}`);
    if (listResult.status === 'fulfilled') {
      setMemberActivityRows(Array.isArray(listResult.value?.items) ? listResult.value.items : []);
      setMemberActivityTotal(Number(listResult.value?.total_count) || 0);
      setMemberActivityPage(page);
    } else failures.push(`Activity Log: ${errorText(listResult.reason, 'লোড হয়নি')}`);
    setMemberActivityError(failures.join(' · '));
    setMemberActivityLoading(false);
  }, []);

  const loadMemberSessions = useCallback(async (member, page = 0) => {
    if (!member?.hostel_id || !member?.user_id) return;
    const requestId = ++memberSessionRequestRef.current;
    setMemberSessionLoading(true); setMemberSessionError('');
    try {
      const result = await platformAdminListMemberSessions(member.hostel_id, member.user_id, 20, page * 20);
      if (requestId !== memberSessionRequestRef.current) return;
      setMemberSessionRows(Array.isArray(result?.items) ? result.items : []);
      setMemberSessionTotal(Number(result?.total_count) || 0);
      setMemberSessionPage(page);
    } catch (cause) {
      if (requestId === memberSessionRequestRef.current) setMemberSessionError(errorText(cause, 'Login History লোড করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    } finally { if (requestId === memberSessionRequestRef.current) setMemberSessionLoading(false); }
  }, []);

  const openMemberActivity = (member) => {
    setMemberActivityTarget(member);
    setMemberActivityOverview(null); setMemberActivityRows([]); setMemberSessionRows([]);
    setMemberActivityError(''); setMemberSessionError('');
    setMemberSessionTotal(0); setMemberActivityPage(0); setMemberSessionPage(0);
    loadMemberActivity(member, 0);
    loadMemberSessions(member, 0);
  };

  const loadCodeHistory = useCallback(async () => {
    const requestId = ++codeHistoryRequestRef.current;
    setCodeHistoryLoading(true); setCodeHistoryError('');
    try {
      const result = await platformAdminListAccessCodeHistory({
        limit: pageSize, offset: codeHistoryPage * pageSize,
        purpose: codeHistoryPurpose === 'all' ? null : codeHistoryPurpose,
      });
      if (requestId !== codeHistoryRequestRef.current) return;
      setCodeHistoryRows(Array.isArray(result?.items) ? result.items : []);
      setCodeHistoryTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      if (requestId === codeHistoryRequestRef.current) setCodeHistoryError(errorText(cause, 'Security Code History রিফ্রেশ করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    } finally { if (requestId === codeHistoryRequestRef.current) setCodeHistoryLoading(false); }
  }, [codeHistoryPage, codeHistoryPurpose]);

  const loadSystemHealth = useCallback(async () => {
    const requestId = ++healthRequestRef.current;
    setHealthLoading(true); setHealthError(''); setDatabaseHealthError('');
    const results = await Promise.allSettled([
      platformAdminGetSystemHealth(Number(healthStaleDays) || 14),
      platformAdminGetDatabaseRuntimeHealth(),
    ]);
    if (requestId !== healthRequestRef.current) return;
    const [operationsResult, databaseResult] = results;
    if (operationsResult.status === 'fulfilled') setHealthData(operationsResult.value || null);
    else setHealthError(errorText(operationsResult.reason, 'System Health রিফ্রেশ করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    if (databaseResult.status === 'fulfilled') setDatabaseHealthData(databaseResult.value || null);
    else setDatabaseHealthError('Database Runtime Metrics লোড হয়নি। Run34 Migration প্রয়োগ ও Schema Reload হয়েছে কি না যাচাই করুন।');
    setHealthLoading(false);
  }, [healthStaleDays]);

  const loadNoticeMonitoring = useCallback(async () => {
    const requestId = ++noticeMonitorRequestRef.current;
    setNoticeMonitorLoading(true); setNoticeMonitorError('');
    try {
      const result = await platformAdminListNoticeMonitoring({
        limit: pageSize, offset: noticeMonitorPage * pageSize, search: noticeMonitorSearch || null,
      });
      if (requestId !== noticeMonitorRequestRef.current) return;
      setNoticeMonitorData(result || null);
      setNoticeMonitorRows(Array.isArray(result?.items) ? result.items : []);
      setNoticeMonitorTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      if (requestId === noticeMonitorRequestRef.current) setNoticeMonitorError(errorText(cause, 'নোটিশের তালিকা রিফ্রেশ করা যায়নি। আগের সফল তথ্য রাখা হয়েছে।'));
    } finally { if (requestId === noticeMonitorRequestRef.current) setNoticeMonitorLoading(false); }
  }, [noticeMonitorPage, noticeMonitorSearch]);

  const generatePlatformReport = useCallback(async () => {
    const requestId = ++reportRequestRef.current;
    setReportLoading(true); setReportError(''); setReportData(null);
    try {
      const result = await platformAdminGetPlatformReport(reportFromDate, reportToDate);
      if (requestId === reportRequestRef.current) setReportData(result || null);
    } catch (cause) {
      if (requestId === reportRequestRef.current) setReportError(errorText(cause, 'প্ল্যাটফর্ম রিপোর্ট তৈরি করা যায়নি।'));
    } finally { if (requestId === reportRequestRef.current) setReportLoading(false); }
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

  const downloadPlatformReportJson = useCallback(() => {
    if (!reportData) return;
    try {
      const safeReport = {
        report_type: 'hostel-life-platform-aggregate',
        schema_version: 1,
        generated_at: reportData.generated_at || new Date().toISOString(),
        from_date: reportData.from_date,
        to_date: reportData.to_date,
        totals: reportData.totals || {},
        items: Array.isArray(reportData.items) ? reportData.items : [],
        notes: [reportData.snapshot_note, 'এটি মেসভিত্তিক Aggregate রিপোর্ট; সদস্যভিত্তিক ব্যক্তিগত লেনদেন অন্তর্ভুক্ত নয়।'].filter(Boolean),
      };
      const blob = new Blob([JSON.stringify(safeReport, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `hostel-life-platform-report-${reportData.from_date}-${reportData.to_date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Aggregate রিপোর্ট JSON ডাউনলোড শুরু হয়েছে।');
    } catch (cause) { setReportError(cause?.message || 'JSON রিপোর্ট ডাউনলোড করা যায়নি।'); }
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
  useEffect(() => { if (tab === 'activity' && reauthenticated && activityView === 'timeline') loadActivity(); }, [tab, reauthenticated, activityView, loadActivity]);
  useEffect(() => { if (tab === 'activity' && reauthenticated && activityView === 'security') loadSecurityMonitor(); }, [tab, reauthenticated, activityView, loadSecurityMonitor]);
  useEffect(() => { if (tab === 'mfa' && reauthenticated) reloadMfaFactors().catch((cause) => setMfaError(cause?.message || 'Authenticator তালিকা লোড হয়নি।')); }, [tab, reauthenticated]);
  useEffect(() => { if (tab === 'security' && reauthenticated) loadCodeHistory(); }, [tab, reauthenticated, loadCodeHistory, codeHistoryReload]);
  useEffect(() => { if (tab === 'health' && reauthenticated) loadSystemHealth(); }, [tab, reauthenticated, loadSystemHealth]);
  useEffect(() => { if (tab === 'notices' && reauthenticated) loadNoticeMonitoring(); }, [tab, reauthenticated, loadNoticeMonitoring]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase || !user?.id) { if (live) { setGateError('বৈধ লগইন সেশন পাওয়া যায়নি।'); setChecking(false); } return; }
      try {
        const { data, error: queryError } = await supabase.from('profiles').select('role,is_blocked').eq('id', user.id).maybeSingle();
        if (queryError) throw queryError;
        if (!live) return;
        const canOpen = data?.role === 'super_admin' && data?.is_blocked !== true;
        setAllowed(canOpen);
        if (!canOpen) {
          const reason = !data
            ? 'এই Supabase Project-এ আপনার Profile পাওয়া যায়নি। Local .env-এর VITE_SUPABASE_URL এবং Publishable Key সঠিক Production Project-এ যাচ্ছে কি না যাচাই করুন।'
            : data.is_blocked === true
              ? 'এই অ্যাকাউন্টটি Block করা আছে। Super Admin প্রবেশাধিকার দেওয়া যাচ্ছে না।'
              : `এই অ্যাকাউন্টের role হলো “${data.role || 'নির্ধারিত নয়'}”; Super Admin Panel-এর জন্য role অবশ্যই super_admin হতে হবে।`;
          setGateError(reason);
        }
      } catch (cause) {
        if (live) setGateError(errorText(cause, 'Profile যাচাই করা যায়নি। Supabase URL/Key, Network এবং profiles SELECT permission পরীক্ষা করুন.'));
      }
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
      || (hostelFilter === 'active' && hostel.platform_status === 'active')
      || (hostelFilter === 'recent' && hostel.created_at && new Date(hostel.created_at).getTime() >= Date.now() - 30 * 86400000)
      || (hostelFilter === 'favorite' && hostel.is_favorite)
      || (hostelFilter === 'trusted' && hostel.is_trusted)
      || (hostelFilter === 'suspended' && hostel.platform_status === 'suspended')),
  [hostels, hostelQuery, hostelFilter]);
  useEffect(() => { setHostelPage(1); }, [hostelQuery, hostelFilter]);
  useEffect(() => { setMemberPage(1); }, [memberQuery, memberFilter, selected?.hostel_id]);
  const visibleHostels = filteredHostels.slice((hostelPage - 1) * pageSize, hostelPage * pageSize);
  const visibleMembers = sortedMembers.slice((memberPage - 1) * pageSize, memberPage * pageSize);

  const loadRetention = useCallback(async () => {
    const requestId = ++retentionRequestRef.current;
    setRetentionLoading(true); setRetentionError('');
    const results = await Promise.allSettled([
      platformAdminGetRetention(), platformAdminListExpiredArchives(), platformAdminListSavedSummaries(), platformAdminListClosedPeriods(),
    ]);
    if (requestId !== retentionRequestRef.current) return;
    const failures = [];
    const [policyResult, queueResult, savedResult, closedResult] = results;
    if (policyResult.status === 'fulfilled') {
      const policy = policyResult.value || {};
      setRetention(policy);
      setRetentionDraft({ detail: String(policy.detail_months ?? 2), summary: String(policy.summary_months ?? 6) });
    } else failures.push(`নীতি: ${errorText(policyResult.reason, 'লোড হয়নি')}`);
    if (queueResult.status === 'fulfilled') {
      setExpiredArchives(Array.isArray(queueResult.value) ? queueResult.value : []);
      setExpiredArchivesLoaded(true);
    } else failures.push(`মেয়াদোত্তীর্ণ তালিকা: ${errorText(queueResult.reason, 'লোড হয়নি')}`);
    if (savedResult.status === 'fulfilled') setSavedSummaries(Array.isArray(savedResult.value) ? savedResult.value : []);
    else failures.push(`সংরক্ষিত সামারি: ${errorText(savedResult.reason, 'লোড হয়নি')}`);
    if (closedResult.status === 'fulfilled') setClosedPeriods(Array.isArray(closedResult.value) ? closedResult.value : []);
    else failures.push(`বন্ধ মাসের তালিকা: ${errorText(closedResult.reason, 'লোড হয়নি')}`);
    setRetentionError(failures.length ? `কিছু তথ্য রিফ্রেশ হয়নি; আগের সফল তথ্য রাখা হয়েছে। ${failures.join(' · ')}` : '');
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

  const loadTelegramConnections = useCallback(async () => {
    setTelegramConnectionLoading(true); setTelegramConnectionError('');
    try {
      const result = await platformAdminListTelegramConnections({ search: telegramConnectionSearch || null, limit: pageSize, offset: telegramConnectionPage * pageSize });
      setTelegramConnections(Array.isArray(result?.items) ? result.items : []);
      setTelegramConnectionTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setTelegramConnections([]); setTelegramConnectionTotal(0);
      setTelegramConnectionError(errorText(cause, 'Telegram সংযোগের তালিকা লোড করা যায়নি। Run35 migration প্রয়োগ হয়েছে কি না যাচাই করুন।'));
    } finally { setTelegramConnectionLoading(false); }
  }, [telegramConnectionSearch, telegramConnectionPage]);

  const disconnectTelegramConnection = async (connection) => {
    const expected = `DISCONNECT TELEGRAM ${connection.user_id}`;
    const typed = await confirmTypedAction(
      `${connection.full_name || connection.email || connection.user_id}-এর Telegram সংযোগ বিচ্ছিন্ন হবে। Telegram ID-র সংযোগ এবং pending link token বাতিল হবে; Hostel Life account বা অন্য তথ্য মুছবে না।`,
      expected,
    );
    if (typed !== expected) return;
    setTelegramConnectionBusyUserId(connection.user_id); setTelegramConnectionError('');
    try {
      await platformAdminDisconnectTelegramUser(connection.user_id, 'Super Admin থেকে Telegram সংযোগ বিচ্ছিন্ন');
      await Promise.all([loadTelegramConnections(), loadTelegramAdminSettings()]);
      setNotice(`${connection.full_name || 'ব্যবহারকারী'}-এর Telegram সংযোগ বিচ্ছিন্ন হয়েছে।`);
    } catch (cause) { setTelegramConnectionError(errorText(cause, 'Telegram সংযোগ বিচ্ছিন্ন করা যায়নি।')); }
    finally { setTelegramConnectionBusyUserId(''); }
  };

  const loadActiveSessions = useCallback(async () => {
    setActiveSessionLoading(true); setActiveSessionError('');
    try {
      const result = await platformAdminListActiveSessions({ search: activeSessionSearch || null, limit: pageSize, offset: activeSessionPage * pageSize });
      setActiveSessions(Array.isArray(result?.items) ? result.items : []);
      setActiveSessionTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setActiveSessions([]); setActiveSessionTotal(0);
      setActiveSessionError(errorText(cause, 'সক্রিয় Device Session তালিকা লোড করা যায়নি। Run35 migration ও Auth Session access যাচাই করুন।'));
    } finally { setActiveSessionLoading(false); }
  }, [activeSessionSearch, activeSessionPage]);

  const revokeActiveSession = async (session) => {
    const expected = `REVOKE SESSION ${session.user_id} ${session.session_ref}`;
    const typed = await confirmTypedAction(
      `${session.full_name || session.email}-এর নির্দিষ্ট Device Session বন্ধ হবে। এই কাজটি শুধু নির্বাচিত Session-এ প্রয়োগ হবে; অন্য Session অক্ষত থাকবে।`,
      expected,
    );
    if (typed !== expected) return;
    setActiveSessionBusyRef(session.session_ref); setActiveSessionError('');
    try {
      await platformAdminRevokeActiveSession(session.user_id, session.session_ref, 'Super Admin কর্তৃক নির্দিষ্ট ডিভাইস Session বাতিল');
      await loadActiveSessions();
      setNotice(`${session.full_name || 'ব্যবহারকারী'}-এর নির্বাচিত Session বন্ধ করা হয়েছে।`);
    } catch (cause) { setActiveSessionError(errorText(cause, 'Session বন্ধ করা যায়নি। তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।')); }
    finally { setActiveSessionBusyRef(''); }
  };

  const loadTelegramAdminSettings = useCallback(async () => {
    setTelegramAdminLoading(true);
    setTelegramAdminError('');
    setTelegramWebhookError('');
    setTelegramDeliveryError('');
    const [settingsResult, webhookResult, deliveryResult] = await Promise.allSettled([
      platformAdminGetNotificationSettings(),
      platformAdminGetTelegramWebhookStatus(),
      platformAdminGetTelegramDeliveryHealth(),
    ]);
    if (settingsResult.status === 'fulfilled') setTelegramAdminSettings(settingsResult.value || {});
    else setTelegramAdminError(errorText(settingsResult.reason, 'টেলিগ্রাম সেটিংস লোড করা যায়নি।'));
    if (webhookResult.status === 'fulfilled') setTelegramWebhookStatus(webhookResult.value || null);
    else { setTelegramWebhookStatus(null); setTelegramWebhookError(await edgeInvokeErrorText(webhookResult.reason)); }
    if (deliveryResult.status === 'fulfilled') setTelegramDeliveryHealth(deliveryResult.value || null);
    else { setTelegramDeliveryHealth(null); setTelegramDeliveryError(errorText(deliveryResult.reason, 'Run32 টেলিগ্রাম স্বাস্থ্য যাচাই মাইগ্রেশন প্রয়োগ করা আছে কি না যাচাই করুন।')); }
    setTelegramAdminLoading(false);
  }, []);

  const loadTelegramDeliveryBatches = useCallback(async () => {
    setTelegramDeliveryLoading(true);
    setTelegramBatchError('');
    try {
      const result = await platformAdminListTelegramDeliveryBatches({
        status: telegramDeliveryFilter === 'all' ? null : telegramDeliveryFilter,
        limit: 10,
        offset: telegramDeliveryPage * 10,
      });
      setTelegramDeliveryRows(Array.isArray(result?.items) ? result.items : []);
      setTelegramDeliveryTotal(Number(result?.total_count) || 0);
    } catch (cause) {
      setTelegramBatchError(errorText(cause, 'টেলিগ্রাম বার্তা প্রেরণের তালিকা লোড করা যায়নি।'));
    } finally {
      setTelegramDeliveryLoading(false);
    }
  }, [telegramDeliveryFilter, telegramDeliveryPage]);

  const loadCommunications = useCallback(async () => {
    setCommunicationsLoading(true);
    setCommunicationsLoaded(false);
    communicationsSavedDraftRef.current = null;
    setCommunicationsError('');
    try {
      const row = await platformAdminGetCommunications();
      const loadedDraft = communicationRowToDraft(row);
      setCommunicationsDraft(loadedDraft);
      communicationsSavedDraftRef.current = JSON.parse(JSON.stringify(loadedDraft));
      setCommunicationsLoaded(true);
    } catch (cause) {
      setCommunicationsError(errorText(cause, 'প্রকাশনার তথ্য লোড করা যায়নি। Run33 Migration প্রয়োগ হয়েছে কি না যাচাই করুন।'));
    } finally {
      setCommunicationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'communications' && reauthenticated) loadCommunications();
  }, [tab, reauthenticated, loadCommunications]);

  const saveCommunicationSection = async (section) => {
    if (!communicationsLoaded || !communicationsSavedDraftRef.current || communicationsBusy) {
      setCommunicationsError('সার্ভারের সংরক্ষিত তথ্য লোড না হওয়া পর্যন্ত পরিবর্তন সংরক্ষণ করা যাবে না। আগে আবার লোড করুন।');
      return;
    }

    const current = communicationsDraft;
    const saved = communicationsSavedDraftRef.current;
    const selected = section === 'release_notes' ? current : section === 'window_notice' ? current.window_notice : current.site_notice;
    const lines = current.release_notes_text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (section === 'release_notes') {
      if (lines.length > 30 || lines.some((line) => line.length > 240)) {
        setCommunicationsError('সর্বোচ্চ ৩০টি আপডেট লিখুন; প্রতিটি ২৪০ অক্ষরের মধ্যে রাখুন।');
        return;
      }
      if (current.release_notes_published && lines.length === 0) {
        setCommunicationsError('আপডেটের তালিকা প্রকাশ করতে অন্তত একটি আপডেট লিখুন।');
        return;
      }
    }
    if (section === 'window_notice' && selected.enabled && !selected.title.trim() && !selected.body.trim()) {
      setCommunicationsError('উইন্ডো নোটিশ চালু করতে শিরোনাম অথবা বার্তা লিখুন।');
      return;
    }
    if (section === 'site_notice' && selected.enabled && selected.mode === 'message' && !selected.title.trim() && !selected.body.trim()) {
      setCommunicationsError('ওয়েবসাইট বিজ্ঞপ্তি চালু করতে শিরোনাম অথবা বার্তা লিখুন।');
      return;
    }
    if (section === 'site_notice' && selected.enabled && selected.mode === 'image' && !selected.image_url) {
      setCommunicationsError('ছবির ব্যানার চালু করার আগে একটি ছবি আপলোড করুন।');
      return;
    }
    if (section !== 'release_notes' && selected.starts_at && selected.ends_at && selected.ends_at <= selected.starts_at) {
      setCommunicationsError('বিজ্ঞপ্তির শেষ সময় শুরুর সময়ের পরে নির্বাচন করুন।');
      return;
    }

    const toIsoOrNull = (value) => {
      if (!value) return null;
      const date = fromDhakaDateTimeInput(value);
      if (!Number.isFinite(date.getTime())) throw new Error('তারিখ ও সময় সঠিকভাবে নির্বাচন করুন।');
      return date.toISOString();
    };
    const releaseSource = section === 'release_notes' ? current : saved;
    const windowSource = section === 'window_notice' ? current.window_notice : saved.window_notice;
    const siteSource = section === 'site_notice' ? current.site_notice : saved.site_notice;

    setCommunicationsBusy(true);
    setCommunicationsError('');
    setNotice('');
    try {
      await platformAdminSaveCommunications({
        release_notes: releaseSource.release_notes_text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        release_notes_published: Boolean(releaseSource.release_notes_published),
        window_notice: {
          enabled: Boolean(windowSource.enabled), title: windowSource.title.trim(), body: windowSource.body.trim(),
          starts_at: toIsoOrNull(windowSource.starts_at), ends_at: toIsoOrNull(windowSource.ends_at), frequency: windowSource.frequency,
        },
        site_notice: {
          enabled: Boolean(siteSource.enabled), mode: siteSource.mode, title: siteSource.title.trim(),
          starts_at: toIsoOrNull(siteSource.starts_at), ends_at: toIsoOrNull(siteSource.ends_at),
          body: siteSource.mode === 'image' ? '' : siteSource.body.trim(), frequency: siteSource.frequency,
        },
      });
      // Update only the saved baseline for this section. Keep edits in the other
      // cards on screen so a section save never silently discards another draft.
      const savedNext = { ...saved };
      if (section === 'release_notes') {
        savedNext.release_notes_text = current.release_notes_text;
        savedNext.release_notes_published = current.release_notes_published;
      } else if (section === 'window_notice') savedNext.window_notice = { ...current.window_notice };
      else savedNext.site_notice = { ...current.site_notice };
      communicationsSavedDraftRef.current = JSON.parse(JSON.stringify(savedNext));
      const label = section === 'release_notes' ? 'আপডেটের তথ্য' : section === 'window_notice' ? 'সবার জন্য নির্দিষ্ট বার্তা' : 'রক্ষণাবেক্ষণ বিজ্ঞপ্তি';
      setNotice(`${label} আলাদাভাবে সংরক্ষিত হয়েছে।`);
    } catch (cause) {
      setCommunicationsError(errorText(cause, 'পরিবর্তন সংরক্ষণ করা যায়নি।'));
    } finally {
      setCommunicationsBusy(false);
    }
  };

  const handleCommunicationsImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCommunicationsImageBusy(true);
    setCommunicationsError('');
    try {
      const imageUrl = await uploadPlatformNoticeImage(user?.id, file);
      setCommunicationsDraft((current) => ({
        ...current,
        site_notice: { ...current.site_notice, mode: 'image', image_url: imageUrl, image_path: 'platform-communications/maintenance-banner.jpg' },
      }));
      setNotice('ব্যানার ছবি আপলোড হয়েছে। প্রকাশ করতে নিচের সংরক্ষণ বোতাম চাপুন।');
    } catch (cause) {
      setCommunicationsError(errorText(cause, 'ব্যানার ছবি আপলোড করা যায়নি।'));
    } finally {
      setCommunicationsImageBusy(false);
    }
  };

  const configureTelegramWebhook = async () => {
    setTelegramWebhookBusy(true);
    setTelegramWebhookError('');
    setNotice('');
    try {
      const result = await platformAdminConfigureTelegramWebhook();
      setTelegramWebhookStatus(result || null);
      if (result?.bot?.username_matches && result?.webhook?.url_matches) {
        setNotice('টেলিগ্রাম বট যাচাই হয়েছে এবং Incoming Webhook সফলভাবে সেট করা হয়েছে।');
      } else if (!result?.bot?.username_matches) {
        setTelegramWebhookError(`বটের ইউজারনেম মেলেনি। Supabase-এ সংরক্ষিত নাম @${result?.bot?.configured_username || '—'}, কিন্তু টোকেনের বট হলো @${result?.bot?.username || '—'}। সঠিক Bot Token ও Username ব্যবহার করুন।`);
      } else {
        setTelegramWebhookError('টেলিগ্রাম ওয়েবহুক সেট করার পরও নির্ধারিত URL নিশ্চিত করা যায়নি। আবার অবস্থা যাচাই করুন।');
      }
      // Refresh outgoing diagnostics independently so a username/webhook warning
      // from this action is not cleared by the general settings loader.
      const [deliveryResult, batchesResult] = await Promise.allSettled([
        platformAdminGetTelegramDeliveryHealth(),
        platformAdminListTelegramDeliveryBatches({ status: telegramDeliveryFilter === 'all' ? null : telegramDeliveryFilter, limit: 10, offset: telegramDeliveryPage * 10 }),
      ]);
      if (deliveryResult.status === 'fulfilled') setTelegramDeliveryHealth(deliveryResult.value || null);
      else setTelegramDeliveryError(errorText(deliveryResult.reason, 'Run32 টেলিগ্রাম স্বাস্থ্য যাচাই মাইগ্রেশন যাচাই করুন।'));
      if (batchesResult.status === 'fulfilled') {
        setTelegramDeliveryRows(Array.isArray(batchesResult.value?.items) ? batchesResult.value.items : []);
        setTelegramDeliveryTotal(Number(batchesResult.value?.total_count) || 0);
      } else setTelegramBatchError(errorText(batchesResult.reason, 'টেলিগ্রাম বার্তা প্রেরণের তালিকা লোড করা যায়নি।'));
    } catch (cause) {
      setTelegramWebhookError(await edgeInvokeErrorText(cause));
    } finally {
      setTelegramWebhookBusy(false);
    }
  };

  useEffect(() => {
    if (tab === 'telegram' && reauthenticated) loadTelegramAdminSettings();
  }, [tab, reauthenticated, loadTelegramAdminSettings]);

  useEffect(() => {
    if (tab === 'telegram' && reauthenticated) loadTelegramDeliveryBatches();
  }, [tab, reauthenticated, loadTelegramDeliveryBatches]);

  useEffect(() => {
    if (tab === 'telegram' && reauthenticated) loadTelegramConnections();
  }, [tab, reauthenticated, loadTelegramConnections]);

  useEffect(() => {
    if (tab === 'sessions' && reauthenticated) loadActiveSessions();
  }, [tab, reauthenticated, loadActiveSessions]);

  useEffect(() => {
    if (tab !== 'messages' || !messageHostelId || !reauthenticated) return undefined;
    const requestId = ++messageMembersRequestRef.current;
    setMessageMembersLoading(true); setMessageMembersError(''); setMessageMembers([]); setMessageSelectedUsers([]);
    platformAdminListHostelMembers(messageHostelId).then((rows) => {
      if (requestId !== messageMembersRequestRef.current) return;
      setMessageMembers((Array.isArray(rows) ? rows : []).filter((row) => row.status === 'active' && !row.is_blocked));
    }).catch((cause) => {
      if (requestId === messageMembersRequestRef.current) setMessageMembersError(errorText(cause, 'সদস্য তালিকা লোড করা যায়নি।'));
    }).finally(() => {
      if (requestId === messageMembersRequestRef.current) setMessageMembersLoading(false);
    });
    return () => { messageMembersRequestRef.current += 1; };
  }, [tab, messageHostelId, reauthenticated]);

  const saveTelegramAdminSettings = async (event) => {
    event.preventDefault();
    setTelegramAdminBusy(true); setTelegramAdminError(''); setNotice('');
    try {
      const result = await platformAdminUpdateNotificationSettings(telegramAdminSettings.telegram_enabled, telegramAdminSettings.telegram_bot_username);
      setTelegramAdminSettings(result || telegramAdminSettings);
      setNotice(telegramAdminSettings.telegram_enabled
        ? 'টেলিগ্রাম সেবা সেটিংস সংরক্ষিত হয়েছে। Edge Function ও Webhook সেটআপ সম্পন্ন না হলে সংযোগ এখনো কাজ করবে না।'
        : 'টেলিগ্রাম বার্তা প্রেরণ বন্ধ করা হয়েছে। বিদ্যমান সংযোগগুলো মুছে ফেলা হয়নি।');
    } catch (cause) { setTelegramAdminError(errorText(cause, 'টেলিগ্রাম সেটিংস সংরক্ষণ করা যায়নি।')); }
    finally { setTelegramAdminBusy(false); }
  };

  const sendPlatformMessage = async (event) => {
    event.preventDefault();
    if (!messageHostelId) { setError('একটি মেস নির্বাচন করুন।'); return; }
    if (messageRecipientMode === 'selected' && !messageSelectedUsers.length) { setError('অন্তত একজন সদস্য নির্বাচন করুন।'); return; }
    const recipientDescription = messageRecipientMode === 'all'
      ? 'নির্বাচিত মেসের সব সক্রিয় সদস্যকে'
      : `${messageSelectedUsers.length.toLocaleString('bn-BD')} জন নির্বাচিত সদস্যকে`;
    if (!await confirmAction(`বার্তাটি ${recipientDescription} পাঠাবেন?

শিরোনাম: ${messageTitle.trim()}

বার্তা পাঠানোর পর তা প্রাপকদের ইনবক্সে সংরক্ষিত হবে এবং টেলিগ্রামে যুক্ত ব্যবহারকারীদের কাছেও যেতে পারে।`, { title: 'বার্তা পাঠানোর আগে নিশ্চিত হন', confirmLabel: 'বার্তা পাঠান', kind: 'message' })) return;
    setMessageSending(true); setError(''); setNotice('');
    try {
      const result = await platformAdminSendTargetedMessage(
        messageHostelId, messageTitle, messageBody,
        messageRecipientMode === 'all' ? null : messageSelectedUsers,
      );
      const count = Number(result?.sent_count || 0);
      setNotice(`${count.toLocaleString('bn-BD')} জন সক্রিয় সদস্যের ইনবক্সে বার্তা পাঠানো হয়েছে। টেলিগ্রামে যাঁরা সংযুক্ত, তাঁরাও বার্তাটি পাবেন।`);
      setMessageTitle(''); setMessageBody(''); setMessageSelectedUsers([]); setMessageRecipientMode('all');
    } catch (cause) { setError(errorText(cause, 'বার্তা পাঠানো যায়নি।')); }
    finally { setMessageSending(false); }
  };

  const metrics = useMemo(() => normalizePlatformOverview(overview), [overview]);
  const selectedStatus = selected?.platform_status || 'active';
  const reloadMfaFactors = async () => {
    const { data, error: factorError } = await supabase.auth.mfa.listFactors();
    if (factorError) throw factorError;

    // Supabase's `totp` collection contains verified TOTP factors only.
    // `all` is the authoritative collection for finding abandoned/unverified enrollments.
    const allFactors = Array.isArray(data?.all)
      ? data.all
      : [...(data?.totp || []), ...(data?.phone || [])];
    const verified = (data?.totp || [])
      .filter((factor) => factor.status === 'verified')
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    const unverified = allFactors.filter((factor) =>
      factor.factor_type === 'totp' && factor.status !== 'verified'
    );

    setMfaFactors(verified);
    return { verified, unverified };
  };

  // Do not create a challenge when the password screen is submitted. A fresh
  // challenge is created at the exact moment the user submits their TOTP code.
  const selectMfaFactorForChallenge = (factorId) => {
    if (!factorId) return;
    setMfaError('');
    setMfaFactorId(factorId);
    setMfaCode('');
    setMfaStage('challenge');
  };

  const beginMfaEnrollment = async (purpose = 'backup') => {
    setMfaError('');
    setMfaBusy(true);
    try {
      const friendlyName = purpose === 'primary'
        ? 'Hostel Life Super Admin'
        : `Hostel Life Backup Authenticator ${Math.max(1, mfaFactors.length)}`;
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName,
      });
      if (enrollError) throw enrollError;
      if (!data?.id || !data?.totp?.qr_code || !data?.totp?.secret) {
        throw new Error('Supabase Authenticator Setup-এর QR বা Secret পাওয়া যায়নি। Supabase Auth → Multi-factor Authentication-এ TOTP সক্রিয় আছে কি না দেখুন।');
      }
      setMfaPurpose(purpose);
      setMfaFriendlyName(friendlyName);
      setMfaFactorId(data.id);
      setMfaQrCode(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaCode('');
      setMfaStage(purpose === 'primary' ? 'enroll-primary' : 'enroll-backup');
    } catch (cause) {
      setMfaError(cause?.message || 'Authenticator যুক্ত করা যায়নি।');
    } finally {
      setMfaBusy(false);
    }
  };

  const prepareSuperAdminMfa = async () => {
    const { verified, unverified } = await reloadMfaFactors();
    if (verified.length) {
      selectMfaFactorForChallenge(verified[0].id);
      return;
    }
    // Remove only abandoned, unverified setup factors belonging to this user.
    for (const factor of unverified) {
      try { await supabase.auth.mfa.unenroll({ factorId: factor.id }); } catch { /* keep the safe enrollment path; show any Supabase limit error below */ }
    }
    await beginMfaEnrollment('primary');
  };

  const changeMfaFactor = (factorId) => {
    if (!factorId || factorId === mfaFactorId) return;
    selectMfaFactorForChallenge(factorId);
  };

  const verifySuperAdminMfa = async (event) => {
    event?.preventDefault?.();
    const code = String(mfaCode || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) {
      setMfaError('Google Authenticator-এর ছয় সংখ্যার কোড লিখুন।');
      return;
    }
    if (!mfaFactorId) {
      setMfaError('Authenticator Factor পাওয়া যায়নি। আবার শুরু করুন।');
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      // Always request a fresh challenge immediately before verification.
      // A challenge created on the password screen can become stale while the
      // user waits for the next TOTP window or changes authenticator factors.
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (challengeError) throw challengeError;
      const challengeId = challengeData?.id;
      if (!challengeId) throw new Error('নতুন Authenticator challenge তৈরি করা যায়নি। আবার চেষ্টা করুন।');

      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId,
        code,
      });
      if (verifyError) throw verifyError;

      // Supabase returns the upgraded AAL2 session from MFA verification.
      // Check the response token and the actual persisted client session; this
      // prevents the UI from opening while Database RPCs still receive AAL1.
      const verifiedSession = verifyData?.session || verifyData;
      const verifiedUserId = verifiedSession?.user?.id || verifyData?.user?.id;
      if (verifiedUserId && verifiedUserId !== user?.id) {
        throw new Error('Authenticator যাচাইয়ের Session বর্তমান Super Admin অ্যাকাউন্টের সঙ্গে মেলেনি। নিরাপত্তার জন্য প্রবেশ বন্ধ রাখা হয়েছে।');
      }

      const verifiedAccessToken = verifiedSession?.access_token || null;
      const verifiedRefreshToken = verifiedSession?.refresh_token || null;
      let { data: sessionSnapshot, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      let activeSession = sessionSnapshot?.session;
      if (!activeSession?.access_token || activeSession?.user?.id !== user?.id) {
        throw new Error('Authenticator যাচাইয়ের পরে বর্তমান অ্যাকাউন্টের Session পাওয়া যায়নি। আবার পাসওয়ার্ড যাচাই করুন।');
      }

      // Validate the exact token returned by MFA verification when available.
      // This is a server-validated AAL check, not a client-side JWT decode.
      const aalToken = verifiedAccessToken || activeSession.access_token;
      const { data: tokenAssurance, error: tokenAssuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel(aalToken);
      if (tokenAssuranceError) throw tokenAssuranceError;
      if (tokenAssurance?.currentLevel !== 'aal2') {
        throw new Error('কোড যাচাইয়ের পর Supabase AAL2 Session নিশ্চিত করেনি। প্যানেল নিরাপদ রাখতে প্রবেশ বন্ধ রাখা হয়েছে।');
      }

      let { data: activeAssurance, error: activeAssuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (activeAssuranceError) throw activeAssuranceError;

      // Only repair a stale AAL1 client session. Never replace a session that
      // has already reached AAL2 (it may have been refreshed after verification).
      if (activeAssurance?.currentLevel !== 'aal2' && verifiedAccessToken && verifiedRefreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: verifiedAccessToken,
          refresh_token: verifiedRefreshToken,
        });
        if (setSessionError) throw setSessionError;
        const refreshedSessionResult = await supabase.auth.getSession();
        if (refreshedSessionResult.error) throw refreshedSessionResult.error;
        sessionSnapshot = refreshedSessionResult.data;
        activeSession = sessionSnapshot?.session;
        const assuranceResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceResult.error) throw assuranceResult.error;
        activeAssurance = assuranceResult.data;
      }

      if (!activeSession?.access_token || activeSession?.user?.id !== user?.id) {
        throw new Error('Authenticator-এর পর Session পুনরায় সমন্বয় করা যায়নি। আবার চেষ্টা করুন।');
      }
      if (activeAssurance?.currentLevel !== 'aal2') {
        throw new Error('AAL2 Token পাওয়া গেছে, কিন্তু অ্যাপের সক্রিয় Session এখনো AAL2 হয়নি। প্যানেল নিরাপদ রাখতে প্রবেশ বন্ধ রাখা হয়েছে।');
      }

      await reloadMfaFactors();
      setMfaQrCode('');
      setMfaSecret('');
      setMfaCode('');
      if (mfaPurpose === 'primary' || mfaStage === 'challenge') {
        setMfaStage('idle');
        setReauthenticated(true);
        setNotice('পাসওয়ার্ড ও Authenticator—দুই ধাপের যাচাই সফল হয়েছে।');
      } else {
        setMfaStage('idle');
        setNotice('ব্যাকআপ Authenticator সফলভাবে যুক্ত হয়েছে।');
      }
    } catch (cause) {
      const errorCode = String(cause?.code || cause?.name || '').trim();
      const errorMessage = String(cause?.message || 'Authenticator কোড যাচাই করা যায়নি।');
      if (errorCode === 'mfa_verification_failed') {
        setMfaError('কোডটি Supabase-এর সঙ্গে মেলেনি। সঠিক Authenticator নির্বাচন করুন এবং ফোনের Date & Time স্বয়ংক্রিয় (Set time automatically) আছে কি না দেখুন। নতুন কোড তৈরি হলে সেটি দিয়ে আবার চেষ্টা করুন।');
      } else if (errorCode === 'mfa_verification_rejected') {
        setMfaError('Supabase MFA Verification Hook এই যাচাই প্রত্যাখ্যান করেছে। Dashboard-এর Auth Hook ও লগ পরীক্ষা করতে হবে।');
      } else {
        setMfaError(errorCode ? `${errorMessage} [${errorCode}]` : errorMessage);
      }
    } finally {
      setMfaBusy(false);
    }
  };

  const reauthenticate = async (event) => {
    event.preventDefault(); setGateError(''); setReauthBusy(true);
    try {
      const { error: authError } = await verifyPassword({ email: user?.email, password });
      if (authError) throw authError;
      setPassword('');
      await prepareSuperAdminMfa();
    } catch (cause) {
      const code = String(cause?.code || '').toUpperCase();
      const message = String(cause?.message || '');
      if (code === 'AUTH_IP_TEMPORARILY_BLOCKED' || code === '429') setGateError(message || 'নিরাপত্তার কারণে এই নেটওয়ার্ক থেকে Login সাময়িকভাবে বন্ধ আছে।');
      else if (code === 'CLIENT_IP_UNAVAILABLE') setGateError(message || 'এই অনুরোধে Client IP পাওয়া যায়নি। IP-ভিত্তিক অতিরিক্ত যাচাই বাদ থাকবে; Supabase Auth-এর নিজস্ব নিরাপত্তা চালু আছে।');
      else if (/invalid login credentials|invalid_credentials/i.test(message)) setGateError('পাসওয়ার্ড সঠিক নয়। আবার যাচাই করুন।');
      else setGateError(`পাসওয়ার্ড যাচাই সম্পন্ন হয়নি: ${message || 'Network/Auth সেবা অনুপলব্ধ।'} Localhost হলে HOSTEL_SECURITY_ALLOWED_ORIGINS-এ সঠিক Origin আছে কি না দেখুন।`);
    }
    finally { setReauthBusy(false); }
  };
  const openHostel = async (hostel) => {
    const requestId = ++hostelMembersRequestRef.current;
    memberActivityRequestRef.current += 1; memberSessionRequestRef.current += 1;
    setSelected(hostel); setMembers([]); setMemberListLoadedHostelId(''); setMemberRoles({}); setReason('');
    setMemberActivityTarget(null); setMemberActivityOverview(null); setMemberActivityRows([]); setMemberSessionRows([]);
    setMemberActivityError(''); setMemberSessionError(''); setBusy(true); setError('');
    try {
      const list = await platformAdminListHostelMembers(hostel.hostel_id);
      if (requestId !== hostelMembersRequestRef.current) return;
      if (!Array.isArray(list)) throw new Error('সদস্য তালিকার সঠিক ফলাফল পাওয়া যায়নি।');
      setMembers(list);
      setMemberListLoadedHostelId(hostel.hostel_id);
      try {
        const roles = await platformAdminListHostelRoleBadges(hostel.hostel_id);
        if (requestId === hostelMembersRequestRef.current) setMemberRoles(roles);
      } catch {
        if (requestId === hostelMembersRequestRef.current) {
          setMemberRoles({});
          setNotice('সদস্য তালিকা এসেছে, তবে ম্যানেজার/সহকারী পরিচয়ের ব্যাজ লোড হয়নি। রিফ্রেশ করে আবার চেষ্টা করুন।');
        }
      }
    } catch (cause) {
      if (requestId === hostelMembersRequestRef.current) setError(errorText(cause, 'সদস্য তালিকা লোড করা যায়নি।'));
    } finally { if (requestId === hostelMembersRequestRef.current) setBusy(false); }
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
      setOrphanSelectedIds([]);
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
      setOrphanSelectedIds(old=>old.filter(id=>id!==account.id));
      setNotice('Auth account স্থায়ীভাবে মুছে ফেলা হয়েছে।');
    } catch(cause){setOrphanError(cause?.message || 'Auth মুছতে পারেনি।');}
    finally {setOrphanBusy(false);}
  };
  const removeSelectedOrphanAccounts = async () => {
    const selected = orphanAccounts.filter((row) => orphanSelectedIds.includes(row.id));
    if (!selected.length || selected.length > 25) return;
    const expected = `DELETE ${selected.length} ORPHAN AUTH ACCOUNTS`;
    const typed = await confirmTypedAction(
      `নিচের ${selected.length}টি Auth account স্থায়ীভাবে মুছে ফেলা হবে। সার্ভার প্রতিটি account-এর membership, Super Admin role ও বর্তমান Admin account আবার যাচাই করবে। মুছে ফেললে ফিরিয়ে আনা যাবে না।`,
      expected,
    );
    if (typed !== expected) return;
    setOrphanBusy(true); setOrphanError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-delete-unlinked-user', {
        body: { action: 'delete_many', user_ids: selected.map((row) => row.id), confirmation: expected },
      });
      if (fnError) throw new Error(await edgeInvokeErrorText(fnError));
      if (data?.error) throw new Error(data.message || data.error);
      const deleted = new Set(Array.isArray(data?.results) ? data.results.filter((row) => row.deleted).map((row) => row.user_id) : []);
      setOrphanAccounts((old) => old.filter((row) => !deleted.has(row.id)));
      setOrphanSelectedIds((old) => old.filter((id) => !deleted.has(id)));
      const failed = Array.isArray(data?.results) ? data.results.filter((row) => !row.deleted) : [];
      setNotice(`${deleted.size.toLocaleString('bn-BD')}টি Auth account মুছে ফেলা হয়েছে${failed.length ? `; ${failed.length.toLocaleString('bn-BD')}টি নিরাপত্তা যাচাই/ডিলিটে ব্যর্থ হওয়ায় রাখা হয়েছে` : ''}।`);
      if (failed.length) setOrphanError(failed.map((row) => `${row.email || row.user_id}: ${row.message || row.code || 'ব্যর্থ'}`).join(' · '));
    } catch (cause) { setOrphanError(cause?.message || 'Bulk Auth account deletion ব্যর্থ হয়েছে।'); }
    finally { setOrphanBusy(false); }
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
    if (!settingsLoaded) { setError('সেটিংসের সংরক্ষিত তথ্য আগে সফলভাবে লোড করুন।'); return; }
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setDeveloperPhotoBusy(true); setError(''); setNotice('');
    try {
      const url = await uploadDeveloperPhoto(user?.id, file);
      setSettings((old) => ({ ...old, developer_photo_url: url }));
      setNotice('ছবি Supabase Storage-এ আপলোড হয়েছে। Developer Info-তে স্থায়ী করতে “সহায়তা তথ্য সংরক্ষণ করুন” চাপুন।');
    } catch (cause) { setError(cause?.message || 'Developer-এর ছবি আপলোড করা যায়নি।'); }
    finally { setDeveloperPhotoBusy(false); }
  };

  const saveDeviceLimit = async () => {
    if (!settingsLoaded || !sessionPolicyLoaded) { setError('Session Policy-এর সংরক্ষিত তথ্য আগে সফলভাবে লোড করুন।'); return; }
    const limit = Number(settings.max_devices_per_user);
    const timeoutMinutes = Number(settings.session_timeout_minutes || 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      setError('একসঙ্গে সর্বোচ্চ Login Session সংখ্যা ১ থেকে ৩০-এর মধ্যে নির্বাচন করুন।');
      return;
    }
    if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 0 || timeoutMinutes > 10080) {
      setError('Session-এর সময় ০ থেকে ১০,০৮০ মিনিটের মধ্যে নির্বাচন করুন।');
      return;
    }
    setDeviceLimitBusy(true); setError(''); setNotice('');
    try {
      const result = await platformAdminSetSessionPolicy(limit, timeoutMinutes);
      const timeoutLabel = timeoutMinutes === 0 ? 'নির্দিষ্ট সময়সীমা নেই' : `${timeoutMinutes.toLocaleString('bn-BD')} মিনিট`;
      setNotice(`Session Policy সংরক্ষিত হয়েছে। নতুন Login এলে সবচেয়ে পুরোনো Session স্বয়ংক্রিয়ভাবে বন্ধ হবে। প্রতি Session-এর সময়: ${timeoutLabel}।${Number(result?.revoked_sessions) ? ` ${Number(result.revoked_sessions).toLocaleString('bn-BD')}টি পুরোনো Session বন্ধ করা হয়েছে।` : ''}`);
      await refresh();
    } catch (cause) {
      setError(errorText(cause, 'Session Policy সংরক্ষণ করা যায়নি।'));
    } finally {
      setDeviceLimitBusy(false);
    }
  };

  const saveDefaultTheme = async () => {
    if (!settingsLoaded) { setError('সেটিংসের সংরক্ষিত তথ্য আগে সফলভাবে লোড করুন।'); return; }
    setDefaultThemeBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetDefaultTheme(settings.default_theme || 'dark');
      setNotice('নতুন ব্যবহারকারী ও নতুন ডিভাইসের ডিফল্ট থিম সংরক্ষিত হয়েছে। যাঁদের ডিভাইসে আগে থেকেই থিম পছন্দ সেভ আছে, সেটি পরিবর্তন হবে না।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'ডিফল্ট থিম সংরক্ষণ করা যায়নি।')); }
    finally { setDefaultThemeBusy(false); }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const saved = settingsSavedRef.current;
    if (!settingsLoaded || !saved) { setError('সেটিংসের সংরক্ষিত তথ্য আগে সফলভাবে লোড করুন।'); return; }
    if (tab === 'settings' && settings.announcement_enabled && !String(settings.announcement_title || '').trim()) { setError('Global Notice চালু করতে একটি শিরোনাম লিখুন।'); return; }
    const announcementFields = ['announcement_enabled', 'announcement_title', 'announcement_body'];
    const developerFields = ['developer_name', 'developer_title', 'developer_photo_url', 'developer_email', 'developer_phone', 'developer_portfolio_url'];
    const fieldsToSave = tab === 'settings' ? announcementFields : developerFields;
    const payload = { ...saved };
    fieldsToSave.forEach((key) => { payload[key] = settings[key]; });
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminUpdatePublicSettings(payload);
      setNotice(tab === 'settings'
        ? 'Global Notice-এর পরিবর্তন সংরক্ষিত হয়েছে। Developer/Support তথ্য অপরিবর্তিত রাখা হয়েছে।'
        : 'Developer/Support তথ্য সংরক্ষিত হয়েছে। Global Notice-এর পরিবর্তন অপরিবর্তিত রাখা হয়েছে।');
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

  const refreshWorkspace = async () => {
    if (refreshingWorkspace) return;
    setRefreshingWorkspace(true);
    try {
      await refresh();
      if (tab === 'insights' && insightsHostelId) await loadHostelInsights(insightsHostelId, insightsPeriodId || null);
      else if (tab === 'health') await loadSystemHealth();
      else if (tab === 'notices') await loadNoticeMonitoring();
      else if (tab === 'reports') await generatePlatformReport();
      else if (tab === 'audit') await loadAuditLog();
      else if (tab === 'activity' && activityView === 'timeline') await loadActivity();
      else if (tab === 'activity' && activityView === 'security') await loadSecurityMonitor();
      else if (tab === 'security') await loadCodeHistory();
      else if (tab === 'retention') await loadRetention();
      else if (tab === 'communications') await loadCommunications();
      else if (tab === 'telegram') await Promise.all([loadTelegramAdminSettings(), loadTelegramDeliveryBatches()]);
      else if (tab === 'hostels' && selected) await openHostel(selected);
      setLastWorkspaceRefresh(new Date().toISOString());
    } catch (cause) {
      setError(errorText(cause, 'Super Admin তথ্য রিফ্রেশ করা যায়নি। আগের সফল তথ্য অক্ষত রাখা হয়েছে।'));
    } finally {
      setRefreshingWorkspace(false);
    }
  };

  const openHostelDirectory = (filter = 'all') => {
    setHostelFilter(filter);
    setHostelQuery('');
    setSelected(null);
    setTab('hostels');
  };

  const openOverviewDestination = (destination, message) => {
    if (destination === 'hostels') {
      setHostelFilter('all');
      setHostelQuery('');
      setSelected(null);
    }
    if (destination === 'activity') {
      setActivityView('timeline');
      setActivityHostelFilter('all');
      setActivityEventFilter('all');
      setActivityPage(0);
    }
    if (destination === 'audit') {
      setAuditActionFilter('all');
      setAuditTargetFilter('all');
      setAuditSearchDraft('');
      setAuditSearch('');
      setAuditPage(0);
    }
    setTab(destination);
    if (message) setNotice(message);
  };

  const openSecurityEvents = (eventType = 'all') => {
    setSecurityEventFilter(eventType);
    setSecurityIpSearchDraft('');
    setSecurityIpSearch('');
    setSecurityPage(0);
    setActivityView('security');
    setTab('activity');
  };

  const openHealthHostel = (row) => {
    const match = hostels.find((hostel) => String(hostel.hostel_id) === String(row.hostel_id));
    const target = match || { hostel_id: row.hostel_id, name: row.hostel_name, platform_status: row.platform_status };
    setTab('hostels');
    openHostel(target);
  };

  const visibleHealthItems = (healthData?.items || []).filter((row) =>
    (healthSeverityFilter === 'all' || row.severity === healthSeverityFilter)
    && (healthIssueFilter === 'all' || (row.issue_codes || []).includes(healthIssueFilter))
  );
  const releaseNoteLines = communicationsDraft.release_notes_text
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const releaseNotesInvalid = releaseNoteLines.length > 30 || releaseNoteLines.some((line) => line.length > 240)
    || (communicationsDraft.release_notes_published && releaseNoteLines.length === 0);
  const windowNoticeInvalid = (communicationsDraft.window_notice.enabled
      && !communicationsDraft.window_notice.title.trim() && !communicationsDraft.window_notice.body.trim())
    || (communicationsDraft.window_notice.starts_at && communicationsDraft.window_notice.ends_at
      && communicationsDraft.window_notice.ends_at <= communicationsDraft.window_notice.starts_at);
  const siteNoticeInvalid = (communicationsDraft.site_notice.enabled && communicationsDraft.site_notice.mode === 'message'
      && !communicationsDraft.site_notice.title.trim() && !communicationsDraft.site_notice.body.trim())
    || (communicationsDraft.site_notice.enabled && communicationsDraft.site_notice.mode === 'image'
      && !communicationsDraft.site_notice.image_url)
    || (communicationsDraft.site_notice.starts_at && communicationsDraft.site_notice.ends_at
      && communicationsDraft.site_notice.ends_at <= communicationsDraft.site_notice.starts_at);

  if (checking) return <main className="platform-page"><LoadingSpinner label="Super Admin role যাচাই হচ্ছে..."/></main>;
  if (!allowed) return <main className="platform-page platform-auth-gate-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="shield" size={30}/></span><h1>Super Admin প্রবেশাধিকার যাচাই</h1><p>{gateError || 'আপনার অ্যাকাউন্টের অনুমতি যাচাই করা যাচ্ছে না। Supabase URL/Key এবং Profile role যাচাই করুন।'}</p><button className="primary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরে যান</button></section></main>;
  if (!reauthenticated && (mfaStage === 'challenge' || mfaStage === 'enroll-primary')) return <main className="platform-page platform-auth-gate-page"><section className="card platform-reauth platform-mfa-gate"><span className="platform-lock"><Icon name="shield-check" size={28}/></span><span className="eyebrow">দ্বিতীয় নিরাপত্তা ধাপ</span><h1>{mfaStage === 'challenge' ? 'Authenticator কোড যাচাই' : 'Google Authenticator সংযুক্ত করুন'}</h1><p>{mfaStage === 'challenge' ? 'পাসওয়ার্ড যাচাই সফল হয়েছে। Google Authenticator থেকে ছয় সংখ্যার বর্তমান কোড দিন।' : 'প্রথমবার Super Admin খুলতে Authenticator অ্যাপে QR Scan করুন, তারপর ছয় সংখ্যার কোড দিয়ে সংযোগ নিশ্চিত করুন।'}</p>{mfaStage === 'challenge' && mfaFactors.length > 1 && <label className="field-label"><span>যে Authenticator ব্যবহার করবেন</span><select value={mfaFactorId} onChange={(event)=>changeMfaFactor(event.target.value)}>{mfaFactors.map((factor)=><option value={factor.id} key={factor.id}>{factor.friendly_name || 'Authenticator'}</option>)}</select></label>}{mfaStage === 'enroll-primary' && <div className="platform-mfa-qr-wrap"><img src={mfaQrCode} alt="Google Authenticator QR code"/><span>QR Scan না হলে এই Secret ম্যানুয়ালি Authenticator-এ যোগ করুন</span><code>{mfaSecret}</code><button type="button" className="secondary-button compact" onClick={async()=>{try{await navigator.clipboard.writeText(mfaSecret);setMfaError('Secret কপি হয়েছে। নিরাপদে রাখুন; কাউকে শেয়ার করবেন না।');}catch{setMfaError('কপি করা যায়নি। Secret নিজে লিখে নিন।');}}}>Secret কপি করুন</button></div>}<form className="form-stack" onSubmit={verifySuperAdminMfa}><label className="field-label"><span>৬ সংখ্যার Authenticator কোড</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event)=>setMfaCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" required/></label>{mfaError && <div className="inline-error">{mfaError}</div>}<button className="primary-button large" type="submit" disabled={mfaBusy || mfaCode.length!==6}>{mfaBusy ? 'কোড যাচাই হচ্ছে...' : mfaStage === 'challenge' ? 'Authenticator যাচাই করে প্রবেশ করুন' : 'Authenticator সংযোগ নিশ্চিত করুন'}</button></form><button type="button" className="secondary-button" onClick={() => { setMfaStage('idle'); setMfaError(''); setMfaCode(''); window.location.href = '/app/dashboard'; }}>বাতিল</button></section></main>;
  if (!reauthenticated) return <main className="platform-page platform-auth-gate-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="lock" size={28}/></span><span className="eyebrow">অতিরিক্ত নিরাপত্তা</span><h1>Super Admin যাচাইকরণ</h1><form className="form-stack" onSubmit={reauthenticate}><label className="field-label"><span>অ্যাকাউন্ট ইমেইল</span><div className="platform-reauth-email-field"><input type={reauthEmailVisible ? 'text' : 'password'} value={user?.email || ''} readOnly autoComplete="off" aria-label="Super Admin account email"/><button type="button" className="platform-reauth-email-toggle" onClick={()=>setReauthEmailVisible((visible)=>!visible)} aria-label={reauthEmailVisible ? 'ইমেইল লুকান' : 'ইমেইল দেখান'} aria-pressed={reauthEmailVisible}><Icon name={reauthEmailVisible ? 'eye-off' : 'eye'} size={17}/></button></div></label><label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{gateError && <div className="inline-error">{gateError}</div>}<button className="primary-button large" type="submit" disabled={reauthBusy}>{reauthBusy ? 'যাচাই হচ্ছে...' : 'যাচাই করে প্রবেশ করুন'}</button><button type="button" className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>বাতিল</button></form></section></main>;

  return <main className="platform-page">
    <header className="platform-header"><div className="platform-brand"><span className="platform-brand-mark"><BrandMark size={49}/></span><div><small>HOSTEL LIFE · PLATFORM CONTROL</small><h1>Super Admin</h1></div></div><div className="platform-header-actions"><span className="platform-auth-user">{user?.email}</span><button className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরুন</button></div></header>
    <div className="platform-intro"><div><span className="eyebrow">PLATFORM CONTROL</span><h2>সিস্টেম কন্ট্রোল</h2></div><div className="platform-refresh-wrap">{lastWorkspaceRefresh && <span className="platform-refresh-time">সর্বশেষ {formatPlatformDate(lastWorkspaceRefresh)}</span>}<button type="button" className={`secondary-button platform-refresh-button${refreshingWorkspace ? ' is-refreshing' : ''}`} onClick={refreshWorkspace} disabled={refreshingWorkspace || busy}><Icon name="refresh-cw" size={17}/> {refreshingWorkspace ? 'রিফ্রেশ হচ্ছে...' : 'রিফ্রেশ'}</button></div></div>
    {error && <div className="inline-error platform-alert"><Icon name="warning" size={17}/><span>{error}</span></div>}{notice && <div className="inline-success platform-alert"><Icon name="check-circle" size={17}/><span>{notice}</span></div>}
    <div className="platform-navigation">
      <section className="platform-navigation-group" aria-label="পর্যবেক্ষণ ও পরিচালনা">
        <div className="platform-navigation-heading"><strong>পর্যবেক্ষণ ও পরিচালনা</strong></div>
        <nav className="platform-tabs platform-main-tabs" aria-label="পর্যবেক্ষণ বিভাগ">{[['overview','ওভারভিউ'],['insights','মেস ইনসাইটস'],['health','System Health'],['notices','নোটিশ পর্যবেক্ষণ'],['reports','রিপোর্ট এক্সপোর্ট'],['backup','Backup & Recovery'],['audit','Audit Log'],['activity','Activity & Security'],['hostels','মেস ও সদস্য'],['retention','ডেটা সংরক্ষণ']].map(([key,label])=><button key={key} type="button" className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{label}</button>)}</nav>
      </section>
      <section className="platform-navigation-group platform-configuration-group" aria-label="সিস্টেম সেটিংস">
        <div className="platform-navigation-heading"><strong>সিস্টেম সেটিংস</strong></div>
        <nav className="platform-tabs platform-config-tabs" aria-label="সিস্টেম সেটিংস বিভাগ">{[['settings','গ্লোবাল নোটিশ'],['communications','আপডেট ও বিজ্ঞপ্তি'],['messages','বার্তা পাঠান'],['telegram','টেলিগ্রাম সেটআপ'],['developer','ডেভেলপার তথ্য'],['appearance','অ্যাপের থিম'],['sessions','সেশন নিরাপত্তা'],['mfa','দ্বিস্তর নিরাপত্তা'],['security','প্রবেশ কোড']].map(([key,label])=><button key={key} type="button" className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{label}</button>)}</nav>
      </section>
    </div>
    {tab === 'overview' && <>
      <div className="platform-overview-heading">
        <div><span className="eyebrow">PLATFORM SNAPSHOT</span><h3>এক নজরে প্ল্যাটফর্ম</h3><p>মেস, অ্যাকাউন্ট ও সদস্যপদের সামগ্রিক অবস্থা—ব্যক্তিগত লেনদেনের তথ্য ছাড়া।</p></div>
        <span className="platform-overview-tag"><Icon name="shield-check" size={15}/> Privacy-aware overview</span>
      </div>
      <section className="platform-stats-grid">
      <Stat label="মোট মেস" value={metrics.hostels} icon="home" onClick={() => openHostelDirectory('all')}/>
      <Stat label="সক্রিয় মেস" value={metrics.activeHostels} icon="home" onClick={() => openHostelDirectory('active')}/>
      <Stat label="স্থগিত মেস" value={metrics.suspendedHostels} icon="lock" onClick={() => openHostelDirectory('suspended')}/>
      <Stat label="মোট অ্যাকাউন্ট" value={metrics.users} icon="users" onClick={() => openOverviewDestination('hostels','অ্যাকাউন্টের বিস্তারিত দেখতে একটি মেস নির্বাচন করে সদস্য তালিকা খুলুন।')}/>
      <Stat label="সক্রিয় মেম্বারশিপ" value={metrics.activeMemberships} icon="user-plus" onClick={() => openOverviewDestination('hostels','সক্রিয় মেম্বারশিপ যাচাই করতে মেস নির্বাচন করে সদস্য তালিকা খুলুন।')}/>
      <Stat label="নিষ্ক্রিয় মেম্বারশিপ" value={metrics.inactiveMemberships} icon="user" onClick={() => openOverviewDestination('activity','সদস্যপদ পরিবর্তনের ইতিহাস Activity Timeline-এ দেখুন।')}/>
      <Stat label="গত ৩০ দিনে তৈরি মেস" value={metrics.recentHostels} icon="calendar" onClick={() => openHostelDirectory('recent')}/>
      <Stat label="ব্লক করা অ্যাকাউন্ট" value={metrics.blockedUsers} icon="shield" onClick={() => openOverviewDestination('hostels','ব্লক করা সদস্য দেখতে মেস নির্বাচন করুন এবং সদস্য তালিকায় Blocked ফিল্টার ব্যবহার করুন।')}/>
      <Stat label="Super Admin" value={metrics.superAdmins} icon="shield-check" onClick={() => openOverviewDestination('audit','Super Admin-সম্পর্কিত প্রশাসনিক পরিবর্তন Audit Log-এ যাচাই করুন।')}/>
      <div className="card platform-privacy-note"><Icon name="shield" size={22}/><div><strong>Privacy boundary</strong><p>এই Overview-তে শুধু সামগ্রিক সংখ্যা দেখানো হয়। ব্যক্তিগত সদস্যের আর্থিক বা মিলের বিস্তারিত এখানে দেখানো হয় না।</p></div></div>
      </section>
      <section className="platform-overview-shortcuts" aria-label="Super Admin দ্রুত সংযোগ">
        <div><span className="eyebrow">QUICK ACCESS</span><h4>গুরুত্বপূর্ণ বিভাগে দ্রুত যান</h4><p>Overview থেকে সংশ্লিষ্ট পর্যবেক্ষণ ও নিয়ন্ত্রণে সরাসরি প্রবেশ করুন।</p></div>
        <div className="platform-overview-shortcut-actions">
          {[
            ['health','সিস্টেম হেলথ','activity'],['reports','রিপোর্ট এক্সপোর্ট','file-text'],['audit','অডিট লগ','history'],
            ['activity','অ্যাক্টিভিটি ও সিকিউরিটি','shield'],['backup','Backup & Recovery','database'],['sessions','সেশন নিরাপত্তা','monitor'],
          ].map(([destination,label,icon])=><button key={destination} type="button" className="secondary-button compact" onClick={()=>openOverviewDestination(destination)}><Icon name={icon} size={15}/>{label}</button>)}
        </div>
      </section>
    </>}
    {tab === 'insights' && <section className="card platform-panel platform-insights-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">HOSTEL INTELLIGENCE</span><h3>মেসভিত্তিক বিস্তারিত সারসংক্ষেপ</h3><p>নির্বাচিত মেসের মাসভিত্তিক মিল, বাজার ও আর্থিক Aggregate দেখা যাবে। ব্যক্তিগত সদস্যের লেনদেন এখানে প্রকাশ করা হয় না।</p></div><button type="button" className="secondary-button compact" disabled={insightsLoading || !insightsHostelId} onClick={()=>loadHostelInsights(insightsHostelId,insightsPeriodId||null)}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <div className="platform-insights-toolbar">
        <label className="field-label"><span>মেস নির্বাচন</span><SearchableSelect value={insightsHostelId} onChange={(value)=>{setInsightsHostelId(value);setInsightsPeriodId('');setInsightsData(null);}} options={hostels.map((hostel)=>({value:hostel.hostel_id,label:`${hostel.name} · ${hostel.platform_status==='suspended'?'স্থগিত':'সক্রিয়'}`}))} placeholder="মেস নির্বাচন করুন" ariaLabel="মেস নির্বাচন"/></label>
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
        <div className="platform-audit-top"><div><strong>{auditActionLabel(row.action)}</strong><small>{auditTargetLabel(row.target_type)} · {row.target_label || row.target_id || '—'}</small></div><time>{formatPlatformDate(row.created_at)}</time></div>
        <div className="platform-audit-actor"><Icon name="user" size={14}/>{row.actor_name || 'অজানা অ্যাকাউন্ট'}</div>
        {row.reason && <p className="platform-audit-reason">কারণ: {row.reason}</p>}
        {row.details && Object.entries(row.details).length > 0 && <div className="platform-audit-details">{Object.entries(row.details).map(([key,value])=><span key={key}>{AUDIT_DETAIL_LABELS[key] || key}: {typeof value === 'boolean' ? (value ? 'হ্যাঁ' : 'না') : String(value)}</span>)}</div>}
      </article>)}</div>}
      <div className="platform-history-pager"><span>{auditTotal.toLocaleString('bn-BD')}টি রেকর্ড · পৃষ্ঠা {auditTotal ? auditPage + 1 : 0} / {Math.max(1,Math.ceil(auditTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={auditLoading || auditPage===0} onClick={()=>setAuditPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={auditLoading || (auditPage+1)*pageSize>=auditTotal} onClick={()=>setAuditPage(value=>value+1)}>পরের</button></div></div>
    </section>}
    {tab === 'activity' && <section className="card platform-panel platform-monitor-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">USER & SECURITY OBSERVABILITY</span><h3>Activity Log ও Security Monitoring</h3><p>মেসের কাজ, সদস্য Login/Logout এবং অ্যাপের মাধ্যমে আসা ব্যর্থ Login/Registration প্রচেষ্টা পর্যবেক্ষণ করুন।</p></div><button type="button" className="secondary-button compact" disabled={activityLoading||securityLoading} onClick={activityView==='timeline'?loadActivity:loadSecurityMonitor}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <div className="platform-filter-pills" role="tablist" aria-label="Activity Monitor View"><button type="button" role="tab" aria-selected={activityView==='timeline'} className={activityView==='timeline'?'active':''} onClick={()=>setActivityView('timeline')}>Activity Timeline</button><button type="button" role="tab" aria-selected={activityView==='security'} className={activityView==='security'?'active':''} onClick={()=>setActivityView('security')}>Security Monitor</button></div>
      {activityView==='timeline' ? <>
        <div className="platform-activity-filters"><label className="field-label"><span>মেস</span><SearchableSelect value={activityHostelFilter} onChange={(value)=>{setActivityHostelFilter(value);setActivityPage(0);}} options={[{value:'all',label:'সব মেস'},...hostels.map((hostel)=>({value:hostel.hostel_id,label:hostel.name}))]} placeholder="সব মেস" ariaLabel="Activity Log মেস ফিল্টার"/></label><label className="field-label"><span>কার্যক্রম</span><select value={activityEventFilter} onChange={(event)=>{setActivityEventFilter(event.target.value);setActivityPage(0);}}><option value="all">সব কার্যক্রম</option><optgroup label="ব্যবহারকারী ও মেসের কার্যক্রম">{Object.entries(ACTIVITY_EVENT_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</optgroup><optgroup label="আর্কাইভ কার্যক্রম">{Object.entries(ARCHIVE_ACTIVITY_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</optgroup></select></label><label className="field-label"><span>শুরুর তারিখ (বাংলাদেশ)</span><input type="date" value={activityFromDate} max={activityToDate || undefined} onChange={(event)=>{setActivityFromDate(event.target.value);setActivityPage(0);}}/></label><label className="field-label"><span>শেষ তারিখ (বাংলাদেশ)</span><input type="date" value={activityToDate} min={activityFromDate || undefined} onChange={(event)=>{setActivityToDate(event.target.value);setActivityPage(0);}}/></label><button type="button" className="secondary-button compact" onClick={()=>{setActivityFromDate('');setActivityToDate('');setActivityPage(0);}}>তারিখ মুছুন</button></div>
        <div className="platform-monitor-crosslink"><span>প্রশাসনিক পরিবর্তনের কারণ ও বিস্তারিত দেখতে</span><button type="button" className="text-button" onClick={()=>setTab('audit')}>Audit Log খুলুন <Icon name="external-link" size={14}/></button></div>
        {activityError && <div className="inline-error platform-alert">{activityError}</div>}
        {activityLoading ? <div className="platform-empty"><LoadingSpinner label="Activity Log লোড হচ্ছে..."/></div> : activityRows.length===0 ? <div className="platform-empty-state"><Icon name="activity" size={28}/><strong>কোনো কার্যক্রম পাওয়া যায়নি</strong><span>Module 3 migration চালু হওয়ার পর নতুন কার্যক্রম এখানে দেখা যাবে।</span></div> : <div className="platform-audit-list">{activityRows.map((row)=><article className="platform-audit-item" key={row.id}><div className="platform-audit-top"><div><strong>{activityEventLabel(row.event_type)}</strong><small>{row.hostel_name || 'প্ল্যাটফর্ম'} · {row.source_table || 'auth'} · {row.target_label || (row.target_id ? `Ref ${String(row.target_id).slice(0,12)}` : 'সংশ্লিষ্ট রেকর্ড')}</small></div><time>{formatPlatformDate(row.created_at)}</time></div><div className="platform-audit-actor"><Icon name="user" size={14}/>{row.actor_name || 'সিস্টেম/অজানা'}{row.subject_name && row.subject_name!=='—' ? ` · সংশ্লিষ্ট: ${row.subject_name}`:''}</div>{activityChangedFields(row.metadata) && <p className="platform-audit-reason">পরিবর্তিত অংশ: {activityChangedFields(row.metadata)}</p>}{row.ip_address && <small className="platform-security-ip">Login IP: {row.ip_address}</small>}</article>)}</div>}
        <div className="platform-history-pager"><span>{activityTotal.toLocaleString('bn-BD')}টি কার্যক্রম · পৃষ্ঠা {activityTotal?activityPage+1:0} / {Math.max(1,Math.ceil(activityTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={activityLoading||activityPage===0} onClick={()=>setActivityPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={activityLoading||(activityPage+1)*pageSize>=activityTotal} onClick={()=>setActivityPage(value=>value+1)}>পরের</button></div></div>
      </> : <>
        <div className="platform-security-explainer">
          <div className="platform-security-note"><Icon name="shield-check" size={17}/><span>Security Monitor-এ Login, Registration ও Password Reset-এর Event দেখা যায়। নিরাপত্তার প্রয়োজনে IP, ঘটনার সময়, Request Origin ও Browser তথ্য ব্যবহার করা হয়। নতুন Event-এ দেশ, শহর, অঞ্চল বা GPS অবস্থান সংগ্রহ বা সংরক্ষণ করা হয় না; পুরোনো Event-এ আগে থাকা location তথ্যও এখানে দেখানো হয় না। Password ও OTP সংরক্ষণ করা হয় না। App pre-check সরাসরি Supabase Auth endpoint-এ পাঠানো অনুরোধ আটকাতে পারে না।</span></div>
        </div>
        {securityTelemetryStatus && (securityTelemetryStatus.ready === true
          ? <details className="platform-security-help platform-security-diagnostics">
              <summary>নিরাপত্তা সংযোগের অবস্থা</summary>
              <div className="platform-security-diagnostic-grid">
                <span>Telemetry RPC: <strong>সচল · {securityTelemetryStatus.version || 'Version অজানা'}</strong></span>
                <span>Account Identity RPC: <strong>{securityTelemetryStatus.authenticated_login_writer_ready ? 'Run39 সচল' : 'Run39 Migration প্রয়োজন'}</strong></span>
                <span>Attempt Email Column: <strong>{securityTelemetryStatus.attempt_email_column_ready ? 'প্রস্তুত' : 'Run39 Migration/Writer যাচাই প্রয়োজন'}</strong></span>
                <span>Login IP Gate: <strong>{securityTelemetryStatus.auth_gate_ready ? (securityTelemetryStatus.auth_gate_ip_available ? 'সচল · IP + Email Pair Protection' : 'সচল · IP অনুপস্থিত, Native Auth Protection') : `যাচাই ব্যর্থ · ${securityTelemetryStatus.auth_gate_code || 'কারণ অজানা'}`}</strong></span>
                <span>Client IP: <strong>{securityTelemetryStatus.client_ip_available ? 'পাওয়া গেছে' : 'পাওয়া যায়নি'}</strong></span>
                <span>লোকেশন সংগ্রহ: <strong>বন্ধ</strong></span>
                <span>Security Proxy: <strong>{securityTelemetryStatus.geo_proxy_verified && securityTelemetryStatus.auth_gate_geo_proxy_verified ? 'Worker signature যাচাই হয়েছে' : 'Direct Supabase path'}</strong></span>
                <span>Signup OTP Route: <strong>{securityTelemetryStatus.signup_otp_ready ? 'সচল' : `যাচাই ব্যর্থ · ${securityTelemetryStatus.signup_otp_code || 'Function/Health অনুপলব্ধ'}`}</strong></span>
                <span>Signup OTP IP: <strong>{securityTelemetryStatus.signup_otp_ip_available ? 'পাওয়া গেছে' : 'পাওয়া যায়নি'}</strong></span>
                <span>OTP Event Writer: <strong>{securityTelemetryStatus.signup_otp_writer_ready ? 'সচল' : 'Run44/Run40 যাচাই প্রয়োজন'}</strong></span>
                <span>OTP Email Capture: <strong>{securityTelemetryStatus.signup_otp_attempt_email_column_ready ? 'প্রস্তুত' : 'যাচাই প্রয়োজন'}</strong></span>
                <span>৩০ দিনের Cleanup: <strong>{securityTelemetryStatus.signup_otp_retention_job_active ? 'সক্রিয়' : 'Cron যাচাই প্রয়োজন'}</strong></span>
              </div>
            </details>
          : <div className="inline-error platform-alert"><Icon name="alert-triangle" size={17}/> Security Telemetry সংযোগ যাচাই ব্যর্থ। Run36 migration, Edge Function Deploy, Origin Allowlist ও Server Secret পরীক্ষা করুন। {securityTelemetryStatus.message || securityTelemetryStatus.code || 'Function অনুপলব্ধ বা পুরোনো সংস্করণে চলছে।'}</div>)}
        {securityOverview && <div className="platform-phase3-stat-grid">
          <Stat label="শেষ ২৪ ঘণ্টার Event" value={securityOverview.events_24h} icon="activity"/>
          <Stat label="শেষ ৭ দিনের Event" value={securityOverview.events_7d} icon="calendar"/>
          <Stat label="ব্যর্থ Login · ২৪ ঘণ্টা" value={securityOverview.failed_logins_24h} icon="lock" onClick={() => openSecurityEvents('login_failed')}/>
          <Stat label="সফল Login · ২৪ ঘণ্টা" value={securityOverview.successful_logins_24h} icon="shield-check" onClick={() => openSecurityEvents('login_success')}/>
          <Stat label="ব্যর্থ Registration · ২৪ ঘণ্টা" value={securityOverview.failed_signups_24h} icon="user-x" onClick={() => openSecurityEvents('signup_failed')}/>
          <Stat label="Registration অনুরোধ · ২৪ ঘণ্টা" value={securityOverview.signup_submitted_24h} icon="user-plus" onClick={() => openSecurityEvents('signup_submitted')}/>
          <Stat label="Reset email অনুরোধ গ্রহণ" value={securityOverview.password_reset_requested_24h} icon="mail-check" onClick={() => openSecurityEvents('password_reset_requested')}/>
          <Stat label="Password Reset ব্যর্থ · ২৪ ঘণ্টা" value={securityOverview.password_reset_failed_24h} icon="key-round" onClick={() => openSecurityEvents('password_reset_failed')}/>
          <Stat label="সক্রিয় Auth IP Block" value={securityOverview.active_auth_ip_blocks} icon="shield-alert" onClick={() => setSecurityEventFilter('login_failed')}/>
          <Stat label="সক্রিয় Reset IP Block" value={securityOverview.active_reset_ip_blocks} icon="ban" onClick={() => setSecurityEventFilter('password_reset_requested')}/>
          <Stat label="বারবার ব্যর্থ IP · ২৪ ঘণ্টা" value={securityOverview.repeat_failure_ips_24h} icon="alert-triangle"/>
          <Stat label="ভিন্ন IP · ২৪ ঘণ্টা" value={securityOverview.unique_ips_24h} icon="globe"/>
        </div>}
        {securityAnalytics30d && <section className="platform-security-review-center">
          <div className="platform-security-review-heading"><div><span className="eyebrow">SECURITY REVIEW · LAST 30 DAYS</span><h4>৩০ দিনের নিরাপত্তা পর্যবেক্ষণ</h4><p>Login, Registration, OTP resend ও Password Reset Event-এর সমন্বিত পর্যালোচনা। প্রতিটি সংখ্যায় চাপ দিলে সংশ্লিষ্ট Event দেখা যাবে।</p></div><span className={securityAnalytics30d.retention_job_active ? 'platform-security-retention-ok' : 'platform-security-retention-warning'}>{securityAnalytics30d.retention_job_active ? '৩০ দিনের দৈনিক Cleanup সক্রিয়' : 'Retention Cron যাচাই প্রয়োজন'}</span></div>
          <div className="platform-security-review-stats">
            <Stat label="মোট Security Event · ৩০ দিন" value={securityAnalytics30d.events_30d} icon="activity"/>
            <Stat label="ব্যর্থ Login · ৩০ দিন" value={securityAnalytics30d.login_failed_30d} icon="lock" onClick={()=>{setSecurityEventFilter('login_failed');setSecurityDateRange(30);}}/>
            <Stat label="সফল Login · ৩০ দিন" value={securityAnalytics30d.login_success_30d} icon="shield-check" onClick={()=>{setSecurityEventFilter('login_success');setSecurityDateRange(30);}}/>
            <Stat label="ব্যর্থ Registration · ৩০ দিন" value={securityAnalytics30d.signup_failed_30d} icon="user-x" onClick={()=>{setSecurityEventFilter('signup_failed');setSecurityDateRange(30);}}/>
            <Stat label="OTP পুনরায় পাঠানো · ৩০ দিন" value={securityAnalytics30d.signup_otp_resend_30d} icon="mail" onClick={()=>{setSecurityEventFilter('signup_otp_resend');setSecurityDateRange(30);}}/>
            <Stat label="রেজিস্ট্রেশন অনুরোধ · ৩০ দিন" value={securityAnalytics30d.signup_submitted_30d} icon="user-plus" onClick={()=>{setSecurityEventFilter('signup_submitted');setSecurityDateRange(30);}}/>
            <Stat label="ইমেইল যাচাই সম্পন্ন · ৩০ দিন" value={securityAnalytics30d.signup_verified_30d} icon="mail-check" onClick={()=>{setSecurityEventFilter('signup_verified');setSecurityDateRange(30);}}/>
            <Stat label="Password Reset অনুরোধ · ৩০ দিন" value={securityAnalytics30d.password_reset_requested_30d} icon="mail-check" onClick={()=>{setSecurityEventFilter('password_reset_requested');setSecurityDateRange(30);}}/>
            <Stat label="Password Reset ব্যর্থ · ৩০ দিন" value={securityAnalytics30d.password_reset_failed_30d} icon="key-round" onClick={()=>{setSecurityEventFilter('password_reset_failed');setSecurityDateRange(30);}}/>
            <Stat label="ভিন্ন IP · ৩০ দিন" value={securityAnalytics30d.unique_ips_30d} icon="globe"/>
          </div>
          {!securityAnalytics30d.retention_job_active && <div className="inline-error platform-alert">৩০ দিনের স্বয়ংক্রিয় Cleanup Job সক্রিয় পাওয়া যায়নি। Run37/Run44 Migration এবং Supabase Cron যাচাই করুন। Cleanup নিশ্চিত না হওয়া পর্যন্ত ৩০ দিনের বেশি পুরোনো Log জমে থাকতে পারে।</div>}
          <div className="platform-security-review-grid">
            <section className="platform-security-review-card"><div className="platform-security-review-card-heading"><strong>দিনভিত্তিক Request Trend</strong><small>শেষ ৩০ দিন · প্রতিটি বার নির্বাচনযোগ্য</small></div><div className="platform-security-daily-chart">{(securityAnalytics30d.daily_30d||[]).map((item)=>{const maxEvents=Math.max(1,...(securityAnalytics30d.daily_30d||[]).map((day)=>Number(day.events)||0));return <button type="button" key={item.date} className="platform-security-day-bar" title={`${item.date} · ${Number(item.events||0).toLocaleString('bn-BD')} Event`} onClick={()=>{setSecurityFromDate(item.date);setSecurityToDate(item.date);setSecurityPage(0);}}><span className="platform-security-day-bar-track"><i style={{height:`${Math.max(3,(Number(item.events||0)/maxEvents)*100)}%`}}/></span><small>{String(item.date||'').slice(8,10)}</small></button>;})}</div><div className="platform-security-chart-legend"><span>কম Event</span><span>বেশি Event</span><b>{Number(securityAnalytics30d.events_30d||0).toLocaleString('bn-BD')} মোট</b></div></section>
            <section className="platform-security-review-card"><div className="platform-security-review-card-heading"><strong>Event-এর ধরন</strong><small>৩০ দিনের মোট</small></div>{(securityAnalytics30d.event_types_30d||[]).length===0 ? <p className="platform-empty">এখনো Event নেই।</p> : <div className="platform-security-breakdown-list">{securityAnalytics30d.event_types_30d.map((item)=><button type="button" key={item.event_type} onClick={()=>{setSecurityEventFilter(item.event_type);setSecurityDateRange(30);}}><span>{securityEventLabel(item.event_type)}</span><b>{Number(item.events||0).toLocaleString('bn-BD')}</b></button>)}</div>}</section>
          </div>
          <div className="platform-security-review-grid platform-security-review-grid-wide">
            <section className="platform-security-review-card"><div className="platform-security-review-card-heading"><strong>Request Origin</strong><small>Top 10 · ৩০ দিন</small></div>{(securityAnalytics30d.top_origins_30d||[]).length===0 ? <p className="platform-empty">Origin তথ্য পাওয়া যায়নি।</p> : <div className="platform-security-breakdown-list">{securityAnalytics30d.top_origins_30d.map((item,index)=><div key={`${item.origin}:${index}`}><span>{item.origin || 'Origin অজানা'}</span><b>{Number(item.events||0).toLocaleString('bn-BD')}</b></div>)}</div>}</section>
          </div>
          <div className="platform-security-data-coverage"><span>IP সহ Event: <strong>{Number(securityAnalytics30d.events_with_ip_30d||0).toLocaleString('bn-BD')}</strong></span><span>IP অনুপস্থিত: <strong>{Number(securityAnalytics30d.events_without_ip_30d||0).toLocaleString('bn-BD')}</strong></span></div>
        </section>}

        {securityOverview && <div className="platform-phase3-stat-grid">
          <Stat label="শেষ ২৪ ঘণ্টার Event" value={securityOverview.events_24h} icon="activity"/>
          <Stat label="শেষ ৭ দিনের Event" value={securityOverview.events_7d} icon="calendar"/>
          <Stat label="ব্যর্থ Login · ২৪ ঘণ্টা" value={securityOverview.failed_logins_24h} icon="lock" onClick={() => openSecurityEvents('login_failed')}/>
          <Stat label="সফল Login · ২৪ ঘণ্টা" value={securityOverview.successful_logins_24h} icon="shield-check" onClick={() => openSecurityEvents('login_success')}/>
          <Stat label="ব্যর্থ Registration · ২৪ ঘণ্টা" value={securityOverview.failed_signups_24h} icon="user-x" onClick={() => openSecurityEvents('signup_failed')}/>
          <Stat label="Registration অনুরোধ · ২৪ ঘণ্টা" value={securityOverview.signup_submitted_24h} icon="user-plus" onClick={() => openSecurityEvents('signup_submitted')}/>
          <Stat label="Reset email অনুরোধ গ্রহণ" value={securityOverview.password_reset_requested_24h} icon="mail-check" onClick={() => openSecurityEvents('password_reset_requested')}/>
          <Stat label="Password Reset ব্যর্থ · ২৪ ঘণ্টা" value={securityOverview.password_reset_failed_24h} icon="key-round" onClick={() => openSecurityEvents('password_reset_failed')}/>
          <Stat label="সক্রিয় Auth IP Block" value={securityOverview.active_auth_ip_blocks} icon="shield-alert" onClick={() => setSecurityEventFilter('login_failed')}/>
          <Stat label="সক্রিয় Reset IP Block" value={securityOverview.active_reset_ip_blocks} icon="ban" onClick={() => setSecurityEventFilter('password_reset_requested')}/>
          <Stat label="বারবার ব্যর্থ IP · ২৪ ঘণ্টা" value={securityOverview.repeat_failure_ips_24h} icon="alert-triangle"/>
          <Stat label="ভিন্ন IP · ২৪ ঘণ্টা" value={securityOverview.unique_ips_24h} icon="globe"/>
        </div>}
        <div className="platform-security-range-presets"><span>Event তালিকার সময়সীমা</span><button type="button" className="secondary-button compact" onClick={()=>setSecurityDateRange(1)}>আজ</button><button type="button" className="secondary-button compact" onClick={()=>setSecurityDateRange(7)}>৭ দিন</button><button type="button" className="secondary-button compact" onClick={()=>setSecurityDateRange(30)}>৩০ দিন</button></div>

        <form className="platform-security-filters" onSubmit={(event)=>{event.preventDefault();setSecurityIpSearch(securityIpSearchDraft.trim());setSecurityPage(0);}}>
          <label className="field-label"><span>Event Type</span><select value={securityEventFilter} onChange={(event)=>{setSecurityEventFilter(event.target.value);setSecurityPage(0);}}><option value="all">সব Event</option><option value="login_failed">ব্যর্থ Login</option><option value="login_success">সফল Login</option><option value="signup_failed">ব্যর্থ Registration</option><option value="signup_submitted">Registration অনুরোধ</option><option value="signup_otp_resend">OTP পুনরায় পাঠানো</option><option value="signup_verified">ইমেইল OTP যাচাই</option><option value="password_reset_failed">ব্যর্থ Password Reset</option><option value="password_reset_requested">Reset email অনুরোধ গ্রহণ</option></select></label>
          <label className="field-label"><span>IP দিয়ে খুঁজুন</span><input value={securityIpSearchDraft} maxLength={80} onChange={(event)=>setSecurityIpSearchDraft(event.target.value)} placeholder="IPv4 / IPv6"/></label>
          <label className="field-label"><span>শুরুর তারিখ</span><input type="date" value={securityFromDate} max={securityToDate || undefined} onChange={(event)=>{setSecurityFromDate(event.target.value);setSecurityPage(0);}}/></label>
          <label className="field-label"><span>শেষ তারিখ</span><input type="date" value={securityToDate} min={securityFromDate || undefined} onChange={(event)=>{setSecurityToDate(event.target.value);setSecurityPage(0);}}/></label>
          <button className="primary-button" type="submit" disabled={securityLoading}>খুঁজুন</button>
          <button className="secondary-button" type="button" onClick={()=>{setSecurityIpSearchDraft('');setSecurityIpSearch('');setSecurityEventFilter('all');setSecurityFromDate('');setSecurityToDate('');setSecurityPage(0);}}>ফিল্টার মুছুন</button>
        </form>
        {securityOverview?.top_origins?.length > 0 && <div className="platform-monitor-country-list"><strong>শেষ ২৪ ঘণ্টার Request Origin</strong>{securityOverview.top_origins.map((item,index)=><div className="platform-monitor-country" key={`${item.origin}:${index}`}><span>{item.origin || 'Origin অজানা'}</span><b>{Number(item.events||0).toLocaleString('bn-BD')} Event</b></div>)}</div>}
        <section className="card platform-panel platform-security-manual-block"><div className="platform-panel-heading"><div><h4>ম্যানুয়াল IP Block</h4><p>নির্দিষ্ট IPv4/IPv6-কে অস্থায়ীভাবে Login/Registration, Password Reset অথবা দুটো জায়গা থেকেই ব্লক করুন।</p></div></div><form className="platform-security-block-form" onSubmit={submitSecurityIpBlock}><label className="field-label"><span>IP Address</span><input type="text" inputMode="text" autoComplete="off" maxLength={45} value={securityBlockIp} onChange={(event)=>setSecurityBlockIp(event.target.value.trim())} placeholder="IPv4 / IPv6" required/></label><label className="field-label"><span>কোন জায়গায় Block হবে</span><select value={securityBlockScope} onChange={(event)=>setSecurityBlockScope(event.target.value)}><option value="both">Login/Registration + Password Reset</option><option value="auth">শুধু Login/Registration</option><option value="password_reset">শুধু Password Reset</option></select></label><label className="field-label"><span>Block-এর মেয়াদ</span><select value={securityBlockDuration} onChange={(event)=>setSecurityBlockDuration(event.target.value)}><option value="15">১৫ মিনিট</option><option value="60">১ ঘণ্টা</option><option value="360">৬ ঘণ্টা</option><option value="1440">২৪ ঘণ্টা</option><option value="10080">৭ দিন</option><option value="43200">৩০ দিন</option></select></label><label className="field-label"><span>কারণ</span><input type="text" maxLength={180} value={securityBlockReason} onChange={(event)=>setSecurityBlockReason(event.target.value)} placeholder="যেমন: অস্বাভাবিক ব্যর্থ প্রচেষ্টা" required/></label><button type="submit" className="danger-button" disabled={securityBlockBusy || !securityBlockIp.trim() || securityBlockReason.trim().length<3}>{securityBlockBusy?'প্রক্রিয়াধীন...':'IP Block করুন'}</button></form><p className="platform-security-block-warning">স্বয়ংক্রিয় ভুল Login/Registration Block নির্দিষ্ট IP ও চেষ্টা করা ইমেইলের জোড়ায় প্রযোজ্য; একই Wi-Fi/CGNAT IP থেকে অন্য ইমেইল ব্যবহারকারী এতে ব্লক হবেন না। এই Super Admin Manual Global IP Block ওই IP থেকে আসা সব ইমেইল ও অ্যাকাউন্টে প্রযোজ্য হবে। আগে Event ও কারণ যাচাই করুন। প্রতিটি Block/Unblock Audit Log-এ লেখা হবে।</p></section>
        <section className="card platform-panel platform-monitor-blocks"><div className="platform-panel-heading"><div><h4>সক্রিয় IP Block</h4><p>সার্ভারে বর্তমানে কার্যকর অস্থায়ী block। মেয়াদ শেষে স্বয়ংক্রিয়ভাবে আর block হিসেবে গণ্য হবে না।</p></div><span className="platform-panel-count">{securityIpBlocks.length.toLocaleString('bn-BD')}</span></div>{securityIpBlocksError && <div className="inline-error">{securityIpBlocksError}</div>}{securityIpBlocks.length===0 ? <p className="platform-empty">এখন কোনো সক্রিয় IP Block নেই।</p> : <div className="platform-retention-list">{securityIpBlocks.map((block)=><div className="platform-retention-row" key={`${block.scope}:${block.ip_address}:${block.attempt_email || 'global'}`}><div><strong>{block.ip_address} · {block.scope==='auth'?'Login/Registration':'Password Reset'}</strong><small>{block.attempt_email ? `নির্দিষ্ট ইমেইল: ${block.attempt_email}` : 'ম্যানুয়াল Global IP Block'} · {Number(block.attempt_count||0).toLocaleString('bn-BD')}টি প্রচেষ্টা · {block.block_reason}</small><small>ব্লক শেষ: {formatPlatformDate(block.blocked_until)}</small></div><div className="platform-security-block-actions"><button type="button" className="text-button" onClick={()=>{setSecurityIpSearchDraft(block.ip_address);setSecurityIpSearch(block.ip_address);setSecurityDateRange(30);setActivityView('security');}}>Event দেখুন <Icon name="external-link" size={14}/></button><button type="button" className="text-button danger-text" disabled={securityBlockBusy} onClick={()=>releaseSecurityIpBlock(block)}>Block তুলে দিন</button></div></div>)}</div>}</section>
        {securityError && <div className="inline-error platform-alert">{securityError}</div>}
        {securityLoading ? <div className="platform-empty"><LoadingSpinner label="Security Event লোড হচ্ছে..."/></div> : securityRows.length===0 ? <div className="platform-empty-state"><Icon name="shield-check" size={27}/><strong>{securityTelemetryStatus?.ready === false ? 'Security Telemetry এখনো যাচাই করা যায়নি' : 'কোনো Security Event নেই'}</strong><span>{securityTelemetryStatus?.ready === false ? 'সংযোগ সচল না হওয়া পর্যন্ত শূন্য সংখ্যাকে প্রকৃত নিরাপত্তা-তথ্য ধরে নেবেন না।' : 'নির্বাচিত সময়সীমায় কোনো সংরক্ষিত Event পাওয়া যায়নি। নতুন Event-এ চেষ্টা করা ইমেইল সংরক্ষিত হবে; পুরোনো Event-এ তথ্য না থাকলে তা পুনরুদ্ধার করা সম্ভব নয়।'}</span></div> : <div className="platform-security-list">{securityRows.map((row)=>{
          const actorName = String(row.actor_name || '').trim();
          const actorLabel = actorName || (row.actor_user_id ? `নাম সংরক্ষিত নেই · User ${String(row.actor_user_id).slice(0, 8)}` : row.identity_ref ? `পরিচয় রেফারেন্স · ${row.identity_ref}` : 'ব্যবহারকারী যাচাই হয়নি');
          return <article className="platform-security-item" key={row.id}>
            <div className="platform-audit-top"><div><strong>{securityEventLabel(row.event_type)}</strong><small>{row.failure_code || (row.event_type === 'login_success' ? 'Auth পরিচয় যাচাইকৃত' : 'ফলাফল কোড নেই')}</small>{row.risk_level==='high'?<span className="platform-security-risk risk-high">উচ্চ পুনরাবৃত্তি</span>:row.risk_level==='review'?<span className="platform-security-risk risk-review">পর্যালোচনা দরকার</span>:null}</div><time>{formatPlatformDate(row.created_at)}</time></div>
            <div className="platform-security-actor"><Icon name={row.actor_user_id ? 'user-check' : 'user'} size={16}/><div><strong>{actorLabel}</strong><small>{row.actor_user_id ? `যাচাইকৃত User ID · …${String(row.actor_user_id).slice(-8)}` : row.identity_ref ? 'পরিচয়-রেফারেন্স' : 'এই Event থেকে নির্দিষ্ট অ্যাকাউন্ট নিশ্চিত করা যায়নি'}</small></div></div>
            <div className="platform-security-email"><Icon name="mail" size={14}/><span>চেষ্টা করা ইমেইল: <strong>{row.attempt_email || 'এই পুরোনো Event-এ সংরক্ষিত নেই'}</strong></span></div>
            {(row.matched_profile_name || row.matched_phone || (Array.isArray(row.matched_memberships) && row.matched_memberships.length > 0)) && <div className="platform-security-match"><strong>সংশ্লিষ্ট অ্যাকাউন্টের তথ্য</strong>{row.matched_profile_name && <span>নাম: {row.matched_profile_name}</span>}{row.matched_phone && <span>ফোন: {row.matched_phone}</span>}{Array.isArray(row.matched_memberships) && row.matched_memberships.map((membership,index)=><span key={`${membership.hostel_name}:${index}`}>মেস: {membership.hostel_name} · ভূমিকা: {membership.role} · অবস্থা: {membership.status}</span>)}</div>}
            <div className="platform-security-ip"><Icon name="globe" size={14}/> IP: <strong>{row.ip_address || 'IP পাওয়া যায়নি'}</strong></div>
            {(row.ip_attempts_15m>0 || row.identity_attempts_15m>0) && <small className="platform-security-agent">শেষ ১৫ মিনিটে একই IP: {Number(row.ip_attempts_15m||0).toLocaleString('bn-BD')} · একই পরিচয়: {Number(row.identity_attempts_15m||0).toLocaleString('bn-BD')}টি ব্যর্থ প্রচেষ্টা</small>}
            {Number(row.ip_attempts_1m||0)>0 && <small className="platform-security-agent">শেষ ১ মিনিটে একই IP: {Number(row.ip_attempts_1m).toLocaleString('bn-BD')}টি ব্যর্থ Login/Registration</small>}
            {row.active_block_until && <span className="platform-security-risk risk-high">সক্রিয় Block · শেষ {formatPlatformDate(row.active_block_until)}</span>}
            <details className="platform-security-event-details"><summary>Event-এর বিস্তারিত দেখুন</summary><div className="platform-security-event-details-grid">
              <div><span>ঘটনার সময়</span><strong>{formatPlatformDate(row.created_at)}</strong></div>
              <div><span>চেষ্টা করা ইমেইল</span><strong>{row.attempt_email || 'সংরক্ষিত নেই'}</strong></div>
              <div><span>ম্যাচ হওয়া অ্যাকাউন্ট</span><strong>{row.matched_profile_name || (row.matched_user_id ? `User …${String(row.matched_user_id).slice(-8)}` : 'পাওয়া যায়নি')}</strong></div>
              <div><span>Request Origin:</span><strong>{row.request_origin || 'পাওয়া যায়নি'}</strong></div>
              <div><span>IP Attempts · ১ মিনিট</span><strong>{Number(row.ip_attempts_1m||0).toLocaleString('bn-BD')}</strong></div>
              <div><span>IP Attempts · ১৫ মিনিট</span><strong>{Number(row.ip_attempts_15m||0).toLocaleString('bn-BD')}</strong></div>
              <div className="platform-security-event-agent"><span>Browser / User-Agent</span><strong>{row.user_agent || 'পাওয়া যায়নি'}</strong></div>
            </div></details>
          </article>;
        })}</div>}
        <div className="platform-history-pager"><span>{securityTotal.toLocaleString('bn-BD')}টি Event · পৃষ্ঠা {securityTotal?securityPage+1:0} / {Math.max(1,Math.ceil(securityTotal/pageSize))}</span><div><button className="secondary-button compact" type="button" disabled={securityLoading||securityPage===0} onClick={()=>setSecurityPage(value=>Math.max(0,value-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={securityLoading||(securityPage+1)*pageSize>=securityTotal} onClick={()=>setSecurityPage(value=>value+1)}>পরের</button></div></div>
      </>}
    </section>}

    {tab === 'health' && <section className="card platform-panel platform-phase3-panel">
      <div className="platform-panel-heading"><div><span className="eyebrow">PLATFORM HEALTH</span><h3>মেসের কার্যক্রম ও সিস্টেম স্বাস্থ্য</h3><p>মেসভিত্তিক অপারেশনাল সংকেত। এগুলো সম্ভাব্য সমস্যা শনাক্ত করে; কোনো মেসে স্বয়ংক্রিয় পরিবর্তন করে না।</p></div><button type="button" className="secondary-button compact" disabled={healthLoading} onClick={loadSystemHealth}><Icon name="refresh" size={15}/> রিফ্রেশ</button></div>
      <div className="platform-phase3-toolbar"><label className="field-label"><span>কত দিনের নিষ্ক্রিয়তাকে সতর্কতা ধরবে</span><select value={healthStaleDays} onChange={(event)=>setHealthStaleDays(event.target.value)}><option value="7">৭ দিন</option><option value="14">১৪ দিন</option><option value="30">৩০ দিন</option><option value="60">৬০ দিন</option></select></label><span className="platform-phase3-note">শুধু পর্যবেক্ষণ · নতুন মেসে ৪৮ ঘণ্টা ছাড় · ৮+ অপেক্ষমাণ অনুরোধে সতর্কতা · কোনো অটোমেটিক ব্লক নয়</span></div>
      {healthError && <div className="inline-error platform-alert">{healthError}</div>}
      {databaseHealthError && <div className="platform-health-runtime-warning"><Icon name="info" size={16}/><span>{databaseHealthError}</span></div>}
      {databaseHealthData && <section className="platform-database-runtime" aria-label="Database Runtime Health">
        <div className="platform-database-runtime-heading"><div><span className="eyebrow">DATABASE RUNTIME · READ ONLY</span><h4>ডাটাবেজের বর্তমান ব্যবহার</h4><p>PostgreSQL-এর বর্তমান মাপ; Supabase Billing Plan-এর পূর্ণ কোটা বা Edge/Egress ব্যবহার নয়।</p></div><small>তথ্য: {formatPlatformDate(databaseHealthData.captured_at)}</small></div>
        <div className="platform-database-runtime-stats">
          <InsightStat label="Database Size" value={formatBytes(databaseHealthData.database_size_bytes)} icon="database" hint="বর্তমান Database-এর মোট আকার" />
          <InsightStat label="Connection ব্যবহার" value={databaseHealthData.connection_usage_percent} format="percent" icon="activity" hint={`${Number(databaseHealthData.connection_count||0).toLocaleString('bn-BD')} / ${Number(databaseHealthData.max_connections||0).toLocaleString('bn-BD')}টি সংযোগ`} />
          <InsightStat label="Active Connection" value={databaseHealthData.active_connections} icon="globe" hint={`${Number(databaseHealthData.idle_connections||0).toLocaleString('bn-BD')}টি idle`} />
          <InsightStat label="Lock Waiting" value={databaseHealthData.lock_waiting_sessions} icon="lock" hint={`${Number(databaseHealthData.ungranted_locks||0).toLocaleString('bn-BD')}টি ungranted lock`} />
          <InsightStat label="৫ মিনিটের বেশি Query" value={databaseHealthData.long_running_queries_over_5m} icon="clock" hint="বর্তমানে চলমান query" />
          <InsightStat label="Buffer Cache Hit" value={databaseHealthData.buffer_cache_hit_percent} format="percent" icon="activity" hint="PostgreSQL statistics since reset" />
          <InsightStat label="Deadlock" value={databaseHealthData.deadlocks_since_stats_reset} icon="alert-triangle" hint="Statistics reset-এর পর থেকে" />
          <InsightStat label="Committed Transaction" value={databaseHealthData.transactions_committed_since_stats_reset} icon="check-circle" hint="Statistics reset-এর পর থেকে" />
          <InsightStat label="Rolled Back Transaction" value={databaseHealthData.transactions_rolled_back_since_stats_reset} icon="alert-circle" hint="Statistics reset-এর পর থেকে" />
        </div>
        {Array.isArray(databaseHealthData.top_tables) && databaseHealthData.top_tables.length>0 && <div className="platform-database-table-sizes"><div className="platform-phase3-list-heading"><h4>সবচেয়ে বড় Public Table</h4><small>মোট সর্বোচ্চ ১০টি</small></div><div className="platform-database-table-list">{databaseHealthData.top_tables.map((row)=> <div key={`${row.schema}.${row.table}`}><span>{row.schema}.{row.table}</span><strong>{formatBytes(row.total_bytes)}</strong></div>)}</div></div>}
        <p className="platform-database-runtime-note"><Icon name="shield-check" size={15}/> এই তথ্যগুলো read-only PostgreSQL statistics। Transaction/Deadlock/Cache হিসাবের পরিসংখ্যান শেষ Reset থেকে; Reset: {databaseHealthData.statistics_reset_at ? formatPlatformDate(databaseHealthData.statistics_reset_at) : 'সময় অনুপলব্ধ'}। Supabase Plan quota, Network Egress, Edge Function invocation ও dashboard billing usage এখানে উপলভ্য নয়।</p>
      </section>}
      {healthLoading ? <div className="platform-empty"><LoadingSpinner label="মেসের স্বাস্থ্য পরীক্ষা হচ্ছে..."/></div> : healthData ? <>
        <div className="platform-phase3-stat-grid">
          <Stat label="মোট মেস" value={healthData.totals?.hostel_count} icon="home" onClick={() => { setHealthSeverityFilter('all'); setHealthIssueFilter('all'); }} active={healthSeverityFilter === 'all' && healthIssueFilter === 'all'}/>
          <Stat label="স্বাভাবিক" value={healthData.totals?.healthy_hostel_count} icon="check-circle" onClick={() => { setHealthSeverityFilter('healthy'); setHealthIssueFilter('all'); }} active={healthSeverityFilter === 'healthy'}/>
          <Stat label="জরুরি সমস্যা" value={healthData.totals?.critical_hostel_count} icon="warning" onClick={() => { setHealthSeverityFilter('critical'); setHealthIssueFilter('all'); }} active={healthSeverityFilter === 'critical'}/>
          <Stat label="পর্যালোচনা দরকার" value={healthData.totals?.warning_hostel_count} icon="alert-circle" onClick={() => { setHealthSeverityFilter('warning'); setHealthIssueFilter('all'); }} active={healthSeverityFilter === 'warning'}/>
          <Stat label="তথ্য" value={healthData.totals?.info_hostel_count} icon="info" onClick={() => { setHealthSeverityFilter('info'); setHealthIssueFilter('all'); }} active={healthSeverityFilter === 'info'}/>
        </div>
        <div className="platform-phase3-breakdown" aria-label="Health issue filters">
          {[
            ['missing_running_period', 'চলমান মাস নেই', 'missing_running_period_count'],
            ['no_active_members', 'সক্রিয় সদস্য নেই', 'no_active_members_count'],
            ['primary_manager_unavailable', 'প্রধান ম্যানেজার সমস্যা', 'primary_manager_unavailable_count'],
            ['stale_activity', 'দীর্ঘদিন কার্যক্রম নেই', 'stale_activity_count'],
            ['pending_request_backlog', 'অপেক্ষমাণ অনুরোধ', 'pending_request_backlog_count'],
          ].map(([code, label, countKey]) => <button key={code} type="button" className={healthIssueFilter === code ? 'is-active' : ''} aria-pressed={healthIssueFilter === code} onClick={() => { setHealthIssueFilter((current) => current === code ? 'all' : code); setHealthSeverityFilter('all'); }}>
            {label}: <b>{Number(healthData.totals?.[countKey] || 0).toLocaleString('bn-BD')}</b>
          </button>)}
          {(healthIssueFilter !== 'all' || healthSeverityFilter !== 'all') && <button type="button" className="platform-health-filter-reset" onClick={() => { setHealthIssueFilter('all'); setHealthSeverityFilter('all'); }}>সব দেখুন</button>}
        </div>
        <div className="platform-phase3-list-heading"><h4>{healthIssueFilter !== 'all' ? 'নির্বাচিত সমস্যার মেস' : healthSeverityFilter === 'all' ? 'যেসব মেসে নজর দেওয়া দরকার' : 'নির্বাচিত Health অবস্থা'}</h4><small>{Number(visibleHealthItems.length||0).toLocaleString('bn-BD')}টি মেস · {healthData.stale_days} দিনের নিষ্ক্রিয়তা সীমা</small></div>
        {!visibleHealthItems.length ? <div className="platform-empty-state"><Icon name="shield-check" size={28}/><strong>{healthSeverityFilter === 'all' && healthIssueFilter === 'all' ? 'কোনো উল্লেখযোগ্য সমস্যা পাওয়া যায়নি' : 'এই ফিল্টারে মেস নেই'}</strong><span>{healthSeverityFilter === 'all' && healthIssueFilter === 'all' ? 'এই মুহূর্তে মেসগুলোর জন্য কোনো Health Alert নেই।' : 'অন্য Health ফিল্টার নির্বাচন করুন।'}</span></div> : <div className="platform-health-list">{visibleHealthItems.map((row)=><button type="button" className="platform-health-item platform-health-item-action" key={row.hostel_id} onClick={() => openHealthHostel(row)}>
          <div className="platform-health-item-top"><div><strong>{row.hostel_name}</strong><small>{row.running_period_label || (row.running_period_id?'চলমান মাস':'চলমান মাস নেই')} · {row.platform_status==='suspended'?'স্থগিত মেস':'সক্রিয় মেস'}</small></div><span className={`platform-health-severity severity-${row.severity}`}>{systemSeverityLabel(row.severity)}</span></div>
          <div className="platform-health-issues">{(row.issue_codes||[]).map(code=><span key={code}>{systemIssueLabel(code)}</span>)}</div>
          <div className="platform-health-meta"><span>সক্রিয় সদস্য: <b>{Number(row.active_members||0).toLocaleString('bn-BD')}</b></span><span>অপেক্ষমাণ অনুরোধ: <b>{Number(row.pending_requests||0).toLocaleString('bn-BD')}</b></span><span>সর্বশেষ কার্যক্রম: <b>{(row.last_activity_at ? formatPlatformDate(row.last_activity_at) : 'কোনো এন্ট্রি রেকর্ড নেই')}</b></span></div>
        </button>)}</div>}
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
        <div className="platform-report-header"><div><span className="eyebrow">REPORT PERIOD</span><h4>{reportData.from_date} — {reportData.to_date}</h4><small>তৈরি: {formatPlatformDate(reportData.generated_at)}</small></div><div className="platform-report-download-actions"><button className="primary-button" type="button" onClick={downloadPlatformReport}><Icon name="download" size={16}/> CSV ডাউনলোড</button><button className="secondary-button" type="button" onClick={downloadPlatformReportJson}><Icon name="file-text" size={16}/> JSON ডাউনলোড</button></div></div>
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
      <div className="platform-backup-runbook">
        <div><span className="eyebrow">SAFE RECOVERY SEQUENCE</span><h4>Backup ও Restore-এর নিরাপদ ধাপ</h4><p>Backup তৈরি হওয়া মানেই Restore প্রস্তুত নয়। Restore-এর আগে প্রতিটি ধাপ সম্পন্ন করুন।</p></div>
        <ol>
          <li><strong>Backup তৈরি করুন</strong><span>Migration বা বড় পরিবর্তনের আগে Master Backup নিন; প্রয়োজনে আলাদা Hostel Backup রাখুন।</span></li>
          <li><strong>Integrity যাচাই করুন</strong><span>Verify Backup চালিয়ে AES-GCM Authentication ও SHA-256 Manifest মিলিয়ে নিন।</span></li>
          <li><strong>Dry Run করুন</strong><span>Master Restore শুধু নতুন/খালি Target Project-এ। Source Project-এ Restore করবেন না।</span></li>
          <li><strong>Test Project-এ Restore পরীক্ষা</strong><span>Production-এ ব্যবহারের আগে আলাদা Test Project-এ Database, Auth ও Storage যাচাই করুন।</span></li>
        </ol>
        <p className="platform-backup-runbook-warning"><Icon name="alert-triangle" size={15}/> Auth Provider, SMTP, Secrets, Realtime, Edge Function Deploy, Vercel Environment ও Active Session আলাদাভাবে পুনরায় কনফিগার/যাচাই করতে হবে। Active Session Restore হয় না।</p>
      </div>
      <div className="platform-backup-scope-note"><strong>কোন তথ্য Restore হবে, আর কোনগুলো আলাদা করতে হবে</strong><div><span><Icon name="check-circle" size={15}/> Database schema/data, Auth User ও Identity snapshot, Storage files, SQL ও Edge Function source archive-এর অংশ।</span><span><Icon name="alert-circle" size={15}/> Active Session/Refresh Token, Supabase Auth Provider/SMTP, Project Secret, Edge Function deploy/secret, Vercel Environment/Domain, Realtime publication ও Cron Job স্বয়ংক্রিয়ভাবে পুনরুদ্ধার হয় না।</span></div></div>
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
        <div><strong>Windows Backup Assistant</strong><p>এই ZIP-টি Assistant সফটওয়্যার; প্রকৃত Backup File নয়। Windows-এ Extract করে <code>RUN_BACKUP_ASSISTANT.bat</code> চালান। প্রথমবারের প্রয়োজনীয় Python Package, Supabase CLI, Docker Desktop ও PostgreSQL Client Tool README-তে দেওয়া আছে।</p></div>
        <a className="primary-button" href="/downloads/Hostel_Life_Backup_Assistant_Windows_Package.zip" download><Icon name="download" size={16}/> Windows Assistant ZIP ডাউনলোড</a>
      </div>
      <section className="platform-backup-restore-guide" aria-label="Backup File Restore নির্দেশনা">
        <div className="platform-backup-restore-heading"><Icon name="upload" size={20}/><div><h4>ডাউনলোড করা Backup File কোথায় Restore করবেন?</h4><p>এই Web Panel-এ `.hlbackup` upload করার জায়গা নেই। নিরাপত্তার জন্য File নির্বাচন ও Restore আলাদা Windows Assistant-এর ভেতরে হবে।</p></div></div>
        <ol>
          <li><strong>Assistant চালু করুন</strong><span>ZIP Extract করে `RUN_BACKUP_ASSISTANT.bat` খুলুন।</span></li>
          <li><strong>Restore &amp; Recovery ট্যাব খুলুন</strong><span>Assistant-এর উপরের Tab থেকে <b>Restore &amp; Recovery</b> নির্বাচন করুন।</span></li>
          <li><strong>Backup File নির্বাচন করুন</strong><span>`.hlbackup File` অংশে <b>Backup File</b> বোতাম চাপুন এবং আগে তৈরি করা `.hlbackup` ফাইলটি নির্বাচন করুন। তারপর Backup Encryption Password দিন।</span></li>
          <li><strong>Target ও Dry Run যাচাই করুন</strong><span>Target Supabase URL, Project Ref, Database Connection ও Target Secret Key দিন। প্রথমে <b>প্রথমে Dry Run / Target Check</b> চালান।</span></li>
          <li><strong>সব যাচাই সফল হলেই Restore</strong><span>নির্দেশিত `RESTORE &lt;Target Project Ref&gt;` লিখে Restore / Resume শুরু করুন। Master Backup শুধু নতুন/খালি Target Project-এ Restore করবেন। Hostel Backup-এর জন্য সামঞ্জস্যপূর্ণ Schema ও Target-এ সংশ্লিষ্ট Auth User আগে থেকে থাকতে হবে।</span></li>
        </ol>
        <p className="platform-backup-restore-warning"><Icon name="shield-alert" size={15}/> Production Project-এ পরীক্ষা হিসেবে Restore করবেন না। আগে আলাদা Staging Project-এ Dry Run ও পূর্ণ Restore Rehearsal করুন।</p>
      </section>
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
          {[['all','সব মেস'],['active','সক্রিয়'],['suspended','স্থগিত'],['recent','নতুন'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত']].map(([key,label])=><button type="button" key={key} className={hostelFilter===key?'active':''} onClick={()=>setHostelFilter(key)}>{label}</button>)}
        </div>
        {filteredHostels.length===0?<p className="platform-empty">এই ফিল্টারে কোনো মেস পাওয়া যায়নি।</p>:<div className="platform-hostel-list">{visibleHostels.map((hostel)=><div className={`platform-hostel-entry ${selected?.hostel_id===hostel.hostel_id?'selected':''}`} key={hostel.hostel_id}>
          <button className={`platform-hostel-row ${selected?.hostel_id===hostel.hostel_id?'selected':''}`} type="button" disabled={busy} onClick={()=>openHostel(hostel)}>
            <span className="platform-hostel-icon"><Icon name="home" size={19}/></span><span className="platform-hostel-copy"><strong>{hostel.name}</strong><small>{hostel.member_count} জন সক্রিয় সদস্য · {hostel.created_at?new Date(hostel.created_at).toLocaleDateString():'—'}</small><small className="platform-hostel-id">{hostel.hostel_id}</small></span><span className={`platform-status status-${hostel.platform_status||'active'}`}>{hostel.platform_status==='soft_deleted'?'বন্ধ':hostel.platform_status==='suspended'?'স্থগিত':'সক্রিয়'}</span>
          </button>
          <div className="platform-quick-flags"><button type="button" title="পছন্দের মেস" aria-pressed={Boolean(hostel.is_favorite)} className={hostel.is_favorite?'flag-active':''} disabled={busy} onClick={()=>toggleHostelFlag(hostel,'favorite')}>⭐</button><button type="button" title="বিশ্বস্ত মেস" aria-pressed={Boolean(hostel.is_trusted)} className={hostel.is_trusted?'flag-active':''} disabled={busy} onClick={()=>toggleHostelFlag(hostel,'trusted')}>✓</button></div>
        </div>)}</div>}
        {filteredHostels.length > pageSize && <div className="platform-pagination"><button className="secondary-button compact" type="button" disabled={hostelPage === 1} onClick={() => setHostelPage(page => page - 1)}>আগের</button><span>{hostelPage} / {Math.ceil(filteredHostels.length / pageSize)}</span><button className="secondary-button compact" type="button" disabled={hostelPage * pageSize >= filteredHostels.length} onClick={() => setHostelPage(page => page + 1)}>পরের</button></div>}
      </div>
      <div className="card platform-panel">
        {selected?<>
          <div className="platform-panel-heading"><div><span className="eyebrow">মেস কন্ট্রোল</span><h3>{selected.name}</h3><p>মেস ID: <code>{selected.hostel_id}</code></p></div><button className="text-button" type="button" disabled={busy} onClick={()=>{memberActivityRequestRef.current+=1;memberSessionRequestRef.current+=1;hostelMembersRequestRef.current+=1;setBusy(false);setSelected(null);setMembers([]);setMemberListLoadedHostelId('');setMemberActivityTarget(null);setMemberActivityOverview(null);setMemberActivityRows([]);setMemberSessionRows([]);setMemberSessionTotal(0);setMemberActivityError('');setMemberSessionError('');}}>বন্ধ করুন</button></div>
          <div className="platform-flag-actions"><button type="button" className={selected.is_favorite?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'favorite')}>⭐ {selected.is_favorite?'পছন্দে আছে':'পছন্দে রাখুন'}</button><button type="button" className={selected.is_trusted?'platform-flag-button active':'platform-flag-button'} disabled={busy} onClick={()=>toggleHostelFlag(selected,'trusted')}>✓ {selected.is_trusted?'বিশ্বস্ত চিহ্নিত':'বিশ্বস্ত হিসেবে চিহ্নিত'}</button></div>
          <Field label="অ্যাকশন নোট / কারণ (ঐচ্ছিক)" value={reason} onChange={setReason} maxLength={300}/>
          <div className="platform-action-row"><button className="secondary-button" disabled={busy||selectedStatus==='active'} type="button" onClick={()=>changeHostelStatus('active')}>চালু করুন</button><button className="secondary-button" disabled={busy||selectedStatus==='suspended'} type="button" onClick={()=>changeHostelStatus('suspended')}>স্থগিত করুন</button></div>
          <div className="platform-permanent-delete"><strong><Icon name="trash" size={16}/> স্থায়ীভাবে মুছে ফেলুন</strong><p>মেসের meal, বাজার, হিসাব, সদস্য ও সংশ্লিষ্ট ডেটা স্থায়ীভাবে মুছে যাবে। এটি ফেরানো যাবে না।</p><button className="danger-button" disabled={busy} type="button" onClick={() => { setDeleteDialog({kind:'hostel'}); setDeleteConfirmation(''); setDeleteAccounts(false); setError(''); }}>{busy?'অপেক্ষা করুন...':'Super Delete · মেস ও সব ডেটা'}</button></div>
          <div className="platform-panel-heading platform-members-heading"><div><h3>সদস্য তালিকা</h3><p>শুধু পরিচয় ও স্ট্যাটাস · কোনো আর্থিক/মিলের রেকর্ড নয়</p></div></div>
          <Field label="সদস্য খুঁজুন (নাম, ফোন বা ID)" value={memberQuery} onChange={setMemberQuery} maxLength={120}/>
          <div className="platform-filter-pills" role="group" aria-label="সদস্য ফিল্টার">{[['all','সব'],['manager','প্রধান ম্যানেজার'],['assistant','সহকারী'],['member','সাধারণ সদস্য'],['favorite','⭐ পছন্দের'],['trusted','✓ বিশ্বস্ত'],['blocked','ব্লক']].map(([key,label])=><button type="button" key={key} className={memberFilter===key?'active':''} onClick={()=>setMemberFilter(key)}>{label}</button>)}</div>
          {busy?<LoadingSpinner label="তথ্য আপডেট হচ্ছে..."/>:sortedMembers.length===0?<p className="platform-empty">এই ফিল্টারে কোনো সদস্য নেই।</p>:<div className="platform-members-list">{visibleMembers.map((member)=><div className="platform-member-row" key={member.membership_id}>
            <div className="platform-avatar">{member.avatar_url ? <img src={member.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : String(member.full_name||'স').slice(0,1)}</div><div className="platform-member-copy"><strong>{member.full_name||'নাম নেই'}</strong><div className="platform-role-badges">{memberRoles[member.membership_id]?.primary && <span className="primary">প্রধান ম্যানেজার</span>}{memberRoles[member.membership_id]?.assistant && <span className="assistant">সহকারী ম্যানেজার</span>}{memberRoles[member.membership_id] && !memberRoles[member.membership_id].primary && !memberRoles[member.membership_id].assistant && <span>সাধারণ সদস্য</span>}</div><small>{member.phone||'ফোন নেই'} · যোগদান {member.joined_at?new Date(member.joined_at).toLocaleDateString():'—'}</small>{member.email && <small className="platform-member-email">{member.email}</small>}<small className="platform-hostel-id">{member.user_id}</small><small className="platform-member-presence">সর্বশেষ সক্রিয়: {member.last_seen_at ? `${presenceLabel(member)} · ${formatPlatformDate(member.last_seen_at)}` : 'রেকর্ড নেই'} · সর্বশেষ প্রবেশ: {member.last_login_at ? formatPlatformDate(member.last_login_at) : 'তথ্য নেই'}</small><div className="platform-member-channels">{member.phone && toWhatsAppUrl(member.phone) ? <a className="platform-member-channel-link whatsapp" href={toWhatsAppUrl(member.phone)} target="_blank" rel="noopener noreferrer"><Icon name="message-circle" size={13}/> হোয়াটসঅ্যাপে খুলুন</a> : member.phone ? <span className="platform-member-channel-muted">ফোন: {member.phone}</span> : null}{member.telegram_connected ? <span className="platform-member-channel-state connected"><TelegramLogo size={13} monochrome/> টেলিগ্রাম সংযুক্ত</span> : <span className="platform-member-channel-state"><TelegramLogo size={13} monochrome/> টেলিগ্রাম সংযুক্ত নয়</span>}{member.telegram_connected && member.telegram_username && toTelegramUrl(member.telegram_username) && <a className="platform-member-channel-link telegram" href={toTelegramUrl(member.telegram_username)} target="_blank" rel="noopener noreferrer">@{String(member.telegram_username).replace(/^@/, '')}</a>}</div><div className="platform-member-flags">{member.is_favorite&&<span>⭐ পছন্দের</span>}{member.is_trusted&&<span>✓ বিশ্বস্ত</span>}{member.is_blocked&&<span className="blocked-flag">ব্লক করা</span>}</div></div>
            <div className="platform-member-actions"><span className={`platform-status ${member.status==='active'?'status-active':'status-inactive'}`}>{member.status==='active'?'সক্রিয়':'নিষ্ক্রিয়'}</span><div className="platform-member-action-buttons"><button className={member.is_favorite?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="পছন্দের চিহ্ন" onClick={()=>toggleMemberFlag(member,'favorite')}>⭐</button><button className={member.is_trusted?'platform-mini-action active':'platform-mini-action'} disabled={busy} type="button" title="বিশ্বস্ত চিহ্ন" onClick={()=>toggleMemberFlag(member,'trusted')}>✓</button><button className={member.is_blocked?'secondary-button':'danger-button'} disabled={busy||member.user_id===user?.id} type="button" onClick={()=>toggleBlock(member)}>{member.is_blocked?'আনব্লক':'ব্লক'}</button><button className="secondary-button compact" type="button" onClick={()=>openMemberActivity(member)}>Activity</button><button className="secondary-button compact" disabled={busy||recoveryBusy||member.user_id===user?.id} type="button" onClick={()=>{setRecoveryTarget(member);setRecoveryResult('');setRecoveryNote('');setRecoveryVerified(false);}}>পাসওয়ার্ড সহায়তা</button><button className="danger-button" disabled={busy||member.user_id===user?.id} type="button" onClick={() => { setDeleteDialog({kind:'member', member}); setDeleteConfirmation(''); setDeleteAccounts(false); setError(''); }}>স্থায়ী ডিলিট</button></div></div>
          </div>)}</div>}
          {memberActivityTarget && <section className="platform-member-activity" aria-label="সদস্যের Activity Log">
            <div className="platform-panel-heading"><div><span className="eyebrow">MEMBER ACTIVITY</span><h3>{memberActivityTarget.full_name || 'সদস্য'} · Activity</h3><p>শুধু এই মেসে এই সদস্যের করা ও তাকে-সম্পর্কিত কাজ।</p></div><button className="text-button" type="button" onClick={()=>{memberActivityRequestRef.current+=1;memberSessionRequestRef.current+=1;setMemberActivityTarget(null);setMemberActivityOverview(null);setMemberActivityRows([]);setMemberSessionRows([]);setMemberSessionTotal(0);setMemberActivityError('');setMemberSessionError('');}}>বন্ধ করুন</button></div>
            {memberActivityError && <div className="inline-error platform-alert">{memberActivityError}</div>}
            {memberActivityOverview && <div className="platform-presence-grid">
              <div><small>বর্তমান অবস্থা</small><strong>{memberActivityOverview.is_online?'সাম্প্রতিক সক্রিয়':'এখন সক্রিয় নয়'}</strong></div>
              <div><small>সর্বশেষ সক্রিয়</small><strong>{formatPlatformDate(memberActivityOverview.last_seen_at)}</strong></div>
              <div><small>সর্বশেষ প্রবেশ</small><strong>{formatPlatformDate(memberActivityOverview.last_login_at)}</strong></div>
              <div><small>Last Logout</small><strong>{formatPlatformDate(memberActivityOverview.last_logout_at)}</strong></div>
              <div><small>সফল Login Session</small><strong>{Number(memberActivityOverview.login_count||0).toLocaleString('bn-BD')}</strong></div>
              <div><small>সর্বশেষ Login IP</small><strong>{memberActivityOverview.last_login_ip || 'রেকর্ড নেই'}</strong></div>
            </div>}
            <div className="platform-login-session-history">
              <div className="platform-session-heading"><strong>Login History</strong><span>{memberSessionTotal.toLocaleString('bn-BD')}টি Session</span></div>
              {memberSessionError && <div className="inline-error platform-alert">{memberSessionError}</div>}{memberSessionLoading ? <div className="platform-empty"><LoadingSpinner label="Login History লোড হচ্ছে..."/></div> : memberSessionRows.length===0 ? <p className="platform-activity-history-note">এই মেসে এখনো কোনো Session History রেকর্ড হয়নি।</p> : memberSessionRows.map((session,index)=><article className="platform-login-session" key={`${session.logged_in_at}-${index}`}>
                <div><strong>{session.session_status==='signed_out'?'লগআউট সম্পন্ন':session.session_status==='recently_active'?'সাম্প্রতিক সক্রিয়':'সর্বশেষ সক্রিয়তা পুরোনো'}</strong><small>প্রবেশ: {formatPlatformDate(session.logged_in_at)} · সর্বশেষ সক্রিয়: {formatPlatformDate(session.last_seen_at)}</small>{session.last_logout_at&&<small>বের হয়েছেন: {formatPlatformDate(session.last_logout_at)}</small>}</div>
                <div><small>IP: {session.ip_address||'রেকর্ড নেই'}</small>{session.user_agent&&<small className="platform-session-agent">{session.user_agent}</small>}</div>
              </article>)}
              {memberSessionTotal>20 && <div className="platform-history-pager"><span>Login History · পৃষ্ঠা {memberSessionPage+1} / {Math.ceil(memberSessionTotal/20)}</span><div><button className="secondary-button compact" type="button" disabled={memberSessionLoading||memberSessionPage===0} onClick={()=>loadMemberSessions(memberActivityTarget,Math.max(0,memberSessionPage-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={memberSessionLoading||(memberSessionPage+1)*20>=memberSessionTotal} onClick={()=>loadMemberSessions(memberActivityTarget,memberSessionPage+1)}>পরের</button></div></div>}
              <p className="platform-activity-history-note">একই অ্যাকাউন্টের আলাদা ডিভাইসের Session আলাদাভাবে দেখানো হয়; Session ID প্রকাশ করা হয় না।</p>
            </div>
            {memberActivityOverview?.history_available_from && <p className="platform-activity-history-note">Activity History সংরক্ষণ শুরু: {formatPlatformDate(memberActivityOverview.history_available_from)}। Migration-এর আগের কাজ এখানে থাকবে না।</p>}
            {memberActivityLoading ? <div className="platform-empty"><LoadingSpinner label="সদস্যের Activity Log লোড হচ্ছে..."/></div> : memberActivityRows.length===0 ? <div className="platform-empty-state"><Icon name="history" size={24}/><strong>এখনো Activity Log নেই</strong><span>Module 3 চালুর পরের কার্যক্রম এখানে জমা হবে।</span></div> : <div className="platform-audit-list">{memberActivityRows.map((row)=><article className="platform-audit-item" key={row.id}>
              <div className="platform-audit-top"><div><strong>{activityEventLabel(row.event_type)}</strong><small>{row.source_table || 'auth'} · {row.target_id || '—'}</small></div><time>{formatPlatformDate(row.created_at)}</time></div>
              <div className="platform-audit-actor"><Icon name="user" size={14}/>{row.actor_name || 'অজানা'}{row.subject_name && row.subject_name !== '—' ? ` · সংশ্লিষ্ট: ${row.subject_name}` : ''}</div>
              {activityChangedFields(row.metadata) && <p className="platform-audit-reason">পরিবর্তিত অংশ: {activityChangedFields(row.metadata)}</p>}
              {row.ip_address && <small className="platform-security-ip">Login IP: {row.ip_address}</small>}
            </article>)}</div>}
            {memberActivityTotal > pageSize && <div className="platform-history-pager"><span>{memberActivityTotal.toLocaleString('bn-BD')}টি কার্যক্রম · পৃষ্ঠা {memberActivityPage+1} / {Math.ceil(memberActivityTotal/pageSize)}</span><div><button className="secondary-button compact" type="button" disabled={memberActivityLoading||memberActivityPage===0} onClick={()=>loadMemberActivity(memberActivityTarget,Math.max(0,memberActivityPage-1))}>আগের</button><button className="secondary-button compact" type="button" disabled={memberActivityLoading||(memberActivityPage+1)*pageSize>=memberActivityTotal} onClick={()=>loadMemberActivity(memberActivityTarget,memberActivityPage+1)}>পরের</button></div></div>}
            <div className="platform-activity-footer"><span>ব্যক্তিগত নোট, পাসওয়ার্ড ও আর্থিক পরিমাণ Activity Log-এ সংরক্ষণ করা হয় না।</span><button className="secondary-button compact" type="button" disabled={memberActivityLoading} onClick={()=>{loadMemberActivity(memberActivityTarget,memberActivityPage);loadMemberSessions(memberActivityTarget,memberSessionPage);}}><Icon name="refresh" size={14}/> রিফ্রেশ</button></div>
          </section>}
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
    {tab === 'hostels' && <section className="card platform-panel" aria-label="মেস-বিহীন Auth account">
      <div className="platform-panel-heading"><div><h3>মেস-বিহীন Auth account</h3><p>প্রতি ধাপে সর্বোচ্চ ৫০০টি Auth account পরীক্ষা হয়। কোনো account-এর যেকোনো membership row থাকলে নিরাপত্তার জন্য সেটি এখানে দেখানো হবে না। প্রতি Bulk action-এ সর্বোচ্চ ২৫টি account নেওয়া হবে; সার্ভার প্রতিটি account আবার যাচাই করবে।</p></div><button className="secondary-button compact" disabled={orphanBusy} type="button" onClick={()=>loadOrphanAccounts(1)}>তালিকা রিফ্রেশ</button></div>
      <div className="platform-action-row"><label className="platform-select-all"><input type="checkbox" checked={orphanAccounts.length>0 && orphanSelectedIds.length===Math.min(25,orphanAccounts.length)} disabled={orphanBusy||!orphanAccounts.length} onChange={(event)=>setOrphanSelectedIds(event.target.checked ? orphanAccounts.slice(0,25).map((row)=>row.id) : [])}/> এই ধাপের প্রথম ২৫টি নির্বাচন</label><span>{orphanSelectedIds.length.toLocaleString('bn-BD')} / ২৫ নির্বাচিত</span><button type="button" className="danger-button" disabled={orphanBusy||orphanSelectedIds.length===0||orphanSelectedIds.length>25} onClick={removeSelectedOrphanAccounts}>নির্বাচিতগুলো মুছুন</button></div>
      {orphanError && <p role="alert" className="inline-error">{orphanError}</p>}
      {orphanScanInfo && <p className="platform-retention-hint">{orphanScanInfo.message} {orphanScanInfo.scannedUsers ? `· ${orphanScanInfo.scannedUsers.toLocaleString('en-US')}টি account পরীক্ষা · Auth পৃষ্ঠা ${orphanScanInfo.authPageStart}–${orphanScanInfo.authPageEnd}` : ''}{orphanScanInfo.requestId ? ` · Request ID: ${orphanScanInfo.requestId}` : ''}</p>}
      {orphanAccounts.length===0 && <p className="platform-empty">{orphanScanInfo ? (orphanMore ? 'এই ধাপে মেস-বিহীন account পাওয়া যায়নি। আরও Auth account পরীক্ষা করতে “পরের ধাপ” চাপুন।' : 'Auth তালিকার শেষ পর্যন্ত পরীক্ষা হয়েছে। এই পরীক্ষিত account-গুলোর মধ্যে নিরাপদে মুছে ফেলার যোগ্য মেস-বিহীন account পাওয়া যায়নি।') : 'তালিকা দেখতে “তালিকা রিফ্রেশ” চাপুন।'}</p>}
      <div className="platform-retention-list">{orphanAccounts.map(account=><div className="platform-retention-row" key={account.id}><label className="platform-orphan-select"><input type="checkbox" checked={orphanSelectedIds.includes(account.id)} disabled={orphanBusy||(!orphanSelectedIds.includes(account.id)&&orphanSelectedIds.length>=25)} onChange={(event)=>setOrphanSelectedIds((old)=>event.target.checked ? [...old,account.id] : old.filter((id)=>id!==account.id))}/><span><strong>{account.email || 'ইমেইল নেই'}</strong><small>{account.id}</small></span></label><button type="button" className="danger-button" disabled={orphanBusy} onClick={()=>removeOrphanAccount(account)}>Auth স্থায়ী ডিলিট</button></div>)}</div>
      <div className="platform-action-row"><button type="button" className="secondary-button compact" disabled={orphanBusy || orphanPage===1} onClick={()=>loadOrphanAccounts(orphanPage-1)}>আগের পৃষ্ঠা</button><span>ধাপ {orphanPage} · প্রতিটি ধাপে সর্বোচ্চ ৫০০ account</span><button type="button" className="secondary-button compact" disabled={orphanBusy || !orphanMore} onClick={()=>loadOrphanAccounts(orphanPage+1)}>পরের ধাপ</button></div>
      <p className="platform-retention-hint">মেস থেকে সরানোর পর Auth মুছতে এই অপশন। যাচাই না করে ডিলিট করবেন না; নতুন নিবন্ধিত কিন্তু এখনও মেসে যোগ না দেওয়া account-ও এখানে থাকতে পারে।</p>
    </section>}
    {tab === 'messages' && <>
      <div className="platform-settings-intro"><span className="eyebrow">DIRECT PLATFORM MESSAGE</span><h2>ব্যবহারকারীকে বার্তা পাঠান</h2><p>নির্দিষ্ট মেসের সব সক্রিয় সদস্য অথবা নির্বাচিত সদস্যদের ইনবক্সে বার্তা পাঠান। বার্তা লগইনের পর একবার Popup-এ দেখানো হবে।</p></div>
      <form className="platform-settings-grid platform-message-compose" onSubmit={sendPlatformMessage}>
        <section className="card platform-panel">
          <div className="platform-panel-heading"><div><h3>প্রাপক নির্বাচন</h3><p>প্রাপকের ইনবক্সে বার্তা যাবে; কোনো Auth/Supabase Push Notification ব্যবহার করা হচ্ছে না।</p></div></div>
          <label className="field-label"><span>মেস নির্বাচন</span><SearchableSelect value={messageHostelId} onChange={(value)=>setMessageHostelId(value)} options={hostels.filter((row)=>row.platform_status!=='soft_deleted').map((row)=>({value:row.hostel_id,label:`${row.name} · ${Number(row.member_count||0).toLocaleString('bn-BD')} জন`}))} placeholder="মেস নির্বাচন করুন" ariaLabel="বার্তা পাঠানোর মেস নির্বাচন"/></label>
          <div className="platform-message-recipient-mode"><label className="platform-radio-card"><input type="radio" name="platform-message-recipients" value="all" checked={messageRecipientMode === 'all'} onChange={() => setMessageRecipientMode('all')}/><span><strong>সব সক্রিয় সদস্য</strong><small>নির্বাচিত মেসের সবাই</small></span></label><label className="platform-radio-card"><input type="radio" name="platform-message-recipients" value="selected" checked={messageRecipientMode === 'selected'} onChange={() => setMessageRecipientMode('selected')}/><span><strong>নির্দিষ্ট সদস্য</strong><small>এক বা একাধিক ব্যক্তি</small></span></label></div>
          {messageRecipientMode === 'selected' && <div className="platform-message-member-picker">
            <div className="platform-panel-heading"><div><h4>সক্রিয় সদস্য</h4><p>{messageSelectedUsers.length.toLocaleString('bn-BD')} জন নির্বাচিত</p></div><button type="button" className="text-button" disabled={messageMembersLoading || !messageMembers.length} onClick={() => setMessageSelectedUsers(messageSelectedUsers.length === messageMembers.length ? [] : messageMembers.map((row) => row.user_id))}>{messageSelectedUsers.length === messageMembers.length ? 'সব বাদ' : 'সব নির্বাচন'}</button></div>
            {messageMembersLoading ? <div className="platform-empty"><LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..."/></div> : messageMembersError ? <div className="inline-error platform-alert">{messageMembersError}</div> : messageMembers.length === 0 ? <p className="platform-empty">এই মেসে সক্রিয় সদস্য পাওয়া যায়নি।</p> : <div className="platform-message-members">{messageMembers.map((member) => <label key={member.user_id} className="platform-message-member"><input type="checkbox" checked={messageSelectedUsers.includes(member.user_id)} onChange={(event) => setMessageSelectedUsers((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))}/><span><strong>{member.full_name || 'নাম নেই'}</strong><small>{member.email || member.phone || 'যোগাযোগের তথ্য নেই'}</small></span></label>)}</div>}
          </div>}
        </section>
        <section className="card platform-panel">
          <div className="platform-panel-heading"><div><h3>বার্তার বিষয়বস্তু</h3><p>এটি অ্যাপের Notification Inbox এবং Popup-এ দেখানো হবে। সংযুক্ত ব্যবহারকারীর টেলিগ্রামেও যাবে।</p></div></div>
          <Field label="শিরোনাম" value={messageTitle} onChange={setMessageTitle} maxLength={160}/>
          <Field label="বার্তা" value={messageBody} onChange={setMessageBody} maxLength={3000} multiline/>
          <div className="platform-message-preview"><span className="eyebrow">PREVIEW</span><strong>{messageTitle || 'বার্তার শিরোনাম'}</strong><p>{messageBody || 'বার্তার বিবরণ এখানে দেখা যাবে।'}</p></div>
          <button type="submit" className="primary-button large" disabled={messageSending || !messageHostelId || !messageTitle.trim() || !messageBody.trim() || (messageRecipientMode === 'selected' && !messageSelectedUsers.length)}><Icon name="send" size={16}/>{messageSending ? 'পাঠানো হচ্ছে...' : 'বার্তা পাঠান'}</button>
        </section>
      </form>
    </>}

    {tab === 'telegram' && <>
      <div className="platform-settings-intro platform-settings-intro-compact">
        <span className="eyebrow">বিজ্ঞপ্তির মাধ্যম</span>
        <h2>টেলিগ্রাম সংযোগ ও বার্তা প্রেরণ</h2>
      </div>
      <div className="platform-telegram-admin-grid">
        <section className="card platform-panel platform-telegram-admin-card">
          <div className="platform-panel-heading">
            <div className="platform-telegram-title"><TelegramLogo size={38}/><div><span className="eyebrow">টেলিগ্রাম বট ব্যবস্থা</span><h3>টেলিগ্রাম বট</h3></div></div>
            <span className={`platform-status ${telegramAdminSettings.telegram_enabled ? 'status-active' : 'status-inactive'}`}>{telegramAdminSettings.telegram_enabled ? 'চালু' : 'বন্ধ'}</span>
          </div>
          <form className="platform-telegram-settings-form" onSubmit={saveTelegramAdminSettings}>
            {telegramAdminError && <div className="inline-error platform-alert">{telegramAdminError}</div>}
            <label className="field-label"><span>বটের ইউজারনেম (@ ছাড়া)</span><input value={telegramAdminSettings.telegram_bot_username || ''} onChange={(event) => setTelegramAdminSettings((old) => ({ ...old, telegram_bot_username: event.target.value.replace(/^@/, '') }))} maxLength={32} placeholder="HostelLifeBot" autoComplete="off" spellCheck="false"/></label>
            <label className="platform-toggle"><span><strong>টেলিগ্রাম বার্তা প্রেরণ চালু</strong><small>বন্ধ করলে নতুন টেলিগ্রাম বার্তা তৈরি হবে না। বিদ্যমান অ্যাকাউন্ট সংযোগ অক্ষত থাকবে।</small></span><input type="checkbox" checked={Boolean(telegramAdminSettings.telegram_enabled)} onChange={(event) => setTelegramAdminSettings((old) => ({ ...old, telegram_enabled: event.target.checked }))}/></label>
            <div className="platform-telegram-connection-stat"><Icon name="users" size={18}/><span><strong>{Number(telegramAdminSettings.connected_users || 0).toLocaleString('bn-BD')}</strong><small>সংযুক্ত ব্যবহারকারী</small></span></div>
            <button type="submit" className="primary-button large" disabled={telegramAdminBusy || telegramAdminLoading}>{telegramAdminBusy ? 'সংরক্ষণ হচ্ছে...' : 'সেটিংস সংরক্ষণ'}</button>
          </form>
        </section>

        <section className="card platform-panel platform-telegram-webhook-card">
          <div className="platform-panel-heading"><div><span className="eyebrow">আগত · অ্যাকাউন্ট সংযোগ</span><h3>বট ওয়েবহুক</h3></div><span className={`platform-status ${telegramWebhookStatus?.webhook?.url_matches && telegramWebhookStatus?.bot?.username_matches ? 'status-active' : 'status-inactive'}`}>{telegramWebhookStatus?.webhook?.url_matches && telegramWebhookStatus?.bot?.username_matches ? 'সচল' : telegramWebhookStatus ? 'পরীক্ষা দরকার' : 'অজানা'}</span></div>
          <div className="platform-telegram-check-list">
            <div><span>বট টোকেন যাচাই</span><strong>{telegramWebhookStatus?.bot?.username ? `@${telegramWebhookStatus.bot.username}` : '—'}</strong></div>
            <div><span>সংরক্ষিত ইউজারনেম</span><strong>{telegramWebhookStatus?.bot?.configured_username ? `@${telegramWebhookStatus.bot.configured_username}` : '—'}</strong></div>
            <div><span>ইউজারনেম মিল</span><b className={telegramWebhookStatus?.bot?.username_matches ? 'is-good' : 'is-bad'}>{telegramWebhookStatus ? (telegramWebhookStatus.bot?.username_matches ? 'মিলেছে' : 'মেলেনি') : '—'}</b></div>
            <div><span>ওয়েবহুক ঠিকানা</span><b className={telegramWebhookStatus?.webhook?.url_matches ? 'is-good' : 'is-bad'}>{telegramWebhookStatus ? (telegramWebhookStatus.webhook?.url_matches ? 'সঠিক' : 'সঠিক নয়') : '—'}</b></div>
            <div><span>অপেক্ষমাণ আপডেট</span><strong>{telegramWebhookStatus?.webhook?.pending_update_count === undefined ? '—' : Number(telegramWebhookStatus.webhook.pending_update_count).toLocaleString('bn-BD')}</strong></div>
          </div>
          {telegramWebhookStatus?.webhook?.last_error_message && <div className="platform-telegram-last-error"><strong>টেলিগ্রামের সর্বশেষ ওয়েবহুক ত্রুটি</strong><span>{telegramWebhookStatus.webhook.last_error_message}</span></div>}
          {telegramWebhookError && <div className="inline-error platform-alert" role="alert">{telegramWebhookError}</div>}
          <div className="platform-telegram-actions">
            <button type="button" className="primary-button" disabled={telegramWebhookBusy || telegramAdminLoading} onClick={configureTelegramWebhook}><TelegramLogo size={18}/>{telegramWebhookBusy ? 'ওয়েবহুক যাচাই হচ্ছে...' : 'ওয়েবহুক সেট / মেরামত'}</button>
            <button type="button" className="secondary-button" disabled={telegramAdminLoading} onClick={loadTelegramAdminSettings}><Icon name="refresh-cw" size={16}/> অবস্থা যাচাই</button>
          </div>
          <p className="platform-telegram-inline-note">এই কাজটি Bot টোকেনের বট শনাক্ত করে Supabase Incoming ওয়েবহুক ঠিকানা স্বয়ংক্রিয়ভাবে সেট করে। Username না মিললে সেট করবে না।</p>
        </section>

        <section className="card platform-panel platform-telegram-delivery-card">
          <div className="platform-panel-heading"><div><span className="eyebrow">বহির্গামী · বার্তা প্রেরণ</span><h3>প্রেরণের অবস্থা</h3></div><span className={`platform-status ${telegramDeliveryHealth?.database_webhook_ready ? 'status-active' : 'status-inactive'}`}>{telegramDeliveryHealth?.database_webhook_ready ? 'ডাটাবেজ ট্রিগার পাওয়া গেছে' : telegramDeliveryHealth ? 'ডাটাবেজ ওয়েবহুক নেই' : 'যাচাই হয়নি'}</span></div>
          {telegramDeliveryError && <div className="inline-error platform-alert" role="alert">{telegramDeliveryError}</div>}
          {telegramDeliveryHealth ? <>
            <div className="platform-telegram-check-list">
              <div><span>সেবা</span><strong>{telegramDeliveryHealth.provider_enabled ? 'টেলিগ্রাম চালু' : 'বন্ধ'}</strong></div>
              <div><span>বটের ইউজারনেম</span><strong>{telegramDeliveryHealth.bot_username ? `@${telegramDeliveryHealth.bot_username}` : '—'}</strong></div>
              <div><span>সংযুক্ত ব্যবহারকারী</span><strong>{Number(telegramDeliveryHealth.connected_users || 0).toLocaleString('bn-BD')}</strong></div>
              <div><span>ডাটাবেজ ওয়েবহুক ট্রিগার</span><b className={telegramDeliveryHealth.database_webhook_ready ? 'is-good' : 'is-bad'}>{telegramDeliveryHealth.database_webhook_ready ? 'পাওয়া গেছে' : 'পাওয়া যায়নি'}</b></div>
              <div><span>শেষ ব্যাচ</span><strong>{telegramDeliveryHealth.batches?.latest_status ? telegramDeliveryHealth.batches.latest_status.toUpperCase() : '—'}</strong></div>
            </div>
            <div className="platform-telegram-batch-stats">
              <Stat label="অপেক্ষমাণ" value={telegramDeliveryHealth.batches?.pending} icon="clock" onClick={() => { setTelegramDeliveryFilter('pending'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'pending'}/>
              <Stat label="প্রক্রিয়াধীন" value={telegramDeliveryHealth.batches?.processing} icon="refresh-cw" onClick={() => { setTelegramDeliveryFilter('processing'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'processing'}/>
              <Stat label="পাঠানো হয়েছে" value={telegramDeliveryHealth.batches?.delivered} icon="check-circle" onClick={() => { setTelegramDeliveryFilter('delivered'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'delivered'}/>
              <Stat label="আংশিক" value={telegramDeliveryHealth.batches?.partial} icon="alert-circle" onClick={() => { setTelegramDeliveryFilter('partial'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'partial'}/>
              <Stat label="ব্যর্থ" value={telegramDeliveryHealth.batches?.failed} icon="warning" onClick={() => { setTelegramDeliveryFilter('failed'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'failed'}/>
              <Stat label="বাদ পড়েছে" value={telegramDeliveryHealth.batches?.skipped} icon="minus" onClick={() => { setTelegramDeliveryFilter('skipped'); setTelegramDeliveryPage(0); }} active={telegramDeliveryFilter === 'skipped'}/>
            </div>
            <div className="platform-telegram-outbox-summary"><span>অপেক্ষমাণ / প্রক্রিয়াধীন বার্তা <b>{Number(telegramDeliveryHealth.outbox?.pending_or_processing || 0).toLocaleString('bn-BD')}</b></span><span>ব্যর্থ বার্তা <b>{Number(telegramDeliveryHealth.outbox?.failed || 0).toLocaleString('bn-BD')}</b></span><span>শেষ ব্যাচ: <b>{formatPlatformDate(telegramDeliveryHealth.batches?.latest_created_at)}</b></span></div>
          </> : !telegramDeliveryError && <div className="platform-empty"><LoadingSpinner label="প্রেরণের অবস্থা লোড হচ্ছে..."/></div>}
          {telegramDeliveryHealth && !telegramDeliveryHealth.database_webhook_ready && <div className="platform-telegram-db-setup">
            <strong>ডাটাবেজ ওয়েবহুক সেটআপ প্রয়োজন</strong>
            <p>Supabase Dashboard → Database → Webhooks-এ একটি <b>INSERT</b> ওয়েবহুক তৈরি করুন।</p>
            <code>public.notification_delivery_batches</code>
            <code>{'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-notification-dispatch'}</code>
            <span>Header: <code>x-hostel-delivery-secret</code> · Value: এজ ফাংশনের গোপন মান <code>NOTIFICATION_DISPATCH_WEBHOOK_SECRET</code>-এর একই মান।</span>
          </div>}
          {telegramDeliveryHealth?.database_webhook_ready && <p className="platform-telegram-inline-note">Trigger শনাক্ত হয়েছে। Dashboard-এর URL ও Header Secret আলাদাভাবে যাচাই করুন—সেগুলোর গোপন মান এখানে পড়া বা প্রকাশ করা হয় না।</p>}
        </section>

        <section className="card platform-panel platform-telegram-queue-card">
          <div className="platform-panel-heading"><div><span className="eyebrow">শেষ ৭ দিন</span><h3>সাম্প্রতিক বার্তা ব্যাচ</h3></div><span className="platform-panel-count">{telegramDeliveryTotal.toLocaleString('bn-BD')}টি</span></div>
          <div className="platform-filter-pills platform-telegram-filter-pills">
            {[['all','সব'],['pending','অপেক্ষমাণ'],['processing','প্রক্রিয়াধীন'],['delivered','পাঠানো হয়েছে'],['partial','আংশিক'],['failed','ব্যর্থ'],['skipped','বাদ পড়েছে']].map(([value,label]) => <button key={value} type="button" className={telegramDeliveryFilter === value ? 'active' : ''} aria-pressed={telegramDeliveryFilter === value} onClick={() => { setTelegramDeliveryFilter(value); setTelegramDeliveryPage(0); }}>{label}</button>)}
          </div>
          {telegramBatchError && <div className="inline-error platform-alert" role="alert">{telegramBatchError}</div>}
          {telegramDeliveryLoading ? <div className="platform-empty"><LoadingSpinner label="বার্তা ব্যাচ লোড হচ্ছে..."/></div> : telegramDeliveryRows.length ? <div className="platform-telegram-batch-list">{telegramDeliveryRows.map((batch) => <article className="platform-telegram-batch-row" key={batch.id}>
            <div><strong>ব্যাচ · {String(batch.id).slice(0, 8).toUpperCase()}</strong><small>{formatPlatformDate(batch.created_at)} · {Number(batch.recipient_count || 0).toLocaleString('bn-BD')} জন প্রাপক</small></div>
            <div className="platform-telegram-batch-result"><span className={`platform-status platform-telegram-status-${batch.status}`}>{({ pending: 'অপেক্ষমাণ', processing: 'প্রক্রিয়াধীন', delivered: 'পাঠানো হয়েছে', partial: 'আংশিক', failed: 'ব্যর্থ', skipped: 'বাদ পড়েছে' })[batch.status] || batch.status}</span>{batch.last_error_code && <small>{batch.last_error_code}</small>}</div>
          </article>)}</div> : <div className="platform-empty-state"><Icon name="archive" size={27}/><strong>কোনো বার্তা ব্যাচ নেই</strong><span>নির্বাচিত সময়ে এই Status-এর কোনো Batch তৈরি হয়নি।</span></div>}
          {telegramDeliveryTotal > 10 && <div className="platform-history-pager"><span>পৃষ্ঠা {telegramDeliveryPage + 1} / {Math.ceil(telegramDeliveryTotal / 10)}</span><div><button type="button" className="secondary-button compact" disabled={telegramDeliveryLoading || telegramDeliveryPage === 0} onClick={() => setTelegramDeliveryPage((page) => Math.max(0, page - 1))}>আগের</button><button type="button" className="secondary-button compact" disabled={telegramDeliveryLoading || (telegramDeliveryPage + 1) * 10 >= telegramDeliveryTotal} onClick={() => setTelegramDeliveryPage((page) => page + 1)}>পরের</button></div></div>}
        </section>
      </div>
      <section className="card platform-panel platform-telegram-connections-panel">
        <div className="platform-panel-heading"><div><span className="eyebrow">LINKED TELEGRAM ACCOUNTS</span><h3>সংযুক্ত ব্যবহারকারীর তালিকা</h3><p>কার Telegram account যুক্ত, Telegram User ID ও সংশ্লিষ্ট সক্রিয় মেস দেখা যাবে। Disconnect করলে শুধু Telegram channel এবং pending link token মুছবে—Hostel Life account নয়।</p></div><button type="button" className="secondary-button compact" disabled={telegramConnectionLoading} onClick={loadTelegramConnections}>রিফ্রেশ</button></div>
        <form className="platform-activity-filters" onSubmit={(event)=>{event.preventDefault();setTelegramConnectionSearch(telegramConnectionSearchDraft.trim());setTelegramConnectionPage(0);}}><label className="field-label"><span>নাম, Email, Telegram ID বা Username</span><input value={telegramConnectionSearchDraft} maxLength={120} onChange={(event)=>setTelegramConnectionSearchDraft(event.target.value)} placeholder="Search connection"/></label><button type="submit" className="primary-button" disabled={telegramConnectionLoading}>খুঁজুন</button><button type="button" className="secondary-button" onClick={()=>{setTelegramConnectionSearchDraft('');setTelegramConnectionSearch('');setTelegramConnectionPage(0);}}>মুছুন</button></form>
        {telegramConnectionError && <div className="inline-error platform-alert" role="alert">{telegramConnectionError}</div>}
        {telegramConnectionLoading ? <div className="platform-empty"><LoadingSpinner label="Telegram সংযোগ লোড হচ্ছে..."/></div> : telegramConnections.length===0 ? <p className="platform-empty">কোনো সক্রিয় Telegram সংযোগ পাওয়া যায়নি।</p> : <div className="platform-retention-list">{telegramConnections.map((connection)=><article className="platform-retention-row platform-telegram-connection-row" key={connection.user_id}><div><strong>{connection.full_name || 'নাম নেই'} · {connection.email || 'Email নেই'}</strong><small>Telegram ID: {connection.telegram_user_id || 'পাওয়া যায়নি'} · Username: {connection.telegram_username ? `@${connection.telegram_username}` : 'সেট করা নেই'}</small><small>সক্রিয় মেস: {connection.hostel_names || 'কোনো সক্রিয় মেস নেই'}</small><small>সংযুক্ত: {formatPlatformDate(connection.connected_at)}</small></div><button type="button" className="danger-button" disabled={telegramConnectionBusyUserId===connection.user_id} onClick={()=>disconnectTelegramConnection(connection)}>{telegramConnectionBusyUserId===connection.user_id?'বিচ্ছিন্ন হচ্ছে...':'Disconnect'}</button></article>)}</div>}
        <div className="platform-history-pager"><span>{telegramConnectionTotal.toLocaleString('bn-BD')}টি সংযোগ · পৃষ্ঠা {telegramConnectionTotal?telegramConnectionPage+1:0} / {Math.max(1,Math.ceil(telegramConnectionTotal/pageSize))}</span><div><button type="button" className="secondary-button compact" disabled={telegramConnectionLoading||telegramConnectionPage===0} onClick={()=>setTelegramConnectionPage((value)=>Math.max(0,value-1))}>আগের</button><button type="button" className="secondary-button compact" disabled={telegramConnectionLoading||(telegramConnectionPage+1)*pageSize>=telegramConnectionTotal} onClick={()=>setTelegramConnectionPage((value)=>value+1)}>পরের</button></div></div>
      </section>
    </>}

    {tab === 'settings' && <>
      <div className="platform-settings-intro"><span className="eyebrow">GLOBAL NOTICE</span><h2>গ্লোবাল নোটিশ</h2><p>অ্যাপের উপরে স্থায়ী Global Banner দেখান। সময় ধরে চালাতে “আপডেট ও বিজ্ঞপ্তি” বিভাগ ব্যবহার করুন।</p></div>
      {!settingsLoaded ? <section className="card platform-panel platform-settings-load-state" role="status">
        {busy ? <LoadingSpinner label="সিস্টেম সেটিংস লোড হচ্ছে..."/> : <><strong>গ্লোবাল নোটিশের তথ্য লোড হয়নি</strong><p>নিরাপত্তার জন্য ফাঁকা ফর্ম সংরক্ষণ বন্ধ রাখা হয়েছে। রিফ্রেশ করে আবার চেষ্টা করুন।</p><button type="button" className="secondary-button" onClick={refresh} disabled={busy}>আবার লোড করুন</button></>}
      </section> : <form className="platform-settings-grid" onSubmit={saveSettings}>
      <section className="card platform-panel">
        <div className="platform-panel-heading"><div><span className="eyebrow">PLATFORM NOTICE</span><h3>সবার জন্য Global Notice</h3><p>প্রকাশিত থাকলে এটি সবার অ্যাপের উপরে স্থায়ীভাবে দেখা যাবে। ব্যবহারকারী নিজে বন্ধ করতে পারবেন না; Super Admin বন্ধ বা পরিবর্তন করলে সবার স্ক্রিনে তা আপডেট হবে। নির্দিষ্ট সময়ের Popup-এর জন্য “আপডেট ও বিজ্ঞপ্তি” ব্যবহার করুন।</p></div></div>
        <label className="platform-toggle"><span><strong>নোটিশ চালু</strong><small>চালু থাকলে অ্যাপের ব্যবহারকারীরা ব্যানার দেখবেন</small></span><input type="checkbox" checked={Boolean(settings.announcement_enabled)} onChange={(e)=>setSettings((old)=>({...old,announcement_enabled:e.target.checked}))}/></label>
        <Field label="নোটিশ শিরোনাম" value={settings.announcement_title} onChange={(v)=>setSettings((old)=>({...old,announcement_title:v}))} maxLength={160}/>
        <Field label="নোটিশের বিবরণ" value={settings.announcement_body} onChange={(v)=>setSettings((old)=>({...old,announcement_body:v}))} maxLength={3000} multiline/>
      </section>
      <div className="platform-settings-footer"><button className="primary-button large" type="submit" disabled={busy||!settingsLoaded}>{busy?'সংরক্ষণ হচ্ছে...':'নোটিশ সংরক্ষণ করুন'}</button></div>
      </form>}
    </>}

    {tab === 'communications' && <>
      <div className="platform-settings-intro"><span className="eyebrow">প্রকাশনা ও বার্তা</span><h2>আপডেট ও বিজ্ঞপ্তি</h2><p>তিন ধরনের প্রকাশনা আলাদাভাবে সাজান। সময়, প্রদর্শনের নিয়ম এবং চালু/বন্ধ অবস্থা প্রতিটির জন্য আলাদা।</p></div>
      <section className="platform-communications-guide" aria-label="বিজ্ঞপ্তি কীভাবে কাজ করে">
        <div className="platform-communications-guide-title"><Icon name="info" size={18}/><strong>কীভাবে কাজ করবে</strong></div>
        <div className="platform-communications-guide-steps">
          <span><b>১</b> প্রয়োজনীয় নোটিশ চালু করে লেখা বা ছবি দিন।</span>
          <span><b>২</b> শুরুর ও শেষের সময় বাংলাদেশ সময় অনুযায়ী দিন। সময় ফাঁকা রাখলে সীমা থাকবে না।</span>
          <span><b>৩</b> প্রতিটি কার্ডের নিচে আলাদা সংরক্ষণ বোতাম আছে; একটির Save অন্য দুটি অংশ পরিবর্তন করবে না।</span>
        </div>
      </section>
      {communicationsError && communicationsLoaded && <div className="inline-error platform-alert" role="alert"><Icon name="warning" size={16}/>{communicationsError}</div>}
      {communicationsLoading ? <div className="card platform-panel"><LoadingSpinner label="প্রকাশনার তথ্য লোড হচ্ছে..."/></div> : !communicationsLoaded ? <section className="card platform-panel platform-communications-load-error" role="alert">
        <span className="platform-communications-load-icon"><Icon name="shield-alert" size={23}/></span>
        <div><strong>প্রকাশনার তথ্য লোড করা যায়নি</strong><p>{communicationsError || 'সার্ভারের সংরক্ষিত তথ্য পাওয়া যায়নি। নিরাপত্তার জন্য ফাঁকা ফর্ম দেখানো হচ্ছে না।'}</p></div>
        <button type="button" className="secondary-button" onClick={loadCommunications} disabled={communicationsLoading}><Icon name="refresh-cw" size={15}/> আবার চেষ্টা করুন</button>
      </section> : <div className="platform-settings-grid platform-communications-grid">
        <section className="card platform-panel platform-communications-card">
          <div className="platform-panel-heading platform-communications-release-heading"><div><span className="eyebrow">সর্বশেষ আপডেট</span><h3>নতুন সংস্করণের তথ্য</h3><p>এখানে লেখা প্রতিটি লাইন ব্যবহারকারীরা “নতুন ফিচারসমূহ” তালিকায় দেখতে পাবেন।</p></div><span className={`platform-status ${communicationsDraft.release_notes_published ? 'status-active' : 'status-inactive'}`}>{communicationsDraft.release_notes_published ? 'প্রকাশিত' : 'ড্রাফট'}</span></div>
          <label className="field-label"><span>পরিবর্তনের তালিকা <small>প্রতি লাইনে একটি পরিবর্তন</small></span><textarea rows={6} maxLength={7200} value={communicationsDraft.release_notes_text} onChange={(event)=>setCommunicationsDraft((current)=>({...current,release_notes_text:event.target.value}))} placeholder={'নতুন সুবিধা যুক্ত হয়েছে।\nব্যবহার সহজ করা হয়েছে।\nনিরাপত্তা আরও উন্নত করা হয়েছে।'} /></label>
          <div className={`platform-communications-count${releaseNotesInvalid ? ' is-invalid' : ''}`} aria-live="polite">
            {releaseNoteLines.length.toLocaleString('bn-BD')} / ৩০টি আপডেট · প্রতিটি সর্বোচ্চ ২৪০ অক্ষর
            {releaseNotesInvalid && <strong>{releaseNoteLines.length > 30 ? 'সর্বোচ্চ ৩০টি আপডেট রাখা যাবে।' : releaseNoteLines.some((line) => line.length > 240) ? 'কোনো একটি আপডেট ২৪০ অক্ষর ছাড়িয়েছে।' : 'প্রকাশের আগে অন্তত একটি আপডেট লিখুন।'}</strong>}
          </div>
          <div className="platform-release-preview"><div className="platform-release-preview-heading"><strong>ব্যবহারকারীর স্ক্রিনে এমন দেখাবে</strong><span>{communicationsDraft.release_notes_published ? 'প্রকাশের জন্য প্রস্তুত' : 'এখনো প্রকাশিত নয়'}</span></div>{releaseNoteLines.length ? <ul>{releaseNoteLines.slice(0, 6).map((line, index)=><li key={`${index}-${line}`}><Icon name="check-circle" size={16}/><span>{line}</span></li>)}</ul> : <p>আপডেটের তথ্য লিখলে এখানে প্রিভিউ দেখা যাবে।</p>}</div>
          <label className="platform-toggle"><span><strong>আপডেটের তালিকা প্রকাশ করুন</strong><small>চালু করলে নতুন সংস্করণ উইন্ডোতে ফিচারের তালিকা দেখাবে।</small></span><input type="checkbox" checked={Boolean(communicationsDraft.release_notes_published)} onChange={(event)=>setCommunicationsDraft((current)=>({...current,release_notes_published:event.target.checked}))}/></label>
          <div className="platform-communications-card-footer"><small>এই অংশের Save শুধু সর্বশেষ সংস্করণের তথ্য সংরক্ষণ করবে।</small><button type="button" className="primary-button" onClick={()=>saveCommunicationSection('release_notes')} disabled={communicationsBusy||!communicationsLoaded||releaseNotesInvalid}>{communicationsBusy?'সংরক্ষণ হচ্ছে...':communicationsDraft.release_notes_published?'আপডেট প্রকাশ করুন':'ড্রাফট সংরক্ষণ করুন'}</button></div>
        </section>

        <section className="card platform-panel platform-communications-card">
          <div className="platform-panel-heading"><div><span className="eyebrow">উইন্ডো নোটিশ</span><h3>সবার জন্য নির্দিষ্ট বার্তা</h3><p>অ্যাপ ব্যবহারকারীদের জন্য আলাদা Popup। নির্ধারিত সময়ে নিজে থেকে খুলবে।</p></div></div>
          <label className="platform-toggle"><span><strong>উইন্ডো নোটিশ চালু</strong><small>বন্ধ করলে সঙ্গে সঙ্গে প্রদর্শন বন্ধ হবে।</small></span><input type="checkbox" checked={Boolean(communicationsDraft.window_notice.enabled)} onChange={(event)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,enabled:event.target.checked}}))}/></label>
          <Field label="শিরোনাম" value={communicationsDraft.window_notice.title} onChange={(value)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,title:value}}))} maxLength={160}/>
          <Field label="বার্তা" value={communicationsDraft.window_notice.body} onChange={(value)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,body:value}}))} maxLength={1200} multiline/>
          <div className="platform-communications-date-grid">
            <DateTimeField id="window-notice-starts-at" label="শুরুর সময়" value={communicationsDraft.window_notice.starts_at} onChange={(value)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,starts_at:value}}))}/>
            <DateTimeField id="window-notice-ends-at" label="শেষের সময়" min={communicationsDraft.window_notice.starts_at || undefined} value={communicationsDraft.window_notice.ends_at} onChange={(value)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,ends_at:value}}))}/>
          </div>
          <label className="field-label"><span>কতবার দেখাবে</span><select value={communicationsDraft.window_notice.frequency} onChange={(event)=>setCommunicationsDraft((current)=>({...current,window_notice:{...current.window_notice,frequency:event.target.value}}))}><option value="once_per_device">এই ব্রাউজার/ডিভাইসে একবার</option><option value="once_per_day">প্রতিদিন একবার</option><option value="once_per_app_open">প্রতি ব্রাউজার সেশনে একবার</option></select></label>
          {windowNoticeInvalid && <p className="platform-communications-inline-error" role="alert">চালু নোটিশে শিরোনাম/বার্তা দিন এবং শেষের সময় শুরুর পরে রাখুন।</p>}
          <div className="platform-communications-card-footer"><small>শুধু এই Popup-এর তথ্য ও সময়সূচি সংরক্ষিত হবে।</small><button type="button" className="primary-button" onClick={()=>saveCommunicationSection('window_notice')} disabled={communicationsBusy||!communicationsLoaded||Boolean(windowNoticeInvalid)}>{communicationsBusy?'সংরক্ষণ হচ্ছে...':'বার্তা সংরক্ষণ করুন'}</button></div>
        </section>

        <section className="card platform-panel platform-communications-card">
          <div className="platform-panel-heading"><div><span className="eyebrow">ওয়েবসাইট বিজ্ঞপ্তি</span><h3>রক্ষণাবেক্ষণ বার্তা বা ব্যানার</h3><p>লিখিত নোটিশ অথবা ছবির ব্যানার। এটি আলাদাভাবে চালু ও সময় নির্ধারণ করুন।</p></div></div>
          <label className="platform-toggle"><span><strong>বিজ্ঞপ্তি চালু</strong><small>বন্ধ করলে নির্ধারিত ছবি বা বার্তা আর দেখাবে না।</small></span><input type="checkbox" checked={Boolean(communicationsDraft.site_notice.enabled)} onChange={(event)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,enabled:event.target.checked}}))}/></label>
          <label className="field-label"><span>বিজ্ঞপ্তির ধরন</span><select value={communicationsDraft.site_notice.mode} onChange={(event)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,mode:event.target.value}}))}><option value="message">লিখিত বার্তা</option><option value="image">ছবির ব্যানার</option></select></label>
          <Field label="শিরোনাম" value={communicationsDraft.site_notice.title} onChange={(value)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,title:value}}))} maxLength={160}/>
          {communicationsDraft.site_notice.mode === 'message' ? <Field label="বার্তা" value={communicationsDraft.site_notice.body} onChange={(value)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,body:value}}))} maxLength={1200} multiline/> : <div className="platform-communications-image-editor">
            {communicationsDraft.site_notice.image_url ? <img src={communicationsDraft.site_notice.image_url} alt="ব্যানার প্রিভিউ"/> : <div className="platform-communications-image-placeholder"><Icon name="image" size={24}/><span>এখনো কোনো ব্যানার আপলোড করা হয়নি</span></div>}
            <input ref={communicationsImageInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handleCommunicationsImage}/>
            <button type="button" className="secondary-button" disabled={communicationsImageBusy||communicationsBusy} onClick={()=>communicationsImageInputRef.current?.click()}><Icon name="upload" size={15}/>{communicationsImageBusy?'আপলোড হচ্ছে...':'ব্যানার ছবি আপলোড / পরিবর্তন'}</button>
            <small>ছবি ৫ MB-এর কম হতে হবে। নতুন ছবি আগের ছবির একই ফাইলে প্রতিস্থাপিত হবে; অতিরিক্ত Storage Object তৈরি হবে না।</small>
          </div>}
          <div className="platform-communications-date-grid">
            <DateTimeField id="site-notice-starts-at" label="শুরুর সময়" value={communicationsDraft.site_notice.starts_at} onChange={(value)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,starts_at:value}}))}/>
            <DateTimeField id="site-notice-ends-at" label="শেষের সময়" min={communicationsDraft.site_notice.starts_at || undefined} value={communicationsDraft.site_notice.ends_at} onChange={(value)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,ends_at:value}}))}/>
          </div>
          <label className="field-label"><span>কতবার দেখাবে</span><select value={communicationsDraft.site_notice.frequency} onChange={(event)=>setCommunicationsDraft((current)=>({...current,site_notice:{...current.site_notice,frequency:event.target.value}}))}><option value="once_per_device">এই ব্রাউজার/ডিভাইসে একবার</option><option value="once_per_day">প্রতিদিন একবার</option><option value="once_per_app_open">প্রতি ব্রাউজার সেশনে একবার</option></select></label>
          {siteNoticeInvalid && <p className="platform-communications-inline-error" role="alert">বিজ্ঞপ্তির ধরন অনুযায়ী লেখা/ছবি দিন এবং শেষের সময় শুরুর পরে রাখুন।</p>}
          <div className="platform-communications-card-footer"><small>দেখানোর সীমা এই ব্রাউজারের সংরক্ষিত তথ্য দিয়ে নিয়ন্ত্রিত হয়; সার্ভারে ব্যক্তিগত প্রদর্শন-গণনা রাখা হয় না।</small><button type="button" className="primary-button" onClick={()=>saveCommunicationSection('site_notice')} disabled={communicationsBusy||communicationsImageBusy||!communicationsLoaded||Boolean(siteNoticeInvalid)}>{communicationsBusy?'সংরক্ষণ হচ্ছে...':'বিজ্ঞপ্তি সংরক্ষণ করুন'}</button></div>
        </section>
      </div>}
    </>}

    {tab === 'developer' && <>
      <div className="platform-settings-intro"><span className="eyebrow">DEVELOPER & SUPPORT</span><h2>ডেভেলপার ও সহায়তা তথ্য</h2><p>ব্যবহারকারীর Help বিভাগে প্রদর্শিত যোগাযোগ ও পরিচিতি।</p></div>
      {!settingsLoaded ? <section className="card platform-panel platform-settings-load-state" role="status">
        {busy ? <LoadingSpinner label="Support তথ্য লোড হচ্ছে..."/> : <><strong>Support তথ্য লোড হয়নি</strong><p>আগে সার্ভারের সংরক্ষিত তথ্য রিফ্রেশ করুন।</p><button type="button" className="secondary-button" onClick={refresh} disabled={busy}>আবার লোড করুন</button></>}
      </section> : <form className="platform-settings-grid" onSubmit={saveSettings}>
      <section className="card platform-panel">
        <div className="platform-panel-heading"><div><span className="eyebrow">SUPPORT PROFILE</span><h3>Developer ও Support তথ্য</h3><p>ব্যবহারকারীর Help বিভাগে দেখানো যোগাযোগের তথ্য।</p></div></div>
        <Field label="নাম" value={settings.developer_name} onChange={(v)=>setSettings((old)=>({...old,developer_name:v}))} maxLength={160}/>
        <Field label="পরিচয় / পদবি" value={settings.developer_title} onChange={(v)=>setSettings((old)=>({...old,developer_title:v}))} maxLength={240}/>
        <div className="developer-photo-uploader"><div className="developer-photo-preview">{settings.developer_photo_url?<img src={settings.developer_photo_url} alt="Developer preview"/>:<span><Icon name="camera" size={24}/></span>}</div><div className="developer-photo-copy"><strong>প্রোফাইল ছবি</strong><small>JPG / PNG / WEBP · সর্বোচ্চ ৫ MB</small><input ref={developerPhotoInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handleDeveloperPhoto}/><button type="button" className="secondary-button compact" disabled={developerPhotoBusy||busy} onClick={()=>developerPhotoInputRef.current?.click()}><Icon name="camera" size={15}/>{developerPhotoBusy?'আপলোড হচ্ছে...':'ছবি আপলোড করুন'}</button></div></div>
        <Field label="ছবির Storage URL" value={settings.developer_photo_url} onChange={(v)=>setSettings((old)=>({...old,developer_photo_url:v}))} maxLength={1000}/>
        <Field label="ইমেইল" type="email" value={settings.developer_email} onChange={(v)=>setSettings((old)=>({...old,developer_email:v}))} maxLength={240}/>
        <Field label="ফোন" value={settings.developer_phone} onChange={(v)=>setSettings((old)=>({...old,developer_phone:v}))} maxLength={80}/>
        <Field label="Portfolio URL" value={settings.developer_portfolio_url} onChange={(v)=>setSettings((old)=>({...old,developer_portfolio_url:v}))} maxLength={1000}/>
      </section>
      <div className="platform-settings-footer"><button className="primary-button large" type="submit" disabled={busy||developerPhotoBusy||!settingsLoaded}>{busy?'সংরক্ষণ হচ্ছে...':'সহায়তা তথ্য সংরক্ষণ করুন'}</button></div>
      </form>}
    </>}

    {tab === 'appearance' && <>
      <div className="platform-settings-intro"><span className="eyebrow">APP APPEARANCE</span><h2>অ্যাপের ডিফল্ট থিম</h2><p>যেসব ব্যবহারকারী নিজের থিম নির্বাচন করেননি, তাঁদের জন্য প্রাথমিক থিম নির্ধারণ করুন।</p></div>
      {!settingsLoaded ? <section className="card platform-panel platform-settings-load-state" role="status">
        {busy ? <LoadingSpinner label="ডিফল্ট থিম লোড হচ্ছে..."/> : <><strong>ডিফল্ট থিম লোড হয়নি</strong><p>সংরক্ষিত থিম নিশ্চিত না হওয়া পর্যন্ত Save বন্ধ রাখা হয়েছে।</p><button type="button" className="secondary-button" onClick={refresh} disabled={busy}>আবার লোড করুন</button></>}
      </section> : <section className="platform-settings-grid">
      <div className="card platform-panel platform-preference-card">
        <div className="platform-panel-heading"><div><span className="eyebrow">APP EXPERIENCE</span><h3>নতুন ব্যবহারকারীর Default Theme</h3><p>যাঁদের ব্রাউজারে আগে থেকে Theme Preference নেই, তাঁদের প্রথম প্রবেশে এই থিম ব্যবহার হবে। সংরক্ষিত ব্যক্তিগত পছন্দ পরিবর্তন হবে না।</p></div><span className="platform-status">৪টি থিম</span></div>
        <label className="field-label"><span>ডিফল্ট থিম</span><select value={settings.default_theme || 'dark'} onChange={(e) => setSettings((old) => ({ ...old, default_theme: e.target.value }))}><option value="system">সিস্টেম</option><option value="light">লাইট</option><option value="dark">ডার্ক</option><option value="blue">আকাশি</option></select></label>
        <button type="button" className="primary-button" disabled={defaultThemeBusy||!settingsLoaded} onClick={saveDefaultTheme}>{defaultThemeBusy ? 'সংরক্ষণ হচ্ছে...' : 'ডিফল্ট থিম সংরক্ষণ করুন'}</button>
      </div>
      </section>}
    </>}

    {tab === 'sessions' && <>
      <div className="platform-settings-intro"><span className="eyebrow">ACCOUNT SECURITY</span><h2>Session নিরাপত্তা</h2><p>একটি অ্যাকাউন্টে কতগুলো Login একসঙ্গে সক্রিয় থাকবে এবং Session কতক্ষণ চলবে তা নিয়ন্ত্রণ করুন। সদস্যের আলাদা Login History মেসের সদস্য তালিকা থেকে দেখা যায়।</p></div>
      {!sessionPolicyLoaded ? <section className="card platform-panel platform-settings-load-state" role="status">
        {busy ? <LoadingSpinner label="Session Policy লোড হচ্ছে..."/> : <><strong>Session Policy লোড হয়নি</strong><p>সর্বশেষ সংরক্ষিত Session সীমা না পাওয়া পর্যন্ত পরিবর্তন সেভ করা যাবে না।</p><button type="button" className="secondary-button" onClick={refresh} disabled={busy}>আবার লোড করুন</button></>}
      </section> : <section className="platform-settings-grid">
      <div className="card platform-panel platform-preference-card">
        <div className="platform-panel-heading"><div><span className="eyebrow">ACCOUNT PROTECTION</span><h3>Login Session Policy</h3><p>নতুন Login-কে অগ্রাধিকার দিয়ে নির্ধারিত সীমার বাইরে থাকা সবচেয়ে পুরোনো Session বাতিল হবে। একই Browser Session-এর একাধিক Tab একটিই গণ্য হবে।</p></div><span className="platform-status">১–৩০</span></div>
        <label className="field-label"><span>এক অ্যাকাউন্টে একসঙ্গে সর্বোচ্চ Session</span><select value={settings.max_devices_per_user || 10} onChange={(e) => setSettings((old) => ({ ...old, max_devices_per_user: Number(e.target.value) }))}>{Array.from({ length: 30 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value.toLocaleString('bn-BD')}টি Session</option>)}</select></label>
        <label className="field-label"><span>প্রতি Login Session কতক্ষণ সক্রিয় থাকবে?</span><select value={settings.session_timeout_minutes ?? 0} onChange={(e) => setSettings((old) => ({ ...old, session_timeout_minutes: Number(e.target.value) }))}><option value={0}>সময় নির্ধারণ নেই</option><option value={15}>১৫ মিনিট</option><option value={30}>৩০ মিনিট</option><option value={60}>১ ঘণ্টা</option><option value={120}>২ ঘণ্টা</option><option value={240}>৪ ঘণ্টা</option><option value={480}>৮ ঘণ্টা</option><option value={720}>১২ ঘণ্টা</option><option value={1440}>২৪ ঘণ্টা</option><option value={4320}>৩ দিন</option><option value={10080}>৭ দিন</option></select></label>
        <div className="platform-retention-hint"><Icon name="shield-check" size={15}/> সীমা অতিক্রম করলে নতুন Session চালু থাকবে এবং পুরোনো Session বন্ধ হবে। সময় শেষ হলে ব্যবহারকারীকে নিরাপদভাবে লগআউট করে কারণ জানানো হবে।</div>
        <button type="button" className="primary-button" disabled={deviceLimitBusy||!sessionPolicyLoaded} onClick={saveDeviceLimit}>{deviceLimitBusy ? 'সংরক্ষণ হচ্ছে...' : 'Session Policy সংরক্ষণ করুন'}</button>
      </div>
      </section>}
      <section className="card platform-panel platform-active-session-panel">
        <div className="platform-panel-heading"><div><span className="eyebrow">ACTIVE DEVICE INVENTORY</span><h3>সক্রিয় Device Session</h3><p>এখানে বর্তমানে Supabase Auth ও Hostel Life registry—দুই জায়গাতেই সক্রিয় হিসেবে থাকা Session দেখানো হয়। প্রকৃত Session ID প্রকাশ করা হয় না।</p><p className="platform-activity-history-note">Admin দিয়ে Session বন্ধ করলে পরবর্তী Refresh Token ব্যবহার বন্ধ হয়; আগে ইস্যু হওয়া Access Token তার নির্ধারিত মেয়াদ শেষ হওয়া পর্যন্ত কার্যকর থাকতে পারে।</p></div><button type="button" className="secondary-button compact" onClick={loadActiveSessions} disabled={activeSessionLoading}>রিফ্রেশ</button></div>
        <form className="platform-activity-filters" onSubmit={(event)=>{event.preventDefault();setActiveSessionSearch(activeSessionSearchDraft.trim());setActiveSessionPage(0);}}><label className="field-label"><span>ব্যবহারকারী খুঁজুন</span><input value={activeSessionSearchDraft} maxLength={120} onChange={(event)=>setActiveSessionSearchDraft(event.target.value)} placeholder="নাম বা Email"/></label><button type="submit" className="primary-button" disabled={activeSessionLoading}>খুঁজুন</button><button type="button" className="secondary-button" onClick={()=>{setActiveSessionSearchDraft('');setActiveSessionSearch('');setActiveSessionPage(0);}}>মুছুন</button></form>
        {activeSessionError && <div className="inline-error platform-alert" role="alert">{activeSessionError}</div>}
        {activeSessionLoading ? <div className="platform-empty"><LoadingSpinner label="সক্রিয় Session লোড হচ্ছে..."/></div> : activeSessions.length===0 ? <p className="platform-empty">সক্রিয় Session পাওয়া যায়নি।</p> : <div className="platform-retention-list">{activeSessions.map((session)=><article className="platform-retention-row platform-active-session-row" key={`${session.user_id}:${session.session_ref}`}><div><strong>{session.full_name || 'নাম নেই'} · {session.email || 'Email নেই'}</strong><small>মেস: {session.hostel_names || 'কোনো সক্রিয় মেস নেই'}</small><small>IP: {session.ip_address || 'তথ্য নেই'} · সর্বশেষ ব্যবহার: {formatPlatformDate(session.last_seen_at)}</small><small>নিবন্ধিত: {formatPlatformDate(session.registered_at)} · মেয়াদ: {session.expires_at ? formatPlatformDate(session.expires_at) : 'নির্ধারিত নয়'}</small><small className="platform-active-session-agent">{session.user_agent || 'Device / Browser তথ্য পাওয়া যায়নি'}</small><small>Session Ref: {String(session.session_ref).slice(0,16)}…</small></div><button type="button" className="danger-button" disabled={activeSessionBusyRef===session.session_ref} onClick={()=>revokeActiveSession(session)}>{activeSessionBusyRef===session.session_ref?'বন্ধ হচ্ছে...':'এই Session বন্ধ করুন'}</button></article>)}</div>}
        <div className="platform-history-pager"><span>{activeSessionTotal.toLocaleString('bn-BD')}টি Session · পৃষ্ঠা {activeSessionTotal?activeSessionPage+1:0} / {Math.max(1,Math.ceil(activeSessionTotal/pageSize))}</span><div><button type="button" className="secondary-button compact" disabled={activeSessionLoading||activeSessionPage===0} onClick={()=>setActiveSessionPage((value)=>Math.max(0,value-1))}>আগের</button><button type="button" className="secondary-button compact" disabled={activeSessionLoading||(activeSessionPage+1)*pageSize>=activeSessionTotal} onClick={()=>setActiveSessionPage((value)=>value+1)}>পরের</button></div></div>
      </section>
    </>}

    {tab === 'retention' && <section className="platform-settings-grid" aria-label="ডেটা সংরক্ষণ নীতি">
      <div className="card platform-panel">
        <div className="platform-panel-heading"><div><h3>ডেটা সংরক্ষণ নীতি</h3><p>সব মেসের জন্য একই নীতি। সময়সীমা পেরোলেই ব্যবসায়িক ডেটা নিজে থেকে মুছে যায় না; সার্ভারের যোগ্যতা যাচাই, সামারি সংরক্ষণ ও আপনার নিশ্চিতকরণের পরেই বিস্তারিত ডেটা স্থায়ীভাবে অপসারণ হয়।</p></div><button type="button" className="secondary-button compact" disabled={retentionLoading} onClick={loadRetention}>তালিকা রিফ্রেশ</button></div>
        <div className="platform-retention-hint"><Icon name="shield-check" size={15}/> Activity ও Security operational log-এর লক্ষ্য ৩০ দিন। Run35 cleanup নতুন Activity/Security Event এলে চলে—Supabase-এ scheduler/cron সেটআপ করা না থাকায় নির্দিষ্ট সময়ে cleanup হওয়ার নিশ্চয়তা নেই। Super Admin-এর Platform Audit Log আলাদা accountability record হিসেবে এই ৩০ দিনের purge-এর আওতায় নেই। Password Reset quota হিসাবের HMAC-only row ৩৫ দিন থাকে, যাতে মাসভিত্তিক সীমা সঠিকভাবে গণনা করা যায়। ব্যবহারকারীর আর্থিক/মাসিক archive detail এই ৩০ দিনের log rule দিয়ে মুছে ফেলা হয় না; সেগুলোর আলাদা Summary ও typed-confirmation policy আছে।</div>
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
      <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>সংরক্ষিত চূড়ান্ত সামারি</h3><p>Delete-এর আগে Final Summary সংরক্ষণ ও যাচাই করতে হবে। সময়সীমা পেরোলেও কোনো মাস স্বয়ংক্রিয়ভাবে মুছে যায় না; সফল Purge-এর পর বিস্তারিত হিসাব বাদ যাবে, যাচাইকৃত Summary থাকবে।</p></div></div>
        {savedSummaries.length === 0 ? <p className="platform-empty">এখনো কোনো চূড়ান্ত সামারি নেই, অথবা তালিকা লোড করা যায়নি।</p> : <div className="platform-retention-list">{savedSummaries.map(row => <div className="platform-retention-row" key={`${row.hostel_id}-${row.period_id}`}><div><strong>{row.hostel_name ? `${row.hostel_name} · ` : ''}{row.period_label || row.period_id}</strong><small>{row.purged_at ? 'বিস্তারিত মুছে ফেলা হয়েছে; সামারি সংরক্ষিত' : 'বিস্তারিত এখনো রয়েছে'} · {row.end_date || ''} · {row.verified_at ? 'যাচাইকৃত' : 'যাচাই বাকি'}</small></div></div>)}</div>}
      </div>
      <div className="card platform-panel"><div className="platform-panel-heading"><div><h3>মেয়াদোত্তীর্ণ আর্কাইভ ({expiredArchives.length})</h3><p>এখানে থাকা প্রতিটি মাসের জন্য সার্ভার প্রথমে মেয়াদ ও ডেটার অবস্থা যাচাই করে। সামারি সংরক্ষণ ও যাচাই সম্পন্ন না হলে Delete নিষ্ক্রিয় থাকবে। Delete সফল হলে বিস্তারিত রেকর্ড মুছবে; যাচাইকৃত Final Summary থাকবে।</p></div><button type="button" className="secondary-button compact" disabled={retentionLoading} onClick={loadRetention}>তালিকা রিফ্রেশ</button></div>
        {!expiredArchivesLoaded && !retentionLoading ? <p className="platform-empty">মেয়াদোত্তীর্ণ আর্কাইভের সার্ভার তালিকা লোড হয়নি। উপরের রিফ্রেশ ব্যবহার করে আবার চেষ্টা করুন।</p> :
          expiredArchivesLoaded && expiredArchives.length === 0 ? <p className="platform-empty">অপসারণের অপেক্ষায় কোনো আর্কাইভ নেই।</p> :
          <div className="platform-retention-list">{expiredArchives.map(entry => <div className="platform-retention-row" key={`${entry.hostel_id}-${entry.period_id}`}><div><strong>{entry.hostel_name || 'মেস'} · {entry.period_label || 'মাস'}</strong><small>মেয়াদ শেষ: {entry.expired_at || 'সার্ভার যাচাইকৃত'}</small></div><div className="platform-archive-actions"><button className="secondary-button compact" type="button" disabled={retentionLoading} onClick={() => prepareArchiveSummary(entry)}>সামারি সংরক্ষণ</button><button className="secondary-button compact" type="button" disabled={retentionLoading || !savedSummaries.some(row => row.period_id === entry.period_id && !row.purged_at) || savedSummaries.some(row => row.period_id === entry.period_id && Boolean(row.verified_at))} onClick={() => verifyArchiveSummary(entry)}>{savedSummaries.some(row => row.period_id === entry.period_id && row.verified_at) ? 'সামারি যাচাইকৃত' : 'সামারি যাচাই'}</button><button className="danger-button" type="button" disabled={retentionLoading || !savedSummaries.some(row => row.period_id === entry.period_id && !row.purged_at && row.verified_at)} onClick={() => deleteExpiredArchive(entry)}>স্থায়ীভাবে মুছুন</button></div></div>)}</div>}
      </div>
    </section>}
    {tab === 'mfa' && <section className="card platform-panel platform-mfa-settings">
      <div className="platform-panel-heading"><div><span className="eyebrow">SUPER ADMIN · AAL2</span><h3>দ্বিস্তর নিরাপত্তা ও Authenticator</h3><p>Super Admin-এর সব প্রশাসনিক RPC-তে পাসওয়ার্ড যাচাইয়ের পাশাপাশি Supabase Auth-এর AAL2 বাধ্যতামূলক। Authenticator Secret Supabase Auth নিজেই সংরক্ষণ করে; অ্যাপের নিজস্ব টেবিলে Secret বা OTP রাখা হয় না।</p></div><span className="platform-panel-count">{mfaFactors.length.toLocaleString('bn-BD')}টি</span></div>
      <div className="platform-mfa-factor-list">{mfaFactors.length===0 ? <div className="platform-empty-state"><Icon name="shield-alert" size={24}/><strong>Authenticator তালিকা পাওয়া যায়নি</strong><span>প্যানেলে প্রবেশের সময় প্রয়োজনীয় Authenticator যাচাই হয়েছে কি না রিফ্রেশ করুন।</span></div> : mfaFactors.map((factor,index)=><article className="platform-mfa-factor" key={factor.id}><span className="platform-mfa-factor-icon"><Icon name="shield-check" size={18}/></span><div><strong>{factor.friendly_name || `Authenticator ${index+1}`}</strong><small>Verified TOTP · যুক্ত: {factor.created_at ? formatPlatformDate(factor.created_at) : 'তারিখ অজানা'}</small></div><span className="platform-security-risk risk-review">সক্রিয়</span></article>)}</div>
      {mfaFactors.length===1 && <div className="platform-mfa-backup-note"><Icon name="info" size={17}/><span>এখন একটি Authenticator সক্রিয়। ফোন হারালে প্রবেশাধিকার হারানোর ঝুঁকি কমাতে আলাদা ডিভাইস বা নিরাপদ Backup-এ দ্বিতীয় Authenticator যুক্ত করুন। Supabase-এর TOTP MFA-তে built-in recovery code নেই।</span></div>}
      {mfaFactors.length>=2 && <div className="platform-mfa-backup-note"><Icon name="check-circle" size={17}/><span>একাধিক Verified Authenticator আছে। পরবর্তী Super Admin প্রবেশে তালিকা থেকে যেকোনো একটি ব্যবহার করতে পারবেন।</span></div>}
      <div className="platform-mfa-actions"><button type="button" className="primary-button" disabled={mfaBusy} onClick={()=>beginMfaEnrollment('backup')}><Icon name="plus" size={15}/> ব্যাকআপ Authenticator যুক্ত করুন</button><span>Google Authenticator, Microsoft Authenticator বা TOTP-সমর্থিত অ্যাপ ব্যবহার করা যাবে।</span></div>
      {mfaStage==='enroll-backup' && <div className="platform-mfa-enroll-card"><div><strong>ব্যাকআপ Authenticator সেটআপ</strong><p>{mfaFriendlyName} নামে নতুন Factor যুক্ত হচ্ছে। আলাদা ডিভাইসে QR Scan করুন।</p></div><div className="platform-mfa-qr-wrap"><img src={mfaQrCode} alt="Backup Authenticator QR code"/><span>ম্যানুয়ালি যোগ করতে Secret</span><code>{mfaSecret}</code><button type="button" className="secondary-button compact" onClick={async()=>{try{await navigator.clipboard.writeText(mfaSecret);setMfaError('Backup Secret কপি হয়েছে। নিরাপদে রাখুন।');}catch{setMfaError('কপি করা যায়নি। Secret নিজে লিখে নিন।');}}}>Secret কপি করুন</button></div><form className="form-stack" onSubmit={verifySuperAdminMfa}><label className="field-label"><span>Authenticator-এর ৬ সংখ্যার কোড</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event)=>setMfaCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" required/></label>{mfaError && <div className="inline-error">{mfaError}</div>}<div className="platform-mfa-actions"><button type="submit" className="primary-button" disabled={mfaBusy || mfaCode.length!==6}>{mfaBusy?'যাচাই হচ্ছে...':'Backup Authenticator যাচাই ও যুক্ত করুন'}</button><button type="button" className="secondary-button" disabled={mfaBusy} onClick={()=>{setMfaStage('idle');setMfaQrCode('');setMfaSecret('');setMfaCode('');setMfaError('');}}>বাতিল</button></div></form></div>}
      {mfaError && mfaStage!=='enroll-backup' && <div className="inline-error platform-alert">{mfaError}</div>}
    </section>}

    {tab === 'security' && <>
      <div className="platform-settings-intro"><span className="eyebrow">ACCESS CONTROL</span><h2>Access Code নিয়ন্ত্রণ</h2><p>Registration ও নতুন মেস তৈরির জন্য নিরাপত্তা কোড পরিচালনা করুন।</p></div>
      <section className="platform-settings-grid">
        <div className="card platform-panel">
          <div className="platform-panel-heading"><div><h3>Permission code controls</h3><p>নতুন কোড তৈরি হলে আগের কোড একই purpose-এ সঙ্গে সঙ্গে বাতিল হবে।</p></div></div>
          {!settingsLoaded && <div className="platform-settings-load-state" role="status"><strong>Code gate-এর সংরক্ষিত অবস্থা লোড হয়নি</strong><p>আবার লোড না হওয়া পর্যন্ত Gate চালু/বন্ধ করা যাবে না।</p><button type="button" className="secondary-button compact" onClick={refresh} disabled={busy}>আবার লোড করুন</button></div>}
          <label className="platform-toggle"><span><strong>নতুন অ্যাকাউন্টে কোড বাধ্যতামূলক</strong><small>Registration page-এ কোড চাইবে</small></span><input type="checkbox" checked={Boolean(settings.registration_code_required)} disabled={busy || !settingsLoaded} onChange={(e)=>changeGate('registration',e.target.checked)}/></label>
          <label className="platform-toggle"><span><strong>মেস তৈরিতে কোড বাধ্যতামূলক</strong><small>নতুন মেস তৈরির আগে কোড যাচাই হবে</small></span><input type="checkbox" checked={Boolean(settings.hostel_creation_code_required)} disabled={busy || !settingsLoaded} onChange={(e)=>changeGate('hostel_creation',e.target.checked)}/></label>
          <Field label="কোডের মেয়াদ (মিনিট, ৫–১০০৮০)" type="number" value={ttl} onChange={setTtl}/>
          <Field label="সর্বোচ্চ ব্যবহার (১–১০০০)" type="number" value={maxUses} onChange={setMaxUses}/>
          <div className="platform-code-buttons"><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('registration')}>Registration code তৈরি</button><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('hostel_creation')}>Hostel creation code তৈরি</button></div>
          {generated&&<div className="platform-generated-code"><small>{generated.purpose==='registration'?'Registration':'Hostel creation'} · মেয়াদ {formatPlatformDate(generated.expires_at)}</small><code>{generated.code}</code><button className="primary-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(generated.code);setNotice('কোড কপি হয়েছে।');}catch{setNotice('কপি করা যায়নি—কোডটি হাতে কপি করুন।');}}}>কোড কপি করুন</button><p>এটি এখন একবারই দেখানো হয়েছে। নিরাপদ স্থানে রাখুন এবং সাধারণ নোটিশে প্রকাশ করবেন না।</p></div>}
        </div>
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
