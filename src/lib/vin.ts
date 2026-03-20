/**
 * VIN decoder using the free NHTSA vPIC API.
 * No API key required.
 * https://vpic.nhtsa.dot.gov/api/
 */

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'

export type VehicleBodyType = 'sedan' | 'suv' | 'minivan' | 'pickup' | 'hatchback' | 'coupe' | 'van' | 'wagon'

export interface VinDecodeResult {
  make: string | null
  model: string | null
  year: string | null
  bodyType: VehicleBodyType | null
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
    bodyType: parseBodyType(get('Body Class')),
  }
}

/**
 * Maps NHTSA "Body Class" string to a simplified body type.
 * NHTSA returns values like "Sedan/Saloon", "Sport Utility Vehicle (SUV)",
 * "Minivan", "Pickup", "Hatchback", "Coupe", "Van", "Wagon", etc.
 */
function parseBodyType(bodyClass: string | null): VehicleBodyType | null {
  if (!bodyClass) return null
  const lc = bodyClass.toLowerCase()

  if (lc.includes('sedan') || lc.includes('saloon')) return 'sedan'
  if (lc.includes('suv') || lc.includes('sport utility')) return 'suv'
  if (lc.includes('minivan') || lc.includes('mini van')) return 'minivan'
  if (lc.includes('pickup') || lc.includes('truck')) return 'pickup'
  if (lc.includes('hatchback') || lc.includes('hatch back')) return 'hatchback'
  if (lc.includes('coupe') || lc.includes('convertible')) return 'coupe'
  if (lc.includes('van') || lc.includes('cargo')) return 'van'
  if (lc.includes('wagon') || lc.includes('crossover')) return 'wagon'

  return 'sedan' // sensible default
}

// ── Guess body type from model name ──────────────────────────────────────────

const BODY_TYPE_MAP: Record<string, VehicleBodyType> = {
  // SUVs
  'rav4': 'suv', 'cr-v': 'suv', 'crv': 'suv', 'highlander': 'suv', 'pilot': 'suv',
  'explorer': 'suv', 'escape': 'suv', 'bronco': 'suv', 'tahoe': 'suv', 'suburban': 'suv',
  'equinox': 'suv', 'traverse': 'suv', 'blazer': 'suv', 'trailblazer': 'suv',
  'wrangler': 'suv', 'cherokee': 'suv', 'grand cherokee': 'suv', 'compass': 'suv',
  'rogue': 'suv', 'pathfinder': 'suv', 'murano': 'suv', 'armada': 'suv',
  'tucson': 'suv', 'santa fe': 'suv', 'palisade': 'suv', 'kona': 'suv',
  'sportage': 'suv', 'telluride': 'suv', 'sorento': 'suv', 'seltos': 'suv',
  'forester': 'suv', 'outback': 'suv', 'crosstrek': 'suv', 'ascent': 'suv',
  'cx-5': 'suv', 'cx-9': 'suv', 'cx-50': 'suv', 'cx-90': 'suv',
  'tiguan': 'suv', 'atlas': 'suv', 'q5': 'suv', 'q7': 'suv', 'x3': 'suv', 'x5': 'suv',
  'model x': 'suv', 'model y': 'suv', 'range rover': 'suv', '4runner': 'suv',
  // Sedans
  'camry': 'sedan', 'corolla': 'sedan', 'accord': 'sedan', 'civic': 'sedan',
  'altima': 'sedan', 'sentra': 'sedan', 'maxima': 'sedan', 'versa': 'sedan',
  'malibu': 'sedan', 'impala': 'sedan', 'fusion': 'sedan', 'taurus': 'sedan',
  'elantra': 'sedan', 'sonata': 'sedan', 'forte': 'sedan', 'optima': 'sedan',
  'legacy': 'sedan', 'impreza': 'sedan', 'mazda3': 'sedan', 'mazda6': 'sedan',
  'jetta': 'sedan', 'passat': 'sedan', 'a4': 'sedan', '3 series': 'sedan', 'c-class': 'sedan',
  'model 3': 'sedan', 'model s': 'sedan', 'charger': 'sedan',
  // Minivans
  'sienna': 'minivan', 'odyssey': 'minivan', 'pacifica': 'minivan',
  'grand caravan': 'minivan', 'carnival': 'minivan', 'sedona': 'minivan',
  // Pickups
  'f-150': 'pickup', 'f150': 'pickup', 'f-250': 'pickup', 'f-350': 'pickup',
  'silverado': 'pickup', 'sierra': 'pickup', 'colorado': 'pickup', 'canyon': 'pickup',
  'ram 1500': 'pickup', 'ram 2500': 'pickup', 'tacoma': 'pickup', 'tundra': 'pickup',
  'frontier': 'pickup', 'titan': 'pickup', 'ranger': 'pickup', 'maverick': 'pickup',
  'ridgeline': 'pickup', 'gladiator': 'pickup', 'cybertruck': 'pickup',
  // Hatchbacks
  'golf': 'hatchback', 'fit': 'hatchback', 'yaris': 'hatchback', 'prius': 'hatchback',
  'leaf': 'hatchback', 'bolt': 'hatchback', 'i3': 'hatchback', 'id.4': 'hatchback',
  'veloster': 'hatchback', 'gti': 'hatchback', 'rio': 'hatchback', 'soul': 'hatchback',
  // Coupes
  'mustang': 'coupe', 'camaro': 'coupe', 'challenger': 'coupe', '86': 'coupe',
  'brz': 'coupe', 'supra': 'coupe', 'miata': 'coupe', 'mx-5': 'coupe',
  '370z': 'coupe', '400z': 'coupe', 'corvette': 'coupe', '2 series': 'coupe',
  // Wagons
  'v60': 'wagon', 'v90': 'wagon', 'e-class wagon': 'wagon', 'a4 allroad': 'wagon',
}

/**
 * Guess body type from model name when VIN decode doesn't provide it.
 */
export function guessBodyType(model: string): VehicleBodyType {
  const lc = model.toLowerCase().trim()
  for (const [key, type] of Object.entries(BODY_TYPE_MAP)) {
    if (lc.includes(key)) return type
  }
  return 'sedan'
}
