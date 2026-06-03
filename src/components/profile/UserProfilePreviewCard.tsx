/**
 * v1.3 Sprint 10 Slice 5 — canonical "view someone else's profile"
 * card. Mirrors iOS DesignSystem/Components/UserProfilePreviewCard.swift
 * lines 11-248.
 *
 * Designed to be embedded inside a BottomSheet — does NOT own its own
 * navigation chrome (the sheet wrapper renders the Close button + title).
 *
 * Reads from GET /api/users/:id/public-profile (server contract at
 * server/routes/users.ts:337-462). The host (`UserProfilePreviewSheet`)
 * seeds the card instantly from a snapshot when the caller already has
 * partial fields, then upgrades in place once the fetch lands — no
 * spinner flash.
 */
import type { PublicProfile, PublicVehicle } from '@/lib/publicProfile'

interface UserProfilePreviewCardProps {
  profile: PublicProfile
  'data-testid'?: string
}

function schoolChipText(profile: PublicProfile): string {
  // Mirrors iOS lines 103-112: "UC Davis · CS · '27" built from the
  // three optional fields. Returns empty when the user has filled none
  // so the chip hides cleanly.
  const parts: string[] = []
  if (profile.school != null && profile.school.length > 0) parts.push(profile.school)
  if (profile.major != null && profile.major.length > 0) parts.push(profile.major)
  if (profile.graduation_year != null) {
    const suffix = String(profile.graduation_year).slice(-2)
    parts.push(`'${suffix}`)
  }
  return parts.join(' · ')
}

function vehicleHeadline(vehicle: PublicVehicle): string {
  // Mirrors iOS lines 215-222: "2021 Silver Toyota Camry" built from
  // year + color + make + model. Falls back to a generic label when
  // every field is empty.
  const parts: string[] = []
  if (vehicle.year != null) parts.push(String(vehicle.year))
  if (vehicle.color != null && vehicle.color.length > 0) parts.push(vehicle.color)
  if (vehicle.make != null && vehicle.make.length > 0) parts.push(vehicle.make)
  if (vehicle.model != null && vehicle.model.length > 0) parts.push(vehicle.model)
  return parts.length === 0 ? "Driver's vehicle" : parts.join(' ')
}

function metaRowText(profile: PublicProfile): string {
  // Mirrors iOS lines 229-237: "Member since Apr 2026 · 47 rides on Tago"
  const bits: string[] = []
  if (profile.member_since != null && profile.member_since.length > 0) {
    const d = new Date(profile.member_since)
    if (!Number.isNaN(d.getTime())) {
      const monthYear = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      bits.push(`Member since ${monthYear}`)
    }
  }
  if (profile.rides_completed > 0) {
    const ride = profile.rides_completed === 1 ? 'ride' : 'rides'
    bits.push(`${profile.rides_completed} ${ride} on Tago`)
  }
  return bits.join(' · ')
}

interface BadgeProps {
  icon: 'car' | 'wheelchair' | 'heart'
  label: string
}

function Badge({ icon, label }: BadgeProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-1 border border-primary/30">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3 w-3 text-primary"
        aria-hidden="true"
      >
        {icon === 'car' && (
          <path d="M5 11l1.5-4h11L19 11h2v6h-2v2h-2v-2H7v2H5v-2H3v-6h2zm2 0h10l-1-3H8l-1 3zm-1 4a1 1 0 100-2 1 1 0 000 2zm12 0a1 1 0 100-2 1 1 0 000 2z" />
        )}
        {icon === 'wheelchair' && (
          <path d="M13 4a2 2 0 100-4 2 2 0 000 4zm-2 2v6h4l3 5 1.5-1-3-6h-3V6h-2.5zm-1 8a4 4 0 100 8 4 4 0 003.8-2.6l-1.7-.6a2.3 2.3 0 11-2.6-3l-.5-1.6A4 4 0 0010 14z" />
        )}
        {icon === 'heart' && (
          <path d="M12 21s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 11c0 5.5-7 10-7 10z" />
        )}
      </svg>
      <span className="text-xs font-semibold text-text-primary">{label}</span>
    </div>
  )
}

export default function UserProfilePreviewCard({
  profile,
  'data-testid': testId = 'user-profile-preview',
}: UserProfilePreviewCardProps) {
  const chipText = schoolChipText(profile)
  const meta = metaRowText(profile)
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-5 px-5 pt-4 pb-6"
    >
      {/* Avatar — iOS lines 36-59 */}
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-surface border border-white/30 shadow-sm">
        {profile.avatar_url != null && profile.avatar_url.length > 0 ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- decorative; user name is rendered as sibling text
          <img
            src={profile.avatar_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10" aria-hidden="true">
              <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" />
            </svg>
          </div>
        )}
      </div>

      {/* Header — name + rating + school chip (iOS 69-98) */}
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="text-[22px] font-bold text-text-primary text-center">
          {profile.full_name ?? 'Tago user'}
        </h2>
        {profile.rating_avg != null && profile.rating_count > 0 ? (
          <div className="flex items-center gap-1 text-[13px] font-medium text-text-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-warning" aria-hidden="true">
              <path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 17.5 5.5 21.5 7 14.5 2 9.5l7-1z" />
            </svg>
            <span>
              {profile.rating_avg.toFixed(1)} · {profile.rating_count} {profile.rating_count === 1 ? 'rating' : 'ratings'}
            </span>
          </div>
        ) : (
          <span className="text-[13px] font-medium text-text-secondary">New on Tago</span>
        )}
        {chipText.length > 0 && (
          <span
            data-testid="user-profile-preview-school-chip"
            className="rounded-full bg-primary/12 px-2.5 py-1 text-xs font-semibold text-primary"
          >
            {chipText}
          </span>
        )}
      </div>

      {/* Badge row (iOS 116-129) */}
      {(profile.is_driver || profile.needs_wheelchair || profile.waive_caregiver_fee) && (
        <div className="flex flex-wrap justify-center gap-2" data-testid="user-profile-preview-badges">
          {profile.is_driver && <Badge icon="car" label="Driver" />}
          {profile.needs_wheelchair && <Badge icon="wheelchair" label="Mobility aid access" />}
          {profile.waive_caregiver_fee && <Badge icon="heart" label="Waives caregiver fee" />}
        </div>
      )}

      {/* Bio (iOS 150-168) */}
      {profile.bio != null && profile.bio.length > 0 && (
        <section
          data-testid="user-profile-preview-bio"
          className="w-full self-stretch rounded-2xl bg-surface p-4"
        >
          <p className="text-[11px] font-extrabold tracking-wider text-text-secondary">ABOUT</p>
          <p className="mt-1.5 whitespace-pre-line text-sm text-text-primary">{profile.bio}</p>
        </section>
      )}

      {/* Vehicle (iOS 172-213) */}
      {profile.vehicle != null && (
        <section
          data-testid="user-profile-preview-vehicle"
          className="w-full self-stretch rounded-2xl bg-surface p-4"
        >
          <p className="text-[11px] font-extrabold tracking-wider text-text-secondary">VEHICLE</p>
          <div className="mt-2 flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 shrink-0 text-primary" aria-hidden="true">
              <path d="M5 11l1.5-4h11L19 11h2v6h-2v2h-2v-2H7v2H5v-2H3v-6h2zm2 0h10l-1-3H8l-1 3zm-1 4a1 1 0 100-2 1 1 0 000 2zm12 0a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-[15px] font-semibold text-text-primary">{vehicleHeadline(profile.vehicle)}</p>
              {profile.vehicle.plate_last4 != null && profile.vehicle.plate_last4.length > 0 && (
                <p className="text-xs font-medium text-text-secondary">Plate ••{profile.vehicle.plate_last4}</p>
              )}
              {profile.vehicle.wheelchair_capable && (
                <p className="flex items-center gap-1 text-xs font-medium text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                    <path d="M13 4a2 2 0 100-4 2 2 0 000 4zm-2 2v6h4l3 5 1.5-1-3-6h-3V6h-2.5zm-1 8a4 4 0 100 8 4 4 0 003.8-2.6l-1.7-.6a2.3 2.3 0 11-2.6-3l-.5-1.6A4 4 0 0010 14z" />
                  </svg>
                  Space for a mobility aid
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Meta row (iOS 228-247) */}
      {meta.length > 0 && (
        <p
          data-testid="user-profile-preview-meta"
          className="text-xs font-medium text-text-secondary text-center"
        >
          {meta}
        </p>
      )}
    </div>
  )
}
