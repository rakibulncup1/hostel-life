import { supabase } from '../lib/supabase';
import { fetchMemberDirectory } from './diningService';
import { normalizeLedgerRow } from '../utils/accounting';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadCsv(filename, columns, rows) {
  const header = columns.map((column) => csvCell(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(','));
  const csv = `\ufeff${[header, ...lines].join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}



function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getActiveMarketRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.status !== 'void');
}

export function getVoidMarketRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.status === 'void');
}

export function mergeFinancialRows(accountRows = [], khalaRows = []) {
  const ledger = (Array.isArray(accountRows) ? accountRows : []).map((row) => ({
    ...row,
    source: 'ledger',
    amount: toFiniteNumber(row.amount),
    entry_date: row.entry_date ? String(row.entry_date).slice(0, 10) : null,
  }));
  const khala = (Array.isArray(khalaRows) ? khalaRows : []).map((row) => ({
    transaction_id: row.entry_id,
    member_id: row.member_id,
    member_name: row.member_name,
    transaction_type: 'খালার টাকা',
    transaction_type_raw: 'other_expense',
    amount: -Math.abs(toFiniteNumber(row.amount)),
    description: row.description || 'খালার পারিশ্রমিক',
    created_at: row.created_at,
    entry_date: row.entry_date ? String(row.entry_date).slice(0, 10) : null,
    reference_type: 'khala_money',
    reference_id: row.entry_id,
    status: row.status || 'active',
    source: 'khala',
  }));
  return [...ledger, ...khala].sort((a, b) => {
    const dateA = new Date(`${a.entry_date || '1970-01-01'}T00:00:00`).getTime();
    const dateB = new Date(`${b.entry_date || '1970-01-01'}T00:00:00`).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

export function summarizeFinancialRows(rows = []) {
  const summary = {
    deposit: 0,
    marketDeposit: 0,
    otherExpense: 0,
    adjustment: 0,
    inflow: 0,
    outflow: 0,
    net: 0,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.source === 'khala' && row?.status === 'void') continue;
    const amount = toFiniteNumber(row.amount);
    const rawType = row.transaction_type_raw || row.transaction_type || '';
    if (rawType === 'deposit' || rawType === 'ডিপোজিট') summary.deposit += Math.max(amount, 0);
    else if (rawType === 'market_deposit' || rawType === 'বাজার ডিপোজিট') summary.marketDeposit += Math.max(amount, 0);
    else if (rawType === 'other_expense' || rawType === 'অন্যান্য খরচ' || row.source === 'khala') summary.otherExpense += Math.abs(Math.min(amount, 0));
    else if (rawType === 'adjustment' || rawType === 'সংশোধন') summary.adjustment += amount;
    if (amount >= 0) summary.inflow += amount;
    else summary.outflow += Math.abs(amount);
  }
  summary.net = summary.inflow - summary.outflow;
  return summary;
}


export async function fetchReportAccountRows(periodId, limit = 2000) {
  assertSupabase();
  if (!periodId) return [];
  const { data, error } = await supabase
    .from('ledger_transactions')
    .select('id,hostel_id,period_id,member_id,entry_date,ledger_type,ledger_group,amount,description,reference_type,reference_id,created_at')
    .eq('period_id', periodId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return Array.isArray(data) ? data.map((row) => normalizeLedgerRow(row)) : [];
}

export function calculateMealTotals(mealRows = []) {
  const result = { breakfast: 0, lunch: 0, dinner: 0, total: 0, finalizedRows: 0, pendingRows: 0 };
  for (const row of Array.isArray(mealRows) ? mealRows : []) {
    result.breakfast += toFiniteNumber(row.breakfast);
    result.lunch += toFiniteNumber(row.lunch);
    result.dinner += toFiniteNumber(row.dinner);
    if (row.finalized) result.finalizedRows += 1;
    else result.pendingRows += 1;
  }
  result.total = result.breakfast + result.lunch + result.dinner;
  return result;
}

export function buildMemberSettlementRows(members = []) {
  return (Array.isArray(members) ? members : []).map((member) => ({
    key: member.membership_id,
    membershipId: member.membership_id,
    name: member.member_name || 'অজানা সদস্য',
    status: member.member_status || 'active',
    role: member.role || 'member',
    mealActivity: member.meal_activity || '',
    meals: toFiniteNumber(member.final_meals ?? member.meals),
    deposit: toFiniteNumber(member.deposit),
    mealCost: toFiniteNumber(member.meal_cost),
    otherExpense: toFiniteNumber(member.other_expense),
    balance: toFiniteNumber(member.balance),
  })).sort((a, b) => {
    const statusOrder = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1);
    if (statusOrder) return statusOrder;
    return a.name.localeCompare(b.name, 'bn');
  });
}

export function buildDailyMealRows(days = [], mealRows = []) {
  const byDate = new Map();
  for (const row of Array.isArray(mealRows) ? mealRows : []) {
    const key = String(row.date || '').slice(0, 10);
    if (!key) continue;
    const current = byDate.get(key) || { key, date: key, status: 'open', breakfast: 0, lunch: 0, dinner: 0, finalizedRows: 0, rows: 0 };
    current.breakfast += toFiniteNumber(row.breakfast);
    current.lunch += toFiniteNumber(row.lunch);
    current.dinner += toFiniteNumber(row.dinner);
    current.rows += 1;
    if (row.finalized) current.finalizedRows += 1;
    byDate.set(key, current);
  }
  return (Array.isArray(days) ? days : []).map((day) => {
    const key = String(day.meal_date || '').slice(0, 10);
    const current = byDate.get(key) || { key, date: key, breakfast: 0, lunch: 0, dinner: 0, finalizedRows: 0, rows: 0 };
    return { ...current, date: key, status: day.status || current.status || 'open' };
  });
}

export function getReportFilename(prefix, label) {
  const safe = String(label || 'report').trim().replace(/[^a-zA-Z0-9\u0980-\u09FF_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `hostel-life-${prefix}-${safe || 'report'}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function openPrintReportWindow() {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) throw new Error('রিপোর্ট প্রিন্ট উইন্ডো খোলা যায়নি। ব্রাউজারের pop-up অনুমতি দিন।');
  win.document.open();
  win.document.write('<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>Hostel Life — রিপোর্ট প্রস্তুত হচ্ছে</title></head><body><p style="font-family:Arial,sans-serif;padding:24px">রিপোর্ট প্রস্তুত হচ্ছে...</p></body></html>');
  win.document.close();
  return win;
}

export function printReport(title, subtitle, tableHtml, existingWindow = null) {
  const win = existingWindow || window.open('', '_blank', 'width=1100,height=800');
  if (!win) throw new Error('রিপোর্ট প্রিন্ট উইন্ডো খোলা যায়নি। ব্রাউজারের pop-up অনুমতি দিন।');
  const currentYear = new Date().getFullYear();
  const portfolioUrl = 'https://rakibul-sec1.vercel.app/';
  const footer = `<footer class="report-footer">Generated by Hostel-Life | © ${currentYear} | Developed By <a href="${portfolioUrl}" target="_blank" rel="noreferrer">Rakibul Islam Samrat</a></footer>`;
  win.document.write(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  *{box-sizing:border-box}body{font-family:Arial,"Noto Sans Bengali",sans-serif;padding:24px 8px 30px;color:#17221d;background:#fff}h1{margin:0 0 6px;font-size:24px}h2{font-size:16px;margin:20px 0 8px}p{margin:0 0 18px;color:#53645b;font-size:12px;line-height:1.6}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d9e1dc;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4f0;font-weight:800}.report-meta{margin-bottom:18px}.report-footer{display:block;position:fixed;left:0;right:0;bottom:-15mm;text-align:center;font-size:8px;line-height:1.4;color:#9aa59f;padding:5px 0;border-top:1px solid #e7ece8;background:#fff}.report-footer a{color:inherit;text-decoration:none}@page{margin:14mm 12mm 22mm}@media print{body{padding:0}button{display:none}a{color:inherit}}
  </style></head><body><div class="report-meta"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${tableHtml}${footer}<script>window.onload=()=>{setTimeout(()=>window.print(),250)};<\/script></body></html>`);
  win.document.close();
}

export async function fetchRunningPeriodReport() {
  assertSupabase();
  const { data: context, error: periodError } = await supabase.rpc('get_running_period_context');
  if (periodError) throw periodError;
  const period = context?.period || null;
  const periodId = period?.id || period?.period_id || null;
  if (!period || !periodId) return null;

  const [{ data: days, error: daysError }, { data: records, error: recordsError }, members] = await Promise.all([
    supabase.from('daily_meal_days').select('id,meal_date,status,cutoff_at,finalized_at').eq('period_id', periodId).order('meal_date'),
    supabase.from('daily_meal_records').select('daily_meal_day_id,member_id,planned_breakfast,planned_lunch,planned_dinner,actual_breakfast,actual_lunch,actual_dinner,final_breakfast,final_lunch,final_dinner,cancelled').eq('period_id', periodId),
    fetchMemberDirectory(),
  ]);
  if (daysError) throw daysError;
  if (recordsError) throw recordsError;

  const nameMap = new Map((Array.isArray(members) ? members : []).map((member) => [member.membership_id, member.member_name]));
  const dayMap = new Map((days || []).map((day) => [day.id, day]));
  const mealRows = (records || []).map((record) => {
    const day = dayMap.get(record.daily_meal_day_id);
    const pick = (finalValue, actualValue, plannedValue) => finalValue ?? actualValue ?? plannedValue ?? 0;
    const finalized = record.final_breakfast !== null || record.final_lunch !== null || record.final_dinner !== null;
    return {
      date: day?.meal_date,
      status: day?.status || 'open',
      memberId: record.member_id,
      memberName: nameMap.get(record.member_id) || 'অজানা সদস্য',
      breakfast: record.cancelled ? 0 : toFiniteNumber(pick(record.final_breakfast, record.actual_breakfast, record.planned_breakfast)),
      lunch: record.cancelled ? 0 : toFiniteNumber(pick(record.final_lunch, record.actual_lunch, record.planned_lunch)),
      dinner: record.cancelled ? 0 : toFiniteNumber(pick(record.final_dinner, record.actual_dinner, record.planned_dinner)),
      finalized,
    };
  });

  return { period, days: days || [], mealRows, members: Array.isArray(members) ? members : [] };
}

export async function fetchCurrentReportBundle() {
  const report = await fetchRunningPeriodReport();
  if (!report) return null;
  const [marketRows, accountRows, khalaRows] = await Promise.all([
    (async () => {
      const primary = await supabase.rpc('get_market_history_v2', { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 });
      if (!primary.error) return Array.isArray(primary.data) ? primary.data : [];
      const missing = primary.error?.code === '42883' || /function .* does not exist/i.test(primary.error?.message || '');
      if (!missing) throw primary.error;
      const fallback = await supabase.rpc('get_market_history', { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 });
      if (fallback.error) throw fallback.error;
      return Array.isArray(fallback.data) ? fallback.data : [];
    })(),
    fetchReportAccountRows(report.period.id, 2000),
    (async () => {
      const primary = await supabase.rpc('get_khala_money_history_v2', { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 });
      if (!primary.error) return Array.isArray(primary.data) ? primary.data : [];
      const missing = primary.error?.code === '42883' || /function .* does not exist/i.test(primary.error?.message || '');
      if (!missing) throw primary.error;
      const fallback = await supabase.rpc('get_khala_money_history', { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 });
      if (fallback.error) throw fallback.error;
      return Array.isArray(fallback.data) ? fallback.data : [];
    })(),
  ]);
  const memberNameMap = new Map((report.members || []).map((member) => [member.membership_id, member.member_name]));
  const namedAccountRows = accountRows.map((row) => ({ ...row, member_name: memberNameMap.get(row.member_id) || 'সদস্য' }));
  return { ...report, marketRows, accountRows: namedAccountRows, khalaRows };
}
