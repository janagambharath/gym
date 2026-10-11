# UI/UX Parity Audit — Part B: Members, Payments, Renewals

**Scope:** PWA `renewal-desk-pwa/src/screens/` (JS) vs Android `renewal-desk-android/src/screens/` (TSX).
**Date:** 2026-10-11. Read-only audit; no code changed. Line refs are to the current working-tree files.

## Cross-cutting differences (apply to several screens)

1. **Pagination vs infinite scroll.** PWA lists use infinite scroll (e.g. `members.js:51-57`, `payments.js` search handler). Android uses explicit "Page X of Y" prev/next buttons (`MembersScreen.tsx:381-403`, `PaymentsScreen.tsx` pagination block). Different UX, same data. **Renewals is the exception:** PWA caps the Expired section at 20 (`renewals.js:56`); Android renders ALL expired members with no cap — a long-expired roster could produce a very long scroll.
2. **Error-state retry.** Android `ErrorState` components always offer a Retry button (`MembersScreen.tsx:169`, `PaymentsScreen.tsx`, `RenewalsScreen.tsx:174`). PWA `renderErrorState(...)` shows the message with no retry affordance (`members.js:63`, `payments.js:56`, `renewals.js:24`).
3. **Pull-to-refresh.** Android screens have `RefreshControl` (`MembersScreen.tsx:224-230`, `PaymentsScreen.tsx`, `MemberDetailScreen.tsx`, `RenewalsScreen.tsx`). PWA has none — only full reload.
4. **Idempotency.** PWA `record-payment.js:59` and `renew-member.js:35` send an `Idempotency-Key` header (generated per form mount). Android `RenewMemberScreen.tsx:113` does too, but Android `RecordPaymentScreen.tsx` does NOT — a double-tap / slow-network double submit can create duplicate payments.
5. **Feedback style.** PWA uses toasts (`showToast`); Android uses `Alert.alert` dialogs and inline message banners. Functionally equivalent, different feel.
6. **Backend-API drift.** The two frontends don't always hit the same endpoints for the same feature: Android CSV import uses a `POST /members/import/preview` (validate-first) + `POST /members/import` with a `csv_text` JSON body (`MemberImportScreen.tsx:48-63`); PWA uploads multipart form data straight to `POST /members/import` (`member-import.js:22-30`). Both apps must be tested against the deployed backend before release.

---

## 1. Members list — `members.js` vs `MembersScreen.tsx`

| Aspect | PWA (`members.js`) | Android (`MembersScreen.tsx`) |
|---|---|---|
| Entry points | Header actions: Add (line 35), Import (line 35); plus FAB "add" (line 27) | Header "Add Member" button (line 170-182, only if `onAddMember` wired); decorative (non-pressable) notifications bell (line 166-168); **no Import entry point** |
| Search | "Search members...", 400ms debounce (line 43-45) | "Search name, phone or member ID", 400ms debounce (line 66-73); clear-X button (line 306-309) |
| Filters | Chips always visible: All / Active / Expiring / Expired (line 20-25) | Same 4 chips with status dots (line 36-41), but **collapsible** behind a filter toggle button (line 192-201) |
| Expiring filter | Server-side: `expiring_within_days=7` (line 61) | **Client-side filter over the current page only** — comment in code: *"Client-side filter for 'expiring' (backend doesn't have this status filter)"* (`MembersScreen.tsx:79-86`). With 20/page, expiring members beyond page 1 are invisible. PWA passes `expiring_within_days=7` to the backend, so the backend DOES support it — Android should use it. **Real data bug.** |
| List rows | Avatar, name, phone · plan name · 📍address; right: status badge + days text (`components.js:211-228`); tap → member detail | Avatar, name, phone, plan name · duration ("Plan not set" warning if none); right: **expiry date** + color-coded days text + status badge; tap → member detail (`MembersScreen.tsx:114-152`). Android row is richer but **drops the address line** |
| List chrome | Count line ("N members"); infinite scroll | Column header row ("Member" / "Expiry & status", line 233-238); count in header subtitle ("N members", line 163) |
| Loading | `renderListSkeleton()` (line 61) | 3× `CardSkeleton` (line 248-252) |
| Empty | "No members found" / contextual text + "Add Member" action when no query (line 68-71) | "No results" vs "No members yet" + "Add Member" action when no search (line 256-263). Parity. |
| Error | Message only, no retry (line 63) | `ErrorState` with Retry (line 254) |

**Verdict — gaps on Android:**
- **A1 (high):** "Expiring" filter is client-side over one page; members past page 1 are missed. PWA does it server-side correctly.
- **A2 (medium):** No Import entry point on the Members screen (PWA has header Import action). Import is reachable only from the Dashboard (`App.tsx:268`, `DashboardScreen.tsx:263`) — discoverability gap.
- **A3 (low):** Dead notifications bell icon in the header (non-pressable `View`) — remove or wire it.
- **A4 (low):** Row drops the 📍 address subtitle that PWA shows.

---

## 2. Member detail — `member-detail.js` vs `MemberDetailScreen.tsx`

**PWA section order** (`member-detail.js:28-140`): Header (title "Member", back, Edit action) → Profile card (XL avatar, name, Call + WhatsApp buttons, phone, address or "No address recorded", status badge, days text) → Membership card (Plan / Start / End + remaining-days progress bar) → Contact & Address card (Phone, Email, Address, Gender, Joined, Notes-if-any, inline Edit button) → Activity & Access card (Access Status "● Inside Gym Now" + Entered At timestamp, WhatsApp opt-in, Biometric enroll state) → Biometric Device Access (eSSL) card (Synced/Not-Enrolled badge; Change ID + Unenroll, or Enroll CTA) → Actions (Check In/Out, Edit Member Details, Renew Membership, Record Payment, Pause/Freeze or Resume, Send WhatsApp Reminder, Block/Unblock Biometric Access, Deactivate danger).

**Android section order** (`MemberDetailScreen.tsx:330-671`): AppHeader ("Member Details", back, no Edit action) → message banner → Profile card (avatar, name, phone, 📞Call/💬WhatsApp buttons, address-if-any, `ID: MBR{id}`, plan chip, status badge + days text) → Membership card (Plan + duration days / "Plan not set", Start, Expiry + tone-colored days-remaining/overdue bar) → **Financial Summary card (Android-only)**: Membership Amount (plan price), Verified Paid (sum over verified/paid payments w/ VERIFIED/PENDING badge), Pending Review (count w/ PENDING/CLEAR badge) — computed from `GET /renewals?member_id=&page_size=5` and `GET /payments?page_size=50` filtered client-side by `member_id` (`MemberDetailScreen.tsx:83-96`) → Activity card (Renewal History count, Payment History count, WhatsApp Reminders "Verified templates active", Access & Attendance, Biometric Terminal — counts only, not tappable) → Biometric Device Access card (Enroll/Change ID/Unenroll + **Block/Unblock moved here** as a third button) → Check In/Out button → Renew Membership CTA → secondary tiles (Send WhatsApp, Record Payment, Edit Member) → Pause/Freeze or Resume → Notes card (if any) → Deactivate danger (**gated to `gym_owner` role**, `MemberDetailScreen.tsx:667`).

**Verdict — gaps on Android:**
- **B1 (high): No Contact & Address info section.** PWA shows Email, Gender, Joined date, Notes inline in a dedicated card with an Edit shortcut (`member-detail.js:73-89`). Android shows phone + address only in the profile header. Email, gender, and joined date are invisible anywhere on the detail screen — a gym owner cannot verify/update contact info without opening the edit form. (Notes do get their own card on Android, so notes are covered.)
- **B2 (medium): No WhatsApp opt-in status.** PWA Activity card shows "WhatsApp: Opted In / Not opted in" (`member-detail.js:97`). Android's Activity card says "Verified templates active" — a static string, not the member's opt-in state.
- **B3 (medium): No "Entered At" timestamp.** PWA shows `last_entry_at` when the member is inside (`member-detail.js:96`). Android shows only "Currently Inside Gym".
- **B4 (medium): Deactivate permission differs.** PWA shows Deactivate to anyone when `status !== 'deleted'` (`member-detail.js:131`). Android restricts to `gym_owner` (`MemberDetailScreen.tsx:667`). Decide which is intended — but note the PWA currently lets staff deactivate.
- **B5 (low, layout):** Block/Unblock Biometric Access moved from the Actions stack (PWA) into the Biometric card (Android) — same API, different location. Also PWA has a header Edit action; Android only offers Edit in the secondary tiles.
- **B6 (perf nit):** Android fetches `page_size=50` payments and filters client-side; a member with >50 payments gets a wrong Financial Summary. Fetch `?member_id=` server-side if the backend supports it.
- Android extras (not in PWA): Financial Summary card, "ID: MBR{id}", plan chip, days-remaining tone bar, Notes-as-own-card, message banner instead of toasts, pull-to-refresh. These are improvements — no PWA feature is lost except B1–B3.

---

## 3. Add member — `add-member.js` vs `AddMemberScreen.tsx`

**PWA fields** (`add-member.js:13-26`): Full Name*, Phone* (tel), Email, Gender (select: Male/Female/Other), Address (textarea), Membership Plan (dropdown; selecting a plan auto-fills fee), Membership Fee "Customizable Money" (defaults to plan price), Payment Status (Paid Now / Collect Later — hides Method when unpaid), Payment Method (Cash/UPI/Card/Bank Transfer/Other), Start Date (date, defaults today), Notes. Duplicate-phone warning: non-blocking, 600ms debounce, fires at ≥10 digits, matches last 10 digits (`add-member.js:56-73`). Validation: name required, phone ≥10 digits (toast + focus). Phone normalized to `+91…`/`+…`. Success → navigates to member-detail.

**Android fields** (`AddMemberScreen.tsx:230-520`): Full Name*, Phone Number* (prefilled with country prefix), Email, Address, plan as **selectable plan chips** (same auto-fill of fee), Membership Fee "Customizable Money"* (required — validated non-negative), Paid/Collect-later toggle, payment method chips (CASH/UPI/**BANK**/CARD/OTHER), **Transaction / Reference ID field (Android-only, sent as `payment_reference`)**, Notes. Duplicate-phone warning: same logic (≥10 digits, 600ms, last-10-digit match, `AddMemberScreen.tsx:61-72`) — parity. Validation: inline per-field errors + error banner (`AddMemberScreen.tsx:132-148`) instead of toasts. Success → `onMemberCreated` → parent replaces with MemberDetail (`App.tsx` wiring) — parity.

**Verdict — gaps on Android:**
- **C1 (high): Gender field missing.** PWA captures Gender (select). Android has no gender input at all — data loss for gyms that track it.
- **C2 (high): Start Date missing.** PWA lets staff backdate the membership start (`am-start`, defaults today). Android hardcodes `membership_start: today` (`AddMemberScreen.tsx:173`). Migrating/backfilling members with past start dates is impossible on Android.
- **C3 (low):** Payment method labels differ ("BANK" vs PWA "Bank Transfer") — cosmetic. Android adds `payment_reference` (extra, good).
- Layout: plan chips vs dropdown — equivalent.

---

## 4. Edit member — `edit-member.js` vs `EditMemberScreen.tsx`

**PWA** (`edit-member.js:16-26`): fetches member + plans fresh; fields Full Name*, Phone*, Email, Gender (**select**: Male/Female/Other), Address, Plan (dropdown), Notes; PATCH; toast + `member-updated` event + `navigate.pop()`.

**Android** (`EditMemberScreen.tsx:30-285`): fetches member + plans fresh; fields Full Name*, Phone* (normalized to +91 on save, `EditMemberScreen.tsx:91-95`), Email, Address, Gender (**free-text input** "Male / Female / Other", `EditMemberScreen.tsx:188-191`), Plan (**chip buttons**, `EditMemberScreen.tsx:206-208`), Notes; PATCH; `onSaved` callback + `onBack()`. Both show loading/error states; Android adds inline field errors.

**Verdict:** Near-full parity. Only difference: **Gender is a controlled select on PWA but free text on Android** — allows typos/inconsistent values ("male", "M", "Mail"). Recommend the same 3-option picker on Android.

---

## 5. Member import — `member-import.js` vs `MemberImportScreen.tsx` + `ImportMembersScreen.tsx`

**PWA** (`member-import.js`): single screen — dashed file-drop zone, accepts `.csv,.xlsx`, shows file name + size, "Import Members" button → multipart upload to `POST /api/mobile/v1/members/import` → toast "N members imported!" → back. No preview, no validation step, no duplicate check client-side.

**Android:**
- `ImportMembersScreen.tsx` = **import hub (no PWA equivalent)**: "Import your members" landing with 3 option cards — Import CSV (`onNavigateCSV`), Scan Member Records / AI document scanner (`onNavigateScan` → `MemberScanScreen`), Add Manually (`onNavigateManual`). Plus a privacy note. Wired in `App.tsx:293` and `:636` under route `ImportMembers`; entry from **Dashboard** (`onNavigateImportMembers`, `App.tsx:268` → `DashboardScreen.tsx:263`), **not** from the Members screen.
- `MemberImportScreen.tsx` = CSV flow: pick CSV via DocumentPicker → **editable CSV text area** → "Preview and validate" → `POST /members/import/preview` shows per-row VALID/INVALID/DUPLICATE + summary counts (total/valid/invalid/duplicates) → **import is blocked while any row is invalid or duplicate** → confirm `POST /members/import` with `csv_text` JSON → alert + back.

**Verdict — differences:**
- **D1 (medium): No Import entry on Android's Members screen.** PWA header has an Import action (`members.js:35`). Android's hub is reachable only via the Dashboard CTA and the scan screen's error fallback. (The routes ARE wired — `App.tsx:293-308`, `636+` — so this is a missing button, not dead code.)
- **D2 (medium): File-type support differs.** PWA accepts `.csv,.xlsx` via multipart upload (backend parses). Android reads the picked file **as text** (`new File(asset.uri).text()`, `MemberImportScreen.tsx:42`) — an `.xlsx` would upload as binary garbage, and its picker MIME list (`text/csv`, `application/vnd.ms-excel`) doesn't even include the real `.xlsx` type. Effective support: CSV only.
- **D3 (low): Android caps CSV at 2 MB** (`MemberImportScreen.tsx:39-42`); PWA has no cap.
- **D4 (info): Android's preview/validate-then-import flow is strictly richer than PWA's blind upload** — atomic import, per-row errors, duplicate blocking. If the backend's `/import/preview` endpoint exists, consider back-porting the preview step to PWA rather than dumbing Android down.
- **D5 (low):** Required columns are documented on Android only (full_name, phone, membership_start, membership_end; E.164 phone; YYYY-MM-DD dates).

---

## 6. Payments list — `payments.js` vs `PaymentsScreen.tsx`

**PWA** (`payments.js:14-33`): header "Payments" + Record action; **3 summary cards** (Today's collections, Pending count, today's Count — fetched from `GET /payments/summary`, only on page 1); search "Search member, amount, reference…" (400ms); status chips All/Pending/Verified/Rejected; infinite scroll (page_size 20); rows = avatar, member name, method · date, right: amount + status badge (`components.js:233-246`); tap → payment-detail; skeleton/empty/error states; FAB + header action → record-payment.

**Android** (`PaymentsScreen.tsx`): header "Payments — Collections, demands & cashflow" + add button → record-payment; **rich summary**: Today's Collections (amount + "N paid" badge + discounts line + "Net verified cashflow"), channel split (Online/VYNLA vs Counter/Offline), pending-review line (count + amount) — refetched on every page/filter change; search "Search by UTR, member name, or phone…"; **status chips + extra channel filter** (All Channels / VYNLA Online / Counter-Cash, sent as `channel=` param, `PaymentsScreen.tsx:39-44, 69`); pagination buttons; rows are **much richer**: channel badge (VYNLA/Counter), phone, method · date, discount strikethrough + savings pill, plan badge, renewal-days, Ref/UTR, Staff (created_by), Verified-by — **and inline Verify / Reject / Cancel buttons on pending rows** (`PaymentsScreen.tsx:176-214`, confirm dialog `413-439`); tap → payment detail.

**Verdict — Android is a superset here except:**
- **E1 (low):** PWA search hint mentions amount ("Search member, amount, reference…"); Android hints UTR/name/phone. Trivial, but check the backend `q=` behavior is identical.
- **E2 (low):** PWA fetches summary only on page 1 (perf); Android refetches every page/filter change — fine but slightly chatty.
- Android extras (not in PWA): channel filter, channel badges, discount display, staff/verified-by on rows, **inline Verify/Reject/Cancel-demand from the list** — a genuine workflow speedup. PWA requires opening payment-detail to verify.

---

## 7. Record payment — `record-payment.js` vs `RecordPaymentScreen.tsx`

**PWA** (`record-payment.js:8-33`): member search (debounced 300ms, page_size 5) or preselected member card with Change; **Plan dropdown** (auto-fills amount); Amount*; Method select (Cash/UPI/Card/**Online**/Other); Reference; Notes; submit → `POST /payments` with **`Idempotency-Key` header**, body `{member_id, amount, method, plan_id, reference, notes}`; on success, if `whatsapp_url` present → confirm dialog → open WhatsApp receipt → pop.

**Android** (`RecordPaymentScreen.tsx`): member search (400ms debounce, page_size 10, results show plan name) or preselected card with Change; **NO plan picker — instead a "Renewal Days" field** (defaults from plan duration, validated 1–730); Amount*; method chips (cash/upi/**bank_transfer**/card/other); Reference/Transaction ID; Notes; **"Payment will be recorded as pending and requires verification"** notice; **₹0 complementary-payment confirm dialog**; submit → `POST /payments` body `{member_id, amount, method, reference, notes, renewal_days}` — **no `plan_id`, no `Idempotency-Key`**; WhatsApp receipt prompt via Alert with "Done"/"Send WhatsApp" → `onCreated` + back.

**Verdict — gaps on Android:**
- **F1 (medium): No Idempotency-Key header.** PWA guards double-submit (`record-payment.js:59`); Android relies only on a `saving` flag — network retry can double-record. Add the key.
- **F2 (medium): No plan selection; adds Renewal Days.** PWA sends `plan_id`; Android sends `renewal_days` instead. These are different renewal semantics — verify the backend treats them equivalently, and decide which the product wants. (RenewMemberScreen on Android sends BOTH `plan_id` and `renewal_days`, so the backend accepts both.)
- **F3 (low): Method options differ** — Android: cash/upi/bank_transfer/card/other; PWA: cash/upi/card/**online**/other. "Online" vs "bank_transfer" mismatch; unify.
- Android extras: ₹0-complementary confirm, pending-verification notice, search results show plan names. Good.

---

## 8. Payment detail — `payment-detail.js` vs `PaymentDetailScreen.tsx`

**PWA** (`payment-detail.js:9-40`): big amount + status badge; info rows (Member, Plan, Standard Price, Discount, Method, Channel, Reference, Date, Notes, Created By, Verified By, Verified At); actions: Share WhatsApp Receipt (if `whatsapp_url`), Verify Payment + Reject Payment (pending only), Delete Payment (always, confirm dialog). Double-tap guard on all action buttons.

**Android** (`PaymentDetailScreen.tsx:150-262`): same core rows (Plan defaults "Membership Renewal"; Channel rendered "Online (VYNLA App)" / "Counter (Cash / POS)"; **adds Renewal Days**; Catalog Price / Discount Given / Net Final Amount split); actions: Share WhatsApp Receipt, Verify / Reject (pending, via ConfirmDialog), **Cancel Demand (extra — `POST /payments/{id}/cancel`)**, **Delete Record restricted to `gym_owner`** (`PaymentDetailScreen.tsx:253`).

**Verdict — differences:**
- **G1 (medium): Android has "Cancel Demand"** — no PWA equivalent anywhere in this flow. If intentional, add to PWA; if not, confirm the endpoint is safe to expose.
- **G2 (medium): Delete permission differs.** PWA lets anyone delete a payment; Android restricts to gym_owner. Same concern as B4 — pick one rule and apply to both apps.
- Android extras: Renewal Days row, price/discount/net split, confirm dialogs on all destructive actions (PWA confirms reject/delete but not verify).

---

## 9. Payment setup — `payment-setup.js` vs `PaymentSetupScreen.tsx`

**PWA** (`payment-setup.js:8-24`): UPI ID/VPA* (validated non-empty + must contain `@`), Payment Label, Instructions textarea, QR image file upload (PNG/JPG/WebP) with 180px preview, Save → `PUT /settings/payment` with `is_active: true` hardcoded; success toast → pop after 500ms.

**Android** (`PaymentSetupScreen.tsx:133-290`): same fields (UPI ID/VPA*, Merchant/Gym Display Name, Instructions, QR pick via image picker + upload + preview) **plus: an Active/Inactive `Switch`** (`PaymentSetupScreen.tsx:198-200`, sent as `is_active`, `PaymentSetupScreen.tsx:88`) and a **status preview** ("Ready for Instant Payments" vs "Inactive", line 267-268). Also an explainer ("never holds your funds").

**Verdict — differences:**
- **H1 (low): Android can disable payment collection** via the switch; PWA hardcodes `is_active: true` — a gym that disabled collection in Android sees no way to re-enable in PWA (and PWA re-saving would silently re-enable it — data clobber).
- **H2 (low): UPI-required validation differs.** PWA blocks save on empty UPI; Android only validates format *if non-empty* (`PaymentSetupScreen.tsx:68-72`) — allows saving with a blank UPI ID. Align the rule.

---

## 10. Renewals — `renewals.js` vs `RenewalsScreen.tsx`

**PWA** (`renewals.js:18-58`): header "Renewals" + megaphone **Campaigns** action; loads `/renewals/upcoming` + `/renewals/expired`; sections **Expiring Today (=0) / Next 7 Days (1–7) / Upcoming (>7) / Expired (capped 20)**; rows: name, phone · plan, **Call + WhatsApp buttons + Renew button** (`data-stop` prevents row navigation on the buttons); row tap → member-detail; skeleton/empty/error states. Partial failure tolerated (shows whichever endpoint succeeded).

**Android** (`RenewalsScreen.tsx`): header "Renewals" + subtitle "N upcoming · N expired"; **NO Campaigns entry point** (`onNavigateCampaigns` prop accepted but never rendered, `RenewalsScreen.tsx:27,31`); sections Expiring Today (≤0) / Next 7 Days (>0) / Expired; rows richer (avatar, name, phone, plan or "Plan not set", expiry date, days text, status badge) + **renew icon, 📞 call, 💬 WhatsApp** quick icons; row tap → member detail; skeleton/empty/error(+retry)/pull-to-refresh; Expired uncapped.

**Verdict — gaps on Android:**
- **I1 (high): "Upcoming" (>7 days) section missing — and a bucketing bug.** PWA renders members expiring beyond 7 days under "Upcoming". Android splits `upcoming` into today (≤0) and "Next 7 Days" (>0) — so members expiring in 8–30 days are **mislabeled as "Next 7 Days"** (`RenewalsScreen.tsx:77-82`). If the backend's `upcoming` window is 30 days, the Android section header lies; if it's 7 days, the PWA "Upcoming" section implies Android is dropping data. Either way, reconcile with the backend contract and add the missing bucket.
- **I2 (medium): Campaigns entry point missing.** PWA header megaphone → campaigns. Android's `onNavigateCampaigns` prop is dead — no button renders it. Add the header action.
- **I3 (low):** PWA caps Expired at 20; Android uncapped (see cross-cutting #1).

---

## 11. Renew member — `renew-member.js` vs `RenewMemberScreen.tsx`

**PWA** (`renew-member.js:10-31`): member card (avatar, name, phone, status badge); Plan dropdown* (auto-fills amount); Amount*; Method (Cash/UPI/Card/Online/Other); Reference/Transaction ID; Notes; **"I confirm…" checkbox gates the submit button**; submit → `POST /payments` with `Idempotency-Key`, body `{member_id, plan_id, amount, method, reference, notes}`; toast + pop.

**Android** (`RenewMemberScreen.tsx`, 1072 lines — a full renewal workstation): member card (current plan + **current expiry + "+N days" renewal extension**, `RenewMemberScreen.tsx:289-290`); 3-step flow — (1) plan selector cards, (2) **Customizable Money**: final payable amount + derived discount ("−₹X (Y% off)", savings pill, `RenewMemberScreen.tsx:360-385`) + Commercial Note/Discount Reason, (3) route toggle: **Publish to VYNLA (UPI)** vs **Counter Payment (Desk)** + method chips; agreement checkbox ("I confirm that the commercial price of ₹X is approved for …", line 450-459); submit → `POST /payments` with `Idempotency-Key`, body `{member_id, plan_id, standard_price, discount, final_payable, channel, method, auto_verify: channel==='offline', renewal_days, notes}`; **post-payment success state** with "Send WhatsApp Confirmation" + "View Member Details" (`RenewMemberScreen.tsx:190-243`).

**Verdict:** Android is a strict superset of PWA functionality, with one gap:
- **J1 (low): Android does not collect Reference/Transaction ID** on the renew screen (PWA `rn-ref` → `reference`). Its POST body has no `reference` field. Add the field or confirm it's intentionally dropped.
- Note the semantic shift: Android sends `final_payable`/`discount`/`channel`/`auto_verify` where PWA sends plain `amount`/`method` — verify backend compatibility for counter payments recorded from the PWA (do they still extend membership the same way?).
- Android extras (discount engine, VYNLA publish route, success screen) are improvements; back-port candidates for PWA if desired.

---

## 12. FastRenewalScreen.tsx — Android-only

**No PWA equivalent exists** (no `fast-renewal` route or reference in `renewal-desk-pwa/src/`). It's a 1–2 tap renewal confirmation: receives `{paymentId, memberName, amount, planName, paymentMethod, paymentReference, membershipEnd}`, shows a summary, "Confirm Renewal" → `POST /payments/{id}/verify` → success state with new start/end dates; treats 409/CONFLICT as idempotent success (`FastRenewalScreen.tsx:36-100`). It's a **push-notification deep-link destination** (`App.tsx:1402`: `payload?.screen === 'FastRenewal' && payload?.payment_id`) — i.e., tap a payment notification → confirm → done, bypassing search → profile → payment → verify. PWA has no push-notification infrastructure, so there's no natural PWA equivalent; note it as Android-only. (`CampaignDetailScreen.tsx:151` has its own inline `onConfirmFastRenewal` that calls the same verify endpoint directly rather than navigating here.)

---

## Priority-ordered gap list

| # | Severity | Gap | Screens |
|---|---|---|---|
| A1 | High | "Expiring" filter is client-side over one page on Android; misses members past page 1. Use `expiring_within_days=7` like PWA | Members |
| I1 | High | Android Renewals mislabels >7-day expiries as "Next 7 Days"; "Upcoming" section missing | Renewals |
| C1 | High | Gender field missing on Android Add Member (data loss) | Add Member |
| C2 | High | Start Date missing on Android Add Member (can't backdate) | Add Member |
| B1 | High | No Contact/Email/Gender/Joined info section on Android Member Detail | Member Detail |
| F1 | Medium | Record Payment on Android lacks Idempotency-Key (double-submit risk) | Record Payment |
| B2 | Medium | WhatsApp opt-in status not shown on Android Member Detail | Member Detail |
| B3 | Medium | "Entered At" timestamp missing on Android Member Detail | Member Detail |
| B4/G2 | Medium | Deactivate/Delete permission differs (Android: gym_owner only; PWA: anyone) — pick one rule | Member Detail, Payment Detail |
| D1 | Medium | No Import entry point on Android Members screen (only via Dashboard) | Members |
| D2 | Medium | Android import is CSV-only in practice (reads file as text; `.xlsx` unsupported) vs PWA's `.csv,.xlsx` | Import |
| I2 | Medium | Campaigns entry point missing on Android Renewals (`onNavigateCampaigns` never rendered) | Renewals |
| F2 | Medium | Record Payment: Android sends `renewal_days` (no plan); PWA sends `plan_id` — different semantics, verify backend | Record Payment |
| G1 | Medium | "Cancel Demand" exists only on Android Payment Detail — confirm intended, or add to PWA | Payment Detail |
| A2 | Medium | Import reachable only from Dashboard on Android | Members |
| F3 | Low | Payment method options differ (Android `bank_transfer` vs PWA `online`) | Record Payment |
| H1 | Low | Android can toggle payment collection off; PWA hardcodes `is_active:true` (re-save clobbers) | Payment Setup |
| H2 | Low | Empty UPI ID allowed on Android, blocked on PWA — align validation | Payment Setup |
| J1 | Low | Renew Member on Android has no Reference/Transaction ID field | Renew Member |
| A3 | Low | Dead notifications bell on Android Members header | Members |
| A4 | Low | Android member rows drop the address line | Members |
| E1/E2 | Low | Search hints differ; summary refetch cadence differs | Payments |
| D3 | Low | Android 2 MB CSV cap; PWA uncapped | Import |
| B5 | Low | Block/Unblock biometric moved into Biometric card (Android) vs Actions stack (PWA) | Member Detail |
| B6 | Perf | Member Detail fetches 50 payments client-filtered; >50 payments → wrong Financial Summary | Member Detail |

**Android-only features worth keeping (consider back-porting to PWA):** Financial Summary card on Member Detail; inline Verify/Reject/Cancel on Payments rows; channel filter + channel badges; import preview/validation with duplicate blocking; import hub with AI scan option; discount engine + VYNLA publish route + success screen on Renew Member; ₹0-complementary confirm; retry buttons on error states; pull-to-refresh.
