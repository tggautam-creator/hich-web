/**
 * Vehicle helpers — v1.2 F4 accessibility derivations.
 *
 * Mirrors iOS `Vehicle.swift::defaultTrunkSize(forBodyType:)`. Same
 * source of truth so the rider-side advisory text and the driver-side
 * pre-fill stay in lockstep across platforms.
 *
 * Drivers don't think in S/M/L for trunks — they think "I drive a
 * Civic." The plate-lookup endpoint gives us a body_type for free, so
 * we pre-fill the trunk-size picker from this mapping and let the
 * driver override.
 */

import type { TrunkSize } from '@/types/database'

const TRUNK_SIZE_BY_BODY_TYPE: Record<string, TrunkSize> = {
  sedan:     'small',
  coupe:     'small',
  hatchback: 'small',
  wagon:     'medium',
  suv:       'medium',
  minivan:   'large',
  pickup:    'large',
  van:       'large',
}

/**
 * Derive the default trunk size from a body-type string. Returns null
 * for unknown / missing body types so callers can decide whether to
 * fall through to 'small' or render nothing. Matches iOS's
 * `Vehicle.defaultTrunkSize(forBodyType:)` 1:1.
 */
export function defaultTrunkSize(bodyType: string | null | undefined): TrunkSize | null {
  if (!bodyType) return null
  const key = bodyType.toLowerCase()
  return TRUNK_SIZE_BY_BODY_TYPE[key] ?? null
}

/**
 * Convenience for downstream consumers: prefer the explicit
 * `trunkSize` when set, else fall back to the body-type derivation.
 * Returns null only when both are null. Mirrors iOS
 * `Vehicle.effectiveTrunkSize`.
 */
export function effectiveTrunkSize(
  trunkSize: TrunkSize | null | undefined,
  bodyType: string | null | undefined,
): TrunkSize | null {
  return trunkSize ?? defaultTrunkSize(bodyType)
}
