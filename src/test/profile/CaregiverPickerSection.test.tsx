/**
 * v1.2 Sprint 6 Slice 3 — CaregiverPickerSection behaviour.
 *
 * Pure presentational test — no data-layer mocks needed. Asserts the
 * toggle-OFF default state, the auto-select first behaviour on
 * toggle ON, the single-vs-multiple caregiver UI branch, and the
 * live fee preview tied to distance.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CaregiverPickerSection from '@/components/profile/CaregiverPickerSection'
import type { Caregiver } from '@/types/database'

function makeCaregiver(over: Partial<Caregiver> = {}): Caregiver {
  return {
    id:           'c-1',
    user_id:      'u-1',
    name:         'Mom',
    relationship: null,
    phone:        null,
    notes:        null,
    avatar_url:   null,
    created_at:   '2026-05-01T10:00:00Z',
    updated_at:   '2026-05-01T10:00:00Z',
    ...over,
  }
}

describe('CaregiverPickerSection', () => {
  it('renders nothing when caregivers list is empty', () => {
    const { container } = render(
      <CaregiverPickerSection
        caregivers={[]}
        selectedId={null}
        onChange={() => {}}
        distanceKm={5}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('toggle starts off; checking it calls onChange with the first caregiver id', () => {
    const onChange = vi.fn()
    render(
      <CaregiverPickerSection
        caregivers={[makeCaregiver({ id: 'c-1' }), makeCaregiver({ id: 'c-2', name: 'Dad' })]}
        selectedId={null}
        onChange={onChange}
        distanceKm={5}
      />,
    )
    expect((screen.getByTestId('caregiver-picker-toggle') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByTestId('caregiver-picker-fee')).toBeNull()

    fireEvent.click(screen.getByTestId('caregiver-picker-toggle'))
    expect(onChange).toHaveBeenCalledWith('c-1')
  })

  it('unchecking the toggle clears the selection', () => {
    const onChange = vi.fn()
    render(
      <CaregiverPickerSection
        caregivers={[makeCaregiver()]}
        selectedId="c-1"
        onChange={onChange}
        distanceKm={5}
      />,
    )
    fireEvent.click(screen.getByTestId('caregiver-picker-toggle'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('single caregiver: shows "with X" caption, no select element', () => {
    render(
      <CaregiverPickerSection
        caregivers={[makeCaregiver({ name: 'Mom' })]}
        selectedId="c-1"
        onChange={() => {}}
        distanceKm={5}
      />,
    )
    expect(screen.getByTestId('caregiver-picker-only').textContent).toContain('Mom')
    expect(screen.queryByTestId('caregiver-picker-select')).toBeNull()
  })

  it('multiple caregivers: renders a select, default value is the currently-selected id', () => {
    render(
      <CaregiverPickerSection
        caregivers={[
          makeCaregiver({ id: 'c-1', name: 'Mom' }),
          makeCaregiver({ id: 'c-2', name: 'Dad' }),
        ]}
        selectedId="c-2"
        onChange={() => {}}
        distanceKm={5}
      />,
    )
    const select = screen.getByTestId('caregiver-picker-select') as HTMLSelectElement
    expect(select.value).toBe('c-2')
    expect(screen.queryByTestId('caregiver-picker-only')).toBeNull()
  })

  it('changing the select fires onChange with the picked id', () => {
    const onChange = vi.fn()
    render(
      <CaregiverPickerSection
        caregivers={[
          makeCaregiver({ id: 'c-1', name: 'Mom' }),
          makeCaregiver({ id: 'c-2', name: 'Dad' }),
        ]}
        selectedId="c-1"
        onChange={onChange}
        distanceKm={5}
      />,
    )
    fireEvent.change(screen.getByTestId('caregiver-picker-select'), { target: { value: 'c-2' } })
    expect(onChange).toHaveBeenCalledWith('c-2')
  })

  it('fee preview reflects the tier for distanceKm', () => {
    // <10 mi = 16.09 km → $3
    const { rerender } = render(
      <CaregiverPickerSection
        caregivers={[makeCaregiver()]}
        selectedId="c-1"
        onChange={() => {}}
        distanceKm={5}
      />,
    )
    expect(screen.getByTestId('caregiver-picker-fee').textContent).toContain('+$3.00')

    // 10–50 mi → $5  (40 km ≈ 24.85 mi)
    rerender(
      <CaregiverPickerSection
        caregivers={[makeCaregiver()]}
        selectedId="c-1"
        onChange={() => {}}
        distanceKm={40}
      />,
    )
    expect(screen.getByTestId('caregiver-picker-fee').textContent).toContain('+$5.00')

    // >50 mi → $8  (100 km ≈ 62.14 mi)
    rerender(
      <CaregiverPickerSection
        caregivers={[makeCaregiver()]}
        selectedId="c-1"
        onChange={() => {}}
        distanceKm={100}
      />,
    )
    expect(screen.getByTestId('caregiver-picker-fee').textContent).toContain('+$8.00')
  })

  it('drops back to the first row when the stored selectedId is no longer present', () => {
    const onChange = vi.fn()
    render(
      <CaregiverPickerSection
        caregivers={[
          makeCaregiver({ id: 'c-1', name: 'Mom' }),
          makeCaregiver({ id: 'c-2', name: 'Dad' }),
        ]}
        selectedId="c-stale"
        onChange={onChange}
        distanceKm={5}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('c-1')
  })
})
