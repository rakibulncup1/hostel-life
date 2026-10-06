import { supabase } from '../lib/supabase';
import { fetchMemberDirectory } from './diningService';

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function printReport(title, subtitle, tableHtml) {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) throw new Error('রিপোর্ট প্রিন্ট উইন্ডো খোলা যায়নি। ব্রাউজারের pop-up অনুমতি দিন।');
  win.document.write(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  *{box-sizing:border-box}body{font-family:Arial,"Noto Sans Bengali",sans-serif;padding:28px;color:#17221d;background:#fff}h1{margin:0 0 6px;font-size:24px}p{margin:0 0 18px;color:#53645b;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d9e1dc;padding:8px;text-align:left;vertical-align:top}th{background:#eef4f0;font-weight:800}.report-meta{margin-bottom:18px}@media print{body{padding:0}button{display:none}}
  </style></head><body><div class="report-meta"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${tableHtml}<script>window.onload=()=>{setTimeout(()=>window.print(),250)};<\/script></body></html>`);
  win.document.close();
}

export async function fetchRunningPeriodReport() {
  assertSupabase();
  const { data: period, error: periodError } = await supabase
    .from('monthly_periods')
    .select('id,label,start_date,end_date,status')
    .eq('status', 'running')
    .maybeSingle();
  if (periodError) throw periodError;
  if (!period) return null;

  const [{ data: days, error: daysError }, { data: records, error: recordsError }, members] = await Promise.all([
    supabase.from('daily_meal_days').select('id,meal_date,status,cutoff_at,finalized_at').eq('period_id', period.id).order('meal_date'),
    supabase.from('daily_meal_records').select('daily_meal_day_id,member_id,planned_breakfast,planned_lunch,planned_dinner,actual_breakfast,actual_lunch,actual_dinner,final_breakfast,final_lunch,final_dinner,cancelled').eq('period_id', period.id),
    fetchMemberDirectory(),
  ]);
  if (daysError) throw daysError;
  if (recordsError) throw recordsError;

  const nameMap = new Map(members.map((member) => [member.membership_id, member.member_name]));
  const dayMap = new Map((days || []).map((day) => [day.id, day]));
  const mealRows = (records || []).map((record) => {
    const day = dayMap.get(record.daily_meal_day_id);
    const pick = (finalValue, actualValue, plannedValue) => finalValue ?? actualValue ?? plannedValue ?? 0;
    return {
      date: day?.meal_date,
      status: day?.status,
      memberId: record.member_id,
      memberName: nameMap.get(record.member_id) || 'অজানা সদস্য',
      breakfast: record.cancelled ? 0 : pick(record.final_breakfast, record.actual_breakfast, record.planned_breakfast),
      lunch: record.cancelled ? 0 : pick(record.final_lunch, record.actual_lunch, record.planned_lunch),
      dinner: record.cancelled ? 0 : pick(record.final_dinner, record.actual_dinner, record.planned_dinner),
      finalized: Boolean(record.final_breakfast !== null || record.final_lunch !== null || record.final_dinner !== null),
    };
  });

  return { period, days: days || [], mealRows, members };
}

export async function fetchCurrentReportBundle() {
  const report = await fetchRunningPeriodReport();
  if (!report) return null;
  const [marketRows, accountRows, khalaRows] = await Promise.all([
    (async () => {
      const { data, error } = await supabase.rpc('get_market_history', { p_period_id: report.period.id, p_limit: 1000 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    })(),
    (async () => {
      const { data, error } = await supabase.rpc('get_account_history', { p_period_id: report.period.id, p_member_id: null, p_limit: 1000 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    })(),
    (async () => {
      const { data, error } = await supabase.rpc('get_khala_money_history', { p_period_id: report.period.id, p_limit: 1000 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    })(),
  ]);
  return { ...report, marketRows, accountRows, khalaRows };
}
