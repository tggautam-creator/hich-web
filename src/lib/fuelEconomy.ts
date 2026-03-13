/**
 * EPA fueleconomy.gov API — free, no key required.
 * Looks up combined MPG by make/model/year from the vehicle's VIN data.
 *
 * Flow: year+make+model → menu/options → vehicle/{id} → comb08 (combined MPG)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface MenuOption {
  text: string
  value: number
}

interface MenuResponse {
  menuItem: MenuOption | MenuOption[]
}

interface VehicleResponse {
  comb08: number    // combined MPG (city + highway)
  city08: number    // city MPG
  highway08: number // highway MPG
  fuelType: string  // e.g. "Regular Gasoline"
}

export interface FuelEconomyResult {
  combined_mpg: number
  city_mpg: number
  highway_mpg: number
  fuel_type: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.fueleconomy.gov/ws/rest'

// ── Default MPG for fallback ──────────────────────────────────────────────────

export const DEFAULT_MPG = 25

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Look up EPA fuel economy for a vehicle by make, model, year.
 * Returns null if the vehicle isn't found in the EPA database.
 */
export async function lookupFuelEconomy(
  year: number,
  make: string,
  model: string,
): Promise<FuelEconomyResult | null> {
  try {
    // Step 1: Get vehicle option IDs for this year/make/model
    const optionsUrl = `${BASE_URL}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`
    const optionsResp = await fetch(optionsUrl, {
      headers: { Accept: 'application/json' },
    })
    if (!optionsResp.ok) return null

    const optionsData = (await optionsResp.json()) as MenuResponse
    // API may return a single object or an array
    const items = Array.isArray(optionsData.menuItem)
      ? optionsData.menuItem
      : optionsData.menuItem
        ? [optionsData.menuItem]
        : []

    if (items.length === 0) return null

    // Step 2: Fetch the first option's vehicle details
    const vehicleId = items[0].value
    const vehicleResp = await fetch(`${BASE_URL}/vehicle/${vehicleId}`, {
      headers: { Accept: 'application/json' },
    })
    if (!vehicleResp.ok) return null

    const vehicle = (await vehicleResp.json()) as VehicleResponse

    if (!vehicle.comb08 || vehicle.comb08 <= 0) return null

    return {
      combined_mpg: vehicle.comb08,
      city_mpg: vehicle.city08,
      highway_mpg: vehicle.highway08,
      fuel_type: vehicle.fuelType ?? 'Gasoline',
    }
  } catch {
    return null
  }
}
