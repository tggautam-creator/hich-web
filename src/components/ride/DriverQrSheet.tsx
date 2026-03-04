import BottomSheet from '@/components/ui/BottomSheet'

interface DriverQrSheetProps {
  isOpen: boolean
  onClose: () => void
  driverId: string
  'data-testid'?: string
}

/**
 * Bottom sheet displaying the driver's QR code.
 *
 * For the MVP this shows a placeholder — the real HMAC-signed QR
 * will be added in Week 5 when the qrcode package is integrated.
 */
export default function DriverQrSheet({
  isOpen,
  onClose,
  driverId,
  'data-testid': testId = 'driver-qr-sheet',
}: DriverQrSheetProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Your QR Code" data-testid={testId}>
      <div className="flex flex-col items-center py-6" data-testid="qr-content">
        {/* Placeholder QR box */}
        <div
          className="mb-4 flex h-48 w-48 items-center justify-center rounded-2xl bg-surface border-2 border-dashed border-border"
          data-testid="qr-placeholder"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-16 w-16 text-text-secondary"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="4" height="4" rx="0.5" />
            <line x1="21" y1="14" x2="21" y2="21" />
            <line x1="14" y1="21" x2="21" y2="21" />
          </svg>
        </div>

        <p className="mb-1 text-center font-medium text-text-primary">
          Show this to your rider
        </p>
        <p className="text-center text-sm text-text-secondary">
          Scan to start or end the ride
        </p>

        {/* Hidden driver ID for future use */}
        <span className="sr-only" data-testid="driver-id">{driverId}</span>
      </div>
    </BottomSheet>
  )
}
