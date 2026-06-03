/**
 * v1.3 Sprint 11 Slice 1 — SafetyPill regression tests.
 *
 * Pins the CLAUDE.md hard rule: "Emergency button — always in a React
 * portal at the top of the DOM tree. Never inside conditional renders."
 *
 * Covers:
 *  - Pill portal-mounts (renders as a sibling of #portal-root, not
 *    nested inside a per-page wrapper).
 *  - Click fires `onOpenChange(true)` to trigger the EmergencySheet.
 *  - The collocated EmergencySheet mounts when `isOpen` is true and
 *    stays unmounted when false.
 *  - The pill survives a conditional-render flip on the parent — this
 *    is the actual fix for the QR-scanning bug where the previous
 *    `<EmergencySheet>` mount lived inside the post-scanning-early-
 *    return branch and disappeared the moment the rider opened the
 *    scanner.
 *  - Accessibility shape mirrors iOS (`aria-label="Emergency"`).
 *  - Per-surface `data-testid` overrides work.
 *  - Renders gracefully without a `#portal-root` element (falls back
 *    to document.body via createPortal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import SafetyPill from '@/components/ui/SafetyPill'

// ── Mock supabase (consumed by EmergencySheet, which SafetyPill renders) ──

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

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function ensurePortalRoot() {
  if (!document.getElementById('portal-root')) {
    const el = document.createElement('div')
    el.id = 'portal-root'
    document.body.appendChild(el)
  }
}

/** Stateful host so click → onOpenChange → re-render works the way it
 *  does in production. */
function Host({ testId, initialOpen = false }: { testId?: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <SafetyPill
      rideId="ride-pill-001"
      isOpen={open}
      onOpenChange={setOpen}
      data-testid={testId}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ensurePortalRoot()
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SafetyPill', () => {
  it('renders a portal-mounted pill button with the default test id when none provided', () => {
    render(<Host />)
    const pill = screen.getByTestId('safety-pill')
    expect(pill).toBeInTheDocument()
    // Mounted into #portal-root (NOT a child of the test render root)
    const portalRoot = document.getElementById('portal-root')!
    expect(portalRoot.contains(pill)).toBe(true)
  })

  it('honours a per-surface data-testid override (mirrors iOS accessibilityIdentifier)', () => {
    render(<Host testId="safety-pill-rider-pickup" />)
    expect(screen.getByTestId('safety-pill-rider-pickup')).toBeInTheDocument()
  })

  it('exposes the iOS-mirrored accessibility shape', () => {
    render(<Host />)
    const pill = screen.getByTestId('safety-pill')
    expect(pill.tagName).toBe('BUTTON')
    expect(pill).toHaveAttribute('aria-label', 'Emergency')
  })

  it('keeps the EmergencySheet unmounted when isOpen is false', () => {
    render(<Host initialOpen={false} />)
    expect(screen.queryByTestId('emergency-sheet')).not.toBeInTheDocument()
  })

  it('mounts the EmergencySheet when isOpen is true', () => {
    render(<Host initialOpen={true} />)
    expect(screen.getByTestId('emergency-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('emergency-call-911')).toBeInTheDocument()
  })

  it('opens the EmergencySheet on pill click (round-trip through onOpenChange)', () => {
    render(<Host initialOpen={false} />)
    expect(screen.queryByTestId('emergency-sheet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('safety-pill'))
    expect(screen.getByTestId('emergency-sheet')).toBeInTheDocument()
  })

  it('SURVIVES a parent conditional-render flip — closes the QR-scanning regression', () => {
    // Simulates the bug from the 2026-06-02 audit: previously, the
    // EmergencySheet mount lived inside the post-scanning-early-return
    // branch of RiderPickupPage, so flipping `scanning=true` removed
    // the entire emergency surface from the DOM. SafetyPill must
    // survive that exact flip because the pill is portal-mounted from
    // a stable component above the conditional.
    function Parent() {
      const [scanning, setScanning] = useState(false)
      const [emergencyOpen, setEmergencyOpen] = useState(false)
      // Mirror production: declare the pill JSX above the early
      // return so both branches render it.
      const pill = (
        <SafetyPill
          rideId="ride-pill-001"
          isOpen={emergencyOpen}
          onOpenChange={setEmergencyOpen}
          data-testid="safety-pill-test"
        />
      )
      if (scanning) {
        return (
          <>
            {pill}
            <div data-testid="scanner">SCANNING</div>
            <button data-testid="exit-scan" onClick={() => setScanning(false)}>exit</button>
          </>
        )
      }
      return (
        <>
          {pill}
          <button data-testid="enter-scan" onClick={() => setScanning(true)}>scan</button>
        </>
      )
    }

    render(<Parent />)
    expect(screen.getByTestId('safety-pill-test')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('enter-scan'))
    // Scanner branch is now active — pill MUST still be reachable.
    expect(screen.getByTestId('scanner')).toBeInTheDocument()
    expect(screen.getByTestId('safety-pill-test')).toBeInTheDocument()
    // And clicking it during scan mode opens the sheet.
    fireEvent.click(screen.getByTestId('safety-pill-test'))
    expect(screen.getByTestId('emergency-sheet')).toBeInTheDocument()
  })

  it('renders without a #portal-root (falls back to document.body)', () => {
    // Tear down the portal root for this test specifically.
    document.getElementById('portal-root')?.remove()
    render(<Host />)
    expect(screen.getByTestId('safety-pill')).toBeInTheDocument()
  })
})
