"""Tests for PromptOverrideStore — YAML scanning, override persistence, and merging."""

import json
import pytest
import yaml
from pathlib import Path

from backend.services.prompt_override_store import (
    PromptOverrideStore,
    PROMPT_CATEGORIES,
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
def projects_dir(tmp_path: Path) -> Path:
    """An empty projects/ root. Test creates proj_xxx subdirs as needed."""
    return tmp_path


def _make_store(prompts_dir: Path, projects_dir: Path) -> PromptOverrideStore:
    return PromptOverrideStore(projects_dir=projects_dir, prompts_dir=prompts_dir)


class TestListAvailable:
    def test_returns_all_yaml_files_grouped_by_category(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_test")
        names = {p["name"] for p in result}
        assert names == {"scene_writing", "outline_generation", "mutation_op"}

    def test_root_dir_files_have_empty_category(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_test")
        scene = next(p for p in result if p["name"] == "scene_writing")
        assert scene["category"] == ""

    def test_subdir_files_have_subdir_name_as_category(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_test")
        mutation = next(p for p in result if p["name"] == "mutation_op")
        assert mutation["category"] == "creative"

    def test_has_override_false_when_no_override_json(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_empty")
        assert all(p["has_override"] is False for p in result)
        assert all(p["modified_at"] is None for p in result)

    def test_has_override_true_when_override_json_exists(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_with"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(
            '{"scene_writing": {"temperature": 0.5, "_modified_at": "2026-07-19T00:00:00Z"}}'
        )
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_with")
        scene = next(p for p in result if p["name"] == "scene_writing")
        assert scene["has_override"] is True
        assert scene["modified_at"] == "2026-07-19T00:00:00Z"

    def test_label_uses_override_or_fallback_to_name(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.list_available("proj_test")
        by_name = {p["name"]: p["label"] for p in result}
        # scene_writing has override → use it
        assert by_name["scene_writing"] == PROMPT_LABEL_OVERRIDES.get(
            "scene_writing", "scene_writing"
        )
        # mutation_op has no override → fallback to name
        assert by_name["mutation_op"] == "mutation_op"


class TestGetEffective:
    def test_returns_yaml_default_when_no_override(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        result = store.get_effective("proj_empty", "scene_writing")
        assert result["system_prompt"] == "default system"
        assert result["temperature"] == 0.9

    def test_merges_override_on_top_of_yaml(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_merge"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        store = _make_store(prompts_dir, projects_dir)
        result = store.get_effective("proj_merge", "scene_writing")
        # Overridden field
        assert result["temperature"] == 0.5
        # Untouched fields still come from YAML
        assert result["system_prompt"] == "default system"
        assert result["user_prompt_template"] == "default user {var}"
        # Metadata is stripped from effective view
        assert "_modified_at" not in result

    def test_raises_when_name_not_found(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(FileNotFoundError):
            store.get_effective("proj_x", "nonexistent_prompt")


class TestGetOverrideOnly:
    def test_returns_none_when_no_override(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        assert store.get_override_only("proj_empty", "scene_writing") is None

    def test_returns_override_dict(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_o"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        store = _make_store(prompts_dir, projects_dir)
        result = store.get_override_only("proj_o", "scene_writing")
        assert result is not None
        assert result["temperature"] == 0.5
        assert result["_modified_at"] == "2026-07-19T00:00:00Z"


class TestSetOverride:
    def test_writes_field_only_if_changed_from_yaml_default(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_set"
        proj.mkdir()
        store = _make_store(prompts_dir, projects_dir)
        store.set_override("proj_set", "scene_writing", {
            "system_prompt": "NEW system",
            "temperature": 0.9,  # same as YAML default — should NOT be persisted
        })
        written = json.loads((proj / "prompt_overrides.json").read_text())
        assert "system_prompt" in written["scene_writing"]
        assert written["scene_writing"]["system_prompt"] == "NEW system"
        assert "temperature" not in written["scene_writing"]
        assert "_modified_at" in written["scene_writing"]

    def test_merges_with_existing_override(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_merge2"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"system_prompt": "old system", "_modified_at": "x"}
        }))
        store = _make_store(prompts_dir, projects_dir)
        store.set_override("proj_merge2", "scene_writing", {
            "user_prompt_template": "NEW user",
        })
        written = json.loads((proj / "prompt_overrides.json").read_text())
        scene = written["scene_writing"]
        assert scene["system_prompt"] == "old system"
        assert scene["user_prompt_template"] == "NEW user"
        assert "_modified_at" in scene

    def test_raises_when_name_not_found(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(FileNotFoundError):
            store.set_override("proj_x", "nonexistent_prompt", {"system_prompt": "x"})


class TestDeleteOverride:
    def test_removes_entry_from_json(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_del"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
            "outline_generation": {"temperature": 0.3, "_modified_at": "y"},
        }))
        store = _make_store(prompts_dir, projects_dir)
        store.delete_override("proj_del", "scene_writing")
        written = json.loads((proj / "prompt_overrides.json").read_text())
        assert "scene_writing" not in written
        assert "outline_generation" in written

    def test_removes_empty_json_file(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_del2"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.5, "_modified_at": "x"},
        }))
        store = _make_store(prompts_dir, projects_dir)
        store.delete_override("proj_del2", "scene_writing")
        assert not (proj / "prompt_overrides.json").exists()

    def test_noop_when_override_does_not_exist(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_del3"
        proj.mkdir()
        store = _make_store(prompts_dir, projects_dir)
        store.delete_override("proj_del3", "scene_writing")  # must not raise
        assert not (proj / "prompt_overrides.json").exists()


class TestGetOverrideOnlyValidation:
    def test_raises_when_name_not_found(self, prompts_dir, projects_dir):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(FileNotFoundError):
            store.get_override_only("proj_x", "nonexistent_prompt")


class TestProjectIdValidation:
    @pytest.mark.parametrize("bad_id", [
        "", " ", "../escape", "foo/bar", "foo\\bar", ".hidden", " foo ",
    ])
    def test_invalid_project_id_raises_on_read(self, prompts_dir, projects_dir, bad_id):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(ValueError):
            store._read_overrides(bad_id)

    @pytest.mark.parametrize("bad_id", ["../escape", "foo/bar"])
    def test_invalid_project_id_raises_on_write(self, prompts_dir, projects_dir, bad_id):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(ValueError):
            store._write_overrides(bad_id, {})

    @pytest.mark.parametrize("bad_id", ["../escape", "foo/bar"])
    def test_invalid_project_id_raises_on_delete(self, prompts_dir, projects_dir, bad_id):
        store = _make_store(prompts_dir, projects_dir)
        with pytest.raises(ValueError):
            store.delete_override(bad_id, "scene_writing")

    def test_valid_project_id_with_dot_inside_works(self, prompts_dir, projects_dir):
        # Sanity check — legitimate IDs with internal dots shouldn't be rejected
        proj = projects_dir / "proj.v1.0"
        proj.mkdir()
        store = _make_store(prompts_dir, projects_dir)
        # Should not raise
        result = store._read_overrides("proj.v1.0")
        assert result == {}
