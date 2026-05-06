import { useNavigate } from 'react-router-dom'
import AppIcon from '@/components/ui/AppIcon'
import type { AppIconName } from '@/components/ui/AppIcon'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface ModeSelectionPageProps {
  'data-testid'?: string
}

/**
 * Flip `users.onboarding_completed = true` for the signed-in user.
 * Called on rider/driver/both selection so AuthGuard's
 * onboarding-incomplete redirect (added 2026-05-05 alongside iOS
 * RootView) releases the user to their home tabs. Driver/both flow
 * also calls this from VehicleRegistrationPage as a belt+suspenders
 * — flagging it here means a rider who picks "Get rides" goes
 * straight to /home/rider with the column already set.
 */
async function markOnboardingCompleted(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ onboarding_completed: true })
    .eq('id', userId)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[ModeSelection] failed to flip onboarding_completed:', error.message)
  }
}

interface ModeCardProps {
  icon: AppIconName
  iconColor: string
  title: string
  description: string
  testId: string
  onClick: () => void
}

function ModeCard({ icon, iconColor, title, description, testId, onClick }: ModeCardProps) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-border bg-white px-5 py-4 shadow-sm active:scale-[0.98] transition-transform"
    >
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5">
        <AppIcon name={icon} className={`h-5 w-5 ${iconColor}`} />
      </div>
      <p className="font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary mt-0.5">{description}</p>
    </button>
  )
}

export default function ModeSelectionPage({
  'data-testid': testId = 'mode-selection-page',
}: ModeSelectionPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  async function handleRiderPick() {
    if (profile?.id) {
      await markOnboardingCompleted(profile.id)
      await refreshProfile()
    }
    navigate('/home/rider')
  }

  function handleDriverPick() {
    // Driver / Both still need vehicle registration — leave
    // `onboarding_completed` FALSE here; VehicleRegistrationPage
    // flips it to TRUE on successful insert.
    navigate('/onboarding/vehicle')
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 2rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="flex-1 flex flex-col justify-center px-6">
        <h1 className="text-2xl font-bold text-text-primary mb-2">How do you want to ride?</h1>
        <p className="text-sm text-text-secondary mb-8">You can always change this later.</p>

        <div className="flex flex-col gap-4">
          <ModeCard
            icon="person"
            iconColor="text-primary"
            title="Get rides"
            description="Match with someone going your direction in seconds"
            testId="mode-rider"
            onClick={() => { void handleRiderPick() }}
          />
          <ModeCard
            icon="steering-wheel"
            iconColor="text-success"
            title="Give rides & earn"
            description="Fill your empty seats on drives you're already making"
            testId="mode-driver"
            onClick={handleDriverPick}
          />
          <ModeCard
            icon="lightning"
            iconColor="text-warning"
            title="Both"
            description="Ride sometimes, drive sometimes — switch anytime"
            testId="mode-both"
            onClick={handleDriverPick}
          />
        </div>
      </div>
    </div>
  )
}
