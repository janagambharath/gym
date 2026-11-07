import logging
from logging.config import fileConfig
import os
import sys

from flask import current_app

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
fileConfig(config.config_file_name)
logger = logging.getLogger('alembic.env')


# --- V6-M18: SQLite is not a migration target -------------------------
# The chain contains Postgres-only SQL (INTERVAL / ANY in
# 71e470eb6cb6_correct_yodha_punch_times, the ~ regex operator in
# c4a9012b3d4e_canonicalize_stored_enroll_numbers, and DATE(created_at)
# + INTERVAL '14 days' in 9d2b4f7e8a13_production_audit_fixes.py:28),
# so a fresh SQLite
# `flask db upgrade` dies mid-chain after ~50 migrations. Refuse early
# with a clear message instead. The default dev DB is SQLite
# (app/config.py) and the test suite builds its schema with
# db.create_all(), NOT migrations — neither is affected: this guard
# only fires for the `flask db upgrade|downgrade|migrate` verbs, so
# read-only commands (`current`, `stamp`, `heads`, `history`) keep
# working on SQLite.
#
# Escape hatch (scratch-testing a single SQLite-safe repair migration
# only — a full-chain SQLite upgrade will still fail mid-chain):
# ALLOW_SQLITE_MIGRATIONS=1 flask db upgrade <revision>
#
# Limitation: the verb is read from sys.argv, which is how every real
# invocation reaches here (`flask db ...` / `alembic ...`). A
# programmatic alembic call (none exists in this codebase) bypasses
# the guard and fails mid-chain as before.
_SQLITE_BLOCKED_VERBS = ("upgrade", "downgrade", "migrate")

# All verbs alembic / flask db accept (V9-L21). _migration_command_verb
# scans argv for the first of these instead of positional parsing.
_MIGRATION_VERBS = (
    "upgrade", "downgrade", "migrate", "current", "stamp", "heads",
    "history", "revision", "branches", "show", "merge", "check",
    "edit", "init", "list_templates", "ensure_version",
)

# CLI options that take a separate value token — their value must be
# skipped too, so a value that happens to look like a verb (or a
# config path) is never mistaken for the verb (V9-L21).
_OPTIONS_WITH_VALUE = ("-c", "--config", "-n", "--name", "-x",
                       "--app", "--env-file")

_SQLITE_REFUSAL = (
    "SQLite is not supported for migrations (V6-M18). The chain "
    "contains Postgres-only SQL (INTERVAL / ANY in 71e470eb6cb6, the ~ "
    "regex operator in c4a9012b3d4e, DATE(created_at) + INTERVAL '14 days' "
    "in 9d2b4f7e8a13), so a SQLite upgrade fails "
    "mid-chain. Run migrations against Postgres (set DATABASE_URL). "
    "Tests and dev schema use db.create_all(), not migrations. "
    "Scratch-testing one SQLite-safe repair migration: "
    "ALLOW_SQLITE_MIGRATIONS=1 flask db upgrade <revision>."
)


def _migration_command_verb(argv):
    """The alembic verb for `flask db <verb> ...` / `alembic <verb> ...`.

    Scans argv for the first known verb token instead of positional
    parsing, so option flags and their values (e.g. `alembic -c
    <ini> upgrade`, `flask --app app:create_app db upgrade`) cannot
    be mistaken for the verb (V9-L21: the old positional parse
    returned '-c' for the `-c` form, so the V6-M18 SQLite refusal
    would not have fired for that invocation).
    """
    argv = list(argv or [])
    i = 1  # skip the program name
    while i < len(argv):
        tok = argv[i]
        if tok == "--":
            i += 1
            continue
        if tok.startswith("-"):
            if "=" in tok:
                i += 1  # --opt=value: single token, no separate value
                continue
            if tok in _OPTIONS_WITH_VALUE:
                i += 2  # skip the option and its value
                continue
            i += 1  # value-less flag
            continue
        if tok in _MIGRATION_VERBS:
            return tok
        # Bare non-verb token (e.g. flask's `db` subcommand, or an
        # unknown verb) — keep scanning for the real verb.
        i += 1
    return None


def _refuse_sqlite_migrations_if_cli_upgrade():
    if os.environ.get("ALLOW_SQLITE_MIGRATIONS") == "1":
        return
    if _migration_command_verb(sys.argv) in _SQLITE_BLOCKED_VERBS:
        raise RuntimeError(_SQLITE_REFUSAL)


def get_engine():
    try:
        # this works with Flask-SQLAlchemy<3 and Alchemical
        return current_app.extensions['migrate'].db.get_engine()
    except (TypeError, AttributeError):
        # this works with Flask-SQLAlchemy>=3
        return current_app.extensions['migrate'].db.engine


def get_engine_url():
    try:
        return get_engine().url.render_as_string(hide_password=False).replace(
            '%', '%%')
    except AttributeError:
        return str(get_engine().url).replace('%', '%%')


# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
config.set_main_option('sqlalchemy.url', get_engine_url())
target_db = current_app.extensions['migrate'].db

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_metadata():
    if hasattr(target_db, 'metadatas'):
        return target_db.metadatas[None]
    return target_db.metadata


def run_migrations_offline():
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    if url and url.split(":", 1)[0].lower() in ("sqlite", "sqlite+pysqlite"):
        _refuse_sqlite_migrations_if_cli_upgrade()
    context.configure(
        url=url, target_metadata=get_metadata(), literal_binds=True
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    # this callback is used to prevent an auto-migration from being generated
    # when there are no changes to the schema
    # reference: http://alembic.zzzcomputing.com/en/latest/cookbook.html
    def process_revision_directives(context, revision, directives):
        if getattr(config.cmd_opts, 'autogenerate', False):
            script = directives[0]
            if script.upgrade_ops.is_empty():
                directives[:] = []
                logger.info('No changes in schema detected.')

    conf_args = current_app.extensions['migrate'].configure_args
    if conf_args.get("process_revision_directives") is None:
        conf_args["process_revision_directives"] = process_revision_directives

    connectable = get_engine()

    # V6-M18: refuse a SQLite migration run early (see header comment).
    if connectable.dialect.name == "sqlite":
        _refuse_sqlite_migrations_if_cli_upgrade()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=get_metadata(),
            **conf_args
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
