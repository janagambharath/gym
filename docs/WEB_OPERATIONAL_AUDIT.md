# Renewal Desk — Web Operational Audit & Discovery
**Date:** August 26, 2026  
**Auditor:** Principal Software & Operations Architect  
**Scope:** Existing Web Application (`app/templates/`, `app/static/`, `app/`), Mobile Android Application (`renewal-desk-android/`), Backend Infrastructure (`app/`), and Biometric PC Bridge (`RenewalDeskBridge/`).

---

## 1. Executive Summary

Renewal Desk is an operational SaaS platform purpose-built for gym owners and front-desk staff. The platform consists of four interlocking subsystems:
1. **Flask + PostgreSQL Backend (`app/`)**: The single authoritative source of truth for multi-tenancy, memberships, financial verifications, WhatsApp Meta Cloud routing, AI Receptionist fallback, and Biometric Bridge command leasing.
2. **Android Mobile App (`renewal-desk-android/`)**: The mobile front-end for owners and staff, featuring 24 screens with offline resilience, push notifications, and fast renewal verification.
3. **Existing Web Control Panel (`app/templates/`, `app/static/`)**: The desktop front-end serving server-rendered Jinja2 views for dashboard metrics, member CRUD, payment verification, reminder triggers, announcements, and staff administration.
4. **Biometric PC Bridge (`RenewalDeskBridge/`)**: The C# .NET Windows desktop application currently running in production at **Yodha Fitness**, communicating over outbound HTTPS via Protocol Version 2 with eSSL / ZKTeco X990 hardware on TimeZone Slot 50 all-day-deny schedule.

---

## 2. Inventory of What Already Works

| Subsystem | Existing Working Capability | Source Location |
| :--- | :--- | :--- |
| **Authentication** | Session-based web login with CSRF protection, role verification (`gym_owner`, `staff`, `super_admin`), account lockout | `app/auth/routes.py` |
| **Members** | List, pagination, search, status filter, Add, Edit, Delete (soft), Hard Delete (owner), Bulk Renew, CSV Import, CSV Export | `app/members/routes.py`, `app/members/import_routes.py` |
| **Payments** | List, filter by status (`pending`, `verified`, `rejected`), Create Manual Payment (Cash, UPI, Bank Transfer), 1-click Verify, 1-click Reject | `app/payments/routes.py` |
| **Renewals** | Expiry date calculation (`max(today, prev_end + 1)`), renewal history recording, automatic biometric command creation | `app/services/payment_service.py` |
| **Reminders** | Reminders log list, status filter, Run Scan, Resend, Manual Test Send, friendly error decoding | `app/reminders/routes.py` |
| **Announcements** | Bulk broadcast composer with preset suggestions, target audience filter (`active`, `expired`, `all`) | `app/gym/routes.py` |
| **Plans & Staff** | Membership plan management (price, duration, active), staff user provisioning and deletion | `app/gym/routes.py`, `app/gym/staff_routes.py` |
| **QR Settings** | Gym UPI ID and QR image upload with WhatsApp media cache invalidation | `app/gym/routes.py` |
| **Biometric Bridge API**| Outbound HTTPS polling for leased commands (`enable_user`, `disable_user`), attendance punch ingestion, command acknowledgment with lease tokens | `app/bridge/routes.py` |
| **Biometric Hardware** | Yodha Fitness eSSL X990 integration via `zkemkeeper.dll` on TimeZone slot 50 all-day-deny schedule | `RenewalDeskBridge/` |

---

## 3. Gap Analysis: What Android Has That Web Does Not

| Feature | Android Status | Existing Web Status | Upgrade Priority |
| :--- | :--- | :--- | :---: |
| **Biometric Console** | Biometric status badge & sync indicator | Missing dedicated web console for bridge health, queue, & activity | **P0** |
| **WhatsApp AI Desk** | Full AI Bot overview, conversation list, live chat stream, lead pipeline, human takeover toggle | Missing web inbox and conversation browser | **P0** |
| **Bot Knowledge Setup** | Configure opening hours, FAQs, trial settings, map link | Missing on Web (only accessible via mobile API) | **P0** |
| **Operational Issues** | Error state badges on individual screens | Missing centralized Issues / Failure Recovery Center | **P1** |
| **Global Search** | Filter chips per screen | Missing desktop `Ctrl + K` global entity search | **P1** |
| **Setup Checklist** | Setup progress tracker | Missing first-time gym onboarding checklist | **P1** |
| **Reports Funnel** | Business performance charts | Web has basic counts, needs outcome funnels | **P1** |

---

## 4. Gap Analysis: What Web Has That Android Does Not

| Feature | Web Status | Value to Desktop Operator |
| :--- | :--- | :--- |
| **High-Density Table** | Full-width tabular layouts with multi-column sorting | Essential for rapid multi-member inspection |
| **Bulk Operations** | Bulk Renew and CSV Member Import / Export | Crucial for front-desk batch operations |
| **Super-Admin Portal** | Platform overview and tenant provisioning (`/admin/`) | Vital for SaaS platform maintenance |
| **Multi-Screen Space** | Wide workspace accommodating split panes and side drawers | Perfect for simultaneous chat + profile handling |

---

## 5. Architectural Non-Negotiables

1. **Zero Duplicate Business Logic:** All calculations for member status, expiration dates, renewal periods, and payment validations must continue to call `app.services` (`payment_service.py`, `reminder_service.py`, `timezone_service.py`).
2. **Preserve Yodha Fitness Bridge Setup:** The C# bridge protocol v2, request headers (`X-Api-Key`, `X-RenewalDesk-Bridge-Protocol: 2`, `X-Device-Serial`), and backend endpoints (`/api/bridge/v1/...`) must remain 100% untouched and functional.
3. **Immutable Financial History:** Replace destructive payment deletion with immutable `voided` / `rejected` statuses accompanied by actor and timestamp logging.
4. **Desktop-First Ergonomics:** Enhance the existing Jinja2 templates and CSS with modern cards, responsive sidebars, split-view conversation panes, live status pills, and global search modals.
