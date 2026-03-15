import { useState, useCallback } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'
import Logo from '@/components/ui/Logo'

interface IntroCarouselProps {
  'data-testid'?: string
}

const SLIDES = [
  {
    id: 'welcome',
    title: 'Your Campus, Your Rides',
    description: 'HICH connects university students for safe, affordable carpooling. Only .edu verified students can join — your campus is your community.',
    fallbackIcon: '🎓',
  },
  {
    id: 'realtime',
    title: 'Real-Time Matching',
    description: 'No posting, no waiting. Request a ride and our AI instantly matches you with a driver heading your way. It just works.',
    fallbackIcon: '⚡',
  },
  {
    id: 'safety',
    title: 'Trust Built In',
    description: 'Every ride is QR-verified at pickup and drop-off. Emergency button always accessible. Every user is .edu authenticated. No strangers.',
    fallbackIcon: '🛡️',
  },
  {
    id: 'earn',
    title: 'Drive & Earn',
    description: 'Already commuting? Turn on driver mode and earn money on rides you\'re already taking. Set your schedule, we send riders to you.',
    fallbackIcon: '💰',
  },
  {
    id: 'get-started',
    title: 'Ready to Ride Smarter?',
    description: 'Save up to 70% vs rideshare. Split costs fairly. Build your campus network. Let\'s go.',
    fallbackIcon: '🚀',
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

        {/* Fallback icon for non-first slides */}
        {current > 0 && (
          <div className="w-28 h-28 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-5xl" data-testid={`slide-fallback-${slide.id}`}>
              {slide.fallbackIcon}
            </span>
          </div>
        )}

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
          {isLast ? "Let's Go" : 'Continue'}
        </button>
      </div>
    </div>
  )
}
