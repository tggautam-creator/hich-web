/**
 * V4 F6 — projected per-rider split for a shared multi-rider event trip.
 *
 * Pre-ride ESTIMATE only. The real fare settles per-segment from GPS distance
 * at drop-off (see server/lib/segments.ts → computeRiderTotals). This mirrors
 * the settlement SHAPE so the preview and the charge agree structurally:
 *   - the $5 floor applies to the split BASE (gas + time),
 *   - caregiver + companion seat fees fold on top, un-floored.
 *
 * Model: split the rider's solo base (their pickup→event leg cost) evenly
 * across everyone expected to share the drive. This is optimistic vs. the
 * segment math (which charges only for the legs a rider is actually aboard
 * when pickups differ), so any UI surfacing it MUST label it an estimate. The
 * point it teaches is the DIRECTION: more riders → a smaller share each.
 */

/** $5 floor — mirrors MIN_FARE_CENTS in server/lib/segments.ts. */
export const MIN_FARE_CENTS = 500

export interface FareSplit {
  /** Expected riders sharing the drive (the split denominator), always ≥ 1. */
  rider_count: number
  /** What this rider would pay alone (base + their own seat fees). */
  solo_total_cents: number
  /** The split base before the floor + seat fees (for "splits N ways" copy). */
  base_split_cents: number
  /** This rider's estimated share: max(floor, base_split) + their seat fees. */
  your_share_cents: number
}

/**
 * @param baseCents      this rider's solo base (gas + time) for their leg
 * @param companionCents this rider's own companion seat fee (not split)
 * @param caregiverCents this rider's own caregiver seat fee (not split)
 * @param riderCount     how many riders are expected to share the drive
 */
export function computeProjectedSplit(
  baseCents: number,
  companionCents: number,
  caregiverCents: number,
  riderCount: number,
): FareSplit {
  const count = Math.max(1, Math.floor(riderCount))
  const baseSplit = Math.round(baseCents / count)
  const yourShare = Math.max(MIN_FARE_CENTS, baseSplit) + companionCents + caregiverCents
  return {
    rider_count: count,
    solo_total_cents: baseCents + companionCents + caregiverCents,
    base_split_cents: baseSplit,
    your_share_cents: yourShare,
  }
}
