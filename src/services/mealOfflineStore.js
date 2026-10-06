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
  const targetDate = getOfflineTargetDate({ bundle: record.bundle, now });
  const today = record.bundle.today;
  const tomorrow = record.bundle.tomorrow;
  const selected = [today, tomorrow].find((item) => item?.meal_date === targetDate);

  if (selected) {
    return {
      ...selected,
      label: selected.meal_date === today?.meal_date ? 'আজকের মিল' : 'আগামীকালের মিল',
      member_details: Array.isArray(selected.member_details) ? selected.member_details : [],
      client_synced_at: record.clientSyncedAt,
      server_fetched_at: record.bundle.server_fetched_at,
      offline: true,
    };
  }

  return null;
}
