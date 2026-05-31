/**
 * Shared marketing-queue UI primitives.
 *
 * Extracted so StoriesPage and PostersPage stay in lockstep — the
 * earlier copy/paste already drifted on button order + verbs (caught
 * in the Phase 2 adversarial review). Single definition for:
 *  - GenerateButton (per-button loading state)
 *  - StatusPill (toggle-back + aria-pressed + contextual label)
 *  - CollapsibleBatchHeader (keyboard-accessible toggle)
 *  - CopyableField (clipboard with success + failure UI states +
 *    aria-live announcement)
 *
 * Naming convention for the 3-way generator: ALWAYS rider-first,
 * driver-second, both-third. Matches the balanced-marketplace rule
 * (riders + drivers are first-class users; alphabetical ordering
 * avoids implying one side is the "primary" audience).
 */
import { useState, useRef, type KeyboardEvent } from 'react'

// ── GenerateButton ────────────────────────────────────────────────

export type AudienceVariant = 'rider' | 'driver' | 'both'

interface GenerateButtonProps {
  testid: string
  label: string
  tone: 'rider' | 'driver' | 'both'
  /** Which value is currently in-flight (from React Query's `mutation.variables`)
   *  — used to show a per-button "Generating…" state instead of
   *  greying all three out indistinguishably. */
  inFlight: AudienceVariant | null
  variant: AudienceVariant
  disabled: boolean
  onClick: () => void
}

export function GenerateButton({
  testid, label, tone, inFlight, variant, disabled, onClick,
}: GenerateButtonProps) {
  const cls = tone === 'both'
    ? 'bg-primary text-white hover:bg-primary/90'
    : tone === 'rider'
      ? 'border border-success/40 text-success bg-success/5 hover:bg-success/10'
      : 'border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10'
  const isMe = inFlight === variant
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={isMe}
      className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${cls}`}
    >
      {isMe ? 'Generating…' : label}
    </button>
  )
}

// ── StatusPill ────────────────────────────────────────────────────

interface StatusPillProps {
  active: boolean
  label: string
  tone: 'success' | 'muted'
  /** Required for screen-reader disambiguation across many cards. */
  ariaLabel: string
  onClick: () => void
}

export function StatusPill({
  active, label, tone, ariaLabel, onClick,
}: StatusPillProps) {
  const base = 'rounded-md px-2 py-1 text-[11px] font-semibold border transition-colors'
  const toneActive = tone === 'success'
    ? 'bg-success/10 text-success border-success/30'
    : 'bg-text-secondary/10 text-text-secondary border-text-secondary/30'
  const toneInactive = 'bg-white text-text-secondary border-border hover:bg-surface'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={[base, active ? toneActive : toneInactive].join(' ')}
    >
      {label}
    </button>
  )
}

// ── CollapsibleBatchHeader ────────────────────────────────────────

interface CollapsibleBatchHeaderProps {
  open: boolean
  onToggle: () => void
  ariaLabel: string
  ariaControls: string
  children: React.ReactNode
}

/**
 * Real <button> wrapper so the collapse/expand toggle is keyboard-
 * activatable (Enter + Space via native button semantics) and
 * announces `aria-expanded` to screen readers. Replaces the
 * non-interactive <header onClick> pattern.
 */
export function CollapsibleBatchHeader({
  open, onToggle, ariaLabel, ariaControls, children,
}: CollapsibleBatchHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={ariaControls}
      aria-label={ariaLabel}
      className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface text-left"
    >
      {children}
      <span
        aria-hidden="true"
        className={`text-text-secondary transition-transform ${open ? 'rotate-90' : ''}`}
      >
        ›
      </span>
    </button>
  )
}

// ── CopyableField ────────────────────────────────────────────────

interface CopyableFieldProps {
  label: string
  value: string
  testid: string
  multiline?: boolean
  /** Mutation invoker for the 'first copy' status flip (story cards
   *  use this to mark item as 'copied'). Optional. */
  onFirstCopy?: () => void
}

/**
 * Clipboard write with:
 *  - 'Copied!' success state for 1.2s
 *  - 'Copy failed' error state when clipboard API rejects (insecure
 *    context, denied permission)
 *  - aria-live region so screen readers announce both outcomes
 *  - onFirstCopy callback for tracking first-time copy actions
 */
export function CopyableField({
  label, value, testid, multiline, onFirstCopy,
}: CopyableFieldProps) {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const firstCopiedRef = useRef(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('success')
      setTimeout(() => setStatus('idle'), 1200)
      if (!firstCopiedRef.current) {
        firstCopiedRef.current = true
        onFirstCopy?.()
      }
    } catch (err) {
      // eslint-disable-next-line no-console -- diagnostic for clipboard-API failure on insecure-origin / old browsers
      console.warn('[marketing] clipboard write failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2400)
    }
  }

  const buttonLabel = status === 'success' ? 'Copied!'
    : status === 'error' ? 'Copy failed'
    : 'Copy'
  const buttonCls = status === 'error'
    ? 'border-danger/30 text-danger bg-danger/5'
    : 'border-border text-text-secondary hover:bg-surface bg-white'

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</p>
        <button
          data-testid={testid}
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${buttonCls}`}
        >
          {buttonLabel}
        </button>
      </div>
      <p
        className={[
          'text-sm text-text-primary',
          multiline ? 'whitespace-pre-wrap' : 'truncate',
        ].join(' ')}
      >
        {value}
      </p>
      {/* Screen-reader announcement for copy outcome. visually-hidden
          via sr-only-style absolute positioning. */}
      <span className="sr-only" aria-live="polite">
        {status === 'success' ? `${label} copied to clipboard.` : ''}
        {status === 'error' ? `${label} copy failed.` : ''}
      </span>
    </div>
  )
}

// ── CostBadge + NoAiCostBadge ─────────────────────────────────────
//
// Inline cost-disclosure primitives. Use these on any button that
// triggers a Gemini call so the cost surfaces at click time instead
// of buried in a doc. Source of truth: src/lib/marketing/costs.ts.

import {
  costDisclosure,
  costTagline,
  estimatedCost,
  NO_AI_COST_LABEL,
  PRICING_LAST_VERIFIED,
  PRICING_SOURCE_URL,
  type CostFeature,
} from '@/lib/marketing/costs'
import {
  useGeminiQuota,
  quotaServiceForFeature,
  quotaChainForFeature,
  type GeminiServiceQuota,
} from '@/hooks/useGeminiQuota'

interface CostBadgeProps {
  feature: CostFeature
  /** Short variant ('~$0.039') vs long ('Flash · ~$0.039 / call'). */
  variant?: 'short' | 'tagline'
  testid?: string
}

export function CostBadge({ feature, variant = 'short', testid }: CostBadgeProps) {
  const label = variant === 'tagline' ? costTagline(feature) : estimatedCost(feature)
  const tooltip = `${costDisclosure(feature)} See ${PRICING_SOURCE_URL}.`
  return (
    <span
      data-testid={testid ?? `cost-badge-${feature}`}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary"
    >
      <span aria-hidden="true">⚡</span>
      {label}
    </span>
  )
}

interface NoAiCostBadgeProps {
  testid?: string
}

export function NoAiCostBadge({ testid }: NoAiCostBadgeProps) {
  return (
    <span
      data-testid={testid ?? 'no-ai-cost-badge'}
      title={`${NO_AI_COST_LABEL} — this button writes to the database only and does not call the Gemini API.`}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-semibold text-text-secondary"
    >
      <span aria-hidden="true">·</span>
      {NO_AI_COST_LABEL}
    </span>
  )
}

// ── GeminiQuotaBanner ─────────────────────────────────────────────
//
// Page-level banner showing today's Gemini usage vs free-tier
// ceilings, per model. Renders inline on every marketing page so the
// founder knows where they stand before clicking Generate. Refreshes
// every 60s via useAdminApiUsage().

export function GeminiQuotaBanner() {
  const { byService, anyExhausted, anyNear, query } = useGeminiQuota()

  if (query.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-secondary">
        Loading Gemini quota…
      </div>
    )
  }
  if (query.error) return null

  const tone = anyExhausted
    ? 'border-danger/40 bg-danger/5'
    : anyNear
      ? 'border-warning/40 bg-warning/5'
      : 'border-border bg-surface'

  return (
    <section
      data-testid="gemini-quota-banner"
      className={`rounded-lg border px-3 py-2 text-[11px] ${tone}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-text-primary">
          Today's Gemini quota
        </span>
        <QuotaPill q={byService.gemini_flash} />
        <QuotaPill q={byService.gemini_pro} />
        <QuotaPill q={byService.gemini_flash_image} />
        <QuotaPill q={byService.gemini_flash_2} />
        <QuotaPill q={byService.gemini_flash_lite} />
        <span className="ml-auto text-text-secondary">
          Resets at UTC midnight
        </span>
      </div>
      {anyExhausted && (
        <p
          data-testid="gemini-quota-exhausted-msg"
          className="mt-1 text-danger"
        >
          One or more Gemini models hit their free-tier ceiling today.
          Buttons that use them are disabled until UTC midnight, or
          enable billing on the GCP project for higher limits.
        </p>
      )}
      {!anyExhausted && anyNear && (
        <p
          data-testid="gemini-quota-near-msg"
          className="mt-1 text-warning"
        >
          One or more Gemini models are within 3 calls of today's free-
          tier ceiling. Generate buttons will ask for confirmation.
        </p>
      )}
    </section>
  )
}

function QuotaPill({ q }: { q: GeminiServiceQuota }) {
  if (q.daily_quota == null) {
    return (
      <span className="text-text-secondary">
        {q.label}: <span className="text-text-primary">{q.today.toLocaleString()}</span>
      </span>
    )
  }
  const tone = q.status === 'exhausted'
    ? 'text-danger font-semibold'
    : q.status === 'near'
      ? 'text-warning font-semibold'
      : 'text-text-primary'
  return (
    <span
      data-testid={`gemini-quota-pill-${q.service}`}
      className="text-text-secondary"
    >
      {q.label}:{' '}
      <span className={tone}>
        {q.today.toLocaleString()}/{q.daily_quota.toLocaleString()}
      </span>
      {q.remaining != null && q.status !== 'ok' && (
        <span className="text-text-secondary"> ({q.remaining} left)</span>
      )}
    </span>
  )
}

/**
 * Returns the disabled state + click-wrapping helper for a feature's
 * Generate button. Single source of truth for the soft-disable logic
 * so every page applies it the same way.
 *
 * Usage:
 *   const gate = useQuotaGate('poster-batch')
 *   <button
 *     disabled={isPending || gate.fullyDisabled}
 *     onClick={() => gate.run(() => mutation.mutate(args), {
 *       confirmMessage: 'Generate poster?\n\n' + costDisclosure(...)
 *     })}
 *   >
 *
 * The confirmMessage option is the standard way to add cost-
 * disclosure friction. The gate MERGES it with the near-quota
 * warning when both apply, so the founder never sees back-to-back
 * native confirms.
 */
export interface QuotaGateRunOptions {
  /**
   * Optional confirmation text. When provided, always shown to the
   * user before the handler fires (even when the gate's own status
   * is 'ok'). Used by buttons that always want a friction step
   * (e.g. paid image gen). If the gate is ALSO in 'near' state, the
   * two messages are merged into a single confirm dialog.
   */
  confirmMessage?: string
}

export interface QuotaGate {
  /** Hard-disable: the model's daily quota is fully exhausted. */
  fullyDisabled: boolean
  /** Warn-disable: 'near' state — button still works but click() asks
   * for a confirm. */
  needsConfirm: boolean
  /** Quota row for the underlying model, or null when no gate applies
   * (e.g. unknown feature, missing data). */
  quota: GeminiServiceQuota | null
  /**
   * Wrap a button's click handler. If fullyDisabled → no-op + alert.
   * If needsConfirm or opts.confirmMessage → window.confirm with the
   * combined message. Else runs the handler directly. The caller
   * passes a thunk that fires the actual mutation.
   */
  run: (handler: () => void, opts?: QuotaGateRunOptions) => void
}

// eslint-disable-next-line react-refresh/only-export-components -- gate hook colocated with the badges that consume it
export function useQuotaGate(feature: CostFeature): QuotaGate {
  const svcKey = quotaServiceForFeature(feature)
  const chainKeys = quotaChainForFeature(feature)
  const { byService } = useGeminiQuota()
  const quota: GeminiServiceQuota | null = svcKey ? byService[svcKey] : null

  // Chain-aware gating. A feature with a fallback chain (e.g. stories,
  // posters) only becomes fully-disabled when EVERY tier is
  // exhausted — until then the server tries the next model on
  // 429 and the founder gets a clean result with a fallback banner.
  // Primary-exhausted but fallback-available → status 'near' so the
  // button stays clickable + the confirm warns about downshift.
  const chainQuotas = chainKeys.map((k) => byService[k]).filter(Boolean)
  const allExhausted = chainQuotas.length > 0
    && chainQuotas.every((q) => q.status === 'exhausted')
  const primaryExhausted = quota?.status === 'exhausted'

  const fullyDisabled = allExhausted
  const needsConfirm = !allExhausted && (
    quota?.status === 'near' || primaryExhausted
  )

  function run(handler: () => void, opts?: QuotaGateRunOptions) {
    if (fullyDisabled) {
      window.alert(
        `All Gemini tiers for this feature hit their daily quota today. Wait for UTC midnight or enable billing on the GCP project.`,
      )
      return
    }
    const parts: string[] = []
    if (primaryExhausted) {
      // Primary is at ceiling but fallback has capacity. Tell the
      // founder which model will actually run.
      const firstHealthy = chainQuotas.find((q) => q.status !== 'exhausted')
      parts.push(
        `${quota?.label ?? 'Primary tier'} hit its daily quota — this call will use ${firstHealthy?.label ?? 'a fallback model'} instead.`,
      )
    } else if (quota?.status === 'near') {
      parts.push(
        `Only ${quota?.remaining ?? '?'} ${quota?.label ?? 'Gemini'} calls left today before fallback kicks in.`,
      )
    }
    if (opts?.confirmMessage) parts.push(opts.confirmMessage)
    if (parts.length > 0) {
      const ok = window.confirm(`${parts.join('\n\n')}\n\nContinue?`)
      if (!ok) return
    }
    handler()
  }

  return { fullyDisabled, needsConfirm, quota, run }
}

/** Footer disclaimer for the marketing-panel pages. */
export function CostFooterNote() {
  return (
    <p className="text-[10px] text-text-secondary mt-2">
      Cost figures are estimates only — Google's invoice is authoritative.
      Last verified against{' '}
      <a
        href={PRICING_SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:no-underline"
      >
        ai.google.dev/pricing
      </a>{' '}
      on {PRICING_LAST_VERIFIED}.
    </p>
  )
}

// ── KeyboardActivatable wrapper helper (for the rare div-as-toggle case) ────

// eslint-disable-next-line react-refresh/only-export-components -- shared keyboard helper colocated with marketing UI atoms
export function onEnterOrSpace(e: KeyboardEvent, handler: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handler()
  }
}
