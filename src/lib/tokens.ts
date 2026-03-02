/**
 * Design tokens — single source of truth for all colours and typography.
 *
 * Rules:
 *  - NEVER use raw hex values in component files. Import from here instead.
 *  - When a colour is used as a Tailwind utility class (bg-primary, text-danger, …)
 *    the class name is derived from the key in `colors` as registered in
 *    tailwind.config.cjs.  Both files must be kept in sync.
 *  - When you need a colour at runtime (inline style, canvas, charting lib, …)
 *    import the value from `colors` below.
 */

export const colors = {
  /** Brand / interactive */
  primary:       '#2563EB',   // Tailwind: bg-primary, text-primary, border-primary
  primaryDark:   '#1E40AF',   // Tailwind: bg-primary-dark
  primaryLight:  '#DBEAFE',   // Tailwind: bg-primary-light

  /** Status */
  success: '#10B981',         // Tailwind: bg-success, text-success
  warning: '#F59E0B',         // Tailwind: bg-warning, text-warning
  danger:  '#EF4444',         // Tailwind: bg-danger, text-danger

  /** Accent */
  teal: '#0D9488',            // Tailwind: bg-teal, text-teal

  /** Text */
  textPrimary:   '#1E293B',   // Tailwind: text-text-primary
  textSecondary: '#64748B',   // Tailwind: text-text-secondary

  /** Surface / layout */
  surface: '#F8FAFC',         // Tailwind: bg-surface
  border:  '#E2E8F0',         // Tailwind: border-border
} as const

export const fontFamily = {
  sans: ['DM Sans', 'sans-serif'],
} as const

/** Union of all colour token names, useful for typed props */
export type ColorToken = keyof typeof colors

/** Union of all colour hex values */
export type ColorValue = (typeof colors)[ColorToken]
