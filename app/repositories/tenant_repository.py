from __future__ import annotations

from flask import abort


class TenantRepository:
    """Small query helper that keeps route code honest about gym scoping."""

    def __init__(self, model, gym_id: int):
        self.model = model
        self.gym_id = gym_id

    def query(self):
        query = self.model.query.filter_by(gym_id=self.gym_id)
        if hasattr(self.model, "deleted_at"):
            query = query.filter(self.model.deleted_at.is_(None))
        return query

    def get_or_404(self, object_id: int, load_options=None):
        query = self.query().filter_by(id=object_id)
        if load_options:
            query = query.options(*load_options)
        item = query.first()
        if item is None:
            abort(404)
        return item
