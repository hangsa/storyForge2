# Regenerate User Modifications — 设计

> 适用范围：让 6 个"重新生成"触发点在点击后弹出一个 textarea 输入框，接收用户的修改意见，agent 在原 prompt 末尾追加 `【用户修改意见】{text}` 段。
> 优先级：意见为空 → 行为与今天完全一致（不渲染段、不污染 prompt）。
> 不持久化：不写 project.json / progress.json / checkpoint；LLM 调用日志中保留全 prompt（用于调试）。
> 不动：circuit breaker、retry、character_designer 内部、router signature、catalog。

---

## 1. 背景与目标

### 1.1 当前状态（已验证）

代码里有 6 个"重新生成"入口和 7 个后端端点：

| 入口 | 端点 | 调用的 agent 方法 | prompt 模板 |
|---|---|---|---|
| InitWizardModal（5 步共用） | `POST /stage1/generate` | `PlannerAgent.generate_concept_and_dna` | `concept_generation.yaml` |
| InitWizardModal | `POST /stage2/generate-world` | `PlannerAgent.generate_world` | `world_generation.yaml` |
| InitWizardModal | `POST /stage2/generate-character` | `PlannerAgent.generate_character` | `character_generation.yaml` |
| BehaviorExamplesSection（每个角色一个） | `POST /stage2/character/{id}/regenerate-examples` | `PlannerAgent.generate_character`（复用） | `character_generation.yaml`（复用） |
| InitWizardModal | `POST /stage3/generate` | `PlannerAgent.generate_outline` | `outline_generation.yaml` |
| InitWizardModal | `POST /stage3/generate-novel-outline` | `PlannerAgent.generate_novel_outline` | `novel_outline_generation.yaml` |
| WritingArea | `POST /stage4/write-scene` | `WriterAgent.write_scene` | `scene_writing.yaml` |

注意：`regenerate-examples` 内部复用了 `generate_character`——同一个 prompt、同一个 agent 方法。所以实际是 **6 个 prompt 模板 + 6 个 agent 方法 + 7 个端点**。

### 1.2 目标

- 6 个入口点击后弹出 textarea 输入框
- 用户输入（或留空）→ 确认 → 重写原内容
- agent 在原 prompt 末尾追加 `【用户修改意见】{text}` 段
- 文本为空时与今天的行为完全一致（零回归）
- 不持久化意见本身

---

## 2. 架构

| 层 | 改造点 | 文件 |
|---|---|---|
| 前端组件 | 新建 `RegenerateModal.tsx`（B 型 560px 弹窗） | `frontend/src/components/shared/RegenerateModal.tsx` |
| 前端 API | 7 个 client 函数加 `user_modifications?: string` 参数 | `frontend/src/api/client.ts` |
| 前端接入 | 3 处接入点（wizard 1、writing 1、behavior examples 1） | `InitWizardModal.tsx`、`WritingArea.tsx`、`CharacterStep.tsx` |
| 后端 helper | 新建 `_build_user_modifications_block(text)` | `backend/agents/_injection_helpers.py`（新文件） |
| 后端端点 | 7 个 handler 加 `user_modifications: str = ""` 字段 | `backend/api/stage{1,2,3,4}*.py` |
| Agent 方法 | 6 个方法加 `user_modifications: str = ""` 形参 | `backend/agents/planner.py`（5）、`backend/agents/writer.py`（1） |
| Prompt 模板 | 6 个 YAML 末尾加 `{user_modifications}` 占位 | `backend/prompts/*.yaml` |

---

## 3. 组件

### 3.1 `RegenerateModal` 组件

**路径**：`frontend/src/components/shared/RegenerateModal.tsx`（新建）

**Props**：
```typescript
interface RegenerateModalProps {
  open: boolean;
  target: string;                              // 上下文标题，如 "概念" / "第二章第一场"
  placeholder?: string;                        // textarea 提示词（可按 target 定制）
  onConfirm: (userModifications: string) => void;  // 确认回调，text 可为空
  onCancel: () => void;
}
```

**State**：
- `text: string`（受控 textarea，初值 `""`）
- 派生：`isOverLimit = text.length > 1000`

**UI 结构**（B 型，560px 居中）：
```
┌─ 标题：重新生成 — {target} ──────────────────────┐
│ 副标题：原内容将被覆盖，AI 会结合你的意见重新生成 │
├─ 修改意见（可选） ──────────────────────────────┤
│ ┌─ textarea（高度 140px，resize: vertical）───┐ │
│ │ 用户输入…                                   │ │
│ └─────────────────────────────────────────────┘ │
│ 留空 = 仅重新生成 · 最多 1000 字        0 / 1000 │
├─ 底栏 ───────────────────────────────────────────┤
│ Esc 取消 · Cmd+Enter 提交    [取消] [重新生成] │
└──────────────────────────────────────────────────┘
```

**交互**：
- 打开：弹窗 + textarea 自动 focus
- 输入：受控，> 1000 字阻止输入
- 提交：调 `onConfirm(text)`，text 可为 `""`
- 关闭：Esc、点背景、× 按钮 → `onCancel()`
- 快捷键：`Cmd+Enter` / `Ctrl+Enter` 提交

**样式**：与 `frontend/src/components/shared/ConfirmDialog.tsx` 同款（Tailwind 手写 + `fixed inset-0 bg-black/50 z-50` + Escape 处理器）。

**可访问性**：
- `role="dialog"`、`aria-modal="true"`
- `aria-labelledby` 指向标题 id
- textarea 有 `aria-label="修改意见"`
- 焦点陷在弹窗内（Tab 循环）

### 3.2 `RegenerateModal.test.tsx`

**路径**：`frontend/src/components/shared/RegenerateModal.test.tsx`（新建，vitest）

测试用例（8）：
1. 打开时 textarea 自动 focus
2. 输入文本 → onConfirm 收到相同文本
3. 留空提交 → onConfirm 收到 `""`
4. Esc 键 → onCancel 被调
5. 点背景 → onCancel 被调
6. Cmd+Enter → onConfirm 被调
7. 超过 1000 字阻止输入（边界值）
8. 标题包含 `target` 字符串

### 3.3 `_build_user_modifications_block(text)` helper

**路径**：`backend/agents/_injection_helpers.py`（新建）

```python
def _build_user_modifications_block(text: str) -> str:
    """Build the 【用户修改意见】 block appended to user_prompt_template.

    Returns "" if text is empty/whitespace, so the template renders an empty
    trailing line and the LLM sees no instruction change.
    """
    if not text or not text.strip():
        return ""
    return f"\n【用户修改意见】\n{text.strip()}"
```

**测试**（5 cases，进 `tests/test_user_modifications.py`）：
- `""` → `""`
- `"   "` → `""`
- `"hello"` → 包含 `【用户修改意见】` + `hello`，无前后多余空白
- `"  hello  "` → stripped（不保留首尾空白）
- `"\nfoo\n"` → 包含 `foo`

### 3.4 Prompt 模板改动

每个 `user_prompt_template:` 末尾加一行（**仅占位、rendered 时由 helper 替换**）：

```yaml

{user_modifications}
```

具体 6 个文件：
- `backend/prompts/concept_generation.yaml`
- `backend/prompts/world_generation.yaml`
- `backend/prompts/character_generation.yaml`
- `backend/prompts/novel_outline_generation.yaml`
- `backend/prompts/outline_generation.yaml`
- `backend/prompts/scene_writing.yaml`

**空文本行为**：`{user_modifications}` 替换为 `""`，YAML 渲染输出一个空行（与 `genre_pacing` 现状一致，可接受）。

### 3.5 Agent 方法签名

每个方法末尾加 `user_modifications: str = ""`，在 `template_vars` 中设置：

```python
async def generate_concept_and_dna(
    self,
    ...,
    user_modifications: str = "",  # NEW
):
    ...
    template_vars["user_modifications"] = _build_user_modifications_block(user_modifications)
    result, response = await self.generate_from_template(
        "concept_generation",
        **template_vars,
        custom_style_config=None,  # 不传 sandbox
    )
    ...
```

**6 个方法**：
- `planner.generate_concept_and_dna` (stage1)
- `planner.generate_world` (stage2 world)
- `planner.generate_character` (stage2 char + regenerate-examples)
- `planner.generate_outline` (stage3 chapter)
- `planner.generate_novel_outline` (stage3 novel)
- `writer.write_scene` (stage4)

### 3.6 后端端点改动

7 个 handler 接受可选 `user_modifications`：

```python
@router.post("/generate")
async def generate_concept(
    project_id: str = Query(...),
    payload: dict = None,  # 已有；现在 body 多一个 user_modifications
):
    payload = payload or {}
    user_modifications = str(payload.get("user_modifications", ""))
    ...
    result, response = await agent.generate_concept_and_dna(
        ...,
        user_modifications=user_modifications,
    )
```

不强制用 Pydantic model（保持现有 `payload: dict = None` 风格）；只 `payload.get("user_modifications", "")` 一次。

**端点清单**：
1. `POST /stage1/generate` — `backend/api/stage1_concept.py:32`
2. `POST /stage2/generate-world` — `backend/api/stage2_world_char.py:84`
3. `POST /stage2/generate-character` — `backend/api/stage2_world_char.py:142`
4. `POST /stage2/character/{id}/regenerate-examples` — `backend/api/stage2_world_char.py:379`
5. `POST /stage3/generate` — `backend/api/stage3_outline.py:40`
6. `POST /stage3/generate-novel-outline` — `backend/api/stage3_outline.py:195`
7. `POST /stage4/write-scene` — `backend/api/stage4_writing.py:1178`

### 3.7 前端 API client 改动

`frontend/src/api/client.ts` 的 7 个函数加 `user_modifications?: string` 形参，序列化为 body 字段。

```typescript
export async function generateConcept(
  projectId: string,
  userModifications: string = "",  // NEW
) {
  await axios.post("/api/stage1/generate", {
    project_id: projectId,
    user_modifications: userModifications,
  });
}
```

（具体 7 个函数在 plan 阶段 grep 落实，spec 阶段不列。）

### 3.8 前端接入点

| 入口 | 文件 | 触发位置 | target 字符串 |
|---|---|---|---|
| InitWizardModal | `frontend/src/components/wizard/InitWizardModal.tsx:210` | 已有 `data-testid="wizard-regenerate"` 按钮 | 当前 step 名称（"概念" / "世界观" / "角色" / "细纲" / "章纲"） |
| WritingArea | `frontend/src/components/workspace/WritingArea.tsx:180-186` | `editor-regenerate` 按钮 | "第{N}章第{M}场"（从 props 取） |
| BehaviorExamplesSection | `frontend/src/components/wizard/BehaviorExamplesSection.tsx:46-58` | `behavior-example-regenerate` 按钮 | "{角色名} · 行为例示" |

每个接入点：open 一个本地 state 控制 `RegenerateModal` 开关；onConfirm 调现有 API 函数（多传 `userModifications`）；onCancel 关闭弹窗。

---

## 4. 数据流（端到端）

```
1. WritingArea "editor-regenerate" 按钮点击
   ↓
2. WritingArea setShowRegenerateModal(true)
   ↓
3. RegenerateModal 打开（target="第二章第一场"）
   ↓
4. 用户输入（或留空）→ Cmd+Enter / 点"重新生成"
   ↓
5. onConfirm(text) → WritingArea 收到回调
   ↓
6. WritingArea 调 api.writeScene({
     project_id, chapter_number, scene_number,
     user_modifications: text,
   })
   ↓
7. POST /stage4/write-scene 收到 body
   handler: user_modifications = payload.get("user_modifications", "")
   ↓
8. handler 调 writer.write_scene(..., user_modifications=user_modifications)
   ↓
9. writer.write_scene:
   template_vars["user_modifications"] = _build_user_modifications_block(text)
   → 末尾追加 "\n【用户修改意见】\n{text.strip()}" 或 ""（空）
   ↓
10. await self.generate_from_template("scene_writing", **template_vars, ...)
   ↓
11. PromptTemplate 渲染：user_prompt_template 末尾的 {user_modifications} 替换
   ↓
12. LLM call with full merged prompt
```

---

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 文本 > 1000 字 | 前端：阻止输入（`<textarea maxLength={1000}>`）;后端：handler 截断到 1000 字符（双层防御） |
| 文本全空白字符 | helper `text.strip() == ""` → 返回 `""`，不渲染段 |
| API 失败 | 与现有重写失败行为一致（toast 提示、progress 状态） |
| 用户按 Esc / 点背景 | 关闭弹窗，不触发重写 |
| 后端缺 `user_modifications`（旧 client） | `payload.get("user_modifications", "")` → `""` → 等价于今天 |
| Agent 缺 `user_modifications` 形参（已迁移） | 形参默认 `""` → 等价于今天 |
| Prompt 缺 `{user_modifications}` 占位（已迁移） | placeholder 不被替换，整段 `"{user_modifications}"` 字面量出现在 prompt（**迁移时全部 6 个模板都加**，但万一漏一个会显示字面量，**这本身是一个退化点**——见 §6） |

**退化点**：如果迁移时漏了某个 prompt 模板，LLM 会看到 `"{user_modifications}"` 字面量字符串。这本身是提示我们漏迁移的信号（LLM 不会理解字面量）。

---

## 6. 边界情况与回归

**回归保护**：
- `tests/test_user_modifications.py` 包含一个"all 6 prompt templates have {user_modifications} placeholder"测试。
- `tests/test_user_modifications.py` 包含一个"all 6 agent methods accept user_modifications kwarg"测试。
- `tests/test_user_modifications.py` 包含一个"empty user_modifications == today's behavior"对比测试。

**字符上限**：
- 前端：`maxLength={1000}` 阻止输入
- 后端：`text = text[:1000]` 截断
- 字符计算：`text.length`（按 code unit 数；1000 字符约等于 ~330 汉字，对 6 个 use case 都够）

**Wizard step target 字符串**：
- ConceptStep → "概念"
- WorldStep → "世界观"
- CharacterStep → "角色"
- OutlineStep → "细纲"
- ChapterOutlineStep → "章纲"
- 字符串通过 `useWizardStep()` 或 props 传入（具体在 plan 阶段 grep 落实）

---

## 7. 测试

### 7.1 `tests/test_user_modifications.py`（新文件）

| Class | 用例数 | 内容 |
|---|---|---|
| `TestUserModificationsHelper` | 5 | `_build_user_modifications_block` 的 5 个 case（§3.3） |
| `TestPromptCoverage` | 2 | (a) 6 个模板都含 `{user_modifications}` 占位; (b) 占位都在 `user_prompt_template` 末尾 |
| `TestAgentSignatureCoverage` | 2 | (a) 6 个 agent 方法签名都含 `user_modifications=""` 形参; (b) 默认值正确 |
| `TestEndToEndBackwardCompat` | 2 | (a) `user_modifications=""` → 模板渲染结果与今天一致; (b) `user_modifications="意见"` → 渲染结果末尾含 `【用户修改意见】意见` |
| `TestEndToEndWithSuggestion` | 1 | 完整端到端：构造 mock agent，注入"xianxia + 意见"，验证 LLM 收到的 prompt 包含 `【用户修改意见】` 段 |
| `TestCharLimit` | 2 | (a) helper 不限制长度（仅前/后端裁剪）; (b) handler 截断到 1000 |

**总计 14 用例，6 个 class。**

### 7.2 `frontend/src/components/shared/RegenerateModal.test.tsx`（新文件，vitest）

8 用例（见 §3.2）。

### 7.3 集成 smoke test

不强制。但 plan 阶段建议加 1 个"前端发请求带 `user_modifications`、后端收到并注入"的端到端 test（用现有的 vitest + pytest + fastapi test client 工具链）。

---

## 8. YAGNI（明确不做）

- ❌ 不持久化意见到 `project.json` / `progress.json` / `checkpoint.json`
- ❌ 不做意见历史/快速回填
- ❌ 不做 AI 推荐的"试试这样写"提示
- ❌ 不做意见模板/快捷短语
- ❌ 不做多语言切换
- ❌ 不做实时字数统计（仅末尾 `0 / 1000` 显示）
- ❌ 不做 `user_modifications` 之外的反馈类型（如"否定意见" / "扩展意见"）
- ❌ 不在 progress.json / llm_usage.jsonl 中独立存储意见
- ❌ 不改 circuit_breaker / retry 行为
- ❌ 不动 `character_designer` 内部实现
- ❌ 不为"留空"提供单独按钮（"重新生成"按钮同时承担"有意见"和"无意见"两种情况）
- ❌ 不为"超过 1000 字"提供单独的"扩展"按钮
- ❌ 不在弹窗里显示原内容（用户已经从 wizard / writing area 看到了，再贴一次是噪声）

---

## 9. 文件清单

**新增** (4)：
- `frontend/src/components/shared/RegenerateModal.tsx`（~120 行）
- `frontend/src/components/shared/RegenerateModal.test.tsx`（~80 行，8 vitest 用例）
- `backend/agents/_injection_helpers.py`（~15 行）
- `tests/test_user_modifications.py`（~280 行，14 pytest 用例）

**修改** (16)：
- `frontend/src/api/client.ts`（7 个 API 函数加 `user_modifications?: string`）
- `frontend/src/components/wizard/InitWizardModal.tsx`（用 `RegenerateModal`）
- `frontend/src/components/wizard/CharacterStep.tsx`（per-card 行为例示触发 `RegenerateModal`）
- `frontend/src/components/workspace/WritingArea.tsx`（场景重写触发 `RegenerateModal`）
- `backend/api/stage1_concept.py`（1 端点）
- `backend/api/stage2_world_char.py`（3 端点：world / character / regenerate-examples）
- `backend/api/stage3_outline.py`（2 端点：generate / generate-novel-outline）
- `backend/api/stage4_writing.py`（1 端点：write-scene）
- `backend/agents/planner.py`（5 方法加形参）
- `backend/agents/writer.py`（1 方法加形参）
- 6 个 prompt 模板末尾加 `{user_modifications}` 占位

**不改**：
- `config/genres/*.yaml`
- `backend/genres/catalog.py`
- `backend/llm/model_router.py`
- `backend/llm/base_provider.py`
- `backend/config.py`
- `backend/conductor/circuit_breaker.py`
- `backend/conductor/chapter_review.py`
- `backend/style_engine/sandbox_renderer.py`
- 任何 project.json / progress.json / checkpoint.json schema
- 前端 WizardContext 的核心逻辑（只改 `setRegenerateHandler` 的 handler 形状）

---

## 10. 验收

- `pytest tests/test_user_modifications.py -v` → 14/14 通过
- `cd frontend && npm test RegenerateModal` → 8/8 通过
- 全量回归 `pytest tests/` + `npm test`：无新增失败（已知的 8 个 autopilot/SSE 失败保持）
- 端到端验收（手动）：
  1. 进 InitWizardModal，点"重新生成"→ 弹窗打开，标题含"概念"
  2. 输入"主角动机更清晰一点"→ Cmd+Enter → 弹窗关闭
  3. 检查 llm_usage.jsonl 的最后一条：scene_writing 的 prompt 末尾有 `【用户修改意见】主角动机更清晰一点`
  4. 重新点"重新生成"→ 弹窗打开，textarea 为空
  5. 直接点"重新生成"→ 弹窗关闭，scene 被重写（行为与今天一致）
  6. 在 1000 字限制处输入到第 1000 字仍可输入，第 1001 字被阻止
  7. 6 个入口每个都走一遍（wizard 5 步 + writing + 行为例示）
