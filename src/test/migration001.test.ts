// @vitest-environment node
/**
 * Migration 001 — users table tests
 *
 * Reads supabase/migrations/001_users_table.sql and asserts:
 *  1. PostGIS extension is enabled
 *  2. users table is created with every required column
 *  3. wallet_balance defaults to 0 (integer, cents)
 *  4. is_driver defaults to false
 *  5. home_location geometry column is added
 *  6. Row-level security is enabled
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

let sql: string

beforeAll(() => {
  sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/001_users_table.sql'),
    'utf-8',
  )
})

describe('migration 001 — PostGIS', () => {
  it('enables the postgis extension', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS postgis/i)
  })
})

describe('migration 001 — users table columns', () => {
  it('creates the users table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS users/i)
  })

  it('has id column (uuid primary key)', () => {
    expect(sql).toMatch(/\bid\b/)
    expect(sql).toMatch(/uuid/i)
    expect(sql).toMatch(/PRIMARY KEY/i)
  })

  it('has email column (unique)', () => {
    expect(sql).toMatch(/\bemail\b/)
    expect(sql).toMatch(/UNIQUE/i)
  })

  it('has phone column', () => {
    expect(sql).toMatch(/\bphone\b/)
  })

  it('has full_name column', () => {
    expect(sql).toMatch(/\bfull_name\b/)
  })

  it('has avatar_url column', () => {
    expect(sql).toMatch(/\bavatar_url\b/)
  })

  it('has wallet_balance defaulting to 0 (cents)', () => {
    expect(sql).toMatch(/wallet_balance/)
    expect(sql).toMatch(/integer/)
    expect(sql).toMatch(/DEFAULT 0/)
  })

  it('has stripe_customer_id column', () => {
    expect(sql).toMatch(/\bstripe_customer_id\b/)
  })

  it('has is_driver defaulting to false', () => {
    expect(sql).toMatch(/\bis_driver\b/)
    expect(sql).toMatch(/DEFAULT false/i)
  })

  it('has rating_avg column', () => {
    expect(sql).toMatch(/\brating_avg\b/)
  })

  it('has rating_count column', () => {
    expect(sql).toMatch(/\brating_count\b/)
  })

  it('has created_at column (timestamptz)', () => {
    expect(sql).toMatch(/\bcreated_at\b/)
    expect(sql).toMatch(/timestamptz/i)
  })
})

describe('migration 001 — geometry column', () => {
  it('adds home_location as a PostGIS Point geometry', () => {
    expect(sql).toMatch(/\bhome_location\b/)
    expect(sql).toMatch(/GEOMETRY\(Point,\s*4326\)/i)
  })
})

describe('migration 001 — row-level security', () => {
  it('enables RLS on the users table', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i)
  })

  it('has a policy for SELECT', () => {
    expect(sql).toMatch(/FOR SELECT/i)
  })

  it('has a policy for UPDATE', () => {
    expect(sql).toMatch(/FOR UPDATE/i)
  })
})
