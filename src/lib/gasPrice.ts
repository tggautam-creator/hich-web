/**
 * Fetch current gas price from the EIA-backed server endpoint.
 *
 * Parses US state abbreviation from a Google Places secondaryText
 * (e.g., "Davis, CA, USA" → "CA") and returns $/gallon.
 *
 * Returns null if unable to determine — caller should use the default.
 */

const US_STATE_ABBREVS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
])

/**
 * Extract 2-letter US state abbreviation from a Google Places secondaryText.
 * Examples:
 *   "Davis, CA, USA"          → "CA"
 *   "New York, NY, USA"       → "NY"
 *   "Austin, TX 78701, USA"   → "TX"
 */
export function parseStateFromSecondaryText(text: string): string | null {
  // Split on commas and spaces, look for a 2-letter state code
  const parts = text.split(/[,\s]+/).map((s) => s.trim().toUpperCase())

  for (const part of parts) {
    if (part.length === 2 && US_STATE_ABBREVS.has(part) && part !== 'US') {
      return part
    }
  }

  return null
}

interface GasPriceResponse {
  price_per_gallon: number
  state: string
  source: string
}

/**
 * Fetch current gas price for a US state.
 * Returns $/gallon or null on failure.
 */
export async function fetchGasPrice(stateAbbrev: string): Promise<number | null> {
  try {
    const resp = await fetch(`/api/gas-price?state=${encodeURIComponent(stateAbbrev)}`)
    if (!resp.ok) return null
    const data = (await resp.json()) as GasPriceResponse
    return data.price_per_gallon
  } catch {
    return null
  }
}
