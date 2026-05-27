// @vitest-environment node
/**
 * v1.2 F3.1 — Caregivers CRUD endpoint test coverage.
 *
 * Mirrors `vehicles.test.ts` structure: hoisted mocks for
 * `supabaseAdmin`, a chain-emulating builder per `from(...)` call, and
 * a thenable terminator so bare-await chains (DELETE) resolve.
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
const USER_ID = '00000000-0000-4000-8000-000000000aaa'
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000bbb'
const CAREGIVER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd'

const inserts: { rows: Array<Record<string, unknown>> } = { rows: [] }
const updates: { patches: Array<Record<string, unknown>> } = { patches: [] }
const deletes: { ids: string[] } = { ids: [] }

interface SetupOpts {
  ownerOfCaregiver?: string
  caregiverRowExists?: boolean
}

function setup(opts: SetupOpts = {}) {
  inserts.rows.length = 0
  updates.patches.length = 0
  deletes.ids.length = 0
  const owner = opts.ownerOfCaregiver ?? USER_ID
  const exists = opts.caregiverRowExists ?? true

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })

  mockFrom.mockImplementation((table: string) => {
    if (table !== 'caregivers') {
      throw new Error(`unmocked from(${table})`)
    }

    let updatePatch: Record<string, unknown> | null = null
    let insertPayload: Record<string, unknown> | null = null
    let isDelete = false
    let selectIsForOwnership = false
    let selectIsForList = false
    let selectIsForInsertReturn = false

    // 2026-05-22 — same fix as vehicles.test.ts: `never[]` parameter
    // list flips function-type variance so narrower-typed mock
    // assignments (insert/update/then with concrete arg types) slot
    // in. Test-only; no runtime change.
    const builder: Record<string, (...args: never[]) => unknown> = {}

    builder['select'] = (cols?: unknown) => {
      if (typeof cols === 'string' && cols === 'user_id') {
        selectIsForOwnership = true
      } else if (typeof cols === 'string' && cols === '*') {
        selectIsForList = true
      } else if (cols === undefined && insertPayload !== null) {
        // .insert(...).select() with no arg — iOS Repository pattern.
        // Returns the inserted row as the awaited result.
        selectIsForInsertReturn = true
      }
      return builder
    }
    builder['insert'] = (payload: Record<string, unknown>) => {
      insertPayload = payload
      return builder
    }
    builder['update'] = (patch: Record<string, unknown>) => {
      updatePatch = patch
      return builder
    }
    builder['delete'] = () => {
      isDelete = true
      return builder
    }
    builder['eq'] = (_col: unknown, value: unknown) => {
      if (isDelete && typeof value === 'string') {
        // Capture once we've reached the .eq('id', ...) on a DELETE.
        deletes.ids.push(value)
      }
      return builder
    }
    builder['order'] = () => builder
    builder['single'] = () => {
      if (insertPayload) {
        inserts.rows.push(insertPayload)
        return Promise.resolve({
          data: { id: CAREGIVER_ID, ...insertPayload },
          error: null,
        })
      }
      if (updatePatch) {
        updates.patches.push(updatePatch)
        return Promise.resolve({
          data: { id: CAREGIVER_ID, ...updatePatch },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }
    builder['maybeSingle'] = () => {
      if (selectIsForOwnership) {
        if (!exists) return Promise.resolve({ data: null, error: null })
        return Promise.resolve({ data: { user_id: owner }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }

    builder['then'] = (
      onFulfilled: (value: { data: unknown; error: null }) => unknown,
    ): unknown => {
      if (selectIsForList) {
        return Promise.resolve({
          data: [
            {
              id: CAREGIVER_ID,
              user_id: USER_ID,
              name: 'Sarah Smith',
              relationship: 'Mom',
              phone: '+15305550100',
              notes: 'Usually with me on chemo days',
              created_at: '2026-05-21T08:00:00Z',
              updated_at: '2026-05-21T08:00:00Z',
            },
          ],
          error: null,
        }).then(onFulfilled)
      }
      if (isDelete) {
        return Promise.resolve({ data: null, error: null }).then(onFulfilled)
      }
      if (selectIsForInsertReturn && insertPayload) {
        // iOS repository's `.insert().select().execute().value` path
        // — returns array.
        const inserted = { id: CAREGIVER_ID, ...insertPayload }
        inserts.rows.push(insertPayload)
        return Promise.resolve({ data: [inserted], error: null }).then(onFulfilled)
      }
      if (updatePatch) {
        updates.patches.push(updatePatch)
        updatePatch = null
      }
      return Promise.resolve({ data: null, error: null }).then(onFulfilled)
    }

    return builder
  })
}

describe('caregivers CRUD', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ── 401 across the board ────────────────────────────────────────────────

  it('401 on POST without token', async () => {
    const res = await request(app).post('/api/caregivers').send({ name: 'Mom' })
    expect(res.status).toBe(401)
  })

  it('401 on GET without token', async () => {
    const res = await request(app).get('/api/caregivers')
    expect(res.status).toBe(401)
  })

  it('401 on PATCH without token', async () => {
    const res = await request(app).patch(`/api/caregivers/${CAREGIVER_ID}`).send({ name: 'Mom' })
    expect(res.status).toBe(401)
  })

  it('401 on DELETE without token', async () => {
    const res = await request(app).delete(`/api/caregivers/${CAREGIVER_ID}`)
    expect(res.status).toBe(401)
  })

  // ── POST validation + happy path ────────────────────────────────────────

  it('POST 400 INVALID_BODY when name missing', async () => {
    setup()
    const res = await request(app)
      .post('/api/caregivers')
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
    expect(res.body.error.message).toMatch(/name/)
  })

  it('POST 400 INVALID_BODY when name > 100 chars', async () => {
    setup()
    const res = await request(app)
      .post('/api/caregivers')
      .set('Authorization', VALID_JWT)
      .send({ name: 'x'.repeat(101) })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('POST 400 INVALID_BODY when notes > 500 chars', async () => {
    setup()
    const res = await request(app)
      .post('/api/caregivers')
      .set('Authorization', VALID_JWT)
      .send({ name: 'Mom', notes: 'x'.repeat(501) })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('POST 201 happy path: trimmed name + relationship + phone + notes', async () => {
    setup()
    const res = await request(app)
      .post('/api/caregivers')
      .set('Authorization', VALID_JWT)
      .send({
        name: '  Sarah Smith  ',
        relationship: 'Mom',
        phone: '+15305550100',
        notes: 'Usually with me on chemo days',
      })
    expect(res.status).toBe(201)
    expect(inserts.rows).toHaveLength(1)
    const row = inserts.rows[0] as Record<string, unknown>
    expect(row['name']).toBe('Sarah Smith')
    expect(row['relationship']).toBe('Mom')
    expect(row['phone']).toBe('+15305550100')
    expect(row['notes']).toBe('Usually with me on chemo days')
    expect(row['user_id']).toBe(USER_ID)
  })

  it('POST 201 with only name (other fields null)', async () => {
    setup()
    const res = await request(app)
      .post('/api/caregivers')
      .set('Authorization', VALID_JWT)
      .send({ name: 'Aide' })
    expect(res.status).toBe(201)
    const row = inserts.rows[0] as Record<string, unknown>
    expect(row['name']).toBe('Aide')
    // Not-in-body fields don't appear in payload.
    expect('relationship' in row).toBe(false)
    expect('phone' in row).toBe(false)
    expect('notes' in row).toBe(false)
  })

  // ── GET happy path ──────────────────────────────────────────────────────

  it('GET 200 returns wrapped list', async () => {
    setup()
    const res = await request(app)
      .get('/api/caregivers')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.caregivers)).toBe(true)
    expect(res.body.caregivers).toHaveLength(1)
    expect(res.body.caregivers[0].name).toBe('Sarah Smith')
  })

  // ── PATCH happy + ownership ─────────────────────────────────────────────

  it('PATCH 200 happy path: updates name + bumps updated_at', async () => {
    setup()
    const res = await request(app)
      .patch(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
      .send({ name: 'Sarah J. Smith' })
    expect(res.status).toBe(200)
    expect(updates.patches).toHaveLength(1)
    const patch = updates.patches[0] as Record<string, unknown>
    expect(patch['name']).toBe('Sarah J. Smith')
    expect(typeof patch['updated_at']).toBe('string')
  })

  it('PATCH 400 INVALID_BODY when body has no recognised fields', async () => {
    setup()
    const res = await request(app)
      .patch(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
      .send({ totally_unknown_field: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('PATCH 404 when caregiver belongs to another user', async () => {
    setup({ ownerOfCaregiver: OTHER_USER_ID })
    const res = await request(app)
      .patch(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
      .send({ name: 'Hacked' })
    expect(res.status).toBe(404)
    expect(updates.patches).toHaveLength(0)
  })

  it('PATCH 404 when caregiver does not exist', async () => {
    setup({ caregiverRowExists: false })
    const res = await request(app)
      .patch(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
      .send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })

  // ── DELETE happy + ownership ────────────────────────────────────────────

  it('DELETE 204 happy path: hard deletes the row', async () => {
    setup()
    const res = await request(app)
      .delete(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(204)
    expect(deletes.ids).toContain(CAREGIVER_ID)
  })

  it('DELETE 404 when caregiver belongs to another user', async () => {
    setup({ ownerOfCaregiver: OTHER_USER_ID })
    const res = await request(app)
      .delete(`/api/caregivers/${CAREGIVER_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(deletes.ids).toHaveLength(0)
  })
})
