"""Tests for /api/v1/projects/{id}/creative/diverge/three-b/* routes.

Covers: GET/DELETE /state, POST /diverge (validation + happy path),
POST /deepen (same-operator rejection), POST /commit (id count validation).
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_engine():
    """Reset the module-level _engine cache so per-test patches on
    ThreeBEngine take effect (the lazy getter caches on first call).
    """
    import backend.api.three_b_routes as routes
    routes._engine = None
    yield
    routes._engine = None


def _seed_state(project_id: str, monkeypatch, tmp_path) -> None:
    """Create a project dir + ThreeBState with one candidate + one deepening."""
    monkeypatch.setattr(
        "backend.config.settings.projects_dir", str(tmp_path / "projects")
    )
    proj = tmp_path / "projects" / project_id
    proj.mkdir(parents=True)
    (proj / "creative_os").mkdir()
    from backend.creative_os.three_b_engine import (
        Candidate,
        DeepenedCandidate,
        RawIntent,
        ThreeBState,
        atomic_write_state,
    )
    state = ThreeBState(
        project_id=project_id,
        raw_intent=RawIntent(
            prompt="测试灵感足够长 prompt text",
            genre_primary="玄幻",
            genre_secondary="科幻",
        ),
        stage2_candidates=[
            Candidate(
                id="cand_a1",
                operator="breaking",
                sub_dimension="打破线性/时间顺序",
                sub_dimension_index=0,
                premise_one_line="倒叙展开",
                rationale="xx",
                novelty_hook="yy",
            )
        ],
        stage3_deepened=[
            DeepenedCandidate(
                id="deep_x1",
                source_candidate_id="cand_a1",
                source_operator="breaking",
                applied_operator="bending",
                applied_sub_dimension="尺度扭曲",
                applied_sub_dimension_index=0,
                premise_one_line="压缩到一呼",
                rationale="xx",
                novelty_hook="yy",
            )
        ],
    )
    atomic_write_state(project_id, state)


def test_state_get_returns_existing(client, tmp_path, monkeypatch):
    _seed_state("p_state_get", monkeypatch, tmp_path)
    resp = client.get(
        "/api/v1/projects/p_state_get/creative/diverge/three-b/state"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["stage2_candidates"][0]["operator"] == "breaking"
    assert data["stage3_deepened"][0]["applied_operator"] == "bending"


def test_state_get_returns_empty_when_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.config.settings.projects_dir", str(tmp_path / "projects")
    )
    (tmp_path / "projects" / "p_empty").mkdir(parents=True)
    resp = client.get(
        "/api/v1/projects/p_empty/creative/diverge/three-b/state"
    )
    assert resp.status_code == 200
    assert resp.json()["stage2_candidates"] == []


def test_state_delete_removes_file(client, tmp_path, monkeypatch):
    _seed_state("p_del", monkeypatch, tmp_path)
    resp = client.delete(
        "/api/v1/projects/p_del/creative/diverge/three-b/state"
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    state_path = (
        tmp_path / "projects" / "p_del" / "creative_os" / "three_b_state.json"
    )
    assert not state_path.exists()


def test_diverge_validates_prompt_min_length(client, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.config.settings.projects_dir", str(tmp_path / "projects")
    )
    (tmp_path / "projects" / "p_short").mkdir(parents=True)
    resp = client.post(
        "/api/v1/projects/p_short/creative/diverge/three-b/diverge",
        json={"prompt": "短", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422


def test_diverge_happy_path(client, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.config.settings.projects_dir", str(tmp_path / "projects")
    )
    (tmp_path / "projects" / "p_diverge").mkdir(parents=True)
    with patch("backend.api.three_b_routes.ThreeBEngine") as MockEngine:
        instance = MockEngine.return_value
        instance.diverge = AsyncMock(
            return_value={
                "candidates": [
                    {
                        "id": "cand_a1",
                        "operator": "breaking",
                        "sub_dimension": "打破线性/时间顺序",
                        "premise_one_line": "x",
                        "rationale": "y",
                        "novelty_hook": "z",
                    }
                ],
                "by_operator": {
                    "breaking": [{"id": "cand_a1"}],
                    "bending": [],
                    "blending": [],
                },
            }
        )
        resp = client.post(
            "/api/v1/projects/p_diverge/creative/diverge/three-b/diverge",
            json={
                "prompt": "足够长的原始灵感 text",
                "genre_primary": "玄幻",
                "genre_secondary": "科幻",
            },
        )
    assert resp.status_code == 200
    assert resp.json()["candidates"][0]["operator"] == "breaking"


def test_deepen_rejects_same_operator(client, tmp_path, monkeypatch):
    _seed_state("p_same_op", monkeypatch, tmp_path)
    with patch("backend.api.three_b_routes.ThreeBEngine") as MockEngine:
        instance = MockEngine.return_value
        # MagicMock is not awaitable — must be AsyncMock so `await ...` works.
        instance.deepen = AsyncMock(
            side_effect=ValueError("必须选择不同的算子(applied_operator != source_operator)")
        )
        resp = client.post(
            "/api/v1/projects/p_same_op/creative/diverge/three-b/deepen",
            json={"candidate_id": "cand_a1", "applied_operator": "breaking"},
        )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "DEEPEN_VALIDATION"


def test_commit_validates_id_count(client, tmp_path, monkeypatch):
    _seed_state("p_commit_empty", monkeypatch, tmp_path)
    resp = client.post(
        "/api/v1/projects/p_commit_empty/creative/diverge/three-b/commit",
        json={"deepened_ids": []},
    )
    assert resp.status_code == 422


def test_commit_runtime_error_returns_503(client, tmp_path, monkeypatch):
    """Any non-ValueError exception from engine.commit() must surface as
    503 COMMIT_FAILED (matching the post_diverge contract), not a raw 500.
    """
    _seed_state("p_commit_503", monkeypatch, tmp_path)
    with patch("backend.api.three_b_routes.ThreeBEngine") as MockEngine:
        instance = MockEngine.return_value
        instance.commit = AsyncMock(side_effect=RuntimeError("boom"))
        resp = client.post(
            "/api/v1/projects/p_commit_503/creative/diverge/three-b/commit",
            json={"deepened_ids": ["deep_x1"]},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "COMMIT_FAILED"
    assert "3B 概念合成失败" in resp.json()["detail"]["message"]
