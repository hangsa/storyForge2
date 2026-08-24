"""Tests for /api/projects/{project_id}/prompts/* endpoints."""

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
def real_prompts_dir(monkeypatch, tmp_path):
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
def real_projects_dir(tmp_path):
    """A real projects_dir but no project subdirs yet."""
    return tmp_path


@pytest.fixture
def global_path(tmp_path):
    """An empty global_prompt_overrides.json path. Plaza tests need an
    isolated global override store so live `config/global_prompt_overrides.json`
    (which has a scene_writing override) doesn't leak in."""
    p = tmp_path / "global_prompt_overrides.json"
    # File intentionally absent — GlobalPromptOverrideStore._read_overrides()
    # returns {} when the file does not exist.
    return p


@pytest.fixture
def project_id(real_projects_dir):
    """Just a string; we don't need a full project file for plaza tests."""
    return "proj_test"


@pytest.fixture(autouse=True)
def patch_store_paths(monkeypatch, real_prompts_dir, real_projects_dir, global_path):
    """Make settings.prompts_dir / projects_dir / global_prompt_overrides_path
    point to tmp_path so we don't touch real config files."""
    monkeypatch.setattr(settings, "prompts_dir", real_prompts_dir)
    monkeypatch.setattr(settings, "projects_dir", real_projects_dir)
    monkeypatch.setattr(settings, "global_prompt_overrides_path", global_path)


class TestGetList:
    def test_returns_200_with_prompts(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}/prompts/list")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        names = {p["name"] for p in data["prompts"]}
        assert names == {"scene_writing", "outline", "mutation"}

    def test_marks_has_override_correctly(self, client, real_projects_dir, project_id):
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/list")
        scene = next(p for p in resp.json()["prompts"] if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["override_source"] == "project"
        assert scene["modified_at"] == "2026-07-19T00:00:00Z"

    def test_global_override_marks_has_override_true(
        self, client, global_path, project_id
    ):
        """A project that inherits only the global override (no project-
        level entry) must still show has_override=True and source='global'.
        Otherwise users would never know the YAML default is being shadowed
        by the tier-1 layer (proj_1a7d7fcf 2026-08-24 regression)."""
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-08-24T00:00:00Z"}
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/list")
        scene = next(p for p in resp.json()["prompts"] if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["override_source"] == "global"
        assert scene["modified_at"] == "2026-08-24T00:00:00Z"

    def test_project_overrides_global_in_source_label(
        self, client, global_path, real_projects_dir, project_id
    ):
        """When BOTH layers have an override, the project one wins for the
        source label and the more recent timestamp is shown."""
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-08-24T01:00:00Z"}
        }))
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.7, "_modified_at": "2026-08-24T02:00:00Z"}
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/list")
        scene = next(p for p in resp.json()["prompts"] if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["override_source"] == "project"
        # Project timestamp is more recent
        assert scene["modified_at"] == "2026-08-24T02:00:00Z"

    def test_no_override_anywhere(self, client, project_id):
        """Default state: no project, no global → has_override=False, source='none'."""
        resp = client.get(f"/api/projects/{project_id}/prompts/list")
        scene = next(p for p in resp.json()["prompts"] if p["name"] == "scene_writing")
        assert scene["has_override"] is False
        assert scene["override_source"] == "none"
        assert scene["modified_at"] is None


class TestGetDetail:
    def test_returns_yaml_override_effective(self, client, real_projects_dir, project_id):
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/scene_writing")
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["builtin_yaml"]["system_prompt"] == "default"
        assert data["override"]["temperature"] == 0.5
        # effective = merged
        assert data["effective"]["system_prompt"] == "default"
        assert data["effective"]["temperature"] == 0.5

    def test_404_when_name_not_found(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}/prompts/nonexistent")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "NOT_FOUND"

    def test_effective_is_3_tier_merged_with_global_override(
        self, client, global_path, real_projects_dir, project_id
    ):
        """When only the global layer overrides scene_writing, the project's
        effective must still reflect the global override (not just YAML).
        proj_1a7d7fcf 2026-08-24: this was returning YAML-only, hiding the
        global override from the user."""
        global_path.write_text(json.dumps({
            "scene_writing": {
                "system_prompt": "global sys",
                "temperature": 0.55,
                "_modified_at": "2026-08-24T00:00:00Z",
            }
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/scene_writing")
        assert resp.status_code == 200
        data = resp.json()
        # override (project) is None — the user has not customized this
        assert data["override"] is None
        # global_override surfaces the tier-1 customization for transparency
        assert data["global_override"] is not None
        assert data["global_override"]["system_prompt"] == "global sys"
        assert data["global_override"]["temperature"] == 0.55
        # effective = YAML + global: temperature comes from global override,
        # system_prompt is fully overridden by global too.
        assert data["effective"]["temperature"] == 0.55
        assert data["effective"]["system_prompt"] == "global sys"

    def test_project_override_wins_over_global_in_effective(
        self, client, global_path, real_projects_dir, project_id
    ):
        """When both layers override the same field, project wins (tier-2 > tier-1)."""
        global_path.write_text(json.dumps({
            "scene_writing": {
                "system_prompt": "global sys",
                "temperature": 0.55,
                "_modified_at": "2026-08-24T01:00:00Z",
            }
        }))
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.77,
                "_modified_at": "2026-08-24T02:00:00Z",
            }
        }))
        resp = client.get(f"/api/projects/{project_id}/prompts/scene_writing")
        data = resp.json()
        # project override surfaces in `override`
        assert data["override"]["temperature"] == 0.77
        # global_override still surfaces separately for transparency
        assert data["global_override"]["system_prompt"] == "global sys"
        # effective is project-over-global: project temp wins, global sys stays
        assert data["effective"]["temperature"] == 0.77
        assert data["effective"]["system_prompt"] == "global sys"

    def test_global_override_is_null_when_no_global_entry(
        self, client, project_id
    ):
        """global_override field is null (not omitted) when no tier-1 entry exists."""
        resp = client.get(f"/api/projects/{project_id}/prompts/scene_writing")
        data = resp.json()
        assert "global_override" in data
        assert data["global_override"] is None


class TestBadProjectId:
    """Bad project_id must return 400 with our envelope, not 500.

    Path-traversal inputs that contain '/' or '..' can't reach this handler
    — they're normalized at the routing layer (404 before any handler runs).
    So we exercise only the cases that survive URL routing: leading dots
    and surrounding whitespace.
    """

    @pytest.mark.parametrize("bad_id", [
        "%2Ehidden",      # leading dot (URL-encoded so it survives routing)
        "%20foo%20",      # surrounding whitespace
    ])
    def test_list_returns_400_envelope(self, client, bad_id):
        resp = client.get(f"/api/projects/{bad_id}/prompts/list")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_get_returns_400_envelope(self, client):
        resp = client.get("/api/projects/%2Ehidden/prompts/scene_writing")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_put_returns_400_envelope(self, client):
        resp = client.put(
            "/api/projects/%2Ehidden/prompts/scene_writing",
            json={"system_prompt": "x"},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_delete_returns_400_envelope(self, client):
        resp = client.delete("/api/projects/%20foo%20/prompts/scene_writing")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


class TestPutOverride:
    def test_writes_override_and_returns_200(self, client, real_projects_dir, project_id):
        resp = client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={"system_prompt": "new sys", "temperature": 0.5},
        )
        assert resp.status_code == 200
        # Verify file written
        written = json.loads(
            (real_projects_dir / project_id / "prompt_overrides.json").read_text()
        )
        assert written["scene_writing"]["system_prompt"] == "new sys"
        assert written["scene_writing"]["temperature"] == 0.5
        assert "_modified_at" in written["scene_writing"]

    def test_prunes_field_equal_to_default(self, client, real_projects_dir, project_id):
        client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={"temperature": 0.9},  # same as default
        )
        written = json.loads(
            (real_projects_dir / project_id / "prompt_overrides.json").read_text()
        )
        # temperature should be pruned (matches YAML default)
        assert "temperature" not in written["scene_writing"]

    def test_400_on_invalid_temperature(self, client, project_id):
        resp = client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={"temperature": 5.0},  # out of [0.0, 2.0]
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_404_when_name_not_found(self, client, project_id):
        resp = client.put(
            f"/api/projects/{project_id}/prompts/nonexistent",
            json={"system_prompt": "x"},
        )
        assert resp.status_code == 404

    def test_put_rejects_model_field_with_422(self, client, project_id):
        """The `model` field is a dead UI artifact — backend must reject it."""
        resp = client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={"system_prompt": "x", "model": "MiniMax-M3"},
        )
        assert resp.status_code == 422

    def test_put_accepts_negative_constraints_field(
        self, client, real_projects_dir, project_id
    ):
        """Per-project plaza accepts new negative_constraints field on PUT."""
        resp = client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={
                "system_prompt": "sys",
                "user_prompt_template": "user",
                "temperature": 0.5,
                "max_tokens": 100,
                "negative_constraints": "不要使用回合制战斗描写\n不要出现现代品牌名",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["error"] is False
        saved = body["detail"]["override"]
        assert saved["negative_constraints"] == (
            "不要使用回合制战斗描写\n不要出现现代品牌名"
        )
        # Also verify it was persisted to disk unchanged
        written = json.loads(
            (real_projects_dir / project_id / "prompt_overrides.json").read_text()
        )
        assert written["scene_writing"]["negative_constraints"] == (
            "不要使用回合制战斗描写\n不要出现现代品牌名"
        )


class TestDeleteOverride:
    def test_removes_override_and_returns_200(self, client, real_projects_dir, project_id):
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
        }))
        resp = client.delete(f"/api/projects/{project_id}/prompts/scene_writing")
        assert resp.status_code == 200
        assert resp.json()["detail"]["status"] == "reset"
        # File should be removed (only had one entry)
        assert not (proj_dir / "prompt_overrides.json").exists()

    def test_keeps_other_entries_in_json(self, client, real_projects_dir, project_id):
        proj_dir = real_projects_dir / project_id
        proj_dir.mkdir()
        (proj_dir / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
            "outline": {"temperature": 0.3, "_modified_at": "y"},
        }))
        resp = client.delete(f"/api/projects/{project_id}/prompts/scene_writing")
        assert resp.status_code == 200
        written = json.loads((proj_dir / "prompt_overrides.json").read_text())
        assert "scene_writing" not in written
        assert "outline" in written