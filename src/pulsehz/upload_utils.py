"""Write uploaded multipart files to disk."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile


async def persist_upload_to_dir(upload: UploadFile, target_dir: str, filename: str) -> str:
    destination = Path(target_dir) / filename
    with destination.open("wb") as output:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    await upload.close()
    return str(destination)
