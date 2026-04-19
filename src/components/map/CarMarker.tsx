interface CarMarkerProps {
  /** Pixel width of the SVG. Default: 32 */
  size?: number
  /** Fill color. Default: '#FFFFFF' (white for dark map contrast). */
  color?: string
  /** Optional CSS class. */
  className?: string
  /** Test ID. */
  'data-testid'?: string
  /**
   * Bearing in degrees clockwise from north. When provided, the marker
   * rotates so the nose points in the direction of travel. Transitioned
   * smoothly so the car doesn't snap between GPS ticks.
   */
  bearing?: number
}

/**
 * Top-down (bird's-eye) car silhouette for use inside Google Maps
 * AdvancedMarker. Designed to be recognisable at 24–48 px.
 */
export default function CarMarker({
  size = 32,
  color = '#FFFFFF',
  className,
  'data-testid': testId,
  bearing,
}: CarMarkerProps) {
  // The SVG is drawn in a 24×40 viewBox (portrait-oriented car)
  const height = Math.round(size * (40 / 24))

  // The SVG is drawn nose-up (north), so a bearing of 0° = no rotation.
  // Long transition covers the gap between GPS ticks (~5–15 s) so the
  // rotation looks like steering rather than teleporting.
  const rotate = typeof bearing === 'number' ? bearing : 0
  const transform = `rotate(${rotate}deg)`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 40"
      width={size}
      height={height}
      fill={color}
      className={className}
      data-testid={testId}
      aria-hidden="true"
      style={{
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
        transform,
        transformOrigin: '50% 50%',
        transition: 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Car body */}
      <rect x="4" y="2" width="16" height="36" rx="6" ry="6" />

      {/* Windshield */}
      <rect x="6" y="7" width="12" height="7" rx="2" ry="2" fill="#000" opacity="0.25" />

      {/* Rear window */}
      <rect x="6" y="28" width="12" height="6" rx="2" ry="2" fill="#000" opacity="0.25" />

      {/* Left mirror */}
      <rect x="1" y="11" width="3.5" height="5" rx="1.75" />

      {/* Right mirror */}
      <rect x="19.5" y="11" width="3.5" height="5" rx="1.75" />
    </svg>
  )
}
