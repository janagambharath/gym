"""Owner-set member profile photo (2026-11-09).

Backend slice of the member-photo spec:
- POST /api/mobile/v1/members/<id>/photo (owner + staff, gym-scoped,
  idempotent via scope "owner_member_photo_upload")
- DELETE /api/mobile/v1/members/<id>/photo
- profile_photo_url in the owner member serializer (list + detail)
- serve endpoint stops serving a soft-deleted member's old signed URL

Negative-checked: every test here fails against the pre-slice code
(no owner photo route, no serializer field, no deleted_at filter on
the serve lookup) and passes with it.
"""
from __future__ import annotations

from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, User
from app.models.mixins import utcnow

BAD_IMAGE_MESSAGE = "The photo could not be saved. Please choose a JPEG, PNG, or WebP image under 3 MB and try again."


def _owner_headers(seed_gym):
    token = create_access_token(
        seed_gym["owner"].id, seed_gym["gym"].id, seed_gym["owner"].role
    )
    return {"Authorization": f"Bearer {token}"}


def _staff_headers(seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="staff@testgym.com",
        full_name="Front Desk",
        role="staff",
    )
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    token = create_access_token(staff.id, seed_gym["gym"].id, "staff")
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(color="#336699"):
    image = BytesIO()
    Image.new("RGB", (32, 24), color).save(image, format="PNG")
    image.seek(0)
    return image


def _photo_dir(client, seed_gym, member):
    upload_root = Path(client.application.config["UPLOAD_FOLDER"])
    return upload_root / "member_profiles" / str(seed_gym["gym"].id) / str(member.id)


def _clear_photo_dir(client, seed_gym, member):
    # Tests share the repo uploads/ dir and every test recreates gym 1 /
    # member 1, so one test's files are the next test's leftovers. Clear
    # the member's photo dir up front so file-count assertions are exact.
    member_dir = _photo_dir(client, seed_gym, member)
    if member_dir.exists():
        for leftover in member_dir.glob("*.jpg"):
            leftover.unlink()


def _photo_files(client, seed_gym, member):
    member_dir = _photo_dir(client, seed_gym, member)
    if not member_dir.exists():
        return []
    return sorted(member_dir.glob("*.jpg"))


def _upload(client, headers, member_id, image=None, filename="profile.png", key=None):
    extra = {}
    if key is not None:
        extra["Idempotency-Key"] = key
    return client.post(
        f"/api/mobile/v1/members/{member_id}/photo",
        headers={**headers, **extra},
        data={"photo": (image if image is not None else _png_bytes(), filename)},
        content_type="multipart/form-data",
    )


def test_owner_upload_happy_path_serves_and_replaces(client, app, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    member = seed_member

    uploaded = _upload(client, headers, member.id)
    assert uploaded.status_code == 200
    photo_url = uploaded.json["data"]["profile_photo_url"]
    assert photo_url
    assert client.get(photo_url).status_code == 200

    db.session.refresh(member)
    assert member.profile_photo_path.startswith(
        f"member_profiles/{member.gym_id}/{member.id}/"
    )
    first_path = member.profile_photo_path
    assert (Path(app.config["UPLOAD_FOLDER"]) / first_path).exists()

    # Replace: a different photo mints a new file and deletes the old one.
    replaced = _upload(client, headers, member.id, image=_png_bytes("#993366"))
    assert replaced.status_code == 200
    assert client.get(replaced.json["data"]["profile_photo_url"]).status_code == 200
    db.session.refresh(member)
    assert member.profile_photo_path != first_path
    assert not (Path(app.config["UPLOAD_FOLDER"]) / first_path).exists()
    assert (Path(app.config["UPLOAD_FOLDER"]) / member.profile_photo_path).exists()
    # The pre-replace URL now 404s (its path is no longer the stored one).
    assert client.get(photo_url).status_code == 404


def test_owner_upload_wrong_gym_member_is_404(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    other_gym = Gym(
        name="Other Gym",
        slug="other-gym",
        email="owner@othergym.com",
        phone="+919876543299",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=14),
        max_members=50,
    )
    db.session.add(other_gym)
    db.session.flush()
    other_member = Member(
        gym_id=other_gym.id,
        full_name="Other Gym Member",
        phone="+919998887700",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(other_member)
    db.session.commit()

    res = _upload(client, headers, other_member.id)
    assert res.status_code == 404


def test_staff_can_set_member_photo(client, seed_gym, seed_member):
    headers = _staff_headers(seed_gym)
    res = _upload(client, headers, seed_member.id)
    assert res.status_code == 200
    assert res.json["data"]["profile_photo_url"]
    assert client.get(res.json["data"]["profile_photo_url"]).status_code == 200


def test_owner_upload_requires_auth(client, seed_member):
    res = _upload(client, {}, seed_member.id)
    assert res.status_code == 401


def test_owner_upload_soft_deleted_member_is_404(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    member = seed_member
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()

    res = _upload(client, headers, member.id)
    assert res.status_code == 404

    removed = client.delete(f"/api/mobile/v1/members/{member.id}/photo", headers=headers)
    assert removed.status_code == 404


def test_owner_upload_rejects_invalid_and_oversize_images(client, seed_gym, seed_member):
    _clear_photo_dir(client, seed_gym, seed_member)
    headers = _owner_headers(seed_gym)

    bad = _upload(
        client, headers, seed_member.id,
        image=BytesIO(b"not an image"), filename="profile.jpg",
    )
    assert bad.status_code == 400
    assert bad.json["error"]["message"] == BAD_IMAGE_MESSAGE

    oversize = _upload(
        client, headers, seed_member.id,
        image=BytesIO(b"\x00" * (3 * 1024 * 1024 + 1)), filename="big.png",
    )
    assert oversize.status_code == 400
    assert oversize.json["error"]["message"] == BAD_IMAGE_MESSAGE

    # Nothing was stored for either rejection.
    assert _photo_files(client, seed_gym, seed_member) == []
    db.session.refresh(seed_member)
    assert seed_member.profile_photo_path is None


def test_owner_upload_idempotency_replays_and_conflicts(client, seed_gym, seed_member):
    _clear_photo_dir(client, seed_gym, seed_member)
    headers = _owner_headers(seed_gym)
    member = seed_member

    first = _upload(client, headers, member.id, key="owner-photo-key-1")
    assert first.status_code == 200
    first_url = first.json["data"]["profile_photo_url"]

    # Same key + same bytes: replayed URL, no second file.
    replay = _upload(client, headers, member.id, key="owner-photo-key-1")
    assert replay.status_code == 200
    assert replay.json["data"]["profile_photo_url"] == first_url
    assert len(_photo_files(client, seed_gym, member)) == 1

    # Same key + different bytes: 409.
    conflict = _upload(
        client, headers, member.id,
        image=_png_bytes("#993366"), key="owner-photo-key-1",
    )
    assert conflict.status_code == 409
    assert len(_photo_files(client, seed_gym, member)) == 1


def test_owner_delete_removes_photo_and_url_404s(client, seed_gym, seed_member):
    _clear_photo_dir(client, seed_gym, seed_member)
    headers = _owner_headers(seed_gym)
    member = seed_member

    uploaded = _upload(client, headers, member.id)
    assert uploaded.status_code == 200
    photo_url = uploaded.json["data"]["profile_photo_url"]
    assert client.get(photo_url).status_code == 200

    removed = client.delete(f"/api/mobile/v1/members/{member.id}/photo", headers=headers)
    assert removed.status_code == 200
    assert removed.json["data"]["profile_photo_url"] is None

    db.session.refresh(member)
    assert member.profile_photo_path is None
    assert _photo_files(client, seed_gym, member) == []
    assert client.get(photo_url).status_code == 404

    # DELETE is naturally idempotent.
    removed_again = client.delete(
        f"/api/mobile/v1/members/{member.id}/photo", headers=headers
    )
    assert removed_again.status_code == 200
    assert removed_again.json["data"]["profile_photo_url"] is None


def test_member_serializer_includes_profile_photo_url(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    member = seed_member

    detail = client.get(f"/api/mobile/v1/members/{member.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json["data"]["profile_photo_url"] is None

    listed = client.get("/api/mobile/v1/members", headers=headers)
    assert listed.status_code == 200
    rows = listed.json["data"]["members"]
    row = next(item for item in rows if item["id"] == member.id)
    assert row["profile_photo_url"] is None

    uploaded = _upload(client, headers, member.id)
    assert uploaded.status_code == 200
    photo_url = uploaded.json["data"]["profile_photo_url"]

    detail = client.get(f"/api/mobile/v1/members/{member.id}", headers=headers)
    assert detail.json["data"]["profile_photo_url"]
    assert client.get(detail.json["data"]["profile_photo_url"]).status_code == 200

    listed = client.get("/api/mobile/v1/members", headers=headers)
    rows = listed.json["data"]["members"]
    row = next(item for item in rows if item["id"] == member.id)
    assert row["profile_photo_url"]
    assert client.get(row["profile_photo_url"]).status_code == 200


def test_serve_endpoint_soft_deleted_member_url_404s(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    member = seed_member

    uploaded = _upload(client, headers, member.id)
    assert uploaded.status_code == 200
    photo_url = uploaded.json["data"]["profile_photo_url"]
    assert client.get(photo_url).status_code == 200

    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()

    assert client.get(photo_url).status_code == 404


def test_hard_delete_removes_profile_photo_file(client, app, seed_gym, seed_member):
    """Spec §4.3 open item: the permanent-removal path must not orphan the file."""
    headers = _owner_headers(seed_gym)
    member = seed_member

    uploaded = _upload(client, headers, member.id)
    assert uploaded.status_code == 200
    db.session.refresh(member)
    photo_path = Path(app.config["UPLOAD_FOLDER"]) / member.profile_photo_path
    assert photo_path.exists()

    # Web hard-delete route (the only permanent-removal path; no bulk
    # hard-delete endpoint exists). Name-confirm is the route's guard.
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
    )
    res = client.post(
        f"/members/{member.id}/hard-delete",
        data={"confirm": member.full_name},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert db.session.get(Member, member.id) is None
    assert not photo_path.exists()
