import { supabase } from '../lib/supabase';
import { rpcWithFallback } from '../lib/rpcCompatibility';
import { ensureRunningPeriodDays, fetchMemberDirectory, fetchRunningPeriod } from './diningService';
import { normalizeLedgerRow } from '../utils/accounting';
import { formatDateWithWeekday } from '../utils/date';
import { formatCurrency, formatNumber } from '../utils/number';

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

export function printReport(title, subtitle, tableHtml, existingWindow = null, metadata = {}) {
  const win = existingWindow || window.open('', '_blank', 'width=1100,height=800');
  if (!win) throw new Error('রিপোর্ট প্রিন্ট উইন্ডো খোলা যায়নি। ব্রাউজারের pop-up অনুমতি দিন।');
  const now = new Date();
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Dhaka', year: 'numeric' }).format(now));
  const generatedAt = new Intl.DateTimeFormat('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }).format(now);
  const titlePeriod = String(title || '').includes(' — ') ? String(title).split(' — ').slice(-1)[0].trim() : '';
  const periodLabel = metadata.periodLabel || titlePeriod || 'মাসিক হিসাব';
  const managerName = metadata.managerName || '';
  const managerPhone = metadata.managerPhone || '';
  const managerMeta = [managerName, managerPhone].filter(Boolean).join(' · ');
  const footer = `<footer class="report-footer"><span>Copyright © ${currentYear} Hostel-Life. All rights reserved.</span><span>Designed &amp; Developed by Rakibul Islam Samrat</span></footer>`;
  const header = `<header class="report-header"><div class="report-brand"><span class="report-brand-mark"><img src="/icons/hostel-life-mark.svg" alt="" width="38" height="38" /></span><div><strong>Hostel Life</strong><small>মেস ব্যবস্থাপনা ও হিসাব</small></div></div><div class="report-header-meta"><strong>${escapeHtml(periodLabel || 'মাসিক হিসাব')}</strong>${managerMeta ? `<small>ম্যানেজার: ${escapeHtml(managerMeta)}</small>` : ''}<small>প্রতিবেদন: ${escapeHtml(title)}</small></div></header>`;
  win.document.open();
  win.document.write(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Bengali",sans-serif;max-width:100%;margin:0;padding:0 0 26px;color:#203129;background:#fff;font-size:13px;line-height:1.55}.report-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 0;margin:0 0 12px;border-bottom:2px solid #dce9e0;background:linear-gradient(90deg,#f2f8f4,#fff)}.report-brand{display:flex;align-items:center;gap:10px;min-width:0}.report-brand-mark{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;border-radius:11px;background:#e2f0e6;color:#226b43;font-size:14px;font-weight:900;letter-spacing:-.04em}.report-brand>div,.report-header-meta{display:grid;gap:2px;min-width:0}.report-brand strong{font-size:15px;letter-spacing:.01em}.report-brand small,.report-header-meta small{color:#69776f;font-size:10px}.report-header-meta{text-align:right}.report-header-meta strong{font-size:12px;color:#245f3e}.report-body{padding:0}.report-title{margin:0 0 4px;font-size:22px;line-height:1.35;color:#173e2a}.report-subtitle{margin:0 0 18px;color:#6c7b72;font-size:11px;line-height:1.65}.report-section-title{margin:20px 0 8px;font-size:14px;color:#245f3e}.report-summary{margin:0 0 17px;width:100%;table-layout:fixed}.report-summary td{background:#f6faf7}.report-summary td strong{display:block;margin-top:3px;font-size:15px;color:#174d30}.report-summary td small{color:#718178;font-size:9px}.report-table-wrap{width:100%;overflow:visible}table{width:100%;max-width:100%;border-collapse:collapse;font-size:11px;line-height:1.5;table-layout:fixed}th,td{border:1px solid #dbe4de;padding:7px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}th{background:#edf5ef;color:#244d35;font-weight:800}tbody tr:nth-child(even){background:#fbfdfb}.meal-matrix{font-size:7px;table-layout:fixed}.meal-matrix th,.meal-matrix td{padding:3px 2px;text-align:center;white-space:nowrap;overflow-wrap:normal;word-break:normal}.meal-matrix th:first-child,.meal-matrix td:first-child{text-align:left;white-space:normal;width:90px}.meal-matrix th:not(:first-child){font-size:7px}tfoot td,tfoot th{background:#f2f7f3;font-weight:800}.report-note{margin:12px 0;color:#738177;font-size:10px;line-height:1.6}.report-footer{position:fixed;left:12.7mm;right:12.7mm;bottom:3mm;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1px;border-top:1px solid #e4ebe6;padding:5px 0;color:#98a39b;font-size:8px;background:#fff}.report-footer span{min-width:0;overflow-wrap:anywhere}@page{size:${metadata.pageOrientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'};margin:12.7mm 12.7mm 15mm}@media(max-width:600px){.report-header{align-items:flex-start;padding:12px;gap:8px}.report-brand-mark{width:32px;height:32px;flex-basis:32px}.report-brand strong{font-size:13px}.report-header-meta small{font-size:9px}.report-body{padding:0}.report-title{font-size:19px}table:not(.meal-matrix){font-size:10px}th,td{padding:5px 5px}.report-footer{left:14mm;right:14mm;font-size:7px}}@media print{body{padding-bottom:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report-footer{position:fixed}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid;page-break-inside:avoid}h1,h2,h3{break-after:avoid;page-break-after:avoid}.report-header{break-after:avoid}.report-summary{break-inside:avoid}.report-section{break-inside:auto}.report-table-wrap{overflow:visible}}
  </style></head><body>${header}<main class="report-body"><h1 class="report-title">${escapeHtml(title)}</h1><p class="report-subtitle">${escapeHtml(subtitle || '')}<br>প্রস্তুত: ${escapeHtml(generatedAt)}</p>${tableHtml}</main>${footer}<script>window.onload=()=>{setTimeout(()=>window.print(),300)};<\/script></body></html>`);
  win.document.close();
}


/**
 * Print a closed-month archive using the same five-section layout as the live
 * Reports > পূর্ণ মাসিক প্রতিবেদন export. Values come only from the archived
 * detail RPC; the server computes each member's settlement using the same
 * private.member_financials helper used by the live dashboard.
 */
export function printArchivedMonthlyReport(detail, existingWindow = null) {
  if (!detail || !Array.isArray(detail.markets) || !Array.isArray(detail.meals)
    || !Array.isArray(detail.ledger) || !Array.isArray(detail.members)) {
    throw new Error('পূর্ণ মাসিক প্রতিবেদন তৈরির জন্য আর্কাইভের বিস্তারিত হিসাব পাওয়া যায়নি। Run41 migration প্রয়োগ করুন।');
  }
  const esc = (value) => escapeHtml(value ?? '—');
  const money = (value) => esc(formatCurrency(value));
  const date = (value) => esc(value ? formatDateWithWeekday(value) : '—');
  const members = detail.members.map((member) => ({
    name: member.member_name || member.name || 'সদস্য',
    deposit: toFiniteNumber(member.deposit),
    meals: toFiniteNumber(member.final_meals ?? member.meals),
    mealCost: toFiniteNumber(member.meal_cost),
    otherExpense: toFiniteNumber(member.other_expense),
    balance: toFiniteNumber(member.balance),
  }));
  const activeMarkets = detail.markets.filter((row) => row.status !== 'void');
  const totalMarket = toFiniteNumber(detail.total_market_expense)
    || activeMarkets.reduce((sum, row) => sum + toFiniteNumber(row.total ?? row.total_amount), 0);
  const totalMeals = toFiniteNumber(detail.total_meals);
  const totalDeposit = toFiniteNumber(detail.total_deposit);
  const totalKhala = (Array.isArray(detail.khala_entries) ? detail.khala_entries : [])
    .filter((row) => row.status !== 'void')
    .reduce((sum, row) => sum + toFiniteNumber(row.amount), 0);
  const mealRate = toFiniteNumber(detail.meal_rate);
  const fundRemaining = toFiniteNumber(detail.fund_remaining);
  const cellTable = (columns, rows) => {
    const head = columns.map((column) => `<th>${esc(column.label)}</th>`).join('');
    const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${esc(column.value(row) ?? '—')}</td>`).join('')}</tr>`).join('');
    return `<div class="report-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">কোনো তথ্য পাওয়া যায়নি</td></tr>`}</tbody></table></div>`;
  };
  const summaryTable = `<table class="report-summary"><tbody><tr><td><small>মোট মিল</small><strong>${esc(formatNumber(totalMeals))}</strong></td><td><small>মোট বাজার</small><strong>${money(totalMarket)}</strong></td><td><small>মিল রেট</small><strong>${money(mealRate)}</strong></td><td><small>মেসের অবশিষ্ট</small><strong>${money(fundRemaining)}</strong></td></tr></tbody></table>`;
  const finalAccountRows = members.map((member) => ({ ...member, totalCost: member.mealCost + member.otherExpense }));
  const finalAccountTable = cellTable([
    { label: 'সদস্যের নাম', value: (row) => row.name },
    { label: 'মোট জমা', value: (row) => formatCurrency(row.deposit) },
    { label: 'মোট মিল', value: (row) => formatNumber(row.meals) },
    { label: 'মোট খরচ', value: (row) => formatCurrency(row.totalCost) },
    { label: 'বকেয়া / অবশিষ্ট', value: (row) => row.balance < 0 ? `বকেয়া ${formatCurrency(Math.abs(row.balance))}` : `অবশিষ্ট ${formatCurrency(row.balance)}` },
  ], finalAccountRows);
  const marketRows = detail.markets.map((row) => ({
    ...row,
    itemCount: Array.isArray(row.items) ? row.items.length : 0,
  }));
  const marketTable = cellTable([
    { label: 'তারিখ', value: (row) => formatDateWithWeekday(row.entry_date) },
    { label: 'বাজারকারী', value: (row) => row.buyer_name || row.member_name || 'সদস্য' },
    { label: 'টাকার পরিমাণ', value: (row) => formatCurrency(row.total ?? row.total_amount) },
    { label: 'আইটেম সংখ্যা', value: (row) => formatNumber(row.itemCount) },
    { label: 'অবস্থা', value: (row) => row.status === 'void' ? 'বাতিল' : 'কার্যকর' },
  ], marketRows).replace('</tbody></table>', `</tbody><tfoot><tr><th colspan="2">মোট কার্যকর বাজার</th><th>${money(totalMarket)}</th><th>${formatNumber(activeMarkets.reduce((sum, row) => sum + (Array.isArray(row.items) ? row.items.length : 0), 0))} আইটেম</th><th></th></tr></tfoot></table>`);
  const depositRows = detail.ledger.filter((row) => ['deposit', 'market_deposit'].includes(row.ledger_type || row.transaction_type)
    && row.status !== 'void' && toFiniteNumber(row.amount) > 0);
  const depositGroupsMap = new Map();
  for (const row of depositRows) {
    const key = row.member_id || row.member_name || 'unknown';
    if (!depositGroupsMap.has(key)) depositGroupsMap.set(key, { name: row.member_name || 'সদস্য', entries: [], total: 0 });
    const group = depositGroupsMap.get(key);
    group.entries.push(row);
    group.total += toFiniteNumber(row.amount);
  }
  const depositGroups = [...depositGroupsMap.values()].map((group) => ({
    ...group,
    entries: group.entries.sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || ''))),
  })).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  const maxDeposits = Math.max(1, ...depositGroups.map((group) => group.entries.length));
  const depositHead = `<th>সদস্যের নাম</th>${Array.from({ length: maxDeposits }, (_, index) => `<th>জমা ${index + 1}</th>`).join('')}<th>মোট জমা</th>`;
  const depositBody = depositGroups.map((group) => `<tr><td>${esc(group.name)}</td>${Array.from({ length: maxDeposits }, (_, index) => {
    const entry = group.entries[index];
    return `<td>${entry ? `<small>${date(entry.entry_date)}</small><br><strong>${money(entry.amount)}</strong><br><small>${(entry.ledger_type || entry.transaction_type) === 'market_deposit' ? 'বাজার বাবদ' : 'জমা'}</small>` : '—'}</td>`;
  }).join('')}<td><strong>${money(group.total)}</strong></td></tr>`).join('');
  const depositTable = `<div class="report-table-wrap"><table><thead><tr>${depositHead}</tr></thead><tbody>${depositBody || `<tr><td colspan="${maxDeposits + 2}">কোনো জমার তথ্য নেই</td></tr>`}</tbody><tfoot><tr><th colspan="${maxDeposits + 1}">সর্বমোট জমা</th><th>${money(totalDeposit)}</th></tr></tfoot></table></div>`;
  const khalaRows = (Array.isArray(detail.khala_entries) ? detail.khala_entries : []).filter((row) => row.status !== 'void').map((row) => ({
    date: row.entry_date || row.payment_date,
    amount: toFiniteNumber(row.amount),
    description: row.description || 'খালার পারিশ্রমিক',
  }));
  const khalaTable = cellTable([
    { label: 'প্রদানের তারিখ', value: (row) => formatDateWithWeekday(row.date) },
    { label: 'বিবরণ', value: (row) => row.description },
    { label: 'পরিমাণ', value: (row) => formatCurrency(row.amount) },
  ], khalaRows).replace('</tbody></table>', `</tbody><tfoot><tr><th colspan="2">খালার টাকার মোট</th><th>${money(totalKhala)}</th></tr></tfoot></table>`);
  const dailyRows = detail.meals.filter((row) => row.status === 'finalized').map((row) => ({
    date: row.date || row.meal_date,
    breakfast: toFiniteNumber(row.breakfast),
    lunch: toFiniteNumber(row.lunch),
    dinner: toFiniteNumber(row.dinner),
  }));
  const dailyTable = cellTable([
    { label: 'তারিখ', value: (row) => formatDateWithWeekday(row.date) },
    { label: 'সকালের মিল', value: (row) => formatNumber(row.breakfast) },
    { label: 'দুপুরের মিল', value: (row) => formatNumber(row.lunch) },
    { label: 'রাতের মিল', value: (row) => formatNumber(row.dinner) },
    { label: 'মোট মিল', value: (row) => formatNumber(row.breakfast + row.lunch + row.dinner) },
  ], dailyRows);
  const subtitle = `${formatDateWithWeekday(detail.start_date)} – ${formatDateWithWeekday(detail.end_date)} · ${detail.label || ''}`;
  const content = `${summaryTable}`
    + `<h2 class="report-section-title">১. সদস্যভিত্তিক ফাইনাল হিসাব</h2>${finalAccountTable}`
    + `<h2 class="report-section-title">২. বাজার হিসাব</h2>${marketTable}`
    + `<h2 class="report-section-title">৩. ডিপোজিট হিসাব</h2>${depositTable}`
    + `<h2 class="report-section-title">৪. খালার পারিশ্রমিক — পৃথক হিসাব</h2>${khalaTable}`
    + `<h2 class="report-section-title">৫. দৈনিক মিলের সারসংক্ষেপ</h2>${dailyTable}`;
  printReport('পূর্ণ মাসিক প্রতিবেদন', subtitle, content, existingWindow, {
    periodLabel: detail.label || '',
    managerName: detail.manager_at_close_name || detail.manager_name || '',
    managerPhone: detail.manager_at_close_phone || '',
    pageOrientation: 'portrait',
  });
}

export async function fetchRunningPeriodReport() {
  assertSupabase();
  await ensureRunningPeriodDays();
  const period = await fetchRunningPeriod();
  const periodId = period?.id || period?.period_id || null;
  if (!period || !periodId) return null;

  const [{ data: days, error: daysError }, { data: records, error: recordsError }, members] = await Promise.all([
    supabase.from('daily_meal_days').select('id,meal_date,status,cutoff_at,finalized_at').eq('period_id', periodId).order('meal_date'),
    supabase.from('daily_meal_records').select('daily_meal_day_id,member_id,actual_breakfast,actual_lunch,actual_dinner,final_breakfast,final_lunch,final_dinner,cancelled').eq('period_id', periodId),
    fetchMemberDirectory(),
  ]);
  if (daysError) throw daysError;
  if (recordsError) throw recordsError;

  const nameMap = new Map((Array.isArray(members) ? members : []).map((member) => [member.membership_id, member.member_name]));
  const dayMap = new Map((days || []).map((day) => [day.id, day]));
  const mealRows = (records || []).flatMap((record) => {
    const day = dayMap.get(record.daily_meal_day_id);
    // A submitted/approved request may already have planned_* values on its
    // daily record. Those values are not a final meal and must never enter a
    // downloadable monthly report until the server marks the day finalized.
    if (!day || day.status !== 'finalized' || record.cancelled) return [];
    const finalValue = (finalMeal, actualMeal) => toFiniteNumber(finalMeal ?? actualMeal ?? 0);
    return [{
      date: day.meal_date,
      status: day.status,
      memberId: record.member_id,
      memberName: nameMap.get(record.member_id) || 'অজানা সদস্য',
      breakfast: finalValue(record.final_breakfast, record.actual_breakfast),
      lunch: finalValue(record.final_lunch, record.actual_lunch),
      dinner: finalValue(record.final_dinner, record.actual_dinner),
      finalized: true,
    }];
  });

  return { period, days: days || [], mealRows, members: Array.isArray(members) ? members : [] };
}

export async function fetchCurrentReportBundle() {
  const report = await fetchRunningPeriodReport();
  if (!report) return null;
  const [marketRows, accountRows, khalaRows] = await Promise.all([
    (async () => {
      const params = { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 };
      const { data, error } = await rpcWithFallback(supabase, [
        { name: 'get_market_history_v2', params },
        { name: 'get_market_history', params },
      ]);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    })(),
    fetchReportAccountRows(report.period.id, 2000),
    (async () => {
      const params = { p_period_id: report.period.id || report.period.period_id, p_limit: 1000 };
      const { data, error } = await rpcWithFallback(supabase, [
        { name: 'get_khala_money_history_v2', params },
        { name: 'get_khala_money_history', params },
      ]);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    })(),
  ]);
  const memberNameMap = new Map((report.members || []).map((member) => [member.membership_id, member.member_name]));
  const namedAccountRows = accountRows.map((row) => ({ ...row, member_name: memberNameMap.get(row.member_id) || 'সদস্য' }));
  return { ...report, marketRows, accountRows: namedAccountRows, khalaRows };
}
