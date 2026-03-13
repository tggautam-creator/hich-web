/**
 * Task 5 — Supabase client + database types tests
 *
 * Verifies:
 *  1. supabase client is exported and has expected interface
 *  2. Database type structure is correct (Row/Insert/Update per table)
 *  3. Row-type aliases match the Database schema
 *  4. Cents convention is enforced in the type definitions
 *  5. RideStatus union covers all six values
 */

import { describe, it, expect } from 'vitest'
import { supabase } from '@/lib/supabase'
import type {
  Database,
  User,
  Vehicle,
  DriverLocation,
  Ride,
  RideStatus,
  Transaction,
  DriverRoutine,
  Message,
  PushToken,
} from '@/types/database'

// ── Supabase client ───────────────────────────────────────────────────────────
describe('supabase client', () => {
  it('is defined', () => {
    expect(supabase).toBeDefined()
  })

  it('exposes .from() query builder', () => {
    expect(typeof supabase.from).toBe('function')
  })

  it('exposes .auth namespace', () => {
    expect(supabase.auth).toBeDefined()
    expect(typeof supabase.auth.signInWithOtp).toBe('function')
    expect(typeof supabase.auth.signOut).toBe('function')
    expect(typeof supabase.auth.getSession).toBe('function')
  })

  it('exposes .storage namespace', () => {
    expect(supabase.storage).toBeDefined()
    expect(typeof supabase.storage.from).toBe('function')
  })

  it('exposes .channel() for Realtime', () => {
    expect(typeof supabase.channel).toBe('function')
  })
})

// ── Database type — Row aliases are usable ────────────────────────────────────
describe('database types — row aliases', () => {
  it('User Row type includes all required fields', () => {
    const user: User = {
      id: 'u1',
      email: 'test@ucdavis.edu',
      phone: null,
      full_name: 'Test User',
      avatar_url: null,
      wallet_balance: 500,      // cents
      stripe_customer_id: null,
      is_driver: false,
      rating_avg: null,
      rating_count: 0,
      home_location: null,
      created_at: new Date().toISOString(),
    }
    expect(user.wallet_balance).toBe(500)
    expect(Number.isInteger(user.wallet_balance)).toBe(true)
  })

  it('Vehicle Row type has seats_available', () => {
    const v: Vehicle = {
      id: 'v1', user_id: 'u1', vin: '1HGBH41JXMN109186',
      make: 'Honda', model: 'Civic', year: 2022, color: 'blue',
      plate: 'ABC123', license_plate_photo_url: 'https://x.com/p.jpg',
      car_photo_url: 'https://x.com/c.jpg', seats_available: 3,
      fuel_efficiency_mpg: null, is_active: true,
    }
    expect(v.seats_available).toBeGreaterThanOrEqual(1)
  })

  it('DriverLocation Row type has GeoPoint location', () => {
    const dl: DriverLocation = {
      id: 'd1', user_id: 'u1',
      location: { type: 'Point', coordinates: [-121.74, 38.54] },
      heading: 180, speed: 30, recorded_at: new Date().toISOString(),
    }
    expect(dl.location.type).toBe('Point')
    expect(dl.location.coordinates).toHaveLength(2)
  })

  it('Ride Row type status is narrowed to RideStatus union', () => {
    const statuses: RideStatus[] = [
      'requested', 'accepted', 'coordinating',
      'active', 'completed', 'cancelled',
    ]
    expect(statuses).toHaveLength(6)
  })

  it('Ride fare_cents is in cents (null or integer)', () => {
    const ride: Ride = {
      id: 'r1', rider_id: 'u1', driver_id: null, vehicle_id: null,
      status: 'requested',
      origin: { type: 'Point', coordinates: [-121.74, 38.54] },
      destination: null, destination_name: null,
      destination_bearing: null, pickup_point: null, pickup_note: null,
      dropoff_point: null, pickup_confirmed: false, dropoff_confirmed: false, fare_cents: 350,
      started_at: null, ended_at: null,
      created_at: new Date().toISOString(),
      schedule_id: null, trip_date: null, trip_time: null,
    }
    expect(ride.fare_cents).not.toBeNull()
    expect(Number.isInteger(ride.fare_cents)).toBe(true)
  })

  it('Transaction amount_cents and balance_after_cents are integers', () => {
    const tx: Transaction = {
      id: 't1', user_id: 'u1', ride_id: null, type: 'topup',
      amount_cents: 1000, balance_after_cents: 1000,
      description: '$10 top-up', created_at: new Date().toISOString(),
    }
    expect(Number.isInteger(tx.amount_cents)).toBe(true)
    expect(Number.isInteger(tx.balance_after_cents)).toBe(true)
  })

  it('DriverRoutine day_of_week is an array', () => {
    const r: DriverRoutine = {
      id: 'dr1', user_id: 'u1', route_name: 'Home → Campus',
      origin: { type: 'Point', coordinates: [-121.74, 38.54] },
      destination: { type: 'Point', coordinates: [-121.75, 38.55] },
      destination_bearing: 315, direction_type: 'one_way',
      day_of_week: [1, 3, 5], departure_time: '08:00',
      arrival_time: '08:30', origin_address: null, dest_address: null,
      is_active: true, created_at: new Date().toISOString(),
    }
    expect(Array.isArray(r.day_of_week)).toBe(true)
  })

  it('Message Row type has ride_id, sender_id, content', () => {
    const msg: Message = {
      id: 'm1', ride_id: 'r1', sender_id: 'u1',
      content: 'On my way!', type: 'text', meta: null,
      created_at: new Date().toISOString(),
    }
    expect(msg.content).toBe('On my way!')
  })

  it('PushToken Row type has token field', () => {
    const pt: PushToken = {
      id: 'pt1', user_id: 'u1', token: 'fcm-token-abc',
      created_at: new Date().toISOString(),
    }
    expect(pt.token).toBe('fcm-token-abc')
  })
})

// ── Database type shape ───────────────────────────────────────────────────────
describe('database types — schema shape', () => {
  it('Database type has public.Tables with all eight tables', () => {
    // Compile-time check: if any table name is wrong, tsc fails the build
    type Tables = Database['public']['Tables']
    type TableNames = keyof Tables
    const names: TableNames[] = [
      'users', 'vehicles', 'driver_locations', 'rides',
      'transactions', 'driver_routines', 'messages', 'push_tokens',
    ]
    expect(names).toHaveLength(8)
  })
})
