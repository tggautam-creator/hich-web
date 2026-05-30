/**
 * v1.2 Sprint 6 Slice 2 — "Caregivers" section on the Profile page.
 *
 * Mirrors iOS `ProfileCaregiversSection.swift` 1:1: loading / load-
 * error / empty / list states + an "Add caregiver" row at the
 * bottom. Hard-delete model — confirm dialog before removal; past
 * rides/schedules NULL via ON DELETE SET NULL (mig 091) so removing
 * a caregiver doesn't break the audit trail.
 *
 * Gating: caller (ProfilePage) mounts this only when
 * `profile?.has_accessibility_needs === true`, matching the iOS
 * gate.
 */
import { useState } from 'react'
import {
  useMyCaregivers,
  useDeleteCaregiver,
} from '@/hooks/useCaregivers'
import AddCaregiverSheet from '@/components/profile/AddCaregiverSheet'
import type { Caregiver } from '@/types/database'

interface CaregiversSectionProps {
  'data-testid'?: string
}

export default function CaregiversSection({
  'data-testid': testId = 'caregivers-section',
}: CaregiversSectionProps) {
  const { data: caregivers, isLoading, error, refetch } = useMyCaregivers()
  const deleteCaregiverMutation = useDeleteCaregiver()

  const [sheetOpen, setSheetOpen]     = useState(false)
  const [editing, setEditing]         = useState<Caregiver | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  function openAdd() {
    setEditing(null)
    setSheetOpen(true)
  }
  function openEdit(c: Caregiver) {
    setEditing(c)
    setSheetOpen(true)
  }
  function closeSheet() {
    setSheetOpen(false)
    setEditing(null)
  }
  async function confirmRemove() {
    if (!pendingRemoveId) return
    try {
      await deleteCaregiverMutation.mutateAsync(pendingRemoveId)
    } catch {
      // mutation surfaces error via mutation state; swallow here so
      // the confirm dialog closes cleanly. List query re-fires below.
    } finally {
      setPendingRemoveId(null)
    }
  }

  return (
    <>
      <section
        data-testid={testId}
        className="bg-white mx-4 mt-4 rounded-2xl border border-border overflow-hidden"
      >
        <h2 className="px-5 pt-4 pb-2 text-sm font-semibold text-text-primary">
          Caregivers
        </h2>

        {isLoading && (
          <p
            data-testid="caregivers-loading"
            className="px-5 py-4 text-xs text-text-secondary"
          >
            Loading caregivers…
          </p>
        )}

        {error && !isLoading && (
          <div
            data-testid="caregivers-load-error"
            className="px-5 py-4 text-xs text-danger"
          >
            <p className="mb-2">Couldn't load caregivers — {error.message}</p>
            <button
              type="button"
              onClick={() => { void refetch() }}
              className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-primary"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && caregivers && caregivers.length === 0 && (
          <p
            data-testid="caregivers-empty"
            className="px-5 py-4 text-xs text-text-secondary"
          >
            No caregivers added — tap below to add someone who usually travels with you.
          </p>
        )}

        {!isLoading && !error && caregivers && caregivers.length > 0 && (
          <ul className="divide-y divide-border">
            {caregivers.map((c) => (
              <CaregiverRow
                key={c.id}
                caregiver={c}
                onEdit={() => openEdit(c)}
                onRemove={() => setPendingRemoveId(c.id)}
                isRemoving={
                  deleteCaregiverMutation.isPending &&
                  deleteCaregiverMutation.variables === c.id
                }
              />
            ))}
          </ul>
        )}

        <button
          type="button"
          data-testid="caregiver-add-button"
          onClick={openAdd}
          className="flex w-full items-center gap-2 border-t border-border px-5 py-3 text-sm font-medium text-primary active:bg-surface"
        >
          <span aria-hidden="true">+</span>
          <span>Add caregiver</span>
        </button>
      </section>

      {sheetOpen && (
        <AddCaregiverSheet
          isOpen={sheetOpen}
          editing={editing}
          onSaved={closeSheet}
          onClose={closeSheet}
        />
      )}

      {pendingRemoveId && (
        <RemoveConfirm
          onCancel={() => setPendingRemoveId(null)}
          onConfirm={() => { void confirmRemove() }}
          submitting={deleteCaregiverMutation.isPending}
        />
      )}
    </>
  )
}

// ── Row ──────────────────────────────────────────────────────────────

function CaregiverRow({
  caregiver,
  onEdit,
  onRemove,
  isRemoving,
}: {
  caregiver: Caregiver
  onEdit: () => void
  onRemove: () => void
  isRemoving: boolean
}) {
  const initial = (caregiver.name[0] ?? '?').toUpperCase()
  return (
    <li
      data-testid={`caregiver-row-${caregiver.id}`}
      className="flex items-start gap-3 px-5 py-3"
    >
      {caregiver.avatar_url ? (
        <img
          src={caregiver.avatar_url}
          alt=""
          className="h-10 w-10 rounded-full object-cover border border-border shrink-0"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">
          {caregiver.name}
        </p>
        {caregiver.phone && (
          <p className="text-xs text-text-secondary truncate">{caregiver.phone}</p>
        )}
        {caregiver.notes && (
          <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">
            {caregiver.notes}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid={`caregiver-edit-${caregiver.id}`}
            onClick={onEdit}
            className="flex-1 rounded-lg bg-primary/10 py-1.5 text-xs font-semibold text-primary"
          >
            Edit
          </button>
          <button
            type="button"
            data-testid={`caregiver-remove-${caregiver.id}`}
            onClick={onRemove}
            disabled={isRemoving}
            className="flex-1 rounded-lg bg-danger/10 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"
          >
            {isRemoving ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </li>
  )
}

// ── Remove confirm dialog ────────────────────────────────────────────

function RemoveConfirm({
  onCancel,
  onConfirm,
  submitting,
}: {
  onCancel: () => void
  onConfirm: () => void
  submitting: boolean
}) {
  return (
    <div
      data-testid="caregiver-remove-confirm"
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label="Remove caregiver?"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-text-primary">Remove this caregiver?</h3>
        <p className="mt-2 text-sm text-text-secondary">
          Past rides keep their record but the caregiver tag will be cleared. You can add a new caregiver later.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="caregiver-remove-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-2xl border border-border bg-white py-2.5 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="caregiver-remove-confirm-btn"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 rounded-2xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Removing…' : 'Remove caregiver'}
          </button>
        </div>
      </div>
    </div>
  )
}
