import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

/// Server-side keys (snake_case to match the API). The local-state
/// React names map onto these in `handleToggle`. Tracking the same
/// strings as the iOS client so a flip on either platform converges.
type PrefServerKey = 'push_rides' | 'push_promos' | 'email_marketing' | 'sms_alerts'

interface SettingsPageProps {
  'data-testid'?: string
}

export default function SettingsPage({ 'data-testid': testId = 'settings-page' }: SettingsPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)

  // Notification preferences. Seed from localStorage cache for an
  // instant first paint, then `refreshFromServer()` overwrites with
  // the canonical server values. P.9 (2026-04-27) replaced the
  // localStorage-only stub with this server-backed flow — see
  // server/routes/users.ts.
  const [pushRides, setPushRides] = useState(() => localStorage.getItem('pref_push_rides') !== 'false')
  const [pushPromos, setPushPromos] = useState(() => localStorage.getItem('pref_push_promos') !== 'false')
  const [emailNotifs, setEmailNotifs] = useState(() => localStorage.getItem('pref_email') !== 'false')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) return
        const resp = await fetch('/api/users/me/notification-preferences', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) return
        const body = await resp.json() as {
          push_rides: boolean
          push_promos: boolean
          email_marketing: boolean
          sms_alerts: boolean
        }
        if (cancelled) return
        setPushRides(body.push_rides)
        setPushPromos(body.push_promos)
        setEmailNotifs(body.email_marketing)
        // Mirror to localStorage so a hard offline session keeps the
        // values across refreshes.
        localStorage.setItem('pref_push_rides', String(body.push_rides))
        localStorage.setItem('pref_push_promos', String(body.push_promos))
        localStorage.setItem('pref_email', String(body.email_marketing))
      } catch {
        // Silent — local cache already painted the toggles.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Password change state
  const [showPassword, setShowPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleToggle = (
    cacheKey: string,
    serverKey: PrefServerKey,
    value: boolean,
    setter: (v: boolean) => void,
  ) => {
    // Update the local React state + cache immediately so the toggle
    // animates without waiting on the network. Then fire-and-forget
    // a PUT to persist server-side.
    localStorage.setItem(cacheKey, String(value))
    setter(value)
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) return
        await fetch('/api/users/me/notification-preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ [serverKey]: value }),
        })
      } catch {
        // Silent failure — local cache + state still reflect the
        // user's choice; next refresh will re-sync from server.
      }
    })()
  }

  const handlePasswordChange = async () => {
    setPasswordError(null)
    setPasswordSuccess(false)

    if (!currentPassword) {
      setPasswordError('Current password is required')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from current')
      return
    }

    setSavingPassword(true)
    // Hit the new server endpoint that re-auths via the GoTrue
    // password grant before flipping. Replaces the prior
    // `auth.updateUser({ password })` call which silently rotated
    // the password without proving knowledge of the old one.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setPasswordError('Not signed in')
        setSavingPassword(false)
        return
      }

      const resp = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ current: currentPassword, new: newPassword }),
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => null) as
          | { error?: { code?: string; message?: string } }
          | null
        const code = body?.error?.code
        if (code === 'WRONG_PASSWORD') {
          setPasswordError('Current password is incorrect')
        } else if (code === 'WEAK_PASSWORD') {
          setPasswordError('New password must be at least 8 characters')
        } else {
          setPasswordError(body?.error?.message ?? 'Could not update password')
        }
        setSavingPassword(false)
        return
      }

      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPassword(false)
    } catch {
      setPasswordError('Network error — try again')
    }
    setSavingPassword(false)
  }

  const handleDeleteAccount = async () => {
    if (!profile?.id) return
    setDeleting(true)
    // Hit the real purge endpoint instead of just flipping
    // `is_driver = false` (which left the user's row + RLS-scoped
    // data behind in the DB and silently failed App Store 5.1.1(v)
    // compliance). Server cascades through every table and finally
    // calls `auth.admin.deleteUser` — see server/routes/account.ts.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        await fetch('/api/account/delete', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch {
      // Best-effort — even if the endpoint fails we still want
      // to sign the user out locally so they're not stuck on a
      // page implying their account was deleted.
    }
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 2rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="flex-1 flex flex-col px-6 py-4">
        {/* Back button */}
        <button
          data-testid="back-button"
          onClick={() => navigate('/profile')}
          className="self-start mb-4 text-sm font-medium text-primary"
        >
          &larr; Back to Profile
        </button>

        <h1 className="mb-6 text-2xl font-bold text-text-primary">Settings</h1>

        {/* ── Notifications ───────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Notifications</h2>
          <div className="bg-white rounded-2xl border border-border divide-y divide-border">
            <ToggleRow
              testId="toggle-push-rides"
              label="Ride updates"
              description="Ride requests, pickups, and completions"
              checked={pushRides}
              onChange={(v) => handleToggle('pref_push_rides', 'push_rides', v, setPushRides)}
            />
            <ToggleRow
              testId="toggle-push-promos"
              label="Promotions"
              description="Special offers and new features"
              checked={pushPromos}
              onChange={(v) => handleToggle('pref_push_promos', 'push_promos', v, setPushPromos)}
            />
            <ToggleRow
              testId="toggle-email"
              label="Email notifications"
              description="Ride receipts and account updates"
              checked={emailNotifs}
              onChange={(v) => handleToggle('pref_email', 'email_marketing', v, setEmailNotifs)}
            />
          </div>
        </section>

        {/* ── Account ─────────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Account</h2>
          <div className="bg-white rounded-2xl border border-border p-4 space-y-4">
            {/* Change password */}
            {!showPassword ? (
              <button
                data-testid="change-password-button"
                onClick={() => setShowPassword(true)}
                className="text-sm font-medium text-primary"
              >
                Change password
              </button>
            ) : (
              <div className="space-y-3">
                <input
                  data-testid="current-password-input"
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                <input
                  data-testid="new-password-input"
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                <input
                  data-testid="confirm-password-input"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                {passwordError && (
                  <p data-testid="password-error" className="text-xs text-danger">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p data-testid="password-success" className="text-xs text-success">Password updated!</p>
                )}
                <div className="flex gap-2">
                  <button
                    data-testid="save-password-button"
                    onClick={() => { void handlePasswordChange() }}
                    disabled={savingPassword}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {savingPassword ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPassword(false)
                      setPasswordError(null)
                      setPasswordSuccess(false)
                      setCurrentPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                    }}
                    className="rounded-lg bg-surface px-4 py-2 text-xs font-medium text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Delete account */}
            <div className="border-t border-border pt-4">
              {!showDeleteConfirm ? (
                <button
                  data-testid="delete-account-button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-sm font-medium text-danger"
                >
                  Delete account
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-text-primary">Are you sure? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button
                      data-testid="confirm-delete-button"
                      onClick={() => { void handleDeleteAccount() }}
                      disabled={deleting}
                      className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {deleting ? 'Deleting...' : 'Yes, delete'}
                    </button>
                    <button
                      data-testid="cancel-delete-button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-lg bg-surface px-4 py-2 text-xs font-medium text-text-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Support ─────────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Support</h2>
          <div className="bg-white rounded-2xl border border-border divide-y divide-border">
            <button
              data-testid="report-issue-button"
              onClick={() => navigate('/report-issue')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary"
            >
              Report an issue
              <span className="text-text-secondary">&rsaquo;</span>
            </button>
            <a
              href="mailto:support@tagorides.com"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary"
            >
              Contact us
              <span className="text-text-secondary">&rsaquo;</span>
            </a>
          </div>
        </section>

        {/* ── Legal ───────────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Legal</h2>
          <div className="bg-white rounded-2xl border border-border divide-y divide-border">
            <Link
              to="/terms"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary"
            >
              Terms of Service
              <span className="text-text-secondary">&rsaquo;</span>
            </Link>
            <Link
              to="/privacy"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary"
            >
              Privacy Policy
              <span className="text-text-secondary">&rsaquo;</span>
            </Link>
          </div>
        </section>

        {/* ── About ───────────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">About</h2>
          <div className="bg-white rounded-2xl border border-border p-4 space-y-2">
            <p className="text-xs text-text-secondary">TAGO — Tag Along. Go Smarter.</p>
            <p className="text-xs text-text-secondary">Version 1.0.0</p>
            <p className="text-xs text-text-secondary mt-2">Made with love in Davis, CA</p>
          </div>
        </section>
      </div>
    </div>
  )
}

// ── ToggleRow ──────────────────────────────────────────────────────────────

interface ToggleRowProps {
  testId: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({ testId, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
      <button
        data-testid={testId}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}
