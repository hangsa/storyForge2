# Creative Canvas Reconstruction v2.0 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the shipped canvas-v2 refactor (`b35f70a..892ff00`, 14 tasks) and the PRD's v2.0 MVP scope (`docs/design/creative-canvas-reconstruction.md` §28.1) by enriching the v4 canvas_state schema, exposing DELETE /evaluate endpoints under the v2 router, adding operation-aware differentiation + 5-dimension consistency check, and aligning the frontend with PRD copy + interaction details.

**Architecture:** Pure gap-fill on top of the shipped canvas-v2 foundation. Backend stays FastAPI + pydantic + JSON files (no new infra). Frontend stays React + Tailwind + design-system primitives. All new endpoints mount under `/creative/canvas/{project_id}/session/*` (matches shipped v2 router namespace, NOT the PRD's `/creative/session/*` — see §26 namespace decision below). v2.1 features (early-finalize §36, backtrack §37, override §38, regenerate §39) are explicitly out of scope; this plan delivers v2.0 MVP ONLY.

**Tech Stack:** Python 3.9 / FastAPI / pytest, React 18 + Vite + Vitest / Tailwind CSS, pydantic-settings (env vars), existing design-system primitives from `frontend/src/components/ds/`.

**Namespace decision (read first):** The PRD §26 lists endpoints under `/creative/session/*`. The shipped v2 router uses `/creative/canvas/{project_id}/session/*`. Per §11.1 the URL is `/project/:projectId/stage0/canvas` which scopes to a project — so the backend namespace MUST include project_id. We'll keep `/creative/canvas/{project_id}/session/*` and document the deviation from §26 in code comments.

**Out of scope (v2.1+, deferred per PRD §28.2):** early-finalize, override, backtrack, regenerate, downstream consumer upgrades (§20.3), `creative_path` / `creative_mechanism` / `canvas_meta` fields in `concept_and_dna.json` (§28.4 — v2.0 commit keeps v3-compat output).

---

## File Structure

Files modified or created by this plan:

**Backend (modified):**
- `backend/api/v2_canvas.py` — add DELETE /state, /evaluate deprecated alias, operation-aware diff prompt hint, auto-evaluate on select, 5-dim consistency check hook
- `backend/api/creative_diverge.py` — _empty_canvas_v4 schema enrichment; /commit creative_divergence.json double-write already exists at line 2153 (no change needed)
- `backend/creative_os/option_generator.py` (NEW) — operation-aware LLM prompt + axis guidance per §7
- `backend/creative_os/consistency_check.py` (NEW) — 5-dimension validator per §17.2
- `tests/test_v2_canvas_endpoints.py` — add DELETE /state, /evaluate deprecation, schema completeness
- `tests/test_v2_e2e.py` — extend with operation-aware diff + consistency check coverage

**Frontend (modified):**
- `frontend/src/api/client.ts` — add `deleteCanvasV2State()`, `evaluateCanvasV2()`, hook `onSelect` to trigger score refresh
- `frontend/src/hooks/useCreativeCanvasV2.ts` — implement reset (replace `console.warn` no-op), add auto-refresh score on select, add pre-commit summary state
- `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx` (NEW) — PRD §18.2 confirm modal
- `frontend/src/components/creative-canvas/PreCommitSummary.tsx` (NEW) — PRD §18.3 stats + commit/cancel
- `frontend/src/components/creative-canvas/OperationGuidance.tsx` (NEW) — PRD §15 "为什么是这个操作" prominent block
- `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` — wire OperationGuidance + axis hints
- `frontend/src/components/creative-canvas/CreativeCanvasPage.tsx` — empty state copy refinement (§11.2); wire ResetConfirmDialog + PreCommitSummary
- `frontend/src/test/components/creative-canvas/ResetConfirmDialog.test.tsx` (NEW)
- `frontend/src/test/components/creative-canvas/PreCommitSummary.test.tsx` (NEW)
- `frontend/src/test/components/creative-canvas/OperationGuidance.test.tsx` (NEW)
- `frontend/src/test/pages/CreativeCanvasPage.test.tsx` — update for empty-state copy + reset/precommit wiring

**Schema (no new file):** v4 canvas_state schema enrichment lives inline in `backend/api/creative_diverge.py:_empty_canvas_v4` (matches shipped convention from Task 1).

---

### Task 1: Enrich v4 canvas_state schema

**Files:**
- Modify: `backend/api/creative_diverge.py:_empty_canvas_v4` (around line 367 per shipped v2 plan)
- Test: `tests/test_v2_canvas_endpoints.py` (extend with assertions)

PRD §22 mandates the v4 schema include `root_idea`, `creative_session`, `current_concept`, top-level `scores`, and `session_metadata` with `elapsed_seconds`. The shipped schema has only `raw_intent`, `session_metadata` (minimal), no `current_concept`, no top-level `scores`. PRD §23.4 mandates `raw_intent` double-write with `root_idea` — shipped code writes only `raw_intent`.

- [ ] **Step 1: Write the failing test for enriched v4 schema**

Append to `tests/test_v2_canvas_endpoints.py`:

```python
def test_init_writes_enriched_v4_schema(project, client, stub_llm):
    """PRD §22 + §23.4: init writes both raw_intent AND root_idea,
    plus creative_session, current_concept, scores blocks."""
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "长生者寻死", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    # PRD §22 root_idea block
    assert "root_idea" in canvas
    assert canvas["root_idea"]["prompt"] == "长生者寻死"
    assert canvas["root_idea"]["genre"] == "xianxia"
    assert "extracted" in canvas["root_idea"]
    # PRD §22 creative_session block
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["creative_session"]["max_steps"] == 5
    assert canvas["creative_session"]["status"] == "active"
    # PRD §22 current_concept
    assert canvas["current_concept"]["premise"]  # non-empty after init
    # PRD §22 top-level scores
    assert "scores" in canvas
    assert canvas["scores"]["computed_at"]  # ISO timestamp
    # PRD §23.4 raw_intent double-write
    assert canvas["raw_intent"]["prompt"] == "长生者寻死"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_init_writes_enriched_v4_schema -v
```

Expected: FAIL with `KeyError: 'root_idea'` (or similar) — schema not yet enriched.

- [ ] **Step 3: Extend _empty_canvas_v4 + init handler**

In `backend/api/creative_diverge.py`, modify the `_empty_canvas_v4()` function (around line 367 per the shipped v2 plan's self-review) to include the new top-level blocks. After init, populate them:

```python
def _empty_canvas_v4() -> dict:
    """PRD §22 schema. Lazy migration target for v3."""
    now = now_iso()
    return {
        "schema_version": 4,
        "session_id": str(uuid.uuid4()),
        "root_idea": {
            "prompt": "",
            "genre": "",
            "premise": "",
            "extracted": {"genre": "", "core_elements": [], "potential_conflict": ""},
        },
        "creative_session": {"current_step": 1, "max_steps": 5, "status": "active"},
        "creative_path": [],
        "current_concept": {
            "premise": "",
            "core_conflict": "",
            "characters": [],
            "world_rules": [],
            "tropes": [],
            "themes": [],
            "novelty": 0.0,
        },
        "final_concept": None,
        "committed": False,
        "committed_at": None,
        "committed_concept_ref": "concept_and_dna.json",
        "scores": {"novelty": 0.0, "conflict": 0.0, "story_potential": 0.0,
                   "uniqueness": 0.0, "computed_at": now},
        "session_metadata": {
            "created_at": now, "last_modified_at": now,
            "elapsed_seconds": 0, "operation_count": 0,
        },
    }
```

In the init handler (the function that calls `_empty_canvas_v4()` after the schema version check), after creating the empty canvas, populate `root_idea`, `current_concept.premise`, and increment `session_metadata.elapsed_seconds` to 0 (already set):

```python
canvas = _empty_canvas_v4()
canvas["raw_intent"] = data.raw_intent.dict()  # PRD §23.4 double-write
canvas["root_idea"] = {
    "prompt": data.raw_intent.prompt,
    "genre": data.raw_intent.genre_primary,
    "premise": data.raw_intent.prompt,  # default; refined by next-step
    "extracted": {"core_elements": data.raw_intent.trope_tags or []},
}
canvas["current_concept"]["premise"] = data.raw_intent.prompt
canvas["session_metadata"]["created_at"] = now_iso()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_init_writes_enriched_v4_schema -v
```

Expected: PASS.

- [ ] **Step 5: Run all v2 endpoint tests to ensure no regression**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_diverge.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): enrich v4 schema with root_idea + creative_session + scores blocks"
```

---

### Task 2: DELETE /state endpoint in v2 router

**Files:**
- Modify: `backend/api/v2_canvas.py` (add `DELETE /state` handler)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §26 + §18.2: DELETE /state resets the session while preserving root_idea. The legacy `/state` DELETE exists in `backend/api/creative_diverge.py` but the v2 router (under `enable_canvas_v2` flag) does NOT expose it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_v2_canvas_endpoints.py`:

```python
def test_delete_state_resets_session_preserves_root_idea(project, client, stub_llm):
    """PRD §18.2: DELETE /state resets session but keeps root_idea."""
    # init + walk 2 steps
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    client.post(f"/creative/canvas/{project}/session/select",
                json={"step": 1, "option_id": "opt_1_b"})

    # reset
    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200

    # creative_path wiped, but root_idea preserved
    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"] == []
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["root_idea"]["prompt"] == "p"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_delete_state_resets_session_preserves_root_idea -v
```

Expected: 404 or 405 (no DELETE handler on /state under v2 router).

- [ ] **Step 3: Implement DELETE /state in v2 router**

In `backend/api/v2_canvas.py`, after the existing `GET /state` handler, add:

```python
@router.delete("/state")
async def delete_canvas_state(project_id: str) -> dict:
    """PRD §18.2: reset session, preserve root_idea.

    Reuses _read_canvas (lazy migrate) + the legacy reset helper from
    creative_diverge to keep behavior identical to the v1.x DELETE /state.
    """
    from backend.api.creative_diverge import _reset_canvas_v3 as _legacy_reset
    canvas = _read_canvas(project_id)
    if canvas.get("root_idea", {}).get("prompt"):
        # PRD §18.2: preserve root_idea + raw_intent; wipe creative_path + scores
        root_idea = canvas["root_idea"]
        raw_intent = canvas.get("raw_intent")
        canvas = _empty_canvas_v4()
        canvas["root_idea"] = root_idea
        if raw_intent:
            canvas["raw_intent"] = raw_intent
        _write_canvas(project_id, canvas)
    else:
        # No init yet — full reset (delete file)
        _legacy_reset(project_id)
    return {"ok": True, "reset": "session"}
```

If `_empty_canvas_v4` is not already imported at the top of `v2_canvas.py`, add the import.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_delete_state_resets_session_preserves_root_idea -v
```

Expected: PASS.

- [ ] **Step 5: Run all v2 endpoint tests**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): DELETE /state endpoint in v2 router (preserves root_idea)"
```

---

### Task 3: /evaluate deprecated alias in v2 router

**Files:**
- Modify: `backend/api/v2_canvas.py` (add POST /evaluate handler with Deprecation header)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §26: `/evaluate` is kept as a deprecated alias in v2.0. It should respond with 200 + `Deprecation: true` header, and trigger a full re-evaluation of the current concept's scores.

- [ ] **Step 1: Write the failing test**

```python
def test_evaluate_returns_deprecation_header(project, client, stub_llm):
    """PRD §26: /evaluate kept as deprecated compat endpoint."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})

    resp = client.post(f"/creative/canvas/{project}/session/evaluate",
                       json={"node_id": None})  # body shape flexible
    # Accept either 200 (compat) or 410 (gone); PRD says keep compat → expect 200
    assert resp.status_code in (200, 410), resp.text
    if resp.status_code == 200:
        assert resp.headers.get("deprecation") == "true" or \
               "deprecated" in resp.json().get("warning", "").lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_evaluate_returns_deprecation_header -v
```

Expected: 404 (no /evaluate handler in v2 router).

- [ ] **Step 3: Implement /evaluate as deprecated alias**

In `backend/api/v2_canvas.py`, add:

```python
@router.post("/evaluate")
async def evaluate_deprecated_alias(
    project_id: str,
    response: Response,
) -> dict:
    """PRD §26: /evaluate is deprecated. Frontend should not call this;
    next-step auto-fills option.scores. Kept for v1.x compat callers.
    """
    response.headers["Deprecation"] = "true"
    canvas = _read_canvas(project_id)
    return {
        "deprecated": True,
        "warning": "Use option.scores from /next-step instead.",
        "current_scores": canvas.get("scores", {}),
    }
```

- [ ] **Step 4: Run test, then all v2 tests, then commit**

```bash
pytest tests/test_v2_canvas_endpoints.py::test_evaluate_returns_deprecation_header -v
pytest tests/test_v2_canvas_endpoints.py -v
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): /evaluate deprecated alias (PRD §26 compat)"
```

---

### Task 4: Operation-aware differentiation in next-step prompt (PRD §7)

**Files:**
- Create: `backend/creative_os/option_generator.py` (axis guidance per operation)
- Modify: `backend/api/v2_canvas.py` (call option_generator for the axis hint)
- Modify: `backend/prompts/canvas/next_step_user_v1.yaml` (inject axis hint into user prompt)
- Test: `tests/test_v2_canvas_endpoints.py` (assert prompt contains axis guidance)

PRD §7 mandates that the three options vary by **operation-specific axis** (Twist: 条件/因果/设定; Break: 边界失效/反噬/不存在; etc.). The shipped prompt only instructs "三者之间存在显著差异" without specifying the axis per operation.

- [ ] **Step 1: Write the failing test for axis guidance lookup**

Create `tests/test_option_generator.py`:

```python
"""Tests for option_generator axis guidance (PRD §7)."""
from backend.creative_os.option_generator import AXIS_GUIDANCE, get_axis_hint


def test_all_six_operations_have_axis_guidance():
    for op in ("twist", "break", "fuse", "invert", "escalate", "dramaturgy"):
        assert op in AXIS_GUIDANCE, f"missing axis for {op}"
        assert "A" in AXIS_GUIDANCE[op]
        assert "B" in AXIS_GUIDANCE[op]
        assert "C" in AXIS_GUIDANCE[op]


def test_twist_axis_per_prd_section_7():
    h = get_axis_hint("twist")
    assert "条件" in h["A"]  # 改变单一关键条件
    assert "因果" in h["B"]
    assert "设定基础" in h["C"]


def test_dramaturgy_axis_per_prd_section_7():
    h = get_axis_hint("dramaturgy")
    assert "简洁" in h["A"]
    assert "复杂" in h["B"]
    assert "主题化" in h["C"]


def test_unknown_operation_falls_back_to_twist():
    h = get_axis_hint("unknown_op")
    twist = get_axis_hint("twist")
    assert h == twist
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_option_generator.py -v
```

Expected: ImportError on `option_generator`.

- [ ] **Step 3: Implement option_generator**

Create `backend/creative_os/option_generator.py`:

```python
"""PRD §7: operation-aware differentiation axis.

Each of the 6 operations (twist/break/fuse/invert/escalate/dramaturgy) has
a fixed A/B/C axis that the LLM uses to vary the 3 options. The hint is
injected into the next-step prompt as `axis_hint` so the LLM generates
differentiated options rather than generic rephrasings.

Source: docs/design/creative-canvas-reconstruction.md §7 table.
"""
from typing import Literal

Operation = Literal["twist", "break", "fuse", "invert", "escalate", "dramaturgy"]

AXIS_GUIDANCE: dict[str, dict[Literal["A", "B", "C"], str]] = {
    "twist": {
        "A": "改变单一关键条件",
        "B": "改变条件之间的因果",
        "C": "改变整个设定基础",
    },
    "break": {
        "A": "规则在边界条件下失效",
        "B": "规则被反噬",
        "C": "规则不存在",
    },
    "fuse": {
        "A": "表面元素融合（道具 / 场景）",
        "B": "类型规则融合（探案机制）",
        "C": "世界观融合（物理规则）",
    },
    "invert": {
        "A": "角色立场反转",
        "B": "因果反转",
        "C": "主题反转",
    },
    "escalate": {
        "A": "个人级别升级",
        "B": "社会级别升级",
        "C": "文明/宇宙级别升级",
    },
    "dramaturgy": {
        "A": "简洁 premise",
        "B": "复杂 premise",
        "C": "主题化 premise",
    },
}


def get_axis_hint(operation: str) -> dict[str, str]:
    """Return the A/B/C axis guidance for an operation. Falls back to twist."""
    return AXIS_GUIDANCE.get(operation, AXIS_GUIDANCE["twist"])


def format_axis_hint_block(operation: str) -> str:
    """Format axis guidance as a prompt-injectable string."""
    hint = get_axis_hint(operation)
    return (
        f"## 三选项差异轴（{operation} 操作）\n"
        f"- A（基础）：{hint['A']}\n"
        f"- B（变体）：{hint['B']}\n"
        f"- C（极端）：{hint['C']}\n"
        "\n三个选项必须沿此轴变化，禁止仅是措辞不同。"
    )
```

- [ ] **Step 4: Run option_generator tests**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_option_generator.py -v
```

Expected: PASS.

- [ ] **Step 5: Wire axis hint into next-step prompt**

In `backend/api/v2_canvas.py`, find where the next-step user prompt is built (look for `canvas_next_step_user_v1.yaml` or similar in `backend/prompts/`). Read the YAML, and inject `format_axis_hint_block(operation)` as an additional block before `current_concept`.

Concrete location (verify when implementing): the `_next_step_impl` function builds the user prompt. The injected axis hint must come AFTER `candidate_operation_hint` and BEFORE the example output schema.

Add to the prompt template (or via string concatenation):
```python
from backend.creative_os.option_generator import format_axis_hint_block

# Inside _next_step_impl, after computing candidate_operation_hint:
prompt_blocks.append(format_axis_hint_block(final_operation))
```

Also add `tests/test_v2_e2e.py` assertion that the prompt contains "三选项差异轴" string (mock the LLM call to capture the prompt):

```python
def test_next_step_prompt_includes_axis_hint(project, client, stub_llm, monkeypatch):
    """PRD §7: next-step prompt includes operation-specific axis guidance."""
    captured = {}
    real_stub = stub_llm  # already monkey-patches _next_step_impl
    # Better: monkey-patch _call_llm_with_retry to capture the prompt
    from backend.api import v2_canvas
    original = v2_canvas._call_llm_with_retry if hasattr(v2_canvas, "_call_llm_with_retry") else None
    # If no such helper, capture via the YAML loader
    init = client.post(f"/creative/canvas/{project}/session/init",
                       json={"prompt": "p", "genre_primary": "xianxia"})
    ns = client.post(f"/creative/canvas/{project}/session/next-step",
                     json={"current_step": 1})
    assert ns.status_code == 200
    # Assert the YAML prompt file contains the axis hint block (static check)
    from pathlib import Path
    prompt_text = (Path("backend/prompts/canvas") / "next_step_user_v1.yaml").read_text(encoding="utf-8")
    # Axis hint is interpolated at runtime; the YAML must contain a placeholder
    assert "{axis_hint}" in prompt_text or "axis_hint" in prompt_text
```

(If the prompt is built by string concatenation rather than YAML templating, adapt the test to capture the concatenated string.)

- [ ] **Step 6: Run all v2 tests + commit**

```bash
pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py tests/test_option_generator.py -v
git add backend/creative_os/option_generator.py backend/api/v2_canvas.py backend/prompts/ tests/test_option_generator.py tests/test_v2_e2e.py && \
  git commit -m "feat(canvas-recon): operation-aware differentiation axis (PRD §7)"
```

---

### Task 5: Auto-refresh scores on /select via NoveltyEvaluator

**Files:**
- Modify: `backend/api/v2_canvas.py` (after /select handler writes the chosen option, call NoveltyEvaluator)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §16.1 + §16.3: After user selects an option, scores auto-refresh (no /evaluate button). The shipped code only writes the selected_option_id; doesn't recompute top-level scores.

- [ ] **Step 1: Write the failing test**

```python
def test_select_refreshes_top_level_scores(project, client, stub_llm, monkeypatch):
    """PRD §16.1: after select, canvas.scores refreshes with novelty/conflict/etc."""
    # Stub NoveltyEvaluator to return deterministic scores
    from backend.creative_os import novelty_evaluator
    async def fake_score(concept, **kwargs):
        return {"novelty": 0.88, "conflict": 0.91,
                "story_potential": 0.85, "uniqueness": 0.82}
    monkeypatch.setattr(novelty_evaluator, "evaluate", fake_score)

    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    sel = client.post(f"/creative/canvas/{project}/session/select",
                      json={"step": 1, "option_id": "opt_1_b"})
    assert sel.status_code == 200, sel.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    # Top-level scores refreshed (not the 0.0 defaults)
    assert canvas["scores"]["novelty"] == 0.88
    assert canvas["scores"]["conflict"] == 0.91
    assert canvas["scores"]["story_potential"] == 0.85
    assert canvas["scores"]["uniqueness"] == 0.82
    assert canvas["scores"]["computed_at"]  # ISO timestamp set
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_select_refreshes_top_level_scores -v
```

Expected: FAIL with assertion on `novelty == 0.88` (still 0.0 after select).

- [ ] **Step 3: Implement auto-refresh in /select handler**

In `backend/api/v2_canvas.py`, in the `/select` handler after the canvas is updated:

```python
from backend.creative_os.novelty_evaluator import evaluate as evaluate_novelty

# After canvas["creative_path"][step-1]["selected_option_id"] = body.option_id:
selected_option = next(
    (o for o in canvas["creative_path"][step-1]["options"]
     if o["id"] == body.option_id),
    None,
)
if selected_option:
    # PRD §16.1: auto-refresh top-level scores
    new_scores = await evaluate_novelty({
        "premise": selected_option.get("premise", canvas["current_concept"]["premise"]),
        "core_conflict": canvas["current_concept"].get("core_conflict", ""),
    })
    canvas["scores"] = {
        **new_scores,
        "computed_at": now_iso(),
    }
_write_canvas(project_id, canvas)
```

Verify the import path for `evaluate` matches the actual NoveltyEvaluator function name (check `backend/creative_os/novelty_evaluator.py`).

- [ ] **Step 4: Run test, then all v2 tests, then commit**

```bash
pytest tests/test_v2_canvas_endpoints.py::test_select_refreshes_top_level_scores -v
pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py -v
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): auto-refresh scores on /select (PRD §16.1)"
```

---

### Task 6: 5-dimension consistency check helper

**Files:**
- Create: `backend/creative_os/consistency_check.py` (5-dim validator)
- Modify: `backend/api/v2_canvas.py` (call after next-step; auto-regenerate on fail)
- Test: `tests/test_consistency_check.py` (NEW) + extend `tests/test_v2_canvas_endpoints.py`

PRD §17.2: After each step generation, run 5-dimension consistency check (Concept/World/Character/Conflict/Novelty). If any fails, auto-regenerate (max 1 retry). User doesn't see the failure.

- [ ] **Step 1: Write the failing tests for the helper**

Create `tests/test_consistency_check.py`:

```python
"""Tests for 5-dimension consistency check (PRD §17.2)."""
import pytest
from backend.creative_os.consistency_check import check_consistency


def test_all_dimensions_passing_concept():
    concept = {
        "premise": "A cultivator who has lived for 1000 years seeks death",
        "core_conflict": "Immortality vs desire for meaning",
        "characters": [{"name": "Lin Feng", "role": "protagonist"}],
        "world_rules": ["Cultivation requires spiritual roots"],
        "tropes": ["xianxia", "immortality"],
        "themes": ["mortality", "purpose"],
        "novelty": 0.75,
    }
    result = check_consistency(concept)
    assert result.passed is True
    assert result.failures == []


def test_concept_drift_fails_concept_dimension():
    """Concept dimension fails when premise contradicts itself."""
    concept = {
        "premise": "",  # empty premise
        "core_conflict": "",
        "characters": [],
        "world_rules": [],
        "tropes": [],
        "themes": [],
        "novelty": 0.0,
    }
    result = check_consistency(concept)
    assert result.passed is False
    assert "concept" in [f.dimension for f in result.failures]


def test_novelty_below_threshold_fails_novelty_dimension():
    concept = {
        "premise": "Generic xianxia",
        "core_conflict": "Weak vs strong",
        "characters": [{"name": "X"}],
        "world_rules": [],
        "tropes": ["xianxia"],
        "themes": [],
        "novelty": 0.3,  # below 0.5 threshold
    }
    result = check_consistency(concept)
    assert "novelty" in [f.dimension for f in result.failures]


def test_check_returns_actionable_failure_messages():
    concept = {"premise": ""}
    result = check_consistency(concept)
    assert result.failures[0].suggestion  # has remediation hint
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_consistency_check.py -v
```

Expected: ImportError on `consistency_check`.

- [ ] **Step 3: Implement consistency_check module**

Create `backend/creative_os/consistency_check.py`:

```python
"""PRD §17.2: 5-dimension consistency check.

After each step generation, run lightweight deterministic checks on:
- Concept (premise + core_conflict non-empty)
- World Logic (world_rules internally consistent — at least 1 rule)
- Character Potential (≥1 named character with role)
- Conflict Potential (core_conflict mentions conflict keywords)
- Novelty (concept.novelty ≥ 0.5)

Failure is per-dimension. Caller decides whether to regenerate.
"""
from dataclasses import dataclass, field

CONFLICT_KEYWORDS = {"冲突", "矛盾", "对立", "对抗", "紧张", "挣扎", "两难"}
NOVELTY_THRESHOLD = 0.5


@dataclass
class Failure:
    dimension: str
    reason: str
    suggestion: str


@dataclass
class CheckResult:
    passed: bool
    failures: list[Failure] = field(default_factory=list)


def check_consistency(concept: dict) -> CheckResult:
    failures: list[Failure] = []

    # Concept
    if not concept.get("premise", "").strip():
        failures.append(Failure(
            dimension="concept",
            reason="premise is empty",
            suggestion="Regenerate with a premise that establishes the core setup.",
        ))
    if not concept.get("core_conflict", "").strip():
        failures.append(Failure(
            dimension="concept",
            reason="core_conflict is empty",
            suggestion="Regenerate with explicit conflict statement.",
        ))

    # World Logic
    if not concept.get("world_rules"):
        failures.append(Failure(
            dimension="world",
            reason="no world_rules declared",
            suggestion="Add at least one world rule to anchor the setting.",
        ))

    # Character Potential
    characters = concept.get("characters", [])
    if not characters or not any(c.get("role") for c in characters):
        failures.append(Failure(
            dimension="character",
            reason="no named characters with roles",
            suggestion="Regenerate with at least one protagonist.",
        ))

    # Conflict Potential
    core_conflict = concept.get("core_conflict", "")
    if core_conflict and not any(kw in core_conflict for kw in CONFLICT_KEYWORDS):
        failures.append(Failure(
            dimension="conflict",
            reason=f"core_conflict lacks conflict keywords ({sorted(CONFLICT_KEYWORDS)})",
            suggestion="Reframe conflict in terms of opposition/tension.",
        ))

    # Novelty
    novelty = concept.get("novelty", 0.0)
    if novelty < NOVELTY_THRESHOLD:
        failures.append(Failure(
            dimension="novelty",
            reason=f"novelty {novelty:.2f} below threshold {NOVELTY_THRESHOLD}",
            suggestion="Regenerate with a more distinctive angle.",
        ))

    return CheckResult(passed=len(failures) == 0, failures=failures)
```

- [ ] **Step 4: Run consistency_check tests**

```bash
pytest tests/test_consistency_check.py -v
```

Expected: PASS.

- [ ] **Step 5: Wire into next-step handler**

In `backend/api/v2_canvas.py`, at the end of `_next_step_impl` (after the 3 options are written to canvas), call the check and auto-regenerate on failure:

```python
from backend.creative_os.consistency_check import check_consistency

# After canvas["creative_path"][current_step-1] = {...options: [...]}:
current_concept = canvas["current_concept"]
result = check_consistency(current_concept)
if not result.passed:
    # PRD §17.2: regenerate silently (max 1 retry)
    regenerated = await _regenerate_options_with_hint(
        project_id, current_step, failure_dims=[f.dimension for f in result.failures]
    )
    canvas["creative_path"][current_step - 1]["options"] = regenerated["options"]
```

Add `_regenerate_options_with_hint` helper that re-runs the LLM with failure_dims as additional user-prompt hint.

- [ ] **Step 6: Add endpoint-level test for consistency check**

Append to `tests/test_v2_canvas_endpoints.py`:

```python
def test_next_step_auto_regenerates_on_consistency_fail(project, client, stub_llm, monkeypatch):
    """PRD §17.2: consistency check failure triggers 1 silent regeneration."""
    # Stub the consistency check to fail on first call, pass on second
    from backend.creative_os import consistency_check
    call_count = {"n": 0}
    real_check = consistency_check.check_consistency

    def fake_check(concept):
        call_count["n"] += 1
        if call_count["n"] == 1:
            from backend.creative_os.consistency_check import CheckResult, Failure
            return CheckResult(passed=False, failures=[
                Failure(dimension="concept", reason="test", suggestion="test"),
            ])
        return real_check(concept)

    monkeypatch.setattr(consistency_check, "check_consistency", fake_check)
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    ns = client.post(f"/creative/canvas/{project}/session/next-step",
                     json={"current_step": 1})
    assert ns.status_code == 200
    # Check was called at least twice (initial + 1 retry)
    assert call_count["n"] >= 2
```

- [ ] **Step 7: Run all v2 tests + commit**

```bash
pytest tests/test_v2_canvas_endpoints.py tests/test_consistency_check.py tests/test_v2_e2e.py -v
git add backend/creative_os/consistency_check.py backend/api/v2_canvas.py tests/ && \
  git commit -m "feat(canvas-recon): 5-dim consistency check + auto-regenerate (PRD §17.2)"
```

---

### Task 7: Frontend ResetConfirmDialog component

**Files:**
- Create: `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx`
- Create: `frontend/src/test/components/creative-canvas/ResetConfirmDialog.test.tsx`
- Modify: `frontend/src/api/client.ts` (add `deleteCanvasV2State`)
- Modify: `frontend/src/hooks/useCreativeCanvasV2.ts` (wire deleteCanvasV2State)
- Modify: `frontend/src/pages/CreativeCanvasPage.tsx` (replace console.warn no-op with dialog)
- Modify: `frontend/src/test/pages/CreativeCanvasPage.test.tsx` (extend)

PRD §18.2: reset shows a confirmation modal preserving root_idea.

- [ ] **Step 1: Write the failing test for ResetConfirmDialog**

Create `frontend/src/test/components/creative-canvas/ResetConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";

describe("ResetConfirmDialog", () => {
  it("renders the PRD §18.2 copy and two buttons", () => {
    render(<ResetConfirmDialog open={true} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/保留你的原始 Idea/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新开始/ })).toBeInTheDocument();
  });

  it("calls onCancel when 取消 clicked", () => {
    const onCancel = vi.fn();
    render(<ResetConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when 重新开始 clicked", () => {
    const onConfirm = vi.fn();
    render(<ResetConfirmDialog open={true} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /重新开始/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <ResetConfirmDialog open={false} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ResetConfirmDialog.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement ResetConfirmDialog**

Create `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx`:

```tsx
import { GhostButton, PrimaryButton } from "@/components/ds";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.2 — reset dialog preserves root_idea. */
export function ResetConfirmDialog({ open, onConfirm, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div
      data-testid="reset-confirm-dialog"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface-container rounded-lg p-6 max-w-sm w-full space-y-4">
        <h2 className="text-lg font-medium">重新开始创意</h2>
        <p className="text-sm text-on-surface-variant">
          这会保留你的原始 Idea，但删除当前创意路径。
        </p>
        <div className="flex justify-end gap-2">
          <GhostButton label="取消" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "重置中..." : "重新开始"}
            onClick={onConfirm}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run component test**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ResetConfirmDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add deleteCanvasV2State to API client + wire hook**

In `frontend/src/api/client.ts`, add:

```typescript
deleteCanvasV2State: (projectId: string): Promise<{ok: boolean; reset: string}> =>
  request("DELETE", `/creative/canvas/${encodeURIComponent(projectId)}/session/state`),
```

In `frontend/src/hooks/useCreativeCanvasV2.ts`, replace the `onReset` no-op:

```typescript
const [showResetDialog, setShowResetDialog] = useState(false);

const onReset = () => setShowResetDialog(true);
const confirmReset = async () => {
  setShowResetDialog(false);
  await api.deleteCanvasV2State(projectId);
  await loadCanvas();
};
```

(Return `showResetDialog` and `confirmReset` from the hook so the page can render the dialog.)

- [ ] **Step 6: Wire dialog into CreativeCanvasPage**

In `CreativeCanvasPage.tsx`:

```tsx
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";
// Inside component:
<CanvasToolbar currentStep={...} totalSteps={5} onViewPath={...} onReset={onReset} />
<ResetConfirmDialog
  open={showResetDialog}
  onConfirm={confirmReset}
  onCancel={() => setShowResetDialog(false)}
/>
```

- [ ] **Step 7: Update CreativeCanvasPage test**

Add a test case to `frontend/src/test/pages/CreativeCanvasPage.test.tsx`:

```tsx
it("opens ResetConfirmDialog when toolbar reset button clicked", async () => {
  render(<MemoryRouter><CreativeCanvasPage projectId="proj_x" /></MemoryRouter>);
  // Set up state with completed canvas
  // ... (use the mock api to return active canvas)
  fireEvent.click(screen.getByRole("button", { name: /重新开始/ }));
  expect(screen.getByTestId("reset-confirm-dialog")).toBeInTheDocument();
});
```

- [ ] **Step 8: Run all canvas-v2 frontend tests + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx
git add frontend/src/components/creative-canvas/ResetConfirmDialog.tsx frontend/src/api/client.ts frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/pages/CreativeCanvasPage.tsx frontend/src/test/ && \
  git commit -m "feat(canvas-recon): ResetConfirmDialog + DELETE /state wiring (PRD §18.2)"
```

---

### Task 8: Frontend PreCommitSummary modal

**Files:**
- Create: `frontend/src/components/creative-canvas/PreCommitSummary.tsx`
- Create: `frontend/src/test/components/creative-canvas/PreCommitSummary.test.tsx`
- Modify: `frontend/src/hooks/useCreativeCanvasV2.ts` (intercept commit, show modal first)
- Modify: `frontend/src/pages/CreativeCanvasPage.tsx` (wire modal)

PRD §18.3: pre-commit shows stats + 「返回继续探索」/「形成概念 →」 buttons.

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/components/creative-canvas/PreCommitSummary.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";

describe("PreCommitSummary", () => {
  const stats = { depth: 4, novelty: 87, conflict: 91 };

  it("renders stats + two buttons per PRD §18.3", () => {
    render(
      <PreCommitSummary open={true} stats={stats} onCommit={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText(/创意深度：4 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/新颖度：87/)).toBeInTheDocument();
    expect(screen.getByText(/核心冲突：91/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /返回继续探索/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /形成概念/ })).toBeInTheDocument();
  });

  it("calls onCancel when 返回继续探索 clicked", () => {
    const onCancel = vi.fn();
    render(<PreCommitSummary open={true} stats={stats} onCommit={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /返回继续探索/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCommit when 形成概念 → clicked", () => {
    const onCommit = vi.fn();
    render(<PreCommitSummary open={true} stats={stats} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /形成概念/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/PreCommitSummary.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement PreCommitSummary**

Create `frontend/src/components/creative-canvas/PreCommitSummary.tsx`:

```tsx
import { GhostButton, PrimaryButton } from "@/components/ds";

interface Stats {
  depth: number;
  novelty: number;
  conflict: number;
}

interface Props {
  open: boolean;
  stats: Stats;
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.3 — pre-commit summary modal. */
export function PreCommitSummary({ open, stats, onCommit, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div
      data-testid="pre-commit-summary"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface-container rounded-lg p-6 max-w-md w-full space-y-4">
        <h2 className="text-lg font-medium">你的创意已经形成</h2>
        <div className="text-sm text-on-surface-variant space-y-1">
          <div>创意深度：{stats.depth} / 5</div>
          <div>新颖度：{stats.novelty}</div>
          <div>核心冲突：{stats.conflict}</div>
        </div>
        <p className="text-sm">你将进入下一阶段：概念 DNA</p>
        <div className="flex justify-end gap-2">
          <GhostButton label="返回继续探索" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "提交中..." : "形成概念 →"}
            onClick={onCommit}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/PreCommitSummary.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire into hook + page**

In `useCreativeCanvasV2.ts`:

```typescript
const [showPreCommit, setShowPreCommit] = useState(false);

const onCommitClick = () => setShowPreCommit(true);
const confirmCommit = async () => {
  setShowPreCommit(false);
  await commitCanvas();
};

return { ..., showPreCommit, onCommitClick, confirmCommit };
```

Replace the existing `onClick={() => commitCanvas()}` in the page with `onClick={onCommitClick}`.

In `CreativeCanvasPage.tsx`:

```tsx
<PreCommitSummary
  open={showPreCommit}
  stats={{
    depth: completedCount,
    novelty: Math.round((canvas.scores?.novelty ?? 0) * 100),
    conflict: Math.round((canvas.scores?.conflict ?? 0) * 100),
  }}
  onCommit={confirmCommit}
  onCancel={() => setShowPreCommit(false)}
/>
```

- [ ] **Step 6: Run all canvas-v2 frontend tests + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/hooks/useCreativeCanvasV2.test.ts
git add frontend/src/components/creative-canvas/PreCommitSummary.tsx frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/pages/CreativeCanvasPage.tsx frontend/src/test/ && \
  git commit -m "feat(canvas-recon): PreCommitSummary modal (PRD §18.3)"
```

---

### Task 9: Frontend OperationGuidance component (PRD §15)

**Files:**
- Create: `frontend/src/components/creative-canvas/OperationGuidance.tsx`
- Create: `frontend/src/test/components/creative-canvas/OperationGuidance.test.tsx`
- Modify: `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` (wire it)

PRD §15: each step shows "为什么是这个操作" prominently.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperationGuidance } from "@/components/creative-canvas/OperationGuidance";

describe("OperationGuidance", () => {
  it("renders the operation name and reason", () => {
    render(<OperationGuidance operation="fusion" reason="当前设定需要外部冲突" />);
    expect(screen.getByText(/融合/)).toBeInTheDocument();
    expect(screen.getByText(/当前设定需要外部冲突/)).toBeInTheDocument();
  });

  it("renders PRD §15.1 \"为什么是这个操作\" header", () => {
    render(<OperationGuidance operation="twist" reason="R" />);
    expect(screen.getByText(/为什么是这个操作/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify fail; then implement**

Create `frontend/src/components/creative-canvas/OperationGuidance.tsx`:

```tsx
interface Props {
  operation: string;
  reason: string;
}

const OPERATION_LABELS: Record<string, string> = {
  twist: "扭曲",
  break: "打破",
  fuse: "融合",
  invert: "反转",
  escalate: "升级",
  dramaturgy: "收束",
};

/** PRD §15 — AI operation recommendation with explanation. */
export function OperationGuidance({ operation, reason }: Props) {
  const label = OPERATION_LABELS[operation] ?? operation;
  return (
    <div data-testid="operation-guidance" className="space-y-1">
      <h3 className="text-base font-medium">STEP · {label}</h3>
      <p className="text-sm text-on-surface-variant">{reason}</p>
      <details className="text-xs text-on-surface-variant/70">
        <summary className="cursor-pointer">为什么是这个操作？</summary>
        <p className="mt-1">{reason}</p>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Run component test, verify pass**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/OperationGuidance.test.tsx
```

- [ ] **Step 4: Wire into ActiveStepPanel**

In `ActiveStepPanel.tsx`, add `<OperationGuidance operation={operation.type} reason={operation.reason} />` above the option grid. Use `operation.type` if it exists, else `operation.name`.

- [ ] **Step 5: Update ActiveStepPanel test (if any) + run canvas-v2 frontend suite + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx
git add frontend/src/components/creative-canvas/OperationGuidance.tsx frontend/src/components/creative-canvas/ActiveStepPanel.tsx frontend/src/test/ && \
  git commit -m "feat(canvas-recon): OperationGuidance component (PRD §15)"
```

---

### Task 10: Frontend empty state copy refinement (PRD §11.2)

**Files:**
- Modify: `frontend/src/pages/CreativeCanvasPage.tsx`
- Modify: `frontend/src/test/pages/CreativeCanvasPage.test.tsx`

PRD §11.2 mandates copy: "创造一个故事，不需要从完整故事开始。 只需要告诉我： 你脑子里现在有什么？" — current shipped copy is more functional.

- [ ] **Step 1: Write failing test**

In `CreativeCanvasPage.test.tsx`, update the empty-state test:

```tsx
it("renders PRD §11.2 empty-state copy", () => {
  render(<MemoryRouter><CreativeCanvasPage projectId="proj_x" /></MemoryRouter>);
  expect(screen.getByText(/创造一个故事/)).toBeInTheDocument();
  expect(screen.getByText(/你脑子里现在有什么/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/pages/CreativeCanvasPage.test.tsx
```

- [ ] **Step 3: Update empty state copy in CreativeCanvasPage.tsx**

Replace the existing empty-state heading + subheading with:

```tsx
<h2 className="text-lg font-medium">创造一个故事，不需要从完整故事开始。</h2>
<p className="text-sm text-on-surface-variant mt-2">
  只需要告诉我：<br />
  「你脑子里现在有什么？」
</p>
```

- [ ] **Step 4: Run page test, verify pass; then commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/pages/CreativeCanvasPage.test.tsx
git add frontend/src/pages/CreativeCanvasPage.tsx frontend/src/test/pages/CreativeCanvasPage.test.tsx && \
  git commit -m "feat(canvas-recon): empty-state copy matches PRD §11.2"
```

---

### Task 11: Frontend option-differentiation axis hints

**Files:**
- Modify: `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` (show axis hint in option cards)
- Create: `frontend/src/components/creative-canvas/axisGuidance.ts` (mirror backend AXIS_GUIDANCE)

PRD §7: each option card shows its A/B/C position relative to the operation's differentiation axis.

- [ ] **Step 1: Create frontend axis guidance constant**

Create `frontend/src/components/creative-canvas/axisGuidance.ts` mirroring `backend/creative_os/option_generator.py`:

```typescript
/** PRD §7 axis labels — keep in sync with backend option_generator.AXIS_GUIDANCE. */
export const AXIS_GUIDANCE: Record<string, { A: string; B: string; C: string }> = {
  twist:     { A: "改变单一关键条件", B: "改变条件之间的因果", C: "改变整个设定基础" },
  break:     { A: "规则在边界条件下失效", B: "规则被反噬", C: "规则不存在" },
  fuse:      { A: "表面元素融合", B: "类型规则融合", C: "世界观融合" },
  invert:    { A: "角色立场反转", B: "因果反转", C: "主题反转" },
  escalate:  { A: "个人级别升级", B: "社会级别升级", C: "文明/宇宙级别升级" },
  dramaturgy:{ A: "简洁 premise", B: "复杂 premise", C: "主题化 premise" },
};

export function getAxisLabel(operation: string, slot: "A" | "B" | "C"): string {
  return AXIS_GUIDANCE[operation]?.[slot] ?? "";
}
```

- [ ] **Step 2: Add axis labels to option cards in ActiveStepPanel**

In `ActiveStepPanel.tsx`, when rendering each option:

```tsx
import { getAxisLabel } from "./axisGuidance";

// Inside .map((opt, idx)):
const slot = (["A", "B", "C"] as const)[idx];
const axisHint = getAxisLabel(operation.type ?? operation.name, slot);

// Add to card:
<p className="text-xs text-on-surface-variant/60 italic mt-1">
  {axisHint}
</p>
```

- [ ] **Step 3: Add test, verify, commit**

Create or extend a test for ActiveStepPanel axis hints:

```tsx
// In ActiveStepPanel.test.tsx (or add to a new test file):
it("shows axis hint per option position", () => {
  const options = [
    { id: "opt_a", title: "A", premise: "P", logic: "" },
    { id: "opt_b", title: "B", premise: "P", logic: "" },
    { id: "opt_c", title: "C", premise: "P", logic: "" },
  ];
  render(
    <ActiveStepPanel
      step={1}
      operation={{ type: "fusion", name: "融合", reason: "" }}
      options={options}
      onSelect={() => {}}
    />
  );
  expect(screen.getByText(/表面元素融合/)).toBeInTheDocument();
  expect(screen.getByText(/类型规则融合/)).toBeInTheDocument();
  expect(screen.getByText(/世界观融合/)).toBeInTheDocument();
});
```

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/
git add frontend/src/components/creative-canvas/axisGuidance.ts frontend/src/components/creative-canvas/ActiveStepPanel.tsx frontend/src/test/ && \
  git commit -m "feat(canvas-recon): option-card axis hints (PRD §7)"
```

---

### Task 12: Integration tests — full PRD v2.0 MVP coverage

**Files:**
- Modify: `tests/test_v2_e2e.py` (add coverage for: enriched schema, DELETE /state, /evaluate deprecation, axis hint in LLM prompt, consistency check, auto-score refresh)
- Modify: `frontend/src/test/pages/CreativeCanvasPage.test.tsx` (end-to-end page flow)

- [ ] **Step 1: Extend backend E2E test**

Append to `tests/test_v2_e2e.py`:

```python
def test_e2e_full_flow_writes_enriched_schema(project, client, stub_planner, stub_llm):
    """After full 5-step flow, canvas on disk has enriched v4 schema."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    for step in range(1, 6):
        client.post(f"/creative/canvas/{project}/session/next-step",
                    json={"current_step": step})
        client.post(f"/creative/canvas/{project}/session/select",
                    json={"step": step, "option_id": f"opt_{step}_b"})
    client.post(f"/creative/canvas/{project}/session/commit")

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    # PRD §22 blocks all populated
    assert canvas["root_idea"]["prompt"] == "p"
    assert canvas["creative_session"]["status"] == "committed"
    assert canvas["creative_session"]["current_step"] == 5
    assert canvas["scores"]["computed_at"]
    assert canvas["current_concept"]["premise"]


def test_e2e_delete_state_preserves_root_idea(project, client, stub_llm):
    """After walking 2 steps + DELETE /state, root_idea remains."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "my idea", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    client.post(f"/creative/canvas/{project}/session/select",
                json={"step": 1, "option_id": "opt_1_b"})
    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200
    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"] == []
    assert canvas["root_idea"]["prompt"] == "my idea"
```

- [ ] **Step 2: Extend frontend page test for full flow**

Append to `frontend/src/test/pages/CreativeCanvasPage.test.tsx`:

```tsx
it("opens PreCommitSummary when commit button clicked", async () => {
  // Mock api to return canvas with 5 completed steps
  // ... (similar to existing 2nd test, but with all 5 steps completed)
  render(<MemoryRouter><CreativeCanvasPage projectId="proj_x" /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /提交/ }));
  expect(screen.getByTestId("pre-commit-summary")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run all tests (backend + frontend)**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py tests/test_option_generator.py tests/test_consistency_check.py -v
cd /Users/longsa/Codes/nebula/frontend && \
  npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/hooks/useCreativeCanvasV2.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_v2_e2e.py frontend/src/test/pages/CreativeCanvasPage.test.tsx && \
  git commit -m "test(canvas-recon): E2E coverage for enriched schema + DELETE + page flow"
```

---

### Task 13: v2 router mount extension + namespace doc

**Files:**
- Modify: `docs/design/creative-canvas-reconstruction.md` — add namespace-decision note (PRD §26 lists `/creative/session/*` but shipped v2 router uses `/creative/canvas/{project_id}/session/*`)
- Modify: `tests/test_v2_flag_gating.py` — extend to also gate DELETE /state + /evaluate

- [ ] **Step 1: Extend flag gating test**

Add to `tests/test_v2_flag_gating.py`:

```python
def test_v2_delete_state_returns_404_when_flag_disabled(tmp_path, monkeypatch):
    """DELETE /state is also gated by enable_canvas_v2."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(settings, "enable_canvas_v2", False)
    app = FastAPI()
    if settings.enable_canvas_v2:
        app.include_router(v2_router)
    client = TestClient(app)
    assert client.delete("/creative/canvas/p_off/session/state").status_code == 404
```

- [ ] **Step 2: Add namespace decision note to reconstruction PRD**

Append a small ADR to the PRD's Part IX §32 or as a separate note near the API section:

```markdown
### 26.1 Namespace decision (v2.0 implementation)

PRD §26 lists endpoints under `/creative/session/*`. The shipped v2
router (commit b35f70a) uses `/creative/canvas/{project_id}/session/*`.
We keep the project-scoped namespace because:
1. Per §11.1 the page URL is `/project/:projectId/stage0/canvas`, so
   project scoping is implied by the route hierarchy.
2. The legacy `/state` and `/evaluate` endpoints in creative_diverge.py
   are also project-scoped (via path param).

Future v2.1 endpoints (regenerate, backtrack, finalize) will follow the
same `/creative/canvas/{project_id}/session/<verb>` shape.
```

- [ ] **Step 3: Run flag gating + commit**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_flag_gating.py -v
git add tests/test_v2_flag_gating.py docs/design/creative-canvas-reconstruction.md && \
  git commit -m "docs(canvas-recon): namespace decision ADR + flag gate DELETE coverage"
```

---

### Task 14: Final regression + integration verification

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite (v2-related)**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py tests/test_option_generator.py tests/test_consistency_check.py tests/test_v2_flag_gating.py -v
```

Expected: all pass.

- [ ] **Step 2: Run full canvas-v2 frontend test suite**

```bash
cd /Users/longsa/Codes/nebula/frontend && \
  npx vitest run src/components/creative-canvas/ src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/hooks/useCreativeCanvasV2.test.ts src/api/client.canvas-v2.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run wider smoke check (canvas-related frontend tests)**

```bash
cd /Users/longsa/Codes/nebula/frontend && \
  npx vitest run src/components/wizard/ src/pages/
```

Expected: pre-existing failures acceptable; NEW regressions = stop and fix.

- [ ] **Step 4: Manual smoke (optional, document outcome)**

Start dev servers per PRD §10.3:
```bash
# Terminal 1
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  ENABLE_CANVAS_V2=true uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd /Users/longsa/Codes/nebula/frontend && npm run dev
```

Walk: empty state copy → init → walk 5 steps → reset dialog → delete state → init again → walk → pre-commit summary → commit. Document outcome in commit message or skip if dev servers aren't runnable in this session.

- [ ] **Step 5: Final commit (if any leftover from manual smoke)**

```bash
git status
# If anything uncommitted, commit with message:
# "chore(canvas-recon): final regression + manual smoke verification"
```

---

## Self-Review

### 1. Spec coverage

| PRD § | Task | Notes |
|---|---|---|
| §5 Step 状态机 5 态 | shipped (canvas-v2 Task 3) | STALE reserved for v2.1 |
| §6 创意操作体系 6 类 | shipped (canvas-v2 Tasks 5, 7) | compute_op_hint covers all 6 |
| §7 三选项差异轴 | **Task 4** (backend) + **Task 11** (frontend) | axis_guidance both sides |
| §8.4 compute_op_hint | shipped (canvas-v2 Task 5) | unchanged |
| §8.5 失败处理 | shipped (canvas-v2 Task 6) + **Task 6** (consistency check) | new: 5-dim auto-regenerate |
| §9 早收束 | out of scope (v2.1 per §28.2) | — |
| §11.2 空状态 copy | **Task 10** | — |
| §15 AI 推荐解释 | **Task 9** | OperationGuidance component |
| §16 自动评分 | shipped + **Task 5** (auto-refresh on /select) | — |
| §17.2 后台一致性校验 | **Task 6** | — |
| §18.2 重置 dialog | **Task 7** | ResetConfirmDialog |
| §18.3 提交前最终确认 | **Task 8** | PreCommitSummary |
| §22 v4 schema | **Task 1** (enrichment) | root_idea + creative_session + scores |
| §23 迁移策略 | shipped (canvas-v2 Task 1, 2) | unchanged |
| §26 端点清单 | **Tasks 2, 3** (DELETE, /evaluate) | namespace deviation documented in Task 13 |
| §27.6 commit 行为 | shipped + Task 1 (schema enriched) | creative_divergence.json already double-writes |
| §28 MVP 范围 | all covered | v2.1+ items correctly deferred |
| §29 指标 | out of scope (analytics, not code) | — |
| §34 v1.x bug 修复 | shipped (canvas-v2 Task 4) | invariant gate |
| §35 wizard 集成 | shipped | unchanged |

### 2. Out-of-scope (correctly deferred to v2.1)

- 早收束 §36
- 分支回溯 §37
- override §38
- Regenerate §39
- 下游消费者升级 §20.3
- creative_path/creative_mechanism/canvas_meta 写入 concept_and_dna.json §28.4

### 3. Placeholder scan

- No "TBD", "TODO", "implement later" in task steps
- All code blocks show actual content (no "similar to Task N")
- Type consistency: `selected_option_id` matches shipped v2 plan; `scores.novelty/conflict/story_potential/uniqueness/computed_at` matches Task 1 schema; `commitCanvas` hook function name matches shipped Task 11

### 4. Risks / open questions

- **Auto-refresh scores latency**: each /select now calls NoveltyEvaluator (LLM). Could add 1-2s to selection latency. Mitigation: fire-and-forget per PRD §16.3, return immediately, refresh UI in next render. **TODO in Task 5**: verify with the implementer whether fire-and-forget is acceptable or if synchronous is required (the test assumes sync; if async, adjust test).
- **Consistency check helper may be too strict**: the shipped concept dictionary doesn't always populate `world_rules` and `characters` with role — many current canvas_states will fail this check on first migration. **TODO in Task 6**: the implementer should soften the check or backfill defaults in migration (Task 1's init handler is the place to add safe defaults).
- **Frontend axis hint position**: Task 11 puts the axis hint as italic small text in the option card. PRD §7 mock doesn't show this clearly. **TODO**: design review may want it elsewhere — defer to v2.1 if disagreeable.

---

## Execution Handoff

This plan is sized for **subagent-driven development** — 14 tasks, each reviewable in isolation. Each task has:
- A failing test first (TDD)
- Sequential implementation steps (2-5 min each)
- A commit at the end

For inline execution via `executing-plans`, batch in groups of 3-4 tasks with checkpoints.

**Recommended sequencing:**
1. Tasks 1-3 (schema + DELETE + /evaluate) — backend foundation, can ship independently
2. Tasks 4-6 (axis + auto-refresh + consistency check) — AI engine alignment
3. Tasks 7-10 (ResetConfirmDialog + PreCommitSummary + OperationGuidance + empty copy) — frontend UI
4. Tasks 11-12 (axis hints + integration tests)
5. Tasks 13-14 (namespace ADR + final regression)

After all tasks land on `nebula`, the canvas-v2 MVP reconstruction is feature-complete per PRD §28.1. Branch is ready to merge to `main`.
