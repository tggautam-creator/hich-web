import { useState, useCallback } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'
import Logo from '@/components/ui/Logo'
interface IntroCarouselProps {
  'data-testid'?: string
}

const SLIDES: readonly { id: string; title: string; description: string; image: string }[] = [
  {
    id: 'welcome',
    title: 'Going the same way?',
    description: 'TAGO connects you with drivers already headed your way. Tag along on routes that exist — no detours, no waiting.',
    image: '/onboarding/slide-welcome.png',
  },
  {
    id: 'realtime',
    title: 'Just tap and go',
    description: 'Enter where you\'re going and we\'ll find someone headed that way. No group chats, no refreshing a board. It just works.',
    image: '/onboarding/slide-realtime.png',
  },
  {
    id: 'safety',
    title: 'Rides from people you know',
    description: 'Every TAGO rider and driver is verified with a .edu email. Your campus community, your trusted rides.',
    image: '/onboarding/slide-safety.png',
  },
  {
    id: 'earn',
    title: 'Your commute pays you back',
    description: 'Already driving somewhere? Turn on driver mode and earn on trips you\'re already making. We send riders to you — zero extra effort.',
    image: '/onboarding/slide-earn.png',
  },
  {
    id: 'get-started',
    title: 'Save up to 70% vs Uber',
    description: 'That\'s real money back in your pocket every week. Thousands of people are already sharing rides.',
    image: '/onboarding/slide-savings.png',
  },
] as const

export default function IntroCarousel({ 'data-testid': testId = 'intro-carousel' }: IntroCarouselProps) {
  const [current, setCurrent] = useState(0)
  const setIntroSeen = useOnboardingStore((s) => s.setIntroSeen)

  const isLast = current === SLIDES.length - 1

  const handleNext = useCallback(() => {
    if (isLast) {
      setIntroSeen()
    } else {
      setCurrent((c) => c + 1)
    }
  }, [isLast, setIntroSeen])

  const handleSkip = useCallback(() => {
    setIntroSeen()
  }, [setIntroSeen])

  // Touch swipe handling
  const [touchStart, setTouchStart] = useState<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0]?.clientX ?? null)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return
    const diff = touchStart - (e.changedTouches[0]?.clientX ?? 0)
    if (Math.abs(diff) > 50) {
      if (diff > 0 && current < SLIDES.length - 1) {
        setCurrent((c) => c + 1)
      } else if (diff < 0 && current > 0) {
        setCurrent((c) => c - 1)
      }
    }
    setTouchStart(null)
  }

  const slide = SLIDES[current]!

  return (
    <div
      data-testid={testId}
      className="fixed inset-0 z-[1050] bg-surface flex flex-col font-sans"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Skip button */}
      {!isLast && (
        <div className="flex justify-end px-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
          <button
            data-testid="skip-button"
            onClick={handleSkip}
            className="text-sm font-medium text-text-secondary py-2"
          >
            Skip
          </button>
        </div>
      )}

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        {/* Logo on first slide */}
        {current === 0 && (
          <div className="mb-2">
            <Logo size="lg" data-testid="intro-logo" />
          </div>
        )}

        {/* Illustration */}
        <img
          src={slide.image}
          alt={slide.title}
          className="w-56 h-56 object-contain"
          data-testid={`slide-image-${slide.id}`}
        />

        <div className="text-center space-y-3 max-w-sm">
          <h2 data-testid={`slide-title-${slide.id}`} className="text-2xl font-bold text-text-primary">
            {slide.title}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            {slide.description}
          </p>
        </div>
      </div>

      {/* Bottom — dot indicators + button */}
      <div className="px-8 pb-8 space-y-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}>
        {/* Dots */}
        <div className="flex justify-center gap-2" data-testid="dot-indicators">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === current ? 'w-6 bg-primary' : 'w-2 bg-border'
              }`}
            />
          ))}
        </div>

        {/* Action button */}
        <button
          data-testid="next-button"
          onClick={handleNext}
          className="w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-white shadow-sm hover:shadow-md active:bg-primary-dark active:scale-[0.98] transition-all"
        >
          {isLast ? 'Find my first ride' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
