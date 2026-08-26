# RENEWAL DESK — PRODUCTION INCIDENT & OPERATIONS RUNBOOK
**Classification:** DevOps & Site Reliability Engineering (SRE) Runbook  

---

## 1. High-Priority Alert Triggers & Action Thresholds

| Component | Trigger Condition | Severity | Automated Action | Staff Runbook Action |
| :--- | :--- | :--- | :--- | :--- |
| **Biometric Bridge** | Heartbeat age > 120s | **WARNING** | Health bar turns Amber on Web Console | Check front-desk PC power & LAN cable |
| **Biometric Bridge** | Heartbeat age > 600s | **CRITICAL** | Urgent Attention item on Dashboard | Contact gym owner; verify Windows Service |
| **Command Queue** | Failed commands > 5 | **WARNING** | Listed on `/biometric/commands` | Click "Retry All" or check device LAN IP |
| **WhatsApp Service** | 3 consecutive failures | **WARNING** | Listed in Incident Center (`/operations/issues`) | Check Meta Cloud API token expiry / WABA status |
| **Unverified Payments**| Pending verification > 24h| **INFO** | Highlighted on Dashboard | Owner reviews payment proof & clicks Verify |
| **Account Security** | Failed logins >= 3 | **SECURITY** | Sentry alert & exponential delay | Account locks after threshold; Owner/Admin reset |

---

## 2. Notification Grouping & Alert Fatigue Mitigation

To prevent notification spam for gym owners:
- **Biometric Failures:** Instead of sending 20 push notifications for 20 failed commands when a gate is unplugged, the system groups them into a single consolidated summary:  
  *“20 biometric updates queued — Bridge 'Main Entrance' is currently offline.”*
- **WhatsApp Webhook Retries:** Meta delivery status webhooks are deduplicated using `provider_message_id` with idempotent SQL transactions.

---

## 3. Production Deployment & Rollout Runbook

### Prerequisites
- Python 3.11+ / 3.13
- PostgreSQL 15+
- Redis 7+ (for async tasks/caching)
- Node.js LTS (for static assets if bundling)

### Environment Configuration Checklist
```ini
FLASK_ENV=production
SECRET_KEY=<strong_random_secret_64_chars>
DATABASE_URL=postgresql://user:pass@db-host:5432/renewaldesk_prod
REDIS_URL=redis://redis-host:6379/0
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=<meta_cloud_access_token>
WHATSAPP_VERIFY_TOKEN=<meta_webhook_verify_token>
PUBLIC_BASE_URL=https://app.renewaldesk.com
```

### Zero-Downtime Deployment Sequence
```bash
# 1. Pull latest verified release commit
git pull origin main

# 2. Update dependencies
pip install -r requirements.txt

# 3. Apply database migrations
flask db upgrade

# 4. Graceful worker reload (Gunicorn / uWSGI)
systemctl reload renewaldesk-web

# 5. Health Check Verification
curl -I https://app.renewaldesk.com/healthz
```
