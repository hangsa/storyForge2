"""Tests for GlobalPromptOverrideStore — YAML scanning, global override persistence, merging.

Mirrors test_prompt_override_store.py but for the project-independent global store.
"""

import json
import pytest
import yaml
from pathlib import Path

from backend.services.global_prompt_override_store import (
    GlobalPromptOverrideStore,
    PROMPT_LABEL_OVERRIDES,
)


@pytest.fixture
def prompts_dir(tmp_path: Path) -> Path:
    """A minimal prompts/ tree with 3 files in 2 categories."""
    (tmp_path / "scene_writing.yaml").write_text(yaml.safe_dump({
        "name": "scene_writing",
        "system_prompt": "default system",
        "user_prompt_template": "default user {var}",
        "temperature": 0.9,
    }))
    (tmp_path / "outline_generation.yaml").write_text(yaml.safe_dump({
        "name": "outline_generation",
        "system_prompt": "outline system",
        "user_prompt_template": "outline user",
        "temperature": 0.7,
    }))
    creative = tmp_path / "creative"
    creative.mkdir()
    (creative / "mutation_op.yaml").write_text(yaml.safe_dump({
        "name": "mutation_op",
        "system_prompt": "mutation system",
        "user_prompt_template": "mutation user",
        "temperature": 0.5,
    }))
    return tmp_path


@pytest.fixture
def global_path(tmp_path: Path) -> Path:
    """Path to the global overrides file (may not exist yet)."""
    # Use a subdir to exercise parent-dir creation on write.
    return tmp_path / "config" / "global_prompt_overrides.json"


def _make_store(prompts_dir: Path, global_path: Path) -> GlobalPromptOverrideStore:
    return GlobalPromptOverrideStore(global_overrides_path=global_path, prompts_dir=prompts_dir)


class TestListAvailable:
    def test_returns_all_yaml_files_grouped_by_category(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        names = {p["name"] for p in result}
        assert names == {"scene_writing", "outline_generation", "mutation_op"}

    def test_root_dir_files_have_empty_category(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        scene = next(p for p in result if p["name"] == "scene_writing")
        assert scene["category"] == ""

    def test_subdir_files_have_subdir_name_as_category(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        mutation = next(p for p in result if p["name"] == "mutation_op")
        assert mutation["category"] == "creative"

    def test_has_override_false_when_no_override_json(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        assert all(p["has_override"] is False for p in result)
        assert all(p["modified_at"] is None for p in result)

    def test_has_override_true_when_override_json_exists(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(
            '{"scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}}'
        )
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        scene = next(p for p in result if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["modified_at"] == "2026-07-19T00:00:00Z"

    def test_label_uses_override_or_fallback_to_name(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.list_available()
        by_name = {p["name"]: p["label"] for p in result}
        assert by_name["scene_writing"] == PROMPT_LABEL_OVERRIDES.get(
            "scene_writing", "scene_writing"
        )
        # mutation_op has no label override → fallback to name
        assert by_name["mutation_op"] == "mutation_op"


class TestGetEffective:
    def test_returns_yaml_default_when_no_override(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        result = store.get_effective("scene_writing")
        assert result["system_prompt"] == "default system"
        assert result["temperature"] == 0.9

    def test_merges_override_on_top_of_yaml(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        store = _make_store(prompts_dir, global_path)
        result = store.get_effective("scene_writing")
        assert result["temperature"] == 0.5
        assert result["system_prompt"] == "default system"
        assert result["user_prompt_template"] == "default user {var}"
        assert "_modified_at" not in result

    def test_merges_override_on_top_of_supplied_base(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"}
        }))
        store = _make_store(prompts_dir, global_path)
        # Supplying a base skips YAML loading and merges override on top.
        base = {"system_prompt": "BASE sys", "temperature": 0.9, "extra": 1}
        result = store.get_effective("scene_writing", base=base)
        assert result["temperature"] == 0.5     # from global override
        assert result["system_prompt"] == "BASE sys"  # from supplied base
        assert result["extra"] == 1             # base preserved

    def test_raises_when_name_not_found(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        with pytest.raises(FileNotFoundError):
            store.get_effective("nonexistent_prompt")


class TestGetOverrideOnly:
    def test_get_override_only_returns_none(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        assert store.get_override_only("scene_writing") is None

    def test_get_override_only_returns_dict(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        store = _make_store(prompts_dir, global_path)
        result = store.get_override_only("scene_writing")
        assert result is not None
        assert result["temperature"] == 0.5
        assert result["_modified_at"] == "2026-07-19T00:00:00Z"

    def test_raises_when_name_not_found(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        with pytest.raises(FileNotFoundError):
            store.get_override_only("nonexistent_prompt")


class TestSetOverride:
    def test_writes_field_only_if_changed_from_yaml_default(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        store.set_override("scene_writing", {
            "system_prompt": "NEW system",
            "temperature": 0.9,  # same as YAML default — should NOT be persisted
        })
        written = json.loads(global_path.read_text())
        assert written["scene_writing"]["system_prompt"] == "NEW system"
        assert "temperature" not in written["scene_writing"]
        assert "_modified_at" in written["scene_writing"]

    def test_merges_with_existing_override(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"system_prompt": "old system", "_modified_at": "x"}
        }))
        store = _make_store(prompts_dir, global_path)
        store.set_override("scene_writing", {
            "user_prompt_template": "NEW user",
        })
        written = json.loads(global_path.read_text())
        scene = written["scene_writing"]
        assert scene["system_prompt"] == "old system"
        assert scene["user_prompt_template"] == "NEW user"
        assert "_modified_at" in scene

    def test_raises_when_name_not_found(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        with pytest.raises(FileNotFoundError):
            store.set_override("nonexistent_prompt", {"system_prompt": "x"})


class TestDeleteOverride:
    def test_removes_entry_from_json(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
            "outline_generation": {"temperature": 0.3, "_modified_at": "y"},
        }))
        store = _make_store(prompts_dir, global_path)
        store.delete_override("scene_writing")
        written = json.loads(global_path.read_text())
        assert "scene_writing" not in written
        assert "outline_generation" in written

    def test_removes_empty_json_file(self, prompts_dir, global_path):
        global_path.parent.mkdir(parents=True, exist_ok=True)
        global_path.write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
        }))
        store = _make_store(prompts_dir, global_path)
        store.delete_override("scene_writing")
        assert not global_path.exists()

    def test_noop_when_override_does_not_exist(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        store.delete_override("scene_writing")  # must not raise
        assert not global_path.exists()


class TestValidateProjectIdNoop:
    def test_validate_project_id_is_noop(self, prompts_dir, global_path):
        store = _make_store(prompts_dir, global_path)
        # Kept for interface symmetry; returns input unchanged, never raises.
        assert store.validate_project_id() is None
        assert store.validate_project_id("anything") == "anything"
