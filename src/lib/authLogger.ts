/**
 * Structured auth diagnostics logger for iOS PWA session persistence debugging.
 *
 * Stores the last 50 log entries in memory and logs to console with [AUTH] prefix.
 * Entries can be retrieved via getAuthLog() for the debug UI panel.
 */

export type AuthLayer = 'idb' | 'localStorage' | 'cacheStorage' | 'serverCookie' | 'supabaseAuth' | 'recovery'

interface AuthLogEntry {
  timestamp: string
  layer: AuthLayer
  action: string
  success: boolean
  detail?: string
}

const MAX_ENTRIES = 50
const entries: AuthLogEntry[] = []

export function authLog(layer: AuthLayer, action: string, success: boolean, detail?: string): void {
  const entry: AuthLogEntry = {
    timestamp: new Date().toISOString(),
    layer,
    action,
    success,
    detail,
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  const icon = success ? '✓' : '✗'
  const msg = `[AUTH] ${icon} [${layer}] ${action}`
  if (detail) {
    // eslint-disable-next-line no-console
    console.log(msg, detail)
  } else {
    // eslint-disable-next-line no-console
    console.log(msg)
  }
}

/** Get all auth log entries (newest last). */
export function getAuthLog(): readonly AuthLogEntry[] {
  return entries
}

/** Clear all stored entries. */
export function clearAuthLog(): void {
  entries.length = 0
}
