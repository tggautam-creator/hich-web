import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { validateFullName, validatePhone, validatePassword } from '@/lib/validation'
import { trackEvent } from '@/lib/analytics'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── Country codes ──────────────────────────────────────────────────────────────

const COUNTRY_CODES = [
  { key: 'US',  dialCode: '+1',   label: '🇺🇸  +1' },
  { key: 'CA',  dialCode: '+1',   label: '🇨🇦  +1' },
  { key: 'GB',  dialCode: '+44',  label: '🇬🇧 +44' },
  { key: 'AU',  dialCode: '+61',  label: '🇦🇺 +61' },
  { key: 'IN',  dialCode: '+91',  label: '🇮🇳 +91' },
  { key: 'MX',  dialCode: '+52',  label: '🇲🇽 +52' },
  { key: 'DE',  dialCode: '+49',  label: '🇩🇪 +49' },
  { key: 'FR',  dialCode: '+33',  label: '🇫🇷 +33' },
  { key: 'JP',  dialCode: '+81',  label: '🇯🇵 +81' },
  { key: 'CN',  dialCode: '+86',  label: '🇨🇳 +86' },
  { key: 'BR',  dialCode: '+55',  label: '🇧🇷 +55' },
  { key: 'PK',  dialCode: '+92',  label: '🇵🇰 +92' },
  { key: 'NG',  dialCode: '+234', label: '🇳🇬 +234' },
  { key: 'ZA',  dialCode: '+27',  label: '🇿🇦 +27' },
  { key: 'AE',  dialCode: '+971', label: '🇦🇪 +971' },
] as const

// ── Component ─────────────────────────────────────────────────────────────────

interface FormErrors {
  fullName?: string
  phone?: string
  password?: string
  submit?: string
}

// Shared input class — matches InputField exactly so the select blends in
const INPUT_CLASS = [
  'w-full rounded-2xl border border-border bg-white px-4 py-3',
  'text-base text-text-primary placeholder:text-text-secondary',
  'transition-colors duration-150',
  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-primary',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

export default function CreateProfilePage() {
  const navigate = useNavigate()
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [fullName,    setFullName]    = useState('')
  const [countryKey,  setCountryKey]  = useState<string>('US')
  const [localPhone,  setLocalPhone]  = useState('')
  const [password,    setPassword]    = useState('')
  const [photo,       setPhoto]       = useState<File | null>(null)
  const [errors,      setErrors]      = useState<FormErrors>({})
  const [isLoading,   setIsLoading]   = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  /** Dial code for the currently selected country */
  const dialCode = COUNTRY_CODES.find(c => c.key === countryKey)?.dialCode ?? '+1'

  /** Full E.164 phone number — used for validation and DB storage */
  const fullPhone = `${dialCode}${localPhone.replace(/\D/g, '')}`

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const nameError     = validateFullName(fullName)
    const phoneError    = validatePhone(fullPhone)
    const passwordError = validatePassword(password)

    if (nameError ?? phoneError ?? passwordError) {
      setErrors({ fullName: nameError, phone: phoneError, password: passwordError })
      return
    }

    setErrors({})
    setIsLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated — please sign in again')

      // Upload photo if selected
      let avatarUrl: string | null = null
      if (photo) {
        const ext         = photo.name.split('.').pop() ?? 'jpg'
        const storagePath = `${user.id}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(storagePath, photo, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(storagePath)
        avatarUrl = urlData.publicUrl
      }

      // Set password on the auth user.
      // If the password hasn't changed (returning user), Supabase returns a
      // "should be different" error — that's fine, the password is already set.
      const { error: authErr } = await supabase.auth.updateUser({ password })
      if (authErr) {
        const msg = authErr.message.toLowerCase()
        const isSamePassword =
          msg.includes('different from') ||
          msg.includes('previously been used') ||
          msg.includes('should be different')
        if (!isSamePassword) throw authErr
      }

      // UPDATE existing row for this auth user; INSERT if none exists.
      // This is RLS-safe: UPDATE USING (auth.uid()=id) only touches own row;
      // INSERT WITH CHECK (auth.uid()=id) only allows own row.
      const { data: updated, error: updateErr } = await supabase
        .from('users')
        .update({
          full_name:  fullName.trim(),
          phone:      fullPhone,
          avatar_url: avatarUrl,
        })
        .eq('id', user.id)
        .select('id')
      if (updateErr) throw updateErr

      if (updated.length === 0) {
        // No row yet for this auth user — first-time profile creation
        const { error: insertErr } = await supabase.from('users').insert({
          id:         user.id,
          email:      user.email ?? '',
          full_name:  fullName.trim(),
          phone:      fullPhone,
          avatar_url: avatarUrl,
        })
        if (insertErr) throw insertErr
      }

      // Refresh the auth store so AuthGuard sees the new full_name
      await refreshProfile()
      trackEvent('signup_completed')
      navigate('/onboarding/location')
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[CreateProfilePage] submit error:', err)
      let message = 'Something went wrong. Please try again.'
      if (err instanceof Error) {
        message = err.message
      } else if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as Record<string, unknown>).message === 'string'
      ) {
        message = (err as { message: string }).message
      }
      setErrors({ submit: message })
    } finally {
      setIsLoading(false)
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file && file.size > 5 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, submit: 'Photo must be under 5 MB' }))
      e.target.value = ''
      return
    }
    setPhoto(file)
  }

  return (
    <div
      data-testid="create-profile-page"
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)', paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
    >
      <div className="flex-1 flex flex-col justify-center px-6">
        <h1 className="mb-2 text-2xl font-bold text-text-primary">Create your profile</h1>
        <p className="mb-8 text-sm text-text-secondary">
          This info will be visible to your driver or rider.
        </p>

        <form onSubmit={(e) => { void handleSubmit(e) }} noValidate className="flex flex-col gap-5">
          <InputField
            id="full-name"
            data-testid="full-name-input"
            label="Full name"
            type="text"
            placeholder="Jane Smith"
            autoComplete="name"
            value={fullName}
            onChange={(e) => { setFullName(e.target.value) }}
            error={errors.fullName}
          />

          {/* Phone — country selector + local number side by side */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-primary">
              Phone number
            </label>
            <div className="flex gap-2">
              <select
                data-testid="country-code-select"
                value={countryKey}
                onChange={(e) => { setCountryKey(e.target.value) }}
                className={[
                  INPUT_CLASS,
                  '!w-[5.5rem] !min-w-[5.5rem] !max-w-[5.5rem] shrink-0 cursor-pointer',
                  errors.phone ? 'border-danger focus:ring-danger' : '',
                ].join(' ')}
                aria-label="Country code"
              >
                {COUNTRY_CODES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>

              <input
                id="phone"
                data-testid="phone-input"
                type="tel"
                inputMode="numeric"
                placeholder="555 123 4567"
                autoComplete="tel-national"
                value={localPhone}
                onChange={(e) => { setLocalPhone(e.target.value) }}
                aria-invalid={errors.phone ? true : undefined}
                className={[
                  INPUT_CLASS,
                  'flex-1 min-w-0',
                  errors.phone ? 'border-danger focus:ring-danger' : '',
                ].join(' ')}
              />
            </div>
            {errors.phone && (
              <p className="text-sm text-danger" role="alert">{errors.phone}</p>
            )}
          </div>

          <InputField
            id="password"
            data-testid="password-input"
            label="Password"
            type="password"
            placeholder="Min. 8 characters, 1 number"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value) }}
            error={errors.password}
          />
          <p className="-mt-3 text-xs text-text-secondary">
            Passwords must be at least 8 characters long and include at least 1 number.
          </p>

          {/* Photo upload — optional */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="photo-input"
              className="text-sm font-medium text-text-primary"
            >
              Profile photo{' '}
              <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <input
              id="photo-input"
              data-testid="photo-input"
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handlePhotoChange}
              className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-light-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
            />
            {photo && (
              <p data-testid="photo-name" className="text-xs text-text-secondary">
                {photo.name}
              </p>
            )}
          </div>

          {errors.submit && (
            <p
              data-testid="submit-error"
              role="alert"
              className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {errors.submit}
            </p>
          )}

          <PrimaryButton
            data-testid="submit-button"
            type="submit"
            isLoading={isLoading}
          >
            Continue
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
