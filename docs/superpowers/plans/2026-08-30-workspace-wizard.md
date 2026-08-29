# Workspace Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fuse the 6-step `InitWizardModal` into `/project/:id/workspace` as a permanent "项目设定" tab with a 7-item sidebar (adding 创意发散 as step 1), remove ContextPanel's 5 redundant editor tabs, lock the "正文手稿" tab until all 7 steps complete, and add 4 new backend endpoints for creative divergence.

**Architecture:** Reuse existing `WizardContext` + `WizardProvider` (zero reducer changes beyond `TOTAL_STEPS=7` + new `STEP_DATA_KEY_TO_STEP` entry + 6th prefill fetch). Existing step components drop into a new `<WizardCanvas>` unchanged. Build new `<WorkspaceWizardPanel>`, `<WizardSidebar>`, `<CreativeDivergenceStep>`, `<WorkspaceWritingPanel>`. Extract the writing-side behavior from `WorkspacePage.tsx` into `<WorkspaceWritingPanel>` so the page itself can host a tab switcher. Rewrite `WizardDeepLinkPage` as a redirect shell.

**Tech Stack:** Python + FastAPI + pytest (backend) · React 18 + Vite + Tailwind + Vitest + jsdom + @testing-library/react (frontend) · Material Symbols Outlined icons · existing `WizardContext` reducer.

**Spec:** `docs/superpowers/specs/2026-08-30-workspace-wizard-design.md` (commit `5a31232`)

**Branch:** `nebula` (no worktree — user prefers direct work per `feedback_worktree_v19.md`)

---

## Phase index

- **Phase 1 — Backend foundation** (Tasks 1–3)
- **Phase 2 — Frontend foundation** (Tasks 4–6)
- **Phase 3 — New wizard components** (Tasks 7–9)
- **Phase 4 — Top bar + writing panel extraction** (Tasks 10–11)
- **Phase 5 — WorkspacePage slim + routing** (Tasks 12, 15)
- **Phase 6 — ContextPanel trim + ConceptStep prefill** (Tasks 13–14)
- **Phase 7 — Deprecation + smoke** (Tasks 16–17)

---

## Task 1: Backend `creative_divergence` API endpoints

**Files:**
- Create: `backend/api/creative_divergence.py`
- Modify: `backend/main.py` (mount router)
- Test: `tests/test_creative_divergence_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_creative_divergence_api.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager  # adjust per project conventions

@pytest.fixture
def project(tmp_path):
    pid = "proj_test_cd"
    (tmp_path / pid).mkdir()
    fm = _file_manager()
    fm.projects_dir = tmp_path  # patch per project_api_file_manager_pattern
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_generate_returns_4_variants(client, project):
    r = client.post(f"/projects/{project}/creative-divergence/generate",
                    json={"prompt": "赛博朋克侦探调查记忆盗窃"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["variants"]) == 4
    for v in data["variants"]:
        assert {"id", "label", "title", "description", "tags"} <= set(v.keys())

def test_generate_rejects_oversized_prompt(client, project):
    r = client.post(f"/projects/{project}/creative-divergence/generate",
                    json={"prompt": "x" * 2001})
    assert r.status_code == 422

def test_select_writes_concept_and_marks_source(client, project):
    client.post(f"/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    list_r = client.get(f"/projects/{project}/creative-divergence")
    variant_id = list_r.json()["variants"][0]["id"]
    sel = client.post(f"/projects/{project}/creative-divergence/select",
                      json={"variant_id": variant_id})
    assert sel.status_code == 200
    payload = sel.json()["concept_payload"]
    assert {"title", "genre", "premise", "tone", "theme"} <= set(payload.keys())
    # concept_and_dna.json was written with source=creative_divergence
    cd = json.loads((_file_manager().projects_dir / project / "concept_and_dna.json").read_text())
    assert cd["concept"]["source"] == "creative_divergence"
    assert cd["concept"]["source_variant_id"] == variant_id

def test_select_rejects_unknown_variant_id(client, project):
    client.post(f"/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    r = client.post(f"/projects/{project}/creative-divergence/select",
                    json={"variant_id": "var_doesnotexist"})
    assert r.status_code == 422

def test_prefill_check_reports_state(client, project):
    r = client.get(f"/projects/{project}/creative-divergence/prefill-check")
    assert r.json() == {"exists": False, "has_selection": False}
    client.post(f"/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    r = client.get(f"/projects/{project}/creative-divergence/prefill-check")
    assert r.json() == {"exists": True, "has_selection": False}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_creative_divergence_api.py -v`
Expected: All FAIL with `404 Not Found` (router not mounted yet).

- [ ] **Step 3: Implement the router**

Create `backend/api/creative_divergence.py`:

```python
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.creative_os.mutation_engine import mutate_idea
from backend.creative_os.idea_pool import sample_idea_pool
from backend.services import _file_manager

router = APIRouter(prefix="/projects/{project_id}", tags=["creative-divergence"])

CD_FILE = "creative_divergence.json"
CONCEPT_FILE = "concept_and_dna.json"
MAX_PROMPT_LEN = 2000
GENERATE_VARIANT_COUNT = 4
VARIANT_LABELS = ["ALPHA", "BETA", "GAMMA", "DELTA"]


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_LEN)
    count: int = Field(default=GENERATE_VARIANT_COUNT, ge=1, le=8)
    params: Optional[dict] = None


class SelectRequest(BaseModel):
    variant_id: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_cd(project_id: str) -> dict:
    fm = _file_manager()
    path = fm.projects_dir / project_id / CD_FILE
    if not path.exists():
        return {"prompt": "", "variants": [], "selected_id": None,
                "selected_at": None, "updated_at": None}
    import json
    return json.loads(path.read_text(encoding="utf-8"))


def _write_cd(project_id: str, data: dict) -> None:
    fm = _file_manager()
    data["updated_at"] = _now()
    path = fm.projects_dir / project_id / CD_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _generate_variants(prompt: str, count: int) -> List[dict]:
    # Reuse existing CreativeOS primitives; fall back to deterministic stub
    # when LLM is unavailable (so tests don't need live keys).
    out: List[dict] = []
    seed_pool = sample_idea_pool(prompt) or [{"title": prompt[:24], "tags": []}]
    for i in range(count):
        mutated = mutate_idea(seed_pool[i % len(seed_pool)], op_index=i)
        out.append({
            "id": f"var_{uuid.uuid4().hex[:12]}",
            "label": f"概念 {VARIANT_LABELS[i % len(VARIANT_LABELS)]}",
            "title": mutated.get("title") or f"变体 {i+1}",
            "description": mutated.get("description") or prompt,
            "tags": mutated.get("tags", []),
            "created_at": _now(),
        })
    return out


@router.get("/creative-divergence")
def list_variants(project_id: str):
    data = _read_cd(project_id)
    return {"variants": data["variants"], "selected_id": data.get("selected_id")}


@router.post("/creative-divergence/generate")
def generate_variants(project_id: str, req: GenerateRequest):
    variants = _generate_variants(req.prompt, req.count)
    data = {
        "prompt": req.prompt,
        "variants": variants,
        "selected_id": None,
        "selected_at": None,
        "updated_at": None,
    }
    _write_cd(project_id, data)
    return {"variants": variants}


@router.post("/creative-divergence/select")
def select_variant(project_id: str, req: SelectRequest):
    import json
    data = _read_cd(project_id)
    target = next((v for v in data["variants"] if v["id"] == req.variant_id), None)
    if target is None:
        raise HTTPException(status_code=422, detail="variant_id 不存在")
    data["selected_id"] = req.variant_id
    data["selected_at"] = _now()
    _write_cd(project_id, data)

    # Sync selected concept fields into concept_and_dna.json.concept
    fm = _file_manager()
    concept_path = fm.projects_dir / project_id / CONCEPT_FILE
    if concept_path.exists():
        cd = json.loads(concept_path.read_text(encoding="utf-8"))
    else:
        cd = {"concept": {}, "story_dna": {}}
    cd["concept"] = {
        **cd.get("concept", {}),
        "title": target["title"],
        "genre": (target.get("tags") or [""])[0],
        "premise": target["description"],
        "tone": target.get("tone") or cd["concept"].get("tone", ""),
        "theme": target.get("theme") or cd["concept"].get("theme", ""),
        "source": "creative_divergence",
        "source_variant_id": req.variant_id,
    }
    concept_path.write_text(json.dumps(cd, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"concept_payload": cd["concept"]}


@router.get("/creative-divergence/prefill-check")
def prefill_check(project_id: str):
    data = _read_cd(project_id)
    return {
        "exists": bool(data.get("variants")),
        "has_selection": data.get("selected_id") is not None,
    }
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

Open `backend/main.py`. Find where other routers are mounted (search for `app.include_router` or `from backend.api import`). Add:

```python
from backend.api.creative_divergence import router as creative_divergence_router
app.include_router(creative_divergence_router)
```

If `backend/main.py` imports routers inside a function (lifespan), add the include_router inside the same function.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_creative_divergence_api.py -v`
Expected: All 5 PASS. If `mutate_idea` / `sample_idea_pool` are unavailable in the project, replace them with deterministic stubs (a function that returns `{"title": f"变体 {prompt[:20]} {i}", "description": prompt, "tags": []}`) and re-run.

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_divergence.py backend/main.py tests/test_creative_divergence_api.py
git commit -m "feat(api): creative-divergence endpoints (list/generate/select/prefill)"
```

---

## Task 2: `concept.py` accepts `source` field on update

**Files:**
- Modify: `backend/api/concept.py`
- Test: `tests/test_concept_source_field.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_concept_source_field.py
import json
from fastapi.testclient import TestClient
from backend.main import app
from backend.services import _file_manager

def test_update_concept_accepts_source_manual(tmp_path):
    pid = "proj_test_src"
    (tmp_path / pid).mkdir()
    _file_manager().projects_dir = tmp_path
    # pre-seed concept_and_dna.json with source=creative_divergence
    (_file_manager().projects_dir / pid / "concept_and_dna.json").write_text(
        json.dumps({"concept": {"title": "X", "source": "creative_divergence"},
                    "story_dna": {}}, ensure_ascii=False)
    )
    c = TestClient(app)
    r = c.post(f"/projects/{pid}/concept/update",
               json={"concept": {"title": "New", "premise": "p", "theme": "t",
                                 "genre": "g", "tone": "tn",
                                 "source": "manual"}})
    assert r.status_code == 200
    saved = json.loads((_file_manager().projects_dir / pid / "concept_and_dna.json").read_text())
    assert saved["concept"]["source"] == "manual"
    assert saved["concept"]["title"] == "New"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_concept_source_field.py -v`
Expected: FAIL — `source` field rejected by Pydantic / persisted payload does not include it.

- [ ] **Step 3: Update `concept.py` to accept and persist `source`**

Open `backend/api/concept.py`. Find the Pydantic model for concept updates (likely `ConceptUpdate` or similar) and the persistence code. Add `source: Optional[str] = Field(default=None, pattern="^(manual|creative_divergence)$")` and `source_variant_id: Optional[str] = None` to the model. In the persistence code, merge these fields through to the saved JSON if present in the request payload.

If the existing update endpoint already uses a permissive `dict` body, no model change is needed — just ensure `source` is passed through to the saved file unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_concept_source_field.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/concept.py tests/test_concept_source_field.py
git commit -m "feat(api): concept.update accepts source + source_variant_id fields"
```

---

## Task 3: Smoke-test backend routes resolve

**Files:**
- Modify: (none — verification only)

- [ ] **Step 1: Verify route registration**

Run: `python -c "from backend.main import app; routes = [r.path for r in app.routes if hasattr(r, 'path')]; print('\n'.join(sorted(r for r in routes if 'creative-divergence' in r)))"`
Expected: prints 4 lines:
```
/projects/{project_id}/creative-divergence
/projects/{project_id}/creative-divergence/generate
/projects/{project_id}/creative-divergence/prefill-check
/projects/{project_id}/creative-divergence/select
```

- [ ] **Step 2: Run full backend test suite**

Run: `pytest tests/test_creative_divergence_api.py tests/test_concept_source_field.py -v`
Expected: All PASS.

If broader regression check desired: `pytest tests/test_api_concept.py -v` (or equivalent existing test file).

- [ ] **Step 3: Commit (no-op if nothing to add)**

Skip if nothing changed.

---

## Task 4: Frontend `api/client.ts` creative-divergence methods

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add the 4 method stubs**

Open `frontend/src/api/client.ts`. Find where other API methods live (search for `getConcept`, `getWorld`). Add the following exports inside the default `api` object (or wherever the existing methods are defined):

```ts
async listCreativeDivergenceVariants(projectId: string): Promise<{
  variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
  selected_id: string | null;
}> {
  const r = await this.get(`/projects/${encodeURIComponent(projectId)}/creative-divergence`);
  return r;
},

async generateCreativeDivergenceVariants(
  projectId: string,
  req: { prompt: string; count?: number; params?: { tone?: string; genre_tags?: string[] } },
): Promise<{ variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }> }> {
  const r = await this.post(`/projects/${encodeURIComponent(projectId)}/creative-divergence/generate`, req);
  return r;
},

async selectCreativeDivergenceVariant(
  projectId: string,
  variantId: string,
): Promise<{ concept_payload: { title: string; genre: string; premise: string; tone: string; theme: string; source: string; source_variant_id: string } }> {
  const r = await this.post(`/projects/${encodeURIComponent(projectId)}/creative-divergence/select`, { variant_id: variantId });
  return r;
},

async getCreativeDivergencePrefill(projectId: string): Promise<{ exists: boolean; has_selection: boolean }> {
  const r = await this.get(`/projects/${encodeURIComponent(projectId)}/creative-divergence/prefill-check`);
  return r;
},
```

(Adjust method names — `this.get` / `this.post` — to match the existing client convention. Inspect 2–3 sibling methods before writing.)

- [ ] **Step 2: Type-check the file**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors related to `client.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(api): client.ts creative-divergence methods (list/generate/select/prefill)"
```

---

## Task 5: `WizardContext` — `TOTAL_STEPS=7` + new prefill fetch + new key

**Files:**
- Modify: `frontend/src/components/wizard/WizardContext.tsx`

- [ ] **Step 1: Update `TOTAL_STEPS` constant**

Find the line `export const TOTAL_STEPS = 6;` and change to `export const TOTAL_STEPS = 7;`.

- [ ] **Step 2: Add `creative_divergence` to `WizardData`**

In the `WizardData` interface, add a new field:

```ts
creative_divergence: {
  variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
  selected_id: string | null;
} | null;
```

In `EMPTY_DATA`, add `creative_divergence: null`.

- [ ] **Step 3: Update `STEP_DATA_KEY_TO_STEP`**

Find the existing map. Reassign every existing entry to its new step:

```ts
const STEP_DATA_KEY_TO_STEP: Partial<Record<keyof WizardData, number>> = {
  creative_divergence: 1,
  concept: 2,
  story_dna: 2,
  world: 3,
  characters: 4,
  novel_outline: 6,
  chapter1_outline: 7,
  chapter_outline_progress: 7,
};
```

- [ ] **Step 4: Add `CreativeDivergence` to the `Concept` type's persisted fields**

Find the useEffect that writes to `sessionStorage` in `WizardProvider`. Add `creative_divergence: state.data.creative_divergence` to the JSON.stringify payload.

- [ ] **Step 5: Run wizard-context tests**

Run: `cd frontend && npm test -- --run 'WizardContext' 2>&1 | tail -30`
Expected: PASS. (Existing tests should still pass — none of them assert TOTAL_STEPS=6 specifically.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/WizardContext.tsx
git commit -m "refactor(wizard): TOTAL_STEPS=7, add creative_divergence data key, shift step mapping"
```

---

## Task 6: Extract `<RegenerateStatusBadge>` to its own file

**Files:**
- Create: `frontend/src/components/wizard/RegenerateStatusBadge.tsx`
- Modify: `frontend/src/components/wizard/InitWizardModal.tsx` (replace inline component with import)

- [ ] **Step 1: Create the new file**

```tsx
// frontend/src/components/wizard/RegenerateStatusBadge.tsx
import { useEffect } from "react";
import { useWizard, type WizardRegenerateState } from "./WizardContext";

export default function RegenerateStatusBadge({ state }: { state: WizardRegenerateState }) {
  const clear = useWizard().clearRegenerateState;
  useEffect(() => {
    if (state.kind === "idle") return;
    const ttl = state.kind === "busy" ? 30_000 : 3500;
    const t = setTimeout(clear, ttl);
    return () => clearTimeout(t);
  }, [state, clear]);

  if (state.kind === "idle") return null;

  if (state.kind === "busy") {
    return (
      <div data-testid="wizard-regenerate-status" data-status="busy" role="status" aria-live="polite"
           className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary-container/10 text-primary-container font-body text-body-md text-xs">
        <span data-testid="wizard-regenerate-status-spinner" aria-hidden="true"
              className="material-symbols-outlined text-[14px] animate-spin inline-block">
          progress_activity
        </span>
        正在重新生成 {state.target}…
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div data-testid="wizard-regenerate-status" data-status="success" role="status" aria-live="polite"
           className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary-container/15 text-primary-container font-body text-body-md text-xs">
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">check</span>
        {state.target} 已重新生成
      </div>
    );
  }

  return (
    <div data-testid="wizard-regenerate-status" data-status="failure" role="status" aria-live="assertive"
         className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-error-container/30 text-error font-body text-body-md text-xs max-w-[40ch] truncate"
         title={`重新生成失败: ${state.message}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
      重新生成失败: {state.message}
    </div>
  );
}
```

- [ ] **Step 2: Update `InitWizardModal.tsx` to import it**

Find the inline `function RegenerateStatusBadge({ state }: { state: WizardRegenerateState })` definition in `InitWizardModal.tsx`. Delete the entire function (lines ~53–116). Replace with `import RegenerateStatusBadge from "./RegenerateStatusBadge";` at the top.

- [ ] **Step 3: Run wizard tests**

Run: `cd frontend && npm test -- --run 'InitWizardModal|RegenerateStatusBadge' 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/RegenerateStatusBadge.tsx frontend/src/components/wizard/InitWizardModal.tsx
git commit -m "refactor(wizard): extract RegenerateStatusBadge to its own file"
```

---

## Task 7: `<WizardSidebar>` component

**Files:**
- Create: `frontend/src/components/wizard/WizardSidebar.tsx`
- Test: `frontend/src/components/wizard/WizardSidebar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/wizard/WizardSidebar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WizardSidebar from "./WizardSidebar";

describe("WizardSidebar", () => {
  const labels = ["创意发散", "概念 DNA", "世界观", "角色设计", "地图系统", "全文大纲", "章节大纲"];

  it("renders 7 sidebar items in order", () => {
    render(<WizardSidebar currentStep={1} completedSteps={[]} onJump={() => {}} />);
    labels.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it("marks active item with secondary-container background", () => {
    render(<WizardSidebar currentStep={2} completedSteps={[]} onJump={() => {}} />);
    const item = screen.getByText("概念 DNA").closest("a, button");
    expect(item?.className).toMatch(/bg-secondary-container/);
  });

  it("disables pending items", () => {
    render(<WizardSidebar currentStep={1} completedSteps={[]} onJump={() => {}} />);
    const item = screen.getByText("角色设计").closest("a, button");
    expect(item).toHaveAttribute("disabled");
  });

  it("calls onJump when reachable item is clicked", () => {
    const onJump = vi.fn();
    render(<WizardSidebar currentStep={3} completedSteps={[1, 2]} onJump={onJump} />);
    fireEvent.click(screen.getByText("概念 DNA"));
    expect(onJump).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run 'WizardSidebar' 2>&1 | tail -30`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/wizard/WizardSidebar.tsx
const STEPS: Array<{ num: number; label: string; icon: string }> = [
  { num: 1, label: "创意发散", icon: "psychology" },
  { num: 2, label: "概念 DNA", icon: "biotech" },
  { num: 3, label: "世界观", icon: "public" },
  { num: 4, label: "角色设计", icon: "groups" },
  { num: 5, label: "地图系统", icon: "map" },
  { num: 6, label: "全文大纲", icon: "format_list_numbered" },
  { num: 7, label: "章节大纲", icon: "auto_stories" },
];

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (step: number) => void;
}

export default function WizardSidebar({ currentStep, completedSteps, onJump }: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container fixed left-0 top-16 h-[calc(100%-64px)] w-[240px] border-r border-outline-variant dark:border-outline-variant flex flex-col py-md px-sm z-20">
      <div className="flex-1 space-y-xs overflow-y-auto pr-xs custom-scrollbar">
        {STEPS.map(({ num, label, icon }) => {
          const completed = completedSteps.includes(num);
          const current = currentStep === num;
          const reachable = completed || current;
          const baseCls = "flex items-center gap-sm px-md py-xs rounded-lg transition-colors";
          const stateCls = current
            ? "bg-secondary-container text-on-secondary-container font-bold scale-95 transition-transform duration-150"
            : "text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant";
          return (
            <button
              key={num}
              type="button"
              data-testid={`wizard-sidebar-item-${num}`}
              data-state={completed ? "completed" : current ? "current" : "pending"}
              disabled={!reachable}
              onClick={() => reachable && onJump(num)}
              className={`${baseCls} ${stateCls} ${!reachable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: current ? '"FILL" 1' : '"FILL" 0' }}
              >
                {icon}
              </span>
              <span className="font-body-md text-body-md">{label}</span>
              {completed && !current && (
                <span aria-hidden="true" className="material-symbols-outlined ml-auto text-[16px] text-primary">
                  check
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run 'WizardSidebar' 2>&1 | tail -30`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/WizardSidebar.tsx frontend/src/components/wizard/WizardSidebar.test.tsx
git commit -m "feat(wizard): WizardSidebar 7-item vertical nav"
```

---

## Task 8: `<CreativeDivergenceStep>` component

**Files:**
- Create: `frontend/src/components/wizard/CreativeDivergenceStep.tsx`
- Test: `frontend/src/components/wizard/CreativeDivergenceStep.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/wizard/CreativeDivergenceStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import api from "../../api/client";
import { WizardProvider } from "./WizardContext";

vi.mock("../../api/client", () => ({
  default: {
    listCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [], selected_id: null }),
    generateCreativeDivergenceVariants: vi.fn().mockResolvedValue({
      variants: [
        { id: "v1", label: "概念 ALPHA", title: "风暴密码", description: "AI 试图...", tags: ["科幻", "悬疑"], created_at: "2026-08-30T00:00:00Z" },
        { id: "v2", label: "概念 BETA", title: "大气回响", description: "AI 已经...", tags: ["心理"], created_at: "2026-08-30T00:00:01Z" },
      ],
    }),
    selectCreativeDivergenceVariant: vi.fn().mockResolvedValue({
      concept_payload: { title: "风暴密码", genre: "科幻", premise: "AI 试图...", tone: "惊悚", theme: "人与自然", source: "creative_divergence", source_variant_id: "v1" },
    }),
  },
}));

function renderStep() {
  return render(
    <WizardProvider projectId="proj_test">
      <CreativeDivergenceStep projectId="proj_test" />
    </WizardProvider>
  );
}

describe("CreativeDivergenceStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders header + glass-panel input + generate button", () => {
    renderStep();
    expect(screen.getByText("创意发散")).toBeInTheDocument();
    expect(screen.getByText("生成概念")).toBeInTheDocument();
  });

  it("renders placeholder when no variants exist", async () => {
    renderStep();
    await waitFor(() => expect(api.listCreativeDivergenceVariants).toHaveBeenCalled());
    expect(screen.getByText(/点生成开始创意发散|暂无变体/i)).toBeInTheDocument();
  });

  it("clicking generate renders 4 variant cards", async () => {
    renderStep();
    fireEvent.click(screen.getByText("生成概念"));
    await waitFor(() => expect(screen.getByText("风暴密码")).toBeInTheDocument());
    expect(screen.getByText("大气回响")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run 'CreativeDivergenceStep' 2>&1 | tail -30`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/wizard/CreativeDivergenceStep.tsx
import { useEffect, useState } from "react";
import api from "../../api/client";
import { useWizard } from "./WizardContext";

type Variant = {
  id: string; label: string; title: string; description: string;
  tags: string[]; created_at: string;
};

interface CreativeDivergenceStepProps {
  projectId: string;
}

export default function CreativeDivergenceStep({ projectId }: CreativeDivergenceStepProps) {
  const wizard = useWizard();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("惊悚");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listCreativeDivergenceVariants(projectId)
      .then((r) => { if (!cancelled) setVariants(r.variants); })
      .catch(() => { /* empty list is fine */ });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleGenerate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.generateCreativeDivergenceVariants(projectId, { prompt, count: 4, params: { tone } });
      setVariants(r.variants);
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.selectCreativeDivergenceVariant(projectId, selectedId);
      wizard.markStepGenerated(1, {
        creative_divergence: { variants, selected_id: selectedId },
        concept: r.concept_payload,
      });
      wizard.jumpToStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col gap-lg">
      <header className="flex flex-col gap-xs">
        <h2 className="font-display-lg text-display-lg text-on-surface">创意发散</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">为你的叙事生成主题钩子和概念起点。</p>
      </header>

      <section className="glass-panel rounded-xl p-md flex flex-col gap-sm relative">
        <div className="absolute inset-0 bg-primary/5 rounded-xl pointer-events-none" />
        <label className="font-label-sm text-label-sm text-primary uppercase tracking-wider flex items-center gap-xs" htmlFor="prompt-input">
          <span className="material-symbols-outlined text-[16px]">arrow_back_ios_new</span>
          AI 提示词指令
        </label>
        <textarea
          id="prompt-input"
          data-testid="cd-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-sm text-on-surface font-body-md min-h-[120px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none placeholder-outline"
          placeholder="描述你的故事想法的核心本质、主题或背景..."
        />
        <div className="flex justify-between items-center mt-xs">
          <div className="flex gap-sm">
            <button type="button" className="flex items-center gap-xs px-sm py-2 rounded-lg bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors text-label-sm font-label-sm">
              <span className="material-symbols-outlined text-[18px]">tune</span>参数设置
            </button>
            <button type="button" onClick={() => setTone(tone === "惊悚" ? "温暖" : "惊悚")}
                    className="flex items-center gap-xs px-sm py-2 rounded-lg bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors text-label-sm font-label-sm">
              <span className="material-symbols-outlined text-[18px]">style</span>语气：{tone}
            </button>
          </div>
          <button data-testid="cd-generate" type="button" onClick={handleGenerate} disabled={busy || !prompt.trim()}
                  className="bg-primary text-on-primary px-lg py-2 rounded-lg font-title-md text-title-md flex items-center gap-xs hover:bg-primary-container transition-colors shadow-[0_0_15px_rgba(142,213,255,0.3)] disabled:opacity-50">
            {busy ? "生成中…" : "生成概念"}
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </section>

      {error && (
        <div data-testid="cd-error" className="px-md py-2 rounded-lg bg-error-container/30 text-error text-body-md">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-md">
        <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
          <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-xs">
            <span className="material-symbols-outlined text-primary">auto_awesome</span>
            生成的创意方向
          </h3>
          <span className="font-label-sm text-label-sm text-on-surface-variant">已有 {variants.length} 个变体</span>
        </div>

        {variants.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant py-lg text-center">
            暂无变体 — 点生成开始创意发散
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {variants.map((v, i) => {
              const active = selectedId === v.id || (selectedId === null && i === 0);
              return (
                <button key={v.id} type="button" data-testid={`cd-variant-${v.id}`}
                        onClick={() => setSelectedId(v.id)}
                        className={`text-left glass-panel rounded-xl p-md flex flex-col gap-md transition-all duration-300 ${active ? "border-primary/50 glow-active bg-surface-container-highest" : "border border-outline-variant hover:border-primary/50 hover:bg-surface-container-highest"}`}>
                  <div className="flex justify-between items-start">
                    <span className={`px-xs py-1 rounded text-[10px] uppercase font-label-sm tracking-wider border ${active ? "bg-primary/20 text-primary border-primary/30" : "bg-surface-container-high text-on-surface-variant border-outline-variant"}`}>
                      {v.label}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-xs">{v.title}</h4>
                    <p className="font-body-md text-body-md text-on-surface-variant line-clamp-3">{v.description}</p>
                  </div>
                  {v.tags.length > 0 && (
                    <div className="mt-auto pt-sm border-t border-outline-variant flex flex-wrap gap-2">
                      {v.tags.map((t) => (
                        <span key={t} className="px-2 py-1 bg-surface-container text-on-surface-variant rounded text-[10px] font-label-sm border border-outline-variant">{t}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {variants.length > 0 && (
        <div className="flex justify-end">
          <button data-testid="cd-confirm" type="button" onClick={handleConfirm} disabled={!selectedId || busy}
                  className="bg-primary text-on-primary px-lg py-2 rounded-lg font-title-md text-title-md hover:bg-primary-container transition-colors disabled:opacity-50">
            确认选中并继续
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run 'CreativeDivergenceStep' 2>&1 | tail -30`
Expected: 3 PASS. If jsdom cold-cache error, re-run once (see `project_vitest_jsdom_cold_cache`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/CreativeDivergenceStep.tsx frontend/src/components/wizard/CreativeDivergenceStep.test.tsx
git commit -m "feat(wizard): CreativeDivergenceStep (input + variant cards + select)"
```

---

## Task 9: `<WorkspaceWizardPanel>` — sidebar + canvas + provider

**Files:**
- Create: `frontend/src/components/wizard/WorkspaceWizardPanel.tsx`
- Test: `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceWizardPanel from "./WorkspaceWizardPanel";
import api from "../../api/client";

vi.mock("../../api/client", () => ({
  default: {
    getCreativeDivergencePrefill: vi.fn().mockResolvedValue({ exists: false, has_selection: false }),
    getConcept: vi.fn().mockRejectedValue(new Error("404")),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockRejectedValue(new Error("404")),
    getOutline: vi.fn().mockRejectedValue(new Error("404")),
  },
}));

describe("WorkspaceWizardPanel", () => {
  it("renders WizardSidebar + step 1 canvas", async () => {
    render(<WorkspaceWizardPanel projectId="proj_test" />);
    expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("创意发散")).toBeInTheDocument());
  });

  it("calls 6 prefill endpoints on mount", async () => {
    render(<WorkspaceWizardPanel projectId="proj_test" />);
    await waitFor(() => {
      expect(api.getCreativeDivergencePrefill).toHaveBeenCalledWith("proj_test");
      expect(api.getConcept).toHaveBeenCalled();
      expect(api.getWorld).toHaveBeenCalled();
      expect(api.getCharacter).toHaveBeenCalled();
      expect(api.getNovelOutline).toHaveBeenCalled();
      expect(api.getOutline).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run 'WorkspaceWizardPanel' 2>&1 | tail -30`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/wizard/WorkspaceWizardPanel.tsx
import { useEffect } from "react";
import api, { Concept, StoryDNA, World, CharacterSet, NovelOutline, Outline } from "../../api/client";
import { WizardProvider, useWizard, TOTAL_STEPS, type WizardData } from "./WizardContext";
import WizardSidebar from "./WizardSidebar";
import ConceptStep from "./ConceptStep";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import RegenerateStatusBadge from "./RegenerateStatusBadge";

interface Props { projectId: string }

const STEP_TITLES: Record<number, string> = {
  1: "创意发散", 2: "概念 DNA", 3: "世界观", 4: "角色设计",
  5: "地图系统", 6: "全文大纲", 7: "章节大纲",
};

function hasContent(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).some((x) => {
    if (x === null || x === undefined || x === "") return false;
    if (Array.isArray(x) && x.length === 0) return false;
    if (typeof x === "object" && Object.keys(x as object).length === 0) return false;
    return true;
  });
}

export default function WorkspaceWizardPanel({ projectId }: Props) {
  return (
    <WizardProvider projectId={projectId}>
      <Inner projectId={projectId} />
    </WizardProvider>
  );
}

function Inner({ projectId }: Props) {
  const wizard = useWizard();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cd, concept, world, chars, novel, outline] = await Promise.allSettled([
          api.getCreativeDivergencePrefill(projectId),
          api.getConcept(projectId),
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
        if (cd.status === "fulfilled" && cd.value.exists) {
          completed.push(1);
          // We don't have variant list here; the step component will reload
        }
        const conceptPayload = concept.status === "fulfilled" ? concept.value : null;
        if (conceptPayload && hasContent(conceptPayload)) {
          completed.push(2);
          const c = (conceptPayload as { concept?: Concept }).concept;
          const dna = (conceptPayload as { story_dna?: StoryDNA }).story_dna;
          if (c) data.concept = c;
          if (dna) data.story_dna = dna;
        }
        if (world.status === "fulfilled" && hasContent(world.value)) { completed.push(3); data.world = world.value as World; }
        if (chars.status === "fulfilled" && hasContent(chars.value)) { completed.push(4); data.characters = chars.value as CharacterSet; }
        if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(6); data.novel_outline = novel.value as NovelOutline; }
        if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(7); data.chapter1_outline = outline.value as Outline; }
        if (completed.length > 0) wizard.hydrateFromFiles(completed, data);
        else wizard.markPrefillComplete();
      } catch {
        if (!cancelled) wizard.markPrefillComplete();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="flex" style={{ minHeight: "calc(100vh - 64px)" }}>
      <WizardSidebar currentStep={wizard.currentStep} completedSteps={wizard.completedSteps}
                     onJump={(s) => wizard.jumpToStep(s)} />

      <div className="ml-[240px] flex-1 flex flex-col bg-background">
        <header className="flex items-center justify-between px-margin-desktop h-12 border-b border-outline-variant shrink-0">
          <h1 className="font-display text-primary text-lg">
            初始化向导 · <span className="text-primary-container">{STEP_TITLES[wizard.currentStep] ?? ""}</span>
          </h1>
          <span className="text-on-surface-variant text-xs">步骤 {wizard.currentStep} / {TOTAL_STEPS}</span>
        </header>

        <main className="flex-1 overflow-y-auto pt-xl px-margin-desktop pb-xl flex justify-center">
          <div className="w-full max-w-[800px] flex flex-col gap-lg">
            {wizard.currentStep === 1 && <CreativeDivergenceStep projectId={projectId} />}
            {wizard.currentStep === 2 && <ConceptStep projectId={projectId} />}
            {wizard.currentStep === 3 && <WorldStep projectId={projectId} />}
            {wizard.currentStep === 4 && <CharacterStep projectId={projectId} />}
            {wizard.currentStep === 5 && <MapStep />}
            {wizard.currentStep === 6 && <OutlineStep projectId={projectId} />}
            {wizard.currentStep === 7 && (
              <ChapterOutlineStep projectId={projectId} onFinish={() => { /* WorkspacePage handles tab switch */ }} />
            )}
          </div>
        </main>

        <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button data-testid="wizard-prev" type="button"
                    onClick={() => wizard.jumpToStep(Math.max(1, wizard.currentStep - 1))}
                    disabled={wizard.currentStep === 1}
                    className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40">
              上一步
            </button>
            {wizard.regenerateState.kind !== "idle" && (
              <RegenerateStatusBadge state={wizard.regenerateState} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {wizard.regenerateHandler && (
              <button data-testid="wizard-regenerate" type="button" onClick={wizard.regenerateHandler}
                      disabled={wizard.regenerateDisabled}
                      className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40">
                重新生成
              </button>
            )}
            {wizard.saveHandler && (
              <button data-testid="wizard-save" type="button" onClick={wizard.saveHandler}
                      disabled={wizard.saveDisabled}
                      className="px-4 py-2 text-sm bg-surface-container text-primary rounded-lg hover:bg-surface-container-low disabled:opacity-40">
                保存修改
              </button>
            )}
            {wizard.nextHandler && (
              <button data-testid="wizard-next" type="button" onClick={wizard.nextHandler}
                      disabled={wizard.nextDisabled}
                      className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40">
                确认修改并继续
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run 'WorkspaceWizardPanel' 2>&1 | tail -30`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/WorkspaceWizardPanel.tsx frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx
git commit -m "feat(wizard): WorkspaceWizardPanel sidebar+canvas (reuses WizardContext)"
```

---

## Task 10: `<WorkspaceTopBar>` adds tab switcher

**Files:**
- Modify: `frontend/src/components/workspace/WorkspaceTopBar.tsx`
- Test: `frontend/src/components/workspace/WorkspaceTopBar.test.tsx` (create)

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/workspace/WorkspaceTopBar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceTopBar from "./WorkspaceTopBar";

describe("WorkspaceTopBar tab switching", () => {
  const baseProps = {
    projectId: "proj_x", projectName: "测试", mode: "manual" as const,
    onModeChange: vi.fn(), onOpenPlaza: vi.fn(), onOpenConsole: vi.fn(),
    activeTab: "settings" as const, onTabChange: vi.fn(), manuscriptLocked: false,
  };

  it("renders 项目设定 / 正文手稿 tabs", () => {
    render(<WorkspaceTopBar {...baseProps} />);
    expect(screen.getByText("项目设定")).toBeInTheDocument();
    expect(screen.getByText("正文手稿")).toBeInTheDocument();
  });

  it("disables 正文手稿 when manuscriptLocked is true", () => {
    render(<WorkspaceTopBar {...baseProps} manuscriptLocked={true} />);
    expect(screen.getByText("正文手稿").closest("button")).toBeDisabled();
  });

  it("calls onTabChange when unlocked tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<WorkspaceTopBar {...baseProps} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("正文手稿"));
    expect(onTabChange).toHaveBeenCalledWith("manuscript");
  });

  it("does NOT call onTabChange when locked tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<WorkspaceTopBar {...baseProps} manuscriptLocked={true} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("正文手稿"));
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run 'WorkspaceTopBar' 2>&1 | tail -30`
Expected: FAIL — props `activeTab` / `onTabChange` / `manuscriptLocked` don't exist yet.

- [ ] **Step 3: Add tab nav to WorkspaceTopBar**

Open `frontend/src/components/workspace/WorkspaceTopBar.tsx`. Add to the props interface:

```ts
activeTab: "settings" | "manuscript";
onTabChange: (t: "settings" | "manuscript") => void;
manuscriptLocked: boolean;
```

Inside the JSX, between the left side (project name + mode switcher) and the right side (settings / AI tools / person icons), add:

```tsx
<nav className="flex items-center gap-6 font-body-md text-body-md ml-8">
  <button
    type="button"
    data-testid="topbar-tab-settings"
    onClick={() => onTabChange("settings")}
    className={`transition-colors ${activeTab === "settings" ? "text-primary font-semibold border-b-2 border-primary py-1" : "text-on-surface-variant hover:text-on-surface"}`}
  >
    项目设定
  </button>
  <button
    type="button"
    data-testid="topbar-tab-manuscript"
    disabled={manuscriptLocked}
    title={manuscriptLocked ? "完成所有项目设定后可进入正文手稿" : undefined}
    onClick={() => !manuscriptLocked && onTabChange("manuscript")}
    className={`transition-colors ${activeTab === "manuscript" ? "text-primary font-semibold border-b-2 border-primary py-1" : "text-on-surface-variant hover:text-on-surface"} ${manuscriptLocked ? "opacity-50 cursor-not-allowed" : ""}`}
  >
    正文手稿
  </button>
</nav>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run 'WorkspaceTopBar' 2>&1 | tail -30`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/WorkspaceTopBar.tsx frontend/src/components/workspace/WorkspaceTopBar.test.tsx
git commit -m "feat(workspace): TopBar adds 项目设定/正文手稿 tab switcher with lock"
```

---

## Task 11: Extract `<WorkspaceWritingPanel>` from `WorkspacePage`

**Files:**
- Create: `frontend/src/components/workspace/WorkspaceWritingPanel.tsx`
- Test: `frontend/src/components/workspace/WorkspaceWritingPanel.test.tsx` (smoke test only)

- [ ] **Step 1: Create the panel — copy from WorkspacePage**

This is a mechanical extraction. Open `frontend/src/pages/WorkspacePage.tsx` (current state, ~727 lines). Copy lines containing the manuscript-side rendering into a new file `frontend/src/components/workspace/WorkspaceWritingPanel.tsx`.

The new component's props:

```ts
interface Props {
  projectId: string;
  projectName: string;
  mode: "manual" | "managed";
  setMode: (m: "manual" | "managed") => void;
  reloadKey: number;
  setReloadKey: (k: number | ((k: number) => number)) => void;
}
```

Move into the panel:
- `chapters`, `manualChapters`, `novelOutline` state + their load effects (relocated to mount on `projectId` / `reloadKey`)
- `currentChapter`, `currentScene`, `sceneStatus`, `content`, `lastSavedContent`, `busy`
- `chapterStatus`, `volumeGroups`, `currentMaxChapter`, `plannedTotal` derived memos
- `initPreview`, `confirmOpen`, `confirmKind`, `takeOverChapter`, `pendingTargetMode`, `startOpen`, `plazaOpen`, `consoleOpen`, `addOpen`, `addProgress`
- handlers: `handleInit`, `confirmInit`, `handleModeChange`, `onDashboardChapterClick`, `onConfirmDrillDown`, `handleAddChapters`, `goToOutlinePanel`, `doRegenerate`
- All `useEffect` blocks that load: `sceneStatus` (`getSceneDrafts`), `projectName` removed (already in props), URL `?chapter=N&scene=M` sync, scene draft load, stage4 progress, outline, novel outline
- Render: `<WorkspaceLayout>` + modals

Keep in `WorkspacePage`:
- `WorkspaceTopBar`, `<WorkspaceWritingPanel>` / `<WorkspaceWizardPanel>` switch, `reloadKey` ownership, `activeTab` state, `manuscriptLocked` derivation

- [ ] **Step 2: Update `WorkspacePage.tsx` to use the new panel**

After extraction, `WorkspacePage.tsx` should:
- Hold `activeTab` state (defaulting per spec §4.5)
- Hold `reloadKey` state (passed into both panels)
- Render `<WorkspaceTopBar>` then either `<WorkspaceWizardPanel>` or `<WorkspaceWritingPanel>` based on `activeTab`

The WorkspaceWritingPanel is rendered with:

```tsx
<WorkspaceWritingPanel
  projectId={projectId}
  projectName={projectName}
  mode={mode}
  setMode={setMode}
  reloadKey={reloadKey}
  setReloadKey={setReloadKey}
/>
```

- [ ] **Step 3: Write a smoke test**

```tsx
// frontend/src/components/workspace/WorkspaceWritingPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceWritingPanel from "./WorkspaceWritingPanel";

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "测试项目" }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    getStage4Progress: vi.fn().mockResolvedValue({ chapters: [] }),
    getNovelOutline: vi.fn().mockResolvedValue(null),
    getSceneDraft: vi.fn().mockResolvedValue({ draft_text: "" }),
    getSceneDrafts: vi.fn().mockResolvedValue({ scenes: [] }),
  },
}));

describe("WorkspaceWritingPanel", () => {
  it("renders the 3-column layout with empty defaults", () => {
    render(
      <WorkspaceWritingPanel
        projectId="proj_x" projectName="测试" mode="manual"
        setMode={vi.fn()} reloadKey={0} setReloadKey={vi.fn()}
      />
    );
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- --run 'WorkspacePage|WorkspaceWritingPanel' 2>&1 | tail -30`
Expected: PASS. If existing `WorkspacePage.test.tsx` referenced internal state, update its assertions to target `<WorkspaceWritingPanel>` instead.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/WorkspaceWritingPanel.tsx frontend/src/components/workspace/WorkspaceWritingPanel.test.tsx frontend/src/pages/WorkspacePage.tsx
git commit -m "refactor(workspace): extract WorkspaceWritingPanel from WorkspacePage"
```

---

## Task 12: `<WorkspacePage>` slim + tab routing + default landing

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx`
- Test: `frontend/src/pages/WorkspacePage.test.tsx` (rewrite)

- [ ] **Step 1: Write failing test for tab routing**

```tsx
// frontend/src/pages/WorkspacePage.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import WorkspacePage from "./WorkspacePage";

vi.mock("../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "测试项目" }),
    getCreativeDivergencePrefill: vi.fn().mockResolvedValue({ exists: true, has_selection: true }),
    getConcept: vi.fn().mockResolvedValue({ concept: { title: "X", source: "creative_divergence" }, story_dna: {} }),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockResolvedValue({ volumes: [{ chapter_range: [1, 10] }] }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  },
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/project/:projectId/workspace" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkspacePage tab routing", () => {
  it("defaults to settings tab when no URL param and not all steps done", async () => {
    renderAt("/project/proj_x/workspace");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });

  it("forces settings when URL asks for manuscript but locked", async () => {
    renderAt("/project/proj_x/workspace?tab=manuscript");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });

  it("respects ?tab=settings in URL", async () => {
    renderAt("/project/proj_x/workspace?tab=settings");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run 'WorkspacePage' 2>&1 | tail -30`
Expected: FAIL — no `wizard-sidebar` testid exists.

- [ ] **Step 3: Rewrite WorkspacePage to host tabs**

The page should be ~150 lines. Skeleton:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";
import WorkspaceWritingPanel from "../components/workspace/WorkspaceWritingPanel";
import WorkspaceWizardPanel from "../components/wizard/WorkspaceWizardPanel";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";

const TAB_STORAGE_KEY = "storyforge.workspace.active-tab";

export default function WorkspacePage({ projectId: projectIdProp }: { projectId?: string } = {}) {
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, setMode } = useWorkspaceMode();

  const [projectName, setProjectName] = useState("加载中…");
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTabState] = useState<"settings" | "manuscript">("settings");
  const [allStepsDone, setAllStepsDone] = useState(false);
  const [plazaOpen, setPlazaOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);

  // load project name (404 → /)
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.getProjectStatus(projectId)
      .then((s) => { if (!cancelled && s?.title) setProjectName(s.title); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 404 || err?.status === 404) navigate("/", { replace: true });
      });
    return () => { cancelled = true; };
  }, [projectId, navigate]);

  // detect allStepsDone via preflight check
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [cd, c, w, ch, n, o] = await Promise.allSettled([
          api.getCreativeDivergencePrefill(projectId),
          api.getConcept(projectId),
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const done = [cd, c, w, ch, n, o].filter((r) => r.status === "fulfilled").length;
        // also require creative_divergence.has_selection for step 1
        const cdOk = cd.status === "fulfilled" && cd.value.has_selection;
        setAllStepsDone(done === 6 && cdOk);
      } catch {
        if (!cancelled) setAllStepsDone(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  // default landing tab logic
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested === "settings" || requested === "manuscript") {
      if (requested === "manuscript" && !allStepsDone) setActiveTabState("settings");
      else setActiveTabState(requested);
    } else {
      setActiveTabState(allStepsDone ? "manuscript" : "settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStepsDone]);

  const handleTabChange = (t: "settings" | "manuscript") => {
    if (t === "manuscript" && !allStepsDone) return;
    setActiveTabState(t);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* ignore */ }
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    setSearchParams(next, { replace: true });
  };

  return (
    <div data-testid="workspace-page" className="h-screen flex flex-col bg-canvas-bg">
      <WorkspaceTopBar
        projectId={projectId}
        projectName={projectName}
        mode={mode}
        onModeChange={setMode}
        onOpenPlaza={() => setPlazaOpen(true)}
        onOpenConsole={() => setConsoleOpen(true)}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        manuscriptLocked={!allStepsDone}
      />
      {activeTab === "settings" ? (
        <WorkspaceWizardPanel projectId={projectId} />
      ) : (
        <WorkspaceWritingPanel
          projectId={projectId}
          projectName={projectName}
          mode={mode}
          setMode={setMode}
          reloadKey={reloadKey}
          setReloadKey={setReloadKey}
        />
      )}

      <PromptPlazaModal
        isOpen={plazaOpen}
        projectId={projectId}
        projectTitle={projectName === "加载中…" ? null : projectName}
        onClose={() => setPlazaOpen(false)}
      />
      <AIConsoleModal isOpen={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- --run 'WorkspacePage' 2>&1 | tail -30`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/pages/WorkspacePage.test.tsx
git commit -m "refactor(workspace): WorkspacePage hosts tab switcher + default landing logic"
```

---

## Task 13: Trim `<ContextPanel>` to 2 tabs

**Files:**
- Modify: `frontend/src/components/workspace/ContextPanel.tsx`

- [ ] **Step 1: Inspect current tab list**

Open `frontend/src/components/workspace/ContextPanel.tsx`. Find the `tabs` array (or equivalent). Note the current order — likely 7 tabs: 概念 / 世界观 / 角色 / 大纲 / 章节大纲 / 诊断 / 导出.

- [ ] **Step 2: Reduce to 2 tabs**

Keep only "诊断" and "导出" entries. Delete the 5 editor entries + their imports. Remove the 5 editor imports (`ConceptEditor`, `WorldEditor`, `CharacterEditor`, `NovelOutlineEditor`, `ChapterOutlineEditor`) — they may no longer be needed elsewhere, but only delete if not imported by any other file (run `grep -r "ConceptEditor" frontend/src/` to verify).

- [ ] **Step 3: Remove `readOnly` prop**

In `ContextPanelProps`, delete the `readOnly` and `readOnlyReason` props. Adjust the call sites in `<WorkspaceWritingPanel>` (since the panel is now used only in writing mode where it should be readOnly when mode==="managed", wire that locally — easiest: have `<WorkspaceWritingPanel>` not pass `readOnly` and instead apply it to the actual children that read data).

Simplest path: keep `readOnly` as a prop on `<ContextPanel>` but only the 诊断 / 导出 children consume it; pass `readOnly={mode === "managed"}` from `<WorkspaceWritingPanel>`.

- [ ] **Step 4: Verify no consumer breaks**

Run: `cd frontend && npm test -- --run 'ContextPanel|WorkspaceWritingPanel|WorkspacePage' 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/ContextPanel.tsx
git commit -m "refactor(workspace): ContextPanel only 诊断/导出 tabs (5 editors removed)"
```

---

## Task 14: `<ConceptStep>` prefill source banner

**Files:**
- Modify: `frontend/src/components/wizard/ConceptStep.tsx`

- [ ] **Step 1: Locate concept state initialization**

Open `frontend/src/components/wizard/ConceptStep.tsx`. Find where the step reads `concept_and_dna.json.concept` into local state (likely in a `useEffect` after fetching from `api.getConcept`).

- [ ] **Step 2: Add source banner + locked-state UI**

After the existing step header, add:

```tsx
const fromCreativeDivergence = wizard.data.concept?.source === "creative_divergence";
{fromCreativeDivergence && (
  <div data-testid="concept-prefill-banner"
       className="px-md py-2 rounded-lg bg-primary-container/15 text-primary-container text-body-md flex items-center gap-xs">
    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
    由创意发散自动生成，可手动修改
  </div>
)}
```

Also add a `readOnly={fromCreativeDivergence}` (or visually grayed inputs — your call) to the title/genre/premise/tone/theme fields when `fromCreativeDivergence` is true.

- [ ] **Step 3: Reset source on manual edit**

In the existing `updateConcept` flow (the function that calls `api.updateConcept`), before sending the request, set `source: "manual"` so any subsequent user edit flips the source field.

- [ ] **Step 4: Verify tests**

Run: `cd frontend && npm test -- --run 'ConceptStep' 2>&1 | tail -30`
Expected: PASS. If existing tests assert specific input attributes, add a new test:

```tsx
it("renders banner when concept was prefilled from creative_divergence", () => {
  // mount with wizard.data.concept = { ..., source: "creative_divergence" }
  expect(screen.getByTestId("concept-prefill-banner")).toBeInTheDocument();
});
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/ConceptStep.tsx frontend/src/components/wizard/ConceptStep.test.tsx
git commit -m "feat(wizard): ConceptStep shows banner + locks inputs when prefilled from creative_divergence"
```

---

## Task 15: `<WizardDeepLinkPage>` redirect shell

**Files:**
- Modify: `frontend/src/pages/WizardDeepLinkPage.tsx`

- [ ] **Step 1: Write failing test**

If a test file exists for this page, modify it; otherwise create `frontend/src/pages/WizardDeepLinkPage.test.tsx`:

```tsx
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it } from "vitest";
import WizardDeepLinkPage from "./WizardDeepLinkPage";

describe("WizardDeepLinkPage", () => {
  it("redirects to /workspace?tab=settings", async () => {
    let pathname = "/init";
    render(
      <MemoryRouter initialEntries={["/project/proj_x/wizard"]}>
        <Routes>
          <Route path="/project/:projectId/wizard" element={<WizardDeepLinkPage />} />
          <Route path="/project/:projectId/workspace" element={<div>workspace here at {pathname}</div>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(window.location.search).toContain("tab=settings"));
    // Or assert via the mock route
  });
});
```

(If your project uses a different test pattern for routing, mirror existing wizard deep-link tests if any.)

- [ ] **Step 2: Replace file body**

```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function WizardDeepLinkPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (projectId) {
      navigate(`/project/${encodeURIComponent(projectId)}/workspace?tab=settings`, { replace: true });
    }
  }, [projectId, navigate]);
  return null;
}
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npm test -- --run 'WizardDeepLinkPage' 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/WizardDeepLinkPage.tsx frontend/src/pages/WizardDeepLinkPage.test.tsx
git commit -m "refactor(wizard): WizardDeepLinkPage redirects to /workspace?tab=settings"
```

---

## Task 16: Mark `InitWizardModal` and `WizardSteps` DEPRECATED

**Files:**
- Modify: `frontend/src/components/wizard/InitWizardModal.tsx`
- Modify: `frontend/src/components/wizard/WizardSteps.tsx`

- [ ] **Step 1: Add deprecation banner to InitWizardModal**

At the very top of `frontend/src/components/wizard/InitWizardModal.tsx`, add a comment block (after the imports):

```ts
// DEPRECATED — replaced by <WorkspaceWizardPanel>. Kept for backward-compatible
// imports in legacy code; no active route renders this modal as of v2.x.
// See docs/superpowers/specs/2026-08-30-workspace-wizard-design.md §3.3.
```

- [ ] **Step 2: Add deprecation banner to WizardSteps**

At the very top of `frontend/src/components/wizard/WizardSteps.tsx`:

```ts
// DEPRECATED — replaced by <WizardSidebar>. Kept for legacy reference.
```

- [ ] **Step 3: Verify no test imports InitWizardModal**

Run: `cd frontend && grep -r "InitWizardModal" src/`
Expected: no results in test files (or only in DEPRECATED comments).

- [ ] **Step 4: Run full frontend test suite**

Run: `cd frontend && npm test 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/InitWizardModal.tsx frontend/src/components/wizard/WizardSteps.tsx
git commit -m "chore(wizard): mark InitWizardModal + WizardSteps as DEPRECATED"
```

---

## Task 17: Manual smoke test

**Files:**
- (no code changes)

- [ ] **Step 1: Start backend + frontend**

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
cd frontend && npm run dev
```

- [ ] **Step 2: Verify HomePage → wizard flow**

- Open http://localhost:5173 → click "新建项目" → fill title → click "建档并进入工作台".
- Expected: URL is `/project/<id>/workspace?tab=settings`; sidebar shows 7 items; current item is "创意发散".

- [ ] **Step 3: Walk through all 7 steps**

- 创意发散: enter prompt, click 生成概念 → 4 cards → click card → click 确认选中并继续.
- 概念 DNA: verify banner shows + inputs are pre-filled.
- 世界观 / 角色设计 / 地图系统(跳过) / 全文大纲 / 章节大纲: click 确认修改并继续 after each.
- Expected: each step's tab in sidebar lights up; manuscript tab button enables after step 7.

- [ ] **Step 4: Verify tab switching**

- Click 正文手稿 → 3-column writing layout renders.
- Switch back to 项目设定 → sidebar + step content renders.
- Reload page → default landing should be 正文手稿 (all steps done).

- [ ] **Step 5: Verify /wizard route**

- Navigate to `/project/<id>/wizard` → expect instant redirect to `/workspace?tab=settings`.

- [ ] **Step 6: Verify INIT-stage project**

- Create a new project on HomePage → open it → expect default settings tab + 正文手稿 disabled.

- [ ] **Step 7: Verify ContextPanel**

- On manuscript tab → right panel has only 诊断 + 导出 tabs.

- [ ] **Step 8: Verify no regressions in existing wizard**

- On settings tab → click back to step 1 from step 5 → reload page → wizard resumes at step 5 (sessionStorage works).
- Run `pytest tests/test_wizard_*` → all pass.
- Run `cd frontend && npm test` → all pass.

- [ ] **Step 9: Document completion**

Append to `docs/wizard-inventory.md` a final section titled "## 9. Workspace 融合完成（2026-08-30）" with a 1-paragraph summary of the merge. (User-facing documentation update.)

- [ ] **Step 10: Final commit + push**

```bash
git add docs/wizard-inventory.md
git commit -m "docs(wizard): note Workspace 融合 completion in inventory"
git push origin nebula
```

---

## Self-review checklist (run before handoff)

- [ ] Spec coverage: §3 components → Tasks 6/7/8/9/11. §4 data flow → Tasks 4/5/14. §5 backend → Tasks 1/2. §6 error handling → Task 1 (validation) + Tasks 9/12 (UI failures). §7 testing → every Task has a test step. §8 file map → matches.
- [ ] Placeholder scan: no TBD / TODO / "implement later". Task 12 Step 3 hoists plaza/console modals to WorkspacePage so the topbar's `onOpenPlaza`/`onOpenConsole` props wire directly to `setPlazaOpen`/`setConsoleOpen`.
- [ ] Type consistency: `Variant` type defined in Task 8 reused in Task 9. `wizard.markStepGenerated(1, ...)` + `wizard.jumpToStep(2)` consistent across Tasks 8 and 9.
- [ ] Each commit is one logical change.
- [ ] No file appears in multiple non-related tasks (each task owns its files).
- [ ] InitWizardModal + WizardSteps marked DEPRECATED in Task 16 (not deleted) per spec §3.3.
- [ ] /wizard route preserved per user decision (Task 15 redirect).