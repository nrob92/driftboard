/**
 * IndexedDB Image Cache
 *
 * Caches image blobs in IndexedDB keyed by storagePath.
 * LRU eviction when cache exceeds maxSize (default 500MB).
 * Check IndexedDB first -> fall back to signed URL -> cache result.
 *
 * Usage:
 *   const blob = await getCachedImage(storagePath, () => fetchSignedUrl(storagePath));
 */

const DB_NAME = 'driftboard-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB

interface CacheEntry {
  storagePath: string;
  blob: Blob;
  size: number;
  lastAccessed: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'storagePath' });
        store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('IndexedDB open failed:', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

async function getEntry(storagePath: string): Promise<CacheEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(storagePath);
    request.onsuccess = () => resolve(request.result as CacheEntry | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function putEntry(entry: CacheEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function touchEntry(storagePath: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(storagePath);
    getReq.onsuccess = () => {
      const entry = getReq.result as CacheEntry | undefined;
      if (entry) {
        entry.lastAccessed = Date.now();
        store.put(entry);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function evictLRU(): Promise<void> {
  const db = await openDB();

  // Get all entries sorted by lastAccessed (ascending = oldest first)
  const entries: CacheEntry[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('lastAccessed');
    const request = index.getAll();
    request.onsuccess = () => resolve(request.result as CacheEntry[]);
    request.onerror = () => reject(request.error);
  });

  let totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  if (totalSize <= MAX_CACHE_SIZE) return;

  // Delete oldest entries until under limit
  const toDelete: string[] = [];
  for (const entry of entries) {
    if (totalSize <= MAX_CACHE_SIZE * 0.8) break; // evict to 80% to avoid thrashing
    toDelete.push(entry.storagePath);
    totalSize -= entry.size;
  }

  if (toDelete.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const key of toDelete) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Get a cached image blob, or fetch and cache it.
 *
 * @param storagePath - The storage path key for the image
 * @param fetcher - Async function that returns a Blob (called on cache miss)
 * @returns The image Blob
 */
export async function getCachedImage(
  storagePath: string,
  fetcher: () => Promise<Blob>
): Promise<Blob> {
  try {
    // Check cache first
    const cached = await getEntry(storagePath);
    if (cached) {
      // Touch for LRU (fire-and-forget)
      touchEntry(storagePath).catch(() => {});
      return cached.blob;
    }
  } catch {
    // IndexedDB not available, fall through to fetcher
  }

  // Cache miss: fetch the image
  const blob = await fetcher();

  // Cache it (fire-and-forget, don't block the caller)
  (async () => {
    try {
      await putEntry({
        storagePath,
        blob,
        size: blob.size,
        lastAccessed: Date.now(),
      });
      await evictLRU();
    } catch {
      // Caching failed silently - not critical
    }
  })();

  return blob;
}

/**
 * Clear the entire image cache (e.g., on sign-out).
 */
export async function clearImageCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail if IndexedDB not available
  }
}

/**
 * Get approximate cache size in bytes.
 */
export async function getCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    const entries: CacheEntry[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as CacheEntry[]);
      request.onerror = () => reject(request.error);
    });
    return entries.reduce((sum, e) => sum + e.size, 0);
  } catch {
    return 0;
  }
}
