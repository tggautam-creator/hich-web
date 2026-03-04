import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from '@/components/Landing'
import Signup from '@/components/Signup'
import Login from '@/components/Login'
import CheckInbox from '@/components/CheckInbox'
import AuthCallback from '@/components/auth/AuthCallback'
import ForgotPassword from '@/components/auth/ForgotPassword'
import AuthGuard from '@/components/auth/AuthGuard'
import CreateProfilePage from '@/components/auth/CreateProfilePage'
import LocationPermissionsPage from '@/components/auth/LocationPermissionsPage'
import ModeSelectionPage from '@/components/auth/ModeSelectionPage'
import VehicleRegistrationPage from '@/components/auth/VehicleRegistrationPage'
import RiderHomePage from '@/components/ride/RiderHomePage'
import DestinationSearch from '@/components/ride/DestinationSearch'
import RideConfirm from '@/components/ride/RideConfirm'
import WaitingRoom from '@/components/ride/WaitingRoom'
import RideSuggestion from '@/components/ride/RideSuggestion'
import DriverHomePage from '@/components/ride/DriverHomePage'
import Placeholder from '@/components/Placeholder'
import 'leaflet/dist/leaflet.css'
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
          {/* ── Public routes — no auth required ──────────────────────────────── */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/check-inbox" element={<CheckInbox />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* ── Authenticated routes — AuthGuard checks session + profile ──────── */}
          <Route element={<AuthGuard />}>

            {/* Week 2 — Onboarding */}
            <Route path="/onboarding/profile"  element={<CreateProfilePage />} />
            <Route path="/onboarding/location" element={<LocationPermissionsPage />} />
            <Route path="/onboarding/mode"     element={<ModeSelectionPage />} />
            <Route path="/onboarding/vehicle"  element={<VehicleRegistrationPage />} />

            {/* Week 3 — Rider & Driver Flows */}
            <Route path="/home/rider"                element={<RiderHomePage />} />
            <Route path="/home/driver"               element={<DriverHomePage />} />
            <Route path="/ride/search"               element={<DestinationSearch />} />
            <Route path="/ride/confirm"              element={<RideConfirm />} />
            <Route path="/ride/waiting"              element={<WaitingRoom />} />
            <Route path="/ride/suggestion/:rideId"   element={<RideSuggestion />} />

            {/* Week 4 — Schedule & Messaging */}
            <Route path="/schedule"                      element={<Placeholder name="Schedule" />} />
            <Route path="/ride/messaging/:rideId"        element={<Placeholder name="Messaging Window" />} />
            <Route path="/ride/multi-driver/:rideId"     element={<Placeholder name="Multi-Driver Map" />} />

            {/* Week 5 — Pickup & QR & Active Ride */}
            <Route path="/ride/pickup-driver/:rideId"  element={<Placeholder name="Pickup Coordination (Driver)" />} />
            <Route path="/ride/pickup-rider/:rideId"   element={<Placeholder name="Walk to Pickup (Rider)" />} />
            <Route path="/ride/active-driver/:rideId"  element={<Placeholder name="Active Ride (Driver)" />} />
            <Route path="/ride/active-rider/:rideId"   element={<Placeholder name="Active Ride (Rider)" />} />

            {/* Week 6 — Payment & Post-Ride */}
            <Route path="/wallet"                element={<Placeholder name="Wallet" />} />
            <Route path="/wallet/add"            element={<Placeholder name="Add Funds" />} />
            <Route path="/ride/summary/:rideId"  element={<Placeholder name="Ride Summary" />} />
            <Route path="/ride/rate/:rideId"     element={<Placeholder name="Rate Ride" />} />
            <Route path="/profile"               element={<Placeholder name="My Profile" />} />
            <Route path="/report/:rideId"        element={<Placeholder name="Report" />} />

          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Placeholder name="404 — Not Found" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
