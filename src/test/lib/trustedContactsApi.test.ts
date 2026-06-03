/**
 * v1.3 Sprint 11 Slice 2 — trustedContactsApi unit tests.
 *
 * Pins:
 *   - normalisePhone mirrors iOS (trim, preserve leading +, strip
 *     non-digits) — this is the front-line guard against the server
 *     INVALID_PHONE 400 path.
 *   - Server error shape decodes into TrustedContactApiError with
 *     the right `code` so the friendly() mapping at the UI layer
 *     can switch on it (mirrors iOS friendly(serverError:)).
 *   - Network failure surfaces as TrustedContactApiError('NETWORK').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  addTrustedContact,
  deleteTrustedContact,
  listTrustedContacts,
  normalisePhone,
  TrustedContactApiError,
} from '@/lib/trustedContactsApi'

// ── Mocks ────────────────────────────────────────────────────────────

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
})

// ── normalisePhone — iOS parity ─────────────────────────────────────

describe('normalisePhone', () => {
  it('preserves a leading + and strips non-digit formatting', () => {
    expect(normalisePhone('+1 (415) 555-1234')).toBe('+14155551234')
  })

  it('strips parens / dashes / spaces from a US-style number without +', () => {
    expect(normalisePhone('(415) 555-1234')).toBe('4155551234')
  })

  it('trims leading + trailing whitespace before normalising', () => {
    expect(normalisePhone('  4155551234  ')).toBe('4155551234')
  })

  it('returns empty string on empty input', () => {
    expect(normalisePhone('')).toBe('')
    expect(normalisePhone('   ')).toBe('')
  })

  it('keeps unicode-digit-only input untouched', () => {
    expect(normalisePhone('14155551234')).toBe('14155551234')
  })
})

// ── listTrustedContacts ──────────────────────────────────────────────

describe('listTrustedContacts', () => {
  it('returns the contacts array on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contacts: [
          { id: 'c-1', name: 'Mom', phone: '+15551112222', created_at: '2026-05-01' },
        ],
      }),
    }))
    const list = await listTrustedContacts()
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('Mom')
  })

  it('throws TrustedContactApiError with NETWORK code on fetch rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(listTrustedContacts()).rejects.toBeInstanceOf(TrustedContactApiError)
    await expect(listTrustedContacts()).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('throws UNAUTHENTICATED when no session exists', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(listTrustedContacts()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

// ── addTrustedContact ────────────────────────────────────────────────

describe('addTrustedContact', () => {
  it('posts name + phone and returns the new contact on 201', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contact: { id: 'c-new', name: 'Mom', phone: '+15551112222', created_at: '2026-06-02' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const newContact = await addTrustedContact({ name: 'Mom', phone: '+15551112222' })
    expect(newContact.id).toBe('c-new')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/safety/trusted-contacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Mom', phone: '+15551112222' }),
      }),
    )
  })

  it('maps the server INVALID_NAME 400 into TrustedContactApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'INVALID_NAME', message: 'Name must be 1-60 characters' } }),
    }))
    await expect(addTrustedContact({ name: '', phone: '+15551112222' }))
      .rejects.toMatchObject({ code: 'INVALID_NAME' })
  })

  it('maps the server INVALID_PHONE 400 into TrustedContactApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'INVALID_PHONE', message: 'Phone must be a valid number' } }),
    }))
    await expect(addTrustedContact({ name: 'Mom', phone: '' }))
      .rejects.toMatchObject({ code: 'INVALID_PHONE' })
  })

  it('maps the server LIMIT_REACHED 409 into TrustedContactApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'LIMIT_REACHED', message: 'You can save up to 5 trusted contacts' } }),
    }))
    await expect(addTrustedContact({ name: 'Sixth', phone: '+15551112222' }))
      .rejects.toMatchObject({ code: 'LIMIT_REACHED' })
  })
})

// ── deleteTrustedContact ─────────────────────────────────────────────

describe('deleteTrustedContact', () => {
  it('DELETEs to the per-id endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await deleteTrustedContact('c-123')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/safety/trusted-contacts/c-123',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws TrustedContactApiError on INVALID_ID 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'INVALID_ID', message: 'Invalid contact id' } }),
    }))
    await expect(deleteTrustedContact('not-a-uuid'))
      .rejects.toMatchObject({ code: 'INVALID_ID' })
  })
})
