/**
 * v1.3 Sprint 11 Slice 2 — AddTrustedContactSheet behaviour.
 * Mirrors iOS `AddTrustedContactSheet.swift`:
 *   - Two-section structure (picker header + manual-entry section
 *     header — picker is a "deferred — iOS only" hint on web).
 *   - Save disabled until name (1-60) AND normalised phone (7-20).
 *   - normalisePhone applied before posting (strips `(415) 555-1234`
 *     formatting).
 *   - Server INVALID_NAME / INVALID_PHONE / LIMIT_REACHED → exact
 *     iOS friendly copy.
 *   - Auto-focus the name field 250ms after open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AddTrustedContactSheet from '@/components/profile/AddTrustedContactSheet'
import { TrustedContactApiError, type TrustedContact } from '@/lib/trustedContactsApi'

// ── Mocks ────────────────────────────────────────────────────────────

const { addState } = vi.hoisted(() => ({
  addState: {
    isPending: false,
    mutateAsync: vi.fn(),
  } as { isPending: boolean; mutateAsync: ReturnType<typeof vi.fn> },
}))

vi.mock('@/hooks/useTrustedContacts', () => ({
  useAddTrustedContact: () => addState,
}))

// Portal-root for BottomSheet.
beforeEach(() => {
  vi.useRealTimers()
  addState.isPending = false
  addState.mutateAsync = vi.fn()
  if (!document.getElementById('portal-root')) {
    const el = document.createElement('div')
    el.id = 'portal-root'
    document.body.appendChild(el)
  }
})

function makeContact(over: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: 'c-new',
    name: 'Mom',
    phone: '+15555550199',
    created_at: '2026-06-02T10:00:00Z',
    ...over,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AddTrustedContactSheet', () => {
  it('does not render when isOpen=false', () => {
    render(<AddTrustedContactSheet isOpen={false} onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByTestId('add-trusted-contact-sheet')).not.toBeInTheDocument()
  })

  it('renders both iOS-mirrored section headers when open', () => {
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('add-trusted-contact-picker-section')).toBeInTheDocument()
    expect(screen.getByText('Or enter manually')).toBeInTheDocument()
    expect(screen.getByTestId('add-trusted-contact-name')).toBeInTheDocument()
    expect(screen.getByTestId('add-trusted-contact-phone')).toBeInTheDocument()
  })

  it('keeps Save disabled until BOTH name and normalised phone are valid', () => {
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    const save = screen.getByTestId('add-trusted-contact-save') as HTMLButtonElement
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByTestId('add-trusted-contact-name'), { target: { value: 'Mom' } })
    expect(save).toBeDisabled()
    // Phone formatted with parens + dashes — normalisePhone trims it
    // down to 10 digits, which passes the 7-char min.
    fireEvent.change(screen.getByTestId('add-trusted-contact-phone'), { target: { value: '(415) 555-1234' } })
    expect(save).not.toBeDisabled()
  })

  it('Save posts the NORMALISED phone (strips parens/dashes/spaces)', async () => {
    addState.mutateAsync.mockResolvedValueOnce(makeContact())
    const onSaved = vi.fn()
    render(<AddTrustedContactSheet isOpen onSaved={onSaved} onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('add-trusted-contact-name'), { target: { value: '  Mom  ' } })
    fireEvent.change(screen.getByTestId('add-trusted-contact-phone'), { target: { value: '+1 (415) 555-1234' } })
    fireEvent.click(screen.getByTestId('add-trusted-contact-save'))
    await waitFor(() => expect(addState.mutateAsync).toHaveBeenCalled())
    expect(addState.mutateAsync).toHaveBeenCalledWith({ name: 'Mom', phone: '+14155551234' })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-new' }))
  })

  it('renders INVALID_NAME friendly copy on server 400', async () => {
    addState.mutateAsync.mockRejectedValueOnce(
      new TrustedContactApiError('INVALID_NAME', 'Name must be 1-60 characters'),
    )
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('add-trusted-contact-name'), { target: { value: 'M' } })
    fireEvent.change(screen.getByTestId('add-trusted-contact-phone'), { target: { value: '+14155551234' } })
    fireEvent.click(screen.getByTestId('add-trusted-contact-save'))
    await waitFor(() => screen.getByTestId('add-trusted-contact-error'))
    expect(screen.getByTestId('add-trusted-contact-error').textContent).toContain('Name must be 1-60 characters.')
  })

  it('renders INVALID_PHONE friendly copy on server 400', async () => {
    addState.mutateAsync.mockRejectedValueOnce(
      new TrustedContactApiError('INVALID_PHONE', 'Phone must be a valid number'),
    )
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('add-trusted-contact-name'), { target: { value: 'Mom' } })
    fireEvent.change(screen.getByTestId('add-trusted-contact-phone'), { target: { value: '+14155551234' } })
    fireEvent.click(screen.getByTestId('add-trusted-contact-save'))
    await waitFor(() => screen.getByTestId('add-trusted-contact-error'))
    expect(screen.getByTestId('add-trusted-contact-error').textContent).toContain('Phone must be a valid number.')
  })

  it('renders LIMIT_REACHED friendly copy on server 409 (separate from client-side cap hide)', async () => {
    addState.mutateAsync.mockRejectedValueOnce(
      new TrustedContactApiError('LIMIT_REACHED', 'You can save up to 5 trusted contacts'),
    )
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('add-trusted-contact-name'), { target: { value: 'Sixth' } })
    fireEvent.change(screen.getByTestId('add-trusted-contact-phone'), { target: { value: '+14155551234' } })
    fireEvent.click(screen.getByTestId('add-trusted-contact-save'))
    await waitFor(() => screen.getByTestId('add-trusted-contact-error'))
    expect(screen.getByTestId('add-trusted-contact-error').textContent).toContain('You can save up to 5 trusted contacts.')
  })

  it('auto-focuses the Name field 250ms after opening (mirrors iOS Task.sleep(250ms))', async () => {
    vi.useFakeTimers()
    render(<AddTrustedContactSheet isOpen onSaved={vi.fn()} onClose={vi.fn()} />)
    const nameInput = screen.getByTestId('add-trusted-contact-name')
    expect(document.activeElement).not.toBe(nameInput)
    // Advance past the 250ms slide-in lag inside React's state-update batch.
    await act(async () => {
      vi.advanceTimersByTime(260)
    })
    expect(document.activeElement).toBe(nameInput)
  })
})
