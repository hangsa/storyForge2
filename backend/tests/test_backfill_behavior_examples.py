"""Tests for scripts/backfill_behavior_examples.py.

Mocks PlannerAgent.generate_character to avoid LLM costs.
"""
import json
import pytest
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, AsyncMock


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_behavior_examples.py"


async def _fake_generate(*args, **kwargs):
    """Module-level stub used by both the in-process patch fixture and the
    subprocess --llm-stub flag. Defined at module scope so the subprocess
    can import it via 'test_backfill_behavior_examples:_fake_generate'."""
    return ({"voice_signature": {"behavior_examples": [
        {"situation": "新场景", "action": "新行为", "speech_sample": "新台词"},
    ]}}, None)


def _write_characters(projects_dir: Path, project_id: str, characters: list[dict]) -> None:
    (projects_dir / project_id).mkdir(parents=True, exist_ok=True)
    (projects_dir / project_id / "characters.json").write_text(
        json.dumps({"characters": characters}, ensure_ascii=False),
        encoding="utf-8",
    )


def _read_characters(projects_dir: Path, project_id: str) -> list[dict]:
    return json.loads(
        (projects_dir / project_id / "characters.json").read_text(encoding="utf-8")
    )["characters"]


@pytest.fixture(autouse=True)
def patch_planner(monkeypatch):
    """Patch the in-process PlannerAgent and inject --llm-stub into the
    subprocess CLI so the same stub function is used in both contexts.

    subprocess.run starts a brand-new Python process where unittest.mock
    patches don't propagate, so the CLI call needs an out-of-band injection
    mechanism. The script supports `--llm-stub module:function`; we point it
    at the module-level `_fake_generate` defined above."""
    # In-process patch — only matters for code paths that run in the pytest
    # process itself; the subprocess invocation below uses --llm-stub.
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = _fake_generate
        yield MockPlanner


def _run_cli(projects_dir: Path, *args) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT),
         "--projects-dir", str(projects_dir),
         "--llm-stub", "backend.tests.test_backfill_behavior_examples:_fake_generate",
         *args],
        capture_output=True, text=True,
    )


def test_dry_run_makes_no_writes(tmp_path):
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a", "--dry-run")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    assert chars[0]["voice_signature"].get("behavior_examples") is None or \
        chars[0]["voice_signature"].get("behavior_examples") == []
    assert "DRY RUN" in result.stdout


def test_fills_missing_behavior_examples(tmp_path):
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    assert len(chars[0]["voice_signature"]["behavior_examples"]) == 1


def test_idempotent_skip_existing(tmp_path):
    """Running twice does NOT re-LLM characters that already have examples."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [
                                  {"situation": "已有", "action": "已有", "speech_sample": "已有"}
                              ]}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    # The pre-existing example is preserved (no LLM call).
    assert chars[0]["voice_signature"]["behavior_examples"][0]["situation"] == "已有"


def test_resumable_from_progress_file(tmp_path):
    """Killing mid-run + restarting continues from .backfill_progress.json."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
        {"id": "c2", "name": "Bob", "character_type": "supporting",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    # Pre-seed progress file marking c1 done.
    progress_path = tmp_path / "proj_a" / ".backfill_progress.json"
    progress_path.write_text(json.dumps({"completed_ids": ["c1"]}), encoding="utf-8")
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    # c1 still has no examples (skipped), c2 has examples (filled).
    assert chars[0]["voice_signature"].get("behavior_examples") in (None, [])
    assert len(chars[1]["voice_signature"]["behavior_examples"]) == 1


def test_walks_all_projects_when_no_project_id(tmp_path):
    """No --project-id → walk all project dirs."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    _write_characters(tmp_path, "proj_b", [
        {"id": "c1", "name": "Bob", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path)
    assert result.returncode == 0
    assert len(_read_characters(tmp_path, "proj_a")[0]["voice_signature"]["behavior_examples"]) == 1
    assert len(_read_characters(tmp_path, "proj_b")[0]["voice_signature"]["behavior_examples"]) == 1