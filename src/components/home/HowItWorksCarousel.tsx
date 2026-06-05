import { useEffect, useRef, useState } from 'react'

/**
 * Step-by-step swipeable explainer of the Instant-Carpool loop. Lives
 * inside the home page's "How Instant Carpool works" card. Web port
 * of ios/Tago/Features/RiderHome/HowItWorksCarousel.swift — same 7
 * slides per side, same step badge + icon + title + body, same dot
 * indicators that animate the active dot wider.
 *
 * Snap-based scroll is the web equivalent of iOS `TabView(.page)` —
 * native swipe / keyboard / VoiceOver navigation comes for free, no
 * carousel library needed.
 */

export interface CarouselSlide {
  id: number
  icon: React.ReactNode
  title: string
  body: string
}

interface HowItWorksCarouselProps {
  slides: CarouselSlide[]
  tint?: 'primary' | 'success'
  'data-testid'?: string
}

export default function HowItWorksCarousel({
  slides,
  tint = 'primary',
  'data-testid': testId,
}: HowItWorksCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [index, setIndex] = useState(0)

  // Track which slide is currently snapped to so the dot row + the
  // step badge re-render as the user swipes. IntersectionObserver
  // beats scroll-position math because it accounts for fractional
  // widths + rubber-banding.
  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    // Guard for non-browser environments (jsdom test runs lack
    // IntersectionObserver). The dot indicators just won't update
    // during tests; manual scrollTo via clicking dots still works.
    if (typeof IntersectionObserver === 'undefined') return
    const slidesEls = Array.from(root.querySelectorAll<HTMLElement>('[data-carousel-slide]'))
    if (!slidesEls.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) {
          const i = Number(visible.target.getAttribute('data-carousel-index'))
          if (!Number.isNaN(i)) setIndex(i)
        }
      },
      { root, threshold: [0.55] },
    )
    slidesEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [slides.length])

  const tintBg = tint === 'success' ? 'bg-success/12' : 'bg-primary/12'
  const tintText = tint === 'success' ? 'text-success' : 'text-primary'
  const dotActive = tint === 'success' ? 'bg-success' : 'bg-primary'
  const dotIdle = tint === 'success' ? 'bg-success/25' : 'bg-primary/25'

  function scrollTo(i: number) {
    const root = scrollerRef.current
    if (!root) return
    const slide = root.querySelector<HTMLElement>(`[data-carousel-index="${i}"]`)
    if (!slide) return
    root.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' })
  }

  return (
    <div data-testid={testId ?? 'how-it-works-carousel'} className="flex flex-col gap-3">
      <div
        ref={scrollerRef}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="carousel"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            data-carousel-slide
            data-carousel-index={i}
            className="snap-center shrink-0 w-full px-2"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}: ${slide.title}`}
          >
            <div className="flex flex-col items-center text-center gap-2 min-h-[208px]">
              <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tintBg, tintText].join(' ')}>
                Step {i + 1} of {slides.length}
              </span>
              <span className={['mt-1', tintText].join(' ')} aria-hidden="true">
                {slide.icon}
              </span>
              <p className="text-base font-bold text-text-primary leading-tight max-w-xs">
                {slide.title}
              </p>
              <p className="text-[12px] text-text-secondary leading-relaxed max-w-xs">
                {slide.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Page dots — active dot widens (iOS Capsule animation) */}
      <div data-testid="how-it-works-dots" className="flex items-center justify-center gap-1.5" aria-hidden="true">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            className={[
              'h-1.5 rounded-full transition-all duration-200',
              i === index ? `w-4 ${dotActive}` : `w-1.5 ${dotIdle}`,
            ].join(' ')}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

// Slide decks live in `howItWorksSlides.tsx` so this file only
// exports React components (keeps Vite's fast-refresh boundary
// clean per `react-refresh/only-export-components`).
