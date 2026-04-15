/**
 * PwaInstallBanner — Dismissible banner shown at top of home pages.
 *
 * Only visible on mobile devices running in the browser (not standalone).
 * Tapping the banner opens a bottom sheet with platform-specific install steps.
 * Persists dismissal via pwaStore so it only shows once.
 */

import { useState } from 'react'
import { isStandalone, isMobile, isIos, isAndroid, detectBrowser, hasInstallPrompt, triggerInstallPrompt } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

function getBannerSteps(): { title: string; steps: string[] } {
  const ios = isIos()
  const android = isAndroid()
  const browser = detectBrowser()

  if (ios && browser === 'safari') {
    return {
      title: 'Quick setup — Safari (iOS):',
      steps: [
        'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> at the <strong>bottom</strong> of the screen',
        'Scroll down and tap <strong>"Add to Home Screen"</strong>',
        'Tap <strong>"Add"</strong> — that\'s it!',
      ],
    }
  }
  if (ios && browser === 'chrome') {
    return {
      title: 'Quick setup — Chrome (iOS):',
      steps: [
        'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> in the <strong>top right</strong>',
        'Scroll down and tap <strong>"Add to Home Screen"</strong>',
        'Tap <strong>"Add"</strong> — that\'s it!',
      ],
    }
  }
  if (ios) {
    return {
      title: 'Quick setup — iOS:',
      steps: [
        'Open this page in <strong>Safari</strong> for the best experience',
        'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> at the bottom',
        'Tap <strong>"Add to Home Screen"</strong>, then <strong>"Add"</strong>',
      ],
    }
  }
  if (android && browser === 'samsung') {
    return {
      title: 'Quick setup — Samsung Internet:',
      steps: [
        'Tap the <strong>menu</strong> (☰) at the <strong>bottom right</strong>',
        'Tap <strong>"Add page to"</strong> → <strong>"Home screen"</strong>',
        'Tap <strong>"Add"</strong> — that\'s it!',
      ],
    }
  }
  // Android Chrome / generic Android
  return {
    title: 'Quick setup — Android:',
    steps: [
      'Tap the <strong>menu</strong> (⋮) in the <strong>top right</strong>',
      'Tap <strong>"Add to Home Screen"</strong>',
      'Tap <strong>"Add"</strong> — that\'s it!',
    ],
  }
}

interface PwaInstallBannerProps {
  'data-testid'?: string
}

export default function PwaInstallBanner({
  'data-testid': testId,
}: PwaInstallBannerProps) {
  const hasDismissedBanner = usePwaStore((s) => s.hasDismissedBanner)
  const setDismissedBanner = usePwaStore((s) => s.setDismissedBanner)
  const [showSheet, setShowSheet] = useState(false)

  // Don't show if already installed, already dismissed, or not mobile
  if (hasDismissedBanner || isStandalone() || !isMobile()) return null

  const handleBannerTap = () => {
    if (hasInstallPrompt()) {
      // Android native prompt available — trigger directly
      triggerInstallPrompt().then((accepted) => {
        if (accepted) setDismissedBanner()
      })
    } else {
      setShowSheet(true)
    }
  }

  const handleDismissBanner = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDismissedBanner()
  }

  const { title, steps } = getBannerSteps()

  return (
    <>
      {/* Top banner */}
      <div
        data-testid={testId ?? 'pwa-install-banner'}
        className="fixed top-0 left-0 right-0 z-[1001] bg-primary text-white cursor-pointer"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
        onClick={handleBannerTap}
      >
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5 flex-1">
            <img
              src="/logo-transparent.png"
              alt=""
              className="w-6 h-6 rounded"
              aria-hidden="true"
            />
            <p className="text-xs font-medium">
              Add TAGO to your home screen for a better experience
            </p>
          </div>
          <button
            onClick={handleDismissBanner}
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

      {/* Install instructions bottom sheet */}
      {showSheet && (
        <div
          className="fixed inset-0 z-[2000] bg-black/40"
          onClick={() => setShowSheet(false)}
          data-testid="pwa-install-sheet-backdrop"
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Header */}
              <div className="flex items-center gap-3">
                <img
                  src="/logo-transparent.png"
                  alt=""
                  className="w-12 h-12"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-lg font-bold text-text-primary">Add TAGO to Home Screen</h2>
                  <p className="text-sm text-text-secondary">It takes 10 seconds</p>
                </div>
              </div>

              {/* Benefits */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: '🔔', label: 'Push notifications' },
                  { icon: '⚡', label: 'Instant launch' },
                  { icon: '📱', label: 'Full screen' },
                ].map((b) => (
                  <div key={b.label} className="bg-surface rounded-xl p-3 text-center space-y-1">
                    <span className="text-xl">{b.icon}</span>
                    <p className="text-[11px] font-medium text-text-secondary leading-tight">{b.label}</p>
                  </div>
                ))}
              </div>

              {/* Browser-specific steps */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-text-primary">{title}</p>
                <ol className="space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{i + 1}</span>
                      <span
                        className="text-sm text-text-primary"
                        dangerouslySetInnerHTML={{ __html: step }}
                      />
                    </li>
                  ))}
                </ol>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => { setShowSheet(false); setDismissedBanner() }}
                className="w-full py-3 text-sm font-medium text-text-secondary"
                data-testid="pwa-sheet-dismiss"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
