/**
 * v1.2 Sprint 6 Slice 2 — CaregiversSection behaviour.
 * Mirrors iOS ProfileCaregiversSection coverage for the cases that
 * map cleanly to web (loading / load-error / empty / list states,
 * Add row opens sheet, Remove confirm dialog).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CaregiversSection from '@/components/profile/CaregiversSection'
import type { Caregiver } from '@/types/database'

// ── Mocks ────────────────────────────────────────────────────────────

interface DeleteState {
  isPending: boolean
  variables: string | undefined
  mutateAsync: (id: string) => Promise<void>
}

const { listState, deleteState } = vi.hoisted(() => ({
  listState: {
    data:      [] as Caregiver[] | undefined,
    isLoading: false,
    error:     null as Error | null,
    refetch:   vi.fn(),
  },
  deleteState: {
    isPending:    false,
    variables:    undefined as string | undefined,
    mutateAsync:  vi.fn().mockResolvedValue(undefined),
  } satisfies DeleteState,
}))

vi.mock('@/hooks/useCaregivers', () => ({
  useMyCaregivers:    () => listState,
  useDeleteCaregiver: () => deleteState,
}))

// AddCaregiverSheet is unrelated to this slice's tests — stub it out
// so opening the sheet doesn't drag in supabase-js mocks.
vi.mock('@/components/profile/AddCaregiverSheet', () => ({
  default: ({ isOpen, editing, onClose }: {
    isOpen: boolean
    editing: Caregiver | null
    onClose: () => void
  }) =>
    isOpen ? (
      <div data-testid="mock-add-sheet">
        <span data-testid="mock-add-sheet-mode">
          {editing ? `edit:${editing.id}` : 'add'}
        </span>
        <button data-testid="mock-add-sheet-close" onClick={onClose}>close</button>
      </div>
    ) : null,
}))

beforeEach(() => {
  listState.data      = undefined
  listState.isLoading = false
  listState.error     = null
  listState.refetch   = vi.fn()
  deleteState.isPending   = false
  deleteState.variables   = undefined
  deleteState.mutateAsync = vi.fn().mockResolvedValue(undefined)
})

function makeCaregiver(over: Partial<Caregiver> = {}): Caregiver {
  return {
    id:           'c-1',
    user_id:      'user-1',
    name:         'Mom',
    relationship: null,
    phone:        '+15555550199',
    notes:        'Joins on chemo days',
    avatar_url:   null,
    created_at:   '2026-05-01T10:00:00Z',
    updated_at:   '2026-05-01T10:00:00Z',
    ...over,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CaregiversSection', () => {
  it('renders loading state', () => {
    listState.isLoading = true
    render(<CaregiversSection />)
    expect(screen.getByTestId('caregivers-loading')).toBeTruthy()
  })

  it('renders load-error with a Retry button that calls refetch', () => {
    listState.error = new Error('rls denied')
    render(<CaregiversSection />)
    const err = screen.getByTestId('caregivers-load-error')
    expect(err.textContent).toContain('rls denied')
    fireEvent.click(screen.getByText('Retry'))
    expect(listState.refetch).toHaveBeenCalledOnce()
  })

  it('renders empty state when the list is empty', () => {
    listState.data = []
    render(<CaregiversSection />)
    expect(screen.getByTestId('caregivers-empty')).toBeTruthy()
  })

  it('renders one row per caregiver with name + phone + notes + actions', () => {
    listState.data = [
      makeCaregiver(),
      makeCaregiver({ id: 'c-2', name: 'Dad', phone: null, notes: null }),
    ]
    render(<CaregiversSection />)
    expect(screen.getByTestId('caregiver-row-c-1')).toBeTruthy()
    expect(screen.getByTestId('caregiver-row-c-2')).toBeTruthy()
    expect(screen.getByText('Mom')).toBeTruthy()
    expect(screen.getByText('Dad')).toBeTruthy()
    expect(screen.getByText('+15555550199')).toBeTruthy()
    expect(screen.getByText('Joins on chemo days')).toBeTruthy()
    // Edit + Remove buttons per row
    expect(screen.getByTestId('caregiver-edit-c-1')).toBeTruthy()
    expect(screen.getByTestId('caregiver-remove-c-1')).toBeTruthy()
  })

  it('clicking the Add row opens the sheet in add mode', () => {
    listState.data = []
    render(<CaregiversSection />)
    fireEvent.click(screen.getByTestId('caregiver-add-button'))
    expect(screen.getByTestId('mock-add-sheet')).toBeTruthy()
    expect(screen.getByTestId('mock-add-sheet-mode').textContent).toBe('add')
  })

  it('clicking Edit opens the sheet in edit mode with the picked row', () => {
    listState.data = [makeCaregiver()]
    render(<CaregiversSection />)
    fireEvent.click(screen.getByTestId('caregiver-edit-c-1'))
    expect(screen.getByTestId('mock-add-sheet-mode').textContent).toBe('edit:c-1')
  })

  it('clicking Remove opens the confirm dialog; Cancel dismisses without deleting', () => {
    listState.data = [makeCaregiver()]
    render(<CaregiversSection />)
    fireEvent.click(screen.getByTestId('caregiver-remove-c-1'))
    expect(screen.getByTestId('caregiver-remove-confirm')).toBeTruthy()
    fireEvent.click(screen.getByTestId('caregiver-remove-cancel'))
    expect(screen.queryByTestId('caregiver-remove-confirm')).toBeNull()
    expect(deleteState.mutateAsync).not.toHaveBeenCalled()
  })

  it('confirming the remove dialog calls mutateAsync with the row id', async () => {
    listState.data = [makeCaregiver()]
    render(<CaregiversSection />)
    fireEvent.click(screen.getByTestId('caregiver-remove-c-1'))
    fireEvent.click(screen.getByTestId('caregiver-remove-confirm-btn'))
    expect(deleteState.mutateAsync).toHaveBeenCalledWith('c-1')
  })

  it('renders the avatar image when avatar_url is set, initials fallback when not', () => {
    listState.data = [
      makeCaregiver({ id: 'c-1', name: 'Sarah', avatar_url: 'https://x.com/s.jpg' }),
      makeCaregiver({ id: 'c-2', name: 'Bob',   avatar_url: null }),
    ]
    render(<CaregiversSection />)
    const sarahRow = screen.getByTestId('caregiver-row-c-1')
    expect(sarahRow.querySelector('img')).toBeTruthy()
    const bobRow = screen.getByTestId('caregiver-row-c-2')
    expect(bobRow.querySelector('img')).toBeNull()
    expect(bobRow.textContent).toContain('B')   // initial fallback
  })
})
