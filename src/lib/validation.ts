/**
 * Shared validation helpers.
 * Pure functions with no side effects — safe to import anywhere.
 */

/** Returns true only for properly formed `.edu` email addresses */
export function isValidEduEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim())
}
