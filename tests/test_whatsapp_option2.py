from __future__ import annotations

import hashlib
import hmac
import json
import unittest
from datetime import date, timedelta

from app import create_app
from app.extensions import db
from app.models import AuditLog, Gym, Member, QRSettings, ReminderLog
from app.services.reminder_service import due_members_for_gym, run_due_reminders_for_gym


class WhatsAppOption2TestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app("testing")
        self.app.config.update(
            WHATSAPP_ENABLED=False,
            WHATSAPP_WEBHOOK_SECRET="test-webhook-secret",
        )
        self.client = self.app.test_client()
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

        self.expiry = date.today() + timedelta(days=3)
        self.gym_one = Gym(
            name="Gym One",
            slug="gym-one",
            phone_number_id="111111",
            business_phone_number="+919000000001",
            whatsapp_enabled=True,
            welcome_message_template="Welcome {{member_name}} to {{gym_name}}.",
            renewal_reminder_template=(
                "Renew {{member_name}} at {{gym_name}} by {{expiry_date}} "
                "({{days_left}} days)."
            ),
        )
        self.gym_two = Gym(
            name="Gym Two",
            slug="gym-two",
            phone_number_id="222222",
            business_phone_number="+919000000002",
            whatsapp_enabled=True,
        )
        db.session.add_all([self.gym_one, self.gym_two])
        db.session.flush()

        self.member_one = Member(
            gym_id=self.gym_one.id,
            full_name="Member One",
            phone="+919100000001",
            membership_end=self.expiry,
        )
        self.member_two = Member(
            gym_id=self.gym_two.id,
            full_name="Member Two",
            phone="+919100000001",
            membership_end=self.expiry,
        )
        self.unopted_member = Member(
            gym_id=self.gym_one.id,
            full_name="Member Three",
            phone="+919100000003",
            membership_end=self.expiry,
        )
        db.session.add_all([self.member_one, self.member_two, self.unopted_member])
        db.session.add(
            QRSettings(
                gym_id=self.gym_one.id,
                qr_public_url="https://example.com/qr.png",
                is_active=True,
            )
        )
        db.session.commit()

    def tearDown(self) -> None:
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def _post_webhook(self, payload: dict):
        body = json.dumps(payload).encode()
        signature = "sha256=" + hmac.new(
            self.app.config["WHATSAPP_WEBHOOK_SECRET"].encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        return self.client.post(
            "/webhook/whatsapp",
            data=body,
            content_type="application/json",
            headers={"X-Hub-Signature-256": signature},
        )

    def test_first_inbound_message_opts_in_only_the_resolved_gyms_member(self) -> None:
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-1", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertTrue(self.member_one.whatsapp_opted_in)
        self.assertIsNotNone(self.member_one.whatsapp_opted_in_at)
        self.assertFalse(self.member_two.whatsapp_opted_in)
        self.assertEqual(
            AuditLog.query.filter_by(gym_id=self.gym_one.id, action="whatsapp_opt_in").count(),
            1,
        )

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertEqual(
            AuditLog.query.filter_by(gym_id=self.gym_one.id, action="whatsapp_opt_in").count(),
            1,
        )

    def test_scheduler_sends_and_logs_only_opted_in_members(self) -> None:
        self.member_one.whatsapp_opted_in = True
        db.session.commit()

        self.assertEqual(
            [member.id for member in due_members_for_gym(self.gym_one.id, 3)],
            [self.member_one.id],
        )
        result = run_due_reminders_for_gym(self.gym_one.id, [3])
        self.assertEqual(result["sent"], 1)

        logs = ReminderLog.query.filter_by(
            gym_id=self.gym_one.id,
            reminder_stage="3_days_before_expiry",
        ).all()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].member_id, self.member_one.id)
        self.assertEqual(
            logs[0].message_snapshot,
            f"Renew Member One at Gym One by {self.expiry.strftime('%d %b %Y')} (3 days).",
        )

    def test_delivery_status_updates_are_scoped_to_webhook_gym(self) -> None:
        self.member_one.whatsapp_opted_in = True
        self.member_two.whatsapp_opted_in = True
        log_one = self._reminder_log(self.gym_one, self.member_one)
        log_two = self._reminder_log(self.gym_two, self.member_two)
        db.session.commit()

        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "statuses": [{"id": "provider-shared", "status": "delivered"}],
                            }
                        }
                    ]
                }
            ]
        }
        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertEqual(log_one.status, "sent")
        self.assertEqual(log_two.status, "pending")

    def _reminder_log(self, gym: Gym, member: Member) -> ReminderLog:
        log = ReminderLog(
            gym_id=gym.id,
            member_id=member.id,
            reminder_stage="test",
            cycle_end_date=member.membership_end,
            scheduled_for=date.today(),
            status="pending",
            phone_snapshot=member.phone.lstrip("+"),
            provider_message_id="provider-shared",
        )
        db.session.add(log)
        return log


if __name__ == "__main__":
    unittest.main()
