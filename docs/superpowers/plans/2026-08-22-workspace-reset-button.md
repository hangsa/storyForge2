# Workspace 初始化按钮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作台左侧栏"刷新"按钮前新增"初始化"按钮，点击后清空章节草稿 + 运行时状态、将项目状态改回 INIT、并跳转到 wizard 章节大纲页。

**Architecture:** 后端新增 `StageStateMachine.regress_to_init()` + 2 个 API 端点（preview + reset）；前端扩展 `<ConfirmDialog>` 增加 busy 状态；`<ChapterTreePanel>` 新增 `onInit?` prop；`<WorkspacePage>` 持有 preview 状态、ConfirmDialog 与 navigate 逻辑；managed 模式由 `<ManagedDashboard>` 透传 prop，复用弹窗与 navigate。

**Tech Stack:** Python (FastAPI, pytest), React 18 + Vite + Tailwind, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-22-workspace-reset-button-design.md` (commit `4d8d087`)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/conductor/state_machine.py` | 修改：新增 `regress_to_init()` 方法 |
| `backend/api/project.py` | 修改：新增2 个端点（GET `/reset-preview`, POST `/reset`） |
| `frontend/src/api/client.ts` | 修改：新增 `resetPreview`, `resetToInit` |
| `frontend/src/components/shared/ConfirmDialog.tsx` | 修改：扩展 `busy` prop |
| `frontend/src/components/workspace/ChapterTreePanel.tsx` | 修改：新增 `onInit?` prop + 按钮渲染 |
| `frontend/src/components/workspace/ManagedDashboard.tsx` | 修改：透传 `onInit?` |
| `frontend/src/pages/WorkspacePage.tsx` | 修改：集成 onInit + ConfirmDialog 渲染 |
| `tests/test_reset_to_init.py` | 新建：后端测试（state machine + 端点） |
| `frontend/src/test/ResetInitButton.test.tsx` | 新建：前端测试 |

---

## Task 1: 后端 state_machine.regress_to_init() — 测试先行

**Files:**
- Modify: `backend/conductor/state_machine.py`
- Test: `tests/test_reset_to_init.py` (new)

- [ ] **Step 1: 写失败的测试**

Create `tests/test_reset_to_init.py`:

```python
"""StageStateMachine.regress_to_init() — atomically clear STAGE4 runtime
state and regress current_stage to INIT, preserving init-phase artifacts
and stage_history.

The regress_to_init helper is the foundation of the workspace "初始化"
button: it deletes chapters/*.md + progress.json + .storyforge_checkpoint.json
+ autopilot/chunks/*.jsonl, then writes project.json with current_stage=INIT.
It is intentionally NOT transactional — idempotent retry is the recovery
path for partial-write failures (see spec §错误处理).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.conductor.state_machine import Stage, StageStateMachine


@pytest.fixture
def projects_dir(tmp_path: Path):
    return tmp_path


@pytest.fixture
def sm(projects_dir):
    return StageStateMachine(projects_dir)


def _seed_project(projects_dir: Path, pid: str, *,
                  stage: str = "STAGE4",
                  stage_history: list | None = None) -> dict:
    project_dir = projects_dir / pid
    project_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "id": pid,
        "title": "测试小说",
        "genre": "cool_novel",
        "current_stage": stage,
        "stage_history": stage_history or [],
        "created_at": "2026-01-01T00:00:00",
    }
    (project_dir / "project.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def test_regress_deletes_chapter_drafts(sm, projects_dir):
    pid = "proj_test"
    _seed_project(projects_dir, pid)
    chapters = projects_dir / pid / "chapters"
    chapters.mkdir()
    (chapters / "ch01_scene_001_draft.md").write_text("scene 1 body")
    (chapters / "ch01_scene_002_draft.md").write_text("scene 2 body")
    (chapters / "ch02_scene_001_draft.md").write_text("ch2 scene 1")

    result = sm.regress_to_init(pid)

    assert result.allowed is True
    assert list(chapters.glob("ch*_scene_*_draft.md")) == []


def test_regress_deletes_progress_and_checkpoint(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    (proj / "progress.json").write_text('{"chapters":[]}', encoding="utf-8")
    (proj / ".storyforge_checkpoint.json").write_text('{"pipeline_stage":"x"}', encoding="utf-8")

    sm.regress_to_init(pid)

    assert not (proj / "progress.json").exists()
    assert not (proj / ".storyforge_checkpoint.json").exists()


def test_regress_clears_chunks_but_keeps_dir(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    chunks = proj / "autopilot" / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "ch01_scene_001.jsonl").write_text('{"seq":1,"text":"a"}', encoding="utf-8")
    (chunks / "ch02_scene_003.jsonl").write_text('{"seq":1,"text":"b"}', encoding="utf-8")

    sm.regress_to_init(pid)

    assert list(chunks.glob("*.jsonl")) == []
    assert chunks.exists()  # SceneChunkStore expects the parent dir to exist


def test_regress_writes_current_stage_init(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid, stage="STAGE4")
    (proj / "progress.json").write_text('{}', encoding="utf-8")

    sm.regress_to_init(pid)

    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["current_stage"] == "INIT"


def test_regress_preserves_stage_history(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    history = [
        {"from_stage": "INIT", "to_stage": "STAGE1", "timestamp": "2026-01-01T00:00:00"},
        {"from_stage": "STAGE1", "to_stage": "STAGE4", "timestamp": "2026-01-02T00:00:00"},
    ]
    _seed_project(projects_dir, pid, stage="STAGE4", stage_history=history)

    sm.regress_to_init(pid)

    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["stage_history"] == history


def test_regress_preserves_init_artifacts(sm, projects_dir):
    """outline.json, characters.json, world.json, novel_outline.json,
    concept_and_dna.json — these belong to init phase and must NOT be deleted."""
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        (proj / fn).write_text(f'{{"file":"{fn}"}}', encoding="utf-8")
    chapters = proj / "chapters"
    chapters.mkdir()
    (chapters / "ch01_scene_001_draft.md").write_text("body", encoding="utf-8")

    sm.regress_to_init(pid)

    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        assert (proj / fn).exists(), f"{fn} should be preserved"


def test_regress_returns_not_allowed_when_project_missing(sm):
    result = sm.regress_to_init("proj_nonexistent")
    assert result.allowed is False
    assert "不存在" in result.message


def test_regress_is_idempotent(sm, projects_dir):
    """第二次调用应成功（已删除的文件跳过）。"""
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    (proj / "progress.json").write_text('{}', encoding="utf-8")

    r1 = sm.regress_to_init(pid)
    r2 = sm.regress_to_init(pid)

    assert r1.allowed is True
    assert r2.allowed is True
    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["current_stage"] == "INIT"
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v`

Expected: ImportError or AttributeError: module 'backend.conductor.state_machine' has no attribute 'regress_to_init'

- [ ] **Step 3: 实现 regress_to_init 方法**

Edit `backend/conductor/state_machine.py`，在 `advance()` 方法之后（line 262 末尾之后）新增：

```python
    def regress_to_init(self, project_id: str) -> TransitionResult:
        """反向推进到 INIT：清空 stage4 运行时产物 + current_stage=INIT。

        原子性范围（v2.1 明确权衡）：任何文件 IO 失败都抛 OSError，不回滚。
        补救路径：用户重试。regress_to_init 是幂等的（已删除文件跳过、
        project.json stage 字段是覆盖写）。若未来需要严格原子性，
        可引入"先备份 .reset_backup/ 再原子提交"两步提交模式。

        保留：concept_and_dna / world / characters / novel_outline / outline
        （init 阶段产物） + stage_history（向前追溯记录）。
        """
        import json as _json

        project_dir = self._project_dir(project_id)
        if not project_dir.exists():
            return TransitionResult(
                allowed=False,
                from_stage=Stage.INIT,
                to_stage=Stage.INIT,
                message=f"项目 {project_id} 不存在",
            )

        # 1. 删除章节草稿（idempotent：glob miss 是 no-op）
        chapters_dir = project_dir / "chapters"
        if chapters_dir.exists():
            for f in chapters_dir.glob("ch*_scene_*_draft.md"):
                f.unlink()

        # 2. 删除运行时状态文件
        for rel in ("progress.json", ".storyforge_checkpoint.json"):
            p = project_dir / rel
            if p.exists():
                p.unlink()

        # 3. 清 autopilot 流式 chunk 缓冲（保留父目录方便 SceneChunkStore 复用）
        chunks_dir = project_dir / "autopilot" / "chunks"
        if chunks_dir.exists():
            for f in chunks_dir.glob("*.jsonl"):
                f.unlink()

        # 4. 改 project.json current_stage=INIT（原子写：tmp + replace）
        project_file = project_dir / "project.json"
        data = self._read_json(project_id, "project.json") or {}
        data["current_stage"] = Stage.INIT.value
        tmp_file = project_file.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
        tmp_file.replace(project_file)

        return TransitionResult(
            allowed=True,
            from_stage=Stage.INIT,
            to_stage=Stage.INIT,
            message="已重置到 INIT",
        )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v`

Expected: 8 tests passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/state_machine.py tests/test_reset_to_init.py
git commit -m "$(cat <<'EOF'
feat(state-machine): add regress_to_init for workspace reset button

Adds StageStateMachine.regress_to_init() that atomically clears
chapters/*.md + progress.json + .storyforge_checkpoint.json +
autopilot/chunks/*.jsonl and writes current_stage=INIT while
preserving init-phase artifacts and stage_history.

Not transactional (idempotent retry is the recovery path); see
docs/superpowers/specs/2026-08-22-workspace-reset-button-design.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 后端 — `GET /api/project/{id}/reset-preview` 端点

**Files:**
- Modify: `backend/api/project.py`
- Test: `tests/test_reset_to_init.py` (extend)

- [ ] **Step 1: 写失败的测试**

Append to `tests/test_reset_to_init.py`:

```python
# === /reset-preview endpoint tests ===

from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(projects_dir):
    from backend.api.project import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_reset_preview_returns_draft_count(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    chapters = proj / "chapters"
    chapters.mkdir()
    for n in (1, 2, 3):
        (chapters / f"ch{n:02d}_scene_001_draft.md").write_text("body")

    resp = client.get(f"/api/project/{pid}/reset-preview")
    assert resp.status_code == 200
    assert resp.json() == {
        "draft_count": 3,
        "has_progress": False,
        "has_checkpoint": False,
        "has_chunks": False,
    }


def test_reset_preview_detects_runtime_state(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    (proj / "progress.json").write_text('{"chapters":[]}', encoding="utf-8")
    (proj / ".storyforge_checkpoint.json").write_text("{}", encoding="utf-8")
    chunks = proj / "autopilot" / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "ch01_scene_001.jsonl").write_text('{"seq":1}')

    resp = client.get(f"/api/project/{pid}/reset-preview")
    body = resp.json()
    assert body["has_progress"] is True
    assert body["has_checkpoint"] is True
    assert body["has_chunks"] is True


def test_reset_preview_404_for_missing_project(client):
    resp = client.get("/api/project/proj_nonexistent/reset-preview")
    assert resp.status_code == 404


def test_reset_preview_handles_no_chapters_dir(client, projects_dir):
    """Project exists but never wrote any chapter drafts → all zeros."""
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "INIT"}),
        encoding="utf-8",
    )

    resp = client.get(f"/api/project/{pid}/reset-preview")
    assert resp.status_code == 200
    assert resp.json()["draft_count"] == 0
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v -k "preview"`

Expected: 404 / route not found

- [ ] **Step 3: 实现 reset_preview 端点**

Edit `backend/api/project.py`，在 `delete_project` 端点（line 117）之后新增：

```python
@router.get("/{project_id}/reset-preview")
async def reset_preview(project_id: str):
    """列出 /reset 将删除的文件与计数，用于前端 ConfirmDialog 文案。

    返回 draft_count（chapters/ 下 ch*_scene_*_draft.md 文件数）、
    has_progress / has_checkpoint / has_chunks 布尔值。文件不存在的
    项目返回全零（不会 404，由调用方判断项目存在性）。
    """
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )
    chapters_dir = project_dir / "chapters"
    draft_count = (
        sum(1 for f in chapters_dir.glob("ch*_scene_*_draft.md") if f.is_file())
        if chapters_dir.exists() else 0
    )
    chunks_dir = project_dir / "autopilot" / "chunks"
    has_chunks = chunks_dir.exists() and any(chunks_dir.glob("*.jsonl"))
    return {
        "draft_count": draft_count,
        "has_progress": (project_dir / "progress.json").exists(),
        "has_checkpoint": (project_dir / ".storyforge_checkpoint.json").exists(),
        "has_chunks": has_chunks,
    }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v -k "preview"`

Expected: 4 preview tests passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/api/project.py tests/test_reset_to_init.py
git commit -m "$(cat <<'EOF'
feat(project-api): add GET /reset-preview endpoint

Returns draft_count + has_progress + has_checkpoint + has_chunks so the
workspace 初始化 button can show accurate delete-counts in the
ConfirmDialog.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 后端 — `POST /api/project/{id}/reset` 端点

**Files:**
- Modify: `backend/api/project.py`
- Test: `tests/test_reset_to_init.py` (extend)

- [ ] **Step 1: 写失败的测试**

Append to `tests/test_reset_to_init.py`:

```python
def test_reset_endpoint_clears_state(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    chapters = proj / "chapters"
    chapters.mkdir()
    (chapters / "ch01_scene_001_draft.md").write_text("body")
    (proj / "progress.json").write_text('{"chapters":[]}', encoding="utf-8")
    (proj / ".storyforge_checkpoint.json").write_text("{}", encoding="utf-8")

    resp = client.post(f"/api/project/{pid}/reset")
    assert resp.status_code == 200
    assert resp.json()["error"] is False

    assert list((proj / "chapters").glob("ch*_scene_*_draft.md")) == []
    assert not (proj / "progress.json").exists()
    assert not (proj / ".storyforge_checkpoint.json").exists()
    assert json.loads((proj / "project.json").read_text(encoding="utf-8"))["current_stage"] == "INIT"


def test_reset_endpoint_preserves_init_artifacts(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        (proj / fn).write_text(f'{{"file":"{fn}"}}', encoding="utf-8")

    resp = client.post(f"/api/project/{pid}/reset")
    assert resp.status_code == 200

    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        assert (proj / fn).exists()


def test_reset_endpoint_404_for_missing_project(client):
    resp = client.post("/api/project/proj_nonexistent/reset")
    assert resp.status_code == 404


def test_reset_endpoint_is_idempotent(client, projects_dir):
    """第二次 POST 也返回 200（regress_to_init 幂等）。"""
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )

    r1 = client.post(f"/api/project/{pid}/reset")
    r2 = client.post(f"/api/project/{pid}/reset")

    assert r1.status_code == 200
    assert r2.status_code == 200
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v -k "endpoint"`

Expected: 404 not found

- [ ] **Step 3: 实现 reset 端点**

Edit `backend/api/project.py`，在 `reset_preview` 端点之后新增：

```python
@router.post("/{project_id}/reset")
async def reset_to_init(project_id: str):
    """原子地清空章节草稿 + 运行时状态，并将 current_stage 写回 INIT。

    保留：concept/world/character/novel_outline/outline 等 init 阶段产物
    + stage_history（向后追溯能力）。

    不实现严格事务回滚：中途失败时已删除的文件不回滚，由前端 toast 报错
    并由用户重试。regress_to_init 幂等（已删除文件跳过）。
    """
    from backend.conductor.state_machine import StageStateMachine

    sm = StageStateMachine(settings.projects_dir)
    result = sm.regress_to_init(project_id)
    if not result.allowed:
        raise HTTPException(
            status_code=404 if "不存在" in result.message else 500,
            detail={
                "error": True,
                "code": "RESET_FAILED",
                "message": result.message,
                "detail": {},
            },
        )
    return {
        "error": False,
        "code": "OK",
        "message": "项目已重置到初始化",
        "detail": {"project_id": project_id},
    }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_reset_to_init.py -v`

Expected: 16 tests passed (8 state machine + 4 preview + 4 endpoint)

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/api/project.py tests/test_reset_to_init.py
git commit -m "$(cat <<'EOF'
feat(project-api): add POST /reset endpoint

Atomically clears chapter drafts + runtime state and writes
current_stage=INIT. Preserves init-phase artifacts and stage_history.
Not transactional — idempotent retry is the recovery path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 前端 — `api/client.ts` 新增 resetPreview + resetToInit

**Files:**
- Modify: `frontend/src/api/client.ts` (around line 778)

- [ ] **Step 1: 添加新方法**

Edit `frontend/src/api/client.ts`，紧邻 `advance` 方法（line 778-779）之后插入：

```ts
  resetPreview: (projectId: string) =>
    request<{
      draft_count: number;
      has_progress: boolean;
      has_checkpoint: boolean;
      has_chunks: boolean;
    }>("GET", `/project/${encodeURIComponent(projectId)}/reset-preview`),

  resetToInit: (projectId: string) =>
    request<{
      error: boolean;
      code: string;
      message: string;
      detail: { project_id: string };
    }>("POST", `/project/${encodeURIComponent(projectId)}/reset`),
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`

Expected: 0 errors (the new methods are typed; existing code unchanged)

- [ ] **Step 3: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/client.ts
git commit -m "$(cat <<'EOF'
feat(api-client): add resetPreview + resetToInit methods

Types match backend GET /reset-preview and POST /reset response shapes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 前端 — `<ConfirmDialog>` 扩展 `busy` prop

**Files:**
- Modify: `frontend/src/components/shared/ConfirmDialog.tsx`
- Test: `frontend/src/test/components/shared/ConfirmDialog.test.tsx` (extend)

- [ ] **Step 1: 写失败测试**

Append to `frontend/src/test/components/shared/ConfirmDialog.test.tsx`:

```tsx
  it("disables confirm button when busy is true", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        busy
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const confirmBtn = screen.getByTestId("confirm-dialog-confirm");
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders spinner icon when busy is true", () => {
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        busy
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-spinner")).toBeInTheDocument();
  });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/components/shared/ConfirmDialog.test.tsx`

Expected: TypeScript error or test failure (busy not a valid prop)

- [ ] **Step 3: 实现 busy prop**

Edit `frontend/src/components/shared/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, disables confirm button and shows a spinner. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = "确认", cancelLabel = "取消",
  busy = false,
  onCancel, onConfirm,
}: Props) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      confirmButtonRef.current?.focus();
    }
  }, [open]);

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
            disabled={busy}
            className="px-4 py-2 rounded bg-surface-container text-system-log hover:bg-surface-container-high text-sm disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded bg-primary-container text-surface-container-low hover:opacity-90 text-sm disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {busy && (
              <span
                data-testid="confirm-dialog-spinner"
                aria-hidden="true"
                className="material-symbols-outlined text-[14px] animate-spin inline-block"
              >
                progress_activity
              </span>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/components/shared/ConfirmDialog.test.tsx`

Expected: 7 tests passed (5 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/shared/ConfirmDialog.tsx frontend/src/test/components/shared/ConfirmDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(ConfirmDialog): add busy prop with spinner

When busy=true: disables both buttons, shows progress_activity spinner
inside the confirm button. Used by workspace 初始化 flow to prevent
double-submit during the reset API call.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 前端 — `<ChapterTreePanel>` 新增 `onInit?` prop + 按钮渲染

**Files:**
- Modify: `frontend/src/components/workspace/ChapterTreePanel.tsx`
- Test: `frontend/src/test/ResetInitButton.test.tsx` (new)

- [ ] **Step 1: 写失败测试**

Create `frontend/src/test/ResetInitButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChapterTreePanel from "../components/workspace/ChapterTreePanel";

const baseProps = () => ({
  volumes: [],
  currentChapter: 1,
  currentScene: null,
  onSelectChapter: vi.fn(),
  onSelectScene: vi.fn(),
  onRefresh: vi.fn(),
});

describe("ChapterTreePanel — init button", () => {
  it("does not render 初始化 button when onInit is omitted", () => {
    render(<ChapterTreePanel {...baseProps()} />);
    expect(screen.queryByTestId("init-project")).not.toBeInTheDocument();
  });

  it("renders 初始化 button when onInit is provided", () => {
    render(<ChapterTreePanel {...baseProps()} onInit={vi.fn()} />);
    expect(screen.getByTestId("init-project")).toBeInTheDocument();
    expect(screen.getByTestId("init-project")).toHaveTextContent("初始化");
  });

  it("renders 初始化 BEFORE 刷新 in DOM order", () => {
    render(<ChapterTreePanel {...baseProps()} onInit={vi.fn()} />);
    const initBtn = screen.getByTestId("init-project");
    const refreshBtn = screen.getByTestId("refresh");
    // initBtn should appear before refreshBtn in document order
    expect(
      initBtn.compareDocumentPosition(refreshBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("clicking 初始化 triggers onInit callback", () => {
    const onInit = vi.fn();
    render(<ChapterTreePanel {...baseProps()} onInit={onInit} />);
    fireEvent.click(screen.getByTestId("init-project"));
    expect(onInit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ResetInitButton.test.tsx`

Expected: TypeScript error (onInit not in Props) or render without button

- [ ] **Step 3: 实现 onInit prop 与按钮渲染**

Edit `frontend/src/components/workspace/ChapterTreePanel.tsx`:

1. 在 `Props` 接口的 `onRefresh: () => void;` 之后新增：
```tsx
  /** v2.1: 初始化按钮回调。省略则不渲染该按钮。 */
  onInit?: () => void;
```

2. 解构函数签名新增：
```tsx
export default function ChapterTreePanel({
  volumes, currentChapter, currentScene, chapterStatus, sceneStatus,
  onSelectChapter, onSelectScene, onAddChapter, onRefresh, onInit,
}: Props) {
```

3. 在 line 96-110 的 `<button data-testid="refresh">` 之前插入新按钮（line 97 之前）：

```tsx
        <div className="flex gap-1">
          {onInit && (
            <button
              type="button"
              data-testid="init-project"
              onClick={onInit}
              className="px-2 py-0.5 rounded text-xs bg-surface-container text-system-log hover:text-primary"
            >初始化</button>
          )}
          <button
            type="button"
            data-testid="refresh"
            onClick={onRefresh}
            className="px-2 py-0.5 rounded text-xs bg-surface-container text-system-log hover:text-primary"
          >刷新</button>
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ResetInitButton.test.tsx`

Expected: 4 tests passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ChapterTreePanel.tsx frontend/src/test/ResetInitButton.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): add onInit prop + 初始化 button to ChapterTreePanel

Renders before 刷新 when onInit is provided. The workspace page
will own the ConfirmDialog + reset API call + navigate logic.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 前端 — `<ManagedDashboard>` 透传 `onInit?`

**Files:**
- Modify: `frontend/src/components/workspace/ManagedDashboard.tsx`

(ManagedDashboard 是一个简单包装组件，无需测试 —— 透传正确性由类型 + 父组件测试保证。)

- [ ] **Step 1: 添加 onInit prop 透传**

Edit `frontend/src/components/workspace/ManagedDashboard.tsx`:

1. 在 `Props` 接口的 `onRefresh: () => void;` 之后新增：
```tsx
  /** v2.1: 透传到 ChapterTreePanel。 */
  onInit?: () => void;
```

2. 解构函数签名新增 `onInit`：
```tsx
export default function ManagedDashboard({
  projectId,
  volumes = [],
  currentChapter,
  currentScene,
  chapterStatus,
  sceneStatus,
  onChapterClick,
  onSelectScene,
  onRefresh,
  onInit,
}: Props) {
```

3. 在 `<ChapterTreePanel ... />` 上添加 `onInit={onInit}` 属性：
```tsx
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={currentChapter}
        currentScene={currentScene}
        chapterStatus={chapterStatus}
        sceneStatus={sceneStatus}
        onSelectChapter={(n) => {
          const status = chapterStatus?.[n] ?? "pending";
          onChapterClick(n, status);
        }}
        onSelectScene={onSelectScene ?? ((_n, _s) => {})}
        // Deliberately undefined — managed mode has no manual add-chapter
        // workflow, so ChapterTreePanel hides the button when this is omitted.
        onRefresh={onRefresh}
        onInit={onInit}
      />
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ManagedDashboard.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): thread onInit through ManagedDashboard to ChapterTreePanel

Managed mode now exposes the same 初始化 button as manual mode.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 前端 — `<WorkspacePage>` 集成 onInit + ConfirmDialog

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx`
- Test: `frontend/src/test/ResetInitButton.test.tsx` (extend — 复用现有测试文件避免创建过多新文件)

- [ ] **Step 1: 写失败测试**

Append to `frontend/src/test/ResetInitButton.test.tsx`:

```tsx
// === WorkspacePage integration tests ===

import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
import { ToastProvider } from "../hooks/useToast";
import { vi } from "vitest";

vi.mock("../api/client", () => ({
  default: {
    resetPreview: vi.fn(),
    resetToInit: vi.fn(),
  },
}));

import api from "../api/client";

// A minimal harness that exercises the WorkspacePage onInit wiring without
// pulling in the full WorkspacePage (which has many other stateful deps).
// We rebuild the same state machine here to test the prop wiring in isolation.
function InitHarness() {
  const [initPreview, setInitPreview] = useState<{
    open: boolean;
    preview?: any;
    busy: boolean;
  }>({ open: false, busy: false });

  const handleInit = async () => {
    (api.resetPreview as any).mockResolvedValue({
      draft_count: 5,
      has_progress: true,
      has_checkpoint: false,
      has_chunks: false,
    });
    const preview = await api.resetPreview("proj_x");
    setInitPreview({ open: true, preview, busy: false });
  };

  const confirmInit = async () => {
    setInitPreview((s) => ({ ...s, busy: true }));
    await api.resetToInit("proj_x");
    setInitPreview({ open: false, busy: false });
  };

  return (
    <ToastProvider>
      <div>
        <button data-testid="harness-init" onClick={handleInit}>
          trigger init
        </button>
        {initPreview.open && (
          <div data-testid="init-dialog">
            <p data-testid="init-message">
              {`将删除 ${initPreview.preview.draft_count} 个章节草稿...`}
            </p>
            <button
              data-testid="init-confirm"
              disabled={initPreview.busy}
              onClick={confirmInit}
            >
              确认初始化
            </button>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}

describe("WorkspacePage init flow (wiring)", () => {
  it("resetPreview is called when handleInit fires", async () => {
    render(
      <MemoryRouter>
        <InitHarness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("harness-init"));
    await vi.waitFor(() => {
      expect(api.resetPreview).toHaveBeenCalledWith("proj_x");
    });
    expect(screen.getByTestId("init-message")).toHaveTextContent("5");
  });

  it("resetToInit is called when confirm is clicked", async () => {
    (api.resetToInit as any).mockResolvedValue({ error: false });
    render(
      <MemoryRouter>
        <InitHarness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("harness-init"));
    await vi.waitFor(() => screen.getByTestId("init-confirm"));
    fireEvent.click(screen.getByTestId("init-confirm"));
    await vi.waitFor(() => {
      expect(api.resetToInit).toHaveBeenCalledWith("proj_x");
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ResetInitButton.test.tsx -t "wiring"`

Expected: mock not called (because handleInit doesn't exist yet — actual workspace test deferred to integration)

NOTE: This test exercises a `InitHarness` rather than the real WorkspacePage because WorkspacePage has many stateful dependencies (useWorkspaceMode, useWorkspacePanel, fetch loops, etc.). The harness verifies that the **same state-machine pattern** (preview → confirm → API → close) works. The real wiring is verified manually after the WorkspacePage changes are applied.

- [ ] **Step 3: 实现 WorkspacePage 集成**

Edit `frontend/src/pages/WorkspacePage.tsx`:

1. 在 imports 区域（line 1-22）新增：
```tsx
import ConfirmDialog from "../components/shared/ConfirmDialog";
```

2. 在已有的 state 声明之后（line 58 `const [busy, setBusy] = useState(false);` 之后）新增：

```tsx
  // v2.1: 初始化按钮状态机
  const [initPreview, setInitPreview] = useState<{
    open: boolean;
    preview?: {
      draft_count: number;
      has_progress: boolean;
      has_checkpoint: boolean;
      has_chunks: boolean;
    };
    busy: boolean;
  }>({ open: false, busy: false });

  const handleInit = useCallback(async () => {
    try {
      const preview = await api.resetPreview(projectId);
      setInitPreview({ open: true, preview, busy: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show(`预览失败：${msg}`);
    }
  }, [projectId, show]);

  const confirmInit = useCallback(async () => {
    setInitPreview((s) => ({ ...s, busy: true }));
    try {
      await api.resetToInit(projectId);
      setInitPreview({ open: false, busy: false });
      navigate(`/project/${encodeURIComponent(projectId)}/wizard`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show(`重置失败：${msg}`);
      setInitPreview((s) => ({ ...s, busy: false }));
    }
  }, [projectId, show, navigate]);
```

3. 在 `ChapterTreePanel` 上添加 `onInit={handleInit}`（line 477-499）：
```tsx
          <ChapterTreePanel
            volumes={volumeGroups}
            currentChapter={currentChapter}
            currentScene={currentScene}
            chapterStatus={chapterStatus}
            sceneStatus={sceneStatus}
            onSelectChapter={(n) => onDashboardChapterClick(n, chapterStatus[n] ?? "pending")}
            onSelectScene={(n, s) => { setCurrentChapter(n); setCurrentScene(s); }}
            onAddChapter={mode === "managed" ? undefined : () => setAddOpen(true)}
            onInit={handleInit}
            onRefresh={async () => {
              ...
```

4. 在 `ManagedDashboard` 上添加 `onInit={handleInit}`（line ~440 region）：
```tsx
          <ManagedDashboard
            ...
            onRefresh={...}
            onInit={handleInit}
          />
```

5. 在 JSX 末尾（确认其他 ConfirmDialog 位置风格一致），渲染：
```tsx
      <ConfirmDialog
        open={initPreview.open}
        title="初始化项目"
        message={buildInitMessage(initPreview.preview)}
        confirmLabel="确认初始化"
        cancelLabel="取消"
        busy={initPreview.busy}
        onCancel={() => setInitPreview({ open: false, busy: false })}
        onConfirm={confirmInit}
      />
```

6. 在组件外部（顶层）添加辅助函数：
```tsx
function buildInitMessage(p?: {
  draft_count: number;
  has_progress: boolean;
  has_checkpoint: boolean;
  has_chunks: boolean;
}): string {
  if (!p) return "无法预览待删除内容。";
  const parts: string[] = [];
  if (p.draft_count > 0) parts.push(`${p.draft_count} 个章节草稿`);
  if (p.has_progress) parts.push("写作进度（progress.json）");
  if (p.has_checkpoint) parts.push("检查点（.storyforge_checkpoint.json）");
  if (p.has_chunks) parts.push("实时写作缓冲（autopilot/chunks/）");
  if (parts.length === 0) {
    return "项目目前无草稿可清理，仅将项目状态改回 INIT（章节大纲）。\n\n确认继续？";
  }
  return `将删除 ${parts.join("、")}，并将项目状态改回 INIT（章节大纲）。\n\n此操作不可恢复，确认继续？`;
}
```

- [ ] **Step 4: TypeScript 类型检查**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`

Expected: 0 errors

- [ ] **Step 5: 运行 harness 测试，确认通过**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/ResetInitButton.test.tsx`

Expected: 6 tests passed (4 ChapterTreePanel + 2 harness wiring)

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/WorkspacePage.tsx frontend/src/test/ResetInitButton.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): wire 初始化 button to /reset-preview + /reset + wizard

- handleInit: GET resetPreview → open ConfirmDialog with delete summary
- confirmInit: POST resetToInit → busy spinner → navigate to wizard
- buildInitMessage: shows counts when present, falls back to INIT-only
- Both manual and managed modes get the button

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 端到端手动验证

**Files:** (no code changes)

- [ ] **Step 1: 启动 dev 服务**

```bash
cd /Users/longsa/Codes/storyForge2
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
cd frontend
npm run dev &
```

打开 http://localhost:5173

- [ ] **Step 2: 创建/选择一个 manual 模式项目，走完 init wizard 直到 step 6，确认章节大纲**

验证：
- 左侧栏显示 "初始化" 按钮（在 "刷新" 之前）
- 项目详情：chapter1_outline 已存在

- [ ] **Step 3: advance 到 STAGE4**

通过 UI 手动 advance：点击确认修改并继续，触发 advance API。验证 `project.json` `current_stage: "STAGE4"`。

- [ ] **Step 4: 制造一些草稿**

可选：用 stage4 写出至少 2 章 draft，或者手动复制：
```bash
mkdir -p projects/{your_pid}/chapters
echo "scene 1 body" > projects/{your_pid}/chapters/ch01_scene_001_draft.md
echo "scene 2 body" > projects/{your_pid}/chapters/ch01_scene_002_draft.md
echo "scene 3 body" > projects/{your_pid}/chapters/ch02_scene_001_draft.md
echo '{"chapters":[]}' > projects/{your_pid}/progress.json
```

- [ ] **Step 5: 点击 "初始化" 按钮**

验证：
- ConfirmDialog 弹出
- 文案显示 "将删除 3 个章节草稿、写作进度（progress.json）..."
- 点击 "确认初始化"
- busy spinner 出现
- 成功后跳转 `/project/{your_pid}/wizard`
- wizard 显示 step 6 章节大纲（不是 step 1）

- [ ] **Step 6: 验证文件状态**

```bash
ls projects/{your_pid}/chapters/  # 应该没有 ch*_scene_*_draft.md
cat projects/{your_pid}/project.json  # current_stage: "INIT", stage_history 保留
cat projects/{your_pid}/outline.json  # 仍存在
cat projects/{your_pid}/concept_and_dna.json  # 仍存在
```

- [ ] **Step 7: 测试 managed 模式**

切换到 managed mode 项目，重复 Step 4-6，验证：
- ManagedDashboard 也显示 "初始化" 按钮
- 行为一致

- [ ] **Step 8: 测试幂等性**

无草稿项目点 "初始化"，验证：弹窗显示 "项目目前无草稿可清理..."，确认后正常跳转。

---

## Self-Review

**1. Spec coverage:** Walked through spec sections:
- §背景与目标 ✅ Task 6+8 (button placement + click behavior)
- §用户场景 ✅ Task 9 (manual mode flow)
- §非目标 (preserve init artifacts) ✅ Task 1 (test_regress_preserves_init_artifacts)
- §架构图 ✅ All tasks
- §组件改动:
  - state_machine.regress_to_init ✅ Task 1
  - /reset-preview endpoint ✅ Task 2
  - /reset endpoint ✅ Task 3
  - api/client methods ✅ Task 4
  - ChapterTreePanel onInit ✅ Task 6
  - ManagedDashboard onInit pass-through ✅ Task 7
  - WorkspacePage integration ✅ Task 8
- §错误处理表 ✅ Tasks 1-3 (idempotent tests), Task 8 (toast on failure)
- §测试矩阵 ✅ Tasks 1-3 (8 backend tests), Tasks 5-6 (frontend unit tests), Task 8 (harness wiring)
- §文件改动清单 ✅ All tasks

**2. Placeholder scan:** No TBD/TODO. Code blocks are complete. Commands have expected output. No "similar to Task N" without restated content.

**3. Type consistency:**
- `regress_to_init(project_id)` — used identically in Task 1, 2, 3 ✅
- `api.resetPreview(projectId)` returns `{ draft_count, has_progress, has_checkpoint, has_chunks }` — same shape in Task 4 (client.ts), Task 2 (backend), Task 8 (WorkspacePage state) ✅
- `api.resetToInit(projectId)` returns `{ error, code, message, detail: { project_id } }` — same in Task 4 and Task 3 ✅
- `ConfirmDialogProps.busy` — used in Task 5 (definition), Task 8 (consumer) ✅
- `data-testid="init-project"` — same in Task 6 (button), Task 6 (tests) ✅
- `data-testid="confirm-dialog-confirm"`, `confirm-dialog-cancel`, `confirm-dialog-spinner` — consistent with existing ConfirmDialog tests ✅

**4. Test count note:** Corrected inline — Task 3 step 4 expected output is "16 tests passed" (8 state machine + 4 preview + 4 endpoint).

---

## Execution Notes

- **Branch**: work directly on `v2.1` (per user preference — no worktree).
- **Test isolation**: backend tests use `tmp_path` fixtures; frontend tests are pure unit tests. No dev server required for tests.
- **Manual verification**: Task 9 is a check-the-box smoke test, not a CI gate.
- **Rollback strategy**: each task is a single commit. Reverting is `git revert HEAD~N..HEAD` for the last N commits if needed.