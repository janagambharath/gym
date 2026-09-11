from app.extensions import db
from app.models.access_event import AccessEvent
from app.models.app_notification import AppNotification
from app.models.audit_log import AuditLog
from app.models.bot import (
    BotBookingRequest,
    BotConversation,
    BotEvent,
    BotFAQ,
    BotFollowUp,
    BotKnowledgeItem,
    BotLead,
    BotMessage,
    FeatureEntitlement,
    GymBotConfig,
)
from app.models.bridge import BridgeAttendance, BridgeCommand, BridgeInstallation
from app.models.bridge_release import BridgeRelease
from app.models.campaign import Campaign, CampaignRecipient
from app.models.gym import Gym
from app.models.google_play_subscription import GooglePlaySubscription

from app.models.gym_deployment import GymDeployment
from app.models.member import Member, MembershipPlan
from app.models.member_access_state import MemberAccessState
from app.models.mobile_token import MobileRefreshToken
from app.models.mobile_idempotency import MobileIdempotencyKey
from app.models.payment_verification import PaymentVerification
from app.models.push_token import UserPushToken
from app.models.qr_settings import QRSettings
from app.models.reminder_log import ReminderLog
from app.models.renewal_history import RenewalHistory
from app.models.template import NotificationTemplate
from app.models.user import User

__all__ = [
    "AccessEvent",
    "AppNotification",
    "AuditLog",
    "BotBookingRequest",
    "BotConversation",
    "BotEvent",
    "BotFAQ",
    "BotFollowUp",
    "BotKnowledgeItem",
    "BotLead",
    "BotMessage",
    "BridgeAttendance",
    "BridgeCommand",
    "BridgeInstallation",
    "BridgeRelease",
    "Campaign",
    "CampaignRecipient",
    "FeatureEntitlement",

    "Gym",
    "GooglePlaySubscription",
    "GymBotConfig",
    "GymDeployment",
    "Member",
    "MemberAccessState",
    "MembershipPlan",
    "MobileRefreshToken",
    "MobileIdempotencyKey",
    "NotificationTemplate",
    "PaymentVerification",
    "QRSettings",
    "ReminderLog",
    "RenewalHistory",
    "User",
    "UserPushToken",
    "db",
]


