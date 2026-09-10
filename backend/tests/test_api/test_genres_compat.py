"""Compatibility: GET /api/v1/genres reads from new store."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.genres import router
from backend.services.creative_dimensions_store import CreativeDimensionsStore
from backend.creative_os.creative_dimensions import (
    DimensionsCatalog,
    DimensionEntry,
)


@pytest.fixture
def store_with_subject(tmp_path):
    seed = DimensionsCatalog(
        subject=[
            DimensionEntry(id="xuanhuan", name="玄幻", description="",
                           status="active", family="xuanhuan", label_en="Xuanhuan",
                           order=0, created_at="x", updated_at="x"),
            DimensionEntry(id="disabled", name="已禁用题材", description="",
                           status="inactive", order=1,
                           created_at="x", updated_at="x"),
        ],
        tone=[], style=[],
    )
    path = tmp_path / "creative_dimensions.json"
    store = CreativeDimensionsStore(path, lambda: seed)
    store.load()
    return store


@pytest.fixture
def client(store_with_subject):
    app = FastAPI()
    app.include_router(router)
    app.state.creative_dimensions_store = store_with_subject
    return TestClient(app)


def test_default_filters_inactive(client):
    """ui_visible_only=True (默认) → 只返回 status=='active'。"""
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids
    assert "disabled" not in ids


def test_explicit_includes_inactive(client):
    """ui_visible_only=False → 包含 inactive。"""
    resp = client.get("/api/v1/genres?ui_visible_only=false")
    assert resp.status_code == 200
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids
    assert "disabled" in ids


def test_field_mapping_compat(client):
    """返回字段 shape 兼容：label_zh ↔ name, label_en ↔ label_en, family, ui_visible。"""
    resp = client.get("/api/v1/genres")
    g = resp.json()[0]
    assert g["id"] == "xuanhuan"
    assert g["label_zh"] == "玄幻"
    assert g["label_en"] == "Xuanhuan"
    assert g["family"] == "xuanhuan"
    assert g["ui_visible"] is True
