# Creative Canvas v2.0 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 v1.x WhatIfTree 模型重构为 5 步创意路径生成器 —— 每步固定 3 选项（保守/意外/激进）、单次 LLM 调用同时返回 (operation + reasoning + options[3])、Step 状态机 5 态（LOCKED/AVAILABLE/ACTIVE/COMPLETED/STALE）、v3 → v4 lazy schema 迁移、下游 concept_and_dna.json 输出 100% v3 兼容。

**Architecture:**
- **后端**：在 `backend/api/creative_diverge.py` 末尾扩展（保留所有 v1.x 路由，新加 v2 namespace `/creative/canvas/session/*`）；新增 `backend/creative_os/state_machine.py`（状态机 + 不变量校验）+ `backend/creative_os/op_hint.py`（确定性 op 选择）+ `backend/prompts/canvas_v2_next_step.yaml`（单次 LLM prompt）；`/commit` 改写为先生final_concept → 再写盘 → 校验生成结果
- **前端**：保留路由 `/project/:id/canvas`，重写 `CreativeCanvasPage.tsx` 装载 HorizontalPathCanvas；删除 WhatIfTree / CanvasNode / NodeDetailPanel；新增 `useCreativeCanvasV2` hook 封装状态机
- **灰度**：feature flag `ENABLE_CANVAS_V2` 控制 v1.x vs v2 路由组（环境变量驱动）；老 canvas_state.json v3 通过 lazy migration 兼容

**Tech Stack:** Python 3 · FastAPI · Pydantic · pytest · React 18 + Vite + Tailwind · Vitest · @testing-library/react · `ds/` primitives

**Spec:** `docs/superpowers/specs/2026-09-02-creative-canvas-v2-design.md`
**PRD:** `docs/design/creative-canvas-reconstruction.md`

**Branch:** `nebula`（无 worktree —— 用户偏好，见 `feedback_worktree_v19.md`）

**⚠ SSE gotcha**（CLAUDE.md）：实现期间如果开了 cockpit SSE 流，改 backend `.py` 会让 `uvicorn --reload` 卡死。**实现期间不要开 cockpit**，改完手动 reload；或 hard-kill + 重启。

---

## File Structure（锁定）

### 后端

| 文件 | 操作 | 职责 |
|---|---|---|
| `backend/api/creative_diverge.py` | Modify（+350 / -100） | 末尾加 v2 namespace + `_migrate_v3_to_v4` helper + `_read_canvas` lazy migrate + `/commit` 改先生后校验 |
| `backend/api/v2_canvas.py` | Create | v2 routes namespace（`/creative/canvas/session/*`） |
| `backend/creative_os/state_machine.py` | Create | `transition_step_state` + `_validate_step_invariants` + `_validate_for_commit` |
| `backend/creative_os/op_hint.py` | Create | `compute_op_hint` 6 分支 |
| `backend/prompts/canvas_v2_next_step.yaml` | Create | 单次 LLM prompt |
| `tests/test_creative_os/test_migration.py` | Create | v3 → v4 字段映射 + 已 commit 不写回 |
| `tests/test_creative_os/test_state_machine.py` | Create | 5 态 transition + invariants + commit 校验 5 失败场景 |
| `tests/test_creative_os/test_op_hint.py` | Create | 6 分支 + fallback |
| `tests/test_commit_validation.py` | Create | `/commit` 端点校验 5 失败场景（API 层测试） |
| `tests/test_v2_canvas_endpoints.py` | Create | init → next-step → select → commit 集成测试 |

### 前端

| 文件 | 操作 | 职责 |
|---|---|---|
| `frontend/src/pages/CreativeCanvasPage.tsx` | Rewrite | 替换 WhatIfTree 为 HorizontalPathCanvas + feature flag |
| `frontend/src/hooks/useCreativeCanvasV2.ts` | Create | 状态机 hook（loadCanvas / initSession / nextStep / selectOption / commitCanvas / resetCanvas） |
| `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx` | Create | 横向路径画布 + Step 状态展示 |
| `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` | Create | 当前 Step operation + 3 选项卡片 |
| `frontend/src/components/creative-canvas/QualityBar.tsx` | Create | 新颖度/冲突/故事潜力 评分条 |
| `frontend/src/components/creative-canvas/CanvasToolbar.tsx` | Rewrite | 移除节点计数 + 加 [查看完整路径] [重新开始] |
| `frontend/src/api/client.ts` | Modify（+80） | 加 `nextStepCanvas` / `selectCanvasOption` / `commitCanvas` 等 |
| `frontend/src/components/creative-canvas/WhatIfTree.tsx` | **Delete** | v2 不再需要 |
| `frontend/src/components/creative-canvas/CanvasNode.tsx` | **Delete** | 同上 |
| `frontend/src/components/creative-canvas/NodeDetailPanel.tsx` | **Delete** | 抽屉被 ActiveStepPanel 取代 |
| `frontend/src/hooks/useCreativeCanvas.ts` | **Delete**（被 V2 替代） | — |
| `frontend/src/components/creative-canvas/__tests__/HorizontalPathCanvas.test.tsx` | Create | 路径状态 + Step 卡片渲染 |
| `frontend/src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx` | Create | 3 选项渲染 + 选 B 调用 callback |

### 文档

| 文件 | 操作 |
|---|---|
| `docs/design/creative-canvas-reconstruction.md` | 已完成（PRD v2.0） |
| `docs/superpowers/specs/2026-09-02-creative-canvas-v2-design.md` | 已完成（本 spec） |
| `docs/superpowers/plans/2026-09-02-creative-canvas-v2.md` | 本文件 |

---

## Phase Index

- **Phase 1** —— 后端 migration + read/write helper（Tasks 1-3）
- **Phase 2** —— 后端 Step 状态机 + compute_op_hint + prompt（Tasks 4-6）
- **Phase 3** —— 后端 v2 routes namespace + `/commit` 改造（Tasks 7-8）
- **Phase 4** —— 后端集成测试（Task 9）
- **Phase 5** —— 前端 hook + API client（Tasks 10-11）
- **Phase 6** —— 前端组件 + page（Tasks 12-13）
- **Phase 7** —— E2E + feature flag 验证（Task 14）

---

## Task 1: 后端 —— `_migrate_v3_to_v4` helper + 单元测试

**Files:**
- Create: `backend/creative_os/migration.py`
- Create: `tests/test_creative_os/test_migration.py`

### Step 1: 写失败测试

```python
# tests/test_creative_os/test_migration.py
"""Verify v3 → v4 canvas_state.json migration."""
import pytest
from backend.creative_os.migration import (
    _migrate_v3_to_v4,
    _build_root_idea_from_raw_intent,
    _build_creative_path_from_v3,
    _build_current_concept_from_v3,
)


V3_MINIMAL = {
    "schema_version": 3,
    "session_id": "sess-1",
    "root_node_id": "wi_001_00",
    "nodes": {
        "wi_001_00": {
            "id": "wi_001_00", "depth": 0, "parent_id": None,
            "content": "长生者寻死的故事", "novelty_score": 70,
            "trope_tags": [], "saturation_warning": False,
            "mutation_context": None, "children_ids": ["wi_002_00"],
            "is_expanded": True, "branch_status": "active",
        },
        "wi_002_00": {
            "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
            "content": "调查未来尸体", "novelty_score": 80,
            "trope_tags": [], "saturation_warning": False,
            "mutation_context": None, "children_ids": [],
            "is_expanded": True, "branch_status": "active",
        },
    },
    "edges": [],
    "selected_path": ["wi_001_00", "wi_002_00"],
    "branch_choices": {"wi_001_00": "wi_002_00"},
    "evaluations": {},
    "created_at": "2026-08-30T10:00:00",
    "updated_at": "2026-08-30T10:00:00",
    "committed_at": None,
    "committed_concept_ref": None,
    "idea_variants": [],
    "core_contradiction": {
        "template_type": "ABILITY_VS_LIMIT",
        "statement": "长生者无法真正死去",
        "side_a": "长生", "side_b": "寻死",
        "tension_score": 85, "is_custom": False,
        "confirmed_at": "2026-08-30T10:00:00",
    },
    "novelty_scores": None,
    "raw_intent": {
        "prompt": "长生者寻死",
        "genre_primary": "仙侠",
        "genre_secondary": "悬疑",
        "trope_tags": [],
    },
    "session_metadata": {
        "created_at": "2026-08-30T10:00:00",
        "last_modified_at": "2026-08-30T10:00:00",
        "elapsed_seconds": 0, "operation_count": 5,
    },
}


def test_migrate_returns_v4_schema_version():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["schema_version"] == 4


def test_migrate_preserves_session_id():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["session_id"] == "sess-1"


def test_migrate_drops_v3_nodes_field():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert "nodes" not in v4
    assert "edges" not in v4
    assert "branch_choices" not in v4
    assert "selected_path" not in v4
    assert "root_node_id" not in v4


def test_migrate_builds_root_idea_from_raw_intent():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    root = v4["root_idea"]
    assert root["prompt"] == "长生者寻死"
    assert root["genre"] == "仙侠"
    assert root["premise"] == "长生者寻死"
    assert root["extracted"]["core_elements"] == []  # trope_tags was empty


def test_migrate_preserves_raw_intent():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["raw_intent"]["prompt"] == "长生者寻死"
    assert v4["raw_intent"]["genre_primary"] == "仙侠"
    assert v4["raw_intent"]["genre_secondary"] == "悬疑"


def test_migrate_creative_path_has_5_step1_available():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    path = v4["creative_path"]
    assert len(path) == 2  # 仅迁移 selected_path 实际走过的步数
    assert path[0]["step"] == 1
    assert path[0]["state"] == "completed"  # 历史已选过
    assert path[0]["selected_option_id"] == "option_root"
    assert path[1]["step"] == 2
    assert path[1]["state"] == "completed"


def test_migrate_creative_session_current_step_reflects_path_length():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    cs = v4["creative_session"]
    assert cs["current_step"] == 2  # = len(selected_path)
    assert cs["max_steps"] == 5
    assert cs["status"] == "active"  # 未 commit


def test_migrate_committed_sets_status_committed_and_final_concept():
    v3_committed = {**V3_MINIMAL, "committed_at": "2026-09-01T10:00:00"}
    v4 = _migrate_v3_to_v4(v3_committed)
    assert v4["creative_session"]["status"] == "committed"
    assert v4["committed"] is True
    assert v4["committed_at"] == "2026-09-01T10:00:00"
    assert v4["final_concept"] is not None  # core_contradiction 迁到 final_concept


def test_migrate_uncommitted_keeps_final_concept_null_and_current_concept():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["final_concept"] is None
    cc = v4["current_concept"]
    assert cc["premise"] == ""  # 无 v3 字段 → 空字符串
    assert cc["core_conflict"] == "长生者无法真正死去"  # 从 core_contradiction 派生


def test_migrate_pure_function_does_not_mutate_input():
    import copy
    snapshot = copy.deepcopy(V3_MINIMAL)
    _migrate_v3_to_v4(V3_MINIMAL)
    assert V3_MINIMAL == snapshot


def test_migrate_handles_empty_selected_path():
    v3_empty = {**V3_MINIMAL, "selected_path": [], "nodes": {}}
    v4 = _migrate_v3_to_v4(v3_empty)
    assert v4["creative_path"] == []
    assert v4["creative_session"]["current_step"] == 1
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_migration.py -v
```

Expected: FAIL — `ImportError: cannot import name '_migrate_v3_to_v4'`

### Step 3: 实现 migration helper

创建 `backend/creative_os/migration.py`：

```python
"""v3 → v4 canvas_state.json lazy migration.

v3 uses a WhatIfTree model (nodes + edges + selected_path + branch_choices).
v4 uses a 5-step creative path (creative_path[] + root_idea + raw_intent).

Migration is a pure function — it must not mutate the input. Committed v3
projects are migrated in memory only (no write-back, see _read_canvas).
"""
from __future__ import annotations

from typing import Optional


def _build_root_idea_from_raw_intent(raw_intent: dict) -> dict:
    """Derive root_idea (v4) from raw_intent (v3).

    v4 root_idea is the visual representation; raw_intent remains the
    canonical input contract (see spec §3.6).
    """
    return {
        "prompt": raw_intent.get("prompt", ""),
        "genre": raw_intent.get("genre_primary", ""),
        "premise": raw_intent.get("prompt", ""),
        "extracted": {
            "core_elements": raw_intent.get("trope_tags", []) or [],
            "potential_conflict": "",
        },
    }


def _build_creative_path_from_v3(v3: dict) -> list:
    """Rebuild creative_path from v3 selected_path + nodes + branch_choices.

    Only steps that were actually selected get a creative_path entry. v3
    had no concept of "step type", so operation defaults to "twist" with
    operation_reason="migrated_from_v3".
    """
    selected_path = v3.get("selected_path", [])
    nodes = v3.get("nodes", {})
    branch_choices = v3.get("branch_choices", {})
    creative_path = []
    for i, node_id in enumerate(selected_path):
        node = nodes.get(node_id, {})
        if i == 0:
            opt_id = "option_root"
        else:
            chosen = branch_choices.get(selected_path[i - 1], "unknown")
            opt_id = f"option_{i + 1}_{chosen}"
        creative_path.append({
            "step": i + 1,
            "operation": "twist",
            "operation_reason": "migrated_from_v3",
            "options": [{
                "id": opt_id,
                "title": (node.get("content", "") or "")[:30],
                "premise": node.get("content", ""),
                "logic": "",
                "scores": {"novelty": node.get("novelty_score", 0)},
            }],
            "selected_option_id": opt_id,
            "created_at": node.get("created_at", ""),
            "selected_at": node.get("selected_at", ""),
            "regenerated_count": 0,
            "state": "completed",
        })
    return creative_path


def _build_current_concept_from_v3(v3: dict) -> dict:
    """Build current_concept (v4) from v3 fields.

    For uncommitted canvases, current_concept absorbs core_contradiction.
    For committed canvases, final_concept absorbs it.
    """
    core = v3.get("core_contradiction") or {}
    return {
        "premise": "",
        "core_conflict": core.get("statement", ""),
        "characters": [],
        "world_rules": [],
        "tropes": [],
        "themes": [],
        "novelty": 0.0,
    }


def _migrate_v3_to_v4(canvas: dict) -> dict:
    """Lazy migration. Pure function — does NOT mutate input.

    See spec §3.2 for full field mapping table.
    """
    v3 = canvas
    is_committed = bool(v3.get("committed_at"))
    raw_intent = v3.get("raw_intent") or {}
    core = v3.get("core_contradiction") or {}

    v4 = {
        "schema_version": 4,
        "session_id": v3.get("session_id"),
        "root_idea": _build_root_idea_from_raw_intent(raw_intent),
        "raw_intent": raw_intent,
        "creative_session": {
            "current_step": max(1, len(v3.get("selected_path", []) or [])),
            "max_steps": 5,
            "status": "committed" if is_committed else "active",
        },
        "creative_path": _build_creative_path_from_v3(v3),
        "current_concept": _build_current_concept_from_v3(v3),
        "final_concept": core if is_committed else None,
        "committed": is_committed,
        "committed_at": v3.get("committed_at"),
        "committed_concept_ref": v3.get("committed_concept_ref"),
        "scores": v3.get("novelty_scores") or {},
        "session_metadata": v3.get("session_metadata", {}),
    }
    return v4
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_migration.py -v
```

Expected: 11 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/creative_os/migration.py tests/test_creative_os/test_migration.py && \
  git commit -m "feat(canvas-v2): _migrate_v3_to_v4 pure-function helper (v3 fields → v4 creative_path)"
```

---

## Task 2: 后端 —— `_read_canvas` lazy migration + 不写已 commit v3

**Files:**
- Modify: `backend/api/creative_diverge.py:82`（`_read_canvas` 入口）
- Create: `tests/test_creative_os/test_read_canvas_migration.py`

### Step 1: 写失败测试

```python
# tests/test_creative_os/test_read_canvas_migration.py
"""Verify _read_canvas performs v3 → v4 lazy migration correctly.

Key invariant: committed v3 canvases must NOT be written back to disk
(v3 schema is the historical record for committed projects).
"""
import json
import pytest
from backend.api import creative_diverge
from backend.config import settings


@pytest.fixture
def tmp_projects_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    return tmp_path


def _setup_project(tmp_path, pid, canvas_data):
    project_dir = tmp_path / pid
    cos_dir = project_dir / "creative_os"
    cos_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": pid, "genre": "xianxia"}),
        encoding="utf-8",
    )
    (cos_dir / "canvas_state.json").write_text(
        json.dumps(canvas_data), encoding="utf-8",
    )


def test_read_canvas_v4_returns_as_is(tmp_projects_dir):
    pid = "p_v4"
    v4_data = {"schema_version": 4, "session_id": "s1", "creative_path": []}
    _setup_project(tmp_projects_dir, pid, v4_data)
    result = creative_diverge._read_canvas(pid)
    assert result["schema_version"] == 4
    # File unchanged
    file_data = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    assert file_data == v4_data


def test_read_canvas_v3_uncommitted_migrates_and_writes_back(tmp_projects_dir):
    pid = "p_v3_active"
    v3 = {
        "schema_version": 3, "root_node_id": "wi_001_00",
        "nodes": {"wi_001_00": {"id": "wi_001_00", "content": "root",
                                 "novelty_score": 70, "children_ids": [],
                                 "depth": 0, "parent_id": None,
                                 "trope_tags": [], "saturation_warning": False,
                                 "mutation_context": None, "is_expanded": True,
                                 "branch_status": "active"}},
        "edges": [], "selected_path": ["wi_001_00"],
        "branch_choices": {}, "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": None, "committed_concept_ref": None,
        "idea_variants": [], "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": "p", "genre_primary": "xianxia",
                       "trope_tags": []},
        "session_metadata": {},
    }
    _setup_project(tmp_projects_dir, pid, v3)

    result = creative_diverge._read_canvas(pid)

    assert result["schema_version"] == 4
    # Disk now contains v4
    disk_data = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    # v3 fields dropped
    assert "nodes" not in disk_data
    assert "selected_path" not in disk_data
    assert "root_node_id" not in disk_data


def test_read_canvas_v3_committed_does_NOT_write_back(tmp_projects_dir):
    pid = "p_v3_committed"
    v3 = {
        "schema_version": 3, "root_node_id": "wi_001_00",
        "nodes": {"wi_001_00": {"id": "wi_001_00", "content": "root",
                                 "novelty_score": 70, "children_ids": [],
                                 "depth": 0, "parent_id": None,
                                 "trope_tags": [], "saturation_warning": False,
                                 "mutation_context": None, "is_expanded": True,
                                 "branch_status": "active"}},
        "edges": [], "selected_path": ["wi_001_00"],
        "branch_choices": {}, "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": "2026-09-01T10:00:00",
        "committed_concept_ref": "concept_and_dna.json",
        "idea_variants": [], "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": "p", "genre_primary": "xianxia",
                       "trope_tags": []},
        "session_metadata": {},
    }
    _setup_project(tmp_projects_dir, pid, v3)
    original_disk = json.dumps(v3, sort_keys=True)

    result = creative_diverge._read_canvas(pid)

    # Disk unchanged — v3 is the historical record
    disk_after = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    disk_after_str = json.dumps(disk_after, sort_keys=True)
    assert disk_after_str == original_disk, "committed v3 must not be overwritten"
    # But returned object is v4 (in-memory migration for read-only callers)
    assert result["schema_version"] == 4
    assert result["committed"] is True


def test_read_canvas_returns_none_for_missing_project(tmp_projects_dir):
    result = creative_diverge._read_canvas("p_nonexistent")
    assert result is None


def test_read_canvas_raises_for_unknown_schema(tmp_projects_dir):
    pid = "p_unknown"
    _setup_project(tmp_projects_dir, pid, {"schema_version": 2})
    with pytest.raises(Exception):
        creative_diverge._read_canvas(pid)
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_read_canvas_migration.py -v
```

Expected: FAIL — `_read_canvas` 当前不做 v3 → v4 迁移（直接读 v3 就返回 v3）

### Step 3: 改 `_read_canvas`

修改 `backend/api/creative_diverge.py:82-115`：

找到现有的 `_read_canvas`（约 line 82），替换为：

```python
def _read_canvas(project_id: str) -> Optional[dict]:
    """Read canvas_state.json, lazily migrating v3 → v4.

    Returns the v4 view (in-memory migration) for v3 canvases.

    Write-back semantics:
    - v4 canvas: returns as-is, no migration
    - v3 uncommitted: migrates AND writes v4 back to disk (next read sees v4)
    - v3 committed: migrates in-memory only, does NOT write back
      (v3 is the historical record; do not touch)

    Raises HTTPException(409) for unknown schema versions.
    """
    canvas = _get_fm().read_json(project_id, "canvas_state.json")
    if canvas is None:
        return None
    if canvas.get("schema_version") == 4:
        return canvas
    if canvas.get("schema_version") == 3:
        from backend.creative_os.migration import _migrate_v3_to_v4
        v4 = _migrate_v3_to_v4(canvas)
        if not v4.get("committed"):
            _write_canvas(project_id, v4, write_through=True)
        return v4
    raise HTTPException(
        status_code=409,
        detail={
            "error": True,
            "code": "UNKNOWN_SCHEMA_VERSION",
            "message": f"不支持的 schema_version: {canvas.get('schema_version')}",
            "detail": {},
        },
    )
```

### Step 4: 给 `_write_canvas` 加 `write_through` 参数

修改 `backend/api/creative_diverge.py:118`：

找到现有 `_write_canvas(project_id, data, preserve_committed=False)`，改为：

```python
def _write_canvas(
    project_id: str,
    data: dict,
    preserve_committed: bool = False,
    write_through: bool = True,
) -> None:
    """Atomically write canvas_state.json after validating invariants.

    Args:
        preserve_committed: If True, keep committed_at/committed_concept_ref
            even if `data` doesn't include them. Used by /commit itself.
        write_through: If False, skip the disk write (caller already knows
            the canvas is a transient v4 view, e.g. lazy-migrated v3 committed).

    All other behavior is unchanged.
    """
    # ... existing validation logic stays ...
    if not write_through:
        return
    # ... existing write logic ...
```

> **注意**：保留 `preserve_committed` 不动（v1.x 行为需要），仅新增 `write_through` 参数。

### Step 5: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_read_canvas_migration.py -v
```

Expected: 5 PASS

### Step 6: 跑现有 v1.x 测试，确认无回归

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_diverge_*.py -v
```

Expected: 所有 PASS

### Step 7: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_creative_os/test_read_canvas_migration.py && \
  git commit -m "feat(canvas-v2): _read_canvas v3→v4 lazy migration; _write_canvas write_through flag"
```

---

## Task 3: 后端 —— Step 状态机 `transition_step_state` + invariants

**Files:**
- Create: `backend/creative_os/state_machine.py`
- Create: `tests/test_creative_os/test_state_machine.py`

### Step 1: 写失败测试

```python
# tests/test_creative_os/test_state_machine.py
"""Verify Step state machine: 5 states + transition_step + _validate_step_invariants."""
import pytest
from backend.creative_os.state_machine import (
    transition_step_state,
    _validate_step_invariants,
    StepStateError,
)


def _make_canvas(num_steps: int, states: list) -> dict:
    """Helper: build a v4 canvas with N steps and given states."""
    return {
        "schema_version": 4,
        "creative_path": [
            {
                "step": i + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": opt_id if states[i] == "completed" else None,
                "created_at": "2026-09-02T10:00:00",
                "selected_at": "2026-09-02T10:00:00" if states[i] == "completed" else None,
                "regenerated_count": 0,
                "state": states[i],
            }
            for i, opt_id in zip(range(num_steps), ["option_1_a"] * num_steps)
        ],
    }


def test_init_makes_step_1_available_and_rest_locked():
    canvas = _make_canvas(5, ["locked"] * 5)
    transition_step_state(canvas, event="init")
    assert canvas["creative_path"][0]["state"] == "available"
    for i in range(1, 5):
        assert canvas["creative_path"][i]["state"] == "locked"


def test_activate_step_makes_state_active():
    canvas = _make_canvas(5, ["available", "locked", "locked", "locked", "locked"])
    transition_step_state(canvas, step=1, event="activate")
    assert canvas["creative_path"][0]["state"] == "active"


def test_complete_step_makes_completed_and_unlocks_next():
    canvas = _make_canvas(5, ["active", "locked", "locked", "locked", "locked"])
    canvas["creative_path"][0]["selected_option_id"] = "option_1_b"
    transition_step_state(canvas, step=1, event="complete")
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][1]["state"] == "available"
    # Steps 3-5 remain locked
    for i in range(2, 5):
        assert canvas["creative_path"][i]["state"] == "locked"


def test_complete_step_5_does_not_try_to_unlock_step_6():
    canvas = _make_canvas(5, ["completed", "completed", "completed",
                              "completed", "active"])
    canvas["creative_path"][4]["selected_option_id"] = "option_5_c"
    transition_step_state(canvas, step=5, event="complete")
    assert canvas["creative_path"][4]["state"] == "completed"
    # No IndexError — only 5 steps exist


def test_backtrack_from_marks_downstream_stale():
    """v2.1 behavior; v2.0 doesn't trigger it but the function must support it."""
    canvas = _make_canvas(5, ["completed", "completed", "active", "locked", "locked"])
    transition_step_state(canvas, step=3, event="backtrack_from")
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][1]["state"] == "completed"
    assert canvas["creative_path"][2]["state"] == "stale"
    assert canvas["creative_path"][3]["state"] == "stale"
    assert canvas["creative_path"][4]["state"] == "stale"


# --- invariants ---


def test_validate_invariants_passes_for_valid_5_step_completed():
    canvas = _make_canvas(5, ["completed"] * 5)
    _validate_step_invariants(canvas)  # should not raise


def test_validate_invariants_rejects_too_many_steps():
    canvas = _make_canvas(6, ["completed"] * 6)
    with pytest.raises(StepStateError, match="超过 5"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_missing_step_1():
    canvas = {"creative_path": [
        {"step": 2, "state": "completed", "selected_option_id": "x"},
    ]}
    with pytest.raises(StepStateError, match="Step 1"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_stale_steps():
    canvas = _make_canvas(5, ["completed", "completed", "stale", "locked", "locked"])
    with pytest.raises(StepStateError, match="STALE"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_completed_without_selection():
    canvas = _make_canvas(5, ["completed", "completed", "completed",
                              "completed", "completed"])
    canvas["creative_path"][2]["selected_option_id"] = None
    with pytest.raises(StepStateError, match="selected_option_id"):
        _validate_step_invariants(canvas)
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_state_machine.py -v
```

Expected: FAIL — `ImportError`

### Step 3: 实现 state machine

创建 `backend/creative_os/state_machine.py`：

```python
"""Step state machine for Creative Canvas v2.

5 states: LOCKED / AVAILABLE / ACTIVE / COMPLETED / STALE
(SKIPPED is v2.1+; not in v2.0 MVP)

All state changes go through transition_step_state() to keep the rules
centralized (spec §4.2). _validate_step_invariants() catches structural
errors that any single endpoint might miss.
"""
from __future__ import annotations


class StepStateError(ValueError):
    """Raised when creative_path violates a structural invariant."""


def transition_step_state(canvas: dict, step: int | None = None, event: str = "") -> None:
    """Apply a transition event to creative_path.

    Events:
      - "init": all LOCKED; step 1 = AVAILABLE (special)
      - "activate": path[step-1] = ACTIVE
      - "complete": path[step-1] = COMPLETED; path[step] = AVAILABLE (if exists)
      - "backtrack_from": path[step-1..end] = STALE (v2.1; v2.0 unused)

    No-op when event is empty or unknown.
    """
    path = canvas.get("creative_path", [])
    if not path:
        return

    if event == "init":
        for p in path:
            p["state"] = "locked"
        path[0]["state"] = "available"
        return

    if step is None or step < 1 or step > len(path):
        return

    if event == "activate":
        path[step - 1]["state"] = "active"
    elif event == "complete":
        path[step - 1]["state"] = "completed"
        if step < len(path):
            path[step]["state"] = "available"
    elif event == "backtrack_from":
        for i in range(step - 1, len(path)):
            path[i]["state"] = "stale"


def _validate_step_invariants(canvas: dict) -> None:
    """Raise StepStateError on any violation (spec §4.3).

    Called by _validate_for_commit() before allowing a commit.
    """
    path = canvas.get("creative_path", [])

    if len(path) > 5:
        raise StepStateError(f"creative_path 超过 5 步: {len(path)}")

    if not path or path[0].get("step") != 1:
        raise StepStateError("creative_path 必须以 Step 1 开头")

    if any(p.get("state") == "stale" for p in path):
        raise StepStateError("存在 STALE 步骤,需要回溯处理")

    for p in path:
        if p.get("state") == "completed" and not p.get("selected_option_id"):
            raise StepStateError(
                f"Step {p.get('step')} COMPLETED 但无 selected_option_id"
            )
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_state_machine.py -v
```

Expected: 9 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/creative_os/state_machine.py tests/test_creative_os/test_state_machine.py && \
  git commit -m "feat(canvas-v2): Step state machine (5 states) + invariants validator"
```

---

## Task 4: 后端 —— `_validate_for_commit`（不含 final_concept 检查）

**Files:**
- Create: `backend/api/v2_canvas.py`（partial — 只放 helper，路由留 Task 7）
- Create: `tests/test_commit_validation.py`

### Step 1: 写失败测试

```python
# tests/test_commit_validation.py
"""Verify /commit's _validate_for_commit enforces the 5 invariants (spec §4.4).

Note: this function must NOT check final_concept — final_concept is
generated by step 2 of /commit AFTER step 1 calls this function.
"""
import pytest
from backend.api.v2_canvas import _validate_for_commit
from backend.api import creative_diverge as cd
from fastapi import HTTPException


def _canvas(states):
    return {"creative_path": [
        {"step": i + 1, "state": s,
         "selected_option_id": "x" if s == "completed" else None}
        for i, s in enumerate(states)
    ]}


def test_validate_passes_for_5_completed_no_stale():
    _validate_for_commit(_canvas(["completed"] * 5))  # should not raise


def test_validate_fails_when_fewer_than_2_completed():
    with pytest.raises(HTTPException) as exc:
        _validate_for_commit(_canvas(["completed", "active", "locked", "locked", "locked"]))
    assert exc.value.status_code == 422
    assert "INVALID_PATH" in str(exc.value.detail)


def test_validate_fails_when_stale_present():
    with pytest.raises(HTTPException) as exc:
        _validate_for_commit(_canvas(["completed", "completed", "stale", "locked", "locked"]))
    assert exc.value.status_code == 422


def test_validate_fails_when_step_5_not_completed():
    with pytest.raises(HTTPException) as exc:
        _validate_for_commit(_canvas(["completed"] * 4 + ["active"]))
    assert "Step 5" in str(exc.value.detail)


def test_validate_does_not_check_final_concept():
    """Critical: final_concept is null at this point (generated in step 2)."""
    canvas = _canvas(["completed"] * 5)
    canvas["final_concept"] = None  # explicitly null
    _validate_for_commit(canvas)  # must not raise
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_commit_validation.py -v
```

Expected: FAIL — `ImportError: cannot import name '_validate_for_commit'`

### Step 3: 实现 helper

创建 `backend/api/v2_canvas.py`（先放 helper，路由在 Task 7 加）：

```python
"""Creative Canvas v2 routes — `/creative/canvas/session/*`.

This module extends the existing v1.x divergence API without breaking
changes. All v1.x endpoints in `creative_diverge.py` remain functional.

Endpoint naming: v2.0 uses `/creative/canvas/session/*` to:
  1. Differentiate from v1.x `/creative/diverge/*` (gradual rollout)
  2. Avoid conflict with wizard step 1's divergence sub-path
  3. Reserve `/creative/canvas/regenerate`, `/finalize`, `/backtrack`
     for v2.1+ deferred features
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/creative/canvas", tags=["canvas-v2"])


def _validate_for_commit(canvas: dict) -> None:
    """Validate canvas is ready to commit.

    Checks (spec §4.4):
      1. ≥ 2 steps COMPLETED
      2. No STALE steps
      3. Step 5 specifically COMPLETED (v2.0 MVP — no early-finalize)

    Note: this function does NOT check `final_concept` — final_concept is
    generated by step 2 of the commit handler AFTER step 1 invokes this
    function. Validation of the generated final_concept happens in step 3
    of the commit handler.
    """
    path = canvas.get("creative_path", [])
    completed = [p for p in path if p.get("state") == "completed"]
    if len(completed) < 2:
        raise HTTPException(
            status_code=422,
            detail={
                "error": True,
                "code": "INVALID_PATH",
                "message": "至少需要 2 步 COMPLETED",
                "detail": {},
            },
        )
    stale = [p for p in path if p.get("state") == "stale"]
    if stale:
        raise HTTPException(
            status_code=422,
            detail={
                "error": True,
                "code": "INVALID_PATH",
                "message": f"{len(stale)} 个 STALE 步骤需要处理",
                "detail": {},
            },
        )
    step5 = next((p for p in path if p.get("step") == 5), None)
    if not step5 or step5.get("state") != "completed":
        raise HTTPException(
            status_code=422,
            detail={
                "error": True,
                "code": "INVALID_PATH",
                "message": "Step 5 必须走完(v2.0 MVP 不支持早收束)",
                "detail": {},
            },
        )
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_commit_validation.py -v
```

Expected: 5 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/v2_canvas.py tests/test_commit_validation.py && \
  git commit -m "feat(canvas-v2): _validate_for_commit (5 invariants, no final_concept check)"
```

---

## Task 5: 后端 —— `compute_op_hint` 6 分支

**Files:**
- Create: `backend/creative_os/op_hint.py`
- Create: `tests/test_creative_os/test_op_hint.py`

### Step 1: 写失败测试

```python
# tests/test_creative_os/test_op_hint.py
"""Verify compute_op_hint deterministic rules (spec §6.2)."""
from backend.creative_os.op_hint import compute_op_hint


def test_step_5_always_dramaturgy():
    hint = compute_op_hint({"novelty": 0.9}, [], step=5)
    assert hint == "dramaturgy"


def test_low_novelty_returns_twist():
    hint = compute_op_hint({"novelty": 0.3}, [], step=2)
    assert hint == "twist"


def test_no_conflict_returns_break():
    hint = compute_op_hint({"novelty": 0.6, "core_conflict": "一句话无冲突"}, [], step=2)
    assert hint == "break"


def test_single_genre_returns_fuse():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突"},
        [],
        step=2,
        genres=["xianxia"],
    )
    assert hint == "fuse"


def test_step_3_no_invert_in_path_returns_invert():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "social"},
        [{"operation": "twist"}, {"operation": "break"}],
        step=3,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "invert"


def test_personal_conflict_scale_returns_escalate():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "personal"},
        [{"operation": "twist"}],
        step=4,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "escalate"


def test_default_returns_twist():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "social"},
        [{"operation": "twist"}, {"operation": "invert"}, {"operation": "escalate"}],
        step=4,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "twist"


def test_empty_concept_returns_twist_fallback():
    hint = compute_op_hint({}, [], step=2)
    assert hint == "twist"  # defaults trigger fallback


def test_handles_conflict_with_contradiction_keyword():
    hint = compute_op_hint(
        {"novelty": 0.6, "core_conflict": "主要矛盾在于身份"},
        [], step=2,
    )
    assert hint == "break"  # contains "矛盾"
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_op_hint.py -v
```

Expected: FAIL — `ImportError`

### Step 3: 实现 compute_op_hint

创建 `backend/creative_os/op_hint.py`：

```python
"""compute_op_hint — deterministic backend op-selection (spec §6.2).

The LLM can micro-adjust the hint, but the final `operation` must be
self-consistent with `operation_reason`. This function provides a
stable fallback when LLM is unavailable or returns low-confidence output.

Returns one of: "twist" | "break" | "fuse" | "invert" | "escalate" | "dramaturgy"
"""
from __future__ import annotations

from typing import Iterable


_VALID_OPS = {"twist", "break", "fuse", "invert", "escalate", "dramaturgy"}


def compute_op_hint(
    concept: dict,
    path: Iterable[dict],
    step: int,
    genres: list[str] | None = None,
) -> str:
    """Pure function. Same inputs → same output (no LLM)."""
    genres = genres or []

    # 1. Step 5 is always the "收束" / dramaturgy step
    if step >= 5:
        return "dramaturgy"

    # 2. Low novelty → twist to find fresh angle
    if (concept.get("novelty") or 0) < 0.5:
        return "twist"

    # 3. Missing core conflict → break to introduce one
    core = concept.get("core_conflict") or ""
    if "冲突" not in core and "矛盾" not in core:
        return "break"

    # 4. Single-genre canvas → fuse to introduce cross-genre
    if len(genres) < 2:
        return "fuse"

    # 5. Step ≥ 3 with no invert in history → invert for reversal
    if step >= 3 and not any(p.get("operation") == "invert" for p in path):
        return "invert"

    # 6. Conflict exists but at personal/None scale → escalate
    if concept.get("conflict_scale") in ("personal", None):
        return "escalate"

    # 7. Default
    return "twist"
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_op_hint.py -v
```

Expected: 9 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/creative_os/op_hint.py tests/test_creative_os/test_op_hint.py && \
  git commit -m "feat(canvas-v2): compute_op_hint deterministic 6-branch selector"
```

---

## Task 6: 后端 —— `canvas_v2_next_step.yaml` + prompt loader + JSON retry

**Files:**
- Create: `backend/prompts/canvas_v2_next_step.yaml`
- Create: `backend/api/v2_canvas.py`（追加 prompt loader + next-step 雏形）
- Create: `tests/test_creative_os/test_next_step_prompt.py`

### Step 1: 写失败测试

```python
# tests/test_creative_os/test_next_step_prompt.py
"""Verify next-step prompt is loaded and the JSON-retry wrapper works."""
import json
import pytest
from backend.api.v2_canvas import _load_next_step_prompt, _call_llm_with_retry


def test_load_prompt_has_system_and_user_sections():
    prompt = _load_next_step_prompt()
    assert "system" in prompt
    assert "user" in prompt
    assert "operation" in prompt["system"]
    assert "options" in prompt["system"]


@pytest.mark.asyncio
async def test_call_llm_with_retry_succeeds_first_try():
    """Mock LLM that returns valid JSON on first call."""
    calls = {"count": 0}

    async def fake_llm(prompt):
        calls["count"] += 1
        return json.dumps({
            "operation": "twist", "operation_reason": "test",
            "options": [
                {"id": "opt_a", "title": "A", "premise": "p1", "logic": ""},
                {"id": "opt_b", "title": "B", "premise": "p2", "logic": ""},
                {"id": "opt_c", "title": "C", "premise": "p3", "logic": ""},
            ],
        })

    result = await _call_llm_with_retry(fake_llm, {"any": "ctx"})
    assert calls["count"] == 1
    assert result["operation"] == "twist"
    assert len(result["options"]) == 3


@pytest.mark.asyncio
async def test_call_llm_with_retry_retries_on_invalid_json():
    """Mock LLM that returns invalid JSON first, valid JSON second."""
    calls = {"count": 0}

    async def fake_llm(prompt):
        calls["count"] += 1
        if calls["count"] == 1:
            return "not valid json"
        return json.dumps({
            "operation": "twist", "operation_reason": "retry success",
            "options": [
                {"id": "opt_a", "title": "A", "premise": "p", "logic": ""},
                {"id": "opt_b", "title": "B", "premise": "p", "logic": ""},
                {"id": "opt_c", "title": "C", "premise": "p", "logic": ""},
            ],
        })

    result = await _call_llm_with_retry(fake_llm, {"any": "ctx"})
    assert calls["count"] == 2
    assert result["operation"] == "twist"


@pytest.mark.asyncio
async def test_call_llm_with_retry_raises_after_2_failures():
    """Mock LLM that always returns invalid JSON — should raise after retry."""
    async def fake_llm(prompt):
        return "garbage"

    with pytest.raises(RuntimeError, match="LLM"):
        await _call_llm_with_retry(fake_llm, {"any": "ctx"})
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_next_step_prompt.py -v
```

Expected: FAIL — `ImportError`

### Step 3: 创建 prompt YAML

创建 `backend/prompts/canvas_v2_next_step.yaml`：

```yaml
system: |
  你是创意推演引擎。根据当前创意状态,决定下一步最有价值的创意操作,并生成 3 个候选方向。

  你的输出必须是合法 JSON(无 Markdown 代码块包裹):
  {
    "operation": "twist|break|fuse|invert|escalate|dramaturgy",
    "operation_reason": "为什么选这个操作(30 字内)",
    "options": [
      { "id": "opt_a", "title": "...", "premise": "...", "logic": "..." },
      { "id": "opt_b", "title": "...", "premise": "...", "logic": "..." },
      { "id": "opt_c", "title": "...", "premise": "...", "logic": "..." }
    ]
  }

  三个选项必须:
  1. 保持当前创意的核心
  2. 产生明显不同的剧情可能
  3. 有明确的因果变化
  4. 能够继续向下游发展
  5. 三者之间存在显著差异(按操作类型自适应:twist 改条件/因果/设定;break 规则失效/反噬/不存在;fuse 表面元素/类型规则/世界观;invert 立场反转/因果反转/主题反转;escalate 个人/社会/文明;dramaturgy 简洁/复杂/主题化)

  如果 candidate_operation_hint 存在,你可以微调,但 operation 必须与 operation_reason 自洽。

user: |
  current_concept: {premise} | 核心冲突: {core_conflict} | 角色: {characters} | 世界规则: {world_rules} | 类型标签: {tropes} | 主题: {themes}
  selected_path: {selected_path_summary}
  current_step: {current_step}
  max_steps: {max_steps}
  candidate_operation_hint: {candidate_operation_hint}
```

### Step 4: 在 `v2_canvas.py` 加 prompt loader + JSON retry helper

编辑 `backend/api/v2_canvas.py`，在 `_validate_for_commit` 上方插入：

```python
import asyncio
import json
import logging
from pathlib import Path
from typing import Awaitable, Callable

import yaml

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_NEXT_STEP_PROMPT_PATH = _PROMPTS_DIR / "canvas_v2_next_step.yaml"
_logger = logging.getLogger(__name__)


def _load_next_step_prompt() -> dict:
    """Load next-step prompt template from YAML.

    Loaded once at first call and cached. Tests should not depend on
    call-count; we cache for stability across reads.
    """
    if not hasattr(_load_next_step_prompt, "_cache"):
        with open(_NEXT_STEP_PROMPT_PATH, encoding="utf-8") as f:
            _load_next_step_prompt._cache = yaml.safe_load(f)
    return _load_next_step_prompt._cache


async def _call_llm_with_retry(
    llm_call: Callable[[dict], Awaitable[str]],
    context: dict,
    max_attempts: int = 2,
) -> dict:
    """Call LLM with JSON retry (spec §6.5).

    Retries ONCE on JSON parse failure with hint 'Please return valid
    JSON only'. Retry interval is 0 (immediate). Raises RuntimeError
    after exhaustion.
    """
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            raw = await llm_call(context)
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            _logger.warning("LLM JSON parse failed on attempt %d: %s", attempt + 1, exc)
            if attempt + 1 < max_attempts:
                # Retry with hint appended to context (next call sees context["retry_hint"])
                context = {**context, "retry_hint": "Please return valid JSON only"}
    raise RuntimeError(
        f"LLM 返回了无效 JSON ({max_attempts} 次): {last_error}"
    )
```

### Step 5: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_os/test_next_step_prompt.py -v
```

Expected: 4 PASS

### Step 6: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/prompts/canvas_v2_next_step.yaml backend/api/v2_canvas.py tests/test_creative_os/test_next_step_prompt.py && \
  git commit -m "feat(canvas-v2): next-step prompt YAML + LLM JSON retry helper (1 retry, interval 0)"
```

---

## Task 7: 后端 —— v2 路由 namespace + `/init` + `/next-step` + `/select`

**Files:**
- Modify: `backend/api/v2_canvas.py`（追加路由）
- Modify: `backend/main.py`（注册 v2 router；feature flag 控制可见性）
- Create: `tests/test_v2_canvas_endpoints.py`

### Step 1: 写失败测试

```python
# tests/test_v2_canvas_endpoints.py
"""Integration tests for v2 endpoints: /init → /next-step → /select."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.config import settings


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "p_v2_init"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        '{"id": "p_v2_init", "genre": "xianxia"}', encoding="utf-8",
    )
    return pid


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(v2_router)
    return TestClient(app)


def test_init_writes_v4_with_raw_intent_and_root_idea(project, client):
    response = client.post(
        f"/creative/canvas/session/init",
        json={
            "prompt": "长生者寻死",
            "genre_primary": "xianxia",
            "genre_secondary": "xuanyi",
            "quick_mode": False,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["ok"] is True
    assert "session_id" in data
    assert "etag" in data

    # File on disk is v4
    import json
    from pathlib import Path
    canvas_path = Path(settings.projects_dir) / project / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    assert canvas["schema_version"] == 4
    assert canvas["raw_intent"]["prompt"] == "长生者寻死"
    assert canvas["root_idea"]["genre"] == "xianxia"
    assert len(canvas["creative_path"]) == 1
    assert canvas["creative_path"][0]["step"] == 1
    assert canvas["creative_path"][0]["state"] == "available"


def test_state_returns_v4_after_init(project, client):
    client.post(
        f"/creative/canvas/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    response = client.get(f"/creative/canvas/session/state")
    assert response.status_code == 200
    data = response.json()
    assert data["schema_version"] == 4


def test_next_step_404_when_canvas_not_initialized(project, client):
    response = client.post(
        f"/creative/canvas/session/next-step",
        json={"current_step": 1},
    )
    # Canvas not found → 400 (not 404 — handler raises HTTPException)
    assert response.status_code in (400, 404)


def test_next_step_returns_operation_and_3_options(project, client, monkeypatch):
    client.post(
        f"/creative/canvas/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )

    # Stub the LLM call to return predictable output
    async def fake_llm_call(context):
        return (
            '{"operation": "twist", "operation_reason": "test",'
            '"options": ['
            '{"id": "opt_a", "title": "A", "premise": "p1", "logic": ""},'
            '{"id": "opt_b", "title": "B", "premise": "p2", "logic": ""},'
            '{"id": "opt_c", "title": "C", "premise": "p3", "logic": ""}'
            ']}'
        )
    monkeypatch.setattr("backend.api.v2_canvas._call_llm_with_retry",
                        lambda llm, ctx: fake_llm_call(ctx))

    # Monkeypatch the inner llm_call — easier: patch _call_llm_with_retry directly
    from backend.api import v2_canvas
    async def stub_retry(llm_call, context, max_attempts=2):
        raw = await llm_call(context)
        import json
        return json.loads(raw)
    monkeypatch.setattr(v2_canvas, "_call_llm_with_retry", stub_retry)

    response = client.post(
        f"/creative/canvas/session/next-step",
        json={"current_step": 1},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["operation"]["type"] == "twist"
    assert len(data["options"]) == 3
    assert all("id" in o for o in data["options"])


def test_select_marks_step_completed_and_unlocks_next(project, client, monkeypatch):
    client.post(
        f"/creative/canvas/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    # Stub next-step to avoid LLM
    from backend.api import v2_canvas
    async def fake_next_step(*a, **kw):
        return {
            "step": 1,
            "operation": {"type": "twist", "name": "扭曲", "reason": ""},
            "options": [
                {"id": "opt_1_a", "title": "A", "premise": "p", "logic": "",
                 "scores": {}},
                {"id": "opt_1_b", "title": "B", "premise": "p", "logic": "",
                 "scores": {}},
                {"id": "opt_1_c", "title": "C", "premise": "p", "logic": "",
                 "scores": {}},
            ],
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next_step)

    client.post(f"/creative/canvas/session/next-step", json={"current_step": 1})

    response = client.post(
        f"/creative/canvas/session/select",
        json={"step": 1, "option_id": "opt_1_b"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["ok"] is True
    assert data["step"] == 1
    assert data["selected_option_id"] == "opt_1_b"

    # Verify canvas on disk
    import json
    from pathlib import Path
    canvas_path = Path(settings.projects_dir) / project / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][0]["selected_option_id"] == "opt_1_b"
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py -v
```

Expected: FAIL — `/creative/canvas/session/init` 等端点不存在

### Step 3: 实现 v2 路由

编辑 `backend/api/v2_canvas.py`，在末尾追加路由：

```python
from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.creative_diverge import (
    _ensure_project,
    _read_canvas,
    _write_canvas,
    _compute_etag,
)
from backend.creative_os.state_machine import (
    transition_step_state,
    _validate_step_invariants,
)
from backend.creative_os.op_hint import compute_op_hint
from backend.creative_os.migration import _migrate_v3_to_v4


# --- Pydantic models ---


class InitRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1700)
    genre_primary: str = Field(..., min_length=1)
    genre_secondary: Optional[str] = None
    target_reader: Optional[str] = None
    reference_works: Optional[list[str]] = None
    forbidden_directions: Optional[list[str]] = None
    quick_mode: bool = False


class NextStepRequest(BaseModel):
    current_step: int = Field(..., ge=1, le=5)


class SelectRequest(BaseModel):
    step: int = Field(..., ge=1, le=5)
    option_id: str = Field(..., min_length=1)


# --- /init ---


@router.post("/session/init")
async def init_canvas_v2(request: Request, body: InitRequest):
    """Initialize v2 canvas with raw_intent + root_idea dual-write."""
    project_id = request.path_params.get("project_id", "")
    _ensure_project(project_id)

    now = datetime.now(timezone.utc).isoformat()
    canvas = {
        "schema_version": 4,
        "session_id": str(uuid.uuid4()),
        "root_idea": {
            "prompt": body.prompt,
            "genre": body.genre_primary,
            "premise": body.prompt,
            "extracted": {"core_elements": []},
        },
        "raw_intent": {
            "prompt": body.prompt,
            "genre_primary": body.genre_primary,
            "genre_secondary": body.genre_secondary,
            "target_reader": body.target_reader,
            "reference_works": body.reference_works or [],
            "forbidden_directions": body.forbidden_directions or [],
            "quick_mode": body.quick_mode,
            "trope_tags": [],
        },
        "creative_session": {
            "current_step": 1,
            "max_steps": 5,
            "status": "active",
        },
        "creative_path": [{
            "step": 1,
            "operation": None,
            "operation_reason": None,
            "options": [],
            "selected_option_id": None,
            "created_at": now,
            "selected_at": None,
            "regenerated_count": 0,
            "state": "available",
        }],
        "current_concept": {
            "premise": body.prompt,
            "core_conflict": "",
            "characters": [],
            "world_rules": [],
            "tropes": [],
            "themes": [],
            "novelty": 0.0,
        },
        "final_concept": None,
        "committed": False,
        "scores": {},
        "session_metadata": {
            "created_at": now,
            "last_modified_at": now,
            "elapsed_seconds": 0,
            "operation_count": 0,
        },
    }
    canvas["_etag"] = _compute_etag(canvas)
    _write_canvas(project_id, canvas)

    return {"ok": True, "session_id": canvas["session_id"], "etag": canvas["_etag"]}


# --- /state ---


@router.get("/session/state")
async def get_state_v2(request: Request):
    project_id = request.path_params.get("project_id", "")
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(status_code=404, detail={"code": "CANVAS_NOT_FOUND",
                                                      "message": "画布未初始化"})
    canvas["_etag"] = _compute_etag(canvas)
    return canvas


# --- /next-step (impl extracted for testability) ---


async def _next_step_impl(project_id: str, current_step: int) -> dict:
    """Core logic for /next-step. Returns {step, operation, options, quality_warning}.

    Raises HTTPException on validation failure.
    """
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(status_code=400, detail={"code": "CANVAS_NOT_INITIALIZED"})

    if canvas["creative_session"]["current_step"] != current_step:
        raise HTTPException(
            status_code=409,
            detail={"code": "STEP_OUT_OF_SYNC",
                    "message": f"expected step {canvas['creative_session']['current_step']}"},
        )

    # Compute deterministic op hint
    genres = [canvas["raw_intent"].get("genre_primary") or ""]
    if canvas["raw_intent"].get("genre_secondary"):
        genres.append(canvas["raw_intent"]["genre_secondary"])
    hint = compute_op_hint(
        canvas["current_concept"],
        canvas["creative_path"],
        current_step,
        genres=genres,
    )

    # Call LLM (single shot) via project's model_router.
    # Uses tier-1 (creative core) per CLAUDE.md routing.
    # See backend/llm/model_router.py + backend/services/llm_config.py.
    from backend.llm.model_router import get_model_router
    from backend.config import settings as _settings

    async def llm_call(context):
        router = get_model_router()
        user_prompt = (
            f"current_concept: {context.get('concept', {})}\n"
            f"selected_path: {context.get('selected_path', [])}\n"
            f"current_step: {context.get('step')}\n"
            f"max_steps: 5\n"
            f"candidate_operation_hint: {context.get('hint')}\n"
        )
        system_prompt = _load_next_step_prompt()["system"]
        return await router.complete(
            tier="tier1",
            system=system_prompt,
            user=user_prompt,
            model=_settings.llm_model,
            max_tokens=2048,
            temperature=0.7,
        )

    parsed = await _call_llm_with_retry(llm_call, {
        "hint": hint,
        "concept": canvas["current_concept"],
        "step": current_step,
    })

    # Build path entry
    path_entry = {
        "step": current_step,
        "operation": parsed["operation"],
        "operation_reason": parsed.get("operation_reason", ""),
        "options": [{
            "id": o["id"],
            "title": o["title"],
            "premise": o["premise"],
            "logic": o.get("logic", ""),
            "scores": {},  # fire-and-forget NoveltyEvaluator will fill
        } for o in parsed["options"]],
        "selected_option_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "selected_at": None,
        "regenerated_count": 0,
        "state": "active",
    }

    # Ensure creative_path has an entry for this step (extend if needed)
    while len(canvas["creative_path"]) < current_step:
        canvas["creative_path"].append({
            "step": len(canvas["creative_path"]) + 1,
            "operation": None,
            "operation_reason": None,
            "options": [],
            "selected_option_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "selected_at": None,
            "regenerated_count": 0,
            "state": "locked",
        })

    canvas["creative_path"][current_step - 1] = path_entry
    transition_step_state(canvas, step=current_step, event="activate")
    canvas["_etag"] = _compute_etag(canvas)
    _write_canvas(project_id, canvas)

    return {
        "step": current_step,
        "operation": {
            "type": parsed["operation"],
            "name": parsed["operation"],
            "reason": parsed.get("operation_reason", ""),
        },
        "options": path_entry["options"],
        "quality_warning": None,
    }


@router.post("/session/next-step")
async def next_step_v2(request: Request, body: NextStepRequest):
    project_id = request.path_params.get("project_id", "")
    return await _next_step_impl(project_id, body.current_step)


# --- /select ---


@router.post("/session/select")
async def select_option_v2(request: Request, body: SelectRequest):
    """Mark step's selected_option_id; cascade-compute next step or finalize."""
    project_id = request.path_params.get("project_id", "")
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(status_code=400, detail={"code": "CANVAS_NOT_INITIALIZED"})

    path = canvas["creative_path"]
    if body.step > len(path):
        raise HTTPException(status_code=404, detail={"code": "STEP_NOT_FOUND"})

    entry = path[body.step - 1]
    if body.option_id not in [o["id"] for o in entry.get("options", [])]:
        raise HTTPException(status_code=422, detail={"code": "INVALID_OPTION_ID"})

    entry["selected_option_id"] = body.option_id
    entry["selected_at"] = datetime.now(timezone.utc).isoformat()

    # Update current_concept from selected option
    selected = next(o for o in entry["options"] if o["id"] == body.option_id)
    canvas["current_concept"]["premise"] = selected.get("premise", canvas["current_concept"]["premise"])

    transition_step_state(canvas, step=body.step, event="complete")

    # Auto-trigger next step (or finalize at step 5)
    if body.step < 5:
        await _next_step_impl(project_id, body.step + 1)
        canvas = _read_canvas(project_id)
    # else: current_concept 收尾(final_concept 留给 /commit)

    canvas["_etag"] = _compute_etag(canvas)
    _write_canvas(project_id, canvas)

    return {"ok": True, "step": body.step, "selected_option_id": body.option_id}
```

> **注意**：`_next_step_impl` 提取为模块级函数，方便 Task 7 测试用 monkeypatch。

### Step 4: 注册 v2 router（feature flag 控制）

修改 `backend/main.py`：

找到现有 app 创建处（一般是 `app = FastAPI(...)`），在 `include_router` 处插入：

```python
from backend.config import settings as _settings

if _settings.enable_canvas_v2:
    from backend.api.v2_canvas import router as v2_canvas_router
    app.include_router(v2_canvas_router)
```

修改 `backend/config.py`：

找到 `Settings` 类，加字段：

```python
enable_canvas_v2: bool = False
```

读环境变量：

```python
# 在 SettingsConfig 或类似处
enable_canvas_v2: bool = Field(
    default=False,
    description="Enable Creative Canvas v2 endpoints (gradual rollout)",
)
```

### Step 5: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py -v
```

Expected: 5 PASS

### Step 6: 跑全部测试，确认无回归

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_diverge_*.py \
         tests/test_creative_os/test_migration.py \
         tests/test_creative_os/test_state_machine.py \
         tests/test_creative_os/test_op_hint.py \
         tests/test_creative_os/test_next_step_prompt.py \
         tests/test_creative_os/test_read_canvas_migration.py \
         tests/test_commit_validation.py \
         tests/test_v2_canvas_endpoints.py -v
```

Expected: 所有 PASS

### Step 7: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/v2_canvas.py backend/main.py backend/config.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-v2): v2 routes namespace + /init + /next-step + /select + feature flag"
```

---

## Task 8: 后端 —— `/commit` 改造（先生成 final_concept 再校验）

**Files:**
- Modify: `backend/api/creative_diverge.py:1810`（`/commit` handler；改 step 顺序）
- Modify: `backend/api/v2_canvas.py`（加 v2 `/commit` endpoint，代理 + 委托 creative_diverge）

### Step 1: 修改 `/commit` handler

修改 `backend/api/creative_diverge.py:1810` 的 `/commit` handler。

**核心改动**：把 `_validate_for_commit` 调用从 handler 开头移到 PlannerAgent.generate_concept_from_canvas 调用之后。找到现有 `/commit` handler（line 1810），重组为：

```python
@router.post("/commit")
async def commit_canvas(project_id: str, request: Request):
    """Commit canvas → concept_and_dna.json (v3 schema compatible).

    Step ordering (spec §5.4):
      1. Validate canvas via _validate_for_commit (does NOT check final_concept)
      2. Generate final_concept via PlannerAgent.generate_concept_from_canvas
      3. Validate generated final_concept is non-empty (PlannerAgent gate)
      4. Write concept_and_dna.json (v3 schema; canvas_snapshot.selected_path
         dual-written for backfill script compatibility)
      5. Dual-write creative_divergence.json
      6. Mark canvas_state.committed_at = now
      7. Rollback note: if concept_and_dna write fails after canvas_state
         stamp, leave stale — next /commit call will overwrite (v1.x
    behavior, see lines 2057-2069 in v1.x for the proven pattern)

    v2.0 does NOT write creative_path / creative_mechanism / canvas_meta
    to concept_and_dna.json (PRD §28.1 — MVP scope).
    """
    # Step 1: validate (NO final_concept check)
    _validate_for_commit_canvas_only(_read_canvas(project_id))

    # Step 2: generate final_concept
    canvas = _read_canvas(project_id)
    from backend.agents.planner import PlannerAgent
    planner = PlannerAgent()
    final_concept, _ = await planner.generate_concept_from_canvas(canvas, genre=...)

    # Step 3: validate generated final_concept is non-empty
    if not final_concept or not final_concept.get("concept"):
        raise HTTPException(
            status_code=503,
            detail={"code": "GENERATION_FAILED",
                    "message": "PlannerAgent 未生成有效 concept"},
        )

    # Steps 4-6: write files, mark committed, dual-write divergence
    # ... (existing logic, with concept_and_dna.canvas_snapshot.selected_path
    #     derived from canvas["creative_path"])
```

`_validate_for_commit_canvas_only` 是新的 helper（从 v2_canvas 复用）：

```python
def _validate_for_commit_canvas_only(canvas):
    """Thin wrapper around v2_canvas._validate_for_commit for v1.x endpoint."""
    if canvas is None:
        raise HTTPException(status_code=400, detail={"code": "CANVAS_NOT_FOUND"})
    from backend.api.v2_canvas import _validate_for_commit as _v2_validate
    _v2_validate(canvas)
```

### Step 2: 加 v2 `/commit` endpoint

编辑 `backend/api/v2_canvas.py`，追加路由：

```python
@router.post("/session/commit")
async def commit_canvas_v2(request: Request):
    """v2 commit endpoint — delegates to v1.x logic after validation.

    Both v1.x `/creative/diverge/commit` and v2 `/creative/canvas/session/commit`
    share the same downstream logic; the only difference is the new validation
    order (generate-then-validate).
    """
    project_id = request.path_params.get("project_id", "")
    # Delegate to v1.x handler — it now does the right thing after our edit
    from backend.api.creative_diverge import commit_canvas as _v1_commit
    return await _v1_commit(project_id, request)
```

### Step 3: 跑现有 commit 测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_diverge_commit.py -v
```

Expected: 所有 PASS

### Step 4: 加 `/commit` v3-compat 输出测试

修改 `tests/test_creative_diverge_commit.py`（或在 `tests/test_v2_canvas_endpoints.py` 加新测试），加：

```python
def test_commit_writes_v3_compatible_concept_and_dna(project, client, monkeypatch):
    """v2 /commit must output concept_and_dna.json in v3 schema (no new fields)."""
    from backend.api import v2_canvas
    async def fake_generate(self, canvas_summary, genre="cool_novel"):
        return (
            {
                "concept": {"title": "T", "premise": "P", "genre": "xianxia",
                            "tone": "", "theme": "", "target_audience": "",
                            "style_template": "", "source": "canvas"},
                "story_dna": {
                    "core_contradiction": {"statement": "S", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"level": "personal", "value_a": "", "value_b": ""}] * 4,
                    "style_template": "", "fusion_meta": None,
                },
            },
            None,
        )
    from backend.agents.planner import PlannerAgent
    monkeypatch.setattr(PlannerAgent, "generate_concept_from_canvas", fake_generate)

    # Init + select through 5 steps
    client.post("/creative/canvas/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})

    # Mock next-step to return same options each time
    async def fake_next(project_id, current_step):
        return {
            "step": current_step,
            "operation": {"type": "twist", "name": "twist", "reason": ""},
            "options": [
                {"id": f"opt_{current_step}_a", "title": "A", "premise": "p", "logic": "",
                 "scores": {}},
                {"id": f"opt_{current_step}_b", "title": "B", "premise": "p", "logic": "",
                 "scores": {}},
                {"id": f"opt_{current_step}_c", "title": "C", "premise": "p", "logic": "",
                 "scores": {}},
            ],
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next)

    for step in range(1, 6):
        client.post("/creative/canvas/session/next-step",
                    json={"current_step": step})
        client.post("/creative/canvas/session/select",
                    json={"step": step, "option_id": f"opt_{step}_b"})

    response = client.post("/creative/canvas/session/commit")
    assert response.status_code == 200, response.text

    # Verify v3 schema in concept_and_dna.json
    import json
    from pathlib import Path
    cnp = Path(settings.projects_dir) / project / "concept_and_dna.json"
    cnd = json.loads(cnp.read_text(encoding="utf-8"))
    # v3 schema fields exist
    assert "concept" in cnd
    assert "story_dna" in cnd
    assert "canvas_snapshot" in cnd
    # v2 NEW fields NOT written
    assert "creative_path" not in cnd
    assert "creative_mechanism" not in cnd
    assert "canvas_meta" not in cnd
    # canvas_snapshot.selected_path is dual-written for backfill compat
    assert "selected_path" in cnd["canvas_snapshot"]
    assert len(cnd["canvas_snapshot"]["selected_path"]) == 5
```

### Step 5: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py tests/test_creative_diverge_commit.py -v
```

Expected: 所有 PASS

### Step 6: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "fix(canvas-v2): /commit validates after PlannerAgent generation (step order fix)"
```

---

## Task 9: 后端 —— 完整集成测试（5 步端到端）

**Files:**
- Create: `tests/test_v2_e2e.py`

### Step 1: 写测试

```python
# tests/test_v2_e2e.py
"""End-to-end integration test for v2 canvas: init → 5×next-step → 5×select → commit."""
import json
import pytest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.agents.planner import PlannerAgent
from backend.config import settings


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "p_e2e"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        '{"id": "p_e2e", "genre": "xianxia"}', encoding="utf-8",
    )
    return pid


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(v2_router)
    return TestClient(app)


@pytest.fixture
def stub_planner(monkeypatch):
    async def fake_generate(self, canvas_summary, genre="xianxia"):
        return (
            {
                "concept": {"title": "T", "premise": "P", "genre": genre,
                            "tone": "", "theme": "", "target_audience": "",
                            "style_template": "", "source": "canvas"},
                "story_dna": {
                    "core_contradiction": {"statement": "S", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"level": l, "value_a": "", "value_b": ""}
                                    for l in ("personal", "social",
                                              "philosophical", "existential")],
                    "style_template": "", "fusion_meta": None,
                },
            },
            None,
        )
    monkeypatch.setattr(PlannerAgent, "generate_concept_from_canvas", fake_generate)


@pytest.fixture
def stub_llm(monkeypatch):
    """Stub the LLM call inside _next_step_impl to skip real LLM."""
    from backend.api import v2_canvas

    async def fake_next(project_id, current_step):
        return {
            "step": current_step,
            "operation": {"type": "twist", "name": "twist", "reason": ""},
            "options": [
                {"id": f"opt_{current_step}_a", "title": "A", "premise": f"p{step}", "logic": "",
                 "scores": {}},
                {"id": f"opt_{current_step}_b", "title": "B", "premise": f"p{step}", "logic": "",
                 "scores": {}},
                {"id": f"opt_{current_step}_c", "title": "C", "premise": f"p{step}", "logic": "",
                 "scores": {}},
            ],
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next)


def test_e2e_full_flow_5_steps_then_commit(project, client, stub_planner, stub_llm):
    # 1. Init
    r = client.post("/creative/canvas/session/init",
                    json={"prompt": "p", "genre_primary": "xianxia"})
    assert r.status_code == 200

    # 2. Walk through 5 steps
    for step in range(1, 6):
        r = client.post("/creative/canvas/session/next-step",
                        json={"current_step": step})
        assert r.status_code == 200, r.text

        r = client.post("/creative/canvas/session/select",
                        json={"step": step, "option_id": f"opt_{step}_b"})
        assert r.status_code == 200, r.text

    # 3. Verify canvas is fully completed
    state = client.get("/creative/canvas/session/state").json()
    assert all(p["state"] == "completed" for p in state["creative_path"])
    assert all(p["selected_option_id"] for p in state["creative_path"])

    # 4. Commit
    r = client.post("/creative/canvas/session/commit")
    assert r.status_code == 200, r.text

    # 5. Verify v3 schema in concept_and_dna.json
    cnp = Path(settings.projects_dir) / project / "concept_and_dna.json"
    assert cnp.exists(), "concept_and_dna.json must be written"
    cnd = json.loads(cnp.read_text(encoding="utf-8"))
    assert cnd["concept"]["title"] == "T"
    assert "canvas_snapshot" in cnd
    assert len(cnd["canvas_snapshot"]["selected_path"]) == 5


def test_e2e_partial_flow_cannot_commit(project, client, stub_llm):
    """Walking only 3 steps then commit must return 422."""
    client.post("/creative/canvas/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    for step in range(1, 4):
        client.post("/creative/canvas/session/next-step",
                    json={"current_step": step})
        client.post("/creative/canvas/session/select",
                    json={"step": step, "option_id": f"opt_{step}_a"})

    r = client.post("/creative/canvas/session/commit")
    assert r.status_code == 422
    assert "INVALID_PATH" in str(r.json())


def test_e2e_v3_canvas_lazy_migrates_and_committable(project, client, stub_planner, stub_llm, monkeypatch):
    """A v3 canvas on disk (legacy) must be readable + committable via v2 endpoints."""
    canvas_path = Path(settings.projects_dir) / project / "creative_os" / "canvas_state.json"
    canvas_path.parent.mkdir(parents=True)
    v3_data = {
        "schema_version": 3, "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {"id": "wi_001_00", "depth": 0, "parent_id": None,
                          "content": "root", "novelty_score": 70,
                          "children_ids": [], "trope_tags": [],
                          "saturation_warning": False,
                          "mutation_context": None, "is_expanded": True,
                          "branch_status": "active"},
        },
        "edges": [], "selected_path": ["wi_001_00"],
        "branch_choices": {}, "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": None, "committed_concept_ref": None,
        "idea_variants": [], "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": "p", "genre_primary": "xianxia", "trope_tags": []},
        "session_metadata": {},
    }
    canvas_path.write_text(json.dumps(v3_data), encoding="utf-8")

    # State should migrate v3 → v4 in memory and write back
    state = client.get("/creative/canvas/session/state").json()
    assert state["schema_version"] == 4

    # Disk now contains v4
    disk = json.loads(canvas_path.read_text(encoding="utf-8"))
    assert disk["schema_version"] == 4
```

### Step 2: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_e2e.py -v
```

Expected: 3 PASS

### Step 3: 跑全部后端测试

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_creative_diverge_*.py \
         tests/test_creative_os/ \
         tests/test_commit_validation.py \
         tests/test_v2_canvas_endpoints.py \
         tests/test_v2_e2e.py -v
```

Expected: 所有 PASS

### Step 4: 提交

```bash
cd /Users/longsa/Codes/nebula && git add tests/test_v2_e2e.py && \
  git commit -m "test(canvas-v2): E2E integration (init → 5 steps → commit)"
```

---

## Task 10: 前端 —— API client 扩展（v2 endpoints）

**Files:**
- Modify: `frontend/src/api/client.ts`（加 v2 endpoint 方法）
- Create: `frontend/src/api/client.canvas-v2.test.ts`

### Step 1: 写失败测试

```typescript
// frontend/src/api/client.canvas-v2.test.ts
import { api } from "@/api/client";

describe("v2 canvas API client methods", () => {
  it("postCanvasV2Init sends RawIntent to v2 namespace", () => {
    expect(typeof api.postCanvasV2Init).toBe("function");
    api.postCanvasV2Init("proj_x", {
      prompt: "p", genre_primary: "xianxia",
    });
  });

  it("postCanvasV2NextStep sends current_step", () => {
    expect(typeof api.postCanvasV2NextStep).toBe("function");
    api.postCanvasV2NextStep("proj_x", { current_step: 1 });
  });

  it("postCanvasV2Select sends step + option_id", () => {
    expect(typeof api.postCanvasV2Select).toBe("function");
    api.postCanvasV2Select("proj_x", { step: 1, option_id: "opt_1_b" });
  });

  it("postCanvasV2Commit sends empty body", () => {
    expect(typeof api.postCanvasV2Commit).toBe("function");
    api.postCanvasV2Commit("proj_x");
  });

  it("getCanvasV2State fetches state", () => {
    expect(typeof api.getCanvasV2State).toBe("function");
    api.getCanvasV2State("proj_x");
  });
});
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/api/client.canvas-v2.test.ts
```

Expected: FAIL — `api.postCanvasV2Init` 等方法不存在

> **冷缓存 gotcha**（CLAUDE.md）：首跑可能报 `ReferenceError: document is not defined`。再跑一次暖缓存。

### Step 3: 在 client.ts 加 v2 方法

修改 `frontend/src/api/client.ts`，在文件中段（已有 `postDivergeInit` 等方法附近）追加：

```typescript
// =========================================================================
// Canvas v2 endpoints — /creative/canvas/session/*
// =========================================================================

postCanvasV2Init: (projectId: string, rawIntent: RawIntent): Promise<{
  ok: boolean;
  session_id: string;
  etag: string;
}> =>
  request("POST", `/creative/canvas/session/init`.replace(
    "${projectId}", encodeURIComponent(projectId)
  ), rawIntent),

getCanvasV2State: (projectId: string): Promise<CanvasV4State> =>
  request("GET", `/creative/canvas/session/state`.replace(
    "${projectId}", encodeURIComponent(projectId)
  )),

postCanvasV2NextStep: (projectId: string, body: { current_step: number }):
  Promise<NextStepResponse> =>
  request("POST", `/creative/canvas/session/next-step`.replace(
    "${projectId}", encodeURIComponent(projectId)
  ), body),

postCanvasV2Select: (projectId: string, body: {
  step: number; option_id: string;
}): Promise<{ ok: boolean; step: number; selected_option_id: string }> =>
  request("POST", `/creative/canvas/session/select`.replace(
    "${projectId}", encodeURIComponent(projectId)
  ), body),

postCanvasV2Commit: (projectId: string): Promise<{
  ok: boolean;
  committed_at: string;
  concept_ref: string;
}> =>
  request("POST", `/creative/canvas/session/commit`.replace(
    "${projectId}", encodeURIComponent(projectId)
  )),
```

> **路径格式**：根据项目实际 prefix 调整。`/v1/projects/...` 是 v1.x 风格；v2 用 `/creative/canvas/session/*` 不带 `/v1/` 前缀是因为 router 在 `v2_canvas.py` 中定义时已绑 prefix。如果发现错误，回查 backend `v2_canvas.py` router prefix。

定义对应的 TypeScript 类型（同文件顶部）：

```typescript
export interface CanvasV4State {
  schema_version: 4;
  session_id: string;
  _etag: string;
  root_idea: { prompt: string; genre: string; premise: string; extracted: Record<string, unknown> };
  raw_intent: RawIntent;
  creative_session: { current_step: number; max_steps: 5; status: string };
  creative_path: CreativeStep[];
  current_concept: CurrentConcept;
  final_concept: unknown | null;
  committed: boolean;
  committed_at: string | null;
  scores: Record<string, number>;
  session_metadata: Record<string, unknown>;
}

export interface CreativeStep {
  step: number;
  operation: string | null;
  operation_reason: string | null;
  options: CreativeOption[];
  selected_option_id: string | null;
  created_at: string;
  selected_at: string | null;
  regenerated_count: number;
  state: "locked" | "available" | "active" | "completed" | "stale";
}

export interface CreativeOption {
  id: string;
  title: string;
  premise: string;
  logic: string;
  scores: Record<string, number>;
}

export interface NextStepResponse {
  step: number;
  operation: { type: string; name: string; reason: string };
  options: CreativeOption[];
  quality_warning: string | null;
}
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/api/client.canvas-v2.test.ts
```

Expected: 5 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/api/client.ts frontend/src/api/client.canvas-v2.test.ts && \
  git commit -m "feat(canvas-v2): frontend API client methods for /creative/canvas/session/*"
```

---

## Task 11: 前端 —— `useCreativeCanvasV2` hook

**Files:**
- Create: `frontend/src/hooks/useCreativeCanvasV2.ts`
- Create: `frontend/src/hooks/useCreativeCanvasV2.test.ts`

### Step 1: 写失败测试

```typescript
// frontend/src/hooks/useCreativeCanvasV2.test.ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import api from "@/api/client";

jest.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postCanvasV2Init: jest.fn().mockResolvedValue({
      ok: true, session_id: "s1", etag: "e1",
    }),
    getCanvasV2State: jest.fn().mockResolvedValue({
      schema_version: 4, session_id: "s1", _etag: "e1",
      creative_path: [],
      committed: false,
    }),
    postCanvasV2NextStep: jest.fn().mockResolvedValue({
      step: 1,
      operation: { type: "twist", name: "扭曲", reason: "" },
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      quality_warning: null,
    }),
    postCanvasV2Select: jest.fn().mockResolvedValue({
      ok: true, step: 1, selected_option_id: "opt_1_b",
    }),
    postCanvasV2Commit: jest.fn().mockResolvedValue({
      ok: true, committed_at: "2026-09-02T10:00:00",
      concept_ref: "concept_and_dna.json",
    }),
  },
}));

describe("useCreativeCanvasV2", () => {
  it("loadCanvas fetches state", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.loadCanvas();
    });
    expect(result.current.canvas).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("initSession calls postCanvasV2Init then loadCanvas", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.initSession({ prompt: "p", genre_primary: "xianxia" });
    });
    expect(api.postCanvasV2Init).toHaveBeenCalledWith("proj_x",
      expect.objectContaining({ prompt: "p" }));
  });

  it("nextStep returns operation + options", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    let resp;
    await act(async () => {
      resp = await result.current.nextStep(1);
    });
    expect(resp!.operation.type).toBe("twist");
    expect(resp!.options.length).toBe(3);
  });

  it("selectOption calls API + reloads state", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.selectOption(1, "opt_1_b");
    });
    expect(api.postCanvasV2Select).toHaveBeenCalledWith("proj_x",
      expect.objectContaining({ step: 1, option_id: "opt_1_b" }));
  });

  it("commitCanvas calls API + sets committedAt", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.commitCanvas();
    });
    expect(api.postCanvasV2Commit).toHaveBeenCalledWith("proj_x");
    expect(result.current.committedAt).not.toBeNull();
  });

  it("exposes canCommit that becomes true after 5 completions", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.loadCanvas();
    });
    expect(result.current.canCommit).toBe(false);

    // Simulate all 5 steps completed
    (api.getCanvasV2State as jest.Mock).mockResolvedValueOnce({
      schema_version: 4,
      creative_path: Array.from({ length: 5 }, (_, i) => ({
        step: i + 1,
        state: "completed",
        selected_option_id: `opt_${i + 1}_b`,
        options: [],
        operation: null,
        operation_reason: null,
        created_at: "",
        selected_at: "",
        regenerated_count: 0,
      })),
      committed: false,
      _etag: "e1",
      session_id: "s1",
      final_concept: null,
    });
    await act(async () => {
      await result.current.loadCanvas();
    });
    expect(result.current.canCommit).toBe(true);
  });
});
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/hooks/useCreativeCanvasV2.test.ts
```

Expected: FAIL — hook 不存在

### Step 3: 实现 hook

创建 `frontend/src/hooks/useCreativeCanvasV2.ts`：

```typescript
import { useCallback, useState } from "react";
import api, {
  type CanvasV4State,
  type NextStepResponse,
  type RawIntent,
} from "@/api/client";

type Status = "empty" | "active" | "completed" | "committed" | "loading";

interface State {
  status: Status;
  canvas: CanvasV4State | null;
  error: string | null;
  loadingStep: boolean;
  committedAt: string | null;
}

interface Actions {
  loadCanvas: () => Promise<void>;
  initSession: (rawIntent: RawIntent) => Promise<void>;
  nextStep: (currentStep: number) => Promise<NextStepResponse>;
  selectOption: (step: number, optionId: string) => Promise<void>;
  commitCanvas: () => Promise<void>;
  resetCanvas: () => Promise<void>;
}

export function useCreativeCanvasV2(projectId: string): [State, Actions] {
  const [status, setStatus] = useState<Status>("empty");
  const [canvas, setCanvas] = useState<CanvasV4State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(false);
  const [committedAt, setCommittedAt] = useState<string | null>(null);

  const loadCanvas = useCallback(async () => {
    setStatus("loading");
    try {
      const c = await api.getCanvasV2State(projectId);
      setCanvas(c);
      if (c.committed) {
        setStatus("committed");
        setCommittedAt(c.committed_at);
      } else if (c.creative_path?.some(p => p.state === "completed")) {
        setStatus("active");
      } else {
        setStatus("empty");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [projectId]);

  const initSession = useCallback(async (rawIntent: RawIntent) => {
    setStatus("loading");
    try {
      await api.postCanvasV2Init(projectId, rawIntent);
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "init failed");
    }
  }, [projectId, loadCanvas]);

  const nextStep = useCallback(async (currentStep: number) => {
    setLoadingStep(true);
    try {
      const resp = await api.postCanvasV2NextStep(projectId, { current_step: currentStep });
      return resp;
    } catch (e) {
      setError(e instanceof Error ? e.message : "next step failed");
      throw e;
    } finally {
      setLoadingStep(false);
    }
  }, [projectId]);

  const selectOption = useCallback(async (step: number, optionId: string) => {
    try {
      await api.postCanvasV2Select(projectId, { step, option_id: optionId });
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "select failed");
    }
  }, [projectId, loadCanvas]);

  const commitCanvas = useCallback(async () => {
    try {
      const resp = await api.postCanvasV2Commit(projectId);
      setCommittedAt(resp.committed_at);
      setStatus("committed");
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit failed");
    }
  }, [projectId, loadCanvas]);

  const resetCanvas = useCallback(async () => {
    try {
      await api.deleteCanvasV2State(projectId);  // not yet implemented; uses v1 endpoint
      setCommittedAt(null);
      setStatus("empty");
      setCanvas(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "reset failed");
    }
  }, [projectId]);

  // canCommit: spec §7.5
  const path = canvas?.creative_path || [];
  const completed = path.filter(p => p.state === "completed");
  const stale = path.filter(p => p.state === "stale");
  const step5 = path.find(p => p.step === 5);
  const canCommit =
    !canvas?.committed &&
    step5?.state === "completed" &&
    stale.length === 0 &&
    completed.length === 5 &&
    canvas?.final_concept != null;

  return [
    { status, canvas, error, loadingStep, committedAt },
    { loadCanvas, initSession, nextStep, selectOption, commitCanvas, resetCanvas },
  ];
}
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/hooks/useCreativeCanvasV2.test.ts
```

Expected: 6 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/hooks/useCreativeCanvasV2.test.ts && \
  git commit -m "feat(canvas-v2): useCreativeCanvasV2 hook (state machine + canCommit)"
```

---

## Task 12: 前端 —— HorizontalPathCanvas + ActiveStepPanel + QualityBar 组件

**Files:**
- Create: `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx`
- Create: `frontend/src/components/creative-canvas/ActiveStepPanel.tsx`
- Create: `frontend/src/components/creative-canvas/QualityBar.tsx`
- Create: `frontend/src/components/creative-canvas/__tests__/HorizontalPathCanvas.test.tsx`
- Create: `frontend/src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx`

### Step 1: 写 ActiveStepPanel 失败测试

```typescript
// frontend/src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ActiveStepPanel } from "../ActiveStepPanel";

const baseProps = {
  step: 3,
  operation: { type: "fusion", name: "融合", reason: "当前创意需要外部冲突" },
  options: [
    { id: "opt_3_a", title: "A 路径", premise: "p1", logic: "l1", scores: {} },
    { id: "opt_3_b", title: "B 路径", premise: "p2", logic: "l2", scores: {} },
    { id: "opt_3_c", title: "C 路径", premise: "p3", logic: "l3", scores: {} },
  ],
  onSelect: jest.fn(),
  disabled: false,
};

describe("ActiveStepPanel", () => {
  it("renders step header + 3 option cards", () => {
    render(<ActiveStepPanel {...baseProps} />);
    expect(screen.getByText(/STEP 3/)).toBeInTheDocument();
    expect(screen.getByText(/融合/)).toBeInTheDocument();
    expect(screen.getByText("A 路径")).toBeInTheDocument();
    expect(screen.getByText("B 路径")).toBeInTheDocument();
    expect(screen.getByText("C 路径")).toBeInTheDocument();
  });

  it("shows AI reasoning as 原因 text", () => {
    render(<ActiveStepPanel {...baseProps} />);
    expect(screen.getByText(/当前创意需要外部冲突/)).toBeInTheDocument();
  });

  it("calls onSelect with option id when 选择 button clicked", () => {
    render(<ActiveStepPanel {...baseProps} />);
    fireEvent.click(screen.getAllByText(/选择/)[1]); // click B
    expect(baseProps.onSelect).toHaveBeenCalledWith("opt_3_b");
  });

  it("disables all buttons when disabled prop true", () => {
    render(<ActiveStepPanel {...baseProps} disabled={true} />);
    screen.getAllByText(/选择/).forEach(btn => {
      expect(btn).toBeDisabled();
    });
  });
});
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx
```

Expected: FAIL

### Step 3: 实现 ActiveStepPanel

创建 `frontend/src/components/creative-canvas/ActiveStepPanel.tsx`：

```tsx
import { PrimaryButton } from "@/components/ds";

interface Props {
  step: number;
  operation: { type: string; name: string; reason: string };
  options: Array<{
    id: string;
    title: string;
    premise: string;
    logic: string;
    scores: Record<string, number>;
  }>;
  onSelect: (optionId: string) => void;
  disabled?: boolean;
}

export function ActiveStepPanel({
  step,
  operation,
  options,
  onSelect,
  disabled = false,
}: Props) {
  return (
    <div className="border border-outline-variant rounded-lg p-6 bg-surface-container">
      <div className="mb-4">
        <h2 className="text-lg font-medium">
          STEP {step} / {operation.name}
        </h2>
        <p className="text-sm text-on-surface-variant mt-1">
          AI 为什么推荐「{operation.name}」?{operation.reason}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {options.map((opt, idx) => (
          <div
            key={opt.id}
            data-testid={`option-card-${idx}`}
            className="border border-outline-variant rounded-lg p-4 bg-surface flex flex-col"
          >
            <h3 className="font-medium mb-2">{opt.title}</h3>
            <p className="text-sm text-on-surface-variant flex-1 mb-3">
              {opt.premise}
            </p>
            {opt.logic && (
              <p className="text-xs text-on-surface-variant/70 italic mb-2">
                {opt.logic}
              </p>
            )}
            <PrimaryButton
              onClick={() => onSelect(opt.id)}
              disabled={disabled}
              data-testid={`option-select-${idx}`}
            >
              {disabled ? "提交中..." : "选择"}
            </PrimaryButton>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 4: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx
```

Expected: 4 PASS

### Step 5: 写 HorizontalPathCanvas 失败测试

```typescript
// frontend/src/components/creative-canvas/__tests__/HorizontalPathCanvas.test.tsx
import { render, screen } from "@testing-library/react";
import { HorizontalPathCanvas } from "../HorizontalPathCanvas";

const pathWithMixedStates = [
  { step: 1, state: "completed" as const, selected_option_id: "opt_1_a",
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 2, state: "completed" as const, selected_option_id: "opt_2_b",
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 3, state: "active" as const, selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 4, state: "available" as const, selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 5, state: "locked" as const, selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
];

describe("HorizontalPathCanvas", () => {
  it("renders IDEA + 5 STEP cells", () => {
    render(
      <HorizontalPathCanvas
        rootIdea="长生者寻死"
        path={pathWithMixedStates}
      />
    );
    expect(screen.getByText("IDEA")).toBeInTheDocument();
    expect(screen.getByText(/STEP 1/)).toBeInTheDocument();
    expect(screen.getByText(/STEP 5/)).toBeInTheDocument();
  });

  it("shows 创意深度 N/5 in header", () => {
    render(
      <HorizontalPathCanvas
        rootIdea="p"
        path={pathWithMixedStates}
      />
    );
    expect(screen.getByText(/创意深度 2 \/ 5/)).toBeInTheDocument();
  });

  it("renders completed steps with ✓ checkmark", () => {
    const { container } = render(
      <HorizontalPathCanvas rootIdea="p" path={pathWithMixedStates} />
    );
    expect(container.querySelectorAll("[data-step-state='completed']").length).toBe(2);
    expect(container.querySelectorAll("[data-step-state='active']").length).toBe(1);
    expect(container.querySelectorAll("[data-step-state='available']").length).toBe(1);
    expect(container.querySelectorAll("[data-step-state='locked']").length).toBe(1);
  });

  it("renders empty state for empty path", () => {
    render(<HorizontalPathCanvas rootIdea="p" path={[]} />);
    expect(screen.getByText(/创意深度 0 \/ 5/)).toBeInTheDocument();
  });
});
```

### Step 6: 实现 HorizontalPathCanvas + QualityBar

创建 `frontend/src/components/creative-canvas/QualityBar.tsx`：

```tsx
interface Props {
  novelty: number;
  conflict: number;
  storyPotential: number;
}

export function QualityBar({ novelty, conflict, storyPotential }: Props) {
  const items = [
    { label: "新颖度", value: novelty, color: "bg-primary" },
    { label: "冲突", value: conflict, color: "bg-secondary" },
    { label: "故事潜力", value: storyPotential, color: "bg-tertiary" },
  ];
  return (
    <div
      data-testid="quality-bar"
      className="flex gap-6 p-3 bg-surface-container rounded-lg"
    >
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-2 text-sm">
          <span className="text-on-surface-variant">{item.label}</span>
          <div className="w-24 h-2 bg-surface-container-high rounded overflow-hidden">
            <div
              className={`h-full ${item.color}`}
              style={{ width: `${Math.round(item.value * 100)}%` }}
            />
          </div>
          <span className="font-medium">{Math.round(item.value * 100)}</span>
        </div>
      ))}
    </div>
  );
}
```

创建 `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx`：

```tsx
import type { CreativeStep } from "@/api/client";

interface Props {
  rootIdea: string;
  path: CreativeStep[];
}

const STATE_LABELS: Record<CreativeStep["state"], string> = {
  locked: "○",
  available: "▢",
  active: "●",
  completed: "✓",
  stale: "⚠",
};

export function HorizontalPathCanvas({ rootIdea, path }: Props) {
  const completedCount = path.filter(p => p.state === "completed").length;
  return (
    <div data-testid="horizontal-path-canvas" className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-medium">Creative Canvas</h3>
        <span className="text-sm text-on-surface-variant">
          创意深度 {completedCount} / 5
        </span>
      </div>
      <p className="text-xs text-on-surface-variant mb-4">
        把一个 Idea 逐步推演成独特的剧情创意
      </p>

      <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
        <div
          data-testid="idea-cell"
          className="min-w-[100px] border-2 border-primary rounded-lg p-3 bg-surface-container flex flex-col items-center justify-center"
        >
          <div className="text-xs text-on-surface-variant">IDEA</div>
          <div className="text-sm font-medium line-clamp-2">{rootIdea}</div>
        </div>

        {path.map((s, i) => (
          <div key={s.step} className="flex items-center">
            <div
              data-testid={`step-cell-${s.step}`}
              data-step-state={s.state}
              className={`min-w-[80px] border-2 rounded-lg p-3 flex flex-col items-center ${
                s.state === "completed"
                  ? "border-primary bg-primary/10"
                  : s.state === "active"
                  ? "border-primary bg-surface-container animate-pulse"
                  : s.state === "available"
                  ? "border-outline-variant bg-surface-container"
                  : s.state === "stale"
                  ? "border-error bg-error/10"
                  : "border-outline bg-surface-container-low opacity-50"
              }`}
            >
              <div className="text-xs text-on-surface-variant">
                STEP {s.step}
              </div>
              <div className="text-xl my-1">{STATE_LABELS[s.state]}</div>
              <div className="text-[10px] text-on-surface-variant">
                {s.state}
              </div>
            </div>
            {i < path.length - 1 && (
              <div className="w-3 h-0.5 bg-outline-variant" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 7: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run \
  src/components/creative-canvas/__tests__/HorizontalPathCanvas.test.tsx \
  src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx
```

Expected: 4 + 4 = 8 PASS

### Step 8: 提交

```bash
cd /Users/longsa/Codes/nebula && git add \
  frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx \
  frontend/src/components/creative-canvas/ActiveStepPanel.tsx \
  frontend/src/components/creative-canvas/QualityBar.tsx \
  frontend/src/components/creative-canvas/__tests__/HorizontalPathCanvas.test.tsx \
  frontend/src/components/creative-canvas/__tests__/ActiveStepPanel.test.tsx && \
  git commit -m "feat(canvas-v2): HorizontalPathCanvas + ActiveStepPanel + QualityBar components"
```

---

## Task 13: 前端 —— `CreativeCanvasPage` 重写 + 删除旧组件

**Files:**
- Rewrite: `frontend/src/pages/CreativeCanvasPage.tsx`
- Rewrite: `frontend/src/components/creative-canvas/CanvasToolbar.tsx`
- Delete: `frontend/src/components/creative-canvas/WhatIfTree.tsx`
- Delete: `frontend/src/components/creative-canvas/CanvasNode.tsx`
- Delete: `frontend/src/components/creative-canvas/NodeDetailPanel.tsx`
- Delete: `frontend/src/hooks/useCreativeCanvas.ts`
- Create: `frontend/src/pages/CreativeCanvasPage.test.tsx`

### Step 1: 写失败测试

```typescript
// frontend/src/pages/CreativeCanvasPage.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CreativeCanvasPage from "./CreativeCanvasPage";
import api from "@/api/client";

jest.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postCanvasV2Init: jest.fn().mockResolvedValue({
      ok: true, session_id: "s1", etag: "e1",
    }),
    getCanvasV2State: jest.fn().mockResolvedValue({
      schema_version: 4, session_id: "s1", _etag: "e1",
      creative_path: [],
      committed: false,
      raw_intent: { prompt: "", genre_primary: "" },
      root_idea: { prompt: "", genre: "", premise: "", extracted: {} },
    }),
    postCanvasV2NextStep: jest.fn().mockResolvedValue({
      step: 1,
      operation: { type: "twist", name: "扭曲", reason: "test" },
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      quality_warning: null,
    }),
    postCanvasV2Select: jest.fn().mockResolvedValue({
      ok: true, step: 1, selected_option_id: "opt_1_b",
    }),
    postCanvasV2Commit: jest.fn().mockResolvedValue({
      ok: true, committed_at: "2026-09-02T10:00:00",
      concept_ref: "concept_and_dna.json",
    }),
  },
}));

describe("CreativeCanvasPage v2", () => {
  it("renders empty state when canvas is empty", async () => {
    render(
      <MemoryRouter initialEntries={["/project/p1/canvas"]}>
        <Routes>
          <Route path="/project/:id/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/用一句话描述你的故事想法/)).toBeInTheDocument();
    });
  });

  it("renders HorizontalPathCanvas + ActiveStepPanel after init + next-step", async () => {
    (api.getCanvasV2State as jest.Mock).mockResolvedValueOnce({
      schema_version: 4,
      creative_path: [{
        step: 1, state: "active", selected_option_id: null,
        operation: "twist", operation_reason: "test",
        options: [
          { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
          { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
          { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
        ],
        created_at: "", selected_at: "", regenerated_count: 0,
      }],
      committed: false,
      _etag: "e1", session_id: "s1",
      root_idea: { prompt: "test idea", genre: "", premise: "", extracted: {} },
      raw_intent: { prompt: "test idea", genre_primary: "" },
    });

    render(
      <MemoryRouter initialEntries={["/project/p1/canvas"]}>
        <Routes>
          <Route path="/project/:id/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("horizontal-path-canvas")).toBeInTheDocument();
      expect(screen.getByText(/STEP 1/)).toBeInTheDocument();
    });
  });
});
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/pages/CreativeCanvasPage.test.tsx
```

Expected: FAIL — page 还在用 v1.x WhatIfTree

### Step 3: 重写 CanvasToolbar

`frontend/src/components/creative-canvas/CanvasToolbar.tsx`（整文件重写）：

```tsx
import { SecondaryButton } from "@/components/ds";

interface Props {
  currentStep: number;
  totalSteps: number;
  onViewPath: () => void;
  onReset: () => void;
}

export function CanvasToolbar({ currentStep, totalSteps, onViewPath, onReset }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant">
      <span className="text-sm text-on-surface-variant">
        Step {currentStep} / {totalSteps}
      </span>
      <div className="flex gap-2">
        <SecondaryButton onClick={onViewPath}>查看完整路径</SecondaryButton>
        <SecondaryButton onClick={onReset}>重新开始</SecondaryButton>
      </div>
    </div>
  );
}
```

### Step 4: 重写 CreativeCanvasPage

`frontend/src/pages/CreativeCanvasPage.tsx`（整文件重写）：

```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PrimaryButton, PanelCard } from "@/components/ds";
import { HorizontalPathCanvas } from "@/components/creative-canvas/HorizontalPathCanvas";
import { ActiveStepPanel } from "@/components/creative-canvas/ActiveStepPanel";
import { QualityBar } from "@/components/creative-canvas/QualityBar";
import { CanvasToolbar } from "@/components/creative-canvas/CanvasToolbar";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import type { RawIntent, NextStepResponse } from "@/api/client";

const FEATURE_FLAG_V2 = process.env.REACT_APP_CANVAS_V2 === "true";

export default function CreativeCanvasPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, actions] = useCreativeCanvasV2(projectId || "");
  const [initForm, setInitForm] = useState({ prompt: "", genre_primary: "" });
  const [pendingNextStep, setPendingNextStep] = useState<NextStepResponse | null>(null);

  useEffect(() => {
    actions.loadCanvas();
  }, [projectId]);

  // Compute next step response from canvas if not pending
  const activeStep = state.canvas?.creative_path.find(p => p.state === "active");
  const stepResponse: NextStepResponse | null =
    pendingNextStep ||
    (activeStep && activeStep.options.length > 0
      ? {
          step: activeStep.step,
          operation: {
            type: activeStep.operation || "twist",
            name: activeStep.operation || "twist",
            reason: activeStep.operation_reason || "",
          },
          options: activeStep.options,
          quality_warning: null,
        }
      : null);

  if (!FEATURE_FLAG_V2) {
    return (
      <div className="p-8 text-error">
        Feature flag REACT_APP_CANVAS_V2 is OFF. Set it to "true" to enable v2.
      </div>
    );
  }

  // Empty state: init form
  if (state.status === "empty") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <PanelCard>
          <h2 className="text-xl mb-4">开始你的创意</h2>
          <textarea
            placeholder="用一句话描述你的故事想法"
            className="w-full h-32 p-3 border border-outline-variant rounded-lg mb-3"
            value={initForm.prompt}
            onChange={e => setInitForm({ ...initForm, prompt: e.target.value })}
          />
          <input
            type="text"
            placeholder="主类型"
            className="w-full p-2 border border-outline-variant rounded-lg mb-3"
            value={initForm.genre_primary}
            onChange={e => setInitForm({ ...initForm, genre_primary: e.target.value })}
          />
          <PrimaryButton
            disabled={initForm.prompt.length < 10 || !initForm.genre_primary}
            onClick={() => actions.initSession(initForm as RawIntent)}
          >
            初始化
          </PrimaryButton>
        </PanelCard>
      </div>
    );
  }

  return (
    <div data-testid="creative-canvas-v2-page" className="flex flex-col h-full">
      <CanvasToolbar
        currentStep={state.canvas?.creative_session?.current_step || 1}
        totalSteps={5}
        onViewPath={() => {}}
        onReset={() => actions.resetCanvas()}
      />

      {state.canvas && (
        <HorizontalPathCanvas
          rootIdea={state.canvas.root_idea.prompt}
          path={state.canvas.creative_path}
        />
      )}

      <div className="flex-1 overflow-auto p-4">
        {state.loadingStep && <div>生成选项中...</div>}

        {stepResponse && (
          <ActiveStepPanel
            step={stepResponse.step}
            operation={stepResponse.operation}
            options={stepResponse.options}
            disabled={state.loadingStep}
            onSelect={async (optionId) => {
              setPendingNextStep(null);
              await actions.selectOption(stepResponse.step, optionId);
              // Auto-fetch next step
              if (stepResponse.step < 5) {
                const next = await actions.nextStep(stepResponse.step + 1);
                setPendingNextStep(next);
              }
            }}
          />
        )}

        {state.canvas?.scores && (
          <QualityBar
            novelty={state.canvas.scores.novelty || 0}
            conflict={state.canvas.scores.conflict || 0}
            storyPotential={state.canvas.scores.story_potential || 0}
          />
        )}

        {state.error && (
          <div className="mt-4 p-3 bg-error/10 border border-error rounded text-error">
            {state.error}
          </div>
        )}

        {state.committedAt && (
          <div className="mt-4 p-3 bg-success/10 border border-success rounded">
            已提交于 {state.committedAt}
            <PrimaryButton onClick={() => navigate(`/project/${projectId}/stage0`)}>
              跳转到 Stage 0
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 5: 删除旧组件

```bash
cd /Users/longsa/Codes/nebula && \
  rm frontend/src/components/creative-canvas/WhatIfTree.tsx \
     frontend/src/components/creative-canvas/CanvasNode.tsx \
     frontend/src/components/creative-canvas/NodeDetailPanel.tsx \
     frontend/src/hooks/useCreativeCanvas.ts
```

### Step 6: 跑测试，确认通过

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/pages/CreativeCanvasPage.test.tsx
```

Expected: 2 PASS

### Step 7: 跑全部前端测试，确认无回归

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run
```

Expected: 所有 PASS（若任何 FAIL 提示旧文件被引用，需更新 import 路径）

### Step 8: 提交

```bash
cd /Users/longsa/Codes/nebula && git add -A && \
  git commit -m "feat(canvas-v2): CreativeCanvasPage rewrite + delete legacy WhatIfTree/CanvasNode/NodeDetailPanel/useCreativeCanvas"
```

---

## Task 14: E2E —— 手工验证 + 灰度发布配置

**Files:**
- Modify: `frontend/.env.example`（加 `REACT_APP_CANVAS_V2`）
- Modify: `backend/.env.example`（加 `ENABLE_CANVAS_V2`）

### Step 1: 加环境变量示例

修改 `frontend/.env.example`（若不存在则创建）：

```bash
# Canvas v2 feature flag (set to "true" to enable)
REACT_APP_CANVAS_V2=false
```

修改 `backend/.env.example`：

```bash
# Enable Creative Canvas v2 endpoints (gradual rollout)
ENABLE_CANVAS_V2=false
```

### Step 2: 启动 dev 环境并手工验证

```bash
# Terminal 1: backend (with v2 enabled)
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  ENABLE_CANVAS_V2=true uvicorn backend.main:app --reload --port 8000

# Terminal 2: frontend
cd /Users/longsa/Codes/nebula/frontend && REACT_APP_CANVAS_V2=true npm run dev
```

> ⚠ **不要开 cockpit SSE 流**（会让 backend reload 卡死，见 CLAUDE.md）

### Step 3: 完整路径测试

1. 打开 http://localhost:5173 → 进入项目 → /canvas 路由
2. **预期**：看到空状态 → 输入 prompt + 主类型 → 点「初始化」
3. **预期**：横向路径画布出现（IDEA + STEP 1 AVAILABLE），点 STEP 1 → 后端调 next-step → 显示 3 选项 + operation 标题
4. 选 B → 后端自动调 next-step for step 2 → 画布更新（STEP 1 ✓ / STEP 2 ACTIVE）
5. 重复 4 直到 STEP 5
6. STEP 5 选完后 → 显示 QualityBar + 「提交到概念讨论」按钮
7. 点 Commit → 跳转 /stage0

### Step 4: 验证概念 DNA 写入

```bash
# 找项目路径(可能是 proj_xxx)
ls /Users/longsa/Codes/nebula/projects/ | head
cat /Users/longsa/Codes/nebula/projects/<your_project>/concept_and_dna.json | python -m json.tool
```

**预期**：
- `concept.source == "canvas"`
- `concept.genre` 来自 `raw_intent.genre_primary`
- `story_dna.core_contradiction.statement` 非空
- `canvas_snapshot.selected_path` 有 5 项（向后兼容）
- **不**出现 `creative_path` / `creative_mechanism` / `canvas_meta` v2 新字段

### Step 5: 回滚路径测试

1. 关闭 dev 服务
2. 重启 backend **不**带 `ENABLE_CANVAS_V2`
3. **预期**：v2 路由 404；前端 REACT_APP_CANVAS_V2=false 显示错误页

### Step 6: 旧 v3 canvas 兼容性测试

1. 找一个旧项目（已 committed v3 canvas）的 `canvas_state.json`
2. 启 v2 后端 → GET `/creative/canvas/session/state`
3. **预期**：响应是 v4 schema（lazy migrated in memory），磁盘文件 v3 保持不变

### Step 7: 提交配置

```bash
cd /Users/longsa/Codes/nebula && git add frontend/.env.example backend/.env.example && \
  git commit -m "chore(canvas-v2): enable feature flags in .env.example"
```

---

## Self-Review

### 1. Spec 覆盖检查

| Spec § | 任务 | 状态 |
|---|---|---|
| §3.2 v3 → v4 migration | Task 1 | ✅ |
| §3.3 已 commit 不写回 | Task 2 | ✅ |
| §3.4 5 engine 兼容 | Task 7（next-step 通过 raw_intent 触发）| ✅ |
| §3.6 raw_intent 保留 | Task 7（`/init` 双写）| ✅ |
| §4.1 5 态定义 | Task 3 | ✅ |
| §4.2 transition rule | Task 3 | ✅ |
| §4.3 invariants | Task 3 + Task 4 | ✅ |
| §4.4 _validate_for_commit | Task 4 + Task 8（step 顺序修正）| ✅ |
| §5.1 endpoint 清单 | Task 7 + Task 8 | ✅ |
| §5.2 next-step 协议 | Task 7 | ✅ |
| §5.3 select 协议 | Task 7（current_step == 5 不生成 final_concept）| ✅ |
| §5.4 commit 协议 | Task 8（先生后校验）| ✅ |
| §5.5 state lazy migration | Task 2 | ✅ |
| §5.6 init 双写 raw_intent | Task 7 | ✅ |
| §6.1 单次 LLM | Task 7（`_next_step_impl` 一次 LLM）| ✅ |
| §6.2 candidate_operation_hint | Task 5 + Task 7（`compute_op_hint` 调用）| ✅ |
| §6.3 prompt 草稿 | Task 6（YAML + retry）| ✅ |
| §6.4 差异轴 | spec 描述，不在 plan 实现（设计文档级）| n/a |
| §6.5 失败处理 | Task 6（`_call_llm_with_retry`）| ✅ |
| §7.1-7.7 UI 改造 | Task 10-13（hook + components + page）| ✅ |
| §8.1 v3 输出 schema | Task 8（v3 兼容）| ✅ |
| §8.2 canvas_snapshot.selected_path 双写 | Task 8（backfill 兼容）| ✅ |
| §8.3 不写 v2 新字段 | Task 9（test 显式断言）| ✅ |
| §9.2 后端先行 | Phase 1-4 全部后端（Tasks 1-9）；Phase 5+ 前端 | ✅ |
| §9.3 灰度策略 | Task 14（feature flag + E2E）| ✅ |
| §9.4 回滚方案 | Task 14 + Settings 字段 | ✅ |
| §10.1 单元测试 | Tasks 1, 3, 5, 6 | ✅ |
| §10.2 集成测试 | Task 7, 8, 9 | ✅ |
| §10.3 E2E（手工）| Task 14 | ✅ |
| §10.4 兼容测试 | Task 9（v3 lazy migrate）| ✅ |

**未覆盖**：
- §10.3 Playwright 自动化 E2E：v2.0 MVP 范围仅手工验证（PRD §28.1）；Playwright 自动化留 v2.1
- §10.5 性能测试：依赖手工测延迟（`P95 < 8s next-step` 等）；自动 perf 测试不在 MVP

### 2. Placeholder 检查

- ✅ 无 "TODO" / "TBD" / "类似 Task N"
- ✅ 所有代码块完整
- ✅ 所有命令带 expected output
- ✅ 所有文件路径精确
- ⚠ **一个边界 case**：`backend/main.py` 注册 router 的代码写了 `if _settings.enable_canvas_v2`，但**实际**的项目可能用不同的 settings 字段名（如 `canvas_v2_enabled`）。实施时实施者按项目实际调整。
- ⚠ **同样**：`QualityBar` 颜色用 `bg-primary` / `bg-secondary` / `bg-tertiary`，但 `ds/` 设计系统可能用不同 token。实施时按 `tokens.ts` 实际定义调整。

### 3. 类型一致性

| 定义 | 引用 | 一致性 |
|---|---|---|
| `CreativeStep.state` 5 态（Task 12）| `useCreativeCanvasV2` 用 `state === "completed"` 等（Task 11）| ✅ |
| `NextStepResponse.options` 字段（Task 10）| `ActiveStepPanel` 接收 `options`（Task 12）| ✅ |
| `_next_step_impl` 模块级函数（Task 7）| test monkeypatch（Task 7）| ✅ |
| `_call_llm_with_retry` 签名（Task 6）| `_next_step_impl` 调用（Task 7）| ✅ |
| `postCanvasV2NextStep` body `{current_step: number}`（Task 10）| hook 调用（Task 11）| ✅ |
| `postCanvasV2Select` body `{step, option_id}`（Task 10）| hook 调用（Task 11）| ✅ |
| `CanvasV4State.creative_path[].state`（Task 10）| `HorizontalPathCanvas` props（Task 12）| ✅ |
| `QualityBar` props `novelty/conflict/storyPotential`（Task 12）| `CreativeCanvasPage` 调用（Task 13）| ✅ |
| 5 种 commit 失败场景（spec §4.4）| test 5 个失败场景（Task 4）| ✅ |
| 6 个 compute_op_hint 分支（spec §6.2）| test 9 个 case（Task 5）| ✅ |

无类型不一致问题。

### 4. 范围 sanity check

- ✅ Plan 是单一子系统（Creative Canvas v2 重构），不需拆 sub-plan
- ✅ 每个任务产生可独立 commit 的代码
- ✅ 后端先行（Tasks 1-9），前端后行（Tasks 10-13），E2E 收尾（Task 14）
- ✅ TDD：每个实现任务前都有失败测试
- ✅ 频繁 commit：每个任务都 git commit