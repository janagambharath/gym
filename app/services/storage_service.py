from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


def allowed_image(filename: str) -> bool:
    if "." not in filename:
        return False
    extension = filename.rsplit(".", 1)[1].lower()
    return extension in current_app.config["ALLOWED_IMAGE_EXTENSIONS"]


def save_gym_qr(file: FileStorage, gym_id: int) -> str:
    if not file or not file.filename:
        raise ValueError("No file selected")
    if not allowed_image(file.filename):
        raise ValueError("Unsupported QR image type")

    extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    relative_dir = Path("gym_qr") / str(gym_id)
    absolute_dir = Path(current_app.config["UPLOAD_FOLDER"]) / relative_dir
    absolute_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid4().hex}.{extension}"
    file.save(absolute_dir / filename)
    return str(relative_dir / filename).replace("\\", "/")
