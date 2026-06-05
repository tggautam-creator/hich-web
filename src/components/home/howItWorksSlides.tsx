import type { CarouselSlide } from './HowItWorksCarousel'

/**
 * Slide decks for the home-page "How Instant Carpool works" carousel.
 * Ported 1:1 from ios/Tago/Features/RiderHome/HowItWorksCarousel.swift
 * `Slide.rider` and `Slide.driver`. SVG icons inline so this file
 * only exports constants (keeps Vite's fast-refresh boundary clean
 * for `HowItWorksCarousel.tsx`).
 */

const ICON_CLASS = 'h-8 w-8'

const magnifierIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS} aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)
const cardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V5zm0 5h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9zm4 6h6v-2H7v2z" />
  </svg>
)
const paperPlaneIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
)
const tramIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M19 16.94V8.5C19 5.42 15.86 3 12 3s-7 2.42-7 5.5v8.44c0 1.13.92 2.06 2.06 2.06l-1.06 1.06v.94h2.41l1.34-1.34a3.75 3.75 0 0 0 4.5 0L15.59 21H18v-.94l-1.06-1.06A2.06 2.06 0 0 0 19 16.94zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm.5-6H7V8h10v3z" />
  </svg>
)
const chatIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
  </svg>
)
const qrIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm10 0h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2h2zm0 6h2v2h-2v-2zm2-4h2v2h-2v-2zm-4 4h2v2h-2v-2z" />
  </svg>
)
const dollarIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.88 14.62v1.5h-1.75v-1.46c-1.84-.28-2.94-1.38-3.05-3.03h2.04c.08.7.55 1.26 1.65 1.26 1.07 0 1.5-.45 1.5-1.07 0-.66-.5-.98-1.95-1.34-2.05-.49-3.05-1.18-3.05-2.65 0-1.34.91-2.28 2.4-2.6V5.75h1.75v1.48c1.6.3 2.55 1.32 2.6 2.82h-2.04c-.04-.71-.5-1.18-1.5-1.18-.92 0-1.42.42-1.42 1 0 .56.42.92 2 1.27 2 .44 3 1.18 3 2.72 0 1.42-1 2.4-2.58 2.76z" />
  </svg>
)
const bellIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" />
  </svg>
)
const pinIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
  </svg>
)
const navIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="2" x2="12" y2="22" />
    <polyline points="9 19 12 22 15 19" />
  </svg>
)

export const RIDER_HOW_IT_WORKS: CarouselSlide[] = [
  { id: 0, icon: magnifierIcon,   title: 'Search for your destination',          body: "Tap Find Instant Carpools and pick where you want to go. That's all we need to start matching." },
  { id: 1, icon: cardIcon,        title: 'Add your card',                        body: "We ask this for security only. You're never charged for requesting a ride — the card is only billed once the trip is complete." },
  { id: 2, icon: paperPlaneIcon,  title: 'Tap Request ride',                     body: 'We notify every verified student driver heading your way. The first one going your direction can accept the ride.' },
  { id: 3, icon: tramIcon,        title: 'Driver accepts and picks a drop-off',  body: "Drivers choose a transit station already on their route so they don't take detours. We map the rest of your journey from that station for you." },
  { id: 4, icon: chatIcon,        title: 'Chat opens',                           body: 'Negotiate the pickup and drop-off — accept what the driver suggests, or counter with an address that works better for you.' },
  { id: 5, icon: qrIcon,          title: 'Scan to start, scan to end',           body: 'When the driver reaches your pickup, scan their QR to start the ride. Scan it again at drop-off to end the trip safely.' },
  { id: 6, icon: dollarIcon,      title: 'Pay only for what you used',           body: "Final fare is the miles you actually travelled together — gas cost plus a small time charge. It's calculated at the end so the price stays fair even if plans change last minute." },
]

export const DRIVER_HOW_IT_WORKS: CarouselSlide[] = [
  { id: 0, icon: bellIcon,        title: 'Get a ride request',                   body: "Accept any request roughly heading your way — destinations don't have to match. We'll find a transit station on your existing route so you never take a detour." },
  { id: 1, icon: pinIcon,         title: "Tell us where you're heading",         body: 'Once you accept, share your destination. We use it to calculate the best drop-off point that already fits your route.' },
  { id: 2, icon: tramIcon,        title: 'Pick a transit drop-off',              body: "We'll show you 3 transit stations along your route. Pick the one that fits best and we'll suggest it to the rider." },
  { id: 3, icon: chatIcon,        title: 'Chat opens',                           body: 'Confirm or negotiate the pickup and drop-off — adjust timings, swap addresses, anything that works for both of you.' },
  { id: 4, icon: navIcon,         title: 'Drive to the pickup',                  body: 'Use the in-app directions to navigate straight to the confirmed pickup location.' },
  { id: 5, icon: qrIcon,          title: 'Show your QR to start',                body: "When the rider gets in, show them your QR to start the ride. They'll scan again at drop-off to end it safely." },
  { id: 6, icon: dollarIcon,      title: 'Get paid for what you drove',          body: 'Earnings settle to your Tago wallet — based on the miles you actually drove together: gas cost plus a small time charge. Fair, automatic, no surprises.' },
]
