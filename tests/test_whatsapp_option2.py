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
from app.services.reminder_service import (
    MAX_REMINDER_ATTEMPTS,
    auto_expire_members_for_gym,
    due_members_for_gym,
    run_due_reminders_for_gym,
    send_reminder,
)
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
            trial_ends_at=date.today() + timedelta(days=14),
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
            trial_ends_at=date.today() + timedelta(days=14),
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

    def test_webhook_rejects_when_dedicated_secret_is_missing(self) -> None:
        self.app.config["WHATSAPP_ACCESS_TOKEN"] = "legacy-fallback-token"
        self.app.config["WHATSAPP_WEBHOOK_SECRET"] = ""
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-unsigned", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }
        body = json.dumps(payload).encode()
        legacy_signature = "sha256=" + hmac.new(
            b"legacy-fallback-token",
            body,
            hashlib.sha256,
        ).hexdigest()

        response = self.client.post(
            "/webhook/whatsapp",
            data=body,
            content_type="application/json",
            headers={"X-Hub-Signature-256": legacy_signature},
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.member_one.whatsapp_opted_in)

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

    def test_reaction_message_does_not_opt_member_in(self) -> None:
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [
                                    {
                                        "id": "reaction-1",
                                        "from": "919100000001",
                                        "type": "reaction",
                                    }
                                ],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertFalse(self.member_one.whatsapp_opted_in)
        self.assertEqual(
            AuditLog.query.filter_by(gym_id=self.gym_one.id, action="whatsapp_opt_in").count(),
            0,
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

    def test_inbound_message_matches_legacy_phone_with_separators(self) -> None:
        self.member_one.phone = "+91-91000-00001"
        db.session.commit()
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-separated", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertTrue(self.member_one.whatsapp_opted_in)
        self.assertEqual(self.member_one.phone, "+919100000001")

    def test_inbound_message_matches_legacy_local_phone_and_normalizes_it(self) -> None:
        self.member_one.phone = "9100000001"
        db.session.commit()
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-local", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertTrue(self.member_one.whatsapp_opted_in)
        self.assertEqual(self.member_one.phone, "+919100000001")

    def test_inbound_message_does_not_guess_between_duplicate_local_matches(self) -> None:
        self.member_one.phone = "9100000001"
        duplicate = Member(
            gym_id=self.gym_one.id,
            full_name="Duplicate Member",
            phone="9100000001",
            membership_end=self.expiry,
        )
        db.session.add(duplicate)
        db.session.commit()
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "messages": [{"id": "inbound-duplicate", "from": "919100000001"}],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)
        self.assertFalse(self.member_one.whatsapp_opted_in)
        self.assertFalse(duplicate.whatsapp_opted_in)

        ignored = AuditLog.query.filter_by(
            gym_id=self.gym_one.id,
            action="whatsapp_opt_in_ignored",
        ).one()
        self.assertEqual(ignored.metadata_json["reason"], "ambiguous")

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

    def test_auto_expire_members_for_gym_marks_expired_active_members(self) -> None:
        self.member_one.membership_end = date.today() - timedelta(days=1)
        self.member_one.status = "active"
        db.session.commit()

        count = auto_expire_members_for_gym(self.gym_one)

        self.assertEqual(count, 1)
        self.assertEqual(self.member_one.status, "expired")
        self.assertEqual(
            AuditLog.query.filter_by(gym_id=self.gym_one.id, action="auto_expired").count(),
            1,
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

    @patch.object(WhatsAppService, "send_image")
    @patch.object(WhatsAppService, "send_text")
    def test_reminder_falls_back_to_text_when_qr_image_send_fails(
        self,
        send_text: Mock,
        send_image: Mock,
    ) -> None:
        send_image.return_value = WhatsAppResult(ok=False, error="QR image rejected")
        send_text.return_value = WhatsAppResult(ok=True, provider_message_id="text-fallback")
        self.member_one.whatsapp_opted_in = True
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        send_image.assert_called_once()
        send_text.assert_called_once()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "text-fallback")
        self.assertIsNone(log.error_message)

    @patch.object(WhatsAppService, "send_template")
    @patch.object(WhatsAppService, "send_text")
    @patch.object(WhatsAppService, "send_image")
    def test_reminder_uses_settings_qr_image_before_template_fallback(
        self,
        send_image: Mock,
        send_text: Mock,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_image.return_value = WhatsAppResult(ok=True, provider_message_id="settings-image")
        self.member_one.whatsapp_opted_in = True
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        send_image.assert_called_once()
        send_text.assert_not_called()
        send_template.assert_not_called()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "settings-image")

    @patch.object(WhatsAppService, "send_template")
    @patch.object(WhatsAppService, "send_text")
    @patch.object(WhatsAppService, "send_image")
    def test_reminder_uses_settings_message_before_template_fallback(
        self,
        send_image: Mock,
        send_text: Mock,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_text.return_value = WhatsAppResult(ok=True, provider_message_id="settings-message")
        self.member_one.whatsapp_opted_in = True
        QRSettings.query.filter_by(gym_id=self.gym_one.id).delete()
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        send_text.assert_called_once()
        send_template.assert_not_called()
        send_image.assert_not_called()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "settings-message")

    @patch.object(WhatsAppService, "send_template")
    @patch.object(WhatsAppService, "send_text")
    @patch.object(WhatsAppService, "send_image")
    def test_reminder_uses_template_fallback_when_settings_message_fails(
        self,
        send_image: Mock,
        send_text: Mock,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_text.return_value = WhatsAppResult(ok=False, error="24-hour window closed")
        send_template.return_value = WhatsAppResult(ok=True, provider_message_id="template-message")
        self.member_one.whatsapp_opted_in = True
        QRSettings.query.filter_by(gym_id=self.gym_one.id).delete()
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        send_text.assert_called_once()
        send_template.assert_called_once()
        self.assertEqual(
            send_template.call_args.kwargs["body_parameters"],
            [
                self.member_one.full_name,
                self.gym_one.name,
                self.expiry.strftime("%d %b %Y"),
                "3",
            ],
        )
        send_image.assert_not_called()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "template-message")

    @patch.object(WhatsAppService, "send_template")
    @patch.object(WhatsAppService, "send_text")
    @patch.object(WhatsAppService, "send_image")
    def test_reminder_records_settings_and_template_errors_when_both_fail(
        self,
        send_image: Mock,
        send_text: Mock,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_text.return_value = WhatsAppResult(ok=False, error="24-hour window closed")
        send_template.return_value = WhatsAppResult(ok=False, error="template missing")
        self.member_one.whatsapp_opted_in = True
        QRSettings.query.filter_by(gym_id=self.gym_one.id).delete()
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        send_text.assert_called_once()
        send_template.assert_called_once()
        send_image.assert_not_called()
        self.assertEqual(log.status, "failed")
        self.assertIn(
            "WhatsApp Settings message failed: 24-hour window closed",
            log.error_message or "",
        )
        self.assertIn(
            "template fallback failed: template missing",
            log.error_message or "",
        )

    @patch.object(WhatsAppService, "send_image")
    @patch.object(WhatsAppService, "send_text")
    def test_reminder_records_image_and_text_errors_when_both_fail(
        self,
        send_text: Mock,
        send_image: Mock,
    ) -> None:
        send_image.return_value = WhatsAppResult(ok=False, error="QR image rejected")
        send_text.return_value = WhatsAppResult(ok=False, error="24-hour window closed")
        self.member_one.whatsapp_opted_in = True
        log = self._reminder_log(self.gym_one, self.member_one)
        db.session.commit()

        send_reminder(log, force=True)

        self.assertEqual(log.status, "failed")
        self.assertIn("Image send failed: QR image rejected", log.error_message or "")
        self.assertIn("text fallback failed: 24-hour window closed", log.error_message or "")

    @patch.object(WhatsAppService, "send_text")
    def test_manual_resend_can_retry_failed_log_after_max_attempts(
        self,
        send_text: Mock,
    ) -> None:
        send_text.return_value = WhatsAppResult(ok=True, provider_message_id="manual-retry")
        self.member_one.whatsapp_opted_in = True
        QRSettings.query.filter_by(gym_id=self.gym_one.id).delete()
        log = self._reminder_log(self.gym_one, self.member_one)
        log.status = "failed"
        log.attempts = MAX_REMINDER_ATTEMPTS
        db.session.commit()

        self.assertEqual(
            self.client.post(
                "/auth/login",
                data={"email": self.owner.email, "password": "ChangeMe123!"},
            ).status_code,
            302,
        )

        response = self.client.post(f"/reminders/{log.id}/resend")

        self.assertEqual(response.status_code, 302)
        send_text.assert_called_once()
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.attempts, MAX_REMINDER_ATTEMPTS + 1)
        self.assertEqual(log.provider_message_id, "manual-retry")

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

    @patch.object(WhatsAppService, "send_template")
    def test_reengagement_delivery_failure_uses_template_fallback(
        self,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_template.return_value = WhatsAppResult(
            ok=True,
            provider_message_id="template-provider",
        )
        self.member_one.whatsapp_opted_in = True
        log = self._reminder_log(self.gym_one, self.member_one)
        log.status = "sent"
        log.provider_message_id = "settings-provider"
        db.session.commit()

        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "statuses": [
                                    {
                                        "id": "settings-provider",
                                        "status": "failed",
                                        "errors": [
                                            {
                                                "title": "Re-engagement message",
                                                "code": 131047,
                                            }
                                        ],
                                    }
                                ],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)

        send_template.assert_called_once()
        self.assertEqual(send_template.call_args.kwargs["to"], log.phone_snapshot)
        self.assertEqual(
            send_template.call_args.kwargs["body_parameters"],
            [
                self.member_one.full_name,
                self.gym_one.name,
                self.expiry.strftime("%d %b %Y"),
                "3",
            ],
        )
        self.assertEqual(log.status, "sent")
        self.assertEqual(log.provider_message_id, "template-provider")
        self.assertIsNone(log.error_message)

    @patch.object(WhatsAppService, "send_template")
    def test_reengagement_delivery_failure_records_template_fallback_error(
        self,
        send_template: Mock,
    ) -> None:
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_NAME"] = "renewal_reminder"
        self.app.config["WHATSAPP_REMINDER_TEMPLATE_LANGUAGE"] = "en_US"
        send_template.return_value = WhatsAppResult(ok=False, error="template missing")
        self.member_one.whatsapp_opted_in = True
        log = self._reminder_log(self.gym_one, self.member_one)
        log.status = "sent"
        log.provider_message_id = "settings-provider"
        db.session.commit()

        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": self.gym_one.phone_number_id},
                                "statuses": [
                                    {
                                        "id": "settings-provider",
                                        "status": "failed",
                                        "errors": [
                                            {
                                                "title": "Re-engagement message",
                                                "code": 131047,
                                            }
                                        ],
                                    }
                                ],
                            }
                        }
                    ]
                }
            ]
        }

        self.assertEqual(self._post_webhook(payload).status_code, 200)

        send_template.assert_called_once()
        self.assertEqual(log.status, "failed")
        self.assertEqual(log.provider_message_id, "settings-provider")
        self.assertIn("Re-engagement message", log.error_message or "")
        self.assertIn("template fallback failed: template missing", log.error_message or "")

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

    @patch("app.services.whatsapp_service._SESSION.post")
    def test_whatsapp_send_errors_include_meta_details(self, post: Mock) -> None:
        self.app.config.update(WHATSAPP_ENABLED=True, WHATSAPP_ACCESS_TOKEN="test-token")
        post.return_value = self._graph_response(
            {
                "error": {
                    "message": "Re-engagement message",
                    "code": 131047,
                    "error_subcode": 2494102,
                    "error_data": {"details": "More than 24 hours have passed."},
                }
            },
            status_code=400,
        )

        result = WhatsAppService(self.gym_one).send_text(to="919100000001", body="Test")

        self.assertFalse(result.ok)
        self.assertIn("Re-engagement message", result.error or "")
        self.assertIn("More than 24 hours have passed.", result.error or "")
        self.assertIn("code 131047/2494102", result.error or "")

    @patch("app.services.whatsapp_service._SESSION.post")
    def test_whatsapp_template_payload_uses_body_parameters(self, post: Mock) -> None:
        self.app.config.update(WHATSAPP_ENABLED=True, WHATSAPP_ACCESS_TOKEN="test-token")
        post.return_value = self._graph_response({"messages": [{"id": "wamid-template"}]})

        result = WhatsAppService(self.gym_one).send_template(
            to="919100000001",
            template_name="renewal_reminder",
            language_code="en_US",
            body_parameters=["Member One", "Gym One", "10 Jun 2026", "3"],
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.provider_message_id, "wamid-template")
        self.assertEqual(
            post.call_args.kwargs["json"],
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": "919100000001",
                "type": "template",
                "template": {
                    "name": "renewal_reminder",
                    "language": {"code": "en_US"},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [
                                {"type": "text", "text": "Member One"},
                                {"type": "text", "text": "Gym One"},
                                {"type": "text", "text": "10 Jun 2026"},
                                {"type": "text", "text": "3"},
                            ],
                        }
                    ],
                },
            },
        )

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
                "timezone": "Asia/Kolkata",
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
        self.assertEqual(self.gym_one.timezone, "Asia/Kolkata")

    def test_member_limit_is_enforced_on_submit(self) -> None:
        self.gym_one.max_members = 2
        db.session.commit()
        self.assertEqual(
            self.client.post(
                "/auth/login",
                data={"email": self.owner.email, "password": "ChangeMe123!"},
            ).status_code,
            302,
        )

        response = self.client.post(
            "/members/new",
            data={
                "full_name": "Limit Test",
                "phone": "+919100000099",
                "email": "",
                "gender": "",
                "plan_id": "0",
                "membership_start": str(date.today()),
                "membership_end": str(date.today() + timedelta(days=30)),
                "status": "active",
                "notes": "",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertIsNone(Member.query.filter_by(full_name="Limit Test").first())

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
