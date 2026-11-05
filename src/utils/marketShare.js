import { formatNumber } from './number.js';

const HONORIFIC_TOKENS = new Set(['md', 'md.', 'মোঃ', 'মো.', 'জনাব']);

export function getMarketBuyerFirstName(value) {
  const parts = String(value || '').trim().split(/\s+/u).filter(Boolean);
  if (parts.length > 1 && HONORIFIC_TOKENS.has(parts[0].toLocaleLowerCase())) return parts[1];
  return parts[0] || 'সদস্য';
}

export function buildMarketShareText({ entryDate, buyerName, items = [], total = 0 }) {
  const dateLabel = entryDate
    ? new Intl.DateTimeFormat('bn-BD', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka',
    }).format(new Date(`${String(entryDate).slice(0, 10)}T12:00:00+06:00`)).replace(/,\s*/u, ' ')
    : 'তারিখ নির্ধারিত নয়';
  const itemLines = items.map((item, index) => {
    const itemName = String(item.item_name || '').replace(/\s+/gu, ' ').trim();
    const quantity = String(item.quantity || '').trim();
    const amount = Number(item.amount);
    const quantityText = quantity ? ` ${quantity}` : '';
    return `${formatNumber(index + 1, { maximumFractionDigits: 0 })}. ${itemName}${quantityText} ${formatNumber(Number.isFinite(amount) ? amount : 0)} টাকা`;
  });

  return [
    `তারিখ : ${dateLabel}`,
    `বাজারকারী: ${getMarketBuyerFirstName(buyerName)}`,
    '',
    ...itemLines,
    '',
    `টোটাল বাজার = ${formatNumber(Number.isFinite(Number(total)) ? Number(total) : 0)} টাকা`,
  ].join('\n');
}


// Preserve a completed market summary while the user briefly switches to a
// native share target, but do not resurrect it after an explicit page reload.
export function readMarketShareSummary({
  storage,
  storageKey,
  navigationType = 'navigate',
  now = Date.now(),
  maxAgeMs = 12 * 60 * 60 * 1000,
} = {}) {
  if (!storage || !storageKey) return null;

  try {
    if (navigationType === 'reload') {
      storage.removeItem(storageKey);
      return null;
    }

    const saved = storage.getItem(storageKey);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    const savedAt = Number(parsed?.savedAt);
    if (typeof parsed?.text !== 'string' || !parsed.text || !Number.isFinite(savedAt) || savedAt > now || now - savedAt > maxAgeMs) {
      storage.removeItem(storageKey);
      return null;
    }

    return parsed;
  } catch {
    try { storage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
    return null;
  }
}
