"""Yodha unblock fix (2026-11-11): full-field USERINFO update (Option C),
plus the TZ reset (2026-11-16).

On 2026-11-11 Yodha's X2008 (ZMM200_TFT, Push 2.0.33S) ACKed the 3-field
``DATA UPDATE USERINFO PIN=<id> Name=<name> Grp=1`` unblock with result 0
and the member still could not punch — the firmware ACKed the partial
update without applying it (review finding 2 / H3; the leading cause,
a bridge-era timezone deny, is a separate on-terminal fix). Block and
unblock therefore send the FULL documented USERINFO field set
(PIN/Name/Pri/Passwd/Card/Grp) so a partial update cannot be silently
ignored.

TZ reset (2026-11-16): terminal photos from Bharath's video call with
Madhu show harsha.t (enroll 25) stuck on Time Period 1 = 50 (the
bridge-era deny) while a working active member shows Time Period 1 = 1.
Unblock therefore ALSO restores Time Period 1 to 1
(``TZ=0000000100000000``). The value encoding follows this repo's own
Oct 13 commit de3a9bd (``TZ=0000003200000000`` = 50,
``TZ=0000000100000000`` = 1) — believed, not proven over PUSH on this
terminal; the harsha punch test after deploy is the proof. Block sends
NO TZ field: block works via Grp=100 and must never write a deny
schedule.

These tests pin the EXACT wire text for every action that builds a
USERINFO update, and pin that ``create_user`` is UNCHANGED
(PIN/Name/Pri=0, no Grp field).
"""

from app.services.bridge_service import adms_command_text


def test_unblock_sends_full_field_userinfo_with_tz_reset():
    assert adms_command_text("unblock", "25", member_name="harsha.t") == (
        "DATA UPDATE USERINFO PIN=25\tName=harsha.t\tPri=0\tPasswd=\tCard=\tGrp=1"
        "\tTZ=0000000100000000"
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
        "\tTZ=0000000100000000"
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


def test_block_carries_no_timezone_field():
    # Block works via Grp=100 and must never write a deny schedule —
    # a TZ on the block path could re-create the bridge-era deny.
    for action in ("block", "essl_group_block_test"):
        assert "TZ=" not in adms_command_text(action, "25", member_name="harsha.t")


def test_unblock_restores_time_period_1():
    # TZ reset (2026-11-16): unblock restores Time Period 1 = 1, the
    # value the terminal photos show on a working member (harsha.t is
    # stuck on 50). The encoding is this repo's own de3a9bd string:
    # 16 hex chars, timezone ID in the first 8 (0x01 = 1).
    for action in ("unblock", "essl_group_unblock_test"):
        assert adms_command_text(action, "25", member_name="harsha.t").endswith(
            "\tTZ=0000000100000000"
        )
    # Not enroll-specific: member 158's unblock carries the same TZ.
    assert adms_command_text("unblock", "2075", member_name="Member 158").endswith(
        "\tTZ=0000000100000000"
    )


def test_full_field_form_matches_documented_user_line_order():
    # Field order follows the USER line format in
    # app/adms/routes.py:_parse_userinfo_line: PIN, Name, Pri, Passwd,
    # Card, Grp — with TZ appended after Grp on unblock.
    text = adms_command_text("unblock", "2075", member_name="Member 158")
    fields = [part.split("=", 1)[0] for part in text.split("DATA UPDATE USERINFO ")[1].split("\t")]
    assert fields == ["PIN", "Name", "Pri", "Passwd", "Card", "Grp", "TZ"]
