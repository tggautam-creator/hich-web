/**
 * PwaInstallBanner — Dismissible banner shown at top of home pages.
 *
 * Only visible on mobile devices running in the browser (not standalone).
 * Persists dismissal via pwaStore so it only shows once.
 */

import { isStandalone, isMobile } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

interface PwaInstallBannerProps {
  'data-testid'?: string
}

export default function PwaInstallBanner({
  'data-testid': testId,
}: PwaInstallBannerProps) {
  const hasDismissedBanner = usePwaStore((s) => s.hasDismissedBanner)
  const setDismissedBanner = usePwaStore((s) => s.setDismissedBanner)

  // Don't show if already installed, already dismissed, or not mobile
  if (hasDismissedBanner || isStandalone() || !isMobile()) return null

  return (
    <div
      data-testid={testId ?? 'pwa-install-banner'}
      className="fixed top-0 left-0 right-0 z-[1001] bg-primary text-white"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between px-4 py-2.5">
        <p className="text-xs font-medium flex-1">
          Install TAGO for the best ride experience
        </p>
        <button
          onClick={setDismissedBanner}
          className="ml-3 p-1 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Dismiss install banner"
          data-testid="pwa-banner-dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
