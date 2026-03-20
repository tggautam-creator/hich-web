import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'
import AppIcon from '@/components/ui/AppIcon'

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
          <AppIcon name="steering-wheel" className="h-12 w-12 text-primary" />
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

        {/* Steps */}
        <div className="mb-10 w-full max-w-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">1</div>
            <div>
              <p className="font-medium text-text-primary">Register your car</p>
              <p className="text-sm text-text-secondary">
                Add your vehicle details so riders know what to expect
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">2</div>
            <div>
              <p className="font-medium text-text-primary">Connect your bank</p>
              <p className="text-sm text-text-secondary">
                Set up Stripe to receive earnings directly — we never see your bank details
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0">3</div>
            <div>
              <p className="font-medium text-text-primary">Start earning</p>
              <p className="text-sm text-text-secondary">
                Drive when you want — keep 100% of every fare
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
          Get started
        </PrimaryButton>
      </div>

      {/* ── Bottom Nav ──────────────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}
