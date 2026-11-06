# Partial-state migrations: why the old files are NOT retrofitted (V6-L40)

## Decision (2026-11-06, fix-all v5+v6, worker A7)

23 pre-v3 migration files never got the inspector-guard convention
(every DDL statement guarded by an inspector check, the way the
v3/v4-era migrations do it). Retrofitting guards would require
editing 23 migrations that already ran live — forbidden by the
fix-all constraint (never edit a live migration). So they are
deliberately left as-is.

**Recovery path for a partial-state DB is restore-from-backup, not
re-run.** Alembic runs each migration in its own transaction, so a
mid-chain failure leaves earlier migrations recorded and the failed
one unrecorded — but re-running after fixing the cause re-executes
the failed migration from its first statement, and any DDL inside it
that already applied (e.g. a first `add_column` that succeeded before
a later `create_check_constraint` failed on existing data) now errors
with "duplicate column". That failure mode is confined to
partial-state replays (failed deploy, staging rebuild); it never
bites the healthy prod chain, which is why it survived this long.

## The files

Verified by mechanical scan (2026-11-06): every file below has
`add_column` in `upgrade()` with no `inspect(...)` /
`has_column` guard. Reproduce with: for each file in
`migrations/versions/`, check whether `upgrade()` contains
`add_column` while containing no inspector guard.

(The v6 review counted 23; this scan reproduces 22. The 23rd is
most plausibly `e1a2b3c4d5e6` — unguarded DDL of the same class but
an index, not `add_column` — which is repaired separately by
`v6l39duemembersidx` under V6-L39. If you find a 23rd
`add_column` file, add it here and say how you found it.)

1. `4c5d6e7f8a9b_add_deployment_center_and_bridge_v2.py`
2. `5d6e7f8a9b0c_add_is_test_to_payments_and_renewals.py`
3. `6a9206cd7b66_production_hardening_batch.py`
4. `9d2b4f7e8a13_production_audit_fixes.py` (also unguarded
   `create_check_constraint` in `upgrade()`, unguarded `drop_column`
   in `downgrade()`)
5. `a001_access_events.py`
6. `a2b3c4d5e6f7_allow_confirmed_fake_adms_member_test.py`
7. `a3c4d5e6f7a8_add_biometric_bridge.py`
8. `b9c1d4e6f8a0_payment_renewal_start_date.py`
9. `c4e7a1b2d903_add_per_gym_whatsapp_settings.py`
10. `c8d4e6a1f203_biometric_link_banner_setting.py`
11. `d7f3c9a8e214_add_gym_whatsapp_business_account_id.py`
12. `f2a1b3c4d5e7_add_last_inbound_at.py`
13. `f7a8b9c0d1e2_adms_device_auth_hardening.py`
14. `g1a2b3c4d5e6_add_campaigns.py`
15. `h1a2b3c4d5e7_add_campaign_type.py`
16. `i1a2b3c4d5e8_add_custom_pricing_and_channel_to_payments.py`
17. `j1a2b3c4d5e9_add_per_gym_whatsapp_token.py`
18. `m2b4c6d8e0f1_add_rrr_growth_system.py`
19. `q6e8f0a1b2c3d_add_owner_operations.py`
20. `t7v8w9x0y1z2_renewal_previous_start.py`
21. `u3v4w5x6y7z8_adms_path_token.py`
22. `y7z8a9b0c1d2_bridge_command_result_data.py`

## What IS guarded instead

* All v3/v4-era migrations use inspector guards (the convention).
* New repair migrations (`v5m15m17_repair_utr_partial_index`,
  `v5l44_repair_reject_cancel_fks`, `v6l39_repair_due_members_index`)
  are written inspector-checked and SQLite-safe.
* `migrations/env.py` refuses SQLite migration runs early (V6-M18):
  the chain contains Postgres-only SQL, so a fresh SQLite upgrade
  fails mid-chain. Tests build their schema with `db.create_all()`,
  not migrations.
