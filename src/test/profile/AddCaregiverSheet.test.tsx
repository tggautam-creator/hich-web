/**
 * v1.2 Sprint 6 Slice 2 — AddCaregiverSheet add + edit behaviour.
 * Photo upload is mocked at the supabase.storage boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddCaregiverSheet from '@/components/profile/AddCaregiverSheet'
import type { Caregiver } from '@/types/database'

// ── Mocks ────────────────────────────────────────────────────────────

const {
  addMutateAsync,
  updateMutateAsync,
  storageUpload,
  getPublicUrl,
  mockProfile,
} = vi.hoisted(() => ({
  addMutateAsync:    vi.fn().mockResolvedValue({ id: 'c-new' } as Caregiver),
  updateMutateAsync: vi.fn().mockResolvedValue(undefined),
  storageUpload:     vi.fn().mockResolvedValue({ error: null }),
  getPublicUrl:      vi.fn(() => ({ data: { publicUrl: 'https://x.com/sarah.jpg' } })),
  mockProfile: {
    id:                       'user-aabbccdd-1234-1234-1234-aabbccddeeff',
    email:                    'maya@uni.edu',
    has_accessibility_needs:  true,
  },
}))

vi.mock('@/hooks/useCaregivers', () => ({
  useAddCaregiver:    () => ({ mutateAsync: addMutateAsync }),
  useUpdateCaregiver: () => ({ mutateAsync: updateMutateAsync }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload:        storageUpload,
        getPublicUrl: getPublicUrl,
      }),
    },
  },
}))

interface AuthState {
  profile: typeof mockProfile
}

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: AuthState) => unknown) => selector({ profile: mockProfile }),
}))

beforeEach(() => {
  addMutateAsync.mockClear()
  updateMutateAsync.mockClear()
  storageUpload.mockReset().mockResolvedValue({ error: null })
  getPublicUrl.mockClear()
  document.body.innerHTML = '<div id="portal-root"></div>'
  // jsdom doesn't ship URL.createObjectURL/.revokeObjectURL; the
  // component uses both for the staged-photo preview.
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

function makeFile(name = 'caregiver.jpg'): File {
  return new File(['fake-image-bytes'], name, { type: 'image/jpeg' })
}

function pickFile(file: File) {
  const input = screen.getByTestId('caregiver-photo-input') as HTMLInputElement
  // jsdom won't let us set files via the user click; assign directly + fire change
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

// ── Add mode ─────────────────────────────────────────────────────────

describe('AddCaregiverSheet — add mode', () => {
  it('Save stays disabled until a photo is staged AND a name is entered', () => {
    render(<AddCaregiverSheet isOpen={true} onSaved={() => {}} onClose={() => {}} />)
    const save = screen.getByTestId('caregiver-sheet-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('caregiver-name'), { target: { value: 'Sarah' } })
    expect(save.disabled).toBe(true)  // still missing photo

    pickFile(makeFile())
    expect(save.disabled).toBe(false)
  })

  it('Save runs insert → upload → patch in order and uploads to the lowercased path', async () => {
    render(<AddCaregiverSheet isOpen={true} onSaved={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('caregiver-name'),  { target: { value: 'Sarah' } })
    fireEvent.change(screen.getByTestId('caregiver-phone'), { target: { value: '+15555550199' } })
    pickFile(makeFile())

    fireEvent.click(screen.getByTestId('caregiver-sheet-save'))

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledOnce())
    expect(addMutateAsync).toHaveBeenCalledWith({
      name:  'Sarah',
      phone: '+15555550199',
      notes: null,
    })

    await waitFor(() => expect(storageUpload).toHaveBeenCalledOnce())
    const uploadCallArgs = storageUpload.mock.calls[0] as [string, File, { upsert: boolean; contentType: string }]
    expect(uploadCallArgs[0]).toBe(`${mockProfile.id.toLowerCase()}/caregivers/c-new.jpg`)
    expect(uploadCallArgs[2]).toMatchObject({ upsert: true, contentType: 'image/jpeg' })

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce())
    const patch = updateMutateAsync.mock.calls[0]?.[0] as { caregiverId: string; avatarUrl: string }
    expect(patch.caregiverId).toBe('c-new')
    expect(patch.avatarUrl).toContain('https://x.com/sarah.jpg')
    expect(patch.avatarUrl).toContain('?t=')   // cache-busted
  })

  it('Save calls onSaved + clears local state on success', async () => {
    const onSaved = vi.fn()
    render(<AddCaregiverSheet isOpen={true} onSaved={onSaved} onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('caregiver-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-sheet-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('Save surfaces an upload error inline without calling onSaved', async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: 'storage 403' } })
    const onSaved = vi.fn()
    render(<AddCaregiverSheet isOpen={true} onSaved={onSaved} onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('caregiver-name'), { target: { value: 'Sarah' } })
    pickFile(makeFile())
    fireEvent.click(screen.getByTestId('caregiver-sheet-save'))
    await waitFor(() => {
      expect(screen.getByTestId('caregiver-sheet-error').textContent).toContain('storage 403')
    })
    expect(onSaved).not.toHaveBeenCalled()
  })
})

// ── Edit mode ────────────────────────────────────────────────────────

const existing: Caregiver = {
  id:           'c-existing',
  user_id:      mockProfile.id,
  name:         'Mom',
  relationship: null,
  phone:        '+15555550100',
  notes:        null,
  avatar_url:   'https://x.com/mom.jpg',
  created_at:   '2026-05-01T10:00:00Z',
  updated_at:   '2026-05-01T10:00:00Z',
}

describe('AddCaregiverSheet — edit mode', () => {
  it('seeds the form from the editing row', () => {
    render(
      <AddCaregiverSheet
        isOpen={true}
        editing={existing}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    )
    expect((screen.getByTestId('caregiver-name')  as HTMLInputElement).value).toBe('Mom')
    expect((screen.getByTestId('caregiver-phone') as HTMLInputElement).value).toBe('+15555550100')
  })

  it('Save is enabled without re-picking a photo (existing avatar counts)', () => {
    render(
      <AddCaregiverSheet
        isOpen={true}
        editing={existing}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    )
    const save = screen.getByTestId('caregiver-sheet-save') as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('patches without re-uploading when the user does not re-pick a photo', async () => {
    render(
      <AddCaregiverSheet
        isOpen={true}
        editing={existing}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByTestId('caregiver-name'), { target: { value: 'Mom (updated)' } })
    fireEvent.click(screen.getByTestId('caregiver-sheet-save'))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce())
    expect(storageUpload).not.toHaveBeenCalled()
    expect(updateMutateAsync).toHaveBeenCalledWith({
      caregiverId: 'c-existing',
      name:        'Mom (updated)',
      phone:       '+15555550100',
      notes:       null,
    })
  })

  it('re-uploads + patches with the new avatarUrl when the user re-picks', async () => {
    render(
      <AddCaregiverSheet
        isOpen={true}
        editing={existing}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    )
    pickFile(makeFile('new.jpg'))
    fireEvent.click(screen.getByTestId('caregiver-sheet-save'))

    await waitFor(() => expect(storageUpload).toHaveBeenCalledOnce())
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledOnce())
    const patch = updateMutateAsync.mock.calls[0]?.[0] as { caregiverId: string; avatarUrl?: string }
    expect(patch.caregiverId).toBe('c-existing')
    expect(patch.avatarUrl).toContain('https://x.com/sarah.jpg')
  })
})
