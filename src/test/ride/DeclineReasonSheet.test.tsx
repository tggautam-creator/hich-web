/**
 * DeclineReasonSheet tests
 *
 * Sprint 2 W-T1-D1 (2026-05-16) — bottom-sheet shown after a driver
 * taps Decline on an inbound ride request. Web mirror of iOS
 * `DeclineReasonSheet.swift`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DeclineReasonSheet from '@/components/ride/DeclineReasonSheet'

describe('DeclineReasonSheet', () => {
  it('renders all 7 reason pills + 6 snooze pills', () => {
    render(
      <DeclineReasonSheet onSubmit={() => {}} onCancel={() => {}} />,
    )
    // Reasons (locked decision — 7-pill extended set)
    for (const reason of [
      'Too far',
      'Wrong direction',
      'Busy right now',
      'Taking a break',
      'Detour too long',
      'Pickup too far from me',
      'Other',
    ]) {
      expect(screen.getByTestId(`decline-reason-${reason}`)).toBeInTheDocument()
    }
    // Snooze (6-pill full iOS set)
    for (const minutes of [15, 60, 120, 240, 480, 1440]) {
      expect(screen.getByTestId(`decline-snooze-${minutes}`)).toBeInTheDocument()
    }
  })

  it('Just decline submits with null reason + null snooze', () => {
    const onSubmit = vi.fn()
    render(
      <DeclineReasonSheet onSubmit={onSubmit} onCancel={() => {}} />,
    )

    fireEvent.click(screen.getByTestId('decline-skip'))
    expect(onSubmit).toHaveBeenCalledWith(null, null)
  })

  it('Submit fires with the picked reason + snooze', () => {
    const onSubmit = vi.fn()
    render(
      <DeclineReasonSheet onSubmit={onSubmit} onCancel={() => {}} />,
    )

    fireEvent.click(screen.getByTestId('decline-reason-Too far'))
    fireEvent.click(screen.getByTestId('decline-snooze-60'))
    fireEvent.click(screen.getByTestId('decline-submit'))

    expect(onSubmit).toHaveBeenCalledWith('Too far', 60)
  })

  it('toggling a selected pill clears it (re-tap = deselect)', () => {
    const onSubmit = vi.fn()
    render(
      <DeclineReasonSheet onSubmit={onSubmit} onCancel={() => {}} />,
    )

    const pill = screen.getByTestId('decline-reason-Other')
    fireEvent.click(pill)
    expect(pill).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pill)
    expect(pill).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByTestId('decline-submit'))
    expect(onSubmit).toHaveBeenCalledWith(null, null)
  })

  it('Submit label changes to "Decline & pause for X" when a snooze is selected', () => {
    render(
      <DeclineReasonSheet onSubmit={() => {}} onCancel={() => {}} />,
    )

    expect(screen.getByTestId('decline-submit')).toHaveTextContent('Decline')
    fireEvent.click(screen.getByTestId('decline-snooze-240'))
    expect(screen.getByTestId('decline-submit')).toHaveTextContent(
      'Decline & pause for 4 hours',
    )
  })

  it('Backdrop click fires onCancel; inside-sheet click does not', () => {
    const onCancel = vi.fn()
    render(
      <DeclineReasonSheet onSubmit={() => {}} onCancel={onCancel} />,
    )

    // Clicking inside the sheet shouldn't bubble
    fireEvent.click(screen.getByTestId('decline-reason-Other'))
    expect(onCancel).not.toHaveBeenCalled()

    // Clicking the backdrop (the outer wrapper) does fire onCancel
    fireEvent.click(screen.getByTestId('decline-reason-sheet'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
