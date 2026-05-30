import { describe, expect, it } from 'vitest'
import { clusterCorridors, dateLabel, regionForAddress } from '../../../../server/lib/marketing/corridors.ts'

describe('regionForAddress', () => {
  it('maps Davis variants to Davis', () => {
    expect(regionForAddress('UC Davis, 1 Shields Ave, Davis, CA 95616, United States')).toBe('Davis')
    expect(regionForAddress('Davis Commons, Davis, CA')).toBe('Davis')
  })

  it('collapses Sacramento metro to one region', () => {
    expect(regionForAddress('123 Main St, Sacramento, CA')).toBe('Sacramento')
    expect(regionForAddress('West Sacramento, CA')).toBe('Sacramento')
    expect(regionForAddress('Elk Grove, CA')).toBe('Sacramento')
    expect(regionForAddress('Roseville, CA 95661')).toBe('Sacramento')
  })

  it('collapses Bay Area cities to one region', () => {
    expect(regionForAddress('San Francisco, CA')).toBe('Bay Area')
    expect(regionForAddress('Oakland Ave, Oakland, CA')).toBe('Bay Area')
    expect(regionForAddress('Palo Alto, CA')).toBe('Bay Area')
  })

  it('collapses SoCal cities to one region', () => {
    expect(regionForAddress('Los Angeles, CA')).toBe('SoCal')
    expect(regionForAddress('Long Beach, CA 90802')).toBe('SoCal')
    expect(regionForAddress('Anaheim, CA, United States')).toBe('SoCal')
    expect(regionForAddress('San Diego, CA')).toBe('SoCal')
  })

  it('falls back to Other when no match', () => {
    expect(regionForAddress('Some Random Place, NY')).toBe('Other')
    expect(regionForAddress(null)).toBe('Other')
    expect(regionForAddress('')).toBe('Other')
  })
})

describe('dateLabel', () => {
  const today = new Date('2026-06-04T15:00:00Z')

  it('returns Today for today', () => {
    expect(dateLabel('2026-06-04', today)).toBe('Today')
  })

  it('returns Tomorrow for tomorrow', () => {
    expect(dateLabel('2026-06-05', today)).toBe('Tomorrow')
  })

  it('returns weekday + month + day for further out', () => {
    // 2026-06-08 is a Monday
    expect(dateLabel('2026-06-08', today)).toBe('Mon Jun 8')
  })
})

describe('clusterCorridors', () => {
  const today = new Date('2026-06-04T15:00:00Z')

  it('drops intra-region rides (Davis → Davis)', () => {
    const corridors = clusterCorridors(
      [
        ride('a', 'rider', 'UC Davis, CA', 'Davis Commons, Davis, CA', '2026-06-05'),
        ride('b', 'rider', 'Davis, CA', 'Davis, CA', '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(0)
  })

  it('groups two riders + zero drivers into a "ask driver" corridor', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-05'),
        ride('2', 'rider', 'Davis, CA', 'Anaheim, CA',     '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.corridor).toBe('Davis ⇌ SoCal')
    expect(corridors[0]!.asking_for).toBe('driver')
    expect(corridors[0]!.rider_count).toBe(2)
    expect(corridors[0]!.driver_count).toBe(0)
  })

  it('groups two drivers + zero riders into a "ask rider" corridor', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'driver', 'Davis, CA', 'San Francisco, CA', '2026-06-05'),
        ride('2', 'driver', 'Davis, CA', 'Oakland, CA',       '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.asking_for).toBe('rider')
  })

  it('skips balanced corridors (1 rider + 1 driver)', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider',  'Davis, CA', 'San Francisco, CA', '2026-06-05'),
        ride('2', 'driver', 'Davis, CA', 'Oakland, CA',       '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(0)
  })

  it('collapses opposite-direction rides into one corridor', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider', 'Davis, CA',     'Los Angeles, CA', '2026-06-05'),
        ride('2', 'rider', 'Long Beach, CA', 'Davis, CA',      '2026-06-06'),
        ride('3', 'rider', 'Davis, CA',     'Anaheim, CA',     '2026-06-06'),
      ],
      today,
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.corridor).toBe('Davis ⇌ SoCal')
    expect(corridors[0]!.rides).toHaveLength(3)
  })

  it('picks the most-common direction for the headline', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider', 'Davis, CA',          'Los Angeles, CA', '2026-06-05'),
        ride('2', 'rider', 'Davis, CA',          'Anaheim, CA',     '2026-06-05'),
        ride('3', 'rider', 'San Diego, CA',      'Davis, CA',       '2026-06-05'),
      ],
      today,
    )
    expect(corridors[0]!.primary_origin).toBe('Davis')
    expect(corridors[0]!.primary_dest).toBe('SoCal')
  })

  it('ranks by volume × recency (earlier dates score higher)', () => {
    const corridors = clusterCorridors(
      [
        // Low-volume, today: 2 rides * 1.0 = 2.0
        ride('a1', 'rider', 'Davis, CA', 'Reno, NV',       '2026-06-04'),
        ride('a2', 'rider', 'Davis, CA', 'Tahoe, CA',      '2026-06-04'),
        // High-volume, 7 days out: 4 rides * (1 - 0.7) = 1.2
        ride('b1', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-11'),
        ride('b2', 'rider', 'Davis, CA', 'Anaheim, CA',     '2026-06-11'),
        ride('b3', 'rider', 'Davis, CA', 'Long Beach, CA',  '2026-06-11'),
        ride('b4', 'rider', 'Davis, CA', 'San Diego, CA',   '2026-06-11'),
      ],
      today,
    )
    expect(corridors).toHaveLength(2)
    expect(corridors[0]!.corridor).toBe('Davis ⇌ Reno/Tahoe') // higher recency-weighted score
    expect(corridors[1]!.corridor).toBe('Davis ⇌ SoCal')
  })

  it('caps output at TOP_CORRIDORS_PER_BATCH (6)', () => {
    const corridors = clusterCorridors(
      [
        // 7 distinct rider-heavy corridors, all on 2026-06-05.
        ...['SoCal', 'Bay Area', 'Sacramento', 'Reno', 'Fresno', 'Stockton', 'Modesto']
          .flatMap((dest, i) => [
            ride(`${i}a`, 'rider', 'Davis, CA', mapDest(dest), '2026-06-05'),
            ride(`${i}b`, 'rider', 'Davis, CA', mapDest(dest), '2026-06-05'),
          ]),
      ],
      today,
    )
    expect(corridors.length).toBeLessThanOrEqual(6)
  })

  it('respects askingFor=driver filter (keeps only rider-heavy corridors)', () => {
    const corridors = clusterCorridors(
      [
        // Davis ⇌ SoCal: 2 riders → asks DRIVERS
        ride('a1', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-05'),
        ride('a2', 'rider', 'Davis, CA', 'Anaheim, CA',     '2026-06-05'),
        // Davis ⇌ Bay Area: 2 drivers → asks RIDERS
        ride('b1', 'driver', 'Davis, CA', 'San Francisco, CA', '2026-06-05'),
        ride('b2', 'driver', 'Davis, CA', 'Oakland, CA',       '2026-06-05'),
      ],
      today,
      'driver',
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.asking_for).toBe('driver')
    expect(corridors[0]!.corridor).toBe('Davis ⇌ SoCal')
  })

  it('respects askingFor=rider filter (keeps only driver-heavy corridors)', () => {
    const corridors = clusterCorridors(
      [
        ride('a1', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-05'),
        ride('a2', 'rider', 'Davis, CA', 'Anaheim, CA',     '2026-06-05'),
        ride('b1', 'driver', 'Davis, CA', 'San Francisco, CA', '2026-06-05'),
        ride('b2', 'driver', 'Davis, CA', 'Oakland, CA',       '2026-06-05'),
      ],
      today,
      'rider',
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.asking_for).toBe('rider')
    expect(corridors[0]!.corridor).toBe('Bay Area ⇌ Davis')
  })

  it('askingFor=both keeps both directions (default)', () => {
    const corridors = clusterCorridors(
      [
        ride('a1', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-05'),
        ride('a2', 'rider', 'Davis, CA', 'Anaheim, CA',     '2026-06-05'),
        ride('b1', 'driver', 'Davis, CA', 'San Francisco, CA', '2026-06-05'),
        ride('b2', 'driver', 'Davis, CA', 'Oakland, CA',       '2026-06-05'),
      ],
      today,
      'both',
    )
    expect(corridors).toHaveLength(2)
  })

  it('includes origin_address + dest_address on each ride for source-rides snapshot', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider', 'UC Davis, 1 Shields Ave, Davis, CA', 'Pier 39, San Francisco, CA', '2026-06-05'),
        ride('2', 'rider', 'Davis Commons, Davis, CA',           'SFO, San Francisco, CA',     '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(1)
    const rides = corridors[0]!.rides
    expect(rides[0]!.origin_address).toBe('UC Davis, 1 Shields Ave, Davis, CA')
    expect(rides[0]!.dest_address).toBe('Pier 39, San Francisco, CA')
    expect(rides[1]!.origin_address).toBe('Davis Commons, Davis, CA')
  })

  it('drops rides missing addresses', () => {
    const corridors = clusterCorridors(
      [
        ride('1', 'rider', null, 'Los Angeles, CA', '2026-06-05'),
        ride('2', 'rider', 'Davis, CA', null, '2026-06-05'),
        ride('3', 'rider', 'Davis, CA', 'Los Angeles, CA', '2026-06-05'),
        ride('4', 'rider', 'Davis, CA', 'Anaheim, CA',    '2026-06-05'),
      ],
      today,
    )
    expect(corridors).toHaveLength(1)
    expect(corridors[0]!.rides).toHaveLength(2)
  })
})

// ── helpers ────────────────────────────────────────────────────────

function ride(
  id: string,
  mode: 'rider' | 'driver',
  origin: string | null,
  dest: string | null,
  tripDate: string,
) {
  return {
    id,
    mode,
    origin_address: origin,
    dest_address: dest,
    trip_date: tripDate,
    trip_time: null,
    direction_type: 'one_way',
    available_seats: mode === 'driver' ? 3 : null,
  }
}

function mapDest(label: string): string {
  switch (label) {
    case 'SoCal': return 'Los Angeles, CA'
    case 'Bay Area': return 'San Francisco, CA'
    case 'Sacramento': return 'Sacramento, CA'
    case 'Reno': return 'Reno, NV'
    case 'Fresno': return 'Fresno, CA'
    case 'Stockton': return 'Stockton, CA'
    case 'Modesto': return 'Modesto, CA'
    default: return `${label}, CA`
  }
}
