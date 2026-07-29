"""Tests for GET /api/v1/genres endpoint."""
import pytest
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_list_genres_returns_array(client):
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 7  # at least the 7 existing


def test_list_genres_schema(client):
    resp = client.get("/api/v1/genres")
    data = resp.json()
    for entry in data:
        assert set(entry.keys()) >= {"id", "label_zh", "label_en", "family", "ui_visible"}
        assert isinstance(entry["id"], str)
        assert isinstance(entry["label_zh"], str)


def test_list_genres_ui_visible_only(client):
    resp = client.get("/api/v1/genres?ui_visible_only=true")
    data = resp.json()
    for entry in data:
        assert entry["ui_visible"] is True
