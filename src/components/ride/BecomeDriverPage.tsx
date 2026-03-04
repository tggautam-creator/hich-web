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
        {/* Icon */}
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-primary-light">
          <span className="text-5xl">🚗</span>
        </div>

        {/* Heading */}
        <h1
          className="mb-2 text-center text-2xl font-bold text-text-primary"
          data-testid="heading"
        >
          Offer rides to fellow students
        </h1>
        <p className="mb-8 text-center text-text-secondary">
          Register your car to start earning on your commute
        </p>

        {/* Benefits */}
        <div className="mb-10 w-full max-w-sm space-y-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">💰</span>
            <div>
              <p className="font-medium text-text-primary">Earn money</p>
              <p className="text-sm text-text-secondary">
                Get paid for rides you&apos;re already making
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">🤝</span>
            <div>
              <p className="font-medium text-text-primary">Help commuters</p>
              <p className="text-sm text-text-secondary">
                Students heading the same way — verified .edu only
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">⏰</span>
            <div>
              <p className="font-medium text-text-primary">Flexible schedule</p>
              <p className="text-sm text-text-secondary">
                Drive when you want — no commitments
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
          Register your car
        </PrimaryButton>
      </div>

      {/* ── Bottom Nav ──────────────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}
