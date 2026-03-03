import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { validateFullName, validatePhone, validatePassword } from '@/lib/validation'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── Component ─────────────────────────────────────────────────────────────────

interface FormErrors {
  fullName?: string
  phone?: string
  password?: string
  submit?: string
}

export default function CreateProfilePage() {
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone]       = useState('')
  const [password, setPassword] = useState('')
  const [photo, setPhoto]       = useState<File | null>(null)
  const [errors, setErrors]     = useState<FormErrors>({})
  const [isLoading, setIsLoading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const nameError     = validateFullName(fullName)
    const phoneError    = validatePhone(phone)
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

      // Set password on the auth user
      const { error: authErr } = await supabase.auth.updateUser({ password })
      if (authErr) throw authErr

      // Upsert the users row
      const { error: dbErr } = await supabase.from('users').upsert({
        id:         user.id,
        email:      user.email ?? '',
        full_name:  fullName.trim(),
        phone:      phone.trim(),
        avatar_url: avatarUrl,
      })
      if (dbErr) throw dbErr

      navigate('/onboarding/location')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setErrors({ submit: message })
    } finally {
      setIsLoading(false)
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setPhoto(e.target.files?.[0] ?? null)
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

          <InputField
            id="phone"
            data-testid="phone-input"
            label="Phone number"
            type="tel"
            placeholder="+15551234567"
            autoComplete="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value) }}
            error={errors.phone}
            hint="International format required (e.g. +15551234567)"
          />

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
              className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
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
