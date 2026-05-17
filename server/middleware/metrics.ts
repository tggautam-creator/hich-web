import type { Request, Response, NextFunction } from 'express'

/**
 * Lightweight in-memory request + bandwidth meter.
 *
 * Not a replacement for real observability (Datadog, Sentry, Supabase's own
 * usage dashboard) — it's a cheap early-warning system so the operator can
 * eyeball "am I drifting toward the Supabase free-tier 2 GB/month cliff?"
 * without leaving the app.
 *
 * Tracks:
 *  - total requests + bytes served (process lifetime)
 *  - monthly totals (current calendar month UTC; resets when month rolls)
 *  - per-path request counts (top-N exposed via /api/ops/health — renamed from /api/admin/health on 2026-05-17)
 *
 * All in-process memory — survives nothing, intentionally. If the server
 * restarts, counters reset. For durability, graduate to Redis or Postgres
 * when traffic justifies the write cost.
 */

interface MetricsState {
  // Process-lifetime counters
  totalRequests: number
  totalBytes: number
  startedAt: number
  // Monthly counters (current calendar month UTC)
  monthKey: string
  monthRequests: number
  monthBytes: number
  // Per-path request counts (key = method + path template). Kept unbounded
  // in principle but the set of templates in this app is small; if it grows,
  // we'll LRU it.
  perPath: Map<string, number>
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const state: MetricsState = {
  totalRequests: 0,
  totalBytes: 0,
  startedAt: Date.now(),
  monthKey: currentMonthKey(),
  monthRequests: 0,
  monthBytes: 0,
  perPath: new Map(),
}

function bumpMonthIfRolled() {
  const key = currentMonthKey()
  if (key !== state.monthKey) {
    state.monthKey = key
    state.monthRequests = 0
    state.monthBytes = 0
  }
}

/**
 * Normalise a request path into a template so `/api/rides/abc` and
 * `/api/rides/xyz` both count as `/api/rides/:id`. Keeps the perPath map
 * bounded by route shape rather than by the user's ID space.
 */
function pathTemplate(path: string): string {
  return path
    // UUIDs
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '/:id')
    // Long numeric IDs
    .replace(/\/\d{4,}\b/g, '/:id')
    // Anything with mixed digits+letters that looks like a slug/id segment
    .replace(/\/[a-z0-9]{16,}\b/gi, '/:id')
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only meter /api traffic; static assets are served by Vercel in prod and
  // don't move the Supabase-bandwidth needle.
  if (!req.path.startsWith('/api/')) {
    next()
    return
  }

  bumpMonthIfRolled()
  state.totalRequests += 1
  state.monthRequests += 1

  const key = `${req.method} ${pathTemplate(req.path)}`
  state.perPath.set(key, (state.perPath.get(key) ?? 0) + 1)

  // Capture response byte count via res.write/res.end wrappers. Node's
  // Content-Length header isn't always set (streaming, compression), so we
  // sum whatever goes out the wire.
  let bytes = 0
  const origWrite = res.write.bind(res)
  const origEnd = res.end.bind(res)

  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk) bytes += bufferLength(chunk)
    return (origWrite as (chunk: unknown, ...rest: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof res.write

  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk) bytes += bufferLength(chunk)
    state.totalBytes += bytes
    state.monthBytes += bytes
    return (origEnd as (chunk?: unknown, ...rest: unknown[]) => Response)(chunk, ...rest)
  }) as typeof res.end

  next()
}

function bufferLength(chunk: unknown): number {
  if (Buffer.isBuffer(chunk)) return chunk.length
  if (typeof chunk === 'string') return Buffer.byteLength(chunk, 'utf8')
  return 0
}

export interface MetricsSnapshot {
  startedAt: number
  uptimeSeconds: number
  totalRequests: number
  totalBytes: number
  month: {
    key: string
    requests: number
    bytes: number
    /** Percent of Supabase free-tier 2 GB egress consumed so far this month. */
    supabaseFreeTierPct: number
  }
  topPaths: Array<{ route: string; count: number }>
}

const SUPABASE_FREE_TIER_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export function getMetricsSnapshot(): MetricsSnapshot {
  bumpMonthIfRolled()
  const topPaths = Array.from(state.perPath.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([route, count]) => ({ route, count }))

  return {
    startedAt: state.startedAt,
    uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    totalRequests: state.totalRequests,
    totalBytes: state.totalBytes,
    month: {
      key: state.monthKey,
      requests: state.monthRequests,
      bytes: state.monthBytes,
      supabaseFreeTierPct:
        Math.round((state.monthBytes / SUPABASE_FREE_TIER_BYTES) * 1000) / 10,
    },
    topPaths,
  }
}

/** Test-only. */
export function _resetMetrics() {
  state.totalRequests = 0
  state.totalBytes = 0
  state.startedAt = Date.now()
  state.monthKey = currentMonthKey()
  state.monthRequests = 0
  state.monthBytes = 0
  state.perPath.clear()
}
