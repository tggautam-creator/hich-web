interface PostRideFABProps {
  onClick: () => void
  'data-testid'?: string
}

export default function PostRideFAB({
  onClick,
  'data-testid': testId = 'post-ride-fab',
}: PostRideFABProps) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      aria-label="Post a ride"
      className="fixed right-4 z-30 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 5.5rem)' }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  )
}
