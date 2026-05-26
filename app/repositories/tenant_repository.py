from __future__ import annotations

from flask import abort


class TenantRepository:
    """Small query helper that keeps route code honest about gym scoping."""

    def __init__(self, model, gym_id: int):
        self.model = model
        self.gym_id = gym_id

    def query(self):
        return self.model.query.filter_by(gym_id=self.gym_id)

    def get_or_404(self, object_id: int):
        item = self.query().filter_by(id=object_id).first()
        if item is None:
            abort(404)
        return item
