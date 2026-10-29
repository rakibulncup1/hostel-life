// Read-only cache of confirmed server responses; no speculative meal counts.
const key = (hostelId) => `hl:seven-day:v1:${hostelId}`;
export function saveSevenDayMeals(hostelId, days) {
  if (!hostelId || !Array.isArray(days)) return;
  try { localStorage.setItem(key(hostelId), JSON.stringify({ savedAt: new Date().toISOString(), days })); } catch { /* storage may be unavailable */ }
}
export function readSevenDayMeals(hostelId) {
  if (!hostelId) return null;
  try { const item = JSON.parse(localStorage.getItem(key(hostelId)) || 'null'); return Array.isArray(item?.days) ? item : null; } catch { return null; }
}
export function getSevenDates(now = new Date()) {
  const dateText = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const base = new Date(`${dateText}T00:00:00Z`);
  return Array.from({length:7}, (_,i) => {const d=new Date(base);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
}
