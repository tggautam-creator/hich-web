import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import Logo from '@/components/ui/Logo'
import PwaInstallPrompt from '@/components/PwaInstallPrompt'
import { isStandalone, isMobile } from '@/lib/pwa'
import { usePwaStore } from '@/stores/pwaStore'

interface LandingProps {
  'data-testid'?: string
}

export default function Landing({ 'data-testid': testId }: LandingProps) {
  const navigate = useNavigate()
  const hasSeenFullPrompt = usePwaStore((s) => s.hasSeenFullPrompt)
  const [showPwaPrompt, setShowPwaPrompt] = useState(false)

  // If the user already has a session (e.g. PWA reopened after force-kill),
  // skip the landing page and go straight into the app.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/home/rider', { replace: true })
    })
  }, [navigate])

  // Show PWA install prompt on mobile, non-standalone, first visit
  useEffect(() => {
    if (!hasSeenFullPrompt && !isStandalone() && isMobile()) {
      setShowPwaPrompt(true)
    }
  }, [hasSeenFullPrompt])

  // Show PWA prompt overlay before landing content
  if (showPwaPrompt) {
    return <PwaInstallPrompt onDismiss={() => setShowPwaPrompt(false)} />
  }

  return (
    <div
      data-testid={testId ?? 'landing-page'}
      className="min-h-dvh w-full bg-gradient-to-b from-white to-surface flex flex-col font-sans"
    >
      {/* Header — safe-area aware top padding */}
      <header className="px-6 pt-safe-top pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}>
        <Logo size="lg" data-testid="landing-logo" />
      </header>

      {/* Hero — grows to fill all remaining space */}
      <main className="flex-1 flex flex-col justify-center px-6 gap-10">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-text-primary leading-tight">
            Going the same way?<br />Let&apos;s ride.
          </h1>
          <p className="text-base text-text-secondary leading-relaxed">
            Request a ride and get matched with someone headed your direction.
            No posting, no waiting — just tap and go.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <PrimaryButton
            data-testid="cta-signup"
            onClick={() => { navigate('/signup') }}
          >
            Get started
          </PrimaryButton>
          <SecondaryButton
            data-testid="cta-login"
            onClick={() => { navigate('/login') }}
          >
            I have an account
          </SecondaryButton>

          {/*
            Cross-platform iOS app callout — visible to Android + desktop
            visitors (iPhone visitors get redirected to the App Store
            before this even renders, via the inline script in
            `index.html`). Tapped from desktop = opens App Store in a
            new tab; tapped from Android = same. Replace the placeholder
            App Store URL once App Store Connect issues your numeric
            App ID (10-digit number under My Apps → app → Apple ID).
          */}
          <a
            data-testid="cta-app-store"
            href="https://apps.apple.com/app/idPLACEHOLDER"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M17.5 12.5c0-2.4 2-3.5 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.7 0-1.9-.9-3.2-.8-1.6 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3.1 2.4 1.3 0 1.7-.8 3.2-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.4-2.8-.1 0-2.7-1-2.8-4M14.7 5.5c.7-.8 1.2-2 1-3.2-1.1.1-2.3.7-3 1.6-.7.7-1.3 2-1.1 3.1 1.2.1 2.4-.7 3.1-1.5"/>
            </svg>
            Get the iOS app
          </a>
        </div>
      </main>

      {/* Trust strip — safe-area aware bottom padding */}
      <footer
        className="px-6 pt-6 flex flex-col items-center"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
      >
        <div className="rounded-2xl bg-white/80 px-5 py-3 shadow-sm backdrop-blur-sm">
          <p
            data-testid="trust-strip"
            className="text-sm text-text-secondary text-center"
          >
            Verified community · Instant matching · Automatic payments
          </p>
        </div>
        <div className="mt-3 flex justify-center gap-3 text-xs text-text-secondary">
          <Link to="/terms" className="underline">Terms of Service</Link>
          <span>·</span>
          <Link to="/privacy" className="underline">Privacy Policy</Link>
        </div>
      </footer>
    </div>
  )
}
