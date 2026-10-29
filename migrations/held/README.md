# Held migrations — NOT applied by `alembic upgrade heads`

## e7f8a9b0c1d2_unique_adms_serial.py (M7)

Partial unique index on `(connector_type, device_serial)` for
`adms_direct` rows — the DB-level enforcement of the one-machine-one-gym
rule. Held per `ADMS_FIXES_REPORT.md` §8.2: it ships only after Bharath
decides the one-machine-one-gym rule AND a prod duplicate-serial check
passes (the implementation aborts listing duplicates, never deletes
rows).

**How the hold is implemented:** the deploy pipeline (snapshot pushes)
cannot delete files, so the copy in `migrations/versions/` was replaced
with a documented no-op keeping the same revision id — alembic stamps it
as applied and it changes nothing. Because of that stamp, do NOT
re-activate this revision id later. To enable the rule, create a NEW
migration (new revision id, down_revision = current head) with the
duplicate check + partial unique index from the implementation below,
and run the prod duplicate-serial check first.

**Real implementation:** `e7f8a9b0c1d2_unique_adms_serial.py` in this
directory (identical to the original `migrations/versions/` file before
it was replaced with the no-op).

The runtime fail-closed duplicate check in `app/adms/routes.py` works
without this index and is unaffected by the hold.
