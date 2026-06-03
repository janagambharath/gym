from __future__ import annotations

import hashlib
import hmac
import json
import unittest
from datetime import date, timedelta
from unittest.mock import Mock, patch

from app import create_app
from app.extensions import db
from app.models import AuditLog, Gym, Member, QRSettings, ReminderLog, User
from app.services.reminder_service import due_members_for_gym, run_due_reminders_for_gym
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService


class WhatsAppOption2TestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app("testing")
        self.app.config.update(
            WHATSAPP_ENABLED=False,
            WHATSAPP_VERIFY_TOKEN="test-verify-token",
            WHATSAPP_WEBHOOK_SECRET="test-webhook-secret",
            PUBLIC_BASE_URL="https://example.test",
        )
        self.client = self.app.test_client()
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

        self.expiry = date.today() + timedelta(days=3)
        self.gym_one = Gym(
            name="Gym One",
            slug="gym-one",
            whatsapp_business_account_id="100001",
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
            whatsapp_business_account_id="100002",
            phone_number_id="222222",
            business_phone_number="+919000000002",
            whatsapp_enabled=True,
        )
        db.session.add_all([self.gym_one, self.gym_two])
        db.session.flush()
        self.owner = User(
            gym_id=self.gym_one.id,
            email="owner@example.com",
            full_name="Gym One Owner",
            role="gym_owner",
        )
        self.owner.set_password("ChangeMe123!")

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
        db.session.add_all([self.owner, self.member_one, self.member_two, self.unopted_member])
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

    def test_inbound_message_matches_legacy_phone_with_spaces(self) -> None:
        self.member_one.phone = "+91 91000 00001"
        db.session.commit()
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-spaced", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertTrue(self.member_one.whatsapp_opted_in)

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

    @patch.object(WhatsAppService, "send_image")
    @patch.object(WhatsAppService, "send_text")
    def test_manual_test_reminder_sends_text_without_qr(
        self,
        send_text: Mock,
        send_image: Mock,
    ) -> None:
        send_text.return_value = WhatsAppResult(ok=True, provider_message_id="text-message")
        self.member_one.whatsapp_opted_in = True
        QRSettings.query.filter_by(gym_id=self.gym_one.id).delete()
        db.session.commit()

        self.assertEqual(
            self.client.post(
                "/auth/login",
                data={"email": self.owner.email, "password": "ChangeMe123!"},
            ).status_code,
            302,
        )

        response = self.client.post(f"/reminders/members/{self.member_one.id}/send-test")

        self.assertEqual(response.status_code, 302)
        send_text.assert_called_once()
        send_image.assert_not_called()

        log = ReminderLog.query.filter_by(
            gym_id=self.gym_one.id,
            member_id=self.member_one.id,
            reminder_stage="manual_test",
        ).one()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "text-message")

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

    @patch("app.services.whatsapp_service._SESSION.post")
    @patch("app.services.whatsapp_service._SESSION.get")
    def test_connect_webhooks_validates_number_and_subscribes_waba(
        self,
        get: Mock,
        post: Mock,
    ) -> None:
        self.app.config["WHATSAPP_ACCESS_TOKEN"] = "test-token"
        get.return_value = self._graph_response(
            {"data": [{"id": self.gym_one.phone_number_id}]}
        )
        post.return_value = self._graph_response({"success": True})

        result = WhatsAppService(self.gym_one).connect_webhooks()

        self.assertTrue(result.ok)
        self.assertIn(
            f"/{self.gym_one.whatsapp_business_account_id}/phone_numbers",
            get.call_args.args[0],
        )
        self.assertIn(
            f"/{self.gym_one.whatsapp_business_account_id}/subscribed_apps",
            post.call_args.args[0],
        )
        self.assertEqual(
            post.call_args.kwargs["json"],
            {
                "override_callback_uri": "https://example.test/webhook/whatsapp",
                "verify_token": "test-verify-token",
            },
        )

    @patch("app.services.whatsapp_service._SESSION.get")
    def test_connect_webhooks_rejects_phone_number_from_another_waba(self, get: Mock) -> None:
        self.app.config["WHATSAPP_ACCESS_TOKEN"] = "test-token"
        get.return_value = self._graph_response({"data": [{"id": "different-number"}]})

        result = WhatsAppService(self.gym_one).connect_webhooks()

        self.assertFalse(result.ok)
        self.assertIn("does not belong", result.error or "")

    @patch.object(WhatsAppService, "connect_webhooks")
    def test_owner_settings_subscribes_before_saving_enabled_connection(
        self,
        connect_webhooks: Mock,
    ) -> None:
        connect_webhooks.return_value = WhatsAppResult(ok=True)
        response = self.client.post(
            "/auth/login",
            data={"email": self.owner.email, "password": "ChangeMe123!"},
        )
        self.assertEqual(response.status_code, 302)

        response = self.client.post(
            "/app/whatsapp-settings",
            data={
                "whatsapp_business_account_id": "100003",
                "phone_number_id": "333333",
                "business_phone_number": "+919000000003",
                "whatsapp_enabled": "y",
                "welcome_message_template": "Welcome {{member_name}}.",
                "renewal_reminder_template": "Renew by {{expiry_date}}.",
            },
        )

        self.assertEqual(response.status_code, 302)
        connect_webhooks.assert_called_once()
        db.session.refresh(self.gym_one)
        self.assertEqual(self.gym_one.whatsapp_business_account_id, "100003")
        self.assertEqual(self.gym_one.phone_number_id, "333333")

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

    @staticmethod
    def _graph_response(payload: dict, status_code: int = 200) -> Mock:
        response = Mock()
        response.status_code = status_code
        response.json.return_value = payload
        return response


if __name__ == "__main__":
    unittest.main()
