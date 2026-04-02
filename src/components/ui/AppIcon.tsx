/**
 * Clean, professional icon set for the TAGO app.
 * Filled style with consistent weight — no emojis, no outlines.
 * Matches the visual language of Uber/Lyft.
 */

interface AppIconProps {
  name: AppIconName
  className?: string
  'data-testid'?: string
}

export type AppIconName =
  | 'car-request'       // ride request notification
  | 'clipboard'         // board request
  | 'check-circle'      // accepted / success
  | 'x-circle'          // declined / error
  | 'bell'              // generic notification
  | 'star'              // rating
  | 'verified'          // verified driver badge
  | 'person'            // rider
  | 'steering-wheel'    // driver
  | 'search'            // search / no results
  | 'graduation'        // campus / education
  | 'lightning'         // real-time / instant
  | 'shield'            // safety / trust
  | 'wallet'            // earnings / money
  | 'rocket'            // get started
  | 'credit-card'       // payment
  | 'bank'              // payouts

export default function AppIcon({
  name,
  className = 'h-5 w-5',
  'data-testid': testId,
}: AppIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      data-testid={testId}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

// ── Icon paths ────────────────────────────────────────────────────────────────
// All use fill="currentColor" for easy theming via Tailwind text-* classes.

const ICONS: Record<AppIconName, React.ReactNode> = {
  'car-request': (
    <g fill="currentColor">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </g>
  ),

  clipboard: (
    <g fill="currentColor">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
    </g>
  ),

  'check-circle': (
    <g fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </g>
  ),

  'x-circle': (
    <g fill="currentColor">
      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
    </g>
  ),

  bell: (
    <g fill="currentColor">
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </g>
  ),

  star: (
    <g fill="currentColor">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </g>
  ),

  verified: (
    <g fill="currentColor">
      <path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82 1.89 3.2L12 21.04l3.4 1.46 1.89-3.2 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.8 1.39-1.41 2.42 2.42 6.1-6.11 1.39 1.41-7.5 7.49z" />
    </g>
  ),

  person: (
    <g fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </g>
  ),

  'steering-wheel': (
    <g fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L10.5 12H4.06c.23 3.77 3.31 6.8 7.08 6.98L12 20zm0-10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm7.94 2h-6.44l4.81-4.9A7.945 7.945 0 0 1 19.94 12z" />
    </g>
  ),

  search: (
    <g fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </g>
  ),

  graduation: (
    <g fill="currentColor">
      <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />
    </g>
  ),

  lightning: (
    <g fill="currentColor">
      <path d="M7 2v11h3v9l7-12h-4l4-8z" />
    </g>
  ),

  shield: (
    <g fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
    </g>
  ),

  wallet: (
    <g fill="currentColor">
      <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
    </g>
  ),

  rocket: (
    <g fill="currentColor">
      <path d="M12 2.5c0 0-7 6-7 12.5 0 3 1.5 5.5 3.5 7l1-2.5c.5.3 1 .5 1.5.6V23h2v-2.9c.5-.1 1-.3 1.5-.6l1 2.5c2-1.5 3.5-4 3.5-7 0-6.5-7-12.5-7-12.5zM12 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </g>
  ),

  'credit-card': (
    <g fill="currentColor">
      <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
    </g>
  ),

  bank: (
    <g fill="currentColor">
      <path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z" />
    </g>
  ),
}
