import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

interface EmergencySheetProps {
  isOpen: boolean
  onClose: () => void
  rideId: string
  'data-testid'?: string
}

const REPORT_CATEGORIES = [
  { value: 'unsafe_driving', label: 'Unsafe driving' },
  { value: 'inappropriate_behavior', label: 'Inappropriate behavior' },
  { value: 'wrong_route', label: 'Wrong route / detour' },
  { value: 'no_show', label: 'No show / abandonment' },
  { value: 'other', label: 'Other safety concern' },
] as const

type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value']
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

  // Report flow
  const [reportStep, setReportStep] = useState<ReportStep>('idle')
  const [reportCategory, setReportCategory] = useState<ReportCategory | null>(null)
  const [reportDescription, setReportDescription] = useState('')

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
      const link = `https://tagorides.com/track/${body.token}`
      setShareLink(link)
      setShareStatus('shared')

      // Copy to clipboard automatically
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
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
                  {REPORT_CATEGORIES.map((cat) => (
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
                  <p className="text-xs text-text-secondary font-medium">{REPORT_CATEGORIES.find(c => c.value === reportCategory)?.label}</p>
                </div>
                <textarea
                  data-testid="report-description-input"
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder="Describe what happened (min. 10 characters)…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
                />
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
              <div data-testid="report-submitted" className="rounded-2xl border border-success/30 bg-success/5 p-4 text-center space-y-1">
                <p className="font-semibold text-success text-sm">Report submitted</p>
                <p className="text-xs text-text-secondary">Our safety team will review this ride. Thank you for reporting.</p>
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
