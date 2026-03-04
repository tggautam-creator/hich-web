import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { decodeVin } from '@/lib/vin'

// ── Mock fetch ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function nhtsaResponse(make: string | null, model: string | null, year: string | null) {
  return {
    ok: true,
    json: () => Promise.resolve({
      Results: [
        { Variable: 'Make', Value: make },
        { Variable: 'Model', Value: model },
        { Variable: 'Model Year', Value: year },
        { Variable: 'Other Field', Value: 'ignored' },
      ],
    }),
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('decodeVin', () => {
  it('returns make, model, and year from NHTSA response', async () => {
    mockFetch.mockResolvedValue(nhtsaResponse('Honda', 'Accord', '2020'))
    const result = await decodeVin('1HGBH41JXMN109186')
    expect(result).toEqual({ make: 'Honda', model: 'Accord', year: '2020' })
  })

  it('calls the correct NHTSA URL', async () => {
    mockFetch.mockResolvedValue(nhtsaResponse('Toyota', 'Camry', '2018'))
    await decodeVin('ABCDE12345FGHIJ67')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/ABCDE12345FGHIJ67?format=json',
    )
  })

  it('trims whitespace from VIN', async () => {
    mockFetch.mockResolvedValue(nhtsaResponse('Ford', 'F-150', '2022'))
    await decodeVin('  1FTEW1EP4MFA12345  ')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/1FTEW1EP4MFA12345?'),
    )
  })

  it('returns null for missing fields', async () => {
    mockFetch.mockResolvedValue(nhtsaResponse(null, null, null))
    const result = await decodeVin('AAAAAAAAAAAAAAAAA')
    expect(result).toEqual({ make: null, model: null, year: null })
  })

  it('returns null for empty-string fields', async () => {
    mockFetch.mockResolvedValue(nhtsaResponse('', '', ''))
    const result = await decodeVin('AAAAAAAAAAAAAAAAA')
    expect(result).toEqual({ make: null, model: null, year: null })
  })

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(decodeVin('AAAAAAAAAAAAAAAAA')).rejects.toThrow('NHTSA API error: 500')
  })

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(decodeVin('AAAAAAAAAAAAAAAAA')).rejects.toThrow('Failed to fetch')
  })
})
