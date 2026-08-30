# "+ 新建项目" 表单字段重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 "+ 新建项目" 中的"创作意图"输入（移至"创意发散"步骤），并将"项目名称"改为必填。

**Architecture:** 彻底删除 `Project.initial_intent` 字段（不留 fallback）。Stage1 概念生成改为从 `creative_divergence.json.prompt` 读取创作意图，读不到则返回 400 `INTENT_MISSING`，引导用户回 wizard step 1 补填。设计原则：契约先行，后端先动，前端跟随，最后回归。

**Tech Stack:** Python (FastAPI + Pydantic v2) · React 18 + TypeScript + Vite · Vitest + Pytest

---

## 文件结构（本次涉及）

### 修改（按任务顺序）

| 文件 | 任务 | 责任 |
|------|------|------|
| `backend/models/project.py` | Task 1 | 删除 `InitialIntent` 类与 `Project.initial_intent` 字段 |
| `backend/models/__init__.py` | Task 1 | 移除 `InitialIntent` 导入与导出 |
| `backend/api/project.py` | Task 2 | `create_project` 不再接收 intent/title 兜底/title 必填校验 |
| `backend/api/stage1_concept.py` | Task 3 | 两处改为读 `creative_divergence.json.prompt` |
| `frontend/src/components/home/CreateProjectModal.tsx` | Task 4 | 删 intent 块；title 加红 * 必填 |
| `frontend/src/components/layout/HomeLayout.tsx` | Task 5 | `handleCreate` 去掉 intent 参数 |
| `frontend/src/hooks/useProject.ts` | Task 5 | `createProject` 签名更新 |
| `frontend/src/api/client.ts` | Task 5 | `createProject` 函数参数；`Project` 接口 |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | Task 6 | 文案/placeholder 更新 |

### 测试修改

| 文件 | 任务 | 说明 |
|------|------|------|
| `tests/test_integration_e2e.py` | Task 2, 7 | fixture 移除 free_text；title 必填断言 |
| `tests/test_concept_source_field.py` | Task 7 | 移除 free_text |
| `tests/test_canvas_mutation_context.py` | Task 7 | 移除 initial_intent |
| `tests/test_stage3_outline_context.py` | Task 7 | 移除 free_text，注入 creative_divergence.json |
| `tests/test_style_extractor.py` | Task 7 | 移除 free_text，注入 creative_divergence.json |
| `tests/test_creative_canvas_reset.py` | Task 7 | 移除 initial_intent |
| `tests/test_genre_template_propagation.py` | Task 7 | 移除 initial_intent 参数 |
| `tests/test_creative_canvas_api.py` | Task 7 | 移除 initial_intent |
| `tests/test_canvas_commit.py` | Task 7 | 移除 initial_intent |
| `tests/test_creative_canvas_select_persistence.py` | Task 7 | 移除 initial_intent |
| `tests/test_stage6_export.py` | Task 7 | 移除 free_text/initial_intent |
| `tests/test_creative_canvas_choose_branch.py` | Task 7 | 移除 initial_intent |
| `tests/test_stage3_novel_outline.py` | Task 7 | 移除 free_text |
| `tests/test_volume_scoped_chapter_outline_e2e.py` | Task 7 | 移除 free_text/concept.free_text |
| `tests/test_settings_api.py` | Task 7 | 移除 free_text |
| `tests/test_user_modifications.py` | Task 7 | 移除 initial_intent，注入 creative_divergence.json |
| `backend/tests/test_stage2_regenerate_world_section.py` | Task 7 | 移除 initial_intent |
| `backend/tests/test_stage2_regenerate_power_system_item.py` | Task 7 | 移除 initial_intent |
| `backend/tests/test_stage1_regenerate_section.py` | Task 3, 7 | 注入 creative_divergence.json |
| `frontend/src/test/HomePage.test.tsx` | Task 5, 7 | `intent-input` → `title-input` |
| `frontend/src/test/client.test.ts` | Task 5, 7 | 去掉 intent 参数 |
| `frontend/src/test/CreateProjectModal.test.tsx` | Task 4, 7 | 新增 title 必填断言 |
| `frontend/src/components/wizard/CreativeDivergenceStep.test.tsx` | Task 6, 7 | 文案断言更新 |

### 不修改

- `frontend/src/pages/InitPage.tsx` — 无路由使用（死代码）
- `backend/agents/planner.py` — `initial_intent` 参数名保留
- `backend/api/creative_divergence.py` — 已有 prompt 字段不变

---

## Task 1: 后端 Project 模型删除 InitialIntent 字段

**Files:**
- Modify: `backend/models/project.py:1-32`
- Modify: `backend/models/__init__.py:1-50`

- [ ] **Step 1: 修改 backend/models/project.py，删除 InitialIntent 类与 Project.initial_intent 字段**

`backend/models/project.py` 全文替换为：

```python
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class StageTransition(BaseModel):
    from_stage: str
    to_stage: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Project(BaseModel):
    id: str
    title: str = ""
    genre: str = "cool_novel"
    min_words: int = 2000
    # Target novel length picked at create time. The label mirrors the
    # CreateProjectCard LENGTHS options (短篇快穿 / 标准商业连载 / 宏大史诗巨著);
    # chapter count is derived as target_total_words / min_words.
    target_total_words: int = 1_000_000
    target_length_category: str = "标准商业连载"
    current_stage: str = "INIT"
    stage_history: list[StageTransition] = []
    genre_thresholds: Optional[dict] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Concept(BaseModel):
    title: str = ""
    genre: str = "cool_novel"
    premise: str = ""
    tone: str = ""
    theme: str = ""
    target_audience: str = "男性向"
    style_template: str = "cool_novel"


class StoryDNA(BaseModel):
    core_contradiction: dict = Field(
        default_factory=lambda: {"statement": "", "side_a": "", "side_b": ""}
    )
    value_stack: list[dict] = []


class ConceptAndDNA(BaseModel):
    concept: Concept
    story_dna: StoryDNA
```

- [ ] **Step 2: 修改 backend/models/__init__.py，移除 InitialIntent**

将 `backend/models/__init__.py` 第 2 行的：
```python
    Project, Concept, StoryDNA, ConceptAndDNA, InitialIntent, StageTransition,
```
改为：
```python
    Project, Concept, StoryDNA, ConceptAndDNA, StageTransition,
```

将第 45 行的：
```python
    "Project", "Concept", "StoryDNA", "ConceptAndDNA", "InitialIntent", "StageTransition",
```
改为：
```python
    "Project", "Concept", "StoryDNA", "ConceptAndDNA", "StageTransition",
```

- [ ] **Step 3: 运行后端测试验证模型导入正常**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && python -c "from backend.models.project import Project; print(Project.model_fields.keys())"
```

预期输出包含：`dict_keys(['id', 'title', 'genre', 'min_words', 'target_total_words', 'target_length_category', 'current_stage', 'stage_history', 'genre_thresholds', 'created_at'])` — 不包含 `initial_intent`。

- [ ] **Step 4: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/models/project.py backend/models/__init__.py && git commit -m "refactor(model): drop Project.initial_intent field; intent lives in creative_divergence.json"
```

---

## Task 2: 后端 project.py create_project 改 title 必填

**Files:**
- Modify: `backend/api/project.py:9,116-164`

- [ ] **Step 1: 修改 create_project 函数，删除 intent/free_text 取值，新增 title 必填校验**

将 `backend/api/project.py` 第 9 行：
```python
from backend.models.project import Project, InitialIntent
```
改为：
```python
from backend.models.project import Project
```

将 `create_project` 函数（第 116-164 行）整段替换为：

```python
@router.post("/create")
async def create_project(data: dict):
    # Title is the only free-text identity we capture at create time.
    # Creative intent is collected later in the init wizard step 1
    # (CreativeDivergenceStep) and lives in `creative_divergence.json`.
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "项目名称必填",
                "detail": {},
            },
        )
    genre = data.get("genre", "cool_novel")
    # Per-chapter target is uniform across the new length options (短篇快穿 /
    # 标准商业连载 / 宏大史诗巨著), each ~2000 字/章 — see CreateProjectCard.tsx.
    # Old clients still send `min_words` directly; accept it but default to 2000.
    min_words = data.get("min_words", 2000)
    target_total_words = data.get("target_total_words", 1_000_000)
    target_length_category = data.get("target_length_category", "标准商业连载")

    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    project = Project(
        id=project_id,
        title=title,
        genre=genre,
        min_words=min_words,
        target_total_words=target_total_words,
        target_length_category=target_length_category,
        current_stage="INIT",
        created_at=datetime.utcnow().isoformat(),
    )

    fm.write_json(project_id, "project.json", project.model_dump())

    return {
        "error": False,
        "code": "OK",
        "message": "项目创建成功",
        "detail": project.model_dump(),
    }
```

- [ ] **Step 2: 写后端测试验证 title 必填**

打开 `tests/test_integration_e2e.py`，修改 `project_data` fixture（第 16-24 行）：

```python
@pytest.fixture
def project_data():
    return {
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
    }
```

修改 `test_create_project_validation`（第 54-56 行）：

```python
    def test_create_project_validation(self, client):
        resp = client.post("/api/project/create", json={"title": ""})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
        assert resp.json()["detail"]["message"] == "项目名称必填"

    def test_create_project_missing_title(self, client):
        resp = client.post("/api/project/create", json={"genre": "cool_novel"})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
```

- [ ] **Step 3: 运行 e2e 测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_integration_e2e.py::TestProjectLifecycle -v
```

预期：5 个测试全部 PASS（test_health / test_create_project / test_create_project_validation / test_create_project_missing_title / test_get_project_status / test_get_project_not_found）。

- [ ] **Step 4: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/project.py tests/test_integration_e2e.py && git commit -m "feat(api): make project title required; drop intent/free_text at create time"
```

---

## Task 3: stage1_concept 改为读 creative_divergence.json

**Files:**
- Modify: `backend/api/stage1_concept.py:60-96, 196-228`

- [ ] **Step 1: 在 stage1_concept.py 顶部添加辅助函数**

在 `backend/api/stage1_concept.py` 第 14 行（`router = APIRouter(...)` 之前）后插入：

```python


def _read_creative_intent(project_id: str) -> str:
    """Return the creative-intent prompt from the latest creative-divergence run.

    Raises 400 INTENT_MISSING when no creative_divergence.json (or empty prompt)
    exists — caller is expected to redirect the user back to wizard step 1
    (CreativeDivergenceStep) to fill the intent. We do NOT fall back to any
    legacy project.json.initial_intent.free_text: that field was removed in
    v2.x; existing pre-removal projects without creative_divergence.json are
    expected to revisit step 1.
    """
    cd = fm.read_json(project_id, "creative_divergence.json") or {}
    prompt = (cd.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INTENT_MISSING",
                "message": "请先完成创意发散",
                "detail": {},
            },
        )
    return prompt
```

- [ ] **Step 2: 修改 generate_concept 函数调用处（第 71-72 行）**

将：
```python
        result, response = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
            user_modifications=user_modifications,
        )
```
改为：
```python
        result, response = await agent.generate_concept_and_dna(
            initial_intent=_read_creative_intent(project_id),
            genre=project.get("genre", "cool_novel"),
            user_modifications=user_modifications,
        )
```

- [ ] **Step 3: 修改 regenerate_section 函数调用处（第 208-213 行）**

将：
```python
    try:
        result, _resp = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
            user_modifications=payload.user_modifications,
        )
```
改为：
```python
    try:
        result, _resp = await agent.generate_concept_and_dna(
            initial_intent=_read_creative_intent(project_id),
            genre=project.get("genre", "cool_novel"),
            user_modifications=payload.user_modifications,
        )
```

- [ ] **Step 4: 在 backend/tests/test_stage1_regenerate_section.py 的 _write_project 中移除 initial_intent 并新增 creative_divergence.json 注入**

修改 `backend/tests/test_stage1_regenerate_section.py` 中的 `_write_project` 函数（找到该函数定义，约第 30-40 行）：

```python
def _write_project(tmp_path: Path) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({
            "id": PROJ,
            "genre": "cool_novel",
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    (tmp_path / PROJ / "creative_divergence.json").write_text(
        json.dumps({
            "prompt": "一个少年在废墟里觉醒",
            "variants": [],
            "selected_id": None,
        }, ensure_ascii=False),
        encoding="utf-8",
    )
```

- [ ] **Step 5: 写测试验证 INTENT_MISSING 行为**

打开 `tests/test_integration_e2e.py`，在 `TestConductorStageTransitions` 类下新增测试方法：

```python
    def test_stage1_generate_without_creative_divergence_returns_intent_missing(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        # advance to STAGE1
        client.post("/api/conductor/advance", json={
            "project_id": proj_id,
            "target_stage": "STAGE1",
        })
        resp = client.post("/api/stage1/generate", json={"project_id": proj_id, "user_modifications": ""})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INTENT_MISSING"
```

- [ ] **Step 6: 运行 stage1 相关测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_integration_e2e.py backend/tests/test_stage1_regenerate_section.py -v
```

预期：所有测试 PASS，包含新增的 `test_stage1_generate_without_creative_divergence_returns_intent_missing`。

- [ ] **Step 7: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage1_concept.py backend/tests/test_stage1_regenerate_section.py tests/test_integration_e2e.py && git commit -m "feat(stage1): read creative intent from creative_divergence.json, not project.json"
```

---

## Task 4: 前端 CreateProjectModal 删 intent、title 必填

**Files:**
- Modify: `frontend/src/components/home/CreateProjectModal.tsx:1-225`

- [ ] **Step 1: 修改 CreateProjectModal.tsx props 接口**

将 `CreateProjectModalProps` 接口（第 11-24 行）：

```typescript
interface CreateProjectModalProps {
  isOpen: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (data: {
    title?: string;
    genre: string;
    min_words: number;
    target_total_words: number;
    target_length_category: string;
  }) => Promise<void>;
  onClose: () => void;
}
```

- [ ] **Step 2: 删除 intent state 和 submit 中的 intent 校验**

将函数组件（第 26-56 行）整段替换为：

```tsx
export default function CreateProjectModal({
  isOpen,
  submitting,
  error,
  onSubmit,
  onClose,
}: CreateProjectModalProps) {
  const genres = useGenres(true);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("cool_novel");
  const [lengthIdx, setLengthIdx] = useState(DEFAULT_LENGTH_INDEX); // default: 标准商业连载
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isOpen) return null;

  const selectedLength = LENGTHS[lengthIdx];
  const targetTotalWords = selectedLength.value;
  const chapterCount = Math.max(1, Math.round(targetTotalWords / WORDS_PER_CHAPTER));

  const submit = async () => {
    if (!title.trim() || submitting) return;
    await onSubmit({
      title: title.trim(),
      genre,
      min_words: WORDS_PER_CHAPTER,
      target_total_words: targetTotalWords,
      target_length_category: selectedLength.label,
    });
  };
```

- [ ] **Step 3: 删除"创作意图" textarea 块（第 81-94 行）**

删除整个：
```tsx
          <div>
            <label className="block font-mono text-on-surface-variant mb-1 text-xs">
              创作意图 <span className="text-error">*</span>
            </label>
            <textarea
              data-testid="intent-input"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力..."
              className="w-full h-28 bg-surface-container border border-outline-variant rounded-lg px-4 py-3
                         text-sm text-primary placeholder:text-on-surface-variant/50
                         focus:outline-none focus:border-primary resize-none"
            />
          </div>
```

- [ ] **Step 4: "项目名称" label 加红 * 并修改 placeholder**

将项目名称 input 块（第 97-109 行）替换为：

```tsx
            <div>
              <label className="block font-mono text-on-surface-variant mb-1 text-xs">
                项目名称 <span className="text-error">*</span>
              </label>
              <input
                data-testid="title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="为这个项目起一个名字"
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                           text-sm text-primary placeholder:text-on-surface-variant/50
                           focus:outline-none focus:border-primary"
              />
            </div>
```

- [ ] **Step 5: 修改提交按钮 disabled 条件**

将第 214 行 `disabled={!intent.trim() || submitting}` 改为：

```tsx
            disabled={!title.trim() || submitting}
```

- [ ] **Step 6: 在 CreateProjectModal.test.tsx 中新增 title 必填断言**

打开 `frontend/src/test/CreateProjectModal.test.tsx`，在文件末尾追加：

```tsx
  it("renders the title-required marker and disabled submit when title empty", () => {
    render(
      <CreateProjectModal
        isOpen
        submitting={false}
        error={null}
        onSubmit={async () => {}}
        onClose={() => {}}
      />
    );
    // The 项目名称 label carries the red asterisk marker
    const labels = screen.getAllByText("项目名称");
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0].parentElement?.textContent).toContain("*");
    // Submit button is disabled before title is filled
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit when title is filled", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { fireEvent } = await import("@testing-library/react");
    render(
      <CreateProjectModal
        isOpen
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onClose={() => {}}
      />
    );
    fireEvent.input(screen.getByTestId("title-input"), { target: { value: "我的新项目" } });
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: "我的新项目" })
    );
  });
```

- [ ] **Step 7: 运行 CreateProjectModal 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- CreateProjectModal
```

预期：4 个测试全部 PASS（原有 2 个 + 新增 2 个）。

- [ ] **Step 8: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/home/CreateProjectModal.tsx frontend/src/test/CreateProjectModal.test.tsx && git commit -m "feat(ui): drop 创作意图 from create-project modal; make 项目名称 required"
```

---

## Task 5: 前端 HomeLayout + useProject + client 调整

**Files:**
- Modify: `frontend/src/components/layout/HomeLayout.tsx:59-78`
- Modify: `frontend/src/hooks/useProject.ts:1-70`
- Modify: `frontend/src/api/client.ts:130-141, 783-790`

- [ ] **Step 1: 修改 frontend/src/api/client.ts：Project 接口与 createProject 函数**

将第 130-141 行 `Project` 接口：

```typescript
export interface Project {
  id: string;
  title: string;
  genre: string;
  min_words: number;
  target_total_words: number;
  target_length_category: string;
  current_stage: string;
  stage_history: Array<{ from: string; to: string; timestamp: string }>;
  created_at: string;
}
```

将第 783-790 行 `createProject`：

```typescript
  createProject: (data: {
    title: string;
    genre: string;
    min_words: number;
    target_total_words: number;
    target_length_category: string;
  }) => request<Project>("POST", "/project/create", data),
```

- [ ] **Step 2: 修改 useProject.ts：createProject 签名**

将整个 `frontend/src/hooks/useProject.ts` 文件替换为：

```typescript
import { useState, useCallback } from "react";
import api, { Project, ProjectStatus, ApiError } from "../api/client";

interface CreateProjectParams {
  title: string;
  genre: string;
  min_words: number;
  target_total_words: number;
  target_length_category: string;
}

interface UseProjectReturn {
  project: Project | null;
  projectStatus: ProjectStatus | null;
  loading: boolean;
  error: string | null;
  createProject: (params: CreateProjectParams) => Promise<Project>;
  loadProjectStatus: (projectId: string) => Promise<void>;
  clearError: () => void;
}

export function useProject(): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = useCallback(
    async (params: CreateProjectParams): Promise<Project> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.createProject(params);
        setProject(result);
        return result;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "创建项目失败";
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadProjectStatus = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getProjectStatus(projectId);
      setProjectStatus(status);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载项目状态失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    project,
    projectStatus,
    loading,
    error,
    createProject,
    loadProjectStatus,
    clearError,
  };
}
```

- [ ] **Step 3: 修改 HomeLayout.tsx：handleCreate 函数**

打开 `frontend/src/components/layout/HomeLayout.tsx`，将 `handleCreate` 函数（第 59-93 行）整段替换为：

```typescript
  const handleCreate = useCallback(
    async (data: {
      title: string;
      genre: string;
      min_words: number;
      target_total_words: number;
      target_length_category: string;
    }) => {
      setSubmitting(true);
      setCreateError(null);
      try {
        const project = await api.createProject({
          title: data.title,
          genre: data.genre,
          min_words: data.min_words,
          target_total_words: data.target_total_words,
          target_length_category: data.target_length_category,
        });
        try {
          await api.advance(project.id, "STAGE1");
        } catch {
          // proceed even if advance fails (mirrors prior behavior)
        }
        setCreateOpen(false);
        navigate(`/project/${encodeURIComponent(project.id)}/workspace?tab=settings`);
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "创建项目失败");
      } finally {
        setSubmitting(false);
      }
    },
    [navigate]
  );
```

- [ ] **Step 4: 运行 client + HomePage + CreateProjectModal 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- client.test HomePage.test CreateProjectModal.test
```

预期：相关测试通过（client/HomePage 还会因 Task 7 的后续 fixture 调整而失败，本步先验证类型错误消失即可）。

- [ ] **Step 5: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/layout/HomeLayout.tsx frontend/src/hooks/useProject.ts frontend/src/api/client.ts && git commit -m "refactor(frontend): createProject signature drops intent; Project.initial_intent field removed"
```

---

## Task 6: CreativeDivergenceStep 文案更新

**Files:**
- Modify: `frontend/src/components/wizard/CreativeDivergenceStep.tsx:117-152`

- [ ] **Step 1: 修改 CreativeDivergenceStep.tsx 的文案与 placeholder**

将第 117-121 行的 header：

```tsx
      <header className="flex flex-col gap-xs">
        <h2 className="font-display-lg text-display-lg text-on-surface">创意发散</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">为你的叙事生成主题钩子和概念起点。在此处填写你的创作意图。</p>
      </header>
```

将第 125-128 行的 label：

```tsx
        <label className="font-label-sm text-label-sm text-primary uppercase tracking-wider flex items-center gap-xs" htmlFor="prompt-input">
          <span className="material-symbols-outlined text-[16px]">edit_note</span>
          创作意图 <span className="text-error">*</span>
        </label>
```

将第 135 行的 placeholder：

```tsx
          placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力…"
```

将第 150 行的按钮文案（如需调整；保留"生成概念"也可）：

```tsx
            {busy ? "生成中…" : "生成概念"}
```

- [ ] **Step 2: 修改 CreativeDivergenceStep.test.tsx 测试**

打开 `frontend/src/components/wizard/CreativeDivergenceStep.test.tsx`。当前文件中没有"AI 提示词指令"的硬断言（已确认：测试用 `getByTestId` 而非文案匹配），但为防止 label 改名后视觉漂移，添加新断言。在文件顶部 describe 内（约第 32 行后）追加新断言：

```tsx
  it("labels the prompt input as 创作意图", () => {
    renderStep();
    expect(screen.getByText("创作意图")).toBeInTheDocument();
  });

  it("submit disabled until prompt is filled", () => {
    renderStep();
    const gen = screen.getByTestId("cd-generate") as HTMLButtonElement;
    expect(gen.disabled).toBe(true);
  });
```

- [ ] **Step 3: 运行 CreativeDivergenceStep 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- CreativeDivergenceStep
```

预期：所有测试 PASS（含新增 2 个）。

- [ ] **Step 4: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/CreativeDivergenceStep.tsx frontend/src/components/wizard/CreativeDivergenceStep.test.tsx && git commit -m "feat(wizard): rename prompt label to 创作意图 in creative-divergence step"
```

---

## Task 7: 测试更新与回归

**Files:**
- Modify: 多个后端 + 前端测试（见各步骤）

- [ ] **Step 1: 修复 frontend/src/test/HomePage.test.tsx**

将第 109-111 行：

```tsx
    fireEvent.input(screen.getByTestId("intent-input"), {
      target: { value: "一个被家族抛弃的少年，在异世界觉醒血脉之力" },
    });
```

改为：

```tsx
    fireEvent.input(screen.getByTestId("title-input"), {
      target: { value: "新书测试" },
    });
```

- [ ] **Step 2: 修复 frontend/src/test/client.test.ts**

将第 192-195 行 `api.createProject` 调用：

```typescript
      await api.createProject({
        genre: "cool_novel", min_words: 2000,
        target_total_words: 1000000, target_length_category: "标准商业连载",
      });
```

- [ ] **Step 3: 修复 backend/tests/test_stage2_regenerate_world_section.py 和 test_stage2_regenerate_power_system_item.py**

打开 `backend/tests/test_stage2_regenerate_world_section.py`，找到 `_write_project` 函数或类似 fixture（约第 30-40 行）中 `"initial_intent": {"free_text": "少年觉醒"}` 的位置：

修改前（伪代码）：
```python
(tmp_path / proj_id / "project.json").write_text(json.dumps({
    "id": proj_id,
    "current_stage": "STAGE4",
    "genre": "cool_novel",
    "initial_intent": {"free_text": "少年觉醒"},   # 删除此行
}, ensure_ascii=False))
```

修改后：
```python
(tmp_path / proj_id / "project.json").write_text(json.dumps({
    "id": proj_id,
    "current_stage": "STAGE4",
    "genre": "cool_novel",
}, ensure_ascii=False))
(tmp_path / proj_id / "creative_divergence.json").write_text(json.dumps({
    "prompt": "少年觉醒",
    "variants": [],
    "selected_id": None,
}, ensure_ascii=False))
```

对 `backend/tests/test_stage2_regenerate_power_system_item.py` 重复上述修改（`少年觉醒` 是同一个 fixture 内容）。

- [ ] **Step 4: 修复 tests/test_concept_source_field.py**

将 `project_data` fixture（第 24-32 行）：

```python
@pytest.fixture
def project_data():
    return {
        "title": "源字段测试",
        "genre": "cool_novel",
        "min_words": 4000,
    }
```

> 注：测试目的是验证 `source` 字段持久化，不依赖 intent；只需删除 free_text/inspiration_source。

- [ ] **Step 5: 修复 tests/test_canvas_mutation_context.py**

将 `project_data` 中 `initial_intent` 键整段（第 25 行）删除。

- [ ] **Step 6: 修复 tests/test_stage3_outline_context.py**

`_new_project` 函数（第 72-79 行）替换为：

```python
def _new_project(client, projects_dir) -> str:
    resp = client.post("/api/project/create", json={
        "title": "测试小说", "genre": "cool_novel", "min_words": 4000,
    })
    proj_id = resp.json()["detail"]["id"]
    (projects_dir / proj_id / "creative_divergence.json").write_text(
        json.dumps({"prompt": "少年觉醒", "variants": [], "selected_id": None}, ensure_ascii=False)
    )
    _seed(projects_dir, proj_id)
    return proj_id
```

- [ ] **Step 7: 修复 tests/test_style_extractor.py**

将 291 / 316 / 329 行的 `"free_text": "..."` 删除，改为在该 fixture 内追加写入 `creative_divergence.json`：

```python
            (projects_dir / proj_id / "creative_divergence.json").write_text(
                json.dumps({"prompt": "...", "variants": [], "selected_id": None}, ensure_ascii=False)
            )
```

- [ ] **Step 8: 修复 tests/test_creative_canvas_reset.py**

将 `project.json` 内容（第 27 行）中的 `"initial_intent": {"free_text": "x"}` 整段删除。

- [ ] **Step 9: 修复 tests/test_genre_template_propagation.py**

将第 96 行的 `initial_intent="一个神秘案件"` 整参数从 `agent.generate_concept_and_dna(...)` 调用中删除（保留其他参数）。

> 注：如果该测试断言 `initial_intent` 字段被传给 planner，则改为 mock planner 不再依赖该字段。

- [ ] **Step 10: 修复 tests/test_creative_canvas_api.py**

第 29 行 `"initial_intent": {"free_text": "测试"}` 删除。

- [ ] **Step 11: 修复 tests/test_canvas_commit.py**

- 第 30 行 `"initial_intent": {"free_text": "测试"}` 删除。
- 第 317 / 337 行：`source="initial_intent"`（这是测试用的 source 字符串，不是 schema 字段）保持不变 — 它测试的是 source 字段的写入逻辑。

- [ ] **Step 12: 修复 tests/test_creative_canvas_select_persistence.py**

第 28 行 `"initial_intent": {"free_text": "x"}` 删除。

- [ ] **Step 13: 修复 tests/test_stage6_export.py**

- 第 59 行 `"initial_intent": {"free_text": "测试"}` 删除。
- 第 494 / 521 / 537 / 564 / 583 行 `"free_text": "..."` 字段（如在 `concept` 字典中）属于 `Concept` 模型的字段，不动；如在 project.json 顶层则删除。

- [ ] **Step 14: 修复 tests/test_creative_canvas_choose_branch.py**

第 24 / 67 行 `"initial_intent": {"free_text": "x"}` 删除。

- [ ] **Step 15: 修复 tests/test_stage3_novel_outline.py**

将 `project_data` fixture（第 27-33 行）：

```python
@pytest.fixture
def project_data():
    return {
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
    }
```

并在测试中需要 initial_intent 的地方，注入 `creative_divergence.json`。

- [ ] **Step 16: 修复 tests/test_volume_scoped_chapter_outline_e2e.py**

- 第 72 行 `"concept": {"title": "测试", "free_text": "少年觉醒"}`：`free_text` 不是 Concept 字段，可能是测试数据残留，删除即可。
- 第 98 行 `"free_text": "少年觉醒", "inspiration_source": "web_novel"`：删除。

- [ ] **Step 17: 修复 tests/test_settings_api.py**

第 21 行 `"free_text": "Test project for settings API"` 删除。

- [ ] **Step 18: 修复 tests/test_user_modifications.py**

- 第 155 行 `"initial_intent": "一个复仇故事"` 删除。
- 第 246 行的 mock lambda 返回 `{"initial_intent": {"free_text": "x"}, ...}`：改为 `{}`（不再写 initial_intent），并在测试需要时让 mock 返回 `creative_divergence.json` 内容。

> 具体模式：找到所有 `read_json` mock 调用返回的 dict，如果包含 `initial_intent` 字段，将其移除；并在对应的项目目录下写入 `creative_divergence.json` 提供 prompt。

- [ ] **Step 19: 整体后端测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/ backend/tests/ -x
```

预期：所有测试 PASS。若有失败，按错误信息调整对应 fixture（优先添加 `creative_divergence.json` 注入或删除 `initial_intent` 字段）。

- [ ] **Step 20: 整体前端测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test
```

预期：所有测试 PASS。

- [ ] **Step 21: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add tests/ backend/tests/ frontend/src/test/HomePage.test.tsx frontend/src/test/client.test.tsx && git commit -m "test: remove free_text/initial_intent from fixtures; inject creative_divergence.json where needed"
```

---

## Task 8: 端到端手动验证

**Files:** 无（仅运行时验证）

- [ ] **Step 1: 启动后端**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && uvicorn backend.main:app --reload --port 8000
```

观察启动日志无报错。

- [ ] **Step 2: 启动前端**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm run dev
```

打开 http://localhost:5173。

- [ ] **Step 3: 手动走一遍新项目流程**

1. 点击 "+ 新建项目" 按钮
2. 确认模态框中没有"创作意图"输入框
3. 在"项目名称"中留空 → 提交按钮 disabled
4. 填入项目名称 → 提交按钮 enabled
5. 选择题材 + 长度 → 点击"建档并进入工作台"
6. 跳转到 workspace，wizard step 1 标签为"创作意图"
7. 在 step 1 中填创作意图 → 生成 → 选中变体 → step 2
8. 在 step 2 中生成概念 → 成功

- [ ] **Step 4: 检查生成的 project.json**

```bash
ls /path/to/projects/proj_xxx/
cat /path/to/projects/proj_xxx/project.json | python3 -m json.tool
```

预期：`project.json` 中无 `initial_intent` 字段。

- [ ] **Step 5: 测试老项目兼容（手动构造）**

```bash
mkdir -p /tmp/old_proj/proj_legacy
echo '{"id": "proj_legacy", "title": "老项目", "genre": "cool_novel", "current_stage": "STAGE1"}' > /tmp/old_proj/proj_legacy/project.json
```

调用：

```bash
curl -X POST http://localhost:8000/api/stage1/generate \
  -H "Content-Type: application/json" \
  -d '{"project_id": "proj_legacy", "user_modifications": ""}'
```

预期：HTTP 400，body 含 `"code": "INTENT_MISSING"`、`"message": "请先完成创意发散"`。

---

## 收尾

- [ ] **最终提交（如果有遗漏的格式调整）**

```bash
cd /Users/longsa/Codes/nebula && git status
```

确认无未跟踪的修改。如有：

```bash
git add -u && git commit -m "chore: address remaining lint/type warnings"
```