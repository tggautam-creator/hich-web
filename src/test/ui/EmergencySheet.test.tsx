/**
 * EmergencySheet tests
 *
 * Verifies:
 *  1. Does not render when closed
 *  2. Renders all three options when open
 *  3. Call 911 link has correct tel: href
 *  4. Share location button calls API and shows link
 *  5. Report link navigates to /report/:rideId
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

  it('Report link points to /report/:rideId', () => {
    renderSheet({ rideId: 'ride-123' })
    const link = screen.getByTestId('emergency-report')
    expect(link).toHaveAttribute('href', '/report/ride-123')
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: mockToken }),
    } as Response)

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
      `https://hich.app/track/${mockToken}`,
    )

    expect(writeText).toHaveBeenCalledWith(`https://hich.app/track/${mockToken}`)
  })

  it('shows error state on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Server error' } }),
    } as Response)

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
})
