import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface SettingsPageProps {
  'data-testid'?: string
}

export default function SettingsPage({ 'data-testid': testId = 'settings-page' }: SettingsPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)

  // Notification preferences (localStorage-based for now)
  const [pushRides, setPushRides] = useState(() => localStorage.getItem('pref_push_rides') !== 'false')
  const [pushPromos, setPushPromos] = useState(() => localStorage.getItem('pref_push_promos') !== 'false')
  const [emailNotifs, setEmailNotifs] = useState(() => localStorage.getItem('pref_email') !== 'false')

  // Password change state
  const [showPassword, setShowPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleToggle = (key: string, value: boolean, setter: (v: boolean) => void) => {
    localStorage.setItem(key, String(value))
    setter(value)
  }

  const handlePasswordChange = async () => {
    setPasswordError(null)
    setPasswordSuccess(false)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      setShowPassword(false)
    }
    setSavingPassword(false)
  }

  const handleDeleteAccount = async () => {
    if (!profile?.id) return
    setDeleting(true)
    await supabase.from('users').update({ is_driver: false }).eq('id', profile.id)
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
              onChange={(v) => handleToggle('pref_push_rides', v, setPushRides)}
            />
            <ToggleRow
              testId="toggle-push-promos"
              label="Promotions"
              description="Special offers and new features"
              checked={pushPromos}
              onChange={(v) => handleToggle('pref_push_promos', v, setPushPromos)}
            />
            <ToggleRow
              testId="toggle-email"
              label="Email notifications"
              description="Ride receipts and account updates"
              checked={emailNotifs}
              onChange={(v) => handleToggle('pref_email', v, setEmailNotifs)}
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
                  data-testid="new-password-input"
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
                />
                <input
                  data-testid="confirm-password-input"
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                    onClick={() => { setShowPassword(false); setPasswordError(null); setPasswordSuccess(false) }}
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
          <div className="bg-white rounded-2xl border border-border">
            <button
              data-testid="report-issue-button"
              onClick={() => navigate('/report-issue')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary"
            >
              Report an issue
              <span className="text-text-secondary">&rsaquo;</span>
            </button>
          </div>
        </section>

        {/* ── About ───────────────────────────────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">About</h2>
          <div className="bg-white rounded-2xl border border-border p-4 space-y-2">
            <p className="text-xs text-text-secondary">HICH — Community Rideshare</p>
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
