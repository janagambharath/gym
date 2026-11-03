from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


_EXTENSION_TO_TYPE = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}


def allowed_image(filename: str) -> bool:
    if "." not in filename:
        return False
    extension = filename.rsplit(".", 1)[1].lower()
    return extension in current_app.config["ALLOWED_IMAGE_EXTENSIONS"]


def _detect_image_type(header: bytes) -> str | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(header) >= 12 and header[0:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    return None


def _validate_image_content(file: FileStorage) -> str:
    header = file.stream.read(512)
    file.stream.seek(0)
    detected_type = _detect_image_type(header)
    if detected_type not in {"png", "jpeg", "webp"}:
        raise ValueError("File content is not a valid PNG, JPEG, or WebP image.")
    return detected_type


def save_gym_qr(file: FileStorage, gym_id: int) -> str:
    if not file or not file.filename:
        raise ValueError("No file selected")
    original_name = secure_filename(file.filename)
    if not allowed_image(original_name):
        raise ValueError("Unsupported QR image type")

    claimed_extension = original_name.rsplit(".", 1)[1].lower()
    detected_type = _validate_image_content(file)
    if _EXTENSION_TO_TYPE.get(claimed_extension) != detected_type:
        raise ValueError("File extension does not match image content.")

    extension = "jpg" if detected_type == "jpeg" else detected_type
    if current_app.config.get("STORAGE_BACKEND") == "s3":
        return _save_to_s3(file, gym_id, extension)
    return _save_to_local(file, gym_id, extension)


def save_member_profile_photo(file: FileStorage, gym_id: int, member_id: int) -> str:
    """Validate, normalize, and store a small member profile photo.

    Decoding and re-encoding with Pillow strips EXIF metadata and prevents a
    renamed non-image file from being served as a profile photo.
    """
    if not file or not file.filename:
        raise ValueError("Choose a photo to upload.")

    raw = file.stream.read(3 * 1024 * 1024 + 1)
    file.stream.seek(0)
    if len(raw) > 3 * 1024 * 1024:
        raise ValueError("Profile photos must be 3 MB or smaller.")

    try:
        from PIL import Image, ImageOps

        with Image.open(BytesIO(raw)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Use a JPEG, PNG, or WebP photo.")
            if image.width * image.height > 24_000_000:
                raise ValueError("This photo is too large to process. Choose a smaller image.")
            image.verify()
        with Image.open(BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            normalized = BytesIO()
            image.save(normalized, format="JPEG", quality=86, optimize=True)
            content = normalized.getvalue()
    except ValueError:
        raise
    except Exception as exc:
        # Keep parser details out of the API response.
        raise ValueError("The selected file is not a supported image.") from exc

    key = f"member_profiles/{gym_id}/{member_id}/{uuid4().hex}.jpg"
    if current_app.config.get("STORAGE_BACKEND") == "s3":
        import boto3

        bucket = current_app.config.get("AWS_S3_BUCKET")
        if not bucket:
            raise ValueError("AWS_S3_BUCKET is required when STORAGE_BACKEND=s3")
        s3 = boto3.client(
            "s3",
            aws_access_key_id=current_app.config.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=current_app.config.get("AWS_SECRET_ACCESS_KEY"),
            region_name=current_app.config.get("AWS_S3_REGION"),
        )
        s3.upload_fileobj(BytesIO(content), bucket, key, ExtraArgs={"ContentType": "image/jpeg"})
    else:
        target = Path(current_app.config["UPLOAD_FOLDER"]) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return key


def delete_member_profile_photo(path: str | None) -> None:
    """Delete only a generated member-profile key from the configured store."""
    if not path:
        return
    normalized = path.replace("\\", "/")
    parts = normalized.split("/")
    if len(parts) != 4 or parts[0] != "member_profiles" or not parts[1].isdigit() or not parts[2].isdigit():
        raise ValueError("Refusing to delete a file outside member profile storage.")
    filename = parts[3]
    if (
        len(filename) != 36
        or not filename.endswith(".jpg")
        or any(char not in "0123456789abcdef" for char in filename[:-4])
    ):
        raise ValueError("Refusing to delete a file outside member profile storage.")
    if current_app.config.get("STORAGE_BACKEND") == "s3":
        import boto3

        bucket = current_app.config.get("AWS_S3_BUCKET")
        if not bucket:
            raise ValueError("AWS_S3_BUCKET is required when STORAGE_BACKEND=s3")
        s3 = boto3.client(
            "s3",
            aws_access_key_id=current_app.config.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=current_app.config.get("AWS_SECRET_ACCESS_KEY"),
            region_name=current_app.config.get("AWS_S3_REGION"),
        )
        s3.delete_object(Bucket=bucket, Key=normalized)
        return
    delete_local_upload(normalized)


def delete_local_upload(relative_path: str | None) -> None:
    if not relative_path:
        return
    upload_root = Path(current_app.config["UPLOAD_FOLDER"]).resolve()
    target = (upload_root / relative_path).resolve()
    if upload_root != target and upload_root not in target.parents:
        raise ValueError("Refusing to delete a file outside the upload folder.")
    if target.exists() and target.is_file():
        target.unlink()


def invalidate_whatsapp_media_cache(phone_number_id: str | None, media_url: str | None) -> None:
    if not phone_number_id or not media_url:
        return
    redis_url = current_app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        return
    try:
        import redis as _redis

        url_hash = hashlib.sha256(media_url.encode()).hexdigest()[:16]
        cache_key = f"wa_media_id:{phone_number_id}:{url_hash}"
        redis_client = _redis.from_url(redis_url, socket_connect_timeout=2)
        redis_client.delete(cache_key)
    except Exception:
        current_app.logger.exception("Could not invalidate WhatsApp media cache")


def _save_to_local(file: FileStorage, gym_id: int, extension: str) -> str:
    relative_dir = Path("gym_qr") / str(gym_id)
    absolute_dir = Path(current_app.config["UPLOAD_FOLDER"]) / relative_dir
    absolute_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid4().hex}.{extension}"
    file.save(absolute_dir / filename)
    return str(relative_dir / filename).replace("\\", "/")


def _save_to_s3(file: FileStorage, gym_id: int, extension: str) -> str:
    import boto3

    bucket = current_app.config["AWS_S3_BUCKET"]
    if not bucket:
        raise ValueError("AWS_S3_BUCKET is required when STORAGE_BACKEND=s3")

    key = f"gym_qr/{gym_id}/{uuid4().hex}.{extension}"
    s3 = boto3.client(
        "s3",
        aws_access_key_id=current_app.config["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=current_app.config["AWS_SECRET_ACCESS_KEY"],
        region_name=current_app.config["AWS_S3_REGION"],
    )
    content_type = "image/jpeg" if extension == "jpg" else f"image/{extension}"
    s3.upload_fileobj(file.stream, bucket, key, ExtraArgs={"ContentType": content_type})

    public_base = current_app.config.get("AWS_S3_PUBLIC_BASE_URL")
    if public_base:
        return f"{public_base}/{key}"
    region = current_app.config["AWS_S3_REGION"]
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
