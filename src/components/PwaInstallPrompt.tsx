/**
 * PwaInstallPrompt — Full-screen overlay shown before the landing page.
 *
 * Auto-detects iOS vs Android and shows platform-specific install instructions.
 * Only visible on mobile devices that haven't installed the PWA yet.
 */

import { useState } from 'react'
import Logo from '@/components/ui/Logo'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import { isIos, hasInstallPrompt, triggerInstallPrompt } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

interface PwaInstallPromptProps {
  onDismiss: () => void
  'data-testid'?: string
}

export default function PwaInstallPrompt({
  onDismiss,
  'data-testid': testId,
}: PwaInstallPromptProps) {
  const setSeenFullPrompt = usePwaStore((s) => s.setSeenFullPrompt)
  const [installing, setInstalling] = useState(false)

  const handleDismiss = () => {
    setSeenFullPrompt()
    onDismiss()
  }

  const handleInstall = async () => {
    if (hasInstallPrompt()) {
      setInstalling(true)
      const accepted = await triggerInstallPrompt()
      setInstalling(false)
      if (accepted) {
        setSeenFullPrompt()
        onDismiss()
      }
    }
  }

  const iosDevice = isIos()
  const canNativeInstall = hasInstallPrompt()

  return (
    <div
      data-testid={testId ?? 'pwa-install-prompt'}
      className="fixed inset-0 z-[2000] bg-gradient-to-b from-white to-surface flex flex-col font-sans"
    >
      {/* Header */}
      <header
        className="px-6 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <Logo size="lg" />
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col justify-center px-6 gap-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-text-primary leading-tight">
            Install TAGO for the best experience
          </h1>
          <p className="text-base text-text-secondary leading-relaxed">
            Add TAGO to your home screen for instant access, push notifications, and a full-screen experience.
          </p>
        </div>

        {/* Platform-specific instructions */}
        {iosDevice ? (
          <div className="bg-white rounded-2xl p-5 border border-border space-y-4">
            <p className="text-sm font-semibold text-text-primary">How to install on iOS:</p>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</span>
                <span className="text-sm text-text-primary">
                  Tap the <strong>Share</strong> button <span className="inline-block text-primary">⬆</span> at the bottom of Safari
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
                  Tap <strong>&quot;Add&quot;</strong> to confirm
                </span>
              </li>
            </ol>
          </div>
        ) : canNativeInstall ? (
          <div className="space-y-3">
            <PrimaryButton
              onClick={handleInstall}
              disabled={installing}
              data-testid="pwa-native-install"
            >
              {installing ? 'Installing...' : 'Install TAGO'}
            </PrimaryButton>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-5 border border-border space-y-4">
            <p className="text-sm font-semibold text-text-primary">How to install on Android:</p>
            <ol className="space-y-3">
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
                  Tap <strong>&quot;Add&quot;</strong> to confirm
                </span>
              </li>
            </ol>
          </div>
        )}

        <SecondaryButton
          onClick={handleDismiss}
          data-testid="pwa-skip"
        >
          Continue to Website
        </SecondaryButton>
      </main>

      {/* Bottom padding for safe area */}
      <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }} />
    </div>
  )
}
