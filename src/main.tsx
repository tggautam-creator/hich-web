import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { initAnalytics } from '@/lib/analytics'
import { IS_TEST_STRIPE } from '@/lib/env'
import { MapPageSkeleton, ListPageSkeleton, FormPageSkeleton } from '@/components/ui/PageSkeleton'
import './index.css'

// AuthGuard is eagerly loaded — needed on every guarded route
import AuthGuard from '@/components/auth/AuthGuard'

initAnalytics()

// ── Safety ───────────────────────────────────────────────────────────────────
const TrackPage = lazy(() => import('@/components/safety/TrackPage'))

// ── Public routes ────────────────────────────────────────────────────────────
const Landing = lazy(() => import('@/components/Landing'))
const Signup = lazy(() => import('@/components/Signup'))
const Login = lazy(() => import('@/components/Login'))
const CheckInbox = lazy(() => import('@/components/CheckInbox'))
const AuthCallback = lazy(() => import('@/components/auth/AuthCallback'))
const ForgotPassword = lazy(() => import('@/components/auth/ForgotPassword'))
const ResetPasswordPage = lazy(() => import('@/components/auth/ResetPasswordPage'))
const TermsPage = lazy(() => import('@/components/legal/TermsPage'))
const PrivacyPage = lazy(() => import('@/components/legal/PrivacyPage'))

// ── Admin panel (Phase 0 shell; phases 1+ extend) ────────────────────────────
const AdminGuard = lazy(() => import('@/components/admin/AdminGuard'))
const AdminLayout = lazy(() => import('@/components/admin/AdminLayout'))
const AdminHomePage = lazy(() => import('@/components/admin/AdminHomePage'))

// ── Onboarding ───────────────────────────────────────────────────────────────
const CreateProfilePage = lazy(() => import('@/components/auth/CreateProfilePage'))
const LocationPermissionsPage = lazy(() => import('@/components/auth/LocationPermissionsPage'))
const ModeSelectionPage = lazy(() => import('@/components/auth/ModeSelectionPage'))
const PhoneVerificationPage = lazy(() => import('@/components/auth/PhoneVerificationPage'))
const VehicleRegistrationPage = lazy(() => import('@/components/auth/VehicleRegistrationPage'))

// ── Ride flow ────────────────────────────────────────────────────────────────
const RiderHomePage = lazy(() => import('@/components/ride/RiderHomePage'))
const DriverHomePage = lazy(() => import('@/components/ride/DriverHomePage'))
const DestinationSearch = lazy(() => import('@/components/ride/DestinationSearch'))
const RideConfirm = lazy(() => import('@/components/ride/RideConfirm'))
const WaitingRoom = lazy(() => import('@/components/ride/WaitingRoom'))
const RideSuggestion = lazy(() => import('@/components/ride/RideSuggestion'))
const DropoffSelection = lazy(() => import('@/components/ride/DropoffSelection'))
const MessagingWindow = lazy(() => import('@/components/ride/MessagingWindow'))
const MultiDriverMap = lazy(() => import('@/components/ride/MultiDriverMap'))
const DriverPickupPage = lazy(() => import('@/components/ride/DriverPickupPage'))
const RiderPickupPage = lazy(() => import('@/components/ride/RiderPickupPage'))
const DriverActiveRidePage = lazy(() => import('@/components/ride/DriverActiveRidePage'))
const DriverMultiRidePage = lazy(() => import('@/components/ride/DriverMultiRidePage'))
const DriverGroupChatPage = lazy(() => import('@/components/ride/DriverGroupChatPage'))
const DriverMultiSummaryFlow = lazy(() => import('@/components/ride/DriverMultiSummaryFlow'))
const RiderActiveRidePage = lazy(() => import('@/components/ride/RiderActiveRidePage'))
const RideSummaryPage = lazy(() => import('@/components/ride/RideSummaryPage'))
const RateRidePage = lazy(() => import('@/components/ride/RateRidePage'))

// ── Payment & Profile ────────────────────────────────────────────────────────
const WalletPage = lazy(() => import('@/components/ride/WalletPage'))
const TransactionDetailPage = lazy(() => import('@/components/ride/TransactionDetailPage'))
const AddFundsPage = lazy(() => import('@/components/ride/AddFundsPage'))
const PaymentMethodsPage = lazy(() => import('@/components/payment/PaymentMethodsPage'))
const SaveCardPage = lazy(() => import('@/components/payment/SaveCardPage'))
const RideHistoryPage = lazy(() => import('@/components/ride/RideHistoryPage'))
const ProfilePage = lazy(() => import('@/components/ride/ProfilePage'))
const VehicleEditPage = lazy(() => import('@/components/ride/VehicleEditPage'))
const SettingsPage = lazy(() => import('@/components/ride/SettingsPage'))
const ReportIssuePage = lazy(() => import('@/components/ride/ReportIssuePage'))
const RideReportPage = lazy(() => import('@/components/ride/RideReportPage'))

// ── Stripe Connect (Driver) ─────────────────────────────────────────────────
const StripeOnboardingPage = lazy(() => import('@/components/driver/StripeOnboardingPage'))
const StripeOnboardingCompletePage = lazy(() => import('@/components/driver/StripeOnboardingCompletePage'))
const DriverPayoutsPage = lazy(() => import('@/components/driver/DriverPayoutsPage'))

// ── Schedule & Board ─────────────────────────────────────────────────────────
const SchedulePage = lazy(() => import('@/components/schedule/SchedulePage'))
const RideBoard = lazy(() => import('@/components/schedule/RideBoard'))
const BoardRequestReview = lazy(() => import('@/components/ride/BoardRequestReview'))
const NotificationsPage = lazy(() => import('@/components/ride/NotificationsPage'))
const MyRidesPage = lazy(() => import('@/components/ride/MyRidesPage'))
const BecomeDriverPage = lazy(() => import('@/components/ride/BecomeDriverPage'))
const Placeholder = lazy(() => import('@/components/Placeholder'))

// ── App setup ────────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* Sandbox banner — only renders when running with a test Stripe
            publishable key. Anchored above all routes via z-9999 so users
            cannot mistake test sessions for real ones. */}
        {IS_TEST_STRIPE && (
          <div
            data-testid="sandbox-banner"
            className="fixed top-0 inset-x-0 z-[9999] bg-warning text-black text-center text-xs font-bold py-1 pointer-events-none"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            Sandbox · payments are not real
          </div>
        )}
        <Suspense fallback={<FormPageSkeleton />}>
          <Routes>
            {/* ── Public routes — no auth required ──────────────────────────── */}
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/check-inbox" element={<CheckInbox />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/track/:token" element={<Suspense fallback={<FormPageSkeleton />}><TrackPage /></Suspense>} />
            <Route path="/terms" element={<Suspense fallback={<FormPageSkeleton />}><TermsPage /></Suspense>} />
            <Route path="/privacy" element={<Suspense fallback={<FormPageSkeleton />}><PrivacyPage /></Suspense>} />

            {/* ── Authenticated routes — AuthGuard checks session + profile ── */}
            <Route element={<AuthGuard />}>

              {/* Onboarding */}
              <Route path="/onboarding/profile" element={<Suspense fallback={<FormPageSkeleton />}><CreateProfilePage /></Suspense>} />
              <Route path="/onboarding/verify-phone" element={<Suspense fallback={<FormPageSkeleton />}><PhoneVerificationPage /></Suspense>} />
              <Route path="/onboarding/location" element={<Suspense fallback={<FormPageSkeleton />}><LocationPermissionsPage /></Suspense>} />
              <Route path="/onboarding/mode" element={<Suspense fallback={<FormPageSkeleton />}><ModeSelectionPage /></Suspense>} />
              <Route path="/onboarding/vehicle" element={<Suspense fallback={<FormPageSkeleton />}><VehicleRegistrationPage /></Suspense>} />

              {/* Rider & Driver Flows */}
              <Route path="/home/rider" element={<Suspense fallback={<MapPageSkeleton />}><RiderHomePage /></Suspense>} />
              <Route path="/home/driver" element={<Suspense fallback={<MapPageSkeleton />}><DriverHomePage /></Suspense>} />
              <Route path="/become-driver" element={<Suspense fallback={<FormPageSkeleton />}><BecomeDriverPage /></Suspense>} />
              <Route path="/ride/search" element={<Suspense fallback={<ListPageSkeleton />}><DestinationSearch /></Suspense>} />
              <Route path="/ride/confirm" element={<Suspense fallback={<FormPageSkeleton />}><RideConfirm /></Suspense>} />
              <Route path="/ride/waiting" element={<Suspense fallback={<MapPageSkeleton />}><WaitingRoom /></Suspense>} />
              <Route path="/ride/suggestion/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><RideSuggestion /></Suspense>} />
              <Route path="/ride/dropoff/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><DropoffSelection /></Suspense>} />

              {/* Schedule & Messaging */}
              <Route path="/schedule" element={<Suspense fallback={<FormPageSkeleton />}><SchedulePage mode="rider" /></Suspense>} />
              <Route path="/schedule/rider" element={<Suspense fallback={<FormPageSkeleton />}><SchedulePage mode="rider" /></Suspense>} />
              <Route path="/schedule/driver" element={<Suspense fallback={<FormPageSkeleton />}><SchedulePage mode="driver" /></Suspense>} />
              <Route path="/rides/board" element={<Suspense fallback={<ListPageSkeleton />}><RideBoard /></Suspense>} />
              <Route path="/ride/board-review/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><BoardRequestReview /></Suspense>} />
              <Route path="/ride/messaging/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><MessagingWindow /></Suspense>} />
              <Route path="/ride/multi-driver/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><MultiDriverMap /></Suspense>} />

              {/* Pickup & Active Ride */}
              <Route path="/ride/pickup-driver/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><DriverPickupPage /></Suspense>} />
              <Route path="/ride/pickup-rider/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><RiderPickupPage /></Suspense>} />
              <Route path="/ride/active-driver/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><DriverActiveRidePage /></Suspense>} />
              <Route path="/ride/driver-multi/:scheduleId" element={<Suspense fallback={<MapPageSkeleton />}><DriverMultiRidePage /></Suspense>} />
              <Route path="/ride/group-chat/:scheduleId" element={<Suspense fallback={<MapPageSkeleton />}><DriverGroupChatPage /></Suspense>} />
              <Route path="/ride/multi-summary/:scheduleId" element={<Suspense fallback={<FormPageSkeleton />}><DriverMultiSummaryFlow /></Suspense>} />
              <Route path="/ride/active-rider/:rideId" element={<Suspense fallback={<MapPageSkeleton />}><RiderActiveRidePage /></Suspense>} />

              {/* Rides hub & Notifications */}
              <Route path="/rides" element={<Suspense fallback={<ListPageSkeleton />}><MyRidesPage /></Suspense>} />
              <Route path="/notifications" element={<Suspense fallback={<ListPageSkeleton />}><NotificationsPage /></Suspense>} />

              {/* Payment & Post-Ride */}
              <Route path="/wallet" element={<Suspense fallback={<ListPageSkeleton />}><WalletPage /></Suspense>} />
              <Route path="/wallet/transaction/:id" element={<Suspense fallback={<FormPageSkeleton />}><TransactionDetailPage /></Suspense>} />
              <Route path="/wallet/add" element={<Suspense fallback={<FormPageSkeleton />}><AddFundsPage /></Suspense>} />
              <Route path="/payment/methods" element={<Suspense fallback={<ListPageSkeleton />}><PaymentMethodsPage /></Suspense>} />
              <Route path="/payment/add" element={<Suspense fallback={<FormPageSkeleton />}><SaveCardPage /></Suspense>} />

              {/* Stripe Connect (Driver) */}
              <Route path="/stripe/onboarding" element={<Suspense fallback={<FormPageSkeleton />}><StripeOnboardingPage /></Suspense>} />
              <Route path="/stripe/onboarding/complete" element={<Suspense fallback={<FormPageSkeleton />}><StripeOnboardingCompletePage /></Suspense>} />
              <Route path="/stripe/payouts" element={<Suspense fallback={<ListPageSkeleton />}><DriverPayoutsPage /></Suspense>} />
              <Route path="/rides/history" element={<Suspense fallback={<ListPageSkeleton />}><RideHistoryPage /></Suspense>} />
              <Route path="/ride/summary/:rideId" element={<Suspense fallback={<FormPageSkeleton />}><RideSummaryPage /></Suspense>} />
              <Route path="/ride/rate/:rideId" element={<Suspense fallback={<FormPageSkeleton />}><RateRidePage /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<ListPageSkeleton />}><ProfilePage /></Suspense>} />
              <Route path="/vehicle/edit/:vehicleId" element={<Suspense fallback={<FormPageSkeleton />}><VehicleEditPage /></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={<FormPageSkeleton />}><SettingsPage /></Suspense>} />
              <Route path="/report-issue" element={<Suspense fallback={<FormPageSkeleton />}><ReportIssuePage /></Suspense>} />
              <Route path="/report/:rideId" element={<Suspense fallback={<FormPageSkeleton />}><RideReportPage /></Suspense>} />

              {/* ── Admin panel (Phase 0 shell — gated by AdminGuard) ── */}
              <Route element={<Suspense fallback={<FormPageSkeleton />}><AdminGuard /></Suspense>}>
                <Route element={<Suspense fallback={<FormPageSkeleton />}><AdminLayout /></Suspense>}>
                  <Route path="/admin" element={<Suspense fallback={<FormPageSkeleton />}><AdminHomePage /></Suspense>} />
                  <Route path="/admin/users"      element={<Placeholder name="Users — Slice 1.3" />} />
                  <Route path="/admin/campaigns"  element={<Placeholder name="Campaigns — Slice 1.4" />} />
                  <Route path="/admin/live"       element={<Placeholder name="Live ops — Slice 1.7" />} />
                  <Route path="/admin/audit-log"  element={<Placeholder name="Audit log — Slice 1.8" />} />
                  <Route path="/admin/settings"   element={<Placeholder name="Admin settings — future" />} />
                </Route>
              </Route>

            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Placeholder name="404 — Not Found" />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
