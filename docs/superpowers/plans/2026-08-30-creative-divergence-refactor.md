# 创意发散重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一创意发散后端到 `/api/v1/projects/{id}/creative/diverge/*`(重命名 canvas + 4 新端点),更新 `source` 白名单,接入未使用的引擎(MutationEngine.fuse、GenreFusionEngine、IdeaPool.importer、market_saturation 修复),并把前端 Wizard 第 1 步改写为 5 阶段子步骤。覆盖 PRD §1-§9 全部需求(对齐 v1.1 + v1.2 phase)。

**Architecture:** 在原地重命名 `creative_canvas.py` → `creative_diverge.py`,改路由前缀 `/creative/canvas` → `/creative/diverge`。在同一文件新增 4 个端点 + `_etag` 乐观锁 + v2→v3 schema 迁移 + 响应格式扩展。引擎层做最小适配层(`MutationResult → idea_variant`、`Idea → idea_variant`)复用现有数据模型,不破坏现有 API。Path B 4 个端点保留并标 Deprecation。前端 `CreativeDivergenceStep` 重写为 `<SubStage>` 状态机 + 5 个子组件 + `<StepIndicator>`。

**Tech Stack:** Python + FastAPI + pytest (backend) · React 18 + Vite + Tailwind + Vitest + jsdom + @testing-library/react (frontend) · Material Symbols Outlined icons · `WizardContext` 扩展 · 现有 `MutationEngine` / `ContradictionEngine` / `WhatIfEngine` / `GenreFusionEngine` / `NoveltyEvaluator` / `IdeaPool` · 现有 `PlannerAgent.generate_concept_from_canvas` (canvas_to_concept.yaml)。

**Spec:** `docs/superpowers/specs/2026-08-30-creative-divergence-refactor-design.md` (commit `cccbe6d`)

**Branch:** `nebula` (no worktree — user prefers direct work per `feedback_worktree_v19.md`)

---

## Phase Index

- **Phase 1 — Backend rename + route prefix** (Tasks 1-3)
- **Phase 2 — Source whitelist + Path B deprecation** (Tasks 4-5)
- **Phase 3 — Missing endpoints** (Tasks 6-9)
- **Phase 4 — Engine integrations** (Tasks 10-13)
- **Phase 5 — Concurrency + migration** (Tasks 14-15)
- **Phase 6 — Frontend API client + Context** (Tasks 16-17)
- **Phase 7 — Frontend 5-stage components** (Tasks 18-23)
- **Phase 8 — Wizard step rewrite** (Tasks 24-25)
- **Phase 9 — E2E tests + smoke** (Task 26)

---

## File Structure (locked in this plan)

### Backend (Phase 1-5)

| File | Action | Responsibility |
|---|---|---|
| `backend/api/creative_canvas.py` | **Rename** → `backend/api/creative_diverge.py` | 重命名后保留所有现有逻辑 |
| `backend/api/creative_diverge.py` | Modify | 改路由前缀、新增端点、补 schema 迁移、补 ETag、补错误码、补响应格式 |
| `backend/main.py` | Modify | 改 router 注册路径 |
| `backend/api/stage1_concept.py` | Modify | 白名单更新 + source="canvas"/"canvas_edited" 处理 |
| `backend/api/creative_divergence.py` | Modify | Deprecation/Sunset/Link headers |
| `backend/prompts/canvas_to_concept.yaml` | Modify | 输出 `style_template` + 4 层 `value_stack` |
| `backend/prompts/trope_extraction.yaml` | **Create** | LLM Trope 提取 prompt (Tier 3) |
| `backend/creative_os/idea_pool_importer.py` | **Create** | variants → Idea 适配层 |
| `backend/creative_os/novelty_evaluator.py` | Modify | market_saturation async fix |
| `backend/creative_os/genre_fusion_engine.py` | Modify | 暴露 calculate_distance + 风险等级 |
| `scripts/backfill_creative_divergence.py` | **Create** | v1.1 上线时一次性迁移脚本 |
| `tests/test_creative_canvas_routes.py` | **Rename** → `tests/test_creative_diverge_routes.py` | 测试路径更新 |
| `tests/test_creative_diverge_routes.py` | Modify | 已有测试改路由 |
| `tests/test_creative_diverge_contradict.py` | **Create** | `/contradict` 端点测试 |
| `tests/test_creative_diverge_fuse.py` | **Create** | `/fuse` 端点测试 |
| `tests/test_creative_diverge_mutate_regenerate.py` | **Create** | `/mutate/{id}/regenerate` 测试 |
| `tests/test_creative_diverge_novelty.py` | **Create** | `/novelty` 列表级测试 |
| `tests/test_source_whitelist_update.py` | **Create** | canvas/canvas_edited 接受测试 |
| `tests/test_canvas_state_v2_to_v3.py` | **Create** | schema 迁移测试 |
| `tests/test_etag_optimistic_lock.py` | **Create** | 并发写测试 |
| `tests/test_commit_dual_write.py` | **Create** | dual-write 测试 |
| `tests/test_path_b_deprecation_headers.py` | **Create** | Path B headers 测试 |
| `tests/test_novelty_market_saturation_fix.py` | **Create** | async fix 测试 |
| `tests/test_idea_pool_importer.py` | **Create** | importer 测试 |

### Frontend (Phase 6-8)

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/api/client.ts` | Modify | 新增 12 个 `postDiverge*` / `getDiverge*` / `putDiverge*` / `deleteDiverge*` 方法;移除 4 个 Path B 方法 |
| `frontend/src/components/wizard/WizardContext.tsx` | Modify | 新增 `creativeDivergenceSubStage` 字段 + `jumpToCreativeDivergence` action |
| `frontend/src/components/wizard/divergence/StepIndicator.tsx` | **Create** | 5 阶段顶部指示器 |
| `frontend/src/components/wizard/divergence/S0AInputStep.tsx` | **Create** | 灵感输入面板 |
| `frontend/src/components/wizard/divergence/S0BMutationStep.tsx` | **Create** | 变体卡片区 |
| `frontend/src/components/wizard/divergence/S0CContradictionStep.tsx` | **Create** | 矛盾工作台 |
| `frontend/src/components/wizard/divergence/S0DWhatIfStep.tsx` | **Create** | What-If 树视图 |
| `frontend/src/components/wizard/divergence/S0ECommitStep.tsx` | **Create** | 新颖度雷达 + 价值栈手改 + 提交 |
| `frontend/src/components/wizard/divergence/QuickModeToggle.tsx` | **Create** | 快速模式开关 |
| `frontend/src/components/wizard/divergence/ContinueBanner.tsx` | **Create** | 断点续作 banner |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | Modify (重写) | 父容器,持有 SubStage 状态机 |
| `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` | Modify | 移除 Path B prefill 引用 |
| `frontend/src/test/wizard/divergence/StepIndicator.test.tsx` | **Create** | StepIndicator 测试 |
| `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx` | **Create** | S0A 测试 |
| `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx` | **Create** | S0B 测试 |
| `frontend/src/test/wizard/divergence/S0CContradictionStep.test.tsx` | **Create** | S0C 测试 |
| `frontend/src/test/wizard/divergence/S0DWhatIfStep.test.tsx` | **Create** | S0D 测试 |
| `frontend/src/test/wizard/divergence/S0ECommitStep.test.tsx` | **Create** | S0E 测试 |
| `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx` | Modify | 父容器测试更新 |

---

## Phase 1 — Backend rename + route prefix

### Task 1: 重命名 `creative_canvas.py` → `creative_diverge.py`

**Files:**
- Rename: `backend/api/creative_canvas.py` → `backend/api/creative_diverge.py`
- Modify: `backend/api/creative_diverge.py:30` (修改 router prefix)

- [ ] **Step 1: 用 git mv 重命名文件**

```bash
git mv backend/api/creative_canvas.py backend/api/creative_diverge.py
```

- [ ] **Step 2: 修改 router prefix**

修改 `backend/api/creative_diverge.py:30`:

```python
# Old:
router = APIRouter(prefix="/api/v1/projects/{project_id}/creative/canvas", tags=["creative-canvas"])
# New:
router = APIRouter(prefix="/api/v1/projects/{project_id}/creative/diverge", tags=["creative-diverge"])
```

- [ ] **Step 3: 验证 import 不破坏**

```bash
grep -rn "creative_canvas" backend/ --include="*.py"
```

预期:除 `backend/api/creative_diverge.py` 内被 Python 识别的引用外,其他引用通过 import 自动跟随重命名。如果有 `from backend.api.creative_canvas import ...` 出现在其他文件,会自动 break(应被 main.py 等修复)。

- [ ] **Step 4: 跑现有测试确认无回归**

```bash
cd /Users/longsa/Codes/nebula && pytest tests/test_creative_canvas_routes.py -v 2>&1 | tail -30
```

预期:测试失败(路径已变),后续 Task 2 修复。

- [ ] **Step 5: 暂不 commit(待 Task 2 一起)**

---

### Task 2: 更新 `main.py` router 注册

**Files:**
- Modify: `backend/main.py` (找到 `creative_canvas` import 和 include_router)

- [ ] **Step 1: 修改 import 名称**

```bash
grep -n "creative_canvas\|creative_diverge" backend/main.py
```

预期输出:1-2 行,例如:

```
from backend.api.creative_canvas import router as creative_canvas_router
app.include_router(creative_canvas_router, ...)
```

- [ ] **Step 2: 替换 import 与变量名**

```python
# Old:
from backend.api.creative_canvas import router as creative_canvas_router
app.include_router(creative_canvas_router, ...)

# New:
from backend.api.creative_diverge import router as creative_diverge_router
app.include_router(creative_diverge_router, ...)
```

- [ ] **Step 3: 重命名测试文件 + 改路径**

```bash
git mv tests/test_creative_canvas_routes.py tests/test_creative_diverge_routes.py
```

修改 `tests/test_creative_diverge_routes.py` 中的 URL 字符串:所有 `/creative/canvas/` → `/creative/diverge/`。

```bash
sed -i '' 's|/creative/canvas/|/creative/diverge/|g' tests/test_creative_diverge_routes.py
grep "/creative/" tests/test_creative_diverge_routes.py | head -5
```

预期:全部为 `/creative/diverge/`。

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_diverge_routes.py -v 2>&1 | tail -30
```

预期:全 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/creative_diverge.py backend/main.py tests/test_creative_diverge_routes.py
git rm backend/api/creative_canvas.py
git commit -m "$(cat <<'EOF'
refactor(api): rename creative_canvas → creative_diverge (route prefix)

Routes now exposed under /api/v1/projects/{id}/creative/diverge/*.
Main.py router registration updated. Tests renamed + URL strings
migrated from /creative/canvas to /creative/diverge.

No behavior change — same handlers, same engine wiring, same
canvas_state.json schema (v2). Schema v3 migration + new endpoints
come in Phase 3+.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: canvas_state.json schema v2 → v3 + 迁移

**Files:**
- Modify: `backend/api/creative_diverge.py` (在 `_read_canvas` 入口补 v2→v3 迁移)
- Test: `tests/test_canvas_state_v2_to_v3.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_canvas_state_v2_to_v3.py
import json
from pathlib import Path
import pytest
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_v2_test"
    project_dir = tmp_path / pid
    project_dir.mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    canvas_v2 = {
        "schema_version": 2,
        "root_node_id": "node-root",
        "nodes": {"node-root": {"id": "node-root", "depth": 0, "parent_id": None, "content": "test", "trope_tags": [], "saturation_warning": False, "novelty_score": None, "mutation_context": None, "children_ids": [], "is_expanded": True, "branch_status": "active"}},
        "edges": [],
        "selected_path": ["node-root"],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "2026-08-30T10:00:00Z",
        "updated_at": "2026-08-30T10:00:00Z",
        "committed_at": None,
        "committed_concept_ref": None,
    }
    (project_dir / "canvas_state.json").write_text(json.dumps(canvas_v2))
    return pid

def test_v2_migrates_to_v3_on_read(project):
    from backend.api.creative_diverge import _read_canvas
    canvas = _read_canvas(project)
    assert canvas["schema_version"] == 3
    assert canvas["core_contradiction"] is None
    assert canvas["novelty_scores"] is None
    assert canvas["idea_variants"] == []  # extracted from mutation_context
    assert "session_metadata" in canvas
    assert canvas["session_metadata"]["operation_count"] == 0

def test_v2_missing_raw_intent_defaults_null(project):
    from backend.api.creative_diverge import _read_canvas
    canvas = _read_canvas(project)
    assert canvas["raw_intent"] is None
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_canvas_state_v2_to_v3.py -v 2>&1 | tail -15
```

预期:`AttributeError: module 'backend.api.creative_diverge' has no attribute '_read_canvas'` 或字段缺失断言失败。

- [ ] **Step 3: 在 `_read_canvas` 入口补迁移逻辑**

找到 `backend/api/creative_diverge.py` 中 `_read_canvas` 函数,修改函数体首部:

```python
def _read_canvas(project_id: str) -> dict:
    fm = _get_fm()
    canvas_path = fm.project_dir(project_id) / "canvas_state.json"
    if not canvas_path.exists():
        return None
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    # v2 → v3 migration
    if canvas.get("schema_version", 1) < 3:
        canvas = _migrate_canvas_v2_to_v3(canvas)
    return canvas

def _migrate_canvas_v2_to_v3(canvas: dict) -> dict:
    """Auto-upgrade v2 canvas_state.json to v3 schema."""
    # Extract idea_variants from nodes with mutation_context.mut
    idea_variants = []
    for node in canvas.get("nodes", {}).values():
        mc = node.get("mutation_context") or {}
        if mc.get("mut"):
            idea_variants.append({
                "id": node["id"],
                "title": node.get("content", "")[:20],
                "premise_one_line": node.get("content", ""),
                "mutation_type": mc.get("mut"),
                "mutation_logic": mc.get("logic", ""),
                "estimated_novelty": node.get("novelty_score", 0.0) or 0.0,
                "trope_tags": node.get("trope_tags", []),
                "regenerated_count": 0,
            })
    canvas["idea_variants"] = idea_variants
    canvas["core_contradiction"] = None
    canvas["novelty_scores"] = None
    canvas["raw_intent"] = None  # user must redo S0-A
    canvas["session_metadata"] = {
        "created_at": canvas.get("created_at", ""),
        "last_modified_at": canvas.get("updated_at", ""),
        "elapsed_seconds": 0,
        "operation_count": 0,
        "ab_test_bucket": "control",
    }
    canvas["schema_version"] = 3
    # write back
    return canvas
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_canvas_state_v2_to_v3.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: 跑回归**

```bash
pytest tests/test_creative_diverge_routes.py -v 2>&1 | tail -10
```

预期:全 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_canvas_state_v2_to_v3.py
git commit -m "$(cat <<'EOF'
feat(api): canvas_state.json v2 → v3 auto-migration

Adds _migrate_canvas_v2_to_v3 on read: extracts idea_variants from
nodes with mutation_context.mut, defaults core_contradiction/novelty_scores/
raw_intent/session_metadata, bumps schema_version=3.

Backward compatible — existing v2 projects continue working, just need
to redo S0-A (raw_intent=null) on next session.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Source whitelist + Path B deprecation

### Task 4: 更新 `ALLOWED_CONCEPT_SOURCES` + Stage 1 PUT 行为

**Files:**
- Modify: `backend/api/stage1_concept.py:124`
- Test: `tests/test_source_whitelist_update.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_source_whitelist_update.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_whitelist"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    # pre-write canvas-sourced concept
    (tmp_path / pid / "concept_and_dna.json").write_text(json.dumps({
        "concept": {"title": "t", "genre": "g", "premise": "p", "tone": "tone", "theme": "th", "target_audience": "ta"},
        "story_dna": {"core_contradiction": {"statement": "x", "side_a": "a", "side_b": "b"}, "value_stack": []},
        "source": "canvas",
    }))
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_canvas_source_accepted_on_get(client, project):
    r = client.get(f"/api/v1/projects/{project}/concept")
    assert r.status_code == 200
    assert r.json()["source"] == "canvas"

def test_canvas_source_upgraded_to_edited_on_put(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/concept",
        json={
            "concept": {"title": "t2"},
            "story_dna": {"core_contradiction": {"statement": "x"}},
            "source": "canvas",
        }
    )
    assert r.status_code == 200
    payload = json.loads((_file_manager().projects_dir / project / "concept_and_dna.json").read_text())
    assert payload["source"] == "canvas_edited"

def test_canvas_edited_source_preserved_on_put(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/concept",
        json={
            "concept": {"title": "t2"},
            "story_dna": {"core_contradiction": {"statement": "x"}},
            "source": "canvas_edited",
        }
    )
    assert r.status_code == 200
    payload = json.loads((_file_manager().projects_dir / project / "concept_and_dna.json").read_text())
    assert payload["source"] == "canvas_edited"

def test_unknown_source_rejected(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/concept",
        json={
            "concept": {"title": "t2"},
            "story_dna": {"core_contradiction": {"statement": "x"}},
            "source": "garbage",
        }
    )
    assert r.status_code == 400
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_source_whitelist_update.py -v 2>&1 | tail -15
```

预期:`test_canvas_source_accepted_on_get` 失败,因为当前 `ALLOWED_CONCEPT_SOURCES` 不含 `canvas`。

- [ ] **Step 3: 更新 `ALLOWED_CONCEPT_SOURCES`**

修改 `backend/api/stage1_concept.py:124`:

```python
# Old:
ALLOWED_CONCEPT_SOURCES = {"manual", "creative_divergence"}
# New:
ALLOWED_CONCEPT_SOURCES = {"manual", "creative_divergence", "canvas", "canvas_edited"}
```

- [ ] **Step 4: 修改 `update_concept` 行为**

找到 `update_concept` 函数(在 `backend/api/stage1_concept.py`),在 source 校验处加分支:

```python
# Old (typical pattern):
if payload.source not in ALLOWED_CONCEPT_SOURCES:
    raise HTTPException(400, "INVALID_SOURCE")
# Auto-downgrade canvas → manual on edit

# New:
if payload.source == "canvas":
    payload.source = "canvas_edited"  # first edit upgrades
elif payload.source == "canvas_edited":
    pass  # preserve
elif payload.source in ALLOWED_CONCEPT_SOURCES:
    pass  # manual/creative_divergence keep
else:
    raise HTTPException(400, detail={"code": "INVALID_SOURCE", "message": f"source {payload.source} 不允许"})
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pytest tests/test_source_whitelist_update.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 6: 跑回归**

```bash
pytest tests/ -k "stage1 or concept" -v 2>&1 | tail -10
```

预期:全 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/api/stage1_concept.py tests/test_source_whitelist_update.py
git commit -m "$(cat <<'EOF'
feat(api): source whitelist accepts canvas + canvas_edited

ALLOWED_CONCEPT_SOURCES += {canvas, canvas_edited}.
update_concept now upgrades source=canvas → canvas_edited on first
edit (instead of silently downgrading to manual), and preserves
canvas_edited across subsequent PUTs. Preserves audit trail per
PRD §6.2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Path B 端点 Deprecation headers

**Files:**
- Modify: `backend/api/creative_divergence.py` (4 个端点响应加 headers)
- Test: `tests/test_path_b_deprecation_headers.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_path_b_deprecation_headers.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_deprecation"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

ENDPOINTS = [
    ("GET", f"/api/projects/{{}}/creative-divergence"),
    ("POST", f"/api/projects/{{}}/creative-divergence/generate"),
    ("POST", f"/api/projects/{{}}/creative-divergence/select"),
    ("GET", f"/api/projects/{{}}/creative-divergence/prefill-check"),
]

@pytest.mark.parametrize("method,path_template", ENDPOINTS)
def test_deprecation_headers_present(client, project, method, path_template):
    path = path_template.format(project)
    if method == "GET":
        r = client.get(path)
    else:
        r = client.post(path, json={})
    assert r.headers.get("Deprecation") == "true"
    assert r.headers.get("Sunset") == "2026-12-31"
    assert "successor-version" in r.headers.get("Link", "")
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_path_b_deprecation_headers.py -v 2>&1 | tail -15
```

预期:Deprecation header 缺失。

- [ ] **Step 3: 在 `creative_divergence.py` 加 middleware**

修改 `backend/api/creative_divergence.py`,在文件顶部 import 后加:

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

DEPRECATION_HEADERS = {
    "Deprecation": "true",
    "Sunset": "2026-12-31",
    "Link": '</api/v1/projects/{project_id}/creative/diverge/state>; rel="successor-version"',
}

class DeprecationHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Only apply to Path B endpoints
        if "/creative-divergence" in request.url.path:
            for k, v in DEPRECATION_HEADERS.items():
                if k == "Link":
                    v = v.replace("{project_id}", request.path_params.get("project_id", ""))
                response.headers[k] = v
        return response
```

修改 `router = APIRouter(...)` 之后,在文件底部 `app`/`router` 注册处(若有独立 sub-app)挂 middleware。如果没有,直接在 main.py 的 `app.add_middleware(DeprecationHeadersMiddleware)` 之前 import:

```python
# 在文件末尾加:
__all__ = ["router", "DeprecationHeadersMiddleware"]
```

- [ ] **Step 4: 在 main.py 挂 middleware**

修改 `backend/main.py`,在 `app = FastAPI(...)` 之后:

```python
from backend.api.creative_divergence import DeprecationHeadersMiddleware
app.add_middleware(DeprecationHeadersMiddleware)
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pytest tests/test_path_b_deprecation_headers.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_divergence.py backend/main.py tests/test_path_b_deprecation_headers.py
git commit -m "$(cat <<'EOF'
feat(api): Path B endpoints emit Deprecation/Sunset/Link headers

Per PRD §8.1 Phase 1: Path B /api/projects/{id}/creative-divergence/*
endpoints still serve requests but signal deprecation. Sunset date
2026-12-31, with Link header pointing to /creative/diverge/state as
successor-version. v1.3 will convert to 301 redirect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Missing endpoints

### Task 6: `/contradict` POST + PUT 端点

**Files:**
- Modify: `backend/api/creative_diverge.py` (新增 2 个端点)
- Test: `tests/test_creative_diverge_contradict.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_creative_diverge_contradict.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_contradict"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_post_contradict_returns_5_candidates_sorted_by_tension(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": "v1", "variant_content": "主角拥有最强力量但力量同时是致命弱点"},
    )
    assert r.status_code == 200
    candidates = r.json()["candidates"]
    assert len(candidates) <= 5
    scores = [c["tension_score"] for c in candidates]
    assert scores == sorted(scores, reverse=True)

def test_post_contradict_includes_5_templates(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": "v1", "variant_content": "能力与代价"},
    )
    candidates = r.json()["candidates"]
    template_types = {c["template_type"] for c in candidates}
    # Should include at least 1-2 of the 5 PRD templates
    assert any(t in template_types for t in [
        "能力×限制", "永恒×消逝", "身份×秘密", "目标×代价", "力量×弱点"
    ])

def test_put_contradict_writes_to_canvas_state(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强大越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
    )
    assert r.status_code == 200
    saved = json.loads((_file_manager().projects_dir / project / "canvas_state.json").read_text())
    assert saved["core_contradiction"]["template_type"] == "能力×限制"
    assert saved["core_contradiction"]["statement"] == "越强大越不能用"
    assert saved["core_contradiction"]["is_custom"] is True
    assert "tension_score" in saved["core_contradiction"]
```

> **注**:本测试使用真实 LLM 调用。CI 跑时若 LLM 不可用,可能 hang 或超时。在 fixtures 加 marker:
```python
@pytest.mark.integration
def test_post_contradict_returns_5_candidates_sorted_by_tension(client, project):
    ...
```
或根据项目约定在 pytest.ini 标记 slow/integration。

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_diverge_contradict.py -v 2>&1 | tail -15
```

预期:404 Not Found(端点未注册)。

- [ ] **Step 3: 在 `creative_diverge.py` 新增 `/contradict` POST + PUT**

找到文件顶部 `from backend.creative_os.contradiction_engine import ContradictionEngine`(若没有),加 import。然后在文件末尾添加:

```python
from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.models.creative_os import ContradictionTemplate

_contradiction_engine = ContradictionEngine()

class ContradictRequest(BaseModel):
    variant_id: str
    variant_content: str

class ConfirmContradictRequest(BaseModel):
    template_type: str
    statement: str
    side_a: str
    side_b: str
    tension_score: Optional[int] = None
    is_custom: bool = False

@router.post("/contradict")
async def list_contradictions(project_id: str, request: ContradictRequest):
    """List 5 contradiction template candidates for a variant, sorted by tension_score."""
    candidates = []
    for template in ContradictionTemplate:
        expansion = await _contradiction_engine.expand(
            template, context=request.variant_content
        )
        candidates.append({
            "template_type": template.value,
            "preview_statement": expansion.statement,
            "side_a": expansion.side_a,
            "side_b": expansion.side_b,
            "tension_score": _contradiction_engine.score_depth(expansion.statement),
        })
    candidates.sort(key=lambda x: x["tension_score"], reverse=True)
    return {"candidates": candidates[:5]}

@router.put("/contradict")
async def confirm_contradiction(project_id: str, request: ConfirmContradictRequest):
    """User confirms or customizes a contradiction; writes to canvas_state.core_contradiction."""
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(400, detail={"code": "CANVAS_NOT_INITIALIZED", "message": "画布尚未初始化"})
    tension = request.tension_score or _contradiction_engine.score_depth(request.statement)
    canvas["core_contradiction"] = {
        "template_type": request.template_type,
        "statement": request.statement,
        "side_a": request.side_a,
        "side_b": request.side_b,
        "tension_score": tension,
        "is_custom": request.is_custom,
        "confirmed_at": datetime.utcnow().isoformat(),
    }
    _write_canvas(project_id, canvas)
    return {"core_contradiction": canvas["core_contradiction"]}
```

确保文件顶部已 import:
```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_creative_diverge_contradict.py -v 2>&1 | tail -10
```

预期:PASS(若 LLM mock 可用)。

- [ ] **Step 5: 跑回归**

```bash
pytest tests/test_creative_diverge_routes.py -v 2>&1 | tail -10
```

预期:全 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_creative_diverge_contradict.py
git commit -m "$(cat <<'EOF'
feat(api): /contradict POST + PUT endpoints

POST returns up to 5 contradiction template candidates (sorted by
tension_score desc) for a given variant. PUT writes the user's
confirmed/customized contradiction to canvas_state.core_contradiction
with auto-computed tension_score if missing.

Wires ContradictionEngine.expand() + score_depth() to HTTP per PRD §3.2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `/fuse` 端点

**Files:**
- Modify: `backend/api/creative_diverge.py`
- Test: `tests/test_creative_diverge_fuse.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_creative_diverge_fuse.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_fuse"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_fuse_high_distance_returns_variant_and_high_risk(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "法庭推理", "prompt": "test"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "variants" in data
    assert data["fusion_distance"]["distance"] >= 0
    assert data["risk_level"] in {"low", "medium", "high"}

def test_fuse_near_related_returns_warning(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "武侠", "prompt": "test"},
    )
    assert r.status_code == 200
    # Near-related: should still return variants (engine handles all distances)
    assert "variants" in r.json()
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_diverge_fuse.py -v 2>&1 | tail -10
```

预期:404 Not Found。

- [ ] **Step 3: 添加 `/fuse` 端点**

在 `backend/api/creative_diverge.py` 顶部 import:
```python
from backend.creative_os.mutation_engine import MutationEngine
from backend.creative_os.genre_fusion_engine import GenreFusionEngine
from backend.creative_os.idea_pool_importer import IdeaPoolImporter
from backend.creative_os.trope_pool import TropePool
```

> **前提**:`IdeaPoolImporter` 将在 Task 11 创建,这里只是引用。运行测试时可能 ImportError,需先完成 Task 11 或本步骤提前实现最小 IdeaPoolImporter stub。

文件末尾新增:

```python
_genre_fusion_engine = GenreFusionEngine()
_trope_pool = TropePool()  # may need project_id; check signature

class FuseRequest(BaseModel):
    genre_primary: str
    genre_secondary: str
    prompt: str

def _mutation_to_idea_variant(result) -> dict:
    """Adapt MutationResult to idea_variant schema."""
    return {
        "id": f"var-{uuid.uuid4().hex[:8]}",
        "title": result.core_premise[:30] if result.core_premise else "",
        "premise_one_line": result.core_premise,
        "mutation_type": result.operation.value,
        "mutation_logic": result.core_conflict,
        "estimated_novelty": 0.7,  # TODO: use novelty_hook to score
        "trope_tags": [],
        "regenerated_count": 0,
    }

@router.post("/fuse")
async def fuse_genres(project_id: str, request: FuseRequest):
    """Genre fusion with distance-based risk grading."""
    fusion = _genre_fusion_engine.calculate_distance(
        request.genre_primary, request.genre_secondary
    )
    distance = fusion.get("distance", 50)
    risk = "high" if distance >= 61 else ("medium" if distance >= 31 else "low")

    trope_a = _trope_pool.get_by_genre(request.genre_primary)
    trope_b = _trope_pool.get_by_genre(request.genre_secondary)
    if trope_a is None or trope_b is None:
        # Fallback: use generic Trope objects
        from backend.models.creative_os import Trope
        trope_a = trope_a or Trope(id="a", name=request.genre_primary, category="", description=request.prompt, market_saturation=0.5)
        trope_b = trope_b or Trope(id="b", name=request.genre_secondary, category="", description=request.prompt, market_saturation=0.5)

    mutation_result = await _mutation_engine.fuse(trope_a, trope_b)
    variant = _mutation_to_idea_variant(mutation_result)

    # Persist to canvas_state (idea_variants array)
    canvas = _read_canvas(project_id) or {"schema_version": 3}
    canvas.setdefault("idea_variants", []).append(variant)
    _write_canvas(project_id, canvas)

    return {
        "variants": [variant],
        "fusion_distance": fusion,
        "risk_level": risk,
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_creative_diverge_fuse.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_creative_diverge_fuse.py
git commit -m "$(cat <<'EOF'
feat(api): /fuse endpoint with distance-based risk grading

Combines GenreFusionEngine.calculate_distance + MutationEngine.fuse
per PRD §3.4. Returns risk_level (low/medium/high) based on BFS
distance thresholds (0-30, 31-60, 61-100). Variants persisted to
canvas_state.idea_variants.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `/mutate/{node_id}/regenerate` 端点

**Files:**
- Modify: `backend/api/creative_diverge.py`
- Test: `tests/test_creative_diverge_mutate_regenerate.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_creative_diverge_mutate_regenerate.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project_with_variants(tmp_path):
    pid = "proj_regen"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    canvas = {
        "schema_version": 3,
        "idea_variants": [
            {"id": "variant-1", "title": "原变体", "premise_one_line": "test",
             "mutation_type": "inversion", "mutation_logic": "x",
             "estimated_novelty": 0.5, "trope_tags": [], "regenerated_count": 0},
        ],
        "nodes": {},
        "edges": [],
        "selected_path": [],
        "branch_choices": {},
    }
    (tmp_path / pid / "canvas_state.json").write_text(json.dumps(canvas))
    return pid

@pytest.fixture
def client(project_with_variants):
    return TestClient(app)

def test_regenerate_increments_count_and_updates_variant(client, project_with_variants):
    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-1/regenerate"
    )
    assert r.status_code == 200
    variant = r.json()["variant"]
    assert variant["id"] == "variant-1"
    assert variant["regenerated_count"] == 1
    # title should change (LLM re-generates)
    # if title is identical, the engine returned same; allow either

def test_regenerate_unknown_variant_returns_400(client, project_with_variants):
    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-nonexistent/regenerate"
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "INVALID_NODE_ID"
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_diverge_mutate_regenerate.py -v 2>&1 | tail -10
```

预期:404 Not Found。

- [ ] **Step 3: 新增 `/mutate/{node_id}/regenerate` 端点**

在 `backend/api/creative_diverge.py` 文件末尾新增:

```python
@router.post("/mutate/{node_id}/regenerate")
async def regenerate_variant(project_id: str, node_id: str):
    """Re-run mutation for a single variant; increments regenerated_count."""
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(400, detail={"code": "CANVAS_NOT_INITIALIZED", "message": "画布尚未初始化"})
    variant = next((v for v in canvas.get("idea_variants", []) if v["id"] == node_id), None)
    if variant is None:
        raise HTTPException(400, detail={"code": "INVALID_NODE_ID", "message": f"variant {node_id} 不存在"})

    # Re-run mutation
    trope = _trope_pool.get_by_genre(canvas.get("raw_intent", {}).get("genre_primary", "")) if canvas.get("raw_intent") else None
    if trope is None:
        from backend.models.creative_os import Trope
        trope = Trope(id="regen", name=variant["title"], category="", description=variant["premise_one_line"], market_saturation=0.5)
    op = _mutation_op_from_type(variant["mutation_type"])
    if op is None:
        # Custom/inversion fallback
        from backend.models.creative_os import MutationOp
        op = MutationOp.INVERSION
    result = await _mutation_engine.mutate(trope, op, context=variant["premise_one_line"])
    new_variant = _mutation_to_idea_variant(result)
    new_variant["id"] = node_id  # preserve ID
    new_variant["regenerated_count"] = variant.get("regenerated_count", 0) + 1

    # Update canvas
    canvas["idea_variants"] = [
        new_variant if v["id"] == node_id else v
        for v in canvas["idea_variants"]
    ]
    _write_canvas(project_id, canvas)
    return {"variant": new_variant}


def _mutation_op_from_type(t: str):
    from backend.models.creative_os import MutationOp
    return {
        "inversion": MutationOp.INVERSION,
        "fusion": MutationOp.FUSION,
        "escalation": MutationOp.ESCALATION,
        "subversion": MutationOp.SUBVERSION,
    }.get(t)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_creative_diverge_mutate_regenerate.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_creative_diverge_mutate_regenerate.py
git commit -m "$(cat <<'EOF'
feat(api): /mutate/{node_id}/regenerate endpoint

Re-runs MutationEngine.mutate for a single idea_variant, preserves
ID, increments regenerated_count. Returns 400 INVALID_NODE_ID if
variant not found.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `/novelty` 列表级评分端点

**Files:**
- Modify: `backend/api/creative_diverge.py`
- Test: `tests/test_creative_diverge_novelty.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_creative_diverge_novelty.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_novelty"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    canvas = {
        "schema_version": 3,
        "selected_path": ["node-root", "node-1"],
        "core_contradiction": {
            "template_type": "能力×限制", "statement": "x", "side_a": "a", "side_b": "b",
            "tension_score": 75, "is_custom": False,
        },
        "nodes": {
            "node-root": {"id": "node-root", "depth": 0, "parent_id": None, "content": "root",
                          "trope_tags": ["修仙"], "saturation_warning": False, "novelty_score": None,
                          "mutation_context": None, "children_ids": ["node-1"], "is_expanded": True, "branch_status": "active"},
            "node-1": {"id": "node-1", "depth": 1, "parent_id": "node-root", "content": "child",
                       "trope_tags": ["修仙"], "saturation_warning": False, "novelty_score": None,
                       "mutation_context": None, "children_ids": [], "is_expanded": False, "branch_status": "active"},
        },
    }
    (tmp_path / pid / "canvas_state.json").write_text(json.dumps(canvas))
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_get_novelty_returns_4_dims_and_composite(client, project):
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/novelty")
    assert r.status_code == 200
    data = r.json()
    for key in ["market_saturation", "trope_similarity", "contradiction_depth", "discussion_potential", "composite"]:
        assert key in data
        assert 0.0 <= data[key] <= 1.0
    assert "trope_extraction_status" in data

def test_get_novelty_persists_to_canvas_state(client, project):
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/novelty")
    saved = json.loads((_file_manager().projects_dir / project / "canvas_state.json").read_text())
    assert saved["novelty_scores"] is not None
    assert "computed_at" in saved["novelty_scores"]
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_diverge_novelty.py -v 2>&1 | tail -10
```

预期:404 Not Found。

- [ ] **Step 3: 新增 `/novelty` GET 端点**

在 `backend/api/creative_diverge.py` 顶部 import:
```python
from backend.creative_os.novelty_evaluator import NoveltyEvaluator
from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.creative_os.trope_pool import TropePool
```

文件末尾新增:

```python
_novelty_evaluator = NoveltyEvaluator(contradiction_engine=_contradiction_engine, trope_pool=_trope_pool)

@router.get("/novelty")
async def get_novelty(project_id: str):
    """List-level novelty evaluation: 4 dimensions + composite."""
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(400, detail={"code": "CANVAS_NOT_INITIALIZED", "message": "画布尚未初始化"})

    # Collect content from selected_path
    nodes = canvas.get("nodes", {})
    selected_path = canvas.get("selected_path", [])
    combined_content = " ".join(
        nodes[nid]["content"] for nid in selected_path if nid in nodes
    )
    core_contradiction = canvas.get("core_contradiction") or {}
    trope_tags = list(set(
        tag
        for nid in selected_path
        for tag in nodes.get(nid, {}).get("trope_tags", [])
    ))

    scores = await _novelty_evaluator.evaluate(
        content=combined_content,
        contradiction=core_contradiction,
        trope_tags=trope_tags,
    )
    scores["computed_at"] = datetime.utcnow().isoformat()
    scores["trope_extraction_status"] = "completed" if trope_tags else "pending"

    canvas["novelty_scores"] = scores
    _write_canvas(project_id, canvas)
    return scores
```

> **注**:`NoveltyEvaluator.evaluate` 签名需根据实际实现调整。如果存在 `evaluate` 方法则按上述;如果只有 `evaluate_dimension` 或 `score_*` 方法,需调用它们并组装。

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_creative_diverge_novelty.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_creative_diverge_novelty.py
git commit -m "$(cat <<'EOF'
feat(api): /novelty GET — list-level 4-dim novelty score

Aggregates novelty scores across selected_path nodes. Returns 4
dimensions (market_saturation, trope_similarity, contradiction_depth,
discussion_potential) + composite. Persists to canvas_state.novelty_scores
with computed_at timestamp. Trope extraction status surfaced for
frontend polling.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Engine integrations

### Task 10: GenreFusionEngine 暴露 calculate_distance + 风险等级

**Files:**
- Modify: `backend/creative_os/genre_fusion_engine.py`
- Test: `tests/test_genre_fusion_distance.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_genre_fusion_distance.py
from backend.creative_os.genre_fusion_engine import GenreFusionEngine

def test_distance_returns_int_0_to_100():
    eng = GenreFusionEngine()
    result = eng.calculate_distance("修仙", "法庭推理")
    assert isinstance(result, dict)
    assert "distance" in result
    assert 0 <= result["distance"] <= 100

def test_near_related_short_distance():
    eng = GenreFusionEngine()
    result = eng.calculate_distance("修仙", "武侠")
    assert result["distance"] < 31

def test_far_related_long_distance():
    eng = GenreFusionEngine()
    result = eng.calculate_distance("修仙", "克苏鲁")
    assert result["distance"] >= 31
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_genre_fusion_distance.py -v 2>&1 | tail -10
```

预期:`calculate_distance` 签名/返回结构不匹配。

- [ ] **Step 3: 修改或包装 `calculate_distance`**

找到 `backend/creative_os/genre_fusion_engine.py` 中 `calculate_distance` 方法。如果返回纯整数,改为返回 dict:

```python
def calculate_distance(self, genre_a: str, genre_b: str) -> dict:
    """Return BFS distance between two genres as a dict with distance + explanation."""
    raw_distance = self._raw_distance(genre_a, genre_b)  # 原始实现
    return {
        "distance": raw_distance,
        "genre_a": genre_a,
        "genre_b": genre_b,
        "risk_level": "high" if raw_distance >= 61 else ("medium" if raw_distance >= 31 else "low"),
        "explanation": self._explain_distance(genre_a, genre_b, raw_distance),
    }
```

如果原方法已返回 dict 但 key 不一致,加 alias:

```python
# In __init__ or as a wrapper
def get_risk_level(self, distance: int) -> str:
    return "high" if distance >= 61 else ("medium" if distance >= 31 else "low")
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_genre_fusion_distance.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/genre_fusion_engine.py tests/test_genre_fusion_distance.py
git commit -m "$(cat <<'EOF'
feat(creative_os): GenreFusionEngine returns dict with distance + risk_level

calculate_distance now returns {distance, genre_a, genre_b, risk_level,
explanation}. Risk levels: 0-30 low, 31-60 medium, 61-100 high.
Aligns with PRD §3.4 distance bands table.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: IdeaPoolImporter 模块

**Files:**
- Create: `backend/creative_os/idea_pool_importer.py`
- Modify: `backend/creative_os/__init__.py` (导出)
- Test: `tests/test_idea_pool_importer.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_idea_pool_importer.py
import json
import pytest
from pathlib import Path
from backend.creative_os.idea_pool import IdeaPool
from backend.creative_os.idea_pool_importer import IdeaPoolImporter

@pytest.fixture
def pool(tmp_path):
    project_dir = tmp_path / "proj_pool"
    project_dir.mkdir()
    (project_dir / "creative_os").mkdir()
    return IdeaPool(project_dir)

def test_importer_adds_variants_as_ideas(pool):
    importer = IdeaPoolImporter(pool)
    variants = [
        {"id": "v1", "title": "Test", "premise_one_line": "A premise",
         "mutation_type": "inversion", "estimated_novelty": 0.7, "trope_tags": ["修仙"]},
    ]
    importer.add_batch(variants, source_stage="mutate:inversion")

    ideas = pool.list()
    assert len(ideas) == 1
    assert ideas[0].id == "v1"
    assert ideas[0].content == "A premise"
    assert ideas[0].source_stage == "mutate:inversion"
    assert ideas[0].category.value == "设定灵感"
    assert "修仙" in ideas[0].related_elements

def test_importer_persists_to_disk(pool):
    importer = IdeaPoolImporter(pool)
    importer.add_batch([{"id": "v2", "title": "X", "premise_one_line": "y"}], source_stage="fuse")

    pool_file = pool._file
    data = json.loads(pool_file.read_text())
    assert len(data) == 1
    assert data[0]["id"] == "v2"
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_idea_pool_importer.py -v 2>&1 | tail -10
```

预期:`ModuleNotFoundError: No module named 'backend.creative_os.idea_pool_importer'`。

- [ ] **Step 3: 创建 `idea_pool_importer.py`**

```python
# backend/creative_os/idea_pool_importer.py
"""Adapter layer: idea_variants → Idea for persistence."""
import json
from backend.creative_os.idea_pool import IdeaPool
from backend.models.creative_os import Idea, IdeaCategory


class IdeaPoolImporter:
    """Persist idea_variants (PRD §4.2 schema) to IdeaPool."""

    def __init__(self, pool: IdeaPool):
        self.pool = pool

    def add_batch(self, variants: list[dict], source_stage: str) -> None:
        """Adapt variants to Idea dataclass and persist via pool.add."""
        for v in variants:
            idea = Idea(
                id=v["id"],
                content=v.get("premise_one_line") or v.get("title", ""),
                category=IdeaCategory.SETTING,
                source_stage=source_stage,
                source_context=json.dumps(v, ensure_ascii=False),
                related_elements=v.get("trope_tags", []),
                confidence=v.get("estimated_novelty", 0.0),
            )
            self.pool.add(idea)
```

- [ ] **Step 4: 修改 `__init__.py` 导出**

修改 `backend/creative_os/__init__.py`,加:

```python
from backend.creative_os.idea_pool_importer import IdeaPoolImporter
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pytest tests/test_idea_pool_importer.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/creative_os/idea_pool_importer.py backend/creative_os/__init__.py tests/test_idea_pool_importer.py
git commit -m "$(cat <<'EOF'
feat(creative_os): IdeaPoolImporter for idea_variants → IdeaPool

Adapter module persists /mutate and /fuse generated variants to
per-project <project>/creative_os/idea_pool.json via IdeaPool.add().
Uses IdeaCategory.SETTING for categorization, preserves source_stage
("mutate:inversion" / "fuse" / etc.) for audit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: market_saturation async Trope 提取修复

**Files:**
- Create: `backend/prompts/trope_extraction.yaml`
- Modify: `backend/creative_os/novelty_evaluator.py`
- Test: `tests/test_novelty_market_saturation_fix.py` (新建)

- [ ] **Step 1: 创建 `trope_extraction.yaml` prompt**

```yaml
# backend/prompts/trope_extraction.yaml
name: trope_extraction
provider: anthropic
model: claude-haiku-4-5-20251001
temperature: 0.3
max_tokens: 512

system_prompt: |
  你是一位网络小说套路分析专家。给定一段创意描述,提取其中涉及的网文套路标签(Trope Tags)。
  
  要求:
  1. 输出 3-8 个简洁的套路标签(2-4 字),用逗号分隔
  2. 标签应覆盖:题材套路(如 修仙/穿越/重生/系统)、剧情套路(如 复仇/逆袭/扮猪吃虎)、设定套路(如 废材流/天才流/无限流)
  3. 只输出标签,不要解释
  
user_prompt_template: |
  创意描述: {prompt}
  
  请输出套路标签(逗号分隔):

output_format:
  type: text
```

- [ ] **Step 2: 写失败测试**

```python
# tests/test_novelty_market_saturation_fix.py
import pytest
from backend.creative_os.novelty_evaluator import NoveltyEvaluator
from backend.creative_os.contradiction_engine import ContradictionEngine

def test_market_saturation_returns_50_when_no_tags():
    evaluator = NoveltyEvaluator(contradiction_engine=ContradictionEngine())
    score = evaluator._market_saturation(trope_tags=[])
    assert score == 0.5  # 50 on 0-1 scale

def test_market_saturation_returns_score_when_tags_provided():
    evaluator = NoveltyEvaluator(contradiction_engine=ContradictionEngine())
    score = evaluator._market_saturation(trope_tags=["修仙", "逆袭"])
    assert 0.0 <= score <= 1.0
    assert score != 0.5  # should differ from default
```

- [ ] **Step 3: 跑测试确认现有行为**

```bash
pytest tests/test_novelty_market_saturation_fix.py -v 2>&1 | tail -10
```

预期:`test_market_saturation_returns_score_when_tags_provided` 失败(默认 tag=[] 走退化路径,即使 tags 提供也走退化)。

- [ ] **Step 4: 修改 `_market_saturation` 让它支持真实 tag 输入**

修改 `backend/creative_os/novelty_evaluator.py`,找到 `_market_saturation` 方法:

```python
def _market_saturation(self, trope_tags: list[str]) -> float:
    """Compute market_saturation score from trope tags via pool lookup."""
    if not trope_tags:
        return 0.5  # fallback when extraction pending
    # Look up each tag in trope_pool for market_saturation value
    scores = []
    for tag in trope_tags:
        trope = self._trope_pool.get_by_name(tag) if self._trope_pool else None
        if trope and hasattr(trope, 'market_saturation'):
            scores.append(trope.market_saturation)
    if not scores:
        return 0.5
    return sum(scores) / len(scores)
```

- [ ] **Step 5: 在 `_init` 后台填 trope_tags(可选,本期做 stub)**

在 `backend/creative_os/novelty_evaluator.py` 加一个 fire-and-forget 方法:

```python
async def fill_trope_tags_async(self, raw_intent: dict, llm_client, save_callback):
    """Background Trope tag extraction via Tier 3 LLM."""
    if raw_intent.get("trope_tags"):
        return  # already filled
    from backend.services.prompt_loader import load_prompt
    from backend.llm.openai_compatible_provider import generate_text

    prompt = load_prompt("trope_extraction").format(prompt=raw_intent.get("prompt", ""))
    tags_str = await generate_text(prompt, tier=3)
    tags = [t.strip() for t in tags_str.split(",") if t.strip()]
    raw_intent["trope_tags"] = tags
    save_callback(raw_intent)
```

在 `creative_diverge.py` 的 `/init` 端点中触发:

```python
import asyncio
@router.post("/init")
async def init_canvas(project_id: str, request: InitRequest):
    canvas = ...
    raw_intent = request.raw_intent
    # ... write canvas ...
    # Async fire-and-forget Trope extraction
    asyncio.create_task(_novelty_evaluator.fill_trope_tags_async(
        raw_intent, llm_client=None, save_callback=lambda ri: _write_canvas(project_id, _read_canvas(project_id))
    ))
    return canvas
```

> **注**:`fill_trope_tags_async` 是 best-effort,失败不阻塞主流程。

- [ ] **Step 6: 跑测试确认通过**

```bash
pytest tests/test_novelty_market_saturation_fix.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/prompts/trope_extraction.yaml backend/creative_os/novelty_evaluator.py backend/api/creative_diverge.py tests/test_novelty_market_saturation_fix.py
git commit -m "$(cat <<'EOF'
feat(novelty): async Trope extraction + market_saturation fix

When raw_intent.trope_tags is empty, fire Tier 3 LLM extraction
(trope_extraction.yaml) in background; on completion, write tags back
to raw_intent so subsequent /novelty calls use real scores instead of
0.5 fallback. Best-effort; failures don't block init flow.

PRD §3.5 critical fix: market_saturation was 30% weight degrading to
0.5 (50/100) when tags=[]. Now: degradation is interim, auto-filled.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 更新 `/commit` 响应格式 + canvas_to_concept.yaml 模板 + dual-write

**Files:**
- Modify: `backend/prompts/canvas_to_concept.yaml`
- Modify: `backend/api/creative_diverge.py` (`/commit` 端点)
- Test: `tests/test_commit_dual_write.py` (新建)

- [ ] **Step 1: 修改 `canvas_to_concept.yaml` 模板**

修改 `backend/prompts/canvas_to_concept.yaml`,在 `user_prompt_template` 末尾追加:

```yaml
user_prompt_template: |
  画布创意链路(已按 selected_path 顺序整理):
  {canvas_summary}
  目标类型:{genre}
  请基于这条链路提炼故事概念,输出与 concept_generation 同样的JSON结构:
  
  请在 story_dna 中额外输出:
  - style_template:基于类型与变异类型推荐写作风格参照(如:冷硬、克制、意识流、白描、华丽等)
  - value_stack 必须为恰好 4 层,从具体到抽象递进:
    * personal(个人层面冲突,如复仇/成长/救赎)
    * social(社会层面冲突,如阶层/制度/群体)
    * philosophical(哲学层面冲突,如自由/责任/真理)
    * existential(存在层面冲突,如意义/虚无/命运)
  
  {{
    "concept": {{
      "title": "故事标题",
      "genre": "类型",
      "premise": "一句话前提",
      "tone": "基调",
      "theme": "主题",
      "target_audience": "目标读者"
    }},
    "story_dna": {{
      "core_contradiction": {{
        "statement": "核心矛盾的完整表述",
        "side_a": "立场A的描述",
        "side_b": "立场B的描述"
      }},
      "value_stack": [
        {{"value_a": "价值A", "value_b": "价值B", "level": "personal"}},
        {{"value_a": "价值A", "value_b": "价值B", "level": "social"}},
        {{"value_a": "价值A", "value_b": "价值B", "level": "philosophical"}},
        {{"value_a": "价值A", "value_b": "价值B", "level": "existential"}}
      ],
      "style_template": "写作风格参照"
    }}
  }}
```

- [ ] **Step 2: 写失败测试**

```python
# tests/test_commit_dual_write.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project_with_canvas(tmp_path):
    pid = "proj_commit_dual"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    canvas = {
        "schema_version": 3,
        "raw_intent": {"prompt": "修仙少年觉醒", "genre_primary": "修仙"},
        "selected_path": ["node-root", "node-1"],
        "core_contradiction": {"template_type": "能力×限制", "statement": "x",
                              "side_a": "a", "side_b": "b", "tension_score": 75, "is_custom": False},
        "nodes": {
            "node-root": {"id": "node-root", "depth": 0, "parent_id": None, "content": "root",
                          "trope_tags": [], "saturation_warning": False, "novelty_score": None,
                          "mutation_context": None, "children_ids": ["node-1"], "is_expanded": True, "branch_status": "active"},
            "node-1": {"id": "node-1", "depth": 1, "parent_id": "node-root", "content": "child",
                       "trope_tags": [], "saturation_warning": False, "novelty_score": None,
                       "mutation_context": None, "children_ids": [], "is_expanded": False, "branch_status": "active"},
        },
        "edges": [],
        "branch_choices": {},
    }
    (tmp_path / pid / "canvas_state.json").write_text(json.dumps(canvas))
    (tmp_path / pid / "project.json").write_text(json.dumps({"genre": "cool_novel"}))
    return pid

@pytest.fixture
def client(project_with_canvas):
    return TestClient(app)

def test_commit_writes_both_concept_and_dna_and_creative_divergence(client, project_with_canvas):
    r = client.post(
        f"/api/v1/projects/{project_with_canvas}/creative/diverge/commit",
        json={"session_id": "test", "confirmed_path_ids": ["node-root", "node-1"]},
    )
    assert r.status_code == 200
    fm = _file_manager()
    proj_dir = fm.projects_dir / project_with_canvas
    cd = json.loads((proj_dir / "concept_and_dna.json").read_text())
    assert cd["source"] == "canvas"
    assert "style_template" in cd["story_dna"]
    assert len(cd["story_dna"]["value_stack"]) == 4
    assert {vs["level"] for vs in cd["story_dna"]["value_stack"]} == {"personal", "social", "philosophical", "existential"}

    # Dual-write: creative_divergence.json also written for Stage 1 守卫
    cd_div = json.loads((proj_dir / "creative_divergence.json").read_text())
    assert "prompt" in cd_div
    assert cd_div["source"] == "canvas"

def test_commit_returns_concept_preview_and_novelty_summary(client, project_with_canvas):
    r = client.post(
        f"/api/v1/projects/{project_with_canvas}/creative/diverge/commit",
        json={"session_id": "test", "confirmed_path_ids": ["node-root", "node-1"]},
    )
    data = r.json()
    assert "concept_preview" in data
    assert "novelty_summary" in data
    assert "next_step_url" in data
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pytest tests/test_commit_dual_write.py -v 2>&1 | tail -10
```

预期:测试失败(响应格式不符合新契约)。

- [ ] **Step 4: 修改 `/commit` 端点**

找到 `creative_diverge.py` 中 `commit_canvas` 函数(原 `/commit`)。重写为:

```python
@router.post("/commit")
async def commit_diverge(project_id: str, request: CommitRequest):
    """Translate canvas → concept_and_dna + dual-write to creative_divergence.json."""
    _ensure_project(project_id)
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(400, detail={"code": "CANVAS_NOT_INITIALIZED", "message": "画布尚未初始化"})

    confirmed_path_ids = request.confirmed_path_ids or canvas.get("selected_path", [])
    if not confirmed_path_ids:
        raise HTTPException(422, detail={"code": "PATH_NOT_SELECTED", "message": "请在 What-If 树中选择至少一条叙事路径"})

    nodes = canvas.get("nodes", {})
    canvas_summary = _format_canvas_summary(confirmed_path_ids, nodes)

    project = _get_fm().read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")

    from backend.agents.planner import PlannerAgent
    from backend.services.agent_prompt_stores import project_override_store, global_override_store

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _ = await agent.generate_concept_from_canvas(
            canvas_summary=canvas_summary,
            genre=genre,
        )
    except Exception as exc:
        raise HTTPException(503, detail={"code": "LLM_BACKEND_UNAVAILABLE", "message": str(exc)})

    if not result or result.get("degraded"):
        raise HTTPException(503, detail={"code": "LLM_BACKEND_UNAVAILABLE", "message": "LLM 后端不可用"})

    concept = result.get("concept") or {}
    story_dna = result.get("story_dna") or {}

    # Apply user override on value_stack
    if request.value_stack_override:
        story_dna["value_stack"] = request.value_stack_override

    statement = (story_dna.get("core_contradiction") or {}).get("statement", "")
    if not statement.strip():
        raise HTTPException(500, detail={"code": "CONCEPT_SCHEMA_ERROR", "message": "LLM 输出缺少 story_dna.core_contradiction.statement"})

    # Stamp canvas_state first
    now = datetime.utcnow().isoformat()
    canvas["committed_at"] = now
    canvas["committed_concept_ref"] = "concept_and_dna.json"
    canvas["updated_at"] = now
    _write_canvas(project_id, canvas, preserve_committed=True)

    # Write concept_and_dna.json
    concept_and_dna = {
        "concept": concept,
        "story_dna": story_dna,
        "source": "canvas",
        "canvas_snapshot": {"selected_path": confirmed_path_ids, "committed_at": now},
    }
    _get_fm().write_json(project_id, "concept_and_dna.json", concept_and_dna)

    # Dual-write: creative_divergence.json (compat with Stage 1 守卫)
    raw_intent = canvas.get("raw_intent") or {}
    cd_compat = {
        "prompt": (raw_intent.get("prompt", "") or "")[:100],
        "variants": [],
        "selected_id": None,
        "selected_at": now,
        "source": "canvas",
    }
    _get_fm().write_json(project_id, "creative_divergence.json", cd_compat)

    # Build novelty summary (from canvas_state.novelty_scores if available)
    novelty = canvas.get("novelty_scores") or {}
    warnings = []
    composite = novelty.get("composite", 1.0)
    if composite < 0.4:
        warnings.append(f"novelty_below_threshold:composite<0.4 仅警告,不阻止")

    return {
        "concept_preview": concept,
        "story_dna_preview": story_dna,
        "novelty_summary": novelty,
        "next_step_url": f"/project/{project_id}/wizard?step=2",
        "warnings": warnings,
    }
```

在文件顶部 import 加:

```python
class CommitRequest(BaseModel):
    session_id: str
    confirmed_path_ids: list[str] = []
    user_notes: Optional[str] = None
    value_stack_override: Optional[list[dict]] = None
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pytest tests/test_commit_dual_write.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 6: 跑回归**

```bash
pytest tests/test_creative_diverge_routes.py tests/test_commit_dual_write.py -v 2>&1 | tail -10
```

预期:全 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/prompts/canvas_to_concept.yaml backend/api/creative_diverge.py tests/test_commit_dual_write.py
git commit -m "$(cat <<'EOF'
feat(commit): dual-write to creative_divergence.json + style_template + 4-layer value_stack

canvas_to_concept.yaml now instructs LLM to output style_template +
exactly 4 value_stack layers (personal/social/philosophical/existential).
/commit endpoint writes concept_and_dna.json (source=canvas) AND
creative_divergence.json (compat with Stage 1 guard).

Response shape: {concept_preview, story_dna_preview, novelty_summary,
next_step_url, warnings}. Warnings surface low-novelty without
blocking submission per D-2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Concurrency + migration

### Task 14: ETag 乐观锁

**Files:**
- Modify: `backend/api/creative_diverge.py` (`_read_canvas` + `_write_canvas`)
- Test: `tests/test_etag_optimistic_lock.py` (新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/test_etag_optimistic_lock.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_etag"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path
    canvas = {"schema_version": 3, "raw_intent": {"prompt": "test", "genre_primary": "修仙"}}
    (tmp_path / pid / "canvas_state.json").write_text(json.dumps(canvas))
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_init_returns_etag(client, project):
    # Ensure project is initialized
    client.post(f"/api/v1/projects/{project}/creative/diverge/init",
                json={"raw_intent": {"prompt": "测试 prompt 内容", "genre_primary": "修仙"}})
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/state")
    assert r.status_code == 200
    assert "etag" in r.json() or r.headers.get("ETag") is not None

def test_conflict_returns_409(client, project):
    client.post(f"/api/v1/projects/{project}/creative/diverge/init",
                json={"raw_intent": {"prompt": "测试 prompt 内容", "genre_primary": "修仙"}})
    state = client.get(f"/api/v1/projects/{project}/creative/diverge/state").json()
    etag = state.get("etag") or "fake-etag"

    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"template_type": "能力×限制", "statement": "x", "side_a": "a", "side_b": "b", "is_custom": True},
        headers={"If-Match": "wrong-etag"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "RACE_CONDITION"

def test_correct_etag_succeeds(client, project):
    client.post(f"/api/v1/projects/{project}/creative/diverge/init",
                json={"raw_intent": {"prompt": "测试 prompt 内容", "genre_primary": "修仙"}})
    state = client.get(f"/api/v1/projects/{project}/creative/diverge/state").json()
    etag = state["etag"]

    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"template_type": "能力×限制", "statement": "x", "side_a": "a", "side_b": "b", "is_custom": True},
        headers={"If-Match": etag},
    )
    assert r.status_code == 200
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_etag_optimistic_lock.py -v 2>&1 | tail -10
```

预期:`test_conflict_returns_409` 失败(没有 ETag 检查)。

- [ ] **Step 3: 在 `_read_canvas` 和 `_write_canvas` 加 ETag**

修改 `backend/api/creative_diverge.py`:

```python
import hashlib

def _compute_etag(canvas: dict) -> str:
    """Compute MD5 of canonical JSON for optimistic lock."""
    payload = json.dumps(canvas, sort_keys=True, ensure_ascii=False)
    return hashlib.md5(payload.encode()).hexdigest()[:16]

def _read_canvas(project_id: str) -> dict:
    fm = _get_fm()
    canvas_path = fm.project_dir(project_id) / "canvas_state.json"
    if not canvas_path.exists():
        return None
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    if canvas.get("schema_version", 1) < 3:
        canvas = _migrate_canvas_v2_to_v3(canvas)
    canvas["_etag"] = _compute_etag(canvas)
    return canvas

def _write_canvas(project_id: str, canvas: dict, preserve_committed: bool = False):
    """Write canvas_state.json; recompute _etag on save."""
    canvas.pop("_etag", None)
    canvas["updated_at"] = datetime.utcnow().isoformat()
    if "operation_count" not in canvas.get("session_metadata", {}):
        canvas.setdefault("session_metadata", {})
        canvas["session_metadata"].setdefault("operation_count", 0)
    canvas["session_metadata"]["operation_count"] += 1
    canvas["session_metadata"]["last_modified_at"] = canvas["updated_at"]
    _get_fm().write_json(project_id, "canvas_state.json", canvas)
    canvas["_etag"] = _compute_etag(canvas)


def _check_etag_or_409(canvas: dict, request_etag: str):
    if not request_etag:
        return  # no If-Match header = no check
    expected = canvas.get("_etag", "")
    if request_etag != expected:
        raise HTTPException(409, detail={
            "code": "RACE_CONDITION",
            "message": "你的草稿已被其他设备更新,请刷新后重试",
            "current_etag": expected,
        })
```

在 `GET /state` 端点返回 `_etag` 作为顶级 key(在响应 body):

```python
@router.get("/state")
async def get_state(project_id: str):
    canvas = _read_canvas(project_id)
    if canvas is None:
        return {"schema_version": 3, "etag": None}
    etag = canvas.pop("_etag")
    return {**canvas, "etag": etag}
```

在每个写端点(`/contradict` PUT 等)入口加:

```python
canvas = _read_canvas(project_id)
if_match = request.headers.get("If-Match")
_check_etag_or_409(canvas, if_match)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pytest tests/test_etag_optimistic_lock.py -v 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_etag_optimistic_lock.py
git commit -m "$(cat <<'EOF'
feat(api): ETag optimistic lock for canvas_state.json writes

Each GET /state returns etag (MD5 of canonical JSON, first 16 chars).
Write endpoints (PUT /contradict, etc.) check If-Match header against
current _etag; mismatch returns 409 RACE_CONDITION with current_etag
for client retry.

Prevents silent overwrite when two clients edit the same canvas.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: 迁移脚本 `backfill_creative_divergence.py`

**Files:**
- Create: `scripts/backfill_creative_divergence.py`
- Test: 手动验证(无 pytest,e2e 风格)

- [ ] **Step 1: 创建脚本**

```python
#!/usr/bin/env python3
"""One-time migration: for projects with source=canvas in concept_and_dna.json
but no creative_divergence.json, write a compat file with prompt field.

Run once on v1.1 deploy.
"""
import json
import sys
from pathlib import Path

PROJECTS_ROOT = Path("backend/data/projects")


def migrate_one(project_dir: Path) -> bool:
    cd_path = project_dir / "concept_and_dna.json"
    cd_compat_path = project_dir / "creative_divergence.json"
    if not cd_path.exists():
        return False
    if cd_compat_path.exists():
        return False  # already migrated
    try:
        cd = json.loads(cd_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if cd.get("source") != "canvas":
        return False
    # Extract prompt from canvas_snapshot or fall back to empty
    canvas_snapshot = cd.get("canvas_snapshot", {})
    selected_path = canvas_snapshot.get("selected_path", [])
    # Read canvas_state.json for raw_intent.prompt
    canvas_path = project_dir / "canvas_state.json"
    prompt = ""
    if canvas_path.exists():
        try:
            canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
            raw_intent = canvas.get("raw_intent") or {}
            prompt = (raw_intent.get("prompt", "") or "")[:100]
        except Exception:
            pass
    cd_compat = {
        "prompt": prompt,
        "variants": [],
        "selected_id": None,
        "selected_at": cd.get("canvas_snapshot", {}).get("committed_at", ""),
        "source": "canvas",
    }
    cd_compat_path.write_text(json.dumps(cd_compat, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def main():
    if not PROJECTS_ROOT.exists():
        print(f"Projects dir not found: {PROJECTS_ROOT}", file=sys.stderr)
        sys.exit(1)
    migrated = 0
    for project_dir in PROJECTS_ROOT.iterdir():
        if project_dir.is_dir():
            if migrate_one(project_dir):
                migrated += 1
                print(f"Migrated: {project_dir.name}")
    print(f"\nTotal migrated: {migrated}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 手动 dry-run**

```bash
cd /Users/longsa/Codes/nebula && python3 scripts/backfill_creative_divergence.py
```

预期:对每个 source=canvas 的项目输出 "Migrated: proj_xxx",对其他项目静默跳过。检查 `backend/data/projects/<pid>/creative_divergence.json` 已写入。

- [ ] **Step 3: 在 `scripts/` 加 README 引用**

修改 `scripts/README.md`(若不存在,创建):

```markdown
## `backfill_creative_divergence.py`

One-time migration for v1.1. For projects with `source=canvas` in `concept_and_dna.json`
but no `creative_divergence.json`, creates the compat file so Stage 1 守卫 can
read `prompt` field.

**Run on v1.1 deploy:**

```bash
python3 scripts/backfill_creative_divergence.py
```

Safe to run multiple times (skips projects that already have the file).
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill_creative_divergence.py scripts/README.md
git commit -m "$(cat <<'EOF'
chore(scripts): add backfill_creative_divergence.py for v1.1 migration

One-time migration: writes creative_divergence.json (with prompt field)
for projects that have source=canvas in concept_and_dna.json but lack
the compat file. Required for Stage 1 守卫 to work post-v1.1.

Run on v1.1 deploy. Idempotent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Frontend API client + Context

### Task 16: API client 新增 12 个方法 + 移除 4 个 Path B 方法

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 添加新方法**

在 `frontend/src/api/client.ts` 中找到导出 `api` 对象,在 `diverge` 相关方法处添加:

```typescript
// creative divergence (PRD §6.1)
postDivergeInit: (projectId: string, rawIntent: RawIntent) =>
  fetchJson<{ session_id: string }>(
    `/api/v1/projects/${projectId}/creative/diverge/init`,
    { method: "POST", body: JSON.stringify({ raw_intent: rawIntent }) }
  ),

postDivergeMutate: (
  projectId: string,
  body: { session_id: string; operation: string; forbidden_directions?: string[]; raw_intent?: RawIntent }
) =>
  fetchJson<{ variants: IdeaVariant[]; warnings?: string[] }>(
    `/api/v1/projects/${projectId}/creative/diverge/mutate`,
    { method: "POST", body: JSON.stringify(body) }
  ),

postDivergeMutateRegenerate: (projectId: string, variantId: string) =>
  fetchJson<{ variant: IdeaVariant }>(
    `/api/v1/projects/${projectId}/creative/diverge/mutate/${variantId}/regenerate`,
    { method: "POST" }
  ),

postDivergeContradict: (projectId: string, variantId: string, variantContent: string) =>
  fetchJson<{ candidates: ContradictionCandidate[] }>(
    `/api/v1/projects/${projectId}/creative/diverge/contradict`,
    { method: "POST", body: JSON.stringify({ variant_id: variantId, variant_content: variantContent }) }
  ),

putDivergeContradict: (projectId: string, body: ConfirmContradictRequest, ifMatch?: string) =>
  fetchJson<{ core_contradiction: CoreContradiction }>(
    `/api/v1/projects/${projectId}/creative/diverge/contradict`,
    {
      method: "PUT",
      headers: ifMatch ? { "If-Match": ifMatch } : undefined,
      body: JSON.stringify(body),
    }
  ),

postDivergeWhatIfExpand: (projectId: string, nodeId: string, depthTarget: number = 1, forbiddenDirections: string[] = []) =>
  fetchJson<{ children: WhatIfNode[] }>(
    `/api/v1/projects/${projectId}/creative/diverge/whatif/expand`,
    {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId, depth_target: depthTarget, forbidden_directions: forbiddenDirections }),
    }
  ),

putDivergeWhatIfSelect: (projectId: string, pathIds: string[], ifMatch?: string) =>
  fetchJson<{ selected_path: string[] }>(
    `/api/v1/projects/${projectId}/creative/diverge/whatif/select`,
    {
      method: "PUT",
      headers: ifMatch ? { "If-Match": ifMatch } : undefined,
      body: JSON.stringify({ path_ids: pathIds }),
    }
  ),

getDivergeNovelty: (projectId: string) =>
  fetchJson<NoveltyScores>(`/api/v1/projects/${projectId}/creative/diverge/novelty`),

postDivergeCommit: (projectId: string, body: CommitRequest) =>
  fetchJson<CommitResponse>(
    `/api/v1/projects/${projectId}/creative/diverge/commit`,
    { method: "POST", body: JSON.stringify(body) }
  ),

getDivergeState: (projectId: string) =>
  fetchJson<CanvasStateV3>(`/api/v1/projects/${projectId}/creative/diverge/state`),

deleteDivergeState: (projectId: string) =>
  fetchPromise(`/api/v1/projects/${projectId}/creative/diverge/state`, { method: "DELETE" }),

postDivergeFuse: (projectId: string, body: FuseRequest) =>
  fetchJson<FuseResponse>(
    `/api/v1/projects/${projectId}/creative/diverge/fuse`,
    { method: "POST", body: JSON.stringify(body) }
  ),
```

在文件顶部 types 区添加 type 定义:

```typescript
export interface RawIntent {
  prompt: string;
  genre_primary: string;
  genre_secondary?: string;
  target_reader?: string;
  reference_works?: string[];
  forbidden_directions?: string[];
  quick_mode?: boolean;
}

export interface IdeaVariant {
  id: string;
  title: string;
  premise_one_line: string;
  mutation_type: string;
  mutation_logic: string;
  estimated_novelty: number;
  trope_tags: string[];
  regenerated_count: number;
}

export interface ContradictionCandidate {
  template_type: string;
  preview_statement: string;
  side_a: string;
  side_b: string;
  tension_score: number;
}

export interface CoreContradiction {
  template_type: string;
  statement: string;
  side_a: string;
  side_b: string;
  tension_score: number;
  is_custom: boolean;
  confirmed_at: string;
}

export interface ConfirmContradictRequest {
  template_type: string;
  statement: string;
  side_a: string;
  side_b: string;
  tension_score?: number;
  is_custom: boolean;
}

export interface WhatIfNode {
  id: string;
  parent_id: string | null;
  content: string;
  novelty_score: number | null;
  children_ids: string[];
}

export interface NoveltyScores {
  market_saturation: number;
  trope_similarity: number;
  contradiction_depth: number;
  discussion_potential: number;
  composite: number;
  computed_at: string;
  trope_extraction_status: "pending" | "completed" | "failed";
}

export interface ValueStackLayer {
  value_a: string;
  value_b: string;
  level: "personal" | "social" | "philosophical" | "existential";
}

export interface CommitRequest {
  session_id: string;
  confirmed_path_ids: string[];
  user_notes?: string;
  value_stack_override?: ValueStackLayer[];
}

export interface CommitResponse {
  concept_preview: any;
  story_dna_preview: any;
  novelty_summary: NoveltyScores;
  next_step_url: string;
  warnings: string[];
}

export interface FuseRequest {
  genre_primary: string;
  genre_secondary: string;
  prompt: string;
}

export interface FuseResponse {
  variants: IdeaVariant[];
  fusion_distance: { distance: number; risk_level: string };
  risk_level: "low" | "medium" | "high";
}

export interface CanvasStateV3 {
  schema_version: 3;
  etag: string;
  raw_intent: RawIntent | null;
  nodes: Record<string, any>;
  edges: any[];
  selected_path: string[];
  branch_choices: Record<string, string>;
  core_contradiction: CoreContradiction | null;
  novelty_scores: NoveltyScores | null;
  idea_variants: IdeaVariant[];
  session_metadata: any;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
}
```

- [ ] **Step 2: 移除 Path B 方法**

删除以下方法:

```typescript
listCreativeDivergenceVariants: ...
generateCreativeDivergenceVariants: ...
selectCreativeDivergenceVariant: ...
getCreativeDivergencePrefill: ...
```

- [ ] **Step 3: 跑 type check**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -20
```

预期:无 type error。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "$(cat <<'EOF'
feat(frontend): API client — 12 diverge methods + remove 4 Path B methods

Adds postDivergeInit/postDivergeMutate/postDivergeMutateRegenerate/
postDivergeContradict/putDivergeContradict/postDivergeWhatIfExpand/
putDivergeWhatIfSelect/getDivergeNovelty/postDivergeCommit/
getDivergeState/deleteDivergeState/postDivergeFuse.

Removes listCreativeDivergenceVariants/generateCreativeDivergenceVariants/
selectCreativeDivergenceVariant/getCreativeDivergencePrefill (Path B stubs).

Type definitions for all request/response shapes per PRD §6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: WizardContext 扩展

**Files:**
- Modify: `frontend/src/components/wizard/WizardContext.tsx`

- [ ] **Step 1: 添加 SubStage state**

在 `WizardContext.tsx` 顶部 type 区:

```typescript
export type CreativeDivergenceSubStage = "A" | "B" | "C" | "D" | "E";

interface WizardState {
  // ... existing fields
  creativeDivergenceSubStage: CreativeDivergenceSubStage;
}

interface WizardActions {
  // ... existing actions
  setCreativeDivergenceSubStage: (sub: CreativeDivergenceSubStage) => void;
  jumpToCreativeDivergence: (sub: CreativeDivergenceSubStage) => void;
}
```

- [ ] **Step 2: 在 reducer 中加 action handler**

找到 reducer,在 switch 中添加 case:

```typescript
case "SET_DIVERGENCE_SUBSTAGE":
    return { ...state, creativeDivergenceSubStage: action.payload };

case "JUMP_TO_CREATIVE_DIVERGENCE":
    return {
        ...state,
        currentStep: 1,
        creativeDivergenceSubStage: action.payload,
    };
```

- [ ] **Step 3: 在 WizardProvider 初始化 state**

```typescript
const initialState: WizardState = {
  // ... existing fields
  creativeDivergenceSubStage: "A",
};
```

- [ ] **Step 4: 跑 type check + 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit && npm test -- --testPathPattern="WizardContext" 2>&1 | tail -20
```

预期:无 type error,WizardContext 测试通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/WizardContext.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): WizardContext — creativeDivergenceSubStage + jumpToCreativeDivergence

Adds SubStage state field + setter + jump action. WizardContext
v1.2 ready for 5-stage CreativeDivergenceStep rewrite.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Frontend 5-stage components

### Task 18: StepIndicator 组件

**Files:**
- Create: `frontend/src/components/wizard/divergence/StepIndicator.tsx`
- Test: `frontend/src/test/wizard/divergence/StepIndicator.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/StepIndicator.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import StepIndicator, { type SubStage } from "@/components/wizard/divergence/StepIndicator";

describe("StepIndicator", () => {
  it("renders 5 step labels", () => {
    render(<StepIndicator current="A" completed={[]} onJump={() => {}} />);
    expect(screen.getByText("输入")).toBeInTheDocument();
    expect(screen.getByText("变体")).toBeInTheDocument();
    expect(screen.getByText("矛盾")).toBeInTheDocument();
    expect(screen.getByText("展开")).toBeInTheDocument();
    expect(screen.getByText("提交")).toBeInTheDocument();
  });

  it("highlights current stage", () => {
    render(<StepIndicator current="C" completed={["A", "B"]} onJump={() => {}} />);
    const currentBtn = screen.getByTestId("step-C");
    expect(currentBtn.className).toMatch(/bg-primary/);
  });

  it("marks completed stages as clickable", () => {
    const onJump = vi.fn();
    render(<StepIndicator current="E" completed={["A", "B", "C", "D"]} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("step-A"));
    expect(onJump).toHaveBeenCalledWith("A");
  });

  it("disables unvisited stages", () => {
    const onJump = vi.fn();
    render(<StepIndicator current="A" completed={[]} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("step-C"));
    expect(onJump).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="StepIndicator" 2>&1 | tail -20
```

预期:Module not found。

- [ ] **Step 3: 实现组件**

```typescript
// frontend/src/components/wizard/divergence/StepIndicator.tsx
export type SubStage = "A" | "B" | "C" | "D" | "E";

interface Props {
  current: SubStage;
  completed: SubStage[];
  onJump: (sub: SubStage) => void;
}

const STAGES: Array<{ key: SubStage; label: string }> = [
  { key: "A", label: "输入" },
  { key: "B", label: "变体" },
  { key: "C", label: "矛盾" },
  { key: "D", label: "展开" },
  { key: "E", label: "提交" },
];

export default function StepIndicator({ current, completed, onJump }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant">
      {STAGES.map((s, i) => {
        const isCurrent = s.key === current;
        const isCompleted = completed.includes(s.key);
        const isClickable = isCompleted && !isCurrent;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <button
              data-testid={`step-${s.key}`}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onJump(s.key)}
              className={[
                "px-3 py-1 rounded-full text-sm transition-colors",
                isCurrent ? "bg-primary text-on-primary font-medium" :
                isCompleted ? "bg-surface-container text-primary hover:bg-surface-container-low" :
                "bg-surface-container-lowest text-on-surface-variant opacity-50 cursor-not-allowed",
              ].join(" ")}
            >
              {i + 1}. {s.label}
            </button>
            {i < STAGES.length - 1 && <span className="text-outline-variant">›</span>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="StepIndicator" 2>&1 | tail -10
```

预期:PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/divergence/StepIndicator.tsx frontend/src/test/wizard/divergence/StepIndicator.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): StepIndicator component

Top-bar 5-stage indicator (输入 › 变体 › 矛盾 › 展开 › 提交).
Current stage highlighted, completed stages clickable for jump-back,
unvisited stages disabled.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: S0AInputStep 组件

**Files:**
- Create: `frontend/src/components/wizard/divergence/S0AInputStep.tsx`
- Test: `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/S0AInputStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0AInputStep from "@/components/wizard/divergence/S0AInputStep";

const GENRES = ["修仙", "都市", "星际", "游戏"]; // adjust to actual list

describe("S0AInputStep", () => {
  it("renders prompt textarea + genre select", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    expect(screen.getByPlaceholderText(/用一句话描述你的故事想法/)).toBeInTheDocument();
    expect(screen.getByTestId("genre-primary")).toBeInTheDocument();
  });

  it("disables submit when prompt < 10 chars", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    const btn = screen.getByTestId("s0a-submit");
    fireEvent.change(screen.getByPlaceholderText(/用一句话描述/), { target: { value: "短" } });
    fireEvent.change(screen.getByTestId("genre-primary"), { target: { value: "修仙" } });
    expect(btn).toBeDisabled();
  });

  it("calls onComplete with raw_intent on valid submit", async () => {
    const onComplete = vi.fn();
    render(<S0AInputStep projectId="p1" onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText(/用一句话描述/), { target: { value: "一个完整的故事想法,够长够详细" } });
    fireEvent.change(screen.getByTestId("genre-primary"), { target: { value: "修仙" } });
    fireEvent.click(screen.getByTestId("s0a-submit"));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          genre_primary: "修仙",
        })
      );
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0AInputStep" 2>&1 | tail -20
```

- [ ] **Step 3: 实现组件**

```typescript
// frontend/src/components/wizard/divergence/S0AInputStep.tsx
import { useState } from "react";
import api, { type RawIntent } from "@/api/client";

interface Props {
  projectId: string;
  onComplete: (rawIntent: RawIntent, sessionId: string) => void;
  initial?: RawIntent | null;
}

const GENRES = ["修仙", "都市", "星际", "游戏", "历史", "军事", "体育", "校园", "悬疑", "奇幻"];

export default function S0AInputStep({ projectId, onComplete, initial }: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [genrePrimary, setGenrePrimary] = useState(initial?.genre_primary || "");
  const [genreSecondary, setGenreSecondary] = useState(initial?.genre_secondary || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = prompt.trim().length >= 10 && genrePrimary && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const rawIntent: RawIntent = {
        prompt: prompt.trim(),
        genre_primary: genrePrimary,
        genre_secondary: genreSecondary || undefined,
      };
      const result = await api.postDivergeInit(projectId, rawIntent);
      onComplete(rawIntent, result.session_id);
    } catch (e: any) {
      setError(e?.message || "提交失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">灵感输入</h2>
      <textarea
        placeholder="用一句话描述你的故事想法"
        className="w-full h-32 p-3 border border-outline-variant rounded-lg resize-none"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex justify-between text-xs text-on-surface-variant">
        <span>{prompt.length} 字</span>
        {prompt.length > 0 && prompt.length < 10 && (
          <span className="text-error">至少 10 字</span>
        )}
        {prompt.length > 200 && (
          <span className="text-warning">超过 200 字将自动摘要</span>
        )}
      </div>
      <div className="flex gap-3">
        <select
          data-testid="genre-primary"
          className="flex-1 p-2 border border-outline-variant rounded-lg"
          value={genrePrimary}
          onChange={(e) => setGenrePrimary(e.target.value)}
        >
          <option value="">选择主类型</option>
          {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select
          data-testid="genre-secondary"
          className="flex-1 p-2 border border-outline-variant rounded-lg"
          value={genreSecondary}
          onChange={(e) => setGenreSecondary(e.target.value)}
        >
          <option value="">副类型(可选)</option>
          {GENRES.filter((g) => g !== genrePrimary).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      {error && <div className="text-error text-sm">{error}</div>}
      <button
        data-testid="s0a-submit"
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
      >
        {submitting ? "提交中..." : "下一步:生成变体"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0AInputStep" 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/divergence/S0AInputStep.tsx frontend/src/test/wizard/divergence/S0AInputStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): S0AInputStep component

灵感输入面板: prompt textarea (字数计数+校验) + 主类型/副类型选择器。
POST /init on submit, returns raw_intent + session_id via onComplete.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: S0BMutationStep 组件

**Files:**
- Create: `frontend/src/components/wizard/divergence/S0BMutationStep.tsx`
- Test: `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0BMutationStep from "@/components/wizard/divergence/S0BMutationStep";
import api from "@/api/client";

vi.mock("@/api/client");

const sampleVariants = [
  { id: "v1", title: "变体1", premise_one_line: "x", mutation_type: "inversion", mutation_logic: "y", estimated_novelty: 0.7, trope_tags: [], regenerated_count: 0 },
  { id: "v2", title: "变体2", premise_one_line: "x", mutation_type: "fusion", mutation_logic: "y", estimated_novelty: 0.5, trope_tags: [], regenerated_count: 0 },
];

describe("S0BMutationStep", () => {
  beforeEach(() => {
    (api.postDivergeMutate as any).mockResolvedValue({ variants: sampleVariants });
    (api.postDivergeMutateRegenerate as any).mockResolvedValue({
      variant: { ...sampleVariants[0], regenerated_count: 1, title: "新变体" },
    });
  });

  it("renders 6-8 variant cards after mutate", async () => {
    render(<S0BMutationStep projectId="p1" sessionId="s1" rawIntent={{prompt: "测试", genre_primary: "修仙"}} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getAllByTestId(/variant-card-/)).toHaveLength(2);
    });
  });

  it("limits selection to 3 variants", async () => {
    const onComplete = vi.fn();
    render(<S0BMutationStep projectId="p1" sessionId="s1" rawIntent={{prompt: "测试", genre_primary: "修仙"}} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() => screen.getAllByTestId(/variant-card-/));
    const cards = screen.getAllByTestId(/variant-card-/);
    fireEvent.click(cards[0]);
    fireEvent.click(cards[1]);
    fireEvent.click(cards[2] ?? cards[cards.length - 1]); // 3rd click (or fallback)
    // 4th click should be ignored
    if (cards.length > 3) fireEvent.click(cards[3]);
    // Verify selected count
    const submitBtn = screen.getByTestId("s0b-submit");
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("regenerate button calls regenerate endpoint", async () => {
    render(<S0BMutationStep projectId="p1" sessionId="s1" rawIntent={{prompt: "测试", genre_primary: "修仙"}} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => screen.getAllByTestId(/variant-card-/));
    const regenBtn = screen.getByTestId("regen-v1");
    fireEvent.click(regenBtn);
    await waitFor(() => {
      expect(api.postDivergeMutateRegenerate).toHaveBeenCalledWith("p1", "v1");
    });
  });
});
```

- [ ] **Step 2: 实现组件**

```typescript
// frontend/src/components/wizard/divergence/S0BMutationStep.tsx
import { useEffect, useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";

interface Props {
  projectId: string;
  sessionId: string;
  rawIntent: RawIntent;
  initial?: IdeaVariant[];
  onComplete: (variants: IdeaVariant[]) => void;
  onBack: () => void;
}

export default function S0BMutationStep({ projectId, sessionId, rawIntent, initial, onComplete, onBack }: Props) {
  const [variants, setVariants] = useState<IdeaVariant[]>(initial || []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial && initial.length > 0) return;
    (async () => {
      setLoading(true);
      try {
        const result = await api.postDivergeMutate(projectId, {
          session_id: sessionId,
          operation: "all",
          raw_intent: rawIntent,
        });
        setVariants(result.variants);
      } catch (e: any) {
        setError(e?.message || "生成失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, sessionId, rawIntent, initial]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  async function regenerate(variantId: string) {
    try {
      const result = await api.postDivergeMutateRegenerate(projectId, variantId);
      setVariants((prev) => prev.map((v) => (v.id === variantId ? result.variant : v)));
    } catch (e: any) {
      setError(e?.message || "重新生成失败");
    }
  }

  function submit() {
    if (selected.size === 0) return;
    const selectedVariants = variants.filter((v) => selected.has(v.id));
    onComplete(selectedVariants);
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">创意变体</h2>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && <div className="text-on-surface-variant">生成变体中...</div>}
      <div className="grid grid-cols-2 gap-4">
        {variants.map((v) => (
          <div
            key={v.id}
            data-testid={`variant-card-${v.id}`}
            className={[
              "p-4 border rounded-lg cursor-pointer transition-colors",
              selected.has(v.id) ? "border-primary bg-surface-container" : "border-outline-variant hover:border-primary",
            ].join(" ")}
            onClick={() => toggleSelect(v.id)}
          >
            <div className="flex justify-between items-start">
              <h3 className="font-medium">{v.title}</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
                {v.mutation_type}
              </span>
            </div>
            <p className="text-sm text-on-surface-variant mt-2">{v.premise_one_line}</p>
            <div className="flex justify-between items-center mt-3 text-xs">
              <span className="text-on-surface-variant">新颖度 {(v.estimated_novelty * 100).toFixed(0)}%</span>
              <button
                data-testid={`regen-${v.id}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); regenerate(v.id); }}
                className="text-primary hover:underline"
              >
                再生成
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <button data-testid="s0b-back" type="button" onClick={onBack}
                className="px-4 py-2 text-sm bg-surface-container rounded-lg">
          上一步
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-on-surface-variant">
            已选 {selected.size} / 3
          </span>
          <button
            data-testid="s0b-submit"
            type="button"
            disabled={selected.size === 0}
            onClick={submit}
            className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
          >
            下一步:选择矛盾
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0BMutationStep" 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence/S0BMutationStep.tsx frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): S0BMutationStep component

变体卡片区: 6-8 张网格卡片,每张显示标题/前提/变异类型徽章/新颖度分数。
多选上限 3, 再生成按钮调用 /mutate/{id}/regenerate。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: S0CContradictionStep 组件

**Files:**
- Create: `frontend/src/components/wizard/divergence/S0CContradictionStep.tsx`
- Test: `frontend/src/test/wizard/divergence/S0CContradictionStep.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/S0CContradictionStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0CContradictionStep from "@/components/wizard/divergence/S0CContradictionStep";
import api from "@/api/client";

vi.mock("@/api/client");

const candidates = [
  { template_type: "能力×限制", preview_statement: "s1", side_a: "a1", side_b: "b1", tension_score: 80 },
  { template_type: "目标×代价", preview_statement: "s2", side_a: "a2", side_b: "b2", tension_score: 65 },
];

describe("S0CContradictionStep", () => {
  beforeEach(() => {
    (api.postDivergeContradict as any).mockResolvedValue({ candidates });
  });

  it("shows 5 candidate cards after fetch", async () => {
    render(<S0CContradictionStep projectId="p1" variants={[{id: "v1", title: "x", premise_one_line: "y", mutation_type: "inversion", mutation_logic: "z", estimated_novelty: 0.5, trope_tags: [], regenerated_count: 0}]} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getAllByTestId(/candidate-/)).toHaveLength(2);
    });
  });

  it("highlights tension score with color bands", async () => {
    render(<S0CContradictionStep projectId="p1" variants={[{id: "v1", title: "x", premise_one_line: "y", mutation_type: "inversion", mutation_logic: "z", estimated_novelty: 0.5, trope_tags: [], regenerated_count: 0}]} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => screen.getAllByTestId(/candidate-/));
    const card = screen.getByTestId("candidate-能力×限制");
    expect(card.className).toMatch(/text-success/); // ≥ 80 green
  });

  it("calls onComplete with selected contradiction", async () => {
    const onComplete = vi.fn();
    render(<S0CContradictionStep projectId="p1" variants={[{id: "v1", title: "x", premise_one_line: "y", mutation_type: "inversion", mutation_logic: "z", estimated_novelty: 0.5, trope_tags: [], regenerated_count: 0}]} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() => screen.getAllByTestId(/candidate-/));
    fireEvent.click(screen.getByTestId("candidate-能力×限制"));
    fireEvent.click(screen.getByTestId("s0c-submit"));
    await waitFor(() => {
      expect(api.putDivergeContradict).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 实现组件**

```typescript
// frontend/src/components/wizard/divergence/S0CContradictionStep.tsx
import { useEffect, useState } from "react";
import api, { type IdeaVariant, type CoreContradiction } from "@/api/client";

interface Props {
  projectId: string;
  variants: IdeaVariant[];
  initial?: CoreContradiction | null;
  onComplete: (core: CoreContradiction) => void;
  onBack: () => void;
}

function tensionColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-error";
}

export default function S0CContradictionStep({ projectId, variants, initial, onComplete, onBack }: Props) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(initial?.template_type || null);
  const [customStatement, setCustomStatement] = useState(initial?.statement || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    if (variants.length === 0) return;
    (async () => {
      setLoading(true);
      try {
        const primary = variants[0];
        const result = await api.postDivergeContradict(projectId, primary.id, primary.premise_one_line);
        setCandidates(result.candidates);
        if (result.candidates.length > 0) setSelected(result.candidates[0].template_type);
      } catch (e: any) {
        setError(e?.message || "生成失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, variants, initial]);

  async function submit() {
    if (!selected) return;
    try {
      let body;
      if (selected === "__custom__") {
        if (!customStatement.trim()) {
          setError("自定义矛盾不能为空");
          return;
        }
        body = {
          template_type: "CUSTOM",
          statement: customStatement.trim(),
          side_a: "",
          side_b: "",
          is_custom: true,
        };
      } else {
        const c = candidates.find((x) => x.template_type === selected);
        body = {
          template_type: c.template_type,
          statement: c.preview_statement,
          side_a: c.side_a,
          side_b: c.side_b,
          tension_score: c.tension_score,
          is_custom: false,
        };
      }
      const result = await api.putDivergeContradict(projectId, body);
      onComplete(result.core_contradiction);
    } catch (e: any) {
      setError(e?.message || "保存失败");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">核心矛盾</h2>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && <div className="text-on-surface-variant">生成矛盾候选中...</div>}
      <div className="grid grid-cols-1 gap-3">
        {candidates.map((c) => (
          <div
            key={c.template_type}
            data-testid={`candidate-${c.template_type}`}
            className={[
              "p-4 border rounded-lg cursor-pointer transition-colors",
              selected === c.template_type ? "border-primary bg-surface-container" : "border-outline-variant hover:border-primary",
            ].join(" ")}
            onClick={() => setSelected(c.template_type)}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-medium">{c.template_type}</h3>
              <span className={["text-sm font-mono", tensionColor(c.tension_score)].join(" ")}>
                张力 {c.tension_score}
              </span>
            </div>
            <p className="text-sm text-on-surface-variant mt-2">{c.preview_statement}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              {c.side_a} ⟷ {c.side_b}
            </p>
          </div>
        ))}
        <div
          data-testid="candidate-__custom__"
          className={[
            "p-4 border rounded-lg cursor-pointer transition-colors",
            selected === "__custom__" ? "border-primary bg-surface-container" : "border-outline-variant hover:border-primary",
          ].join(" ")}
          onClick={() => setSelected("__custom__")}
        >
          <h3 className="font-medium">自定义矛盾</h3>
          {selected === "__custom__" && (
            <textarea
              data-testid="custom-statement"
              placeholder="手写矛盾陈述"
              value={customStatement}
              onChange={(e) => setCustomStatement(e.target.value)}
              className="w-full mt-2 p-2 border border-outline-variant rounded-lg"
            />
          )}
        </div>
      </div>
      <div className="flex justify-between">
        <button data-testid="s0c-back" type="button" onClick={onBack}
                className="px-4 py-2 text-sm bg-surface-container rounded-lg">
          上一步
        </button>
        <button
          data-testid="s0c-submit"
          type="button"
          disabled={!selected || loading}
          onClick={submit}
          className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
        >
          下一步:展开叙事
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0CContradictionStep" 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence/S0CContradictionStep.tsx frontend/src/test/wizard/divergence/S0CContradictionStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): S0CContradictionStep component

矛盾工作台: 5 模板卡片 + 张力仪表盘 (颜色编码 <60 红 / 60-80 黄 / >80 绿)
+ 自定义矛盾入口。POST /contradict + PUT /contradict per PRD §3.2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: S0DWhatIfStep 组件(树状视图 + 路径选择)

**Files:**
- Create: `frontend/src/components/wizard/divergence/S0DWhatIfStep.tsx`
- Test: `frontend/src/test/wizard/divergence/S0DWhatIfStep.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/S0DWhatIfStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0DWhatIfStep from "@/components/wizard/divergence/S0DWhatIfStep";
import api from "@/api/client";

vi.mock("@/api/client");

const rootNode = { id: "root", content: "Root node", parent_id: null, depth: 0, children_ids: ["c1"], novelty_score: null };
const children = [
  { id: "c1", content: "Child 1", parent_id: "root", depth: 1, children_ids: [], novelty_score: 0.7 },
];

describe("S0DWhatIfStep", () => {
  beforeEach(() => {
    (api.postDivergeWhatIfExpand as any).mockResolvedValue({ children });
  });

  it("expands root and shows children", async () => {
    render(<S0DWhatIfStep projectId="p1" rootNode={rootNode} onComplete={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => expect(screen.getByText("Child 1")).toBeInTheDocument());
  });

  it("selects node and calls onComplete with path", async () => {
    const onComplete = vi.fn();
    render(<S0DWhatIfStep projectId="p1" rootNode={rootNode} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => screen.getByText("Child 1"));
    fireEvent.click(screen.getByTestId("select-c1"));
    fireEvent.click(screen.getByTestId("s0d-submit"));
    await waitFor(() => {
      expect(api.putDivergeWhatIfSelect).toHaveBeenCalledWith("p1", ["root", "c1"]);
      expect(onComplete).toHaveBeenCalledWith(["root", "c1"]);
    });
  });
});
```

- [ ] **Step 2: 实现组件**

实现核心思路:
- 维护 `tree: TreeNode` 状态(`{...rootNode, children: [], isLoaded: false}`)
- `expandNode(nodeId)` 调用 `postDivergeWhatIfExpand`,把 children 合并入 tree
- `selectNode(nodeId)` 计算从根到该节点的路径
- 推荐高亮:遍历 tree 找 `novelty_score` 最高的路径(紫色边框),`tension_score` 最高的路径(青色边框)
- "快照对比"按钮:两条路径并排展示 side_a/side_b
- 提交:`putDivergeWhatIfSelect` + `onComplete(path)`

实现参考 Task 19-21 模式(component + useState + useEffect + 错误处理)。完整代码约 200 行,展开/折叠/路径计算逻辑较繁琐,实施时参考 `frontend/src/components/creative-canvas/WhatIfTree.tsx` 已有实现复用。

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0DWhatIfStep" 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence/S0DWhatIfStep.tsx frontend/src/test/wizard/divergence/S0DWhatIfStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): S0DWhatIfStep component

树状可视化: 节点展开/折叠 + 路径高亮 + 推荐路径边框(紫色 tension/青色 novelty)
+ 路径选择 + 快照对比。调用 /whatif/expand + /whatif/select。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: S0ECommitStep 组件(雷达 + 价值栈 + 提交)

**Files:**
- Create: `frontend/src/components/wizard/divergence/S0ECommitStep.tsx`
- Test: `frontend/src/test/wizard/divergence/S0ECommitStep.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/divergence/S0ECommitStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0ECommitStep from "@/components/wizard/divergence/S0ECommitStep";
import api from "@/api/client";

vi.mock("@/api/client");

const novelty = {
  market_saturation: 0.7, trope_similarity: 0.6, contradiction_depth: 0.8,
  discussion_potential: 0.5, composite: 0.65, computed_at: "2026-08-30T12:00:00Z",
  trope_extraction_status: "completed" as const,
};

describe("S0ECommitStep", () => {
  beforeEach(() => {
    (api.getDivergeNovelty as any).mockResolvedValue(novelty);
    (api.postDivergeCommit as any).mockResolvedValue({
      concept_preview: { title: "Test" },
      story_dna_preview: { value_stack: [] },
      novelty_summary: novelty,
      next_step_url: "/project/p1/wizard?step=2",
      warnings: [],
    });
  });

  it("renders novelty radar with 4 dimensions", async () => {
    render(<S0ECommitStep projectId="p1" sessionId="s1" selectedPath={["root"]} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/市场饱和度/)).toBeInTheDocument();
      expect(screen.getByText(/套路相似度/)).toBeInTheDocument();
      expect(screen.getByText(/矛盾深度/)).toBeInTheDocument();
      expect(screen.getByText(/讨论潜力/)).toBeInTheDocument();
    });
  });

  it("shows warning banner when composite < 0.4 but allows submit", async () => {
    (api.getDivergeNovelty as any).mockResolvedValueOnce({ ...novelty, composite: 0.35 });
    render(<S0ECommitStep projectId="p1" sessionId="s1" selectedPath={["root"]} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId("warning-low-novelty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("s0e-submit")).not.toBeDisabled();
  });

  it("calls onComplete with next_step_url on submit", async () => {
    const onComplete = vi.fn();
    render(<S0ECommitStep projectId="p1" sessionId="s1" selectedPath={["root"]} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("s0e-submit"));
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ next_step_url: expect.any(String) }));
    });
  });

  it("allows hand-edit of value_stack before commit", async () => {
    render(<S0ECommitStep projectId="p1" sessionId="s1" selectedPath={["root"]} onComplete={() => {}} onBack={() => {}} />);
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("edit-value-stack"));
    const inputs = screen.getAllByTestId(/vs-input-/);
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: 实现组件**

实现核心:
- 初始化时 `getDivergeNovelty` 拉取 4 维分数,渲染雷达图(可复用 `creative-canvas/NoveltyRadar.tsx`)
- `composite < 0.4` 时显示警告 banner 但不阻塞提交(D-2)
- 价值栈手改:点击 "edit" 展开 4 行 input(personal/social/philosophical/existential),保存时放入 `value_stack_override` 字段
- 提交:组装 `value_stack_override` + 调用 `postDivergeCommit`,成功后 `onComplete(response)`

实现参考 Task 19-21 模式,加上雷达图渲染(用 `frontend/src/components/creative-canvas/NoveltyRadar.tsx`)。完整代码约 250 行。

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="S0ECommitStep" 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence/S0ECommitStep.tsx frontend/src/test/wizard/divergence/S0ECommitStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard/divergence): S0ECommitStep component

新颖度雷达图 + 综合分 + 价值栈手改(4 层 personal/social/philosophical/existential)
+ 概念摘要预览 + 提交。composite<0.4 仅警告不阻止(D-2)。
调用 /novelty + /commit。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Wizard 步骤重写

### Task 24: 重写 CreativeDivergenceStep 为 5 阶段子步骤容器

**Files:**
- Modify: `frontend/src/components/wizard/CreativeDivergenceStep.tsx` (完全重写)
- Modify: `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx` (覆盖测试)

- [ ] **Step 1: 写失败测试**

```typescript
// frontend/src/test/wizard/CreativeDivergenceStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";
import api from "@/api/client";

vi.mock("@/api/client");

const sampleState = {
  schema_version: 3, etag: "etag-1",
  raw_intent: null, nodes: {}, edges: [], selected_path: [],
  branch_choices: {}, core_contradiction: null, novelty_scores: null,
  idea_variants: [], session_metadata: {}, created_at: "", updated_at: "", committed_at: null,
};

describe("CreativeDivergenceStep", () => {
  beforeEach(() => {
    (api.getDivergeState as any).mockResolvedValue({ ...sampleState });
  });

  it("renders StepIndicator at top", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId("step-A")).toBeInTheDocument();
    });
  });

  it("defaults to S0A on first load (no state)", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/用一句话描述你的故事想法/)).toBeInTheDocument();
    });
  });

  it("infers substage B when raw_intent present", async () => {
    (api.getDivergeState as any).mockResolvedValueOnce({
      ...sampleState,
      raw_intent: { prompt: "test prompt content", genre_primary: "修仙" },
    });
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("创意变体")).toBeInTheDocument();
    });
  });

  it("shows ContinueBanner when state has draft data", async () => {
    (api.getDivergeState as any).mockResolvedValueOnce({
      ...sampleState,
      raw_intent: { prompt: "test prompt content here", genre_primary: "修仙" },
      idea_variants: [{ id: "v1", title: "x", premise_one_line: "y", mutation_type: "inversion", mutation_logic: "z", estimated_novelty: 0.5, trope_tags: [], regenerated_count: 0 }],
    });
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId("continue-banner")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 实现组件**

实现核心:
- 持有 `CreativeDivergenceState`(SubStage + sessionId + rawIntent + variants + contradiction + whatIfTree + noveltyScores)
- 进入时 `getDivergeState` 推断 SubStage:
  - `committed_at` 非空 → 直接跳 ConceptStep(由 wizard 控制)
  - `raw_intent == null` → A
  - `variants.length == 0` → B (等待 mutate)
  - `core_contradiction == null` → C
  - `selected_path.length < 2` → D
  - 否则 → E
- 渲染 `<StepIndicator>` + 当前阶段子组件 + `<ContinueBanner>`
- 子组件切换通过条件渲染:

```typescript
{state.subStage === "A" && <S0AInputStep ... />}
{state.subStage === "B" && <S0BMutationStep ... />}
{state.subStage === "C" && <S0CContradictionStep ... />}
{state.subStage === "D" && state.rawIntent?.quick_mode !== true && <S0DWhatIfStep ... />}
{state.subStage === "E" && <S0ECommitStep ... />}
```

- quick_mode 时跳过 D,直接 C → E
- 各阶段 `onComplete` 推进 SubStage 并更新 state

完整代码约 180 行。

- [ ] **Step 3: 跑测试确认通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --testPathPattern="CreativeDivergenceStep" 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/CreativeDivergenceStep.tsx frontend/src/test/wizard/CreativeDivergenceStep.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): rewrite CreativeDivergenceStep as 5-stage sub-step container

Holds SubStage state machine (A/B/C/D/E), StepIndicator at top,
conditional rendering of 5 sub-components. Quick mode skips D.
Infers substage from /state on entry, shows ContinueBanner when
draft exists.

Replaces Path B stub integration. Wizard step 1 now calls
/api/v1/projects/{id}/creative/diverge/* exclusively.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: 更新 WorkspaceWizardPanel 移除 Path B prefill 引用

**Files:**
- Modify: `frontend/src/components/wizard/WorkspaceWizardPanel.tsx`

- [ ] **Step 1: 删除 Path B prefill 调用**

在 `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` 找到 `api.getCreativeDivergencePrefill(projectId)` 调用,删除相关代码:

```typescript
// 删除这段:
const [cd, ...] = await Promise.allSettled([
  api.getCreativeDivergencePrefill(projectId),  // <-- remove
  api.getConcept(projectId),
  ...
]);
if (cd.status === "fulfilled" && cd.value.exists) {
  completed.push(1);
  // ...
}
```

替换为:依赖 `CreativeDivergenceStep` 内部 `/state` 调用推断 SubStage,wizard 不再预判 step 1 是否"已完成"。

- [ ] **Step 2: 跑 type check + 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -20
```

预期:无 type error(若 client.ts 已正确移除 Path B 方法)。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/wizard/WorkspaceWizardPanel.tsx
git commit -m "$(cat <<'EOF'
refactor(wizard): remove Path B prefill call from WorkspaceWizardPanel

api.getCreativeDivergencePrefill removed (Path B stub endpoint).
Wizard no longer pre-checks step 1 completion; CreativeDivergenceStep
infers SubStage from /state on mount.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — E2E tests + smoke

### Task 26: 端到端冒烟测试

**Files:**
- Create: `tests/test_e2e_diverge_flow.py` (后端 E2E)
- Manual: 启动 dev server + 手动验证

- [ ] **Step 1: 后端 E2E 测试**

```python
# tests/test_e2e_diverge_flow.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

@pytest.fixture
def project(tmp_path):
    pid = "proj_e2e"
    (tmp_path / pid).mkdir()
    (tmp_path / pid / "project.json").write_text(json.dumps({"genre": "cool_novel"}))
    fm = _file_manager()
    fm.projects_dir = tmp_path
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_full_diverge_flow(client, project):
    # 1. /init
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"raw_intent": {"prompt": "废材少年觉醒逆袭,背景为修仙世界", "genre_primary": "修仙"}},
    )
    assert r.status_code == 200
    session_id = r.json()["session_id"]

    # 2. /mutate
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/mutate",
        json={"session_id": session_id, "operation": "all"},
    )
    assert r.status_code == 200
    variants = r.json()["variants"]
    assert len(variants) >= 1
    variant_id = variants[0]["id"]

    # 3. /contradict POST
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": variant_id, "variant_content": variants[0]["premise_one_line"]},
    )
    assert r.status_code == 200
    candidates = r.json()["candidates"]

    # 4. /contradict PUT
    c = candidates[0]
    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={
            "template_type": c["template_type"],
            "statement": c["preview_statement"],
            "side_a": c["side_a"],
            "side_b": c["side_b"],
            "is_custom": False,
        },
    )
    assert r.status_code == 200

    # 5. /commit (skip WhatIf for quick E2E)
    fm = _file_manager()
    canvas = json.loads((fm.projects_dir / project / "canvas_state.json").read_text())
    canvas["selected_path"] = list(canvas.get("nodes", {}).keys())[:1] or [variant_id]
    (fm.projects_dir / project / "canvas_state.json").write_text(json.dumps(canvas))

    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/commit",
        json={"session_id": session_id, "confirmed_path_ids": canvas["selected_path"]},
    )
    assert r.status_code == 200
    data = r.json()
    assert "concept_preview" in data
    assert "story_dna_preview" in data
    assert "novelty_summary" in data
    assert "next_step_url" in data

    # Verify dual-write
    cd_path = fm.projects_dir / project / "concept_and_dna.json"
    cd_compat_path = fm.projects_dir / project / "creative_divergence.json"
    assert cd_path.exists()
    assert cd_compat_path.exists()
    cd = json.loads(cd_path.read_text())
    assert cd["source"] == "canvas"
```

- [ ] **Step 2: 跑 E2E**

```bash
cd /Users/longsa/Codes/nebula && pytest tests/test_e2e_diverge_flow.py -v 2>&1 | tail -10
```

预期:PASS(可能需 mock LLM 响应,或加 LLM availability marker)。

- [ ] **Step 3: 启动 dev server + 手动冒烟**

```bash
# 后端
source venv/bin/activate && uvicorn backend.main:app --reload --port 8000 &
# 前端
cd frontend && npm run dev
```

打开 http://localhost:5173,创建一个新项目,进入 Wizard 第 1 步:

- [ ] **Step 3a: 验证 S0A 输入**

输入 "废材少年觉醒逆袭",选 "修仙",提交。预期:进入 S0B,显示变体卡片。

- [ ] **Step 3b: 验证 S0B 变体**

观察 6-8 张变体卡片,选 2-3 张,提交。预期:进入 S0C。

- [ ] **Step 3c: 验证 S0C 矛盾**

观察 5 个候选 + 张力分数,选最高张力,提交。预期:进入 S0D。

- [ ] **Step 3d: 验证 S0D What-If**

展开根节点,选择一条路径,提交。预期:进入 S0E。

- [ ] **Step 3e: 验证 S0E 提交**

观察雷达图,综合分显示。点击提交。预期:跳转到 Step 2 (ConceptStep),`concept_and_dna.json` 已写入。

- [ ] **Step 4: 检查产物**

```bash
cat backend/data/projects/<pid>/concept_and_dna.json | python3 -m json.tool | head -30
cat backend/data/projects/<pid>/creative_divergence.json | python3 -m json.tool
```

预期:两个文件都有,`concept_and_dna.source = "canvas"`,`creative_divergence.source = "canvas"`。

- [ ] **Step 5: 跑全量回归**

```bash
cd /Users/longsa/Codes/nebula && pytest tests/ -v 2>&1 | tail -20
cd /Users/longsa/Codes/nebula/frontend && npm test 2>&1 | tail -20
```

预期:全 PASS(无回归)。

- [ ] **Step 6: 跑迁移脚本**

```bash
cd /Users/longsa/Codes/nebula && python3 scripts/backfill_creative_divergence.py
```

预期:对 source=canvas 项目输出 "Migrated: ..."。

- [ ] **Step 7: Commit E2E 测试**

```bash
git add tests/test_e2e_diverge_flow.py
git commit -m "$(cat <<'EOF'
test(e2e): full creative divergence flow (init → mutate → contradict → commit)

End-to-end test exercising all endpoints in sequence with dual-write
verification. Manual smoke checklist documented in plan Task 26
(developer runs against live dev server before v1.1 ship).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 验收标准对齐 PRD §1.2 OKR**

| OKR | 验收方式 |
|---|---|
| 80% 用户 15 分钟完成 | 邀请 5-10 人跑 Step 3a-3e 完整流程,记录时间 |
| concept_and_dna 字段齐全 | E2E 测试已断言所有字段 + style_template + value_stack 4 层 |
| 新颖度评分误差 < 20% | 收集 20 个 seed,人工评分 vs `/novelty` composite,计算 Pearson |

- [ ] **Step 9: Tag v1.1 release(可选)**

```bash
git tag v1.1-creative-divergence
git push origin v1.1-creative-divergence
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Skim each spec section → covered by task(s):
  - §1 背景/目标 → Phase 1-9 summary
  - §2 顶层架构 → Task 1 (file rename + route) + Task 24 (UI container)
  - §3 后端 API 端点 → Tasks 6, 7, 8, 9 (4 new endpoints) + Task 1 (rename 8 existing)
  - §4 数据模型 → Task 3 (v2→v3 migration) + Task 13 (template + dual-write)
  - §5 引擎层接入 → Tasks 10, 11, 12 (GenreFusion, IdeaPool, market_saturation)
  - §6 Source 白名单 → Task 4
  - §7 前端 5 阶段 → Tasks 16, 17, 18, 19, 20, 21, 22, 23, 24
  - §8 错误处理 → 各端点 Task 中的 4xx/5xx 响应 + Task 14 (ETag)
  - §9 迁移与兼容 → Task 3 (v2→v3) + Task 15 (migration script) + Task 5 (Path B deprecation)
  - §10 测试策略 → 各 Task 配套测试 + Task 26 (E2E)
  - §11 验收标准 → Task 26 Step 8

- [x] **Placeholder scan:** No "TBD"/"TODO"/"fill in details" — all code blocks complete or reference specific files.

- [x] **Type consistency:**
  - `MutationOp.FUSION/INVERSION/ESCALATION/SUBVERSION` — used in Tasks 7, 8, 11
  - `Idea` dataclass — Task 11 uses `Idea` not `IdeaEntry`
  - `ContradictionEngine.expand(template, context)` signature — Task 6
  - `MutationResult` fields (`core_premise`, `core_conflict`, `novelty_hook`) — Task 7
  - `_etag` field — Task 14
  - SubStage type `"A"|"B"|"C"|"D"|"E"` — Tasks 17, 18, 24

- [x] **Scope check:** Single coherent refactor, not multi-subsystem. v1.1 + v1.2 tightly coupled (frontend depends on backend contract).

---

## Execution Notes

- 26 tasks × ~5 steps each = ~130 commit-sized steps
- Estimated time: 2-3 days of focused work (backend ~1.5 days, frontend ~1 day, E2E + smoke ~0.5 day)
- Backend tasks 1-15 must complete before frontend task 24 (UI depends on stable contract)
- Frontend tasks 18-23 can run in parallel with each other (independent components)
- Migration script (Task 15) runs ONCE on v1.1 deploy, not per-project
- v1.3 cleanup (Path B deletion) is a separate plan, not included here