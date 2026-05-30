/**
 * v1.2 Sprint 7 Slice 5 — second onboarding step (after CreateProfile).
 *
 * Mirrors iOS `AboutYouPage.swift` 1:1. Every field is optional;
 * Skip advances to /onboarding/location without writing.
 *
 * Sections (top-to-bottom):
 *   • About you — Bio (multi-line, 280 chars) + Gender picker
 *   • Education — School (closed picker, 50 CA universities), Major,
 *     Graduation year (select)
 *   • Access needs — top toggle gates: Wheelchair, Other (200-char
 *     free text), Caregiver toggle (when wheelchair on), always-
 *     visible tiered fare explainer ($3/$5/$8)
 *
 * If the user opts into wheelchair + caregiver both, we surface a
 * "We'll set up your caregiver next." hint matching iOS — and on
 * Continue we route to /onboarding/caregiver
 * (AddCaregiverOnboardingPage, Sprint 6 Slice 6) instead of
 * /onboarding/location. Skip is a hard escape hatch: bypasses the
 * caregiver step even when the toggles were on at click time.
 *
 * Write contract: direct supabase-js via `useAuthStore.updateProfileFields`
 * (Slice 1's helper). Same JSON shape iOS sends.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import {
  CALIFORNIA_FOUR_YEAR_UNIVERSITIES,
  graduationYearOptions,
  schoolPickerOptions,
} from '@/lib/universities'
import PrimaryButton from '@/components/ui/PrimaryButton'
import type { AccessibilityProfile, Gender } from '@/types/database'

interface AboutYouPageProps {
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

export default function AboutYouPage({
  'data-testid': testId = 'about-you-page',
}: AboutYouPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const updateProfileFields = useAuthStore((s) => s.updateProfileFields)

  // About you
  const [bio, setBio]         = useState('')
  const [gender, setGender]   = useState<Gender | ''>('')

  // Education
  const [school, setSchool]                 = useState('')
  const [major, setMajor]                   = useState('')
  const [graduationYear, setGraduationYear] = useState<number | ''>('')

  // Access needs
  const [hasAccessibilityNeeds, setHasAccessibilityNeeds] = useState(false)
  const [needsWheelchair, setNeedsWheelchair]             = useState(false)
  const [needsCaregiver, setNeedsCaregiver]               = useState(false)
  const [needsOther, setNeedsOther]                       = useState(false)
  const [otherNotes, setOtherNotes]                       = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Seed from profile ONCE on first paint. iOS uses the same one-time-
  // seed guard so re-entering the page (e.g. back-nav) doesn't wipe
  // in-flight edits. React's strict-effects + `hasSeeded` ref-equivalent
  // here is a single useEffect with profile in deps + a one-shot flag.
  const [hasSeeded, setHasSeeded] = useState(false)
  useEffect(() => {
    if (hasSeeded || !profile) return
    setHasSeeded(true)
    setBio(profile.bio ?? '')
    setGender(profile.gender ?? '')
    setSchool(profile.school ?? '')
    setMajor(profile.major ?? '')
    setGraduationYear(profile.graduation_year ?? '')

    const acc: AccessibilityProfile = profile.accessibility_profile ?? {}
    setHasAccessibilityNeeds(profile.has_accessibility_needs ?? false)
    setNeedsWheelchair(acc.needs_wheelchair === true)
    setNeedsCaregiver(acc.needs_caregiver === true)
    const notes = acc.other_notes ?? ''
    setOtherNotes(notes)
    setNeedsOther(notes.length > 0)
  }, [hasSeeded, profile])

  const schoolList = schoolPickerOptions(profile?.school)
  const yearList   = graduationYearOptions(profile?.graduation_year)

  // v1.2 F2.2 + Sprint 6 Slice 6 — when the user opted into the
  // wheelchair + caregiver flow, Continue routes to the
  // /onboarding/caregiver interstitial; otherwise straight to
  // Location. Skip ALWAYS bypasses the caregiver step — it's a hard
  // escape hatch even when the user toggled the flags on at the
  // last second (iOS parity: defer caregiver setup to Profile).
  const wantsCaregiverFlow = hasAccessibilityNeeds && needsWheelchair && needsCaregiver

  async function saveAndContinue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isSaving) return
    setIsSaving(true)
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
        bio:                  trimmedBio.length > 0 ? trimmedBio : null,
        gender:               gender === '' ? null : gender,
        school:               school.length > 0 ? school : null,
        major:                trimmedMajor.length > 0 ? trimmedMajor : null,
        graduationYear:       graduationYear === '' ? null : graduationYear,
        hasAccessibilityNeeds,
        accessibilityProfile: access,
        // v1.2 F14.2 — preserve a driver's waiver state if it was
        // already set in a prior session. Onboarding should never
        // accidentally reset it. Matches iOS line 449.
        waiveCaregiverFee:    profile?.waive_caregiver_fee === true,
      })
      navigate(
        wantsCaregiverFlow ? '/onboarding/caregiver' : '/onboarding/location',
        { replace: true },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save changes'
      setError(msg)
      setIsSaving(false)
    }
  }

  function skip() {
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
        <h1 className="mb-1 text-2xl font-bold text-text-primary">Tell us about you</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Optional — helps the people you travel with get to know you. Skip and add later from your profile.
        </p>

        <form
          onSubmit={(e) => { void saveAndContinue(e) }}
          noValidate
          className="flex flex-col gap-6 pb-8"
        >
          {/* ── About you ───────────────────────────────────────────── */}
          <Section header="About you">
            <Field label="Bio">
              <textarea
                data-testid="about-you-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                rows={3}
                maxLength={MAX_BIO}
                placeholder="A short bio — what you study, where you ride."
                className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-right text-xs text-text-secondary">{bio.length}/{MAX_BIO}</p>
            </Field>

            <Field label="Gender">
              <select
                data-testid="about-you-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | '')}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="">—</option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </Field>
          </Section>

          {/* ── Education ───────────────────────────────────────────── */}
          <Section header="Education">
            <Field label="School">
              <select
                data-testid="about-you-school"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="">Pick your school</option>
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
            </Field>

            <Field label="Major">
              <input
                data-testid="about-you-major"
                type="text"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                placeholder="e.g. Computer Science"
                maxLength={100}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
              />
            </Field>

            <Field label="Graduation year">
              <select
                data-testid="about-you-graduation-year"
                value={graduationYear === '' ? '' : String(graduationYear)}
                onChange={(e) => setGraduationYear(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="">—</option>
                {yearList.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </Field>
          </Section>

          {/* ── Access needs ────────────────────────────────────────── */}
          <Section header="Access needs">
            <ToggleRow
              testId="about-you-has-access"
              label="I have accessibility needs"
              description="Helps us match you with the right rides."
              checked={hasAccessibilityNeeds}
              onChange={setHasAccessibilityNeeds}
            />

            {hasAccessibilityNeeds && (
              <>
                <ToggleRow
                  testId="about-you-needs-wheelchair"
                  label="Wheelchair"
                  checked={needsWheelchair}
                  onChange={setNeedsWheelchair}
                />
                <ToggleRow
                  testId="about-you-needs-other"
                  label="Other (tell us)"
                  checked={needsOther}
                  onChange={setNeedsOther}
                />

                {needsOther && (
                  <Field label="What do you need?">
                    <textarea
                      data-testid="about-you-other-notes"
                      value={otherNotes}
                      onChange={(e) => setOtherNotes(e.target.value.slice(0, MAX_OTHER_NOTES))}
                      rows={2}
                      maxLength={MAX_OTHER_NOTES}
                      placeholder="Tell us what you need"
                      className="w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
                    />
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <p className="text-xs text-text-secondary">
                        We don't have a feature for this yet — we'd love to hear how Tago can help.
                      </p>
                      <p className="shrink-0 text-xs text-text-secondary">{otherNotes.length}/{MAX_OTHER_NOTES}</p>
                    </div>
                  </Field>
                )}

                {needsWheelchair && (
                  <div className="rounded-2xl border border-border bg-white p-4">
                    <ToggleRow
                      testId="about-you-needs-caregiver"
                      label="Caregiver usually with me"
                      checked={needsCaregiver}
                      onChange={setNeedsCaregiver}
                    />
                    <div className="mt-3 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                        Caregiver seat fee
                      </p>
                      <Tier label="Short trip (<10 mi)"    value="+$3" />
                      <Tier label="Medium trip (10–50 mi)" value="+$5" />
                      <Tier label="Long trip (>50 mi)"     value="+$8" />
                    </div>
                    {wantsCaregiverFlow && (
                      <p
                        data-testid="about-you-caregiver-hint"
                        className="mt-3 text-xs font-semibold text-primary"
                      >
                        We'll set up your caregiver next.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>

          {error && (
            <p data-testid="about-you-error" role="alert" className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <PrimaryButton
            data-testid="about-you-continue"
            type="submit"
            isLoading={isSaving}
            loadingLabel="Saving…"
          >
            Continue
          </PrimaryButton>

          <button
            type="button"
            data-testid="about-you-skip"
            onClick={skip}
            disabled={isSaving}
            className="text-sm font-semibold text-text-secondary py-2 disabled:opacity-50"
          >
            Skip for now
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Atoms ─────────────────────────────────────────────────────────────

function Section({
  header,
  children,
}: {
  header: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
        {header}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-text-primary">{label}</span>
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
      <div className="text-sm">
        <p className="font-semibold text-text-primary">{label}</p>
        {description && <p className="mt-0.5 text-xs text-text-secondary">{description}</p>}
      </div>
    </label>
  )
}

function Tier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-primary">{label}</span>
      <span className="font-semibold text-primary">{value}</span>
    </div>
  )
}
