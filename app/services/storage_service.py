from __future__ import annotations

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
