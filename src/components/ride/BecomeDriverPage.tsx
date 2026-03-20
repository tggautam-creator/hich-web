import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'

interface BecomeDriverPageProps {
  'data-testid'?: string
}

export default function BecomeDriverPage({
  'data-testid': testId = 'become-driver-page',
}: BecomeDriverPageProps) {
  const navigate = useNavigate()

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans pb-16"
    >
      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {/* Illustration */}
        <img
          src="/onboarding/become-driver.png"
          alt="Earn on your everyday drive"
          className="mb-6 w-48 h-48 object-contain"
          data-testid="become-driver-illustration"
        />

        {/* Heading */}
        <h1
          className="mb-2 text-center text-2xl font-bold text-text-primary"
          data-testid="heading"
        >
          Earn on your everyday drive
        </h1>
        <p className="mb-8 text-center text-text-secondary">
          You&apos;re already making the drive — now get paid for the empty seats.
        </p>

        {/* Steps */}
        <div className="mb-10 w-full max-w-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">1</div>
            <div>
              <p className="font-medium text-text-primary">Add your car</p>
              <p className="text-sm text-text-secondary">
                Takes 30 seconds. Riders see your car details before they hop in.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">2</div>
            <div>
              <p className="font-medium text-text-primary">Connect payouts</p>
              <p className="text-sm text-text-secondary">
                Link your bank once. Earnings hit your account after every ride.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">3</div>
            <div>
              <p className="font-medium text-text-primary">Start earning</p>
              <p className="text-sm text-text-secondary">
                Drive whenever you want. Keep 100% of every fare — paid automatically.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <PrimaryButton
          data-testid="register-car-button"
          onClick={() => { navigate('/onboarding/vehicle') }}
          className="w-full max-w-sm"
        >
          Register my car
        </PrimaryButton>
      </div>

      {/* ── Bottom Nav ──────────────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}
