# HICH — Product Requirements Document (PRD)
**Version:** 2.1 | **Last Updated:** March 2026 | **Status:** Active

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User Personas](#2-user-personas)
3. [Feature Requirements](#3-feature-requirements)
   - 3.1 [User Registration & Authentication](#31-user-registration--authentication)
   - 3.2 [Driver Onboarding](#32-driver-onboarding)
   - 3.3 [Trip Scheduling](#33-trip-scheduling)
   - 3.4 [Rider — Ride Now Flow](#34-rider--ride-now-flow)
   - 3.5 [Driver Notification & Acceptance](#35-driver-notification--acceptance)
   - 3.6 [Dropoff Negotiation & Transit Integration](#36-dropoff-negotiation--transit-integration)
   - 3.7 [Multiple Driver Scenario](#37-multiple-driver-scenario)
   - 3.8 [Pickup Coordination](#38-pickup-coordination)
   - 3.9 [Active Ride](#39-active-ride)
   - 3.10 [Ride End & Payment](#310-ride-end--payment)
   - 3.11 [Ratings & Post-Ride](#311-ratings--post-ride)
   - 3.12 [Wallet](#312-wallet)
   - 3.13 [Safety Features](#313-safety-features)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Out of Scope for MVP](#5-out-of-scope-for-mvp)
6. [Open Questions](#6-open-questions)
7. [AI Matching — Implementation Stages](#7-ai-matching--implementation-stages)
8. [Development Rules & Tooling](#8-development-rules--tooling)

---

## 1. Product Overview

### What HICH Is

HICH is an AI-powered carpooling platform for university students. It removes the biggest barrier to driver participation — the need to manually post every ride — by predicting where drivers are going and proactively suggesting riders heading in the same direction.

### Core Differentiator

Every other carpooling app requires the driver to initiate. HICH works in reverse: the rider requests, and AI finds the driver. Drivers set their routine once and receive ride suggestions automatically. The more they use it, the smarter the matching becomes.

### Who It's For

University students verified via `.edu` email. Initial market: UC Davis students traveling the Davis ↔ Bay Area corridor.

### What We Are Testing in This MVP

> **Core hypothesis:** If we remove the effort of posting rides from drivers entirely, significantly more drivers will participate — and that increased supply will make near-instant intercity carpooling viable for riders.

---

## 2. User Personas

### Persona A — The Commuter Driver
- **Name:** Ahmed, 22, UC Davis senior
- **Situation:** Drives to the Bay Area 2–3 times per week for an internship
- **Pain today:** Spends $60–80/month on fuel. Has tried posting rides on Facebook groups but it takes too long and people cancel last minute.
- **What HICH does for them:** Learns their routine automatically. Sends a notification when a rider needs a lift on the same route. Ahmed earns $20–30 per trip without changing anything about how he drives.
- **Critical need:** Must trust that the rider is safe and that coordination is fast. Cannot spend more than 2 minutes per ride on logistics.

### Persona B — The Student Rider
- **Name:** Maya, 20, UC Davis sophomore
- **Situation:** Needs to get home to the Bay Area every other weekend. Amtrak is slow, Uber is $60+.
- **Pain today:** Posts in Davis Facebook groups hoping a driver sees it in time. Often plans 3+ days ahead.
- **What HICH does for them:** Opens the app, types destination, and within minutes a verified driver heading that direction accepts. Pays $12–18 instead of $60.
- **Critical need:** Needs to know the dropoff point works for them before committing. Must be able to reach their final destination after being dropped off.

### Persona C — The Flexible Driver/Rider
- **Name:** Jordan, 21, UC Davis junior
- **Situation:** Has a car and sometimes drives to SF, sometimes needs a ride back.
- **Pain today:** Uses both Uber and Lyft depending on direction. Spending $150+/month on transport.
- **What HICH does for them:** One app handles both directions. Earning as a driver partially offsets their spending as a rider.

---

## 3. Feature Requirements

---

### 3.1 User Registration & Authentication

#### Overview
All users register with a `.edu` email to establish a trusted, university-verified community. No separate home/work address is collected during signup — location permissions replace this.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REG-01 | User can enter an email address on the signup screen | Must Have |
| REG-02 | System validates in real-time that the email ends in `.edu` — shows a green checkmark if valid, red error if not | Must Have |
| REG-03 | Non-.edu emails cannot proceed past this screen | Must Have |
| REG-04 | Supabase sends a magic link to the verified email | Must Have |
| REG-05 | User is redirected into the app after clicking the magic link | Must Have |
| REG-06 | User provides: full name, phone number, profile photo, password | Must Have |
| REG-07 | User grants location permissions during signup (required for ride matching) | Must Have |
| REG-08 | Location permissions prompt explains why it is needed: "We use your location to find drivers heading your way" | Must Have |
| REG-09 | User selects mode: Rider / Driver / Both | Must Have |
| REG-10 | Sessions persist across app restarts via Supabase JWT refresh | Must Have |

#### Notes
- Home and work address are **not** collected at registration. The AI engine learns destinations from trip history.
- Profile photo is optional at signup but drivers are nudged to add one before their first accepted ride.

---

### 3.2 Driver Onboarding

#### Overview
Drivers complete a vehicle registration step after mode selection. This is more rigorous than the rider flow to establish safety and accountability.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| DRV-01 | Driver enters: VIN number, car make, car model, year | Must Have |
| DRV-02 | Driver enters: license plate number | Must Have |
| DRV-03 | Driver selects car color from a swatch picker (10 common colors) | Must Have |
| DRV-04 | Driver uploads or takes a photo of their car | Must Have |
| DRV-05 | Driver uploads a photo of their driver's license | Must Have |
| DRV-06 | Driver selects number of seats available for riders (1–4 stepper) | Must Have |
| DRV-07 | On completion, system generates a unique QR code for this driver | Must Have |
| DRV-08 | System confirms: "Your vehicle has been registered" | Must Have |
| DRV-09 | Driver QR code is accessible from their profile and the active ride screen at any time | Must Have |

#### Notes
- License photo is stored securely and never shown to riders. It is used for identity verification only.
- VIN enables future background check integration (Phase 3).

---

### 3.3 Trip Scheduling

#### Overview
Both drivers and riders can proactively schedule trips rather than waiting for real-time matching. Scheduled trips feed the AI engine and allow advance notifications to be sent to matching users.

This is one of the most important differentiating features. A driver who schedules their Monday commute will automatically receive notifications whenever a rider needs a lift on that route at that time — without any manual effort after setup.

#### 3.3.1 — Schedule Page (Both Driver and Rider)

| ID | Requirement | Priority |
|----|-------------|----------|
| SCH-01 | Schedule button is visible on both the rider and driver home screens | Must Have |
| SCH-02 | Schedule page asks: "Where do you usually travel?" | Must Have |
| SCH-03 | User enters a route tag name (e.g. "Home to SF") for easy reference | Must Have |
| SCH-04 | User enters a From location and a To location using address autocomplete | Must Have |
| SCH-05 | User selects direction type: One-way or Roundtrip | Must Have |
| SCH-06 | User is asked: "Is this a one-time trip or part of your routine?" with two options | Must Have |

#### 3.3.2 — One-Time Trip Path

| ID | Requirement | Priority |
|----|-------------|----------|
| SCH-07 | User selects a specific date via a date picker | Must Have |
| SCH-08 | User selects a departure time or arrival time via a time picker | Must Have |
| SCH-09 | On confirmation, system sends notifications to eligible matching users at the scheduled time | Must Have |
| SCH-10 | One-time trip appears in the user's scheduled trips list until it departs | Must Have |

#### 3.3.3 — Recurring Routine Path

| ID | Requirement | Priority |
|----|-------------|----------|
| SCH-11 | User sees 7 day pills (Sun, Mon, Tue, Wed, Thu, Fri, Sat) | Must Have |
| SCH-12 | Tapping a day pill opens a time picker for that day | Must Have |
| SCH-13 | Time picker asks for departure time OR arrival time, with a toggle | Must Have |
| SCH-14 | Each day can have its own departure/arrival time | Must Have |
| SCH-15 | User taps Save after setting times for all relevant days | Must Have |
| SCH-16 | Routine is saved to `driver_routines` table and feeds the AI matching engine | Must Have |
| SCH-17 | User can view, pause, and delete saved routines from their profile | Must Have |
| SCH-18 | When a matching user appears, system notifies the routine owner | Must Have |

#### Notes
- Driver routines also function as implicit AI training data. The more routines saved, the faster the prediction model reaches useful accuracy.
- Riders who schedule routines allow the system to give drivers advance notice of upcoming demand on a route.

---

### 3.4 Rider — Ride Now Flow

#### Overview
The immediate ride request flow for riders who need a ride right now.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| RDR-01 | Rider home screen shows a full-screen map with the rider's current GPS location | Must Have |
| RDR-02 | A prominent search bar overlay allows the rider to type a destination | Must Have |
| RDR-03 | Destination input uses Google Places autocomplete | Must Have |
| RDR-04 | Recent destinations are shown below the input for one-tap repeat | Should Have |
| RDR-05 | On destination confirmed, system calls the backend ride request endpoint | Must Have |
| RDR-06 | **Stage 1 (ship first):** Notify ALL registered drivers with `is_driver=true` — no filtering. **Stage 2 (upgrade same week):** Filter to drivers within 15km using PostGIS `ST_DWithin`. **Stage 3 (only if driver has a saved route):** Also filter by bearing — driver's `destination_bearing` must be within 60 degrees of the rider's destination bearing. If a driver has no saved route, always fall back to Stage 2 only. See Section 7 for full staging rules. | Must Have |
| RDR-07 | Push notifications are sent to all eligible matching drivers simultaneously | Must Have |
| RDR-08 | Rider sees a Waiting Room screen with a fare range estimate while drivers are notified | Must Have |
| RDR-09 | Rider can cancel from the Waiting Room at any time with no penalty | Must Have |
| RDR-10 | Waiting Room updates in real-time via Supabase Realtime subscription | Must Have |

#### Direction Matching Definition
See **Section 7** for the full staged implementation strategy. Summary: Stage 1 notifies all drivers (ship this first). Stage 2 adds a 15km radius filter. Stage 3 adds bearing-based direction matching — but **only when the driver has a saved route**. If a driver has no saved route, always fall back to Stage 2. Never fake direction matching.

---

### 3.5 Driver Notification & Acceptance

#### Overview
When a rider requests a ride, matching drivers receive a push notification. The driver can review the full ride details, optionally adjust the drop-off and pickup points, then accept or decline.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NOT-01 | Push notification shows: rider name, destination, distance to rider, estimated earnings | Must Have |
| NOT-02 | Tapping the notification opens a full Ride Detail View | Must Have |
| NOT-03 | Ride Detail View shows: full rider profile, star rating, route preview on map | Must Have |
| NOT-04 | Driver can optionally change the drop-off location before accepting | Must Have |
| NOT-05 | Driver can optionally adjust the pickup pin before accepting | Must Have |
| NOT-06 | Driver taps Accept or Decline | Must Have |
| NOT-07 | If driver does not respond within 90 seconds, the notification auto-expires | Must Have |
| NOT-08 | On decline or timeout, the next eligible driver in the queue receives a notification | Must Have |
| NOT-09 | On decline, driver is returned to their home screen with no penalty (first time) | Must Have |
| NOT-10 | On accept, rider is notified instantly via Supabase Realtime | Must Have |

---

### 3.6 Dropoff Negotiation & Transit Integration

#### Overview
One of HICH's most distinctive features. When a driver accepts, before the ride is confirmed, a messaging window opens showing the rider the driver's chosen drop-off point along with public transit options available from that point. This allows the rider to make an informed decision about whether the drop-off works for their final destination.

This solves a real pain point: riders don't get dropped exactly where they want to go, but if the drop-off is near good transit, it's still a great deal.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| TRN-01 | After driver accepts, a messaging window opens automatically for the rider | Must Have |
| TRN-02 | Messaging window shows the driver's chosen drop-off point on a map | Must Have |
| TRN-03 | Messaging window shows nearby public transit options from the drop-off point | Must Have |
| TRN-04 | Transit options include: bus stops, BART stations, Caltrain stations, light rail — whichever are within reasonable walking distance | Must Have |
| TRN-05 | For each transit option, show the estimated total travel time from drop-off to rider's final destination | Must Have |
| TRN-06 | Rider sees a clear Accept or Decline button for the drop-off | Must Have |
| TRN-07 | If rider accepts the drop-off, fare calculation begins and both move to Pickup Coordination | Must Have |
| TRN-08 | If rider declines the drop-off, they are returned to the Waiting Room to wait for another driver | Must Have |
| TRN-09 | Driver is notified if the rider declines their drop-off | Must Have |
| TRN-10 | Rider and driver can chat within the messaging window | Must Have |
| TRN-11 | Driver can change their drop-off selection from within the messaging window before rider confirms | Should Have |

#### Transit Data Source
Use the Google Places API "transit" type search to find nearby stations and stops. For ETA calculation, use the Google Maps Directions API with `mode=transit` from the drop-off point to the rider's final destination.

#### Notes
- The drop-off point the driver selects should ideally be at or near a transit hub. The UI should guide drivers toward selecting locations near BART stations, bus stops, or train stations — not random points on their route.
- This feature is what makes a driver's detour limitation irrelevant to the rider. "I'll drop you at Embarcadero BART" is a complete solution, not a compromise.

---

### 3.7 Multiple Driver Scenario

#### Overview
When multiple drivers accept a ride request simultaneously, the rider should not be forced to accept whoever responded first. They should be able to compare options and choose the driver whose route, drop-off, and timing works best for them.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MLT-01 | When more than one driver accepts, rider sees a map window instead of the single-driver messaging window | Must Have |
| MLT-02 | Map shows all accepting drivers as icons with their live positions | Must Have |
| MLT-03 | Each driver's icon is tappable to reveal their ride details card | Must Have |
| MLT-04 | Ride details card shows: driver profile, car info, their proposed drop-off, ETA, estimated fare | Must Have |
| MLT-05 | Rider selects one driver to proceed with | Must Have |
| MLT-06 | On selection, a chat window opens between rider and chosen driver to coordinate | Must Have |
| MLT-07 | All other accepting drivers are notified that the ride has been taken | Must Have |
| MLT-08 | All other accepting drivers are released — they do not receive a penalty | Must Have |
| MLT-09 | After chatting, both rider and driver confirm to move to Pickup Coordination | Must Have |

#### Notes
- This scenario is relatively rare in the MVP (most routes will have 0–1 accepting drivers) but becomes common at scale. Building it correctly now prevents a painful refactor later.
- The map-with-multiple-drivers view is the same technical component as the driver home map. Build it once, reuse it.

---

### 3.8 Pickup Coordination

#### Overview
After the ride is confirmed, both users need to physically meet. The app calculates an optimal intercept point on the driver's route nearest to the rider's current location, constrainted by a maximum 5-minute walk time for the rider.

#### 3.8.1 — Driver Screen

| ID | Requirement | Priority |
|----|-------------|----------|
| PKP-01 | Driver sees a full-screen map with their current position, the rider's position, and a suggested pickup pin | Must Have |
| PKP-02 | Pickup pin is the calculated intercept point on the driver's route closest to the rider | Must Have |
| PKP-03 | Driver can drag the pin to adjust it | Must Have |
| PKP-04 | Pin cannot be dragged to a location that would require the rider to walk more than 5 minutes | Must Have |
| PKP-05 | Driver sees the rider's estimated walk time to the current pin position, updating live as pin is moved | Must Have |
| PKP-06 | Driver can add an optional note for the rider (e.g. "Blue Honda, near the ATM") | Must Have |
| PKP-07 | Driver taps CONFIRM PICKUP to send the pin to the rider | Must Have |
| PKP-08 | If driver does not confirm within 90 seconds, they receive a nudge notification | Must Have |
| PKP-09 | After 3 minutes with no confirmation, ride auto-cancels (no penalty on first occurrence) | Must Have |
| PKP-10 | After confirming, driver's screen shows navigation button to open Maps to the pin | Must Have |
| PKP-11 | Driver sees rider's live ETA to the pickup point, updating as rider walks | Must Have |
| PKP-12 | Chat button is visible and accessible throughout coordination | Must Have |

#### 3.8.2 — Rider Screen

| ID | Requirement | Priority |
|----|-------------|----------|
| PKP-13 | Rider sees a walking route on the map from their current location to the pickup pin | Must Have |
| PKP-14 | Rider sees the pickup address in large readable text | Must Have |
| PKP-15 | Any note added by the driver is shown prominently below the address | Must Have |
| PKP-16 | Rider sees walk distance and estimated walk time (e.g. "350m · 4 min walk") | Must Have |
| PKP-17 | Rider sees the driver's live ETA to the pickup point | Must Have |
| PKP-18 | Driver's ETA is shown in red if the driver will arrive before the rider's walk is complete — urgency signal | Should Have |
| PKP-19 | Rider sees driver's car color and license plate in large text | Must Have |
| PKP-20 | A "Signal Driver" button sends a push notification to the driver: "Your rider is at the pickup point" | Must Have |
| PKP-21 | When rider is within 100m of the pin, a green pulse animation appears and "You're almost there!" replaces the walk distance | Should Have |
| PKP-22 | When rider is within 100m, a bottom sheet slides up priming them to scan the QR code | Must Have |
| PKP-23 | Pin coordinates update on rider's screen the instant driver confirms — no refresh needed | Must Have |

---

### 3.9 Active Ride

#### Overview
Both users' in-ride experience from QR scan start to QR scan end.

#### Ride Start Trigger
Rider opens camera and scans the QR code displayed on the driver's phone. This single action:
1. Validates the driver QR code against the database
2. Starts the ride timer
3. Starts the fare meter at $0
4. Transitions both screens to the Active Ride view

#### 3.9.1 — Driver Active Ride Screen

| ID | Requirement | Priority |
|----|-------------|----------|
| RDE-01 | Screen shows a pulsing red LIVE badge and a live ride timer (HH:MM:SS) | Must Have |
| RDE-02 | Full-screen map showing current position and route to the agreed drop-off | Must Have |
| RDE-03 | Navigate button opens Apple Maps or Google Maps with directions to the drop-off | Must Have |
| RDE-04 | Live fare meter counts up in real-time (driver's earnings view) | Must Have |
| RDE-05 | Show QR button expands driver's QR code full-screen for rider to scan at end | Must Have |
| RDE-06 | Chat button with unread badge for in-ride messaging | Must Have |
| RDE-07 | ETA to drop-off | Must Have |
| RDE-08 | Emergency button — visible at all times, never hidden in a menu | Must Have |
| RDE-09 | END RIDE button at bottom — tapping displays "Rider must scan QR to end the ride" | Must Have |
| RDE-10 | Driver cannot unilaterally end a ride and trigger payment — QR scan by rider is required | Must Have |

#### 3.9.2 — Rider Active Ride Screen

| ID | Requirement | Priority |
|----|-------------|----------|
| RDE-11 | Screen shows a green RIDING badge | Must Have |
| RDE-12 | Map shows current position (moving), route, and drop-off flag marker | Must Have |
| RDE-13 | Scan QR to End is the primary CTA (highlighted blue, prominent) | Must Have |
| RDE-14 | Live fare meter counting up (rider's cost view) | Must Have |
| RDE-15 | ETA to rider's stop with a countdown progress bar | Must Have |
| RDE-16 | Transit info for onward journey shown below ETA | Should Have |
| RDE-17 | Chat button with unread badge | Must Have |
| RDE-18 | Change Dropoff option — sends a request to the driver who must accept it | Should Have |
| RDE-19 | Emergency button — visible at all times, never hidden | Must Have |
| RDE-20 | Share live location button — one tap to send live GPS to a contact outside the app | Must Have |
| RDE-21 | Rider does NOT have an End Ride button — only Scan QR | Must Have |

---

### 3.10 Ride End & Payment

#### Overview
The ride ends when the rider scans the driver's QR code a second time. This single scan simultaneously ends the ride and triggers payment — the QR scan is consent, confirmation, and payment trigger in one action.

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PAY-01 | Second QR scan by rider triggers ride end | Must Have |
| PAY-02 | Backend calculates final fare: base fare + (distance_km × per_km_rate) + (duration_min × per_min_rate) | Must Have |
| PAY-03 | Fare is stored in cents (integer) to avoid floating point errors | Must Have |
| PAY-04 | Platform fee (15%) is deducted from total fare | Must Have |
| PAY-05 | Rider's `wallet_balance` is debited by the full fare amount | Must Have |
| PAY-06 | Driver's `wallet_balance` is credited by (fare − platform fee) | Must Have |
| PAY-07 | Both wallet changes and a transaction record are written atomically (database transaction) | Must Have |
| PAY-08 | If rider's wallet balance is insufficient, ride cannot start — wallet top-up is required first | Must Have |
| PAY-09 | Both users see the End of Ride summary screen immediately after payment | Must Have |

#### Fare Formula
```
fare = base_fare + (distance_km × 0.18) + (duration_min × 0.05)
minimum_fare = $2.00
maximum_fare = $40.00 (MVP cap)
platform_fee = fare × 0.15
driver_earns = fare − platform_fee
```
All amounts stored in cents. Display in dollars.

---

### 3.11 Ratings & Post-Ride

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| RAT-01 | End of Ride screen shows: route thumbnail map, distance, duration, fare breakdown, driver net earnings | Must Have |
| RAT-02 | Both users are prompted to rate each other (1–5 stars) | Must Have |
| RAT-03 | Ratings are blind — neither user sees the other's rating until both have submitted | Must Have |
| RAT-04 | After selecting a star rating, user sees quick-select tags (positive tags for 4–5 stars, issue tags for 1–3 stars) | Should Have |
| RAT-05 | An optional free-text comment field is shown for ratings of 3 stars or below | Should Have |
| RAT-06 | Ratings can be skipped | Must Have |
| RAT-07 | "Report an issue" link is available on the post-ride screen | Must Have |
| RAT-08 | Report categories: overcharged, no-show, unsafe behavior, wrong route, other | Must Have |
| RAT-09 | User's average rating is recalculated after each submission | Must Have |
| RAT-10 | Completed trip is logged to `driver_routines` table to improve AI predictions | Must Have |

---

### 3.12 Wallet

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| WAL-01 | Wallet screen shows current balance in dollars | Must Have |
| WAL-02 | Transaction history shows all credits and debits with ride reference | Must Have |
| WAL-03 | Add Funds screen integrates Stripe's CardElement | Must Have |
| WAL-04 | Amount options: $10, $20, $50, or custom input | Must Have |
| WAL-05 | Apple Pay and Google Pay are supported via Stripe | Should Have |
| WAL-06 | Rider cannot request a ride if wallet balance is below the minimum fare | Must Have |
| WAL-07 | Driver can request a payout of their wallet balance via Stripe Connect | Should Have (Phase 2) |
| WAL-08 | All transactions are processed in Stripe test mode for the entire MVP beta | Must Have |

---

### 3.13 Safety Features

#### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| SAF-01 | Emergency button is visible on all active ride screens at all times — never in a menu, never behind a tap | Must Have |
| SAF-02 | Tapping Emergency shows three options: Call 911, Share live location, Report unsafe situation | Must Have |
| SAF-03 | "Share live location" generates a link the user can send to any contact outside the app | Must Have |
| SAF-04 | All users are `.edu` verified — this is the primary trust layer | Must Have |
| SAF-05 | Driver's license photo is stored for identity verification | Must Have |
| SAF-06 | Users can report a ride from the post-ride screen | Must Have |
| SAF-07 | Reported rides go into a review queue (manual review for MVP) | Must Have |

---

## 4. Non-Functional Requirements

### Performance
- Ride match query (PostGIS radius + direction filter) must return results in under 2 seconds
- Push notification delivery within 5 seconds of a ride request
- QR scan to ride start transition in under 3 seconds
- Real-time location updates every 10 seconds during active coordination
- Map renders rider and driver positions with under 1-second lag

### Reliability
- Supabase Realtime connection must auto-reconnect on network interruption
- Ride state (status, pickup pin, fare) must be recoverable if either user's app crashes mid-ride
- Payment debit/credit must be atomic — partial payment states are not acceptable

### Security
- All API endpoints require a valid JWT (Supabase Auth)
- Card numbers never touch HICH servers — Stripe handles all card input via their hosted elements
- Driver license photos stored in private Supabase Storage bucket (not publicly accessible)
- Location data is not stored beyond the active ride
- `.env` credentials never committed to git

### Compatibility
- PWA must work on iOS Safari 15+ and Android Chrome 90+
- All screens must be usable at 375px viewport width (iPhone SE)
- Maps must function without a wi-fi connection (cached tiles)

---

## 5. Out of Scope for MVP

The following are deliberately excluded from the MVP to maintain focus. They are planned for Phase 2 or Phase 3.

| Feature | Reason Excluded | Planned Phase |
|---------|-----------------|---------------|
| Native iOS app | PWA validates hypothesis faster | Phase 3 |
| ML destination prediction model | Need trip data to train; cold start rules sufficient | Phase 2 |
| Real Stripe payouts to driver bank accounts | Stripe Connect onboarding takes time; wallet accumulation acceptable for beta | Phase 2 |
| Driver background checks | Requires Checkr API integration; .edu + license photo sufficient for beta | Phase 3 |
| Surge pricing | Requires demand modeling; flat fare adequate for MVP | Phase 3 |
| Admin dashboard | Manual review acceptable for <100 rides | Phase 3 |
| In-app rating influence on matching | Insufficient data at MVP scale | Phase 2 |
| Multi-city expansion | Single corridor (Davis ↔ Bay Area) for MVP | Phase 3 |
| Android native app | After iOS validation | Phase 3+ |

---

## 6. Open Questions

These questions require a decision before or during development. They are not blockers to starting but must be resolved before the affected feature is built.

| # | Question | Owner | Needed By |
|---|----------|-------|-----------|
| 1 | What transit data API do we use? Google Maps Directions API (transit mode) is the simplest but costs per request. Is there a free BART/Caltrain GTFS feed we can query instead for local transit? | Engineering | Before TRN feature build |
| 2 | ~~What is the exact definition of "same direction" for driver matching?~~ **Resolved:** Direction matching (Stage 3) only applies when a driver has a saved route. "Same direction" = driver's `destination_bearing` is within 60 degrees of the rider's destination bearing. If no saved route → Stage 2 (radius only). See Section 7. | Engineering | ✅ Resolved |
| 3 | How do we handle the case where a rider declines every driver's drop-off and no other drivers are available? Show a "no rides available right now" state and exit? Or keep them in a passive waiting state? | Product | Before TRN-08 build |
| 4 | Should drivers be able to set a maximum detour distance? E.g. "only notify me for riders within 5 min of my direct route." This would reduce false notifications but may reduce supply. | Product | Before NOT-01 build |
| 5 | Pickup pin 5-minute walk constraint: is this enforced hard (pin snaps back if too far) or soft (warning shown but driver can override)? Your excalidraw says "not more than 5 mins walk allowed" — confirming this is a hard limit. | Product | Before PKP-04 build |
| 6 | Multiple drivers scenario: what happens to the drivers who were not chosen? They are released with no penalty — but should they be able to see that the ride was taken so they understand why their notification disappeared? | Product | Before MLT-07 build |

---

## 7. AI Matching — Implementation Stages

This section defines exactly which matching logic to build and when. The staging approach comes from a hard lesson: you cannot train a machine learning model without data, and you cannot get data without first shipping a working product. So the AI comes last, not first.

> **The rule:** Ship the dumbest version that proves the loop works. Add intelligence only after you have evidence the loop is worth making smarter.

### Stage 1 — Notify Everyone (Ship This First)

**When:** Week 3, Day 1 — the moment ride requests go live.

**What it does:** A rider submits a request → your backend sends a push notification to every registered driver in the app. Zero filtering. Zero intelligence. Just a broadcast.

**Why this is the right call:** This proves the core loop works end-to-end: driver gets notified, driver accepts, rider gets picked up, payment happens. That loop is the entire product. Get it working before you add complexity.

```sql
-- Stage 1: get every active driver
SELECT u.id, pt.token
FROM users u
JOIN push_tokens pt ON pt.user_id = u.id
WHERE u.is_driver = true
```

**Log this:** `{ ride_id, stage: 1, drivers_notified: N }`

---

### Stage 2 — Radius Filter (Add Same Week)

**When:** Week 3, Day 2 — once Stage 1 is confirmed working on a real phone.

**What it does:** Only notify drivers within 15km of the rider's location. Uses PostGIS `ST_DWithin` — this is two lines of SQL.

**Why this matters:** Notifying a driver 80km away is noise. It wastes their attention and trains them to ignore notifications.

```sql
-- Stage 2: drivers within 15km, with a location update in the last 5 min
SELECT u.id, pt.token
FROM users u
JOIN push_tokens pt ON pt.user_id = u.id
JOIN driver_locations dl ON dl.user_id = u.id
WHERE u.is_driver = true
  AND ST_DWithin(
    dl.location::geography,
    ST_SetSRID(ST_Point(:rider_lng, :rider_lat), 4326)::geography,
    15000
  )
  AND dl.recorded_at > NOW() - INTERVAL '5 minutes'
```

**Fallback:** If Stage 2 returns zero results, fall back to Stage 1. Log the fallback.

---

### Stage 3 — Direction Filter (Only for Scheduled Routes)

**When:** Week 4 — when Trip Scheduling is built. Not before.

**What it does:** For drivers who have a saved route in `driver_routines`, also filter by bearing. The driver's `destination_bearing` must be within 60 degrees of the rider's destination bearing.

**The critical constraint:** Stage 3 only applies when the driver has a saved route. You only know their direction if they told you. If a driver has no saved route, fall back to Stage 2. Never infer direction from live GPS alone.

**Bearing check:**
```javascript
function withinBearingThreshold(bearing1, bearing2, threshold = 60) {
  const diff = Math.abs(bearing1 - bearing2) % 360;
  return Math.min(diff, 360 - diff) <= threshold;
}
```

```sql
-- Stage 3: radius + direction filter (only applied to drivers with a saved routine)
SELECT u.id, pt.token
FROM users u
JOIN push_tokens pt ON pt.user_id = u.id
JOIN driver_locations dl ON dl.user_id = u.id
LEFT JOIN driver_routines dr ON dr.user_id = u.id AND dr.is_active = true
WHERE u.is_driver = true
  AND ST_DWithin(dl.location::geography,
    ST_SetSRID(ST_Point(:rider_lng, :rider_lat), 4326)::geography, 15000)
  AND dl.recorded_at > NOW() - INTERVAL '5 minutes'
  AND (
    (dr.id IS NOT NULL AND ABS(((dr.destination_bearing - :rider_bearing) + 540) % 360 - 180) <= 60)
    OR
    (dr.id IS NULL)  -- no saved route: include anyway (Stage 2 fallback)
  )
```

---

### Stage 4 — Real AI (Phase 2, Not MVP)

Train a per-driver ML model on completed trip history. You cannot do this until you have real data. Do not build it in the MVP.

---

### Matching Stage Decision Table

| Situation | Stage to Apply |
|-----------|----------------|
| Week 3, first ride requests | Stage 1 (notify all) |
| Week 3 onward, Stage 1 confirmed | Stage 2 (15km radius) |
| Driver has a saved route in `driver_routines` | Stage 3 (radius + bearing) |
| Driver has NO saved route | Stage 2 (radius only — never fake direction) |
| Stage 2 returns zero results | Fall back to Stage 1 |
| Phase 2, after real trip data exists | Stage 4 (ML model) |

---

## 8. Development Standards

This section defines the non-negotiable standards for the HICH MVP build. Every rule here exists because violating it creates a specific category of problem that is painful to fix later.

### 8.1 The Test-First Rule

**Rule:** Every feature must have a test written in the same session it is built. You do not move to the next feature with untested code.

**Why:** Claude Code will produce code that works on the happy path and silently fail on edge cases. A test suite is the only way to know the feature you built yesterday still works after you changed something today.

**Minimum coverage required on critical files:**
- `src/lib/geo.ts` — 8+ tests covering standard cases, edge cases, and boundary conditions
- `src/lib/fare.ts` — 5+ tests with specific input/output assertions
- All Zustand store actions — test each action individually
- All API endpoint handlers — integration test for success path and at least one error path
- All form components — test each validation rule independently

---

### 8.2 The Lint Rule

**Rule:** Run `npm run lint` after every file you touch. Fix all errors before moving on. Zero lint errors in CI.

**Why:** Lint errors that accumulate across sessions compound. A codebase with 200 lint warnings is one where no one reads the warnings anymore, and the real bugs are hidden in noise.

**ESLint rules to enforce:**
```json
{
  "rules": {
    "no-unused-vars": "error",
    "no-console": "warn",
    "react-hooks/exhaustive-deps": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error"
  }
}
```

---

### 8.3 Why Each Rule Exists

These are the rules that go in `CLAUDE.md` and are read by Claude Code at the start of every session. The explanations below are for you — so you know why each rule is there and can defend it if Claude Code tries to skip one.

| Rule | Why it exists |
|---|---|
| Write tests in the same task | Without this explicit requirement, Claude Code considers a task done when the code runs once. You must define "done" as including a passing test. |
| Run lint before marking done | Lint issues compound. Catching them per-task takes 10 seconds. Fixing them all at the end takes hours. |
| Run full test suite before moving on | Claude Code can accidentally break a previous feature while building a new one. Running all tests after every task catches regressions at the point where the cause is obvious. |
| `unknown` not `any` | `any` disables TypeScript's entire purpose for that variable. One `any` spreads through a codebase like a virus. |
| React Query for server state | Without this rule, Claude Code will `useState` + `useEffect` for every API call, producing race conditions, missing loading states, and no caching. |
| Cents, never dollars | `0.1 + 0.2 = 0.30000000000000004` in JavaScript. Never let a floating point error corrupt a payment record. |
| `data-testid` on every component | Tests that target text content or CSS classes break when you rename things. `data-testid` is stable and explicit. |
| Emergency button in a React portal | If the Emergency button is inside a conditional render block and that condition is false during an incident, the button does not exist in the DOM. A portal at the top of the tree is always rendered regardless of what else is happening in the component tree. |
| No End Ride button for rider | The QR scan is consent and payment trigger in one action. If the rider could tap End Ride without scanning, the driver could be left without proof the ride ended. This is a product safety decision, not a UI preference. |
| Atomic wallet transactions | If the database crashes between the debit and the credit, a rider has paid for a ride and the driver received nothing. `BEGIN / COMMIT` blocks prevent this. |
| JWT validation first | Without this, anyone can call your endpoints without logging in. Always verify the token before touching data. |
| HMAC-signed QR tokens | Without a signature, anyone who knows a driver's UUID can generate a fake QR code and claim a ride started or ended. The HMAC means only the server can issue valid tokens. |
| License photos private | A public Supabase Storage URL means any unauthenticated person can view someone's government ID. This is a privacy liability. |

---

### 8.4 How to Work with Claude Cowork

**Step 1 — Create `CLAUDE.md` in your project root before your first session.** Claude Code reads this file automatically at the start of every session. It is how you avoid re-explaining your architecture and rules every time you open a new session. The content for this file is in `CLAUDE.md` (provided separately).

**Step 2 — Start each session with this opener:**
> "Read `CLAUDE.md` first. Then open `PRD.md` and find the first unchecked task. Build it, write a Vitest test for it, run `npm run lint`, run `npm test -- --run`, and confirm everything passes before we move on."

**Step 3 — One task per session maximum.** The temptation is to ask Claude to "build Week 3." Resist it. When the context window fills up with code and errors, quality degrades. One task = one complete, tested, linted feature. End the session. Start a fresh one for the next task.

**Step 4 — After every session, update the `## Current State` line in `CLAUDE.md`** with what was just built. This keeps future sessions grounded without needing a long re-explanation.

**Step 5 — Check off completed tasks in `PRD.md`.** Manually mark tasks `[x]` when done. If Week 4 is 30% done after two weeks, something needs to be cut.

---

### 8.5 Progress Tracking (`progress.txt`)

Create `progress.txt` in your project root. Update it manually at the end of each session.

```
## Summary
Total tasks: 48 | Completed: 0 | Remaining: 48

## Week 1 — Foundation
[x] Scaffold project + dependencies
[ ] Design tokens + Tailwind
...

## Decisions Log
2026-03-01 — Money: all cents, never floats.
2026-03-01 — License photos: private Supabase bucket, never a public URL.
2026-03-01 — AI matching: Stage 1 → 2 (same week) → 3 (only with saved route). Stage 4 = Phase 2.
```

The Decisions Log is the most important part. Every time you make a call that future-you might forget — an API choice, a schema decision, a UX tradeoff — write it here with a date. 30 seconds now saves hours of archaeology later.

---

### 8.6 GitHub Actions CI

Add this to `.github/workflows/ci.yml`. Every pull request runs lint and tests automatically. No PR merges if either fails.

```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --run
      - run: npm run build
```

---

*This PRD will be updated as decisions are made on the open questions above. Any feature change that affects an existing requirement ID should be tracked with a version note.*

---

**Document Owner:** HICH Founding Team  
**Review Cycle:** After each completed sprint
