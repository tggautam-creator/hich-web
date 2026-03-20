/**
 * Clean flat-design car icon. One universal shape, colored with the vehicle's
 * actual color from the palette. Inspired by Flaticon #9851490.
 *
 * Usage:
 *   <VehicleIcon color="#1565C0" />           // blue car
 *   <VehicleIcon color={vehicle.color} />     // vehicle's registered color
 *   <VehicleIcon />                           // default gray
 */

interface VehicleIconProps {
  /** CSS color for the car body (e.g. "#D32F2F", "blue", vehicle.color) */
  color?: string
  className?: string
  'data-testid'?: string
}

export default function VehicleIcon({
  color = '#6b7280',
  className = 'h-8 w-auto',
  'data-testid': testId,
}: VehicleIconProps) {
  // Darken the body color slightly for the lower body / shadow
  // We just use opacity layering instead of complex color math
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 40"
      className={className}
      data-testid={testId}
      aria-hidden="true"
    >
      {/* Car body — main shape */}
      <path
        d="M8 28 L8 22 C8 20 9 18 11 17 L18 14 C20 10 24 8 28 8 L40 8 C44 8 47 10 49 14 L54 17 C56 18 57 20 57 22 L57 28 Z"
        fill={color}
      />

      {/* Roof / cabin */}
      <path
        d="M20 14 C22 10 25 8.5 28 8.5 L38 8.5 C41 8.5 43 10 45 14 Z"
        fill={color}
        opacity="0.85"
      />

      {/* Windshield */}
      <path
        d="M22 14 L26 9.5 L36 9.5 C38 9.5 39 10 40 11 L44 14 Z"
        fill="white"
        opacity="0.6"
      />

      {/* Rear window */}
      <path
        d="M20.5 14 L23 10 L26 9.5 L22 14 Z"
        fill="white"
        opacity="0.45"
      />

      {/* Lower body stripe — adds depth */}
      <rect x="8" y="24" width="49" height="4" rx="1" fill={color} opacity="0.7" />

      {/* Bumpers */}
      <rect x="5" y="20" width="4" height="6" rx="2" fill={color} opacity="0.5" />
      <rect x="56" y="20" width="4" height="6" rx="2" fill={color} opacity="0.5" />

      {/* Headlight */}
      <ellipse cx="56.5" cy="21" rx="1.5" ry="1.2" fill="#fbbf24" />

      {/* Taillight */}
      <ellipse cx="8.5" cy="21" rx="1.2" ry="1" fill="#ef4444" />

      {/* Front wheel */}
      <circle cx="18" cy="28" r="5" fill="#374151" />
      <circle cx="18" cy="28" r="2.5" fill="#9ca3af" />
      <circle cx="18" cy="28" r="1" fill="#374151" />

      {/* Rear wheel */}
      <circle cx="47" cy="28" r="5" fill="#374151" />
      <circle cx="47" cy="28" r="2.5" fill="#9ca3af" />
      <circle cx="47" cy="28" r="1" fill="#374151" />

      {/* Door handle */}
      <rect x="30" y="17" width="3" height="0.8" rx="0.4" fill="white" opacity="0.4" />
    </svg>
  )
}
