# "+ 新建项目" 表单字段重构 — 设计规格

**日期**: 2026-08-30
**状态**: 待用户最终审阅
**作者**: Claude (brainstorming 流程产出)

## 背景与目标

`HomePage` 的"+ 新建项目"模态 (`CreateProjectModal.tsx`) 当前有两个文本输入：
- `创作意图` (intent) — 必填 textarea，是项目初始意图的核心描述
- `项目名称` (title) — 可选 input，留空时自动从 intent 截取前 30 字符

`stage1_concept.py` 当前从 `project.json.initial_intent.free_text` 读取该意图，并喂给 `PlannerAgent.generate_concept_and_dna` 作为 `{initial_intent}` prompt 占位符。

**目标变更**：
1. **移除 "+ 新建项目" 中的"创作意图"输入** — 该字段不再在创建项目阶段收集
2. **创作意图在"创意发散"（wizard step 1, `CreativeDivergenceStep`）中填写** — 复用现有 textarea，文案改为"创作意图"
3. **"项目名称" 改为必填** — 不能留空、不再有 intent 截取兜底

**设计决策（用户答复 2026-08-30 brainstorm 会话）**：
- 复用现有"AI 提示词指令" textarea，仅改文案与 placeholder
- 创意发散的 prompt **不**回写到 `project.json.initial_intent.free_text`
- `stage1_concept.py` 改为从 `creative_divergence.json.prompt` 读取
- 选中"彻底删除" `InitialIntent` 字段边界，**不保留 fallback** — 老项目（无 `creative_divergence.json`）需在 wizard step 1 重填才能继续 stage1

## 架构变更

### 数据契约变化

**`POST /api/project/create` 请求 schema**（之前 → 之后）：

| 字段 | 之前 | 之后 |
|------|------|------|
| `title` | 可选（缺省时从 intent 截取） | **必填**（空白 → 400 `VALIDATION_ERROR "项目名称必填"`） |
| `intent` | 必填 | **删除** |
| `free_text` | 可选（fallback 用） | **删除** |
| `inspiration_source` | 可选 | **删除** |
| `genre` | 必填 | 必填（不变） |
| `min_words` | 可选 | 可选（不变） |
| `target_total_words` | 可选 | 可选（不变） |
| `target_length_category` | 可选 | 可选（不变） |

**`project.json` schema 变化**：

```diff
 {
   "id": "proj_xxx",
   "title": "...",
   "genre": "cool_novel",
   "min_words": 2000,
   "target_total_words": 1000000,
   "target_length_category": "标准商业连载",
-  "initial_intent": { "free_text": "...", "inspiration_source": "..." },
   "current_stage": "INIT",
   "stage_history": [],
   "created_at": "..."
 }
```

### Stage1 创作意图来源（之前 → 之后）

```python
# 之前
initial_intent = project.get("initial_intent", {}).get("free_text", "")

# 之后
cd = fm.read_json(project_id, "creative_divergence.json")
prompt = (cd or {}).get("prompt", "").strip()
if not prompt:
    raise HTTPException(400, "INTENT_MISSING", "请先完成创意发散")
initial_intent = prompt
```

## 改动清单

### 前端（用户立即感知）

**`frontend/src/components/home/CreateProjectModal.tsx`**
- 删除整个"创作意图" textarea 块（label + textarea + `intent` state）
- 删除 `CreateProjectModalProps.onSubmit` 中的 `intent` 字段
- 删除 `intent` state 与 `setIntent` 调用
- 删除 `submit()` 中的 `intent.trim()` 校验与 `intent` 字段
- "项目名称" 标签加 `<span className="text-error">*</span>`
- "项目名称" input 的 placeholder 改为 `"必填"` 或 `"请输入项目名称"`
- `disabled` 条件改为 `!title.trim() || submitting`

**`frontend/src/components/layout/HomeLayout.tsx`**
- `handleCreate` 回调函数参数去掉 `intent: string`
- `api.createProject` 调用去掉 `intent: data.intent`

**`frontend/src/hooks/useProject.ts`**
- `createProject` 签名：`async (genre, minWords, targetTotalWords, targetLengthCategory, title?)`
- 调用 `api.createProject({ title, genre, min_words, target_total_words, target_length_category })`

**`frontend/src/api/client.ts`**
- `createProject` 函数参数类型去掉 `intent: string`
- `Project` 接口删除 `initial_intent` 字段

**`frontend/src/components/wizard/CreativeDivergenceStep.tsx`**（仅文案）
- label "AI 提示词指令" → "创作意图"
- textarea placeholder 更新（围绕"故事想法的核心本质、主题或背景"）

### 后端模型

**`backend/models/project.py`**
- 删除 `InitialIntent` 类
- `Project.initial_intent: InitialIntent = Field(default_factory=InitialIntent)` 整行删除

**`backend/models/__init__.py`**
- import 列表去掉 `InitialIntent`
- `__all__` 去掉 `"InitialIntent"`

### 后端 API

**`backend/api/project.py`**
- 顶部 `from backend.models.project import Project, InitialIntent` → `from backend.models.project import Project`
- `create_project` 函数：
  - 删除 `intent = data.get("intent", "")`、`title = data.get("title", "") or (intent[:30] + "..." ...)`
  - 删除 `free_text = ...`、`inspiration_source = ...`
  - 新增 title 必填校验：`if not (data.get("title") or "").strip(): raise 400 VALIDATION_ERROR "项目名称必填"`
  - `Project(...)` 构造删除 `initial_intent=InitialIntent(...)` 参数

**`backend/api/stage1_concept.py`**
- 两处 `initial_intent=project.get("initial_intent", {}).get("free_text", "")` 替换为：
  ```python
  cd = fm.read_json(project_id, "creative_divergence.json") or {}
  initial_intent_text = (cd.get("prompt") or "").strip()
  if not initial_intent_text:
      raise http_error(400, "INTENT_MISSING", "请先完成创意发散")
  initial_intent=initial_intent_text,
  ```
- 文件顶部导入 `fm`（若尚未导入）

### 测试更新

**后端 `tests/test_integration_e2e.py`**
- `project_data` fixture 移除 `free_text`、`inspiration_source` 字段
- `test_create_project_validation`：从 `{"title": "", "free_text": ""}` → `{"title": ""}`

**后端涉及 `free_text`/`initial_intent` 的 16 个测试**（按引用模式分类处理）：
- `test_stage2_regenerate_world_section.py`、`test_stage2_regenerate_power_system_item.py`、`test_stage1_regenerate_section.py`：`project.json` fixture 中移除 `initial_intent` 字段（不再写入），但新增/保持 `creative_divergence.json` 注入 prompt（如测试依赖 initial_intent）
- `test_concept_source_field.py`、`test_canvas_mutation_context.py`、`test_stage3_outline_context.py`、`test_style_extractor.py`、`test_creative_canvas_reset.py`、`test_creative_canvas_api.py`、`test_creative_canvas_select_persistence.py`、`test_canvas_commit.py`、`test_creative_canvas_choose_branch.py`、`test_stage3_novel_outline.py`、`test_volume_scoped_chapter_outline_e2e.py`、`test_settings_api.py`、`test_user_modifications.py`、`test_genre_template_propagation.py`、`test_stage6_export.py`：按需移除 `initial_intent`/`free_text`，注入 prompt 到 `creative_divergence.json`，保持测试断言

**前端 `frontend/src/test/HomePage.test.tsx`**
- 第 109 行 `screen.getByTestId("intent-input")` → `screen.getByTestId("title-input")`
- 第 110 行的意图文本 → 改为 `title-input` 输入

**前端 `frontend/src/test/client.test.ts`**
- 第 192-196 行 `api.createProject({ intent, genre, min_words, target_total_words, target_length_category })` → 去掉 intent

### 保留不动（保持最小改动原则）

- `frontend/src/pages/InitPage.tsx` — 无路由使用，是死代码
- `backend/agents/planner.py` — `initial_intent` 参数名保留（仅数据来源变了）
- `backend/api/creative_divergence.py` — 已有的 `prompt` 字段与写入逻辑不动
- `Concept` 模型、`StoryDNA` 模型、`ConceptAndDNA` 模型 — 不变

## 数据流（v2.x 新项目）

```
用户点 "+ 新建项目" 按钮
        ↓
CreateProjectModal 打开 → 用户输入 [title*] [genre] [length]
        ↓
点击 "建档并进入工作台"  → HomeLayout.handleCreate({title, genre, length})
        ↓
POST /api/project/create {title, genre, min_words, target_total_words, target_length_category}
        ↓
后端 Project(...) 构造 → 写入 project.json
        ↓
POST /api/conductor/advance {STAGE1} (best-effort)
        ↓
navigate(/project/:id/workspace?tab=settings) → WorkspaceWizardPanel
        ↓
wizard step 1 (CreativeDivergenceStep)：
  用户输入"创作意图" → 生成变体 → 选中变体
  → POST /creative-divergence/generate → POST /creative-divergence/select
  → 写入 creative_divergence.json {prompt, variants, selected_id}
  → 写入 concept_and_dna.json {source: "creative_divergence", source_variant_id}
        ↓
wizard step 2 (ConceptStep) → 用户编辑或重新生成概念
        ↓
POST /stage1/generate → 读取 creative_divergence.json.prompt 作为 initial_intent
```

## 行为变化 / 风险

### 新项目（v2.x 创建）

正常流程，无破坏性变更。

### 老项目（v2.x 之前创建，无 `creative_divergence.json`）

- **风险**：用户尝试 `/stage1/generate` 或 `/stage1/regenerate-section` 时，新代码读不到 prompt → 返回 400 `INTENT_MISSING "请先完成创意发散"`
- **用户恢复路径**：进入 wizard step 1 (`CreativeDivergenceStep`)，填创作意图并完成一次生成+选中，写入 `creative_divergence.json`，即可恢复正常
- **不数据迁移**：明确不写迁移脚本，避免隐藏副作用

### 潜在破坏面

- 所有调用 `api.createProject({...})` 的代码必须同步去掉 `intent` 字段（避免后端忽略未知字段时不报错）
- `Project` 接口（前端）删除 `initial_intent` 字段后，任何访问 `project.initial_intent.free_text` 的前端代码会变 `undefined`，需 grep 确认无遗漏

## 错误处理

| 场景 | HTTP 状态码 | code | message |
|------|-------------|------|---------|
| `POST /api/project/create` title 空白 | 400 | `VALIDATION_ERROR` | `项目名称必填` |
| `POST /api/projects/:id/stage1/generate` 读不到 prompt | 400 | `INTENT_MISSING` | `请先完成创意发散` |
| `POST /api/projects/:id/stage1/regenerate-section` 读不到 prompt | 400 | `INTENT_MISSING` | `请先完成创意发散` |

## 验证计划

1. **前端单元/集成测试**：`npm test` 跑全量，重点关注 `CreateProjectModal.test.tsx`、`HomePage.test.tsx`、`client.test.ts`、`CreativeDivergenceStep.test.tsx`
2. **后端单元测试**：`pytest tests/` 跑全量，关注 `test_integration_e2e.py` 与所有改动的 stage1/stage2 测试
3. **手动端到端**：
   - 创建新项目（只填 title+genre+length）→ 跳到 workspace → step 1 填创作意图 → step 2 生成概念 → 检查 `project.json` 无 `initial_intent`，`creative_divergence.json` 有 prompt
   - 老项目恢复：找一个 v2.x 之前创建的项目目录，手动放入后运行 `/stage1/generate` → 应返回 400 `INTENT_MISSING`
4. **回归检查**：
   - 删除测试/老项目路径无报错
   - `POST /api/project/create` 不传 title → 400
   - `POST /api/project/create` 不传 intent/free_text → 200（不报错）

## 未来工作（不在本次范围）

- `InitPage.tsx` 是死代码，可后续清理（不在本次范围）
- 进一步把 `intake → 创意发散` 合并为一个连贯的 onboarding 流程