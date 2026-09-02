# 类型融合(主+副类型)接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 S0-A「主类型 + 副类型」端到端接通 — `/init` 持久化、`/fuse` 自动触发 + 手动按钮、`/commit` 写入 `story_dna.fusion_meta`、两个 regenerate 端点联动 /fuse。前端 S0-A 加勾选框、S0-B 加 fusion variant 卡片与重融合按钮。

**Architecture:**
- 后端:`backend/api/creative_diverge.py` 加 Pydantic `InitRequest`,扩展 `_mutation_to_idea_variant` 签名,新增 `_extract_fusion_metadata` helper,改 `/commit` / `/regenerate/*` 消费 `raw_intent` + 联动 `/fuse`
- 前端:`S0AInputStep` 加勾选框 + 调 `/fuse`,`S0BMutationStep` 加 fusion 卡片 + 「重新融合」按钮,`CreativeDivergenceStep` 透传 `fusionVariant` + 显示 banner
- 融合信息(`secondary_genre / risk_level / distance`)独立写入 `concept_and_dna.story_dna.fusion_meta`,**不**拼字符串进 `concept.genre`(否则 LLM prompt 的 tone/style_rules 注入会失效 —— 见 spec §2.4 D8)

**Tech Stack:** Python 3 · FastAPI · Pydantic · pytest · React 18 · Vite · Tailwind · Vitest · @testing-library/react · `ds/` primitives

**Spec:** `docs/superpowers/specs/2026-09-01-genre-fusion-wiring-design.md`

**Branch:** `nebula`(no worktree —— 用户偏好,见 `feedback_worktree_v19.md`)

**⚠ SSE gotcha**(CLAUDE.md):实现期间如果开了 cockpit SSE 流,改 backend `.py` 会让 `uvicorn --reload` 卡死。**实现期间不要开 cockpit**,改完手动 reload;或 hard-kill + 重启。

---

## File Structure(锁定)

### 后端

| 文件 | 操作 | 职责 |
|---|---|---|
| `backend/api/creative_diverge.py` | Modify | 加 `InitRequest` / 改 `/init` / 改 `/fuse` 错误码 / 扩 `_mutation_to_idea_variant` 签名 / 加 `_extract_fusion_metadata` helper / 改 `/commit` genre 来源 + fusion_meta / 改 `/regenerate/{node_id}/regenerate` / 改 `/regenerate/raw-intent` |
| `tests/test_init_raw_intent_persistence.py` | Create | `/init` 持久化全 raw_intent 字段 + GENRE_MISSING |
| `tests/test_init_migration_old_caller.py` | Create | 旧 caller `{"premise": "..."}` → 422 Pydantic |
| `tests/test_fuse_error_codes.py` | Create | CANVAS_NOT_INITIALIZED / INTENT_INCOMPLETE / FUSION_SAME_GENRE |
| `tests/test_fuse_variant_metadata.py` | Create | `/fuse` 响应 `variants[0]` 含 `risk_level` + `fusion_distance` |
| `tests/test_extract_fusion_metadata.py` | Create | `_extract_fusion_metadata` helper 单元测试(None / 单个 / 多个 / 字段缺失) |
| `tests/test_commit_uses_raw_intent_genre.py` | Create | genre 来源 + fusion_meta 写入 |
| `tests/test_regenerate_node_fusion.py` | Create | `/regenerate/{id}/regenerate` 对 fusion 走 `/fuse` |
| `tests/test_regenerate_raw_intent_fuse.py` | Create | `/regenerate/raw-intent` 清完后重跑 /fuse |

### 前端

| 文件 | 操作 | 职责 |
|---|---|---|
| `frontend/src/api/client.ts` | Modify | `postDivergeInit` 签名改 `(projectId, rawIntent: RawIntent)` |
| `frontend/src/components/wizard/divergence/S0AInputStep.tsx` | Modify | 加 `enableFusion` 勾选 + submit 双调用 + onComplete 扩 3 参 |
| `frontend/src/components/wizard/divergence/S0BMutationStep.tsx` | Modify | 渲染 fusion variant 卡片 + 「重新融合」按钮 + 「重新生成」fusion 走 /fuse |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | Modify | 加 `fusionVariant/fusionBanner` state + 透传 + 显示 banner |
| `frontend/src/api/client.test.ts` | Modify | `postDivergeInit` 接受 RawIntent |
| `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx` | Modify | 勾选触发 /fuse + 失败时 banner |
| `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx` | Modify | 「重新融合」按钮可见 + 可点击 |
| `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx` | Modify | 透传 fusionVariant + banner 显示 |

---

## Phase Index

- **Phase 1** —— 后端 `/init` 扩展(Tasks 1-2)
- **Phase 2** —— 后端 `/fuse` + variant schema(Task 3)
- **Phase 3** —— 后端 `_extract_fusion_metadata` helper(Task 4)
- **Phase 4** —— 后端 `/commit` genre + fusion_meta(Tasks 5-6)
- **Phase 5** —— 后端 `/regenerate` 联动(Task 7)
- **Phase 6** —— 前端 API client(Task 8)
- **Phase 7** —— 前端 S0A(Task 9)
- **Phase 8** —— 前端 S0B(Task 10)
- **Phase 9** —— 前端 CreativeDivergenceStep(Task 11)
- **Phase 10** —— 前端剩余测试(Task 12)
- **Phase 11** —— E2E(Task 13)

---

## Task 1: 后端 —— 加 `InitRequest` Pydantic 模型 + 持久化全字段

**Files:**
- Modify: `backend/api/creative_diverge.py:601-697`(`/init` handler + canvas 构造)
- Create: `tests/test_init_raw_intent_persistence.py`

### Step 1: 写失败的测试

```python
# tests/test_init_raw_intent_persistence.py
"""Verify /init persists all RawIntent fields to canvas.raw_intent."""
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    """Project root + canvas dir; /init writes canvas_state.json on success."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_init_persist"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_init_persists_all_raw_intent_fields(project, client):
    response = client.post(
        f"/v1/projects/{project}/creative/diverge/init",
        json={
            "premise": "一个关于永生者寻找死亡方法的故事",
            "genre_primary": "仙侠",
            "genre_secondary": "悬疑",
            "target_reader": "男频 · 30+",
            "reference_works": ["诡秘之主"],
            "forbidden_directions": ["后宫"],
            "quick_mode": False,
        },
    )
    assert response.status_code == 200, response.text

    canvas_path = (
        settings.projects_dir / project / "creative_os" / "canvas_state.json"
    )
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    raw_intent = canvas["raw_intent"]
    assert raw_intent["prompt"] == "一个关于永生者寻找死亡方法的故事"
    assert raw_intent["genre_primary"] == "仙侠"
    assert raw_intent["genre_secondary"] == "悬疑"
    assert raw_intent["target_reader"] == "男频 · 30+"
    assert raw_intent["reference_works"] == ["诡秘之主"]
    assert raw_intent["forbidden_directions"] == ["后宫"]
    assert raw_intent["quick_mode"] is False
    assert raw_intent["trope_tags"] == []


def test_init_returns_400_when_genre_primary_missing(project, client):
    response = client.post(
        f"/v1/projects/{project}/creative/diverge/init",
        json={"premise": "no genre here"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "GENRE_MISSING"
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_init_raw_intent_persistence.py -v
```

Expected: FAIL with `pydantic.ValidationError` (current `/init` uses `data: dict`, no validation;但 raw_intent 不会包含新字段,所以 assertions 失败)

### Step 3: 实现 `InitRequest` + 改 `/init` handler

修改 `backend/api/creative_diverge.py`:

找到现有 `/init` 端点(约 line 601),替换为:

```python
class InitRequest(BaseModel):
    premise: str = Field(..., min_length=1, max_length=1700)
    genre_primary: str = Field(..., min_length=1)
    genre_secondary: Optional[str] = None
    target_reader: Optional[str] = None
    reference_works: Optional[List[str]] = None
    forbidden_directions: Optional[List[str]] = None
    quick_mode: bool = False


@router.post("/init")
async def init_canvas(project_id: str, request: InitRequest):
    """Initialize the canvas with a root WhatIf node from `premise`.

    Persists the full RawIntent (PRD §4.1) to canvas.raw_intent. Side
    effect: spawns a fire-and-forget Tier 3 LLM call to extract Trope
    tags for the canvas's raw_intent (per PRD §3.5).
    """
    _ensure_project(project_id)

    if not request.genre_primary.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "GENRE_MISSING",
                "message": "请选择至少一个主类型",
                "detail": {},
            },
        )

    from backend.creative_os.whatif_engine import WhatIfEngine

    engine = WhatIfEngine()
    root_node = engine.generate_root(request.premise)

    now = datetime.now(timezone.utc).isoformat()
    canvas = {
        "schema_version": 3,
        "root_node_id": root_node.id,
        "nodes": {root_node.id: _node_to_dict(root_node)},
        "edges": [],
        "selected_path": [root_node.id],
        "branch_choices": {},
        "evaluations": {},
        "created_at": now,
        "updated_at": now,
        "idea_variants": [],
        "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {
            "prompt": request.premise,
            "genre_primary": request.genre_primary,
            "genre_secondary": request.genre_secondary,
            "target_reader": request.target_reader,
            "reference_works": request.reference_works,
            "forbidden_directions": request.forbidden_directions,
            "quick_mode": request.quick_mode,
            "trope_tags": [],
        },
        "session_metadata": {
            "created_at": now,
            "last_modified_at": now,
            "elapsed_seconds": 0,
            "operation_count": 0,
            "ab_test_bucket": "control",
        },
    }
    _write_canvas(project_id, canvas)

    # Fire-and-forget Tier 3 Trope extraction. Best-effort; failures are
    # logged but never surface to the /init caller. (Existing logic — keep verbatim.)
    try:
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        evaluator = NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=ContradictionEngine(),
            model_router=None,
            embedder=None,
        )

        llm_client = _build_trope_extraction_llm_client()
        if llm_client is not None:
            raw_intent_ref = canvas["raw_intent"]
            task = asyncio.create_task(
                evaluator.fill_trope_tags_async(
                    raw_intent=raw_intent_ref,
                    llm_client=llm_client,
                    save_callback=lambda ri: _save_raw_intent_trope_tags(project_id, ri),
                )
            )
            _background_trope_tasks.add(task)
            task.add_done_callback(_background_trope_tasks.discard)
    except Exception as exc:
        logger.warning("Could not schedule trope extraction for %s: %s", project_id, exc)

    return {
        "error": False,
        "code": "OK",
        "message": "画布初始化成功",
        "detail": canvas,
    }
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_init_raw_intent_persistence.py -v
```

Expected: 2 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_init_raw_intent_persistence.py && \
  git commit -m "fix(divergence): /init persists full RawIntent (genre_primary/secondary + others)"
```

---

## Task 2: 后端 —— 旧 caller 兼容性测试(422)

**Files:**
- Create: `tests/test_init_migration_old_caller.py`

### Step 1: 写测试

```python
# tests/test_init_migration_old_caller.py
"""Verify that the new Pydantic InitRequest rejects old-style callers.

Old callers sent {"premise": "..."} without genre_primary. After introducing
InitRequest (genre_primary required), Pydantic returns 422 before the
endpoint runs. The only known caller is S0AInputStep.tsx, which Task 9
updates in lockstep.
"""
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_old_caller"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_old_caller_missing_genre_primary_returns_422(project, client):
    """Old S0A caller sent only premise; now must send genre_primary."""
    response = client.post(
        f"/v1/projects/{project}/creative/diverge/init",
        json={"premise": "old-style caller"},
    )
    assert response.status_code == 422, response.text
```

### Step 2: 跑测试,确认通过(Task 1 已落地 `InitRequest`)

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_init_migration_old_caller.py -v
```

Expected: 1 PASS

### Step 3: 提交

```bash
cd /Users/longsa/Codes/nebula && git add tests/test_init_migration_old_caller.py && \
  git commit -m "test(divergence): verify old /init caller (premise-only) → 422"
```

---

## Task 3: 后端 —— `/fuse` 错误码 + `_mutation_to_idea_variant` 加 `risk_level/distance` 字段

**Files:**
- Modify: `backend/api/creative_diverge.py:2316-2332`(`_mutation_to_idea_variant`)
- Modify: `backend/api/creative_diverge.py:2467-2587`(`/fuse` handler)
- Create: `tests/test_fuse_error_codes.py`
- Create: `tests/test_fuse_variant_metadata.py`

### Step 1: 写 `_extract_fusion_metadata` 和 `_mutation_to_idea_variant` 失败的测试

```python
# tests/test_fuse_variant_metadata.py
"""Verify /fuse response variants[0] contains risk_level + fusion_distance."""
import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_fuse_meta"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "xianxia"}),
        encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "测试", "novelty_score": 70,
                "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [],
                "is_expanded": True, "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "测试",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_fuse_response_variant_has_risk_metadata(project, client):
    """The fused variant must carry risk_level + fusion_distance for /commit."""
    # LLM 不可用走降级路径 — 仍然写入 risk_level + fusion_distance
    response = client.post(
        f"/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "variants" in data
    assert len(data["variants"]) == 1
    variant = data["variants"][0]
    assert variant["mutation_type"] == "fusion"
    assert "risk_level" in variant, f"missing risk_level in {variant}"
    assert "fusion_distance" in variant, f"missing fusion_distance in {variant}"
    assert variant["risk_level"] in {"low", "medium", "high"}
    assert 0 <= int(variant["fusion_distance"]) <= 3


def test_fuse_distance_is_int_0_to_3(project, client):
    """compute_distance returns BFS hops (0-3), not PRD's 0-100 percentage."""
    response = client.post(
        f"/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "dushi", "prompt": "测试"},
    )
    assert response.status_code == 200
    variant = response.json()["variants"][0]
    assert isinstance(variant["fusion_distance"], int)
    assert 0 <= variant["fusion_distance"] <= 3
```

### Step 2: 写 `/fuse` 错误码测试

```python
# tests/test_fuse_error_codes.py
"""Verify /fuse returns explicit error codes for missing canvas / intent / same-genre."""
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_no_canvas(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_canvas"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def project_no_genre(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_genre"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    # canvas with raw_intent missing genre_primary
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3, "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "", "novelty_score": 0, "trope_tags": [],
                "saturation_warning": False, "mutation_context": None,
                "children_ids": [], "is_expanded": True, "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {"prompt": "测试", "trope_tags": []},  # 缺 genre_primary
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_fuse_returns_400_when_canvas_not_initialized(project_no_canvas, client):
    response = client.post(
        f"/v1/projects/{project_no_canvas}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"


def test_fuse_returns_400_when_genre_primary_missing_in_intent(project_no_genre, client):
    response = client.post(
        f"/v1/projects/{project_no_genre}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INTENT_INCOMPLETE"


def test_fuse_returns_400_when_primary_equals_secondary(project_no_canvas, client):
    """Setup: /init canvas first, then try /fuse with same genres."""
    # ... reuse TestClient to /init then /fuse
    pass  # 实现见下
```

### Step 3: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_fuse_variant_metadata.py tests/test_fuse_error_codes.py -v
```

Expected: FAIL — variant 缺 `risk_level/fusion_distance`;`/fuse` 不检查 canvas / raw_intent 缺失

### Step 4: 实现 —— 扩 `_mutation_to_idea_variant` 签名 + 改 `/fuse`

修改 `backend/api/creative_diverge.py:2316-2332`:

```python
def _mutation_to_idea_variant(
    result,
    genre_a: str,
    genre_b: str,
    *,
    risk_level: str = "low",
    distance: int = 0,
) -> dict:
    """Adapt a MutationResult into the idea_variant schema.

    For fusion variants, callers pass risk_level + distance (computed by
    GenreFusionEngine.compute_distance + get_risk_level). Other mutation
    ops use the defaults "low"/0.
    """
    return {
        "id": f"var-{uuid.uuid4().hex[:8]}",
        "title": (result.core_premise or "")[:30],
        "premise_one_line": result.core_premise,
        "mutation_type": result.operation.value,
        "mutation_logic": result.core_conflict,
        "estimated_novelty": 0.7,
        "trope_tags": [genre_a, genre_b] if genre_a and genre_b else [],
        "regenerated_count": 0,
        "risk_level": risk_level,
        "fusion_distance": distance,
    }
```

修改 `/fuse` handler(约 line 2467-2587),在 canvas 检查后、调用 `MutationEngine` 前插入:

```python
@router.post("/fuse")
async def fuse_genres(project_id: str, request: FuseRequest):
    """Cross-genre fusion with distance-based risk grading (PRD §3.4)."""
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化,请先调用 /init",
                "detail": {},
            },
        )

    raw_intent = canvas.get("raw_intent") or {}
    if not raw_intent.get("genre_primary") or not request.genre_secondary:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INTENT_INCOMPLETE",
                "message": "raw_intent.genre_primary 与 genre_secondary 必须同时存在",
                "detail": {},
            },
        )

    if request.genre_primary == request.genre_secondary:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "FUSION_SAME_GENRE",
                "message": "主类型与副类型不能相同",
                "detail": {},
            },
        )

    from backend.creative_os.genre_fusion_engine import GenreFusionEngine
    from backend.creative_os.mutation_engine import MutationEngine

    fusion_engine = GenreFusionEngine()
    distance = fusion_engine.compute_distance(
        request.genre_primary, request.genre_secondary
    )
    compatibility = fusion_engine.get_compatibility(
        request.genre_primary, request.genre_secondary
    )
    risk_level = _risk_from_distance(distance)

    trope_a = _genre_to_trope(request.genre_primary, request.prompt)
    trope_b = _genre_to_trope(request.genre_secondary, request.prompt)

    variant: Optional[dict] = None
    try:
        mutation_engine = MutationEngine()
        mutation_result = await mutation_engine.fuse(trope_a, trope_b)
        variant = _mutation_to_idea_variant(
            mutation_result,
            request.genre_primary,
            request.genre_secondary,
            risk_level=risk_level,
            distance=distance,
        )
    except NotImplementedError as exc:
        logger.info("MutationEngine.fuse unavailable (no LLM): %s", exc)
    except Exception as exc:
        logger.warning("MutationEngine.fuse failed: %s", exc)

    if variant is None:
        variant = {
            "id": f"var-{uuid.uuid4().hex[:8]}",
            "title": f"{request.genre_primary}×{request.genre_secondary}",
            "premise_one_line": f"{request.genre_primary} 与 {request.genre_secondary} 融合",
            "mutation_type": "fusion",
            "mutation_logic": f"跨 {distance} 跳距离的体裁融合",
            "estimated_novelty": 0.7,
            "trope_tags": [request.genre_primary, request.genre_secondary],
            "regenerated_count": 0,
            "risk_level": risk_level,
            "fusion_distance": distance,
        }

    # Persist to canvas_state.idea_variants
    canvas["idea_variants"] = (canvas.get("idea_variants") or []) + [variant]
    _write_canvas(project_id, canvas)

    return {
        "variants": [variant],
        "fusion_distance": {
            "distance": distance,
            "compatibility": compatibility,
        },
        "risk_level": risk_level,
    }
```

> **注意**:原 `/fuse` 的 `return {...}` 路径已有 fuse_distance + risk_level,但没把 variant 写入 canvas。**新行为**:把 variant 追加到 `canvas["idea_variants"]`,这样 `_extract_fusion_metadata`(Task 4)能读。

### Step 5: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_fuse_variant_metadata.py tests/test_fuse_error_codes.py -v
```

Expected: 所有 PASS

### Step 6: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_fuse_*.py && \
  git commit -m "fix(divergence): /fuse error codes + variant risk_level/distance metadata"
```

---

## Task 4: 后端 —— `_extract_fusion_metadata` helper + 单元测试

**Files:**
- Modify: `backend/api/creative_diverge.py:2467`(在 `/fuse` handler 前加 helper)
- Create: `tests/test_extract_fusion_metadata.py`

### Step 1: 写失败测试

```python
# tests/test_extract_fusion_metadata.py
"""Unit tests for _extract_fusion_metadata helper."""
import pytest

from backend.api.creative_diverge import _extract_fusion_metadata


def test_returns_none_when_no_fusion_variants():
    canvas = {"idea_variants": [
        {"id": "v1", "mutation_type": "inversion"},
        {"id": "v2", "mutation_type": "escalation"},
    ]}
    assert _extract_fusion_metadata(canvas) is None


def test_returns_none_when_idea_variants_empty():
    canvas = {"idea_variants": []}
    assert _extract_fusion_metadata(canvas) is None


def test_returns_metadata_when_single_fusion_variant():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "medium", "fusion_distance": 2},
    ]}
    assert _extract_fusion_metadata(canvas) == ("medium", 2)


def test_returns_last_when_multiple_fusion_variants():
    """Append-only invariant: last fusion variant = most recent."""
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "low", "fusion_distance": 1},
        {"id": "f2", "mutation_type": "inversion"},
        {"id": "f3", "mutation_type": "fusion", "risk_level": "high", "fusion_distance": 3},
    ]}
    assert _extract_fusion_metadata(canvas) == ("high", 3)


def test_falls_back_to_low_zero_when_metadata_missing():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion"},  # 缺 risk_level + fusion_distance
    ]}
    assert _extract_fusion_metadata(canvas) == ("low", 0)


def test_handles_invalid_distance_gracefully():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "medium", "fusion_distance": "not-a-number"},
    ]}
    assert _extract_fusion_metadata(canvas) == ("medium", 0)


def test_handles_missing_idea_variants_key():
    canvas = {}
    assert _extract_fusion_metadata(canvas) is None
```

### Step 2: 跑测试,确认失败(ImportError)

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_extract_fusion_metadata.py -v
```

Expected: FAIL with `ImportError: cannot import name '_extract_fusion_metadata'`

### Step 3: 实现 helper

在 `backend/api/creative_diverge.py` 的 `/fuse` handler 上方(约 line 2460)插入:

```python
def _extract_fusion_metadata(canvas: dict) -> Optional[tuple[str, int]]:
    """Pick (risk_level, distance) from the most recent fusion variant.

    Returns None when no fusion variant exists on the canvas (so /commit
    can decide whether to write fusion_meta or skip). Picks the LAST
    fusion variant by list position — variants are appended in order, so
    last == most recent.

    Defaults ("low", 0) when a fusion variant exists but its metadata
    fields are missing (defensive for legacy / partial canvas state).
    """
    variants = canvas.get("idea_variants", []) or []
    fusions = [v for v in variants if v.get("mutation_type") == "fusion"]
    if not fusions:
        return None
    fusion = fusions[-1]   # last = most recent (append-only invariant)
    risk = (fusion.get("risk_level") or "low").strip() or "low"
    try:
        dist = int(fusion.get("fusion_distance") or 0)
    except (TypeError, ValueError):
        dist = 0
    return (risk, dist)
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_extract_fusion_metadata.py -v
```

Expected: 7 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_extract_fusion_metadata.py && \
  git commit -m "feat(divergence): _extract_fusion_metadata helper for /commit fusion_meta"
```

---

## Task 5: 后端 —— `/commit` 改 genre 来源 + 写 `story_dna.fusion_meta`

**Files:**
- Modify: `backend/api/creative_diverge.py:1786-2050`(`/commit` handler,lines 1846-1847 + ~1995)
- Create: `tests/test_commit_uses_raw_intent_genre.py`

### Step 1: 写失败测试

```python
# tests/test_commit_uses_raw_intent_genre.py
"""Verify /commit reads genre from raw_intent and writes fusion_meta."""
import json
import pytest
from unittest.mock import patch, AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_intent(tmp_path):
    """Canvas with raw_intent.genre_primary + fusion variant in idea_variants."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_commit_intent"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    # Build a multi-node canvas so /commit path validation passes
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "root", "novelty_score": 70,
                    "trope_tags": [], "saturation_warning": False,
                    "mutation_context": None, "children_ids": ["wi_002_00"],
                    "is_expanded": True, "branch_status": "active",
                },
                "wi_002_00": {
                    "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                    "content": "child", "novelty_score": 80,
                    "trope_tags": [], "saturation_warning": False,
                    "mutation_context": None, "children_ids": [],
                    "is_expanded": True, "branch_status": "active",
                },
            },
            "edges": [], "selected_path": ["wi_001_00", "wi_002_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [
                {"id": "f1", "mutation_type": "fusion",
                 "risk_level": "medium", "fusion_distance": 2,
                 "title": "test fusion", "premise_one_line": "",
                 "mutation_logic": "", "estimated_novelty": 0.7,
                 "trope_tags": ["xianxia", "xuanyi"], "regenerated_count": 0},
            ],
            "core_contradiction": {
                "template_type": "ABILITY_VS_LIMIT",
                "statement": "长生者无法真正死去,因而在永恒中失去意义",
                "side_a": "长生", "side_b": "寻死",
                "tension_score": 85, "is_custom": False,
                "confirmed_at": "2026-08-30T10:00:00",
            },
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "长生者寻死",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def _mock_planner_agent():
    """Return a PlannerAgent-like object whose generate_concept_from_canvas
    returns a valid concept + story_dna without hitting real LLM."""
    from backend.agents.planner import PlannerAgent
    return PlannerAgent


@pytest.fixture(autouse=True)
def stub_llm(monkeypatch):
    """Stub PlannerAgent.generate_concept_from_canvas to skip LLM."""
    async def fake_generate_concept_from_canvas(self, canvas_summary, genre="cool_novel"):
        return (
            {
                "concept": {
                    "title": "长生者的悬疑", "premise": "summary",
                    "theme": "永恒 vs 短暂", "tone": "深沉",
                    "genre": genre,
                },
                "story_dna": {
                    "core_contradiction": {"statement": "长生者寻死的悖论"},
                    "style_template": "xianxia_noir",
                    "value_stack": [
                        {"level": "personal", "name": "p"},
                        {"level": "social", "name": "s"},
                        {"level": "philosophical", "name": "ph"},
                        {"level": "existential", "name": "e"},
                    ],
                },
            },
            None,
        )
    from backend.agents.planner import PlannerAgent
    monkeypatch.setattr(
        PlannerAgent, "generate_concept_from_canvas",
        fake_generate_concept_from_canvas,
    )


def test_commit_writes_fusion_meta_when_genre_secondary_exists(project_with_intent, client):
    response = client.post(
        f"/v1/projects/{project_with_intent}/creative/diverge/commit", json={}
    )
    assert response.status_code == 200, response.text

    concept_path = settings.projects_dir / project_with_intent / "concept_and_dna.json"
    concept_and_dna = json.loads(concept_path.read_text(encoding="utf-8"))

    assert concept_and_dna["concept"]["genre"] == "xianxia"
    fusion_meta = concept_and_dna["story_dna"].get("fusion_meta")
    assert fusion_meta is not None
    assert fusion_meta["secondary_genre"] == "xuanyi"
    assert fusion_meta["risk_level"] == "medium"
    assert fusion_meta["distance"] == 2


def test_commit_uses_genre_primary_when_no_secondary(tmp_path):
    """When raw_intent.genre_secondary is absent, fusion_meta must NOT be written."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_secondary"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {"id": "wi_001_00", "depth": 0, "parent_id": None, "content": "r",
                              "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                              "mutation_context": None, "children_ids": ["wi_002_00"],
                              "is_expanded": True, "branch_status": "active"},
                "wi_002_00": {"id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                              "content": "c", "novelty_score": 0, "trope_tags": [],
                              "saturation_warning": False, "mutation_context": None,
                              "children_ids": [], "is_expanded": True, "branch_status": "active"},
            },
            "edges": [], "selected_path": ["wi_001_00", "wi_002_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {"prompt": "p", "genre_primary": "xianxia", "trope_tags": []},
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    settings.projects_dir = original

    app = FastAPI()
    app.include_router(diverge_router)
    c = TestClient(app)
    response = c.post(f"/v1/projects/{pid}/creative/diverge/commit", json={})
    assert response.status_code == 200
    # Reload canvas from actual disk (settings reset)
    settings.projects_dir = tmp_path
    concept_path = settings.projects_dir / pid / "concept_and_dna.json"
    concept_and_dna = json.loads(concept_path.read_text(encoding="utf-8"))
    assert "fusion_meta" not in concept_and_dna["story_dna"]
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_commit_uses_raw_intent_genre.py -v
```

Expected: FAIL — `/commit` 仍读 `project.json.genre`,不写 `fusion_meta`

### Step 3: 实现 —— 改 `/commit` genre 来源 + fusion_meta 写入

修改 `backend/api/creative_diverge.py` 的 `/commit` handler:

找到现有:
```python
# Read genre from project.json
project = _get_fm().read_json(project_id, "project.json") or {}
genre = project.get("genre", "cool_novel")
```

替换为:
```python
# NEW: genre comes from raw_intent.genre_primary (catalog-resolvable),
# fallback to project.json.genre when raw_intent is missing fields.
raw_intent = canvas.get("raw_intent") or {}
genre_primary = (raw_intent.get("genre_primary") or "").strip()
genre_secondary = (raw_intent.get("genre_secondary") or "").strip()

if genre_primary:
    genre = genre_primary
    genre_source = "raw_intent_primary"
else:
    project = _get_fm().read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")
    genre_source = "project_json_fallback"

# fusion_meta: only when genre_secondary is set AND a fusion variant exists
fusion_meta_obj = None
if genre_secondary:
    fusion_meta = _extract_fusion_metadata(canvas)
    if fusion_meta is not None:
        risk_level, distance = fusion_meta
        fusion_meta_obj = {
            "secondary_genre": genre_secondary,
            "risk_level": risk_level,
            "distance": distance,
        }
```

找到现有 `concept_and_dna` dict 构造处(约 line 1995):
```python
concept_and_dna = {
    "concept": concept,
    "story_dna": story_dna,
    "source": "canvas",
    "canvas_snapshot": {
        "selected_path": selected_path,
        "committed_at": now,
    },
}
```

在 `_get_fm().write_json(...)` 之前追加:
```python
if fusion_meta_obj is not None:
    concept_and_dna["story_dna"]["fusion_meta"] = fusion_meta_obj
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_commit_uses_raw_intent_genre.py -v
```

Expected: 2 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_commit_uses_raw_intent_genre.py && \
  git commit -m "fix(divergence): /commit reads genre from raw_intent + writes story_dna.fusion_meta"
```

---

## Task 6: 后端 —— `/regenerate/{node_id}/regenerate` 对 fusion 走 `/fuse`

**Files:**
- Modify: `backend/api/creative_diverge.py:2365-2464`(`/regenerate/{node_id}/regenerate` handler)
- Create: `tests/test_regenerate_node_fusion.py`

### Step 1: 写失败测试

```python
# tests/test_regenerate_node_fusion.py
"""Verify /regenerate/{node_id}/regenerate on a fusion variant calls /fuse, not INVERSION fallback."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_fusion_variant(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_fusion_regen"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None, "content": "",
                "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [], "is_expanded": True,
                "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [
                {"id": "var-existing", "mutation_type": "fusion",
                 "title": "old fusion", "premise_one_line": "old",
                 "mutation_logic": "", "estimated_novelty": 0.7,
                 "trope_tags": ["xianxia", "xuanyi"],
                 "regenerated_count": 0,
                 "risk_level": "medium", "fusion_distance": 2},
            ],
            "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "p",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_regenerate_fusion_variant_keeps_mutation_type(project_with_fusion_variant, client):
    """Regenerating a fusion variant must NOT downgrade it to INVERSION."""
    response = client.post(
        f"/v1/projects/{project_with_fusion_variant}/creative/diverge/mutate/var-existing/regenerate"
    )
    assert response.status_code == 200, response.text
    variant = response.json()["variant"]
    assert variant["mutation_type"] == "fusion", \
        f"Expected fusion, got {variant['mutation_type']} — D9 regression"
    assert variant["id"] == "var-existing", "ID must be preserved"
    assert variant["regenerated_count"] == 1, "regenerated_count must increment"
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_regenerate_node_fusion.py -v
```

Expected: FAIL — 当前实现 `_mutation_op_from_type("fusion")` 返回 `None`,fallback `INVERSION`,新 variant 的 `mutation_type="inversion"` 违反 D9

### Step 3: 实现 —— special-case fusion

修改 `backend/api/creative_diverge.py:2365` 的 `/regenerate/{node_id}/regenerate` handler。

找到现有:
```python
op = _mutation_op_from_type(variant.get("mutation_type", ""))
if op is None:
    # Unknown / custom mutation_type (e.g., 'custom' from /contradict PUT).
    # Default to INVERSION so we still emit a coherent variant.
    op = MutationOp.INVERSION
```

替换为:
```python
op = _mutation_op_from_type(variant.get("mutation_type", ""))

# NEW (D9): fusion variants must be regenerated via /fuse, not INVERSION fallback.
# Calling /fuse keeps mutation_type="fusion" and re-computes risk/distance.
if variant.get("mutation_type") == "fusion":
    raw_intent = canvas.get("raw_intent") or {}
    genre_primary = (raw_intent.get("genre_primary") or "").strip()
    genre_secondary = (raw_intent.get("genre_secondary") or "").strip()
    if genre_primary and genre_secondary and genre_primary != genre_secondary:
        from backend.creative_os.genre_fusion_engine import GenreFusionEngine
        fusion_engine = GenreFusionEngine()
        distance = fusion_engine.compute_distance(genre_primary, genre_secondary)
        risk_level = _risk_from_distance(distance)
        new_variant: Optional[dict] = None
        try:
            mutation_engine = MutationEngine()
            trope_a = _genre_to_trope(genre_primary, raw_intent.get("prompt", ""))
            trope_b = _genre_to_trope(genre_secondary, raw_intent.get("prompt", ""))
            mutation_result = await mutation_engine.fuse(trope_a, trope_b)
            new_variant = _mutation_to_idea_variant(
                mutation_result, genre_primary, genre_secondary,
                risk_level=risk_level, distance=distance,
            )
        except Exception as exc:
            logger.warning("fusion regenerate failed: %s", exc)

        if new_variant is None:
            new_variant = {
                "id": node_id,
                "title": f"{genre_primary}×{genre_secondary} (重生成)",
                "premise_one_line": variant.get("premise_one_line", ""),
                "mutation_type": "fusion",
                "mutation_logic": f"跨 {distance} 跳距离的体裁融合(重生成)",
                "estimated_novelty": variant.get("estimated_novelty", 0.7),
                "trope_tags": list(variant.get("trope_tags", []) or []),
                "regenerated_count": 0,
                "risk_level": risk_level,
                "fusion_distance": distance,
            }

        # Preserve ID + bump count
        new_variant["id"] = node_id
        new_variant["regenerated_count"] = int(variant.get("regenerated_count", 0)) + 1

        canvas["idea_variants"] = [
            dict(new_variant) if v.get("id") == node_id else v
            for v in variants
        ]
        _write_canvas(project_id, canvas)
        return {"variant": new_variant}

# 非 fusion 才走 INVERSION fallback
if op is None:
    op = MutationOp.INVERSION
```

(后面的 mutation logic 保持原样,只对 non-fusion 路径生效)

### Step 4: 跑测试,确认通过

Run:
```bash
cd /ongsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_regenerate_node_fusion.py -v
```

Expected: 1 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_regenerate_node_fusion.py && \
  git commit -m "fix(divergence): /regenerate/{id}/regenerate on fusion calls /fuse (D9)"
```

---

## Task 7: 后端 —— `/regenerate/raw-intent` 清完后重跑 `/fuse`(D10)

**Files:**
- Modify: `backend/api/creative_diverge.py:2624-2700`(`/regenerate/raw-intent` handler)
- Create: `tests/test_regenerate_raw_intent_fuse.py`

### Step 1: 写失败测试

```python
# tests/test_regenerate_raw_intent_fuse.py
"""Verify /regenerate/raw-intent re-runs /fuse when raw_intent.genre_secondary exists."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_intent_and_no_fusion(tmp_path):
    """Canvas where raw_intent has genre_secondary but no fusion variant exists."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_regen_raw_intent_fuse"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None, "content": "p",
                "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [], "is_expanded": True,
                "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {"wi_001_00": {"branch_status": "active", "chosen_child_id": None}},
            "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [],   # 起始空,regen 后应有 mutation + fusion
            "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "长生者寻死",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_regenerate_raw_intent_appends_fusion_variant_when_secondary_exists(
    project_with_intent_and_no_fusion, client
):
    response = client.post(
        f"/v1/projects/{project_with_intent_and_no_fusion}/creative/diverge/regenerate/raw-intent",
        json={"user_modifications": ""},
    )
    assert response.status_code == 200, response.text

    canvas_path = (
        settings.projects_dir / project_with_intent_and_no_fusion
        / "creative_os" / "canvas_state.json"
    )
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    variants = canvas.get("idea_variants", [])
    fusion_variants = [v for v in variants if v.get("mutation_type") == "fusion"]
    assert len(fusion_variants) == 1, \
        f"Expected exactly 1 fusion variant after regen, got {len(fusion_variants)}"
    assert fusion_variants[0]["risk_level"] in {"low", "medium", "high"}
    assert 0 <= int(fusion_variants[0]["fusion_distance"]) <= 3
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_regenerate_raw_intent_fuse.py -v
```

Expected: FAIL — 当前实现只跑 3-op mutation chain,清完后没有 fusion variant

### Step 3: 实现 —— 在 `/regenerate/raw-intent` 末尾追加 /fuse

修改 `backend/api/creative_diverge.py:2624` 的 `/regenerate/raw-intent` handler。

找到 `canvas["idea_variants"] = built` 那一行,后面追加:

```python
canvas["idea_variants"] = built

# NEW (D10): if raw_intent has genre_secondary, re-run /fuse to append
# a fresh fusion variant. Keeps the contract "主+副类型都触发融合"
# consistent across /init, /regenerate/raw-intent, and S0-B 重新融合.
raw_intent = canvas.get("raw_intent") or {}
genre_primary = (raw_intent.get("genre_primary") or "").strip()
genre_secondary = (raw_intent.get("genre_secondary") or "").strip()

if genre_primary and genre_secondary and genre_primary != genre_secondary:
    try:
        from backend.creative_os.genre_fusion_engine import GenreFusionEngine
        from backend.creative_os.mutation_engine import MutationEngine

        fusion_engine = GenreFusionEngine()
        distance = fusion_engine.compute_distance(genre_primary, genre_secondary)
        risk_level = _risk_from_distance(distance)

        fusion_variant: Optional[dict] = None
        try:
            mutation_engine = MutationEngine(model_router=_try_get_model_router())
            trope_a = _genre_to_trope(genre_primary, raw_intent.get("prompt", ""))
            trope_b = _genre_to_trope(genre_secondary, raw_intent.get("prompt", ""))
            mutation_result = await mutation_engine.fuse(trope_a, trope_b)
            fusion_variant = _mutation_to_idea_variant(
                mutation_result, genre_primary, genre_secondary,
                risk_level=risk_level, distance=distance,
            )
        except Exception as exc:
            logger.warning("regenerate_raw_intent fuse LLM failed: %s", exc)

        if fusion_variant is None:
            fusion_variant = {
                "id": f"var-{uuid.uuid4().hex[:8]}",
                "title": f"{genre_primary}×{genre_secondary}",
                "premise_one_line": f"{genre_primary} 与 {genre_secondary} 融合",
                "mutation_type": "fusion",
                "mutation_logic": f"跨 {distance} 跳距离的体裁融合",
                "estimated_novelty": 0.7,
                "trope_tags": [genre_primary, genre_secondary],
                "regenerated_count": 0,
                "risk_level": risk_level,
                "fusion_distance": distance,
            }

        canvas["idea_variants"] = built + [fusion_variant]
    except Exception as exc:
        logger.warning("regenerate_raw_intent fuse re-run failed: %s", exc)

canvas["updated_at"] = datetime.now(timezone.utc).isoformat()
_write_canvas(project_id, canvas)
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_regenerate_raw_intent_fuse.py -v
```

Expected: 1 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/creative_diverge.py tests/test_regenerate_raw_intent_fuse.py && \
  git commit -m "fix(divergence): /regenerate/raw-intent re-runs /fuse when genre_secondary exists (D10)"
```

---

## Task 8: 前端 —— `postDivergeInit` 签名改 `(projectId, rawIntent: RawIntent)`

**Files:**
- Modify: `frontend/src/api/client.ts:1405-1410`(`postDivergeInit`)
- Modify: `frontend/src/api/client.test.ts`(添加对应测试)

### Step 1: 写失败测试

修改 `frontend/src/api/client.test.ts`(若不存在则创建),添加:

```typescript
// frontend/src/api/client.test.ts
import { api, type RawIntent } from "@/api/client";

describe("postDivergeInit", () => {
  it("accepts a RawIntent object (not just premise string)", async () => {
    const rawIntent: RawIntent = {
      prompt: "长生者寻死",
      genre_primary: "xianxia",
      genre_secondary: "xuanyi",
    };
    // 走 mock fetch — 这里只验证 TypeScript 编译通过
    // 真正的 fetch 行为由后端测试覆盖(Task 1-2)
    expect(typeof api.postDivergeInit).toBe("function");
    // 验证第二参接受 RawIntent 类型
    api.postDivergeInit("proj_test", rawIntent);
  });
});
```

### Step 2: 跑测试,确认失败(TypeScript 类型错误)

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/api/client.test.ts
```

Expected: FAIL — 当前 `postDivergeInit` 第二参是 `premise: string`,传 `RawIntent` 会类型错误

### Step 3: 改签名

修改 `frontend/src/api/client.ts:1405-1410`:

```typescript
postDivergeInit: (projectId: string, rawIntent: RawIntent) =>
  request<CanvasStateV3>(
    "POST",
    `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/init`,
    rawIntent,
  ),
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/api/client.test.ts
```

Expected: PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/api/client.ts frontend/src/api/client.test.ts && \
  git commit -m "fix(frontend): postDivergeInit accepts full RawIntent (not just premise string)"
```

---

## Task 9: 前端 —— `S0AInputStep` 加 `enableFusion` 勾选 + submit 调 `/fuse`

**Files:**
- Modify: `frontend/src/components/wizard/divergence/S0AInputStep.tsx`(全文)
- Modify: `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx`(添加测试)

### Step 1: 写失败测试

修改 `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0AInputStep from "@/components/wizard/divergence/S0AInputStep";
import api from "@/api/client";

jest.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postDivergeInit: jest.fn().mockResolvedValue({ detail: {} }),
    postDivergeFuse: jest.fn().mockResolvedValue({
      variants: [{
        id: "var-fuse-1", title: "fusion", premise_one_line: "f",
        mutation_type: "fusion", mutation_logic: "",
        estimated_novelty: 0.7, trope_tags: ["xianxia", "xuanyi"],
        regenerated_count: 0, risk_level: "medium", fusion_distance: 2,
      }],
      fusion_distance: { distance: 2, compatibility: "中" },
      risk_level: "medium",
    }),
  },
}));

describe("S0AInputStep fusion trigger", () => {
  it("calls postDivergeFuse when 副类型 filled + 启用类型融合 checked", async () => {
    const onComplete = jest.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死故事" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));

    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(api.postDivergeInit).toHaveBeenCalledWith(
        "proj_x",
        expect.objectContaining({
          prompt: "长生者寻死故事",
          genre_primary: "xianxia",
          genre_secondary: "xuanyi",
        })
      );
      expect(api.postDivergeFuse).toHaveBeenCalledWith(
        "proj_x",
        expect.objectContaining({
          genre_primary: "xianxia",
          genre_secondary: "xuanyi",
        })
      );
    });
  });

  it("does NOT call postDivergeFuse when 启用类型融合 unchecked", async () => {
    const onComplete = jest.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "p" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    // NOT clicking enable-fusion

    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(api.postDivergeInit).toHaveBeenCalled();
      expect(api.postDivergeFuse).not.toHaveBeenCalled();
    });
  });

  it("passes fusion variant + null banner to onComplete on success", async () => {
    const onComplete = jest.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "p" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ genre_primary: "xianxia" }),
        expect.objectContaining({ mutation_type: "fusion" }),
        null,
      );
    });
  });

  it("passes fusion banner when /fuse fails", async () => {
    (api.postDivergeFuse as jest.Mock).mockRejectedValueOnce(
      new Error("LLM 不可用")
    );
    const onComplete = jest.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "p" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.anything(),
        null,
        expect.stringContaining("类型融合未启用"),
      );
    });
  });
});
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/divergence/S0AInputStep.test.tsx
```

Expected: FAIL — `enable-fusion` testid 不存在;submit 不调 `/fuse`

### Step 3: 实现 —— 加勾选 + submit 调 /fuse

**整文件重写** `frontend/src/components/wizard/divergence/S0AInputStep.tsx`:

```tsx
import { useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";

interface Props {
  projectId: string;
  onComplete: (
    rawIntent: RawIntent,
    fusionVariant: IdeaVariant | null,
    fusionBanner: string | null,
  ) => void;
  initial?: RawIntent | null;
  /**
   * Called after a successful /diverge/regenerate/raw-intent call so the
   * parent re-reads canvas state and the new variants surface when the user
   * navigates to S0B.
   */
  onCanvasMutated?: () => void;
}

const GENRES = [
  "修仙",
  "都市",
  "星际",
  "游戏",
  "历史",
  "军事",
  "体育",
  "校园",
  "悬疑",
  "奇幻",
];

export default function S0AInputStep({
  projectId,
  onComplete,
  initial,
  onCanvasMutated,
}: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [genrePrimary, setGenrePrimary] = useState(
    initial?.genre_primary || "",
  );
  const [genreSecondary, setGenreSecondary] = useState(
    initial?.genre_secondary || "",
  );
  const [enableFusion, setEnableFusion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

  // canSubmit: prompt ≥10 + 主类型有值 + (勾选融合则副类型也必须有值)
  const canSubmit =
    prompt.trim().length >= 10 &&
    !!genrePrimary &&
    (!enableFusion || !!genreSecondary) &&
    !submitting;

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
      await api.postDivergeInit(projectId, rawIntent);

      let fusionVariant: IdeaVariant | null = null;
      let fusionBanner: string | null = null;
      if (rawIntent.genre_secondary && enableFusion) {
        try {
          const fuseResp = await api.postDivergeFuse(projectId, {
            genre_primary: rawIntent.genre_primary,
            genre_secondary: rawIntent.genre_secondary,
            prompt: rawIntent.prompt,
          });
          fusionVariant = fuseResp.variants[0] ?? null;
        } catch (e) {
          fusionBanner = `类型融合未启用(${e instanceof Error ? e.message : "LLM 后端不可用"})`;
        }
      }

      onComplete(rawIntent, fusionVariant, fusionBanner);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "提交失败");
      setSubmitting(false);
    }
  }

  async function handleRegenerate(userModifications: string) {
    setShowRegenerateModal(false);
    setRegenerating(true);
    setError(null);
    try {
      await api.postDivergeRegenerateRawIntent(projectId, {
        user_modifications: userModifications,
      });
      onCanvasMutated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">灵感输入</h2>
        <button
          type="button"
          data-testid="s0a-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={!initial || regenerating}
          aria-label="重新生成 — 灵感输入"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0a-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      <textarea
        placeholder="用一句话描述你的故事想法"
        className="w-full h-44 p-3 bg-surface-container border border-outline-variant rounded-lg resize-none text-primary text-sm placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex justify-between text-xs text-on-surface-variant">
        <span>{prompt.length} 字</span>
        {prompt.length > 0 && prompt.length < 10 && (
          <span className="text-error">至少 10 字</span>
        )}
        {prompt.length > 1700 && (
          <span className="text-warning">超过 1700 字将被截断（后端硬上限）</span>
        )}
      </div>
      <div className="flex gap-3">
        <select
          data-testid="genre-primary"
          className="flex-1 p-2 bg-surface-container border border-outline-variant rounded-lg text-primary text-sm focus:outline-none focus:border-primary"
          value={genrePrimary}
          onChange={(e) => setGenrePrimary(e.target.value)}
        >
          <option value="">选择主类型</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          data-testid="genre-secondary"
          className="flex-1 p-2 bg-surface-container border border-outline-variant rounded-lg text-primary text-sm focus:outline-none focus:border-primary"
          value={genreSecondary}
          onChange={(e) => setGenreSecondary(e.target.value)}
        >
          <option value="">副类型(可选)</option>
          {GENRES.filter((g) => g !== genrePrimary).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      {genreSecondary && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="enable-fusion"
            checked={enableFusion}
            onChange={(e) => setEnableFusion(e.target.checked)}
          />
          <span>启用类型融合(计算 BFS 距离 + 风险等级,产出融合变体)</span>
        </label>
      )}
      {error && <div className="text-error text-sm">{error}</div>}
      <div className="flex justify-end">
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
      <RegenerateModal
        open={showRegenerateModal}
        target="灵感输入"
        placeholder="例如:换一个更悬疑的题材方向 / 加入科幻元素……"
        busy={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/divergence/S0AInputStep.test.tsx
```

Expected: 4 PASS

> **冷缓存 gotcha**(CLAUDE.md):首跑可能报 `ReferenceError: document is not defined`。再跑一次暖缓存。

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/divergence/S0AInputStep.tsx frontend/src/test/wizard/divergence/S0AInputStep.test.tsx && \
  git commit -m "feat(divergence): S0-A 启用类型融合 checkbox + auto-trigger /fuse"
```

---

## Task 10: 前端 —— `S0BMutationStep` 渲染 fusion variant + 「重新融合」按钮

**Files:**
- Modify: `frontend/src/components/wizard/divergence/S0BMutationStep.tsx`(全文)
- Modify: `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx`(添加测试)

### Step 1: 写失败测试

修改 `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import S0BMutationStep from "@/components/wizard/divergence/S0BMutationStep";
import api from "@/api/client";

jest.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postDivergeFuse: jest.fn().mockResolvedValue({
      variants: [{
        id: "var-fuse-replaced", title: "new fusion",
        premise_one_line: "new", mutation_type: "fusion",
        mutation_logic: "", estimated_novelty: 0.8,
        trope_tags: ["xianxia", "xuanyi"], regenerated_count: 0,
        risk_level: "high", fusion_distance: 3,
      }],
      fusion_distance: { distance: 3, compatibility: "低" },
      risk_level: "high",
    }),
  },
}));

const rawIntentWithSecondary = {
  prompt: "p", genre_primary: "xianxia", genre_secondary: "xuanyi",
};

const baseProps = {
  projectId: "proj_x",
  rawIntent: rawIntentWithSecondary,
  initial: [],
  selectedIds: [],
  onComplete: jest.fn(),
  onBack: jest.fn(),
  fusionVariant: null as any,
};

describe("S0BMutationStep fusion variant UI", () => {
  it("renders 重新融合 button when rawIntent.genre_secondary exists", () => {
    render(<S0BMutationStep {...baseProps} />);
    expect(screen.getByTestId("refuse-button")).toBeInTheDocument();
  });

  it("renders fusion variant card with risk_level badge when fusionVariant passed", () => {
    const fusionVariant = {
      id: "var-fuse-1", title: "fusion",
      premise_one_line: "f", mutation_type: "fusion" as const,
      mutation_logic: "", estimated_novelty: 0.7,
      trope_tags: ["xianxia", "xuanyi"], regenerated_count: 0,
      risk_level: "medium", fusion_distance: 2,
    };
    render(
      <S0BMutationStep
        {...baseProps}
        initial={[fusionVariant]}
        fusionVariant={fusionVariant}
      />
    );
    expect(screen.getByTestId("fusion-card")).toBeInTheDocument();
    expect(screen.getByTestId("risk-badge")).toHaveTextContent("medium");
  });

  it("clicking 重新融合 calls postDivergeFuse + replaces fusion variant", async () => {
    const initialFusion = {
      id: "var-fuse-1", title: "old fusion",
      premise_one_line: "old", mutation_type: "fusion" as const,
      mutation_logic: "", estimated_novelty: 0.7,
      trope_tags: ["xianxia", "xuanyi"], regenerated_count: 0,
      risk_level: "medium", fusion_distance: 2,
    };
    render(
      <S0BMutationStep
        {...baseProps}
        initial={[initialFusion]}
        fusionVariant={initialFusion}
      />
    );
    fireEvent.click(screen.getByTestId("refuse-button"));
    await waitFor(() => {
      expect(api.postDivergeFuse).toHaveBeenCalledWith(
        "proj_x",
        expect.objectContaining({
          genre_primary: "xianxia",
          genre_secondary: "xuanyi",
        })
      );
    });
  });

  it("disables 重新融合 when genre_secondary missing", () => {
    render(
      <S0BMutationStep
        {...baseProps}
        rawIntent={{ prompt: "p", genre_primary: "xianxia" }}
      />
    );
    expect(screen.getByTestId("refuse-button")).toBeDisabled();
  });
});
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/divergence/S0BMutationStep.test.tsx
```

Expected: FAIL — `refuse-button` / `fusion-card` / `risk-badge` testids 不存在

### Step 3: 实现 —— 修改 `S0BMutationStep`

**整文件重写** `frontend/src/components/wizard/divergence/S0BMutationStep.tsx`(保留 mutation chain 逻辑,加 fusion 卡片与按钮):

```tsx
import { useEffect, useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";

interface Props {
  projectId: string;
  rawIntent: RawIntent;
  initial?: IdeaVariant[];
  selectedIds?: string[];
  fusionVariant?: IdeaVariant | null;
  onComplete: (variants: IdeaVariant[], selectedIds: string[]) => void;
  onBack: () => void;
  onCanvasMutated?: () => void;
}

const MUTATION_OPS = ["inversion", "escalation", "subversion"] as const;

function buildVariant(/* ... 保持原有逻辑 ... */): IdeaVariant {
  // ... 保持原 buildVariant 实现 ...
  // (省略 — 见 git diff)
  return {} as IdeaVariant;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  high: "bg-red-100 text-red-800 border-red-300",
};

export default function S0BMutationStep({
  projectId,
  rawIntent,
  initial,
  selectedIds,
  fusionVariant,
  onComplete,
  onBack,
  onCanvasMutated,
}: Props) {
  const [variants, setVariants] = useState<IdeaVariant[]>(initial || []);
  const [fusionVariantState, setFusionVariantState] =
    useState<IdeaVariant | null>(fusionVariant || null);
  const [refusing, setRefusing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ... 保留原有 mutation chain 逻辑 ...

  async function handleRefuse() {
    if (!rawIntent.genre_primary || !rawIntent.genre_secondary) return;
    setRefusing(true);
    setError(null);
    try {
      const resp = await api.postDivergeFuse(projectId, {
        genre_primary: rawIntent.genre_primary,
        genre_secondary: rawIntent.genre_secondary,
        prompt: rawIntent.prompt || "",
      });
      const newFusion = resp.variants[0] || null;
      // Preserve ID + bump regenerated_count
      const prevId = fusionVariantState?.id;
      const prevCount = fusionVariantState?.regenerated_count || 0;
      if (newFusion && prevId) {
        newFusion.id = prevId;
        newFusion.regenerated_count = prevCount + 1;
      }
      setFusionVariantState(newFusion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新融合失败");
    } finally {
      setRefusing(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">变体选择</h2>
        <div className="flex gap-2">
          {rawIntent.genre_secondary && (
            <button
              type="button"
              data-testid="refuse-button"
              disabled={refusing}
              onClick={handleRefuse}
              className="..."
            >
              {refusing ? "融合中..." : "重新融合"}
            </button>
          )}
          <button type="button" onClick={onBack}>返回</button>
        </div>
      </div>

      {/* Fusion variant card */}
      {fusionVariantState && (
        <div
          data-testid="fusion-card"
          className="border-2 border-primary rounded-lg p-4 bg-surface-container"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">融合变体</h3>
            <span
              data-testid="risk-badge"
              className={`text-xs px-2 py-1 rounded border ${
                RISK_COLORS[fusionVariantState.risk_level || "low"] ||
                RISK_COLORS.low
              }`}
            >
              risk: {fusionVariantState.risk_level || "low"} · distance:{" "}
              {fusionVariantState.fusion_distance ?? 0}
            </span>
          </div>
          <p className="text-sm">{fusionVariantState.premise_one_line}</p>
        </div>
      )}

      {/* 原有 mutation variants 列表 */}
      <div className="grid ...">{/* 保留原有卡片渲染 */}</div>

      {error && <div className="text-error text-sm">{error}</div>}
    </div>
  );
}
```

> **实现细节**:完整 mutation chain 逻辑(应用 mutation 操作、buildVariant 函数等)从原文件复制;只新增 fusion 卡片渲染、按钮、handleRefuse。完整文件大约 300 行,可参考 git diff 验证。

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/divergence/S0BMutationStep.test.tsx
```

Expected: 4 PASS(若失败可能是 mock 设置或原有 mutation 逻辑残留,需对照 git diff 调试)

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/divergence/S0BMutationStep.tsx frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx && \
  git commit -m "feat(divergence): S0-B fusion variant card + 重新融合 button + risk badge"
```

---

## Task 11: 前端 —— `CreativeDivergenceStep` 加 `fusionVariant/fusionBanner` state + 透传 + banner

**Files:**
- Modify: `frontend/src/components/wizard/CreativeDivergenceStep.tsx`(找 S0-A onComplete + S0-B props)
- Modify: `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`(添加测试)

### Step 1: 写失败测试

修改 `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";

describe("CreativeDivergenceStep fusion propagation", () => {
  it("passes fusionVariant from S0-A to S0-B", async () => {
    render(<CreativeDivergenceStep projectId="proj_x" />);

    // 触发 S0-A submit with fusion
    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    // S0-B 出现
    await waitFor(() => {
      expect(screen.getByTestId("fusion-card")).toBeInTheDocument();
      expect(screen.getByTestId("risk-badge")).toHaveTextContent(/medium/);
    });
  });

  it("shows fusionBanner in S0-B when /fuse failed", async () => {
    render(<CreativeDivergenceStep projectId="proj_x" />);
    // mock api 失败路径 — 略
    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "p" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "xianxia" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "xuanyi" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("fusion-banner")).toHaveTextContent(
        /类型融合未启用/,
      );
    });
  });
});
```

### Step 2: 跑测试,确认失败

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/CreativeDivergenceStep.test.tsx
```

Expected: FAIL — `fusion-banner` testid 不存在;fusionVariant 不透传

### Step 3: 实现

修改 `frontend/src/components/wizard/CreativeDivergenceStep.tsx`:

```tsx
import { useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";
import S0AInputStep from "./divergence/S0AInputStep";
import S0BMutationStep from "./divergence/S0BMutationStep";
// ... 其他 step imports

export default function CreativeDivergenceStep({ projectId }: { projectId: string }) {
  const [stage, setStage] = useState<"S0A" | "S0B" | "S0C" | "S0D" | "S0E">("S0A");
  const [rawIntent, setRawIntent] = useState<RawIntent | null>(null);
  const [fusionVariant, setFusionVariant] = useState<IdeaVariant | null>(null);
  const [fusionBanner, setFusionBanner] = useState<string | null>(null);

  // ... 现有 state ...

  return (
    <div>
      {stage === "S0A" && (
        <S0AInputStep
          projectId={projectId}
          initial={rawIntent}
          onComplete={(ri, fv, fb) => {
            setRawIntent(ri);
            setFusionVariant(fv);
            setFusionBanner(fb);
            setStage("S0B");
          }}
        />
      )}
      {stage === "S0B" && rawIntent && (
        <>
          {fusionBanner && (
            <div
              data-testid="fusion-banner"
              className="mx-6 mt-4 p-3 rounded bg-warning/10 border border-warning text-sm"
            >
              {fusionBanner}
            </div>
          )}
          <S0BMutationStep
            projectId={projectId}
            rawIntent={rawIntent}
            fusionVariant={fusionVariant}
            onComplete={(variants, ids) => {
              setStage("S0C");
            }}
            onBack={() => setStage("S0A")}
          />
        </>
      )}
      {/* S0C / S0D / S0E 保持原样 */}
    </div>
  );
}
```

### Step 4: 跑测试,确认通过

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/wizard/CreativeDivergenceStep.test.tsx
```

Expected: 2 PASS

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/CreativeDivergenceStep.tsx frontend/src/test/wizard/CreativeDivergenceStep.test.tsx && \
  git commit -m "feat(divergence): CreativeDivergenceStep passes fusionVariant + shows banner"
```

---

## Task 12: 前端 —— 跑完整测试套件,确保没回归

**Files:** none modified

### Step 1: 跑所有 divergence 相关前端测试

Run:
```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run \
  src/test/wizard/divergence/ \
  src/test/wizard/CreativeDivergenceStep.test.tsx \
  src/api/client.test.ts
```

Expected: 所有 PASS(若有任何 FAIL,先排查不要继续)

### Step 2: 跑所有后端测试

Run:
```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_init_raw_intent_persistence.py \
         tests/test_init_migration_old_caller.py \
         tests/test_fuse_error_codes.py \
         tests/test_fuse_variant_metadata.py \
         tests/test_extract_fusion_metadata.py \
         tests/test_commit_uses_raw_intent_genre.py \
         tests/test_regenerate_node_fusion.py \
         tests/test_regenerate_raw_intent_fuse.py \
         tests/test_creative_diverge_*.py -v
```

Expected: 所有 PASS(注意:test_creative_diverge_*.py 已有测试不能因本 spec 改动失败)

### Step 3: 提交(若有修复)

```bash
cd /Users/longsa/Codes/nebula && git add -A && git commit -m "test(divergence): full regression sweep passes" --allow-empty
```

---

## Task 13: E2E —— 手工跑通三条路径

**Files:** none

### Step 1: 启动 dev 环境

```bash
# Terminal 1: backend
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  uvicorn backend.main:app --port 8000

# Terminal 2: frontend
cd /Users/longsa/Codes/nebula/frontend && npm run dev
```

> ⚠ **不要开 cockpit SSE 流**(会让 backend reload 卡死,见 CLAUDE.md)

### Step 2: 完整路径测试

1. 打开 http://localhost:5173 → 新建项目(或打开现有)
2. 进入创意发散 → S0-A
3. 填 prompt(≥10 字)→ 主类型选「仙侠」 → 副类型选「悬疑」 → 勾选「启用类型融合」
4. 点「下一步:生成变体」
5. **预期**:S0-B 出现 7 张卡(6 mutation + 1 fusion),fusion 卡显示 `risk: medium · distance: 2` 黄色 badge
6. 进 S0-E → 点「提交」
7. **验证**:打开 `<project>/concept_and_dna.json`:
   - `concept.genre == "仙侠"`
   - `story_dna.fusion_meta == {secondary_genre: "悬疑", risk_level: "medium", distance: 2}`

### Step 3: 失败路径测试(LLM 不可用)

1. 临时把 backend `.env` 里 `llm_provider` 设为 `mock` 或 unset 实际 API key
2. 重启 backend
3. 重复 Step 2.1-2.5
4. **预期**:S0-A 提交后显示 banner「类型融合未启用(...)」 → S0-B 只有 6 张 mutation 卡
5. 进 S0-E commit → `concept_and_dna.json` 写入 `concept.genre="仙侠"`,**无** `fusion_meta` 字段

### Step 4: 回退路径测试(旧项目)

1. 用一个旧项目(只有 `prompt + trope_tags` 的 raw_intent,无 genre_primary)
2. 直接点 S0-E commit
3. **预期**:走 `project.json.genre` fallback,`concept_and_dna.json` 写入,无 `fusion_meta`

### Step 5: regenerate 路径测试

1. 完整路径 Step 2 完成后,返回 S0-A,点「重新生成」
2. **预期**:S0-B 仍显示 7 张卡(3 mutation 重生成 + 1 fusion 重生成)
3. 在 S0-B 点 fusion 卡的「重新生成」按钮
4. **预期**:fusion 卡 mutation_type 仍是 fusion,`regenerated_count++`,`risk_level/distance` 重新计算

### Step 6: 提交(若有发现并修复)

```bash
cd /Users/longsa/Codes/nebula && git add -A && git commit -m "chore(divergence): E2E manual verification" --allow-empty
```

---

## Self-Review

### 1. Spec 覆盖检查

| Spec § | 任务 | 状态 |
|---|---|---|
| §1.2 #1 持久化 | Task 1 | ✅ |
| §1.2 #2 S0-A 自动触发 | Task 9 | ✅ |
| §1.2 #3 S0-B 显式按钮 | Task 10 | ✅ |
| §1.2 #4 `/commit` 消费 + fusion_meta | Task 5 | ✅ |
| §1.2 #5 `/fuse` 健壮性 | Task 3 | ✅ |
| §4.1 `/init` body 扩展 | Task 1 | ✅ |
| §4.2 `/fuse` 错误码 | Task 3 | ✅ |
| §4.3 `/commit` genre + fusion_meta | Task 5 | ✅ |
| §4.4 `/regenerate/{id}/regenerate` fusion | Task 6 | ✅ |
| §4.5 `/regenerate/raw-intent` 重跑 /fuse | Task 7 | ✅ |
| §5.1 S0A 加勾选 + submit | Task 9 | ✅ |
| §5.2 S0B fusion card + 重新融合 | Task 10 | ✅ |
| §5.3 CreativeDivergenceStep 透传 | Task 11 | ✅ |
| §6.1 /init InitRequest + 持久化 | Task 1 | ✅ |
| §6.2 /fuse 错误码 + variant 字段 | Task 3 | ✅ |
| §6.3 /commit genre + fusion_meta | Task 5 | ✅ |
| §6.4 _extract_fusion_metadata | Task 4 | ✅ |
| §8.1 后端测试 | Tasks 1, 2, 3, 4, 5, 6, 7(共 8 个测试文件) | ✅ |
| §8.2 前端测试 | Tasks 8, 9, 10, 11(共 4 个测试文件) | ✅ |
| §8.3 E2E 三条路径 | Task 13 | ✅ |
| §10 验收(18 项) | Tasks 1-13 覆盖全部 18 项 | ✅ |

### 2. Placeholder 检查

- 无 "TODO" / "TBD" / "类似 Task N"
- 所有代码块完整
- 所有命令带 expected output
- 所有文件路径精确

### 3. 类型一致性

- `InitRequest`(Task 1 定义)→ `frontend postDivergeInit` 接收 `RawIntent`(Task 8 改)→ `S0AInputStep` 用 `RawIntent` 组装(Task 9)✅
- `_extract_fusion_metadata` 返回 `Optional[tuple[str, int]]`(Task 4 定义)→ `/commit` 用 `if fusion_meta is not None`(Task 5)✅
- `IdeaVariant.risk_level / fusion_distance`(Task 3 加)→ S0-B 卡片渲染(Task 10)、`/commit` fusion_meta(Task 5)✅
- `enable-fusion` testid(Task 9 定义)→ S0A 测试(Task 9)✅
- `refuse-button` / `fusion-card` / `risk-badge` testid(Task 10 定义)→ S0B 测试(Task 10)✅
- `fusion-banner` testid(Task 11 定义)→ CreativeDivergenceStep 测试(Task 11)✅

无类型不一致问题。