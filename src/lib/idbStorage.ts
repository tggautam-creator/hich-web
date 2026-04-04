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
const OLD_DB_NAME = 'hich-auth' // migration: read from old DB if new one is empty
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

/** Delete a key from the old hich-auth DB to prevent repeated migration of stale tokens */
async function deleteFromOldDb(key: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(OLD_DB_NAME, 1)
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve(); return }
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    }
    req.onerror = () => resolve()
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
    if (lsValue) {
      authLog('localStorage', `getItem(${key.slice(0, 30)})`, true, 'source=localStorage')
      return lsValue
    }
    // Migration: try old hich-auth DB for users who haven't re-logged after rebrand
    try {
      const oldValue = await new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open(OLD_DB_NAME, 1)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve(null); return }
          const tx = db.transaction(STORE_NAME, 'readonly')
          const getReq = tx.objectStore(STORE_NAME).get(key)
          getReq.onsuccess = () => { db.close(); resolve((getReq.result as string) ?? null) }
          getReq.onerror = () => { db.close(); reject(getReq.error) }
        }
        req.onerror = () => resolve(null)
      })
      if (oldValue) {
        authLog('idb', `getItem(${key.slice(0, 30)})`, true, 'source=hich-auth-migration')
        // Migrate to new DB and delete from old DB so this only happens once
        void idbSet(key, oldValue).catch(() => {})
        void deleteFromOldDb(key).catch(() => {})
        return oldValue
      }
    } catch { /* old DB not available, ignore */ }
    authLog('localStorage', `getItem(${key.slice(0, 30)})`, false, 'not found in any store')
    return null
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
