import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from '@/components/ui/BottomSheet'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { trackEvent } from '@/lib/analytics'
import { useCreateReport, type ReportSeverity } from '@/hooks/useReports'
import {
  categoriesFor,
  findCategory,
  type CategorySpec,
  type ReportCategory,
  type ReportContext,
} from './categoryConfig'

/**
 * 2026-05-20 — shared bottom-sheet for the in-app reporting flow.
 *
 * Same component drives every entry point (Active ride / Ride
 * summary / Wallet row / Messaging / Settings) — caller passes
 * `context` to control which categories show, plus optional
 * `rideId`, `subjectUserId`, `prefillCategory` so the sheet can
 * open straight to the form when the context is unambiguous (e.g.
 * tapping "Issue with this charge?" pre-selects `fare_dispute`).
 *
 * Flow:
 *   1. category   — pick what kind of report (skipped if prefilled)
 *   2. form       — title (optional), body (required, ≥10), refund
 *                   amount (when category.promptsRefund), GPS opt-in
 *   3. review     — summary + Submit
 *   4. submitted  — success state + link to "My Reports"
 *
 * Severity is server-decided based on category; the UI shows a
 * coloured pill so the user knows the urgency.
 */

interface ReportFlowSheetProps {
  isOpen: boolean
  onClose: () => void
  context: ReportContext
  rideId?: string | null
  subjectUserId?: string | null
  scheduleId?: string | null
  /** Pre-select a category and skip step 1. Useful for context-specific entries. */
  prefillCategory?: ReportCategory
  'data-testid'?: string
}

type Step = 'category' | 'form' | 'review' | 'submitted'

const APP_VERSION = '1.0.0' // matches Settings → About
const MIN_BODY_LEN = 10

export default function ReportFlowSheet({
  isOpen,
  onClose,
  context,
  rideId,
  subjectUserId,
  scheduleId,
  prefillCategory,
  'data-testid': testId = 'report-flow-sheet',
}: ReportFlowSheetProps) {
  const navigate = useNavigate()
  const create = useCreateReport()

  const categories = useMemo(() => categoriesFor(context), [context])
  const [category, setCategory] = useState<CategorySpec | null>(null)
  const [step, setStep] = useState<Step>('category')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [refundDollars, setRefundDollars] = useState('')
  const [shareGps, setShareGps] = useState(false)
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdSeverity, setCreatedSeverity] = useState<ReportSeverity | null>(null)

  // Open-side-effects: reset state every time the sheet opens. Also
  // jump straight to the form when a prefillCategory is supplied.
  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setBody('')
    setRefundDollars('')
    setShareGps(false)
    setGps(null)
    setError(null)
    setCreatedId(null)
    setCreatedSeverity(null)
    create.reset()
    if (prefillCategory) {
      const spec = findCategory(prefillCategory)
      if (spec) {
        setCategory(spec)
        setStep('form')
        trackEvent('report_opened', { context, prefilled: true, category: prefillCategory })
        return
      }
    }
    setCategory(null)
    setStep('category')
    trackEvent('report_opened', { context, prefilled: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefillCategory, context])

  function pickCategory(spec: CategorySpec) {
    setCategory(spec)
    setStep('form')
    trackEvent('report_category_selected', { context, category: spec.value })
  }

  function attemptGpsCapture() {
    if (!('geolocation' in navigator)) {
      setShareGps(false)
      return
    }
    setShareGps(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      // Silent failure — admin will still see report, just no GPS.
      () => setShareGps(false),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    )
  }

  const canSubmit = body.trim().length >= MIN_BODY_LEN
  const refundCents = (() => {
    if (!refundDollars.trim()) return null
    const n = Math.round(parseFloat(refundDollars) * 100)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  })()

  async function handleSubmit() {
    if (!category) return
    setError(null)
    try {
      const result = await create.mutateAsync({
        category: category.value,
        title: title.trim() || undefined,
        body: body.trim(),
        ride_id: rideId ?? null,
        subject_user_id: subjectUserId ?? null,
        schedule_id: scheduleId ?? null,
        requested_refund_cents: refundCents,
        metadata: {
          app_version: APP_VERSION,
          platform: 'web',
          ...(gps ? { gps_lat: gps.lat, gps_lng: gps.lng } : {}),
        },
      })
      setCreatedId(result.id)
      setCreatedSeverity(result.severity)
      setStep('submitted')
      trackEvent('report_submitted', {
        context,
        category: category.value,
        severity: result.severity,
        ride_id: rideId ?? null,
        with_gps: gps != null,
        with_refund_request: refundCents != null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setError(msg)
    }
  }

  function handleOpenMyReport() {
    if (!createdId) return
    onClose()
    navigate(`/reports/${createdId}`)
  }

  const sheetTitle = step === 'submitted'
    ? 'Report received'
    : (category?.label ?? 'Report a problem')

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={sheetTitle}
      data-testid={testId}
    >
      {step === 'category' && (
        <CategoryStep
          categories={categories}
          onPick={pickCategory}
        />
      )}

      {step === 'form' && category && (
        <FormStep
          category={category}
          title={title}
          setTitle={setTitle}
          body={body}
          setBody={setBody}
          refundDollars={refundDollars}
          setRefundDollars={setRefundDollars}
          shareGps={shareGps}
          attemptGpsCapture={attemptGpsCapture}
          canSubmit={canSubmit}
          minLen={MIN_BODY_LEN}
          onBack={() => {
            if (prefillCategory) {
              onClose()
            } else {
              setStep('category')
            }
          }}
          onContinue={() => setStep('review')}
        />
      )}

      {step === 'review' && category && (
        <ReviewStep
          category={category}
          title={title}
          body={body}
          refundCents={refundCents}
          hasGps={gps != null}
          rideId={rideId ?? null}
          submitting={create.isPending}
          error={error}
          onBack={() => setStep('form')}
          onSubmit={() => { void handleSubmit() }}
        />
      )}

      {step === 'submitted' && createdId && (
        <SubmittedStep
          severity={createdSeverity}
          onClose={onClose}
          onOpenReport={handleOpenMyReport}
        />
      )}
    </BottomSheet>
  )
}

// ── Step 1 — Category picker ────────────────────────────────────────

function CategoryStep({
  categories,
  onPick,
}: {
  categories: CategorySpec[]
  onPick: (spec: CategorySpec) => void
}) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No report categories available here. Try Settings → Report a problem.
      </p>
    )
  }
  return (
    <div data-testid="report-step-category" className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary mb-1">
        What kind of issue is this?
      </p>
      {categories.map((c) => (
        <button
          key={c.value}
          type="button"
          data-testid={`report-category-${c.value}`}
          onClick={() => onPick(c)}
          className={[
            'rounded-2xl border bg-white px-4 py-3 text-left transition-colors',
            c.value === 'safety_during_ride'
              ? 'border-danger/30 hover:border-danger hover:bg-danger/5'
              : 'border-border hover:border-primary hover:bg-primary/5',
          ].join(' ')}
        >
          <p
            className={[
              'text-sm font-semibold',
              c.value === 'safety_during_ride' ? 'text-danger' : 'text-text-primary',
            ].join(' ')}
          >
            {c.label}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">{c.description}</p>
        </button>
      ))}
    </div>
  )
}

// ── Step 2 — Form ───────────────────────────────────────────────────

function FormStep({
  category,
  title,
  setTitle,
  body,
  setBody,
  refundDollars,
  setRefundDollars,
  shareGps,
  attemptGpsCapture,
  canSubmit,
  minLen,
  onBack,
  onContinue,
}: {
  category: CategorySpec
  title: string
  setTitle: (s: string) => void
  body: string
  setBody: (s: string) => void
  refundDollars: string
  setRefundDollars: (s: string) => void
  shareGps: boolean
  attemptGpsCapture: () => void
  canSubmit: boolean
  minLen: number
  onBack: () => void
  onContinue: () => void
}) {
  const remaining = minLen - body.trim().length
  return (
    <div data-testid="report-step-form" className="flex flex-col gap-4">
      <div className="rounded-xl bg-surface p-3 text-xs text-text-secondary">
        {category.description}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          Summary <span className="text-text-secondary">(optional)</span>
        </span>
        <input
          data-testid="report-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Short headline (we'll generate one if you skip)"
          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          What happened?
        </span>
        <textarea
          data-testid="report-body-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="The more detail you can give us, the faster we can help."
          className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
        />
        <p
          className={[
            'mt-1 text-xs',
            remaining > 0 ? 'text-text-secondary' : 'text-success',
          ].join(' ')}
        >
          {remaining > 0
            ? `At least ${remaining} more character${remaining === 1 ? '' : 's'} needed`
            : 'Looks good'}
        </p>
      </label>

      {category.promptsRefund && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            How much should be refunded? <span className="text-text-secondary">(optional)</span>
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">$</span>
            <input
              data-testid="report-refund-input"
              type="text"
              inputMode="decimal"
              value={refundDollars}
              onChange={(e) => setRefundDollars(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-border bg-white py-2 pl-7 pr-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            We'll review and reach out if we need more details.
          </p>
        </label>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-border bg-white p-3">
        <input
          data-testid="report-share-gps"
          type="checkbox"
          checked={shareGps}
          onChange={(e) => {
            if (e.target.checked) attemptGpsCapture()
            else {
              // Uncheck instantly so the toggle is responsive.
              e.target.checked = false
            }
          }}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
        />
        <div className="text-xs text-text-secondary">
          <p className="font-medium text-text-primary">Share my current location</p>
          <p>Helps us understand exactly where the issue happened.</p>
        </div>
      </div>

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          data-testid="report-back-button"
          onClick={onBack}
          className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary"
        >
          Back
        </button>
        <PrimaryButton
          data-testid="report-continue-button"
          disabled={!canSubmit}
          onClick={onContinue}
          className="flex-1"
        >
          Continue
        </PrimaryButton>
      </div>
    </div>
  )
}

// ── Step 3 — Review ─────────────────────────────────────────────────

function ReviewStep({
  category,
  title,
  body,
  refundCents,
  hasGps,
  rideId,
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  category: CategorySpec
  title: string
  body: string
  refundCents: number | null
  hasGps: boolean
  rideId: string | null
  submitting: boolean
  error: string | null
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <div data-testid="report-step-review" className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        We'll send this to the Tago team. You can follow up in <strong>My Reports</strong>.
      </p>

      <div className="rounded-2xl border border-border bg-white">
        <ReviewRow label="Category" value={category.label} />
        {title.trim() && <ReviewRow label="Summary" value={title.trim()} />}
        <ReviewRow label="Details" value={body.trim()} multiline />
        {refundCents != null && (
          <ReviewRow label="Refund requested" value={`$${(refundCents / 100).toFixed(2)}`} />
        )}
        {rideId && <ReviewRow label="Attached ride" value={rideId.slice(0, 8) + '…'} mono />}
        <ReviewRow label="Share location" value={hasGps ? 'Yes' : 'No'} />
      </div>

      {error && (
        <p data-testid="report-error" className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          data-testid="report-back-button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          Back
        </button>
        <PrimaryButton
          data-testid="report-submit-button"
          isLoading={submitting}
          loadingLabel="Sending…"
          onClick={onSubmit}
          className="flex-1"
        >
          Submit
        </PrimaryButton>
      </div>
    </div>
  )
}

function ReviewRow({
  label,
  value,
  multiline,
  mono,
}: {
  label: string
  value: string
  multiline?: boolean
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="text-xs text-text-secondary">{label}</div>
      <div
        className={[
          'text-sm text-text-primary',
          multiline ? 'whitespace-pre-wrap break-words' : 'break-words',
          mono ? 'font-mono text-xs' : '',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}

// ── Step 4 — Submitted ──────────────────────────────────────────────

function SubmittedStep({
  severity,
  onClose,
  onOpenReport,
}: {
  severity: ReportSeverity | null
  onClose: () => void
  onOpenReport: () => void
}) {
  const isEmergency = severity === 'emergency'
  return (
    <div data-testid="report-step-submitted" className="flex flex-col gap-4">
      <div className="flex flex-col items-center text-center">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-3xl text-success">
          ✓
        </div>
        <p className="text-sm text-text-primary">
          Thanks — we have your report.
        </p>
        <p className="mt-1 text-xs text-text-secondary max-w-xs">
          {isEmergency
            ? 'We have alerted on-call. Someone will reach out shortly. If you are in immediate danger, please dial 911.'
            : 'We will review it and follow up if we need more details. You can track progress in My Reports.'}
        </p>
      </div>

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          data-testid="report-close-button"
          onClick={onClose}
          className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary"
        >
          Done
        </button>
        <PrimaryButton
          data-testid="report-open-detail-button"
          onClick={onOpenReport}
          className="flex-1"
        >
          View report
        </PrimaryButton>
      </div>
    </div>
  )
}
