/**
 * v1.3 Sprint 10 Slice 5 — generic sheet wrapper that fetches a
 * `PublicProfile` by user id and renders `UserProfilePreviewCard`.
 * Mirrors iOS DesignSystem/Components/UserProfilePreviewCard.swift
 * lines 259-397 (UserProfilePreviewSheet struct).
 *
 * Wire from any avatar-tap site that already has the counterparty's
 * user id (RideBoardCard, BoardOfferAcceptPage driver row, etc.).
 *
 * Loading + error states are first-class — falls back to a skeleton
 * with the seed fields when present, or an error state with a Try
 * again button when neither seed nor fetch succeed. With an
 * `initialProfile` seed, a network blip is invisible to the user —
 * they keep seeing the seeded card while the background fetch
 * silently retries on the next open.
 */
import { useEffect, useState, useCallback } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import UserProfilePreviewCard from './UserProfilePreviewCard'
import {
  fetchPublicProfile,
  PublicProfileApiException,
  type PublicProfile,
} from '@/lib/publicProfile'

interface UserProfilePreviewSheetProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  /** Optional seed — when the caller already has the user's name +
   *  avatar + rating + role flags (e.g. tapping a poster on the Ride
   *  Board, or a driver card on BoardOfferAcceptPage), pass them here
   *  so the sheet renders the card immediately instead of showing the
   *  skeleton-then-flash. The background fetch still runs and quietly
   *  upgrades the card once bio / school / vehicle / etc. arrive. */
  initialProfile?: PublicProfile | null
  /** Fallback chrome when there's no `initialProfile` — just enough
   *  to show "I'm loading a profile for X" without a blank sheet. */
  fallbackName?: string | null
  fallbackAvatarUrl?: string | null
  'data-testid'?: string
}

export default function UserProfilePreviewSheet({
  isOpen,
  onClose,
  userId,
  initialProfile = null,
  fallbackName = null,
  fallbackAvatarUrl = null,
  'data-testid': testId = 'user-profile-preview-sheet',
}: UserProfilePreviewSheetProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(initialProfile)
  const [loading, setLoading] = useState<boolean>(initialProfile == null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const fetched = await fetchPublicProfile(userId)
      setProfile(fetched)
      setLoading(false)
    } catch (err) {
      // Only surface error UI when there's NO data at all to show.
      // With an `initialProfile` seed, a network blip is invisible to
      // the user — they keep seeing the partial card that opened with
      // the sheet. Matches iOS behavior at lines 334-343.
      setProfile((prev) => {
        if (prev == null) {
          const msg = err instanceof PublicProfileApiException ? err.message : "Couldn't load profile."
          setError(msg)
        }
        return prev
      })
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!isOpen) return
    // Reset state for the new userId on each open. The card render
    // below short-circuits to the seed during the very first frame
    // before the fetch lands.
    setProfile(initialProfile)
    setLoading(initialProfile == null)
    setError(null)
    void load()
  }, [isOpen, userId, initialProfile, load])

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Profile"
      data-testid={testId}
    >
      {profile != null ? (
        <UserProfilePreviewCard profile={profile} />
      ) : loading ? (
        <div
          data-testid="user-profile-preview-skeleton"
          className="flex flex-col items-center gap-4 px-5 pt-4 pb-8"
        >
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-surface">
            {fallbackAvatarUrl != null && fallbackAvatarUrl.length > 0 && (
              // alt="" marks the image as decorative; the fallback
              // name is rendered as sibling text below.
              <img src={fallbackAvatarUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <p className="text-[22px] font-bold text-text-primary">
            {fallbackName ?? 'Loading…'}
          </p>
          <div className="h-5 w-5 animate-spin rounded-full border-[2px] border-primary border-t-transparent" />
        </div>
      ) : (
        <div
          data-testid="user-profile-preview-error"
          className="flex flex-col items-center gap-4 px-5 pt-8 pb-8 text-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9 text-warning" aria-hidden="true">
            <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 5h2v8h-2V7zm0 10h2v2h-2v-2z" />
          </svg>
          <p className="text-sm font-medium text-text-secondary">{error ?? 'Profile unavailable'}</p>
          <button
            type="button"
            onClick={() => { void load() }}
            data-testid="user-profile-preview-retry"
            className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white active:opacity-90"
          >
            Try again
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
