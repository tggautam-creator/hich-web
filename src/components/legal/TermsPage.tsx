import { Link } from 'react-router-dom'

export default function TermsPage() {
  return (
    <div
      data-testid="terms-page"
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

        <h1 className="mb-2 text-3xl font-bold text-text-primary">Terms of Service</h1>
        <p className="mb-8 text-sm text-text-secondary">Effective Date: April 11, 2026</p>

        <div className="space-y-6 text-sm leading-relaxed text-text-primary">
          {/* 1. Acceptance */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the TAGO platform (&quot;Service&quot;), you agree to be bound by these
              Terms of Service (&quot;Terms&quot;). If you do not agree, do not use the Service. We may update
              these Terms at any time; continued use after changes constitutes acceptance.
            </p>
          </section>

          {/* 2. Service Description */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">2. Service Description</h2>
            <p>
              TAGO is a peer-to-peer carpooling platform designed for university students. TAGO is a
              technology platform that connects riders with drivers — TAGO does not provide
              transportation services and is not a transportation carrier. All rides are arranged
              directly between users of the platform.
            </p>
          </section>

          {/* 3. Eligibility */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">3. Eligibility</h2>
            <p>To use TAGO, you must:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Be at least 18 years of age</li>
              <li>Have a valid university email address (.edu)</li>
              <li>Provide accurate and complete registration information</li>
            </ul>
          </section>

          {/* 4. Account & Verification */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">4. Account &amp; Verification</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials.
              You must provide accurate information during registration, including your full name,
              phone number, and university email address. TAGO may verify your identity through
              email and phone verification.
            </p>
          </section>

          {/* 5. SMS/Messaging Consent — Twilio-critical */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">5. SMS/Messaging Consent</h2>
            <p>
              By providing your phone number to TAGO, you expressly consent to receive SMS text
              messages from TAGO, including but not limited to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>One-time passcodes (OTP) for phone number verification</li>
              <li>Ride status notifications</li>
              <li>Account security alerts</li>
            </ul>
            <p className="mt-3">
              <strong>Message frequency varies.</strong> Message and data rates may apply depending
              on your mobile carrier and plan. TAGO is not responsible for any charges incurred
              from your carrier for receiving SMS messages.
            </p>
            <p className="mt-3">
              You may opt out of SMS messages at any time by replying <strong>STOP</strong> to any
              message. For help, reply <strong>HELP</strong> or contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
            <p className="mt-3">
              Carriers are not liable for delayed or undelivered messages. SMS consent is not a
              condition of purchase or use of the Service, except where phone verification is
              required for account security.
            </p>
          </section>

          {/* 6. Payments */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">6. Payments</h2>
            <p>
              Ride fares are calculated based on distance and estimated travel time, with a $5
              minimum per ride. All amounts are displayed and charged in US dollars. Payments are
              processed securely through Stripe — TAGO does not store your credit card information.
              By using the Service, you agree to Stripe&apos;s terms and conditions for payment
              processing.
            </p>
          </section>

          {/* 7. Driver Responsibilities */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">7. Driver Responsibilities</h2>
            <p>If you register as a driver, you represent and warrant that you:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Hold a valid driver&apos;s license</li>
              <li>Maintain adequate automobile insurance as required by law</li>
              <li>Operate a safe, roadworthy vehicle</li>
              <li>Comply with all applicable traffic laws and regulations</li>
              <li>Will not operate the vehicle under the influence of drugs or alcohol</li>
            </ul>
          </section>

          {/* 8. Rider Responsibilities */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">8. Rider Responsibilities</h2>
            <p>As a rider, you agree to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Provide accurate pickup and drop-off locations</li>
              <li>Be at the pickup location at the agreed time</li>
              <li>Treat drivers and other riders with respect</li>
              <li>Wear a seatbelt at all times during the ride</li>
              <li>Not engage in any behavior that could distract the driver</li>
            </ul>
          </section>

          {/* 9. Safety */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">9. Safety</h2>
            <p>
              TAGO provides safety features including an in-app emergency button and trip sharing
              with trusted contacts. However, TAGO does not guarantee the safety of any ride and
              is not liable for any incidents, accidents, injuries, or damages that occur during
              rides arranged through the platform. In case of emergency, contact local emergency
              services (911) immediately.
            </p>
          </section>

          {/* 10. Limitation of Liability */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">10. Limitation of Liability</h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
              EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, TAGO SHALL NOT
              BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
              DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE.
            </p>
            <p className="mt-3">
              TAGO&apos;s total liability for any claim arising from the Service shall not exceed the
              amount you paid to TAGO in the twelve (12) months preceding the claim.
            </p>
          </section>

          {/* 11. Pilot / Beta Disclaimer */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">11. Pilot Program &amp; Early Access</h2>
            <p>
              TAGO is currently in an early access / pilot stage. By using the Service, you
              acknowledge and agree that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>The Service is under active development and may contain bugs or errors</li>
              <li>Features may be added, modified, or removed without prior notice</li>
              <li>The Service may be temporarily or permanently discontinued at any time</li>
              <li>Availability is limited to select geographic areas and may change</li>
              <li>
                TAGO makes no guarantees regarding uptime, reliability, or availability
                during this pilot period
              </li>
            </ul>
          </section>

          {/* 12. Prohibited Conduct */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">12. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use the Service for any unlawful purpose</li>
              <li>Impersonate another person or misrepresent your identity</li>
              <li>Harass, threaten, or harm other users</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Use the Service for commercial transportation (e.g., operating as a taxi)</li>
            </ul>
          </section>

          {/* 13. Termination */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">13. Termination</h2>
            <p>
              TAGO may suspend or terminate your account at any time, with or without cause, and
              with or without notice. You may delete your account at any time by contacting
              support. Upon termination, your right to use the Service ceases immediately.
            </p>
          </section>

          {/* 14. Governing Law */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">14. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              United States. Any disputes arising from these Terms or the Service shall be
              resolved through binding arbitration, except where prohibited by law.
            </p>
          </section>

          {/* 15. Contact */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">15. Contact Us</h2>
            <p>
              If you have questions about these Terms, please contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              .
            </p>
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-10 border-t border-border pt-6 text-center text-xs text-text-secondary">
          <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>
          <span className="mx-2">|</span>
          <Link to="/" className="text-primary underline">Home</Link>
        </div>
      </div>
    </div>
  )
}
