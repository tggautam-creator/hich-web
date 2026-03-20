import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import Logo from '@/components/ui/Logo'

interface LandingProps {
  'data-testid'?: string
}

export default function Landing({ 'data-testid': testId }: LandingProps) {
  const navigate = useNavigate()

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
        </div>
      </main>

      {/* Trust strip — safe-area aware bottom padding */}
      <footer
        className="px-6 pt-6 flex justify-center"
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
      </footer>
    </div>
  )
}
