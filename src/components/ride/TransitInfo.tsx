import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { haversineMetres } from '@/lib/geo'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TransitInfoProps {
  dropoffLat: number
  dropoffLng: number
  destLat: number
  destLng: number
  'data-testid'?: string
}

interface TransitOption {
  type: string
  icon: string
  line_name: string
  departure_stop?: string
  arrival_stop?: string
  duration_minutes?: number
  walk_minutes: number
  total_minutes: number
}

/** Minimum distance (metres) between dropoff and destination for transit to be relevant. */
const MIN_DISTANCE_M = 200

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransitInfo({
  dropoffLat,
  dropoffLng,
  destLat,
  destLng,
  'data-testid': testId = 'transit-info',
}: TransitInfoProps) {
  const [options, setOptions] = useState<TransitOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)

  // Cache fetched results by coordinate key to avoid re-fetching on re-renders
  const cacheRef = useRef<Map<string, TransitOption[]>>(new Map())

  const distance = haversineMetres(dropoffLat, dropoffLng, destLat, destLng)
  const tooClose = distance < MIN_DISTANCE_M

  const fetchTransit = useCallback(async () => {
    const key = `${dropoffLat.toFixed(4)},${dropoffLng.toFixed(4)}->${destLat.toFixed(4)},${destLng.toFixed(4)}`

    // Check cache first
    const cached = cacheRef.current.get(key)
    if (cached) {
      setOptions(cached)
      return
    }

    setLoading(true)
    setErrored(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        return
      }

      const resp = await fetch(
        `/api/transit/options?dropoff_lat=${dropoffLat}&dropoff_lng=${dropoffLng}&dest_lat=${destLat}&dest_lng=${destLng}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      )

      if (!resp.ok) {
        setErrored(true)
        setLoading(false)
        return
      }

      const body = (await resp.json()) as { options?: TransitOption[] }
      const result = body.options ?? []
      cacheRef.current.set(key, result)
      setOptions(result)
    } catch {
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [dropoffLat, dropoffLng, destLat, destLng])

  useEffect(() => {
    if (tooClose) return
    void fetchTransit()
  }, [tooClose, fetchTransit])

  // Don't render anything if dropoff is very close to destination
  if (tooClose) return null

  // Don't render if there was an error (fail silently)
  if (errored) return null

  // Loading skeleton
  if (loading || options === null) {
    return (
      <div data-testid={testId} className="my-2">
        <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
          Transit from dropoff
        </p>
        <div className="flex gap-2 overflow-x-auto">
          {[1, 2].map((i) => (
            <div
              key={i}
              data-testid="transit-skeleton"
              className="shrink-0 h-12 w-32 rounded-2xl bg-surface animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  // No transit options
  if (options.length === 0) {
    return (
      <div data-testid={testId} className="my-2">
        <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
          Transit from dropoff
        </p>
        <p data-testid="no-transit" className="text-xs text-text-secondary">
          No transit options nearby
        </p>
      </div>
    )
  }

  // Render transit chips
  return (
    <div data-testid={testId} className="my-2">
      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
        Transit from dropoff
      </p>
      <div className="space-y-1.5">
        {options.map((opt, idx) => (
          <div
            key={`${opt.type}-${opt.line_name}-${idx}`}
            data-testid="transit-leg"
            className="flex items-center gap-2 text-xs"
          >
            <span className="shrink-0 text-sm">{opt.icon}</span>
            <span className="font-semibold text-text-primary shrink-0">{opt.line_name}</span>
            {opt.departure_stop && opt.arrival_stop ? (
              <>
                <span className="text-text-secondary truncate">
                  {opt.departure_stop} → {opt.arrival_stop}
                </span>
                {opt.duration_minutes != null && (
                  <span className="shrink-0 text-text-secondary">· {opt.duration_minutes} min</span>
                )}
              </>
            ) : (
              <span className="text-text-secondary">
                {opt.walk_minutes > 0 ? `${opt.walk_minutes} min walk · ` : ''}{opt.total_minutes} min total
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
