"""Parse JSON project metadata from multipart form strings."""

from __future__ import annotations

import json

from fastapi import HTTPException
from pydantic import ValidationError

from pulsehz.api_models import ProjectMetadata


def parse_project_metadata(metadata: str) -> ProjectMetadata:
    try:
        payload = json.loads(metadata)
        return ProjectMetadata.model_validate(payload)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid metadata: {exc}") from exc
