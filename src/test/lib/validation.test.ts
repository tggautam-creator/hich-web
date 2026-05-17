import { describe, it, expect } from 'vitest'
import {
  isValidEduEmail,
  isAdminEmail,
  validateFullName,
  validatePhone,
  validatePassword,
  validateVin,
  validateYear,
} from '@/lib/validation'

describe('isValidEduEmail', () => {
  it('accepts a standard .edu address', () => {
    expect(isValidEduEmail('alice@ucdavis.edu')).toBe(true)
  })

  it('accepts a sub-domained .edu address', () => {
    expect(isValidEduEmail('bob@grad.berkeley.edu')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isValidEduEmail('Carol@UCLA.EDU')).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    expect(isValidEduEmail('  dave@ucsd.edu  ')).toBe(true)
  })

  it('rejects a .com address that is not @tagorides.com', () => {
    expect(isValidEduEmail('eve@gmail.com')).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(isValidEduEmail('not-an-email')).toBe(false)
  })

  // Admin-email bypass — added 2026-05-16 (Slice 0.2)
  it('accepts the canonical admin alias @tagorides.com', () => {
    expect(isValidEduEmail('admin@tagorides.com')).toBe(true)
  })

  it('accepts arbitrary @tagorides.com mailboxes for team aliases', () => {
    expect(isValidEduEmail('marketing@tagorides.com')).toBe(true)
    expect(isValidEduEmail('support@tagorides.com')).toBe(true)
    expect(isValidEduEmail('tarun@tagorides.com')).toBe(true)
  })

  it('is case-insensitive for @tagorides.com too', () => {
    expect(isValidEduEmail('ADMIN@TAGORIDES.COM')).toBe(true)
  })

  it('rejects look-alike admin domains', () => {
    // A typo / spoofing attempt shouldn't slip through the admin path.
    expect(isValidEduEmail('admin@tagoride.com')).toBe(false)
    expect(isValidEduEmail('admin@tagorides.co')).toBe(false)
    expect(isValidEduEmail('admin@tagorides.com.evil.com')).toBe(false)
  })
})

describe('isAdminEmail', () => {
  it('returns true only for @tagorides.com addresses', () => {
    expect(isAdminEmail('admin@tagorides.com')).toBe(true)
    expect(isAdminEmail('marketing@tagorides.com')).toBe(true)
  })

  it('returns false for .edu addresses', () => {
    expect(isAdminEmail('alice@ucdavis.edu')).toBe(false)
  })

  it('returns false for other domains', () => {
    expect(isAdminEmail('eve@gmail.com')).toBe(false)
    expect(isAdminEmail('eve@tagorides.org')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isAdminEmail('Admin@TAGORIDES.com')).toBe(true)
  })

  it('rejects look-alike domains', () => {
    expect(isAdminEmail('admin@tagoride.com')).toBe(false)
    expect(isAdminEmail('admin@tagorides.com.evil.com')).toBe(false)
  })
})

describe('validateFullName', () => {
  it('returns an error for an empty name', () => {
    expect(validateFullName('')).toBe('Full name is required')
  })
  it('returns an error for whitespace-only', () => {
    expect(validateFullName('   ')).toBe('Full name is required')
  })
  it('passes a real name', () => {
    expect(validateFullName('Alice Bob')).toBeUndefined()
  })
})

describe('validatePhone', () => {
  it('accepts a US E.164 number', () => {
    expect(validatePhone('+15551234567')).toBeUndefined()
  })
  it('rejects missing +', () => {
    expect(validatePhone('15551234567')).toBeDefined()
  })
  it('rejects an empty string', () => {
    expect(validatePhone('')).toBe('Phone number is required')
  })
})

describe('validatePassword', () => {
  it('passes 8+ chars with a digit', () => {
    expect(validatePassword('Hello123')).toBeUndefined()
  })
  it('rejects under 8 chars', () => {
    expect(validatePassword('abc1')).toBe('Password must be at least 8 characters')
  })
  it('rejects no digit', () => {
    expect(validatePassword('Helloworld')).toBe('Password must contain at least one number')
  })
})

describe('validateVin', () => {
  it('passes empty (optional field)', () => {
    expect(validateVin('')).toBeUndefined()
  })
  it('passes a 17-char alphanumeric VIN', () => {
    expect(validateVin('1HGBH41JXMN109186')).toBeUndefined()
  })
  it('rejects a 16-char VIN', () => {
    expect(validateVin('1HGBH41JXMN10918')).toBe('VIN must be 17 alphanumeric characters')
  })
})

describe('validateYear', () => {
  it('passes a current-decade year', () => {
    expect(validateYear('2024')).toBeUndefined()
  })
  it('rejects empty', () => {
    expect(validateYear('')).toBe('Year is required')
  })
  it('rejects out-of-range', () => {
    expect(validateYear('1989')).toBe('Year must be between 1990 and 2026')
  })
})
