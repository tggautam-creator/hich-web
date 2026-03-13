import { createHmac, timingSafeEqual } from 'crypto'
import { getServerEnv } from '../env'

/**
 * QR token format: `driverId:rideId:timestamp:signature`
 *
 * The HMAC-SHA256 signature ensures only the server can generate valid tokens.
 * Rider scans QR → sends token to POST /api/rides/:id/start (or /end) →
 * server validates signature before starting/ending ride.
 */

export function generateQrToken(driverId: string, rideId: string): string {
  const { QR_HMAC_SECRET } = getServerEnv()
  const timestamp = Date.now().toString()
  const data = `${driverId}:${rideId}:${timestamp}`
  const sig = createHmac('sha256', QR_HMAC_SECRET).update(data).digest('hex')
  return `${data}:${sig}`
}

interface ParsedQrToken {
  driverId: string
  rideId: string
  timestamp: number
}

/**
 * Validates an HMAC-signed QR token.
 * Returns parsed fields if valid, null if tampered or malformed.
 * Tokens older than 24 hours are rejected.
 */
export function validateQrToken(token: string): ParsedQrToken | null {
  const parts = token.split(':')
  if (parts.length !== 4) return null

  const [driverId, rideId, timestampStr, sig] = parts
  if (!driverId || !rideId || !timestampStr || !sig) return null

  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp)) return null

  // Reject tokens older than 24 hours
  const ageMs = Date.now() - timestamp
  if (ageMs > 24 * 60 * 60 * 1000 || ageMs < 0) return null

  const { QR_HMAC_SECRET } = getServerEnv()
  const data = `${driverId}:${rideId}:${timestampStr}`
  const expectedSig = createHmac('sha256', QR_HMAC_SECRET).update(data).digest('hex')

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return null
  const sigBuf = Buffer.from(sig, 'hex')
  const expectedBuf = Buffer.from(expectedSig, 'hex')
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  return { driverId, rideId, timestamp }
}
