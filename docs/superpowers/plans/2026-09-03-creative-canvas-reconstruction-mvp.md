# Creative Canvas Reconstruction v2.0 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Creative Canvas frontend around the v2 UI design (`docs/design/canvas-reconstruction/{DESIGN.md, screen.png, code.html}`) — SVG bezier tree, glass-panel option cards with AI-Recommended badge, step indicator pill + progress dots, sidebar re-integration — and align the backend v4 schema, scoring, and AI engine wiring with PRD v2.0 MVP scope (`docs/design/creative-canvas-reconstruction.md` §28.1).

**Architecture:** Three-layer rebuild:
1. **Backend foundation** (Tasks 1-6) — v4 schema enrichment, DELETE /state, /evaluate deprecated alias, operation-aware differentiation, auto-refresh scores, 5-dim consistency check. Mostly aligns with shipped canvas-v2 plan (`b35f70a..892ff00`) — closes the schema/endpoint gap.
2. **Frontend redesign** (Tasks 7-14) — replaces shipped `HorizontalPathCanvas` / `ActiveStepPanel` / `QualityBar` / `CanvasToolbar` / `CreativeCanvasPage` with design-aligned SVG tree + glass option cards. Re-enables the canvas route + sidebar tab (commit `4b05201` removed them).
3. **Polish + tests** (Tasks 15-16) — empty state, reset/pre-commit modals styled, E2E coverage, namespace ADR.

**Tech Stack:** Python 3.9 / FastAPI / pytest, React 18 + Vite + Vitest / Tailwind CSS, Material Symbols Outlined icon font, JetBrains Mono + Hanken Grotesk + Inter (already imported by Stage1 design system). Existing design-system primitives from `frontend/src/components/ds/` (PrimaryButton / SecondaryButton / GhostButton).

**Design system tokens (read first):** `docs/design/canvas-reconstruction/DESIGN.md` is authoritative for the canvas page. Use Tailwind classes `bg-primary`, `text-on-surface-variant`, `bg-surface-container`, `bg-surface-container-highest`, `glass-panel` custom utility, `glow-active` custom utility. Colors: primary `#38bdf8`, surface `#051424`, surface-container `#122131`, surface-container-highest `#273647`, outline-variant `#3e484f`. Border radius: `rounded-lg` (cards), `rounded-full` (chips/pills). Stats use `font-stats-number` (JetBrains Mono 24px/600) for numbers and `font-label-sm` (JetBrains Mono 12px/500 uppercase) for labels.

**Out of scope (v2.1+, deferred per PRD §28.2):** early-finalize (§36), backtrack (§37), override (§38), regenerate (§39), downstream consumer upgrades (§20.3), `creative_path`/`creative_mechanism`/`canvas_meta` fields in `concept_and_dna.json` (§28.4 — v2.0 commit keeps v3-compat output).

---

## File Structure

**Backend (modified):**
- `backend/api/creative_diverge.py` — `_empty_canvas_v4` enrichment + `root_idea` write-on-init (Task 1)
- `backend/api/v2_canvas.py` — DELETE /state, /evaluate deprecated alias (Tasks 2-3), operation-aware axis prompt (Task 4), auto-refresh scores on /select (Task 5), 5-dim consistency check hook (Task 6)
- `backend/creative_os/option_generator.py` (NEW) — axis guidance per operation, single source for both backend prompt + frontend axis labels (Task 4)
- `backend/creative_os/consistency_check.py` (NEW) — 5-dim validator (Task 6)

**Frontend (heavily modified — replaces shipped canvas-v2 components):**
- `frontend/src/components/creative-canvas/TreeCanvas.tsx` (NEW) — SVG bezier tree of option nodes per step (Task 7). Replaces shipped `HorizontalPathCanvas.tsx` — file is deleted in Task 7.
- `frontend/src/components/creative-canvas/OptionCard.tsx` (NEW) — glass-panel option card with AI Recommended badge (Task 8). Replaces shipped `ActiveStepPanel.tsx`.
- `frontend/src/components/creative-canvas/StepIndicator.tsx` (NEW) — top-right step pill + progress dots (Task 9).
- `frontend/src/components/creative-canvas/IdeaRootNode.tsx` (NEW) — the column-1 idea card with flag icon (Task 7).
- `frontend/src/components/creative-canvas/OptionNode.tsx` (NEW) — circle node (A/B/C or ✓) for the tree (Task 7).
- `frontend/src/components/creative-canvas/TreePath.tsx` (NEW) — SVG bezier path renderer (Task 7).
- `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx` (NEW) — glass-styled modal (Task 11).
- `frontend/src/components/creative-canvas/PreCommitSummary.tsx` (NEW) — glass-styled modal with stats (Task 12).
- `frontend/src/components/creative-canvas/EmptyState.tsx` (NEW) — initial empty canvas card (Task 13).
- `frontend/src/components/creative-canvas/CreativeCanvasPage.tsx` (rewrite) — wires all of the above (Task 14).
- `frontend/src/components/creative-canvas/QualityBar.tsx` (modify) — drop 3rd bar (故事潜力) and the 4th uniqueness, keep only Novelty + Conflict to match the design's 2-stat display (Task 8).
- `frontend/src/api/client.ts` (modify) — add `deleteCanvasV2State()`, `evaluateCanvasV2()`, change `CreativeOption` to include `theme_name: string` (Tasks 2, 8, 11).
- `frontend/src/hooks/useCreativeCanvasV2.ts` (modify) — replace `console.warn` reset no-op, add `showResetDialog` + `showPreCommit` state, return both (Tasks 11, 12).
- `frontend/src/App.tsx` (modify) — re-enable `/stage1/canvas` route to render `<CreativeCanvasPage>` (Task 14, completes entry-cleanup commit `4b05201` reversal).
- `frontend/src/components/layout/Stage1Layout.tsx` (modify) — re-add the 创意画布 tab (Task 14).

**Deleted (replaced by redesign):**
- `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx` (Task 7)
- `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` (Task 8)
- `frontend/src/components/creative-canvas/CanvasToolbar.tsx` (Task 9 inlines its concerns into StepIndicator + page-level buttons)

**Tests (modified):**
- `tests/test_v2_canvas_endpoints.py` (extend) — Tasks 1-6 coverage
- `tests/test_v2_e2e.py` (extend) — Tasks 1, 2, 5, 6 E2E
- `tests/test_option_generator.py` (NEW) — Task 4
- `tests/test_consistency_check.py` (NEW) — Task 6
- `frontend/src/test/components/creative-canvas/TreeCanvas.test.tsx` (NEW) — Task 7
- `frontend/src/test/components/creative-canvas/OptionCard.test.tsx` (NEW) — Task 8
- `frontend/src/test/components/creative-canvas/StepIndicator.test.tsx` (NEW) — Task 9
- `frontend/src/test/components/creative-canvas/ResetConfirmDialog.test.tsx` (NEW) — Task 11
- `frontend/src/test/components/creative-canvas/PreCommitSummary.test.tsx` (NEW) — Task 12
- `frontend/src/test/pages/CreativeCanvasPage.test.tsx` (rewrite) — Task 14

**Docs:**
- `docs/design/creative-canvas-reconstruction.md` — append namespace ADR (Task 15)

---

### Task 1: v4 schema enrichment (root_idea + creative_session + scores)

**Files:**
- Modify: `backend/api/creative_diverge.py:_empty_canvas_v4` (around line 367 per shipped v2 plan)
- Modify: `backend/api/creative_diverge.py` — `/init` handler writes root_idea double-field per PRD §23.4
- Modify: `backend/api/v2_canvas.py:_next_step_impl` — post-process LLM option ids to step-scoped format
- Modify: `frontend/src/api/client.ts` (CanvasV4State.extracted + scores) — tighten types to match PRD §22
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §22 mandates `root_idea`, `creative_session`, `current_concept`, top-level `scores`, and `session_metadata.elapsed_seconds`. Shipped v4 has only `raw_intent` and minimal `session_metadata`. The UI design shows root_idea as a card column with "原始想法" + the user's prompt truncated to 16 chars ("修仙对抗外星") — so `root_idea.prompt` and `root_idea.short_label` both matter.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_v2_canvas_endpoints.py`:

```python
def test_init_writes_enriched_v4_schema_with_root_idea(project, client, stub_llm):
    """PRD §22 + §23.4 + UI design (root_idea card column)."""
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "修仙对抗外星舰队的可能性", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    # PRD §22 root_idea block (used by IdeaRootNode in design)
    assert canvas["root_idea"]["prompt"] == "修仙对抗外星舰队的可能性"
    assert canvas["root_idea"]["genre"] == "xianxia"
    assert "extracted" in canvas["root_idea"]
    # PRD §22 creative_session block (used by StepIndicator)
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["creative_session"]["max_steps"] == 5
    assert canvas["creative_session"]["status"] == "active"
    # PRD §22 top-level scores (used by QualityBar in option cards)
    assert "scores" in canvas
    assert canvas["scores"]["computed_at"]  # ISO timestamp
    # PRD §23.4 raw_intent double-write
    assert canvas["raw_intent"]["prompt"] == "修仙对抗外星舰队的可能性"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_init_writes_enriched_v4_schema_with_root_idea -v
```

Expected: FAIL with `KeyError: 'root_idea'`.

- [ ] **Step 3: Extend _empty_canvas_v4 + init handler**

In `backend/api/creative_diverge.py`, modify `_empty_canvas_v4()`:

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
            "premise": "", "core_conflict": "",
            "characters": [], "world_rules": [], "tropes": [], "themes": [],
            "novelty": 0.0,
        },
        "final_concept": None,
        "committed": False,
        "committed_at": None,
        "committed_concept_ref": "concept_and_dna.json",
        "scores": {"novelty": 0.0, "conflict": 0.0,
                   "story_potential": 0.0, "uniqueness": 0.0,
                   "computed_at": now},
        "session_metadata": {
            "created_at": now, "last_modified_at": now,
            "elapsed_seconds": 0, "operation_count": 0,
        },
    }
```

In the init handler, after creating the empty canvas:

```python
canvas = _empty_canvas_v4()
canvas["raw_intent"] = data.raw_intent.dict()  # PRD §23.4 double-write
canvas["root_idea"] = {
    "prompt": data.raw_intent.prompt,
    "genre": data.raw_intent.genre_primary,
    "premise": data.raw_intent.prompt,
    "extracted": {"core_elements": data.raw_intent.trope_tags or []},
}
canvas["current_concept"]["premise"] = data.raw_intent.prompt
canvas["session_metadata"]["created_at"] = now_iso()
_write_canvas(project_id, canvas)
```

In `backend/prompts/canvas_v2_next_step.yaml` lines 9-11, change option ids to slot-only format (keep LLM prompt simple — backend renumbers after parsing):

```yaml
{ "id": "opt_a", "title": "...", "premise": "...", "logic": "..." },
{ "id": "opt_b", "title": "...", "premise": "...", "logic": "..." },
{ "id": "opt_c", "title": "...", "premise": "...", "logic": "..." }
```

(Keep as-is — backend renumbers to `opt_{step}_{slot}` after parsing in step 3 below.)

In `backend/api/v2_canvas.py:_next_step_impl`, after `parsed = await _call_llm_with_retry(...)` (around line 305), renumber option ids to match PRD §22 + frontend TreeCanvas lookup:

```python
# Renumber option ids to be step-scoped (LLM produces opt_a/b/c; TreeCanvas looks up opt_{step}_{slot})
for idx, opt in enumerate(parsed["options"]):
    slot = ("a", "b", "c")[idx] if idx < 3 else f"x{idx}"
    opt["id"] = f"opt_{current_step}_{slot}"
```

In `frontend/src/api/client.ts`, tighten types to match PRD §22:

```typescript
export interface RootIdeaExtracted {
  genre: string;
  core_elements: string[];
  potential_conflict: string;
}

export interface CanvasV4State {
  // ...existing fields...
  root_idea: {
    prompt: string;
    genre: string;
    premise: string;
    extracted: RootIdeaExtracted;
  };
  scores: {
    novelty: number;
    conflict: number;
    story_potential: number;
    uniqueness: number;
    computed_at: string;
  };
}
```

- [ ] **Step 4: Run test, verify pass; run all v2 tests; commit**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_init_writes_enriched_v4_schema_with_root_idea -v
pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py -v
git add backend/api/creative_diverge.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): enrich v4 schema with root_idea + creative_session + scores"
```

---

### Task 2: DELETE /state endpoint in v2 router

**Files:**
- Modify: `backend/api/v2_canvas.py` (add `DELETE /state` handler)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §26 + §18.2: DELETE /state resets session while preserving `root_idea`. The legacy `/state` DELETE exists in `backend/api/creative_diverge.py` but the v2 router (under `enable_canvas_v2` flag) does NOT expose it. Task 11 (frontend) wires the reset button to this endpoint.

- [ ] **Step 1: Write the failing test**

```python
def test_delete_state_resets_session_preserves_root_idea(project, client, stub_llm):
    """PRD §18.2: DELETE /state wipes creative_path but keeps root_idea."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    client.post(f"/creative/canvas/{project}/session/select",
                json={"step": 1, "option_id": "opt_1_b"})

    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"] == []
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["root_idea"]["prompt"] == "p"
    assert canvas["creative_session"]["status"] == "active"
```

- [ ] **Step 2: Run test, verify fail (expect 404)**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_delete_state_resets_session_preserves_root_idea -v
```

- [ ] **Step 3: Implement DELETE /state in v2 router**

In `backend/api/v2_canvas.py`, after the existing `GET /state` handler:

```python
@router.delete("/state")
async def delete_canvas_state(project_id: str) -> dict:
    """PRD §18.2: reset session, preserve root_idea.

    Preserves root_idea + raw_intent; wipes creative_path + scores +
    creative_session (back to step 1 / active). When no init has been
    done, deletes canvas_state.json entirely.
    """
    canvas = _read_canvas(project_id)
    if canvas.get("root_idea", {}).get("prompt"):
        root_idea = canvas["root_idea"]
        raw_intent = canvas.get("raw_intent")
        canvas = _empty_canvas_v4()
        canvas["root_idea"] = root_idea
        if raw_intent:
            canvas["raw_intent"] = raw_intent
        _write_canvas(project_id, canvas)
    else:
        from pathlib import Path
        from backend.config import settings as cfg
        path = Path(cfg.projects_dir) / project_id / "creative_os" / "canvas_state.json"
        if path.exists():
            path.unlink()
    return {"ok": True, "reset": "session"}
```

Add `_empty_canvas_v4` import if not already present.

- [ ] **Step 4: Run test, verify pass; run all v2 tests; commit**

```bash
pytest tests/test_v2_canvas_endpoints.py::test_delete_state_resets_session_preserves_root_idea -v
pytest tests/test_v2_canvas_endpoints.py -v
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): DELETE /state endpoint in v2 router"
```

---

### Task 3: /evaluate deprecated alias in v2 router

**Files:**
- Modify: `backend/api/v2_canvas.py` (add POST /evaluate handler)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §26: `/evaluate` is kept as deprecated compat endpoint. Returns 200 with `Deprecation: true` header. Used by v1.x callers; v2.0 frontend uses auto-refreshed scores from /select instead (Task 5).

- [ ] **Step 1: Write the failing test**

```python
def test_evaluate_returns_deprecation_header(project, client, stub_llm):
    """PRD §26: /evaluate kept as deprecated compat endpoint."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})

    resp = client.post(f"/creative/canvas/{project}/session/evaluate",
                       json={"node_id": None})
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("deprecation") == "true"
    body = resp.json()
    assert body["deprecated"] is True
```

- [ ] **Step 2: Run test, verify fail (404)**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_evaluate_returns_deprecation_header -v
```

- [ ] **Step 3: Implement /evaluate as deprecated alias**

In `backend/api/v2_canvas.py`:

```python
from fastapi import Response

@router.post("/evaluate")
async def evaluate_deprecated_alias(project_id: str, response: Response) -> dict:
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

- [ ] **Step 4: Run test, verify pass; commit**

```bash
pytest tests/test_v2_canvas_endpoints.py::test_evaluate_returns_deprecation_header -v
pytest tests/test_v2_canvas_endpoints.py -v
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): /evaluate deprecated alias (PRD §26)"
```

---

### Task 4: Operation-aware differentiation axis (backend)

**Files:**
- Create: `backend/creative_os/option_generator.py` (axis guidance per operation)
- Modify: `backend/api/v2_canvas.py` (inject axis hint into next-step prompt)
- Test: `tests/test_option_generator.py` (NEW)

PRD §7: each of the 6 operations has a fixed A/B/C differentiation axis. The shipped prompt only says "三者之间存在显著差异" — too vague. The UI design's option card titles ("融合 A: 克苏鲁神话") imply the LLM should produce distinctive themed options, not generic rephrasings.

- [ ] **Step 1: Write failing tests**

Create `tests/test_option_generator.py`:

```python
"""PRD §7: operation-aware differentiation axis."""
from backend.creative_os.option_generator import AXIS_GUIDANCE, get_axis_hint, format_axis_hint_block


def test_all_six_operations_have_axis_guidance():
    for op in ("twist", "break", "fuse", "invert", "escalate", "dramaturgy"):
        assert op in AXIS_GUIDANCE
        for slot in ("A", "B", "C"):
            assert slot in AXIS_GUIDANCE[op]


def test_axis_hint_per_operation_matches_prd_section_7():
    assert "条件" in get_axis_hint("twist")["A"]
    assert "规则" in get_axis_hint("break")["A"]
    assert "元素" in get_axis_hint("fuse")["A"]
    assert "立场" in get_axis_hint("invert")["A"]
    assert "个人" in get_axis_hint("escalate")["A"]
    assert "简洁" in get_axis_hint("dramaturgy")["A"]


def test_unknown_operation_falls_back_to_twist():
    assert get_axis_hint("unknown") == get_axis_hint("twist")


def test_format_axis_hint_block_includes_slot_markers():
    block = format_axis_hint_block("fusion")
    assert "A（基础）" in block
    assert "B（变体）" in block
    assert "C（极端）" in block
    assert "fusion" in block
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_option_generator.py -v
```

- [ ] **Step 3: Implement option_generator**

Create `backend/creative_os/option_generator.py`:

```python
"""PRD §7: operation-aware differentiation axis.

Source: docs/design/creative-canvas-reconstruction.md §7 table.
Mirrored in frontend `frontend/src/components/creative-canvas/axisGuidance.ts`
— keep both sides in sync.
"""
from typing import Literal

Operation = Literal["twist", "break", "fuse", "invert", "escalate", "dramaturgy"]

AXIS_GUIDANCE: dict[str, dict[Literal["A", "B", "C"], str]] = {
    "twist":      {"A": "改变单一关键条件",  "B": "改变条件之间的因果", "C": "改变整个设定基础"},
    "break":      {"A": "规则在边界条件下失效", "B": "规则被反噬",     "C": "规则不存在"},
    "fuse":       {"A": "表面元素融合（道具/场景）", "B": "类型规则融合", "C": "世界观融合（物理规则）"},
    "invert":     {"A": "角色立场反转",       "B": "因果反转",       "C": "主题反转"},
    "escalate":   {"A": "个人级别升级",       "B": "社会级别升级",   "C": "文明/宇宙级别升级"},
    "dramaturgy": {"A": "简洁 premise",       "B": "复杂 premise",   "C": "主题化 premise"},
}


def get_axis_hint(operation: str) -> dict[str, str]:
    return AXIS_GUIDANCE.get(operation, AXIS_GUIDANCE["twist"])


def format_axis_hint_block(operation: str) -> str:
    hint = get_axis_hint(operation)
    return (
        f"## 三选项差异轴（{operation} 操作）\n"
        f"- A（基础）：{hint['A']}\n"
        f"- B（变体）：{hint['B']}\n"
        f"- C（极端）：{hint['C']}\n"
        "\n三个选项必须沿此轴变化，禁止仅是措辞不同。"
    )
```

- [ ] **Step 4: Wire into next-step prompt template**

The actual prompt assembly is in `backend/prompts/canvas_v2_next_step.yaml`. Modify the `user:` section (lines 24-29) to include the axis hint:

```yaml
user: |
  current_concept: {premise} | 核心冲突: {core_conflict} | 角色: {characters} | 世界规则: {world_rules} | 类型标签: {tropes} | 主题: {themes}
  selected_path: {selected_path_summary}
  current_step: {current_step}
  max_steps: {max_steps}
  candidate_operation_hint: {candidate_operation_hint}

  ## 三选项差异轴（{operation} 操作）
  - A（基础）：{axis_hint_a}
  - B（变体）：{axis_hint_b}
  - C（极端）：{axis_hint_c}

  三个选项必须沿此轴变化，禁止仅是措辞不同。
```

In `backend/api/v2_canvas.py:_next_step_impl` (around line 285, before `_call_llm_with_retry`), populate the new placeholders:

```python
from backend.creative_os.option_generator import get_axis_hint

hint = get_axis_hint(parsed["operation"])  # actually, operation isn't known yet — use the candidate_operation_hint-derived operation
# Better: pass the *final* operation decision here. The shipped code reads hint from context.

# The existing code computes operation from `parsed["operation"]` after LLM call.
# So the placeholder population happens AFTER llm call but BEFORE writing the canvas:
axis_hint = get_axis_hint(parsed["operation"])
# Then write back the rendered prompt? No — the prompt is sent in, not out.
# Actually: pre-render before LLM call, using the candidate_operation_hint's resolved operation:
operation_for_hint = context.get("operation_resolved") or context.get("operation_hint") or parsed.get("operation")
```

(Cleaner approach: do a two-pass — first LLM call picks operation (no axis hint needed), then second LLM call generates options WITH the axis hint for that operation. Implementation choice — adjust based on shipping decision. MVP keeps single-call: inject axis hint derived from candidate_operation_hint BEFORE LLM call.)

- [ ] **Step 5: Add endpoint assertion test**

Append to `tests/test_v2_canvas_endpoints.py`:

```python
def test_next_step_prompt_renders_axis_hint_block(project, client, stub_llm):
    """PRD §7: next-step template renders operation-specific axis guidance."""
    from pathlib import Path

    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    ns = client.post(f"/creative/canvas/{project}/session/next-step",
                     json={"current_step": 1})
    assert ns.status_code == 200

    # Verify the YAML template has the placeholders + the option_generator module
    # produces the expected text for at least one operation
    yaml_text = Path("backend/prompts/canvas_v2_next_step.yaml").read_text(encoding="utf-8")
    assert "{axis_hint_a}" in yaml_text
    assert "{axis_hint_b}" in yaml_text
    assert "{axis_hint_c}" in yaml_text

    from backend.creative_os.option_generator import format_axis_hint_block
    fuse_block = format_axis_hint_block("fuse")
    assert "融合" not in fuse_block  # module is operation-agnostic
    assert "fuse" in fuse_block
    assert "A（基础）" in fuse_block
```

- [ ] **Step 6: Run all tests + commit**

```bash
pytest tests/test_option_generator.py tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py -v
git add backend/creative_os/option_generator.py backend/api/v2_canvas.py tests/ && \
  git commit -m "feat(canvas-recon): operation-aware differentiation axis (PRD §7)"
```

---

### Task 5: Auto-refresh scores on /select via NoveltyEvaluator

**Files:**
- Modify: `backend/api/v2_canvas.py` (call NoveltyEvaluator after writing selected_option_id)
- Test: `tests/test_v2_canvas_endpoints.py` (extend)

PRD §16.1 + §16.3: after user selects an option, top-level `scores` auto-refresh. The shipped code only writes `selected_option_id`; the UI design shows Novelty/Conflict in the option cards AND in a top-bar, both updated reactively.

- [ ] **Step 1: Write the failing test**

```python
def test_select_refreshes_top_level_scores(project, client, stub_llm, monkeypatch):
    """PRD §16.1: after /select, canvas.scores refreshes."""
    from backend.creative_os import novelty_evaluator

    def fake_evaluate(self, content):
        # Sync (not async) — Task 5 wraps with run_in_executor
        from backend.creative_os.novelty_evaluator import NoveltyScore
        return NoveltyScore(novelty=0.88, conflict=0.91,
                            story_potential=0.85, uniqueness=0.82)

    monkeypatch.setattr(novelty_evaluator.NoveltyEvaluator, "evaluate", fake_evaluate)

    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    sel = client.post(f"/creative/canvas/{project}/session/select",
                      json={"step": 1, "option_id": "opt_1_b"})
    assert sel.status_code == 200, sel.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["scores"]["novelty"] == 0.88
    assert canvas["scores"]["conflict"] == 0.91
    assert canvas["scores"]["computed_at"]
```

- [ ] **Step 2: Run test, verify fail (expect scores still 0.0)**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py::test_select_refreshes_top_level_scores -v
```

- [ ] **Step 3: Implement auto-refresh in /select handler**

In `backend/api/v2_canvas.py`, in the `/select` handler after `selected_option_id` is written:

```python
from backend.creative_os.novelty_evaluator import NoveltyEvaluator
import asyncio

# After canvas["creative_path"][step-1]["selected_option_id"] = body.option_id:
selected_option = next(
    (o for o in canvas["creative_path"][step-1]["options"]
     if o["id"] == body.option_id),
    None,
)
if selected_option:
    concept_for_eval = selected_option.get("premise", canvas["current_concept"]["premise"])
    # PRD §16.3: best-effort; NoveltyEvaluator.evaluate is SYNC — wrap with to_thread
    try:
        loop = asyncio.get_running_loop()
        new_score = await asyncio.wait_for(
            loop.run_in_executor(None, NoveltyEvaluator().evaluate, concept_for_eval),
            timeout=3.0,
        )
        # new_score is a NoveltyScore dataclass; convert to dict
        canvas["scores"] = {
            "novelty": getattr(new_score, "novelty", 0.0),
            "conflict": getattr(new_score, "conflict", 0.0),
            "story_potential": getattr(new_score, "story_potential", 0.0),
            "uniqueness": getattr(new_score, "uniqueness", 0.0),
            "computed_at": now_iso(),
        }
    except (asyncio.TimeoutError, Exception) as e:
        # Don't block the user's select action on evaluator failure
        canvas["scores"] = {**canvas.get("scores", {}), "computed_at": now_iso()}
    _write_canvas(project_id, canvas)
```

(Adjust `NoveltyEvaluator` instantiation — it may already be a singleton in `backend/creative_os/novelty_evaluator.py`. Check before constructing.)

- [ ] **Step 4: Run test, verify pass; run all v2 tests; commit**

```bash
pytest tests/test_v2_canvas_endpoints.py::test_select_refreshes_top_level_scores -v
pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py -v
git add backend/api/v2_canvas.py tests/test_v2_canvas_endpoints.py && \
  git commit -m "feat(canvas-recon): auto-refresh scores on /select (PRD §16.1)"
```

---

### Task 6: 5-dimension consistency check helper

**Files:**
- Create: `backend/creative_os/consistency_check.py`
- Modify: `backend/api/v2_canvas.py` (call after next-step; silent auto-regen on fail)
- Test: `tests/test_consistency_check.py` (NEW) + extend `tests/test_v2_canvas_endpoints.py`

PRD §17.2: post-step consistency check (Concept/World/Character/Conflict/Novelty). Auto-regenerate max 1 time on fail.

- [ ] **Step 1: Write failing tests for the helper**

Create `tests/test_consistency_check.py`:

```python
import pytest
from backend.creative_os.consistency_check import check_consistency


def test_all_dimensions_passing_returns_no_failures():
    concept = {
        "premise": "Cultivator seeks death after 1000 years",
        "core_conflict": "Immortality vs desire for meaning",
        "characters": [{"name": "Lin Feng", "role": "protagonist"}],
        "world_rules": ["Cultivation requires spiritual roots"],
        "tropes": ["xianxia"],
        "themes": ["mortality"],
        "novelty": 0.75,
    }
    result = check_consistency(concept)
    assert result.passed is True
    assert result.failures == []


def test_empty_premise_fails_concept_dimension():
    result = check_consistency({"premise": ""})
    assert "concept" in [f.dimension for f in result.failures]


def test_no_world_rules_fails_world_dimension():
    result = check_consistency({
        "premise": "x", "core_conflict": "y",
        "characters": [{"name": "a", "role": "p"}],
        "world_rules": [], "tropes": [], "themes": [], "novelty": 0.6,
    })
    assert "world" in [f.dimension for f in result.failures]


def test_novelty_below_threshold_fails():
    result = check_consistency({
        "premise": "x", "core_conflict": "y",
        "characters": [{"name": "a", "role": "p"}],
        "world_rules": ["r"], "tropes": [], "themes": [], "novelty": 0.3,
    })
    assert "novelty" in [f.dimension for f in result.failures]


def test_failure_includes_suggestion():
    result = check_consistency({"premise": ""})
    assert result.failures[0].suggestion
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_consistency_check.py -v
```

- [ ] **Step 3: Implement consistency_check**

Create `backend/creative_os/consistency_check.py`:

```python
"""PRD §17.2: 5-dimension consistency check.

Deterministic checks on the current concept state:
- Concept (premise + core_conflict non-empty)
- World Logic (≥1 world_rule declared)
- Character Potential (≥1 named character with role)
- Conflict Potential (core_conflict mentions opposition keywords)
- Novelty (concept.novelty ≥ 0.5)

Failure is per-dimension. Caller decides whether to regenerate.
"""
from dataclasses import dataclass, field

CONFLICT_KEYWORDS = {"冲突", "矛盾", "对立", "对抗", "紧张", "挣扎", "两难", "vs"}
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

    if not (concept.get("premise") or "").strip():
        failures.append(Failure("concept", "premise is empty",
                                "Regenerate with a premise that establishes the core setup."))
    if not (concept.get("core_conflict") or "").strip():
        failures.append(Failure("concept", "core_conflict is empty",
                                "Regenerate with explicit conflict statement."))

    if not concept.get("world_rules"):
        failures.append(Failure("world", "no world_rules declared",
                                "Add at least one world rule to anchor the setting."))

    characters = concept.get("characters", [])
    if not characters or not any(c.get("role") for c in characters):
        failures.append(Failure("character", "no named characters with roles",
                                "Regenerate with at least one protagonist."))

    core_conflict = concept.get("core_conflict", "")
    if core_conflict and not any(kw in core_conflict for kw in CONFLICT_KEYWORDS):
        failures.append(Failure(
            "conflict",
            f"core_conflict lacks conflict keywords ({sorted(CONFLICT_KEYWORDS)})",
            "Reframe conflict in terms of opposition/tension.",
        ))

    novelty = concept.get("novelty", 0.0)
    if novelty < NOVELTY_THRESHOLD:
        failures.append(Failure("novelty",
                                f"novelty {novelty:.2f} below {NOVELTY_THRESHOLD}",
                                "Regenerate with a more distinctive angle."))

    return CheckResult(passed=len(failures) == 0, failures=failures)
```

- [ ] **Step 4: Run consistency tests, verify pass**

```bash
pytest tests/test_consistency_check.py -v
```

- [ ] **Step 5: Wire into next-step handler**

In `backend/api/v2_canvas.py`, at end of `_next_step_impl` after `creative_path[current_step-1] = {...options: [...]}`:

```python
from backend.creative_os.consistency_check import check_consistency

# After current_concept is updated from the LLM response:
result = check_consistency(canvas["current_concept"])
# PRD §17.2: regenerate silently, max 1 retry. Exempt `novelty` dimension
# because current_concept.novelty is initialized to 0.0 and only updated
# by the LLM response (which doesn't always set it) — would otherwise
# trigger spurious regen on every step.
non_novelty_failures = [f for f in result.failures if f.dimension != "novelty"]
if non_novelty_failures and current_step < 5:  # don't regen on final dramaturgy
    canvas["creative_path"][current_step - 1]["regenerated_count"] = \
        canvas["creative_path"][current_step - 1].get("regenerated_count", 0) + 1
    regenerated = await _regenerate_options_with_hint(
        project_id, current_step,
        failure_dims=[f.dimension for f in non_novelty_failures],
    )
    canvas["creative_path"][current_step - 1]["options"] = regenerated["options"]
```

Add `_regenerate_options_with_hint` helper that re-runs the LLM with the failure dimensions as an additional prompt hint.

- [ ] **Step 6: Add endpoint test for auto-regenerate**

```python
def test_next_step_auto_regenerates_on_consistency_fail(project, client, stub_llm, monkeypatch):
    """PRD §17.2: consistency failure triggers 1 silent regeneration."""
    from backend.creative_os import consistency_check
    call_count = {"n": 0}
    real_check = consistency_check.check_consistency

    def fake_check(concept):
        call_count["n"] += 1
        if call_count["n"] == 1:
            from backend.creative_os.consistency_check import CheckResult, Failure
            return CheckResult(passed=False,
                               failures=[Failure("concept", "test", "test")])
        return real_check(concept)

    monkeypatch.setattr(consistency_check, "check_consistency", fake_check)
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    ns = client.post(f"/creative/canvas/{project}/session/next-step",
                     json={"current_step": 1})
    assert ns.status_code == 200
    assert call_count["n"] >= 2
```

- [ ] **Step 7: Run all v2 tests + commit**

```bash
pytest tests/test_v2_canvas_endpoints.py tests/test_consistency_check.py tests/test_v2_e2e.py -v
git add backend/creative_os/consistency_check.py backend/api/v2_canvas.py tests/ && \
  git commit -m "feat(canvas-recon): 5-dim consistency check + auto-regenerate (PRD §17.2)"
```

---

### Task 7: Frontend TreeCanvas (SVG bezier tree)

**Files:**
- Delete: `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx`
- Delete: `frontend/src/test/components/creative-canvas/QualityBar.test.tsx` is kept (QualityBar remains for option-card stat display)
- Create: `frontend/src/components/creative-canvas/TreeCanvas.tsx` (orchestrator)
- Create: `frontend/src/components/creative-canvas/IdeaRootNode.tsx`
- Create: `frontend/src/components/creative-canvas/OptionNode.tsx`
- Create: `frontend/src/components/creative-canvas/TreePath.tsx`
- Create: `frontend/src/test/components/creative-canvas/TreeCanvas.test.tsx`

This is the biggest visual change. The shipped `HorizontalPathCanvas` (flat row of cells) is replaced with a **multi-column SVG bezier tree** matching `code.html` lines 226-371. Columns: `IdeaRoot` + Step 1-5 (each with 3 stacked option nodes A/B/C). Curved bezier paths between selected nodes glow primary; unselected branches are dashed gray. Current step's center node pulses.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/components/creative-canvas/TreeCanvas.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreeCanvas } from "@/components/creative-canvas/TreeCanvas";
import type { CreativeStep, CanvasV4State } from "@/api/client";

const baseState: Partial<CanvasV4State> = {
  schema_version: 4,
  session_id: "s",
  root_idea: {
    prompt: "修仙对抗外星",
    genre: "xianxia",
    premise: "x",
    extracted: { genre: "xianxia", core_elements: [], potential_conflict: "" },
  },
  creative_session: { current_step: 3, max_steps: 5, status: "active" },
  creative_path: [
    { step: 1, operation: "twist", operation_reason: "r",
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
      ],
      selected_option_id: "opt_1_b",
      created_at: "2026-09-03T00:00:00", selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0, state: "completed" },
    { step: 2, operation: "invert", operation_reason: "r",
      options: [
        { id: "opt_2_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_2_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_2_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: "opt_2_c",
      created_at: "2026-09-03T00:00:00", selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0, state: "completed" },
    { step: 3, operation: "fuse", operation_reason: "r",
      options: [
        { id: "opt_3_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_3_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_3_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: null,
      created_at: "2026-09-03T00:00:00", selected_at: null,
      regenerated_count: 0, state: "active" },
  ],
  current_concept: { premise: "x", core_conflict: "", characters: [], world_rules: [], tropes: [], themes: [], novelty: 0 },
  final_concept: null, committed: false, committed_at: null,
  committed_concept_ref: "concept_and_dna.json",
  scores: { novelty: 0, conflict: 0, story_potential: 0, uniqueness: 0, computed_at: "2026-09-03T00:00:00" },
  session_metadata: { created_at: "2026-09-03T00:00:00", last_modified_at: "2026-09-03T00:00:00",
                      elapsed_seconds: 0, operation_count: 0 },
};

describe("TreeCanvas", () => {
  it("renders the idea root node and one column per creative_path entry", () => {
    render(<TreeCanvas canvas={baseState as CanvasV4State} />);
    expect(screen.getByTestId("idea-root-node")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^step-column-\d+$/)).toHaveLength(3);
  });

  it("renders 3 option nodes per step", () => {
    render(<TreeCanvas canvas={baseState as CanvasV4State} />);
    expect(screen.getAllByTestId(/^option-node-\d+-[abc]$/)).toHaveLength(9);
  });

  it("renders SVG paths between columns", () => {
    const { container } = render(<TreeCanvas canvas={baseState as CanvasV4State} />);
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("marks selected option with check icon", () => {
    render(<TreeCanvas canvas={baseState as CanvasV4State} />);
    const selectedB = screen.getByTestId("option-node-1-b");
    expect(selectedB.querySelector('[data-check-icon]')).toBeInTheDocument();
  });

  it("marks current step's center node with pulse animation", () => {
    render(<TreeCanvas canvas={baseState as CanvasV4State} />);
    const currentNode = screen.getByTestId("step-3-current-node");
    expect(currentNode.className).toMatch(/animate-pulse|glow-active/);
  });
});
```

(Adjust test IDs and class assertions based on actual implementation choices.)

- [ ] **Step 2: Run test, verify fail (component doesn't exist)**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/TreeCanvas.test.tsx
```

- [ ] **Step 3: Implement IdeaRootNode**

Create `frontend/src/components/creative-canvas/IdeaRootNode.tsx`:

```tsx
interface Props { prompt: string; }

export function IdeaRootNode({ prompt }: Props) {
  const shortLabel = prompt.length > 8 ? prompt.slice(0, 8) + "…" : prompt;
  return (
    <div data-testid="idea-root-node"
         className="relative z-10 flex flex-col items-center bg-surface p-2 rounded-lg">
      <div className="w-12 h-12 rounded-full bg-surface-container border-2 border-primary
                      flex items-center justify-center mb-sm">
        <span className="material-symbols-outlined text-primary text-sm">flag</span>
      </div>
      <span className="font-label-sm text-label-sm text-on-surface text-center">原始想法</span>
      <span className="text-xs text-on-surface-variant text-center max-w-[100px] truncate"
            title={prompt}>{shortLabel}</span>
    </div>
  );
}
```

- [ ] **Step 4: Implement OptionNode**

Create `frontend/src/components/creative-canvas/OptionNode.tsx`:

```tsx
type Slot = "a" | "b" | "c";

interface Props {
  testId: string;          // e.g. "option-node-1-b"
  slot: Slot;
  label: string;           // user-visible option label, e.g. "保留灵气"
  selected: boolean;
  faded?: boolean;         // unselected options dim
}

export function OptionNode({ testId, slot, label, selected, faded = false }: Props) {
  if (selected) {
    return (
      <div data-testid={testId} className="flex flex-col items-center relative top-[-10px]">
        <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/50 text-primary
                        flex items-center justify-center mb-sm shadow-[0_0_10px_rgba(56,189,248,0.2)]">
          <span data-check-icon
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
        </div>
        <span className="text-xs text-primary max-w-[100px] truncate" title={label}>{label}</span>
      </div>
    );
  }
  return (
    <div data-testid={testId}
         className={`flex flex-col items-center transition-opacity cursor-pointer
                     ${faded ? "opacity-30" : "opacity-50 hover:opacity-100"}`}>
      <div className="w-10 h-10 rounded-full bg-surface-variant border border-outline-variant
                      flex items-center justify-center mb-1">
        <span className="text-xs uppercase">{slot}</span>
      </div>
      <span className="text-xs text-on-surface-variant max-w-[100px] truncate"
            title={label}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Implement TreePath**

Create `frontend/src/components/creative-canvas/TreePath.tsx`:

```tsx
interface PathSegment {
  fromX: number; fromY: number;
  toX: number;   toY: number;
  active: boolean;
}

/** Render bezier paths between option nodes. Active = solid primary glow;
    inactive = dashed outline-variant. */
export function TreePath({ paths }: { paths: PathSegment[] }) {
  return (
    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-0"
         style={{ minWidth: 1200 }}>
      {paths.map((p, i) => {
        const midX = (p.fromX + p.toX) / 2;
        const d = `M ${p.fromX} ${p.fromY} C ${midX} ${p.fromY}, ${midX} ${p.toY}, ${p.toX} ${p.toY}`;
        if (p.active) {
          return (
            <path key={i} d={d} fill="none" stroke="#38bdf8" strokeWidth={2}
                  style={{ filter: "drop-shadow(0 0 4px #38bdf8)" }} />
          );
        }
        return (
          <path key={i} d={d} fill="none" stroke="#3e484f"
                strokeDasharray="4 4" strokeWidth={2} />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 6: Implement TreeCanvas orchestrator**

Create `frontend/src/components/creative-canvas/TreeCanvas.tsx`:

```tsx
import type { CanvasV4State } from "@/api/client";
import { IdeaRootNode } from "./IdeaRootNode";
import { OptionNode } from "./OptionNode";
import { TreePath } from "./TreePath";

interface Props { canvas: CanvasV4State; }

const COL_WIDTH = 200;
const COL_GAP = 100;  // current step column wider per design
const SLOT_Y = { a: 50, b: 200, c: 350 } as const;

export function TreeCanvas({ canvas }: Props) {
  const steps = canvas.creative_path;
  const selectedPath: Array<{ step: number; slot: "a" | "b" | "c" }> = [];
  steps.forEach((s) => {
    const slot = s.selected_option_id?.match(/_([abc])$/)?.[1] as "a" | "b" | "c" | undefined;
    if (slot) selectedPath.push({ step: s.step, slot });
  });

  const pathSegments: Array<{ fromX: number; fromY: number;
                              toX: number; toY: number;
                              active: boolean }> = [];

  // Root idea → Step 1 (always active if Step 1 selected, otherwise dashed)
  steps.forEach((s, idx) => {
    const colX = COL_WIDTH + idx * (COL_WIDTH + COL_GAP);
    const slots: Array<"a" | "b" | "c"> = ["a", "b", "c"];
    slots.forEach((slot) => {
      const targetY = SLOT_Y[slot];
      let fromX: number, fromY: number;
      if (idx === 0) {
        // from root idea
        fromX = COL_WIDTH; fromY = 200;
      } else {
        const prevSelected = selectedPath[idx - 1];
        if (!prevSelected) return;
        fromX = COL_WIDTH + (idx - 1) * (COL_WIDTH + COL_GAP) + 20;
        fromY = SLOT_Y[prevSelected.slot];
      }
      const isActive =
        selectedPath[idx]?.slot === slot &&
        s.selected_option_id === `opt_${s.step}_${slot}`;
      pathSegments.push({ fromX, fromY, toX: colX, toY: targetY, active: isActive });
    });
  });

  return (
    <div data-testid="tree-canvas"
         className="relative flex-1 mt-md min-h-[600px]"
         style={{ minWidth: 1200 }}>
      <TreePath paths={pathSegments} />
      <div className="relative z-10 w-full h-full flex">
        <div className="w-[200px] flex flex-col items-center justify-center relative h-[400px]">
          <IdeaRootNode prompt={canvas.root_idea?.prompt ?? ""} />
        </div>
        {steps.map((s, idx) => (
          <div key={s.step} data-testid={`step-column-${s.step}`}
               className="w-[200px] flex flex-col justify-between py-[25px] h-[400px]">
            {(["a", "b", "c"] as const).map((slot) => {
              const opt = s.options.find((o) => o.id === `opt_${s.step}_${slot}`);
              const isSelected = s.selected_option_id === `opt_${s.step}_${slot}`;
              const isFaded = !isSelected && s.state === "completed";
              return (
                <OptionNode
                  key={slot}
                  testId={`option-node-${s.step}-${slot}`}
                  slot={slot}
                  label={opt?.title ?? slot.toUpperCase()}
                  selected={isSelected}
                  faded={isFaded}
                />
              );
            })}
            {s.state === "active" && (
              <div data-testid={`step-${s.step}-current-node`}
                   className="absolute top-[150px] flex flex-col items-center">
                <div className="w-14 h-14 rounded-full bg-surface border-2 border-primary glow-active
                                flex items-center justify-center animate-pulse">
                  <div className="w-6 h-6 rounded-full bg-primary" />
                </div>
                <span className="font-label-sm text-label-sm text-primary font-bold mt-sm">
                  Step {s.step}: {s.operation}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Add `.glow-active` and `.animate-pulse` classes if not already in Tailwind config (likely they are).

- [ ] **Step 7: Run TreeCanvas test, verify pass**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/TreeCanvas.test.tsx
```

Expected: PASS (may need iteration on test IDs / class names based on what tree-shaking produces).

- [ ] **Step 8: Delete shipped HorizontalPathCanvas + commit**

```bash
git rm frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx
cd frontend && npx vitest run src/test/components/creative-canvas/
git add frontend/src/components/creative-canvas/ && \
  git commit -m "feat(canvas-recon): TreeCanvas SVG bezier tree replacing HorizontalPathCanvas"
```

---

### Task 8: OptionCard component with AI Recommended badge

**Files:**
- Delete: `frontend/src/components/creative-canvas/ActiveStepPanel.tsx`
- Modify: `frontend/src/components/creative-canvas/QualityBar.tsx` (drop 故事潜力 + uniqueness to match 2-stat design)
- Create: `frontend/src/components/creative-canvas/OptionCard.tsx`
- Create: `frontend/src/components/creative-canvas/AIRecommendedBadge.tsx`
- Modify: `frontend/src/api/client.ts` (no new fields needed — title alone feeds OptionCard)
- Create: `frontend/src/test/components/creative-canvas/OptionCard.test.tsx`
- Modify: `frontend/src/test/components/creative-canvas/QualityBar.test.tsx` (drop 故事潜力 test)

The UI design's option card structure:
- Title: `融合 B: 赛博朋克 / 资本论` (operation_label + slot + option.title)
- Right side: `Novelty: 9/10` + `Conflict: 9/10` (label-sm + stats-number, both JetBrains Mono)
- Body paragraph (premise)
- Footer button: "Continue with Option B" for recommended (filled primary); "Select Option A" for others (outline)
- Recommended card: `border-primary glow-active bg-surface-container-highest` + `AI Recommended` pill badge at top center
- Use `.glass-panel` styling: `bg-[rgba(17,24,39,0.7)] backdrop-blur-[12px] border border-[#1E293B] rounded-xl p-md`

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/components/creative-canvas/OptionCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OptionCard } from "@/components/creative-canvas/OptionCard";

const baseOption = {
  id: "opt_3_a", title: "克苏鲁神话", premise: "飞升并非进入仙界...", logic: "", scores: {},
};

describe("OptionCard", () => {
  it("renders operation label + slot + theme_name as title", () => {
    render(
      <OptionCard option={baseOption} slot="A" operationLabel="融合"
                  recommended={false} selected={false}
                  onSelect={() => {}} disabled={false} />
    );
    expect(screen.getByText(/融合 A: 克苏鲁神话/)).toBeInTheDocument();
  });

  it("shows AI Recommended badge when recommended=true", () => {
    render(
      <OptionCard option={{ ...baseOption, id: "opt_3_b", title: "赛博朋克" }}
                  slot="B" operationLabel="融合" recommended
                  selected={false} onSelect={() => {}} disabled={false} />
    );
    expect(screen.getByText(/AI Recommended/i)).toBeInTheDocument();
  });

  it("renders 2-stat score display (Novelty + Conflict only)", () => {
    render(
      <OptionCard option={{ ...baseOption, scores: { novelty: 0.9, conflict: 0.85 } }}
                  slot="A" operationLabel="融合" recommended={false}
                  selected={false} onSelect={() => {}} disabled={false} />
    );
    expect(screen.getByText(/Novelty/)).toBeInTheDocument();
    expect(screen.getByText(/Conflict/)).toBeInTheDocument();
    // 故事潜力 NOT shown (dropped from design)
    expect(screen.queryByText(/故事潜力/)).not.toBeInTheDocument();
  });

  it("button copy is \"Continue with Option X\" when recommended, else \"Select Option X\"", () => {
    const { rerender } = render(
      <OptionCard option={baseOption} slot="A" operationLabel="融合"
                  recommended={false} selected={false} onSelect={() => {}} disabled={false} />
    );
    expect(screen.getByRole("button", { name: /Select Option A/ })).toBeInTheDocument();

    rerender(
      <OptionCard option={{ ...baseOption, id: "opt_3_b" }} slot="B"
                  operationLabel="融合" recommended selected={false}
                  onSelect={() => {}} disabled={false} />
    );
    expect(screen.getByRole("button", { name: /Continue with Option B/ })).toBeInTheDocument();
  });

  it("calls onSelect with option id when clicked", () => {
    const onSelect = vi.fn();
    render(
      <OptionCard option={baseOption} slot="A" operationLabel="融合"
                  recommended={false} selected={false}
                  onSelect={onSelect} disabled={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Select Option A/ }));
    expect(onSelect).toHaveBeenCalledWith("opt_3_a");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/OptionCard.test.tsx
```

- [ ] **Step 3: Adjust QualityBar (no theme_name addition)**

`CreativeOption.title` already serves as the theme name (PRD §22). No type change needed. Adjust QualityBar to only show Novelty + Conflict (drop storyPotential + uniqueness):

```tsx
interface Props { novelty: number; conflict: number; }
const toPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 100)));

export function QualityBar({ novelty, conflict }: Props) {
  const items = [
    { key: "novelty", label: "Novelty", value: novelty, color: "bg-primary" },
    { key: "conflict", label: "Conflict", value: conflict, color: "bg-error" },
  ];
  return (
    <div data-testid="quality-bar"
         className="flex flex-col gap-1 items-end">
      {items.map((item) => (
        <div key={item.key}
             data-testid={`quality-${item.key}`}
             className="flex flex-col gap-1 items-end">
          <span className="font-label-sm text-label-sm text-surface-tint">
            {item.label}: {toPct(item.value) / 10}/10
          </span>
          <div className="w-16 h-1 bg-surface-variant rounded-full overflow-hidden">
            <div className={`h-full ${item.color}`}
                 style={{ width: `${toPct(item.value)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

(Adjust `QualityBar` styling to match design's right-aligned stacked display.)

Update `frontend/src/test/components/creative-canvas/QualityBar.test.tsx` to drop 故事潜力 assertion (replace with Novelty + Conflict only).

- [ ] **Step 4: Implement AIRecommendedBadge**

Create `frontend/src/components/creative-canvas/AIRecommendedBadge.tsx`:

```tsx
export function AIRecommendedBadge() {
  return (
    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2
                    bg-primary text-on-primary font-label-sm text-[10px]
                    px-2 py-1 rounded-full font-bold uppercase tracking-widest
                    shadow-[0_0_10px_rgba(56,189,248,0.3)]">
      AI Recommended
    </div>
  );
}
```

- [ ] **Step 5: Implement OptionCard**

Create `frontend/src/components/creative-canvas/OptionCard.tsx`:

```tsx
import type { CreativeOption } from "@/api/client";
import { QualityBar } from "./QualityBar";
import { AIRecommendedBadge } from "./AIRecommendedBadge";

type Slot = "A" | "B" | "C";

interface Props {
  option: CreativeOption;
  slot: Slot;
  operationLabel: string;          // e.g. "融合"
  recommended: boolean;
  selected: boolean;
  onSelect: (optionId: string) => void;
  disabled: boolean;
}

export function OptionCard({
  option, slot, operationLabel, recommended, selected, onSelect, disabled,
}: Props) {
  const titleClass = recommended ? "text-primary" : "text-on-surface group-hover:text-primary";
  const panelClass = recommended
    ? "glass-panel rounded-xl p-md flex flex-col border-primary glow-active bg-surface-container-highest relative h-full"
    : "glass-panel rounded-xl p-md flex flex-col hover:border-primary/50 transition-colors cursor-pointer group h-full";

  return (
    <div data-testid={`option-card-${option.id}`}
         data-recommended={recommended} data-selected={selected}
         className={panelClass}>
      {recommended && <AIRecommendedBadge />}
      <div className="flex justify-between items-start mb-md mt-2">
        <h4 className={`font-title-md text-title-md transition-colors ${titleClass}`}>
          {operationLabel} {slot}: {option.title}
        </h4>
        <QualityBar
          novelty={option.scores?.novelty ?? 0}
          conflict={option.scores?.conflict ?? 0}
        />
      </div>
      <p className={`text-sm flex-1 mb-md ${recommended ? "text-on-surface" : "text-on-surface-variant"}`}>
        {option.premise}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(option.id)}
        className={
          recommended
            ? "w-full py-xs rounded bg-primary text-on-primary font-bold hover:bg-primary-container transition-colors shadow-[0_0_15px_rgba(56,189,248,0.2)]"
            : "w-full py-xs rounded border border-outline-variant text-on-surface-variant group-hover:border-primary/50 group-hover:text-primary transition-colors"
        }
      >
        {recommended ? `Continue with Option ${slot}` : `Select Option ${slot}`}
      </button>
    </div>
  );
}
```

Add `.glass-panel` and `.glow-active` to `frontend/src/index.css` or `tailwind.config.js`:

```css
.glass-panel {
  background: rgba(17, 24, 39, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid #1E293B;
}
.glow-active {
  box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.4);
  border-color: #38bdf8;
}
```

- [ ] **Step 6: Run OptionCard test + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/OptionCard.test.tsx
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/QualityBar.test.tsx
git add frontend/src/components/creative-canvas/ frontend/src/api/client.ts && \
  git rm frontend/src/components/creative-canvas/ActiveStepPanel.tsx && \
  git commit -m "feat(canvas-recon): OptionCard with AI Recommended badge + 2-stat QualityBar"
```

---

### Task 9: StepIndicator (top-right pill + progress dots)

**Files:**
- Delete: `frontend/src/components/creative-canvas/CanvasToolbar.tsx`
- Create: `frontend/src/components/creative-canvas/StepIndicator.tsx`
- Create: `frontend/src/test/components/creative-canvas/StepIndicator.test.tsx`

The design's top-right header: `STEP 3 / 5 : 融合 (FUSE)` pill + 5 progress dots (3 filled primary + glow, 2 surface-variant).

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepIndicator } from "@/components/creative-canvas/StepIndicator";

describe("StepIndicator", () => {
  it("renders step number and operation in pill", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    expect(screen.getByText(/STEP 3 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText(/融合/)).toBeInTheDocument();
  });

  it("renders maxSteps progress dots", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    expect(screen.getAllByTestId(/^progress-dot-\d+$/)).toHaveLength(5);
  });

  it("marks dots before current as completed (primary + glow)", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    const dot1 = screen.getByTestId("progress-dot-1");
    const dot3 = screen.getByTestId("progress-dot-3");
    const dot4 = screen.getByTestId("progress-dot-4");
    expect(dot1.className).toMatch(/bg-primary/);
    expect(dot3.className).toMatch(/glow-active/);  // current
    expect(dot4.className).toMatch(/bg-surface-variant/);  // future
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/StepIndicator.test.tsx
```

- [ ] **Step 3: Implement StepIndicator**

Create `frontend/src/components/creative-canvas/StepIndicator.tsx`:

```tsx
const OPERATION_LABELS: Record<string, { zh: string; en: string }> = {
  twist:      { zh: "扭曲", en: "TWIST" },
  break:      { zh: "打破", en: "BREAK" },
  fuse:       { zh: "融合", en: "FUSE" },
  invert:     { zh: "反转", en: "INVERT" },
  escalate:   { zh: "升级", en: "ESCALATE" },
  dramaturgy: { zh: "收束", en: "DRAMATURGY" },
};

interface Props {
  currentStep: number;
  maxSteps: number;
  operation: string;
}

export function StepIndicator({ currentStep, maxSteps, operation }: Props) {
  const label = OPERATION_LABELS[operation] ?? { zh: operation, en: operation.toUpperCase() };
  return (
    <div data-testid="step-indicator" className="flex flex-col items-end">
      <span className="font-label-sm text-label-sm text-primary mb-xs uppercase tracking-wider">
        STEP {currentStep} / {maxSteps} : {label.zh} ({label.en})
      </span>
      <div className="flex gap-2">
        {Array.from({ length: maxSteps }, (_, i) => i + 1).map((n) => {
          const isCompleted = n < currentStep;
          const isCurrent = n === currentStep;
          const cls = isCompleted || isCurrent
            ? "w-8 h-2 rounded-full bg-primary glow-active"
            : "w-8 h-2 rounded-full bg-surface-variant";
          return <div key={n} data-testid={`progress-dot-${n}`} className={cls} />;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass; commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/StepIndicator.test.tsx
git add frontend/src/components/creative-canvas/ frontend/src/test/components/creative-canvas/ && \
  git rm frontend/src/components/creative-canvas/CanvasToolbar.tsx && \
  git commit -m "feat(canvas-recon): StepIndicator with progress dots + operation label pill"
```

---

### Task 10: Empty state (IdeaRootNode as initial card)

**Files:**
- Modify: `frontend/src/components/creative-canvas/IdeaRootNode.tsx` (add empty-state variant)
- Create: `frontend/src/components/creative-canvas/EmptyState.tsx`
- Modify: `frontend/src/test/components/creative-canvas/TreeCanvas.test.tsx` (extend)

The design shows an empty-canvas alternative: just the `原始想法` card centered, no option columns. PRD §11.2 mandates the "创造一个故事..." copy.

- [ ] **Step 1: Write failing test**

Append to TreeCanvas test (or create separate EmptyState test):

```tsx
// In frontend/src/test/components/creative-canvas/EmptyState.test.tsx:
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/creative-canvas/EmptyState";

describe("EmptyState", () => {
  it("renders PRD §11.2 copy", () => {
    render(<EmptyState />);
    expect(screen.getByText(/创造一个故事/)).toBeInTheDocument();
    expect(screen.getByText(/你脑子里现在有什么/)).toBeInTheDocument();
  });

  it("renders init form (textarea + genre select + button)", () => {
    render(<EmptyState onInit={(prompt, genre) => {}} />);
    expect(screen.getByPlaceholderText(/一个关于|用一句话/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始|初始化/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/EmptyState.test.tsx
```

- [ ] **Step 3: Implement EmptyState**

Create `frontend/src/components/creative-canvas/EmptyState.tsx`:

```tsx
import { useState } from "react";
import { PrimaryButton, GhostButton } from "@/components/ds";

interface Props {
  onInit?: (prompt: string, genre: string) => void;
  loading?: boolean;
}

const GENRES = ["仙侠", "科幻", "都市", "悬疑", "历史", "玄幻"];

export function EmptyState({ onInit, loading = false }: Props) {
  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState("xianxia");

  return (
    <div data-testid="empty-state"
         className="glass-panel rounded-xl p-xl max-w-2xl mx-auto space-y-lg mt-xl">
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-on-surface">
          创造一个故事，不需要从完整故事开始。
        </h2>
        <p className="text-on-surface-variant font-body-md mt-sm">
          只需要告诉我：<br />
          「你脑子里现在有什么？」
        </p>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="一个关于……"
        rows={4}
        className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-md
                   text-on-surface placeholder-on-surface-variant/50
                   focus:border-primary focus:outline-none transition-colors"
      />
      <div className="flex items-center gap-md">
        <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">类型</label>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}
                className="bg-surface-container-high border border-outline-variant rounded-lg
                           px-md py-xs text-on-surface focus:border-primary">
          {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="flex justify-end">
        <PrimaryButton
          label={loading ? "初始化中..." : "开始创意推演 →"}
          onClick={() => onInit?.(prompt, genre)}
          disabled={loading || prompt.trim().length < 10}
        />
      </div>
      <details className="text-xs text-on-surface-variant/60">
        <summary className="cursor-pointer">查看示例 idea</summary>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>修仙者活了 1000 年后想要死亡</li>
          <li>末世只剩一座图书馆和它的管理员</li>
          <li>一个能听懂动物说话但被所有人当成疯子的孩子</li>
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run EmptyState test; commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/EmptyState.test.tsx
git add frontend/src/components/creative-canvas/EmptyState.tsx frontend/src/test/ && \
  git commit -m "feat(canvas-recon): EmptyState with PRD §11.2 copy + init form"
```

---

### Task 11: ResetConfirmDialog (glass-styled)

**Files:**
- Create: `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx`
- Create: `frontend/src/test/components/creative-canvas/ResetConfirmDialog.test.tsx`
- Modify: `frontend/src/api/client.ts` (add `deleteCanvasV2State` method)
- Modify: `frontend/src/hooks/useCreativeCanvasV2.ts` (replace reset no-op)

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";

describe("ResetConfirmDialog", () => {
  it("renders PRD §18.2 copy", () => {
    render(<ResetConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/重新开始创意/)).toBeInTheDocument();
    expect(screen.getByText(/保留你的原始 Idea/)).toBeInTheDocument();
  });

  it("uses glass-panel styling (data-testid backdrop)", () => {
    const { container } = render(
      <ResetConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.querySelector(".glass-panel")).toBeInTheDocument();
  });

  it("calls onCancel when 取消 clicked", () => {
    const onCancel = vi.fn();
    render(<ResetConfirmDialog open onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when 重新开始 clicked", () => {
    const onConfirm = vi.fn();
    render(<ResetConfirmDialog open onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /重新开始/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <ResetConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ResetConfirmDialog.test.tsx
```

- [ ] **Step 3: Add deleteCanvasV2State to client**

In `frontend/src/api/client.ts`:

```typescript
deleteCanvasV2State: (projectId: string): Promise<{ok: boolean; reset: string}> =>
  request("DELETE", `/creative/canvas/${encodeURIComponent(projectId)}/session/state`),
```

- [ ] **Step 4: Implement ResetConfirmDialog**

Create `frontend/src/components/creative-canvas/ResetConfirmDialog.tsx`:

```tsx
import { GhostButton, PrimaryButton } from "@/components/ds";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.2 — reset dialog preserves root_idea; uses glass-panel design. */
export function ResetConfirmDialog({ open, onConfirm, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div data-testid="reset-confirm-dialog"
         className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
         role="dialog" aria-modal="true">
      <div className="glass-panel rounded-xl p-xl max-w-sm w-full space-y-md">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
          重新开始创意
        </h2>
        <p className="text-on-surface-variant text-sm">
          这会保留你的原始 Idea，但删除当前创意路径。
        </p>
        <div className="flex justify-end gap-sm pt-md">
          <GhostButton label="取消" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "重置中..." : "重新开始"}
            onClick={onConfirm} disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire hook — extend interface**

The shipped `useCreativeCanvasV2` (line 10-24) returns `{ status, canvas, error, loadingStep, committedAt, canCommit, loadCanvas, initSession, nextStep, selectOption, commitCanvas }`. Add reset-dialog state + handlers by extending the interface and return value.

In `frontend/src/hooks/useCreativeCanvasV2.ts`:

```typescript
interface UseCreativeCanvasV2 {
  // ...existing fields...
  // Reset (new in Task 11)
  showResetDialog: boolean;
  onReset: () => void;
  closeResetDialog: () => void;
  confirmReset: () => Promise<void>;
}

// Inside the hook:
const [showResetDialog, setShowResetDialog] = useState(false);
const onReset = () => setShowResetDialog(true);
const closeResetDialog = () => setShowResetDialog(false);
const confirmReset = async () => {
  setShowResetDialog(false);
  await api.deleteCanvasV2State(projectId);
  await loadCanvas();
};

// Extend the return statement:
return {
  status, canvas, error, loadingStep, committedAt, canCommit,
  loadCanvas, initSession, nextStep, selectOption, commitCanvas,
  showResetDialog, onReset, closeResetDialog, confirmReset,
};
```

- [ ] **Step 6: Run, commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ResetConfirmDialog.test.tsx
git add frontend/src/components/creative-canvas/ResetConfirmDialog.tsx frontend/src/api/client.ts frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/test/ && \
  git commit -m "feat(canvas-recon): ResetConfirmDialog glass-styled + DELETE /state wiring"
```

---

### Task 12: PreCommitSummary (glass-styled)

**Files:**
- Create: `frontend/src/components/creative-canvas/PreCommitSummary.tsx`
- Create: `frontend/src/test/components/creative-canvas/PreCommitSummary.test.tsx`
- Modify: `frontend/src/hooks/useCreativeCanvasV2.ts` (intercept commit)

PRD §18.3: pre-commit shows stats + 「返回继续探索」/「形成概念 →」.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";

describe("PreCommitSummary", () => {
  const stats = { depth: 4, novelty: 87, conflict: 91 };

  it("renders stats + 2 buttons per PRD §18.3", () => {
    render(<PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/创意深度：4 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/新颖度：87/)).toBeInTheDocument();
    expect(screen.getByText(/核心冲突：91/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /返回继续探索/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /形成概念/ })).toBeInTheDocument();
  });

  it("uses glass-panel styling", () => {
    const { container } = render(
      <PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.querySelector(".glass-panel")).toBeInTheDocument();
  });

  it("calls onCancel when 返回继续探索 clicked", () => {
    const onCancel = vi.fn();
    render(<PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /返回继续探索/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCommit when 形成概念 → clicked", () => {
    const onCommit = vi.fn();
    render(<PreCommitSummary open stats={stats} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /形成概念/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/PreCommitSummary.test.tsx
```

- [ ] **Step 3: Implement PreCommitSummary**

Create `frontend/src/components/creative-canvas/PreCommitSummary.tsx`:

```tsx
import { GhostButton, PrimaryButton } from "@/components/ds";

interface Stats { depth: number; novelty: number; conflict: number; }

interface Props {
  open: boolean;
  stats: Stats;
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.3 — pre-commit summary modal; glass-panel design. */
export function PreCommitSummary({ open, stats, onCommit, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div data-testid="pre-commit-summary"
         className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
         role="dialog" aria-modal="true">
      <div className="glass-panel rounded-xl p-xl max-w-md w-full space-y-md">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
          你的创意已经形成
        </h2>
        <div className="font-stats-number text-stats-number text-primary space-y-xs">
          <div>创意深度：{stats.depth} / 5</div>
          <div className="text-sm text-on-surface-variant">
            新颖度：{stats.novelty} · 核心冲突：{stats.conflict}
          </div>
        </div>
        <p className="text-on-surface-variant text-sm">
          你将进入下一阶段：<span className="text-primary">概念 DNA</span>
        </p>
        <div className="flex justify-end gap-sm pt-md">
          <GhostButton label="返回继续探索" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "提交中..." : "形成概念 →"}
            onClick={onCommit} disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into hook — extend interface**

Add `showPreCommit` state + handlers to the existing hook (same pattern as Task 11):

```typescript
interface UseCreativeCanvasV2 {
  // ...existing fields + Task 11 reset fields...
  // Pre-commit (new in Task 12)
  showPreCommit: boolean;
  onCommitClick: () => void;
  closePreCommit: () => void;
  confirmCommit: () => Promise<void>;
}

// Inside the hook:
const [showPreCommit, setShowPreCommit] = useState(false);
const onCommitClick = () => setShowPreCommit(true);
const closePreCommit = () => setShowPreCommit(false);
const confirmCommit = async () => {
  setShowPreCommit(false);
  await commitCanvas();
};

// Extend the return statement:
return {
  status, canvas, error, loadingStep, committedAt, canCommit,
  loadCanvas, initSession, nextStep, selectOption, commitCanvas,
  showResetDialog, onReset, closeResetDialog, confirmReset,
  showPreCommit, onCommitClick, closePreCommit, confirmCommit,
};
```

- [ ] **Step 5: Run test, verify pass; commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/PreCommitSummary.test.tsx
git add frontend/src/components/creative-canvas/PreCommitSummary.tsx frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/test/ && \
  git commit -m "feat(canvas-recon): PreCommitSummary glass-styled modal (PRD §18.3)"
```

---

### Task 13: Re-enable canvas route + sidebar tab

**Files:**
- Modify: `frontend/src/App.tsx` (re-enable `/stage1/canvas` route)
- Modify: `frontend/src/components/layout/Stage1Layout.tsx` (re-add 创意画布 tab)
- Modify: `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` (no canvas module — re-integration handled by App.tsx route + sidebar tab; remove the placeholder comment)

The entry-cleanup commit `4b05201` removed the canvas route + tab to prepare for the redesign. Now the redesign ships, so re-enable.

- [ ] **Step 1: Re-enable route in App.tsx**

In `frontend/src/App.tsx`, replace the commented-out block:

```tsx
// Replace:
// // CreativeCanvasPage was removed from the route tree...
// // const CreativeCanvasPage = lazy(() => import("./pages/CreativeCanvasPage"));
const CreativeCanvasPage = lazy(() => import("./pages/CreativeCanvasPage"));

// Replace:
// <Route path="canvas" element={<Navigate to=".." replace />} />
// With:
<Route
  path="canvas"
  element={
    <Suspense fallback={<LoadingFallback />}>
      <StageWrapper name="stage1-canvas">
        <CreativeCanvasPage />
      </StageWrapper>
    </Suspense>
  }
/>
```

- [ ] **Step 2: Re-add 创意画布 tab in Stage1Layout.tsx**

In `frontend/src/components/layout/Stage1Layout.tsx`, restore the sub-tab machinery (around the commented-out block at the top of the file). The simplest restoration: copy the implementation from git history:

```bash
git log --all --oneline -- frontend/src/components/layout/Stage1Layout.tsx | head -5
git show <pre-cleanup-commit>:frontend/src/components/layout/Stage1Layout.tsx > /tmp/stage1layout_orig.tsx
```

Then port the tab switcher back, but adapt for the v2 design — remove the old logic, add a simpler version that points to `/project/${projectId}/stage1/canvas` for the canvas tab. (See design code.html line 174 for the active tab styling: `bg-secondary-container text-on-secondary-container`.)

Concrete replacement for Stage1Layout.tsx:

```tsx
import { Outlet, useParams, useLocation, useNavigate } from "react-router-dom";

type Stage1SubTab = "quick" | "canvas";

function activeSubTabFromPath(pathname: string): Stage1SubTab {
  if (pathname.endsWith("/stage1/canvas")) return "canvas";
  return "quick";
}

export default function Stage1Layout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const active = activeSubTabFromPath(location.pathname);

  const goTo = (tab: Stage1SubTab) => {
    if (!projectId) return;
    navigate(`/project/${projectId}/stage1${tab === "canvas" ? "/canvas" : ""}`);
  };

  const tabs: { key: Stage1SubTab; label: string; icon: string }[] = [
    { key: "quick", label: "快速生成", icon: "bolt" },
    { key: "canvas", label: "创意画布", icon: "draw" },  // matches design
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      <div>
        <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">
          Stage 1 — 概念
        </h1>
        <p className="text-sm text-on-surface-variant">
          从一个 Idea 出发,生成你的故事核心。
        </p>
      </div>
      <div className="flex gap-1 bg-surface-container rounded-lg p-1 w-fit">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => goTo(key)}
            data-testid={`stage1-tab-${key}`}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-body-ui text-sm transition-colors ${
              active === key
                ? "bg-secondary-container text-on-secondary-container font-bold scale-[0.98] transition-transform duration-150"
                : "text-system-log hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 3: Clean up WorkspaceWizardPanel placeholder comment**

In `frontend/src/components/wizard/WorkspaceWizardPanel.tsx`, the placeholder comment at line ~37 about removing the canvas module is now obsolete. Remove it:

```tsx
// Remove this block (around line 37-40):
// The 创意画布 sidebar module was removed on 2026-09-02 while the
// feature is being refactored (see docs/design/creative-canvas-module.md).
// When the refactor lands, re-add the WizardSidebarModule entry between
// step 1 and step 2.
```

- [ ] **Step 4: Run wizard tests + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/components/wizard/
git add frontend/src/App.tsx frontend/src/components/layout/Stage1Layout.tsx frontend/src/components/wizard/WorkspaceWizardPanel.tsx && \
  git commit -m "feat(canvas-recon): re-enable canvas route + sidebar tab + clean wizard placeholder"
```

---

### Task 14: CreativeCanvasPage rewrite + integration

**Files:**
- Rewrite: `frontend/src/pages/CreativeCanvasPage.tsx`
- Rewrite: `frontend/src/test/pages/CreativeCanvasPage.test.tsx`

The page wires everything: EmptyState (when no canvas), or [StepIndicator header + TreeCanvas + OptionCard row + Reset/Commit buttons + modals] when canvas active.

- [ ] **Step 1: Rewrite CreativeCanvasPage.tsx**

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import { TreeCanvas } from "@/components/creative-canvas/TreeCanvas";
import { StepIndicator } from "@/components/creative-canvas/StepIndicator";
import { OptionCard } from "@/components/creative-canvas/OptionCard";
import { EmptyState } from "@/components/creative-canvas/EmptyState";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";
import { GhostButton, PrimaryButton } from "@/components/ds";
import type { CreativeOption } from "@/api/client";

export default function CreativeCanvasPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const {
    canvas, loadingStep, canCommit,
    showResetDialog, onReset, closeResetDialog, confirmReset,
    showPreCommit, onCommitClick, closePreCommit, confirmCommit,
    initSession, nextStep, selectOption,
  } = useCreativeCanvasV2(projectId);

  if (!canvas) {
    return (
      <EmptyState
        loading={loadingStep}
        onInit={(prompt, genre) => initSession({ prompt, genre })}
      />
    );
  }

  const activeStep = canvas.creative_path.find((s) => s.state === "active");
  const completedCount = canvas.creative_path.filter((s) => s.state === "completed").length;

  return (
    <div data-testid="creative-canvas-page"
         className="bg-nebula min-h-screen p-xl">
      {/* Header: title left, StepIndicator right */}
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">
            Creative Canvas
          </h2>
          <p className="text-on-surface-variant font-body-md">
            Explore and evolve your core concept.
          </p>
        </div>
        <StepIndicator
          currentStep={canvas.creative_session.current_step}
          maxSteps={canvas.creative_session.max_steps}
          operation={activeStep?.operation ?? "twist"}
        />
      </div>

      {/* Tree visualization */}
      <TreeCanvas canvas={canvas} />

      {/* Active step options */}
      {activeStep && (
        <div className="mt-xl" data-testid="active-step-panel">
          <div className="grid grid-cols-3 gap-lg">
            {(["A", "B", "C"] as const).map((slot, idx) => {
              // Option id format fixed in Task 1: opt_{step}_{slot} (LLM produces opt_a/b/c, backend renumbers)
              const option = activeStep.options.find(
                (o) => o.id === `opt_${activeStep.step}_${slot.toLowerCase()}`
              ) as CreativeOption | undefined;
              if (!option) return null;
              const isRecommended = slot === "B";  // PRD §8: B is AI default
              return (
                <OptionCard
                  key={slot}
                  option={option}
                  slot={slot}
                  operationLabel={
                    ({ twist: "扭曲", break: "打破", fuse: "融合",
                       invert: "反转", escalate: "升级",
                       dramaturgy: "收束" } as Record<string, string>)[activeStep.operation]
                    ?? activeStep.operation
                  }
                  recommended={isRecommended}
                  selected={false}
                  onSelect={(id) => selectOption(activeStep.step, id)}
                  disabled={loadingStep}
                />
              );
            })}
          </div>
          <p className="text-on-surface-variant text-sm mt-md text-center">
            为什么是「{activeStep.operation}」？{activeStep.operation_reason}
          </p>
        </div>
      )}

      {/* Bottom action bar — PRD §11.3: entry-point compat with wizard
          (existing /wizard ConceptStep still works; canvas is the new
          standalone path). The button copy maps to PRD §18 (Reset) +
          §36 (next stage). */}
      <div className="mt-xl flex justify-between">
        <GhostButton label="重新开始" onClick={onReset} disabled={loadingStep} />
        <div className="flex gap-sm">
          {canCommit && (
            <PrimaryButton label="提交" onClick={onCommitClick} disabled={loadingStep} />
          )}
        </div>
      </div>

      <ResetConfirmDialog
        open={showResetDialog}
        onConfirm={confirmReset}
        onCancel={closeResetDialog}
      />
      <PreCommitSummary
        open={showPreCommit}
        stats={{
          depth: completedCount,
          novelty: Math.round((canvas.scores?.novelty ?? 0) * 100),
          conflict: Math.round((canvas.scores?.conflict ?? 0) * 100),
        }}
        onCommit={confirmCommit}
        onCancel={closePreCommit}
      />
    </div>
  );
}
```

Notes:
- Dropped `nextStep` button — shipped `/select` auto-advances to next step (v2_canvas.py:403). Manual "生成下一阶段" button doesn't make sense.
- `loadingStep` is `boolean` (not number) per shipped hook signature.
- `canCommit` is computed in the hook (line 105) — use it directly.
- `closeResetDialog` / `closePreCommit` are exposed by the hook (Tasks 11/12).

- [ ] **Step 2: Rewrite CreativeCanvasPage.test.tsx**

Replace shipped test file with comprehensive coverage:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CreativeCanvasPage from "@/pages/CreativeCanvasPage";

// Mock api client (similar pattern as existing test)
// Mock useCreativeCanvasV2 hook to control state

describe("CreativeCanvasPage", () => {
  it("renders EmptyState when no canvas", () => {
    vi.mock("@/hooks/useCreativeCanvasV2", () => ({
      useCreativeCanvasV2: () => ({ canvas: null, initSession: vi.fn() }),
    }));
    render(<MemoryRouter><Routes><Route path="*" element={<CreativeCanvasPage />} /></Routes></MemoryRouter>);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders StepIndicator + TreeCanvas when canvas active", () => {
    // Mock with active canvas state
    // ...
  });

  it("opens ResetConfirmDialog when 重新开始 clicked", () => { /* ... */ });
  it("opens PreCommitSummary when 提交 clicked", () => { /* ... */ });
});
```

(Concrete implementation needs to mock `useCreativeCanvasV2` return value. Reference the shipped canvas-v2 test patterns.)

- [ ] **Step 3: Run all canvas-v2 frontend tests + commit**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/hooks/useCreativeCanvasV2.test.ts
git add frontend/src/pages/CreativeCanvasPage.tsx frontend/src/test/pages/CreativeCanvasPage.test.tsx && \
  git commit -m "feat(canvas-recon): CreativeCanvasPage rewrite wiring TreeCanvas + StepIndicator + OptionCard + modals"
```

---

### Task 15: E2E integration tests + namespace ADR

**Files:**
- Modify: `tests/test_v2_e2e.py` (extend with: enriched schema on commit, DELETE preserves root_idea)
- Modify: `tests/test_v2_flag_gating.py` (extend: DELETE /state + /evaluate also gated)
- Modify: `docs/design/creative-canvas-reconstruction.md` (append namespace ADR)

- [ ] **Step 1: Extend E2E test**

Append to `tests/test_v2_e2e.py`:

```python
def test_e2e_full_flow_commits_with_enriched_schema(project, client, stub_planner, stub_llm):
    """After 5-step flow, canvas on disk has all PRD §22 blocks populated."""
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "my idea", "genre_primary": "xianxia"})
    for step in range(1, 6):
        client.post(f"/creative/canvas/{project}/session/next-step",
                    json={"current_step": step})
        client.post(f"/creative/canvas/{project}/session/select",
                    json={"step": step, "option_id": f"opt_{step}_b"})
    commit_resp = client.post(f"/creative/canvas/{project}/session/commit")
    assert commit_resp.status_code == 200, commit_resp.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["root_idea"]["prompt"] == "my idea"
    assert canvas["creative_session"]["status"] == "committed"
    assert canvas["creative_session"]["current_step"] == 5
    assert canvas["scores"]["computed_at"]
    assert canvas["current_concept"]["premise"]


def test_e2e_delete_state_after_2_steps_preserves_root_idea(project, client, stub_llm):
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "keep this", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    client.post(f"/creative/canvas/{project}/session/select",
                json={"step": 1, "option_id": "opt_1_b"})
    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200
    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"] == []
    assert canvas["root_idea"]["prompt"] == "keep this"
```

- [ ] **Step 2: Extend flag gating test**

Append to `tests/test_v2_flag_gating.py`:

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


def test_v2_evaluate_returns_404_when_flag_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(settings, "enable_canvas_v2", False)
    app = FastAPI()
    if settings.enable_canvas_v2:
        app.include_router(v2_router)
    client = TestClient(app)
    assert client.post("/creative/canvas/p_off/session/evaluate",
                       json={"node_id": None}).status_code == 404
```

- [ ] **Step 3: Add namespace ADR to PRD**

Append to `docs/design/creative-canvas-reconstruction.md` (after §27.6):

```markdown
### 26.1 Namespace decision (v2.0 implementation)

PRD §26 lists endpoints under `/creative/session/*`. The shipped v2
router (commit b35f70a, before v2.0 reconstruction) uses
`/creative/canvas/{project_id}/session/*`. We keep the project-scoped
namespace because:

1. Per §11.1 the page URL is `/project/:projectId/stage0/canvas`, so
   project scoping is implied by the route hierarchy.
2. The legacy `/state` and `/evaluate` endpoints in
   `backend/api/creative_diverge.py` are also project-scoped (via path
   param).

Future v2.1 endpoints (regenerate, backtrack, finalize) follow the same
`/creative/canvas/{project_id}/session/<verb>` shape.
```

- [ ] **Step 4: Run all tests + commit**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  pytest tests/test_v2_canvas_endpoints.py tests/test_v2_e2e.py tests/test_option_generator.py tests/test_consistency_check.py tests/test_v2_flag_gating.py -v
cd /Users/longsa/Codes/nebula/frontend && \
  npx vitest run src/test/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/hooks/useCreativeCanvasV2.test.ts
git add tests/ docs/design/creative-canvas-reconstruction.md && \
  git commit -m "test(canvas-recon): E2E enriched schema + DELETE preservation + namespace ADR"
```

---

### Task 16: Final regression + verification

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

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

- [ ] **Step 3: Run wider smoke check (wizard + pages)**

```bash
cd /Users/longsa/Codes/nebula/frontend && \
  npx vitest run src/components/wizard/ src/pages/
```

Expected: pre-existing failures acceptable; NEW regressions = stop and fix.

- [ ] **Step 4: Optional manual smoke (document outcome in commit message)**

```bash
# Terminal 1
cd /Users/longsa/Codes/nebula && source venv/bin/activate && \
  ENABLE_CANVAS_V2=true uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd /Users/longsa/Codes/nebula/frontend && npm run dev
```

Visit http://localhost:5173/project/<id>/stage1/canvas, walk:
1. Empty state copy + init form
2. Tree renders with idea root + 5 step columns (init only fills step 1 options)
3. Step indicator pill + 1 filled dot
4. Click option B → tree updates step 1 column with ✓ on B, paths glow primary
5. Generate Step 2 → modal loads, options render with AI Recommended B highlighted
6. Continue to step 5 → pre-commit summary appears
7. Form concept → commit → write happens
8. Reset dialog → delete state → re-init

Skip if dev servers not runnable in this session.

- [ ] **Step 5: Final commit if anything leftover**

```bash
git status
# If anything uncommitted:
# git commit -m "chore(canvas-recon): final regression + manual smoke verification"
```

---

## Self-Review

### Spec coverage (PRD v2.0 MVP scope §28.1 + §7 + §16 + §17 + §18 + §22 + §26)

| PRD § | Task | Notes |
|---|---|---|
| §5 状态机 5 态 | shipped (canvas-v2 Task 3) | STALE reserved for v2.1 |
| §6 操作体系 6 类 | shipped (Tasks 5, 7) | compute_op_hint covers all 6 |
| §7 三选项差异轴 | **Task 4** (backend) + **Task 8** (frontend title format) | axis_guidance both sides |
| §8.4 compute_op_hint | shipped | unchanged |
| §8.5 失败处理 | shipped + **Task 6** (5-dim check) | auto-regen on fail |
| §11.2 空状态 copy | **Task 10** | EmptyState with PRD §11.2 copy |
| §12 横向路径 UI | **Tasks 7-9** | SVG bezier tree + step indicator |
| §13 当前步骤突出 | **Task 8** | recommended card glow + pulse on current step node |
| §15 AI 推荐解释 | **Task 14** | integrated as text below option cards |
| §16 自动评分 | shipped + **Task 5** | auto-refresh on /select |
| §17.2 后台一致性校验 | **Task 6** | — |
| §18.2 重置 dialog | **Task 11** | glass-styled ResetConfirmDialog |
| §18.3 提交前最终确认 | **Task 12** | glass-styled PreCommitSummary |
| §22 v4 schema | **Task 1** | root_idea + creative_session + scores |
| §23 迁移 | shipped | unchanged |
| §26 端点清单 | **Tasks 2, 3** | namespace deviation documented in Task 15 |
| §27.6 commit | shipped + Task 1 schema | creative_divergence.json double-write unchanged |
| §28 MVP 范围 | all covered | v2.1+ items correctly deferred |
| §34 v1.x bug 修复 | shipped (Task 4) | invariant gate |

### Out of scope (correctly deferred to v2.1 per §28.2)

- §36 early-finalize
- §37 backtrack
- §38 override
- §39 regenerate
- §20.3 downstream consumer upgrades
- §28.4 `creative_path`/`creative_mechanism`/`canvas_meta` fields in concept_and_dna.json

### UI design alignment

| Design element | Component | Task |
|---|---|---|
| Top app bar | unchanged (already exists) | — |
| Sidebar nav (240px) | Stage1Layout.tsx | **Task 13** |
| 创意画布 tab active state | Stage1Layout.tsx | **Task 13** |
| "Creative Canvas" headline | CreativeCanvasPage | **Task 14** |
| Step 3/5 pill | StepIndicator | **Task 9** |
| 5 progress dots | StepIndicator | **Task 9** |
| SVG bezier tree | TreeCanvas + TreePath | **Task 7** |
| Root idea flag icon | IdeaRootNode | **Task 7** |
| Option nodes (A/B/C or ✓) | OptionNode | **Task 7** |
| 3 option cards grid | OptionCard | **Task 8** |
| AI Recommended badge | AIRecommendedBadge | **Task 8** |
| Glass-panel styling | Tailwind utility + .glass-panel CSS | **Task 8** |
| Glow-active ring | .glow-active CSS | **Task 7** |
| Pulse on current node | animate-pulse Tailwind | **Task 7** |
| Dashed gray branches | TreePath inactive | **Task 7** |
| Novelty/Conflict stats (2 only) | QualityBar | **Task 8** |
| "Select Option X" / "Continue with Option X" copy | OptionCard | **Task 8** |

### Open questions / risks

1. **Task 5 auto-refresh latency**: Each `/select` calls NoveltyEvaluator (sync, wrapped with `run_in_executor`, 3s timeout). On timeout, old scores are preserved. Pure fire-and-forget would require spawning a background task — out of scope for MVP.
2. **Task 6 strict consistency check**: `novelty` dimension is exempted from the regeneration trigger because `current_concept.novelty` initializes to 0.0 and the LLM doesn't always set it. Other dimensions (concept/world/character/conflict) still trigger regen. Existing canvas_states with empty `world_rules` / `characters.role` may still fail on first regeneration — the regen is bounded (max 1 retry per PRD §17.2).
3. **SVG path positioning**: The shipped TreeCanvas uses fixed `SLOT_Y = { a: 50, b: 200, c: 350 }`. If option cards grow in height (e.g. multi-line premise), the tree spacing may need adjustment. Out of scope for MVP.
4. **Option ID renumbering**: Task 1 has explicit post-processing in `_next_step_impl` to rewrite LLM-produced `opt_a/b/c` ids to step-scoped `opt_{step}_{slot}`. If the LLM produces options in wrong order (not strictly a/b/c), the renumbering will assign slots in declaration order — may need fuzzy matching.
5. **PRD §11.3 wizard compat**: The canvas EmptyState provides standalone init; the existing `/wizard` ConceptStep remains functional. Users who arrived via wizard step 1 see the wizard's init; users arriving directly at `/project/:id/stage1/canvas` see EmptyState. No conflict, but no deep-link either.

---

## Execution Handoff

This plan is sized for **subagent-driven development** — 16 tasks, each reviewable in isolation. Each task has TDD discipline: failing test first, implementation, run + commit.

For inline execution via `executing-plans`, batch in groups of 3-4 tasks with checkpoints.

**Recommended sequencing:**
1. **Backend foundation** (Tasks 1-3) — schema + DELETE + /evaluate. Can ship independently.
2. **AI engine alignment** (Tasks 4-6) — axis hint + auto-refresh + consistency check. Backend-complete.
3. **Frontend components** (Tasks 7-12) — TreeCanvas, OptionCard, StepIndicator, EmptyState, ResetConfirmDialog, PreCommitSummary.
4. **Integration** (Tasks 13-14) — re-enable route + sidebar, page rewrite.
5. **Verification** (Tasks 15-16) — E2E coverage + final regression.

After all tasks land on `nebula`, the canvas-v2 reconstruction is feature-complete per PRD §28.1 + design system. Branch is ready to merge to `main`.
