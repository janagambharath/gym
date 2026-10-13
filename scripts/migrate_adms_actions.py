"""Expand rrr_adms_commands action constraint for advanced commands."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from app.extensions import db
from sqlalchemy import text

app = create_app()
with app.app_context():
    with db.engine.connect() as conn:
        conn.execute(text("ALTER TABLE rrr_adms_commands DROP CONSTRAINT IF EXISTS ck_rrr_adms_command_action"))
        conn.execute(text(
            "ALTER TABLE rrr_adms_commands ADD CONSTRAINT ck_rrr_adms_command_action "
            "CHECK (action IN ('probe_info','block_test','unblock_test','block','unblock',"
            "'create_user','delete_user','unlock_door','clear_log','reboot','check'))"
        ))
        conn.commit()
    print("Migration done")
