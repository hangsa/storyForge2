"""Tests for /api/v1/creative-dimensions routes."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_dimensions import router
from backend.services.creative_dimensions_store import CreativeDimensionsStore
from backend.creative_os.creative_dimensions import (
    DimensionsCatalog,
    DimensionEntry,
)


@pytest.fixture
def store_with_seed(tmp_path):
    """Returns a store pre-loaded with 1 entry per kind."""
    seed = DimensionsCatalog(
        subject=[DimensionEntry(id="xuanhuan", name="玄幻", description="东方仙侠世界",
                                status="active", order=0,
                                created_at="2026-01-01T00:00:00Z",
                                updated_at="2026-01-01T00:00:00Z")],
        tone=[DimensionEntry(id="rexue", name="热血", description="激烈昂扬",
                             status="inactive", order=0,
                             created_at="2026-01-01T00:00:00Z",
                             updated_at="2026-01-01T00:00:00Z")],
        style=[],
    )
    path = tmp_path / "creative_dimensions.json"
    store = CreativeDimensionsStore(path, lambda: seed)
    store.load()
    return store


@pytest.fixture
def client(store_with_seed):
    app = FastAPI()
    app.include_router(router)
    app.state.creative_dimensions_store = store_with_seed
    return TestClient(app)


def test_get_active_returns_only_active(client):
    resp = client.get("/api/v1/creative-dimensions/active")
    assert resp.status_code == 200
    body = resp.json()
    assert "subject" in body and "tone" in body and "style" in body
    # subject 全部 active
    assert all(e["status"] == "active" for e in body["subject"])
    # tone 中 "rexue" 是 inactive → active 列表不应包含
    assert all(e["status"] == "active" for e in body["tone"])
    assert all(e["status"] == "active" for e in body["style"])


def test_get_all_returns_inactive_too(client):
    resp = client.get("/api/v1/creative-dimensions/")
    assert resp.status_code == 200
    body = resp.json()
    # tone 应包含 "rexue" (inactive)
    assert any(e["id"] == "rexue" for e in body["tone"])


def test_get_by_kind(client):
    resp = client.get("/api/v1/creative-dimensions/subject")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert any(e["id"] == "xuanhuan" for e in body)


def test_get_by_kind_invalid_returns_400(client):
    resp = client.get("/api/v1/creative-dimensions/bogus")
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "INVALID_KIND"


def test_post_creates_entry(client):
    resp = client.post(
        "/api/v1/creative-dimensions/tone",
        json={"name": "新基调", "description": "测试用", "status": "active"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "新基调"
    assert body["id"]  # 自动生成


def test_post_duplicate_name_returns_400(client):
    resp = client.post(
        "/api/v1/creative-dimensions/subject",
        json={"name": "玄幻"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "DUPLICATE_NAME"


def test_put_updates_entry(client):
    resp = client.put(
        "/api/v1/creative-dimensions/tone/rexue",
        json={"name": "热血（升级）", "description": "激烈昂扬2", "status": "active"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "热血（升级）"


def test_put_not_found_returns_404(client):
    resp = client.put(
        "/api/v1/creative-dimensions/tone/missing",
        json={"name": "x"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


def test_delete_removes_entry(client):
    resp = client.delete("/api/v1/creative-dimensions/tone/rexue")
    assert resp.status_code == 200
    # 二次删返回 404
    resp2 = client.delete("/api/v1/creative-dimensions/tone/rexue")
    assert resp2.status_code == 404


def test_payload_extra_forbidden(client):
    resp = client.post(
        "/api/v1/creative-dimensions/style",
        json={"name": "新风格", "bogus_field": "nope"},
    )
    assert resp.status_code == 422


def test_routes_wildcard_does_not_capture_active(client):
    """路由顺序敏感。 /active 不能被 /{kind} 通配捕获。"""
    resp = client.get("/api/v1/creative-dimensions/active")
    # 期望 200 而不是 400 (400 = INVALID_KIND)
    assert resp.status_code == 200
