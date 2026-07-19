# 提示词广场（Prompt Plaza）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 storyForge2 首页侧栏启用「提示词广场」按钮，弹出全屏 modal，展示 24 个 YAML 提示词并允许项目级覆盖编辑，存到 `projects/{id}/prompt_overrides.json`，向后兼容 `BaseAgent.load_prompt`。

**Architecture:** 后端新增 `PromptOverrideStore` + FastAPI router (`/api/projects/{id}/prompts/*`)；`BaseAgent.load_prompt(name, project_id?)` 新增可选签名；前端用 React modal + 列表/编辑器组件，状态走两个自定义 hook（`usePromptList` / `usePromptDetail`），不动现有 agent 调用点。

**Tech Stack:** Python 3.9 + FastAPI + Pydantic + pytest + TestClient；React 18 + Vite + Tailwind + Vitest + Testing Library + `useAutoHeight`（已存在）。

**Worktree:** 不开 worktree，直接在 v1.9 分支操作（参考 user 偏好 memory）。

**Spec:** `docs/superpowers/specs/2026-07-19-prompt-plaza-design.md`

---

## 任务概览

| Task | 内容 | 文件数 |
|---|---|---|
| 1 | PromptOverrideStore（含 5 方法 + 测试） | 3 |
| 2 | API router（4 端点 + 测试） | 2 |
| 3 | BaseAgent.load_prompt 集成（向后兼容 + 测试） | 2 |
| 4 | main.py 注册 router | 1 |
| 5 | 前端 API client | 1 |
| 6 | usePromptList / usePromptDetail hooks（含测试） | 3 |
| 7 | PromptListPanel（含测试） | 2 |
| 8 | AdvancedSection（无独立测试） | 1 |
| 9 | PromptEditPanel（含测试） | 2 |
| 10 | PromptPlazaModal（含测试） | 2 |
| 11 | HomePage + StatsSidebar + QuickActions 接线 | 3 |

每步 2-5 分钟；共 11 任务，约 50 步。

---

## Task 1: PromptOverrideStore（含 5 方法 + 测试）

**Files:**
- Create: `backend/services/__init__.py`
- Create: `backend/services/prompt_override_store.py`
- Create: `tests/test_prompt_override_store.py`

- [ ] **Step 1: Write the failing test for `list_available`**

Create `tests/test_prompt_override_store.py`:

```python
"""Tests for PromptOverrideStore — YAML scanning, override persistence, and merging."""

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_prompt_override_store.py -v`
Expected: ImportError or ModuleNotFoundError on `backend.services.prompt_override_store`

- [ ] **Step 3: Write the implementation (part 1: list_available + constants)**

Create `backend/services/__init__.py`:

```python
"""Backend services — reusable business logic decoupled from HTTP layer."""
```

Create `backend/services/prompt_override_store.py`:

```python
"""PromptOverrideStore — per-project JSON overrides on top of read-only YAML defaults.

The store is the only writer to projects/{project_id}/prompt_overrides.json.
backend/prompts/*.yaml files are NEVER written; they remain the factory defaults.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


PROMPT_CATEGORIES: dict[str, str] = {
    "creative": "创意",
    "character_designer": "角色",
    "style_engine": "风格",
    "": "其它",
}

PROMPT_LABEL_OVERRIDES: dict[str, str] = {
    "scene_writing": "场景写作",
    "outline_generation": "大纲生成",
    "narrative_guard": "叙事守护",
    "concept_generation": "概念生成",
    "world_generation": "世界观生成",
    "character_generation": "角色生成",
    "chapter_summary": "章节摘要",
    "scene_rewrite": "场景改写",
    "semantic_precheck": "语义预检",
    "sf_log_suggestion": "SF_LOG 建议",
    "branch_simulation_llm": "分支模拟",
    "canvas_to_concept": "画布转概念",
}


class PromptOverrideStore:
    """Reads/writes projects/{project_id}/prompt_overrides.json."""

    def __init__(self, projects_dir: Path, prompts_dir: Path) -> None:
        self.projects_dir = Path(projects_dir)
        self.prompts_dir = Path(prompts_dir)

    # ------------------------------------------------------------------
    # YAML scanning
    # ------------------------------------------------------------------

    def _iter_yaml_files(self) -> list[tuple[Path, str]]:
        """Returns (path, category) for every .yaml under prompts_dir (recursive).

        category is the subdir name relative to prompts_dir, or "" for root.
        """
        results: list[tuple[Path, str]] = []
        for path in sorted(self.prompts_dir.rglob("*.yaml")):
            rel = path.relative_to(self.prompts_dir)
            category = rel.parts[0] if len(rel.parts) > 1 else ""
            # Only treat top-level subdirs as categories; deeper nesting is not supported
            if len(rel.parts) > 2:
                continue
            results.append((path, category))
        return results

    def _load_yaml(self, name: str) -> dict[str, Any]:
        """Load a YAML prompt file by base name (with or without .yaml)."""
        candidate = name if name.endswith(".yaml") else f"{name}.yaml"
        # Try root first, then subdirs
        for path, _category in self._iter_yaml_files():
            if path.name == candidate and path.stem == name:
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                return data
        raise FileNotFoundError(f"Prompt template not found: {name}")

    # ------------------------------------------------------------------
    # Override JSON I/O
    # ------------------------------------------------------------------

    def _override_path(self, project_id: str) -> Path:
        return self.projects_dir / project_id / "prompt_overrides.json"

    def _read_overrides(self, project_id: str) -> dict[str, Any]:
        path = self._override_path(project_id)
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}

    def _write_overrides(self, project_id: str, data: dict[str, Any]) -> None:
        path = self._override_path(project_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    # ------------------------------------------------------------------
    # Public API: list_available
    # ------------------------------------------------------------------

    def list_available(self, project_id: str) -> list[dict[str, Any]]:
        overrides = self._read_overrides(project_id)
        result: list[dict[str, Any]] = []
        for path, category in self._iter_yaml_files():
            name = path.stem
            override_entry = overrides.get(name) or {}
            modified_at = override_entry.get("_modified_at")
            result.append({
                "name": name,
                "category": category,
                "label": PROMPT_LABEL_OVERRIDES.get(name, name),
                "has_override": bool(override_entry),
                "modified_at": modified_at,
                "builtin": True,
            })
        return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_prompt_override_store.py::TestListAvailable -v`
Expected: All 6 tests in TestListAvailable PASS

- [ ] **Step 5: Add failing tests for get_effective, get_override_only, set_override, delete_override**

Append to `tests/test_prompt_override_store.py`:

```python
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
```

Add to the top of the test file:
```python
import json
```

(after `import pytest`)

- [ ] **Step 6: Run tests to verify they fail**

Run: `source venv/bin/activate && pytest tests/test_prompt_override_store.py -v`
Expected: TestGetEffective, TestGetOverrideOnly, TestSetOverride, TestDeleteOverride all FAIL with AttributeError (methods not yet defined on store)

- [ ] **Step 7: Write the implementation (part 2: get_effective, get_override_only, set_override, delete_override)**

Append to `backend/services/prompt_override_store.py`:

```python
    # ------------------------------------------------------------------
    # Public API: get_effective (merge YAML + override)
    # ------------------------------------------------------------------

    def get_effective(self, project_id: str, name: str) -> dict[str, Any]:
        base = self._load_yaml(name)
        overrides = self._read_overrides(project_id)
        entry = overrides.get(name) or {}
        # Strip metadata keys before merging
        fields = {k: v for k, v in entry.items() if not k.startswith("_")}
        return {**base, **fields}

    # ------------------------------------------------------------------
    # Public API: get_override_only
    # ------------------------------------------------------------------

    def get_override_only(self, project_id: str, name: str) -> dict[str, Any] | None:
        overrides = self._read_overrides(project_id)
        entry = overrides.get(name)
        return entry if entry else None

    # ------------------------------------------------------------------
    # Public API: set_override (with field-pruning)
    # ------------------------------------------------------------------

    def _pruned_override(self, name: str, full: dict[str, Any]) -> dict[str, Any]:
        """Drop fields whose value matches the YAML default — keeps the JSON clean."""
        base = self._load_yaml(name)
        pruned: dict[str, Any] = {}
        for k, v in full.items():
            if k.startswith("_"):
                continue
            if base.get(k) != v:
                pruned[k] = v
        pruned["_modified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return pruned

    def set_override(
        self,
        project_id: str,
        name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        # Validate name exists in YAML (raises FileNotFoundError if not)
        self._load_yaml(name)

        existing = self._read_overrides(project_id)
        current_entry = existing.get(name) or {}
        # Strip metadata before merging so payload doesn't clobber _modified_at
        current_fields = {k: v for k, v in current_entry.items() if not k.startswith("_")}
        merged_fields = {**current_fields, **payload}
        pruned = self._pruned_override(name, merged_fields)

        if len(pruned) == 1 and "_modified_at" in pruned:
            # All payload fields reverted to default — remove the entry entirely
            existing.pop(name, None)
        else:
            existing[name] = pruned

        # Don't write an empty JSON file
        if existing:
            self._write_overrides(project_id, existing)
        else:
            path = self._override_path(project_id)
            if path.exists():
                path.unlink()

        # Return the persisted override (may be None if all fields reverted)
        return existing.get(name) or {}

    # ------------------------------------------------------------------
    # Public API: delete_override
    # ------------------------------------------------------------------

    def delete_override(self, project_id: str, name: str) -> None:
        existing = self._read_overrides(project_id)
        if name not in existing:
            return
        existing.pop(name)
        if existing:
            self._write_overrides(project_id, existing)
        else:
            path = self._override_path(project_id)
            if path.exists():
                path.unlink()
```

- [ ] **Step 8: Run all store tests to verify they pass**

Run: `source venv/bin/activate && pytest tests/test_prompt_override_store.py -v`
Expected: All ~14 tests PASS

- [ ] **Step 9: Commit**

```bash
git add backend/services/__init__.py backend/services/prompt_override_store.py tests/test_prompt_override_store.py
git commit -m "feat(prompts): add PromptOverrideStore for per-project JSON overrides

Per-project overrides live in projects/{id}/prompt_overrides.json; YAML
files at backend/prompts/ remain the read-only factory defaults. The
store prunes fields whose value matches the YAML default, keeping the
JSON clean when users revert changes."
```

---

## Task 2: API router（4 端点 + 测试）

**Files:**
- Create: `backend/api/prompt_plaza.py`
- Create: `tests/test_prompt_plaza_api.py`

- [ ] **Step 1: Write the failing test for GET /list**

Create `tests/test_prompt_plaza_api.py`:

```python
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
def project_id(real_projects_dir):
    """Just a string; we don't need a full project file for plaza tests."""
    return "proj_test"


@pytest.fixture(autouse=True)
def patch_store_paths(monkeypatch, real_prompts_dir, real_projects_dir):
    """Make settings.prompts_dir / projects_dir point to tmp_path so we don't
    touch real project files."""
    monkeypatch.setattr(settings, "prompts_dir", real_prompts_dir)
    monkeypatch.setattr(settings, "projects_dir", real_projects_dir)


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
        assert scene["modified_at"] == "2026-07-19T00:00:00Z"


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source venv/bin/activate && pytest tests/test_prompt_plaza_api.py -v`
Expected: All tests FAIL with 404 (router not yet registered)

- [ ] **Step 3: Write the router implementation**

Create `backend/api/prompt_plaza.py`:

```python
"""Prompt Plaza API — browse and edit per-project prompt overrides.

Routes are mounted at /api/projects/{project_id}/prompts/*.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.config import settings
from backend.services.prompt_override_store import PromptOverrideStore


router = APIRouter(prefix="/api/projects/{project_id}/prompts", tags=["prompts"])


# ----------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------


class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: str | None = None
    user_prompt_template: str | None = None
    model: str | None = None
    temperature: float | None = Field(None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(None, ge=1, le=32768)
    output_format: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------
# Store singleton (one per settings path)
# ----------------------------------------------------------------------


def _store() -> PromptOverrideStore:
    return PromptOverrideStore(
        projects_dir=Path(settings.projects_dir),
        prompts_dir=Path(settings.prompts_dir),
    )


# ----------------------------------------------------------------------
# Routes — register list/export before {name} to avoid path collision
# ----------------------------------------------------------------------


@router.get("/list")
async def list_prompts(project_id: str):
    return {"error": False, "code": "OK", "message": "", "detail": {"prompts": _store().list_available(project_id)}}


@router.get("/{name}")
async def get_prompt(project_id: str, name: str):
    try:
        builtin = _store()._load_yaml(name)
        override = _store().get_override_only(project_id, name)
        effective = _store().get_effective(project_id, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NOT_FOUND",
            "message": f"Prompt template not found: {name}",
            "detail": {"name": name},
        })
    return {
        "error": False, "code": "OK", "message": "",
        "detail": {
            "name": name,
            "builtin_yaml": builtin,
            "override": override,
            "effective": effective,
        },
    }


@router.put("/{name}")
async def update_prompt(project_id: str, name: str, payload: PromptOverridePayload):
    try:
        # set_override validates name exists by loading YAML
        override = _store().set_override(project_id, name, payload.model_dump(exclude_none=True))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NOT_FOUND",
            "message": f"Prompt template not found: {name}",
            "detail": {"name": name},
        })
    return {
        "error": False, "code": "OK", "message": "已保存",
        "detail": {
            "name": name,
            "override": override,
            "modified_at": override.get("_modified_at") if override else None,
        },
    }


@router.delete("/{name}")
async def reset_prompt(project_id: str, name: str):
    _store().delete_override(project_id, name)
    return {
        "error": False, "code": "OK", "message": "已重置为默认值",
        "detail": {"name": name, "status": "reset"},
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `source venv/bin/activate && pytest tests/test_prompt_plaza_api.py -v`
Expected: All ~11 tests PASS

(Note: `patch_store_paths` autouse fixture is in place so paths are overridden, but we haven't registered the router yet — these will pass once registered in Task 4. For now, the failure will be 404 from the missing route. **Do NOT commit this task's router code yet**; the next task registers the router and tests will pass together.)

If tests fail with 404 Not Found for `/api/projects/.../prompts/list`, that's expected — proceed to Task 3 (BaseAgent integration test, no router change) and then Task 4 (register router).

- [ ] **Step 5: Defer commit until Task 4**

Run:
```bash
git add backend/api/prompt_plaza.py tests/test_prompt_plaza_api.py
git commit -m "feat(api): add prompt_plaza router with list/get/put/delete endpoints

End-to-end tests written and passing against TestClient (paths mocked via
autouse fixture); commit rolled into Task 4 alongside router registration."
```

Actually — to keep tasks atomic and TDD-pure, do NOT commit here. Move on to Task 3, then commit both Task 2 + Task 4 together in Task 4 Step 3.

---

## Task 3: BaseAgent.load_prompt 集成（向后兼容 + 测试）

**Files:**
- Modify: `backend/agents/base_agent.py:42-86`
- Create: `tests/test_load_prompt_with_override.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_load_prompt_with_override.py`:

```python
"""Tests for BaseAgent.load_prompt(name, project_id=None).

Verifies:
- Without project_id: identical behavior to today (YAML only).
- With project_id: YAML defaults are merged with project override.
- Backward compat: existing callers (no project_id) keep working.
"""

import pytest
import yaml
from pathlib import Path

from backend.agents.base_agent import BaseAgent
from backend.services.prompt_override_store import PromptOverrideStore


@pytest.fixture
def prompts_dir(tmp_path: Path) -> Path:
    (tmp_path / "scene_writing.yaml").write_text(yaml.safe_dump({
        "name": "scene_writing",
        "system_prompt": "default sys",
        "user_prompt_template": "default user",
        "temperature": 0.9,
        "max_tokens": 1000,
    }))
    return tmp_path


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    return tmp_path


def _make_agent(prompts_dir, projects_dir, project_id=None) -> BaseAgent:
    store = PromptOverrideStore(projects_dir=projects_dir, prompts_dir=prompts_dir)
    return BaseAgent(
        project_id=project_id or "proj_dummy",
        prompts_dir=prompts_dir,
        override_store=store,
    )


class TestBackwardCompat:
    def test_load_prompt_without_project_id_uses_yaml_only(self, prompts_dir, projects_dir):
        # Simulate legacy callers that don't know about overrides
        agent = BaseAgent(project_id="proj_dummy", prompts_dir=prompts_dir)
        # No override_store injected → no merging happens
        prompt = agent.load_prompt("scene_writing")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_but_no_override_uses_yaml(self, prompts_dir, projects_dir):
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_empty")
        prompt = agent.load_prompt("scene_writing", project_id="proj_empty")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_and_override_merges(self, prompts_dir, projects_dir):
        # Pre-seed an override
        proj = projects_dir / "proj_merged"
        proj.mkdir()
        import json
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_merged")
        prompt = agent.load_prompt("scene_writing", project_id="proj_merged")
        # Override applied
        assert prompt.temperature == 0.5
        # Non-overridden field untouched
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_partial_override_keeps_yaml_for_untouched_fields(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_partial"
        proj.mkdir()
        import json
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"system_prompt": "OVERRIDDEN", "_modified_at": "x"}
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_partial")
        prompt = agent.load_prompt("scene_writing", project_id="proj_partial")
        assert prompt.system_prompt == "OVERRIDDEN"
        assert prompt.user_prompt_template == "default user"  # still YAML
        assert prompt.temperature == 0.9  # still YAML
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_load_prompt_with_override.py -v`
Expected: TypeError on `BaseAgent(...)` — `override_store` kwarg not yet accepted

- [ ] **Step 3: Modify BaseAgent**

Open `backend/agents/base_agent.py`. Change `__init__` signature (around line 47-57) and `load_prompt` (around line 78-86):

Replace:
```python
def __init__(
    self,
    project_id: str,
    prompts_dir: Optional[Path] = None,
    model_router: Optional[ModelRouter] = None,
):
    self.project_id = project_id
    self.prompts_dir = Path(prompts_dir) if prompts_dir else settings.prompts_dir
    self._provider = None
    self._usage_log_path = None
    self._router = model_router
```

With:
```python
def __init__(
    self,
    project_id: str,
    prompts_dir: Optional[Path] = None,
    model_router: Optional[ModelRouter] = None,
    override_store: Optional["PromptOverrideStore"] = None,
):
    self.project_id = project_id
    self.prompts_dir = Path(prompts_dir) if prompts_dir else settings.prompts_dir
    self._provider = None
    self._usage_log_path = None
    self._router = model_router
    self._override_store = override_store
```

Replace `load_prompt`:
```python
def load_prompt(self, template_name: str) -> PromptTemplate:
    path = self.prompts_dir / f"{template_name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if data is None:
        raise ValueError(f"Empty prompt template: {path}")
    return PromptTemplate(data)
```

With:
```python
def load_prompt(
    self,
    template_name: str,
    project_id: Optional[str] = None,
) -> PromptTemplate:
    """Load a prompt template. If project_id is provided AND an override store
    is configured, merge the project's overrides on top of the YAML default.
    """
    if project_id is not None and self._override_store is not None:
        merged = self._override_store.get_effective(project_id, template_name)
        return PromptTemplate(merged)
    return self._load_prompt_from_yaml(template_name)

def _load_prompt_from_yaml(self, template_name: str) -> PromptTemplate:
    path = self.prompts_dir / f"{template_name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if data is None:
        raise ValueError(f"Empty prompt template: {path}")
    return PromptTemplate(data)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_load_prompt_with_override.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Run existing base_agent tests to confirm no regression**

Run: `source venv/bin/activate && pytest tests/test_base_agent_stream.py tests/test_base_agent.py -v 2>/dev/null || pytest tests/ -k "base_agent or BaseAgent" -v`
Expected: All existing tests still PASS (backward compat preserved)

- [ ] **Step 6: Commit**

```bash
git add backend/agents/base_agent.py tests/test_load_prompt_with_override.py
git commit -m "feat(agents): BaseAgent.load_prompt accepts optional project_id

When project_id is provided AND an override store is injected, the YAML
default is merged with projects/{id}/prompt_overrides.json. Existing
callers (no project_id) keep identical behavior — fully backward compat."
```

---

## Task 4: Register router in main.py

**Files:**
- Modify: `backend/main.py` (add 1 import + 1 line)

- [ ] **Step 1: Verify router file exists and tests still fail without registration**

Run: `source venv/bin/activate && pytest tests/test_prompt_plaza_api.py -v 2>&1 | tail -20`
Expected: All tests fail with 404 (router not registered)

- [ ] **Step 2: Register the router in main.py**

Open `backend/main.py`. Find the existing imports and `app.include_router(...)` calls. Add:

In the imports section (with the other `from backend.api import ...`):
```python
from backend.api import prompt_plaza
```

With the other `app.include_router(...)` calls:
```python
app.include_router(prompt_plaza.router)
```

- [ ] **Step 3: Run all plaza API tests + base_agent tests**

Run: `source venv/bin/activate && pytest tests/test_prompt_plaza_api.py tests/test_prompt_override_store.py tests/test_load_prompt_with_override.py -v`
Expected: All tests PASS

- [ ] **Step 4: Run full backend test suite to confirm no regression**

Run: `source venv/bin/activate && pytest -x --tb=short 2>&1 | tail -30`
Expected: All tests PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add backend/api/prompt_plaza.py backend/main.py tests/test_prompt_plaza_api.py
git commit -m "feat(api): register prompt_plaza router at /api/projects/{id}/prompts

Four endpoints: GET /list, GET /{name}, PUT /{name}, DELETE /{name}.
YAML files at backend/prompts/ remain the read-only factory defaults."
```

---

## Task 5: 前端 API client

**Files:**
- Modify: `frontend/src/api/client.ts:16` (export the private `request` helper)
- Create: `frontend/src/api/promptPlaza.ts`

**Two facts about `client.ts` this task depends on (verified):**
1. `request<T>(method, path, body?)` is a **module-private** function (line 16) — it is NOT reachable as `api.request`. We must add `export` to it.
2. `request` **already unwraps the response envelope**: its last line is `return (json!.detail as T) ?? (json as T)`. So a backend response `{"error": false, "detail": {"prompts": [...]}}` is returned to the caller as `{"prompts": [...]}`. Generic types must therefore describe the **already-unwrapped** shape, NOT the `{ detail: ... }` wrapper.
3. `ApiError` is already exported (line 1086). `API_BASE` is `/api`, so path `/projects/{id}/prompts/list` hits `/api/projects/{id}/prompts/list` — matching the router prefix. Do NOT prepend `/api`.

- [ ] **Step 1: Export the `request` helper from client.ts**

Open `frontend/src/api/client.ts`. Change line 16 from:

```typescript
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
```

to:

```typescript
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
```

(This is purely additive — the module-internal `api` object keeps calling `request` exactly as before.)

- [ ] **Step 2: Create the API client**

Create `frontend/src/api/promptPlaza.ts`:

```typescript
import { request, ApiError } from "./client";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export interface PromptSummary {
  name: string;
  category: string;
  label: string;
  has_override: boolean;
  modified_at: string | null;
  builtin: boolean;
}

export interface PromptDetail {
  name: string;
  builtin_yaml: Record<string, unknown>;
  override: Record<string, unknown> | null;
  effective: Record<string, unknown>;
}

export interface PromptOverridePayload {
  system_prompt?: string;
  user_prompt_template?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: Record<string, unknown>;
}

// ----------------------------------------------------------------------
// Endpoints — `request` already unwraps the `.detail` envelope, so the
// generic type is the shape INSIDE `detail`.
// ----------------------------------------------------------------------

/** GET /api/projects/{project_id}/prompts/list */
export async function listPlazaPrompts(projectId: string): Promise<PromptSummary[]> {
  const data = await request<{ prompts: PromptSummary[] }>(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/prompts/list`,
  );
  return data.prompts;
}

/** GET /api/projects/{project_id}/prompts/{name} */
export async function getPlazaPrompt(projectId: string, name: string): Promise<PromptDetail> {
  return request<PromptDetail>(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
  );
}

/** PUT /api/projects/{project_id}/prompts/{name} */
export async function putPlazaPrompt(
  projectId: string,
  name: string,
  payload: PromptOverridePayload,
): Promise<{ name: string; override: Record<string, unknown> | null; modified_at: string | null }> {
  return request<{ name: string; override: Record<string, unknown> | null; modified_at: string | null }>(
    "PUT",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
    payload,
  );
}

/** DELETE /api/projects/{project_id}/prompts/{name} */
export async function deletePlazaPrompt(
  projectId: string,
  name: string,
): Promise<{ name: string; status: string }> {
  return request<{ name: string; status: string }>(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}`,
  );
}

// Re-export ApiError for convenience
export { ApiError };
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors introduced

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/promptPlaza.ts
git commit -m "feat(api-client): add promptPlaza API client (list/get/put/delete)"
```

---

## Task 6: usePromptList / usePromptDetail hooks（含测试）

**Files:**
- Create: `frontend/src/hooks/usePromptList.ts`
- Create: `frontend/src/hooks/usePromptDetail.ts`
- Create: `frontend/src/test/hooks/usePromptList.test.tsx`
- Create: `frontend/src/test/hooks/usePromptDetail.test.tsx`

- [ ] **Step 1: Write failing tests for usePromptList**

Create `frontend/src/test/hooks/usePromptList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePromptList } from "../../hooks/usePromptList";

vi.mock("../../api/promptPlaza", () => ({
  listPlazaPrompts: vi.fn(),
}));

import { listPlazaPrompts } from "../../api/promptPlaza";

const SAMPLE = [
  { name: "scene_writing", category: "", label: "场景写作", has_override: false, modified_at: null, builtin: true },
  { name: "mutation", category: "creative", label: "变异", has_override: true, modified_at: "2026-07-19T00:00:00Z", builtin: true },
];

describe("usePromptList", () => {
  beforeEach(() => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockReset();
  });

  it("starts in loading state, then resolves with prompts", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => usePromptList("proj_x"));
    expect(result.current.loading).toBe(true);
    expect(result.current.prompts).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prompts).toEqual(SAMPLE);
    expect(result.current.error).toBeNull();
  });

  it("captures error on fetch failure", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePromptList("proj_x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network");
    expect(result.current.prompts).toEqual([]);
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => usePromptList(null));
    expect(result.current.loading).toBe(false);
    expect(listPlazaPrompts).not.toHaveBeenCalled();
  });

  it("refresh() re-fetches", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => usePromptList("proj_x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listPlazaPrompts).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refresh();
    });
    expect(listPlazaPrompts).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Write failing test for usePromptDetail**

Create `frontend/src/test/hooks/usePromptDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePromptDetail } from "../../hooks/usePromptDetail";

vi.mock("../../api/promptPlaza", () => ({
  getPlazaPrompt: vi.fn(),
}));

import { getPlazaPrompt } from "../../api/promptPlaza";

const SAMPLE_DETAIL = {
  name: "scene_writing",
  builtin_yaml: { system_prompt: "default", temperature: 0.9 },
  override: { temperature: 0.5, _modified_at: "x" },
  effective: { system_prompt: "default", temperature: 0.5 },
};

describe("usePromptDetail", () => {
  beforeEach(() => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockReset();
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => usePromptDetail("proj_x", null));
    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toBeNull();
    expect(getPlazaPrompt).not.toHaveBeenCalled();
  });

  it("fetches when name is provided", async () => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_DETAIL);
    const { result } = renderHook(() => usePromptDetail("proj_x", "scene_writing"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toEqual(SAMPLE_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it("captures error on fetch failure", async () => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => usePromptDetail("proj_x", "scene_writing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("404");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/test/hooks/usePromptList.test.tsx src/test/hooks/usePromptDetail.test.tsx 2>&1 | tail -15`
Expected: FAIL — hooks do not exist yet

- [ ] **Step 4: Implement usePromptList**

Create `frontend/src/hooks/usePromptList.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { listPlazaPrompts, type PromptSummary } from "../api/promptPlaza";

interface UsePromptListReturn {
  prompts: PromptSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePromptList(projectId: string | null): UsePromptListReturn {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listPlazaPrompts(projectId);
      setPrompts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载提示词列表失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { prompts, loading, error, refresh };
}
```

- [ ] **Step 5: Implement usePromptDetail**

Create `frontend/src/hooks/usePromptDetail.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { getPlazaPrompt, type PromptDetail } from "../api/promptPlaza";

interface UsePromptDetailReturn {
  detail: PromptDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePromptDetail(projectId: string | null, name: string | null): UsePromptDetailReturn {
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId || !name) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPlazaPrompt(projectId, name);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载提示词详情失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { detail, loading, error, refresh };
}
```

- [ ] **Step 6: Run hook tests to verify they pass**

Run: `cd frontend && npx vitest run src/test/hooks/usePromptList.test.tsx src/test/hooks/usePromptDetail.test.tsx 2>&1 | tail -10`
Expected: All 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/usePromptList.ts frontend/src/hooks/usePromptDetail.ts frontend/src/test/hooks/usePromptList.test.tsx frontend/src/test/hooks/usePromptDetail.test.tsx
git commit -m "feat(hooks): add usePromptList / usePromptDetail for plaza data fetching"
```

---

## Task 7: PromptListPanel（含测试）

**Files:**
- Create: `frontend/src/components/home/promptPlaza/PromptListPanel.tsx`
- Create: `frontend/src/test/promptPlaza/PromptListPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/promptPlaza/PromptListPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PromptListPanel from "../../../components/home/promptPlaza/PromptListPanel";

const SAMPLE = [
  { name: "scene_writing", category: "", label: "场景写作", has_override: false, modified_at: null, builtin: true },
  { name: "outline", category: "", label: "大纲生成", has_override: false, modified_at: null, builtin: true },
  { name: "mutation", category: "creative", label: "变异", has_override: true, modified_at: "2026-07-19T00:00:00Z", builtin: true },
  { name: "whatif", category: "creative", label: "WhatIf", has_override: false, modified_at: null, builtin: true },
];

describe("PromptListPanel", () => {
  it("renders prompts grouped by category", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText("场景写作")).toBeInTheDocument();
    expect(screen.getByText("变异")).toBeInTheDocument();
  });

  it("shows has_override badge for prompts with override", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    // mutation has override; should have a badge marked somehow
    const mutation = screen.getByText("变异").closest('[data-testid="plaza-row"]')!;
    expect(mutation.querySelector('[data-testid="override-dot"]')).toBeInTheDocument();
    // scene_writing has no override
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.querySelector('[data-testid="override-dot"]')).not.toBeInTheDocument();
  });

  it("highlights the selected prompt", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName="scene_writing" onSelect={vi.fn()} />);
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.getAttribute("data-selected")).toBe("true");
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("场景写作"));
    expect(onSelect).toHaveBeenCalledWith("scene_writing");
  });

  it("filters by search query", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜索/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "outline" } });
    expect(screen.queryByText("场景写作")).not.toBeInTheDocument();
    expect(screen.getByText("大纲生成")).toBeInTheDocument();
  });

  it("renders empty state when no prompts", () => {
    render(<PromptListPanel prompts={[]} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/暂无提示词/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptListPanel.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PromptListPanel**

Create `frontend/src/components/home/promptPlaza/PromptListPanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { PromptSummary } from "../../../api/promptPlaza";
import { PROMPT_CATEGORY_LABELS } from "./categoryLabels";

interface Props {
  prompts: PromptSummary[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export default function PromptListPanel({ prompts, selectedName, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PromptSummary[]>();
    for (const p of filtered) {
      const arr = groups.get(p.category) ?? [];
      arr.push(p);
      groups.set(p.category, arr);
    }
    return groups;
  }, [filtered]);

  if (prompts.length === 0) {
    return (
      <div className="p-4 text-system-log text-sm text-center">
        暂无提示词
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-outline-variant">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索提示词"
          data-testid="plaza-search"
          className="w-full bg-surface-container border border-outline-variant rounded
                     px-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                     focus:outline-none focus:border-primary-container"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category || "_root"}>
            <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider mb-1.5">
              {PROMPT_CATEGORY_LABELS[category] ?? category}
            </div>
            <div className="space-y-1">
              {items.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  data-testid="plaza-row"
                  data-selected={selectedName === p.name ? "true" : "false"}
                  onClick={() => onSelect(p.name)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm
                              ${selectedName === p.name
                                ? "bg-primary-container/20 text-primary"
                                : "text-primary hover:bg-surface-container"
                              }`}
                >
                  <span className="truncate">{p.label}</span>
                  {p.has_override && (
                    <span
                      data-testid="override-dot"
                      className="shrink-0 w-2 h-2 rounded-full bg-primary-container"
                      title={`已自定义 ${p.modified_at ?? ""}`}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `frontend/src/components/home/promptPlaza/categoryLabels.ts`:

```typescript
/** Display labels for prompt categories. Mirrors PROMPT_CATEGORIES in prompt_override_store.py. */
export const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  "": "其它",
  creative: "创意",
  character_designer: "角色",
  style_engine: "风格",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptListPanel.test.tsx 2>&1 | tail -10`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/promptPlaza/PromptListPanel.tsx frontend/src/components/home/promptPlaza/categoryLabels.ts frontend/src/test/promptPlaza/PromptListPanel.test.tsx
git commit -m "feat(plaza): PromptListPanel — categorized list with search + override dots"
```

---

## Task 8: AdvancedSection（无独立测试）

**Files:**
- Create: `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`

- [ ] **Step 1: Implement AdvancedSection**

Create `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`:

```tsx
import { useState } from "react";

interface Props {
  model: string;
  temperature: number;
  maxTokens: number;
  outputFormatJson: string;
  onModelChange: (v: string) => void;
  onTemperatureChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  onOutputFormatChange: (v: string) => void;
}

export default function AdvancedSection({
  model, temperature, maxTokens, outputFormatJson,
  onModelChange, onTemperatureChange, onMaxTokensChange, onOutputFormatChange,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-outline-variant">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="advanced-toggle"
        className="w-full px-3 py-2 flex items-center justify-between text-sm text-system-log hover:text-primary"
      >
        <span>高级</span>
        <span className="material-symbols-outlined text-base">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3" data-testid="advanced-body">
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              data-testid="adv-model"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">
              temperature: {temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0" max="2" step="0.05"
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              data-testid="adv-temperature"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">max_tokens</label>
            <input
              type="number"
              min="1" max="32768"
              value={maxTokens}
              onChange={(e) => onMaxTokensChange(parseInt(e.target.value, 10) || 0)}
              data-testid="adv-max-tokens"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">output_format (JSON)</label>
            <textarea
              value={outputFormatJson}
              onChange={(e) => onOutputFormatChange(e.target.value)}
              data-testid="adv-output-format"
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs font-mono resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/home/promptPlaza/AdvancedSection.tsx
git commit -m "feat(plaza): AdvancedSection — collapsible model/temperature/max_tokens/output_format"
```

---

## Task 9: PromptEditPanel（含测试）

**Files:**
- Create: `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`
- Create: `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptEditPanel from "../../../components/home/promptPlaza/PromptEditPanel";
import type { PromptDetail } from "../../../api/promptPlaza";

const DETAIL: PromptDetail = {
  name: "scene_writing",
  builtin_yaml: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    model: "deepseek-chat",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
  override: null,
  effective: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    model: "deepseek-chat",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
};

describe("PromptEditPanel", () => {
  it("renders empty state when detail is null", () => {
    render(<PromptEditPanel detail={null} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/请从左侧选择一个提示词/)).toBeInTheDocument();
  });

  it("renders the prompt name and labels", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("scene_writing")).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/)).toBeInTheDocument();
    expect(screen.getByText(/User Prompt Template/)).toBeInTheDocument();
  });

  it("pre-fills textareas from effective values", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    const ta = screen.getByTestId("edit-system") as HTMLTextAreaElement;
    expect(ta.value).toBe("default sys");
    const userTa = screen.getByTestId("edit-user-template") as HTMLTextAreaElement;
    expect(userTa.value).toBe("default user {var}");
  });

  it("emits onSave with the edited fields", () => {
    const onSave = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "NEW sys" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      system_prompt: "NEW sys",
    }));
  });

  it("disables save when not dirty", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    const save = screen.getByTestId("save-button") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("enables save when system_prompt is changed", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "changed" } });
    const save = screen.getByTestId("save-button") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("calls onReset when reset button is clicked", () => {
    const onReset = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={onReset} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(onReset).toHaveBeenCalled();
  });

  it("shows loading state", () => {
    render(<PromptEditPanel detail={null} loading={true} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<PromptEditPanel detail={null} loading={false} error="some error" onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("some error")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptEditPanel.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PromptEditPanel**

Create `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { PromptDetail } from "../../../api/promptPlaza";
import AdvancedSection from "./AdvancedSection";
import { useAutoHeight } from "../../../hooks/useAutoHeight";

interface Props {
  detail: PromptDetail | null;
  loading: boolean;
  error: string | null;
  onSave: (payload: {
    system_prompt?: string;
    user_prompt_template?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    output_format?: Record<string, unknown>;
  }) => void;
  onReset: () => void;
  onClose: () => void;
}

function getEffectiveString(detail: PromptDetail, key: string, fallback = ""): string {
  const v = (detail.effective as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

function getEffectiveNumber(detail: PromptDetail, key: string, fallback = 0): number {
  const v = (detail.effective as Record<string, unknown>)[key];
  return typeof v === "number" ? v : fallback;
}

export default function PromptEditPanel({ detail, loading, error, onSave, onReset, onClose }: Props) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [outputFormatJson, setOutputFormatJson] = useState("{}");

  const systemRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(systemRef, [systemPrompt]);
  useAutoHeight(userRef, [userTemplate]);

  // Reset draft when detail changes
  useEffect(() => {
    if (!detail) return;
    setSystemPrompt(getEffectiveString(detail, "system_prompt"));
    setUserTemplate(getEffectiveString(detail, "user_prompt_template"));
    setModel(getEffectiveString(detail, "model", ""));
    setTemperature(getEffectiveNumber(detail, "temperature", 0.9));
    setMaxTokens(getEffectiveNumber(detail, "max_tokens", 1000));
    const of = (detail.effective as Record<string, unknown>).output_format;
    setOutputFormatJson(of ? JSON.stringify(of, null, 2) : "{}");
  }, [detail]);

  const dirty = useMemo(() => {
    if (!detail) return false;
    const baseSystem = getEffectiveString(detail, "system_prompt");
    const baseUser = getEffectiveString(detail, "user_prompt_template");
    const baseModel = getEffectiveString(detail, "model", "");
    const baseTemp = getEffectiveNumber(detail, "temperature", 0.9);
    const baseMax = getEffectiveNumber(detail, "max_tokens", 1000);
    const baseOf = JSON.stringify((detail.effective as Record<string, unknown>).output_format ?? {});
    return (
      systemPrompt !== baseSystem ||
      userTemplate !== baseUser ||
      model !== baseModel ||
      temperature !== baseTemp ||
      maxTokens !== baseMax ||
      outputFormatJson !== baseOf
    );
  }, [detail, systemPrompt, userTemplate, model, temperature, maxTokens, outputFormatJson]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-system-log text-sm">
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-error text-sm" role="alert">
        {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-system-log text-sm">
        请从左侧选择一个提示词
      </div>
    );
  }

  const handleSave = () => {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(outputFormatJson) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
    onSave({
      system_prompt: systemPrompt,
      user_prompt_template: userTemplate,
      model,
      temperature,
      max_tokens: maxTokens,
      output_format: parsed,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-primary text-lg">{detail.name}</h3>
          {detail.override && (
            <span className="text-xs font-label-mono text-primary-container">
              已自定义 {detail.override._modified_at as string}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="text-system-log hover:text-primary"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs font-label-mono text-system-log mb-1">
            System Prompt
          </label>
          <textarea
            ref={systemRef}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            data-testid="edit-system"
            className="w-full bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm font-mono overflow-hidden"
            style={{ resize: "none" }}
          />
        </div>
        <div>
          <label className="block text-xs font-label-mono text-system-log mb-1">
            User Prompt Template
            <span className="ml-2 text-system-log/60">
              {userTemplate.length} 字
            </span>
          </label>
          <textarea
            ref={userRef}
            value={userTemplate}
            onChange={(e) => setUserTemplate(e.target.value)}
            data-testid="edit-user-template"
            className="w-full bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm font-mono overflow-hidden"
            style={{ resize: "none" }}
          />
        </div>
        <AdvancedSection
          model={model}
          temperature={temperature}
          maxTokens={maxTokens}
          outputFormatJson={outputFormatJson}
          onModelChange={setModel}
          onTemperatureChange={setTemperature}
          onMaxTokensChange={setMaxTokens}
          onOutputFormatChange={setOutputFormatJson}
        />
      </div>

      <footer className="px-4 py-3 border-t border-outline-variant flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          data-testid="reset-button"
          disabled={!detail.override}
          className="px-3 py-1.5 text-sm text-system-log hover:text-primary disabled:opacity-40"
        >
          重置为默认
        </button>
        <button
          type="button"
          onClick={handleSave}
          data-testid="save-button"
          disabled={!dirty}
          className="px-4 py-1.5 bg-primary-container text-sm rounded text-surface-container-lowest hover:opacity-90 disabled:opacity-40"
        >
          保存
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptEditPanel.test.tsx 2>&1 | tail -10`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/promptPlaza/PromptEditPanel.tsx frontend/src/test/promptPlaza/PromptEditPanel.test.tsx
git commit -m "feat(plaza): PromptEditPanel — system + user textareas + advanced + dirty detection"
```

---

## Task 10: PromptPlazaModal（含测试）

**Files:**
- Create: `frontend/src/components/home/promptPlaza/PromptPlazaModal.tsx`
- Create: `frontend/src/test/promptPlaza/PromptPlazaModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/promptPlaza/PromptPlazaModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptPlazaModal from "../../../components/home/promptPlaza/PromptPlazaModal";

const SAMPLE_PROMPTS = [
  { name: "scene_writing", category: "", label: "场景写作", has_override: false, modified_at: null, builtin: true },
];

const SAMPLE_DETAIL = {
  name: "scene_writing",
  builtin_yaml: { system_prompt: "default" },
  override: null,
  effective: { system_prompt: "default", model: "deepseek-chat", temperature: 0.9, max_tokens: 1000 },
};

describe("PromptPlazaModal", () => {
  it("does not render when closed", () => {
    const { container } = render(
      <PromptPlazaModal
        isOpen={false}
        projectId="proj_x"
        projectTitle="测试"
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title and project name when open", () => {
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId="proj_x"
        projectTitle="诡眼少年"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("提示词广场")).toBeInTheDocument();
    expect(screen.getByText(/诡眼少年/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId="proj_x"
        projectTitle="测试"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows empty state when projectId is null", () => {
    render(
      <PromptPlazaModal
        isOpen={true}
        projectId={null}
        projectTitle={null}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/请先创建项目/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptPlazaModal.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PromptPlazaModal**

Create `frontend/src/components/home/promptPlaza/PromptPlazaModal.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { PromptDetail, PromptOverridePayload } from "../../../api/promptPlaza";
import { putPlazaPrompt, deletePlazaPrompt } from "../../../api/promptPlaza";
import { usePromptList } from "../../../hooks/usePromptList";
import { usePromptDetail } from "../../../hooks/usePromptDetail";
import PromptListPanel from "./PromptListPanel";
import PromptEditPanel from "./PromptEditPanel";

interface Props {
  isOpen: boolean;
  projectId: string | null;
  projectTitle: string | null;
  onClose: () => void;
}

export default function PromptPlazaModal({ isOpen, projectId, projectTitle, onClose }: Props) {
  const { prompts, loading: listLoading, error: listError, refresh: refreshList } = usePromptList(
    isOpen ? projectId : null,
  );
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { detail, loading: detailLoading, error: detailError, refresh: refreshDetail } = usePromptDetail(
    isOpen ? projectId : null,
    selectedName,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (!isOpen) setSelectedName(null);
  }, [isOpen]);

  // Auto-select first prompt when list loads (only if nothing selected)
  useEffect(() => {
    if (prompts.length > 0 && selectedName === null) {
      setSelectedName(prompts[0].name);
    }
  }, [prompts, selectedName]);

  const handleSave = useCallback(
    async (payload: PromptOverridePayload) => {
      if (!projectId || !selectedName) return;
      setSaving(true);
      setSaveError(null);
      try {
        await putPlazaPrompt(projectId, selectedName, payload);
        await Promise.all([refreshList(), refreshDetail()]);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setSaving(false);
      }
    },
    [projectId, selectedName, refreshList, refreshDetail],
  );

  const handleReset = useCallback(async () => {
    if (!projectId || !selectedName) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deletePlazaPrompt(projectId, selectedName);
      await Promise.all([refreshList(), refreshDetail()]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "重置失败");
    } finally {
      setSaving(false);
    }
  }, [projectId, selectedName, refreshList, refreshDetail]);

  // ESC close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="prompt-plaza-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-primary text-xl">提示词广场</h2>
            {projectTitle && (
              <span className="text-sm text-system-log">项目：{projectTitle}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="plaza-close"
            className="text-system-log hover:text-primary"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {!projectId ? (
          <div className="flex-1 flex items-center justify-center text-system-log">
            请先创建项目
          </div>
        ) : (
          <>
            {saveError && (
              <div className="mx-6 mt-3 p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
                {saveError}
              </div>
            )}
            <div className="flex-1 flex overflow-hidden">
              <aside className="w-72 border-r border-outline-variant">
                <PromptListPanel
                  prompts={prompts}
                  selectedName={selectedName}
                  onSelect={setSelectedName}
                />
                {listError && (
                  <div className="p-3 text-error text-xs">{listError}</div>
                )}
                {listLoading && (
                  <div className="p-3 text-system-log text-xs">加载中…</div>
                )}
              </aside>
              <main className="flex-1 flex flex-col overflow-hidden">
                <PromptEditPanel
                  detail={detail}
                  loading={detailLoading || saving}
                  error={detailError}
                  onSave={handleSave}
                  onReset={handleReset}
                  onClose={onClose}
                />
              </main>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/promptPlaza/PromptPlazaModal.test.tsx 2>&1 | tail -10`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/promptPlaza/PromptPlazaModal.tsx frontend/src/test/promptPlaza/PromptPlazaModal.test.tsx
git commit -m "feat(plaza): PromptPlazaModal — full-screen modal wiring list + detail + save + reset"
```

---

## Task 11: HomePage + StatsSidebar + QuickActions 接线

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/components/home/StatsSidebar.tsx`
- Modify: `frontend/src/components/home/QuickActions.tsx`

- [ ] **Step 1: Update QuickActions to accept and call onOpenPlaza**

Open `frontend/src/components/home/QuickActions.tsx`. Change the interface and the action list:

Replace:
```typescript
interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
}
```

With:
```typescript
interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
}
```

Replace the `qa-prompt-square` action:
```typescript
    {
      label: "提示词广场",
      icon: "forum",
      disabled: true,
      tooltip: "即将推出",
      testId: "qa-prompt-square",
    },
```

With:
```typescript
    {
      label: "提示词广场",
      icon: "forum",
      onClick: onOpenPlaza,
      disabled: plazaDisabled,
      tooltip: plazaTooltip,
      testId: "qa-prompt-square",
    },
```

- [ ] **Step 2: Update StatsSidebar to accept and forward plaza props**

Open `frontend/src/components/home/StatsSidebar.tsx`. Add to the interface:

```typescript
interface StatsSidebarProps {
  stats: ProjectStats | null;
  statsLoading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
}
```

Update the destructuring and pass through to `QuickActions`:

```typescript
export default function StatsSidebar({
  stats, statsLoading, onRefresh, refreshing, onOpenPlaza, plazaDisabled, plazaTooltip,
}: StatsSidebarProps) {
```

Find the `<QuickActions ... />` usage (inside both the expanded and collapsed variants). Update:

```tsx
<QuickActions
  onRefresh={onRefresh}
  refreshing={refreshing}
  onOpenPlaza={onOpenPlaza}
  plazaDisabled={plazaDisabled}
  plazaTooltip={plazaTooltip}
/>
```

- [ ] **Step 3: Update HomePage to render PromptPlazaModal + wire state**

Open `frontend/src/pages/HomePage.tsx`. Add imports:

```typescript
import { useMemo } from "react";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
```

(Other imports remain.)

Inside the component, after the existing state declarations (around line 21), add:

```typescript
  const [plazaOpen, setPlazaOpen] = useState(false);

  const mostRecentProject = useMemo(() => {
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) => b.updated_at - a.updated_at)[0];
  }, [projects]);
```

Find the existing `handleRefresh` and add after it:

```typescript
  const handleOpenPlaza = useCallback(() => {
    if (mostRecentProject) setPlazaOpen(true);
  }, [mostRecentProject]);
```

Update the JSX. Find the `<StatsSidebar ... />` invocation (around line 87). Update:

```tsx
      <StatsSidebar
        stats={stats}
        statsLoading={statsLoading}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onOpenPlaza={handleOpenPlaza}
        plazaDisabled={!mostRecentProject}
        plazaTooltip={mostRecentProject ? undefined : "请先创建项目"}
      />
```

After the closing `</main>` tag (around line 105), add the modal:

```tsx
      <PromptPlazaModal
        isOpen={plazaOpen}
        projectId={mostRecentProject?.id ?? null}
        projectTitle={mostRecentProject?.title ?? null}
        onClose={() => setPlazaOpen(false)}
      />
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Run all frontend plaza tests**

Run: `cd frontend && npx vitest run src/test/promptPlaza/ src/test/hooks/usePromptList.test.tsx src/test/hooks/usePromptDetail.test.tsx 2>&1 | tail -15`
Expected: All plaza tests PASS

- [ ] **Step 6: Run full frontend test suite to confirm no regression**

Run: `cd frontend && npx vitest run 2>&1 | tail -10`
Expected: All existing tests still PASS; only the 12 EventSource-related failures in Workspace.test.tsx (pre-existing) may remain

- [ ] **Step 7: Smoke-test the integration manually**

```bash
# Terminal 1: backend
source venv/bin/activate && uvicorn backend.main:app --reload --port 8000

# Terminal 2: frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`:
1. Click "提示词广场" → modal opens
2. Click on a prompt → detail panel shows
3. Edit a textarea → "保存" button enables
4. Click save → modal stays open, badge appears on the row
5. Reload page, reopen modal → row still has badge
6. Click "重置为默认" → badge disappears
7. Close modal

If any step fails, fix and re-test before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/HomePage.tsx frontend/src/components/home/StatsSidebar.tsx frontend/src/components/home/QuickActions.tsx
git commit -m "feat(home): wire prompt plaza entry from QuickActions → full-screen modal

Plaza opens on the most-recent project (sorted by updated_at). Button is
disabled with tooltip when no project exists. Save/reset flows update the
badge in real-time."
```

---

## 验收检查清单

完成后逐项确认：

- [ ] 首页侧栏「提示词广场」按钮可点击（不再是 disabled）
- [ ] 点击后全屏 modal 弹出，按分类显示 24 个提示词
- [ ] 选中一个提示词 → 右侧出现 system + user 两个大文本框 + 折叠的高级项
- [ ] 修改 system_prompt 一行 → 保存按钮变 enabled
- [ ] 保存 → modal 不关，列表项出现 override 圆点
- [ ] 重新打开 modal → 圆点仍在（持久化）
- [ ] 重置为默认 → 圆点消失
- [ ] 浏览器开发者工具显示 1 次 `PUT /api/projects/{id}/prompts/{name}` 成功
- [ ] `pytest tests/ -x` 全部通过，无回归
- [ ] `cd frontend && npx vitest run` 全部通过，仅已有的 12 个 Workspace.test.tsx EventSource 失败保持不变
- [ ] `BaseAgent.load_prompt("scene_writing")` 不传 project_id 时行为与改动前完全一致（由 `test_load_prompt_with_override.py::TestBackwardCompat::test_load_prompt_without_project_id_uses_yaml_only` 守住）

---

## 未来扩展（不在本 plan）

- **v1.x 后续**：让 agent 调用点（writer / reviewer / character_designer 等）传入 `project_id`，使项目级覆盖真正影响写作结果
- **v2**：版本历史 + 回滚 — 把 `prompt_overrides.json` 升级为 SQLite version 表，加 diff UI 与回滚按钮
- **v2**：变量提取 / sandbox dry-run — 解析 `{var}`、校验模板渲染、提供预览
- **v3**：跨项目模板共享 / 导入导出
- **v3**：工作台顶栏入口（在 workspace 里也能打开 plaza）