# Workspace WritingArea Button Fixes (P0-P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three WritingArea footer buttons (重新生成 / Fact Guard / 保存草稿) in manual mode actually do what they say, load existing drafts when switching chapters, and give the user feedback.

**Architecture:** Six small, independent tasks — each fixes one P0/P1/P2 issue found in the v1.9 review. Backend gets one new endpoint (`POST /stage4/fact-guard` for read-only fact-check). Frontend wires the existing `api.updateSceneDraft` / `api.getSceneDraft` (both already exist in `client.ts` but were never called) plus a new `api.factGuard` and a simple `ConfirmDialog` component. A new `lastSavedContent` state (added in Task 1, used by Tasks 4 & 5) tracks the on-disk prose so the regenerate confirm only fires for genuinely unsaved edits.

**Tech Stack:** FastAPI backend (existing), React 18 + Vite + Tailwind (existing), Vitest (existing), pytest (existing).

---

## File Structure

**New files:**
- `backend/api/stage4_fact_guard.py` — new endpoint for read-only fact-guard
- `tests/test_stage4_fact_guard.py` — backend tests for the new endpoint
- `frontend/src/components/shared/ConfirmDialog.tsx` — generic confirm dialog
- `frontend/src/test/components/shared/ConfirmDialog.test.tsx` — minimal component test

**Modified files:**
- `frontend/src/api/client.ts` — add `api.factGuard` method
- `frontend/src/pages/WorkspacePage.tsx` — wire all three handlers + draft loading
- `frontend/src/test/Workspace.test.tsx` — add regression tests for each fix
- `frontend/src/hooks/useWorkspacePage.ts` — does NOT exist; will not create

The plan stays inside `WorkspacePage.tsx` and the `client.ts` API surface. No new hooks, no new state machines, no breaking changes to existing types.

---

## Task 1: Fix 保存草稿 to write the correct file (P0)

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx:420-433` (onSaveDraft handler)
- Modify: `frontend/src/test/Workspace.test.tsx` (add regression test)

**Problem:** The current handler calls `api.updateOutline` which writes to `outline.json` and corrupts it (sets `title: ""`, injects schema-invalid `content` field). The correct endpoint is `api.updateSceneDraft` which writes `ch{NN}_scene_{NNN}_draft.md`. The `api.updateSceneDraft` method already exists at `client.ts:870` but is never called from WorkspacePage.

- [ ] **Step 1: Add a failing test for the corrected save flow**

Add a new test to `frontend/src/test/Workspace.test.tsx` in the "Workspace integration" describe block (after the existing 重新生成 test around line 288):

```typescript
  // Bug fix — "保存草稿" must call updateSceneDraft (writes draft.md), NOT
  // updateOutline (which corrupts outline.json by setting title: "" and
  // injecting schema-invalid `content` field). See client.ts:870 for the
  // correct endpoint.
  it("'保存草稿' button calls updateSceneDraft with the current editor content", async () => {
    const { default: api } = await import("../api/client");
    const updateSceneDraftSpy = api.updateSceneDraft as ReturnType<typeof vi.fn>;
    updateSceneDraftSpy.mockReset();
    updateSceneDraftSpy.mockResolvedValue({ chapter_number: 1, scene_number: 1 });

    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    // Wait for editor to mount, then type some content.
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "用户写的正文" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(updateSceneDraftSpy).toHaveBeenCalled());
    // Must use the scene-draft endpoint, not updateOutline (which would
    // corrupt outline.json).
    expect(updateSceneDraftSpy).toHaveBeenCalledWith({
      project_id: "p1",
      chapter_number: 1,
      scene_number: 1,
      draft_text: "用户写的正文",
    });
  });
```

The `updateSceneDraft` mock must be added to the `vi.mock("../api/client", ...)` block. Read the file at line 42-55 and add the line:

```typescript
    updateSceneDraft: vi.fn().mockResolvedValue({ chapter_number: 1, scene_number: 1 }),
```

(Place it next to `updateOutline: vi.fn().mockResolvedValue(undefined)` in the existing mock factory.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "保存草稿"
```

Expected: FAIL — `updateSceneDraft` is undefined or not called (the current implementation calls `updateOutline`).

- [ ] **Step 3: Replace onSaveDraft handler in WorkspacePage.tsx**

In `frontend/src/pages/WorkspacePage.tsx`, do two things:

3a) Add `lastSavedContent` state — the on-disk content for the current scene. Tracked so the regenerate confirm dialog (Task 5) can tell "user has unsaved edits" from "user just opened this chapter and hasn't touched it". Place it next to the other `useState` declarations around line 117-126:

```typescript
  // Tracks the on-disk content for the currently-selected scene. Set
  // after a successful save and after a successful draft load (Task 4).
  // The dirty check `content !== lastSavedContent` decides whether the
  // regenerate confirm dialog should appear. length > 0 alone would fire
  // on every regenerate for chapters that already have a saved draft —
  // the common case for power users.
  const [lastSavedContent, setLastSavedContent] = useState<string>("");
```

3b) Replace the existing `onSaveDraft={async () => { ... }}` block (lines 420-433) with:

```typescript
              onSaveDraft={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  await api.updateSceneDraft({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                  setLastSavedContent(content);
                } catch {
                  // swallow — toast wiring lands in Task 6
                } finally {
                  setBusy(false);
                }
              }}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "保存草稿"
```

Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite to confirm no regressions**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx
```

Expected: All workspace tests pass (the 1 pre-existing ChapterTreePanel test failure is unrelated and can be ignored — it's a `chapterStatus` test that's been broken before this work).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/test/Workspace.test.tsx
git commit -m "fix(workspace): 保存草稿 writes to scene-draft endpoint, not outline"
```

---

## Task 2: Add backend `POST /stage4/fact-guard` endpoint (P0 part A)

**Files:**
- Create: `backend/api/stage4_fact_guard.py`
- Create: `tests/test_stage4_fact_guard.py`
- Modify: `backend/main.py` (register the new router)

**Problem:** The current `onFactGuard` handler in WorkspacePage calls `api.writeScene` which runs the full Writer pipeline (LLM call), overwriting the user's draft. We need a read-only endpoint that runs fact-guard on user-provided text without regenerating.

- [ ] **Step 1: Write the failing backend test**

Create `tests/test_stage4_fact_guard.py`:

```python
"""POST /api/stage4/fact-guard runs a fact-guard check on user-supplied
draft text without invoking the Writer LLM. Returns the same
fact_guard_results shape as the inline result of /write-scene."""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    from backend.api.stage4_fact_guard import fm
    fm.projects_dir = tmp_path
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_fact_guard import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed_project(projects_dir: Path, pid: str = "p1") -> None:
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "project.json").write_text(json.dumps({
        "id": pid, "title": "测试", "current_stage": "STAGE4",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({"title": "X"}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [{"chapter_number": 1, "scene_plan": [
            {"scene_number": 1, "goal": "测试", "conflict": "测试"},
        ]}],
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps({
        "project_id": pid, "current_stage": "STAGE4", "current_chapter": 1,
        "total_chapters": 1, "chapters": [], "circuit_breaker_events": [],
    }), encoding="utf-8")


def test_fact_guard_returns_pass_result(client, projects_dir):
    _seed_project(projects_dir)
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "一段没有问题的正文内容。",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["error"] is False
    assert body["code"] == "OK"
    detail = body["detail"]
    # detail must carry the same fields the inline write-scene result
    # exposes, so the frontend can render pass/fail uniformly.
    assert "all_passed" in detail
    assert "checks" in detail
    assert isinstance(detail["checks"], list)


def test_fact_guard_does_not_overwrite_draft_on_disk(client, projects_dir):
    _seed_project(projects_dir)
    # Write an existing draft.
    chapters = projects_dir / "p1" / "chapters"
    chapters.mkdir()
    draft_path = chapters / "ch01_scene_001_draft.md"
    draft_path.write_text("原始内容", encoding="utf-8")
    client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "新检查的内容",
    })
    # Disk file must be unchanged — fact-guard is read-only.
    assert draft_path.read_text(encoding="utf-8") == "原始内容"


def test_fact_guard_404_for_unknown_scene(client, projects_dir):
    _seed_project(projects_dir)
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 99,  # not in outline
        "draft_text": "x",
    })
    assert resp.status_code == 404
    assert resp.json()["code"] == "SCENE_NOT_FOUND"


def test_fact_guard_400_for_empty_project_id(client, projects_dir):
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "x",
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "VALIDATION_ERROR"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_stage4_fact_guard.py -v
```

Expected: ModuleNotFoundError or 404 (no such endpoint). The test will fail because the endpoint doesn't exist.

- [ ] **Step 3: Implement the endpoint**

First, read `backend/api/stage4_writing.py` to identify exactly which JSON files `_load_context` reads and which keys it requires on each. The function builds a `ctx` dict with at least: `chapter`, `world`, `characters`, `concept`, `genre`. The current `_seed_project` test fixture seeds `project.json`, `concept_and_dna.json`, `world.json`, `characters.json`, `outline.json`, `progress.json` — these may not be the exact filenames `_load_context` uses. If the implementer sees `KeyError` or missing-file errors when running Step 5, read `_load_context` to discover the actual file names/keys and add them to `_seed_project`.

Create `backend/api/stage4_fact_guard.py`:

```python
"""POST /api/stage4/fact-guard — read-only fact-guard check on user-supplied
draft text. Does not invoke the Writer LLM and does not write to disk.

Used by the manual-mode "Fact Guard" button in the workspace to validate
the user's hand-edited draft without overwriting it.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.api.stage4_writing import _load_context, _run_semantic_precheck
from backend.agents.reviewer import ReviewerAgent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stage4", tags=["stage4-fact-guard"])

# FileManager is bound at module-import time, the same way stage4_writing
# does it. Tests can rebind `fm.projects_dir` to point at a tmp dir.
from backend.utils.file_manager import FileManager
from backend.config import settings

fm = FileManager(settings.projects_dir)


@router.post("/fact-guard")
async def fact_guard(data: dict):
    """Run fact-guard on `draft_text` without regenerating or saving.

    Body: {project_id, chapter_number, scene_number, draft_text}
    Returns the same {all_passed, checks, coherence_score} shape that
    /write-scene returns inline.
    """
    project_id = data.get("project_id", "")
    chapter_number = int(data.get("chapter_number", 1))
    scene_number = int(data.get("scene_number", 1))
    draft_text = data.get("draft_text", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )

    ctx = _load_context(project_id, chapter_number)
    scenes = ctx["chapter"].get("scene_plan", [])
    scene_plan = next(
        (s for s in scenes if s.get("scene_number") == scene_number), None
    )
    if scene_plan is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "SCENE_NOT_FOUND",
                    "message": f"Scene {scene_number} 不存在", "detail": {}},
        )

    char_names = [c.get("name", "") for c in ctx.get("characters", []) if c.get("name")]
    precheck_result = _run_semantic_precheck(
        scene_text=draft_text,
        scene_plan=scene_plan,
        character_names=char_names,
    )

    reviewer = ReviewerAgent(project_id)
    fg_result = reviewer.run_fact_guard(
        draft_text=draft_text,
        characters=ctx["characters"],
        world_rules=ctx["world"],
        scene_plan=scene_plan,
        precheck_result=precheck_result,
    )

    checks_payload = [
        {"name": c.name, "passed": c.passed, "detail": c.detail}
        for c in getattr(fg_result, "checks", [])
    ]

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "all_passed": bool(getattr(fg_result, "all_passed", False)),
            "checks": checks_payload,
            "coherence_score": int(getattr(fg_result, "coherence_score", 0)),
        },
    }
```

Note: `_load_context` and `_run_semantic_precheck` are private helpers in `stage4_writing.py`. If `stage4_fact_guard.py` lives in the same package (`backend.api`), Python's name mangling doesn't apply to module-level functions — they're importable as `_load_context` and `_run_semantic_precheck`. Verify they exist by running:

```bash
grep -n "^def _load_context\|^async def _load_context\|^def _run_semantic_precheck\|^async def _run_semantic_precheck" backend/api/stage4_writing.py
```

If the helper names differ, read `backend/api/stage4_writing.py` (lines 187-330) to find the actual names and adjust the imports accordingly. Do NOT duplicate the context-loading logic into the new file — refactoring it is out of scope for this fix.

- [ ] **Step 4: Register the new router in main.py**

Read `backend/main.py` to find where `stage4_router` is registered (search for `stage4_router` or `include_router.*stage4`). Add a new line right after it:

```python
from backend.api.stage4_fact_guard import router as stage4_fact_guard_router
app.include_router(stage4_fact_guard_router)
```

If `main.py` builds the FastAPI app via a factory function, register the router inside that factory the same way the other routers are registered.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_stage4_fact_guard.py -v
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Run the broader stage4 test suite to confirm no regressions**

```bash
cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_stage4_writing_refactor.py -v
```

Expected: All existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/api/stage4_fact_guard.py backend/main.py tests/test_stage4_fact_guard.py
git commit -m "feat(stage4): add read-only POST /stage4/fact-guard endpoint"
```

---

## Task 3: Add `api.factGuard` and wire `onFactGuard` to use it (P0 part B)

**Files:**
- Modify: `frontend/src/api/client.ts` (add method around line 850)
- Modify: `frontend/src/pages/WorkspacePage.tsx:454-477` (replace handler)
- Modify: `frontend/src/test/Workspace.test.tsx` (update mock + add test)

**Problem:** The current `onFactGuard` calls `api.writeScene`, regenerates the scene (overwriting user edits), and doesn't surface fact-guard results. With Task 2's endpoint in place, wire the new method.

- [ ] **Step 1: Add a failing regression test**

In `frontend/src/test/Workspace.test.tsx`:

1a) Add `factGuard` to the hoisted mock set (around line 8-15):

```typescript
const {
  mockedGetProjectStatus,
  mockedGetStage4Progress,
  mockedGetOutline,
  mockedGetNovelOutline,
  mockedGenerateOutline,
  mockedWriteScene,
  mockedFactGuard,
} = vi.hoisted(() => ({
  mockedGetProjectStatus: vi.fn().mockResolvedValue({ title: "T" }),
  mockedGetStage4Progress: vi
    .fn()
    .mockResolvedValue({ chapters: [], total_chapters: 0 }),
  mockedGetOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  mockedGetNovelOutline: vi.fn().mockResolvedValue({ volumes: [] }),
  mockedGenerateOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  mockedWriteScene: vi.fn().mockResolvedValue({
    scene_number: 0,
    status: "passed",
    retry_count: 0,
    draft_text: "",
    parsed_logs: [],
    fact_guard_results: { all_passed: true, checks: [], coherence_score: 0 },
    registry_updates: { created: [], updated: [], cascade_executed: [] },
    l0_snapshot: {},
    precheck_result: { precheck_passed: true, suggestions: [], tokens_used: 0, skipped_reason: "" },
  }),
  // Default: pass. Tests that care about a specific result override via
  // mockResolvedValueOnce.
  mockedFactGuard: vi.fn().mockResolvedValue({
    all_passed: true,
    checks: [],
    coherence_score: 95,
  }),
}));
```

1b) Add `factGuard: mockedFactGuard` to the `vi.mock("../api/client", ...)` factory (around line 42-55).

1c) Add a `mockedFactGuard.mockReset()` + `mockedFactGuard.mockResolvedValue({ all_passed: true, checks: [], coherence_score: 95 })` block in `beforeEach` (next to the existing `mockedWriteScene.mockReset()` around line 138-149).

1d) Add the new test to the "Workspace integration" describe block (after the Task 1 保存草稿 test):

```typescript
  // Bug fix — "Fact Guard" must run a read-only check on the current draft,
  // not regenerate the scene via /write-scene (which would overwrite the
  // user's hand-written text). See api.factGuard in client.ts.
  it("'Fact Guard' button calls factGuard (not writeScene) and does NOT overwrite the editor", async () => {
    const { default: api } = await import("../api/client");
    const writeSceneSpy = api.writeScene as ReturnType<typeof vi.fn>;
    writeSceneSpy.mockClear();

    mockedFactGuard.mockResolvedValueOnce({
      all_passed: false,
      checks: [{ name: "timeline", passed: false, detail: "时间线冲突" }],
      coherence_score: 60,
    });

    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    // Type user content; clicking Fact Guard must NOT replace it.
    fireEvent.change(body, { target: { value: "用户手写的稿子" } });
    fireEvent.click(screen.getByTestId("editor-fact-guard"));

    await waitFor(() => expect(mockedFactGuard).toHaveBeenCalled());
    expect(mockedFactGuard).toHaveBeenCalledWith({
      project_id: "p1",
      chapter_number: 1,
      scene_number: 1,
      draft_text: "用户手写的稿子",
    });
    // Critical: writeScene is NOT called for Fact Guard (would overwrite).
    expect(writeSceneSpy).not.toHaveBeenCalled();
    // Editor body must be unchanged after Fact Guard.
    expect((screen.getByTestId("editor-body") as HTMLTextAreaElement).value).toBe("用户手写的稿子");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "Fact Guard"
```

Expected: FAIL — `mockedFactGuard` doesn't exist yet, and the current handler calls `writeScene` (so the assertions about "writeScene not called" and "body unchanged" will fail).

- [ ] **Step 3: Add `api.factGuard` to client.ts**

In `frontend/src/api/client.ts`, add the new method right after `writeScene` (around line 850):

```typescript
  factGuard: (data: {
    project_id: string;
    chapter_number: number;
    scene_number: number;
    draft_text: string;
  }) =>
    request<{
      all_passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
      coherence_score: number;
    }>("POST", "/stage4/fact-guard", data),
```

- [ ] **Step 4: Replace the onFactGuard handler in WorkspacePage.tsx**

In `frontend/src/pages/WorkspacePage.tsx`, replace the `onFactGuard={async () => { ... }}` block (lines 454-477) with:

```typescript
              onFactGuard={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  // Read-only check — does NOT call /write-scene, does NOT
                  // overwrite the editor. Result is shown via toast (Task 5)
                  // and an inline summary in the future.
                  await api.factGuard({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                } catch {
                  // swallow — toast wiring lands in Task 5
                } finally {
                  setBusy(false);
                }
              }}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "Fact Guard"
```

Expected: PASS.

- [ ] **Step 6: Run the full workspace test suite to confirm no regressions**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx
```

Expected: All workspace tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/WorkspacePage.tsx frontend/src/test/Workspace.test.tsx
git commit -m "fix(workspace): Fact Guard runs read-only check, no longer overwrites editor"
```

---

## Task 4: Load existing draft when selecting a chapter/scene (P1)

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx` (new useEffect)
- Modify: `frontend/src/test/Workspace.test.tsx` (regression test)

**Problem:** The current `onSelectChapter` and `onSelectScene` handlers do `setContent("")` and never load the saved draft from disk. `api.getSceneDraft` exists at `client.ts:861` but is never called from WorkspacePage.

**Known UX side-effect (acceptable for v1):** When the user switches from chapter A (with prose) to chapter B, the editor briefly shows chapter A's content before the useEffect loads chapter B's draft. This is a one-frame flash. Mitigation is a `loading` state that hides the editor while the request is in flight — out of scope for v1, listed as a follow-up polish item.

- [ ] **Step 1: Add a failing test**

Add the following test to `frontend/src/test/Workspace.test.tsx` (after the Task 1 test):

```typescript
  // Bug fix — selecting a chapter/scene must load the saved draft from
  // disk (ch{NN}_scene_{NNN}_draft.md) so the user sees their previously
  // written prose instead of an empty editor.
  it("selecting a chapter loads its saved draft into the editor", async () => {
    const { default: api } = await import("../api/client");
    const getSceneDraftSpy = api.getSceneDraft as ReturnType<typeof vi.fn>;
    getSceneDraftSpy.mockReset();
    getSceneDraftSpy.mockResolvedValueOnce({
      draft_text: "之前保存的草稿",
      chapter_number: 1,
      scene_number: 1,
      parsed_logs: [],
      fact_guard_results: null,
      coherence_score: 0,
    });

    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        {
          chapter_number: 1,
          title: "第一章",
          scene_plan: [
            { scene_number: 1 },
            { scene_number: 2 },
          ],
        },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    // Wait for the draft load useEffect to run.
    await waitFor(() => expect(getSceneDraftSpy).toHaveBeenCalledWith("p1", 1, 1));
    const body = await screen.findByTestId("editor-body");
    expect((body as HTMLTextAreaElement).value).toBe("之前保存的草稿");
  });
```

Also: add `getSceneDraft: vi.fn().mockResolvedValue({ draft_text: "", chapter_number: 1, scene_number: 1, parsed_logs: [], fact_guard_results: null, coherence_score: 0 })` to the `vi.mock("../api/client", ...)` factory (around line 42-55), and a `getSceneDraftSpy.mockReset()` + default in `beforeEach`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "selecting a chapter"
```

Expected: FAIL — `getSceneDraft` is never called, so the editor stays empty.

- [ ] **Step 3: Add the draft-load useEffect to WorkspacePage.tsx**

In `frontend/src/pages/WorkspacePage.tsx`, find the `useEffect` that reads URL params (around lines 166-179). Right after it, add:

```typescript
  // Load saved draft for the currently-selected chapter/scene. The
  // content is set even if it's empty (so the editor doesn't show stale
  // prose from a previous selection). When the user picks a chapter
  // with no saved draft yet, content is set to "". lastSavedContent
  // tracks the on-disk state so the regenerate confirm only fires when
  // the user has unsaved edits.
  useEffect(() => {
    if (!projectId) return;
    if (!currentScene) return;
    const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
    if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
    let cancelled = false;
    api
      .getSceneDraft(projectId, currentChapter, sceneNumber)
      .then((d: { draft_text?: string }) => {
        if (cancelled) return;
        const text = d?.draft_text ?? "";
        setContent(text);
        setLastSavedContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setLastSavedContent("");
      });
    return () => { cancelled = true; };
  }, [projectId, currentChapter, currentScene]);
```

- [ ] **Step 4: Remove the `setContent("")` calls in onSelectChapter/onSelectScene**

In `frontend/src/pages/WorkspacePage.tsx`, the `onSelectChapter` callback (around line 377-382) currently has `setContent("")` at the end. The draft-load useEffect now handles the content reset. Remove that line:

```typescript
              onSelectChapter={(n) => {
                setCurrentChapter(n);
                const ch = manualChapters.find((c) => c.chapter_number === n);
                setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
              }}
```

`onSelectScene` doesn't currently call `setContent`, so no change needed there.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "selecting a chapter"
```

Expected: PASS.

- [ ] **Step 6: Run the full workspace test suite**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx
```

Expected: All workspace tests pass. The existing 重新生成 regression test (line 257-288) should still work because it sets up `chapter=1&scene=1-1`, the draft-load useEffect runs, gets empty content (default mock), and the regenerate button still calls writeScene. No conflict.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/test/Workspace.test.tsx
git commit -m "feat(workspace): load saved scene draft when selecting a chapter"
```

---

## Task 5: Confirm dialog for 重新生成 when there are unsaved changes (P1)

**Files:**
- Create: `frontend/src/components/shared/ConfirmDialog.tsx`
- Create: `frontend/src/test/components/shared/ConfirmDialog.test.tsx`
- Modify: `frontend/src/pages/WorkspacePage.tsx` (wire to onRegenerate)

**Problem:** Clicking 重新生成 silently overwrites the editor (and any unsaved user edits) with a freshly-generated scene. We want a confirm dialog when content has been modified since the last save.

**Key design point:** The "unsaved changes" check must compare `content` against the LAST SAVED OR LOADED version, not just `content.length > 0`. Otherwise the confirm will fire on every regenerate for chapters that already have a saved draft (the most common case for power users).

- [ ] **Step 1: Write the ConfirmDialog component test**

Create `frontend/src/test/components/shared/ConfirmDialog.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "../../../components/shared/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and message when open", () => {
    render(
      <ConfirmDialog
        open
        title="重新生成场景？"
        message="当前编辑的内容将被覆盖。是否继续？"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("重新生成场景？")).toBeInTheDocument();
    expect(screen.getByText(/当前编辑的内容将被覆盖/)).toBeInTheDocument();
  });

  it("clicking confirm button calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="t"
        message="m"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/components/shared/ConfirmDialog.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ConfirmDialog component**

Create `frontend/src/components/shared/ConfirmDialog.tsx`:

```typescript
interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = "确认", cancelLabel = "取消", onCancel, onConfirm,
}: Props) {
  if (!open) return null;
  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4"
      >
        <h2 className="font-display text-primary text-lg">{title}</h2>
        <p className="font-body-ui text-system-log text-sm">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="px-4 py-2 rounded bg-surface-container text-system-log hover:bg-surface-container-high text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="px-4 py-2 rounded bg-primary-container text-surface-container-low hover:opacity-90 text-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/components/shared/ConfirmDialog.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Add a failing test for the WorkspacePage confirm flow**

Add this test to `frontend/src/test/Workspace.test.tsx` (after the Task 4 test):

```typescript
  // UX fix — clicking 重新生成 with unsaved changes must show a confirm
  // dialog, not silently destroy the user's work. The dialog uses the
  // generic ConfirmDialog (data-testid="confirm-dialog").
  it("重新生成 with unsaved changes shows a confirm dialog", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "未保存的改动" } });
    fireEvent.click(screen.getByTestId("editor-regenerate"));
    // Confirm dialog should appear; writeScene is NOT called yet.
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
  });

  // UX fix — the confirm must NOT fire when the user opens a chapter with
  // a saved draft but hasn't edited anything (otherwise every regenerate
  // is interrupted). lastSavedContent tracks the on-disk state; dirty =
  // content !== lastSavedContent.
  it("重新生成 with no edits (content matches saved) does NOT show a confirm dialog", async () => {
    const { default: api } = await import("../api/client");
    const getSceneDraftSpy = api.getSceneDraft as ReturnType<typeof vi.fn>;
    getSceneDraftSpy.mockReset();
    getSceneDraftSpy.mockResolvedValueOnce({
      draft_text: "磁盘上已有的内容",
      chapter_number: 1,
      scene_number: 1,
      parsed_logs: [],
      fact_guard_results: null,
      coherence_score: 0,
    });
    const writeSceneSpy = api.writeScene as ReturnType<typeof vi.fn>;
    writeSceneSpy.mockClear();

    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    // Wait for the draft load to populate the editor.
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toBe("磁盘上已有的内容"));
    // User clicks regenerate without editing. No confirm — writeScene fires
    // immediately (since content matches the loaded draft = not dirty).
    fireEvent.click(screen.getByTestId("editor-regenerate"));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(writeSceneSpy).toHaveBeenCalled());
  });

  // UX fix — clicking 取消 on the confirm dialog must NOT call writeScene.
  it("cancelling the regenerate confirm does NOT call writeScene", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    const { default: api } = await import("../api/client");
    const writeSceneSpy = api.writeScene as ReturnType<typeof vi.fn>;
    writeSceneSpy.mockClear();
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "未保存的改动" } });
    fireEvent.click(screen.getByTestId("editor-regenerate"));
    // Click the cancel button (global — there's only one confirm dialog
    // on the page at a time, so a global getByTestId is fine).
    await screen.findByTestId("confirm-dialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(writeSceneSpy).not.toHaveBeenCalled();
    // Editor content is preserved.
    expect((screen.getByTestId("editor-body") as HTMLTextAreaElement).value).toBe("未保存的改动");
  });
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "重新生成 with unsaved"
```

Expected: FAIL — no confirm dialog exists yet; the current handler calls writeScene immediately.

- [ ] **Step 7: Wire the confirm dialog to onRegenerate**

In `frontend/src/pages/WorkspacePage.tsx`:

7a) Add the import at the top of the file (next to the other workspace component imports around line 16-20):

```typescript
import ConfirmDialog from "../components/shared/ConfirmDialog";
```

7b) Add state for the unsaved-changes guard. Find the `useState` declarations (around line 117-126) and add:

```typescript
  // 重新生成: when true, the user has chosen to proceed with regenerate
  // after the unsaved-changes confirm dialog.
  const [regenerateGuard, setRegenerateGuard] = useState<{
    open: boolean;
    pending: boolean;
  }>({ open: false, pending: false });
```

Note: `lastSavedContent` was already added in Task 1 (Step 3a). It is read here by the dirty check; it does not need to be re-declared.

7c) Wrap the existing onRegenerate. The current handler (around line 434-453) is:

```typescript
              onRegenerate={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  const resp = await api.writeScene({...});
                  if (resp.draft_text) setContent(resp.draft_text);
                } catch (e) { ... } finally { setBusy(false); }
              }}
```

Replace it with:

```typescript
              onRegenerate={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                // Confirm only when the editor has edits the user has NOT
                // saved. If content matches what's on disk (lastSavedContent),
                // the regenerate doesn't destroy anything.
                if (content !== lastSavedContent) {
                  setRegenerateGuard({ open: true, pending: true });
                  return;
                }
                await doRegenerate(sceneNumber);
              }}
```

7d) Add the `doRegenerate` helper. Place it just before the `return (` of the component, near the other handlers (e.g. right before `const goToOutlinePanel = ...`):

```typescript
  const doRegenerate = async (sceneNumber: number) => {
    setBusy(true);
    try {
      const resp = await api.writeScene({
        project_id: projectId,
        chapter_number: currentChapter,
        scene_number: sceneNumber,
      });
      if (resp.draft_text) setContent(resp.draft_text);
    } catch (e) {
      console.warn("regenerate scene failed", e);
    } finally {
      setBusy(false);
    }
  };
```

7e) Render the ConfirmDialog. Find the existing modal block (around line 493-520) and add a new ConfirmDialog right after `</AddChaptersModal>`:

```typescript
      <ConfirmDialog
        open={regenerateGuard.open}
        title="重新生成场景？"
        message="当前编辑的内容将被覆盖。是否继续？"
        confirmLabel="重新生成"
        onCancel={() => setRegenerateGuard({ open: false, pending: false })}
        onConfirm={async () => {
          setRegenerateGuard({ open: false, pending: false });
          if (!currentScene) return;
          const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
          if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
          await doRegenerate(sceneNumber);
        }}
      />
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "重新生成 with unsaved"
```

Expected: PASS.

- [ ] **Step 9: Run the full workspace test suite**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx
```

Expected: All workspace tests pass. **Note:** the existing 重新生成 regression test (line 257-288) starts with an empty editor (the Task 4 useEffect runs and gets empty content from the default `getSceneDraft` mock), so `content === lastSavedContent === ""` (not dirty) and the confirm dialog does not appear — writeScene runs immediately. The test should still pass.

If it does NOT pass because the draft-load useEffect races with the test's regenerate click, the test setup may need to mock `getSceneDraft` to resolve empty (the default mock already does this). Verify the test still passes; if not, the test's `mockedGetOutline.mockResolvedValueOnce` already provides the outline — the issue would be timing. Use `waitFor` if needed.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/shared/ConfirmDialog.tsx frontend/src/test/components/shared/ConfirmDialog.test.tsx frontend/src/pages/WorkspacePage.tsx frontend/src/test/Workspace.test.tsx
git commit -m "feat(workspace): confirm before regenerating scene with unsaved content"
```

---

## Task 6: Toast feedback for save / regenerate / fact-guard (P2)

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx` (add useToast to three handlers)
- Modify: `frontend/src/test/Workspace.test.tsx` (regression tests)

**Problem:** None of the three handlers give the user any feedback. A failed save looks identical to a successful one.

- [ ] **Step 1: Add a failing test for save success toast**

Add to `frontend/src/test/Workspace.test.tsx` (after the Task 1 test):

```typescript
  // UX fix — 保存草稿 must show a success toast on success.
  it("'保存草稿' shows a success toast on save", async () => {
    const { default: api } = await import("../api/client");
    const updateSceneDraftSpy = api.updateSceneDraft as ReturnType<typeof vi.fn>;
    updateSceneDraftSpy.mockReset();
    updateSceneDraftSpy.mockResolvedValue({ chapter_number: 1, scene_number: 1 });

    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    const body = (await screen.findByTestId("editor-body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "新内容" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    // findByText polls — the toast renders asynchronously after the save
    // promise resolves. Use waitFor to avoid races with the auto-dismiss
    // timer in case the test environment is slow.
    await waitFor(() => expect(screen.getByText(/草稿已保存/)).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "草稿已保存"
```

Expected: FAIL — no toast rendered.

- [ ] **Step 3: Wire useToast in WorkspacePage**

In `frontend/src/pages/WorkspacePage.tsx`:

3a) Add the import next to the other hook imports (around line 4):

```typescript
import { useToast } from "../hooks/useToast";
```

3b) Get the toast API inside the component body, near the other hook calls (around line 103-104):

```typescript
  const { show } = useToast();
```

3c) Update the `onSaveDraft` handler to show toasts on success/failure. Replace the current block (around line 420-433, after Task 1's fix) with:

```typescript
              onSaveDraft={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  await api.updateSceneDraft({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                  show("草稿已保存");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  show(`保存失败：${msg}`);
                } finally {
                  setBusy(false);
                }
              }}
```

3d) Update the `onFactGuard` handler (after Task 3's fix). Replace its `try { ... } catch { swallow }` with:

```typescript
              onFactGuard={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  const result = await api.factGuard({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                  // User-friendly summary — hide internal check names; just
                  // report the failure count so the toast stays short.
                  if (result.all_passed) {
                    const n = result.checks.length;
                    show(n > 0 ? `Fact Guard 通过（${n} 项检查）` : "Fact Guard 通过");
                  } else {
                    const failed = result.checks.filter((c) => !c.passed).length;
                    show(`Fact Guard 未通过（${failed} 项不通过）`);
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  show(`Fact Guard 失败：${msg}`);
                } finally {
                  setBusy(false);
                }
              }}
```

3e) Update `doRegenerate` (after Task 5's refactor) to show toasts:

```typescript
  const doRegenerate = async (sceneNumber: number) => {
    setBusy(true);
    try {
      const resp = await api.writeScene({
        project_id: projectId,
        chapter_number: currentChapter,
        scene_number: sceneNumber,
      });
      if (resp.draft_text) {
        setContent(resp.draft_text);
        show("场景已重新生成");
      } else {
        show("场景生成完成（无草稿文本）");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show(`重新生成失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx -t "草稿已保存"
```

Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/Workspace.test.tsx
```

Expected: All workspace tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/test/Workspace.test.tsx
git commit -m "feat(workspace): toast feedback for save / regenerate / fact-guard"
```

---

## Self-Review

**1. Spec coverage:**
- P0-1 (保存草稿 uses correct endpoint) — Task 1 ✓
- P0-2 (Fact Guard is read-only) — Tasks 2 + 3 ✓
- P1-1 (load draft on chapter select) — Task 4 ✓
- P1-2 (confirm before regenerate) — Task 5 ✓
- P2 (toast feedback) — Task 6 ✓

All 5 user-listed issues have a corresponding task.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "fill in details" placeholders. Every code step has the actual code. References to existing helpers (`_load_context`, `_run_semantic_precheck`) include a verification step (`grep` command) to confirm the names match — implementer can adjust if they differ.

**3. Type consistency:**
- `api.updateSceneDraft(data)` signature consistent between client.ts (line 870) and the test (Task 1, Task 6) ✓
- `api.factGuard(data)` signature defined in Task 3 and used in Task 6 ✓
- `doRegenerate(sceneNumber)` defined and called consistently in Task 5 and Task 6 ✓
- `regenerateGuard` state shape used consistently ✓
- `api.getSceneDraft(projectId, chapterNumber, sceneNumber)` signature matches client.ts (line 861) ✓
