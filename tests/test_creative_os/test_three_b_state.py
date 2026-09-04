"""ThreeBState schema + atomic write helper."""

import json
from pathlib import Path

import pytest

from backend.creative_os.three_b_engine import (
    ThreeBState,
    Candidate,
    DeepenedCandidate,
    RawIntent,
    atomic_write_state,
    load_state,
    STATE_FILE,
)


def _setup_project(tmp_path: Path, project_id: str = "proj_test") -> Path:
    proj = tmp_path / "projects" / project_id
    proj.mkdir(parents=True)
    (proj / "creative_os").mkdir()
    return proj


def test_state_file_constant():
    assert STATE_FILE == "three_b_state.json"


def test_atomic_write_creates_file(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    proj = _setup_project(tmp_path)
    state = ThreeBState(
        schema_version=1,
        project_id="proj_test",
        raw_intent=RawIntent(prompt="test prompt here", genre_primary="修仙", genre_secondary=None),
        committed=False,
    )
    atomic_write_state("proj_test", state)
    path = proj / "creative_os" / "three_b_state.json"
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["schema_version"] == 1
    assert data["raw_intent"]["prompt"] == "test prompt here"
    assert data["committed"] is False


def test_atomic_write_no_tmp_files_left(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    _setup_project(tmp_path)
    state = ThreeBState(schema_version=1, project_id="proj_test", committed=False)
    atomic_write_state("proj_test", state)
    proj = tmp_path / "projects" / "proj_test"
    leftover = [p for p in proj.rglob("*.tmp")]
    assert leftover == [], f"atomic write left tmp files: {leftover}"


def test_load_state_returns_none_when_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    _setup_project(tmp_path)
    assert load_state("proj_test") is None


def test_load_state_round_trip(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    _setup_project(tmp_path)
    state = ThreeBState(
        schema_version=1,
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary="科幻"),
        stage2_candidates=[
            Candidate(
                id="cand_1",
                operator="breaking",
                sub_dimension="打破线性/时间顺序",
                sub_dimension_index=0,
                premise_one_line="倒叙展开",
                rationale="先展示结局",
                novelty_hook="信息倒置",
                recognition_score=0.7,
                strangeness_score=0.6,
                regenerated_count=0,
            )
        ],
        committed=False,
    )
    atomic_write_state("proj_test", state)
    loaded = load_state("proj_test")
    assert loaded is not None
    assert loaded.stage2_candidates[0].id == "cand_1"
    assert loaded.raw_intent.prompt == "x" * 20
