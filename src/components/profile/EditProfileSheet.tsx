/**
 * v1.2 Sprint 7 Slice 2 — bottom-sheet for editing the v1.2 user-
 * profile + accessibility fields. Mirrors iOS `EditProfileSheet.swift`
 * 1:1 (sections: About you / Education / Access needs / Caregiver
 * fees) so both clients carry the same copy + structure + write
 * shape. Existing name + phone inline edit on `ProfilePage` is left
 * alone — that's the quick-edit path; this sheet is for the richer
 * profile fields.
 *
 * Write contract: direct supabase-js via `useAuthStore.updateProfileFields`,
 * which mirrors iOS `AuthStore.updateProfileFields` field-for-field.
 * No server REST round-trip — RLS scopes the write to `auth.uid()`.
 */
import { useEffect, useMemo, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { useAuthStore } from '@/stores/authStore'
import {
  CALIFORNIA_FOUR_YEAR_UNIVERSITIES,
  graduationYearOptions,
  schoolPickerOptions,
} from '@/lib/universities'
import type { AccessibilityProfile, Gender } from '@/types/database'

interface EditProfileSheetProps {
  isOpen: boolean
  onClose: () => void
  'data-testid'?: string
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male',              label: 'Male' },
  { value: 'female',            label: 'Female' },
  { value: 'non_binary',        label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const MAX_BIO = 280
const MAX_OTHER_NOTES = 200

export default function EditProfileSheet({
  isOpen,
  onClose,
  'data-testid': testId = 'edit-profile-sheet',
}: EditProfileSheetProps) {
  const profile = useAuthStore((s) => s.profile)
  const updateProfileFields = useAuthStore((s) => s.updateProfileFields)

  // ── Form state ──────────────────────────────────────────────────────
  const [bio, setBio] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')
  const [school, setSchool] = useState<string>('')
  const [major, setMajor] = useState('')
  const [graduationYear, setGraduationYear] = useState<number | ''>('')

  // Accessibility
  const [hasAccessibilityNeeds, setHasAccessibilityNeeds] = useState(false)
  const [needsWheelchair, setNeedsWheelchair] = useState(false)
  const [needsCaregiver, setNeedsCaregiver] = useState(false)
  const [needsOther, setNeedsOther] = useState(false)
  const [otherNotes, setOtherNotes] = useState('')

  // Driver-only waive
  const [waiveCaregiverFee, setWaiveCaregiverFee] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from profile every time the sheet opens, mirroring iOS's
  // .onAppear seeding. `profile` is the dependency so a background
  // refresh that lands while the sheet is closed picks up next open.
  useEffect(() => {
    if (!isOpen) return
    setBio(profile?.bio ?? '')
    setGender(profile?.gender ?? '')
    setSchool(profile?.school ?? '')
    setMajor(profile?.major ?? '')
    setGraduationYear(profile?.graduation_year ?? '')

    const access: AccessibilityProfile = profile?.accessibility_profile ?? {}
    setHasAccessibilityNeeds(profile?.has_accessibility_needs ?? false)
    setNeedsWheelchair(access.needs_wheelchair === true)
    setNeedsCaregiver(access.needs_caregiver === true)
    const notes = access.other_notes ?? ''
    setOtherNotes(notes)
    setNeedsOther(notes.length > 0)

    setWaiveCaregiverFee(profile?.waive_caregiver_fee === true)

    setError(null)
  }, [isOpen, profile])

  const schoolList = useMemo(() => schoolPickerOptions(profile?.school), [profile?.school])
  const yearList   = useMemo(() => graduationYearOptions(profile?.graduation_year), [profile?.graduation_year])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const trimmedBio   = bio.trim()
      const trimmedMajor = major.trim()
      const trimmedNotes = otherNotes.trim()

      const access: AccessibilityProfile = {
        needs_wheelchair: hasAccessibilityNeeds && needsWheelchair,
        needs_caregiver:  hasAccessibilityNeeds && needsWheelchair && needsCaregiver,
        other_notes:      hasAccessibilityNeeds && needsOther && trimmedNotes.length > 0
          ? trimmedNotes
          : null,
      }

      await updateProfileFields({
        bio:             trimmedBio.length > 0 ? trimmedBio : null,
        gender:          gender === '' ? null : gender,
        school:          school.length > 0 ? school : null,
        major:           trimmedMajor.length > 0 ? trimmedMajor : null,
        graduationYear:  graduationYear === '' ? null : graduationYear,
        hasAccessibilityNeeds,
        accessibilityProfile:  access,
        waiveCaregiverFee,
      })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save changes'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const isDriver = profile?.is_driver === true

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Edit profile"
      data-testid={testId}
    >
      <div className="flex flex-col gap-6">

        {/* ── About you ──────────────────────────────────────────────── */}
        <Section
          header="About you"
          footer="Helps other students decide to share a ride with you."
        >
          <FieldLabel text="Bio (optional)">
            <textarea
              data-testid="edit-profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
              rows={4}
              maxLength={MAX_BIO}
              placeholder="A short bio — share what you study, where you ride, what makes you a good carpool partner."
              className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-text-secondary">{bio.length}/{MAX_BIO}</p>
          </FieldLabel>

          <FieldLabel text="Gender">
            <select
              data-testid="edit-profile-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | '')}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">—</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </FieldLabel>
        </Section>

        {/* ── Education ──────────────────────────────────────────────── */}
        <Section
          header="Education"
          footer="Pick from California schools. Surfaces as a small chip on your profile."
        >
          <FieldLabel text="School">
            <select
              data-testid="edit-profile-school"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">—</option>
              {schoolList.legacy && (
                <optgroup label="Currently selected">
                  <option value={schoolList.legacy}>{schoolList.legacy}</option>
                </optgroup>
              )}
              <optgroup label="California 4-year">
                {CALIFORNIA_FOUR_YEAR_UNIVERSITIES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </optgroup>
            </select>
          </FieldLabel>

          <FieldLabel text="Major (free text)">
            <input
              data-testid="edit-profile-major"
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="e.g. Computer Science"
              maxLength={100}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
            />
          </FieldLabel>

          <FieldLabel text="Graduation year">
            <select
              data-testid="edit-profile-graduation-year"
              value={graduationYear === '' ? '' : String(graduationYear)}
              onChange={(e) => setGraduationYear(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">—</option>
              {yearList.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </FieldLabel>
        </Section>

        {/* ── Access needs ───────────────────────────────────────────── */}
        <Section
          header="Access needs"
          footer="Helps us match you with the right rides. Editable any time."
        >
          <ToggleRow
            testId="edit-profile-has-access"
            label="I have accessibility needs"
            checked={hasAccessibilityNeeds}
            onChange={setHasAccessibilityNeeds}
          />

          {hasAccessibilityNeeds && (
            <>
              <ToggleRow
                testId="edit-profile-needs-wheelchair"
                label="Wheelchair"
                checked={needsWheelchair}
                onChange={setNeedsWheelchair}
              />

              <ToggleRow
                testId="edit-profile-needs-other"
                label="Other (tell us)"
                checked={needsOther}
                onChange={setNeedsOther}
              />

              {needsOther && (
                <FieldLabel text="What do you need?">
                  <textarea
                    data-testid="edit-profile-other-notes"
                    value={otherNotes}
                    onChange={(e) => setOtherNotes(e.target.value.slice(0, MAX_OTHER_NOTES))}
                    rows={2}
                    maxLength={MAX_OTHER_NOTES}
                    placeholder="Tell us what you need"
                    className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
                  />
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="text-xs text-text-secondary">
                      We don't have a feature for this yet — we'd love to hear how Tago can help.
                    </p>
                    <p className="shrink-0 text-xs text-text-secondary">{otherNotes.length}/{MAX_OTHER_NOTES}</p>
                  </div>
                </FieldLabel>
              )}

              {needsWheelchair && (
                <div className="rounded-xl border border-border bg-surface p-3 text-xs text-text-secondary">
                  <ToggleRow
                    testId="edit-profile-needs-caregiver"
                    label="Caregiver usually with me"
                    checked={needsCaregiver}
                    onChange={setNeedsCaregiver}
                  />
                  <div className="mt-3 space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                      Caregiver seat fee
                    </p>
                    <CaregiverTier label="Short trip (<10 mi)"    value="+$3" />
                    <CaregiverTier label="Medium trip (10–50 mi)" value="+$5" />
                    <CaregiverTier label="Long trip (>50 mi)"     value="+$8" />
                  </div>
                  {needsCaregiver && (
                    <p className="mt-3 text-xs text-text-secondary">
                      Add and manage caregivers from the Caregivers section on your profile.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Section>

        {/* ── Caregiver fees (drivers only) ──────────────────────────── */}
        {isDriver && (
          <Section
            header="Caregiver fees (drivers)"
            footer="An act of goodwill — your call. Either choice is fine; the fee compensates you for the extra effort of helping with mobility aids and loading."
          >
            <ToggleRow
              testId="edit-profile-waive-caregiver"
              label="Waive caregiver seat fees"
              description="When on, you won't charge the $3–$8 caregiver add-on on any ride you accept. Riders still need a payment method; they just won't be charged the fee."
              checked={waiveCaregiverFee}
              onChange={setWaiveCaregiverFee}
            />
          </Section>
        )}

        {error && (
          <p data-testid="edit-profile-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            data-testid="edit-profile-cancel"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <PrimaryButton
            data-testid="edit-profile-save"
            isLoading={saving}
            loadingLabel="Saving…"
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

// ── Atoms ─────────────────────────────────────────────────────────────

function Section({
  header,
  footer,
  children,
}: {
  header: string
  footer?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {header}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
      {footer && (
        <p className="text-xs text-text-secondary">{footer}</p>
      )}
    </section>
  )
}

function FieldLabel({
  text,
  children,
}: {
  text: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{text}</span>
      {children}
    </label>
  )
}

function ToggleRow({
  testId,
  label,
  description,
  checked,
  onChange,
}: {
  testId: string
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
      />
      <div className="text-xs">
        <p className="font-medium text-text-primary">{label}</p>
        {description && <p className="mt-0.5 text-text-secondary">{description}</p>}
      </div>
    </label>
  )
}

function CaregiverTier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <span className="text-xs font-semibold text-primary">{value}</span>
    </div>
  )
}
