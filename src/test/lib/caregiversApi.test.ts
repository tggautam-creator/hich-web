/**
 * v1.2 Sprint 6 Slice 1 — caregiversApi unit coverage.
 *
 * Mocks supabase-js at the from() boundary so the helpers stay
 * decoupled from network / RLS / the real Postgrest builder. The
 * mocks return canned shapes and the tests assert (a) what got
 * sent and (b) what got returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  addCaregiver,
  deleteCaregiver,
  loadCaregivers,
  updateCaregiver,
} from '@/lib/caregiversApi'

// ── Supabase mock ────────────────────────────────────────────────────

interface CallLog {
  table?:    string
  selected?: boolean
  inserted?: Record<string, unknown>
  updated?:  Record<string, unknown>
  deleted?:  boolean
  eqs:       Array<{ col: string; value: unknown }>
  ordered?:  { col: string; ascending: boolean }
  singled?:  boolean
}

interface MockSetters {
  setNextSelectList: (r: { data: unknown[]; error: { message: string } | null }) => void
  setNextSingle:     (r: { data: unknown; error: { message: string } | null }) => void
  setNextEq:         (r: { error: { message: string } | null }) => void
}

const {
  calls,
  supabaseStub,
  setNextSelectList,
  setNextSingle,
  setNextEq,
} = vi.hoisted((): {
  calls:        CallLog[]
  supabaseStub: { from: (table: string) => unknown }
} & MockSetters => {
  const calls: CallLog[] = []
  let nextSelectListResolver: { data: unknown[]; error: { message: string } | null } = {
    data: [], error: null,
  }
  let nextSingleResolver: { data: unknown; error: { message: string } | null } = {
    data: null, error: null,
  }
  let nextEqResolver: { error: { message: string } | null } = { error: null }

  function makeBuilder(table: string) {
    const call: CallLog = { table, eqs: [] }
    calls.push(call)

    const builder = {
      select(_cols?: string) {
        call.selected = true
        return builder
      },
      insert(payload: Record<string, unknown>) {
        call.inserted = payload
        return builder
      },
      update(payload: Record<string, unknown>) {
        call.updated = payload
        return builder
      },
      delete() {
        call.deleted = true
        return builder
      },
      eq(col: string, value: unknown) {
        call.eqs.push({ col, value })
        // Terminal write (.update / .delete) resolves on eq; otherwise
        // return the builder for further chaining.
        if (call.updated || call.deleted) {
          return Promise.resolve(nextEqResolver)
        }
        return builder
      },
      order(col: string, opts: { ascending: boolean }) {
        call.ordered = { col, ascending: opts.ascending }
        return Promise.resolve(nextSelectListResolver)
      },
      async single() {
        call.singled = true
        return nextSingleResolver
      },
    }
    return builder
  }

  return {
    calls,
    supabaseStub: { from: (table: string) => makeBuilder(table) },
    setNextSelectList: (r) => { nextSelectListResolver = r },
    setNextSingle:     (r) => { nextSingleResolver = r },
    setNextEq:         (r) => { nextEqResolver = r },
  }
})

vi.mock('@/lib/supabase', () => ({ supabase: supabaseStub }))

beforeEach(() => {
  calls.length = 0
  setNextSelectList({ data: [], error: null })
  setNextSingle({ data: null, error: null })
  setNextEq({ error: null })
})

// ── loadCaregivers ───────────────────────────────────────────────────

describe('loadCaregivers', () => {
  it('selects from caregivers, scopes by user_id, orders desc by created_at', async () => {
    setNextSelectList({ data: [{ id: 'c-1', user_id: 'user-1', name: 'Mom' }], error: null })

    const rows = await loadCaregivers('user-1')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Mom')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      table:    'caregivers',
      selected: true,
      eqs:      [{ col: 'user_id', value: 'user-1' }],
      ordered:  { col: 'created_at', ascending: false },
    })
  })

  it('throws when the table read errors', async () => {
    setNextSelectList({ data: [], error: { message: 'rls denied' } })
    await expect(loadCaregivers('user-1')).rejects.toThrow('rls denied')
  })
})

// ── addCaregiver ─────────────────────────────────────────────────────

describe('addCaregiver', () => {
  it('inserts the full payload with nulls for omitted optional fields', async () => {
    setNextSingle({ data: { id: 'c-new', user_id: 'user-1', name: 'Mom' }, error: null })

    const row = await addCaregiver({ userId: 'user-1', name: 'Mom' })

    expect(row.id).toBe('c-new')
    expect(calls[0]?.inserted).toEqual({
      user_id:      'user-1',
      name:         'Mom',
      relationship: null,
      phone:        null,
      notes:        null,
      avatar_url:   null,
    })
    expect(calls[0]?.singled).toBe(true)
  })

  it('passes through provided optional fields verbatim', async () => {
    setNextSingle({ data: { id: 'c-new' }, error: null })

    await addCaregiver({
      userId:       'user-1',
      name:         'Sarah',
      relationship: 'Sister',
      phone:        '+15555550199',
      notes:        'Joins on chemo days',
      avatarUrl:    'https://example.com/sarah.jpg',
    })

    expect(calls[0]?.inserted).toEqual({
      user_id:      'user-1',
      name:         'Sarah',
      relationship: 'Sister',
      phone:        '+15555550199',
      notes:        'Joins on chemo days',
      avatar_url:   'https://example.com/sarah.jpg',
    })
  })

  it('throws when the insert returns no row (RLS bounce or DB error)', async () => {
    setNextSingle({ data: null, error: { message: 'rls denied' } })
    await expect(addCaregiver({ userId: 'user-1', name: 'Mom' })).rejects.toThrow('rls denied')
  })
})

// ── updateCaregiver ──────────────────────────────────────────────────

describe('updateCaregiver', () => {
  it('only patches the keys the caller passed + always bumps updated_at', async () => {
    await updateCaregiver({ caregiverId: 'c-1', name: 'Mom (updated)' })

    const updated = calls[0]?.updated ?? {}
    expect(updated.name).toBe('Mom (updated)')
    expect(typeof updated.updated_at).toBe('string')
    // No other keys touched
    expect(Object.keys(updated).sort()).toEqual(['name', 'updated_at'])
    expect(calls[0]?.eqs).toEqual([{ col: 'id', value: 'c-1' }])
  })

  it('accepts explicit null to clear a nullable column', async () => {
    await updateCaregiver({ caregiverId: 'c-1', avatarUrl: null, phone: null })

    const updated = calls[0]?.updated ?? {}
    expect(updated.avatar_url).toBeNull()
    expect(updated.phone).toBeNull()
  })

  it('round-trips relationship + notes verbatim', async () => {
    await updateCaregiver({
      caregiverId:  'c-1',
      relationship: 'Aide',
      notes:        'Updated note',
    })

    const updated = calls[0]?.updated ?? {}
    expect(updated.relationship).toBe('Aide')
    expect(updated.notes).toBe('Updated note')
  })

  it('throws when the update errors', async () => {
    setNextEq({ error: { message: 'rls denied' } })
    await expect(updateCaregiver({ caregiverId: 'c-1', name: 'X' })).rejects.toThrow('rls denied')
  })
})

// ── deleteCaregiver ──────────────────────────────────────────────────

describe('deleteCaregiver', () => {
  it('hard-deletes by id', async () => {
    await deleteCaregiver('c-1')

    expect(calls[0]).toMatchObject({
      table:   'caregivers',
      deleted: true,
      eqs:     [{ col: 'id', value: 'c-1' }],
    })
  })

  it('throws when the delete errors', async () => {
    setNextEq({ error: { message: 'rls denied' } })
    await expect(deleteCaregiver('c-1')).rejects.toThrow('rls denied')
  })
})
