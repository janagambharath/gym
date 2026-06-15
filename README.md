# RenewalDesk

Multi-tenant Flask SaaS platform for gym membership renewal tracking, manual payment verification, QR payment attachment, and WhatsApp renewal reminders.

## What is included

- Flask app factory with Blueprints for auth, tenant dashboard, members, payments, reminders, and super admin.
- SQLAlchemy tenant-safe models: `Gym`, `User`, `Member`, `MembershipPlan`, `RenewalHistory`, `ReminderLog`, `PaymentVerification`, `QRSettings`, `NotificationTemplate`, `AuditLog`.
- Every tenant business table carries `gym_id`, with route queries scoped to `current_user.gym_id`.
- Role-based access for `super_admin`, `gym_owner`, and `staff`.
- Flask-WTF CSRF-protected forms, secure password hashing, secure QR uploads, and audit logs.
- APScheduler reminder scan plus `flask run-reminders` one-shot command for worker/cron deployment.
- WhatsApp Cloud API service with QR image attachment support.
- Bootstrap/Jinja responsive SaaS dashboard UI.
- Railway/Gunicorn/PostgreSQL-ready deployment files.

## Local setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Set `DATABASE_URL` in `.env`. For quick local development you can omit it and the app will use SQLite.

```bash
flask --app app:create_app db upgrade
set DEFAULT_ADMIN_PASSWORD=ChangeMe123!
flask --app app:create_app create-admin
flask --app app:create_app seed-demo
flask --app app:create_app run
```

When changing models later, create a new migration with:

```bash
flask --app app:create_app db migrate -m "Describe change"
flask --app app:create_app db upgrade
```

Demo tenant after `seed-demo`:

- Owner: `owner@example.com`
- Password: `ChangeMe123!`

Super admin after `create-admin` with the example password above:

- Admin: `admin@example.com`
- Password: `ChangeMe123!`

## Railway deployment

1. Create a Railway PostgreSQL database.
2. Set environment variables from `.env.example`.
3. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, and `PUBLIC_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` on the web service. Adjust `Postgres` and `Redis` to match the exact Railway service names.
4. Use the included `Procfile` or `railway.json` start command.
5. Run migrations:

```bash
flask --app app:create_app db upgrade
flask --app app:create_app create-admin
```

For production, the built-in scheduler is enabled by default and protected by a
Redis lock so only one web worker runs the scan. It runs once on startup and then
every 24 hours by default (`REMINDER_JOB_MINUTES=1440`). You can also run the
one-shot command from a Railway cron/worker process:

```bash
flask --app app:create_app run-reminders
flask --app app:create_app check-reminders-heartbeat
```

Check schema state before a deploy with:

```bash
scripts/db_check.sh
```

Migration rollback:

```bash
flask --app app:create_app db current
flask --app app:create_app db history
flask --app app:create_app db downgrade -1
flask --app app:create_app db downgrade b51c07904421
```

Daily database backups can run from a Railway cron service:

```bash
scripts/backup_db.sh
```

If `AWS_S3_BUCKET` is set, the backup script expects the AWS CLI to be available in that cron environment.

In development, `DevelopmentConfig` enables the in-process scheduler by default. If you run multiple local app processes, set `ENABLE_SCHEDULER=false`.

## WhatsApp

Set:

- `WHATSAPP_ENABLED=true`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

`WHATSAPP_ENABLED` is the platform-wide delivery switch. Each gym owner connects their
own Meta WhatsApp Business Account (WABA) ID, WhatsApp Business number, and Meta phone
number ID from the dashboard's WhatsApp Settings page. Saving an enabled connection
validates that the phone number belongs to the WABA and subscribes the app to that WABA's
webhook events with a WABA-specific callback override pointing to this deployment. The
server-side Meta access token must have permission to manage and send from each connected
WABA.

Each gym can upload a QR image or provide a public QR URL. Authenticated users can view uploaded QR files through `/uploads`; WhatsApp delivery uses a signed 24-hour media URL or the configured public QR URL when available, and falls back to a text reminder when no fetchable QR is configured or image delivery fails.
Meta inbound messages and delivery status callbacks are handled at `/webhook/whatsapp`.
Inbound messages from known members refresh Meta's 24-hour normal-message window and trigger
the configured welcome message on first contact. Scheduled renewal reminders scan all due
active members; members without an open 24-hour window are sent through the approved Meta
template when configured.

## Tenant safety

Tenant-facing routes use `current_user.gym_id` and tenant repositories for object lookup. Super admin routes live under `/admin` and require the `super_admin` role. Suspended gyms are blocked from tenant dashboards.
