/**
 * v1.2 Sprint 6 Slice 4 — driver-facing caregiver detail sheet.
 * Mirrors iOS `CaregiverInfoSheet.swift` 1:1: avatar hero + Call /
 * Message / Copy buttons + DJC "who is a caregiver?" explainer.
 *
 * The 3 action buttons use platform anchors (`tel:` + `sms:` +
 * `navigator.clipboard`) — same effect as iOS's `Link(destination:)`
 * + UIPasteboard.
 */
import { useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import type { CaregiverEnrichment } from '@/lib/caregiverForRide'

interface CaregiverInfoSheetProps {
  caregiver: CaregiverEnrichment
  onClose: () => void
}

export default function CaregiverInfoSheet({
  caregiver,
  onClose,
}: CaregiverInfoSheetProps) {
  const [copied, setCopied] = useState(false)
  const phone = (caregiver.phone ?? '').trim()
  const hasPhone = phone.length > 0
  const initial = caregiver.name[0]?.toUpperCase() ?? '?'

  async function handleCopy() {
    if (!hasPhone) return
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard write can fail on insecure-origin / older browsers.
      // Soft-fail — the user can still long-press the phone link.
    }
  }

  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title="Caregiver"
      data-testid="caregiver-info-sheet"
    >
      <div className="flex flex-col gap-5">

        {/* Hero ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2">
          {caregiver.avatar_url ? (
            <img
              src={caregiver.avatar_url}
              alt=""
              className="h-24 w-24 rounded-full object-cover border border-primary/30"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/15 text-primary text-3xl font-bold">
              {initial}
            </div>
          )}
          <p
            data-testid="caregiver-info-name"
            className="text-xl font-bold text-text-primary text-center"
          >
            {caregiver.name}
          </p>
          <p className="text-xs text-text-secondary">Caregiver on this ride</p>
        </div>

        {/* Actions ─────────────────────────────────────────────── */}
        {hasPhone && (
          <div data-testid="caregiver-info-actions" className="grid grid-cols-3 gap-2">
            <ActionTile
              testId="caregiver-info-call"
              href={`tel:${phone}`}
              icon={<PhoneIcon />}
              label="Call"
              tone="primary"
            />
            <ActionTile
              testId="caregiver-info-message"
              href={`sms:${phone}`}
              icon={<MessageIcon />}
              label="Message"
              tone="success"
            />
            <button
              type="button"
              data-testid="caregiver-info-copy"
              onClick={() => { void handleCopy() }}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-white py-3 text-text-secondary active:bg-surface"
            >
              <CopyIcon />
              <span className="text-xs font-semibold text-text-primary">Copy</span>
            </button>
          </div>
        )}

        {copied && (
          <p data-testid="caregiver-info-copied-toast" className="text-center text-xs font-semibold text-success">
            Phone copied
          </p>
        )}

        {/* Definition ──────────────────────────────────────────── */}
        <div className="rounded-2xl bg-surface p-4 flex flex-col gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Who is a caregiver?
          </p>
          <p className="text-sm text-text-primary">
            A caregiver is an individual who provides ongoing physical support for a disabled person. Their primary role is to assist a person with long- or short-term disabilities with daily activities and tasks to help them maintain independence and well-being.
          </p>
          <p className="text-xs text-text-secondary">
            Caregivers aren&apos;t optional — they&apos;re a necessity for many disabled riders. Tago&apos;s tiered seat fee compensates drivers for the extra effort (helping with mobility aids, doors, loading) so disabled riders aren&apos;t less likely to find a driver.
          </p>
        </div>
      </div>
    </BottomSheet>
  )
}

// ── Atoms ─────────────────────────────────────────────────────────────

function ActionTile({
  testId,
  href,
  icon,
  label,
  tone,
}: {
  testId: string
  href: string
  icon: React.ReactNode
  label: string
  tone: 'primary' | 'success'
}) {
  const toneClass = tone === 'primary'
    ? 'border-primary/30 text-primary'
    : 'border-success/30 text-success'
  return (
    <a
      data-testid={testId}
      href={href}
      className={[
        'flex flex-col items-center gap-1.5 rounded-2xl border bg-white py-3 active:bg-surface',
        toneClass,
      ].join(' ')}
    >
      {icon}
      <span className="text-xs font-semibold text-text-primary">{label}</span>
    </a>
  )
}

function PhoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
    </svg>
  )
}
