// @vitest-environment node
/**
 * v1.2 F18.1 — GET /api/users/:id/public-profile.
 *
 * Canonical "view someone else's profile" endpoint. Returns the
 * public-safe subset of the users row + active vehicle (driver-only,
 * plate redacted to last 4) + completed-rides count. Private fields
 * (phone, email, stripe_*, wallet_balance) are NEVER returned.
 *
 * Covers: 401, 400 invalid UUID, 404 user not found, 200 rider
 * shape, 200 driver shape with redacted plate, accessibility +
 * waive_caregiver_fee projection.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const VIEWER_ID = '00000000-0000-4000-8000-000000000aaa'
const SUBJECT_ID = '11111111-1111-4111-8111-111111111111'

interface SubjectShape {
  id?: string
  full_name?: string | null
  avatar_url?: string | null
  is_driver?: boolean | null
  rating_avg?: number | null
  rating_count?: number | null
  bio?: string | null
  gender?: string | null
  school?: string | null
  major?: string | null
  graduation_year?: number | null
  has_accessibility_needs?: boolean | null
  accessibility_profile?: { needs_wheelchair?: boolean } | null
  created_at?: string
  waive_caregiver_fee?: boolean | null
}
interface VehicleShape {
  make?: string | null
  model?: string | null
  color?: string | null
  year?: number | null
  plate?: string | null
  wheelchair_capable?: boolean | null
  trunk_size?: string | null
}

function setup(opts: {
  subject?: SubjectShape | null
  vehicle?: VehicleShape | null
  ridesCount?: number
} = {}) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: VIEWER_ID } },
    error: null,
  })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: opts.subject === undefined
                ? defaultSubject()
                : opts.subject,
              error: opts.subject === null ? { message: 'not found' } : null,
            }),
          }),
        }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: opts.vehicle ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => ({
            or: () => Promise.resolve({
              count: opts.ridesCount ?? 0,
              error: null,
            }),
          }),
        }),
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

function defaultSubject(): SubjectShape {
  return {
    id: SUBJECT_ID,
    full_name: 'Sarah Johnson',
    avatar_url: 'https://example/sarah.jpg',
    is_driver: false,
    rating_avg: 4.9,
    rating_count: 47,
    bio: 'CS senior at UC Davis.',
    gender: 'female',
    school: 'UC Davis',
    major: 'Computer Science',
    graduation_year: 2027,
    has_accessibility_needs: false,
    accessibility_profile: null,
    created_at: '2026-04-12T00:00:00Z',
    waive_caregiver_fee: false,
  }
}

describe('GET /api/users/:id/public-profile', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401 without a token', async () => {
    const res = await request(app).get(`/api/users/${SUBJECT_ID}/public-profile`)
    expect(res.status).toBe(401)
  })

  it('400 INVALID_ID for non-UUID', async () => {
    setup()
    const res = await request(app)
      .get('/api/users/not-a-uuid/public-profile')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ID')
  })

  it('404 when user row missing', async () => {
    setup({ subject: null })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('200 returns rider profile (no vehicle), surfaces school/major/bio + rating', async () => {
    setup({ ridesCount: 12 })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.full_name).toBe('Sarah Johnson')
    expect(res.body.is_driver).toBe(false)
    expect(res.body.rating_avg).toBe(4.9)
    expect(res.body.rating_count).toBe(47)
    expect(res.body.rides_completed).toBe(12)
    expect(res.body.bio).toContain('UC Davis')
    expect(res.body.school).toBe('UC Davis')
    expect(res.body.major).toBe('Computer Science')
    expect(res.body.graduation_year).toBe(2027)
    expect(res.body.vehicle).toBe(null)
    // Private fields must NEVER leak.
    expect(res.body.phone).toBeUndefined()
    expect(res.body.email).toBeUndefined()
    expect(res.body.stripe_customer_id).toBeUndefined()
  })

  it('200 driver returns vehicle with plate redacted to last 4 chars', async () => {
    setup({
      subject: { ...defaultSubject(), is_driver: true },
      vehicle: {
        make: 'Honda',
        model: 'Civic',
        color: 'Black',
        year: 2022,
        plate: '8XGT942',
        wheelchair_capable: true,
        trunk_size: 'small',
      },
      ridesCount: 88,
    })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.is_driver).toBe(true)
    expect(res.body.vehicle).toMatchObject({
      make: 'Honda',
      model: 'Civic',
      color: 'Black',
      year: 2022,
      plate_last4: 'T942',
      wheelchair_capable: true,
      trunk_size: 'small',
    })
    // Full plate must not be returned anywhere on the payload.
    expect(JSON.stringify(res.body)).not.toContain('8XGT942')
  })

  it('200 projects has_accessibility_needs + needs_wheelchair + waive_caregiver_fee', async () => {
    setup({
      subject: {
        ...defaultSubject(),
        has_accessibility_needs: true,
        accessibility_profile: { needs_wheelchair: true },
        waive_caregiver_fee: true,
      },
    })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.has_accessibility_needs).toBe(true)
    expect(res.body.needs_wheelchair).toBe(true)
    expect(res.body.waive_caregiver_fee).toBe(true)
  })

  it('needs_wheelchair is false when top-level flag is off (sub-state gate)', async () => {
    setup({
      subject: {
        ...defaultSubject(),
        has_accessibility_needs: false,
        accessibility_profile: { needs_wheelchair: true },
      },
    })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.has_accessibility_needs).toBe(false)
    expect(res.body.needs_wheelchair).toBe(false)
  })

  it('plate shorter than 4 chars returns the full short plate (no padding)', async () => {
    setup({
      subject: { ...defaultSubject(), is_driver: true },
      vehicle: { make: 'Tesla', model: 'X', color: 'White', year: 2024, plate: 'AB1' },
    })
    const res = await request(app)
      .get(`/api/users/${SUBJECT_ID}/public-profile`)
      .set('Authorization', VALID_JWT)
    expect(res.body.vehicle.plate_last4).toBe('AB1')
  })
})
