/**
 * v1.2 Sprint 6 Slice 6 — onboarding caregiver-attach interstitial.
 *
 * Replaces the F2.2 placeholder. Reached only when AboutYouPage's
 * `wantsCaregiverFlow` predicate fires (hasAccessibilityNeeds +
 * needsWheelchair + needsCaregiver all true). The page itself
 * renders unconditionally — caller-side gating.
 *
 * ADD-only (no edit mode). Reuses the insert → upload → PATCH dance
 * + storage path pattern from AddCaregiverSheet:
 *   1. insert caregiver row (no avatar_url) to mint a caregiverID
 *   2. upload JPEG to avatars/<riderUUID lowercased>/caregivers/<id>.<ext>
 *   3. PATCH the row with the cache-busted public URL
 * Order is RLS-mandated; reversing breaks the storage policy check.
 *
 * Both Save & continue + Skip route to /onboarding/location. Skip is
 * a hard escape hatch — bypasses every write even when the user has
 * staged a photo (iOS parity: a user who isn't ready defers to
 * Profile-side caregiver management later).
 *
 * Mirrors iOS AddCaregiverOnboardingPage.swift 1:1 on copy + the
 * gating rules; chrome (no MapBackdrop / GlassCard / haptics / SF
 * Symbols / @FocusState) intentionally drifts per the parity matrix.
 */
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useAddCaregiver, useUpdateCaregiver } from '@/hooks/useCaregivers'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface AddCaregiverOnboardingPageProps {
  'data-testid'?: string
}

const MAX_NAME_LEN  = 100
const MAX_PHONE_LEN = 32
const MAX_NOTES_LEN = 500

export default function AddCaregiverOnboardingPage({
  'data-testid': testId = 'add-caregiver-onboarding-page',
}: AddCaregiverOnboardingPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const addCaregiverMutation    = useAddCaregiver()
  const updateCaregiverMutation = useUpdateCaregiver()

  const [name, setName]                   = useState('')
  const [phone, setPhone]                 = useState('')
  const [notes, setNotes]                 = useState('')
  const [stagedFile, setStagedFile]       = useState<File | null>(null)
  const [stagedPreview, setStagedPreview] = useState<string | null>(null)
  const [isSaving, setIsSaving]           = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Stash the inserted caregiver id so a retry-after-failure reuses
  // the same row instead of leaking a duplicate. Cleared back to
  // null only after the final PATCH succeeds. Without this, an
  // upload/PATCH failure → retry would insert a SECOND row and
  // orphan the first.
  const insertedIdRef = useRef<string | null>(null)
  // Stable id so aria-describedby on inputs can point at the error
  // pill when one renders.
  const errorId = useId()
  const errorDescribedBy = error ? errorId : undefined

  // Revoke the object URL when we replace or unmount so the browser
  // doesn't leak the blob. Same pattern as AddCaregiverSheet.
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

  // v1.2 F18.5 — Save gate: name AND photo both required. No
  // existing-avatar branch because this page is ADD-only.
  const canSave = !isSaving
    && name.trim().length > 0
    && stagedFile != null

  async function handleSave() {
    if (!canSave) return
    if (!profile?.id) {
      setError('Sign in required.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const trimmedName  = name.trim()
      const trimmedPhone = phone.trim()
      const trimmedNotes = notes.trim()
      if (!stagedFile) throw new Error('Photo is required')

      // Idempotent insert — reuse a previously-inserted row on retry
      // so an upload/PATCH failure doesn't leak duplicate caregivers
      // (each Skip-and-finish-later would surface the orphan as a
      // photo-less row in CaregiversSection).
      let caregiverId = insertedIdRef.current
      if (caregiverId == null) {
        const inserted = await addCaregiverMutation.mutateAsync({
          name:  trimmedName,
          phone: trimmedPhone.length > 0 ? trimmedPhone : null,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
        })
        caregiverId = inserted.id
        insertedIdRef.current = caregiverId
      }
      const uploadedUrl = await uploadCaregiverPhoto(
        stagedFile,
        profile.id,
        caregiverId,
      )
      await updateCaregiverMutation.mutateAsync({
        caregiverId,
        avatarUrl: uploadedUrl,
      })
      insertedIdRef.current = null
      navigate('/onboarding/location', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save caregiver'
      setError(msg)
    } finally {
      // Always reset the spinner — relying on navigate() to unmount
      // leaks isSaving=true under StrictMode dev double-render + in
      // tests where navigate is mocked. Matches AddCaregiverSheet.
      setIsSaving(false)
    }
  }

  // Skip is a hard escape hatch but it must not race a save that's
  // already in-flight. Gate on the mutation's isPending flags too so
  // a tap between Save's onClick and React's setState commit can't
  // sneak through and double-fire navigation.
  const saveMutationInFlight = isSaving
    || addCaregiverMutation.isPending
    || updateCaregiverMutation.isPending

  function handleSkip() {
    // Skip bypasses ALL writes even when toggles + photo are present.
    // Matches iOS — defers caregiver setup to Profile.
    navigate('/onboarding/location', { replace: true })
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{
        paddingTop:    'max(env(safe-area-inset-top), 2rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="flex-1 flex flex-col px-6 py-4">
        <h1 className="mb-1 text-2xl font-bold text-text-primary">Add a caregiver</h1>
        <p className="mb-6 text-sm text-text-secondary">
          You can add more caregivers later from your profile. Skip if you&apos;d rather set this up after.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); void handleSave() }}
          noValidate
          className="flex flex-col gap-6 pb-8"
        >
          {/* ── Photo (required) ───────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <button
              type="button"
              data-testid="caregiver-onboarding-photo-picker"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-3 rounded-2xl border border-border bg-white p-3 text-left"
            >
              <PhotoPreview stagedPreview={stagedPreview} />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-text-primary">
                  {stagedPreview ? 'Change photo' : 'Add photo (required)'}
                </span>
                <span className="text-xs text-text-secondary">
                  A clear face photo helps drivers recognize this caregiver at pickup.
                </span>
              </div>
            </button>
            <input
              ref={fileInputRef}
              data-testid="caregiver-onboarding-photo-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </section>

          {/* ── Name (required) ────────────────────────────────────── */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-primary">Name</span>
            <input
              data-testid="caregiver-onboarding-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
              maxLength={MAX_NAME_LEN}
              placeholder="e.g. Sarah Smith"
              autoComplete="name"
              // Android Chrome doesn't auto-capitalise autoComplete=name
              // fields, so without these riders type 'sarah smith' and
              // that's what drivers see at pickup. iOS Safari already
              // does the right thing here.
              autoCapitalize="words"
              autoCorrect="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={errorDescribedBy}
              className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </label>

          {/* ── Phone (optional) ───────────────────────────────────── */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-primary">Phone (optional)</span>
            <input
              data-testid="caregiver-onboarding-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.slice(0, MAX_PHONE_LEN))}
              maxLength={MAX_PHONE_LEN}
              placeholder="+15305550100"
              autoComplete="tel"
              inputMode="tel"
              className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </label>

          {/* ── Notes (optional) ───────────────────────────────────── */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-primary">Notes (optional)</span>
            <textarea
              data-testid="caregiver-onboarding-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES_LEN))}
              rows={3}
              maxLength={MAX_NOTES_LEN}
              placeholder="e.g. Usually with me on chemo days"
              className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-text-secondary">{notes.length}/{MAX_NOTES_LEN}</p>
          </label>

          {error && (
            <p
              id={errorId}
              data-testid="caregiver-onboarding-error"
              role="alert"
              className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <PrimaryButton
            data-testid="caregiver-onboarding-save"
            type="submit"
            isLoading={isSaving}
            loadingLabel="Saving…"
            disabled={!canSave}
          >
            Save &amp; continue
          </PrimaryButton>

          <button
            type="button"
            data-testid="caregiver-onboarding-skip"
            onClick={handleSkip}
            disabled={saveMutationInFlight}
            className="text-sm font-semibold text-text-secondary py-2 disabled:opacity-50"
          >
            Skip for now
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Atoms ────────────────────────────────────────────────────────────

function PhotoPreview({ stagedPreview }: { stagedPreview: string | null }) {
  if (stagedPreview) {
    return (
      <img
        src={stagedPreview}
        alt=""
        className="h-16 w-16 rounded-full object-cover border border-border"
      />
    )
  }
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary text-xl">
      +
    </div>
  )
}

// ── Upload helper ────────────────────────────────────────────────────

/**
 * Identical to AddCaregiverSheet.uploadCaregiverPhoto so the
 * onboarding + post-onboarding flows land photos under the same
 * RLS-safe path: avatars/<rider-uuid-lowercased>/caregivers/<id>.<ext>.
 *
 * Extracting both copies into a shared lib is a follow-up cleanup
 * (not a Slice 6 blocker) — duplicating now keeps the diff small.
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
