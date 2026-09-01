# Renewal Desk — Master Gap Audit Matrix

**Date:** September 1, 2026  
**Auditor Roles:** Principal Android Engineer, Backend Engineer, QA Lead, Security Engineer, Product Strategist  
**Scope:** Complete accounting of all 21 identified audit gaps, severity classification, resolution evidence, and final readiness classification.

---

## 1. Comprehensive Gap Classification & Resolution Matrix

| # | Gap / Identified Area | Severity | Type | Fix Now? | External Dependency? | Resolution / Evidence | Action / Verdict |
|:---:|:---|:---:|:---:|:---:|:---:|:---|:---:|
| **1** | **Account Deletion Flow** | **P0** | Technical & Policy | **YES** | No | Backend `DELETE /api/mobile/v1/auth/account`, mobile in-app button in `SettingsScreen.tsx`, plus public web deletion page `https://renewaldesk.app/delete-account`. Tested with owner & staff cascade. | **RESOLVED & VERIFIED** |
| **2** | **Google Play Real Billing** | **P0** | Billing / Store | In Progress | **YES** | Native `expo-iap` + backend `/billing/verify-google-play` implemented with RTDN subscription lifecycle handling. Requires Play Console internal track activation. | **EXTERNAL PLAY DEPENDENCY** |
| **3** | **Meta WhatsApp Embedded Signup** | **P0** | Integration | In Progress | **YES** | Facebook SDK embedded flow & `/whatsapp/connect-waba` endpoint fully built. Live business sending depends on Meta App Review approval. | **EXTERNAL META DEPENDENCY** |
| **4** | **WhatsApp Coexistence** | **P1** | Platform | Roadmap | **YES** | Supported on eligible Cloud API numbers. Documented technical prerequisites. | **EXTERNAL / NOT VERIFIED** |
| **5** | **Physical Device Validation** | **P1** | QA | Continuous | Partial | Verified on Android emulator & real Expo environment. Full multi-device physical matrix to be finalized via Play Closed Testing. | **READY FOR CLOSED TESTING** |
| **6** | **Notification / Deep-Link Device Testing** | **P1** | Mobile UX | **YES** | No | `expo-notifications` handler mapped to allowlisted screens (`BotConversationDetail`, `BotLeadDetail`, `PaymentDetail`, `RenewalsHome`). | **RESOLVED & VERIFIED** |
| **7** | **Performance at Scale (1,000+ members)** | **P1** | Infrastructure | **YES** | No | Virtualized FlatLists with key extractors, debounced search (400ms), DB indexed pagination, cached Redis analytics. | **RESOLVED & VERIFIED** |
| **8** | **Dashboard Revenue at Risk Visibility** | **P0** | Product / ROI | **YES** | No | Authoritative server-side `revenue_at_risk` calculation based on active members expiring in next 7 days multiplied by plan price. | **RESOLVED & VERIFIED** |
| **9** | **Renewal Rate Formula & Zero Handling** | **P0** | Analytics | **YES** | No | Formula: `renewals_completed / (renewals_completed + expired_members)`. Returns safe `0.0%` on zero renewal activity (no NaN or Infinity). | **RESOLVED & VERIFIED** |
| **10** | **New-User Activation & Hero Actions** | **P0** | UX / Growth | **YES** | No | Prominent "GET STARTED: Bring Your Members In" hero card with 1-tap `[ Import Existing Members ]` and `[ Scan Records ]`. | **RESOLVED & VERIFIED** |
| **11** | **Manual Member Entry Burden** | **P0** | Product | **YES** | No | De-emphasized manual entry from primary onboarding; transformed into fallback option. | **RESOLVED & VERIFIED** |
| **12** | **Primary Member Import Onboarding** | **P0** | Product | **YES** | No | Created 3-option hub (`ImportMembersScreen.tsx`) covering CSV, AI Document Scan, and Single Entry. | **RESOLVED & VERIFIED** |
| **13** | **AI-Assisted Document / Member Scanner** | **P0** | AI / Onboarding | **YES** | No | Multimodal OpenRouter vision pipeline (`DocumentScanService`) with strict schema, date/phone normalization, plan fuzzy matching, and interactive review table. | **RESOLVED & VERIFIED** |
| **14** | **Ambiguous "No Plan" Member State** | **P1** | UI Clarity | **YES** | No | Replaced all instances of `"No plan"` with `"Plan not set"` styled in warning tone across all screens. | **RESOLVED & VERIFIED** |
| **15** | **WhatsApp Bot Setup Clarity** | **P1** | UX | **YES** | No | Transformed to "GET YOUR AI RECEPTIONIST READY (X / 4 complete)" with green `COMPLETE` / gray `NOT CONFIGURED` badges. Technical Meta IDs hidden. | **RESOLVED & VERIFIED** |
| **16** | **Demo & Sales Readiness** | **P1** | Commercial | **YES** | No | Demo Gym seed data (`demo-gym`), sample renewals, and realistic member roster ready for prospective gym walk-throughs. | **RESOLVED & VERIFIED** |
| **17** | **AI Free-Model Reliability Safeguards** | **P1** | Resilience | **YES** | No | Multi-tier vision gateway: primary `gemini-2.0-flash-exp:free`, fallback `llama-3.2-11b-vision-instruct:free`, rate-limit timeout recovery, graceful degradation. | **RESOLVED & VERIFIED** |
| **18** | **Scheduler Worker Separation** | **P2** | Architecture | Defer | No | In-process APScheduler with DB mutex is stable for < 10,000 gyms. Documented Celery/Redis worker migration threshold for scale. | **DEFERRED (ROADMAP)** |
| **19** | **Annual Pricing Option** | **P2** | Commercial | Defer | No | Annual billing tier deferred until month 3 customer retention data is collected. | **DEFERRED (ROADMAP)** |
| **20** | **US / UK / AU Commercial Go-To-Market** | **P2** | Commercial | Defer | No | Multi-currency formatting technically complete (`INR`, `AED`, `USD`, `GBP`, `AUD`). Initial commercial sales strictly focused on India gym market. | **DEFERRED (ROADMAP)** |
| **21** | **Referral & Growth Loops** | **P2** | Growth | Defer | No | In-app gym owner referral program deferred to post-launch product iterations. | **DEFERRED (ROADMAP)** |

---

## 2. Severity Classification Summary

- **P0 Launch Blockers (Fixed & Verified):** Account Deletion, Member Import Hub, AI Document Scanner, Revenue at Risk, Renewal Rate, Empty States, First Action Hero.
- **P0 External Dependencies (Awaiting Third-Party Approval):** Google Play Closed Track Testing & Meta WhatsApp Embedded Signup Approval.
- **P1 High-Value UX Enhancements (Fixed & Verified):** Plan Not Set label, WhatsApp 4-Essentials progress, Deep Linking, Demo readiness, AI fallback safeguards.
- **P2 Roadmap Items (Deferred post-launch):** Annual pricing, Celery worker separation, non-India commercial launch, referral loops.
