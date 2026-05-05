import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <div
      data-testid="privacy-page"
      className="min-h-dvh w-full bg-surface"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 1rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          Back to home
        </Link>

        <h1 className="mb-2 text-3xl font-bold text-text-primary">Privacy Policy</h1>
        <p className="mb-6 text-sm text-text-secondary">Effective Date: May 4, 2026</p>

        {/* Beta + unverified-ID banner — prominent so neither riders, drivers,
            nor App Store reviewers can miss it. */}
        <div className="mb-8 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed text-text-primary">
          <p className="mb-2 font-semibold text-warning">
            Beta Notice — Important
          </p>
          <p>
            TAGO is currently in <strong>early access (beta)</strong>. During this
            phase we do <strong>not</strong> verify driver&apos;s licenses,
            vehicle ownership, automobile insurance, driving history, criminal
            background, or rider identity beyond a working <code>.edu</code>{' '}
            email address. The .edu check is an access gate, not an identity
            verification. You are responsible for evaluating the people you
            ride with or carry as passengers. See our{' '}
            <Link to="/terms" className="text-primary underline">
              Terms of Service
            </Link>{' '}
            for the full risk allocation.
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-text-primary">
          {/* 1. Introduction */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">1. Introduction</h2>
            <p>
              TAGO (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates a
              peer-to-peer carpooling platform (the &quot;Service&quot;). This
              Privacy Policy explains what information we collect, how we use it,
              who we share it with, and the choices you have. By creating an
              account or using the Service, you consent to the practices
              described here.
            </p>
          </section>

          {/* 2. Information We Collect */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">2. Information We Collect</h2>
            <p>We collect the following categories of information:</p>

            <h3 className="mt-3 font-medium">Account &amp; Profile</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Full name</li>
              <li>University email address (must end in <code>.edu</code>)</li>
              <li>Phone number (verified via SMS one-time passcode)</li>
              <li>Date of birth (used to confirm you meet our 18+ minimum)</li>
              <li>Profile photo (optional)</li>
              <li>
                Password — stored only as an encrypted hash by Supabase Auth.
                We never see or store your plaintext password.
              </li>
            </ul>

            <h3 className="mt-3 font-medium">Driver Information (drivers only)</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Vehicle make, model, year, color</li>
              <li>License plate number (text only — we no longer collect a plate photo)</li>
              <li>Vehicle photo</li>
              <li>
                Stripe Connect account information for receiving payouts —
                created and managed by Stripe; we receive only an account ID
                + onboarding status, not your bank details
              </li>
              <li>Driver routine / typical commute schedule (optional)</li>
              <li>Decline reasons and snooze preferences (so we can pace requests sensibly)</li>
            </ul>

            <h3 className="mt-3 font-medium">Location Data</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Pickup and drop-off coordinates for ride requests</li>
              <li>
                Real-time location during active rides — used for navigation,
                ETA, the rider&apos;s &quot;where&apos;s my driver&quot; map,
                and the in-app safety/trip-share feature
              </li>
              <li>
                Drivers&apos; coarse online location while &quot;Online&quot;
                so the matcher can route nearby ride requests to you. Stops
                broadcasting the moment you toggle Offline or Snooze.
              </li>
            </ul>

            <h3 className="mt-3 font-medium">Payment &amp; Wallet</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Card and Apple Pay details are collected and processed by{' '}
                <strong>Stripe</strong>. We never see or store your full card
                number, CVV, or Apple Pay token. We retain only a Stripe
                customer/payment-method identifier so we can charge for
                completed rides.
              </li>
              <li>
                Wallet balance, top-ups, ride charges, tips, withdrawals, and
                payout history are stored in your account so you can review
                them and so we can resolve disputes.
              </li>
            </ul>

            <h3 className="mt-3 font-medium">Communications &amp; Ratings</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                In-app chat messages between matched riders and drivers
                (retained for safety review and dispute resolution)
              </li>
              <li>
                Ratings and short feedback you and your ride partner exchange
                after each completed trip
              </li>
              <li>
                Notifications history (ride requests, payment events, schedule
                matches) plus your notification preferences
              </li>
            </ul>

            <h3 className="mt-3 font-medium">Device &amp; Push Tokens</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Apple Push (APNs) and Firebase Cloud Messaging (FCM) tokens —
                so we can deliver lock-screen notifications for incoming
                rides, payment events, and safety alerts
              </li>
              <li>
                Apple Live Activity tokens — so we can update the lock-screen
                / Dynamic Island ride card during an active trip
              </li>
              <li>Device type, OS version, and browser/app version for diagnostics</li>
            </ul>

            <h3 className="mt-3 font-medium">Usage Analytics</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Feature interactions and screen events captured by{' '}
                <strong>PostHog</strong> to understand usage and prioritize
                fixes. Pseudonymous — keyed to a randomly generated
                installation ID, not your name.
              </li>
            </ul>
          </section>

          {/* 3. How We Use Your Information */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">3. How We Use Your Information</h2>
            <p>We use the data above to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Create and operate your account</li>
              <li>Verify your phone number via SMS and confirm you are 18+</li>
              <li>Match riders with drivers heading the same direction</li>
              <li>Charge for completed rides and pay drivers their share</li>
              <li>
                Provide safety surfaces: in-app emergency button, trip
                sharing, ETA tracking, post-ride incident reporting
              </li>
              <li>Send push notifications about ride status, payments, and account events</li>
              <li>
                Pace ride request notifications so drivers aren&apos;t
                bombarded (using the snooze and decline-reason data)
              </li>
              <li>Investigate fraud, abuse, and disputes</li>
              <li>Improve the Service via aggregated analytics</li>
              <li>Respond to support requests</li>
            </ul>
          </section>

          {/* 4. SMS Communications — Twilio-critical */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">4. SMS Communications</h2>
            <p>
              When you provide your phone number to TAGO, we may send you SMS
              text messages for:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Phone number verification via one-time passcodes (OTP)</li>
              <li>Account security alerts</li>
              <li>Ride status notifications</li>
            </ul>
            <p className="mt-3">
              <strong>Message frequency varies.</strong> Message and data rates
              may apply depending on your mobile carrier and plan.
            </p>
            <p className="mt-3">
              You may opt out of receiving SMS messages at any time by replying{' '}
              <strong>STOP</strong> to any message received from TAGO. To get
              help, reply <strong>HELP</strong> or contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
            <p className="mt-3">
              Carriers are not liable for delayed or undelivered messages. Your
              consent to receive non-security SMS messages is not a condition of
              using the Service.
            </p>
          </section>

          {/* 5. Information Sharing */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">5. Information Sharing</h2>
            <p>We share your information only as follows:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>With your matched ride partner:</strong> Riders see the
                driver&apos;s name, profile photo, vehicle details, real-time
                location, and rating during a ride. Drivers see the
                rider&apos;s name, profile photo, pickup location, and
                rating. Once a ride completes, real-time location stops being
                shared.
              </li>
              <li>
                <strong>Service providers:</strong> Supabase (database, auth,
                storage), Stripe and Stripe Connect (payments &amp; payouts),
                Twilio (SMS), Apple (APNs / Apple Pay), Google
                (Firebase Cloud Messaging, Maps, Places, Routes), PostHog
                (analytics), Amazon Web Services (Supabase&apos;s hosting
                provider), and EIA (US gas-price reference data). Each
                processes data only for the function we&apos;ve hired them
                for.
              </li>
              <li>
                <strong>Legal requirements:</strong> We may disclose
                information if required by law, legal process, or a
                government request.
              </li>
              <li>
                <strong>Safety:</strong> We may share information with law
                enforcement if we believe in good faith it is necessary to
                prevent imminent harm or respond to an emergency.
              </li>
              <li>
                <strong>Business transitions:</strong> If TAGO is acquired or
                merged, your information may transfer to the successor entity
                under the same protections described here.
              </li>
            </ul>
            <p className="mt-3 font-medium">
              We do not sell, rent, or trade your personal information to third
              parties for advertising or marketing purposes.
            </p>
          </section>

          {/* 6. Data Storage & Security */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">6. Data Storage &amp; Security</h2>
            <p>
              Your data is stored in Supabase (hosted on AWS). We implement the
              following safeguards:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Row-level security policies on every database table so each
                user can only read or write their own rows (and the matched
                counterparty&apos;s during a shared ride)
              </li>
              <li>HTTPS/TLS for every network call</li>
              <li>Private storage buckets for profile and vehicle photos</li>
              <li>JWT-validated API endpoints</li>
              <li>HMAC-signed QR codes for the start-ride / end-ride flow</li>
              <li>
                Stripe handles all card data inside their PCI-DSS-compliant
                vault — TAGO never sees raw card data
              </li>
            </ul>
            <p className="mt-3">
              While we work to protect your information, no method of
              electronic storage or transmission is 100% secure. We cannot
              guarantee absolute security.
            </p>
          </section>

          {/* 7. Location Data */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">7. Location Data</h2>
            <p>
              We collect location data only when necessary for providing the
              Service: while you have an active ride, while a driver is
              toggled &quot;Online&quot; (so we can route nearby requests to
              them), and when you actively pick a pickup or drop-off point.
              We do not continuously track your location when you are not
              using the Service. iOS users can revoke location permission at
              any time in Settings → TAGO RIDES → Location.
            </p>
          </section>

          {/* 8. Data Retention */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">8. Data Retention</h2>
            <p>
              We retain your account information while your account is active.
              Ride history, chat messages, ratings, and transaction records
              are retained for safety review, dispute resolution, and legal
              compliance. If you request account deletion via Settings →
              Account → Delete account or by emailing us, we will remove
              personal data within 30 days, except where retention is
              required by law (e.g., financial records) or where a recent
              dispute is unresolved.
            </p>
          </section>

          {/* 9. Your Rights */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">9. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your account and personal data</li>
              <li>Opt out of SMS communications by replying STOP</li>
              <li>Toggle individual notification categories on or off in Settings</li>
              <li>Disable analytics tracking</li>
              <li>Revoke location and notification permissions in iOS Settings at any time</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
          </section>

          {/* 10. Children's Privacy */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">10. Children&apos;s Privacy</h2>
            <p>
              The Service is not intended for users under the age of 18. We
              collect date of birth at signup and reject accounts that
              indicate an age below 18. If we become aware that we have
              inadvertently collected data from a minor, we will delete that
              information promptly.
            </p>
          </section>

          {/* 11. Beta Notice */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">
              11. Beta Notice &amp; Identity Verification
            </h2>
            <p>
              TAGO is in early access. We currently:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Confirm only that the email address you sign up with ends in <code>.edu</code></li>
              <li>Verify ownership of the phone number you provide (via SMS OTP)</li>
              <li>Require a self-reported date of birth (18+)</li>
            </ul>
            <p className="mt-3">
              We do <strong>not</strong> currently verify driver&apos;s
              licenses, automobile insurance, vehicle registration, driving
              history, or criminal background, and we do <strong>not</strong>{' '}
              verify rider identity beyond the email + phone above. Vehicle
              and license plate information is self-reported and not
              cross-checked. Background-check and document-verification
              integrations are planned for a future release.
            </p>
            <p className="mt-3">
              Until then, you should evaluate any rider or driver you match
              with the same caution you would apply to any peer arrangement
              found through a public bulletin board. The features TAGO does
              provide — pickup/dropoff QR scans, real-time tracking, in-app
              chat, emergency button, trip sharing — are tools to help you
              make safer decisions, not a substitute for your own judgment.
            </p>
          </section>

          {/* 12. Changes to This Policy */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we
              make material changes, we will update the &quot;Effective
              Date&quot; at the top and, where appropriate, surface a notice
              in the app. Continued use of the Service after changes are
              posted constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* 13. Contact */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">13. Contact Us</h2>
            <p>
              Questions, complaints, or requests about this Privacy Policy can
              be directed to{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-10 border-t border-border pt-6 text-center text-xs text-text-secondary">
          <Link to="/terms" className="text-primary underline">Terms of Service</Link>
          <span className="mx-2">|</span>
          <Link to="/" className="text-primary underline">Home</Link>
        </div>
      </div>
    </div>
  )
}
