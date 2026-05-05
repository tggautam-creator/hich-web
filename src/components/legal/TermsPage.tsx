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
        <p className="mb-6 text-sm text-text-secondary">Effective Date: May 4, 2026</p>

        {/* Beta + unverified-ID banner — legally important, kept above the
            scroll fold so a reasonable user is on actual notice. */}
        <div className="mb-8 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed text-text-primary">
          <p className="mb-2 font-semibold text-warning">
            Beta Notice — Read Before Using
          </p>
          <p>
            TAGO is in <strong>beta / early access</strong>. You acknowledge
            and agree that during this phase TAGO does <strong>NOT</strong>:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Verify driver&apos;s licenses</li>
            <li>Verify automobile insurance coverage</li>
            <li>Verify vehicle ownership or registration</li>
            <li>Run criminal background checks on riders or drivers</li>
            <li>Verify driving history or past traffic violations</li>
            <li>
              Verify the identity of riders or drivers beyond a working{' '}
              <code>.edu</code> email address and SMS-verified phone number
            </li>
          </ul>
          <p className="mt-3">
            <strong>You assume all risk of using the Service.</strong> You
            are solely responsible for evaluating any rider or driver you
            match with. The .edu email check is an access gate; it is not
            an identity verification. Vehicle, license-plate, and profile
            information is self-reported by users and not independently
            confirmed.
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-text-primary">
          {/* 1. Acceptance */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the TAGO platform (the &quot;Service&quot;),
              you agree to be bound by these Terms of Service (the
              &quot;Terms&quot;) and our{' '}
              <Link to="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
              . If you do not agree, do not use the Service. We may update
              these Terms at any time; continued use after changes are
              posted constitutes acceptance.
            </p>
          </section>

          {/* 2. Service Description */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">2. Service Description</h2>
            <p>
              TAGO is a peer-to-peer carpooling platform designed for
              university students. <strong>TAGO is a technology
              platform</strong> that connects riders with drivers heading the
              same direction. TAGO is <strong>not</strong> a transportation
              carrier, taxi service, common carrier, or a transportation
              network company (TNC). TAGO does not own, operate, or control
              any vehicles. All rides are arranged directly between users
              of the platform.
            </p>
          </section>

          {/* 3. Eligibility */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">3. Eligibility</h2>
            <p>To use TAGO, you must:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Be at least 18 years of age (verified by self-reported date of birth)</li>
              <li>Have a valid university email address ending in <code>.edu</code></li>
              <li>Have a working US mobile phone number for SMS verification</li>
              <li>Provide accurate registration information</li>
              <li>Not be barred from using the Service under any prior suspension</li>
            </ul>
            <p className="mt-3">
              You may not use the Service on behalf of any other person or
              create more than one account.
            </p>
          </section>

          {/* 4. Account & What We Verify */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">
              4. Account &amp; What We Verify (and What We Do Not)
            </h2>
            <p>
              You are responsible for keeping your account credentials
              confidential. You must provide accurate information during
              registration including your full name, date of birth, phone
              number, and university email address.
            </p>
            <p className="mt-3">
              <strong>What TAGO currently verifies:</strong> ownership of the
              email address (via Supabase Auth&apos;s magic-link flow) and
              ownership of the phone number (via Twilio SMS OTP).
            </p>
            <p className="mt-3">
              <strong>What TAGO does not currently verify</strong> (see the
              banner at the top of these Terms for the full list): driver&apos;s
              licenses, insurance, vehicle ownership or registration, driving
              history, criminal background, or rider identity beyond the
              email/phone above. Vehicle make, model, year, color, and
              license plate are self-reported by drivers at registration and
              are not independently confirmed.
            </p>
          </section>

          {/* 5. SMS/Messaging Consent — Twilio-critical */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">5. SMS / Messaging Consent</h2>
            <p>
              By providing your phone number to TAGO, you expressly consent
              to receive SMS text messages from TAGO, including:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>One-time passcodes (OTP) for phone verification</li>
              <li>Ride status notifications</li>
              <li>Account security alerts</li>
            </ul>
            <p className="mt-3">
              <strong>Message frequency varies.</strong> Message and data
              rates may apply depending on your mobile carrier and plan.
              TAGO is not responsible for any charges incurred from your
              carrier for receiving SMS messages.
            </p>
            <p className="mt-3">
              You may opt out of non-security SMS messages at any time by
              replying <strong>STOP</strong> to any message. For help, reply{' '}
              <strong>HELP</strong> or contact us at{' '}
              <a href="mailto:support@tagorides.com" className="text-primary underline">
                support@tagorides.com
              </a>
              . Carriers are not liable for delayed or undelivered messages.
              Your consent to non-security SMS messages is not a condition
              of using the Service.
            </p>
          </section>

          {/* 6. Payments */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">6. Payments &amp; Wallet</h2>
            <p>
              Ride fares are calculated automatically based on distance and
              estimated travel time, with a $5 minimum per ride. All amounts
              are charged in US dollars. Riders may also add an optional tip
              after the ride.
            </p>
            <p className="mt-3">
              Payments are processed by <strong>Stripe</strong>. TAGO does
              not store your card number, CVV, or full Apple Pay token —
              those live with Stripe. By using the Service you also agree to
              Stripe&apos;s Terms of Service for payment processing.
            </p>
            <p className="mt-3">
              Drivers receive payouts through Stripe Connect. TAGO does not
              store your bank account details. Payouts are subject to
              Stripe&apos;s schedule and any holds Stripe places for risk or
              compliance reasons.
            </p>
            <p className="mt-3">
              TAGO operates a wallet feature: balances, top-ups, ride
              charges, tips, and withdrawals are tracked in your account so
              you can review activity. Wallet balances are not a deposit
              account, are not insured, and do not earn interest.
            </p>
          </section>

          {/* 7. Driver Responsibilities */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">7. Driver Responsibilities</h2>
            <p>If you register as a driver, you represent and warrant that you:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Hold a valid, unsuspended driver&apos;s license</li>
              <li>
                Maintain automobile liability insurance that meets or exceeds
                the minimum required by the laws of your state and that
                covers your use of the vehicle for ridesharing arrangements
              </li>
              <li>Are the legal owner or authorized operator of the vehicle</li>
              <li>Operate a safe, roadworthy vehicle in compliance with all applicable laws</li>
              <li>
                Will not drive while impaired by alcohol, drugs, or any
                other substance
              </li>
              <li>Will not engage in distracted driving while a rider is in the vehicle</li>
              <li>
                Acknowledge that TAGO does not currently verify any of the
                above and that you are personally responsible for compliance
              </li>
              <li>
                Acknowledge that personal automobile insurance policies may
                not cover ridesharing activity — you are solely responsible
                for confirming coverage with your insurance carrier
              </li>
            </ul>
          </section>

          {/* 8. Rider Responsibilities */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">8. Rider Responsibilities</h2>
            <p>As a rider, you agree to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Provide accurate pickup and drop-off locations</li>
              <li>Be at the pickup location at the agreed time</li>
              <li>Treat drivers with respect and follow reasonable vehicle rules</li>
              <li>Wear a seatbelt at all times during the ride</li>
              <li>Not engage in any behavior that could distract the driver or damage the vehicle</li>
              <li>
                Not bring weapons, illegal substances, or hazardous
                materials into the vehicle
              </li>
              <li>
                Acknowledge that drivers are independent peers, not employees
                of TAGO, and that TAGO has not vetted the driver&apos;s
                license, insurance, vehicle, or background
              </li>
            </ul>
          </section>

          {/* 9. Safety */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">9. Safety</h2>
            <p>
              TAGO offers in-app safety tools including: an emergency button,
              trip sharing with trusted contacts, real-time location tracking
              during the ride, QR-code start/end verification, and a
              post-ride reporting flow. These are tools to help you make
              safer decisions; they are <strong>not</strong> a guarantee of
              safety, and TAGO is not liable for any incidents, accidents,
              injuries, deaths, or damages that occur during, before, or
              after rides arranged through the platform. In an emergency
              call <strong>911</strong> immediately — do not rely on the
              app alone.
            </p>
          </section>

          {/* 10. Assumption of Risk */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">10. Assumption of Risk</h2>
            <p>
              You acknowledge that carpooling with a stranger involves
              inherent risks, including but not limited to risks of physical
              injury, property damage, theft, harassment, fraud, or vehicle
              accidents. You voluntarily assume all such risks. You agree
              that you are solely responsible for evaluating the trip, the
              vehicle, and the other party before, during, and after each
              ride.
            </p>
          </section>

          {/* 11. Limitation of Liability */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">11. Limitation of Liability</h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS
              OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES
              OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              NON-INFRINGEMENT, OR THAT THE SERVICE WILL BE UNINTERRUPTED,
              SECURE, OR ERROR-FREE. TO THE FULLEST EXTENT PERMITTED BY LAW,
              TAGO AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND
              AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
              INCLUDING WITHOUT LIMITATION DAMAGES FOR LOSS OF PROFITS,
              GOODWILL, USE, DATA, OR OTHER INTANGIBLE LOSSES, ARISING OUT
              OF OR RELATED TO YOUR USE OF, OR INABILITY TO USE, THE SERVICE
              — INCLUDING ANY ACT OR OMISSION OF ANOTHER USER OF THE
              SERVICE — EVEN IF TAGO HAS BEEN ADVISED OF THE POSSIBILITY OF
              SUCH DAMAGES.
            </p>
            <p className="mt-3">
              IN NO EVENT SHALL TAGO&apos;S TOTAL AGGREGATE LIABILITY FOR ANY
              CLAIM ARISING FROM OR RELATED TO THE SERVICE EXCEED THE
              GREATER OF (a) THE AMOUNT YOU PAID DIRECTLY TO TAGO IN THE
              TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (b) ONE HUNDRED
              US DOLLARS ($100). Some jurisdictions do not allow the
              exclusion or limitation of certain damages; in those
              jurisdictions our liability is limited to the maximum extent
              permitted by law.
            </p>
          </section>

          {/* 12. Indemnification */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">12. Indemnification</h2>
            <p>
              You agree to defend, indemnify, and hold harmless TAGO and its
              officers, directors, employees, agents, and affiliates from
              and against any claims, liabilities, damages, losses, and
              expenses (including reasonable attorneys&apos; fees) arising
              out of or in any way connected with: (a) your access to or
              use of the Service; (b) your violation of these Terms; (c)
              your violation of any third-party right, including without
              limitation any intellectual property, privacy, or property
              right; (d) any incident, accident, injury, or damage that
              occurs during a ride you participate in; or (e) any claim
              that your use of the Service caused damage to a third party.
            </p>
          </section>

          {/* 13. Pilot / Beta Disclaimer */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">13. Pilot / Beta Status</h2>
            <p>
              TAGO is currently in early access / pilot stage. By using the
              Service you acknowledge and agree that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>The Service is under active development and may contain bugs or errors</li>
              <li>Features may be added, modified, or removed without prior notice</li>
              <li>The Service may be temporarily or permanently discontinued at any time</li>
              <li>Availability is limited to select geographic areas and may change</li>
              <li>
                Identity, license, insurance, and vehicle verification are
                <strong> not</strong> currently performed (see the banner at
                the top of these Terms)
              </li>
              <li>
                TAGO makes no guarantees regarding uptime, reliability,
                accuracy, or availability during this pilot period
              </li>
            </ul>
          </section>

          {/* 14. Prohibited Conduct */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">14. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use the Service for any unlawful purpose</li>
              <li>Impersonate another person or misrepresent your affiliation with any institution</li>
              <li>Harass, threaten, defame, or harm other users</li>
              <li>Attempt unauthorized access to the Service or its systems</li>
              <li>Use the Service to operate a commercial taxi or transportation business</li>
              <li>Reverse-engineer, decompile, or otherwise attempt to derive the source code</li>
              <li>Use bots, scrapers, or other automated means to access the Service</li>
              <li>Attempt to manipulate ratings, decline reasons, or other feedback signals</li>
            </ul>
          </section>

          {/* 15. Termination */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">15. Termination</h2>
            <p>
              TAGO may suspend or terminate your account at any time, with
              or without cause, and with or without notice, including for
              violation of these Terms or for conduct we determine in our
              sole discretion to be harmful to other users or the Service.
              You may delete your account at any time via Settings →
              Account → Delete account or by contacting support. Sections
              that by their nature should survive termination (including
              Sections 9 through 14, 16, and 17) will so survive.
            </p>
          </section>

          {/* 16. Governing Law & Disputes */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">
              16. Governing Law &amp; Dispute Resolution
            </h2>
            <p>
              These Terms are governed by the laws of the State of California
              and applicable US federal law, without regard to conflict of
              laws principles. Any dispute arising from or related to the
              Service or these Terms will first be addressed via good-faith
              negotiation between the parties. If unresolved within 30
              days, the dispute will be resolved by binding individual
              arbitration administered by a recognized arbitration provider,
              except that either party may bring an individual action in
              small-claims court for any qualifying claim.
            </p>
            <p className="mt-3">
              <strong>Class action waiver.</strong> To the fullest extent
              permitted by law, you and TAGO each waive any right to assert
              claims against the other as a representative or member in any
              class or representative action.
            </p>
          </section>

          {/* 17. Severability + Misc */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">17. Miscellaneous</h2>
            <p>
              If any provision of these Terms is found to be unenforceable,
              the remaining provisions will remain in full force and effect.
              Failure by TAGO to enforce any right is not a waiver of that
              right. These Terms (together with the Privacy Policy) are the
              entire agreement between you and TAGO regarding the Service.
              You may not assign these Terms; TAGO may assign them in
              connection with a merger, acquisition, or sale of assets.
            </p>
          </section>

          {/* 18. Contact */}
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">18. Contact Us</h2>
            <p>
              Questions about these Terms can be sent to{' '}
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
