/**
 * v1.3 Sprint 11 Slice 1 — always-visible top-bar safety pill +
 * collocated EmergencySheet mount.
 *
 * Closes a CLAUDE.md hard-rule violation: "Emergency button — always
 * in a React portal at the top of the DOM tree. Never inside
 * conditional renders. Never inside a menu." Previously both the pill
 * trigger AND the `EmergencySheet` mount lived inside the
 * post-scanning-early-return branch on `RiderActiveRidePage` /
 * `RiderPickupPage`, so the moment a rider opened the QR scanner the
 * whole emergency surface vanished from the DOM tree. The CTO-asked
 * audit (2026-06-02) flagged this as BLOCKER.
 *
 * Mirrors iOS `safetyPill` on RiderActiveRidePage.swift:475-490 +
 * DriverActiveRidePage.swift:446-461 + DriverPickupPage.swift:919-941:
 * same 36x36 disc, glass background, `exclamationmark.shield.fill`
 * icon (web uses a hand-inlined SVG with matching geometry — Lucide
 * doesn't ship the exact Apple symbol), danger token foreground, same
 * `aria-label="Emergency"` accessibility shape.
 *
 * Both the pill button AND the `EmergencySheet` portal into
 * `document.getElementById('portal-root')` (with a `document.body`
 * fallback) so they're siblings of the app root rather than
 * descendants of any per-page branch. z-index 1900 sits below
 * `EmergencySheet`'s own backdrop (z-2000) but above every screen
 * shell, including the QR scanner's full-bleed black overlay.
 *
 * Mount this component on every active-ride / pickup page,
 * UNCONDITIONALLY (i.e. above any `if (scanning) return …` early
 * return). External `isOpen`/`onOpenChange` props keep the existing
 * `JourneyDrawer` SOS button working as a redundant trigger — both
 * routes flip the same state so the pre-existing UX path doesn't
 * change.
 */
import { createPortal } from 'react-dom'
import EmergencySheet from '@/components/ui/EmergencySheet'

interface SafetyPillProps {
  rideId: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Per-surface identifier — mirrors iOS `accessibilityIdentifier`. */
  'data-testid'?: string
}

export default function SafetyPill({ rideId, isOpen, onOpenChange, 'data-testid': testId }: SafetyPillProps) {
  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root'))
    || (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) {
    // Server-render / no-DOM environment — also render the sheet so
    // its server-side return-null behaviour keeps working for tests.
    return <EmergencySheet isOpen={isOpen} onClose={() => onOpenChange(false)} rideId={rideId} />
  }

  return (
    <>
      {createPortal(
        <button
          type="button"
          data-testid={testId ?? 'safety-pill'}
          onClick={() => onOpenChange(true)}
          aria-label="Emergency"
          className="fixed z-[1900] flex h-9 w-9 items-center justify-center rounded-full border border-white/40 bg-white/90 text-danger shadow-md backdrop-blur-sm transition-transform active:scale-95"
          style={{
            // iOS places the pill in the top bar — mirror with
            // `safe-area-inset-top` so notched devices clear the
            // status bar. Right-aligned with a small inset to match
            // iOS HStack ordering (safety/chat/timer rightmost).
            top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
            right: '0.75rem',
          }}
        >
          {/* SF Symbol "exclamationmark.shield.fill" equivalent —
              solid shield with a vertical exclamation. Geometry
              approximates Apple's 14pt bold symbol; keep bold strokes
              so the pill reads as urgent on a glass background. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M12 2.25 4 5.25v6.75c0 4.71 3.4 9.13 8 9.75 4.6-.62 8-5.04 8-9.75V5.25l-8-3Zm-1 5.25h2v6h-2v-6Zm0 7.5h2v2h-2v-2Z" />
          </svg>
        </button>,
        portalTarget,
      )}
      <EmergencySheet
        isOpen={isOpen}
        onClose={() => onOpenChange(false)}
        rideId={rideId}
      />
    </>
  )
}
