# Renewal Desk — PWA vs Android Parity Audit · Part C

**Date:** 2026-10-11
**Scope:** AI Receptionist (bot-\*), WhatsApp (whatsapp\*, campaigns\*), inbox, notifications, plans, staff, reports, subscription, access, gym-profile, member-scan, owner-\*, registration.
**Files:** PWA `renewal-desk-pwa/src/screens/` (JS) vs Android `renewal-desk-android/src/screens/` (TSX). Static code comparison only.
**Legend:** ✅ parity · ⚠️ partial / different behavior · ❌ missing on one side (production-relevant)

---

## Pair 1 — AI Receptionist Overview
`bot-overview.js` (26 lines) vs `BotOverviewScreen.tsx` (742 lines)

**Verdict: ⚠️ Android is a superset in layout, but metrics differ and PWA's "Test Bot" entry is unreachable on Android.**

### Metrics shown
| Metric | PWA (`bot-overview.js:10-17`) | Android (`BotOverviewScreen.tsx:190-216`) |
|---|---|---|
| Conversations | ✅ | ✅ |
| Leads | ✅ | ✅ |
| Handovers (handover_count) | ✅ | ❌ (only as "staff attention" attention card, `BotOverviewScreen.tsx:217-236`) |
| Resolution % (resolution_rate) | ✅ | ❌ |
| Contacted leads | ❌ | ✅ |
| Trials (trial_requests) | ❌ | ✅ (+ Converted in pipeline section `:309-327`) |

- Endpoint mismatch: PWA hits `/api/mobile/v1/bot/overview` (`:8`); Android hits `/api/mobile/v1/bot/stats` + `/api/mobile/v1/bot/config` (`:94-97`). Two different contracts for the "overview" screen.
- Menu items — PWA `:19-24`: Conversations, Leads, Bot Setup, **Test Bot**. Android: Conversations, Leads, Setup (operation cards `:262-280` + bottom buttons `:329-350`) — **no Test Bot entry anywhere** (see Pair 6).
- Android-only: status row (`:176-188`, "AI Receptionist Active · Staff Handover Enabled" / "Setup Needs Attention"), 4-item setup-completeness checklist with COMPLETE/NOT CONFIGURED badges (`:282-307`, pulls from `/bot/config`: greeting, opening hours, map link, enabled FAQ count), pull-to-refresh (`:155-164`), header refresh button, 401 → logout (`:107-110), proper error screen with retry (`:159-166`). PWA renders `{}` silently on failure — `renderListSkeleton` replaced by empty data, no error state.
- Header title: PWA "AI Receptionist" vs Android "WhatsApp AI Receptionist".

---

## Pair 2 — Bot Conversations List
`bot-conversations.js` (29) vs `BotConversationsScreen.tsx` (286)

**Verdict: ⚠️ Android richer; PWA fails silently and has no search/filters.**

| Feature | PWA | Android |
|---|---|---|
| Rows: name/phone, state, relative time, handover badge | ✅ (`:17-32`) | ✅ (`:124-148`) |
| Handover badge (`Handover` for human_requested/human_active) | ✅ (`:18-19, :29`) | ✅ via `StatusBadge` |
| Phone shown as separate line | ❌ (only as title fallback `:24`) | ✅ (`:139`) |
| Search (name/phone/state) | ❌ | ✅ debounced client-side (`:108-122`, `SearchBar :180-186`) |
| Status filters | ❌ | ✅ All / Bot / Needs staff / Staff active / Closed (`:24-30`) |
| Header count "N total" | ❌ | ✅ (`:170`) |
| Pull-to-refresh | ❌ | ✅ (`:188-194`) |
| Error state w/ retry | ❌ — API failure renders the **"No conversations" empty state** (`:13` → empty list), which lies | ✅ `BotAccessState` + retry (`:156-162`) |
| 401 → logout | ❌ | ✅ (`:139-141`) |
| Loading skeleton | ✅ (`:9`) | ✅ (`:150-155`) |

---

## Pair 3 — Bot Conversation Detail
`bot-conversation-detail.js` (35) vs `BotConversationDetailScreen.tsx` (587)

**Verdict: ❌ PWA is missing the entire handover take-over action (the core staff workflow).**

| Feature | PWA | Android |
|---|---|---|
| Message bubbles (bot/customer/staff) | ✅ (`:20-25`) | ✅ `BotMessageBubble` |
| Reply box + send via POST `/conversations/:id/message` | ✅ (`:12-15, :27-34`) | ✅ (`:322-345`) |
| Identity header (name, phone, state, status badge) | ❌ | ✅ (`:243-255`) |
| Conversation-mode indicator (AI handling / staff handling / "customer requested staff — AI paused" / closed) | ❌ | ✅ (`:257-280`) |
| **Take over / Resume AI receptionist** (POST `/conversations/:id/handover`, take_over|resume_bot) | ❌ — sending a message does NOT mark staff takeover | ✅ (`:127-150`, button `:295-306`) |
| Closed-conversation handling (reply disabled, lock banner) | ❌ | ✅ (`:307-312`, composer disabled `:342`) |
| Linked lead → "View lead" | ❌ | ✅ (`:314-320`) |
| Detail rows (last activity, state) | ❌ | ✅ (`:282-293`) |
| 4000-char limit, success/error notice banners | ❌ | ✅ (`:329, :259-270`) |
| History error with "Retry history" | ❌ — failed load shows "Not found" (`:18`) | ✅ (`:182-195`) |
| Entitlement/access error handling | ❌ | ✅ `BotAccessState` (`:231-238`) |

On PWA, a staff member can only reply — there is no way to pause/resume the AI receptionist, so the bot may keep auto-replying over staff messages.

---

## Pair 4a — Bot Leads List
`bot-leads.js` (25) vs `BotLeadsScreen.tsx` (327)

**Verdict: ⚠️ Android richer; PWA missing search/filter/pagination.**

| Feature | PWA | Android |
|---|---|---|
| Rows: name/phone, status badge, created time | ✅ (`:12-25`) | ✅ (`:120-146`) |
| Search | ❌ | ✅ server-side, debounced 350ms (`:46-60`) |
| Status filters | ❌ | ✅ All / New / Contacted / Interested / Trial / Converted / Lost (`:22-30`), server-side `?status=` |
| Pagination (page_size=20, prev/next) | ❌ | ✅ (`:170-196`) |
| Total count in header | ❌ | ✅ (`:168`) |
| Row extras: interested_plan, intent, "Trial requested" flag | ❌ | ✅ (`:134-137`) |
| Error state w/ retry | ❌ — silent empty | ✅ (`:160-165`) |

## Pair 4b — Bot Lead Detail
`bot-lead-detail.js` (36) vs `BotLeadDetailScreen.tsx` (412)

**Verdict: ⚠️ Each side has something the other lacks.**

| Feature | PWA | Android |
|---|---|---|
| Info card (phone, name, source, created) | ✅ (`:10-19`) | ✅ "Enquiry" summary (`:191-201`) + intent, plan interest, trial flag, conversation id |
| Conversation history | ✅ (`:25-28`) | ✅ (`:233-245`) |
| **Convert to Member** (prefilled add-member) | ✅ (`:22, :33`) | ❌ |
| **Send WhatsApp** (`wa.me` deep link) | ✅ (`:23, :34`) | ❌ |
| Edit lead: name, notes, status chips (8 statuses) → PATCH `/bot/leads/:id` | ❌ | ✅ (`:203-229`, `:105-149`, `LEAD_STATUS_OPTIONS :26-35`) |
| Success/error notices, pull-to-refresh | ❌ (toast only) | ✅ |

**Production gap:** Android has no one-tap path from a captured lead to a member (PWA's "Convert to Member") nor a WhatsApp deep link. PWA has no lead status workflow at all (can't mark contacted/interested/lost).

---

## Pair 5 — Bot Setup
`bot-setup.js` (30) vs `BotSetupScreen.tsx` (771)

**Verdict: ❌ PWA is a 6-field form; Android is a full config console. PWA can't manage FAQs, trials, or handover.**

| Feature | PWA | Android |
|---|---|---|
| Greeting message | ✅ (`:11`) | ✅ + 3 quick-welcome template chips (`:227-251`) |
| Opening hours | ✅ (`:12`) | ✅ (`:255-262`) |
| Google Maps link | ✅ (`:13`) | ✅ (`:263-272`) |
| Registration link | ✅ (`:14`) | ✅ (`:348-359`) |
| Trial price / duration | ✅ (`:15-16`) | ✅ (`:296-312`) |
| **Trial on/off switch** (`trial_enabled`) | ❌ | ✅ (`:296-312`) |
| **Human handover on/off** (`handover_enabled`) | ❌ | ✅ (`:331-346`) |
| **FAQ management** (list w/ ON/OFF, add, delete, 8 prebuilt templates) | ❌ | ✅ (`:361-456`, POST/DELETE `/bot/faqs`) |
| Field validation (price ≤2 decimals, duration integer) | ❌ | ✅ (`:34-40, :131-140`) |
| Owner-only editing (staff = read-only banner) | ❌ — anyone logged in can PATCH | ✅ `canEdit` (`:69, :204-208`) |
| Error/access states | ❌ (toast only) | ✅ `BotAccessState` + inline notices |

PWA sends only 6 keys on PATCH (`:20-27`); trial_enabled/handover_enabled/FAQs are unreachable from PWA.

---

## Pair 6 — Bot Test Sandbox
`bot-test.js` (31) vs `BotTestScreen.tsx` (316)

**Verdict: ⚠️ Different designs; ❌ Android screen is DEAD (unreachable).**

- PWA: chat-style sandbox — bot greeting, user messages, bot replies in bubbles, Enter-to-send (`:9-31`). Error → generic "Sorry, I couldn't process that." (`:28`).
- Android: form-style "AI Bot Sandbox" (`:93`) — info banner, 5 suggested prompt chips (`:32-38`), custom message box, "Simulate Response" → result card with AI reply, **classified intent (uppercase)** and **handover-triggered notice** (`:155-192`). Proper error card (`:145-152`).
- Android fetches `lead_captured` in the response type (`:23-30`) but **never renders it** — wasted field.
- **PWA reaches Test Bot from AI Receptionist menu (`bot-overview.js:23`). On Android, `BotTestScreen` has ZERO references anywhere in `src/` — it is unreachable.** (Verified 2026-10-11 via grep.)

---
## Pair 7 — WhatsApp Setup (Embedded Signup)
`whatsapp-setup.js` (38) vs `WhatsAppSetupScreen.tsx` (425)

**Verdict: ⚠️ Same backend flow; Android completes it in-app, PWA kicks out to a browser tab and never learns the result.**

- PWA: connection-status card (`:10-12`), 3-step "How it works" explainer (`:18-21`), "Start Setup" → fetches `/whatsapp/onboarding-config` (`:30`) → `window.open(embedded-signup-page, '_blank')` (`:35`) with toast "Complete the Meta setup in the new tab, then return here" (`:36`). **No result detection** — if the user finishes, the PWA screen shows no success and doesn't re-check status.
- Android: loads the same embedded-signup page in an in-app `WebView` (`:169-241`, Android UA spoof), handles `postMessage` events: `open_external_browser`, `embedded_signup_cancel` (→ back), `embedded_signup_error`, `embedded_signup_code` (→ POST `/connect-waba` with code), `WA_EMBEDDED_SIGNUP`/`embedded_signup_complete` (waba_id/phone_number_id → POST `/connect-waba`) (`:91-168`). Explicit phases: loading → ready → connecting (`:245-252`) → **success** (`:254-274`, "WhatsApp Connected!" + "Go to WhatsApp Dashboard" → `onConnected` + back) / **error with Try Again** (`:276-300`).
- PWA connected state shows phone + next_action (`:22-23`); Android success navigates back and refreshes.

## Pair 8 — WhatsApp Dashboard
`whatsapp.js` (46) vs `WhatsAppScreen.tsx` (1028)

**Verdict: ⚠️ Android is a 3-tab work center; PWA is a status card + recent log.**

| Feature | PWA | Android |
|---|---|---|
| Title | "WhatsApp" | "WhatsApp & Broadcasts" (`:400`) |
| Connection state, phone, auto-reminders on/off, sent today | ✅ (`:13-24`) | ✅ + 5-item checklist (WhatsApp Business / Meta Business / Phone Number / Messaging Ready / Renewal Reminders) (`:443-467`) and per-state copy (connected / action_required / failed / pending / not_connected) (`:415-442`) |
| Connect → setup flow | ✅ (`:27, :43`) | ✅ taps status card → `WhatsAppOnboardingModal` (`:404-412, :750-756`) |
| Broadcast | Button → **`campaign-create` screen** (`:27, :44`) | Inline **composer tab** (`:551-662`): audience selector w/ live counts (`/whatsapp/broadcast/stats`), 4 quick presets (`:51-68`), char count, **live WhatsApp preview** (`:619-636`), confirm dialog, POST `/whatsapp/broadcast`, success banner (`:284-330`) |
| Campaigns link | ✅ (`:28, :45`) | ❌ |
| Recent messages log (`/whatsapp/logs`, up to 15, status badges) | ✅ (`:30-41`) | ❌ |
| Reminders tab: sent/failed today stats, status filters All/Sent/Failed/Pending (`/whatsapp/reminders`), error message on rows, tap → member detail | ❌ | ✅ (`:497-548`) |
| AI Leads tab (filters, trial badge, notes, tap → lead chat modal w/ reply box) | ❌ | ✅ (`:665-747`) |

**Behavioral split:** the same "Broadcast" capability is two different flows — PWA routes to the campaign wizard (template-based, Meta-approved); Android's WhatsApp screen has its own free-text broadcast composer. Keep both discoverable or unify.

## Pair 9a — Campaigns List
`campaigns.js` (25) vs `CampaignsScreen.tsx` (853)

**Verdict: ⚠️ Android is a campaign hub with purpose funnel; PWA is a flat history list.**

- PWA (`:10-22`): rows (name/segment → segment label, recipients, created date, status badge), header "+" → campaign-create, empty state → New Campaign.
- Android: **"Campaign Purposes" cards** — Recover Expired Members (recovery), Promotions & Offers (promotion), Get New Members (**Coming Soon** alert `:87-95`) — each with its own CTA (`:110-235`); history filter tabs All / Expired Recovery / Promotions with server-side `?campaign_type=` (`:248-282`); rich cards with type badge, **metric pills Sent/Delivered/Read + Renewed (recovery) / Replied (promo)**, **"revenue recovered" attribution row** on recovery cards (`:350-358`), reply-engagement row (`:360-367`), date + creator footer (`:369-376`); quick-create "New" in nav (`:390-402`); tab-aware empty states (`:419-431`).

## Pair 9b — Campaign Create
`campaign-create.js` (43) vs `CampaignCreateScreen.tsx` (1515)

**Verdict: ❌ Android is a 3-step guarded wizard; PWA is a one-shot form missing purpose/CSV/cooldown.**

| Feature | PWA | Android |
|---|---|---|
| Name + target segment | ✅ (`:13-14`) | ✅ with per-purpose segment lists (6 recovery segments, 3 promo) (`:566-579`) |
| Message template picker | ✅ (`:15`, `/campaigns/templates`) | ✅ Meta-approved template cards w/ WhatsApp bubble preview + variables (`:698-744`, `?purpose=`) |
| **Free-text message fallback** | ✅ when no templates exist (`:15`) | ❌ template-only |
| Preview & recipient count | ✅ manual "Preview & Count" (`:16-24`) | ✅ auto live preview w/ member samples (`:586-616`) |
| Purpose (recovery vs promotion) | ❌ | ✅ switcher + 6 promo presets (`:484-535`) |
| CSV import (file picker + paste + server validation, invalid/duplicate stats) | ❌ | ✅ (`:599-692`) |
| **Cooldown protection** (7-day exclusion, POST `/cooldown-check`, toggle) | ❌ | ✅ (`:746-784`) |
| Review summary + compliance card | ❌ | ✅ (`:786-866`) |
| Confirm before send | ✅ native confirm dialog (`:26`) | ✅ "Launch" w/ summary, then sending state (`:250-318`) |
| API shape | POST `/campaigns` {name, segment, template_id, message} — sends immediately | POST `/campaigns` {name, campaign_type, promo_preset, template_name, segment_type, imported_contacts, exclude_recent} → POST `/campaigns/:id/send` |

## Pair 9c — Campaign Detail
`campaign-detail.js` (28) vs `CampaignDetailScreen.tsx` (837)

**Verdict: ❌ Android is a revenue-attribution workbench; PWA is read-only stats.**

- PWA (`:13-26`): status badge, segment, recipients, sent, delivered, failed, created, sent_at, first 20 recipients w/ status badge. Error → "Campaign not found".
- Android: refetches campaign + recipients on mount/refresh (`:93-123`); metrics grid Sent/Delivered/Read + Renewed (recovery) / Replied (promo) (`:338-383`); **"Revenue Recovered" card** w/ amount + renewal count (`:385-398`) or promotion-engagement card; recipient status filters All/Sent/Delivered/Read/Replied/Renewed/Failed (`:121-129, :406-419`, server-side, page_size=100); per-recipient cards: name, phone, plan, expiry date, status badge, **"Renewed — attributed to this campaign" banner** (`:249-256`); actions: **1-tap Fast Renewal modal** (amount/days prefilled, POST `/renewals/:member_id` with campaign-attribution note `:169-225`), **WhatsApp deep link** (`:150-156`), **Call** (`:158-163`); tap name → member detail.
- Minor PWA-only: Created/Sent At date rows — Android detail header shows name + segment only (dates appear on list cards, not detail).

---

## Pair 10a — Inbox
`inbox.js` (32) vs `InboxScreen.tsx` (417)

**Verdict: ⚠️ Android is a unified conversation inbox; PWA is a generic deep-link list.**

- PWA (`:5-29`): rows (avatar, sender name, preview text, relative time); tap deep-links by `conversation_id` → bot-conversation-detail, `member_id` → member-detail, `payment_id` → payment-detail, `lead_id` → bot-lead-detail (`:21-27`). No filters, no unread tracking. Reads `data.messages`.
- Android: conversation model (type `bot`/`campaign_reply`/`member`), filter tabs All / Bot Chats / Campaign Replies / Members (server `?type=`) (`:34-39, :70-113`); **summary bar** (total/handovers/unread) (`:59-64`); **unread badge in header** (`:91-97`); **handover attention banner** → bot conversations (`:100-106`); rows with type-icon avatar badge, last message, relative time, unread dot + highlighted styling, "Staff Handover" / "Campaign Reply" tags (`:150-193`); pull-to-refresh; `ErrorState` + retry. Reads `data.conversations` + `data.summary` — **contract differs from PWA**.

## Pair 10b — Notifications
`notifications.js` (32) vs `NotificationsScreen.tsx` (281)

**Verdict: ⚠️ PWA has no read-management; Android does.**

- PWA (`:12-28`): type icons (payment/renewal/member/whatsapp/bot/campaign → `:13-14`), unread = brand-subtle bg + bold title (`:16-18`), relative time; tap deep-links member/payment/conversation (`:30-35`). **Tapping does not mark as read; no "mark all read".**
- Android: category chips All / Handovers / Leads / Payments / Renewals w/ server `?category=` (`:37-43, :98-113`); unread count; **"Mark all read" header action** (`:117-124`); tap marks item read in background via POST `/notifications/:id/read` (`:126-144`); deep-link via `item.data.screen` (`:141-143`); pull-to-refresh; `ErrorState` + retry.

---

## Pair 11a — Membership Plans
`plans.js` (53) vs `PlansScreen.tsx` (461)

**Verdict: ⚠️ Feature-equal CRUD, but reversed safety gaps.**

- Both: list (name, duration_days, price) from `/settings`; add/edit/delete via POST/PATCH/DELETE `/plans`; same fields.
- **PWA: no role gating** — any logged-in staff sees Add/Edit/Delete (`:7, :33-35`). **Android gates edit UI behind `gym_owner`** (`:59, :196-216`) — staff get a view-only list. If the backend doesn't enforce this, PWA staff can mutate plans. (Security-relevant.)
- **Delete confirm: PWA asks** (`showConfirm`, `:37-40`); **Android deletes immediately on tap** (`:150-162`) — no confirmation.
- Android: inline add/edit cards (`:237-290, :163-230`), notice banners (`:235-248`), `ErrorState` + retry. PWA: full-width form, toasts.

## Pair 11b — Staff Management
`staff.js` (316) vs `StaffScreen.tsx` (546)

**Verdict: ✅ near parity — same flows, one safety gap on Android.**

- Both: list (avatar, name, email, Owner/Staff badge, Inactive badge); add modal (name, phone, email, role staff/gym_owner, temp password); **invite success modal** with temp credentials + Share-via-WhatsApp (`invite_whatsapp_url`); action sheet: Reset Password + Deactivate/Activate.
- Differences:
  - Android list shows **"Last login: …"** (`:200-202`); PWA doesn't.
  - Android role = segmented chips; PWA = dropdown. Cosmetic.
  - **Android performs Deactivate/Reset Password immediately — no confirmation** (`:126-147`). PWA asks confirm for both, with the "They will not be able to log in" warning (`:234-284`).
  - Android add modal has no Cancel button (only X); PWA has Close + Cancel. Minor.

## Pair 11c — Reports
`reports.js` (38) vs `ReportsScreen.tsx` (187)

**Verdict: ⚠️ different slices of the same endpoint — and the response contracts differ.**

- PWA: fixed snapshot — 4 metric cards (Active / Expired / Total / **New This Month**) + Revenue (Today / Week / **Month**) + Renewals (renewed_this_month, recovery_rate%) + WhatsApp (sent_today, **total_sent**). Flat keys (`d.total_active`, `d.revenue_today`, `d.renewals.recovery_rate`…).
- Android: **period selector Today / 7 Days / 30 Days** (`?period=`, `:44-62`) — Members (Total/Active/Expired/New), Revenue (Collected / **Pending** / **At Risk 7d**), Renewals (Completed, Renewal Rate), WhatsApp (**Sent / Failed**). Nested keys (`data.members.total`, `data.revenue.collected`…).
- **Contract mismatch:** both call `/api/mobile/v1/reports/summary` but parse different shapes. One of these two screens is broken against the real backend — verify which shape the API returns.
- PWA-only data: New This Month, revenue today/week/month, total WhatsApp sent. Android-only: period switching, pending revenue, at-risk revenue, WhatsApp failed count.

## Pair 11d — Subscription
`subscription.js` (34) vs `SubscriptionScreen.tsx` (774)

**Verdict: ⚠️ fundamentally different products (web status vs Play billing). PWA has no upgrade path.**

- PWA: read-only — plan name, status badge, next billing, member limit, amount (from `/subscription/status`, `:9-19`).
  - **Bug:** line 30 renders "Members Used" from `s.members_used`, but the normalize block (`:13-19`) never sets `members_used` — always false. Dead line.
- Android: full **Google Play billing** — entitlement status, billing catalog (Starter/Growth/Pro w/ feature lists `:33-72`), plan cards w/ Play prices, purchase → server verification → `finishTransaction`, restore purchases, deep-link to Play subscription management, failed-payment banner w/ retry, 14-day grace-period banner, trial notice, manual-billing notice, auto-renew disclosures.
- PWA offers no way to view plans, upgrade, or manage billing.

---

## Pair 12a — Live Access
`access.js` (350) vs `AccessScreen.tsx` (1179)

**Verdict: ✅ near parity — best-matched pair in Part C.** Both: device online/offline bar, Inside Now / Entries / Exits stats, + Check In (member search modal), failed-commands "Retry All", denied-events banner → denied tab, 5 filter tabs, inside list with Check Out, event list w/ type badges, 15s auto-refresh, manual check-in modal with debounced member search.

Differences:
- Android has **no back button / header actions** (tab screen `:564-581`); check-in lives in content; refresh is pull-to-refresh. PWA has header Check In + Refresh actions (`:313-320`).
- **Search boxes** on Android events + inside tabs (`:589-624`); PWA none.
- **Infinite scroll** pagination on Android events (`:248-262`); PWA fixed per_page.
- Android-only: **legacy bridge banner** ("bridge doesn't report entry/exit direction", `:396-406`); **"Membership expired" reason** on denied events (`:444-450`); action result banner (`:287-296`); denied events show "Last event … ago" vs PWA's heartbeat fallback (`:33`).
- PWA-only: **tabs carry counts** ("Inside (3)", "Entries (12)") (`:171-182`); **every event row navigates to member detail** (`:207-212`) — Android event rows are NOT tappable, only inside members are (`:477-510`); **stat cards are clickable** to switch tabs (`:195-197`); offline dot is gray vs Android red (`:569`); tip box for empty state (`:163-167`).

## Pair 12b — Gym Profile
`gym-profile.js` (36) vs `EditGymProfileScreen.tsx` (96)

**Verdict: ✅ parity.** Same 5 fields (name, email, phone, address, timezone, default Asia/Kolkata), same `/settings` GET/PATCH, name-required validation, save → back. Differences: header "Gym Profile" vs "Edit Gym Profile"; Android shows inline error text (`:68`), PWA toasts; Android sends `null` for empties, PWA sends `''` (`:51-57`); PWA reads `res.data.settings || res.data`, Android reads `res.data.gym` — minor contract nuance.

---

## Pair 13a — Member Scan
`member-scan.js` (35) vs `MemberScanScreen.tsx` (539)

**Verdict: ⚠️ Android multi-page + guidance; PWA has the camera the Android lacks.**

| Feature | PWA | Android |
|---|---|---|
| Capture | ✅ **"Take Photo"** w/ camera (`capture="environment"` `:12-15`) + gallery picker (`:17-22`) | Document picker only (`:49-94`) — **no camera capture** |
| Multi-page | ❌ single image | ✅ up to 5 pages, thumbnails w/ page badges, remove (`:93, :151-174`) |
| File size guard | ❌ | ✅ 5MB/image (`:58`) |
| Processing UX | spinner "Analyzing image with AI…" (`:25`) | stepped progress messages (`:118-124`), 5–15s note |
| Error fallbacks | toast only | error card: Try Again / **Use CSV Instead** / **Add Manually** (`:283-299`) |
| Tips card | ❌ | ✅ (`:309-325`) |
- **Contract nuance:** PWA POSTs multipart `FormData(image)`; Android POSTs JSON `{images: [{data: base64, mime_type, filename}]}` to the same `/api/mobile/v1/members/scan`. Backend must accept both.
- Android → `onScanComplete` (parent routes to review); PWA → `navigate.replace('member-scan-review', {members: JSON.stringify(...)})`.

## Pair 13b — Scan Review
`member-scan-review.js` (36) vs `MemberScanReviewScreen.tsx` (945)

**Verdict: ❌ Android is a full QA station; PWA is a flat editable table.**

- PWA (`:11-33`): table with inline-editable Name/Phone/Plan inputs, one "Import N Members" button → POST `/members/batch-create` `{members}` → double `navigate.pop()` on success.
- Android: **extraction summary** (Total / Ready / Needs Review / Duplicates, `:137-159`); **bulk select** (Select Ready / Select All / Clear, `:160-170`); **filter tabs** All/Ready/Review/Duplicates (`:162-184`); per-member cards w/ select checkbox, edit modal, remove (`:186-215+`); **edit re-evaluates readiness** (`:95-110`); import blocked for incomplete rows with alert (`:116-134`); **selective import** of only selected members w/ rich payload (name/phone/email/plan_id/membership_start/membership_end/status/amount/notes, `:119-129`); **success modal** → View Members / View Renewals (`:188-195`).
- PWA sends raw `{name, phone, plan}` strings; Android maps to `plan_id` and dates. **PWA imports everything blindly — including duplicates and phone-less rows.**

---

## Pair 14 — Owner Finance & Owner Leads (PWA-only)
**Verdict: ❌ BOTH SCREENS ARE MISSING ON ANDROID.**

No Android screen, route, or component references `owner-finance`, `owner-leads`, `/owner/finance`, `/owner/leads`, or `/owner/cash-close` (only a stray `cash_close` type in `RrrGrowthScreen.tsx:18`, unused for UI).

What PWA has that Android users cannot reach:
- `owner-finance.js` (39): daily collections hero (collected today), cash expected / pending verification / last-7-days cards, today-by-payment-method breakdown, **cash-close recording** (POST `/api/mobile/v1/owner/cash-close`) with counted-cash, notes, variance display.
- `owner-leads.js` (129): "Leads & trial visits" pipeline — summary (New / Open / Trials booked), **Add lead** form (name, phone, source walk-in/phone/referral/instagram/google/whatsapp/other, next follow-up datetime, interested plan, notes, trial-requested checkbox).

Note: the AI-leads surface exists on Android (BotLeadsScreen + WhatsApp "AI Leads" tab) but the **manual front-desk lead capture** (walk-ins/phone enquiries) and the **cash reconciliation** workflows have no Android equivalent.

## Pair 15 — Registration
`RegistrationScreen.tsx` (153) vs PWA `signup.js`

**Verdict: ❌ RegistrationScreen is a DEAD screen; and it is NOT the member-login equivalent.**

- Android `RegistrationScreen` = **gym-owner account registration wizard**: Step 1 owner details (name/email/phone/password 12+ chars w/ complexity), Step 2 gym name, Step 3 country+c timezone+currency (IN/AE/GB/AU/US), Step 4 success w/ billing catalog plan selection + explicit warning that "Google Play checkout is intentionally unavailable" (`:108-110`) → "Continue with trial" → `onRegistered`. **Zero references to it anywhere else in `src/` — unreachable.**
- Its true PWA counterpart is **`signup.js`** (single form: full name, email, phone, password "Min 6 characters", gym name, country dropdown → auto-login on success). Differences vs PWA signup: wizard vs single form; 12-char password policy vs "min 6"; country codes w/ currency+timezone vs country names; ends on trial with plan selection vs immediate login.
- The PWA **member** login (`member-login.js`, OTP via WhatsApp → member-home) maps to Android **`MemberLoginScreen.tsx`** (`screens/member/`), which exists — not to RegistrationScreen.
- The live Android owner-signup path is **`SignupScreen.tsx`** (2-step + Google login, also reachable). So Android has two signup implementations and the reachable one is SignupScreen.

---

## Cross-cutting findings

### C1. Dead (unreachable) screens on Android — P0
`BotTestScreen` and `RegistrationScreen` have **zero references** in `src/` (verified 2026-10-11). BotTest is the worse one: PWA users reach it from AI Receptionist, Android users can't reach it at all — AI owners have no bot sandbox on Android.

### C2. API contract mismatches — P0
| Endpoint | PWA | Android |
|---|---|---|
| `/bot/overview` vs `/bot/stats` + `/bot/config` | PWA | Android |
| `/reports/summary` | flat keys (`total_active`, `revenue_today`) | nested keys (`members.total`, `revenue.collected`) + `?period=` |
| `/inbox` | `data.messages` | `data.conversations` + `data.summary` |
| `/members/scan` | multipart `FormData(image)` | JSON `{images:[{base64}]}` |
| `/campaigns` (create) | `{name, segment, template_id, message}` → sends immediately | `{name, campaign_type, promo_preset, template_name, segment_type, imported_contacts, exclude_recent}` → separate `POST /:id/send` |
| `/settings` | `res.data.settings \|\| res.data` | `res.data.gym` |

At least `/reports/summary` is guaranteed broken on one side; verify the others against the backend.

### C3. Missing role gating on PWA, missing confirmations on Android — P1
- PWA `plans.js`: staff (non-owner) can add/edit/delete plans. Android gates behind `gym_owner`.
- PWA `bot-setup.js`: anyone can PATCH bot config. Android gates behind `gym_owner`.
- Android deletes plans and deactivates/resets staff passwords **with no confirmation dialog**; PWA asks for both. Immediate-delete on a phone tap is the riskier direction.

### C4. Silent failures on PWA bot surfaces — P1
`bot-overview.js:8`, `bot-conversations.js:13`, `bot-leads.js:9` render empty/blank states when the API fails — the owner sees "No conversations" instead of an error. Android consistently shows retry-capable error states.

### C5. PWA-only capabilities with no Android path — P1/P2
- Lead → "Convert to Member" + WhatsApp deep link (`bot-lead-detail.js:33-34`).
- Bot handover take-over is Android-only; but Android's bot *test* is unreachable (C1) — net: **no client can both test the bot and take over chats from PWA alone** (test on PWA, take-over on Android).
- Campaigns "Get New Members" (Meta/IG ads) is "Coming Soon" on Android only — no PWA mention.
- Android `lead_captured` from `/bot/test` is fetched but never rendered (`BotTestScreen.tsx:23-30`).

### C6. Minor
- `subscription.js:30` dead line: "Members Used" reads `s.members_used`, never set (`:13-19`).
- Android Android tab screens (Inbox, Access) have no back button — intended as tab roots; fine, but Access from settings deep-link relies on it being a tab.
- PWA event rows in Access navigate to member detail; Android's don't (Pair 12a).
- Header title drift: "AI Receptionist" vs "WhatsApp AI Receptionist"; "Gym Profile" vs "Edit Gym Profile"; "WhatsApp" vs "WhatsApp & Broadcasts".

## Priority fix list (production)

| # | Issue | Impact |
|---|---|---|
| P0 | Wire `BotTestScreen` into Android navigation (or delete) | Feature exists on PWA, unreachable on Android |
| P0 | Build Android owner-finance + owner-leads, or confirm intentionally dropped | Cash-close + front-desk lead capture absent on Android |
| P0 | Resolve `/reports/summary` contract (flat vs nested) | One side's Reports screen is broken |
| P1 | Add `gym_owner` gating (or backend enforcement) to PWA plans + bot-setup | Staff could mutate plans/bot config from PWA |
| P1 | Add delete/deactivate/reset-password confirms on Android | One-tap destructive actions |
| P1 | Add "Convert to Member" + WhatsApp link to Android lead detail | Core lead→member workflow missing |
| P1 | Verify `/members/scan` accepts both multipart and base64 JSON | Scan import may fail on one client |
| P2 | PWA error states instead of fake "No conversations/leads" | Misleading empty states |
| P2 | Render `lead_captured` in Android bot test result | Already fetched |
| P2 | PWA "Members Used" dead line in subscription.js | Dead code |
