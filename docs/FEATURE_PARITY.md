# Renewal Desk — Web & Mobile Feature Parity Matrix
**Date:** August 26, 2026  
**Target:** 100% Operational Feature Parity & Desktop Synergy

---

## 1. Feature Parity Matrix

| Feature Domain | Feature Description | Android App | Existing Web | Backend Service | Permissions | Upgrade Status | Missing on Web | Priority |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **Auth & Profile** | Login / Logout / Lockout | YES | YES | `app.auth` | All | **PARITY** | Account lockout timer UI | P2 |
| **Dashboard** | Urgent Attention Center | YES | Partial | `app.services.analytics` | Owner/Staff | **UPGRADED** | Urgent attention cards & health badges | P0 |
| **Members** | List, Search, Filter | YES | YES | `app.members` | Owner/Staff | **PARITY** | Desktop bulk filter & biometrics badge | P1 |
| **Member Detail** | Profile & Access State | YES | Partial | `app.members` | Owner/Staff | **UPGRADED** | Biometric Access Control card | P0 |
| **Member CRUD** | Add / Edit / Soft Delete | YES | YES | `app.members` | Owner/Staff | **PARITY** | Complete | P1 |
| **Member Import** | CSV Import with validation | NO | YES | `app.members_import` | Owner/Staff | **UPGRADED** | Column mapping & error breakdown | P1 |
| **Plans** | Create, List, Edit Plans | YES | YES | `app.gym` | Owner | **PARITY** | Complete | P2 |
| **Renewals** | Expiring / Expired views | YES | YES | `app.members` | Owner/Staff | **PARITY** | 1-click renewal calculation preview | P1 |
| **Payments** | Record Manual Payment | YES | YES | `app.payments` | Owner/Staff | **PARITY** | Complete | P1 |
| **Payment Verify** | Verify & Extend Expiry | YES | YES | `app.services.payment` | Owner/Staff | **PARITY** | Confirmation modal with new expiry | P0 |
| **Financial Safety**| Immutable Rejection/Void | Partial | Partial | `app.payments` | Owner | **UPGRADED** | Soft-void & reverse status logging | P0 |
| **WhatsApp Reminders**| Reminders Log & Resend | YES | YES | `app.reminders` | Owner/Staff | **PARITY** | Live delivery status decoding | P1 |
| **Broadcasts** | Bulk Announcements | YES | YES | `app.services.broadcast` | Owner/Staff | **PARITY** | Live WhatsApp preview bubble | P1 |
| **WhatsApp AI Desk**| Split-View Chat Inbox | YES | NO | `app.models.bot` | Owner/Staff | **ADDED** | Split-view desktop chat interface | P0 |
| **Human Handover** | Takeover toggle & reply | YES | NO | `app.services.bot` | Owner/Staff | **ADDED** | 1-click takeover button & manual send | P0 |
| **Lead Pipeline** | Captured leads management | YES | NO | `app.models.bot` | Owner/Staff | **ADDED** | Leads pipeline table & status editor | P0 |
| **Bot Knowledge** | FAQs, Hours, Trial config | YES | NO | `app.models.bot` | Owner | **ADDED** | Bot knowledge base web forms | P0 |
| **Biometric Console**| Bridge & Device Health | Partial | NO | `app.bridge` | Owner/Staff | **ADDED** | Dedicated Biometric Control Center | P0 |
| **Biometric Queue** | Leased Commands Inspector | NO | NO | `app.models.bridge` | Owner/Staff | **ADDED** | Command queue viewer & retry trigger | P0 |
| **Biometric Activity**| Live Attendance Punches | NO | NO | `app.models.bridge` | Owner/Staff | **ADDED** | Real-time punch log viewer | P0 |
| **Biometric Pairing**| 5-Minute Pairing Wizard | NO | NO | `app.services.bridge` | Owner | **ADDED** | Pairing code generator & assistant | P0 |
| **Global Search** | Ctrl + K Quick Search | NO | NO | `app.services.search` | Owner/Staff | **ADDED** | Global search across all entities | P1 |
| **Issues Center** | Centralized Failure Hub | NO | NO | `app.services.audit` | Owner/Staff | **ADDED** | Operations & recovery dashboard | P1 |
| **Reports** | Business Funnel Outcomes | Partial | Partial | `app.services.analytics` | Owner | **UPGRADED** | Renewal recovery & lead funnel charts | P1 |
| **Staff Admin** | Add / Manage Staff Users | YES | YES | `app.gym.staff` | Owner | **PARITY** | Complete | P2 |
| **QR & UPI Setup** | Upload QR / Set UPI ID | YES | YES | `app.gym` | Owner | **PARITY** | Complete | P2 |
