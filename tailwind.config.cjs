/** @type {import('tailwindcss').Config} */

// Colour values are kept in sync with src/lib/tokens.ts.
// When you change a token value, update BOTH files.
const colors = {
  primary:       '#2563EB',
  primaryDark:   '#1E40AF',
  primaryLight:  '#DBEAFE',
  success:       '#10B981',
  warning:       '#F59E0B',
  danger:        '#EF4444',
  teal:          '#0D9488',
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
        teal:             colors.teal,
        'text-primary':   colors.textPrimary,
        'text-secondary': colors.textSecondary,
        surface:          colors.surface,
        border:           colors.border,
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
      },
    },
  },
  plugins: [],
}
