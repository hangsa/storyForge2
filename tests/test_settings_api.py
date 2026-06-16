"""Tests for Settings API endpoints."""

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_id(client):
    """Create a test project and return its ID."""
    resp = client.post("/api/project/create", json={
        "title": "Settings Test Novel",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "Test project for settings API",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["error"] is False
    return data["detail"]["id"]


class TestGetThresholds:
    def test_returns_defaults(self, client, project_id):
        resp = client.get("/api/settings/thresholds", params={"project_id": project_id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["detail"]["genre"] == "cool_novel"
        assert "addiction_severe" in data["detail"]["defaults"]
        assert "addiction_critical" in data["detail"]["defaults"]

    def test_missing_project_id(self, client):
        resp = client.get("/api/settings/thresholds", params={"project_id": ""})
        assert resp.status_code == 400
        data = resp.json()
        assert data["detail"]["code"] == "VALIDATION_ERROR"


class TestPutThresholds:
    def test_saves_overrides(self, client, project_id):
        overrides = {"addiction_severe": 60, "fatigue_moderate": 40}
        resp = client.put("/api/settings/thresholds", json={
            "project_id": project_id,
            "overrides": overrides,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["detail"]["status"] == "updated"

        # Verify persistence via GET
        resp2 = client.get("/api/settings/thresholds", params={"project_id": project_id})
        assert resp2.status_code == 200
        detail = resp2.json()["detail"]
        assert detail["overrides"] == overrides

    def test_missing_project_id(self, client):
        resp = client.put("/api/settings/thresholds", json={
            "project_id": "",
            "overrides": {},
        })
        assert resp.status_code == 400
        data = resp.json()
        assert data["detail"]["code"] == "VALIDATION_ERROR"


class TestModelConfig:
    def test_returns_config(self, client):
        resp = client.get("/api/settings/model-config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert "tiers" in data["detail"]


class TestReloadConfig:
    def test_reload_succeeds(self, client):
        resp = client.post("/api/settings/reload-config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["detail"]["status"] == "reloaded"
