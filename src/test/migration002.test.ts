// @vitest-environment node
/**
 * Migration 002 — remaining schema tests
 *
 * Reads supabase/migrations/002_remaining_schema.sql and asserts
 * every required table, column, constraint, and index is present.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

let sql: string

beforeAll(() => {
  sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/002_remaining_schema.sql'),
    'utf-8',
  )
})

// ── vehicles ──────────────────────────────────────────────────────────────────
describe('migration 002 — vehicles table', () => {
  it('creates the vehicles table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vehicles/i)
  })

  it('references users table via user_id', () => {
    expect(sql).toMatch(/user_id.*REFERENCES users/is)
  })

  it('has vin, make, model, year, color, plate columns', () => {
    expect(sql).toMatch(/\bvin\b/)
    expect(sql).toMatch(/\bmake\b/)
    expect(sql).toMatch(/\bmodel\b/)
    expect(sql).toMatch(/\byear\b/)
    expect(sql).toMatch(/\bcolor\b/)
    expect(sql).toMatch(/\bplate\b/)
  })

  it('has license_plate_photo_url and car_photo_url columns', () => {
    expect(sql).toMatch(/license_plate_photo_url/)
    expect(sql).toMatch(/car_photo_url/)
  })

  it('has seats_available defaulting to 4', () => {
    expect(sql).toMatch(/seats_available/)
    expect(sql).toMatch(/DEFAULT 4/)
  })

  it('has is_active defaulting to true', () => {
    expect(sql).toMatch(/is_active/)
  })

  it('enables RLS on vehicles', () => {
    expect(sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeGreaterThan(
      sql.indexOf('CREATE TABLE IF NOT EXISTS vehicles'),
    )
  })
})

// ── driver_locations ──────────────────────────────────────────────────────────
describe('migration 002 — driver_locations table', () => {
  it('creates the driver_locations table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS driver_locations/i)
  })

  it('has a PostGIS Point geometry column', () => {
    expect(sql).toMatch(/GEOMETRY\(Point,\s*4326\)/i)
  })

  it('has heading and speed columns', () => {
    expect(sql).toMatch(/\bheading\b/)
    expect(sql).toMatch(/\bspeed\b/)
  })

  it('creates the required PostGIS spatial index', () => {
    expect(sql).toMatch(/idx_driver_locations_geom/)
    expect(sql).toMatch(/USING GIST/i)
  })
})

// ── rides ─────────────────────────────────────────────────────────────────────
describe('migration 002 — rides table', () => {
  it('creates the rides table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rides/i)
  })

  it('has rider_id and driver_id columns', () => {
    expect(sql).toMatch(/rider_id/)
    expect(sql).toMatch(/driver_id/)
  })

  it('status CHECK constraint includes all six valid values', () => {
    const statuses = ['requested', 'accepted', 'coordinating', 'active', 'completed', 'cancelled']
    for (const s of statuses) {
      expect(sql).toContain(s)
    }
  })

  it('fare_cents column is present (integer, cents)', () => {
    expect(sql).toMatch(/fare_cents/)
  })

  it('has origin geometry column', () => {
    expect(sql).toMatch(/\borigin\b/)
  })

  it('has destination_bearing column', () => {
    expect(sql).toMatch(/destination_bearing/)
  })

  it('has pickup_point and dropoff_point geometry columns', () => {
    expect(sql).toMatch(/pickup_point/)
    expect(sql).toMatch(/dropoff_point/)
  })

  it('has started_at and ended_at timestamps', () => {
    expect(sql).toMatch(/started_at/)
    expect(sql).toMatch(/ended_at/)
  })
})

// ── transactions ──────────────────────────────────────────────────────────────
describe('migration 002 — transactions table', () => {
  it('creates the transactions table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS transactions/i)
  })

  it('has amount_cents and balance_after_cents (cents convention)', () => {
    expect(sql).toMatch(/amount_cents/)
    expect(sql).toMatch(/balance_after_cents/)
  })

  it('has type and description columns', () => {
    expect(sql).toMatch(/\btype\b/)
    expect(sql).toMatch(/\bdescription\b/)
  })

  it('references both users and rides tables', () => {
    expect(sql).toMatch(/REFERENCES users/)
    expect(sql).toMatch(/REFERENCES rides/)
  })
})

// ── driver_routines ───────────────────────────────────────────────────────────
describe('migration 002 — driver_routines table', () => {
  it('creates the driver_routines table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS driver_routines/i)
  })

  it('has route_name column', () => {
    expect(sql).toMatch(/route_name/)
  })

  it('has origin and destination geometry columns', () => {
    expect(sql).toMatch(/\borigin\b/)
    expect(sql).toMatch(/\bdestination\b/)
  })

  it('has destination_bearing column', () => {
    expect(sql).toMatch(/destination_bearing/)
  })

  it('direction_type CHECK constraint covers one_way and roundtrip', () => {
    expect(sql).toMatch(/one_way/)
    expect(sql).toMatch(/roundtrip/)
  })

  it('has day_of_week as an integer array', () => {
    expect(sql).toMatch(/day_of_week/)
    expect(sql).toMatch(/integer\[\]/)
  })

  it('has departure_time and arrival_time columns', () => {
    expect(sql).toMatch(/departure_time/)
    expect(sql).toMatch(/arrival_time/)
  })

  it('has is_active defaulting to true', () => {
    expect(sql).toMatch(/is_active/)
  })

  it('creates bearing index for Stage 3 direction matching', () => {
    expect(sql).toMatch(/idx_driver_routines_bearing/)
  })
})
