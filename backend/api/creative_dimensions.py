"""REST API for creative dimensions (subject / tone / style).

Routes (mounted at /api/v1/creative-dimensions):
  GET    /active                  - S1 一次拿齐，按 kind 各返回 active 列表
  GET    /                        - 管理页用，返回全量 (含 inactive)
  GET    /{kind}                  - 单维度列表（全量）
  POST   /{kind}                  - 新增条目 (id 自动生成)
  PUT    /{kind}/{entry_id}       - 更新
  DELETE /{kind}/{entry_id}       - 删除

⚠️ 路由顺序敏感：`/active` 和 `/` 必须在 `/{kind}` 之前注册，否则会被
通配捕获（FastAPI 路由按声明顺序匹配）。代码块严格保持该顺序。
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api._errors import http_error
from backend.creative_os.creative_dimensions import (
    DimensionEntryPayload,
    VALID_KINDS,
)


router = APIRouter(prefix="/api/v1/creative-dimensions", tags=["creative_dimensions"])


def _store(request: Request):
    store = getattr(request.app.state, "creative_dimensions_store", None)
    if store is None:
        raise http_error(503, "STORE_UNAVAILABLE", "creative_dimensions_store 未初始化")
    return store


@router.get("/active")
async def list_active(request: Request) -> dict:
    store = _store(request)
    return {
        "subject": [vars(e) for e in store.list("subject", active_only=True)],
        "tone":    [vars(e) for e in store.list("tone",    active_only=True)],
        "style":   [vars(e) for e in store.list("style",   active_only=True)],
    }


@router.get("")
async def list_all(request: Request) -> dict:
    store = _store(request)
    return {
        "subject": [vars(e) for e in store.list("subject", active_only=False)],
        "tone":    [vars(e) for e in store.list("tone",    active_only=False)],
        "style":   [vars(e) for e in store.list("style",   active_only=False)],
    }


@router.get("/{kind}")
async def list_by_kind(kind: str, request: Request) -> list[dict]:
    if kind not in VALID_KINDS:
        raise http_error(400, "INVALID_KIND", f"unknown kind: {kind!r}", kind=kind)
    store = _store(request)
    return [vars(e) for e in store.list(kind, active_only=False)]


@router.post("/{kind}")
async def add_entry(kind: str, payload: DimensionEntryPayload, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise http_error(400, "INVALID_KIND", f"unknown kind: {kind!r}", kind=kind)
    store = _store(request)
    try:
        entry = store.add(kind, payload)
    except ValueError as e:
        msg = str(e)
        if "duplicate name" in msg:
            raise http_error(400, "DUPLICATE_NAME", msg, kind=kind) from e
        raise http_error(400, "BAD_REQUEST", msg, kind=kind) from e
    return vars(entry)


@router.put("/{kind}/{entry_id}")
async def update_entry(kind: str, entry_id: str, payload: DimensionEntryPayload, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise http_error(400, "INVALID_KIND", f"unknown kind: {kind!r}", kind=kind)
    store = _store(request)
    try:
        entry = store.update(kind, entry_id, payload)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise http_error(404, "NOT_FOUND", msg, kind=kind, entry_id=entry_id) from e
        if "duplicate name" in msg:
            raise http_error(400, "DUPLICATE_NAME", msg, kind=kind, entry_id=entry_id) from e
        raise http_error(400, "BAD_REQUEST", msg, kind=kind, entry_id=entry_id) from e
    return vars(entry)


@router.delete("/{kind}/{entry_id}")
async def delete_entry(kind: str, entry_id: str, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise http_error(400, "INVALID_KIND", f"unknown kind: {kind!r}", kind=kind)
    store = _store(request)
    if not store.delete(kind, entry_id):
        raise http_error(404, "NOT_FOUND", f"entry not found: {entry_id!r} in {kind}",
                         kind=kind, entry_id=entry_id)
    return {"deleted": True, "id": entry_id}
