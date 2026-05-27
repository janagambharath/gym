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

For production, keep `ENABLE_SCHEDULER=false` on web workers and run reminders from exactly one Railway cron/worker process:

```bash
flask --app app:create_app run-reminders
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
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

Each gym can upload a QR image or provide a public QR URL. Authenticated users can view uploaded QR files through `/uploads`; WhatsApp delivery uses a signed 24-hour media URL or the configured public QR URL.
Meta delivery status callbacks are handled at `/webhook/whatsapp`.

## Tenant safety

Tenant-facing routes use `current_user.gym_id` and tenant repositories for object lookup. Super admin routes live under `/admin` and require the `super_admin` role. Suspended gyms are blocked from tenant dashboards.
