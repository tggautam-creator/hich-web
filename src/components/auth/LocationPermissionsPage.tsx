import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'

type LocationState = 'idle' | 'loading' | 'denied'

interface LocationPermissionsPageProps {
  'data-testid'?: string
}

export default function LocationPermissionsPage({
  'data-testid': testId = 'location-permissions-page',
}: LocationPermissionsPageProps) {
  const navigate = useNavigate()
  const [state, setState] = useState<LocationState>('idle')

  function handleAllow() {
    if (!navigator.geolocation) {
      setState('denied')
      return
    }
    setState('loading')
    navigator.geolocation.getCurrentPosition(
      () => {
        navigate('/onboarding/mode')
      },
      () => {
        setState('denied')
      },
      { timeout: 10000, maximumAge: 0 },
    )
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
      <div className="flex-1 flex flex-col justify-center px-6 text-center">
        <div className="text-6xl mb-6" aria-hidden="true">
          {state === 'denied' ? '\u26A0\uFE0F' : '\uD83D\uDCCD'}
        </div>

        <h1 className="text-2xl font-bold text-text-primary mb-3">Enable location</h1>
        <p className="text-sm text-text-secondary mb-8">
          HICH uses your location to find drivers heading your way. Required to use the app.
        </p>

        {state === 'denied' ? (
          <div
            data-testid="denied-instructions"
            className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-4 text-left"
          >
            <p className="text-sm font-semibold text-text-primary mb-2">
              Location access was denied
            </p>
            <p className="text-sm text-text-secondary mb-3">
              To use HICH, please enable location in your browser settings:
            </p>
            <ol className="text-sm text-text-secondary space-y-1 list-decimal list-inside">
              <li>Open your browser settings</li>
              <li>Go to Site Settings &gt; Location</li>
              <li>Allow location access for this site</li>
              <li>Refresh the page and try again</li>
            </ol>
          </div>
        ) : (
          <PrimaryButton
            data-testid="allow-button"
            onClick={handleAllow}
            isLoading={state === 'loading'}
          >
            Allow location access
          </PrimaryButton>
        )}
      </div>
    </div>
  )
}
