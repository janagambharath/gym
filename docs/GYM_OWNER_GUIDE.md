# RENEWAL DESK — GYM OWNER'S OPERATING MANUAL
**For Gym Owners & Front Desk Managers**  

---

## 1. Getting Started: Accessing Your Gym Console

1. **Receive Credentials:** Your Renewal Desk platform administrator creates your account and provides you with your secure **Login Email** and **Initial Password**.
2. **Log In:** Open your browser and navigate to `https://app.renewaldesk.com/auth/login`.
3. **Change Password:** On your first login, navigate to **Profile Settings** and update your password to a strong personal passphrase.

---

## 2. The 5-Step First-Time Gym Setup Checklist

Your main dashboard displays a live onboarding checklist:

1. **Configure Gym Profile:** Ensure your gym name, contact phone, opening hours, and address are accurate (`/gym/settings`).
2. **Create Membership Plans:** Set up your standard pricing packages, e.g. Monthly (₹1,500), Quarterly (₹4,000), Annual (₹12,000) (`/gym/plans`).
3. **Import Existing Members:** Upload your member list using our CSV Import tool (`/members/import`). The system automatically validates phone numbers, skips duplicates, and assigns Batch IDs for safe rollbacks.
4. **Pair Biometric Bridge:** Download the desktop bridge installer, copy your unique pairing token from `/biometric/settings`, and connect your front-desk PC to the turnstile.
5. **Set Up WhatsApp AI Receptionist:** Enter your gym's FAQs, trial duration, and pricing knowledge base (`/bot/setup`).

---

## 3. Daily Front Desk Operations

### A. Member Management & Biometric Turnstile Access
- **Find Members:** Use the global keyboard shortcut `Ctrl + K` (or `Cmd + K` on Mac) to search by name, phone number, or biometric ID from anywhere in the app.
- **Biometric Card:** Open any member profile to view their **Biometric Access Card**. If a member pays at the desk, their turnstile access is updated in real time.
- **Filter Views:** Use quick filter chips on `/members/` to see:
  - *All Members*
  - *Active Members*
  - *Expiring in 3 Days*
  - *Expired / Access Blocked*

---

### B. Payment Recording & Renewal Reconciliation
1. Navigate to `/payments/create?member_id=123`.
2. Enter the amount received, payment method (UPI / Cash / Card), and reference transaction ID.
3. Select renewal duration (e.g. 30 days, 90 days).
4. *(Optional)* Attach screenshot of UPI payment confirmation for accounting records.
5. Click **Verify & Activate Membership**.
6. **Result:**
   - Membership validity extended immediately.
   - Biometric access unblocked on turnstile.
   - WhatsApp payment receipt sent to member automatically.

---

### C. WhatsApp AI Receptionist & Human Takeover Desk
- Open the **Split-Pane Inbox** at `/bot/inbox`.
- **AI Automation:** When unknown prospects message your gym WhatsApp, the AI automatically answers pricing, location, timings, and books trial passes.
- **Human Takeover:** Click **Take Over (Human)** to pause the AI instantly whenever a customer asks for custom packages or personal trainer consultations.
- **Send Direct Reply:** Type in the chat box to send WhatsApp messages directly from the web panel without needing a physical phone.

---

### D. Operational Incident Hub & Recovery
- If any automated reminder fails, a payment is unverified, or the front-desk PC loses internet connectivity, the **Incident Hub** (`/operations/issues`) highlights the exact issue with 1-click recovery actions.
