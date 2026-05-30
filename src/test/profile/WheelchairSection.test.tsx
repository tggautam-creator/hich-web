/**
 * v1.2 Sprint 7 Slice 3 — WheelchairSection behaviour.
 *
 * The component itself is intentionally dumb: it doesn't own the
 * trunk-size fallback chain (the parent does). These tests pin the
 * dumb contract — toggle fires, picker hides until on, segmented
 * buttons report aria-checked correctly, onTrunkSizeChange fires with
 * the right TrunkSize value.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WheelchairSection from '@/components/profile/WheelchairSection'

describe('WheelchairSection', () => {
  it('hides the trunk-size picker when wheelchair is off', () => {
    render(
      <WheelchairSection
        wheelchairCapable={false}
        onToggle={() => {}}
        trunkSize="small"
        onTrunkSizeChange={() => {}}
      />,
    )
    expect(screen.queryByTestId('trunk-size-picker')).toBeNull()
  })

  it('renders the trunk-size picker when wheelchair is on', () => {
    render(
      <WheelchairSection
        wheelchairCapable={true}
        onToggle={() => {}}
        trunkSize="medium"
        onTrunkSizeChange={() => {}}
      />,
    )
    expect(screen.getByTestId('trunk-size-picker')).toBeTruthy()
    expect(screen.getByTestId('trunk-size-small')).toBeTruthy()
    expect(screen.getByTestId('trunk-size-medium')).toBeTruthy()
    expect(screen.getByTestId('trunk-size-large')).toBeTruthy()
  })

  it('marks the active size with aria-checked', () => {
    render(
      <WheelchairSection
        wheelchairCapable={true}
        onToggle={() => {}}
        trunkSize="large"
        onTrunkSizeChange={() => {}}
      />,
    )
    expect(screen.getByTestId('trunk-size-large').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('trunk-size-small').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('trunk-size-medium').getAttribute('aria-checked')).toBe('false')
  })

  it('fires onToggle with the new boolean when the checkbox is clicked', () => {
    const onToggle = vi.fn()
    render(
      <WheelchairSection
        wheelchairCapable={false}
        onToggle={onToggle}
        trunkSize="small"
        onTrunkSizeChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('wheelchair-capable-toggle'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('fires onTrunkSizeChange with the picked TrunkSize value', () => {
    const onTrunkSizeChange = vi.fn()
    render(
      <WheelchairSection
        wheelchairCapable={true}
        onToggle={() => {}}
        trunkSize="small"
        onTrunkSizeChange={onTrunkSizeChange}
      />,
    )
    fireEvent.click(screen.getByTestId('trunk-size-large'))
    expect(onTrunkSizeChange).toHaveBeenCalledWith('large')
  })
})
