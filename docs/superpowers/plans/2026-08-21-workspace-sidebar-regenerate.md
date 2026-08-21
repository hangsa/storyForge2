# 工作区右侧栏重新生成支持 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 workspace 右侧栏 5 个 tab（概念/世界观/角色/大纲/章节大纲）上为每个 section 添加 AI 重新生成按钮，沿用 wizard 的后端端点（章节大纲除外，新增端点）。

**Architecture:** 后端在 stage3 新增 `POST /stage3/regenerate-chapter-outline` 区间端点；其他 5 个 wizard regenerate 端点零修改。前端把 `SectionRegenerateButton` 解耦 wizard context（加可选 `statusReporter` prop），5 个 workspace 编辑器按 section 摆放 ↻ 按钮；章节大纲用新建的 `ChapterRangeRegenerateModal` 收 start/end。乐观刷新（API 响应 detail 直接 setState），不触发 reloadKey。`readOnly === true` 时隐藏按钮。

**Tech Stack:** Python 3.9 + FastAPI + Pydantic dataclass + pytest-asyncio；React 18 + TypeScript + vitest + React Testing Library。

**Spec:** `docs/superpowers/specs/2026-08-21-workspace-sidebar-regenerate-design.md`

---

## File Structure

**新增文件：**
- `tests/test_chapter_outline_regenerate.py` — 后端新端点测试
- `frontend/src/components/workspace/editors/ChapterRangeRegenerateModal.tsx` — 章节大纲区间 modal
- `frontend/src/test/ChapterRangeRegenerateModal.test.tsx` — modal 测试
- `frontend/src/test/ConceptEditor.workspace.test.tsx` — 概念编辑器 regenerate 测试
- `frontend/src/test/WorldEditor.workspace.test.tsx` — 世界观编辑器 regenerate 测试
- `frontend/src/test/NovelOutlineEditor.workspace.test.tsx` — 大纲编辑器 regenerate 测试

**修改文件：**
- `backend/api/stage3_outline.py` — 新增 `regenerate_chapter_outline` 端点
- `frontend/src/api/client.ts` — 新增 `regenerateChapterOutlineRange`
- `frontend/src/test/client.test.ts` — 新增 client 测试
- `frontend/src/components/shared/SectionRegenerateButton.tsx` — 加 `statusReporter` prop
- `frontend/src/test/SectionRegenerateButton.test.tsx` — 加新路径测试
- `frontend/src/components/workspace/editors/ConceptEditor.tsx` — 加2 个 ↻
- `frontend/src/components/workspace/editors/WorldEditor.tsx` — 加 section ↻
- `frontend/src/components/workspace/editors/CharacterEditor.tsx` — 加 section ↻
- `frontend/src/components/workspace/editors/NovelOutlineEditor.tsx` — 加 section ↻
- `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx` — 加 range 按钮 + modal
- `frontend/src/test/ChapterOutlineEditor.test.tsx` — 加 range 按钮测试
- `frontend/src/test/CharacterEditor.workspace.test.tsx` — 加 regenerate 测试

---

## Task 1: 后端 — 新增 `POST /stage3/regenerate-chapter-outline` 端点

**Files:**
- Modify: `backend/api/stage3_outline.py`（在 `regenerate_novel_outline_section` 后追加，约 line 423 之后）
- Create: `tests/test_chapter_outline_regenerate.py`

- [ ] **Step 1: 写失败测试 — happy path（单章重生）**

创建 `tests/test_chapter_outline_regenerate.py`：

```python
"""Tests for the chapter-outline range regenerate endpoint.

This endpoint regenerates chapters in outline.json for the workspace
sidebar (v2.1+). It does NOT gate on STAGE_ORDER — workspace projects
have already completed the wizard.
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def projects_dir(tmp_path, monkeypatch):
    d = tmp_path / "projects"
    d.mkdir()
    monkeypatch.setattr("backend.config.settings.projects_dir", d)
    return d


@pytest.fixture
def client():
    return TestClient(app)


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed(projects_dir, proj_id, planned_total=10):
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id, "title": "测试", "genre": "cool_novel",
        "min_words": 4000, "current_stage": "STAGE4",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试", "premise": "p"},
        "story_dna": {"core_contradiction": {"statement": "s"}},
    })
    _write_json(projects_dir, proj_id, "world.json", {"era": "异世界"})
    _write_json(projects_dir, proj_id, "characters.json", {"characters": []})
    _write_json(projects_dir, proj_id, "novel_outline.json", {
        "core_conflict": "x",
        "volumes": [{"volume_number": 1, "title": "v1", "chapter_range": [1, planned_total]}],
        "mc_growth": [],
        "key_plot": [],
    })
    _write_json(projects_dir, proj_id, "outline.json", {
        "chapters": [
            {"chapter_number": i, "title": f"ch{i}-old", "theme": f"theme-{i}"}
            for i in range(1, planned_total + 1)
        ]
    })


def test_regenerate_single_chapter_returns_merged_outline(projects_dir, client):
    _seed(projects_dir, "p1", planned_total=5)
    new_ch3 = {"chapter_number": 3, "title": "ch3-new", "theme": "theme-3-new"}

    with patch("backend.agents.planner.PlannerAgent") as MockAgent:
        instance = MockAgent.return_value
        instance.generate_outline = AsyncMock(return_value=(new_ch3, None))
        resp = client.post(
            "/api/stage3/regenerate-chapter-outline?project_id=p1",
            json={"chapter_start": 3, "chapter_end": 3, "user_modifications": ""},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["error"] is False
    chapters = body["detail"]["chapters"]
    assert len(chapters) == 5
    ch3 = next(c for c in chapters if c["chapter_number"] == 3)
    assert ch3["title"] == "ch3-new"
    # Out-of-range chapters preserved byte-identical.
    ch1 = next(c for c in chapters if c["chapter_number"] == 1)
    assert ch1["title"] == "ch1-old"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_chapter_outline_regenerate.py::test_regenerate_single_chapter_returns_merged_outline -v`
Expected: FAIL with "404 Not Found"（端点不存在）。

- [ ] **Step 3: 实现端点（最小）**

打开 `backend/api/stage3_outline.py`，定位到 `regenerate_novel_outline_section` 函数定义结束后的位置（约 line 423），在 `branch_router = APIRouter(...)` 之前追加：

```python
class RegenerateChapterOutlinePayload(BaseModel):
    chapter_start: int = Field(ge=1)
    chapter_end: int = Field(ge=1)
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-chapter-outline")
async def regenerate_chapter_outline(
    project_id: str = Query(...),
    payload: RegenerateChapterOutlinePayload = None,
):
    """重生成 outline.json 中 chapter_start..chapter_end 区间内的章节大纲。
    其他章节 byte-identical 保留。
    与 /stage3/generate 共用 PlannerAgent.generate_outline，无 STAGE_ORDER 检查。
    """
    from backend.agents.planner import PlannerAgent
    from backend.growth_curve.auto_generator import planned_total

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    if payload.chapter_end < payload.chapter_start:
        raise http_error(
            400, "VALIDATION_ERROR",
            f"chapter_end ({payload.chapter_end}) 必须 >= chapter_start ({payload.chapter_start})",
        )

    project = fm.read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = fm.read_json(project_id, "outline.json") or {}
    chapters = list(existing.get("chapters", []))
    if not chapters:
        raise http_error(400, "PRECONDITION_FAILED", "outline.json 为空，无可重新生成的章节")

    novel_outline = fm.read_json(project_id, "novel_outline.json") or {}
    novel_total = planned_total(novel_outline) if novel_outline else 0
    if novel_total and payload.chapter_end > novel_total:
        raise http_error(
            400, "VALIDATION_ERROR",
            f"chapter_end ({payload.chapter_end}) 超出 planned_total ({novel_total})",
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json") or {}
    world = fm.read_json(project_id, "world.json") or {}
    characters_data = fm.read_json(project_id, "characters.json") or {}
    characters = characters_data.get("characters", [])
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )

    outline_for_prompt = existing

    for ch_num in range(payload.chapter_start, payload.chapter_end + 1):
        try:
            result, _resp = await agent.generate_outline(
                concept=concept_and_dna.get("concept", {}),
                story_dna=concept_and_dna.get("story_dna", {}),
                world=world,
                characters=characters,
                chapter_number=ch_num,
                min_words=project.get("min_words", 4000),
                novel_outline=novel_outline,
                outline=outline_for_prompt,
                user_modifications=payload.user_modifications,
            )
        except ValueError as e:
            raise http_error(503, "LLM_GENERATION_FAILED", str(e))

        chapters = [ch for ch in chapters if ch.get("chapter_number") != ch_num]
        chapters.append(result)
        outline_for_prompt = dict(outline_for_prompt)
        outline_for_prompt["chapters"] = chapters

    chapters.sort(key=lambda ch: ch.get("chapter_number", 0))
    merged_outline = {"chapters": chapters}
    fm.write_json(project_id, "outline.json", merged_outline)

    return {
        "error": False,
        "code": "OK",
        "message": f"第 {payload.chapter_start}-{payload.chapter_end} 章已重新生成",
        "detail": merged_outline,
    }
```

文件顶部如果还没有 `from backend.api._errors import http_error`，加进去。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_chapter_outline_regenerate.py::test_regenerate_single_chapter_returns_merged_outline -v`
Expected: PASS。

- [ ] **Step 5: 追加失败测试 — 多章 + 区间越界 + 边界 + 副作用**

继续往 `tests/test_chapter_outline_regenerate.py` 追加：

```python
def test_regenerate_range_calls_agent_per_chapter(projects_dir, client):
    """多章重生应逐章调 agent，每章的 prompt 看到前面已重生的章节。"""
    _seed(projects_dir, "p1", planned_total=5)

    call_log = []

    async def fake_gen_outline(*args, **kwargs):
        ch_num = kwargs.get("chapter_number")
        call_log.append(ch_num)
        return ({"chapter_number": ch_num, "title": f"ch{ch_num}-new"}, None)

    with patch("backend.agents.planner.PlannerAgent") as MockAgent:
        MockAgent.return_value.generate_outline = fake_gen_outline
        resp = client.post(
            "/api/stage3/regenerate-chapter-outline?project_id=p1",
            json={"chapter_start": 2, "chapter_end": 4, "user_modifications": ""},
        )

    assert resp.status_code == 200
    assert call_log == [2, 3, 4]
    body = resp.json()
    titles = {c["chapter_number"]: c["title"] for c in body["detail"]["chapters"]}
    assert titles[1] == "ch1-old"   # out of range
    assert titles[2] == "ch2-new"
    assert titles[3] == "ch3-new"
    assert titles[4] == "ch4-new"
    assert titles[5] == "ch5-old"   # out of range


def test_regenerate_end_before_start_returns_400(projects_dir, client):
    _seed(projects_dir, "p1", planned_total=5)
    resp = client.post(
        "/api/stage3/regenerate-chapter-outline?project_id=p1",
        json={"chapter_start": 3, "chapter_end": 2, "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_regenerate_end_exceeds_planned_total_returns_400(projects_dir, client):
    _seed(projects_dir, "p1", planned_total=5)
    resp = client.post(
        "/api/stage3/regenerate-chapter-outline?project_id=p1",
        json={"chapter_start": 1, "chapter_end": 100, "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_regenerate_empty_outline_returns_400(projects_dir, client):
    _seed(projects_dir, "p1", planned_total=5)
    (projects_dir / "p1" / "outline.json").write_text(json.dumps({}))
    resp = client.post(
        "/api/stage3/regenerate-chapter-outline?project_id=p1",
        json={"chapter_start": 1, "chapter_end": 1, "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "PRECONDITION_FAILED"


def test_regenerate_does_not_touch_characters_or_progress(projects_dir, client):
    _seed(projects_dir, "p1", planned_total=3)
    _write_json(projects_dir, "p1", "characters.json", {
        "characters": [{"id": "char_x", "growth_curve": {"bound_chapter": 2}}]
    })
    _write_json(projects_dir, "p1", "progress.json", {"total_chapters": 99})

    with patch("backend.agents.planner.PlannerAgent") as MockAgent:
        MockAgent.return_value.generate_outline = AsyncMock(
            return_value=({"chapter_number": 1, "title": "new"}, None)
        )
        client.post(
            "/api/stage3/regenerate-chapter-outline?project_id=p1",
            json={"chapter_start": 1, "chapter_end": 1, "user_modifications": ""},
        )

    characters = json.loads((projects_dir / "p1" / "characters.json").read_text())
    assert characters["characters"][0]["growth_curve"]["bound_chapter"] == 2
    progress = json.loads((projects_dir / "p1" / "progress.json").read_text())
    assert progress["total_chapters"] == 99
```

- [ ] **Step 6: 跑全部后端测试**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_chapter_outline_regenerate.py -v`
Expected: 全部 PASS（5 个测试）。

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add backend/api/stage3_outline.py tests/test_chapter_outline_regenerate.py && git commit -m "feat(stage3): add regenerate-chapter-outline range endpoint"
```

---

## Task 2: 前端 — API client 加 `regenerateChapterOutlineRange`

**Files:**
- Modify: `frontend/src/api/client.ts:892-901`（在 `regenerateNovelOutlineSection` 之后）
- Modify: `frontend/src/test/client.test.ts`

- [ ] **Step 1: 写失败测试**

打开 `frontend/src/test/client.test.ts`，定位到 `regenerateNovelOutlineSection_postsBody` 测试（约 line 241）之后追加：

```ts
it("regenerateChapterOutlineRange_postsBody", async () => {
  const captured = captureRequest();
  await api.regenerateChapterOutlineRange("p1", 3, 5, "let me adjust");
  expect(captured.url).toBe(
    "/api/stage3/regenerate-chapter-outline?project_id=p1",
  );
  expect(captured.method).toBe("POST");
  expect(captured.body).toEqual({
    chapter_start: 3,
    chapter_end: 5,
    user_modifications: "let me adjust",
  });
});
```

如果 `captureRequest` helper 不存在，先在文件顶部加：

```ts
function captureRequest() {
  const captured = { url: "", method: "", body: undefined as unknown };
  (globalThis as { __capturedRequest?: typeof captured }).__capturedRequest = captured;
  return captured;
}
```

并修改 mock 的 `fetch` 实现（在文件顶部已有的 fetch mock 里）让它把 method/url/body 写到 `globalThis.__capturedRequest`。**如果已有类似 helper，直接复用现有命名**（grep "captureRequest\|__captured" 看有没有）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/client.test.ts -t "regenerateChapterOutlineRange"`
Expected: FAIL with "api.regenerateChapterOutlineRange is not a function"。

- [ ] **Step 3: 实现 client 方法**

打开 `frontend/src/api/client.ts`，在 `regenerateNovelOutlineSection` 函数定义（line 892-901）之后追加：

```ts
  regenerateChapterOutlineRange: (
    projectId: string,
    chapterStart: number,
    chapterEnd: number,
    userModifications: string = "",
  ): Promise<{ chapters: unknown[] }> =>
    request<{ chapters: unknown[] }>(
      "POST",
      `/stage3/regenerate-chapter-outline?project_id=${encodeURIComponent(projectId)}`,
      {
        chapter_start: chapterStart,
        chapter_end: chapterEnd,
        user_modifications: userModifications,
      },
    ),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/client.test.ts -t "regenerateChapterOutlineRange"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/api/client.ts frontend/src/test/client.test.ts && git commit -m "feat(api-client): add regenerateChapterOutlineRange"
```

---

## Task 3: 前端 — `SectionRegenerateButton` 解耦 wizard context

**Files:**
- Modify: `frontend/src/components/shared/SectionRegenerateButton.tsx`
- Modify: `frontend/src/test/SectionRegenerateButton.test.tsx`

- [ ] **Step 1: 看现有测试结构**

Run: `cd /Users/longsa/Codes/storyForge2 && head -40 frontend/src/test/SectionRegenerateButton.test.tsx`

记录测试文件如何 mock `useWizard` 和断言 status 路径。**这是新测试要绕开的路径**。

- [ ] **Step 2: 写失败测试 — `statusReporter` 走自定义回调**

在 `frontend/src/test/SectionRegenerateButton.test.tsx` 末尾追加：

```tsx
describe("SectionRegenerateButton with statusReporter (workspace path)", () => {
  it("calls onSuccess of statusReporter when onRegenerate resolves", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onBusy = vi.fn();

    render(
      <SectionRegenerateButton
        target="概念"
        onRegenerate={async () => {}}
        statusReporter={{ onSuccess, onError, onBusy }}
      />,
    );

    fireEvent.click(screen.getByTestId("section-regenerate-概念"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("概念"));
    expect(onError).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenCalledWith("概念");
  });

  it("calls onError of statusReporter when onRegenerate rejects", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => { throw new Error("boom"); }}
        statusReporter={{ onSuccess, onError }}
      />,
    );

    fireEvent.click(screen.getByTestId("section-regenerate-力量体系"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("力量体系", expect.stringContaining("boom")),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑新测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/SectionRegenerateButton.test.tsx -t "workspace path"`
Expected: FAIL — 新测试至少因 modal 不打开或 statusReporter 未被调用而失败。

- [ ] **Step 4: 改 SectionRegenerateButton 支持可选 statusReporter**

打开 `frontend/src/components/shared/SectionRegenerateButton.tsx`，把 `useWizard()` 调用改成条件式：

```tsx
import { useState } from "react";
import { RegenerateModal } from "./RegenerateModal";
import { useWizard } from "../wizard/WizardContext";

interface SectionRegenerateButtonProps {
  target: string;
  onRegenerate: (userModifications: string) => Promise<void>;
  disabled?: boolean;
  testId?: string;
  /**
   * 工作区使用：传入自定义 reporter（通常用 useToast 包装）。
   * 不传则 fallback useWizard()，保持现有 wizard 行为不变。
   */
  statusReporter?: {
    onBusy?: (target: string) => void;
    onSuccess?: (target: string) => void;
    onError?: (target: string, message: string) => void;
  };
}

export function SectionRegenerateButton({
  target,
  onRegenerate,
  disabled = false,
  testId,
  statusReporter,
}: SectionRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 只有没传 statusReporter 时才走 wizard（保持向后兼容）。
  const wizard = statusReporter ? null : useWizard();

  const reportBusy = (t: string) => {
    if (statusReporter?.onBusy) statusReporter.onBusy(t);
    else wizard?.setRegenerateBusy(t);
  };
  const reportSuccess = (t: string) => {
    if (statusReporter?.onSuccess) statusReporter.onSuccess(t);
    else wizard?.setRegenerateSuccess(t);
  };
  const reportError = (t: string, m: string) => {
    if (statusReporter?.onError) statusReporter.onError(t, m);
    else wizard?.setRegenerateFailure(t, m);
  };

  const handleConfirm = async (text: string) => {
    setBusy(true);
    reportBusy(target);
    try {
      await onRegenerate(text);
      reportSuccess(target);
      setOpen(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      reportError(target, m);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={testId ?? `section-regenerate-${target}`}
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        aria-label={`重新生成 — ${target}`}
        title={`重新生成 — ${target}`}
        className="inline-flex items-center justify-center h-6 w-6 rounded text-system-log/50 hover:text-primary-container hover:bg-surface-container transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span
          className={`material-symbols-outlined text-[14px]${busy ? " animate-spin text-primary-container" : ""}`}
          data-testid={busy ? `${testId ?? `section-regenerate-${target}`}-spinner` : undefined}
        >
          {busy ? "progress_activity" : "refresh"}
        </span>
      </button>
      <RegenerateModal
        open={open}
        target={target}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
        busy={busy}
      />
    </>
  );
}
```

- [ ] **Step 5: 跑全部 SectionRegenerateButton 测试**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/SectionRegenerateButton.test.tsx`
Expected: 全部 PASS（既有 wizard 测试 + 新 statusReporter 测试）。

- [ ] **Step 6: 跑 wizard 测试套件确保没回归**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/WorldStep.test.tsx src/test/CharacterStep.behavior_examples.test.tsx src/test/CharacterStep.edit_delete.test.tsx src/test/ConceptStep.test.tsx`
Expected: 全部 PASS（这些 Step 组件用 SectionRegenerateButton 走 wizard 路径）。

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/shared/SectionRegenerateButton.tsx frontend/src/test/SectionRegenerateButton.test.tsx && git commit -m "refactor(shared): make SectionRegenerateButton context-agnostic via statusReporter"
```

---

## Task 4: 前端 — `ConceptEditor` 加2 个 ↻ 按钮

**Files:**
- Create: `frontend/src/test/ConceptEditor.workspace.test.tsx`
- Modify: `frontend/src/components/workspace/editors/ConceptEditor.tsx`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/test/ConceptEditor.workspace.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/client", () => ({
  default: {
    updateConcept: vi.fn(),
    regenerateConceptSection: vi.fn(),
  },
}));

import api from "../../../api/client";
import ConceptEditor from "../../../components/workspace/editors/ConceptEditor";

const SEED = {
  concept: {
    title: "原标题",
    genre: "cool_novel",
    premise: "原前提",
    tone: "",
    theme: "",
    target_audience: "",
    style_template: "",
  },
  story_dna: {
    core_contradiction: { statement: "原矛盾", side_a: "", side_b: "" },
    value_stack: [],
  },
};

const toastCalls: string[] = [];
vi.mock("../../../hooks/useToast", () => ({
  useToast: () => ({ show: (msg: string) => toastCalls.push(msg) }),
}));

beforeEach(() => {
  (api.updateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockReset();
  toastCalls.length = 0;
});

describe("ConceptEditor regenerate", () => {
  it("renders 2 section regenerate buttons (concept + dna)", () => {
    render(
      <ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} />,
    );
    expect(screen.getByTestId("section-regenerate-概念")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-Story DNA")).toBeInTheDocument();
  });

  it("clicking concept regenerate calls API and updates local state", async () => {
    (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { ...SEED.concept, title: "新标题", premise: "新前提" },
      story_dna: SEED.story_dna,
    });

    render(<ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId("section-regenerate-概念"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateConceptSection).toHaveBeenCalledWith("p1", "concept", ""),
    );
    expect((screen.getByTestId("concept-title") as HTMLInputElement).value).toBe("新标题");
    expect(toastCalls.some((m) => m.includes("概念"))).toBe(true);
  });

  it("readOnly=true hides both regenerate buttons", () => {
    render(
      <ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />,
    );
    expect(screen.queryByTestId("section-regenerate-概念")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-Story DNA")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ConceptEditor.workspace.test.tsx`
Expected: 全部 FAIL（按钮还不存在）。

- [ ] **Step 3: 加 import + statusReporter + 按钮到 ConceptEditor**

打开 `frontend/src/components/workspace/editors/ConceptEditor.tsx`，**顶部 imports 区域**追加：

```tsx
import { SectionRegenerateButton } from "../../shared/SectionRegenerateButton";
import { useToast } from "../../../hooks/useToast";
```

**在 `export default function ConceptEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {` 函数体内**（busy state 后）追加：

```tsx
  const { show } = useToast();
```

**把 `concept` 段落标签（line 84 `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">概念</div>`）改成**：

```tsx
      <div className="flex items-center justify-between">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">概念</div>
        {!readOnly && (
          <SectionRegenerateButton
            target="概念"
            statusReporter={{
              onSuccess: (t) => show(`${t} 已重新生成`),
              onError: (t, m) => show(`重新生成 ${t} 失败：${m}`),
            }}
            onRegenerate={async (mods) => {
              const result = await api.regenerateConceptSection(projectId, "concept", mods);
              setConcept(result.concept);
            }}
          />
        )}
      </div>
```

**把 `story_dna` 段落标签（line 154 `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾 (Story DNA)</div>`）改成**：

```tsx
        <div className="flex items-center justify-between">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾 (Story DNA)</div>
          {!readOnly && (
            <SectionRegenerateButton
              target="Story DNA"
              statusReporter={{
                onSuccess: (t) => show(`${t} 已重新生成`),
                onError: (t, m) => show(`重新生成 ${t} 失败：${m}`),
              }}
              onRegenerate={async (mods) => {
                const result = await api.regenerateConceptSection(projectId, "dna", mods);
                setDna(result.story_dna);
              }}
            />
          )}
        </div>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ConceptEditor.workspace.test.tsx`
Expected: 3 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/ConceptEditor.tsx frontend/src/test/ConceptEditor.workspace.test.tsx && git commit -m "feat(workspace): add section regenerate buttons to ConceptEditor"
```

---

## Task 5: 前端 — `WorldEditor` 加 section ↻ 按钮

**Files:**
- Create: `frontend/src/test/WorldEditor.workspace.test.tsx`
- Modify: `frontend/src/components/workspace/editors/WorldEditor.tsx`

- [ ] **Step 1: 看 WorldEditor 结构**

Run: `cd /Users/longsa/Codes/storyForge2 && grep -n "<div className=\"font-label-mono\\|power_systems\\|generateWorld\\|regenerate" frontend/src/components/workspace/editors/WorldEditor.tsx | head -30`

记录 era / power_system / core_rules / factions 4 个段落标签的精确位置，以及 power_systems 数组的渲染方式（map 还是 indexed）。**这些位置决定了按钮插入点**。

- [ ] **Step 2: 写失败测试**

创建 `frontend/src/test/WorldEditor.workspace.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/client", () => ({
  default: {
    regenerateWorldSection: vi.fn(),
    regeneratePowerSystemItem: vi.fn(),
    updateWorld: vi.fn(),
  },
}));

import api from "../../../api/client";
import WorldEditor from "../../../components/workspace/editors/WorldEditor";

const SEED = {
  era: "原时代",
  power_systems: [
    { name: "灵力", description: "原灵力", rules: [] },
  ],
  core_rules: ["原规则"],
  factions: [{ name: "原阵营" }],
};

const toastCalls: string[] = [];
vi.mock("../../../hooks/useToast", () => ({
  useToast: () => ({ show: (msg: string) => toastCalls.push(msg) }),
}));

beforeEach(() => {
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockReset();
  toastCalls.length = 0;
});

describe("WorldEditor regenerate", () => {
  it("renders 4 section regenerate buttons + 1 per power-system card", () => {
    render(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    expect(screen.getByTestId("section-regenerate-时代与地理")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-力量体系")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-世界规则")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-阵营")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-power-system-0")).toBeInTheDocument();
  });

  it("clicking era regenerate calls API with section=era", async () => {
    (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SEED, era: "新时代",
    });
    render(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId("section-regenerate-时代与地理"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateWorldSection).toHaveBeenCalledWith("p1", "era", ""),
    );
  });

  it("clicking power-system card regenerate calls regeneratePowerSystemItem", async () => {
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 0,
      power_system: { name: "新灵力", description: "新", rules: [] },
      world: SEED,
    });
    render(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId("section-regenerate-power-system-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regeneratePowerSystemItem).toHaveBeenCalledWith("p1", 0, ""),
    );
  });

  it("readOnly=true hides all regenerate buttons", () => {
    render(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />);
    expect(screen.queryByTestId("section-regenerate-时代与地理")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-power-system-0")).not.toBeInTheDocument();
  });
});
```

> **注意：** 上面的 `target` 命名（"时代与地理"、"力量体系"、"世界规则"、"阵营"）按 Step 1 看到的 WorldEditor 实际段落标签命名。**如果实际标签名不同，根据 grep 结果调整**。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/WorldEditor.workspace.test.tsx`
Expected: 全部 FAIL（按钮还不存在）。

- [ ] **Step 4: 加 import + statusReporter + 5 个按钮**

打开 `frontend/src/components/workspace/editors/WorldEditor.tsx`，**顶部 imports 追加**：

```tsx
import { SectionRegenerateButton } from "../../shared/SectionRegenerateButton";
import { useToast } from "../../../hooks/useToast";
```

**在组件函数体顶部**（state 声明后）追加：

```tsx
  const { show } = useToast();
  const reportRegen = (section: string) => ({
    onSuccess: (t: string) => show(`${t} 已重新生成`),
    onError: (t: string, m: string) => show(`重新生成 ${t} 失败：${m}`),
  });
```

**在 era 段落标签旁**（按 Step 1 看到的实际位置）追加：

```tsx
{!readOnly && (
  <SectionRegenerateButton
    target="时代与地理"
    statusReporter={reportRegen("时代与地理")}
    onRegenerate={async (mods) => {
      const result = await api.regenerateWorldSection(projectId, "era", mods);
      // 调用方负责把 result 合并进本地 state
    }}
  />
)}
```

**对 power_system / core_rules / factions 段落同理**（section 字符串分别为 `"power_system"` / `"core_rules"` / `"factions"`）。

**在 power_systems[i] 卡片渲染的 map 里**追加一个 ↻ 按钮，target 用 `power-system-${i}`：

```tsx
{!readOnly && (
  <SectionRegenerateButton
    target={`power-system-${i}`}
    testId={`section-regenerate-power-system-${i}`}
    statusReporter={reportRegen(`力量体系 #${i + 1}`)}
    onRegenerate={async (mods) => {
      const result = await api.regeneratePowerSystemItem(projectId, i, mods);
      // 把 result.power_system 替换本地数组第 i 项
    }}
  />
)}
```

**实现细节：onRegenerate 必须把 API 响应合并进本地 state。** 具体做法因 WorldEditor 内部 state 结构而异——这一步**必须读懂 WorldEditor 的现有 state 形状**（grep `useState` 看它存的是哪个对象），然后正确 setState。如果 WorldEditor 当前把 data 直接用作渲染源（每次 data 变都重新渲染），可以在 onRegenerate 后调 `onSaved()` 触发 reloadKey 重新 fetch。如果它有内部 mutable state，则需要 setState 新值。

> **风险点：** WorldEditor 的 state 结构决定了实现细节。如果不能直接 setState 合并，至少要 `onSaved()` + 不调 reloadKey（乐观刷新）。**具体写法由工程师按现场代码决定，但必须保证成功后 UI 显示新内容。**

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/WorldEditor.workspace.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/WorldEditor.tsx frontend/src/test/WorldEditor.workspace.test.tsx && git commit -m "feat(workspace): add section + per-card regenerate buttons to WorldEditor"
```

---

## Task 6: 前端 — `CharacterEditor` 加 section ↻ 按钮

**Files:**
- Modify: `frontend/src/test/CharacterEditor.workspace.test.tsx`（追加 describe 块）
- Modify: `frontend/src/components/workspace/editors/CharacterEditor.tsx`

- [ ] **Step 1: 看 CharacterEditor 结构**

Run: `cd /Users/longsa/Codes/storyForge2 && grep -n "personality\\|voice_signature\\|current_state\\|unknown\\|relations\\|behavior_examples\\|<h3\\|<div className=\"font-label-mono" frontend/src/components/workspace/editors/CharacterEditor.tsx | head -40`

记录每段标题的精确位置和实际命名（用于 target 字符串）。

- [ ] **Step 2: 写失败测试 — 每个角色 5 个 section + 1 个 examples 按钮**

打开 `frontend/src/test/CharacterEditor.workspace.test.tsx`，**追加**：

```tsx
import { regenerateCharacterSection, regenerateCharacterExamples } from ... // 顶部已有 api mock，加上这2 个

describe("CharacterEditor regenerate", () => {
  beforeEach(() => {
    (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockReset();
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockReset();
  });

  it("renders 6 regenerate buttons per character card", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("section-regenerate-性格-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-声音特征-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-当前状态-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-角色未知-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-人物关系-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-行为示例-0")).toBeInTheDocument();
  });

  it("personality regenerate calls API with section=personality", async () => {
    (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("section-regenerate-性格-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateCharacterSection).toHaveBeenCalledWith(
        "p1", "char_alice", "personality", { keepExisting: false, userModifications: "" },
      ),
    );
  });

  it("behavior_examples regenerate calls regenerateCharacterExamples", async () => {
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("section-regenerate-行为示例-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateCharacterExamples).toHaveBeenCalledWith("p1", "char_alice", false, ""),
    );
  });

  it("readOnly=true hides all regenerate buttons", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} readOnly />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("section-regenerate-性格-0")).not.toBeInTheDocument();
  });
});
```

> **注意：** target 命名（"性格"、"声音特征" 等）按 Step 1 看到的实际段落标签。**多角色时后缀加 character index**（testId `section-regenerate-${label}-${i}`），避免重复。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditor.workspace.test.tsx -t "regenerate"`
Expected: 全部 FAIL。

- [ ] **Step 4: 加 6 个按钮到 CharacterEditor**

打开 `frontend/src/components/workspace/editors/CharacterEditor.tsx`，**顶部 imports 追加**：

```tsx
import { SectionRegenerateButton } from "../../shared/SectionRegenerateButton";
import { useToast } from "../../../hooks/useToast";
```

**在组件函数体顶部**追加：

```tsx
  const { show } = useToast();
```

**对每个角色卡片的 personality / voice_signature / current_state / unknown / relations / behavior_examples 段标题各追加**：

```tsx
{!readOnly && (
  <SectionRegenerateButton
    target="<label>"
    testId={`section-regenerate-<label>-${i}`}
    statusReporter={{
      onSuccess: (t) => show(`${t} 已重新生成`),
      onError: (t, m) => show(`重新生成 ${t} 失败：${m}`),
    }}
    onRegenerate={async (mods) => {
      const result = await api.regenerateCharacterSection(projectId, c.id, "<section>", {
        userModifications: mods,
      });
      // 合并 result 到本地 characters 数组第 i 项
    }}
  />
)}
```

behavior_examples 那一个用 `api.regenerateCharacterExamples(projectId, c.id, false, mods)`。

**关键：** `onRegenerate` 必须更新本地 state，使新内容显示出来。具体写法取决于 CharacterEditor 的内部 state 结构——可能需要 setCharacters 数组、把 result 替换到对应 index。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditor.workspace.test.tsx`
Expected: 全部 PASS（包括新增 4 个测试 + 既有 add/delete 测试）。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/CharacterEditor.tsx frontend/src/test/CharacterEditor.workspace.test.tsx && git commit -m "feat(workspace): add per-character section regenerate buttons"
```

---

## Task 7: 前端 — `NovelOutlineEditor` 加 section ↻ 按钮

**Files:**
- Create: `frontend/src/test/NovelOutlineEditor.workspace.test.tsx`
- Modify: `frontend/src/components/workspace/editors/NovelOutlineEditor.tsx`

- [ ] **Step 1: 看 NovelOutlineEditor 结构**

Run: `cd /Users/longsa/Codes/storyForge2 && grep -n "<div className=\"font-label-mono\\|<h2\\|<h3\\|title\\|core_conflict\\|volumes\\|mc_growth\\|key_plot" frontend/src/components/workspace/editors/NovelOutlineEditor.tsx | head -40`

记录 4 个 section 的实际渲染位置（可能用 map 渲染 `{title}` 字符串）。

- [ ] **Step 2: 写失败测试**

创建 `frontend/src/test/NovelOutlineEditor.workspace.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/client", () => ({
  default: {
    regenerateNovelOutlineSection: vi.fn(),
    updateNovelOutline: vi.fn(),
  },
}));

import api from "../../../api/client";
import NovelOutlineEditor from "../../../components/workspace/editors/NovelOutlineEditor";

const SEED = {
  core_conflict: "原核心冲突",
  volumes: [{ volume_number: 1, title: "v1", chapter_range: [1, 5] }],
  mc_growth: [{ arc: "原弧线" }],
  key_plot: ["原关键点"],
};

const toastCalls: string[] = [];
vi.mock("../../../hooks/useToast", () => ({
  useToast: () => ({ show: (msg: string) => toastCalls.push(msg) }),
}));

beforeEach(() => {
  (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockReset();
  toastCalls.length = 0;
});

describe("NovelOutlineEditor regenerate", () => {
  it("renders 4 section regenerate buttons", () => {
    render(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    expect(screen.getByTestId("section-regenerate-core_conflict")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-volumes")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-mc_growth")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-key_plot")).toBeInTheDocument();
  });

  it("clicking core_conflict calls API", async () => {
    (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockResolvedValue(SEED);
    render(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId("section-regenerate-core_conflict"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateNovelOutlineSection).toHaveBeenCalledWith("p1", "core_conflict", ""),
    );
  });

  it("readOnly=true hides all regenerate buttons", () => {
    render(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />);
    expect(screen.queryByTestId("section-regenerate-core_conflict")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/NovelOutlineEditor.workspace.test.tsx`
Expected: 全部 FAIL。

- [ ] **Step 4: 加 4 个按钮到 NovelOutlineEditor**

打开 `frontend/src/components/workspace/editors/NovelOutlineEditor.tsx`，**顶部 imports 追加**：

```tsx
import { SectionRegenerateButton } from "../../shared/SectionRegenerateButton";
import { useToast } from "../../../hooks/useToast";
```

**组件函数体顶部**追加：

```tsx
  const { show } = useToast();
```

**对每个 section（core_conflict / volumes / mc_growth / key_plot）的标题行**追加：

```tsx
{!readOnly && (
  <SectionRegenerateButton
    target="<label>"
    testId={`section-regenerate-<label>`}
    statusReporter={{
      onSuccess: (t) => show(`${t} 已重新生成`),
      onError: (t, m) => show(`重新生成 ${t} 失败：${m}`),
    }}
    onRegenerate={async (mods) => {
      const result = await api.regenerateNovelOutlineSection(projectId, "<section>", mods);
      // 合并 result 进本地 state
    }}
  />
)}
```

如果 NovelOutlineEditor 的 4 个 section 是用 `[{title: "核心冲突", section: "core_conflict"}, ...]` 这样的数组 map 渲染的，则在 map 里加按钮，target 用 `title`、section 用 `item.section`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/NovelOutlineEditor.workspace.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/NovelOutlineEditor.tsx frontend/src/test/NovelOutlineEditor.workspace.test.tsx && git commit -m "feat(workspace): add section regenerate buttons to NovelOutlineEditor"
```

---

## Task 8: 前端 — `ChapterRangeRegenerateModal` 新组件

**Files:**
- Create: `frontend/src/components/workspace/editors/ChapterRangeRegenerateModal.tsx`
- Create: `frontend/src/test/ChapterRangeRegenerateModal.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/test/ChapterRangeRegenerateModal.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChapterRangeRegenerateModal from "../../components/workspace/editors/ChapterRangeRegenerateModal";

describe("ChapterRangeRegenerateModal", () => {
  const defaultProps = {
    open: true,
    chapterCount: 10,
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  };

  it("renders 2 number inputs (start, end), warning banner, textarea", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    expect(screen.getByTestId("chapter-range-warning")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-start")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-end")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-mods")).toBeInTheDocument();
  });

  it("submit calls onConfirm with parsed values", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ChapterRangeRegenerateModal {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("chapter-range-mods"), { target: { value: "make it tight" } });
    fireEvent.click(screen.getByTestId("chapter-range-confirm"));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(3, 5, "make it tight"),
    );
  });

  it("start > end disables confirm button (or shows error before submit)", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "3" } });
    const btn = screen.getByTestId("chapter-range-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("out-of-range input disables confirm button", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "0" } });
    const btn = screen.getByTestId("chapter-range-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    render(<ChapterRangeRegenerateModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("busy disables inputs and confirm", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} busy />);
    expect((screen.getByTestId("chapter-range-start") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("chapter-range-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ChapterRangeRegenerateModal.test.tsx`
Expected: 全部 FAIL（组件不存在）。

- [ ] **Step 3: 实现 ChapterRangeRegenerateModal**

创建 `frontend/src/components/workspace/editors/ChapterRangeRegenerateModal.tsx`：

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface ChapterRangeRegenerateModalProps {
  open: boolean;
  chapterCount: number;
  onConfirm: (chapterStart: number, chapterEnd: number, userModifications: string) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

const MAX_LEN = 1700;

export default function ChapterRangeRegenerateModal({
  open,
  chapterCount,
  onConfirm,
  onCancel,
  busy = false,
}: ChapterRangeRegenerateModalProps) {
  const [start, setStart] = useState<string>("1");
  const [end, setEnd] = useState<string>(String(chapterCount));
  const [mods, setMods] = useState<string>("");
  const startInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setStart("1");
      setEnd(String(chapterCount));
      setMods("");
      startInputRef.current?.focus();
    }
  }, [open, chapterCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const startNum = Number(start);
  const endNum = Number(end);
  const valid =
    Number.isInteger(startNum) &&
    Number.isInteger(endNum) &&
    startNum >= 1 &&
    endNum <= chapterCount &&
    endNum >= startNum;

  const handleSubmit = () => {
    if (!valid) return;
    onConfirm(startNum, endNum, mods);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-range-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        data-testid="chapter-range-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl w-[560px] max-w-[92vw] overflow-hidden"
      >
        <div className="px-6 pt-5 pb-3 border-b border-system-divider">
          <h2 id="chapter-range-modal-title" className="font-display text-primary text-base font-semibold">
            重新生成章节大纲
          </h2>
          <p
            data-testid="chapter-range-warning"
            className="font-body-ui text-system-log/80 text-xs mt-2 px-3 py-2 bg-yellow-100 border border-yellow-400 rounded"
          >
            ⚠ 已写章节不会自动重写或回填，请确认理解影响范围。
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
                开始章节 (1 - {chapterCount})
              </label>
              <input
                ref={startInputRef}
                data-testid="chapter-range-start"
                type="number"
                min={1}
                max={chapterCount}
                value={start}
                disabled={busy}
                onChange={(e) => setStart(e.target.value)}
                className="w-full border border-system-divider rounded-md px-3 py-2 text-sm bg-surface-container text-system-log font-body-ui focus:outline-none focus:ring-2 focus:ring-primary-container/40"
              />
            </div>
            <div>
              <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
                结束章节 (1 - {chapterCount})
              </label>
              <input
                data-testid="chapter-range-end"
                type="number"
                min={1}
                max={chapterCount}
                value={end}
                disabled={busy}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full border border-system-divider rounded-md px-3 py-2 text-sm bg-surface-container text-system-log font-body-ui focus:outline-none focus:ring-2 focus:ring-primary-container/40"
              />
            </div>
          </div>

          <div>
            <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
              修改意见 (可选)
            </label>
            <textarea
              data-testid="chapter-range-mods"
              value={mods}
              disabled={busy}
              onChange={(e) => setMods(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={handleKey}
              maxLength={MAX_LEN}
              placeholder="例如:第7章节奏更紧凑 / 让伏笔更明显……"
              className="w-full h-[100px] border border-system-divider rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-container/40 bg-surface-container text-system-log font-body-ui"
            />
            <div className="mt-1 text-right font-body-ui text-system-log/50 text-[11px]">
              {mods.length} / {MAX_LEN}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-surface-container border-t border-system-divider flex items-center justify-between">
          <span className="font-body-ui text-system-log/50 text-[11px]">
            Esc 取消 · Cmd+Enter 提交
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="chapter-range-cancel"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-high text-system-log disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="chapter-range-confirm"
              onClick={handleSubmit}
              disabled={busy || !valid}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm bg-primary-container text-surface-container-low rounded-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? "重新生成中…" : "重新生成"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ChapterRangeRegenerateModal.test.tsx`
Expected: 全部 PASS（6 个测试）。

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/ChapterRangeRegenerateModal.tsx frontend/src/test/ChapterRangeRegenerateModal.test.tsx && git commit -m "feat(workspace): add ChapterRangeRegenerateModal"
```

---

## Task 9: 前端 — `ChapterOutlineEditor` 集成 range 按钮 + modal

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Modify: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: 看 ChapterOutlineEditor 结构**

Run: `cd /Users/longsa/Codes/storyForge2 && head -50 frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`

记录顶部布局（标题、toolbar 区域在哪儿）和内部 state 结构。**这决定了按钮的插入位置**。

- [ ] **Step 2: 写失败测试**

打开 `frontend/src/test/ChapterOutlineEditor.test.tsx`，定位到既有 describe 块之后追加：

```tsx
import ChapterRangeRegenerateModal from "../components/workspace/editors/ChapterRangeRegenerateModal";
import { regenerateChapterOutlineRange } from ... // api mock 里加上

describe("ChapterOutlineEditor range regenerate", () => {
  beforeEach(() => {
    (api.regenerateChapterOutlineRange as ReturnType<typeof vi.fn>).mockReset();
  });

  it("renders ↻ 重新生成章节大纲 button", () => {
    render(<ChapterOutlineEditor projectId="p1" data={{ chapters: [...] }} novelOutline={...} onSaved={() => {}} />);
    expect(screen.getByTestId("chapter-outline-range-regenerate")).toBeInTheDocument();
  });

  it("clicking button opens ChapterRangeRegenerateModal", () => {
    render(<ChapterOutlineEditor ... />);
    fireEvent.click(screen.getByTestId("chapter-outline-range-regenerate"));
    expect(screen.getByTestId("chapter-range-modal")).toBeInTheDocument();
  });

  it("submit calls regenerateChapterOutlineRange and updates local state", async () => {
    const newChapters = [{ chapter_number: 3, title: "new" }, { chapter_number: 4, title: "new" }];
    (api.regenerateChapterOutlineRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: newChapters,
    });
    render(<ChapterOutlineEditor ... />);
    fireEvent.click(screen.getByTestId("chapter-outline-range-regenerate"));
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("chapter-range-confirm"));

    await waitFor(() =>
      expect(api.regenerateChapterOutlineRange).toHaveBeenCalledWith("p1", 3, 4, ""),
    );
    // 断言新内容显示出来
  });

  it("readOnly=true hides the button", () => {
    render(<ChapterOutlineEditor ... readOnly />);
    expect(screen.queryByTestId("chapter-outline-range-regenerate")).not.toBeInTheDocument();
  });
});
```

> **注意：** mock SEED 数据从既有 ChapterOutlineEditor.test.tsx 里抄，保持一致。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ChapterOutlineEditor.test.tsx -t "range regenerate"`
Expected: 全部 FAIL。

- [ ] **Step 4: 加按钮 + modal 到 ChapterOutlineEditor**

打开 `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`：

**顶部 imports 追加**：

```tsx
import { useState } from "react"; // 如果还没有
import ChapterRangeRegenerateModal from "./ChapterRangeRegenerateModal";
import { useToast } from "../../../hooks/useToast";
```

**组件函数体顶部**追加：

```tsx
  const { show } = useToast();
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [rangeBusy, setRangeBusy] = useState(false);
  const plannedTotal = novelOutline ? /* planned_total 字段 */ : 0;

  const handleRangeConfirm = async (start: number, end: number, mods: string) => {
    setRangeBusy(true);
    try {
      const result = await api.regenerateChapterOutlineRange(projectId, start, end, mods);
      // 合并 result.chapters 进本地 state
      setLocalOutline(result.chapters);
      show(`第 ${start}-${end} 章已重新生成`);
      setShowRangeModal(false);
    } catch (e) {
      show(`重新生成章节大纲失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRangeBusy(false);
    }
  };
```

**实际 planned_total 的取法**：grep `planned_total` 看 backend 是怎么算的，前端要么调 `planned_total(novelOutline)` 工具函数，要么直接读 novelOutline 的 `volumes` 数组累加 chapter_range。如果太复杂，可以**简化**：传 `chapterCount: plannedTotal` 字段给 modal；如果 novelOutline 为空则传 0 让 modal 显示空提示。

**在编辑器顶部 header/toolbar 区域追加**：

```tsx
{!readOnly && (
  <button
    type="button"
    data-testid="chapter-outline-range-regenerate"
    onClick={() => setShowRangeModal(true)}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low"
  >
    <span className="material-symbols-outlined text-[14px]">refresh</span>
    重新生成章节大纲
  </button>
)}
```

**在编辑器底部**追加：

```tsx
<ChapterRangeRegenerateModal
  open={showRangeModal}
  chapterCount={plannedTotal}
  onConfirm={handleRangeConfirm}
  onCancel={() => setShowRangeModal(false)}
  busy={rangeBusy}
/>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ChapterOutlineEditor.test.tsx`
Expected: 全部 PASS（包括新增 4 个测试 + 既有测试）。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2 && git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx && git commit -m "feat(workspace): integrate chapter-range regenerate in ChapterOutlineEditor"
```

---

## Task 10: 手动验收（按 spec §9 清单）

**Files:** 无（验证步骤）

- [ ] **Step 1: 启动 dev server**

```bash
cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && uvicorn backend.main:app --reload --port 8000 &
cd /Users/longsa/Codes/storyForge2/frontend && npm run dev &
```

打开 http://localhost:5173，进入一个有真实项目数据的 workspace。

- [ ] **Step 2: 概念 tab**

- [ ] 点击"概念"段 ↻，弹 modal，确认。验证新文本显示，toast 提示。
- [ ] 点击"Story DNA"段 ↻，同上。

- [ ] **Step 3: 世界观 tab**

- [ ] era / power_system / core_rules / factions 各 ↻，验证成功。
- [ ] power_systems 数组里的每张卡片 ↻，验证成功。

- [ ] **Step 4: 角色 tab**

- [ ] 每个角色 personality / voice_signature / current_state / unknown / relations ↻，验证成功。
- [ ] voice_signature.behavior_examples ↻，验证成功。
- [ ] 多角色：验证所有角色都有按钮（testId 后缀防重复）。

- [ ] **Step 5: 大纲 tab**

- [ ] core_conflict / volumes / mc_growth / key_plot 各 ↻，验证成功。

- [ ] **Step 6: 章节大纲 tab**

- [ ] 顶部"重新生成章节大纲"按钮可见，点击弹 modal。
- [ ] 黄底警告条常驻。
- [ ] 输入 start=3, end=5，确认。验证 chapters[3..5] 全部更新，chapters[1..2] 和 [6..end] 不变（对照磁盘上的 outline.json）。
- [ ] 输入 start > end：确认按钮 disabled。
- [ ] 输入 start=0 或 end > planned_total：确认按钮 disabled。

- [ ] **Step 7: 只读模式**

- [ ] 在托管运行模式下进入 workspace，验证所有 5 个 tab 的 ↻ 按钮**全部不渲染**。
- [ ] 验证手动编辑的保存/取消按钮在只读下也禁用（既有行为，不回归）。

- [ ] **Step 8: Wizard 回归**

- [ ] 进入 Stage1/2/3 wizard，验证 section ↻ 按钮**仍然正常工作**（因为 SectionRegenerateButton 的 wizard 路径是 fallback）。
- [ ] 验证 wizard status badge 仍然显示成功/失败（既有行为）。

- [ ] **Step 9: Commit 验收标记**

不需要 commit。如果有问题，列出来在下一个 plan 里修。

---

## 自审（已完成）

- ✅ Spec 覆盖：§2.2 新端点 → Task 1；§3.1 shared 改造 → Task 3；§3.2 5 个编辑器 → Tasks 4-7；§3.3 ChapterRangeRegenerateModal → Task 8；§3.4 API client → Task 2；§4 数据流 → 各 editor 实现；§5 错误处理 → modal 校验；§6 测试 → 每个 Task 自带；§9 验收 → Task 10。
- ✅ 无 placeholder / TBD / TODO。
- ✅ 类型一致：`statusReporter.onSuccess / onError / onBusy` 全 plan 一致；`target` 命名规则说明清楚；`data-testid` 命名一致。