# Backend Correctness Review (subagent, 2026-10-10)
## 1. CRITICAL — refresh_opportunities ~4 queries/member on every dashboard load (rrr_service.py:139-207) — 8000+ queries for 2000 members
## 2. CRITICAL — reject/cancel race verify: payment "rejected" while member renewed (payment_service.py:107-149, mobile_api/payments.py:470-483) — check-then-set vs FOR UPDATE
## 3. HIGH — Dead Redis scheduler lock starves reminders/expiry up to 48h (reminder_scheduler.py:28-100)
## 4. HIGH — No refund primitive; reversal is hard-delete; 'refunded' status never set (payment_verification.py:17, payment_service.py:118-135); campaign attribution not unwound
## 5. HIGH — delete_payment reverts membership but never calls queue_membership_command; door access retained (payment_service.py:118-135)
## 6. HIGH — Two ledgers: RenewalHistory without PaymentVerification; revenue vs collections diverge (renewals.py:116-320, members/routes.py:132-147)
## 7. HIGH — auto_expire runs from GET endpoints with row locks (reminder_service.py:94-122; members.py:278, gym/routes.py:53, members/routes.py:38)
## 8. HIGH — normalize_attendance TOCTOU on dedupe_key; ADMS path 500s (rrr_service.py:69-93, adms/routes.py:95-127)
## 9. HIGH — Plan price edits retroactively reprice revenue_at_risk; no price history (revenue_service.py:36-56; Member.price written never read)
## 10. HIGH — Push failures swallowed in scheduler (reminder_scheduler.py:199-203)
Honorable: lock-ordering deadlock (members/routes.py:101-113 vs reminder_service.py:105), Google Play verify 500 on retries, idempotency reuse 500 not 409, swallowing data migration, off-by-one document-scan expiry, send-before-commit WhatsApp dupes, create_or_get_log session rollback, inbox N+1, bulk_renew amount parser, dead code (due_members_for_gym, revenue_recovered_breakdown).
Verified safe: money math (Numeric, no float), verify_payment locking, bridge command queue, timezone handling, migrations (single head r7f9g0a1b2c3d, no bad add_column), no bare except in app/.
