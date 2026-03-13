import { useEffect, useRef, useState, useCallback } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

interface QrScannerProps {
  onScan: (decodedText: string) => void
  onError?: (error: string) => void
  'data-testid'?: string
}

/**
 * Camera-based QR scanner using html5-qrcode.
 * Calls onScan with the decoded text when a QR is successfully read.
 */
export default function QrScanner({
  onScan,
  onError,
  'data-testid': testId = 'qr-scanner',
}: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const hasScanned = useRef(false)

  const handleScan = useCallback((text: string) => {
    if (hasScanned.current) return
    hasScanned.current = true
    onScan(text)
  }, [onScan])

  useEffect(() => {
    const scannerId = 'qr-scanner-region'
    let scanner: Html5Qrcode | null = null

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(scannerId)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => { handleScan(decodedText) },
          () => { /* ignore scan failures — they're common */ },
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Camera access denied'
        setCameraError(msg)
        onError?.(msg)
      }
    }

    void startScanner()

    return () => {
      if (scanner?.isScanning) {
        scanner.stop().catch(() => { /* cleanup */ })
      }
    }
  }, [handleScan, onError])

  if (cameraError) {
    return (
      <div data-testid={testId} className="flex flex-col items-center justify-center py-12 px-6">
        <p className="text-sm text-danger text-center mb-2">Camera Error</p>
        <p className="text-xs text-text-secondary text-center">{cameraError}</p>
      </div>
    )
  }

  return (
    <div data-testid={testId} className="relative">
      <div id="qr-scanner-region" ref={containerRef} className="w-full" />
    </div>
  )
}
