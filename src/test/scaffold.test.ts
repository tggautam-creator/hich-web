/**
 * Scaffold smoke tests — Task 1 (Week 1)
 *
 * Verifies:
 *  1. The @/ path alias resolves (imports from src/ work)
 *  2. src/types/database.ts exports the expected types
 *  3. React Query QueryClient can be instantiated (dep installed)
 *  4. React Router createBrowserRouter is importable (dep installed)
 *  5. Zustand createStore is importable (dep installed)
 */

import { describe, it, expect } from 'vitest'

// ── 1. @/ alias resolves to src/ ─────────────────────────────────────────────
import type { User, Ride, Vehicle, Transaction, DriverRoutine } from '@/types/database'

describe('scaffold — @/ alias and database types', () => {
  it('User type has required fields', () => {
    const user: User = {
      id: 'abc',
      email: 'test@ucdavis.edu',
      phone: null,
      full_name: 'Test User',
      avatar_url: null,
      wallet_balance: 0,
      stripe_customer_id: null,
      is_driver: false,
      rating_avg: null,
      rating_count: 0,
      home_location: null,
      created_at: new Date().toISOString(),
    }
    expect(user.wallet_balance).toBe(0)
    expect(user.is_driver).toBe(false)
    expect(typeof user.id).toBe('string')
  })

  it('wallet_balance is an integer (cents)', () => {
    const user: User = {
      id: 'abc',
      email: 'test@ucdavis.edu',
      phone: null,
      full_name: null,
      avatar_url: null,
      wallet_balance: 500, // $5.00
      stripe_customer_id: null,
      is_driver: false,
      rating_avg: null,
      rating_count: 0,
      home_location: null,
      created_at: new Date().toISOString(),
    }
    expect(Number.isInteger(user.wallet_balance)).toBe(true)
    expect(user.wallet_balance).toBe(500)
  })

  it('Ride type allows all valid status values', () => {
    const statuses: Ride['status'][] = [
      'requested',
      'accepted',
      'coordinating',
      'active',
      'completed',
      'cancelled',
    ]
    expect(statuses).toHaveLength(6)
  })

  it('Vehicle type has seats_available field', () => {
    const v: Vehicle = {
      id: 'v1',
      user_id: 'u1',
      vin: '1HGBH41JXMN109186',
      make: 'Honda',
      model: 'Civic',
      year: 2022,
      color: 'blue',
      plate: 'ABC123',
      license_plate_photo_url: 'https://example.com/plate.jpg',
      car_photo_url: 'https://example.com/car.jpg',
      seats_available: 3,
      is_active: true,
    }
    expect(v.seats_available).toBeGreaterThanOrEqual(1)
    expect(v.seats_available).toBeLessThanOrEqual(4)
  })

  it('Transaction amount is in cents (integer)', () => {
    const tx: Transaction = {
      id: 't1',
      user_id: 'u1',
      ride_id: null,
      type: 'topup',
      amount_cents: 1000,
      balance_after_cents: 1000,
      description: 'Top-up $10',
      created_at: new Date().toISOString(),
    }
    expect(Number.isInteger(tx.amount_cents)).toBe(true)
  })

  it('DriverRoutine day_of_week is an array', () => {
    const routine: DriverRoutine = {
      id: 'r1',
      user_id: 'u1',
      route_name: 'Home → Campus',
      origin: { type: 'Point', coordinates: [-121.7405, 38.5382] },
      destination: { type: 'Point', coordinates: [-121.7491, 38.5449] },
      destination_bearing: 315,
      direction_type: 'one_way',
      day_of_week: [1, 3, 5], // Mon, Wed, Fri
      departure_time: '08:00',
      arrival_time: '08:30',
      is_active: true,
      created_at: new Date().toISOString(),
    }
    expect(Array.isArray(routine.day_of_week)).toBe(true)
    expect(routine.day_of_week).toContain(1)
  })
})

// ── 2. Third-party dependencies are installed ─────────────────────────────────
import { QueryClient } from '@tanstack/react-query'
import { createBrowserRouter } from 'react-router-dom'
import { createStore } from 'zustand/vanilla'

describe('scaffold — dependencies installed', () => {
  it('React Query QueryClient can be instantiated', () => {
    const client = new QueryClient()
    expect(client).toBeDefined()
    client.clear()
  })

  it('React Router createBrowserRouter is a function', () => {
    expect(typeof createBrowserRouter).toBe('function')
  })

  it('Zustand createStore is a function', () => {
    expect(typeof createStore).toBe('function')
  })
})
