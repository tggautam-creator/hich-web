/**
 * VIN decoder using the free NHTSA vPIC API.
 * No API key required.
 * https://vpic.nhtsa.dot.gov/api/
 */

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'

export interface VinDecodeResult {
  make: string | null
  model: string | null
  year: string | null
}

interface NhtsaVariable {
  Variable: string
  Value: string | null
}

interface NhtsaResponse {
  Results: NhtsaVariable[]
}

/**
 * Decodes a VIN via the NHTSA API and returns make, model, and year.
 * Returns null values for any field the API couldn't determine.
 * Throws on network errors.
 */
export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const res = await fetch(`${NHTSA_URL}/${encodeURIComponent(vin.trim())}?format=json`)
  if (!res.ok) {
    throw new Error(`NHTSA API error: ${res.status}`)
  }

  const data = (await res.json()) as NhtsaResponse
  const results = data.Results

  const get = (variableName: string): string | null => {
    const entry = results.find((r) => r.Variable === variableName)
    return entry?.Value?.trim() || null
  }

  return {
    make:  get('Make'),
    model: get('Model'),
    year:  get('Model Year'),
  }
}
