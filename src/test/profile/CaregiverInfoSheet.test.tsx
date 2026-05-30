/**
 * v1.2 Sprint 6 Slice 4 — CaregiverInfoSheet behaviour.
 *
 * Asserts:
 *  - Hero (name) + DJC explainer always render
 *  - Action grid hides when no phone
 *  - Action links use tel:/sms: protocols
 *  - Copy button writes to clipboard + shows toast
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaregiverInfoSheet from '@/components/profile/CaregiverInfoSheet'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  writeText.mockClear()
  document.body.innerHTML = '<div id="portal-root"></div>'
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

describe('CaregiverInfoSheet', () => {
  it('renders the caregiver name + the DJC explainer', () => {
    render(
      <CaregiverInfoSheet
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '+15555550199', avatar_url: null }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('caregiver-info-name').textContent).toBe('Sarah')
    expect(screen.getByText(/Who is a caregiver\?/i)).toBeTruthy()
  })

  it('hides the action grid when phone is missing', () => {
    render(
      <CaregiverInfoSheet
        caregiver={{ id: 'c-1', name: 'Sarah', phone: null, avatar_url: null }}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByTestId('caregiver-info-actions')).toBeNull()
  })

  it('renders Call + Message + Copy when phone is present', () => {
    render(
      <CaregiverInfoSheet
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '+15555550199', avatar_url: null }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('caregiver-info-call').getAttribute('href')).toBe('tel:+15555550199')
    expect(screen.getByTestId('caregiver-info-message').getAttribute('href')).toBe('sms:+15555550199')
    expect(screen.getByTestId('caregiver-info-copy')).toBeTruthy()
  })

  it('Copy writes to clipboard and shows the toast', async () => {
    render(
      <CaregiverInfoSheet
        caregiver={{ id: 'c-1', name: 'Sarah', phone: '+15555550199', avatar_url: null }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('caregiver-info-copy'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('+15555550199')
    })
    await waitFor(() => {
      expect(screen.getByTestId('caregiver-info-copied-toast')).toBeTruthy()
    })
  })
})
