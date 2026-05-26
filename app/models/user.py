from __future__ import annotations

from datetime import timezone

from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db, login_manager
from app.models.mixins import TimestampMixin, utcnow


class User(UserMixin, TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    full_name = db.Column(db.String(160), nullable=False)
    password_hash = db.Column(db.Text, nullable=False)
    role = db.Column(db.String(32), nullable=False, default="staff", index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    last_login_at = db.Column(db.DateTime(timezone=True), nullable=True)
    failed_login_count = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime(timezone=True), nullable=True)

    gym = db.relationship("Gym", back_populates="users")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def mark_login(self) -> None:
        self.last_login_at = utcnow()

    def is_locked(self) -> bool:
        if self.locked_until is None:
            return False
        locked_until = self.locked_until
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        return utcnow() < locked_until

    def record_failed_login(self) -> None:
        self.failed_login_count = (self.failed_login_count or 0) + 1
        if self.failed_login_count >= 10:
            from datetime import timedelta

            self.locked_until = utcnow() + timedelta(minutes=15)

    def reset_failed_logins(self) -> None:
        self.failed_login_count = 0
        self.locked_until = None

    def can_manage_gym(self, gym_id: int) -> bool:
        return self.role == "super_admin" or self.gym_id == gym_id

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"

    @property
    def is_gym_admin(self) -> bool:
        return self.role in {"gym_owner", "staff"}


@login_manager.user_loader
def load_user(user_id: str) -> User | None:
    if not user_id.isdigit():
        return None
    return db.session.get(User, int(user_id))
