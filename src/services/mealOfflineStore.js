const DB_NAME = 'hostel-life-offline';
const DB_VERSION = 1;
const STORE_NAME = 'meal-card';
const CACHE_KEY = 'latest';

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('এই ব্রাউজারে offline storage সমর্থিত নয়।'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Offline storage খোলা যায়নি।'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

export async function saveMealBundle({ hostelId, bundle }) {
  if (!hostelId || !bundle) return;
  const db = await openDatabase();
  const record = {
    key: CACHE_KEY,
    hostelId,
    bundle,
    clientSyncedAt: new Date().toISOString(),
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('অফলাইন মিলের তথ্য সংরক্ষণ করা যায়নি।'));
    tx.onabort = () => reject(tx.error || new Error('অফলাইন মিলের তথ্য সংরক্ষণ বাতিল হয়েছে।'));
  });

  db.close();
}

export async function readMealBundle(hostelId) {
  if (!hostelId) return null;
  const db = await openDatabase();

  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(CACHE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('অফলাইন মিলের তথ্য পড়া যায়নি।'));
  });

  db.close();
  if (!record || record.hostelId !== hostelId) return null;
  return record;
}

export async function clearMealBundle() {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Offline meal cache পরিষ্কার করা যায়নি।'));
    tx.onabort = () => reject(tx.error || new Error('Offline meal cache পরিষ্কার করা বাতিল হয়েছে।'));
  });
  db.close();
}

export function getOfflineTargetDate({ bundle, now = new Date(), timeZone = 'Asia/Dhaka' }) {
  if (!bundle) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(get('hour'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  const localDate = new Date(Date.UTC(year, month - 1, day));
  if (hour >= 22) localDate.setUTCDate(localDate.getUTCDate() + 1);
  return localDate.toISOString().slice(0, 10);
}

export function pickOfflineMealCard(record, now = new Date()) {
  if (!record?.bundle) return null;
  const bundle = record.bundle;
  const targetDate = getOfflineTargetDate({ bundle, now });
  if (!targetDate) return null;

  // Current server response contains `days` + `mealRows` and a snapshot `meal_card`;
  // older frontend code expected pre-shaped `today`/`tomorrow` objects that the RPC
  // never returned. Build the selected card from the real RPC contract instead.
  const selectedDay = (Array.isArray(bundle.days) ? bundle.days : [])
    .find((item) => String(item?.meal_date || '').slice(0, 10) === targetDate);
  if (!selectedDay) {
    const legacySelected = [bundle.today, bundle.tomorrow]
      .find((item) => String(item?.meal_date || '').slice(0, 10) === targetDate);
    return legacySelected ? {
      ...legacySelected,
      label: legacySelected.meal_date === bundle.today?.meal_date ? 'আজকের মিল' : 'আগামীকালের মিল',
      member_details: Array.isArray(legacySelected.member_details) ? legacySelected.member_details : [],
      client_synced_at: record.clientSyncedAt,
      server_fetched_at: bundle.server_fetched_at,
      offline: true,
    } : null;
  }

  const rows = (Array.isArray(bundle.mealRows) ? bundle.mealRows : [])
    .filter((row) => String(row?.meal_date || row?.date || '').slice(0, 10) === targetDate && !row?.cancelled);
  const member_details = rows.map((row) => ({
    membership_id: row.member_id || row.memberId,
    member_id: row.member_id || row.memberId,
    member_name: row.member_name || row.memberName || 'সদস্য',
    name: row.member_name || row.memberName || 'সদস্য',
    breakfast: Number(row.breakfast || 0),
    lunch: Number(row.lunch || 0),
    dinner: Number(row.dinner || 0),
    finalized: Boolean(row.finalized || selectedDay.status === 'finalized'),
  }));
  const matchingSnapshot = String(bundle.meal_card?.meal_date || '').slice(0, 10) === targetDate
    ? bundle.meal_card
    : null;
  const localToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  return {
    ...selectedDay,
    ...(matchingSnapshot || {}),
    meal_date: targetDate,
    label: targetDate === localToday ? 'আজকের মিল' : 'আগামীকালের মিল',
    breakfast: matchingSnapshot ? Number(matchingSnapshot.breakfast || 0) : member_details.reduce((sum, row) => sum + row.breakfast, 0),
    lunch: matchingSnapshot ? Number(matchingSnapshot.lunch || 0) : member_details.reduce((sum, row) => sum + row.lunch, 0),
    dinner: matchingSnapshot ? Number(matchingSnapshot.dinner || 0) : member_details.reduce((sum, row) => sum + row.dinner, 0),
    member_details: matchingSnapshot && Array.isArray(matchingSnapshot.member_details) ? matchingSnapshot.member_details : member_details,
    late_requests: matchingSnapshot && Array.isArray(matchingSnapshot.late_requests) ? matchingSnapshot.late_requests : [],
    client_synced_at: record.clientSyncedAt,
    server_fetched_at: bundle.server_fetched_at,
    offline: true,
  };
}
