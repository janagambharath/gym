# PWA Frontend Review (subagent, 2026-10-10)
## 1. CRITICAL — Member OTP login drops the JWT (member-login.js:51); in-PWA member app broken / privilege confusion
## 2. HIGH — Payment Verify no double-submit protection (payment-detail.js:37-40)
## 3. HIGH — Idempotency key regenerated per attempt (record-payment.js:48, renew-member.js:36) — double payments on retry
## 4. MEDIUM — OS back gesture exits app; pushState never called (router.js:44-48)
## 5. MEDIUM — Dead screens: dashboard.js, import-members.js, fast-renewal.js (latter has unguarded verify)
## 6. MEDIUM — Viewport blocks pinch-zoom (index.html:5)
## 7. MEDIUM — Tokens in localStorage (session.js)
## 8. MEDIUM — Cash-close double-submit; QR upload no timeout (owner-finance.js:27-32, api.js uploadPaymentQrImage)
## 9. LOW — OTP no resend (member-login.js:63-70)
## 10. LOW — .btn-sm 36px (components.css:472)
OK: destructive confirms, login, logout, PII hygiene, SW autoUpdate sound, api.js timeout/refresh handling.
Fix order: #1, #3, #2, #5, #4, #8, then #6/#7/#9/#10.
