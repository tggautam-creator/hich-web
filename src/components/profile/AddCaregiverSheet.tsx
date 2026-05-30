/**
 * v1.2 Sprint 6 Slice 2 — Add OR Edit a caregiver. Single component
 * handles both modes — pass `editing: someCaregiver` to pre-fill the
 * form, omit it for a fresh add.
 *
 * v1.2 F18.5 — caregiver photo is MANDATORY (CTO call 2026-05-23).
 * Save stays disabled until a photo is staged. Upload path mirrors
 * iOS exactly: `avatars/<riderUUID>/caregivers/<caregiverID>.jpg`
 * — the existing `avatars insert own` RLS policy (mig 040) allows
 * the rider to write under their own UUID prefix.
 *
 * ADD flow: insert row first to mint a caregiverID → upload photo →
 * PATCH avatar_url. Same dance as iOS so RLS validates the photo path
 * against a row that actually exists.
 *
 * EDIT flow: re-upload only when the user re-picks; otherwise leave
 * the existing avatar_url alone.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useAddCaregiver, useUpdateCaregiver } from '@/hooks/useCaregivers'
import type { Caregiver } from '@/types/database'

interface AddCaregiverSheetProps {
  isOpen: boolean
  /** When set, the sheet opens in Edit mode pre-filled from this row. */
  editing?: Caregiver | null
  onSaved: () => void
  onClose: () => void
  'data-testid'?: string
}

const MAX_NAME_LEN  = 100
const MAX_PHONE_LEN = 32
const MAX_NOTES_LEN = 500

export default function AddCaregiverSheet({
  isOpen,
  editing,
  onSaved,
  onClose,
  'data-testid': testId = 'add-caregiver-sheet',
}: AddCaregiverSheetProps) {
  const profile = useAuthStore((s) => s.profile)
  const addCaregiverMutation    = useAddCaregiver()
  const updateCaregiverMutation = useUpdateCaregiver()

  const [name, setName]     = useState('')
  const [phone, setPhone]   = useState('')
  const [notes, setNotes]   = useState('')
  const [stagedFile, setStagedFile]       = useState<File | null>(null)
  const [stagedPreview, setStagedPreview] = useState<string | null>(null)
  const [isSaving, setIsSaving]           = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEditing = editing != null

  // Reset form each time the sheet opens. Mirrors iOS seedIfEditing
  // pattern — re-entry into the sheet always shows the latest profile
  // state, not stale in-flight edits from a previous open.
  useEffect(() => {
    if (!isOpen) return
    setName(editing?.name ?? '')
    setPhone(editing?.phone ?? '')
    setNotes(editing?.notes ?? '')
    setStagedFile(null)
    setStagedPreview(null)
    setError(null)
  }, [isOpen, editing])

  // Revoke the object URL when we replace or unmount so the browser
  // doesn't leak the blob.
  useEffect(() => {
    return () => {
      if (stagedPreview) URL.revokeObjectURL(stagedPreview)
    }
  }, [stagedPreview])

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (stagedPreview) URL.revokeObjectURL(stagedPreview)
    setStagedFile(file)
    setStagedPreview(URL.createObjectURL(file))
    setError(null)
  }

  // v1.2 F18.5 — Save gate. ADD requires a fresh photo (mandatory).
  // EDIT accepts the existing avatar_url in lieu of a re-pick.
  const hasExistingAvatar = isEditing && (editing?.avatar_url ?? '').length > 0
  const canSave = !isSaving
    && name.trim().length > 0
    && (stagedFile != null || hasExistingAvatar)

  async function handleSave() {
    if (!canSave || !profile?.id) return
    setIsSaving(true)
    setError(null)
    try {
      const trimmedName  = name.trim()
      const trimmedPhone = phone.trim()
      const trimmedNotes = notes.trim()

      if (isEditing && editing) {
        // EDIT — upload first (if user re-picked) then patch.
        let nextAvatarUrl: string | undefined
        if (stagedFile) {
          nextAvatarUrl = await uploadCaregiverPhoto(
            stagedFile,
            profile.id,
            editing.id,
          )
        }
        await updateCaregiverMutation.mutateAsync({
          caregiverId: editing.id,
          name:        trimmedName,
          phone:       trimmedPhone.length > 0 ? trimmedPhone : null,
          notes:       trimmedNotes.length > 0 ? trimmedNotes : null,
          ...(nextAvatarUrl ? { avatarUrl: nextAvatarUrl } : {}),
        })
      } else {
        // ADD — insert row first to mint a caregiverID, then upload
        // photo, then patch avatar_url. Same flow as iOS so RLS
        // validates the storage path against a row that exists.
        if (!stagedFile) throw new Error('Photo is required')
        const inserted = await addCaregiverMutation.mutateAsync({
          name:         trimmedName,
          phone:        trimmedPhone.length > 0 ? trimmedPhone : null,
          notes:        trimmedNotes.length > 0 ? trimmedNotes : null,
        })
        const uploadedUrl = await uploadCaregiverPhoto(
          stagedFile,
          profile.id,
          inserted.id,
        )
        await updateCaregiverMutation.mutateAsync({
          caregiverId: inserted.id,
          avatarUrl:   uploadedUrl,
        })
      }
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save caregiver'
      setError(msg)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit caregiver' : 'Add caregiver'}
      data-testid={testId}
    >
      <div className="flex flex-col gap-5">

        {/* ── Photo ──────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Photo
          </h3>
          <button
            type="button"
            data-testid="caregiver-photo-picker"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 rounded-2xl border border-border bg-white p-3 text-left"
          >
            <PhotoPreview
              stagedPreview={stagedPreview}
              existingUrl={editing?.avatar_url ?? null}
            />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                {stagedPreview || hasExistingAvatar ? 'Change photo' : 'Add photo (required)'}
              </span>
              <span className="text-xs text-text-secondary">Choose from your library</span>
            </div>
          </button>
          <input
            ref={fileInputRef}
            data-testid="caregiver-photo-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
          <p className="text-xs text-text-secondary">
            A clear face photo helps your driver recognize your caregiver at pickup. Photo is required.
          </p>
        </section>

        {/* ── Caregiver ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Caregiver
          </h3>

          <Field label="Name (required)">
            <input
              data-testid="caregiver-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
              maxLength={MAX_NAME_LEN}
              autoComplete="name"
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </Field>

          <Field label="Phone (e.g. +15305550100)">
            <input
              data-testid="caregiver-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.slice(0, MAX_PHONE_LEN))}
              maxLength={MAX_PHONE_LEN}
              autoComplete="tel"
              inputMode="tel"
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </Field>
        </section>

        {/* ── Notes ──────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Notes
          </h3>
          <Field label="">
            <textarea
              data-testid="caregiver-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES_LEN))}
              rows={3}
              maxLength={MAX_NOTES_LEN}
              placeholder="e.g. Usually with me on chemo days"
              className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-text-secondary">
              {notes.length}/{MAX_NOTES_LEN}
            </p>
          </Field>
          <p className="text-xs text-text-secondary">
            Only you can see your caregivers. After your driver accepts the ride, they'll see this caregiver's name + photo + phone.
          </p>
        </section>

        {error && (
          <p
            data-testid="caregiver-sheet-error"
            role="alert"
            className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            data-testid="caregiver-sheet-cancel"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <PrimaryButton
            data-testid="caregiver-sheet-save"
            isLoading={isSaving}
            loadingLabel="Saving…"
            disabled={!canSave}
            onClick={() => { void handleSave() }}
            className="flex-1"
          >
            Save
          </PrimaryButton>
        </div>
      </div>
    </BottomSheet>
  )
}

// ── Upload helper ────────────────────────────────────────────────────

/**
 * Upload the staged file to `avatars/<rider>/caregivers/<caregiver>.jpg`
 * and return a cache-busted public URL. Path matches iOS
 * `AddCaregiverSheet.uploadCaregiverPhoto` so both clients write into
 * the same shape, and the existing `avatars insert own` RLS policy
 * (mig 040) allows the signed-in rider to write under their own
 * UUID prefix.
 *
 * Defensive lowercase on the rider UUID — Postgres returns it
 * lowercased and storage RLS compares case-sensitively against
 * `auth.uid()::text`. iOS has the same defensive `.lowercased()`.
 */
async function uploadCaregiverPhoto(
  file: File,
  riderUserId: string,
  caregiverId: string,
): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  const path = `${riderUserId.toLowerCase()}/caregivers/${caregiverId}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}

// ── Atoms ────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      )}
      {children}
    </label>
  )
}

function PhotoPreview({
  stagedPreview,
  existingUrl,
}: {
  stagedPreview: string | null
  existingUrl: string | null
}) {
  const src = stagedPreview ?? (existingUrl && existingUrl.length > 0 ? existingUrl : null)
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-14 w-14 rounded-full object-cover border border-border"
      />
    )
  }
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary text-xl">
      +
    </div>
  )
}
