/**
 * Process-wide cache for the live US gas price (per gallon, USD).
 * Single source of truth for client-side fare estimators that need a
 * synchronous gas-price value (e.g. `fareEstimate.ts` running inside a
 * React render — can't await a fetch).
 *
 * Seed it once per page load via `useGasPriceSeed()` (or any caller that
 * holds the value from `GET /api/gas-price?state=CA`). Until seeded,
 * `getCurrentGasPricePerGallon()` returns the hardcoded
 * `DEFAULT_GAS_PRICE_PER_GALLON` ($3.50) so callers always get a finite
 * positive number — matches the iOS `Fare.currentGasPricePerGallon` /
 * `Fare.defaultGasPricePerGallon` pattern.
 *
 * Hardcoded California for now (matches the iOS `GasPriceStore`
 * default + the server-side `getGasPriceForState('CA')` calls in
 * `server/routes/rides.ts`). State-aware lookup is a follow-up.
 */

import { useEffect } from 'react'
import { DEFAULT_GAS_PRICE_PER_GALLON } from '@/lib/fare'
import { fetchGasPrice } from '@/lib/gasPrice'

let currentValue: number = DEFAULT_GAS_PRICE_PER_GALLON
let lastFetched: number | null = null
let inFlight: Promise<void> | null = null

/** 30-minute soft cache, mirrors `GasPriceStore.staleAfter` on iOS. */
const STALE_AFTER_MS = 30 * 60 * 1000

/** Synchronous read — returns the most recent seeded value or the default. */
export function getCurrentGasPricePerGallon(): number {
  return currentValue
}

/**
 * Seed the cache from EIA. Concurrent callers join the same in-flight
 * request. Silent on failure — the existing value (or default) stays.
 */
export async function refreshGasPriceIfStale(state: string = 'CA'): Promise<void> {
  if (lastFetched != null && Date.now() - lastFetched < STALE_AFTER_MS) return
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const price = await fetchGasPrice(state)
      if (price != null && Number.isFinite(price) && price > 0) {
        currentValue = price
        lastFetched = Date.now()
      }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * React hook — fires `refreshGasPriceIfStale` on mount. Components that
 * render board-style fare estimates should call this once near the top of
 * their tree so the estimator picks up today's pump price within the same
 * render cycle (or the next one, after the network round-trip).
 */
export function useGasPriceSeed(state: string = 'CA'): void {
  useEffect(() => {
    void refreshGasPriceIfStale(state)
  }, [state])
}
