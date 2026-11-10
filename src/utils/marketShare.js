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
    return `${formatNumber(index + 1, { maximumFractionDigits: 0 })}. ${itemName}${quantityText} ${formatNumber(Number.isFinite(amount) ? amount : 0)} টাকা`.replace(/^[\s\u00a0]+/u, '');
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

/**
 * Restore a just-saved market share summary while navigating within the same
 * tab. A browser refresh intentionally clears it, matching the form UX contract.
 */
export function readMarketShareSummary({ storage, storageKey, navigationType } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storageKey !== 'string' || !storageKey) return null;

  if (navigationType === 'reload') {
    try { storage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
    return null;
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) {
      storage.removeItem(storageKey);
      return null;
    }
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) {
      storage.removeItem(storageKey);
      return null;
    }
    return { text: parsed.text.slice(0, 12000), savedAt };
  } catch {
    try { storage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
    return null;
  }
}
