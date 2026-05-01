import { Router, type Request, type Response, type NextFunction } from 'express'

export const gasPriceRouter = Router()

// ── EIA API config ──────────────────────────────────────────────────────────

const EIA_API_KEY = process.env['EIA_API_KEY'] ?? '2f3tnmbYRXWb0bQchnrn3beODQFjoMYBZ7U2XuCR'
const EIA_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data'

// Cache TTL — 6 hours (EIA updates weekly, no need to hit on every request)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

// ── State → PADD region mapping ─────────────────────────────────────────────

// States with dedicated EIA series (more granular than PADD)
const STATE_CODES: Record<string, string> = {
  CA: 'SCA',
  TX: 'STX',
  NY: 'SNY',
  FL: 'SFL',
  CO: 'SCO',
  MA: 'SMA',
  MN: 'SMN',
  OH: 'SOH',
  WA: 'SWA',
}

// All other states → PADD region
const STATE_TO_PADD: Record<string, string> = {
  // PADD 1 — East Coast
  CT: 'R10', DC: 'R10', DE: 'R10', GA: 'R10', MA: 'R10', MD: 'R10',
  ME: 'R10', NC: 'R10', NH: 'R10', NJ: 'R10', NY: 'R10', PA: 'R10',
  RI: 'R10', SC: 'R10', VA: 'R10', VT: 'R10', WV: 'R10', FL: 'R10',
  // PADD 2 — Midwest
  IA: 'R20', IL: 'R20', IN: 'R20', KS: 'R20', KY: 'R20', MI: 'R20',
  MN: 'R20', MO: 'R20', ND: 'R20', NE: 'R20', OH: 'R20', OK: 'R20',
  SD: 'R20', TN: 'R20', WI: 'R20',
  // PADD 3 — Gulf Coast
  AL: 'R30', AR: 'R30', LA: 'R30', MS: 'R30', NM: 'R30', TX: 'R30',
  // PADD 4 — Rocky Mountain
  CO: 'R40', ID: 'R40', MT: 'R40', UT: 'R40', WY: 'R40',
  // PADD 5 — West Coast
  AK: 'R50', AZ: 'R50', CA: 'R50', HI: 'R50', NV: 'R50', OR: 'R50', WA: 'R50',
}

// ── In-memory cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  prices: Record<string, number>  // duoarea code → $/gallon
  fetchedAt: number
}

let cache: CacheEntry | null = null

/**
 * Fetch latest gas prices from EIA for all PADD regions + key states.
 * Returns a map of duoarea code → price per gallon.
 */
async function fetchEiaPrices(): Promise<Record<string, number>> {
  // Check cache
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.prices
  }

  const duoareas = ['R10', 'R20', 'R30', 'R40', 'R50', 'SCA', 'STX', 'SNY', 'SFL']
  const facets = duoareas.map((d) => `facets[duoarea][]=${d}`).join('&')

  const url = `${EIA_BASE}/?api_key=${EIA_API_KEY}&frequency=weekly&data[0]=value&facets[product][]=EPMR&${facets}&sort[0][column]=period&sort[0][direction]=desc&length=${duoareas.length}`

  const resp = await fetch(url)
  if (!resp.ok) {
    console.error('[gas-price] EIA API error:', resp.status, await resp.text())
    // Return cache even if stale, or default
    if (cache) return cache.prices
    return {}
  }

  const json = (await resp.json()) as {
    response?: { data?: Array<{ duoarea: string; value: number | null }> }
  }

  const data = json.response?.data
  if (!data || data.length === 0) {
    if (cache) return cache.prices
    return {}
  }

  const prices: Record<string, number> = {}
  for (const row of data) {
    if (row.value != null && row.value > 0) {
      prices[row.duoarea] = row.value
    }
  }

  cache = { prices, fetchedAt: Date.now() }
  console.log(`[gas-price] Cached ${Object.keys(prices).length} regions from EIA`)
  return prices
}

/**
 * Look up gas price for a US state abbreviation.
 * Returns $/gallon or null if not found.
 */
function getPriceForState(
  prices: Record<string, number>,
  stateAbbrev: string,
): number | null {
  const upper = stateAbbrev.toUpperCase()

  // Try state-specific series first
  const stateCode = STATE_CODES[upper]
  if (stateCode && prices[stateCode] != null) {
    return prices[stateCode]
  }

  // Fall back to PADD region
  const paddCode = STATE_TO_PADD[upper]
  if (paddCode && prices[paddCode] != null) {
    return prices[paddCode]
  }

  return null
}

// ── Server-internal helper (used by rides.ts for fare calculation) ────────

/**
 * Resolve the current gas price for a US state.
 * Returns the cached EIA value if fresh, otherwise refetches from EIA,
 * with a hard fallback to $3.50 (national avg) on errors.
 *
 * Used by fare-calculation paths in `rides.ts` so the canonical fare
 * stored on the rides row reflects real-world fuel cost (rather than
 * the legacy $3.50 hardcode). Hardcoded CA at the call site for
 * tonight (2026-05-01); state-aware lookup is a follow-up.
 */
export async function getGasPriceForState(stateAbbrev: string): Promise<number> {
  try {
    const prices = await fetchEiaPrices()
    const direct = getPriceForState(prices, stateAbbrev)
    if (direct != null) return direct
    // Fall back to PADD region average
    const paddPrices = ['R10', 'R20', 'R30', 'R40', 'R50']
      .map((code) => prices[code])
      .filter((p): p is number => p != null && p > 0)
    if (paddPrices.length > 0) {
      return paddPrices.reduce((a, b) => a + b, 0) / paddPrices.length
    }
  } catch (err) {
    console.error('[gas-price] getGasPriceForState error:', err)
  }
  return 3.50
}

// ── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /api/gas-price?state=CA
 *
 * Returns current average regular gasoline price per gallon for the given state.
 * No auth required — public data.
 */
gasPriceRouter.get(
  '/',
  async (req: Request, res: Response, _next: NextFunction) => {
    const stateParam = req.query['state'] as string | undefined

    if (!stateParam || stateParam.length !== 2) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'state query param required (2-letter US state abbreviation)' },
      })
      return
    }

    try {
      const prices = await fetchEiaPrices()
      const price = getPriceForState(prices, stateParam)

      if (price == null) {
        // Return US national average fallback
        // Average all PADD regions
        const paddPrices = ['R10', 'R20', 'R30', 'R40', 'R50']
          .map((code) => prices[code])
          .filter((p): p is number => p != null && p > 0)

        const national = paddPrices.length > 0
          ? paddPrices.reduce((a, b) => a + b, 0) / paddPrices.length
          : 3.50  // hard fallback

        res.json({
          price_per_gallon: Math.round(national * 100) / 100,
          state: stateParam.toUpperCase(),
          source: 'eia_national_avg',
        })
        return
      }

      res.json({
        price_per_gallon: Math.round(price * 100) / 100,
        state: stateParam.toUpperCase(),
        source: 'eia',
      })
    } catch (err) {
      console.error('[gas-price] Error:', err)
      // Return default so the frontend never blocks on this
      res.json({
        price_per_gallon: 3.50,
        state: stateParam.toUpperCase(),
        source: 'fallback',
      })
    }
  },
)
