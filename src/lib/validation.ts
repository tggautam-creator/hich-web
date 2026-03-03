/**
 * Shared validation helpers.
 * Pure functions with no side effects — safe to import anywhere.
 */

/** Returns true only for properly formed `.edu` email addresses */
export function isValidEduEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim())
}

/** Returns an error string if full name is empty/whitespace, else undefined */
export function validateFullName(name: string): string | undefined {
  if (!name.trim()) return 'Full name is required'
  return undefined
}

/**
 * Returns an error string if phone is not a valid E.164 number, else undefined.
 * E.164 format: + followed by a non-zero country code digit, then 1–14 more digits.
 * Examples: +15551234567, +447700900000, +61412345678
 */
export function validatePhone(phone: string): string | undefined {
  if (!phone.trim()) return 'Phone number is required'
  if (!/^\+[1-9]\d{1,14}$/.test(phone.trim())) {
    return 'Please enter a valid phone number in E.164 format (e.g. +15551234567)'
  }
  return undefined
}

/**
 * Returns an error string if password is too short or missing a number, else undefined.
 * Rules: minimum 8 characters, at least one numeric digit.
 */
export function validatePassword(password: string): string | undefined {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/\d/.test(password)) return 'Password must contain at least one number'
  return undefined
}

/** Returns an error string if VIN is not a valid 17-character alphanumeric string, else undefined. */
export function validateVin(vin: string): string | undefined {
  if (!vin.trim()) return 'VIN is required'
  if (!/^[A-Z0-9]{17}$/i.test(vin.trim())) return 'VIN must be 17 alphanumeric characters'
  return undefined
}

/** Returns an error string if year is outside 1990–2026, else undefined. */
export function validateYear(year: string): string | undefined {
  if (!year.trim()) return 'Year is required'
  const num = Number(year)
  if (!Number.isInteger(num) || isNaN(num)) return 'Enter a valid year'
  if (num < 1990 || num > 2026) return 'Year must be between 1990 and 2026'
  return undefined
}
