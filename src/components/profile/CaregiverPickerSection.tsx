/**
 * v1.2 Sprint 6 Slice 3 — caregiver picker for ride-request /
 * board-post surfaces. Mirrors iOS `RideConfirmCaregiverSection.swift`
 * 1:1. Renders nothing when the caller passes zero caregivers.
 *
 * Gating predicate (parent decides whether to mount this at all):
 *   profile.has_accessibility_needs
 *     AND profile.accessibility_profile.needs_wheelchair
 *     AND caregivers.length > 0
 *
 * UX:
 *   - Toggle starts OFF; flipping ON auto-selects the first caregiver
 *   - Single caregiver → no picker, just "with X" caption
 *   - Multiple caregivers → <select> picker, defaults to first
 *   - Live fee preview: "+$3 / +$5 / +$8 caregiver seat fee" via
 *     `caregiverFareCents(distanceKm)` — server is canonical at
 *     ride-request time + re-derives the fee, so this is preview only
 */
import { useEffect } from 'react'
import { caregiverFareCents, formatCents } from '@/lib/fare'
import type { Caregiver } from '@/types/database'

interface CaregiverPickerSectionProps {
  caregivers:    Caregiver[]
  /** Selected caregiver id; `null` means the toggle is off. */
  selectedId:    string | null
  onChange:      (id: string | null) => void
  /** Live distance used for the fee-preview line. */
  distanceKm:    number
  'data-testid'?: string
}

export default function CaregiverPickerSection({
  caregivers,
  selectedId,
  onChange,
  distanceKm,
  'data-testid': testId = 'caregiver-picker',
}: CaregiverPickerSectionProps) {
  // Auto-select the first caregiver when the toggle is flipped ON and
  // we don't yet have a selection. Mirrors iOS first-row default.
  // Cleared when the toggle is flipped OFF.
  useEffect(() => {
    if (selectedId !== null && !caregivers.some((c) => c.id === selectedId)) {
      // Stored selection is stale (e.g. caregiver was just deleted).
      // Drop back to the first row so the picker stays consistent.
      onChange(caregivers[0]?.id ?? null)
    }
  }, [selectedId, caregivers, onChange])

  if (caregivers.length === 0) return null

  const isOn = selectedId !== null
  const fareCents = isOn ? caregiverFareCents(distanceKm) : 0
  const onlyOne = caregivers.length === 1
  const firstCaregiverId = caregivers[0]?.id

  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-3"
    >
      <label className="flex items-start gap-3">
        <input
          data-testid="caregiver-picker-toggle"
          type="checkbox"
          checked={isOn}
          onChange={(e) => {
            if (e.target.checked) {
              onChange(firstCaregiverId ?? null)
            } else {
              onChange(null)
            }
          }}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
        />
        <div className="text-sm">
          <p className="font-semibold text-text-primary">Bring my caregiver?</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Your driver will see your caregiver's name, photo, and phone after they accept.
          </p>
        </div>
      </label>

      {isOn && (
        <div className="flex flex-col gap-2">
          {onlyOne ? (
            <p
              data-testid="caregiver-picker-only"
              className="text-xs text-text-secondary"
            >
              with <span className="font-semibold text-text-primary">{caregivers[0]?.name}</span>
            </p>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                Which caregiver?
              </span>
              <select
                data-testid="caregiver-picker-select"
                value={selectedId ?? ''}
                onChange={(e) => onChange(e.target.value || null)}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
              >
                {caregivers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          <div
            data-testid="caregiver-picker-fee"
            className="flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2 text-xs"
          >
            <span className="text-text-secondary">Caregiver seat fee</span>
            <span className="font-semibold text-primary">+{formatCents(fareCents)}</span>
          </div>
        </div>
      )}
    </section>
  )
}
