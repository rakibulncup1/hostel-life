const DB_NAME = 'hostel-life-offline-v2';
const DB_VERSION = 1;
const IDENTITY_STORE = 'identity';
const DASHBOARD_STORE = 'dashboard';

let dbPromise = null;

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

export async function saveDashboardSnapshot({ userId, hostelId, dashboard, mealBundle }) {
  if (!userId || !hostelId || !dashboard) return;
  await put(DASHBOARD_STORE, {
    key: keyFor(userId, hostelId),
    userId,
    hostelId,
    dashboard,
    mealBundle: mealBundle || null,
    savedAt: new Date().toISOString(),
    schemaVersion: 2,
  });
}

export async function readDashboardSnapshot({ userId, hostelId }) {
  if (!userId || !hostelId) return null;
  return get(DASHBOARD_STORE, keyFor(userId, hostelId));
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
