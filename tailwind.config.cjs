/** @type {import('tailwindcss').Config} */

// Colour values are kept in sync with src/lib/tokens.ts.
// When you change a token value, update BOTH files.
const colors = {
  primary:       '#00A8F3',
  primaryDark:   '#0077C2',
  primaryLight:  '#E0F4FF',
  success:       '#10B981',
  warning:       '#F59E0B',
  danger:        '#EF4444',
  textPrimary:   '#1E293B',
  textSecondary: '#64748B',
  surface:       '#F8FAFC',
  border:        '#E2E8F0',
}

module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary:          colors.primary,
        'primary-dark':   colors.primaryDark,
        'primary-light':  colors.primaryLight,
        success:          colors.success,
        warning:          colors.warning,
        danger:           colors.danger,
        'text-primary':   colors.textPrimary,
        'text-secondary': colors.textSecondary,
        surface:          colors.surface,
        border:           colors.border,
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      // Motion keyframes + animations. Durations + easings are echoed in
      // src/lib/motion.ts; keep both in sync so a future port (Capacitor /
      // React Native / native Swift) has one source of timing intent.
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'sheet-in': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'sheet-out': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'reveal-up': {
          '0%':   { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
        // `cubic-bezier(0.22, 1, 0.36, 1)` is a standard ease-out-quint —
        // a quick, natively-feeling settle. It matches Apple's default
        // sheet easing closely so the feel ports to iOS without retuning.
        'sheet-in':  'sheet-in 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        'sheet-out': 'sheet-out 220ms cubic-bezier(0.4, 0, 1, 1)',
        'fade-in':   'fade-in 220ms ease-out',
        'fade-out':  'fade-out 180ms ease-in',
        'reveal-up': 'reveal-up 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
