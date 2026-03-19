/**
 * IndexedDB-based storage adapter for Supabase auth.
 *
 * On iOS PWAs, IndexedDB is more persistent than localStorage after force-kills.
 * Supabase's auth client accepts async storage (getItem/setItem/removeItem can
 * return Promises), so we use IndexedDB as the primary store with a localStorage
 * fallback for environments where IndexedDB is unavailable.
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

export const idbStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).get(key)
        request.onsuccess = () => resolve((request.result as string) ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch {
      return localStorage.getItem(key)
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      localStorage.setItem(key, value)
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      localStorage.removeItem(key)
    }
  },
}
