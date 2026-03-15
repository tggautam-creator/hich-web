import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'home' | 'drive' | 'rides' | 'wallet' | 'profile'

interface BottomNavProps {
  activeTab: Tab
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Shared bottom navigation — 5 tabs, consistent across all pages.
 *
 * Home | Drive | Rides | Wallet | Profile
 *
 * - `activeTab` receives `text-primary` styling; others are `text-text-secondary`.
 * - Drive tab routes to `/home/driver` (if already a driver) or `/become-driver`.
 * - Rides tab links to My Rides (hub for active/upcoming rides).
 * - Uses `fixed` positioning so it works in both map pages and scrollable pages.
 */
export default function BottomNav({
  activeTab,
  'data-testid': testId = 'bottom-nav',
}: BottomNavProps) {
  const navigate = useNavigate()
  const isDriver = useAuthStore((s) => s.isDriver)

  function handleDriveTab() {
    if (activeTab === 'drive') return
    navigate(isDriver ? '/home/driver' : '/become-driver')
  }

  function handleHomeTab() {
    if (activeTab === 'home') return
    navigate('/home/rider')
  }

  const tabClass = (tab: Tab) =>
    [
      'flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors',
      activeTab === tab ? 'text-primary' : 'text-text-secondary hover:text-primary',
    ].join(' ')

  const labelClass = (tab: Tab) =>
    activeTab === tab ? 'text-[10px] font-semibold' : 'text-[10px] font-medium'

  return (
    <nav
      data-testid={testId}
      className="fixed bottom-0 left-0 right-0 z-[1000] bg-white/95 backdrop-blur-sm border-t border-border shadow-[0_-1px_3px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
    >
      <div className="flex">

        {/* Home */}
        <button
          data-testid="home-tab"
          onClick={handleHomeTab}
          aria-label="Home"
          className={tabClass('home')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className={labelClass('home')}>Home</span>
        </button>

        {/* Drive */}
        <button
          data-testid="driver-tab"
          onClick={handleDriveTab}
          aria-label={isDriver ? 'Switch to driver mode' : 'Become a driver'}
          className={tabClass('drive')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M5 15v-3l2-4h10l2 4v3" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <circle cx="7" cy="18" r="2" />
            <circle cx="17" cy="18" r="2" />
          </svg>
          <span className={labelClass('drive')}>Drive</span>
        </button>

        {/* Rides */}
        <button
          data-testid="rides-tab"
          onClick={() => { if (activeTab !== 'rides') navigate('/rides') }}
          aria-label="My Rides"
          className={tabClass('rides')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M16 3h5v5" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
          <span className={labelClass('rides')}>Rides</span>
        </button>

        {/* Wallet */}
        <button
          data-testid="wallet-tab"
          onClick={() => { navigate('/wallet') }}
          aria-label="Wallet"
          className={tabClass('wallet')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <span className={labelClass('wallet')}>Wallet</span>
        </button>

        {/* Profile */}
        <button
          data-testid="profile-tab"
          onClick={() => { navigate('/profile') }}
          aria-label="Profile"
          className={tabClass('profile')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className={labelClass('profile')}>Profile</span>
        </button>

      </div>
    </nav>
  )
}
