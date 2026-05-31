from app.forms.auth import LoginForm, RegisterGymForm
from app.forms.gym import NotificationTemplateForm, QRSettingsForm, WhatsAppSettingsForm
from app.forms.member import MemberForm, MembershipPlanForm
from app.forms.payment import PaymentVerificationForm

__all__ = [
    "LoginForm",
    "MemberForm",
    "MembershipPlanForm",
    "NotificationTemplateForm",
    "PaymentVerificationForm",
    "QRSettingsForm",
    "RegisterGymForm",
    "WhatsAppSettingsForm",
]
