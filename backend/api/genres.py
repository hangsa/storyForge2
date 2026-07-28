"""GET /api/v1/genres — list all genres for the frontend."""
from fastapi import APIRouter

from backend.genres.catalog import get_catalog

router = APIRouter(prefix="/api/v1/genres", tags=["genres"])


@router.get("")
async def list_genres(ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` because the primary caller is the UI dropdown.
    Admin / internal callers can pass `?ui_visible_only=false` to get the full set.
    """
    return get_catalog().list(ui_visible_only=ui_visible_only)
