/**
 * PwaInstallPrompt — Full-screen overlay shown before the landing page.
 *
 * Auto-detects OS + browser and shows tailored install instructions.
 * Only visible on mobile devices that haven't installed the PWA yet.
 */

import { useState } from 'react'
import Logo from '@/components/ui/Logo'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { isIos, isAndroid, detectBrowser, hasInstallPrompt, triggerInstallPrompt } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

interface PwaInstallPromptProps {
  onDismiss: () => void
  'data-testid'?: string
}

// ── Step data per browser/OS combo ───────────────────────────────────────────

interface InstallStep {
  text: string
}

function getInstallSteps(): { title: string; steps: InstallStep[] } {
  const ios = isIos()
  const android = isAndroid()
  const browser = detectBrowser()

  if (ios && browser === 'safari') {
    return {
      title: 'How to install on Safari (iOS):',
      steps: [
        { text: 'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> at the <strong>bottom</strong> of the screen' },
        { text: 'Scroll down and tap <strong>"Add to Home Screen"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (ios && browser === 'chrome') {
    return {
      title: 'How to install on Chrome (iOS):',
      steps: [
        { text: 'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> in the <strong>top right</strong> (or address bar)' },
        { text: 'Scroll down and tap <strong>"Add to Home Screen"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (ios && browser === 'firefox') {
    return {
      title: 'How to install on Firefox (iOS):',
      steps: [
        { text: 'Tap the <strong>menu</strong> (☰) in the <strong>bottom right</strong>' },
        { text: 'Tap <strong>"Share"</strong>, then <strong>"Add to Home Screen"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (ios) {
    // iOS other browsers — generic fallback
    return {
      title: 'How to install on iOS:',
      steps: [
        { text: 'Open this page in <strong>Safari</strong> for the best experience' },
        { text: 'Tap the <strong>Share</strong> button <span class="text-primary">⬆</span> at the bottom' },
        { text: 'Tap <strong>"Add to Home Screen"</strong>, then <strong>"Add"</strong>' },
      ],
    }
  }

  if (android && browser === 'chrome') {
    return {
      title: 'How to install on Chrome (Android):',
      steps: [
        { text: 'Tap the <strong>menu</strong> (⋮) in the <strong>top right</strong> corner' },
        { text: 'Tap <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (android && browser === 'samsung') {
    return {
      title: 'How to install on Samsung Internet:',
      steps: [
        { text: 'Tap the <strong>menu</strong> (☰) at the <strong>bottom right</strong>' },
        { text: 'Tap <strong>"Add page to"</strong> → <strong>"Home screen"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (android && browser === 'firefox') {
    return {
      title: 'How to install on Firefox (Android):',
      steps: [
        { text: 'Tap the <strong>menu</strong> (⋮) in the <strong>top right</strong>' },
        { text: 'Tap <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (android && browser === 'edge') {
    return {
      title: 'How to install on Edge (Android):',
      steps: [
        { text: 'Tap the <strong>menu</strong> (⋯) at the <strong>bottom center</strong>' },
        { text: 'Tap <strong>"Add to Phone"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  if (android) {
    return {
      title: 'How to install on Android:',
      steps: [
        { text: 'Tap the <strong>browser menu</strong> (⋮ or ☰)' },
        { text: 'Look for <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong>' },
        { text: 'Tap <strong>"Add"</strong> to confirm' },
      ],
    }
  }

  // Desktop fallback
  return {
    title: 'How to install:',
    steps: [
      { text: 'In Chrome, click the <strong>install icon</strong> in the address bar' },
      { text: 'Or open the browser menu and look for <strong>"Install TAGO"</strong>' },
      { text: 'Click <strong>"Install"</strong> to confirm' },
    ],
  }
}

// ── Component ────────────────────────────────────────────────────────────────

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

  const canNativeInstall = hasInstallPrompt()
  const { title, steps } = getInstallSteps()

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

        {/* Native install button (Android Chrome when beforeinstallprompt fired) */}
        {canNativeInstall ? (
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
          /* Browser-specific manual instructions */
          <div className="bg-white rounded-2xl p-5 border border-border space-y-4">
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <ol className="space-y-3">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span
                    className="text-sm text-text-primary"
                    dangerouslySetInnerHTML={{ __html: step.text }}
                  />
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Benefits strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: '🔔', label: 'Push alerts' },
            { icon: '⚡', label: 'Instant launch' },
            { icon: '📱', label: 'Full screen' },
          ].map((b) => (
            <div key={b.label} className="bg-white/80 rounded-xl p-3 text-center space-y-1 border border-border/50">
              <span className="text-xl">{b.icon}</span>
              <p className="text-[11px] font-medium text-text-secondary leading-tight">{b.label}</p>
            </div>
          ))}
        </div>

        {/* Subtle skip — small grey text, not a button */}
        <button
          onClick={handleDismiss}
          data-testid="pwa-skip"
          className="text-xs text-text-secondary/60 text-center py-2 active:opacity-60"
        >
          Continue to website
        </button>
      </main>

      {/* Bottom padding for safe area */}
      <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }} />
    </div>
  )
}
