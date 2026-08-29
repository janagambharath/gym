# ANDROID FINAL BUG REPORT — RENEWAL DESK

This document tracks all bugs and potential vulnerabilities identified during the QA audit, along with their severity rating, root cause analysis, fix implementation, and verification status.

---

### Bug Summary Table

| ID | Severity | Screen | Description | Status |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | **P1** | WhatsAppScreen | Lead message transcript response shape mismatch prevented chat history from displaying in modal | **FIXED & VERIFIED** |
| **BUG-002** | **P1** | RecordPaymentScreen | Missing in-flight guard allowed potential duplicate payment submissions on rapid taps | **FIXED & VERIFIED** |
| **BUG-003** | **P1** | EditMemberScreen | Missing in-flight guard allowed multiple simultaneous `PATCH` requests on fast save button taps | **FIXED & VERIFIED** |
| **BUG-004** | **P1** | PaymentDetailScreen | Verify, Reject, and Delete payment buttons lacked concurrent tap guard | **FIXED & VERIFIED** |
| **BUG-005** | **P2** | RenewalsScreen | Nested `TouchableOpacity` elements in renewal list rows could cause touch event conflicts on Android | **FIXED & VERIFIED** |
| **BUG-006** | **P1** | App.tsx | Push notification tap handler logged payload but did not trigger deep navigation to target screens | **FIXED & VERIFIED** |
| **BUG-007** | **P2** | MemberDetailScreen | Member details lacked explicit Biometric Access / Device enrollment state presentation | **FIXED & VERIFIED** |
| **BUG-008** | **P2** | App Configuration | `versionCode` in `app.json` was set to 2 instead of incrementing for fresh production release | **FIXED & VERIFIED** |

---

### Detailed Bug Reports

#### BUG-001: WhatsAppScreen Lead Message Modal Parsing Error
- **Severity:** P1 (Important before production)
- **Screen:** `src/screens/WhatsAppScreen.tsx`
- **Reproduction:** Navigate to WhatsApp Screen -> Switch to "Leads" tab -> Tap any lead to view conversation transcript modal.
- **Root Cause:** `openLeadDetail` expected messages at `res.data.conversation.messages`, whereas the `/api/mobile/v1/bot/conversations/:id` endpoint returns `{ conversation: {...}, messages: [...], lead: {...} }` where `messages` is a top-level property of `data`. Additionally, `sendReply` was posting to an unmapped `/reply` subpath instead of the `/message` endpoint with `{ body }`.
- **Fix:** Updated `openLeadDetail` to extract `res.data.messages || (res.data.conversation as any)?.messages || []` and updated `sendReply` to call `/api/mobile/v1/bot/conversations/:id/message` with `{ body: replyText.trim() }`.
- **Verification:** Verified message list loads properly and manual replies send successfully.

#### BUG-002: RecordPaymentScreen Duplicate Submit on Rapid Tap
- **Severity:** P1 (Financial safety)
- **Screen:** `src/screens/RecordPaymentScreen.tsx`
- **Reproduction:** Open Record Payment -> Select member -> Rapidly double-tap "Record Payment".
- **Root Cause:** `handleSubmit` did not check `if (saving) return;` at the entry point of the function before starting async operations.
- **Fix:** Added immediate `if (saving) return;` check at the beginning of `handleSubmit` and added `saving` to the `useCallback` dependency array.
- **Verification:** Rapid tapping disabled during in-flight state; only one payment request is dispatched.

#### BUG-003: EditMemberScreen Concurrency on Fast Save
- **Severity:** P1 (Data consistency)
- **Screen:** `src/screens/EditMemberScreen.tsx`
- **Reproduction:** Open Edit Member -> Modify member name -> Rapidly double-tap "Save Changes".
- **Root Cause:** `handleSave` did not check `if (saving) return;` prior to validation.
- **Fix:** Added `if (saving) return;` at the entry point of `handleSave` and included `saving` in dependencies.
- **Verification:** Tested with fast taps; only a single `PATCH` request is dispatched.

#### BUG-004: PaymentDetailScreen Concurrency on Verification / Rejection
- **Severity:** P1 (Financial state consistency)
- **Screen:** `src/screens/PaymentDetailScreen.tsx`
- **Reproduction:** Open Payment Detail for a pending payment -> Rapidly tap Verify or Reject multiple times.
- **Root Cause:** `handleVerify`, `handleReject`, and `handleDelete` lacked an `if (acting) return;` guard.
- **Fix:** Added `if (acting) return;` to `handleVerify`, `handleReject`, and `handleDelete`.
- **Verification:** Double execution prevented; confirmation dialog locks during action in flight.

#### BUG-005: Nested Touchable Elements in Renewals Screen
- **Severity:** P2 (UX / Android touch event handling)
- **Screen:** `src/screens/RenewalsScreen.tsx`
- **Reproduction:** On an Android device, tap near the right edge of a renewal row.
- **Root Cause:** A `TouchableOpacity` for the instant renewal action was nested inside the outer `TouchableOpacity` for the entire member row. On Android native touch systems, nested touchables can cause bubbling conflicts where both actions trigger or the inner action is swallowed.
- **Fix:** Separated the row into a non-touchable container `View` with two sibling `TouchableOpacity` elements: one for the member details press and one for the renewal action button.
- **Verification:** Both tap targets trigger their independent actions cleanly on Android.

#### BUG-006: Push Notification Tap Handler Missing Deep Navigation
- **Severity:** P1 (Mobile UX & responsiveness)
- **Screen:** `App.tsx`
- **Reproduction:** Receive a push notification for a handover or lead -> Tap the notification from the Android system tray.
- **Root Cause:** `Notifications.addNotificationResponseReceivedListener` logged the payload to console but did not navigate to the target screen.
- **Fix:** Created a top-level `navigationRef` attached to `NavigationContainer` and wired up deep navigation to route to `BotConversationDetail`, `BotLeadDetail`, `PaymentDetail`, `Renewals`, or `Notifications` based on notification payload data.
- **Verification:** Verified push notification tap triggers direct navigation to target screen.

#### BUG-007: Biometric Access Status Visibility
- **Severity:** P2 (Hardware & Access Control Truthfulness)
- **Screen:** `src/screens/MemberDetailScreen.tsx`
- **Reproduction:** View Member Detail for a member.
- **Root Cause:** Member payload includes `has_biometric: boolean`, but the screen did not expose this state to the gym owner.
- **Fix:** Added a dedicated "Biometric / Access State" row in the Activity card displaying "Enrolled on Access Device" (Active badge) vs "Not enrolled on device" (Pending badge).
- **Verification:** Verified accurate reflection of member biometric enrollment status.

#### BUG-008: Release Version Code Increment
- **Severity:** P2 (Release Configuration)
- **Screen:** `app.json`
- **Reproduction:** Inspect `app.json` `android.versionCode`.
- **Root Cause:** `versionCode` was set to 2.
- **Fix:** Incremented `versionCode` to 3 for the fresh production release.
- **Verification:** Verified `app.json` contains `versionCode: 3`.
