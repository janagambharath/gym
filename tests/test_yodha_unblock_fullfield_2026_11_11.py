"""Yodha unblock fix (2026-11-11): full-field USERINFO update (Option C).

On 2026-11-11 Yodha's X2008 (ZMM200_TFT, Push 2.0.33S) ACKed the 3-field
``DATA UPDATE USERINFO PIN=<id> Name=<name> Grp=1`` unblock with result 0
and the member still could not punch — the firmware ACKed the partial
update without applying it (review finding 2 / H3; the leading cause,
a bridge-era timezone deny, is a separate on-terminal fix). Block and
unblock therefore send the FULL documented USERINFO field set
(PIN/Name/Pri/Passwd/Card/Grp) so a partial update cannot be silently
ignored. These tests pin the EXACT wire text for every action that
builds a USERINFO update, and pin that ``create_user`` is UNCHANGED
(PIN/Name/Pri=0, no Grp field).
"""

from app.services.bridge_service import adms_command_text


def test_unblock_sends_full_field_userinfo():
    assert adms_command_text("unblock", "25", member_name="harsha.t") == (
        "DATA UPDATE USERINFO PIN=25\tName=harsha.t\tPri=0\tPasswd=\tCard=\tGrp=1"
    )


def test_block_sends_full_field_userinfo():
    assert adms_command_text("block", "25", member_name="harsha.t") == (
        "DATA UPDATE USERINFO PIN=25\tName=harsha.t\tPri=0\tPasswd=\tCard=\tGrp=100"
    )


def test_group_test_actions_use_the_same_full_field_text():
    assert adms_command_text(
        "essl_group_unblock_test", "999", member_name="ADMS TEST"
    ) == (
        "DATA UPDATE USERINFO PIN=999\tName=ADMS TEST\tPri=0\tPasswd=\tCard=\tGrp=1"
    )
    assert adms_command_text(
        "essl_group_block_test", "999", member_name="ADMS TEST"
    ) == (
        "DATA UPDATE USERINFO PIN=999\tName=ADMS TEST\tPri=0\tPasswd=\tCard=\tGrp=100"
    )


def test_create_user_wire_text_is_unchanged():
    # create_user carries no Grp field by design (V3-M6: a genuinely new
    # user gets firmware-default access). This fix does not touch it.
    assert adms_command_text("create_user", "25", member_name="harsha.t") == (
        "DATA UPDATE USERINFO PIN=25\tName=harsha.t\tPri=0"
    )


def test_block_unblock_carry_no_timezone_field():
    # Deliberate non-inclusion (see yodha-unblock-fix-state-2026-11-11.md):
    # the PUSH USERINFO record has a TZ field in the public protocol, but
    # the 16-char encoding is unverified and the server holds no per-member
    # schedule — a guessed TZ write on the every-renewal unblock path
    # could alter access for working members. No TZ until the Step 0
    # terminal check (or a USERINFO upload) shows real values.
    for action in ("block", "unblock"):
        assert "TZ=" not in adms_command_text(action, "25", member_name="harsha.t")


def test_full_field_form_matches_documented_user_line_order():
    # Field order follows the USER line format in
    # app/adms/routes.py:_parse_userinfo_line: PIN, Name, Pri, Passwd,
    # Card, Grp.
    text = adms_command_text("unblock", "2075", member_name="Member 158")
    fields = [part.split("=", 1)[0] for part in text.split("DATA UPDATE USERINFO ")[1].split("\t")]
    assert fields == ["PIN", "Name", "Pri", "Passwd", "Card", "Grp"]
