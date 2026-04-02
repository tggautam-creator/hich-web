import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import BottomSheet from '@/components/ui/BottomSheet'

interface DriverQrSheetProps {
  isOpen: boolean
  onClose: () => void
  driverId: string
  rideId?: string
  'data-testid'?: string
}

/**
 * Bottom sheet displaying the driver's permanent QR code.
 * The QR encodes "tago:{driverId}" — riders scan this to start/end rides.
 * The short code (first 8 chars of UUID) is shown for manual entry.
 */
export default function DriverQrSheet({
  isOpen,
  onClose,
  driverId,
  'data-testid': testId = 'driver-qr-sheet',
}: DriverQrSheetProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const shortCode = driverId.slice(0, 8).toUpperCase()

  useEffect(() => {
    if (!isOpen || !driverId) return

    let cancelled = false
    async function generateQr() {
      setLoading(true)

      try {
        const dataUrl = await QRCode.toDataURL(`tago:${driverId}`, {
          width: 256,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })

        if (!cancelled) {
          setQrDataUrl(dataUrl)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    void generateQr()
    return () => { cancelled = true }
  }, [isOpen, driverId])

  const handleCopy = () => {
    void navigator.clipboard.writeText(shortCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Your Driver Code" data-testid={testId}>
      <div className="flex flex-col items-center py-6" data-testid="qr-content">

        {loading && (
          <div className="mb-4 flex h-48 w-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {qrDataUrl && !loading && (
          <img
            src={qrDataUrl}
            alt="QR code for ride verification"
            className="mb-4 h-48 w-48 rounded-2xl"
            data-testid="qr-image"
          />
        )}

        {/* Driver short code for manual entry */}
        <div className="mb-3 flex items-center gap-2">
          <span
            data-testid="driver-code"
            className="font-mono text-2xl font-bold tracking-[0.25em] text-text-primary"
          >
            {shortCode}
          </span>
          <button
            data-testid="copy-code"
            onClick={handleCopy}
            className="rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary active:bg-border transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <p className="mb-1 text-center font-medium text-text-primary">
          Show this to your rider
        </p>
        <p className="text-center text-sm text-text-secondary">
          Rider scans QR or enters the code above to start or end the ride
        </p>

        {/* Hidden driver ID for testing */}
        <span className="sr-only" data-testid="driver-id">{driverId}</span>
      </div>
    </BottomSheet>
  )
}
