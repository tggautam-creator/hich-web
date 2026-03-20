/**
 * SessionDebugPanel — diagnostic overlay for auth persistence debugging.
 *
 * Only renders when URL contains `?debug=auth`. Shows:
 *  - Auth log entries from authLogger
 *  - Status of each persistence layer
 *  - Buttons to test cookie flow and force recovery
 *
 * To use: open the PWA with ?debug=auth appended to the URL.
 */

import { useState, useCallback } from 'react'
import { getAuthLog, clearAuthLog } from '@/lib/authLogger'
import { checkServerCookie } from '@/lib/serverSession'
import { getCachedRefreshToken } from '@/lib/persistentStorage'

interface DebugPanelProps {
  'data-testid'?: string
}

const isDebugMode = new URLSearchParams(window.location.search).has('debug')
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false

export default function SessionDebugPanel({ 'data-testid': testId }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [cookieStatus, setCookieStatus] = useState<string>('untested')
  const [cacheStatus, setCacheStatus] = useState<string>('untested')
  const [logEntries, setLogEntries] = useState(getAuthLog())

  const refreshLog = useCallback(() => {
    setLogEntries([...getAuthLog()])
  }, [])

  const testCookie = useCallback(async () => {
    setCookieStatus('testing...')
    const result = await checkServerCookie()
    if (!result) {
      setCookieStatus('FAILED — endpoint unreachable')
    } else if (result.hasCookie) {
      setCookieStatus(`OK — cookie present (len=${result.cookieLength})`)
    } else {
      setCookieStatus('NO COOKIE — Vercel proxy may strip Set-Cookie')
    }
  }, [])

  const testCache = useCallback(async () => {
    setCacheStatus('testing...')
    const token = await getCachedRefreshToken()
    if (token) {
      setCacheStatus(`OK — token in CacheStorage (len=${token.length})`)
    } else {
      setCacheStatus('EMPTY — no token in CacheStorage')
    }
  }, [])

  // Only render if ?debug is in the URL
  if (!isDebugMode) return null

  if (!expanded) {
    return (
      <button
        data-testid={testId}
        onClick={() => { setExpanded(true); refreshLog() }}
        style={{
          position: 'fixed', bottom: 80, right: 8, zIndex: 99999,
          background: '#1e293b', color: '#f8fafc', fontSize: 11,
          padding: '4px 8px', borderRadius: 6, border: '1px solid #475569',
          opacity: 0.9,
        }}
      >
        [AUTH DEBUG]
      </button>
    )
  }

  return (
    <div
      data-testid={testId}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.85)', color: '#e2e8f0',
        fontSize: 11, fontFamily: 'monospace',
        overflow: 'auto', padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Auth Debug Panel</strong>
        <button onClick={() => setExpanded(false)} style={{ color: '#f87171' }}>Close</button>
      </div>

      {/* Layer Status Tests */}
      <div style={{ marginBottom: 12, padding: 8, background: '#1e293b', borderRadius: 6 }}>
        <div style={{ marginBottom: 4 }}><strong>Layer Tests:</strong></div>
        <div style={{ marginBottom: 4 }}>
          Server Cookie: <span style={{ color: cookieStatus.startsWith('OK') ? '#4ade80' : cookieStatus === 'untested' ? '#94a3b8' : '#f87171' }}>{cookieStatus}</span>
          {' '}<button onClick={() => void testCookie()} style={{ color: '#60a5fa', textDecoration: 'underline' }}>test</button>
        </div>
        <div style={{ marginBottom: 4 }}>
          CacheStorage: <span style={{ color: cacheStatus.startsWith('OK') ? '#4ade80' : cacheStatus === 'untested' ? '#94a3b8' : '#f87171' }}>{cacheStatus}</span>
          {' '}<button onClick={() => void testCache()} style={{ color: '#60a5fa', textDecoration: 'underline' }}>test</button>
        </div>
        <div>
          IndexedDB: <span style={{ color: '#94a3b8' }}>check log below</span>
        </div>
        <div>
          Standalone mode: <span style={{ color: isStandalone ? '#4ade80' : '#fbbf24' }}>
            {isStandalone ? 'YES (PWA)' : 'NO (browser)'}
          </span>
        </div>
      </div>

      {/* Auth Log */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={refreshLog} style={{ color: '#60a5fa', textDecoration: 'underline' }}>Refresh log</button>
        <button onClick={() => { clearAuthLog(); refreshLog() }} style={{ color: '#f87171', textDecoration: 'underline' }}>Clear log</button>
      </div>

      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {logEntries.length === 0 && <div style={{ color: '#64748b' }}>No log entries yet. Login or reload to see activity.</div>}
        {logEntries.map((entry, i) => (
          <div key={i} style={{ marginBottom: 2, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
            <span style={{ color: '#64748b' }}>{entry.timestamp.slice(11, 23)}</span>
            {' '}<span style={{ color: entry.success ? '#4ade80' : '#f87171' }}>{entry.success ? '✓' : '✗'}</span>
            {' '}<span style={{ color: '#fbbf24' }}>[{entry.layer}]</span>
            {' '}{entry.action}
            {entry.detail && <span style={{ color: '#94a3b8' }}> — {entry.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
