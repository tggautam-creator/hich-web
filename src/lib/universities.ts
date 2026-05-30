/**
 * v1.2 F1.2 — closed list of California 4-year universities used by
 * the EditProfileSheet school picker to constrain `users.school`.
 * Mirrors iOS `Universities.californiaFourYear` 1:1 — the picker
 * matches on equality, not fuzzy similarity, so future renames here
 * must stay in lockstep with the iOS list (and would need a data
 * migration for any saved values that drift).
 *
 * Free text is intentionally disallowed (Tarun's direction
 * 2026-05-21). Students at unlisted schools leave the field blank.
 *
 * Tolerance: legacy values written before this list shipped (e.g. an
 * admin-set "Harvard") are still rendered via the splice-in pattern
 * — the saved string is shown as a "Currently selected" option above
 * the canonical list so the user can keep or change it.
 */

export const CALIFORNIA_FOUR_YEAR_UNIVERSITIES: readonly string[] = [
  // UC system
  'UC Berkeley',
  'UC Davis',
  'UC Irvine',
  'UC Los Angeles (UCLA)',
  'UC Merced',
  'UC Riverside',
  'UC San Diego',
  'UC San Francisco (UCSF)',
  'UC Santa Barbara',
  'UC Santa Cruz',

  // CSU system
  'Cal Poly Humboldt',
  'Cal Poly Pomona',
  'Cal Poly San Luis Obispo',
  'Cal State Bakersfield',
  'Cal State Channel Islands',
  'Cal State Chico',
  'Cal State Dominguez Hills',
  'Cal State East Bay',
  'Cal State Fresno',
  'Cal State Fullerton',
  'Cal State LA',
  'Cal State Long Beach',
  'Cal State Maritime Academy',
  'Cal State Monterey Bay',
  'Cal State Northridge',
  'Cal State San Bernardino',
  'Cal State San Marcos',
  'Cal State Stanislaus',
  'Sacramento State',
  'San Diego State',
  'San Francisco State',
  'San Jose State',
  'Sonoma State',

  // Major California private universities
  'California Institute of Technology (Caltech)',
  'Chapman University',
  'Claremont McKenna College',
  'Harvey Mudd College',
  'Loyola Marymount University',
  'Mills College',
  'Occidental College',
  'Pepperdine University',
  'Pitzer College',
  'Pomona College',
  "Saint Mary's College of California",
  'Santa Clara University',
  'Scripps College',
  'Stanford University',
  'University of San Diego',
  'University of San Francisco (USF)',
  'University of Southern California (USC)',
]

/**
 * Splice the user's saved school into the picker options so a legacy
 * value (or a future iOS-only addition) is still selectable. Returns
 * `{ legacy: '...' | null, options: string[] }` — the legacy entry
 * (if any) renders separately at the top so the user knows it's not
 * in the canonical California list.
 */
export function schoolPickerOptions(savedSchool: string | null | undefined): {
  legacy: string | null
  options: readonly string[]
} {
  const trimmed = (savedSchool ?? '').trim()
  if (!trimmed) return { legacy: null, options: CALIFORNIA_FOUR_YEAR_UNIVERSITIES }
  if (CALIFORNIA_FOUR_YEAR_UNIVERSITIES.includes(trimmed)) {
    return { legacy: null, options: CALIFORNIA_FOUR_YEAR_UNIVERSITIES }
  }
  return { legacy: trimmed, options: CALIFORNIA_FOUR_YEAR_UNIVERSITIES }
}

/**
 * 17-year graduation-year window centred a bit ahead of today (the
 * typical student case). Existing values outside the window are
 * spliced in so a returning user with an older saved year still sees
 * + can keep it. Sorted descending so the most recent / future years
 * sit at the top of the picker. Mirrors iOS
 * `EditProfileSheet.graduationYearOptions`.
 *
 * `now` is parametrised for deterministic tests.
 */
export function graduationYearOptions(
  savedYear: number | null | undefined,
  now: Date = new Date(),
): number[] {
  const currentYear = now.getFullYear()
  const years = new Set<number>()
  for (let y = currentYear - 6; y <= currentYear + 10; y++) {
    years.add(y)
  }
  if (typeof savedYear === 'number' && savedYear >= 1980 && savedYear <= 2100) {
    years.add(savedYear)
  }
  return Array.from(years).sort((a, b) => b - a)
}
