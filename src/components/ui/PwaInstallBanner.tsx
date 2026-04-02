/**
 * PwaInstallBanner — Dismissible banner shown at top of home pages.
 *
 * Only visible on mobile devices running in the browser (not standalone).
 * Tapping the banner opens a bottom sheet with platform-specific install steps.
 * Persists dismissal via pwaStore so it only shows once.
 */

import { useState } from 'react'
import { isStandalone, isMobile, isIos, hasInstallPrompt, triggerInstallPrompt } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

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

  const iosDevice = isIos()

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
                  <p className="text-sm text-text-secondary">Get the full app experience</p>
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

              {/* Platform-specific steps */}
              {iosDevice ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-text-primary">How to add on iPhone:</p>
                  <ol className="space-y-2.5">
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</span>
                      <span className="text-sm text-text-primary">
                        Tap the <strong>Share</strong> button <span className="text-primary">⬆</span> at the bottom of Safari
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">2</span>
                      <span className="text-sm text-text-primary">
                        Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">3</span>
                      <span className="text-sm text-text-primary">
                        Tap <strong>&quot;Add&quot;</strong> — that&apos;s it!
                      </span>
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-text-primary">How to add on Android:</p>
                  <ol className="space-y-2.5">
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</span>
                      <span className="text-sm text-text-primary">
                        Tap the <strong>menu</strong> (&#8942;) in the top right of Chrome
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">2</span>
                      <span className="text-sm text-text-primary">
                        Tap <strong>&quot;Add to Home Screen&quot;</strong>
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">3</span>
                      <span className="text-sm text-text-primary">
                        Tap <strong>&quot;Add&quot;</strong> — that&apos;s it!
                      </span>
                    </li>
                  </ol>
                </div>
              )}

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
