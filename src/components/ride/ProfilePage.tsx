import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import BottomNav from '@/components/ui/BottomNav'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import AppIcon from '@/components/ui/AppIcon'
import VehicleIcon from '@/components/ui/VehicleIcon'
import type { Ride, DriverRoutine, Vehicle, SavedAddress } from '@/types/database'
import AddressPickerModal from '@/components/ride/AddressPickerModal'

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

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Saved routes state
  const [routines, setRoutines] = useState<DriverRoutine[]>([])
  const [loadingRoutines, setLoadingRoutines] = useState(true)
  const [togglingRoute, setTogglingRoute] = useState<string | null>(null)
  const [deletingRoute, setDeletingRoute] = useState<string | null>(null)

  // Vehicle state
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loadingVehicle, setLoadingVehicle] = useState(true)

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

  // Refresh profile to get latest wallet_balance
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  // Sync edit fields when profile loads or editing starts
  useEffect(() => {
    if (editing) {
      setEditName(profile?.full_name ?? '')
      setEditPhone(profile?.phone ?? '')
      setEditError(null)
    }
  }, [editing, profile?.full_name, profile?.phone])

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

  // ── Load vehicle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id || !profile.is_driver) {
      setLoadingVehicle(false)
      return
    }
    const userId = profile.id
    async function loadVehicle() {
      const { data } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      setVehicle(data as Vehicle | null)
      setLoadingVehicle(false)
    }
    void loadVehicle()
  }, [profile?.id, profile?.is_driver])

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
      .upload(path, file, { upsert: true })
    if (upErr) { setUploadingAvatar(false); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', profile.id)
    await refreshProfile()
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

    const { error } = await supabase
      .from('users')
      .update({ full_name: trimmedName, phone: editPhone.trim() || null })
      .eq('id', profile.id)

    if (error) {
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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="bg-white px-5 border-b border-border flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)', paddingBottom: '1.25rem' }}
      >
        <h1 className="text-lg font-bold text-text-primary">Profile</h1>
        <button
          data-testid="settings-button"
          onClick={() => navigate('/settings')}
          aria-label="Settings"
          className="p-1.5 rounded-lg hover:bg-surface transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-secondary" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* ── User card ───────────────────────────────────────────────────────── */}
      <div className="bg-white mx-4 mt-4 rounded-2xl p-5 shadow-sm border border-border">
        <div className="flex items-center gap-4">
          <button
            data-testid="avatar-button"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl shrink-0 overflow-hidden relative disabled:opacity-50"
          >
            {uploadingAvatar ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  data-testid="edit-name-input"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-lg border border-border px-3 py-1.5 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                <input
                  data-testid="edit-phone-input"
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-lg border border-border px-3 py-1.5 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                {editError && (
                  <p data-testid="edit-error" className="text-xs text-danger">{editError}</p>
                )}
              </div>
            ) : (
              <>
                <p data-testid="profile-name" className="text-base font-semibold text-text-primary truncate">
                  {profile?.full_name ?? 'User'}
                </p>
                <p data-testid="profile-email" className="text-xs text-text-secondary truncate">
                  {profile?.email ?? ''}
                </p>
                {profile?.phone && (
                  <p data-testid="profile-phone" className="text-xs text-text-secondary truncate">
                    {profile.phone}
                  </p>
                )}
                {profile?.rating_avg != null && (
                  <p className="text-xs text-text-secondary mt-0.5">
                    <span className="inline-flex items-center gap-1">
                      <AppIcon name="star" className="h-3.5 w-3.5 text-warning" />
                      {profile.rating_avg.toFixed(1)} ({profile.rating_count} ratings)
                    </span>
                  </p>
                )}
              </>
            )}
          </div>

          {/* Edit / Save / Cancel buttons */}
          {editing ? (
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                data-testid="save-profile-button"
                onClick={() => { void handleSave() }}
                disabled={saving}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                data-testid="cancel-edit-button"
                onClick={() => setEditing(false)}
                className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              data-testid="edit-profile-button"
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-primary"
            >
              Edit
            </button>
          )}
        </div>

        {/* Payment & Payouts links */}
        <div className="mt-4 space-y-2">
          <button
            data-testid="payment-methods-link"
            onClick={() => { navigate('/payment/methods') }}
            className="w-full flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary" aria-hidden="true">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
              <span className="text-sm text-text-secondary">Payment Methods</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          {profile?.is_driver && (
            <button
              data-testid="payouts-link"
              onClick={() => { navigate('/stripe/payouts') }}
              className="w-full flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <span className="text-sm text-text-secondary">Payouts</span>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </div>

        {/* Driver badge */}
        {profile?.is_driver && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-2.5">
            <AppIcon name="verified" className="h-4 w-4 text-success" />
            <span className="text-xs font-medium text-success">Registered Driver</span>
          </div>
        )}
      </div>

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
                  <span className="text-lg">🏠</span>
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
                  <span className="text-lg">💼</span>
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

      {/* ── My Vehicle ──────────────────────────────────────────────────── */}
      {profile?.is_driver && (
        <div className="mx-4 mt-4">
          <h2 className="text-sm font-semibold text-text-primary mb-3">My Vehicle</h2>
          {loadingVehicle ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            </div>
          ) : vehicle ? (
            <div data-testid="vehicle-card" className="bg-white rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-3">
                {vehicle.car_photo_url ? (
                  <img
                    src={vehicle.car_photo_url}
                    alt="Vehicle"
                    className="h-16 w-20 rounded-2xl object-cover shrink-0"
                  />
                ) : (
                  <div className="h-16 w-20 rounded-2xl bg-surface flex items-center justify-center shrink-0">
                    <VehicleIcon color={vehicle.color.toLowerCase()} className="h-10 w-auto" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p data-testid="vehicle-name" className="text-sm font-semibold text-text-primary truncate">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="h-3 w-3 rounded-full border border-border shrink-0"
                      style={{ backgroundColor: vehicle.color.toLowerCase() }}
                    />
                    <span className="text-xs text-text-secondary">{vehicle.color}</span>
                  </div>
                  <p data-testid="vehicle-plate" className="text-xs text-text-secondary mt-0.5">
                    {vehicle.plate} · {vehicle.seats_available} seat{vehicle.seats_available !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                data-testid="edit-vehicle-button"
                onClick={() => navigate('/vehicle/edit')}
                className="mt-3 w-full rounded-2xl py-2 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20 transition-colors"
              >
                Edit Vehicle
              </button>
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
      {profile?.is_driver && (
        <div className="mx-4 mt-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Saved Routes</h2>

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
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold text-text-primary truncate flex-1">
                      {routine.route_name}
                    </p>
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

      <BottomNav activeTab="profile" />
    </div>
  )
}
