# 工作区右侧栏重新生成支持 — 设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 wizard 的"重新生成"能力扩展到 workspace 右侧栏的 5 个 tab（概念 / 世界观 / 角色 / 大纲 / 章节大纲），让用户在已写章节的工程里也能针对每个字段调 AI 重生。

**Architecture:** 后端只新增章节大纲区间端点，其他 5 个 wizard 的 `regenerate-*` 端点零修改（已验证无 wizard session 依赖、无 STAGE_ORDER 门禁）。前端把 `SectionRegenerateButton` 解耦 wizard context（加可选 `statusReporter` prop），5 个 workspace 编辑器按 section 摆放 ↻ 按钮；章节大纲编辑器顶部新增专用 modal 收 chapter_start / chapter_end 区间。乐观刷新（API 响应 `detail` 直接 setState），不触发 reloadKey。`readOnly === true` 时隐藏按钮。

**Tech Stack:** Python 3.9 + FastAPI + Pydantic dataclass + pytest-asyncio；React 18 + TypeScript + vitest + React Testing Library。

---

## 1. 决策摘要（5 个关键决定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 重新生成粒度 | **section 级（wizard 同款）** | 范围最小 = 风险最小；可复用 wizard 组件 |
| 章节大纲粒度 | **chapter_start..chapter_end 区间** | 用户明确选择；逐章按钮太碎、整卷按钮太激进 |
| 已写章节影响 | **用户自负风险，弹黄色警告** | "用户自负风险，仅提示"已确认；不做一致性扫描 |
| 刷新策略 | **乐观刷新（API 响应直接 setState）** | 体验最快；与 wizard 行为一致 |
| 只读模式 | **隐藏重新生成按钮** | readOnly 状态保护已写章节不被扰动；用户应先解除 readOnly |
| 共享组件耦合 | **`SectionRegenerateButton` 加可选 `statusReporter` prop** | 向后兼容；不引入双胞胎组件 |

---

## 2. 后端改动

### 2.1 零修改清单（仅复用）

| 端点 | 文件 | section 取值 |
|---|---|---|
| `POST /stage1/regenerate-section` | `backend/api/stage1_concept.py:133` | `concept` / `dna` |
| `POST /stage2/regenerate-world-section` | `backend/api/stage2_world_char.py:506` | `era` / `power_system` / `core_rules` / `factions` |
| `POST /stage2/regenerate-power-system-item` | `backend/api/stage2_world_char.py:588` | `system_index` (单条目) |
| `POST /stage2/regenerate-character-section` | `backend/api/stage2_world_char.py:677` | `personality` / `voice_signature` / `current_state` / `unknown` / `relations` |
| `POST /stage2/character/{id}/regenerate-examples` | `backend/api/stage2_world_char.py:420` | (整 `behavior_examples`) |
| `POST /stage3/regenerate-novel-outline-section` | `backend/api/stage3_outline.py:342` | `core_conflict` / `volumes` / `mc_growth` / `key_plot` |

**验证已确认（2026-08-21）：** 这些端点都没有 `StageStateMachine.get_current_stage` 检查（只有 `/generate` 端点有 `STAGE_ORDER` 门禁）。都不引用 `wizard_session_id` 或前端 sessionStorage 字段。接收的 payload 与 wizard 流一致：`{ section / system_index / character_id, user_modifications: str(max 1700) }`。响应统一为 `{ error, code, message, detail }`，`detail` 总是包含合并后的完整 JSON。

### 2.2 新增端点：`POST /stage3/regenerate-chapter-outline`

放置位置：`backend/api/stage3_outline.py`（接在 `regenerate_novel_outline_section` 后面，约 line 423 之后）。

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

    与 /stage3/generate 共用 PlannerAgent.generate_outline，无 STAGE_ORDER
    检查。专门服务于工作区场景，已写章节不被扰动。
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

    # 用于构造每章 prompt 的 preceding chapters —— 同一卷内累积当前生成结果。
    # 沿用 stage3/generate 的写法，把 outline 当作 dict 而不是分片读取。
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

        # 替换 chapters 数组里同 chapter_number 的条目；不在区间内的保留。
        chapters = [ch for ch in chapters if ch.get("chapter_number") != ch_num]
        chapters.append(result)
        # outline_for_prompt 同步更新，让后续章看到已重新生成的前面章节。
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

**为什么不调 `bind_growth_curve_to_outline`？** `stage3_outline.py:164` 首次生成时会调，原因是 growth curve 还没绑到 chapters。workspace 重新生成场景下 growth curve 已经在 `characters.json` 里，调它会引入不可预测的副作用（可能改变已写章节里的成长标记）。

**为什么不动 `progress.json`？** `stage3_outline.py:152-159` 首次生成时刷新 `total_chapters`。workspace 重新生成 chapters 数不变，没必要写。

---

## 3. 前端改动

### 3.1 shared 组件改造：`SectionRegenerateButton`

**文件：** `frontend/src/components/shared/SectionRegenerateButton.tsx`

```tsx
interface SectionRegenerateButtonProps {
  /** Modal 标题后缀，例如 "力量体系"。 */
  target: string;
  /**
   * 确认时调用，参数为 user_modifications。resolve 表示成功，reject 表示失败。
   * 父组件负责把成功/失败写到自己的 state。
   */
  onRegenerate: (userModifications: string) => Promise<void>;
  /** 与重生无关的忙碌状态（如正在保存手动修改）时禁用。 */
  disabled?: boolean;
  testId?: string;
  /**
   * 自定义状态回报器。**不传则 fallback useWizard()**（向后兼容现有 wizard 调用方）。
   * 工作区使用：传入 useToast 包装的 reporter。
   */
  statusReporter?: {
    onBusy?: (target: string) => void;
    onSuccess?: (target: string) => void;
    onError?: (target: string, message: string) => void;
  };
}
```

**实现关键：**
- 当 `statusReporter` 传入时，跳过 `useWizard()` 调用，全部走传入的回调。
- 当未传入时，行为完全不变（保持 wizard 现有 UX 不被扰动）。
- `data-testid` 命名规则保持向后兼容：`section-regenerate-${target}`。
- busy 状态由组件自身的旋转图标表达（已存在），不依赖 statusReporter。

### 3.2 5 个编辑器新增按钮

#### `frontend/src/components/workspace/editors/ConceptEditor.tsx`

- 在 `concept` 段落标题后追加 `<SectionRegenerateButton target="概念" onRegenerate={...} />`
- 在 `story_dna` 段落标题后追加 `<SectionRegenerateButton target="Story DNA" onRegenerate={...} />`
- `onRegenerate` 实现：
  ```ts
  const handleRegenerateConcept = async (mods: string) => {
    const result = await api.regenerateConceptSection(projectId, "concept", mods);
    setConceptLocal(result.concept);
    onSaved(); // 也通知 ContextPanel 刷新（防止下次切 tab 时拿陈旧）
  };
  ```
- `readOnly === true` 时不渲染按钮。

#### `frontend/src/components/workspace/editors/WorldEditor.tsx`

- era / power_system / core_rules / factions 4 个标题各加 1 个 ↻（用 `regenerateWorldSection`）
- `power_systems[i]` 卡片右上角加 1 个 ↻（用 `regeneratePowerSystemItem`，沿用 wizard 模式）
- `onRegenerate` 把响应 `detail` 合并进本地 state。

#### `frontend/src/components/workspace/editors/CharacterEditor.tsx`

- 每个角色卡片的 personality / voice_signature / current_state / unknown / relations 段标题各加 1 个 ↻（用 `regenerateCharacterSection`）
- voice_signature.behavior_examples 段独立 1 个 ↻（用 `regenerateCharacterExamples`）
- 角色切换时按钮 target 命名加 character_id 后缀防止重复。

#### `frontend/src/components/workspace/editors/NovelOutlineEditor.tsx`

- core_conflict / volumes / mc_growth / key_plot 4 个标题各加 1 个 ↻（用 `regenerateNovelOutlineSection`）

#### `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`

- 编辑器顶部加 1 个 "↻ 重新生成章节大纲" 按钮
- 点击不直接走 `RegenerateModal`，而是打开**专用 `ChapterRangeRegenerateModal`**（新建组件，见 §3.3）

### 3.3 新组件 `ChapterRangeRegenerateModal`

**文件：** `frontend/src/components/workspace/editors/ChapterRangeRegenerateModal.tsx`

**Props：**
```tsx
interface ChapterRangeRegenerateModalProps {
  open: boolean;
  chapterCount: number;  // planned_total
  onConfirm: (chapterStart: number, chapterEnd: number, userModifications: string) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}
```

**UI 布局：**
- 顶部：黄底警告条"⚠ 已写章节不会自动重写或回填，请确认理解影响范围"
- 中部：两个 `<input type="number">` 横排（开始章节 / 结束章节），最小1，最大 `chapterCount`
- 下方：`RegenerateModal` 风格的 textarea（user_modifications，可选）+ 1700 字限制
- 底部：取消 + 确认（确认时校验 `start ≤ end`、都在范围内）

**复用：** textarea + 字数计数 + Esc/Cmd-Enter 行为直接抄 `RegenerateModal.tsx:90-148`，暂不抽象成更小组件（避免过度工程）。

### 3.4 客户端 API

**文件：** `frontend/src/api/client.ts`（约 line 892 后面）

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
    { chapter_start: chapterStart, chapter_end: chapterEnd, user_modifications: userModifications },
  ),
```

---

## 4. 数据流（章节大纲区间重生示例）

```
1. 用户点击 ChapterOutlineEditor 顶部 "↻ 重新生成章节大纲" 按钮
2. ChapterRangeRegenerateModal 打开
3. 用户输入 start=5, end=8, mods="让第7章节奏更紧凑"
4. 点击确认 → onConfirm(5, 8, "让第7章节奏更紧凑")
5. 调 api.regenerateChapterOutlineRange(projectId, 5, 8, "让第7章节奏更紧凑")
6. 后端循环调 agent.generate_outline(chapter_number=5..8)，逐章替换 outline.json 的 chapters 数组
7. 后端返回 { detail: { chapters: [...] } }
8. 前端 setLocalOutline(result.detail.chapters)
9. toast 弹 "第 5-8 章已重新生成"
```

**与手动编辑的耦合：** `ChapterOutlineEditor` 当前有手动编辑能力。乐观刷新后，本地 state 被覆盖为 API 响应值。**如果用户已经在 textarea 里改了内容但没保存**，会被覆盖。**对策：** 弹 modal 之前检测 `isDirty`，若有未保存手动修改，提示用户先保存或放弃修改（沿用 wizard 的 SectionRegenerateButton 行为：它不检测 dirty — 这个问题 wizard 已存在，本 spec 不修，列为 follow-up）。

---

## 5. 错误处理

| 场景 | 后端响应 | 前端表现 |
|---|---|---|
| `chapter_end < chapter_start` | 400 VALIDATION_ERROR | toast 报错，modal 不关闭 |
| `chapter_end > planned_total` | 400 VALIDATION_ERROR | toast 报错，modal 不关闭 |
| `outline.json` 为空 | 400 PRECONDITION_FAILED | toast 报错 |
| LLM 失败（ValueError） | 503 LLM_GENERATION_FAILED | toast 报错，modal 关闭 |
| 网络断开 | fetch reject | toast 报错，modal 关闭 |
| `payload.section` 不合法（其他端点） | 400 VALIDATION_ERROR | toast 报错 |

modal 设计：失败时**不自动关闭**，让用户看到错误可重试（沿用 wizard 行为）。

---

## 6. 测试

### 6.1 后端 `tests/test_chapter_outline_regenerate.py`（新文件）

- 成功：单章重生（start=end），返回 chapters 数组更新
- 成功：多章重生（start<end），chapters 数组按 chapter_number 排序
- 成功：区间外的章节字段 byte-identical（不调 agent、不污染）
- 成功：preceding chapters 上下文累积（start=5 时，第 6 章的 prompt 应能看到刚重生的第 5 章内容）
- 失败：chapter_end < chapter_start → 400
- 失败：chapter_end > planned_total → 400
- 失败：outline.json 为空 → 400
- 失败：LLM raise ValueError → 503
- 隔离：不动 `characters.json` 的 `growth_curve.bound_chapter`
- 隔离：不动 `progress.json.total_chapters`

### 6.2 前端 `SectionRegenerateButton` 既有断言保留

`frontend/src/test/SectionRegenerateButton.test.tsx`（已存在）：不传 `statusReporter` 走 wizard 路径，所有现有测试必须继续过。

### 6.3 前端 `SectionRegenerateButton` 新增 workspace 路径测试

- 传入 `statusReporter` 时，调 onRegenerate 后 success 调用 `statusReporter.onSuccess(target)`，error 时调用 `statusReporter.onError(target, msg)`
- 不调 `useWizard`（mock 不到的话注入到 wizard 上下文断言不调用）

### 6.4 前端 `ChapterRangeRegenerateModal` 新组件测试

`frontend/src/test/ChapterRangeRegenerateModal.test.tsx`（新文件）
- 输入 start=1, end=10，submit 调 onConfirm(1, 10, "...")
- start > end 时，submit 按钮 disabled 或调 onConfirm 但后端会拒绝（前端只做 UX 校验）
- start/end 超出 [1, chapterCount] 时同样
- Esc 取消
- Cmd+Enter 提交
- 黄底警告条常驻

### 6.5 前端 5 个 editor 集成测试

- 每个 editor 渲染时存在对应数量的 ↻ 按钮（按 tab 配）
- `readOnly === true` 时所有 ↻ 按钮不渲染
- 点击 ↻ 调对应 API（mock 验证）
- API 成功后本地 state 更新
- API 失败时 toast 报错

---

## 7. 风险与已知局限

| 风险 | 描述 | 缓解 |
|---|---|---|
| 已写章节与新世界观的 drift | 重新生成 world 后，已写章节基于旧 world，Fact Guard 下次写新场景时可能与旧场景不一致 | 用户自负风险，警告条；Fact Guard 自身设计为不重写已写章节 |
| 角色重新生成覆盖 behavior_examples 之外的字段 | regenerate-character-section 显式保留 behavior_examples（per-card 职责），但其他 voice_signature 字段会变 | 沿用 wizard 既有行为；用户自负风险 |
| 章节大纲区间重生影响后续 Scene Planning | 后续 chapter 的 Scene Planning 会读到新的 outline，已生成的 scene 不会被改 | 区间重生后，已生成的 scene draft 文件不变；但下次 advance-chapter 时会按新 outline 生成新 scene |
| 章节大纲区间重生与 growth curve 不同步 | 我们故意不调 `bind_growth_curve_to_outline` | 列在 §2.2 决策里；如果未来发现需要，重新评估 |
| 用户正在手动编辑时被覆盖 | 见 §4 数据流最后一段 | 列为 follow-up，wizard 端同样的问题不修，本 spec 不解决 |
| 多个按钮都处于 busy 状态 | UI 上每个按钮独立旋转图标 | 已存在；不视为问题 |

---

## 8. 不在本 spec 范围

- wizard 的 section 按钮行为变更
- 自动检测 dirty 状态后阻止重生（wizard 也无）
- 新增 growth curve 反向同步
- Stage 4-6 任何端点
- 重新生成 undo / redo（无现有基础设施）

---

## 9. 验收清单（手测）

- [ ] 概念 tab：concept ↻ 成功，看到新文本；Story DNA ↻ 成功
- [ ] 世界观 tab：4 个 section ↻ 成功；power_systems 数组里 3 张 card 各 ↻ 成功
- [ ] 角色 tab：每个角色 personality / voice_signature / current_state / unknown / relations ↻ 成功；behavior_examples ↻ 成功
- [ ] 大纲 tab：core_conflict / volumes / mc_growth / key_plot ↻ 成功
- [ ] 章节大纲 tab：start=5, end=8 → chapters[5..8] 全部更新，chapters[1..4] 和 [9..end] 不变
- [ ] 章节大纲 tab：start > end 时按钮不调 API（前端拦截）或后端拒绝
- [ ] 章节大纲 tab：start > planned_total 时前端拦截或后端拒绝
- [ ] 5 个 tab 在 `readOnly === true` 时所有 ↻ 按钮不渲染
- [ ] 黄底警告条在章节大纲 modal 里常驻
- [ ] wizard 的 section 按钮功能**不变**（回归）