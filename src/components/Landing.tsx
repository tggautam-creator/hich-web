import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'

interface LandingProps {
  'data-testid'?: string
}

export default function Landing({ 'data-testid': testId }: LandingProps) {
  const navigate = useNavigate()

  return (
    <div
      data-testid={testId ?? 'landing-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      {/* Header — safe-area aware top padding */}
      <header className="px-6 pt-safe-top pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}>
        <span className="text-2xl font-bold text-primary tracking-tight">HICH</span>
      </header>

      {/* Hero — grows to fill all remaining space */}
      <main className="flex-1 flex flex-col justify-center px-6 gap-10">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-text-primary leading-tight">
            Carpool smarter.<br />Get home cheaper.
          </h1>
          <p className="text-base text-text-secondary leading-relaxed">
            AI-powered rides between UC Davis and the Bay Area.
            Drivers are matched automatically — no posting required.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <PrimaryButton
            data-testid="cta-signup"
            onClick={() => { navigate('/signup') }}
          >
            Sign up
          </PrimaryButton>
          <SecondaryButton
            data-testid="cta-login"
            onClick={() => { navigate('/login') }}
          >
            Log in
          </SecondaryButton>
        </div>
      </main>

      {/* Trust strip — safe-area aware bottom padding */}
      <footer
        className="px-6 pt-6 flex justify-center"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
      >
        <p
          data-testid="trust-strip"
          className="text-sm text-text-secondary text-center"
        >
          .edu verified · QR-confirmed rides · Fare splitting
        </p>
      </footer>
    </div>
  )
}
