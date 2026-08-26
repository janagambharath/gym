"""Add deployment center, bridge releases v2, and user/gym security columns.

Revision ID: 4c5d6e7f8a9b
Revises: 3a4b5c6d7e8f
Create Date: 2026-08-26 18:35:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "4c5d6e7f8a9b"
down_revision = "3a4b5c6d7e8f"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Update users table with onboarding & password management columns
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("invitation_status", sa.String(length=32), nullable=False, server_default="sent")
        )
        batch_op.add_column(
            sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("created_by_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("is_temporary_password", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_foreign_key(
            "fk_users_created_by_id", "users", ["created_by_id"], ["id"], ondelete="SET NULL"
        )

    # 2. Update gyms table with deployment & internationalization metadata
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.add_column(
            sa.Column("country", sa.String(length=64), nullable=False, server_default="India")
        )
        batch_op.add_column(
            sa.Column("city", sa.String(length=120), nullable=True)
        )
        batch_op.add_column(
            sa.Column("area", sa.String(length=120), nullable=True)
        )
        batch_op.add_column(
            sa.Column("currency", sa.String(length=16), nullable=False, server_default="INR")
        )
        batch_op.add_column(
            sa.Column("business_category", sa.String(length=64), nullable=False, server_default="Gym / Fitness Center")
        )
        batch_op.add_column(
            sa.Column("internal_notes", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("onboarding_status", sa.String(length=32), nullable=False, server_default="lead")
        )
        batch_op.add_column(
            sa.Column("is_test_gym", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("health_score", sa.Integer(), nullable=False, server_default="100")
        )
        batch_op.add_column(
            sa.Column("go_live_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("go_live_by_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("deployment_version", sa.String(length=32), nullable=False, server_default="v2.4")
        )
        batch_op.create_index("ix_gyms_onboarding_status", ["onboarding_status"], unique=False)
        batch_op.create_foreign_key(
            "fk_gyms_go_live_by_id", "users", ["go_live_by_id"], ["id"], ondelete="SET NULL"
        )

    # 3. Create bridge_releases table
    op.create_table(
        "bridge_releases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("build_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("release_channel", sa.String(length=32), nullable=False, server_default="testing"),
        sa.Column("supported_os", sa.String(length=120), nullable=False, server_default="Windows 10/11 x64"),
        sa.Column("min_supported_app_version", sa.String(length=32), nullable=False, server_default="v2.0"),
        sa.Column("max_supported_app_version", sa.String(length=32), nullable=True),
        sa.Column("bridge_protocol_version", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sha256_checksum", sa.String(length=64), nullable=False),
        sa.Column("release_notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("is_current_stable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("downloads_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version", "build_number", name="uq_bridge_releases_version_build"),
    )
    op.create_index("ix_bridge_releases_version", "bridge_releases", ["version"], unique=False)
    op.create_index("ix_bridge_releases_release_channel", "bridge_releases", ["release_channel"], unique=False)
    op.create_index("ix_bridge_releases_is_current_stable", "bridge_releases", ["is_current_stable"], unique=False)
    op.create_index("ix_bridge_releases_channel_active", "bridge_releases", ["release_channel", "is_active"], unique=False)

    # 4. Update bridge_installations table with V2 telemetry and release relationship
    with op.batch_alter_table("bridge_installations") as batch_op:
        batch_op.add_column(
            sa.Column("installed_version", sa.String(length=32), nullable=False, server_default="1.0.0")
        )
        batch_op.add_column(
            sa.Column("installed_build", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("os_info", sa.String(length=120), nullable=True)
        )
        batch_op.add_column(
            sa.Column("pc_name", sa.String(length=120), nullable=True)
        )
        batch_op.add_column(
            sa.Column("first_paired_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("release_channel", sa.String(length=32), nullable=False, server_default="stable")
        )
        batch_op.add_column(
            sa.Column("release_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("status", sa.String(length=32), nullable=False, server_default="paired")
        )
        batch_op.create_index("ix_bridge_installations_installed_version", ["installed_version"], unique=False)
        batch_op.create_index("ix_bridge_installations_status", ["status"], unique=False)
        batch_op.create_foreign_key(
            "fk_bridge_installations_release_id", "bridge_releases", ["release_id"], ["id"], ondelete="SET NULL"
        )

    # 5. Create gym_deployments table
    op.create_table(
        "gym_deployments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("wizard_state_json", sa.JSON(), nullable=True),
        sa.Column("checklist_json", sa.JSON(), nullable=True),
        sa.Column("pairing_code", sa.String(length=16), nullable=True),
        sa.Column("pairing_code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("setup_duration_seconds", sa.Integer(), nullable=True),
        sa.Column("last_test_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test_results_json", sa.JSON(), nullable=True),
        sa.Column("deployment_timeline_json", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id", name="uq_gym_deployments_gym_id"),
    )
    op.create_index("ix_gym_deployments_gym_id", "gym_deployments", ["gym_id"], unique=False)
    op.create_index("ix_gym_deployments_pairing_code", "gym_deployments", ["pairing_code"], unique=False)


def downgrade():
    op.drop_table("gym_deployments")
    with op.batch_alter_table("bridge_installations") as batch_op:
        batch_op.drop_constraint("fk_bridge_installations_release_id", type_="foreignkey")
        batch_op.drop_index("ix_bridge_installations_status")
        batch_op.drop_index("ix_bridge_installations_installed_version")
        batch_op.drop_column("status")
        batch_op.drop_column("release_id")
        batch_op.drop_column("release_channel")
        batch_op.drop_column("first_paired_at")
        batch_op.drop_column("pc_name")
        batch_op.drop_column("os_info")
        batch_op.drop_column("installed_build")
        batch_op.drop_column("installed_version")

    op.drop_table("bridge_releases")

    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_constraint("fk_gyms_go_live_by_id", type_="foreignkey")
        batch_op.drop_index("ix_gyms_onboarding_status")
        batch_op.drop_column("deployment_version")
        batch_op.drop_column("go_live_by_id")
        batch_op.drop_column("go_live_at")
        batch_op.drop_column("health_score")
        batch_op.drop_column("is_test_gym")
        batch_op.drop_column("onboarding_status")
        batch_op.drop_column("internal_notes")
        batch_op.drop_column("business_category")
        batch_op.drop_column("currency")
        batch_op.drop_column("area")
        batch_op.drop_column("city")
        batch_op.drop_column("country")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("fk_users_created_by_id", type_="foreignkey")
        batch_op.drop_column("is_temporary_password")
        batch_op.drop_column("created_by_id")
        batch_op.drop_column("invited_at")
        batch_op.drop_column("invitation_status")
        batch_op.drop_column("must_change_password")
