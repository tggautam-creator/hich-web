import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import { updateMyProfile } from '@/lib/profileApi'
import { useMyStats } from '@/hooks/useMyStats'
import BottomNav from '@/components/ui/BottomNav'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import AppIcon from '@/components/ui/AppIcon'
import VehicleIcon from '@/components/ui/VehicleIcon'
import TrustBadges from '@/components/ui/TrustBadges'
import type { Ride, DriverRoutine, Vehicle, SavedAddress } from '@/types/database'
import AddressPickerModal from '@/components/ride/AddressPickerModal'

// v1.2 Sprint 7 Slice 2 — lazy-loaded so the sheet's React Query /
// supabase write dependencies don't inflate the ProfilePage chunk.
const EditProfileSheet  = lazy(() => import('@/components/profile/EditProfileSheet'))
// v1.2 Sprint 6 Slice 2 — caregivers section. Only mounted for
// users with hasAccessibilityNeeds=true so non-accessibility riders
// don't see the section at all (matching iOS gate).
const CaregiversSection = lazy(() => import('@/components/profile/CaregiversSection'))
// v1.3 Sprint 11 Slice 2 — trusted contacts section. Universal
// mount (no accessibility gate) — every rider and driver can save
// up to 5 emergency contacts. Mirrors iOS ProfilePage.swift:113.
const TrustedContactsSection = lazy(() => import('@/components/profile/TrustedContactsSection'))

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfilePageProps {
  'data-testid'?: string
}

interface RideWithRole extends Ride {
  role: 'rider' | 'driver'
  other_name?: string
  other_avatar_url?: string | null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfilePage({ 'data-testid': testId }: ProfilePageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [rides, setRides] = useState<RideWithRole[]>([])
  const [loadingRides, setLoadingRides] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  // v1.3 Sprint 12 Slice 5b — server-fresh ride count + rating.
  // Replaces the previous `rides.length` count which under-counted
  // any user with more than 50 rides as either rider or driver
  // (the loadRides query caps at 50 per role). Matches iOS
  // ProfilePage.loadUserStats() pattern: cached `auth.profile`
  // values seed TrustBadges so the row never pops in — it just
  // sharpens once the server response lands.
  const { data: stats } = useMyStats({ enabled: Boolean(profile?.id) })

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // v1.3 — accessibility editor state (mirrors iOS EditProfileSheet
  // accessNeedsSection + waiveCaregiverFeeSection). Seeded from
  // profile on entering edit mode; saved through `updateMyProfile`.
  const [editHasAccessibilityNeeds, setEditHasAccessibilityNeeds] = useState(false)
  const [editNeedsWheelchair, setEditNeedsWheelchair] = useState(false)
  const [editNeedsCaregiver, setEditNeedsCaregiver] = useState(false)
  const [editNeedsOther, setEditNeedsOther] = useState(false)
  const [editOtherNotes, setEditOtherNotes] = useState('')
  const [editWaiveCaregiverFee, setEditWaiveCaregiverFee] = useState(false)

  // Saved routes state
  const [routines, setRoutines] = useState<DriverRoutine[]>([])
  const [loadingRoutines, setLoadingRoutines] = useState(true)
  const [togglingRoute, setTogglingRoute] = useState<string | null>(null)
  const [deletingRoute, setDeletingRoute] = useState<string | null>(null)

  // Vehicle state
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loadingVehicle, setLoadingVehicle] = useState(true)
  const [removingVehicle, setRemovingVehicle] = useState<string | null>(null)
  const [settingActive, setSettingActive] = useState<string | null>(null)

  // QR sheet state
  const [qrOpen, setQrOpen] = useState(false)

  // Saved addresses state
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([])
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  const [addressPickerOpen, setAddressPickerOpen] = useState(false)
  const [addressPresetLabel, setAddressPresetLabel] = useState<'home' | 'work' | null>(null)
  const [deletingAddress, setDeletingAddress] = useState<string | null>(null)

  // Avatar upload state
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // v1.2 Sprint 7 Slice 2 — EditProfileSheet (v1.2 fields only). The
  // existing inline name+phone edit stays as the quick-edit path.
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false)

  // Refresh profile to get latest wallet_balance
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  // Sync edit fields when profile loads or editing starts
  useEffect(() => {
    if (editing) {
      setEditName(profile?.full_name ?? '')
      setEditPhone(profile?.phone ?? '')
      // v1.3 — accessibility seed. Mirrors iOS EditProfileSheet onAppear
      // (EditProfileSheet.swift:160-168). Loads the current values so
      // toggles render in the right state; save sends only what changed.
      const accProfile = profile?.accessibility_profile ?? {}
      const hasNeeds = profile?.has_accessibility_needs === true
      const notes = accProfile.other_notes ?? ''
      setEditHasAccessibilityNeeds(hasNeeds)
      setEditNeedsWheelchair(accProfile.needs_wheelchair === true)
      setEditNeedsCaregiver(accProfile.needs_caregiver === true)
      setEditNeedsOther(notes.length > 0)
      setEditOtherNotes(notes)
      setEditWaiveCaregiverFee(profile?.waive_caregiver_fee === true)
      setEditError(null)
    }
  }, [editing, profile])

  // ── Load ride history ──────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id) return

    const userId = profile.id

    async function loadRides() {
      const { data: asRider } = await supabase
        .from('rides')
        .select('*')
        .eq('rider_id', userId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(50)

      const { data: asDriver } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', userId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(50)

      const uniqueMap = new Map<string, RideWithRole>()
      for (const r of asRider ?? []) {
        if (!uniqueMap.has(r.id)) uniqueMap.set(r.id, { ...r, role: 'rider' })
      }
      for (const r of asDriver ?? []) {
        if (!uniqueMap.has(r.id)) uniqueMap.set(r.id, { ...r, role: 'driver' })
      }

      const sorted = Array.from(uniqueMap.values()).sort(
        (a, b) => new Date(b.ended_at ?? b.created_at).getTime() - new Date(a.ended_at ?? a.created_at).getTime(),
      )

      const otherUserIds = sorted
        .map((ride) => (ride.role === 'driver' ? ride.rider_id : ride.driver_id))
        .filter((id): id is string => Boolean(id))
      const uniqueOtherIds = [...new Set(otherUserIds)]

      let userLookup: Record<string, { full_name: string | null; avatar_url: string | null }> = {}
      if (uniqueOtherIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name, avatar_url')
          .in('id', uniqueOtherIds)

        if (users) {
          userLookup = Object.fromEntries(
            users.map((u) => [u.id, { full_name: u.full_name, avatar_url: u.avatar_url }]),
          )
        }
      }

      const enriched = sorted.map((ride) => {
        const otherId = ride.role === 'driver' ? ride.rider_id : ride.driver_id
        const other = otherId ? userLookup[otherId] : undefined
        return {
          ...ride,
          other_name: other?.full_name ?? undefined,
          other_avatar_url: other?.avatar_url ?? null,
        }
      })

      setRides(enriched)
      setLoadingRides(false)
    }

    void loadRides()
  }, [profile?.id])

  // ── Load saved routes ──────────────────────────────────────────────────
  const loadRoutines = useCallback(async () => {
    if (!profile?.id) return
    setLoadingRoutines(true)
    const { data } = await supabase
      .from('driver_routines')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })

    setRoutines((data ?? []) as unknown as DriverRoutine[])
    setLoadingRoutines(false)
  }, [profile?.id])

  useEffect(() => { void loadRoutines() }, [loadRoutines])

  // ── Load vehicles ────────────────────────────────────────────────────
  const loadVehicles = useCallback(async () => {
    if (!profile?.id || !profile.is_driver) {
      setLoadingVehicle(false)
      return
    }
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', profile.id)
      .order('is_active', { ascending: false })
    // Filter out soft-deleted vehicles client-side
    const active = ((data ?? []) as Vehicle[]).filter((v) => !v.deleted_at)
    setVehicles(active)
    setLoadingVehicle(false)
  }, [profile?.id, profile?.is_driver])

  useEffect(() => { void loadVehicles() }, [loadVehicles])

  // ── Set active vehicle ──────────────────────────────────────────────
  const handleSetActive = async (vehicleId: string) => {
    if (!profile?.id) return
    setSettingActive(vehicleId)
    // Deactivate all non-deleted, then activate selected
    await supabase
      .from('vehicles')
      .update({ is_active: false })
      .eq('user_id', profile.id)
      .eq('is_active', true)
    await supabase
      .from('vehicles')
      .update({ is_active: true })
      .eq('id', vehicleId)
    await loadVehicles()
    setSettingActive(null)
  }

  // ── Remove vehicle (soft delete) ───────────────────────────────────
  const handleRemoveVehicle = async (vehicleId: string) => {
    if (!profile?.id) return
    if (vehicles.length <= 1) {
      window.alert('You must add a new vehicle before removing your only one. Drivers need at least one vehicle to receive ride requests.')
      return
    }
    if (!window.confirm('Remove this vehicle? It will no longer appear in your list.')) return
    setRemovingVehicle(vehicleId)
    await supabase
      .from('vehicles')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', vehicleId)

    // If no vehicles remain, unset is_driver
    const { data: allVehicles } = await supabase
      .from('vehicles')
      .select('id, deleted_at')
      .eq('user_id', profile.id)
    const remaining = (allVehicles ?? []).filter((v: { deleted_at: string | null }) => !v.deleted_at)
    if (!remaining || remaining.length === 0) {
      // v1.3 Sprint 12 Slice 5a — `is_driver` stays a direct supabase
      // write here for parity with iOS `UsersDriverFlagRepository` at
      // ios/Tago/Core/Supabase/Repositories/VehiclesRepository.swift:148.
      // POST /api/users/me/profile doesn't accept `is_driver` (it's
      // not in the validated allow-list), and iOS itself uses direct
      // RLS-gated update for this side-effect.
      await supabase.from('users').update({ is_driver: false }).eq('id', profile.id)
      await refreshProfile()
    } else {
      // If the removed vehicle was active, auto-activate the first remaining
      const wasActive = vehicles.find((v) => v.id === vehicleId)?.is_active
      if (wasActive && remaining.length > 0) {
        await supabase
          .from('vehicles')
          .update({ is_active: true })
          .eq('id', remaining[0].id)
      }
    }
    await loadVehicles()
    setRemovingVehicle(null)
  }

  // ── Load saved addresses ────────────────────────────────────────────
  const loadAddresses = useCallback(async () => {
    if (!profile?.id) return
    setLoadingAddresses(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setLoadingAddresses(false); return }

    const resp = await fetch('/api/addresses', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      const body = await resp.json() as { addresses: SavedAddress[] }
      setSavedAddresses(body.addresses ?? [])
    }
    setLoadingAddresses(false)
  }, [profile?.id])

  useEffect(() => { void loadAddresses() }, [loadAddresses])

  const handleDeleteAddress = async (id: string) => {
    setDeletingAddress(id)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (token) {
      await fetch(`/api/addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    await loadAddresses()
    setDeletingAddress(null)
  }

  // ── Avatar upload ────────────────────────────────────────────────────
  const handleAvatarUpload = async (file: File) => {
    if (!profile?.id) return
    setUploadingAvatar(true)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${profile.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { setUploadingAvatar(false); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    // v1.3 Sprint 12 Slice 5a — server-mediated profile write.
    // Matches iOS AuthStore.upsertProfile path.
    try {
      await updateMyProfile({ avatar_url: urlData.publicUrl })
      await refreshProfile()
    } catch {
      // Avatar upload succeeded but profile write failed — leave the
      // file in storage; user can retry. Silent here keeps the avatar
      // picker UX intact (no scary modal mid-upload).
    }
    setUploadingAvatar(false)
  }

  // ── Save profile edits ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!profile?.id) return
    const trimmedName = editName.trim()
    if (!trimmedName) {
      setEditError('Name is required')
      return
    }

    setSaving(true)
    setEditError(null)

    const newPhone = editPhone.trim() || null

    // v1.3 Sprint 12 Slice 5a — server-mediated profile write.
    // Routes through POST /api/users/me/profile so this path stays
    // parity-aligned with iOS `AuthStore.upsertProfile` + bypasses
    // the RLS race the direct supabase.from('users').update used to
    // hit on first-time signup-row creation.
    //
    // `phone_verified` is intentionally NOT touched here. iOS
    // EditProfileSheet doesn't flip it either — AuthGuard owns the
    // verification routing on the next session via
    // VITE_SKIP_PHONE_VERIFICATION. See WEB_PARITY_REPORT W-T0-8.
    // v1.3 — accessibility fold (mirrors iOS EditProfileSheet.save).
    // When the top toggle is off, we send empty sub-fields so the
    // server clears any previously-saved wheelchair/caregiver/other
    // state. When on, the JSONB profile carries only the fields the
    // user enabled — empty other_notes maps to null so the column
    // doesn't accumulate stale strings after the user turns off
    // "Other".
    const otherNotesClean = editOtherNotes.trim().slice(0, 200)
    const accessibilityProfile = editHasAccessibilityNeeds
      ? {
          needs_wheelchair: editNeedsWheelchair,
          needs_caregiver: editNeedsCaregiver,
          other_notes: editNeedsOther && otherNotesClean.length > 0 ? otherNotesClean : null,
        }
      : {
          needs_wheelchair: false,
          needs_caregiver: false,
          other_notes: null,
        }

    try {
      await updateMyProfile({
        full_name: trimmedName,
        phone: newPhone,
        has_accessibility_needs: editHasAccessibilityNeeds,
        accessibility_profile: accessibilityProfile,
        // Driver-only flag — sending it from a non-driver is harmless
        // (server validates booleans + ignores invalid values), but the
        // toggle UI is also gated on `profile.is_driver` so this only
        // changes when a driver explicitly flipped it.
        ...(profile?.is_driver ? { waive_caregiver_fee: editWaiveCaregiverFee } : {}),
      })
    } catch {
      setEditError('Failed to save changes')
      setSaving(false)
      return
    }

    await refreshProfile()
    setSaving(false)
    setEditing(false)
  }

  // ── Toggle route active/paused ─────────────────────────────────────────
  const handleToggleRoute = async (routineId: string, currentActive: boolean) => {
    setTogglingRoute(routineId)
    await supabase
      .from('driver_routines')
      .update({ is_active: !currentActive })
      .eq('id', routineId)

    setRoutines((prev) =>
      prev.map((r) => (r.id === routineId ? { ...r, is_active: !currentActive } : r)),
    )
    setTogglingRoute(null)
  }

  // ── Delete route ───────────────────────────────────────────────────────
  const handleDeleteRoute = async (routineId: string) => {
    setDeletingRoute(routineId)
    await supabase
      .from('driver_routines')
      .delete()
      .eq('id', routineId)

    setRoutines((prev) => prev.filter((r) => r.id !== routineId))
    setDeletingRoute(null)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate('/', { replace: true })
  }

  const initial = profile?.full_name?.[0]?.toUpperCase() ?? '?'

  return (
    <div data-testid={testId ?? 'profile-page'} className="flex min-h-dvh flex-col bg-surface font-sans pb-20">

      {/* ── Sticky top bar ──────────────────────────────────────────────
          iOS ProfilePage uses .navigationTitle("Profile") inline + a
          settings gear in the toolbar. Web mirrors with a sticky
          translucent bar matching the rider/driver home pattern. */}
      <div
        data-testid="profile-top-bar"
        className="sticky top-0 z-30 bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <h1 className="text-base font-bold text-text-primary">Profile</h1>
        <button
          data-testid="settings-button"
          onClick={() => navigate('/settings')}
          aria-label="Settings"
          className="p-1.5 rounded-lg active:bg-surface transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-secondary" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* ── iOS-parity hero ────────────────────────────────────────────
          ios/Tago/Features/Profile/ProfilePage.swift:351 (`profileHero`).
          Brand-gradient backdrop that bleeds to the screen edges, large
          centered avatar, name in heavy display type, identity rows
          (email + phone) stacked underneath, education chip + registered
          driver pill, trust badges row, Edit pill anchored in the
          top-right. Replaces the prior tight horizontal user-card. */}
      <div
        data-testid="profile-hero"
        className="relative px-6 pt-6 pb-6"
        style={{
          background: 'linear-gradient(180deg, rgba(58,90,228,0.18) 0%, rgba(58,90,228,0.06) 55%, transparent 100%)',
        }}
      >
        {/* Edit pill — top-right, anchored absolutely so the avatar
            stays centered without competing for space. */}
        <button
          data-testid="edit-profile-button"
          onClick={() => setEditing(true)}
          className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-white/85 backdrop-blur-sm px-3 py-1.5 text-xs font-extrabold text-primary border border-white/70 shadow-sm active:scale-95 transition-transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>

        <div className="flex flex-col items-center gap-2">
          {/* Avatar — 96px tap target, opens the file picker. */}
          <button
            data-testid="avatar-button"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-3xl shrink-0 overflow-hidden relative disabled:opacity-50 border-4 border-white shadow-md"
          >
            {uploadingAvatar ? (
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAvatarUpload(f) }}
          />

          {/* Name + bio + identity rows */}
          <h2
            data-testid="profile-name"
            className="text-2xl font-extrabold text-text-primary text-center tracking-tight mt-1"
          >
            {profile?.full_name ?? '—'}
          </h2>
          {profile?.bio && profile.bio.length > 0 && (
            <p
              data-testid="profile-bio"
              className="text-sm text-text-secondary text-center line-clamp-3 max-w-xs"
            >
              {profile.bio}
            </p>
          )}
          <div className="flex flex-col items-center gap-0.5">
            {profile?.email && (
              <p data-testid="profile-email" className="text-xs text-text-secondary">
                {profile.email}
              </p>
            )}
            {profile?.phone && (
              <p data-testid="profile-phone" className="text-xs text-text-secondary">
                {profile.phone}
              </p>
            )}
          </div>

          {/* Driver pill — iOS registeredDriverPill */}
          {profile?.is_driver && (
            <div
              data-testid="profile-registered-driver-pill"
              className="inline-flex items-center gap-1.5 rounded-full bg-success/15 border border-success/30 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-success uppercase mt-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                <path fillRule="evenodd" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" clipRule="evenodd" />
              </svg>
              Registered Driver
            </div>
          )}

          {/* Education chip — iOS schoolMajorChip */}
          {(() => {
            const parts: string[] = []
            if (profile?.school) parts.push(profile.school)
            if (profile?.major) parts.push(profile.major)
            if (profile?.graduation_year) parts.push(`Class of ${profile.graduation_year}`)
            if (parts.length === 0) return null
            return (
              <div
                data-testid="profile-education-chip"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-2.5 py-1 text-[11px] font-semibold text-primary"
              >
                <AppIcon name="graduation" className="h-3 w-3" />
                <span className="truncate max-w-[18rem]">{parts.join(' · ')}</span>
              </div>
            )
          })()}

          {/* Trust badges */}
          <TrustBadges
            email={profile?.email}
            ratingAvg={stats?.ratingAvg ?? profile?.rating_avg ?? null}
            ratingCount={stats?.ratingCount ?? profile?.rating_count ?? 0}
            ridesCompleted={stats?.ridesCompleted ?? rides.length}
            size="md"
            className="mt-1"
          />
        </div>
      </div>

      {/* ── Inline edit panel ────────────────────────────────────────
          Wraps the existing name + phone inputs (and accessibility
          editor + save / cancel actions) in a card below the hero
          when editing=true. iOS uses an EditProfileSheet for richer
          fields; web keeps the inline quick-edit path on a separate
          card so the existing tests don't change. */}
      {editing && (
        <div data-testid="profile-edit-panel" className="bg-white mx-4 mt-4 rounded-2xl p-4 shadow-sm border border-border space-y-3">
          <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">
            Edit profile
          </p>
          <input
            data-testid="edit-name-input"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
          />
          <input
            data-testid="edit-phone-input"
            type="tel"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
          />
          {editError && (
            <p data-testid="edit-error" className="text-xs text-danger">{editError}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              data-testid="save-profile-button"
              onClick={() => { void handleSave() }}
              disabled={saving}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              data-testid="cancel-edit-button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-text-secondary"
            >
              Cancel
            </button>
          </div>
          {/* Accessibility editor — same testids preserved */}
          <div data-testid="profile-accessibility-editor" className="mt-4 rounded-2xl bg-surface p-4 space-y-3">
            <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">
              Access needs
            </p>

            {/* Top toggle */}
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm text-text-primary">I have accessibility needs</span>
              <input
                data-testid="edit-has-accessibility-needs"
                type="checkbox"
                checked={editHasAccessibilityNeeds}
                onChange={(e) => setEditHasAccessibilityNeeds(e.target.checked)}
                className="h-5 w-5 rounded text-primary focus:ring-primary"
              />
            </label>

            {editHasAccessibilityNeeds && (
              <div className="space-y-3 pl-3 border-l-2 border-primary/20">
                {/* Wheelchair */}
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm text-text-primary inline-flex items-center gap-2">
                    <span aria-hidden="true">&#x267F;</span> Wheelchair
                  </span>
                  <input
                    data-testid="edit-needs-wheelchair"
                    type="checkbox"
                    checked={editNeedsWheelchair}
                    onChange={(e) => setEditNeedsWheelchair(e.target.checked)}
                    className="h-5 w-5 rounded text-primary focus:ring-primary"
                  />
                </label>

                {/* Caregiver — only shown when wheelchair is on, matching
                    iOS wheelchairCaregiverSubsection scope. */}
                {editNeedsWheelchair && (
                  <>
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="text-sm text-text-primary">Caregiver usually with me</span>
                      <input
                        data-testid="edit-needs-caregiver"
                        type="checkbox"
                        checked={editNeedsCaregiver}
                        onChange={(e) => setEditNeedsCaregiver(e.target.checked)}
                        className="h-5 w-5 rounded text-primary focus:ring-primary"
                      />
                    </label>
                    {/* Tiered fare explainer (iOS EditProfileSheet:419-432) */}
                    <div className="rounded-xl bg-primary/5 p-3 text-xs">
                      <p className="font-semibold text-text-secondary mb-1.5">Caregiver seat fee</p>
                      <div className="space-y-0.5 text-text-primary">
                        <div className="flex justify-between"><span>Short trip (&lt;10 mi)</span><span className="font-semibold">+$3</span></div>
                        <div className="flex justify-between"><span>Medium trip (10–50 mi)</span><span className="font-semibold">+$5</span></div>
                        <div className="flex justify-between"><span>Long trip (&gt;50 mi)</span><span className="font-semibold">+$8</span></div>
                      </div>
                    </div>
                  </>
                )}

                {/* Other */}
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm text-text-primary inline-flex items-center gap-2">
                    <span aria-hidden="true">&#x1F4AC;</span> Other (tell us)
                  </span>
                  <input
                    data-testid="edit-needs-other"
                    type="checkbox"
                    checked={editNeedsOther}
                    onChange={(e) => setEditNeedsOther(e.target.checked)}
                    className="h-5 w-5 rounded text-primary focus:ring-primary"
                  />
                </label>
                {editNeedsOther && (
                  <div>
                    <textarea
                      data-testid="edit-other-notes"
                      value={editOtherNotes}
                      onChange={(e) => setEditOtherNotes(e.target.value.slice(0, 200))}
                      placeholder="Tell us what you need"
                      rows={2}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none resize-none"
                    />
                    <div className="flex items-start justify-between gap-2 mt-1">
                      <p className="text-[11px] text-text-secondary leading-tight">
                        We don&rsquo;t have a feature for this yet — we&rsquo;d love to hear how Tago can help.
                      </p>
                      <span className="text-[11px] text-text-secondary shrink-0">{editOtherNotes.length}/200</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-text-secondary pt-1">
              Helps us match you with the right rides. Editable any time.
            </p>

            {/* Waive caregiver fees — driver-only (iOS:382-407) */}
            {profile?.is_driver && (
              <div className="mt-2 pt-3 border-t border-border">
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-text-primary">Waive caregiver seat fees</span>
                    <span className="block text-[11px] text-text-secondary leading-snug mt-0.5">
                      When on, you won&rsquo;t charge the $3–$8 caregiver add-on on any ride you accept. Riders still need a payment method; they just won&rsquo;t be charged the fee.
                    </span>
                  </span>
                  <input
                    data-testid="edit-waive-caregiver-fee"
                    type="checkbox"
                    checked={editWaiveCaregiverFee}
                    onChange={(e) => setEditWaiveCaregiverFee(e.target.checked)}
                    className="h-5 w-5 rounded text-primary focus:ring-primary mt-0.5"
                  />
                </label>
                <p className="text-[11px] text-text-secondary mt-1.5 leading-snug">
                  An act of goodwill — your call. Either choice is fine; the fee compensates you for the extra effort of helping with mobility aids and loading.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Quick Links section ────────────────────────────────────────
          iOS ProfilePage.swift:552 (`quickLinksSection`). Wraps
          Payment Methods + Payouts (driver) + Profile Details into a
          single card with row dividers, instead of nesting them
          inside the user-card chrome. */}
      <div data-testid="profile-quick-links" className="mx-4 mt-4 rounded-2xl bg-white border border-border divide-y divide-border overflow-hidden">
        <button
          data-testid="payment-methods-link"
          onClick={() => { navigate('/payment/methods') }}
          className="w-full flex items-center justify-between px-4 py-3 active:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </span>
            <span className="text-sm font-medium text-text-primary">Payment Methods</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {profile?.is_driver && (
          <button
            data-testid="payouts-link"
            onClick={() => { navigate('/stripe/payouts') }}
            className="w-full flex items-center justify-between px-4 py-3 active:bg-surface transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center text-success">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <span className="text-sm font-medium text-text-primary">Payouts</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
          </svg>
          </button>
        )}

        <button
          type="button"
          data-testid="profile-details-button"
          onClick={() => setProfileDetailsOpen(true)}
          className="w-full flex items-center justify-between px-4 py-3 active:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="7" r="4" />
                <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
              </svg>
            </span>
            <span className="text-sm font-medium text-text-primary truncate">Bio, education & access needs</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* v1.2 Sprint 6 Slice 2 — Caregivers section. Gated on
          has_accessibility_needs so non-accessibility riders never
          see it (matching iOS ProfilePage gate). */}
      {profile?.has_accessibility_needs === true && (
        <Suspense fallback={null}>
          <CaregiversSection />
        </Suspense>
      )}

      {/* v1.3 Sprint 11 Slice 2 — Trusted Contacts section. NOT
          gated — every signed-in user can save up to 5 emergency
          contacts. Mirrors iOS canonical mount on
          ProfilePage.swift:113 (ProfileSafetySection). The
          EmergencySheet's "Text my trusted contacts" CTA and the
          Slice 4b RideSafetyCheckOverlay "Get help" branch both
          read this list. */}
      <Suspense fallback={null}>
        <TrustedContactsSection />
      </Suspense>

      {/* ── Saved Places ────────────────────────────────────────────────── */}
      <div className="mx-4 mt-4" data-testid="saved-places-section">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Saved Places</h2>
        {loadingAddresses ? (
          <div className="flex justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-border divide-y divide-border">
            {/* Home preset */}
            {(() => {
              const home = savedAddresses.find((a) => a.label === 'home')
              return (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <path d="M3 10.5 12 3l9 7.5" />
                      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">Home</p>
                    {home ? (
                      <p className="text-xs text-text-secondary truncate">{home.main_text}</p>
                    ) : (
                      <button
                        onClick={() => { setAddressPresetLabel('home'); setAddressPickerOpen(true) }}
                        className="text-xs text-primary font-medium"
                        data-testid="add-home-address"
                      >
                        + Add home address
                      </button>
                    )}
                  </div>
                  {home && (
                    <button
                      onClick={() => handleDeleteAddress(home.id)}
                      disabled={deletingAddress === home.id}
                      className="p-1.5 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
                      data-testid="delete-home-address"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Work preset */}
            {(() => {
              const work = savedAddresses.find((a) => a.label === 'work')
              return (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <rect x="3" y="7" width="18" height="13" rx="2" />
                      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">Work</p>
                    {work ? (
                      <p className="text-xs text-text-secondary truncate">{work.main_text}</p>
                    ) : (
                      <button
                        onClick={() => { setAddressPresetLabel('work'); setAddressPickerOpen(true) }}
                        className="text-xs text-primary font-medium"
                        data-testid="add-work-address"
                      >
                        + Add work address
                      </button>
                    )}
                  </div>
                  {work && (
                    <button
                      onClick={() => handleDeleteAddress(work.id)}
                      disabled={deletingAddress === work.id}
                      className="p-1.5 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
                      data-testid="delete-work-address"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Custom addresses */}
            {savedAddresses
              .filter((a) => !a.is_preset)
              .map((addr) => (
                <div key={addr.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-lg">📍</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{addr.label}</p>
                    <p className="text-xs text-text-secondary truncate">{addr.main_text}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteAddress(addr.id)}
                    disabled={deletingAddress === addr.id}
                    className="p-1.5 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
                    data-testid={`delete-address-${addr.id}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}

            {/* Add custom address */}
            {savedAddresses.length < 10 && (
              <button
                onClick={() => { setAddressPresetLabel(null); setAddressPickerOpen(true) }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/5 transition-colors rounded-b-2xl"
                data-testid="add-custom-address"
              >
                <span className="text-base font-bold leading-none">+</span>
                Add Address
              </button>
            )}
          </div>
        )}
      </div>

      {/* Address picker modal */}
      <AddressPickerModal
        isOpen={addressPickerOpen}
        onClose={() => setAddressPickerOpen(false)}
        onSaved={() => void loadAddresses()}
        presetLabel={addressPresetLabel}
      />

      {/* ── My Vehicles ─────────────────────────────────────────────────── */}
      {profile?.is_driver && (
        <div className="mx-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary">My Vehicles</h2>
            <button
              data-testid="add-vehicle-button"
              onClick={() => navigate('/onboarding/vehicle?from=profile')}
              className="text-xs font-semibold text-primary"
            >
              + Add Vehicle
            </button>
          </div>
          {loadingVehicle ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            </div>
          ) : vehicles.length > 0 ? (
            <div className="flex flex-col gap-3">
              {vehicles.map((v) => (
                <div key={v.id} data-testid="vehicle-card" className="bg-white rounded-2xl p-4 border border-border">
                  <div className="flex items-center gap-3">
                    {v.car_photo_url ? (
                      <img
                        src={v.car_photo_url}
                        alt="Vehicle"
                        className="h-16 w-20 rounded-2xl object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-16 w-20 rounded-2xl bg-surface flex items-center justify-center shrink-0">
                        <VehicleIcon color={v.color.toLowerCase()} className="h-10 w-auto" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p data-testid="vehicle-name" className="text-sm font-semibold text-text-primary truncate">
                          {v.year} {v.make} {v.model}
                        </p>
                        {v.is_active && (
                          <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="h-3 w-3 rounded-full border border-border shrink-0"
                          style={{ backgroundColor: v.color.toLowerCase() }}
                        />
                        <span className="text-xs text-text-secondary">{v.color}</span>
                      </div>
                      <p data-testid="vehicle-plate" className="text-xs text-text-secondary mt-0.5">
                        {v.plate} · {v.seats_available} seat{v.seats_available !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      data-testid="edit-vehicle-button"
                      onClick={() => navigate(`/vehicle/edit/${v.id}`)}
                      className="flex-1 rounded-2xl py-2 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20 transition-colors"
                    >
                      Edit
                    </button>
                    {!v.is_active && (
                      <button
                        data-testid="set-active-button"
                        onClick={() => { void handleSetActive(v.id) }}
                        disabled={settingActive === v.id}
                        className="flex-1 rounded-2xl py-2 text-xs font-semibold text-success bg-success/10 active:bg-success/20 transition-colors disabled:opacity-50"
                      >
                        {settingActive === v.id ? 'Setting...' : 'Set Active'}
                      </button>
                    )}
                    <button
                      data-testid="remove-vehicle-button"
                      onClick={() => { void handleRemoveVehicle(v.id) }}
                      disabled={removingVehicle === v.id || vehicles.length <= 1}
                      title={vehicles.length <= 1 ? 'Add a new vehicle before removing your only one' : undefined}
                      className="rounded-2xl px-3 py-2 text-xs font-semibold text-danger bg-danger/10 active:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {removingVehicle === v.id ? '...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-6 text-center border border-border">
              <p className="text-sm text-text-secondary">No vehicle registered</p>
            </div>
          )}
        </div>
      )}

      {/* ── Driver QR Code ──────────────────────────────────────────────── */}
      {profile?.is_driver && (
        <div className="mx-4 mt-4">
          <button
            data-testid="qr-button"
            onClick={() => { setQrOpen(true) }}
            className="w-full bg-white rounded-2xl px-4 py-3 border border-border flex items-center gap-3 active:bg-surface transition-colors"
          >
            <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 text-primary" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="4" height="4" rx="0.5" />
                <line x1="21" y1="14" x2="21" y2="21" />
                <line x1="14" y1="21" x2="21" y2="21" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-text-primary">My Driver QR Code</p>
              <p className="text-xs text-text-secondary">Show to riders for ride verification</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Saved Routes ──────────────────────────────────────────────────── */}
      {/* v1.3 — visible for ALL users (rider + driver). Routines unified
          under driver_routines + mode column (migration 103). Previously
          gated on is_driver so rider-only users couldn't see their own
          rider routines — closes the iOS-parity gap where
          ProfileRoutinesSection.swift renders both kinds. */}
      {(profile?.is_driver || routines.length > 0) && (
        <div className="mx-4 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary">Saved Routines</h2>
            <div className="flex items-center gap-2">
              {/* Drivers see "+ Driver" + "+ Rider"; non-drivers see
                  just "+ Add Routine" (rider-side, since they can't
                  drive without a vehicle). */}
              {profile?.is_driver ? (
                <>
                  <button
                    data-testid="add-driver-routine-button"
                    onClick={() => navigate('/schedule/driver', { state: { tripType: 'routine' } })}
                    className="text-xs font-semibold text-primary"
                  >
                    + Driver
                  </button>
                  <button
                    data-testid="add-rider-routine-button"
                    onClick={() => navigate('/schedule/rider', { state: { tripType: 'routine' } })}
                    className="text-xs font-semibold text-primary"
                  >
                    + Rider
                  </button>
                </>
              ) : (
                <button
                  data-testid="add-routine-button"
                  onClick={() => navigate('/schedule/rider', { state: { tripType: 'routine' } })}
                  className="text-xs font-semibold text-primary"
                >
                  + Add Routine
                </button>
              )}
            </div>
          </div>

          {loadingRoutines ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            </div>
          ) : routines.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center border border-border">
              <p data-testid="no-routes" className="text-sm text-text-secondary">No saved routes yet</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="routes-list">
              {routines.map((routine) => (
                <div
                  key={routine.id}
                  data-testid={`route-${routine.id}`}
                  className="bg-white rounded-2xl px-4 py-3 border border-border"
                >
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <p className="text-sm font-semibold text-text-primary truncate flex-1">
                      {routine.route_name}
                    </p>
                    {/* v1.3 — mode badge so users with both rider AND
                        driver routines can tell them apart at a glance.
                        Matches iOS ProfileRoutinesSection.swift:401. */}
                    <span
                      data-testid={`route-mode-${routine.id}`}
                      className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full ${
                        routine.mode === 'rider'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-success/10 text-success'
                      }`}
                    >
                      {routine.mode === 'rider' ? 'Rider' : 'Driver'}
                    </span>
                    <span
                      data-testid={`route-status-${routine.id}`}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        routine.is_active
                          ? 'bg-success/10 text-success'
                          : 'bg-border text-text-secondary'
                      }`}
                    >
                      {routine.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>

                  {/* Days */}
                  <div className="flex gap-1 mb-1.5">
                    {routine.day_of_week.map((d) => (
                      <span
                        key={d}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                      >
                        {DAY_LABELS[d]}
                      </span>
                    ))}
                  </div>

                  {/* Time */}
                  <p className="text-xs text-text-secondary mb-2">
                    {routine.departure_time
                      ? `Departs ${routine.departure_time.slice(0, 5)}`
                      : routine.arrival_time
                        ? `Arrives ${routine.arrival_time.slice(0, 5)}`
                        : 'No time set'}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      data-testid={`toggle-route-${routine.id}`}
                      onClick={() => { void handleToggleRoute(routine.id, routine.is_active) }}
                      disabled={togglingRoute === routine.id}
                      className={`flex-1 rounded-2xl py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        routine.is_active
                          ? 'bg-warning/10 text-warning'
                          : 'bg-success/10 text-success'
                      }`}
                    >
                      {togglingRoute === routine.id
                        ? 'Updating…'
                        : routine.is_active
                          ? 'Pause'
                          : 'Resume'}
                    </button>
                    <button
                      data-testid={`delete-route-${routine.id}`}
                      onClick={() => { void handleDeleteRoute(routine.id) }}
                      disabled={deletingRoute === routine.id}
                      className="rounded-2xl py-2 px-4 text-xs font-semibold text-danger bg-danger/10 transition-colors disabled:opacity-50"
                    >
                      {deletingRoute === routine.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Ride History (compact — max 3, link to full page) ────────────── */}
      <div className="mx-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Ride History</h2>
          {rides.length > 3 && (
            <button
              data-testid="view-all-rides"
              onClick={() => navigate('/rides/history')}
              className="text-xs font-medium text-primary"
            >
              View all ({rides.length})
            </button>
          )}
        </div>

        {loadingRides ? (
          <div className="flex justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          </div>
        ) : rides.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 text-center border border-border">
            <p className="text-sm text-text-secondary">No completed rides yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-border divide-y divide-border">
            {rides.slice(0, 3).map((ride) => {
              const date = ride.ended_at ?? ride.created_at
              const fare = ride.fare_cents ?? 0
              const isDriverRole = ride.role === 'driver'
              const platformFee = Math.round(fare * 0.15)
              const earned = fare - platformFee
              const otherInitial = ride.other_name?.charAt(0)?.toUpperCase() ?? (isDriverRole ? 'R' : 'D')

              return (
                <button
                  key={ride.id}
                  data-testid={`ride-${ride.id}`}
                  onClick={() => navigate(`/ride/summary/${ride.id}`)}
                  className="w-full px-4 py-2.5 text-left active:bg-surface transition-colors flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {ride.other_avatar_url ? (
                      <img
                        src={ride.other_avatar_url}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-light text-primary text-[11px] font-bold shrink-0">
                        {otherInitial}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">
                        {ride.destination_name ?? (isDriverRole ? 'Driver' : 'Rider')}
                      </p>
                      <p className="text-[10px] text-text-secondary">
                        {new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {' · '}
                        {new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${isDriverRole ? 'text-success' : 'text-text-primary'}`}>
                    {isDriverRole ? `+${formatCents(earned)}` : formatCents(fare)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Admin panel link — only visible to internal admins ─────────────── */}
      {profile?.is_admin && (
        <div className="mx-4 mt-6">
          <button
            data-testid="profile-admin-link"
            onClick={() => navigate('/admin')}
            className="w-full rounded-2xl py-3 text-sm font-semibold text-primary bg-primary-light active:opacity-80 transition-opacity"
          >
            Open Admin Panel
          </button>
        </div>
      )}

      {/* ── Sign out ──────────────────────────────────────────────────────── */}
      <div className="mx-4 mt-6">
        <button
          data-testid="sign-out-button"
          onClick={() => { void handleSignOut() }}
          disabled={signingOut}
          className="w-full rounded-2xl py-3 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 transition-colors disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </div>

      {/* ── QR Sheet ───────────────────────────────────────────────────── */}
      {profile?.is_driver && (
        <DriverQrSheet
          isOpen={qrOpen}
          onClose={() => { setQrOpen(false) }}
          driverId={profile.id}
        />
      )}

      {/* v1.2 Sprint 7 Slice 2 — EditProfileSheet. Lazy-loaded; only
          rendered while open so the existing test suite doesn't need to
          mock the supabase-js update path on every ProfilePage render. */}
      {profileDetailsOpen && (
        <Suspense fallback={null}>
          <EditProfileSheet
            isOpen={profileDetailsOpen}
            onClose={() => setProfileDetailsOpen(false)}
          />
        </Suspense>
      )}

      <BottomNav activeTab="profile" />
    </div>
  )
}
