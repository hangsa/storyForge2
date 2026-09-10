"""GET /api/v1/genres — list all genres for the frontend.

读 CreativeDimensionsStore 的 subject 维度（兼容原 catalog 接口）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request


router = APIRouter(prefix="/api/v1/genres", tags=["genres"])


@router.get("")
async def list_genres(request: Request, ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` 因为 primary caller 是 UI dropdown。
    Admin / internal caller 可传 `?ui_visible_only=false` 拿全量。

    字段映射（向后兼容）：
      id         ↔ DimensionEntry.id
      label_zh   ↔ DimensionEntry.name
      label_en   ↔ DimensionEntry.label_en
      family     ↔ DimensionEntry.family
      ui_visible ↔ (status == "active")
    """
    store = getattr(request.app.state, "creative_dimensions_store", None)
    if store is None:
        # 后备路径：仍读原 catalog YAML（首次启动时 store 未就绪）
        from backend.genres.catalog import get_catalog
        return get_catalog().list(ui_visible_only=ui_visible_only)

    entries = store.list("subject", active_only=ui_visible_only)
    return [
        {
            "id":         e.id,
            "label_zh":   e.name,
            "label_en":   e.label_en or "",
            "family":     e.family or "",
            "ui_visible": e.status == "active",
        }
        for e in entries
    ]
