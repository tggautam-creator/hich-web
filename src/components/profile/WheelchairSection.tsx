/**
 * v1.2 F4.2 — shared "Mobility aid space" form section used by both
 * `VehicleEditPage` (post-onboarding driver) and
 * `VehicleRegistrationPage` (onboarding driver). Mirrors iOS
 * `VehicleEditPage.swift` / `VehicleRegistrationPage.swift` 1:1.
 *
 * Behaviour the caller owns (not this component's job):
 *  - Toggle ON without an explicit trunkSize → caller seeds it from
 *    `defaultTrunkSize(body_type)` (so this component never has to
 *    know the car body type itself).
 *  - Toggle OFF → caller nulls the trunkSize so the column clears.
 *
 * This component just renders the rule, surfaces the toggle, and —
 * when on — the segmented small/medium/large picker.
 */
import type { TrunkSize } from '@/types/database'

interface WheelchairSectionProps {
  wheelchairCapable: boolean
  onToggle: (next: boolean) => void
  /** Effective trunk size to display (caller resolves the fallback). */
  trunkSize: TrunkSize
  onTrunkSizeChange: (size: TrunkSize) => void
  'data-testid'?: string
}

const TRUNK_SIZES: TrunkSize[] = ['small', 'medium', 'large']

export default function WheelchairSection({
  wheelchairCapable,
  onToggle,
  trunkSize,
  onTrunkSizeChange,
  'data-testid': testId = 'wheelchair-section',
}: WheelchairSectionProps) {
  return (
    <div data-testid={testId} className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Mobility aid space
      </span>

      <label className="flex items-start gap-3">
        <input
          data-testid="wheelchair-capable-toggle"
          type="checkbox"
          checked={wheelchairCapable}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
        />
        <div className="text-xs">
          <p className="font-semibold text-text-primary">Space for a mobility aid?</p>
          <p className="mt-0.5 text-text-secondary">
            Riders with wheelchairs, rollators, or walkers will see this on the ride board.
          </p>
        </div>
      </label>

      {wheelchairCapable && (
        <div data-testid="trunk-size-picker" className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-primary">Trunk size</span>
          <div
            role="radiogroup"
            aria-label="Trunk size"
            className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-xs"
          >
            {TRUNK_SIZES.map((size) => {
              const active = trunkSize === size
              return (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`trunk-size-${size}`}
                  onClick={() => onTrunkSizeChange(size)}
                  className={[
                    'rounded-lg px-3 py-1.5 font-medium capitalize transition-colors',
                    active
                      ? 'bg-white text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  ].join(' ')}
                >
                  {size}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-text-secondary">
            Auto-filled from your vehicle type. Tap to override if you've modified your cargo space.
          </p>
        </div>
      )}
    </div>
  )
}
