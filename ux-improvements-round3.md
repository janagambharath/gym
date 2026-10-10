# UX Improvements Round 3 — PWA + Android

**Date:** 2026-10-10
**Scope:** Day-to-day owner workflows. All items are frontend-only (no backend changes), visible in daily use, and safe.
**Skipped** (already fixed): More tab, Options→More rename, renew confirmation, WhatsApp status fields, Android commissioning UI, Android liveness check, HTTPS warning.

---

## 1. Tap-to-call on member detail (PWA + Android)

**Where:**
- PWA: `renewal-desk-pwa/src/screens/member-detail.js:39` (phone displayed as plain text), `:77` (info row)
- Android: `renewal-desk-android/src/screens/MemberDetailScreen.tsx:299` (phone as plain Text)

**Why it matters:** The owner's #1 daily action is calling members — renewal follow-ups, payment reminders, trial confirmations. Right now the phone number is displayed but not tappable. The owner has to memorize it, copy it, or switch apps and type it manually. Every single call has this friction, dozens of times a day.

**Fix:**
- PWA: wrap the phone display in `<a href="tel:${member.phone}" style="color:var(--brand);text-decoration:none">`. Add a small phone icon before it for affordance.
- Android: wrap in `<TouchableOpacity onPress={() => Linking.openURL(`tel:${member.phone}`)}>` with a call icon. Import `Linking` from `react-native`.
- Strip non-digits except leading `+` before building the tel: URL.

---

## 2. "Chat on WhatsApp" button on member detail (PWA + Android)

**Where:** Same files as #1.

**Why it matters:** The `wa.me/` deep-link pattern already exists in the codebase (PWA `bot-lead-detail.js:34`, Android `CampaignDetailScreen.tsx:129`) but is missing where the owner needs it most — the member profile. WhatsApp is the primary communication channel for Indian gym owners. Currently: copy number → open WhatsApp → paste → find chat. Should be one tap.

**Fix:**
- PWA: add a button next to the phone row (or in the actions section near `#btn-send-reminder`): `window.open(`https://wa.me/${member.phone.replace(/\D/g,'')}`, '_blank')`. Use the WhatsApp icon, `btn-whatsapp` styling for consistency.
- Android: same with `Linking.openURL(`https://wa.me/${cleanPhone}`)`. Reuse the phone-cleaning logic from CampaignDetailScreen.
- Note: this opens a direct chat (different from "Send WhatsApp Reminder" which sends a template). Both are needed — template for formal reminders, direct chat for conversation.

---

## 3. Quick call/WhatsApp actions on renewal rows (PWA + Android)

**Where:**
- PWA: `renewal-desk-pwa/src/screens/renewals.js:49` (per-row Renew button only)
- Android: `renewal-desk-android/src/screens/RenewalsScreen.tsx:101` (phone shown, no actions)

**Why it matters:** This is the highest-revenue screen in the app — "Expiring Today" is literally the money list. The owner's workflow is: see who's expiring → contact them → get them to renew. Right now contacting means tapping into each member's detail screen (2 extra taps per member × 15 expiring members = 30 wasted taps daily). The contact actions should be on the row itself.

**Fix:**
- PWA: add two small icon buttons next to the Renew button on each row — phone icon (`tel:` link) and WhatsApp icon (`wa.me/` link). Keep them compact (`btn-sm`, icon-only) so the row doesn't get crowded.
- Android: add the same two icon touchables in the row layout. Use the existing `Icon` component (`phone`, `whatsapp` names — verify they exist in `theme/icons`).
- Both: stop propagation on these buttons so they don't trigger the row's member-detail navigation.

---

## 4. PWA payments screen: add search (parity with Android)

**Where:**
- PWA: `renewal-desk-pwa/src/screens/payments.js` — no search input
- Android: `renewal-desk-android/src/screens/PaymentsScreen.tsx:53` — has `searchQuery` state, passes `q` param

**Why it matters:** "Did Sharma pay?" is a daily question. Android owners can search payments; PWA owners must scroll through pages. This is a straight parity gap on a daily-use screen.

**Fix:**
- PWA: add a search input at the top of `payments.js` (reuse the pattern from `members.js` search). Debounce 300ms, pass `q` to `/api/mobile/v1/payments`. The backend already supports the `q` param (Android uses it).
- Match Android's behavior: search by member name, phone, or reference/transaction ID (whatever the backend `q` covers).

---

## 5. PWA receipt share: replace `window.confirm` with app modal

**Where:** `renewal-desk-pwa/src/screens/record-payment.js:53`
```js
const share = window.confirm('Payment recorded successfully! Send digital receipt via WhatsApp?');
```

**Why it matters:** The owner UX overhaul replaced all `window.prompt()` calls with the styled `showPrompt` modal — but this `window.confirm` was missed. It shows the ugly native browser dialog, breaking the app's visual consistency at a celebratory moment (payment recorded!). Small fix, visible polish.

**Fix:** Replace with the existing `showConfirm` from `components.js`:
```js
import { ..., showConfirm, ... } from '../components.js';
const share = await showConfirm({ title: 'Receipt Sent', message: 'Payment recorded successfully! Send digital receipt via WhatsApp?', confirmText: 'Send Receipt' });
```
`showConfirm` is already imported in `member-detail.js` — verify it's exported from `components.js` (it is, used in settings.js).

---

## 6. Android MembersScreen: add pull-to-refresh

**Where:**
- Android: `renewal-desk-android/src/screens/MembersScreen.tsx` — `FlatList` at `:216` has no `refreshControl`
- Reference: `DashboardScreen.tsx:174` and `RenewalsScreen.tsx:192` both have `RefreshControl`

**Why it matters:** Consistency. The owner adds a member on one screen, switches to Members, and instinctively pulls to refresh — nothing happens. Dashboard and Renewals both support it; Members is the odd one out. This is the kind of inconsistency that makes an app feel unfinished.

**Fix:** Add to the `FlatList`:
```tsx
refreshControl={
  <RefreshControl
    refreshing={refreshing}
    onRefresh={refresh}
    colors={[colors.brand]}
  />
}
```
Wire `refreshing`/`refresh` to the existing data-fetch logic (check how `requestRevision` or similar re-fetch trigger works in this screen — line 50 shows a `requestRevision` in the request key).

---

## 7. Duplicate phone warning on add-member (PWA + Android)

**Where:**
- PWA: `renewal-desk-pwa/src/screens/add-member.js` — no duplicate check
- Android: `renewal-desk-android/src/screens/AddMemberScreen.tsx` — no duplicate check

**Why it matters:** Gym staff add members hastily at the front desk. Duplicate records (same person, slightly different name spelling) are the #1 data quality problem in gym management — they cause double renewal reminders, wrong attendance mapping, and confused reports. A gentle "this phone number already exists" warning at entry time prevents the mess.

**Fix (safe, no backend change):**
- On the phone field's `blur` event (not on every keystroke), call `GET /api/mobile/v1/members?q=<digits>&page_size=3`.
- If any result has a matching phone (compare digits-only), show an inline warning under the field: "⚠️ A member with this number already exists: [Name]. Continue anyway?" — non-blocking, just a warning.
- Don't block submission — sometimes duplicates are legitimate (family sharing a number). The warning is enough.
- Debounce to avoid API spam if the user tabs through quickly.

---

## Implementation notes for parent

- Items 1, 2, 3 share the same `tel:` / `wa.me/` helper logic — build it once per platform.
- Item 3's row buttons must use `e.stopPropagation()` (PWA) / not bubble (Android) to avoid triggering row navigation.
- Item 5: `showConfirm` returns a Promise<boolean> — the current code is already `async`, so just `await` it.
- All items are additive UI — no existing flows are modified, no API contracts change.
