import { Link } from 'react-router-dom'

/**
 * Public, no-login SMS opt-in proof page.
 *
 * This is the URL given to Twilio / carrier reviewers as the "Opt-in policy
 * proof". Carrier compliance requires that they can SEE — without creating an
 * account — exactly where a user enters their phone number AND the consent
 * disclosure shown at that point. Our real phone-entry screen lives inside the
 * authenticated onboarding flow, so this page reproduces it (the mock input +
 * the verbatim consent text) on a freely accessible route.
 *
 * Route: /sms-opt-in (registered in main.tsx, outside AuthGuard).
 */
export default function SmsOptInPage() {
  return (
    <div
      data-testid="sms-opt-in-page"
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

        <h1 className="mb-2 text-3xl font-bold text-text-primary">SMS Messaging &amp; Opt-In</h1>
        <p className="mb-8 text-sm text-text-secondary">
          How TAGO uses text messaging, and how you give (and withdraw) consent.
        </p>

        {/* ── What the signup screen looks like ─────────────────────────────
            A faithful reproduction of the phone-entry step in onboarding, so a
            reviewer can see the input field and the disclosure together. */}
        <div className="mb-10">
          <p className="mb-3 text-sm font-semibold text-text-primary">
            Where you opt in (account setup):
          </p>
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-xl font-bold text-text-primary">Verify your phone</h2>
            <p className="mb-4 text-sm text-text-secondary">
              We&apos;ll text you a 6-digit code to confirm it&apos;s really you.
            </p>

            <label htmlFor="optin-phone-demo" className="mb-1 block text-sm font-medium text-text-primary">
              Mobile number
            </label>
            <input
              id="optin-phone-demo"
              type="tel"
              inputMode="tel"
              disabled
              placeholder="(555) 123-4567"
              className="mb-4 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-text-primary"
            />

            {/* The consent disclosure shown at the point of phone entry. */}
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              By tapping &ldquo;Continue&rdquo; you agree to receive SMS text
              messages from TAGO at the number provided, including one-time
              passcodes (account verification), account security alerts, and ride
              status notifications. Message frequency varies. Message and data
              rates may apply. Reply <strong>STOP</strong> to opt out or{' '}
              <strong>HELP</strong> for help. Consent is not a condition of
              purchase. See our{' '}
              <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>{' '}
              and{' '}
              <Link to="/terms" className="text-primary underline">Terms of Service</Link>.
            </p>

            <button
              type="button"
              disabled
              className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-white opacity-90"
            >
              Continue
            </button>
            <p className="mt-3 text-center text-[11px] text-text-secondary">
              Illustration of the in-app screen — this page is for reference only.
            </p>
          </div>
        </div>

        {/* ── The written program details ──────────────────────────────────── */}
        <div className="space-y-6 text-sm leading-relaxed text-text-primary">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Program description</h2>
            <p>
              TAGO is a carpooling service for verified university students. We
              send transactional SMS messages to support your account and rides:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Phone-number verification via one-time passcodes (OTP)</li>
              <li>Account security alerts</li>
              <li>Ride status notifications</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">How you opt in</h2>
            <p>
              You opt in by entering your mobile number during account setup and
              tapping &ldquo;Continue&rdquo; on the screen shown above. This is an
              explicit, user-initiated action. Consent to receive SMS is not a
              condition of using the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Message frequency &amp; cost</h2>
            <p>
              Message frequency varies based on your activity (for example, a code
              each time you sign in, plus ride updates). <strong>Message and data
              rates may apply</strong> depending on your mobile carrier and plan.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">How to opt out (STOP) and get help (HELP)</h2>
            <p>
              You can cancel SMS messages at any time by replying{' '}
              <strong>STOP</strong> to any message from TAGO. After you send STOP,
              we will send one confirmation message and then stop sending SMS
              messages. For help, reply <strong>HELP</strong> or email us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Privacy &amp; data sharing</h2>
            <p className="font-medium">
              Mobile information will not be shared with third parties/affiliates
              for marketing/promotional purposes. All the above categories exclude
              text messaging originator opt-in data and consent; this information
              will not be shared with any third parties.
            </p>
            <p className="mt-3">
              For full details, see our{' '}
              <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>{' '}
              and{' '}
              <Link to="/terms" className="text-primary underline">Terms of Service</Link>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
