# HICH — Session Briefing

## How to use this file
Copy everything below the divider and paste it as your first message in a new Claude session.
Update the "This session" line with the exact PRD task line you want to build.
The working directory for ALL code is: `/Users/tarungautam/Desktop/Hich`

---

## Paste this into each new session:

```
HICH — Session briefing
Working directory: /Users/tarungautam/Desktop/Hich

## Already built (all tests pass — do not rebuild any of this)

Week 1 — Foundation (complete)
  Vite + React + TypeScript scaffold, Tailwind CSS, design tokens (src/lib/tokens.ts),
  Supabase schema (users, vehicles, rides, transactions, driver_locations, driver_routines),
  typed Supabase client + env validation, base UI components (PrimaryButton, SecondaryButton,
  InputField, Card, DayPill, BottomSheet), ESLint config, Vercel deploy.

Week 2 — Auth & Onboarding (complete)
  Landing page (/), Signup (/signup) with .edu validation + email-exists guard (supabase RPC),
  Login (/login) with password + magic link + forgot-password link,
  ForgotPassword (/forgot-password), CheckInbox (/check-inbox) with 60s resend timer,
  CreateProfile (/onboarding/profile), LocationPermissions (/onboarding/location),
  ModeSelection (/onboarding/mode), VehicleRegistration (/onboarding/vehicle),
  AuthGuard (redirects unauthenticated/incomplete users), Zustand authStore.

Week 3 — partial
  RiderHomePage (/home/rider): full-screen Leaflet map, GPS blue-dot, reverse-geocoded
    "From" label, "Where to?" search card, schedule button, 4-tab bottom nav.
  DestinationSearch (/ride/search): Google Places autocomplete, 300ms debounce,
    recent destinations from localStorage.
  RideConfirm (/ride/confirm): destination address, fare range (±15%), request button,
    src/lib/fare.ts (calculateFare / calculateFareRange / formatCents).

## This session — build exactly this one feature:
[PASTE THE EXACT PRD TASK LINE HERE]

## Key files to read before starting
- PRD.md                              (full task list — mark [x] when done)
- src/main.tsx                        (routing — add new routes here)
- src/lib/tokens.ts                   (colours — never raw hex in components)
- src/lib/fare.ts                     (fare calculation — already built)
- src/lib/supabase.ts                 (typed Supabase client)
- src/types/database.ts               (all table types)
- src/components/ride/RideConfirm.tsx (last screen built — good pattern reference)

## Conventions (enforced by lint + tests)
- Money always in cents (integers). Display only as dollars. Never floats.
- All colours via src/lib/tokens.ts. Never raw hex.
- Server state: React Query. Client state: Zustand. Never useState+useEffect for API calls.
- Every component accepts a data-testid prop.
- API errors: { error: { code: string, message: string } } on failure.
- TypeScript strict mode. Never `any`. Use `unknown` and narrow it.
- JWT validated on every API endpoint before any other logic.

## Definition of done — all three must pass before marking [x] in PRD.md
npm test -- --run    ← all tests green including new ones for this feature
npm run lint         ← zero errors
npm run build        ← no TypeScript errors
```
