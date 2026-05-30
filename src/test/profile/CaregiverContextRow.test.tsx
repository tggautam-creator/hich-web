/**
 * v1.2 Sprint 6 Slice 4 — CaregiverContextRow behaviour.
 *
 * Pure presentational + state machine for opening the detail sheet.
 * CaregiverInfoSheet is rendered as a side effect on click; we
 * stub it to keep this test focused on the row itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CaregiverContextRow from '@/components/profile/CaregiverContextRow'

vi.mock('@/components/profile/CaregiverInfoSheet', () => ({
  default: ({ caregiver }: { caregiver: { id: string; name: string } }) => (
    <div data-testid="mock-info-sheet">{caregiver.name}</div>
  ),
}))

beforeEach(() => {
  document.body.innerHTML = '<div id="portal-root"></div>'
})

describe('CaregiverContextRow', () => {
  it('renders nothing when caregiver is null', () => {
    const { container } = render(<CaregiverContextRow caregiver={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when caregiver has no name', () => {
    const { container } = render(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: '', phone: null, avatar_url: null }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the row with avatar fallback when no avatar_url', () => {
    render(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: 'Sarah', phone: null, avatar_url: null }}
      />,
    )
    const row = screen.getByTestId('caregiver-context-row')
    expect(row.textContent).toContain('Sarah')
    expect(row.textContent).toContain('Riding with caregiver')
    expect(row.querySelector('img')).toBeNull()
  })

  it('renders the avatar image when avatar_url is set', () => {
    render(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: 'Sarah', phone: null, avatar_url: 'https://x.com/s.jpg' }}
      />,
    )
    const img = screen.getByTestId('caregiver-context-row').querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://x.com/s.jpg')
  })

  it('shows phone badge only when phone is non-empty', () => {
    const { rerender } = render(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '+15555550199', avatar_url: null }}
      />,
    )
    expect(screen.getByTestId('caregiver-context-row').querySelector('[title="Phone available"]')).toBeTruthy()

    rerender(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '   ', avatar_url: null }}
      />,
    )
    expect(screen.queryByTestId('caregiver-context-row')?.querySelector('[title="Phone available"]')).toBeNull()
  })

  it('clicking the row mounts the CaregiverInfoSheet', () => {
    render(
      <CaregiverContextRow
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '+15555550199', avatar_url: null }}
      />,
    )
    expect(screen.queryByTestId('mock-info-sheet')).toBeNull()
    fireEvent.click(screen.getByTestId('caregiver-context-row'))
    expect(screen.getByTestId('mock-info-sheet').textContent).toBe('Sarah')
  })
})
