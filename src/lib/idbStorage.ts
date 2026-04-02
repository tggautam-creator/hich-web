/**
 * Dual-write storage adapter for Supabase auth (IndexedDB + localStorage).
 *
 * iOS PWAs have a known WebKit bug where IndexedDB can lose its connection
 * mid-session after repeated app-switch cycles. Writing to BOTH stores on
 * every setItem means we always have a fallback ready. On read, we try
 * IndexedDB first (more persistent after force-kills), then localStorage.
 */

import { authLog } from '@/lib/authLogger'

const DB_NAME = 'tago-auth'
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
    request.onsuccess = () => {
      authLog('idb', 'openDB', true)
      resolve(request.result)
    }
    request.onerror = () => {
      dbPromise = null
      authLog('idb', 'openDB', false, String(request.error))
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
      if (value !== null) {
        authLog('idb', `getItem(${key.slice(0, 30)})`, true, 'source=IndexedDB')
        return value
      }
    } catch (err) {
      // IndexedDB disconnected — reset so next call retries
      dbPromise = null
      authLog('idb', `getItem(${key.slice(0, 30)})`, false, String(err))
    }
    // Fallback to localStorage
    const lsValue = localStorage.getItem(key)
    authLog('localStorage', `getItem(${key.slice(0, 30)})`, lsValue !== null, lsValue ? 'source=localStorage' : 'not found in any store')
    return lsValue
  },

  async setItem(key: string, value: string): Promise<void> {
    // Write-through: BOTH stores get every write.
    // If IndexedDB disconnects mid-session, localStorage already has the data.
    try {
      localStorage.setItem(key, value)
      authLog('localStorage', `setItem(${key.slice(0, 30)})`, true)
    } catch (err) {
      authLog('localStorage', `setItem(${key.slice(0, 30)})`, false, String(err))
    }
    try {
      await idbSet(key, value)
      authLog('idb', `setItem(${key.slice(0, 30)})`, true)
    } catch (err) {
      dbPromise = null
      authLog('idb', `setItem(${key.slice(0, 30)})`, false, String(err))
    }
  },

  async removeItem(key: string): Promise<void> {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    try { await idbDelete(key) } catch { dbPromise = null }
  },
}
