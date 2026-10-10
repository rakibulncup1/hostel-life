const LEDGER_TYPE_LABELS = Object.freeze({
  deposit: 'ডিপোজিট',
  market_deposit: 'বাজার ডিপোজিট',
  other_expense: 'অন্যান্য খরচ',
  adjustment: 'সংশোধন',
});

export function ledgerTypeLabel(type) {
  return LEDGER_TYPE_LABELS[type] || type || 'সংশোধন';
}

export function normalizeLedgerRow(row = {}) {
  const rawType = row.transaction_type ?? row.ledger_type ?? '';
  return {
    ...row,
    transaction_type: ledgerTypeLabel(rawType),
    transaction_type_raw: rawType,
    entry_date: row.entry_date ? String(row.entry_date).slice(0, 10) : null,
    amount: Number(row.amount ?? 0),
  };
}

export function ledgerRowIsPositive(row = {}) {
  const type = row.transaction_type_raw ?? row.transaction_type;
  if (type === 'deposit' || type === 'market_deposit' || type === 'ডিপোজিট' || type === 'বাজার ডিপোজিট') return true;
  return Number(row.amount ?? 0) > 0;
}

export function ledgerRowIsEditable(row = {}) {
  const type = row.transaction_type_raw ?? row.transaction_type;
  return type === 'deposit' || type === 'other_expense' || type === 'ডিপোজিট' || type === 'অন্যান্য খরচ';
}
