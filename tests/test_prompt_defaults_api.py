"""Tests for /api/prompts/defaults/* endpoints (project-independent global overrides)."""

import json
import pytest
import yaml
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import settings


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def real_prompts_dir(tmp_path):
    """Point the store at a tmp_path with 3 fixture YAMLs."""
    (tmp_path / "scene_writing.yaml").write_text(yaml.safe_dump({
        "name": "scene_writing",
        "system_prompt": "default",
        "user_prompt_template": "user default {var}",
        "temperature": 0.9,
        "max_tokens": 1000,
    }))
    (tmp_path / "outline.yaml").write_text(yaml.safe_dump({
        "name": "outline",
        "system_prompt": "outline sys",
        "user_prompt_template": "outline user",
        "temperature": 0.7,
    }))
    creative = tmp_path / "creative"
    creative.mkdir()
    (creative / "mutation.yaml").write_text(yaml.safe_dump({
        "name": "mutation",
        "system_prompt": "mut sys",
        "user_prompt_template": "mut user",
        "temperature": 0.5,
    }))
    return tmp_path


@pytest.fixture
def global_path(tmp_path):
    """Path to the global overrides file (parent created on write)."""
    return tmp_path / "config" / "global_prompt_overrides.json"


@pytest.fixture(autouse=True)
def patch_store_paths(monkeypatch, real_prompts_dir, global_path):
    """Make settings.prompts_dir / global_prompt_overrides_path point to tmp_path."""
    monkeypatch.setattr(settings, "prompts_dir", real_prompts_dir)
    monkeypatch.setattr(settings, "global_prompt_overrides_path", global_path)


class TestGetList:
    def test_returns_200_with_prompts(self, client):
        resp = client.get("/api/prompts/defaults/list")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        names = {p["name"] for p in data["prompts"]}
        assert names == {"scene_writing", "outline", "mutation"}

    def test_marks_has_override_correctly(self, client, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}
        }))
        resp = client.get("/api/prompts/defaults/list")
        scene = next(p for p in resp.json()["prompts"] if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["modified_at"] == "2026-07-19T00:00:00Z"


class TestGetDetail:
    def test_returns_yaml_override_effective(self, client, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}
        }))
        resp = client.get("/api/prompts/defaults/scene_writing")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["builtin_yaml"]["system_prompt"] == "default"
        assert data["override"]["temperature"] == 0.5
        # effective = merged
        assert data["effective"]["system_prompt"] == "default"
        assert data["effective"]["temperature"] == 0.5

    def test_404_when_name_not_found(self, client):
        resp = client.get("/api/prompts/defaults/nonexistent")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "NOT_FOUND"


class TestPutOverride:
    def test_writes_override_and_returns_200(self, client, global_path):
        resp = client.put(
            "/api/prompts/defaults/scene_writing",
            json={"system_prompt": "new sys", "temperature": 0.5},
        )
        assert resp.status_code == 200
        written = json.loads(global_path.read_text())
        assert written["scene_writing"]["system_prompt"] == "new sys"
        assert written["scene_writing"]["temperature"] == 0.5
        assert "_modified_at" in written["scene_writing"]

    def test_prunes_field_equal_to_default(self, client, global_path):
        client.put(
            "/api/prompts/defaults/scene_writing",
            json={"temperature": 0.9},  # same as default
        )
        written = json.loads(global_path.read_text())
        assert "temperature" not in written["scene_writing"]

    def test_400_on_invalid_temperature(self, client):
        resp = client.put(
            "/api/prompts/defaults/scene_writing",
            json={"temperature": 5.0},  # out of [0.0, 2.0]
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_400_on_invalid_max_tokens(self, client):
        resp = client.put(
            "/api/prompts/defaults/scene_writing",
            json={"max_tokens": 0},  # out of [1, 32768]
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_404_when_name_not_found(self, client):
        resp = client.put(
            "/api/prompts/defaults/nonexistent",
            json={"system_prompt": "x"},
        )
        assert resp.status_code == 404

    def test_put_rejects_model_field_with_422(self, client):
        """The `model` field is a dead UI artifact — backend must reject it."""
        resp = client.put(
            "/api/prompts/defaults/scene_writing",
            json={"system_prompt": "x", "model": "MiniMax-M3"},
        )
        assert resp.status_code == 422


class TestDeleteOverride:
    def test_removes_override_and_returns_200(self, client, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
        }))
        resp = client.delete("/api/prompts/defaults/scene_writing")
        assert resp.status_code == 200
        assert resp.json()["detail"]["status"] == "reset"
        # File should be removed (only had one entry)
        assert not global_path.exists()

    def test_keeps_other_entries_in_json(self, client, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
            "outline": {"temperature": 0.3, "_modified_at": "y"},
        }))
        resp = client.delete("/api/prompts/defaults/scene_writing")
        assert resp.status_code == 200
        written = json.loads(global_path.read_text())
        assert "scene_writing" not in written
        assert "outline" in written
