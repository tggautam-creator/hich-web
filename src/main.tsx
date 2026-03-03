import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from '@/components/Landing'
import Signup from '@/components/Signup'
import Login from '@/components/Login'
import CheckInbox from '@/components/CheckInbox'
import CreateProfilePage from '@/components/auth/CreateProfilePage'
import Placeholder from '@/components/Placeholder'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Week 2 — Auth & Onboarding */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/check-inbox" element={<CheckInbox />} />
          <Route path="/onboarding/profile" element={<CreateProfilePage />} />
          <Route path="/onboarding/location" element={<Placeholder name="Location Permissions" />} />
          <Route path="/onboarding/mode" element={<Placeholder name="Mode Selection" />} />
          <Route path="/onboarding/vehicle" element={<Placeholder name="Vehicle Registration" />} />

          {/* Week 3 — Rider & Driver Flows */}
          <Route path="/home/rider" element={<Placeholder name="Rider Home" />} />
          <Route path="/home/driver" element={<Placeholder name="Driver Home" />} />
          <Route path="/ride/search" element={<Placeholder name="Destination Search" />} />
          <Route path="/ride/confirm" element={<Placeholder name="Ride Confirm" />} />
          <Route path="/ride/waiting" element={<Placeholder name="Waiting Room" />} />
          <Route path="/ride/suggestion/:rideId" element={<Placeholder name="Ride Suggestion" />} />

          {/* Week 4 — Schedule & Messaging */}
          <Route path="/schedule" element={<Placeholder name="Schedule" />} />
          <Route path="/ride/messaging/:rideId" element={<Placeholder name="Messaging Window" />} />
          <Route path="/ride/multi-driver/:rideId" element={<Placeholder name="Multi-Driver Map" />} />

          {/* Week 5 — Pickup & QR & Active Ride */}
          <Route path="/ride/pickup-driver/:rideId" element={<Placeholder name="Pickup Coordination (Driver)" />} />
          <Route path="/ride/pickup-rider/:rideId" element={<Placeholder name="Walk to Pickup (Rider)" />} />
          <Route path="/ride/active-driver/:rideId" element={<Placeholder name="Active Ride (Driver)" />} />
          <Route path="/ride/active-rider/:rideId" element={<Placeholder name="Active Ride (Rider)" />} />

          {/* Week 6 — Payment & Post-Ride */}
          <Route path="/wallet" element={<Placeholder name="Wallet" />} />
          <Route path="/wallet/add" element={<Placeholder name="Add Funds" />} />
          <Route path="/ride/summary/:rideId" element={<Placeholder name="Ride Summary" />} />
          <Route path="/ride/rate/:rideId" element={<Placeholder name="Rate Ride" />} />
          <Route path="/profile" element={<Placeholder name="My Profile" />} />
          <Route path="/report/:rideId" element={<Placeholder name="Report" />} />

          {/* Catch-all */}
          <Route path="*" element={<Placeholder name="404 — Not Found" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
