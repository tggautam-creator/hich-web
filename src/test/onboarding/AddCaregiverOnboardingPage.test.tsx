/**
 * v1.2 Sprint 6 Slice 6 — AddCaregiverOnboardingPage behaviour.
 *
 * Mirrors the iOS XCTest coverage for the mapped cases (save gating,
 * insert→upload→PATCH happy path, error surfacing, Skip routing).
 * Photo upload is mocked at the supabase.storage boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AddCaregiverOnboardingPage from '@/components/onboarding/AddCaregiverOnboardingPage'
import type { Caregiver } from '@/types/database'

// ── Mocks ────────────────────────────────────────────────────────────

const {
  addMutateAsync,
  updateMutateAsync,
  storageUpload,
  getPublicUrl,
  mockNavigate,
  mockProfile,
} = vi.hoisted(() => ({
  addMutateAsync:    vi.fn().mockResolvedValue({ id: 'c-new' } as Caregiver),
  updateMutateAsync: vi.fn().mockResolvedValue(undefined),
  storageUpload:     vi.fn().mockResolvedValue({ error: null }),
  getPublicUrl:      vi.fn(() => ({ data: { publicUrl: 'https://x.com/sarah.jpg' } })),
  mockNavigate:      vi.fn(),
  mockProfile: {
    id: 'user-aabbccdd-1234-1234-1234-aabbccddeeff',
  },
}))

vi.mock('@/hooks/useCaregivers', () => ({
  useAddCaregiver:    () => ({ mutateAsync: addMutateAsync }),
  useUpdateCaregiver: () => ({ mutateAsync: updateMutateAsync }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({ upload: storageUpload, getPublicUrl: getPublicUrl }),
    },
  },
}))

interface AuthState { profile: typeof mockProfile }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: AuthState) => unknown) => selector({ profile: mockProfile }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  addMutateAsync.mockClear().mockResolvedValue({ id: 'c-new' } as Caregiver)
  updateMutateAsync.mockClear().mockResolvedValue(undefined)
  storageUpload.mockReset().mockResolvedValue({ error: null })
  getPublicUrl.mockClear().mockReturnValue({ data: { publicUrl: 'https://x.com/sarah.jpg' } })
  mockNavigate.mockClear()
  document.body.innerHTML = ''
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value:        vi.fn(() => 'blob://stub'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value:        vi.fn(),
    })
  }
})

function makeFile(name = 'caregiver.jpg', type = 'image/jpeg'): File {
  return new File(['fake-image-bytes'], name, { type })
}

function pickFile(file: File) {
  const input = screen.getByTestId('caregiver-onboarding-photo-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AddCaregiverOnboardingPage />
    </MemoryRouter>,
  )
}

// ── Static render ────────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — static render', () => {
  it('renders the iOS-verbatim heading + subtitle copy', () => {
    renderPage()
    expect(screen.getByText('Add a caregiver')).toBeTruthy()
    expect(screen.getByText(/You can add more caregivers later from your profile/)).toBeTruthy()
    expect(screen.getByText(/Skip if you'd rather set this up after/)).toBeTruthy()
  })

  it('renders the iOS-verbatim photo picker labels', () => {
    renderPage()
    expect(screen.getByText('Add photo (required)')).toBeTruthy()
    expect(screen.getByText('A clear face photo helps drivers recognize this caregiver at pickup.')).toBeTruthy()
  })

  it('renders all 9 data-testid hooks', () => {
    renderPage()
    for (const id of [
      'add-caregiver-onboarding-page',
      'caregiver-onboarding-photo-picker',
      'caregiver-onboarding-photo-input',
      'caregiver-onboarding-name',
      'caregiver-onboarding-phone',
      'caregiver-onboarding-notes',
      'caregiver-onboarding-save',
      'caregiver-onboarding-skip',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })

  it('notes counter renders "0/500" initially', () => {
    renderPage()
    expect(screen.getByText('0/500')).toBeTruthy()
  })
})

// ── Save gating ──────────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — save gating', () => {
  it('Save is disabled when name AND photo are both missing', () => {
    renderPage()
    const save = screen.getByTestId('caregiver-onboarding-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('Save is disabled when name is filled but no photo is staged', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    expect((screen.getByTestId('caregiver-onboarding-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save is disabled when photo is staged but name is whitespace-only', () => {
    renderPage()
    pickFile(makeFile())
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: '   ' } })
    expect((screen.getByTestId('caregiver-onboarding-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save enables once both name + photo are provided', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    expect((screen.getByTestId('caregiver-onboarding-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('Skip is enabled even without name or photo (escape hatch)', () => {
    renderPage()
    expect((screen.getByTestId('caregiver-onboarding-skip') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ── Length clamps ────────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — length clamps', () => {
  it('name clamps at 100 chars', () => {
    renderPage()
    const input = screen.getByTestId('caregiver-onboarding-name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x'.repeat(150) } })
    expect(input.value.length).toBe(100)
  })

  it('phone clamps at 32 chars', () => {
    renderPage()
    const input = screen.getByTestId('caregiver-onboarding-phone') as HTMLInputElement
    fireEvent.change(input, { target: { value: '+'.repeat(50) } })
    expect(input.value.length).toBe(32)
  })

  it('notes clamps at 500 chars + counter reflects truncation', () => {
    renderPage()
    const textarea = screen.getByTestId('caregiver-onboarding-notes') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'a'.repeat(600) } })
    expect(textarea.value.length).toBe(500)
    expect(screen.getByText('500/500')).toBeTruthy()
  })
})

// ── Happy-path save ──────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — happy-path save', () => {
  it('runs insert → upload → patch in order, then navigates to /onboarding/location with replace=true', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'),  { target: { value: '  Sarah  ' } })
    fireEvent.change(screen.getByTestId('caregiver-onboarding-phone'), { target: { value: '+15555550199' } })
    pickFile(makeFile())

    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledOnce())
    expect(addMutateAsync).toHaveBeenCalledWith({
      name:  'Sarah',
      phone: '+15555550199',
      notes: null,
    })

    await waitFor(() => expect(storageUpload).toHaveBeenCalledOnce())
    const uploadCall = storageUpload.mock.calls[0] as [string, File, { upsert: boolean; contentType: string }]
    expect(uploadCall[0]).toBe(`${mockProfile.id.toLowerCase()}/caregivers/c-new.jpg`)
    expect(uploadCall[2]).toMatchObject({ upsert: true, contentType: 'image/jpeg' })

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce())
    const patch = updateMutateAsync.mock.calls[0]?.[0] as { caregiverId: string; avatarUrl: string }
    expect(patch.caregiverId).toBe('c-new')
    expect(patch.avatarUrl).toContain('https://x.com/sarah.jpg')
    expect(patch.avatarUrl).toContain('?t=')

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true })
    })
  })

  it('passes null for blank phone + notes, trims whitespace when filled', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'),  { target: { value: 'Sarah' } })
    fireEvent.change(screen.getByTestId('caregiver-onboarding-notes'), { target: { value: '   Joins on chemo days   ' } })
    pickFile(makeFile())

    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledOnce())
    expect(addMutateAsync).toHaveBeenCalledWith({
      name:  'Sarah',
      phone: null,
      notes: 'Joins on chemo days',
    })
  })

  it('uses the lowercased file extension in the storage path', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile('caregiver.PNG', 'image/png'))

    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => expect(storageUpload).toHaveBeenCalledOnce())
    const uploadCall = storageUpload.mock.calls[0] as [string, File, unknown]
    expect(uploadCall[0]).toBe(`${mockProfile.id.toLowerCase()}/caregivers/c-new.png`)
  })

  it('submitting the form via Enter key triggers the same handleSave path', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())

    // Enter-to-submit is the actual user-facing contract; jsdom's
    // form-implicit-submit doesn't fire on keyDown alone, so we
    // exercise both the contract (button has type=submit) and the
    // observable behaviour (fireEvent.submit(form) calls onSubmit).
    expect(
      (screen.getByTestId('caregiver-onboarding-save') as HTMLButtonElement).type,
    ).toBe('submit')

    const form = screen.getByTestId('caregiver-onboarding-save').closest('form')
    if (!form) throw new Error('expected save button to be inside a form')
    fireEvent.submit(form)

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledOnce())
  })

  it('insert runs BEFORE upload — RLS contract pin (upload needs the caregiver row to exist)', async () => {
    let resolveInsert: ((value: Caregiver) => void) | undefined
    addMutateAsync.mockImplementationOnce(
      () => new Promise<Caregiver>((resolve) => { resolveInsert = resolve }),
    )

    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledOnce())
    // Upload MUST NOT fire until the insert promise resolves —
    // a future refactor parallelising the two would break the
    // storage-RLS check that requires the row id to exist first.
    expect(storageUpload).not.toHaveBeenCalled()

    resolveInsert!({ id: 'c-new' } as Caregiver)

    await waitFor(() => expect(storageUpload).toHaveBeenCalledOnce())
  })

  it('retry-after-failure reuses the same caregiver row (no orphan insert)', async () => {
    // First attempt: insert succeeds, upload fails.
    addMutateAsync.mockResolvedValueOnce({ id: 'c-new' } as Caregiver)
    storageUpload.mockResolvedValueOnce({ error: { message: 'transient 502' } })

    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => {
      expect(screen.getByTestId('caregiver-onboarding-error').textContent).toContain('transient 502')
    })
    expect(addMutateAsync).toHaveBeenCalledOnce()

    // Second attempt: upload succeeds. addCaregiver must NOT be
    // called again — same row id reused via insertedIdRef.
    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => expect(storageUpload).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce())
    expect(addMutateAsync).toHaveBeenCalledOnce()
  })
})

// ── Defensive guards ────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — defensive guards', () => {
  it('Save short-circuits with "Sign in required." when profile.id is missing', async () => {
    // Re-mock useAuthStore for this test only.
    const originalProfile = { ...mockProfile }
    Object.assign(mockProfile, { id: undefined as unknown as string })

    try {
      renderPage()
      fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
      pickFile(makeFile())
      fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

      await waitFor(() => {
        expect(screen.getByTestId('caregiver-onboarding-error').textContent).toContain('Sign in required.')
      })
      expect(addMutateAsync).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
    } finally {
      Object.assign(mockProfile, originalProfile)
    }
  })
})

// ── Skip path ────────────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — skip path', () => {
  it('Skip navigates to /onboarding/location with replace=true and fires NO mutations or uploads', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())

    fireEvent.click(screen.getByTestId('caregiver-onboarding-skip'))

    expect(addMutateAsync).not.toHaveBeenCalled()
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true })
  })
})

// ── Error surfacing ──────────────────────────────────────────────────

describe('AddCaregiverOnboardingPage — error surfacing', () => {
  it('renders the inline error pill when the storage upload fails + does not navigate', async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: 'storage 403' } })
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => {
      expect(screen.getByTestId('caregiver-onboarding-error').textContent).toContain('storage 403')
    })
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('renders the inline error pill when the insert mutation fails + does not upload or patch', async () => {
    addMutateAsync.mockRejectedValueOnce(new Error('RLS denied'))
    renderPage()
    fireEvent.change(screen.getByTestId('caregiver-onboarding-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-onboarding-save'))

    await waitFor(() => {
      expect(screen.getByTestId('caregiver-onboarding-error').textContent).toContain('RLS denied')
    })
    expect(storageUpload).not.toHaveBeenCalled()
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
