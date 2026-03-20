/**
 * Dual-write storage adapter for Supabase auth (IndexedDB + localStorage).
 *
 * iOS PWAs have a known WebKit bug where IndexedDB can lose its connection
 * mid-session after repeated app-switch cycles. Writing to BOTH stores on
 * every setItem means we always have a fallback ready. On read, we try
 * IndexedDB first (more persistent after force-kills), then localStorage.
 */

const DB_NAME = 'hich-auth'
const STORE_NAME = 'session'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })
  return dbPromise
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve((request.result as string) ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const idbStorage = {
  async getItem(key: string): Promise<string | null> {
    // Try IndexedDB first (survives iOS force-kills better)
    try {
      const value = await idbGet(key)
      if (value !== null) return value
    } catch {
      // IndexedDB disconnected — reset so next call retries
      dbPromise = null
    }
    // Fallback to localStorage
    return localStorage.getItem(key)
  },

  async setItem(key: string, value: string): Promise<void> {
    // Write-through: BOTH stores get every write.
    // If IndexedDB disconnects mid-session, localStorage already has the data.
    try { localStorage.setItem(key, value) } catch { /* quota exceeded */ }
    try { await idbSet(key, value) } catch { dbPromise = null }
  },

  async removeItem(key: string): Promise<void> {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    try { await idbDelete(key) } catch { dbPromise = null }
  },
}
