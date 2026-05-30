import { describe, it, expect } from 'vitest'
import { defaultTrunkSize, effectiveTrunkSize } from '@/lib/vehicle'

describe('defaultTrunkSize', () => {
  it('maps sedan / coupe / hatchback → small', () => {
    expect(defaultTrunkSize('sedan')).toBe('small')
    expect(defaultTrunkSize('coupe')).toBe('small')
    expect(defaultTrunkSize('hatchback')).toBe('small')
  })

  it('maps wagon / suv → medium', () => {
    expect(defaultTrunkSize('wagon')).toBe('medium')
    expect(defaultTrunkSize('suv')).toBe('medium')
  })

  it('maps minivan / pickup / van → large', () => {
    expect(defaultTrunkSize('minivan')).toBe('large')
    expect(defaultTrunkSize('pickup')).toBe('large')
    expect(defaultTrunkSize('van')).toBe('large')
  })

  it('is case-insensitive', () => {
    expect(defaultTrunkSize('SEDAN')).toBe('small')
    expect(defaultTrunkSize('Suv')).toBe('medium')
    expect(defaultTrunkSize('Van')).toBe('large')
  })

  it('returns null for null / undefined / empty / unknown body types', () => {
    expect(defaultTrunkSize(null)).toBeNull()
    expect(defaultTrunkSize(undefined)).toBeNull()
    expect(defaultTrunkSize('')).toBeNull()
    expect(defaultTrunkSize('spaceship')).toBeNull()
  })
})

describe('effectiveTrunkSize', () => {
  it('prefers explicit trunkSize over derivation', () => {
    expect(effectiveTrunkSize('large', 'sedan')).toBe('large')
    expect(effectiveTrunkSize('small', 'suv')).toBe('small')
  })

  it('falls back to body-type derivation when trunkSize is null', () => {
    expect(effectiveTrunkSize(null, 'sedan')).toBe('small')
    expect(effectiveTrunkSize(undefined, 'suv')).toBe('medium')
    expect(effectiveTrunkSize(null, 'van')).toBe('large')
  })

  it('returns null when both are missing', () => {
    expect(effectiveTrunkSize(null, null)).toBeNull()
    expect(effectiveTrunkSize(undefined, undefined)).toBeNull()
    expect(effectiveTrunkSize(null, 'spaceship')).toBeNull()
  })
})
