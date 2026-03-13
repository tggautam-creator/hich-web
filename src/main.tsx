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
import ResetPasswordPage from '@/components/auth/ResetPasswordPage'
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
import MessagingWindow from '@/components/ride/MessagingWindow'
import DriverPickupPage from '@/components/ride/DriverPickupPage'
import RiderPickupPage from '@/components/ride/RiderPickupPage'
import DriverActiveRidePage from '@/components/ride/DriverActiveRidePage'
import RiderActiveRidePage from '@/components/ride/RiderActiveRidePage'
import RideSummaryPage from '@/components/ride/RideSummaryPage'
import RateRidePage from '@/components/ride/RateRidePage'
import WalletPage from '@/components/ride/WalletPage'
import MultiDriverMap from '@/components/ride/MultiDriverMap'
import AddFundsPage from '@/components/ride/AddFundsPage'
import RideHistoryPage from '@/components/ride/RideHistoryPage'
import ProfilePage from '@/components/ride/ProfilePage'
import SchedulePage from '@/components/schedule/SchedulePage'
import RideBoard from '@/components/schedule/RideBoard'
import BoardRequestReview from '@/components/ride/BoardRequestReview'
import NotificationsPage from '@/components/ride/NotificationsPage'
import MyRidesPage from '@/components/ride/MyRidesPage'
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
          {/* ── Public routes — no auth required ──────────────────────────────── */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/check-inbox" element={<CheckInbox />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            <Route path="/schedule"                      element={<SchedulePage mode="rider" />} />
            <Route path="/schedule/rider"                 element={<SchedulePage mode="rider" />} />
            <Route path="/schedule/driver"                element={<SchedulePage mode="driver" />} />
            <Route path="/rides/board"                    element={<RideBoard />} />
            <Route path="/ride/board-review/:rideId"     element={<BoardRequestReview />} />
            <Route path="/ride/messaging/:rideId"        element={<MessagingWindow />} />
            <Route path="/ride/multi-driver/:rideId"     element={<MultiDriverMap />} />

            {/* Week 5 — Pickup & QR & Active Ride */}
            <Route path="/ride/pickup-driver/:rideId"  element={<DriverPickupPage />} />
            <Route path="/ride/pickup-rider/:rideId"   element={<RiderPickupPage />} />
            <Route path="/ride/active-driver/:rideId"  element={<DriverActiveRidePage />} />
            <Route path="/ride/active-rider/:rideId"   element={<RiderActiveRidePage />} />

            {/* Rides hub & Notifications */}
            <Route path="/rides"                   element={<MyRidesPage />} />
            <Route path="/notifications"           element={<NotificationsPage />} />

            {/* Week 6 — Payment & Post-Ride */}
            <Route path="/wallet"                element={<WalletPage />} />
            <Route path="/wallet/add"            element={<AddFundsPage />} />
            <Route path="/rides/history"         element={<RideHistoryPage />} />
            <Route path="/ride/summary/:rideId"  element={<RideSummaryPage />} />
            <Route path="/ride/rate/:rideId"     element={<RateRidePage />} />
            <Route path="/profile"               element={<ProfilePage />} />
            <Route path="/report/:rideId"        element={<Placeholder name="Report" />} />

          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Placeholder name="404 — Not Found" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
