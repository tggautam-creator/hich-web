/**
 * v1.3 Sprint 11 Slice 2 — TrustedContactsSection behaviour.
 * Mirrors iOS `ProfileSafetySection.swift` coverage:
 *   - loading / load-error / empty / list states
 *   - empty-state exact copy (cap-substituted)
 *   - per-row delete confirmation dialog with verbatim iOS copy
 *   - add button hidden at cap (defence-in-depth alongside server 409)
 *   - add button label flips between "first" / "another"
 *   - server 409 LIMIT_REACHED → user copy ("You can save up to 5
 *     trusted contacts.") via the section's action-error surface
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TrustedContactsSection from '@/components/profile/TrustedContactsSection'
import { TrustedContactApiError, type TrustedContact } from '@/lib/trustedContactsApi'

// ── Mocks ────────────────────────────────────────────────────────────

interface DeleteState {
  isPending: boolean
  error: Error | null
  mutateAsync: (id: string) => Promise<void>
}

const { listState, deleteState } = vi.hoisted(() => ({
  listState: {
    data: undefined as TrustedContact[] | undefined,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  deleteState: {
    isPending: false,
    error: null as Error | null,
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  } satisfies DeleteState,
}))

vi.mock('@/hooks/useTrustedContacts', () => ({
  useMyTrustedContacts: () => listState,
  useDeleteTrustedContact: () => deleteState,
}))

// Stub the AddSheet — out-of-scope for the section's behaviour tests.
vi.mock('@/components/profile/AddTrustedContactSheet', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-add-sheet">
        <button data-testid="mock-add-sheet-close" onClick={onClose}>close</button>
      </div>
    ) : null,
}))

beforeEach(() => {
  listState.data = undefined
  listState.isLoading = false
  listState.isFetching = false
  listState.error = null
  listState.refetch = vi.fn()
  deleteState.isPending = false
  deleteState.error = null
  deleteState.mutateAsync = vi.fn().mockResolvedValue(undefined)
})

function makeContact(over: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: 'c-1',
    name: 'Mom',
    phone: '+15555550199',
    created_at: '2026-05-01T10:00:00Z',
    ...over,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TrustedContactsSection', () => {
  it('renders the loading state', () => {
    listState.isLoading = true
    render(<TrustedContactsSection />)
    expect(screen.getByTestId('trusted-contacts-loading')).toBeInTheDocument()
  })

  it('renders the load-error state + Retry calls refetch', () => {
    listState.error = new Error('rls denied')
    render(<TrustedContactsSection />)
    expect(screen.getByTestId('trusted-contacts-load-error')).toBeInTheDocument()
    expect(screen.getByText(/Tap retry/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('trusted-contacts-retry'))
    expect(listState.refetch).toHaveBeenCalledOnce()
  })

  it('renders the empty state with cap-substituted iOS copy verbatim', () => {
    listState.data = []
    render(<TrustedContactsSection />)
    const empty = screen.getByTestId('trusted-contacts-empty')
    expect(empty.textContent).toContain('No trusted contacts yet')
    // Exact iOS copy from ProfileSafetySection.swift:28-31.
    expect(empty.textContent).toContain('Add up to 5 people')
    expect(empty.textContent).toContain('live-tracking link')
  })

  it('renders the empty add button with the "first" label when count=0', () => {
    listState.data = []
    render(<TrustedContactsSection />)
    expect(screen.getByTestId('trusted-contacts-add').textContent).toContain('Add your first trusted contact')
  })

  it('renders the non-empty add button with the "another" label when count between 1 and 4', () => {
    listState.data = [makeContact()]
    render(<TrustedContactsSection />)
    expect(screen.getByTestId('trusted-contacts-add').textContent).toContain('Add another contact')
  })

  it('lists all rows and HIDES the add button at the 5-contact cap (defence-in-depth)', () => {
    listState.data = Array.from({ length: 5 }, (_, i) => makeContact({ id: `c-${i}`, name: `Contact ${i}` }))
    render(<TrustedContactsSection />)
    expect(screen.getAllByText(/Contact \d/)).toHaveLength(5)
    expect(screen.queryByTestId('trusted-contacts-add')).not.toBeInTheDocument()
  })

  it('opens the AddSheet stub when the Add button is clicked', () => {
    listState.data = []
    render(<TrustedContactsSection />)
    fireEvent.click(screen.getByTestId('trusted-contacts-add'))
    expect(screen.getByTestId('mock-add-sheet')).toBeInTheDocument()
  })

  it('shows the destructive confirm dialog with the verbatim iOS copy on row delete tap', () => {
    listState.data = [makeContact({ id: 'c-1', name: 'Dad' })]
    render(<TrustedContactsSection />)
    fireEvent.click(screen.getByTestId('trusted-contact-delete-c-1'))
    const dialog = screen.getByTestId('trusted-contacts-confirm-delete')
    expect(dialog.textContent).toContain('Remove this contact?')
    // Verbatim iOS string from ProfileSafetySection.swift:92.
    expect(dialog.textContent).toContain("They won't receive your live-tracking link in an emergency.")
  })

  it('Confirm → Remove calls deleteMutation with the row id', async () => {
    listState.data = [makeContact({ id: 'c-1', name: 'Dad' })]
    render(<TrustedContactsSection />)
    fireEvent.click(screen.getByTestId('trusted-contact-delete-c-1'))
    fireEvent.click(screen.getByTestId('trusted-contacts-confirm-remove'))
    expect(deleteState.mutateAsync).toHaveBeenCalledWith('c-1')
  })

  it('Confirm → Cancel closes the dialog without calling deleteMutation', () => {
    listState.data = [makeContact({ id: 'c-1', name: 'Dad' })]
    render(<TrustedContactsSection />)
    fireEvent.click(screen.getByTestId('trusted-contact-delete-c-1'))
    fireEvent.click(screen.getByTestId('trusted-contacts-confirm-cancel'))
    expect(screen.queryByTestId('trusted-contacts-confirm-delete')).not.toBeInTheDocument()
    expect(deleteState.mutateAsync).not.toHaveBeenCalled()
  })

  it('surfaces a delete LIMIT_REACHED 409 with the friendly user copy', () => {
    // Simulate a stale delete that bounced — section should show the
    // copy in its action-error footer once the mutation settles.
    listState.data = [makeContact({ id: 'c-1' })]
    deleteState.error = new TrustedContactApiError('LIMIT_REACHED', 'You can save up to 5 trusted contacts')
    render(<TrustedContactsSection />)
    const action = screen.getByTestId('trusted-contacts-action-error')
    expect(action.textContent).toContain('You can save up to 5 trusted contacts.')
  })
})
