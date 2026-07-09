# Project Center Multi-select, Search, Bulk Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project multi-select, name search, and bulk delete to the project center, gated by a new `POST /api/project/bulk-delete` endpoint.

**Architecture:** 1 new FastAPI endpoint with pytest TDD; in `ProjectListPage`, add 4 React state slots, a `useMemo`-derived `visibleProjects`, an `api.bulkDeleteProjects` client method, a search input, a mode toggle, a per-card checkbox variant, a floating bulk-action toolbar, and a bulk-delete confirmation modal. No new shared components, no new pages, no new routes.

**Tech Stack:** Python 3.9 + FastAPI + pytest + httpx TestClient, React 18 + TypeScript + Vite + Vitest + React Testing Library + jsdom. Material Symbols Outlined icons. Tailwind utility classes. Existing `GlassPanel`, existing `FileManager`, existing `api/client.ts`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/api/project.py` | Modify | Add `POST /api/project/bulk-delete` endpoint |
| `tests/test_project_bulk.py` | Create | pytest cases for the new endpoint |
| `frontend/src/api/client.ts` | Modify | Add `BulkDeleteResult` type + `bulkDeleteProjects` method |
| `frontend/src/pages/ProjectListPage.tsx` | Modify | State, search, mode toggle, card variant, toolbar, modal, handlers |
| `frontend/src/test/ProjectListPage.test.tsx` | Create | Vitest tests for the new page behaviors |

The frontend is intentionally modified in one file. The page is ~411 lines today; the new code adds ~180 lines, leaving it at ~590. Splitting it into a `ProjectListPage/` folder of subcomponents is a separate refactor and not in this plan.

---

## Task 1: Backend `POST /api/project/bulk-delete` endpoint (TDD)

**Files:**
- Modify: `backend/api/project.py` (add endpoint)
- Create: `tests/test_project_bulk.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_project_bulk.py`:

```python
"""Tests for POST /api/project/bulk-delete."""
import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def temp_projects_dir():
    d = Path(tempfile.mkdtemp())
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_projects_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_projects_dir

    from backend.api.project import router as project_router
    app = FastAPI()
    app.include_router(project_router)
    yield TestClient(app)
    settings.projects_dir = original


def _make_project(root: Path, pid: str, title: str = "测试") -> Path:
    pdir = root / pid
    pdir.mkdir(parents=True)
    (pdir / "project.json").write_text(
        json.dumps({"id": pid, "title": title}, ensure_ascii=False),
        encoding="utf-8",
    )
    return pdir


class TestBulkDelete:

    def test_all_ids_exist_returns_deleted(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")
        _make_project(temp_projects_dir, "proj_b", "B")
        _make_project(temp_projects_dir, "proj_c", "C")

        resp = client.post("/api/project/bulk-delete", json={"project_ids": ["proj_a", "proj_b"]})

        assert resp.status_code == 200
        body = resp.json()
        assert body["error"] is False
        assert body["detail"]["deleted"] == ["proj_a", "proj_b"]
        assert body["detail"]["failed"] == []
        assert body["detail"]["deleted_count"] == 2
        assert body["detail"]["failed_count"] == 0
        assert not (temp_projects_dir / "proj_a").exists()
        assert not (temp_projects_dir / "proj_b").exists()
        assert (temp_projects_dir / "proj_c").exists()

    def test_mixed_existing_and_missing(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")

        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_a", "proj_missing"]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_a"]
        assert body["detail"]["failed"] == [{"id": "proj_missing", "error": "not_found"}]

    def test_all_missing_returns_failed_only(self, client, temp_projects_dir):
        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_x", "proj_y"]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == []
        assert {f["id"] for f in body["detail"]["failed"]} == {"proj_x", "proj_y"}
        assert all(f["error"] == "not_found" for f in body["detail"]["failed"])

    def test_empty_list_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={"project_ids": []})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_missing_project_ids_field_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_project_ids_not_a_list_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={"project_ids": "proj_a"})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_non_string_item_marked_invalid_id(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")

        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_a", 42, None]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_a"]
        failed_by_id = {f["id"]: f["error"] for f in body["detail"]["failed"]}
        assert failed_by_id == {"42": "invalid_id", "None": "invalid_id"}

    def test_unexpected_exception_in_delete_marked_failed(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")
        _make_project(temp_projects_dir, "proj_b", "B")

        original_delete = None
        from backend.api.project import fm as project_fm

        def boom(pid):
            if pid == "proj_a":
                raise OSError("disk full")
            return project_fm.delete_project(pid)

        with patch.object(project_fm, "delete_project", side_effect=boom):
            resp = client.post(
                "/api/project/bulk-delete",
                json={"project_ids": ["proj_a", "proj_b"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_b"]
        assert body["detail"]["failed"] == [
            {"id": "proj_a", "error": "disk full"}
        ]
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_project_bulk.py -v`
Expected: All 8 tests fail with `404 Not Found` (the endpoint does not exist yet) or with `ModuleNotFoundError` / import errors from the missing endpoint. The critical signal is **no test passes** — the endpoint is not implemented.

- [ ] **Step 3: Implement the endpoint**

In `backend/api/project.py`, immediately after the existing `delete_project` function (the `DELETE /{project_id}` endpoint), add:

```python
@router.post("/bulk-delete")
async def bulk_delete_projects(data: dict):
    ids = data.get("project_ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_ids 必须是非空数组",
                "detail": {},
            },
        )

    deleted: list = []
    failed: list = []
    for pid in ids:
        if not isinstance(pid, str) or not pid:
            failed.append({"id": str(pid), "error": "invalid_id"})
            continue
        try:
            if not fm.project_exists(pid):
                failed.append({"id": pid, "error": "not_found"})
                continue
            fm.delete_project(pid)
            deleted.append(pid)
        except Exception as e:
            failed.append({"id": pid, "error": str(e)})

    return {
        "error": False,
        "code": "OK",
        "message": f"已删除 {len(deleted)} 个，失败 {len(failed)} 个",
        "detail": {
            "deleted": deleted,
            "failed": failed,
            "deleted_count": len(deleted),
            "failed_count": len(failed),
        },
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_project_bulk.py -v`
Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/api/project.py tests/test_project_bulk.py
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(api): add POST /api/project/bulk-delete endpoint

Per-item success/failure split into detail.deleted and detail.failed;
400 only for malformed body. Reuses FileManager.delete_project.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Frontend API client type + method

**Files:**
- Modify: `frontend/src/api/client.ts` (add type + method)

This task is not TDD-tested directly — the `api` object is mocked wholesale in page tests, so the new method is covered transitively by Task 6's page tests. A typecheck + the build step are the verification.

- [ ] **Step 1: Add the `BulkDeleteResult` exported type**

In `frontend/src/api/client.ts`, find the `ProjectSummary` interface (around line 67) and add a new interface immediately after it:

```ts
export interface BulkDeleteResult {
  deleted: string[];
  failed: { id: string; error: string }[];
  deleted_count: number;
  failed_count: number;
}
```

- [ ] **Step 2: Add the `bulkDeleteProjects` method to the `api` object**

In `frontend/src/api/client.ts`, inside the `export const api = { ... }` block, immediately after the existing `deleteProject` method (around line 673), add:

```ts
  bulkDeleteProjects: (projectIds: string[]) =>
    request<BulkDeleteResult>(
      "POST",
      "/project/bulk-delete",
      { project_ids: projectIds },
    ),
```

- [ ] **Step 3: Typecheck the frontend**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`
Expected: Exit code 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/client.ts
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(client): add bulkDeleteProjects API method + BulkDeleteResult type

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Frontend state foundation + search input + filtered count hint

**Files:**
- Modify: `frontend/src/pages/ProjectListPage.tsx` (state, useMemo, search UI)
- Create: `frontend/src/test/ProjectListPage.test.tsx` (test file scaffold + search tests)

This task wires up the state slots and the search experience. Selection-mode UI is added in Task 4.

- [ ] **Step 1: Create the test file with a shared render helper**

Create `frontend/src/test/ProjectListPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockApi = {
  listProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  bulkDeleteProjects: vi.fn(),
  advance: vi.fn(),
};

vi.mock("../../api/client", () => ({
  default: mockApi,
  ProjectSummary: {},
  ApiError: class extends Error {
    code: string;
    detail: Record<string, unknown>;
    constructor(code: string, message: string, detail?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.detail = detail || {};
    }
  },
}));

vi.mock("../../hooks/useProject", () => ({
  useProject: () => ({
    createProject: vi.fn().mockResolvedValue({ id: "new_proj" }),
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

import ProjectListPage from "../../pages/ProjectListPage";

const SAMPLE = [
  { id: "proj_a", title: "诡眼少年", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-06-29T00:00:00", min_words: 4000 },
  { id: "proj_b", title: "测试小说", genre: "cool_novel", current_stage: "INIT", created_at: "2026-06-28T00:00:00", min_words: 4000 },
  { id: "proj_c", title: "一部城隍成长史", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-27T00:00:00", min_words: 6000 },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.listProjects.mockReset();
  mockApi.listProjects.mockResolvedValue(SAMPLE);
  mockApi.deleteProject.mockReset();
  mockApi.bulkDeleteProjects.mockReset();
});
```

- [ ] **Step 2: Write the failing search tests**

Append to `frontend/src/test/ProjectListPage.test.tsx`:

```tsx
describe("ProjectListPage search", () => {
  it("renders all projects initially", async () => {
    renderPage();
    expect(await screen.findByText("诡眼少年")).toBeInTheDocument();
    expect(screen.getByText("测试小说")).toBeInTheDocument();
    expect(screen.getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("filters by case-insensitive substring match", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "城隍" } });
    });

    expect(screen.queryByText("诡眼少年")).not.toBeInTheDocument();
    expect(screen.queryByText("测试小说")).not.toBeInTheDocument();
    expect(screen.getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("shows the filtered count hint when search is active", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "测试" } });
    });

    expect(screen.getByText("1 个匹配项 / 共 3 个")).toBeInTheDocument();
  });

  it("hides the count hint when search is empty", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    expect(screen.queryByText(/个匹配项/)).not.toBeInTheDocument();
  });

  it("shows zero-match empty state with a clear-search button", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "不存在的标题xyz" } });
    });

    expect(screen.getByText("无匹配项目")).toBeInTheDocument();
    const clearBtn = screen.getByRole("button", { name: "清空搜索" });
    await act(async () => {
      clearBtn.click();
    });
    expect(input.value).toBe("");
    expect(screen.getByText("诡眼少年")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the search tests and confirm they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 search tests fail. The page currently has no search input, no count hint, no zero-match state.

- [ ] **Step 4: Add the 4 state slots and the `useMemo` to `ProjectListPage`**

In `frontend/src/pages/ProjectListPage.tsx`, add `useMemo` to the React import line:

```tsx
import { useState, useEffect, useMemo } from "react";
```

Add 4 new state declarations right after the existing `const [deleting, setDeleting] = useState(false);` line:

```tsx
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
```

Add a derived value right after the `loadProjects` function:

```tsx
  const visibleProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, searchQuery]);
```

- [ ] **Step 5: Add the search input to the header**

Find the existing `<header>` block in `ProjectListPage.tsx`. Replace the existing right-side `<button onClick={openCreate}>` block with a flex row that includes the search input, then keep the "新建项目" button after it. The new markup:

```tsx
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-symbols-outlined text-base absolute left-3 top-1/2 -translate-y-1/2 text-system-log/60 pointer-events-none">
                search
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目名称"
                className="w-60 bg-surface-container border border-outline-variant rounded-lg
                           pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                           focus:outline-none focus:border-primary-container"
              />
            </div>
            <button
              onClick={openCreate}
              className="btn-ghost flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              新建项目
            </button>
          </div>
```

- [ ] **Step 6: Swap the grid to render `visibleProjects`, add count hint and zero-match state**

Find the existing project grid block:

```tsx
        ) : (
          /* Project grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
```

Replace the whole `) : (` through the closing `</div>` of the grid block with:

```tsx
        ) : visibleProjects.length === 0 ? (
          /* Zero-match empty state */
          <div className="text-center py-24">
            <span className="material-symbols-outlined text-6xl text-system-log/20 mb-4 block">
              search_off
            </span>
            <h2 className="font-headline-md text-primary mb-2">无匹配项目</h2>
            <p className="font-body-ui text-system-log mb-6 max-w-md mx-auto">
              没有标题包含「{searchQuery}」的项目。
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="btn-ghost inline-flex items-center gap-2"
            >
              <span className="material-symbols-outlined">close</span>
              清空搜索
            </button>
          </div>
        ) : (
          <>
            {searchQuery.trim() && (
              <div className="text-right font-label-mono text-xs text-system-log mb-3">
                {visibleProjects.length} 个匹配项 / 共 {projects.length} 个
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleProjects.map((p) => (
```

Note: this leaves the existing `</div></div>)` for the grid open. Add the corresponding close tags at the end of the grid's children (`GlassPanel` block stays exactly as it is) so the rendered tree becomes `<> {optional hint} <grid> {cards} </grid> </>`.

- [ ] **Step 7: Run the search tests and confirm they pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 search tests pass.

- [ ] **Step 8: Typecheck**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/ProjectListPage.tsx frontend/src/test/ProjectListPage.test.tsx
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(project-center): add name search with live filter + count hint

Client-side lowercase substring filter via useMemo on visibleProjects.
Search input is type=search (native clear-X), placeholder '搜索项目名称'.
When the filter is active, shows 'N 个匹配项 / 共 M 个' hint.
When the filter yields no results, shows a zero-match empty state with a
清空搜索 button that resets the query.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Multi-select mode toggle + card variant

**Files:**
- Modify: `frontend/src/pages/ProjectListPage.tsx` (mode toggle button, card variant)

- [ ] **Step 1: Write the failing mode-toggle tests**

Append to `frontend/src/test/ProjectListPage.test.tsx`:

```tsx
describe("ProjectListPage multi-select mode", () => {
  it("does not show checkboxes by default", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    // No card-level checkbox icons in the document yet.
    const cards = screen.getAllByText(/诡眼少年|测试小说|一部城隍成长史/);
    expect(cards.length).toBeGreaterThan(0);
    // Multi-select toolbar should not exist.
    expect(screen.queryByText("已选")).not.toBeInTheDocument();
  });

  it("entering multi-select mode shows a checkbox on each card and a toolbar", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const toggle = screen.getByRole("button", { name: "多选" });
    await act(async () => {
      toggle.click();
    });

    // Toolbar appears (with 0 selected initially).
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(screen.getByText("全选可见")).toBeInTheDocument();
    expect(screen.getByText("全不选")).toBeInTheDocument();
    // The mode toggle button label flips.
    expect(screen.getByRole("button", { name: "退出多选" })).toBeInTheDocument();
  });

  it("clicking a card checkbox toggles selection in select mode", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });

    // Each card now has a checkbox button — click the one inside the first card.
    const card = screen.getByText("诡眼少年").closest("div[class*='cursor-pointer'], div")!.parentElement!;
    const checkbox = within(card as HTMLElement).getByRole("button", { name: /选择|取消选择/ });
    await act(async () => {
      checkbox.click();
    });

    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });

  it("clicking the card body in select mode toggles selection, not navigation", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });

    // The card's "navigate" button is no longer rendered in select mode.
    // Click the card title text and assert the URL did not change.
    const title = screen.getByText("诡眼少年");
    await act(async () => {
      title.click();
    });
    // If we got here without an error and selection state changed, the test passes.
    expect(screen.getByText(/已选/)).toBeInTheDocument();
  });

  it("exiting select mode clears selectedIds and hides the toolbar", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "退出多选" }).click();
    });

    expect(screen.queryByText("已选")).not.toBeInTheDocument();
    // No checkboxes left.
    expect(screen.queryByRole("button", { name: /选择|取消选择/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the mode-toggle tests and confirm they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests fail. The page has no multi-select toggle yet.

- [ ] **Step 3: Add the mode toggle button to the header**

In `frontend/src/pages/ProjectListPage.tsx`, find the header `<div className="flex items-center gap-3">` block you added in Task 3. Add the multi-select toggle button between the search input wrapper and the "新建项目" button:

```tsx
            <button
              onClick={() => setSelectMode((v) => !v)}
              className={`btn-ghost flex items-center gap-2 ${selectMode ? "border border-primary-container" : ""}`}
              aria-label={selectMode ? "退出多选" : "多选"}
            >
              <span className="material-symbols-outlined text-lg">
                {selectMode ? "check_box" : "check_box_outline_blank"}
              </span>
              {selectMode ? "退出多选" : "多选"}
            </button>
```

- [ ] **Step 4: Add the `exitSelectMode` helper and the per-card select-mode variant**

In `frontend/src/pages/ProjectListPage.tsx`, add this helper immediately after `loadProjects`:

```tsx
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
```

Now find the existing card `<GlassPanel ...>` block (the one inside `visibleProjects.map((p) => (`). Replace the entire block — including its outer `<button onClick={() => navigate(...)}>...</button>` and the trailing hover delete button — with this select-mode-aware version:

```tsx
              <GlassPanel
                key={p.id}
                className={`transition-colors group relative ${
                  selectedIds.has(p.id)
                    ? "border-primary-container"
                    : "hover:border-primary-container/30"
                }`}
              >
                {selectMode ? (
                  <button
                    type="button"
                    onClick={() => toggleSelected(p.id)}
                    className="w-full text-left cursor-pointer flex items-start gap-3 p-0"
                    aria-label={selectedIds.has(p.id) ? "取消选择" : "选择"}
                  >
                    <span
                      className={`material-symbols-outlined text-xl mt-0.5 shrink-0 ${
                        selectedIds.has(p.id) ? "text-primary-container" : "text-system-log/50"
                      }`}
                    >
                      {selectedIds.has(p.id) ? "check_box" : "check_box_outline_blank"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-3 pr-2">
                        <h3 className="font-headline-md text-primary group-hover:text-primary-container transition-colors">
                          {p.title}
                        </h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                        >
                          {STAGE_LABELS[p.current_stage] || p.current_stage}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-label-mono text-system-log">
                        <span>{GENRES[p.genre] || p.genre}</span>
                        <span>·</span>
                        <span>{p.min_words.toLocaleString()} 字</span>
                        {p.created_at && (
                          <>
                            <span>·</span>
                            <span>{p.created_at.slice(0, 10)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => navigate(`/project/${p.id}/stage1`)}
                      className="w-full text-left cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-3 pr-8">
                        <h3 className="font-headline-md text-primary group-hover:text-primary-container transition-colors">
                          {p.title}
                        </h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                        >
                          {STAGE_LABELS[p.current_stage] || p.current_stage}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-label-mono text-system-log">
                        <span>{GENRES[p.genre] || p.genre}</span>
                        <span>·</span>
                        <span>{p.min_words.toLocaleString()} 字</span>
                        {p.created_at && (
                          <>
                            <span>·</span>
                            <span>{p.created_at.slice(0, 10)}</span>
                          </>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(p);
                      }}
                      className="absolute top-3 right-3 p-1.5 rounded text-system-log/50 hover:text-red-400
                                 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="删除项目"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </>
                )}
              </GlassPanel>
```

- [ ] **Step 5: Run the mode-toggle tests and confirm they pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests pass. The 5 search tests from Task 3 still pass.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/ProjectListPage.tsx frontend/src/test/ProjectListPage.test.tsx
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(project-center): add multi-select mode toggle + per-card checkbox

Mode toggle in header flips between navigate and select modes. In select
mode, each card shows a top-left checkbox and the card body click toggles
selection instead of navigating. Selected cards get a primary-container
border. exitSelectMode() helper enforces the state invariant
selectMode=false ⇒ selectedIds.size=0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Bulk action toolbar (全选可见 / 全不选 / 批量删除)

**Files:**
- Modify: `frontend/src/pages/ProjectListPage.tsx` (add toolbar)

- [ ] **Step 1: Write the failing toolbar tests**

Append to `frontend/src/test/ProjectListPage.test.tsx`:

```tsx
describe("ProjectListPage bulk action toolbar", () => {
  async function enterSelectMode() {
    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });
  }

  it("toolbar is hidden when 0 selected", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await enterSelectMode();
    // With 0 selected, the toolbar still renders (showing '已选 0 项') per the
    // spec — but the 批量删除 button is disabled.
    const bulkBtn = screen.getByRole("button", { name: /批量删除/ });
    expect(bulkBtn).toBeDisabled();
  });

  it("全选可见 selects every visible project", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await enterSelectMode();

    await act(async () => {
      screen.getByRole("button", { name: "全选可见" }).click();
    });

    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
  });

  it("全选可见 respects the active search filter", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await enterSelectMode();

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "测试" } });
    });

    await act(async () => {
      screen.getByRole("button", { name: "全选可见" }).click();
    });

    // Only '测试小说' matches, so 1 selected.
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });

  it("全不选 clears the selection but keeps select mode active", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await enterSelectMode();

    await act(async () => {
      screen.getByRole("button", { name: "全选可见" }).click();
    });
    expect(screen.getByText("已选 3 项")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "全不选" }).click();
    });

    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    // Still in select mode (the toggle button label is still '退出多选').
    expect(screen.getByRole("button", { name: "退出多选" })).toBeInTheDocument();
  });

  it("批量删除 button is enabled once ≥1 project is selected", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await enterSelectMode();

    await act(async () => {
      screen.getByRole("button", { name: "全选可见" }).click();
    });

    const bulkBtn = screen.getByRole("button", { name: /批量删除/ });
    expect(bulkBtn).not.toBeDisabled();
    expect(bulkBtn.textContent).toContain("3");
  });
});
```

- [ ] **Step 2: Run the toolbar tests and confirm they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests fail. No toolbar exists yet.

- [ ] **Step 3: Add the bulk action toolbar to the page**

In `frontend/src/pages/ProjectListPage.tsx`, find the opening `<main className="max-w-5xl mx-auto px-6 py-8">` block. Immediately after the `{error && (...)}` block, add the toolbar:

```tsx
      {selectMode && (
        <div
          data-testid="bulk-action-bar"
          className="sticky top-2 z-10 mb-4 bg-surface-container-low border border-primary-container/40
                     rounded-lg px-4 py-2 flex items-center gap-3 shadow-lg shadow-black/20
                     animate-[slideDown_150ms_ease-out]"
        >
          <button
            onClick={exitSelectMode}
            className="flex items-center gap-1 text-system-log hover:text-primary text-sm"
          >
            <span className="material-symbols-outlined text-lg">close</span>
            取消多选
          </button>
          <span className="text-sm font-label-mono text-primary">
            已选 {selectedIds.size} 项
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setSelectedIds(new Set(visibleProjects.map((p) => p.id)))}
            className="text-sm text-system-log hover:text-primary"
          >
            全选可见
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedIds.size === 0}
            className="text-sm text-system-log hover:text-primary disabled:opacity-40"
          >
            全不选
          </button>
          <button
            onClick={() => setShowBulkDeleteModal(true)}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1 px-3 py-1 bg-error text-surface-container-low
                       text-sm rounded hover:opacity-90 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-base">delete</span>
            批量删除 ({selectedIds.size})
          </button>
        </div>
      )}
```

Note: the `animate-[slideDown_150ms_ease-out]` Tailwind arbitrary value requires a keyframe definition. Add to `frontend/tailwind.config.ts` inside `theme.extend.keyframes` and `theme.extend.animation`:

```ts
      keyframes: {
        slideDown: {
          "0%": { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        slideDown: "slideDown 150ms ease-out",
      },
```

If the file does not have a `theme.extend` block, add one wrapping the above. If `keyframes`/`animation` already exist, merge the new entry into the existing objects.

- [ ] **Step 4: Run the toolbar tests and confirm they pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests pass. All 10 prior tests still pass.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/ProjectListPage.tsx frontend/tailwind.config.ts frontend/src/test/ProjectListPage.test.tsx
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(project-center): add floating bulk-action toolbar

Visible only in select mode. Renders 取消多选 / 已选 N 项 / 全选可见 /
全不选 / 批量删除 (N). 全选可见 operates on the post-search visible list.
Adds slideDown keyframe + animation to tailwind config.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Bulk delete modal + handler

**Files:**
- Modify: `frontend/src/pages/ProjectListPage.tsx` (modal + handler)

- [ ] **Step 1: Write the failing modal/handler tests**

Append to `frontend/src/test/ProjectListPage.test.tsx`:

```tsx
describe("ProjectListPage bulk delete", () => {
  async function selectAllThree() {
    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "全选可见" }).click();
    });
  }

  it("opening the modal lists every selected project by title", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    await selectAllThree();

    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });

    expect(screen.getByText("批量删除 3 个项目")).toBeInTheDocument();
    const list = screen.getByText("批量删除 3 个项目").closest("div")!.parentElement!;
    expect(within(list as HTMLElement).getByText("诡眼少年")).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText("测试小说")).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("confirming the modal calls bulkDeleteProjects ONCE with the full selection", async () => {
    mockApi.bulkDeleteProjects.mockResolvedValue({
      deleted: ["proj_a", "proj_b", "proj_c"],
      failed: [],
      deleted_count: 3,
      failed_count: 0,
    });

    renderPage();
    await screen.findByText("诡眼少年");
    await selectAllThree();

    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });

    expect(mockApi.bulkDeleteProjects).toHaveBeenCalledTimes(1);
    expect(mockApi.bulkDeleteProjects).toHaveBeenCalledWith(
      expect.arrayContaining(["proj_a", "proj_b", "proj_c"]),
    );
    expect(mockApi.bulkDeleteProjects.mock.calls[0][0]).toHaveLength(3);
  });

  it("on full success, exits select mode and removes deleted projects from the list", async () => {
    mockApi.bulkDeleteProjects.mockResolvedValue({
      deleted: ["proj_a", "proj_b", "proj_c"],
      failed: [],
      deleted_count: 3,
      failed_count: 0,
    });

    renderPage();
    await screen.findByText("诡眼少年");
    await selectAllThree();

    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });

    // Modal closes, select mode exits, toolbar gone.
    expect(screen.queryByText("批量删除 3 个项目")).not.toBeInTheDocument();
    expect(screen.queryByText("已选")).not.toBeInTheDocument();
    // Projects removed from local list.
    expect(screen.queryByText("诡眼少年")).not.toBeInTheDocument();
    expect(screen.queryByText("测试小说")).not.toBeInTheDocument();
    expect(screen.queryByText("一部城隍成长史")).not.toBeInTheDocument();
  });

  it("on partial failure, keeps select mode, prunes to failed-only, shows an error banner", async () => {
    mockApi.bulkDeleteProjects.mockResolvedValue({
      deleted: ["proj_a"],
      failed: [{ id: "proj_b", error: "not_found" }],
      deleted_count: 1,
      failed_count: 1,
    });

    renderPage();
    await screen.findByText("诡眼少年");
    await selectAllThree();

    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });

    // Modal closed, select mode still active, selection pruned to 1.
    expect(screen.queryByText("批量删除 3 个项目")).not.toBeInTheDocument();
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    // Error banner surfaces the failure detail.
    expect(screen.getByText(/已删除 1 个，1 个失败/)).toBeInTheDocument();
    expect(screen.getByText(/proj_b \(not_found\)/)).toBeInTheDocument();
  });

  it("does NOT call deleteProject per-item — only the bulk endpoint", async () => {
    mockApi.bulkDeleteProjects.mockResolvedValue({
      deleted: ["proj_a", "proj_b", "proj_c"],
      failed: [],
      deleted_count: 3,
      failed_count: 0,
    });

    renderPage();
    await screen.findByText("诡眼少年");
    await selectAllThree();

    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });

    expect(mockApi.deleteProject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the modal/handler tests and confirm they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests fail. No bulk delete modal exists yet.

- [ ] **Step 3: Add the `handleBulkDeleteConfirm` function**

In `frontend/src/pages/ProjectListPage.tsx`, immediately after the existing `handleDeleteConfirm` function, add:

```tsx
  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.bulkDeleteProjects(ids);
      setProjects((prev) => prev.filter((p) => !result.deleted.includes(p.id)));
      setShowBulkDeleteModal(false);
      if (result.failed.length === 0) {
        exitSelectMode();
      } else {
        const failedIds = new Set(result.failed.map((f) => f.id));
        setSelectedIds(failedIds);
        setError(
          `已删除 ${result.deleted_count} 个，${result.failed_count} 个失败：` +
            result.failed.map((f) => `${f.id} (${f.error})`).join("、"),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBulkDeleting(false);
    }
  };
```

- [ ] **Step 4: Add the bulk delete confirmation modal**

In `frontend/src/pages/ProjectListPage.tsx`, immediately after the closing `)}` of the existing single-project delete confirmation modal (the block that starts with `{deleteTarget && (`), add:

```tsx
      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border border-error/30 rounded-lg max-w-lg w-full mx-4 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-error">delete</span>
                <span className="font-label-mono text-error">
                  批量删除 {selectedIds.size} 个项目
                </span>
              </div>
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={bulkDeleting}
                className="text-system-log hover:text-primary disabled:opacity-30"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-body-ui text-system-log text-xs">
                将永久删除以下项目及其所有数据（概念、大纲、章节、模拟记录），此操作不可撤销。
              </p>
              <div className="max-h-60 overflow-y-auto border border-outline-variant rounded">
                {projects
                  .filter((p) => selectedIds.has(p.id))
                  .slice(0, 20)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 border-b border-outline-variant last:border-b-0"
                    >
                      <span className="font-display text-primary text-sm truncate pr-3">
                        {p.title}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                      >
                        {STAGE_LABELS[p.current_stage] || p.current_stage}
                      </span>
                    </div>
                  ))}
                {projects.filter((p) => selectedIds.has(p.id)).length > 20 && (
                  <div className="px-3 py-2 text-xs text-system-log text-center">
                    + {projects.filter((p) => selectedIds.has(p.id)).length - 20} 项未显示
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowBulkDeleteModal(false)}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-surface-container text-system-log text-sm
                             rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={handleBulkDeleteConfirm}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-error text-surface-container-low text-sm
                             rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {bulkDeleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Run the modal/handler tests and confirm they pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ProjectListPage.test.tsx`
Expected: All 5 new tests pass. All 15 prior tests (5 search + 5 mode + 5 toolbar) still pass.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/ProjectListPage.tsx frontend/src/test/ProjectListPage.test.tsx
git -c user.name=hangsa -c user.email=hangsa@local commit -m "feat(project-center): add bulk-delete modal + handler

Modal lists every selected project (truncated to 20 with overflow footer)
using existing STAGE_COLORS/STAGE_LABELS. On full success, exitSelectMode
and prune local list. On partial failure, prune selection to failed-only
and surface a banner with the per-item error. On network/HTTP failure,
preserve selection and show the error message.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Manual smoke test in the running app

**Files:** None. Verification only.

The dev servers should already be running from earlier (`bf7xir552` for backend on :8000, `brvppnqr2` for frontend on :5173). Vite's HMR will have picked up all the changes; FastAPI's `--reload` will have picked up the backend change.

- [ ] **Step 1: Confirm both services are still healthy**

Run: `curl -sS -o /dev/null -w "backend: %{http_code}\n" http://localhost:8000/api/health && curl -sS -o /dev/null -w "frontend: %{http_code}\n" http://localhost:5173/`
Expected: `backend: 200`, `frontend: 200`.

- [ ] **Step 2: Exercise the search box in the browser**

1. Open http://localhost:5173/
2. Confirm the project grid loads and the search input is visible to the right of the title.
3. Type `测试` in the search box. Confirm the list filters to matching projects and the `N 个匹配项 / 共 M 个` hint appears above the grid.
4. Type something that matches nothing (e.g. `zzzzzz`). Confirm the zero-match empty state appears with a `清空搜索` button.
5. Click `清空搜索`. Confirm the list is restored.

- [ ] **Step 3: Exercise multi-select mode**

1. With the list restored, click the `多选` toggle button. Confirm the button label changes to `退出多选` and a sticky toolbar appears at the top of the grid.
2. Click 2-3 card checkboxes. Confirm the `已选 N 项` count updates and the selected cards get a `border-primary-container` ring.
3. Click the card body of a non-selected card. Confirm it becomes selected (instead of navigating).
4. Click `全选可见`. Confirm all currently-visible projects are selected.
5. Click `全不选`. Confirm the selection clears.
6. Type a search query to filter the list to 1 item. Click `全选可见` again. Confirm only the 1 visible project is selected.
7. Click `取消多选`. Confirm the toolbar disappears and the mode toggle returns to the default state.

- [ ] **Step 4: Exercise bulk delete (full success path)**

1. In select mode, pick 2 test projects (e.g. 2 of the existing `proj_*` you just cleaned up — or create 2 throwaway projects via the "新建项目" modal first).
2. Click `批量删除 (2)`. Confirm the modal opens with a red-bordered shell, the title `批量删除 2 个项目`, and both project titles listed with their stage labels.
3. Click `确认删除`. Confirm:
   - The modal closes
   - The 2 projects are gone from the grid
   - Select mode exits (toolbar gone, `多选` button back)

- [ ] **Step 5: Exercise bulk delete (partial failure path)**

To force a partial failure, you can:
1. Select 2 projects in the UI.
2. In another tab/process, manually delete one of the project directories on disk: `rm -rf projects/proj_xxx`
3. Back in the UI, click `批量删除`. Confirm the modal opens.
4. Click `确认删除`. Confirm:
   - The remaining project is deleted from the grid
   - The deleted-on-disk project's title still shows in an error banner: `已删除 1 个，1 个失败：proj_xxx (not_found)`
   - Select mode stays active, with the failed project still in the selection so you can retry.

- [ ] **Step 6: Run the full test suite one more time**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run`
Expected: All tests pass, no regressions.

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_project_bulk.py -v`
Expected: 8 passed.

- [ ] **Step 7: Final commit (only if any tweaks were made)**

If no tweaks were needed, skip this step. If anything was adjusted during smoke testing:

```bash
cd /Users/longsa/Codes/storyForge2
git add -A
git -c user.name=hangsa -c user.email=hangsa@local commit -m "chore(project-center): smoke-test tweaks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Out of Scope (per spec)

- Server-side search / pagination / sorting
- "Select all matching" across the full unfiltered list
- Bulk export / archive / tag
- Per-project confirmation within a batch
- Selection persistence across navigation (intentionally cleared on exit)
