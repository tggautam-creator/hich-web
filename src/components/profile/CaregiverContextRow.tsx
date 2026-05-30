/**
 * v1.2 Sprint 6 Slice 4 — driver-facing "Riding with caregiver"
 * row. Mirrors iOS `CaregiverContextRow.swift` 1:1.
 *
 * Renders nothing when the ride has no caregiver attached so
 * callers can mount it unconditionally.
 *
 * Tap opens `CaregiverInfoSheet` (Call · Message · Copy buttons +
 * DJC explainer).
 */
import { useState } from 'react'
import CaregiverInfoSheet from '@/components/profile/CaregiverInfoSheet'
import type { CaregiverEnrichment } from '@/lib/caregiverForRide'

interface CaregiverContextRowProps {
  caregiver: CaregiverEnrichment | null
  'data-testid'?: string
}

export default function CaregiverContextRow({
  caregiver,
  'data-testid': testId = 'caregiver-context-row',
}: CaregiverContextRowProps) {
  const [open, setOpen] = useState(false)
  if (!caregiver || !caregiver.name) return null

  const initial = caregiver.name[0]?.toUpperCase() ?? '?'
  const hasPhone = !!caregiver.phone && caregiver.phone.trim().length > 0

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        aria-label={`Caregiver ${caregiver.name}. Tap for contact options and details.`}
        className="flex w-full items-center gap-3 rounded-2xl bg-white border border-border px-4 py-3 text-left active:bg-surface"
      >
        <Avatar avatarUrl={caregiver.avatar_url} initial={initial} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Riding with caregiver
          </p>
          <p className="text-sm font-semibold text-text-primary truncate">{caregiver.name}</p>
        </div>
        {hasPhone && (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"
            title="Phone available"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </span>
        )}
        <span aria-hidden="true" className="text-text-secondary">›</span>
      </button>

      {open && (
        <CaregiverInfoSheet
          caregiver={caregiver}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function Avatar({ avatarUrl, initial }: { avatarUrl: string | null; initial: string }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-8 w-8 rounded-full object-cover border border-primary/30 shrink-0"
      />
    )
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
      {initial}
    </div>
  )
}
