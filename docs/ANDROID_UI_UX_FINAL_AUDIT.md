# Renewal Desk — Android UI/UX Final Audit

## Scope and evidence

This is a code-level review as of 2026-08-31, not a physical-device or screen-reader certification. No release build was installed for this audit.

## Implemented billing-screen corrections

- Replaced mock purchase/restore controls with native Google Play actions.
- Product price and availability are now taken from Play product details, not a locally fabricated amount.
- The subscription screen distinguishes manual customers from Google Play customers and never pushes manual customers into checkout.
- Pending purchases do not grant an entitlement. Backend verification is required before local transaction completion.
- Purchase errors, unavailable products, restore results, and unavailable billing connections have visible feedback.
- Buttons have `accessibilityRole`, descriptive labels/hints, and a 44dp minimum action height; feedback is announced as a live region.
- Lifecycle badges now represent trial, pending, payment failure, grace period, cancellation, expiry, and active states.

## Not verified on hardware

- Font scaling, display scaling, TalkBack focus order, keyboard behavior, and long localized strings.
- Device safe areas, gesture/back behavior, rotation, low-memory recovery, and offline transitions.
- Every app screen named in the release checklist. No claim is made that all were visually audited.
- Notification tap navigation, CSV picker behavior, Play checkout, restore, or subscription management.

## Required release-candidate device checklist

1. Install the signed production AAB/Internal Test build on a supported Android device.
2. Exercise login, signup, dashboard, members, payments, renewals, CSV import, settings, notifications, WhatsApp, AI, and subscription screens.
3. Repeat the highest-risk paths with large font, display scaling, keyboard, long names/currency values, offline/slow network, and TalkBack.
4. Record device model, Android version, build ID, scenarios, defects, and retest results before changing this document to VERIFIED.
