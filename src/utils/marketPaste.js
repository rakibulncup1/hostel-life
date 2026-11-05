const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const DIGIT_MAP = Object.freeze({
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
});

export function sanitizeMarketInput(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(CONTROL_CHARS, '');
}

function cleanCell(value) {
  return sanitizeMarketInput(value).replace(/\s+/gu, ' ').trim();
}

function cleanMultilineCell(value) {
  return sanitizeMarketInput(value)
    .split('\n')
    .map((line) => line.replace(/[\t ]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeAmount(value) {
  const raw = cleanCell(value);
  if (!raw) return '';
  const latin = Array.from(raw, (character) => DIGIT_MAP[character] ?? character).join('');
  const valueWithoutCurrency = latin
    .replace(/(?:৳|টাকা|bdt|tk\.?)/giu, '')
    .replace(/\s/gu, '');
  const decimalParts = valueWithoutCurrency.split('.');
  if (decimalParts.length > 2) return null;
  const [integerPart, fractionPart = ''] = decimalParts;
  if (!/^\d{1,2}$|^\d{1,3}(?:,\d{3})+$|^\d{1,2}(?:,\d{2})+,\d{3}$|^\d+$/u.test(integerPart)) return null;
  if (fractionPart && !/^\d{1,2}$/u.test(fractionPart)) return null;
  const normalized = `${integerPart.replace(/,/gu, '')}${fractionPart ? `.${fractionPart}` : ''}`;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return normalized;
}

function isHeaderRow(cells) {
  const text = cells.slice(0, 3).join(' ').toLocaleLowerCase();
  return /(আইটেম|পণ্য|item|name)/u.test(text)
    && /(পরিমাণ|quantity|qty)/u.test(text)
    && /(টাকা|দাম|amount|price|টাকার)/u.test(text);
}

function isSerialCell(value) {
  const latin = Array.from(cleanCell(value), (character) => DIGIT_MAP[character] ?? character).join('');
  return /^\d{1,3}[.)]?$/.test(latin);
}

/**
 * Parses clipboard text pasted into a market item-name field.
 * - Plain text (including line breaks): one item name/description, preserving newlines.
 * - Spreadsheet/TSV: item name, quantity, amount (optional leading serial column).
 * Returns a single item or a spreadsheet row collection.
 */

export function parseMarketPaste(clipboardText) {
  const raw = sanitizeMarketInput(clipboardText);
  const hasTabs = raw.includes('\t');
  if (!hasTabs) {
    const itemName = cleanMultilineCell(raw);
    if (!itemName) return { error: 'খালি আইটেম পেস্ট করা যাবে না।' };
    if (Array.from(itemName).length > 160) {
      return { error: 'একটি আইটেমের নাম সর্বোচ্চ ১৬০ অক্ষরের হতে পারবে।' };
    }
    return { mode: 'single', itemName };
  }

  const lines = raw.split('\n').map((line) => line.replace(/\s+$/u, '')).filter((line) => line.trim());
  if (!lines.length) return { error: 'পেস্ট করা লেখায় কোনো আইটেম পাওয়া যায়নি।' };

  const items = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const cells = line.split('\t').map(cleanCell);
    const headerOffset = cells.length >= 4 && (isSerialCell(cells[0]) || /^(ক্রম|sl|s\.?no\.?|no\.?)$/iu.test(cells[0])) ? 1 : 0;
    if (lineIndex === 0 && isHeaderRow(cells.slice(headerOffset))) continue;
    let columns = cells;
    if (cells.length >= 4 && (isSerialCell(cells[0]) || /^(ক্রম|sl|s\.?no\.?|no\.?)$/iu.test(cells[0]))) columns = cells.slice(1);
    if (columns.length > 3 && columns.slice(3).some(Boolean)) {
      return { error: `লাইন ${lineIndex + 1}: সর্বোচ্চ ৩টি কলাম দিন—আইটেম, পরিমাণ ও টাকা।` };
    }

    const [item_name = '', quantity = '', amountText = ''] = columns;
    if (!item_name) return { error: `লাইন ${lineIndex + 1}: আইটেমের নাম পাওয়া যায়নি।` };
    if (Array.from(item_name).length > 160) return { error: `লাইন ${lineIndex + 1}: আইটেমের নাম ১৬০ অক্ষরের বেশি।` };
    if (Array.from(quantity).length > 120) return { error: `লাইন ${lineIndex + 1}: পরিমাণ ১২০ অক্ষরের বেশি।` };
    const amount = normalizeAmount(amountText);
    if (amount === null) return { error: `লাইন ${lineIndex + 1}: টাকার ঘরে শুধু সঠিক সংখ্যা দিন। উদাহরণ: ৫০০ বা ৫০০.৫০।` };
    items.push({ item_name, quantity, amount });
  }

  if (!items.length) return { error: 'পেস্ট করা লেখায় কোনো আইটেম পাওয়া যায়নি।' };
  if (items.length > 100) return { error: 'একটি বাজার এন্ট্রিতে সর্বোচ্চ ১০০টি আইটেম যোগ করা যাবে।' };
  return { mode: 'rows', items };
}
