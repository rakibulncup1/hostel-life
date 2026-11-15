const DB_NAME = 'hostel-life-offline-v2';
const DB_VERSION = 1;
const IDENTITY_STORE = 'identity';
const DASHBOARD_STORE = 'dashboard';
const MAX_CACHED_MEAL_DAYS = 8;

let dbPromise = null;
let dashboardWriteQueue = Promise.resolve();

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('এই ব্রাউজারে offline storage সমর্থিত নয়।'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Offline storage খোলা যায়নি।'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DASHBOARD_STORE)) {
        db.createObjectStore(DASHBOARD_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function keyFor(userId, hostelId) {
  return `${userId || 'unknown'}:${hostelId || 'unknown'}`;
}

async function put(storeName, record) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Offline data সংরক্ষণ করা যায়নি।'));
    tx.onabort = () => reject(tx.error || new Error('Offline data সংরক্ষণ বাতিল হয়েছে।'));
  });
}

async function get(storeName, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('Offline data পড়া যায়নি।'));
  });
}

function updateDashboardRecord({ userId, hostelId }, updater) {
  if (!userId || !hostelId) return Promise.resolve(null);
  const key = keyFor(userId, hostelId);
  // Keep writes from this app tab ordered so a detail-cache write cannot be
  // overwritten by a dashboard refresh that began a moment earlier.
  const operation = dashboardWriteQueue.then(async () => {
    const current = await get(DASHBOARD_STORE, key)
      || { key, userId, hostelId, schemaVersion: 3 };
    const updated = updater(current) || current;
    await put(DASHBOARD_STORE, updated);
    return updated;
  });
  dashboardWriteQueue = operation.catch(() => null);
  return operation;
}

function pickFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(fields
    .filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));
}

function makeDashboardSnapshot(dashboard) {
  const source = { meal_card: dashboard.meal_card || null };
  const meal = source.meal_card;
  const period = dashboard?.period || null;
  const summary = pickFields(dashboard?.summary, [
    'total_meals', 'total_market', 'total_market_expense', 'meal_rate',
    'total_deposit', 'other_expense', 'total_other_expense',
    'khala_money', 'total_khala_money', 'total_expense', 'fund_remaining',
  ]);
  const account = pickFields(dashboard?.my_account, [
    'name', 'meals', 'deposit', 'meal_cost', 'other_expense', 'balance',
  ]);

  return {
    meal_card: meal ? {
      meal_date: meal.meal_date || null,
      label: meal.label || null,
      breakfast: meal.breakfast ?? 0,
      lunch: meal.lunch ?? 0,
      dinner: meal.dinner ?? 0,
      total: meal.total ?? null,
      status: meal.status || null,
      server_snapshot_at: meal.server_snapshot_at || null,
      member_details: Array.isArray(meal.member_details) ? meal.member_details : [],
      late_requests: Array.isArray(meal.late_requests) ? meal.late_requests : [],
    } : null,
    period_status: dashboard?.period_status || null,
    has_running_period: dashboard?.has_running_period ?? null,
    period: period ? pickFields(period, ['id', 'period_id', 'label', 'start_date', 'end_date', 'status']) : null,
    summary,
    my_account: account,
  };
}

function trimMealDetailCache(cache = {}) {
  return Object.fromEntries(Object.entries(cache)
    .sort((a, b) => new Date(b[1]?.savedAt || 0).getTime() - new Date(a[1]?.savedAt || 0).getTime())
    .slice(0, MAX_CACHED_MEAL_DAYS));
}

export async function saveIdentitySnapshot({ userId, identity }) {
  if (!userId || !identity) return;
  await put(IDENTITY_STORE, {
    key: userId,
    userId,
    identity,
    savedAt: new Date().toISOString(),
  });
}

export async function readIdentitySnapshot(userId) {
  if (!userId) return null;
  return get(IDENTITY_STORE, userId);
}

/**
 * Store only the four read-only dashboard surfaces. The member directory is
 * intentionally excluded to keep device storage small and avoid duplicating
 * the directory payload already fetched for the online view.
 */
export async function saveDashboardSnapshot({ userId, hostelId, dashboard }) {
  if (!userId || !hostelId || !dashboard) return;
  const nextDashboard = makeDashboardSnapshot(dashboard);
  const periodId = nextDashboard.period?.period_id || nextDashboard.period?.id || null;
  const mealDate = String(nextDashboard.meal_card?.meal_date || '').slice(0, 10);
  const embeddedRows = nextDashboard.meal_card?.member_details;
  const now = new Date().toISOString();

  await updateDashboardRecord({ userId, hostelId }, (current) => {
    const samePeriod = Boolean(periodId && current.periodId === periodId);
    const mealDetails = samePeriod ? { ...(current.mealDetails || {}) } : {};
    if (mealDate && Array.isArray(embeddedRows) && embeddedRows.length) {
      mealDetails[mealDate] = { periodId, rows: embeddedRows, savedAt: now };
    }

    const cachedOwnDetail = samePeriod ? (current.myAccountDetail || null) : null;
    return {
      ...current,
      key: keyFor(userId, hostelId),
      userId,
      hostelId,
      dashboard: nextDashboard,
      periodId,
      mealDetails: trimMealDetailCache(mealDetails),
      myAccountDetail: cachedOwnDetail,
      savedAt: now,
      schemaVersion: 3,
    };
  });
}

export async function readDashboardSnapshot({ userId, hostelId }) {
  if (!userId || !hostelId) return null;
  const record = await get(DASHBOARD_STORE, keyFor(userId, hostelId));
  if (!record) return null;

  const cached = record.dashboard || {};
  return {
    ...record,
    dashboard: {
      meal_card: cached.meal_card || null,
      late_requests: null,
      period_status: cached.period_status || null,
      has_running_period: cached.has_running_period ?? null,
      period: cached.period || null,
      summary: cached.summary || null,
      my_account: cached.my_account || null,
      // Never return the member directory from offline storage.
      members: [],
    },
  };
}

/** Cache only the signed-in member's own account detail, never another member. */
export async function saveOwnAccountDetailSnapshot({ userId, hostelId, membershipId, periodId, detail }) {
  if (!userId || !hostelId || !membershipId || !periodId || !detail) return null;
  const savedAt = new Date().toISOString();
  return updateDashboardRecord({ userId, hostelId }, (current) => ({
    ...current,
    myAccountDetail: { membershipId, periodId, detail, savedAt },
    periodId: current.periodId || periodId,
    savedAt: current.savedAt || savedAt,
    schemaVersion: 3,
  }));
}

export async function readOwnAccountDetailSnapshot({ userId, hostelId, membershipId, periodId }) {
  if (!userId || !hostelId || !membershipId || !periodId) return null;
  const record = await get(DASHBOARD_STORE, keyFor(userId, hostelId));
  const cached = record?.myAccountDetail;
  if (!cached || cached.membershipId !== membershipId || cached.periodId !== periodId) return null;
  return cached;
}

/** Detail rows are cached only after the user has opened that day online. */
export async function saveMealDetailSnapshot({ userId, hostelId, periodId, mealDate, rows }) {
  const date = String(mealDate || '').slice(0, 10);
  if (!userId || !hostelId || !periodId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows)) return null;
  const savedAt = new Date().toISOString();
  return updateDashboardRecord({ userId, hostelId }, (current) => {
    if (current.periodId && current.periodId !== periodId) return current;
    const mealDetails = {
      ...(current.mealDetails || {}),
      [date]: { periodId, rows, savedAt },
    };
    return { ...current, mealDetails: trimMealDetailCache(mealDetails), schemaVersion: 3 };
  });
}

export async function readMealDetailSnapshot({ userId, hostelId, periodId, mealDate }) {
  const date = String(mealDate || '').slice(0, 10);
  if (!userId || !hostelId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const record = await get(DASHBOARD_STORE, keyFor(userId, hostelId));
  const cached = record?.mealDetails?.[date];
  if (!cached || (periodId && cached.periodId !== periodId)) return null;
  return cached;
}

export async function clearDashboardSnapshot({ userId, hostelId }) {
  if (!userId || !hostelId || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const key = keyFor(userId, hostelId);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DASHBOARD_STORE, 'readwrite');
    tx.objectStore(DASHBOARD_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Offline dashboard cache মুছে ফেলা যায়নি।'));
    tx.onabort = () => reject(tx.error || new Error('Offline dashboard cache মুছে ফেলা বাতিল হয়েছে।'));
  });
}

export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
