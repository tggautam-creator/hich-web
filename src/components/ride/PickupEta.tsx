import { useEffect, useRef, useState } from 'react'
import { getDirectionsByLatLng } from '@/lib/directions'
import { haversineMetres } from '@/lib/geo'

interface PickupEtaProps {
  /**
   * Origin — typically the driver's live GPS while en route.
   */
  fromLat: number | null
  fromLng: number | null
  /** Destination — the pickup point. */
  toLat: number | null
  toLng: number | null
  /**
   * Polling interval in seconds. Default 60 — balances freshness against
   * Google API cost; between polls the countdown decrements locally so the
   * number still feels alive.
   */
  pollSeconds?: number
  /** Travel mode passed to the Directions API. Default 'DRIVE'. */
  mode?: 'DRIVE' | 'WALK'
  /** Label prefix, e.g. "Driver arrives in". Default shows just the time. */
  label?: string
  /** Suffix to append after the time, e.g. "walk". */
  suffix?: string
  className?: string
  'data-testid'?: string
}

/**
 * Live pickup ETA countdown. Fetches Google driving directions between the
 * two points, then decrements locally every second so the user sees a
 * moving number instead of a stale poll result. Re-fetches every
 * `pollSeconds` to correct drift (traffic changes, reroutes).
 *
 * Hides itself if either point is missing or Google returns no route.
 */
export default function PickupEta({
  fromLat,
  fromLng,
  toLat,
  toLng,
  pollSeconds = 60,
  mode = 'DRIVE',
  label,
  suffix,
  className,
  'data-testid': testId = 'pickup-eta',
}: PickupEtaProps) {
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)
  const [fetching, setFetching] = useState(false)
  const fetchedAtRef = useRef<number>(0)

  const canFetch = fromLat != null && fromLng != null && toLat != null && toLng != null

  // Fetch driving duration from Google on mount + every `pollSeconds`.
  useEffect(() => {
    if (!canFetch) return
    let cancelled = false

    const doFetch = async () => {
      setFetching(true)
      const result = await getDirectionsByLatLng(fromLat, fromLng, toLat, toLng, mode)
      if (cancelled) return
      setFetching(false)
      if (result?.duration_min != null) {
        setEtaSeconds(Math.max(0, Math.round(result.duration_min * 60)))
        fetchedAtRef.current = Date.now()
      }
    }

    void doFetch()
    const interval = setInterval(() => { void doFetch() }, pollSeconds * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [fromLat, fromLng, toLat, toLng, canFetch, pollSeconds, mode])

  // Local countdown — updates the display every second between polls so the
  // number visibly ticks down.
  const hasEta = etaSeconds != null
  useEffect(() => {
    if (!hasEta) return
    const tick = setInterval(() => {
      setEtaSeconds((prev) => {
        if (prev == null) return prev
        return Math.max(0, prev - 1)
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [hasEta])

  // Fallback for the first render while Google is still fetching: show a
  // rough haversine-based estimate at 30 km/h so the user never sees "…"
  // if we have both points.
  const fallbackMin = (() => {
    if (etaSeconds != null || !canFetch) return null
    const distM = haversineMetres(fromLat, fromLng, toLat, toLng)
    if (distM < 200) return 0
    return Math.max(1, Math.round((distM / 1000) / 30 * 60))
  })()

  if (!canFetch) return null

  const display = (() => {
    if (etaSeconds != null) {
      if (etaSeconds <= 30) return 'Arriving now'
      if (etaSeconds < 90) return '1 min'
      return `${Math.round(etaSeconds / 60)} min`
    }
    if (fallbackMin != null) {
      return fallbackMin === 0 ? 'Arriving now' : `${fallbackMin} min`
    }
    return '…'
  })()

  const full = [label, display, suffix && !display.startsWith('Arriving') ? suffix : null]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      data-testid={testId}
      className={className}
      aria-live="polite"
      aria-busy={fetching}
    >
      {full}
    </span>
  )
}
