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

// ── KeyboardActivatable wrapper helper (for the rare div-as-toggle case) ────

// eslint-disable-next-line react-refresh/only-export-components -- shared keyboard helper colocated with marketing UI atoms
export function onEnterOrSpace(e: KeyboardEvent, handler: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handler()
  }
}
