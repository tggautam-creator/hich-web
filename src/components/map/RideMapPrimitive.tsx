/**
 * v1.3 Sprint 10 Slice 3 — shared map shell for ride/Board surfaces.
 *
 * Lifts the inline `<Map>` + `<MapBoundsFitter>` + renderless pan-to
 * pattern that `TransitSuggestionCard` (Picker + mini-map) was using
 * inline into a single reusable primitive. Slice 4 will consume this
 * for the `RideBoardConfirmSheet` transit station mini-map + peek.
 *
 * Pure refactor — no behavior change for existing callers. The
 * primitive owns:
 *   • The `<Map>` shell with the project's `MAP_ID` + sensible defaults
 *     (gestureHandling="greedy", disableDefaultUI, clickableIcons=false)
 *   • Bounds fitting via `<MapBoundsFitter>` (renderless, child of Map
 *     so it can read `useMap()`)
 *   • Optional pan-to behavior (peek mode — overrides bounds-fit by
 *     panning to a specific coord after the initial fit settles)
 *
 * Callers retain control over what markers / polylines render — they
 * pass them as `children`. This keeps the primitive thin and lets the
 * caller manage its own selection state, scroll-sync, etc. (Matches the
 * Slice 3 open-question fallback that explicitly said to keep
 * cardRefs scroll-sync OUT of the primitive.)
 *
 * Per CLAUDE.md mandatory-exception clause: this slice ships ONLY this
 * file + a refactor of TransitSuggestionCard + a snapshot equivalence
 * test. No user-visible parity surface — reviewer matrix is N/A per
 * the pure-refactor exemption.
 */

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Map, useMap } from '@vis.gl/react-google-maps'
import { MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'

// ── Renderless helper: pan to a point after the initial bounds-fit ──────

/** When `coord` is non-null, pans the underlying map to it whenever
 *  the coord changes. Renderless — must live as a child of `<Map>`
 *  because it calls `useMap()`. */
function MapPanTo({ coord }: { coord: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !coord) return
    map.panTo(coord)
  }, [map, coord?.lat, coord?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// ── Props ──────────────────────────────────────────────────────────────

export interface RideMapPrimitiveProps {
  /**
   * Pins, polylines, and any other React children to render INSIDE
   * the `<Map>`. Caller is responsible for instantiating
   * `<AdvancedMarker>` / `<RoutePolyline>` etc. The primitive does NOT
   * own marker UI — that stays in caller-land so consumers can drive
   * their own selection state, scroll-sync, etc.
   */
  children?: ReactNode

  /** Coords used for the initial bounds-fit. When provided, the
   *  primitive mounts `<MapBoundsFitter>` internally. Pass an empty
   *  array (or omit) to skip the fit and rely on `defaultCenter` +
   *  `defaultZoom`. */
  boundsPoints?: Array<{ lat: number; lng: number }>

  /**
   * Peek mode — when non-null, pans the camera to this coord after
   * the initial fit. Use when the caller wants to tighten focus on a
   * specific marker (e.g. selecting a station from a list). Pass null
   * to skip the pan and let the initial bounds-fit be the resting
   * state.
   */
  panTo?: { lat: number; lng: number } | null

  /** Map mapId — defaults to the project's `MAP_ID`. Override only for
   *  testing or to render against a different vector style. */
  mapId?: string

  /** Initial center before bounds-fit runs. Defaults to the rough
   *  Davis, CA coords the project uses elsewhere. */
  defaultCenter?: { lat: number; lng: number }

  /** Initial zoom before bounds-fit runs. */
  defaultZoom?: number

  /** CSS height for the wrapper div. Use a fixed pixel value
   *  (`'180px'`) to match iOS `RideBoardTransitMiniMap`'s 180pt
   *  default. */
  height?: string

  /** Extra classes to apply to the wrapper div (rounded corners,
   *  border, etc. — the primitive itself ships no chrome). */
  className?: string

  'data-testid'?: string
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * Thin shared `<Map>` shell for ride / Board surfaces. See module
 * docstring for the design contract.
 */
export default function RideMapPrimitive({
  children,
  boundsPoints,
  panTo = null,
  mapId,
  defaultCenter = { lat: 38.5, lng: -121.7 },
  defaultZoom = 12,
  height = '180px',
  className = '',
  'data-testid': testId,
}: RideMapPrimitiveProps) {
  return (
    <div
      data-testid={testId}
      className={className}
      style={{ height }}
    >
      <Map
        mapId={mapId ?? MAP_ID}
        defaultZoom={defaultZoom}
        defaultCenter={defaultCenter}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        className="h-full w-full"
      >
        {boundsPoints != null && boundsPoints.length > 0 && (
          <MapBoundsFitter points={boundsPoints} />
        )}
        <MapPanTo coord={panTo} />
        {children}
      </Map>
    </div>
  )
}
