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
        <p className="mb-8 text-sm text-text-secondary">Effective Date: April 11, 2026</p>

        <div className="space-y-6 text-sm leading-relaxed text-text-primary">
          {/* 1. Introduction */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">1. Introduction</h2>
            <p>
              TAGO (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy. This
              Privacy Policy explains how we collect, use, share, and safeguard your personal
              information when you use our carpooling platform (&quot;Service&quot;). By using the
              Service, you consent to the practices described in this policy.
            </p>
          </section>

          {/* 2. Information We Collect */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">2. Information We Collect</h2>
            <p>We collect the following types of information:</p>
            <h3 className="mt-3 font-medium">Account Information</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Full name</li>
              <li>University email address (.edu)</li>
              <li>Phone number</li>
              <li>Profile photo (optional)</li>
              <li>Password (stored securely via Supabase Auth — we never store plaintext passwords)</li>
            </ul>
            <h3 className="mt-3 font-medium">Driver Information</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Vehicle details (make, model, year, color, license plate number)</li>
              <li>License plate photo (stored in a private, access-controlled storage bucket)</li>
              <li>Vehicle photo</li>
            </ul>
            <h3 className="mt-3 font-medium">Location Data</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Pickup and drop-off locations for ride requests</li>
              <li>Real-time location during active rides (for navigation and safety)</li>
            </ul>
            <h3 className="mt-3 font-medium">Payment Information</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Payment details are processed securely through Stripe. We do not store your
                credit card numbers, CVV, or full card details on our servers.
              </li>
            </ul>
            <h3 className="mt-3 font-medium">Usage Data</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>App usage patterns and feature interactions (via PostHog analytics)</li>
              <li>Device type, browser, and operating system</li>
            </ul>
          </section>

          {/* 3. How We Use Your Information */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Create and manage your account</li>
              <li>Verify your identity via email and phone (SMS verification)</li>
              <li>Match riders with nearby drivers</li>
              <li>Process ride payments and driver payouts</li>
              <li>Provide safety features, including trip sharing and emergency contacts</li>
              <li>Send push notifications about ride status and updates</li>
              <li>Improve the Service through analytics</li>
              <li>Respond to support requests</li>
            </ul>
          </section>

          {/* 4. SMS Communications — Twilio-critical */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">4. SMS Communications</h2>
            <p>
              When you provide your phone number to TAGO, we may send you SMS text messages for
              the following purposes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Phone number verification via one-time passcodes (OTP)</li>
              <li>Account security alerts</li>
              <li>Ride status notifications</li>
            </ul>
            <p className="mt-3">
              <strong>Message frequency varies.</strong> Message and data rates may apply depending
              on your mobile carrier and plan.
            </p>
            <p className="mt-3">
              You may opt out of receiving SMS messages at any time by replying{' '}
              <strong>STOP</strong> to any message received from TAGO. To get help, reply{' '}
              <strong>HELP</strong> or contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
            <p className="mt-3">
              Carriers are not liable for delayed or undelivered messages. Your consent to receive
              SMS messages is not a condition of purchasing any goods or services.
            </p>
          </section>

          {/* 5. Information Sharing */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">5. Information Sharing</h2>
            <p>We share your information only in the following circumstances:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>With other users:</strong> Riders can see the driver&apos;s name, profile
                photo, vehicle details, and real-time location during a ride. Drivers can see the
                rider&apos;s name, profile photo, and pickup location.
              </li>
              <li>
                <strong>Payment processing:</strong> Payment information is shared with Stripe to
                process transactions securely.
              </li>
              <li>
                <strong>Legal requirements:</strong> We may disclose information if required by
                law, legal process, or government request.
              </li>
              <li>
                <strong>Safety:</strong> We may share information with law enforcement if we
                believe it is necessary to prevent harm or respond to an emergency.
              </li>
            </ul>
            <p className="mt-3 font-medium">
              We do not sell, rent, or trade your personal information to third parties for
              marketing purposes.
            </p>
          </section>

          {/* 6. Data Storage & Security */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">6. Data Storage &amp; Security</h2>
            <p>
              Your data is stored securely using Supabase, which is hosted on AWS infrastructure.
              We implement industry-standard security measures including:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Row-level security (RLS) on all database tables</li>
              <li>Encrypted data transmission (HTTPS/TLS)</li>
              <li>Private storage buckets for sensitive documents (e.g., license plate photos)</li>
              <li>Secure authentication via Supabase Auth</li>
            </ul>
            <p className="mt-3">
              While we strive to protect your information, no method of electronic storage or
              transmission is 100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          {/* 7. Location Data */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">7. Location Data</h2>
            <p>
              We collect location data only when necessary for providing the Service. Location is
              used during active rides for navigation, driver matching, and safety features such
              as trip sharing. We do not continuously track your location when you are not actively
              using the Service.
            </p>
          </section>

          {/* 8. Data Retention */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">8. Data Retention</h2>
            <p>
              We retain your account information for as long as your account is active. Ride
              history and transaction records are retained for safety, dispute resolution, and
              legal compliance purposes. If you request account deletion, we will remove your
              personal data within 30 days, except where retention is required by law.
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
              <li>Opt out of analytics tracking</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{' '}
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
              The Service is not intended for users under the age of 18. We do not knowingly
              collect personal information from anyone under 18. If we become aware that we have
              collected data from a minor, we will take steps to delete that information promptly.
            </p>
          </section>

          {/* 11. Changes to This Policy */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we make changes, we will
              update the &quot;Effective Date&quot; at the top of this page. Continued use of the Service
              after changes are posted constitutes your acceptance of the updated policy.
            </p>
          </section>

          {/* 12. Contact */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">12. Contact Us</h2>
            <p>
              If you have questions or concerns about this Privacy Policy, please contact us at{' '}
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
