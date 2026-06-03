import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useRideRole } from '@/hooks/useRideRole'
import {
  availableFor as availableSafetyCategoriesFor,
  SAFETY_REPORT_DETAILS_FOOTER,
  type SafetyReportCategoryValue,
} from '@/lib/safetyReportCategories'

interface EmergencySheetProps {
  isOpen: boolean
  onClose: () => void
  rideId: string
  'data-testid'?: string
}

interface TrustedContact {
  id: string
  name: string
  phone: string
}

/**
 * Extract the share token out of an absolute track URL so we can DELETE
 * `/api/safety/share-location/:token` to revoke. The route mints the
 * URL as `<origin>/track/<token>`; we split off the last segment.
 */
function tokenFromShareLink(link: string): string | null {
  try {
    const u = new URL(link)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? null
  } catch {
    return null
  }
}

// v1.3 Sprint 11 Slice 3 — category list now derived per-ride from
// `useRideRole`. Rider sees driver-facing categories ("Unsafe
// driving" …), driver sees rider-facing categories ("Rider was
// aggressive" …). Server's LEGACY_CATEGORY_MAP at
// server/routes/report.ts:73-93 accepts all 9 rawValues.
type ReportStep = 'idle' | 'category' | 'description' | 'submitting' | 'submitted' | 'error'

/**
 * Emergency action sheet — renders in a React portal at the top of the DOM tree.
 * Always available on active ride screens. Backdrop click does NOT dismiss.
 * Only an explicit close button dismisses the sheet.
 */
export default function EmergencySheet({
  isOpen,
  onClose,
  rideId,
  'data-testid': testId = 'emergency-sheet',
}: EmergencySheetProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'shared' | 'error'>('idle')
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokingShare, setRevokingShare] = useState(false)

  // Report flow
  const [reportStep, setReportStep] = useState<ReportStep>('idle')
  const [reportCategory, setReportCategory] = useState<SafetyReportCategoryValue | null>(null)
  const [reportDescription, setReportDescription] = useState('')

  // v1.3 Sprint 11 Slice 3 — derive viewer role from the ride row
  // (per the role-per-ride memory rule). Picks which 5 categories
  // surface in the wizard. Falls back to the rider list when the
  // role is still loading or unknown — matches the deployed
  // pre-split behaviour so the wizard doesn't blank-state.
  const { role: rideRole } = useRideRole(rideId)
  const reportCategories = useMemo(
    () => availableSafetyCategoriesFor(rideRole),
    [rideRole],
  )
  const reportCategoryLabel = useMemo(
    () => reportCategories.find((c) => c.value === reportCategory)?.label ?? '',
    [reportCategories, reportCategory],
  )

  // W-T1-E1 — Trusted contacts. Loaded lazily on sheet open from
  // GET /api/safety/trusted-contacts. The list is small (cap 5) so
  // we don't paginate.
  const [trustedContacts, setTrustedContacts] = useState<TrustedContact[]>([])
  const [trustedContactsLoaded, setTrustedContactsLoaded] = useState(false)

  useEffect(() => {
    if (!isOpen || trustedContactsLoaded) return
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const resp = await fetch('/api/safety/trusted-contacts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) return
        const body = (await resp.json()) as { contacts?: TrustedContact[] }
        if (cancelled) return
        setTrustedContacts(body.contacts ?? [])
        setTrustedContactsLoaded(true)
      } catch {
        // silent — no contacts row just hides the affordance
        setTrustedContactsLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, trustedContactsLoaded])

  /**
   * Open the device SMS composer pre-filled with every trusted
   * contact + the share-location link (when one was created in this
   * session). Mirrors iOS `MFMessageComposeViewController` pre-fill.
   * The `sms:` URL is built per the iOS-compatible spec
   * (comma-separated recipients, `?&body=` parameter).
   */
  function textTrustedContacts() {
    if (trustedContacts.length === 0) return
    const recipients = trustedContacts.map((c) => c.phone).join(',')
    const trackBody = shareLink
      ? `I'm on a Tago ride and wanted you to know. Follow my live location: ${shareLink}`
      : `I'm on a Tago ride and wanted you to know. If something's wrong, please check on me.`
    const encoded = encodeURIComponent(trackBody)
    // iOS Safari + Android Chrome accept `sms:<recipients>?body=...`.
    // Some carriers prefer `&body=`; iOS quirk: include `?&body=`.
    const href = `sms:${recipients}?&body=${encoded}`
    window.location.href = href
  }

  /**
   * Revoke the active share link (E1). Calls
   * DELETE /api/safety/share-location/:token so the recipient sees
   * the share expire immediately instead of waiting for the 4-hour
   * TTL. Mirrors iOS "Stop sharing" affordance.
   */
  async function stopSharingLocation() {
    if (!shareLink || revokingShare) return
    const token = tokenFromShareLink(shareLink)
    if (!token) return
    setRevokingShare(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch(`/api/safety/share-location/${token}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        setShareStatus('idle')
        setShareLink(null)
        setCopied(false)
      }
    } catch {
      // best-effort — fail silently; the 4-hour TTL is the backstop
    } finally {
      setRevokingShare(false)
    }
  }

  function resetReport() {
    setReportStep('idle')
    setReportCategory(null)
    setReportDescription('')
  }

  async function handleSubmitReport() {
    if (!reportCategory || reportDescription.trim().length < 10) return
    setReportStep('submitting')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setReportStep('error'); return }

      const res = await fetch('/api/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ category: reportCategory, description: reportDescription.trim(), ride_id: rideId }),
      })

      if (!res.ok) { setReportStep('error'); return }
      setReportStep('submitted')
    } catch {
      setReportStep('error')
    }
  }

  const handleShareLocation = async () => {
    setShareStatus('sharing')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setShareStatus('error')
        return
      }

      const res = await fetch('/api/safety/share-location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })

      if (!res.ok) {
        setShareStatus('error')
        return
      }

      const body = (await res.json()) as { token: string }
      const link = `${window.location.origin}/track/${body.token}`
      setShareLink(link)
      setShareStatus('shared')

      // Try native share sheet first (mobile), fall back to clipboard copy
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Track my TAGO ride',
            text: 'Follow my live location during this ride (link valid for 4 hours)',
            url: link,
          })
        } catch {
          // User dismissed share sheet — still copy to clipboard as fallback
          try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 3000) } catch { /* ignore */ }
        }
      } else {
        try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 3000) } catch { /* ignore */ }
      }
    } catch {
      setShareStatus('error')
    }
  }

  if (!isOpen) return null

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root')) ||
    (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Emergency options"
      data-testid={testId}
    >
      {/* Backdrop — does NOT dismiss on click */}
      <div
        className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        data-testid="emergency-backdrop"
      />

      {/* Sheet */}
      <div
        className="fixed inset-x-0 top-0 z-[2100] mx-auto max-w-lg px-4 pt-[env(safe-area-inset-top,16px)]"
        data-testid="emergency-content"
      >
        <div className="mt-4 rounded-2xl border border-danger bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-bold text-danger">Emergency</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close emergency sheet"
              data-testid="emergency-close"
              className="rounded-lg p-1.5 text-text-secondary hover:bg-surface"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Options */}
          <div className="flex flex-col gap-3 p-5">
            {/* Call 911 */}
            <a
              href="tel:911"
              data-testid="emergency-call-911"
              className="flex items-center gap-4 rounded-2xl bg-danger px-5 py-4 text-white active:opacity-80 transition-opacity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 01.97-.27c1.08.36 2.24.55 3.42.55a1 1 0 011 1V20a1 1 0 01-1 1C10.07 21 3 13.93 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.18.19 2.34.55 3.42a1 1 0 01-.27.97l-2.16 2.4z" />
              </svg>
              <div>
                <span className="text-base font-bold">Call 911</span>
                <p className="text-sm text-white/80">Connect to emergency services</p>
              </div>
            </a>

            {/* Share my location */}
            <button
              type="button"
              onClick={() => void handleShareLocation()}
              disabled={shareStatus === 'sharing'}
              data-testid="emergency-share-location"
              className="flex items-center gap-4 rounded-2xl bg-warning px-5 py-4 text-white active:opacity-80 transition-opacity disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
              </svg>
              <div className="text-left">
                <span className="text-base font-bold">
                  {shareStatus === 'sharing' && 'Sharing...'}
                  {shareStatus === 'shared' && (copied ? 'Link copied!' : 'Link ready')}
                  {shareStatus === 'error' && 'Failed — try again'}
                  {shareStatus === 'idle' && 'Share my location'}
                </span>
                <p className="text-sm text-white/80">
                  {shareStatus === 'shared'
                    ? 'Send this link to someone you trust'
                    : 'Creates a temporary tracking link (4 hrs)'}
                </p>
              </div>
            </button>

            {shareLink && (
              <div
                data-testid="emergency-share-link"
                className="rounded-lg bg-surface px-4 py-2 text-xs text-text-secondary break-all"
              >
                {shareLink}
              </div>
            )}

            {/* W-T1-E1 — Stop sharing — only visible while a share
                link is live. Revokes the token immediately so the
                recipient's tracker flips to expired. */}
            {shareLink && (
              <button
                type="button"
                onClick={() => { void stopSharingLocation() }}
                disabled={revokingShare}
                data-testid="emergency-stop-sharing"
                className="flex items-center gap-4 rounded-2xl border-2 border-warning bg-warning/10 px-5 py-3 text-warning active:bg-warning/15 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm5 11H7v-2h10v2z" />
                </svg>
                <div className="text-left">
                  <span className="text-sm font-bold">
                    {revokingShare ? 'Stopping…' : 'Stop sharing location'}
                  </span>
                  <p className="text-xs text-warning/80">
                    Revoke the link now — recipients lose access immediately
                  </p>
                </div>
              </button>
            )}

            {/* W-T1-E1 — Text trusted contacts — opens the device SMS
                composer pre-filled with every saved trusted contact +
                the share-location link (when one was created in this
                session). Only rendered when the rider has at least
                one trusted contact on file. */}
            {trustedContacts.length > 0 && (
              <button
                type="button"
                onClick={textTrustedContacts}
                data-testid="emergency-text-trusted-contacts"
                className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-primary/10 px-5 py-3 text-primary active:bg-primary/15"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zM7 9h10v2H7zm0 4h7v2H7z" />
                </svg>
                <div className="text-left">
                  <span className="text-sm font-bold">
                    Text {trustedContacts.length === 1 ? 'my trusted contact' : `my ${trustedContacts.length} trusted contacts`}
                  </span>
                  <p className="text-xs text-primary/80">
                    Opens your messages app with {shareLink ? 'your live track link' : 'a check-in message'} pre-filled
                  </p>
                </div>
              </button>
            )}

            {/* Report unsafe situation — inline form, never navigates away */}
            {reportStep === 'idle' && (
              <button
                type="button"
                onClick={() => setReportStep('category')}
                data-testid="emergency-report"
                className="flex items-center gap-4 rounded-2xl bg-text-primary px-5 py-4 text-white active:opacity-80 transition-opacity w-full text-left"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                </svg>
                <div>
                  <span className="text-base font-bold">Report unsafe situation</span>
                  <p className="text-sm text-white/80">File a safety report for this ride</p>
                </div>
              </button>
            )}

            {reportStep === 'category' && (
              <div data-testid="report-category-step" className="rounded-2xl border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-text-primary">What happened?</p>
                  <button type="button" onClick={resetReport} className="text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
                <div className="space-y-2">
                  {reportCategories.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      data-testid={`report-category-${cat.value}`}
                      onClick={() => { setReportCategory(cat.value); setReportStep('description') }}
                      className="flex w-full items-center justify-between rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary active:bg-surface"
                    >
                      {cat.label}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-text-secondary" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {reportStep === 'description' && (
              <div data-testid="report-description-step" className="rounded-2xl border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setReportStep('category')} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Back
                  </button>
                  <p className="text-xs text-text-secondary font-medium">{reportCategoryLabel}</p>
                </div>
                <textarea
                  data-testid="report-description-input"
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder="Describe what happened (min. 10 characters)…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
                />
                {/* v1.3 Sprint 11 Slice 3 — verbatim iOS `detailsFooter`
                    so the user knows what kind of detail helps the
                    safety team triage faster. */}
                <p data-testid="report-description-footer" className="text-xs text-text-secondary">
                  {SAFETY_REPORT_DETAILS_FOOTER}
                </p>
                <button
                  type="button"
                  data-testid="report-submit-button"
                  onClick={() => void handleSubmitReport()}
                  disabled={reportDescription.trim().length < 10}
                  className="w-full rounded-xl bg-danger px-4 py-3 text-sm font-bold text-white disabled:opacity-40 active:opacity-80"
                >
                  Submit Report
                </button>
              </div>
            )}

            {reportStep === 'submitting' && (
              <div data-testid="report-submitting" className="rounded-2xl border border-border bg-surface p-4 text-center text-sm text-text-secondary">
                Submitting report…
              </div>
            )}

            {reportStep === 'submitted' && (
              <div data-testid="report-submitted" className="rounded-2xl border border-success/30 bg-success/5 p-4 text-center space-y-3">
                <p className="font-semibold text-success text-sm">Report submitted</p>
                <p className="text-xs text-text-secondary">Our safety team will review this ride. Thank you for reporting.</p>
                {/* v1.3 Sprint 11 Slice 3 — explicit Done button mirrors
                    iOS `ReportSafetyView.submittedSection`. Resets the
                    wizard so re-opening the sheet starts at idle
                    instead of "Report submitted." */}
                <button
                  type="button"
                  data-testid="report-done-button"
                  onClick={resetReport}
                  className="w-full rounded-xl border border-success/40 px-4 py-2 text-sm font-semibold text-success active:bg-success/10"
                >
                  Done
                </button>
              </div>
            )}

            {reportStep === 'error' && (
              <div data-testid="report-error" className="rounded-2xl border border-danger/30 bg-danger/5 p-4 space-y-2">
                <p className="text-sm font-semibold text-danger text-center">Failed to submit</p>
                <button
                  type="button"
                  onClick={() => setReportStep('description')}
                  className="w-full rounded-xl border border-danger/30 px-4 py-2 text-sm font-medium text-danger"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  )
}
