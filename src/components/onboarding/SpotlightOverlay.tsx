import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useOnboardingStore } from '@/stores/onboardingStore'

interface SpotlightOverlayProps {
  'data-testid'?: string
}

interface SpotlightStep {
  targetTestId: string
  title: string
  description: string
}

const STEPS: SpotlightStep[] = [
  {
    targetTestId: 'search-bar',
    title: 'Find Rides in Real-Time',
    description: 'Tap here to enter your destination. Our AI will instantly match you with a verified driver heading the same way — no posting needed.',
  },
  {
    targetTestId: 'ride-board-button',
    title: 'Browse the Ride Board',
    description: 'See all scheduled rides from fellow students. Find a ride that fits your schedule or post your own commute.',
  },
  {
    targetTestId: 'driver-tab',
    title: 'Drive & Earn Money',
    description: 'Already commuting? Switch to driver mode and earn money on rides you\'re already taking. Set it and forget it.',
  },
  {
    targetTestId: 'rides-tab',
    title: 'Your Rides & Schedule',
    description: 'View your active rides, upcoming trips, and set recurring commute schedules. Never miss a ride.',
  },
  {
    targetTestId: 'wallet-tab',
    title: 'Your Wallet',
    description: 'Add funds, track earnings, and view your transaction history. Payments are automatic after each QR-verified ride.',
  },
  {
    targetTestId: 'profile-tab',
    title: 'Your Profile & Settings',
    description: 'Manage your vehicle, view ride history, and customize notification preferences.',
  },
]

export default function SpotlightOverlay({ 'data-testid': testId = 'spotlight-overlay' }: SpotlightOverlayProps) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const setWalkthroughSeen = useOnboardingStore((s) => s.setWalkthroughSeen)

  const currentStep = STEPS[step]!

  const measureTarget = useCallback(() => {
    const el = document.querySelector(`[data-testid="${currentStep.targetTestId}"]`)
    if (el) {
      setRect(el.getBoundingClientRect())
    } else {
      setRect(null)
    }
  }, [currentStep.targetTestId])

  useEffect(() => {
    measureTarget()
    window.addEventListener('resize', measureTarget)
    return () => window.removeEventListener('resize', measureTarget)
  }, [measureTarget])

  const handleNext = () => {
    if (step === STEPS.length - 1) {
      setWalkthroughSeen()
    } else {
      setStep((s) => s + 1)
    }
  }

  const handleSkip = () => {
    setWalkthroughSeen()
  }

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) return null

  const padding = 8
  // Auto-detect: place tooltip above when target is in lower half of screen
  const tooltipHeight = 200
  const placeAbove = rect ? (rect.bottom + padding + 12 + tooltipHeight > window.innerHeight) : false

  return createPortal(
    <div data-testid={testId} className="fixed inset-0 z-[1050] font-sans">
      {/* Dark overlay with hole */}
      <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - padding}
                y={rect.top - padding}
                width={rect.width + padding * 2}
                height={rect.height + padding * 2}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Tooltip — always visible, centered fallback when target not found */}
      <div
        data-testid={`spotlight-tooltip-${step}`}
        className="absolute left-4 right-4 mx-auto max-w-sm"
        style={rect ? (placeAbove ? {
          bottom: window.innerHeight - rect.top + padding + 12,
        } : {
          top: rect.bottom + padding + 12,
        }) : {
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      >
        <div className="bg-white rounded-2xl p-5 shadow-xl border border-border">
          <p className="text-xs text-text-secondary mb-1">
            {step + 1} of {STEPS.length}
          </p>
          <h3 data-testid="spotlight-title" className="text-base font-bold text-text-primary mb-1.5">
            {currentStep.title}
          </h3>
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            {currentStep.description}
          </p>
          <div className="flex items-center justify-between">
            <button
              data-testid="spotlight-skip"
              onClick={handleSkip}
              className="text-xs font-medium text-text-secondary"
            >
              Skip tour
            </button>
            <button
              data-testid="spotlight-next"
              onClick={handleNext}
              className="rounded-2xl bg-primary px-5 py-2 text-xs font-semibold text-white"
            >
              {step === STEPS.length - 1 ? 'Got it!' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalRoot,
  )
}
