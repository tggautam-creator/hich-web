/**
 * Design tokens tests — Task 2 (Week 1)
 *
 * Verifies:
 *  1. All 11 colour tokens are present with the exact hex values from the PRD
 *  2. Every value is a valid #RRGGBB hex string
 *  3. fontFamily includes DM Sans
 *  4. ColorToken and ColorValue types are inferred correctly (compile-time check)
 */

import { describe, it, expect } from 'vitest'
import { colors, fontFamily } from '@/lib/tokens'
import type { ColorToken, ColorValue } from '@/lib/tokens'

// ── Helpers ───────────────────────────────────────────────────────────────────
const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v)

// ── Colour token values (exact hex from PRD) ──────────────────────────────────
describe('design tokens — colours', () => {
  it('primary blue is #2563EB', () => {
    expect(colors.primary).toBe('#2563EB')
  })

  it('dark blue is #1E40AF', () => {
    expect(colors.primaryDark).toBe('#1E40AF')
  })

  it('light blue is #DBEAFE', () => {
    expect(colors.primaryLight).toBe('#DBEAFE')
  })

  it('success is #10B981', () => {
    expect(colors.success).toBe('#10B981')
  })

  it('warning is #F59E0B', () => {
    expect(colors.warning).toBe('#F59E0B')
  })

  it('danger is #EF4444', () => {
    expect(colors.danger).toBe('#EF4444')
  })

  it('teal is #0D9488', () => {
    expect(colors.teal).toBe('#0D9488')
  })

  it('text-primary is #1E293B', () => {
    expect(colors.textPrimary).toBe('#1E293B')
  })

  it('text-secondary is #64748B', () => {
    expect(colors.textSecondary).toBe('#64748B')
  })

  it('surface is #F8FAFC', () => {
    expect(colors.surface).toBe('#F8FAFC')
  })

  it('border is #E2E8F0', () => {
    expect(colors.border).toBe('#E2E8F0')
  })
})

// ── All values are valid hex strings ─────────────────────────────────────────
describe('design tokens — hex format', () => {
  it('every colour value is a valid #RRGGBB hex string', () => {
    for (const [key, value] of Object.entries(colors)) {
      expect(isHex(value), `${key}: "${value}" is not a valid #RRGGBB hex`).toBe(true)
    }
  })

  it('exports exactly 11 colour tokens', () => {
    expect(Object.keys(colors)).toHaveLength(11)
  })
})

// ── Font family ───────────────────────────────────────────────────────────────
describe('design tokens — typography', () => {
  it('fontFamily.sans starts with DM Sans', () => {
    expect(fontFamily.sans[0]).toBe('DM Sans')
  })

  it('fontFamily.sans has a fallback', () => {
    expect(fontFamily.sans.length).toBeGreaterThan(1)
  })
})

// ── TypeScript types compile correctly (caught at build time, not runtime) ────
describe('design tokens — types', () => {
  it('ColorToken type accepts all valid keys', () => {
    const keys: ColorToken[] = [
      'primary', 'primaryDark', 'primaryLight',
      'success', 'warning', 'danger', 'teal',
      'textPrimary', 'textSecondary', 'surface', 'border',
    ]
    expect(keys).toHaveLength(11)
  })

  it('ColorValue type accepts a valid hex string', () => {
    const val: ColorValue = '#2563EB'
    expect(val).toBe(colors.primary)
  })
})
