import { useNavigate } from 'react-router-dom'

interface ModeSelectionPageProps {
  'data-testid'?: string
}

interface ModeCardProps {
  emoji: string
  title: string
  description: string
  testId: string
  onClick: () => void
}

function ModeCard({ emoji, title, description, testId, onClick }: ModeCardProps) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-border bg-white px-5 py-4 shadow-sm active:scale-[0.98] transition-transform"
    >
      <div className="text-3xl mb-2">{emoji}</div>
      <p className="font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary mt-0.5">{description}</p>
    </button>
  )
}

export default function ModeSelectionPage({
  'data-testid': testId = 'mode-selection-page',
}: ModeSelectionPageProps) {
  const navigate = useNavigate()

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
        <h1 className="text-2xl font-bold text-text-primary mb-2">How will you use HICH?</h1>
        <p className="text-sm text-text-secondary mb-8">You can always change this later.</p>

        <div className="flex flex-col gap-4">
          <ModeCard
            emoji={'\uD83D\uDEB6'}
            title="I need rides"
            description="Request rides from drivers heading your way"
            testId="mode-rider"
            onClick={() => { navigate('/home/rider') }}
          />
          <ModeCard
            emoji={'\uD83D\uDE97'}
            title="I offer rides"
            description="Pick up riders along your regular commute"
            testId="mode-driver"
            onClick={() => { navigate('/onboarding/vehicle') }}
          />
          <ModeCard
            emoji={'\u26A1'}
            title="I do both"
            description="Switch between requesting and offering rides"
            testId="mode-both"
            onClick={() => { navigate('/onboarding/vehicle') }}
          />
        </div>
      </div>
    </div>
  )
}
