import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'

type LocationState = 'idle' | 'loading' | 'denied' | 'checking'

interface LocationPermissionsPageProps {
  'data-testid'?: string
}

export default function LocationPermissionsPage({
  'data-testid': testId = 'location-permissions-page',
}: LocationPermissionsPageProps) {
  const navigate = useNavigate()
  const [state, setState] = useState<LocationState>('checking')

  // Check if location permission is already granted — skip this page if so
  useEffect(() => {
    if (!navigator.permissions) {
      // Permissions API not supported — show the page
      setState('idle')
      return
    }
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      if (result.state === 'granted') {
        navigate('/onboarding/mode', { replace: true })
      } else {
        setState('idle')
      }
    }).catch(() => {
      setState('idle')
    })
  }, [navigate])

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

  // While checking permissions, show a brief spinner
  if (state === 'checking') {
    return (
      <div data-testid={testId} className="min-h-dvh w-full bg-surface flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
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

        <h1 className="text-2xl font-bold text-text-primary mb-3">Where are you?</h1>
        <p className="text-sm text-text-secondary mb-8">
          We need your location to match you with rides nearby. Just one tap.
        </p>

        {state === 'denied' ? (
          <div className="space-y-4">
            <div
              data-testid="denied-instructions"
              className="rounded-2xl border border-warning/20 bg-warning/5 px-4 py-4 text-left"
            >
              <p className="text-sm font-semibold text-text-primary mb-2">
                Location access was denied
              </p>
              <p className="text-sm text-text-secondary mb-3">
                TAGO needs your location to find rides near you. Please enable location in your browser settings:
              </p>
              <ol className="text-sm text-text-secondary space-y-1 list-decimal list-inside">
                <li>Open your browser settings</li>
                <li>Go to Site Settings &gt; Location</li>
                <li>Allow location access for this site</li>
                <li>Refresh the page and try again</li>
              </ol>
            </div>
            <button
              data-testid="continue-without-location"
              onClick={() => { navigate('/onboarding/mode') }}
              className="w-full text-center text-sm text-primary font-medium py-2"
            >
              Continue without location
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <PrimaryButton
              data-testid="allow-button"
              onClick={handleAllow}
              isLoading={state === 'loading'}
            >
              Share my location
            </PrimaryButton>
            <button
              data-testid="skip-location"
              onClick={() => { navigate('/onboarding/mode') }}
              className="w-full text-center text-sm text-text-secondary font-medium py-2"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
