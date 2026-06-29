from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app

client = TestClient(app)


def _ensure_project(pid: str):
    (Path(settings.projects_dir) / pid).mkdir(parents=True, exist_ok=True)


def test_preview_returns_422_for_short_text():
    pid = "ss_test_1"
    _ensure_project(pid)
    r = client.post(
        f"/api/v1/projects/{pid}/style/sandbox/preview",
        json={"source_text": "短", "params": {}},
    )
    assert r.status_code == 422


def test_preview_skips_when_no_router():
    pid = "ss_test_2"
    _ensure_project(pid)
    with patch("backend.api.style_sandbox.get_model_router", return_value=None):
        r = client.post(
            f"/api/v1/projects/{pid}/style/sandbox/preview",
            json={"source_text": "x" * 200, "params": {}},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["detail"]["skipped_reason"] == "no router"


def test_save_and_list_roundtrip():
    pid = "ss_test_3"
    _ensure_project(pid)
    # save
    r = client.post(
        f"/api/v1/projects/{pid}/style/sandbox/save",
        json={"name": "快节奏 v1", "params": {
            "sentence": {"avg_length_range": [10, 20], "short_sentence_ratio": 0.5,
                         "paragraph_length_range": [80, 200]},
            "dialogue": {"ratio": 0.4, "max_consecutive_lines": 6},
            "rhythm": {"pacing_bpm": 400, "scene_change_frequency": 0.5},
            "density": {"description_ratio": 0.4, "action_ratio": 0.3},
            "satisfaction": {"satisfaction_beat_count": 5, "suspense_hook_required": True},
        }},
    )
    assert r.status_code == 200
    # list
    r2 = client.get(f"/api/v1/projects/{pid}/style/sandbox/configs")
    assert r2.status_code == 200
    body = r2.json()
    assert body["error"] is False
    names = [c["name"] for c in body["detail"]["configs"]]
    assert "快节奏 v1" in names


def test_save_rejects_duplicate_name():
    pid = "ss_test_4"
    _ensure_project(pid)
    payload = {"name": "dup", "params": {
        "sentence": {"avg_length_range": [10, 20], "short_sentence_ratio": 0.5,
                     "paragraph_length_range": [80, 200]},
        "dialogue": {"ratio": 0.4, "max_consecutive_lines": 6},
        "rhythm": {"pacing_bpm": 400, "scene_change_frequency": 0.5},
        "density": {"description_ratio": 0.4, "action_ratio": 0.3},
        "satisfaction": {"satisfaction_beat_count": 5, "suspense_hook_required": True},
    }}
    client.post(f"/api/v1/projects/{pid}/style/sandbox/save", json=payload)
    r2 = client.post(f"/api/v1/projects/{pid}/style/sandbox/save", json=payload)
    assert r2.status_code == 422
