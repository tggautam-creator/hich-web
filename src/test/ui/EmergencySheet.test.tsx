/**
 * EmergencySheet tests
 *
 * Verifies:
 *  1. Does not render when closed
 *  2. Renders all three options when open
 *  3. Call 911 link has correct tel: href
 *  4. Share location button calls API and shows link
 *  5. Report button opens inline category picker (no navigation)
 *  6. Backdrop click does NOT dismiss (no onClose called)
 *  7. Close button calls onClose
 *  8. Renders in a portal (at top of DOM)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EmergencySheet from '@/components/ui/EmergencySheet'

// ── Mock supabase ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      }),
    },
  },
}))

// ── Mock env ───────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

// v1.3 Sprint 11 Slice 3 — EmergencySheet now consumes useRideRole
// to surface the role-aware safety report category list. Stub the
// hook so existing tests don't need a QueryClientProvider.
const { mockRideRole } = vi.hoisted(() => ({
  mockRideRole: { current: 'rider' as 'rider' | 'driver' | null },
}))

vi.mock('@/hooks/useRideRole', () => ({
  useRideRole: () => ({ role: mockRideRole.current, isLoading: false, error: null }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function renderSheet(props: Partial<Parameters<typeof EmergencySheet>[0]> = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    rideId: 'ride-001',
  }
  return { ...render(<EmergencySheet {...defaultProps} {...props} />), onClose: defaultProps.onClose }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EmergencySheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the role mock between tests — default to rider.
    mockRideRole.current = 'rider'
    // Ensure portal root exists
    if (!document.getElementById('portal-root')) {
      const el = document.createElement('div')
      el.id = 'portal-root'
      document.body.appendChild(el)
    }
  })

  it('does not render when closed', () => {
    renderSheet({ isOpen: false })
    expect(screen.queryByTestId('emergency-sheet')).not.toBeInTheDocument()
  })

  it('renders all three emergency options when open', () => {
    renderSheet()
    expect(screen.getByTestId('emergency-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('emergency-call-911')).toBeInTheDocument()
    expect(screen.getByTestId('emergency-share-location')).toBeInTheDocument()
    expect(screen.getByTestId('emergency-report')).toBeInTheDocument()
  })

  it('Call 911 link has correct tel: href', () => {
    renderSheet()
    const link = screen.getByTestId('emergency-call-911')
    expect(link).toHaveAttribute('href', 'tel:911')
  })

  it('Report button opens inline category picker', async () => {
    renderSheet({ rideId: 'ride-123' })
    const btn = screen.getByTestId('emergency-report')
    expect(btn.tagName).toBe('BUTTON')
    fireEvent.click(btn)
    expect(screen.getByTestId('report-category-step')).toBeInTheDocument()
  })

  it('backdrop click does NOT dismiss the sheet', () => {
    const { onClose } = renderSheet()
    const backdrop = screen.getByTestId('emergency-backdrop')
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    const closeBtn = screen.getByTestId('emergency-close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders in portal at top of DOM (not inline)', () => {
    renderSheet()
    const sheet = screen.getByTestId('emergency-sheet')
    // Should be inside portal-root, not inside test container
    const portalRoot = document.getElementById('portal-root')
    expect(portalRoot?.contains(sheet)).toBe(true)
  })

  it('share location button calls API and shows link', async () => {
    const mockToken = 'abc123def456'
    // URL-routed mock so the mount-time GET /trusted-contacts (added
    // in Sprint 4 W-T1-E1) doesn't consume the one-shot share-location
    // response that the test is asserting on.
    globalThis.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/share-location') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: mockToken }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ contacts: [] }),
      }) as unknown as Promise<Response>
    })

    // Mock clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderSheet()

    const shareBtn = screen.getByTestId('emergency-share-location')
    fireEvent.click(shareBtn)

    await waitFor(() => {
      expect(screen.getByTestId('emergency-share-link')).toBeInTheDocument()
    })

    expect(screen.getByTestId('emergency-share-link')).toHaveTextContent(
      `/track/${mockToken}`,
    )

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/track/${mockToken}`))
  })

  it('shows error state on API failure', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/share-location') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: 'Server error' } }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ contacts: [] }),
      }) as unknown as Promise<Response>
    })

    renderSheet()

    fireEvent.click(screen.getByTestId('emergency-share-location'))

    await waitFor(() => {
      expect(screen.getByTestId('emergency-share-location')).toHaveTextContent('Failed')
    })
  })

  it('renders with custom data-testid', () => {
    renderSheet({ 'data-testid': 'custom-emergency' })
    expect(screen.getByTestId('custom-emergency')).toBeInTheDocument()
  })

  // ── Sprint 4 W-T1-E1 — trusted contacts + stop sharing ────────────────

  it('renders the Text trusted contacts row when /api/safety/trusted-contacts returns at least one row', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            contacts: [
              { id: 'c1', name: 'Mom', phone: '+15551112222' },
              { id: 'c2', name: 'Best friend', phone: '+15552223333' },
            ],
          }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })

    renderSheet()
    await waitFor(() => {
      expect(screen.getByTestId('emergency-text-trusted-contacts')).toBeInTheDocument()
    })
    expect(screen.getByTestId('emergency-text-trusted-contacts').textContent).toContain('2 trusted contacts')
  })

  it('does NOT render the Text trusted contacts row when the list is empty', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ contacts: [] }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })

    renderSheet()
    // Give the fetch a tick to resolve, then assert the row is absent.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/safety/trusted-contacts',
        expect.anything(),
      )
    })
    expect(screen.queryByTestId('emergency-text-trusted-contacts')).not.toBeInTheDocument()
  })

  it('renders the Stop sharing row only after a share link is created, and DELETEs the token on tap', async () => {
    let revokeCall: { url: string; method?: string } | null = null
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ contacts: [] }),
        }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ token: 'a'.repeat(64) }),
        }) as unknown as Promise<Response>
      }
      if (url.startsWith('/api/safety/share-location/') && opts?.method === 'DELETE') {
        revokeCall = { url, method: 'DELETE' }
        return Promise.resolve({
          ok: true,
          json: async () => ({ revoked: true }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })

    renderSheet()
    // No share link yet — row hidden.
    expect(screen.queryByTestId('emergency-stop-sharing')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => {
      expect(screen.getByTestId('emergency-stop-sharing')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('emergency-stop-sharing'))
    await waitFor(() => {
      expect(revokeCall).not.toBeNull()
    })
    expect(revokeCall!.url).toBe(`/api/safety/share-location/${'a'.repeat(64)}`)
    // After revoke, the link disappears + Stop row disappears
    await waitFor(() => {
      expect(screen.queryByTestId('emergency-stop-sharing')).not.toBeInTheDocument()
    })
  })

  // ── Sprint 11 Slice 3 — role-aware report categories + Done + footer ──

  it('rider sees the 5 RIDER safety report categories', () => {
    mockRideRole.current = 'rider'
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-report'))
    expect(screen.getByTestId('report-category-unsafe_driving')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-inappropriate_behavior')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-wrong_route')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-no_show')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-other')).toBeInTheDocument()
    // Driver categories must NOT appear in the rider list.
    expect(screen.queryByTestId('report-category-rider_aggression')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-rider_damage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-rider_threat')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-rider_no_show')).not.toBeInTheDocument()
  })

  it('driver sees the 5 DRIVER safety report categories', () => {
    mockRideRole.current = 'driver'
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-report'))
    expect(screen.getByTestId('report-category-rider_aggression')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-rider_damage')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-rider_threat')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-rider_no_show')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-other')).toBeInTheDocument()
    // Rider categories must NOT appear in the driver list.
    expect(screen.queryByTestId('report-category-unsafe_driving')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-inappropriate_behavior')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-wrong_route')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-no_show')).not.toBeInTheDocument()
  })

  it('description step renders the verbatim iOS detailsFooter under the textarea', () => {
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-report'))
    fireEvent.click(screen.getByTestId('report-category-unsafe_driving'))
    const footer = screen.getByTestId('report-description-footer')
    expect(footer.textContent).toContain("Tago's safety team reviews every report.")
    expect(footer.textContent).toContain('driver behaviour, location, time, anything that helps.')
  })

  it('submission posts the selected category rawValue to /api/report', async () => {
    let postBody: { category?: string; description?: string; ride_id?: string } | null = null
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/report' && opts?.method === 'POST') {
        postBody = JSON.parse(opts.body as string) as typeof postBody
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: 'r-1' }) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })

    mockRideRole.current = 'driver'
    renderSheet({ rideId: 'ride-xyz' })
    fireEvent.click(screen.getByTestId('emergency-report'))
    fireEvent.click(screen.getByTestId('report-category-rider_aggression'))
    fireEvent.change(screen.getByTestId('report-description-input'), {
      target: { value: 'rider was screaming at me for 5 minutes' },
    })
    fireEvent.click(screen.getByTestId('report-submit-button'))
    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody!.category).toBe('rider_aggression')
    expect(postBody!.ride_id).toBe('ride-xyz')
  })

  // ── Sprint 11 Slice 6 — sections + footer + copy + share-via + sms-fallback ──

  it('renders the three semantic section headers (Emergency Services / Share Location / Report)', () => {
    renderSheet()
    expect(screen.getByTestId('emergency-section-emergency-services').textContent).toContain('Emergency Services')
    expect(screen.getByTestId('emergency-section-share-location').textContent).toContain('Share Location')
    expect(screen.getByTestId('emergency-section-report').textContent).toContain('Report')
  })

  it('Share Location footer shows the "idle" copy by default (explains 4-hour TTL)', () => {
    renderSheet()
    const footer = screen.getByTestId('emergency-share-footer')
    expect(footer.getAttribute('data-share-state')).toBe('idle')
    expect(footer.textContent).toContain('valid 4 hours')
    expect(footer.textContent).toContain('Tago never shares your location otherwise')
  })

  it('Share Location footer flips to "shared" copy once a link is live', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({ ok: true, json: async () => ({ contacts: [] }) }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'tok-12345678' }) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => {
      const footer = screen.getByTestId('emergency-share-footer')
      expect(footer.getAttribute('data-share-state')).toBe('shared')
    })
    expect(screen.getByTestId('emergency-share-footer').textContent).toContain('the next 4 hours')
    expect(screen.getByTestId('emergency-share-footer').textContent).toContain('Stop sharing')
  })

  it('share link row exposes a dedicated Copy button that fires a "Link copied" toast', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    })
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({ ok: true, json: async () => ({ contacts: [] }) }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'tok-xyz' }) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => screen.getByTestId('emergency-share-link-copy'))
    fireEvent.click(screen.getByTestId('emergency-share-link-copy'))
    await waitFor(() => expect(writeTextSpy).toHaveBeenCalled())
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('/track/tok-xyz'))
    await waitFor(() => {
      const toast = screen.queryByTestId('emergency-toast')
      expect(toast?.textContent).toBe('Link copied')
    })
  })

  it('mint failure surfaces a "Couldn’t create the link" toast', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({ ok: true, json: async () => ({ contacts: [] }) }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => {
      const toast = screen.queryByTestId('emergency-toast')
      expect(toast?.textContent).toContain('Couldn’t create the link')
    })
  })

  it('revoke failure surfaces "Couldn’t reach server — link still active" toast', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({ ok: true, json: async () => ({ contacts: [] }) }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'a'.repeat(32) }) }) as unknown as Promise<Response>
      }
      if (url.startsWith('/api/safety/share-location/') && opts?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => screen.getByTestId('emergency-stop-sharing'))
    fireEvent.click(screen.getByTestId('emergency-stop-sharing'))
    await waitFor(() => {
      const toast = screen.queryByTestId('emergency-toast')
      expect(toast?.textContent).toContain('Couldn’t reach server')
    })
  })

  it('successful revoke flips the footer to "revoked" + flashes "Tracking link turned off" toast', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({ ok: true, json: async () => ({ contacts: [] }) }) as unknown as Promise<Response>
      }
      if (url === '/api/safety/share-location' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'b'.repeat(32) }) }) as unknown as Promise<Response>
      }
      if (url.startsWith('/api/safety/share-location/') && opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ revoked: true }) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-share-location'))
    await waitFor(() => screen.getByTestId('emergency-stop-sharing'))
    fireEvent.click(screen.getByTestId('emergency-stop-sharing'))
    await waitFor(() => {
      expect(screen.getByTestId('emergency-share-footer').getAttribute('data-share-state')).toBe('revoked')
    })
    expect(screen.queryByTestId('emergency-toast')?.textContent).toBe('Tracking link turned off')
  })

  it('Text trusted contacts on DESKTOP opens the desktop sms-fallback dialog (no sms: navigation)', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
    globalThis.fetch = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/safety/trusted-contacts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ contacts: [{ id: 'c-1', name: 'Mom', phone: '+15551112222' }] }),
        }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })
    renderSheet()
    await waitFor(() => screen.getByTestId('emergency-text-trusted-contacts'))
    fireEvent.click(screen.getByTestId('emergency-text-trusted-contacts'))
    expect(screen.getByTestId('emergency-sms-desktop-fallback')).toBeInTheDocument()
    expect(screen.getByText(/Can’t send SMS from this device/)).toBeInTheDocument()
  })

  it('Done button on submitted state resets the wizard back to idle', async () => {
    globalThis.fetch = vi.fn((input: URL | RequestInfo, opts?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/report' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: 'r-1' }) }) as unknown as Promise<Response>
      }
      return Promise.resolve({ ok: true, json: async () => ({}) }) as unknown as Promise<Response>
    })

    renderSheet()
    fireEvent.click(screen.getByTestId('emergency-report'))
    fireEvent.click(screen.getByTestId('report-category-unsafe_driving'))
    fireEvent.change(screen.getByTestId('report-description-input'), {
      target: { value: 'driver was swerving across lanes' },
    })
    fireEvent.click(screen.getByTestId('report-submit-button'))
    await waitFor(() => expect(screen.getByTestId('report-submitted')).toBeInTheDocument())
    expect(screen.getByTestId('report-done-button')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('report-done-button'))
    // After Done: wizard reset to idle — the Report idle button is
    // visible again, the submitted card is gone.
    expect(screen.queryByTestId('report-submitted')).not.toBeInTheDocument()
    expect(screen.getByTestId('emergency-report')).toBeInTheDocument()
  })
})
