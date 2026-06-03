/**
 * v1.3 Sprint 11 Slice 2 — bottom sheet for adding one trusted
 * contact.
 *
 * Mirrors iOS `AddTrustedContactSheet.swift`:
 *   - Two-section structure: "Pick from Contacts" intent header
 *     (web omits the native picker — Web Contacts Picker API is
 *     Chromium-only/secure-context per the audit scope cuts — but
 *     keeps the "Or enter manually" section header so the form
 *     reads the same to a returning iOS user).
 *   - Name (1-60 chars trimmed) + phone (7-20 chars after
 *     `normalisePhone`) fields, Save button disabled until both
 *     valid.
 *   - Auto-focus the Name field 250ms after the sheet opens so the
 *     slide-in animation lands before the keyboard surfaces
 *     (`AddTrustedContactSheet.swift:120-125`).
 *   - Server error → user copy mapping mirrors iOS
 *     `friendly(serverError:)`: INVALID_NAME / INVALID_PHONE /
 *     LIMIT_REACHED each get the exact same string the iOS user
 *     sees.
 *
 * `normalisePhone` lives in `lib/trustedContactsApi.ts` so it can be
 * unit-tested independently and so the EmergencySheet (Slice 4b SMS
 * branch) can reuse it.
 */
import { useEffect, useRef, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useAddTrustedContact } from '@/hooks/useTrustedContacts'
import {
  normalisePhone,
  TrustedContactApiError,
  type TrustedContact,
} from '@/lib/trustedContactsApi'

interface AddTrustedContactSheetProps {
  isOpen: boolean
  onSaved: (contact: TrustedContact) => void
  onClose: () => void
  'data-testid'?: string
}

const NAME_MAX = 60
const PHONE_MIN = 7
const PHONE_MAX = 20

function friendlyError(err: unknown): string {
  if (err instanceof TrustedContactApiError) {
    switch (err.code) {
      case 'INVALID_NAME':
        return 'Name must be 1-60 characters.'
      case 'INVALID_PHONE':
        return 'Phone must be a valid number.'
      case 'LIMIT_REACHED':
        return 'You can save up to 5 trusted contacts.'
      default:
        return err.message
    }
  }
  return 'Couldn’t save — check your connection and try again.'
}

export default function AddTrustedContactSheet({
  isOpen,
  onSaved,
  onClose,
  'data-testid': testId = 'add-trusted-contact-sheet',
}: AddTrustedContactSheetProps) {
  const addMutation = useAddTrustedContact()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset form on open + auto-focus the Name field 250ms after the
  // sheet's slide-in animation lands (mirrors iOS Task.sleep(250ms)
  // at AddTrustedContactSheet.swift:120-125).
  useEffect(() => {
    if (!isOpen) return
    setName('')
    setPhone('')
    setErrorMessage(null)
    const t = setTimeout(() => {
      nameInputRef.current?.focus()
    }, 250)
    return () => clearTimeout(t)
  }, [isOpen])

  const cleanedName = name.trim()
  const cleanedPhone = normalisePhone(phone)
  const canSave =
    !addMutation.isPending
    && cleanedName.length > 0
    && cleanedName.length <= NAME_MAX
    && cleanedPhone.length >= PHONE_MIN
    && cleanedPhone.length <= PHONE_MAX

  async function handleSave() {
    if (!canSave) return
    setErrorMessage(null)
    try {
      const contact = await addMutation.mutateAsync({
        name: cleanedName,
        phone: cleanedPhone,
      })
      onSaved(contact)
    } catch (err) {
      setErrorMessage(friendlyError(err))
    }
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Add Contact"
      data-testid={testId}
    >
      <div className="space-y-5">
        {/* "Pick from Contacts" section header — iOS exposes a native
            CNContactPickerViewController here. Web has no
            cross-browser equivalent (Web Contacts Picker API is
            Chromium-only + secure-context-gated). Surfacing the
            section header anyway so the structure mirrors iOS and a
            returning user knows where they are. */}
        <div data-testid="add-trusted-contact-picker-section">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Pick from Contacts
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Native contact picker is iOS-only — enter the name and phone manually below.
          </p>
        </div>

        {/* Manual entry section */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Or enter manually
          </p>
          <div className="space-y-3">
            <label className="block">
              <span className="sr-only">Name</span>
              <input
                ref={nameInputRef}
                data-testid="add-trusted-contact-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                maxLength={NAME_MAX}
                autoComplete="name"
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <label className="block">
              <span className="sr-only">Phone</span>
              <input
                data-testid="add-trusted-contact-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (e.g. +14155551234)"
                inputMode="tel"
                autoComplete="tel"
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            They’ll receive your live-tracking link via SMS when you tap &ldquo;Text my contacts&rdquo; from the Safety menu during an active ride. Tago never contacts them otherwise.
          </p>
        </div>

        {errorMessage && (
          <div
            data-testid="add-trusted-contact-error"
            className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            <span aria-hidden="true">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            data-testid="add-trusted-contact-cancel"
            onClick={onClose}
            disabled={addMutation.isPending}
            className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-primary transition-colors active:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="add-trusted-contact-save"
            onClick={() => { void handleSave() }}
            disabled={!canSave}
            className="flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-white transition-colors active:bg-primary/90 disabled:opacity-50"
          >
            {addMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
