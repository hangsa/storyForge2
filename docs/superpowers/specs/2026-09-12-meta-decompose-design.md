# Meta-Decompose for Stage 2 第一性拆解

日期: 2026-09-12
作者: brainstorming session (Claude + user)
关联实现: docs/design/meta_decompose.md

## 目标

让 S2 第一性拆解不再使用通用 YAML 提示词,而是基于每个项目的灵感 + 题材 + 基调 + 风格,先用「元提示词」自动生成一份**专用、特化**的第一性原理拆解提示词,再用这份专用提示词完成实际拆解。专用提示词持久化在项目级 override,可在 S2 顶部通过图标查看 / 编辑,「重新生成」会复用专用提示词而不再调元 LLM。

## 关键决策(来自 brainstorming)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 「重新生成」按钮 UX | 保留现有 RegenerateModal(自由文本「修改意见」) | 与图标编辑提示词通道正交,不强制用户每次重新生成都要编辑提示词 |
| 元 LLM 失败处理 | 硬错,S2 显示红色错误块 + 重试按钮,**不**降级到 generic YAML | Q2:保持流程的严肃性;generic YAML 的「专用」价值无法保证 |
| 专用提示词存储位置 | 项目级 `prompt_overrides.json`(`firstness_decompose.system_prompt`) | Q3:复用 3-tier 架构;`PromptOverrideStore.set_override` 已经支持按 name 写覆盖 |
| 后端 endpoint 拆分 | **2 个 endpoint**(`/meta-decompose` 写覆盖,`/decompose` 读覆盖后拆解) | frontend 可以区分「生成专用提示词中…」vs「拆解中…」两种 loading 文案 |
| 编辑图标 modal 行为 | 保存 → 关闭弹窗 → 用户**自行**点 footer「重新生成」 | 用户原文:「修改保存后点击'重新生成'即使用修改后的提示词进行重新拆解」 |
| 编辑覆盖源 | `firstness_decompose` 项目级 override,Plaza UI **隐藏**该 prompt | 让动态生成的提示词对用户不可手编;只保留 Plaza 编辑元提示词 `meta_decompose` 的入口 |
| Meta 触发时机 | 只在 S1 → S2 forward transition;footer regen / 图标编辑后 regen **不**调 meta | 用户原文:「只有从'灵感输入'点击下一步进入拆解环节,才调用元提示词生成拆解提示词」 |
| S2 backward jump(S3 → S2) | 不调 meta,只展示已有 dimensions | 与「只有 S1→S2 forward transition 才调 meta」一致 |

## 架构概览

5 个核心组件:

| # | 组件 | 位置 |
|---|---|---|
| 1 | 元提示词 YAML | `backend/prompts/creative/meta_decompose.yaml` (新) |
| 2 | 元提示词生成 API | `POST /api/v1/projects/{id}/creative/diverge/three-b/meta-decompose` (新) |
| 3 | 拆解 API(行为升级) | `POST /api/v1/projects/{id}/creative/diverge/three-b/decompose` — 读项目级 override 作为 system_prompt |
| 4 | S2 编辑图标 + 弹窗 | `frontend/.../divergence_v2/S2DecomposeStep.tsx` + 新 `EditPromptModal` 组件 |
| 5 | Prompt Plaza 改造 | `stageGroups.ts` 隐藏 `firstness_decompose`,添加 `meta_decompose` |

## 数据流

### S1 → S2 进入

```
S1 点「下一步:拆解 →」
  ↓
[1] POST /meta-decompose  body={prompt, genre_primary, tone, style}
    → 后端 invoke_meta_llm:调 router.execute(task_name="meta_decompose", json_mode=False)
    → 后端 override_store.set_override("firstness_decompose", {system_prompt: <text>})
  ↓ 返回 {generated_prompt: <text>, written_to_override: true}
[2] POST /decompose  body={prompt, genre_primary, tone, style}
    → 后端 load_prompt_effective("firstness_decompose", project_id) 合并 YAML+全局+项目覆盖
    → 用合并后的 system_prompt 调 firstness_decompose LLM
  ↓ 返回 {dimensions, causal_map, top_level_summary}
[3] S2 展示 dimensions + 总览 + 编辑图标
```

`S2 footer「下一步:发散 →」按钮`:
- 阶段 1(`metaLoading=true`):label = 「生成专用提示词中…」,disabled
- 阶段 2(`metaLoading=false && loading=true`):label = 「拆解中…」,disabled
- 阶段 3(全部完成):label = 「下一步:发散 →」,可点

### Footer「重新生成」

完全沿用现有逻辑,**不调元 LLM**:

```
点「重新生成」→ RegenerateModal → 用户输入「修改意见」→ 确认
  ↓
POST /decompose  body={..., user_modifications}
  → load_prompt_effective 已读到 prompt_overrides.json 里的 system_prompt(若存在)
  → 用该 system_prompt 调 firstness_decompose
  ↓ 返回新 dimensions
```

### 图标编辑提示词

```
点 S2 顶部图标 → EditPromptModal 打开
  ↓ textarea 预填 GET /api/v1/projects/{id}/prompts/firstness_decompose 返回的 system_prompt
用户修改 → 点「保存」
  ↓ PUT /api/v1/projects/{id}/prompts/firstness_decompose  body={system_prompt: <新文本>}
  → 后端 PromptOverrideStore.set_override 覆盖 prompt_overrides.json
关闭弹窗 → 用户自行点 footer「重新生成」走上面流程
```

`S2 backward jump`(S3 → S2):**不**调 meta;只展示已有 dimensions。`S2 forward jump via footer next` 也**不**调 meta(此时 `state.rawIntent` 不为空且已有 dimensions,只是跳到 S3 触发 `diverge`)。

### S1 → S2 再次进入(覆盖语义)

用户修改 S1 灵感点子后点「下一步」,会再次走 `runS1ToS2`,**覆盖**之前生成的专用提示词。用户之前的图标准编辑**会丢失**(符合用户原文「在用户重新从'灵感输入'点击下一步进入拆解环节,调用元提示词生成新拆解提示词时,覆盖原有的拆解提示词」)。

## 后端实现

### 新增文件:`backend/prompts/creative/meta_decompose.yaml`

```yaml
name: meta_decompose
provider: default
model: default
temperature: 0.7
max_tokens: 8192
negative_constraints: ""

system_prompt: |
  (来自 docs/design/meta_decompose.md,四步方法论:
  诊断设定类型 → 生成第一性追问 → 整合为专用提示词 → 只输出提示词本身)

user_prompt_template: |
  小说创意: {prompt}
  主类型: {genre_primary}
  基调: {tone}
  风格: {style}

output_format:
  type: text
```

`output_format.type: text` 是个新枚举值;`_invoke_llm_text` 会基于它选择 `json_mode=False`。

### 改动:`backend/creative_os/three_b_engine.py`

```python
# 顶部新增常量
META_DECOMPOSE_PROMPT = "meta_decompose"

# 新增方法(类内)
async def invoke_meta_llm(self, project_id: str, raw_intent: RawIntent) -> str:
    """基于 raw_intent 生成专用第一性拆解提示词,写入项目级 firstness_decompose override。

    纯文本输出。返回原始 LLM 文本以供前端展示(也用于调试)。
    """
    prompt_data = self._load_prompt(META_DECOMPOSE_PROMPT, project_id)
    system = prompt_data["system_prompt"].format(negative_constraints="")
    user = prompt_data["user_prompt_template"].format(
        prompt=raw_intent.prompt,
        genre_primary=raw_intent.genre_primary,
        tone=raw_intent.tone or "(无)",
        style=raw_intent.style or "(无)",
    )
    response = await self._router.execute(
        agent_name="three_b",
        task_name="meta_decompose",
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
        json_mode=False,
        temperature=prompt_data.get("temperature", 0.7),
        max_tokens=prompt_data.get("max_tokens", 8192),
    )
    text = (response.get("content") or "").strip()
    if not text:
        raise ValueError("meta_decompose: LLM 返回空文本")
    # 写入项目级覆盖(让 /decompose 通过 load_prompt_effective 读到)
    self._override_store.set_override(
        project_id, "firstness_decompose", {"system_prompt": text}
    )
    return text
```

`decompose()` 方法本身**不变**:`load_prompt_effective` 已经在用 project_id,所以自动读到 override。

### 新增 endpoint:`backend/api/three_b_routes.py`

```python
class MetaDecomposeRequest(BaseModel):
    prompt: str = Field(..., min_length=10)
    genre_primary: str
    tone: str = ""
    style: str = ""

class MetaDecomposeResponse(BaseModel):
    generated_prompt: str
    written_to_override: bool = True

@router.post("/meta-decompose")
async def meta_decompose(project_id: str, body: MetaDecomposeRequest, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        text = await engine.invoke_meta_llm(
            project_id,
            RawIntent(
                prompt=body.prompt,
                genre_primary=body.genre_primary,
                tone=body.tone,
                style=body.style,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("meta_decompose failed")
        raise HTTPException(status_code=503, detail=f"元提示词生成失败: {e}")
    return {"generated_prompt": text, "written_to_override": True}
```

`/decompose` endpoint 完全不变 — 它通过 `load_prompt_effective` 自动消费 override。

## 前端实现

### 新增组件:`frontend/src/components/wizard/divergence_v2/EditPromptModal.tsx`

Props:

```ts
interface EditPromptModalProps {
  open: boolean;
  initialText: string;
  busy?: boolean;
  onSave: (newText: string) => void | Promise<void>;
  onCancel: () => void;
}
```

行为:
- 复用 `RegenerateModal` 的 Esc 关闭 + Cmd/Ctrl+Enter 提交模式
- textarea 高度 ~280px(比 RegenerateModal 的 140px 高,因为提示词文本较长)
-「保存」按钮:`busy` 时显示 spinner + 「保存中…」
-「取消」按钮:始终可点;若 `busy=true` 仍禁用,以免与 in-flight 保存竞争
- 关闭弹窗**不**自动调 decompose(按用户要求:用户保存后自行点 footer「重新生成」)

### 改动:`frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx`

总览 div 改为 flex 布局,左侧图标,右侧文本:

```tsx
{topLevelSummary && (
  <div className="bg-primary-container/5 rounded-lg py-2 px-3" data-testid="top-level-summary">
    <div className="flex items-start gap-2">
      <button
        type="button"
        aria-label="查看/编辑本次拆解的专用提示词"
        data-testid="edit-decompose-prompt-btn"
        onClick={() => setEditPromptOpen(true)}
        className="shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-primary-container/15 text-primary-container"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">edit_note</span>
      </button>
      <p className="flex-1 text-sm text-primary">{topLevelSummary}</p>
    </div>
  </div>
)}
```

Props 扩展:

```tsx
interface Props {
  dimensions: DimensionDecomposition[];
  topLevelSummary: string;
  decomposePrompt: string;       // 新增:来自 backend 的当前专用提示词
  promptBusy: boolean;            // 新增:PUT 是否 in-flight
  onSavePrompt: (newText: string) => Promise<void>;  // 新增
  // 现有 props 保留...
}
```

在 S2 底部加 `<EditPromptModal open={editPromptOpen} initialText={decomposePrompt} busy={promptBusy} onSave={onSavePrompt} onCancel={...} />`。

### 改动:`frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts`

新增 action + thunk `runS1ToS2`:

```ts
type Action = ...
  | { type: "META_DECOMPOSE_START" }
  | { type: "META_DECOMPOSE_SUCCESS"; generatedPrompt: string }
  | { type: "META_DECOMPOSE_ERROR"; message: string }
  | { type: "SAVE_PROMPT_START" }
  | { type: "SAVE_PROMPT_SUCCESS"; decomposePrompt: string }
  | { type: "SAVE_PROMPT_ERROR"; message: string }
  | { type: "HYDRATE_DECOMPOSE_PROMPT"; decomposePrompt: string };

interface State {
  // ...
  metaLoading: boolean;
  decomposePrompt: string;  // 来自 GET /prompts/firstness_decompose 的 system_prompt
  promptBusy: boolean;
}

const runS1ToS2 = useCallback(async (intent: RawIntent) => {
  dispatch({ type: "STAGE1_SUCCESS", intent });
  dispatch({ type: "META_DECOMPOSE_START" });
  try {
    const r = await api.postThreeBMetaDecompose(projectId, intent);
    dispatch({ type: "META_DECOMPOSE_SUCCESS", generatedPrompt: r.generated_prompt });
  } catch (e: any) {
    dispatch({ type: "META_DECOMPOSE_ERROR", message: e.message });
    return; // 硬错:不进入阶段 2
  }
  dispatch({ type: "DECOMPOSE_START" });
  try {
    const r = await api.postThreeBDecompose(projectId, { ...intent, user_modifications: undefined });
    dispatch({
      type: "DECOMPOSE_SUCCESS",
      dimensions: r.dimensions,
      causalMap: r.causal_map,
      topLevelSummary: r.top_level_summary,
    });
  } catch (e: any) {
    dispatch({ type: "DECOMPOSE_ERROR", message: e.message });
  }
}, [projectId]);

const savePrompt = useCallback(async (newText: string) => {
  dispatch({ type: "SAVE_PROMPT_START" });
  try {
    await api.putProjectPrompt(projectId, "firstness_decompose", { system_prompt: newText });
    dispatch({ type: "SAVE_PROMPT_SUCCESS", decomposePrompt: newText });
  } catch (e: any) {
    dispatch({ type: "SAVE_PROMPT_ERROR", message: e.message });
  }
}, [projectId]);
```

`HYDRATE` 时同时拉取现有 decomposePrompt:在 useEffect 里多发一个 `api.getProjectPrompt(projectId, "firstness_decompose")`,dispatch `HYDRATE_DECOMPOSE_PROMPT`。这样回到 S2 时 textarea 能预填(若 override 存在)。

### 改动:`frontend/src/components/wizard/CreativeDivergenceStep.tsx`

`handleS1Submit` 改:

```tsx
const handleS1Submit = useCallback((intent: RawIntent) => {
  jumpToStage("2");
  runS1ToS2(intent);  // 之前是 decompose(intent)
}, [jumpToStage, runS1ToS2]);
```

S2 footer next handler 按 `state.metaLoading` 区分 loading label:

```tsx
} else if (sub === "2") {
  const disabled = state.loading;
  const loadingLabel = state.metaLoading
    ? "生成专用提示词中…"
    : "拆解中…";
  setNext(() => requestNext("3"), disabled, "下一步:发散 →", loadingLabel);
}
```

S2 backward jump 触发 decompose 的 useEffect(现 L161-165)保持不变 — 但只在 `!state.metaLoading` 时才允许重新 decompose(否则会被并发的 `runS1ToS2` 干扰):

```tsx
useEffect(() => {
  if (
    state.currentSubStage === "2" &&
    state.dimensions.length === 0 &&
    state.rawIntent &&
    !state.loading &&
    !state.metaLoading   // 新增
  ) {
    decompose(state.rawIntent);
  }
}, [state.currentSubStage, state.dimensions.length, state.rawIntent, state.loading, state.metaLoading, decompose]);
```

### 新增 API helper:`frontend/src/api/client.ts`

```ts
async function postThreeBMetaDecompose(
  projectId: string,
  body: { prompt: string; genre_primary: string; tone: string; style: string }
) {
  return request(`/api/v1/projects/${projectId}/creative/diverge/three-b/meta-decompose`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

`api.getProjectPrompt(projectId, "firstness_decompose")` 与 `api.putProjectPrompt(...)` 已经存在,直接复用。

## Prompt Plaza 改造

### 改动:`frontend/src/components/home/promptPlaza/stageGroups.ts`

```ts
/** 从 Plaza UI 隐藏的内置提示词 — 后端 YAML 仍存在供 load_prompt_effective 兜底。*/
export const HIDDEN_BUILTIN_PROMPTS: ReadonlyArray<string> = [
  // firstness_decompose 在 S2 由元提示词动态生成;Plaza UI 不能让用户手编
  // 这份动态提示词(否则会出现「用户编辑了但下次 S1→S2 触发 meta 时被覆盖」的歧义)。
  // 后端仍以 YAML 形式保留文件,作为 meta 失败时系统层的最后兜底(虽然此次实现 meta 失败
  // 不再降级到 YAML),以及 /meta-decompose 写入 prompt_overrides.json 时的 base 用于
  // _pruned_override 计算。
  "firstness_decompose",
];

// groupByStage 跳过 hidden:
export function groupByStage(prompts) {
  const buckets = new Map<string, PromptSummary[]>();
  for (const key of PROMPT_STAGE_ORDER) buckets.set(key, []);
  for (const p of prompts) {
    if (HIDDEN_BUILTIN_PROMPTS.includes(p.name)) continue;
    buckets.get(stageOf(p.name))!.push(p);
  }
  return Array.from(buckets.entries()).filter(([, items]) => items.length > 0);
}
```

PROMPT_NAME_TO_STAGE 新增 `meta_decompose: "divergence"`。

### 改动:`backend/services/prompt_override_store.py`

```python
PROMPT_LABEL_OVERRIDES: dict[str, str] = {
  # ... existing entries ...
  "meta_decompose": "拆解元提示词",  # 新增
  "firstness_decompose": "第一性拆解",  # 保留 label(虽然 Plaza UI 隐藏,但后端其它逻辑可能依赖)
}
```

## 错误处理

| 场景 | HTTP 状态 | detail 文案 | 前端展示 |
|---|---|---|---|
| `/meta-decompose` LLM 异常 | 503 | `元提示词生成失败: <原始错误>` | S2 顶部红色错误块 + 「重试」按钮;**不**进入阶段 2 |
| `/meta-decompose` LLM 返回空文本 | 422 | `meta_decompose: LLM 返回空文本` | 同上 |
| `/meta-decompose` prompt 过短 | 422 | FastAPI 自动校验:`prompt: String should have at least 10 characters` | 同上 |
| `/decompose` 失败(网络/LLM/JSON 解析) | 503 / 422 | 沿用现有文案(`DECOMPOSE_FAILED: ...`) | 沿用现有红色错误块 |
| `/decompose` 因无 raw_intent 拒绝 | 422 | 沿用现有 | 沿用现有 |
| EditPromptModal PUT 失败 | (沿用 Plaza 现有 422/503) | 沿用现有 | EditPromptModal 内「保存」按钮转 spinner,失败后回到可编辑状态,弹 toast |

## 测试

### 后端新增:`backend/tests/test_three_b_meta_decompose.py`

1. `test_meta_decompose_endpoint_writes_override`:mock router.execute 返回固定字符串 → 调 `/meta-decompose` → 断言:
   - 响应 `{"generated_prompt": "...", "written_to_override": true}`
   - `prompt_overrides.json` 中 `firstness_decompose.system_prompt` 等于响应字符串
2. `test_meta_decompose_failure_returns_503`:mock router.execute 抛异常 → 断言 503 + detail 含「元提示词生成失败」
3. `test_meta_decompose_empty_response_returns_422`:mock 返回 `{"content": ""}` → 断言 422
4. `test_subsequent_decompose_reads_meta_override`:先调 `/meta-decompose`,再调 `/decompose`,断言 router.execute 的第二次调用 messages[0].content 等于 override 里的 system_prompt
5. `test_regenerate_does_not_call_meta`:只调 `/decompose`(不调 meta),断言 router.execute 只被调 1 次且 task_name="decompose"(不应出现 "meta_decompose")
6. `test_decompose_with_no_override_uses_yaml`:fresh project(无 prompt_overrides.json)调 `/decompose`,断言 router.execute 的 system_prompt 等于 YAML 默认值

### 前端新增 / 扩展

- `frontend/src/test/wizard/divergence_v2/S2DecomposeStep.test.tsx`(新):
  - 渲染时顶部出现 `edit-decompose-prompt-btn` 按钮
  - 点击 → EditPromptModal 打开,textarea 预填 `decomposePrompt` prop
  - 修改 → 「保存」→ 断言 `api.putProjectPrompt` 被调且 body.system_prompt 等于修改后文本
  - 关闭 modal 后断言**没有**自动调 `/decompose`(用户原文:用户保存后自行点 footer regen)
- `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`(扩展):
  - `handleS1Submit` 触发时,断言先调 `postThreeBMetaDecompose` → 等其 resolve → 再调 `postThreeBDecompose`
  - meta 失败时,**不**调 `/decompose`,`state.error` 文案包含「元提示词生成失败」
  - footer next label 在不同阶段正确:`metaLoading=true` → 「生成专用提示词中…」;否则 `loading=true` → 「拆解中…」;都 false → 「下一步:发散 →」
  - 跳到 S3 后 back 到 S2:不调 meta,只展示已有 dimensions
- `frontend/src/test/wizard/divergence_v2/runS1ToS2.test.ts`(新):
  - 完整两阶段序列:state 转换正确(metaLoading true → false;loading true → true → false)
  - meta 错误时 DECOMPOSE_START 不被 dispatch
- `frontend/src/test/promptPlaza/stageGroups.test.ts`(扩展):
  - 断言 `firstness_decompose` 不出现在 `groupByStage` 输出
  - 断言 `meta_decompose` 在 "divergence" group

## 文档

- `docs/design/meta_decompose.md` 已经是 spec 文档,**无需改动** — 本次实现按它做。
- `CLAUDE.md` 项目记忆不更新(本次改动是 incremental feature)。
- 本设计文档: `docs/superpowers/specs/2026-09-12-meta-decompose-design.md`(本文件)。

## 实施顺序

1. **后端 YAML + engine + endpoint**:`meta_decompose.yaml`(新),`three_b_engine.py` 加 `invoke_meta_llm`,`three_b_routes.py` 加 endpoint。1 commit。
2. **后端测试**:`backend/tests/test_three_b_meta_decompose.py` 6 个用例。1 commit。
3. **Prompt Plaza 改造**:`stageGroups.ts`(HIDDEN_BUILTIN_PROMPTS + groupByStage 过滤 + meta_decompose stage mapping),`prompt_override_store.py`(PROMPT_LABEL_OVERRIDES 加 meta_decompose)。2 文件,1 commit。
4. **前端 EditPromptModal + S2 顶部图标**:新组件 `EditPromptModal.tsx`,`S2DecomposeStep.tsx` 加按钮 + props 扩展。2 文件,1 commit。
5. **前端 S1→S2 两阶段加载**:`useThreeBDivergence.ts` 加 `runS1ToS2` + metaLoading state + HYDRATE_DECOMPOSE_PROMPT,`CreativeDivergenceStep.tsx` 改 `handleS1Submit` + footer loading label + backward-jump useEffect 守护,`client.ts` 加 `postThreeBMetaDecompose`。3 文件,1 commit。
6. **前端测试**:S2DecomposeStep.test.tsx(新)、CreativeDivergenceStep.test.tsx(扩展)、runS1ToS2.test.tsx(新)、stageGroups.test.ts(扩展)。4 文件,1 commit。

总计 6 个 commit,每步独立可测、可回滚。