# 类型融合(主+副类型)接线 Spec

> 上游 PRD:[`/docs/design/创意发散系统PRD_v1.0.docx`](../design/创意发散系统PRD_v1.0.docx) §3.4 / §4.1 / §5.2 / 表 3 / 表 6
> 上游 Spec:[`/docs/superpowers/specs/2026-08-30-creative-divergence-refactor-design.md`](2026-08-30-creative-divergence-refactor-design.md)
> 范围:S0-A 灵感输入 → S0-B 变体生成 → S0-E 提交 的「主类型 + 副类型」端到端接线
> 不在范围:GenreFusionEngine 算法升级、MutationOp 接入 `/apply-mutation`、Canvas 独立画布 UI 重做、Path B 删除(v1.3)

---

## 1. 背景与目标

### 1.1 当前 gap

`docs/superpowers/specs/2026-08-30-creative-divergence-refactor-design.md` 已经把 divergence 系统的 5 阶段骨架、路由、引擎接线全部搭好了,但主+副类型的端到端链路没接通。读源码后整理如下:

| 层 | 现状 | 问题 |
|---|---|---|
| 前端 S0A 下拉 | `genre_primary` 必填、`genre_secondary` 可选,收集进 `RawIntent` | `submit()` 只把 `rawIntent.prompt` 发给 `/init`,主+副类型根本没出组件 |
| 后端 `/init` | 只读 `data.get("premise")`,写 `{"prompt": premise, "trope_tags": []}` | 主+副类型在门口就被丢弃 |
| 后端 `/fuse` | 端点存在,接收 `genre_primary/secondary`,跑 BFS 距离 + LLM fusion,产出 risk-graded variant | **UI 完全没调用**,`postDivergeFuse` 只在 `api/client.ts` 定义 |
| S0-B mutation 步骤 | `MUTATION_OPS = ["inversion", "escalation", "subversion"]`(`S0BMutationStep.tsx:33`),显式 drop fusion | 即使用户补做融合,也没有 UI 入口 |
| 后端 `/commit` | `genre = project.get("genre", "cool_novel")`(`creative_diverge.py:1847`) | 读 `project.json`,**不读 `raw_intent`**,完全忽略主+副类型 |
| `concept_and_dna.genre` | 来自 `PlannerAgent(genre=genre)` 的 LLM 输出 | 输入的 `genre` 只来自 `project.json`,没融合主+副 |

PRD §3.4 原话:**"当用户选择 fusion 变异操作,或在灵感输入阶段勾选'类型融合'时激活"** —— 副类型一旦填写,GenreFusionEngine 就该启动。当前实现里这个触发器完全没接。

### 1.2 目标

1. **持久化**:`/init` 把 `RawIntent` 整体(主+副类型 + target_reader + reference_works + forbidden_directions + quick_mode)写入 `canvas_state.json` 的 `raw_intent` 字段
2. **S0-A 自动触发**:用户提交 S0-A 时若副类型有值,**自动调 `/fuse`** 产出 1 个 fusion variant,加入 `idea_variants`,与 mutation chain 的变体并列展示
3. **S0-B 显式按钮**:S0-B 顶部加「融合变体」按钮,允许用户在选定 premise 后**补做**类型融合(对应 PRD §3.4 第二条触发路径)
4. **`/commit` 消费**:`/commit` 从 `canvas.raw_intent.genre_primary` 喂给 `PlannerAgent`(catalog 可解析的 genre ID);融合信息写入 `concept_and_dna.story_dna.fusion_meta` 独立字段,供下游消费
5. **`/fuse` 健壮性**:`/fuse` 在 canvas 未初始化或缺主类型时返回明确错误码;在 LLM 不可用时降级为合成 variant(沿用现有 `try/except NotImplementedError` 路径)

### 1.3 不在范围

- GenreFusionEngine BFS 距离图谱扩到 50+ 类型(目前 10 主类型)
- 把 fusion 作为 `MUTATION_OPS` 一员接入 `/apply-mutation` —— `/apply-mutation` 设计上只支持单源节点,fusion 需要双源,继续走独立 `/fuse` 端点
- 跨项目 IdeaPool 查询 / 24h 草稿归档
- 修改 Canvas 独立画布模式

---

## 2. 设计意图回顾(PRD 摘要)

### 2.1 `raw_intent` 字段定义(PRD §4.1 表 5)

| 字段 | 必填 | 说明 |
|---|---|---|
| `prompt` | ✅ | 核心创意描述,建议 30-200 字 |
| **`genre_primary`** | ✅ | 主类型,从 10 个预设列表选择(修仙/都市/星际/游戏/历史/军事/体育/校园/悬疑/奇幻) |
| **`genre_secondary`** | ❌ | **副类型,触发 GenreFusionEngine** |
| `target_reader` | ❌ | 目标读者群,影响 tone |
| `reference_works` | ❌ | 参考作品(最多 3 部) |
| `forbidden_directions` | ❌ | 注入 MutationEngine 禁止列表 |
| `quick_mode` | ❌ | 跳过 What-If 展开 |

### 2.2 GenreFusionEngine 触发逻辑(PRD §3.4)

> 当用户选择 fusion 变异操作,**或在灵感输入阶段勾选'类型融合'时激活**。通过 BFS 距离矩阵计算两个类型之间的叙事距离,距离越远融合结果越新颖但风险越高。

**关键解读**:「在灵感输入阶段勾选'类型融合'时激活」—— "勾选"可以解读为两种 UI 形态:

- (a) 选了副类型就算勾选(隐式)
- (b) 副类型旁显式加个"启用类型融合"勾选框(显式)

本 spec 选 **(b) 显式勾选**,理由:与 PRD "勾选" 字面对齐;允许用户填副类型但不立刻跑融合(比如想先把 prompt 改清楚);和 PRD §2.2 "5 分钟快速模式"对(快速模式用户可能跳过融合)。

### 2.3 距离 → 风险等级

**⚠ PRD §3.4 表 3 与代码不一致 —— 本 spec 以代码为准**

PRD 表 3 描述的是 0-100 距离区间的百分比映射,但 `GenreFusionEngine.compute_distance` 实际返回 **int 0-3(BFS 跳数)**,`get_risk_level`(`genre_fusion_engine.py:73`)按此映射:

| BFS 距离(跳数) | 风险 | 含义 |
|---|---|---|
| 0 | low | 同一类型 |
| 1 | low | 一跳可达(紧邻) |
| 2 | medium | 两跳可达(中等距离) |
| ≥ 3 | high | 三跳及以上 / 不可达 |

**业务示例(用 catalog 内 genre IDs 演示)**:
- 修仙 + 武侠 → distance 0 → low(同一家族)
- 修仙 + 克苏鲁 → distance ≈ 2 → medium
- 修仙 + 法庭推理 → distance ≈ 3+ → high(catalog 内无对应 genre,fallback)

**实际产出**:`/fuse` 的 `FuseResponse.fusion_distance.distance` 是 int 0-3;本 spec 的 genre 字符串会带真实跳数(0/1/2/3),不会更大。

### 2.4 `concept_and_dna` 字段映射(PRD 表 6)

| concept_and_dna 字段 | 来源(当前) | 来源(本 spec 修复后) |
|---|---|---|
| `concept.genre` | `project.json.genre` | **`raw_intent.genre_primary`**(catalog 可解析的 ID,喂给 PlannerAgent) |
| `story_dna.fusion_meta` | (不存在) | **新增字段**:`{secondary, risk_level, distance}`,副类型选填时记录 |
| `core_contradiction.*` | canvas.core_contradiction | 不变 |
| `value_stack[4 levels]` | branch_choices + What-If 路径 | 不变 |

**关键设计决策**:`concept.genre` 只存 catalog 可解析的主类型 ID(`genre_primary`),不拼融合字符串进 LLM prompt。原因:

- `_resolve_genre_label(genre)` 会调 `catalog.get(genre)`(`writer.py:23`),找不到就 fallback 到 index 第一个条目 —— 如果传 `"修仙 × 悬疑 (risk=low, distance=2)"`,**整个 tone/style_rules/trope_patterns 注入都会失效**,LLM 拿到的是 fallback genre 的写作风格,与用户实际期望完全脱钩
- 融合语义通过新增的 `story_dna.fusion_meta` 字段独立承载,Stage 2/3 可读
- 若需要 LLM 感知融合,在 `canvas_to_concept.yaml` 加 `{fusion_secondary_genre}` / `{fusion_risk_level}` 占位符(本 spec 不做,但留接口)

---

## 3. 目标行为

### 3.1 端到端数据流

```
S0-A submit (主=仙侠, 副=悬疑, 勾选"启用类型融合")
   │
   ├─► POST /init  {prompt, genre_primary:"仙侠", genre_secondary:"悬疑", ...}   ─► canvas.raw_intent 持久化全部字段
   │
   ├─► POST /fuse  {genre_primary:"仙侠", genre_secondary:"悬疑", prompt}        ─► 1 个 fusion variant
   │      │
   │      ├─► GenreFusionEngine.compute_distance → 2 (medium)
   │      ├─► MutationEngine.fuse(trope_a, trope_b) → MutationResult
   │      └─► _mutation_to_idea_variant(risk_level="medium", distance=2)
   │            ─► variant {mutation_type:"fusion", risk_level:"medium", fusion_distance:2}
   │
   └─► S0-B 显示 6 mutation variants + 1 fusion variant(共 7 张卡)
         │
         └─► 用户可点顶部"重新融合"按钮(再次调 /fuse,新 variant 替换旧 fusion,ID 不变)

S0-E commit
   │
   ├─► 读 canvas.raw_intent.genre_primary="仙侠"(catalog 可解析)
   ├─► 读 canvas.idea_variants 找到 fusion variant ─► fusion_meta = {secondary:"悬疑", risk:"medium", distance:2}
   ├─► PlannerAgent(genre="仙侠")  ← 只传主类型,catalog 命中 xianxia.yaml
   ├─► story_dna.fusion_meta = {secondary, risk_level, distance}  ← 独立字段
   └─► concept_and_dna.concept.genre = "仙侠",story_dna.fusion_meta = {...}
```

### 3.2 行为约束(契约)

| ID | 行为 | 触发 | 不变量 |
|---|---|---|---|
| C1 | 副类型未填 → 不调 `/fuse` | S0-A submit | canvas.idea_variants 不含 mutation_type="fusion" |
| C2 | 副类型已填但用户**未勾选**"启用类型融合" → 不调 `/fuse` | S0-A submit | 同 C1 |
| C3 | 副类型已填 + 已勾选 → 自动调 `/fuse` | S0-A submit | canvas.idea_variants 追加 1 个 fusion variant(若 LLM 成功) |
| C4 | `/fuse` 失败(LLM 不可用 / 异常) → **不写 canvas**,S0-A 收到 `fusionBanner` | `/fuse` 异常 | 不阻塞 S0-A 主流程 |
| C5 | S0-A 显示 info banner "类型融合未启用(LLM 后端不可用)" | S0-A | 用户可继续,后续 step 无 fusion variant |
| C6 | S0-B "重新融合"按钮 → 调 `/fuse`,新 variant 替换旧 fusion variant(ID 不变) | S0-B 点击 | 不影响其他 mutation variants |
| C7 | `/commit` 时若 `raw_intent.genre_secondary` 缺失 → `concept.genre = genre_primary`,无 `fusion_meta` | `/commit` | 与无副类型时一致 |
| C8 | `/commit` 时若 `raw_intent.genre_primary` 缺失 → **fallback 到 `project.json.genre`**(见 D4) | `/commit` | 防御兜底,不阻塞旧项目 commit |
| C9 | `/regenerate/{node_id}/regenerate` 对 `mutation_type="fusion"` → 调用 `/fuse` 重跑,不是 fallback INVERSION | S0-B 点"重新生成" | fusion variant 保持 fusion 类型 |

---

## 4. API 变更

### 4.1 `POST /creative/diverge/init` —— body 扩展

**当前请求体**:
```json
{"premise": "一个关于永生者寻找死亡方法的故事"}
```

**新请求体**(向后兼容,旧 `premise` 字段保留):
```json
{
  "premise": "...",
  "genre_primary": "修仙",
  "genre_secondary": "克苏鲁",
  "target_reader": "...",
  "reference_works": ["诡秘之主"],
  "forbidden_directions": ["后宫"],
  "quick_mode": false
}
```

**后端处理**:
- 用 Pydantic `BaseModel` `InitRequest` 替换 `data: dict`(避免魔法 key)
- 写入 `canvas.raw_intent`:
  ```json
  {
    "prompt": <premise>,
    "genre_primary": <必填,空时 400 GENRE_MISSING>,
    "genre_secondary": <可选,None 时不写>,
    "target_reader": <可选>,
    "reference_works": <可选 list>,
    "forbidden_directions": <可选 list>,
    "quick_mode": <bool,默认 False>,
    "trope_tags": []
  }
  ```
- `premise` 字段映射到 `raw_intent.prompt`(Pydantic 自动;无需 alias)
- **向后兼容**:旧 caller `{"premise": "..."}` 缺 `genre_primary` 会被 Pydantic 直接 422;唯一已知 caller 是 `S0AInputStep.tsx`,本 spec 同步更新;**无外部 API 消费者**
- PRD §7.1 表 9 错误码:`GENRE_MISSING` 已在 PRD 中定义,本 spec 复用

**响应不变**(保持 `{error, code, message, detail}` envelope)。

### 4.2 `POST /creative/diverge/fuse` —— 错误码补齐 + 响应契约

端点本身已实现(`creative_diverge.py:2467`),本 spec 不改算法,只补错误码契约 + 响应字段。

**响应契约**(已存在,需要前端正确消费):
```json
{
  "variants": [<IdeaVariant>],     // 数组,通常 length=1
  "fusion_distance": {
    "distance": 2,                  // int 0-3,见 §2.3
    "compatibility": "中"           // "高"/"中"/"低"
  },
  "risk_level": "medium"            // "low"/"medium"/"high"
}
```

前端 `FuseResponse`(`client.ts:681`)已对齐此结构。**注意:`/fuse` 返回的是 `variants` 数组,不是单个 `variant`**。

**错误码补齐**:

| 场景 | HTTP | code | 何时 |
|---|---|---|---|
| canvas 未初始化 | 400 | `CANVAS_NOT_INITIALIZED` | 复用 `/commit` 已有错误码 |
| `raw_intent.genre_primary` 缺失 | 400 | `INTENT_INCOMPLETE` | 新增,防御性 |
| `genre_secondary` 缺失(请求体) | 400 | `INTENT_INCOMPLETE` | 新增(用户不应绕过 UI 直接调) |
| 主+副类型相同(distance=0,无意义) | 400 | `FUSION_SAME_GENRE` | 新增(前端 S0A 已过滤同类) |
| LLM 不可用 | 200 | (无错,降级合成 variant) | 沿用现有 `NotImplementedError` 降级路径 |

请求体 `FuseRequest` 已经定义,不动:
```python
class FuseRequest(BaseModel):
    genre_primary: str
    genre_secondary: str
    prompt: str = ""
```

**Fusion variant 扩展字段**(本 spec 新增,见 §4.3 与 §7.2):
```python
{
  ...,
  "risk_level": "medium",          # 新增,从 /fuse 响应复制
  "fusion_distance": 2,            # 新增,从 /fuse 响应复制
}
```

需要在 `_mutation_to_idea_variant` 中加这两个字段(`creative_diverge.py:2316`),并把 `/fuse` 的 distance + risk_level 透传进去。

### 4.3 `POST /creative/diverge/commit` —— genre 来源 + fusion_meta 字段

**当前**(`creative_diverge.py:1846-1847`):
```python
project = _get_fm().read_json(project_id, "project.json") or {}
genre = project.get("genre", "cool_novel")
```

**修复后**(只把主类型喂给 PlannerAgent,fusion_meta 独立存):
```python
raw_intent = canvas.get("raw_intent") or {}
genre_primary = (raw_intent.get("genre_primary") or "").strip()
genre_secondary = (raw_intent.get("genre_secondary") or "").strip()

# C7/C8: genre 优先 raw_intent.genre_primary,缺失时 fallback project.json
if genre_primary:
    genre = genre_primary
    genre_source = "raw_intent_primary"
else:
    project = _get_fm().read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")
    genre_source = "project_json_fallback"

# 融合元数据:仅在副类型有值且存在 fusion variant 时写入
fusion_meta = None
if genre_secondary:
    fusion_meta = _extract_fusion_metadata(canvas)
    # fusion_meta = (risk_level, distance) 或 None
```

后续 LLM 调用仍走现有路径(用 `genre`),不拼字符串。

**写入 concept_and_dna.json**(`/commit` 现有 line ~1995):
```python
concept_and_dna = {
    "concept": concept,
    "story_dna": story_dna,
    "source": "canvas",
    "canvas_snapshot": {
        "selected_path": selected_path,
        "committed_at": now,
    },
}
# 本 spec 新增:
if fusion_meta is not None:
    concept_and_dna["story_dna"]["fusion_meta"] = {
        "secondary_genre": genre_secondary,
        "risk_level": fusion_meta[0],
        "distance": fusion_meta[1],
    }
```

**新增 helper** `_extract_fusion_metadata(canvas)`:
```python
def _extract_fusion_metadata(canvas: dict) -> Optional[tuple[str, int]]:
    """Return (risk_level, distance) from the most recent fusion variant.

    Returns None when no fusion variant exists on the canvas (so /commit
    can decide whether to write fusion_meta or skip). Picks the LAST
    fusion variant by list position — variants are appended in order, so
    last == most recent.

    Defaults ("low", 0) when a fusion variant exists but its metadata
    fields are missing (defensive for legacy / partial canvas state).
    """
    variants = canvas.get("idea_variants", []) or []
    fusions = [v for v in variants if v.get("mutation_type") == "fusion"]
    if not fusions:
        return None
    fusion = fusions[-1]   # last = most recent (append-only invariant)
    risk = (fusion.get("risk_level") or "low").strip() or "low"
    try:
        dist = int(fusion.get("fusion_distance") or 0)
    except (TypeError, ValueError):
        dist = 0
    return (risk, dist)
```

需要在 `_mutation_to_idea_variant` 中给 fusion variant 多塞两个字段:

```python
def _mutation_to_idea_variant(
    result, genre_a: str, genre_b: str,
    *, risk_level: str = "low", distance: int = 0,
) -> dict:
    return {
        ...,
        "mutation_type": result.operation.value,
        "mutation_logic": result.core_conflict,
        "risk_level": risk_level,            # 新增
        "fusion_distance": distance,         # 新增
        ...
    }
```

`/fuse` 调用处增加入参:
```python
fusion_engine = GenreFusionEngine()
distance = fusion_engine.compute_distance(req.genre_primary, req.genre_secondary)
risk_level = _risk_from_distance(distance)
...
variant = _mutation_to_idea_variant(
    mutation_result, req.genre_primary, req.genre_secondary,
    risk_level=risk_level, distance=distance,   # 新增
)
```

降级合成 variant 路径(`NotImplementedError` 分支)同样补 `risk_level/distance`(用同一 `distance/risk_level` 计算结果)。

### 4.4 端点总览(本 spec 涉及)

| 端点 | 改动 | 备注 |
|---|---|---|
| `POST /init` | Body 扩展 + 持久化 raw_intent 全字段 | 本 spec 主改 |
| `POST /fuse` | 加错误码;fusion variant schema 扩 risk_level/distance | 本 spec 主改 |
| `POST /commit` | genre 来源切到 raw_intent;新增 fusion_meta 字段写入 | 本 spec 主改 |
| `POST /regenerate/{node_id}/regenerate` | 对 fusion variant 走 `/fuse` 而不是 INVERSION fallback | 本 spec 主改(C9) |
| `POST /regenerate/raw-intent` | 若 `raw_intent.genre_secondary` 有值,清掉 variants 后**重新调 `/fuse`** 追加 fusion variant | 本 spec 主改,见 §4.5 |
### 4.5 `POST /regenerate/raw-intent` —— 联动 /fuse

**当前行为**(`creative_diverge.py:2624+`):清掉 `idea_variants / core_contradiction / selected_path`,重新跑 3-op mutate chain (`_run_3op_mutate_chain`)。**问题**:如果有 fusion variant,会被清掉,且不会重跑。

**修复**:
```python
# /regenerate/raw-intent 末尾追加(在 canvas["idea_variants"] = built 之后)
raw_intent = canvas.get("raw_intent") or {}
if raw_intent.get("genre_secondary"):
    try:
        from backend.creative_os.genre_fusion_engine import GenreFusionEngine
        from backend.creative_os.mutation_engine import MutationEngine
        from backend.models.creative_os import Trope
        fusion_engine = GenreFusionEngine()
        distance = fusion_engine.compute_distance(
            raw_intent["genre_primary"], raw_intent["genre_secondary"]
        )
        risk_level = GenreFusionEngine.get_risk_level(distance)
        # 调 MutationEngine.fuse 走 LLM 路径,失败降级
        try:
            engine = MutationEngine(model_router=_try_get_model_router())
            mutation_result = await engine.fuse(
                Trope(id=f"genre:{raw_intent['genre_primary']}", name=raw_intent["genre_primary"], category="genre", description=raw_intent.get("prompt",""), market_saturation=0.5),
                Trope(id=f"genre:{raw_intent['genre_secondary']}", name=raw_intent["genre_secondary"], category="genre", description=raw_intent.get("prompt",""), market_saturation=0.5),
            )
            fusion_variant = _mutation_to_idea_variant(
                mutation_result,
                raw_intent["genre_primary"], raw_intent["genre_secondary"],
                risk_level=risk_level, distance=distance,
            )
        except Exception:
            # 降级合成 variant
            fusion_variant = {
                "id": f"var-{uuid.uuid4().hex[:8]}",
                "title": f"{raw_intent['genre_primary']}×{raw_intent['genre_secondary']}",
                "premise_one_line": f"{raw_intent['genre_primary']} 与 {raw_intent['genre_secondary']} 融合",
                "mutation_type": "fusion",
                "mutation_logic": f"跨 {distance} 跳距离的体裁融合",
                "estimated_novelty": 0.7,
                "trope_tags": [raw_intent["genre_primary"], raw_intent["genre_secondary"]],
                "regenerated_count": 0,
                "risk_level": risk_level,
                "fusion_distance": distance,
            }
        canvas["idea_variants"] = built + [fusion_variant]
    except Exception as exc:
        logger.warning("regenerate_raw_intent fuse re-run failed: %s", exc)
```

> **注意**:`/regenerate/variants` 端点不重跑 /fuse —— 它的契约是只重跑 3-op mutation chain(用户点 S0-B 的"再生成"按钮),不在本 spec 范围。若用户需要重做融合,点 S0-B 的"重新融合"按钮(见 §5.2)。

---

## 5. 前端变更

### 5.1 `S0AInputStep.tsx`

**变更点**:

1. **新增勾选框**:副类型下拉旁边加 `<input type="checkbox">` + label「启用类型融合」
2. **submit() 重写**:
   ```ts
   async function submit() {
     const rawIntent: RawIntent = {
       prompt: prompt.trim(),
       genre_primary: genrePrimary,
       genre_secondary: genreSecondary || undefined,
       target_reader: targetReader || undefined,
       reference_works: referenceWorks.length > 0 ? referenceWorks : undefined,
       forbidden_directions: forbiddenDirections.length > 0 ? forbiddenDirections : undefined,
       quick_mode: quickMode,
     };

     // Step 1: /init(持久化全部 raw_intent)
     await api.postDivergeInit(projectId, rawIntent);

     // Step 2: 勾选了"启用类型融合" + 副类型有值 → 自动 /fuse
     let fusionVariant: IdeaVariant | null = null;
     let fusionBanner: string | null = null;
     if (rawIntent.genre_secondary && enableFusion) {
       try {
         const fuseResp = await api.postDivergeFuse(projectId, {
           genre_primary: rawIntent.genre_primary,
           genre_secondary: rawIntent.genre_secondary,
           prompt: rawIntent.prompt,
         });
         // /fuse 响应是 variants 数组(通常 length=1)
         fusionVariant = fuseResp.variants[0] ?? null;
       } catch (e) {
         fusionBanner = "类型融合未启用(LLM 后端不可用)";
       }
     }

     onComplete(rawIntent, fusionVariant, fusionBanner);
   }
   ```
3. **onComplete 签名扩展**:`onComplete(rawIntent, fusionVariant, fusionBanner)` —— 父组件 `CreativeDivergenceStep` 透传到 S0-B
4. **校验**:`canSubmit` 加入 `enableFusion` 检查(勾选了就要求副类型必填)
5. **样式**:勾选框沿用现有 `ds/` 的 `GhostButton` 风格,不引入新组件
6. **GENRES 列表**:继续使用现有 `["修仙", "都市", ...]` 中文显示名(见 §7.1 关于 GENRES vs catalog 的已知问题)

### 5.2 `S0BMutationStep.tsx`

**变更点**:

1. **新增 Props**:`fusionVariant?: IdeaVariant | null` —— S0-A 透传的预生成 fusion variant(若有)
2. **顶部工具条加按钮**:`「重新融合」`(若用户已选副类型) 或 「生成融合变体」(若 S0-A 未填)
   ```tsx
   {rawIntent.genre_secondary && (
     <button onClick={handleRefuse} disabled={refusing}>
       {refusing ? "融合中..." : "重新融合"}
     </button>
   )}
   ```
3. **fusion variant 显示**:作为特殊 mutation_type="fusion" 卡片,与 inversion/escalation/subversion 卡片并列;卡片角标显示 `risk_level` badge(low=绿 / medium=黄 / high=红)
4. **handleRefuse 行为**:调 `api.postDivergeFuse(projectId, {genre_primary, genre_secondary, prompt})`,用响应替换原 fusion variant(保留 ID 不变,`regenerated_count++`)
5. **校验**:无副类型时按钮 disabled + tooltip "请先在灵感输入阶段选择副类型"

### 5.3 `CreativeDivergenceStep.tsx`

**变更点**:

1. **state 扩展**:
   ```tsx
   const [fusionVariant, setFusionVariant] = useState<IdeaVariant | null>(null);
   const [fusionBanner, setFusionBanner] = useState<string | null>(null);
   ```
2. **S0-A 完成回调**:
   ```tsx
   onComplete={(ri, fv, fb) => {
     setRawIntent(ri);
     setFusionVariant(fv);
     setFusionBanner(fb);
     goToStage("S0B");
   }}
   ```
3. **S0-B 渲染**:把 `fusionVariant` 传给 `S0BMutationStep`
4. **Banner 显示**:`fusionBanner` 非空时,在 S0-B 顶部渲染 info banner

### 5.4 `WizardContext.tsx`(可选,看现有架构)

如果 `fusionVariant` 需要在 5 个 stage 间共享,放在 `WizardContext`;如果只在 S0-A → S0-B 间传,放在 `CreativeDivergenceStep` 本地 state 即可。**决策:放本地 state**,S0-B 之后 S0-C / S0-D / S0-E 都不需要它(它已落到 `canvas.idea_variants`,后续 step 从 canvas 读)。

---

## 6. 后端变更

### 6.1 `backend/api/creative_diverge.py` —— `/init`

```python
class InitRequest(BaseModel):
    premise: str = Field(..., min_length=1, max_length=1700)
    genre_primary: str = Field(..., min_length=1)
    genre_secondary: Optional[str] = None
    target_reader: Optional[str] = None
    reference_works: Optional[List[str]] = None
    forbidden_directions: Optional[List[str]] = None
    quick_mode: bool = False


@router.post("/init")
async def init_canvas(project_id: str, request: InitRequest):
    _ensure_project(project_id)

    if not request.genre_primary.strip():
        raise HTTPException(400, detail={
            "error": True, "code": "GENRE_MISSING",
            "message": "请选择至少一个主类型",
            "detail": {},
        })

    from backend.creative_os.whatif_engine import WhatIfEngine
    engine = WhatIfEngine()
    root_node = engine.generate_root(request.premise)

    now = datetime.now(timezone.utc).isoformat()
    canvas = {
        "schema_version": 3,
        "root_node_id": root_node.id,
        "nodes": {root_node.id: _node_to_dict(root_node)},
        ...,
        "raw_intent": {
            "prompt": request.premise,
            "genre_primary": request.genre_primary,
            "genre_secondary": request.genre_secondary,
            "target_reader": request.target_reader,
            "reference_works": request.reference_works,
            "forbidden_directions": request.forbidden_directions,
            "quick_mode": request.quick_mode,
            "trope_tags": [],
        },
        ...,
    }
    ...
```

### 6.2 `backend/api/creative_diverge.py` —— `/fuse`

补错误码 + 补 `risk_level/distance` 字段:

```python
@router.post("/fuse")
async def fuse_genres(project_id: str, request: FuseRequest):
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(400, detail={
            "error": True, "code": "CANVAS_NOT_INITIALIZED",
            "message": "画布尚未初始化,请先调用 /init",
            "detail": {},
        })

    raw_intent = canvas.get("raw_intent") or {}
    if not raw_intent.get("genre_primary") or not request.genre_secondary:
        raise HTTPException(400, detail={
            "error": True, "code": "INTENT_INCOMPLETE",
            "message": "raw_intent.genre_primary 与 genre_secondary 必须同时存在",
            "detail": {},
        })

    # ... existing fusion logic ...
    # 把 distance + risk_level 透传给 _mutation_to_idea_variant
```

### 6.3 `backend/api/creative_diverge.py` —— `/commit`

```python
@router.post("/commit")
async def commit_canvas(project_id: str, data: dict = {}):
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化,请先调用 /init",
                "detail": {},
            },
        )

    # ... existing path validation (lines 1826-1843) ...

    # NEW: genre 来自 raw_intent.genre_primary (catalog 可解析),fallback project.json
    raw_intent = canvas.get("raw_intent") or {}
    genre_primary = (raw_intent.get("genre_primary") or "").strip()
    genre_secondary = (raw_intent.get("genre_secondary") or "").strip()

    if genre_primary:
        genre = genre_primary
        genre_source = "raw_intent_primary"
    else:
        project = _get_fm().read_json(project_id, "project.json") or {}
        genre = project.get("genre", "cool_novel")
        genre_source = "project_json_fallback"

    # 融合元数据:副类型有值且 canvas 有 fusion variant 时填充
    fusion_meta_obj = None
    if genre_secondary:
        fusion_meta = _extract_fusion_metadata(canvas)
        if fusion_meta is not None:
            risk_level, distance = fusion_meta
            fusion_meta_obj = {
                "secondary_genre": genre_secondary,
                "risk_level": risk_level,
                "distance": distance,
            }

    # ... existing LLM call (lines 1856-1866, 用上面的 genre) ...
    agent = PlannerAgent(project_id, ..., genre=genre)
    ...

    # NEW: 在 concept_and_dna 写入时附加 fusion_meta
    # (现有 line ~1995 的 concept_and_dna dict 构造处)
    if fusion_meta_obj is not None:
        concept_and_dna["story_dna"]["fusion_meta"] = fusion_meta_obj
```

### 6.4 `_extract_fusion_metadata` helper

放在 `/fuse` 端点附近的 helper 区(不导出,模块内私有):

```python
def _extract_fusion_metadata(canvas: dict) -> Optional[tuple[str, int]]:
    """Pick (risk_level, distance) from the most recent fusion variant.

    Returns None when no fusion variant exists on the canvas (so /commit
    can decide whether to write fusion_meta or skip). Picks the LAST
    fusion variant by list position — variants are appended in order, so
    last == most recent.

    Defaults ("low", 0) when a fusion variant exists but its metadata
    fields are missing (defensive for legacy / partial canvas state).
    """
    variants = canvas.get("idea_variants", []) or []
    fusions = [v for v in variants if v.get("mutation_type") == "fusion"]
    if not fusions:
        return None
    fusion = fusions[-1]   # last = most recent (append-only invariant)
    risk = (fusion.get("risk_level") or "low").strip() or "low"
    try:
        dist = int(fusion.get("fusion_distance") or 0)
    except (TypeError, ValueError):
        dist = 0
    return (risk, dist)
```

---

## 7. 数据模型

### 7.1 `canvas_state.json` —— `raw_intent` schema(v3 扩展)

```json
{
  "schema_version": 3,
  "root_node_id": "wi_001_00",
  "nodes": {...},
  "edges": [],
  "selected_path": ["wi_001_00"],
  "branch_choices": {},
  "evaluations": {},
  "idea_variants": [],
  "core_contradiction": null,
  "novelty_scores": null,
  "raw_intent": {
    "prompt": "一个关于永生者寻找死亡方法的故事",
    "genre_primary": "仙侠",
    "genre_secondary": "悬疑",
    "target_reader": "男频 · 30+",
    "reference_works": ["诡秘之主"],
    "forbidden_directions": ["后宫"],
    "quick_mode": false,
    "trope_tags": ["immortality", "mystery"]
  },
  "session_metadata": {...}
}
```

### 7.1.1 ⚠ 已知问题:前端 GENRES vs backend catalog IDs 不匹配

**问题描述**:前端 `S0AInputStep.tsx:19-30` 的 `GENRES` 数组是中文显示名(`["修仙", "都市", "星际", "游戏", ...]`),而 backend `config/genres/index.yaml` 用的是 catalog ID(`xianxia/仙侠, dushi/都市, xuanyi/悬疑, ...`),catalog 只有 **7 个 genre**(爽文/仙侠/玄幻/都市/科幻/悬疑/言情),前端 dropdown 有 10 项,**多数前端选项在 catalog 里找不到对应**。

**现状行为**:选"修仙"提交到 backend,`catalog.get("修仙")` 找不到 → fallback 到 index 第一个条目("爽文") → LLM 拿到爽文的 tone/style_rules,与用户期望的修仙文不符。这是已存在的 bug,**不是本 spec 引入**。

**本 spec 处理**:
- 本 spec 继续使用前端的显示名作为 `raw_intent.genre_primary/secondary` 持久化值,**不强行改为 catalog ID**
- `/commit` 把这些字符串直接传给 `PlannerAgent`,由 `_resolve_genre_label` 走 fallback
- 这是已知 trade-off:本 spec 修复主+副类型端到端接线,完整修复 GENRES/catalog 一致性留给后续 spec(需要 PRD 决策:S0A 文案改 catalog ID,还是 backend catalog 补全缺失项)

**对本 spec 实现的影响**:
- 集成测试时若选"修仙" → commit 后的 `concept.genre = "修仙"`(字符串),LLM prompt 里 `{genre}` 会 fallback 到"爽文"
- 用户看到的 fusion variant 标题 `修仙 × 悬疑`(正确)
- 下游 Stage 1 读 `concept.genre = "修仙"` → 同样的 fallback 行为
- ⚠ 实际 fusion 距离计算用 catalog ID 时可能不准确(若 genre 不在 catalog 中 → distance=3, risk=high)

### 7.2 `idea_variants[]` —— fusion 变体 schema 扩展

```json
{
  "id": "var-abc12345",
  "title": "仙侠 × 悬疑 (跨界)",
  "premise_one_line": "仙侠体系中的悬疑推理,长生者追查自身死亡的真相",
  "mutation_type": "fusion",
  "mutation_logic": "基于 BFS 距离 2 的类型融合",
  "estimated_novelty": 0.7,
  "trope_tags": ["仙侠", "悬疑"],
  "regenerated_count": 0,
  "risk_level": "medium",
  "fusion_distance": 2
}
```

非 fusion variants 不需要这两个字段(允许缺失)。

### 7.3 迁移策略

**不需要数据迁移脚本** —— 因为:

- 已有 canvas 的 `raw_intent` 字段只含 `prompt + trope_tags`,缺字段不影响 `/fuse`(新错误码只在缺主+副时报错,旧 canvas 缺主类型时本就不会调 `/fuse`)
- `/commit` 的 fallback 路径处理了 `genre_primary` 缺失的情况
- 旧项目刷新 S0-A 时,前端用 `initial?.genre_primary || ""` 填充(`S0AInputStep.tsx:39`),用户重选即可触发新的写入

**唯一需要做的**:第一次访问 S0-A 时,如果 `initial.genre_primary` 为空(旧项目),前端 label 提示「检测到旧项目,请补选主类型」。

---

## 8. 测试计划

### 8.1 后端

| 测试文件 | 覆盖 |
|---|---|
| `tests/test_init_raw_intent_persistence.py` | `/init` 持久化 prompt + genre_primary + genre_secondary + target_reader + reference_works + forbidden_directions + quick_mode;主类型缺失 400 GENRE_MISSING |
| `tests/test_init_migration_old_caller.py` | 旧 caller `{"premise": "..."}`(缺 genre_primary) → 422 Pydantic validation(新签名,无 fallback) |
| `tests/test_fuse_error_codes.py` | canvas 未初始化 400 CANVAS_NOT_INITIALIZED;raw_intent.genre_primary 缺失 400 INTENT_INCOMPLETE;主=副 400 FUSION_SAME_GENRE;LLM 不可用降级路径 |
| `tests/test_fuse_variant_metadata.py` | `/fuse` 响应 `variants[0]` 包含 `risk_level` + `fusion_distance` 字段;distance 范围 0-3 |
| `tests/test_commit_uses_raw_intent_genre.py` | 有 genre_primary → PlannerAgent 收到它;缺 genre_primary → fallback project.json;有副类型 + fusion variant → story_dna.fusion_meta 写入;无 fusion variant → fusion_meta 不写入 |
| `tests/test_extract_fusion_metadata.py` | helper 单元测试:无 fusion variant → None;有 1 个 → 返回它的 risk/distance;有多个 → 取**最后一个**(append-only);risk/distance 缺失字段 → fallback "low"/0 |
| `tests/test_regenerate_node_fusion.py` | `/regenerate/{node_id}/regenerate` 对 `mutation_type="fusion"` 调 `/fuse` 不是 INVERSION;新 variant 仍是 fusion 类型 |
| `tests/test_regenerate_raw_intent_fuse.py` | `/regenerate/raw-intent` 清完后若 genre_secondary 存在 → 重跑 /fuse 追加 fusion variant;若 genre_secondary 不存在 → 不追加 |

### 8.2 前端

| 测试文件 | 覆盖 |
|---|---|
| `frontend/src/test/wizard/divergence/S0AInputStep.test.tsx` | 副类型填写 + 勾选「启用类型融合」+ submit → 调 postDivergeInit + postDivergeFuse;只勾不填副类型 → canSubmit false;LLM 失败 → onComplete 收到 fusionBanner |
| `frontend/src/test/wizard/divergence/S0BMutationStep.test.tsx` | 顶部「重新融合」按钮可见 + 可点击;点击 → 调 postDivergeFuse + 替换旧 fusion variant;无副类型 → 按钮 disabled |
| `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx` | S0-A 完成时 fusionVariant 透传到 S0-B;fusionBanner 非空时显示 banner |
| `frontend/src/test/api/client.test.ts` | postDivergeInit 接受 RawIntent(不是 string) |

### 8.3 E2E(手工 + Playwright 可选)

- **完整路径**:主=仙侠 + 副=悬疑 + 勾选融合 → 进 S0-B 看到 7 张卡(6 mutation + 1 fusion,risk=medium badge) → 进 S0-E commit → 检查 `concept_and_dna.concept.genre == "仙侠"` 且 `story_dna.fusion_meta == {secondary_genre:"悬疑", risk_level:"medium", distance:2}`
- **失败路径**(LLM 关掉):S0-A submit 后看到 banner「类型融合未启用」 → 进 S0-B 只有 6 张 mutation 卡(无 fusion) → commit 仍可成功,`concept.genre == "仙侠"`,**无 `fusion_meta` 字段**
- **回退路径**(旧项目,raw_intent 缺 genre_primary):commit 仍走 `project.json.genre` fallback,`fusion_meta` 不写入

---

## 9. 风险与决策记录

### 9.1 决策

| ID | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | `/init` body 用 Pydantic `InitRequest` 替换 `dict` | 保留 `dict` + 手工校验 | 类型安全,IDE 友好,Swagger 文档自动生成 |
| D2 | 「启用类型融合」用显式勾选框 | 选了副类型就隐式触发 | 对齐 PRD「勾选」字面;允许填副类型但不立刻跑(快速模式友好) |
| D3 | fusion variant **不**加入 `MUTATION_OPS` 数组(不进 mutation chain) | 把 fusion 加进 `/apply-mutation` 支持 | `/apply-mutation` 设计上单源,fusion 需双源;独立 `/fuse` 路径更清晰 |
| D4 | `/commit` genre 优先 raw_intent.genre_primary,缺失时 fallback project.json | 强制 raw_intent(无则 422) | 旧项目兼容,无 raw_intent 也能 commit;C8 是 fallback,不是 422 |
| D5 | fusion variant 卡片放 S0-B mutation 列表,角标显示 risk_level badge | 单独 tab/分区 | 与 mutation variants 并列展示,与 PRD §5.2 "变体卡片区"对齐 |
| D6 | S0-A → S0-B 传 `fusionVariant` 用 props,不放 WizardContext | 放 WizardContext 共享 | 仅 S0-A → S0-B 间需要,S0-B 之后从 canvas 读;本地 state 更轻 |
| D7 | `/fuse` 失败时不写 canvas(只前端提示 banner),由用户后续手动点"重新融合"补救 | 写 stub variant 到 canvas,标记 degraded | stub variant 会污染 idea_variants,S0-E commit 时 fusion_meta 逻辑被干扰 |
| **D8** | **`/commit` 把 `genre_primary` 直接喂 PlannerAgent,fusion 信息走 `story_dna.fusion_meta` 独立字段** | 把融合字符串拼进 genre 字段喂 LLM | `_resolve_genre_label` 会做 catalog lookup,拼字符串会让 tone/style_rules 注入失效(catalog 找不到该 ID) |
| **D9** | **`/regenerate/{node_id}/regenerate` 对 fusion variant 调 `/fuse` 而非 INVERSION fallback** | 保持 INVERSION fallback | 维持 fusion variant 的 mutation_type 一致性;否则用户重生成的 fusion 卡变 inversion 卡,违反直觉 |
| **D10** | **`/regenerate/raw-intent` 清完 variants 后若副类型存在,重跑 `/fuse` 追加 fusion variant** | 不重跑,只重跑 3-op chain | 维持"主+副类型都触发融合"的契约,否则用户 regenerate 后 fusion variant 消失 |
| **D11** | **`_extract_fusion_metadata` 取 `fusions[-1]`(最后一个 fusion variant)** | `next(fusions)`(第一个) | variants 列表是 append-only,最后一个 = 最新;`next()` 会拿到旧的 |

### 9.2 风险

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | 已有 `/init` caller 依赖 `{"premise": "..."}` body —— 改 Pydantic 后旧 caller 会被 422 | 唯一的 caller 是 `S0AInputStep.tsx`,本 spec 同步更新;无外部 API 消费者 |
| R2 | S0-A 选副类型 + 勾选 → 同时调 `/init` + `/fuse`,若 `/fuse` 慢,用户看到卡顿 | `/fuse` 走 `NotImplementedError` 降级极快(微秒级);真实 LLM 路径平均 2-5s,在 S0-A loading 状态内 |
| R3 | `/commit` 改 genre 来源 → 旧项目第一次 commit 时 genre 字符串格式变化 | fallback 链:raw_intent 缺 → project.json → 默认值;UI 提交预览可展示新格式 |
| R4 | 副类型选与主类型相同 → distance=0,risk=low,fusion variant 缺乏价值 | 前端 S0A `GENRES.filter(g => g !== genrePrimary)` 已过滤同类;后端 `/fuse` 补 `FUSION_SAME_GENRE` 错误码兜底 |
| R5 | `_mutation_to_idea_variant` 改签名后调用方都要传 `risk_level/fusion_distance` | keyword-only 默认参数 `(risk_level="low", distance=0)` 保持向后兼容;`_run_3op_mutate_chain` 不需要传(non-fusion 默认值) |
| **R6** | **`/regenerate/{node_id}/regenerate` 对 fusion variant 默认走 INVERSION fallback(`_mutation_op_from_type` 返回 None)** | 本 spec 修复(D9):在 `op is None` 分支增加 `if variant.get("mutation_type") == "fusion"` 判断,改为调 `/fuse` 重新产 fusion variant |
| **R7** | **`/regenerate/raw-intent` 清 variants 后 fusion variant 消失,UI 状态不一致** | D10 修复:清完后重跑 `/fuse`,保持 fusion variant 持续存在 |
| R8 | PRD §9 D-2 "新颖度评分阈值:<40 强制阻止提交" 尚未决策 | 本 spec 不解决;留给后续 PRD 决策会议 |
| **R9** | **前端 GENRES 列表与 backend catalog ID 不匹配(§7.1.1)** —— 选"修仙"会被 catalog fallback 到"爽文" | 本 spec 不修,记录为已知问题;后续 spec 决定 GENRES 改 catalog ID 或 catalog 补全 |

---

## 10. 验收标准

### 10.1 功能

- [ ] `/init` 接受完整 `RawIntent` body(Pydantic `InitRequest`),缺失 `genre_primary` 时 400 GENRE_MISSING
- [ ] `/init` 持久化全部 `raw_intent` 字段(prompt + genre_primary + genre_secondary + target_reader + reference_works + forbidden_directions + quick_mode + trope_tags)到 `canvas_state.json`
- [ ] `/fuse` 在 canvas 未初始化时 400 CANVAS_NOT_INITIALIZED;缺主类型时 400 INTENT_INCOMPLETE;主=副时 400 FUSION_SAME_GENRE
- [ ] `/fuse` 响应 `variants[0]` 包含 `risk_level` 和 `fusion_distance`
- [ ] S0-A 提交时若副类型有值 + 勾选「启用类型融合」→ 自动调 `/fuse`,取 `variants[0]` 通过 onComplete 传到 S0-B
- [ ] S0-A 提交时若 `genre_secondary` 为空 → 不调 `/fuse`
- [ ] S0-A 提交时若未勾选「启用类型融合」 → 不调 `/fuse`(即使副类型已填)
- [ ] S0-A 「启用类型融合」勾选但 `genre_secondary` 为空 → canSubmit false
- [ ] S0-B 顶部显示「重新融合」按钮(若副类型已选)或 disabled 状态(若未选)
- [ ] S0-B 显示 fusion variant 卡片,角标显示 risk_level badge
- [ ] S0-B 点「重新融合」→ 调 `/fuse`,新 variant 替换旧 fusion variant(保留 ID)
- [ ] S0-B 点「重新生成」fusion variant → 调 `/fuse` 重跑(不是 INVERSION fallback)
- [ ] `/fuse` 失败时 S0-A 显示 banner「类型融合未启用(LLM 后端不可用)」,fusion variant 不写入 canvas
- [ ] `/commit` 喂给 PlannerAgent 的 genre 来自 `raw_intent.genre_primary`(或 fallback project.json)
- [ ] `/commit` 在副类型 + fusion variant 都存在时,在 `concept_and_dna.story_dna.fusion_meta` 写入 `{secondary_genre, risk_level, distance}`
- [ ] `/commit` 在 `raw_intent.genre_primary` 缺失时 fallback 到 `project.json.genre`,**不**抛 422
- [ ] `/regenerate/raw-intent` 清完后若 `raw_intent.genre_secondary` 存在 → 重跑 `/fuse` 追加 fusion variant
- [ ] `/regenerate/{node_id}/regenerate` 对 `mutation_type="fusion"` → 调 `/fuse`,不是 INVERSION fallback

### 10.2 兼容

- [ ] 已有 canvas_state.json(无 genre 字段)刷新 S0-A → 表单空,提示补选主类型
- [ ] 已有项目(走 Path B 旧链路)的 project.json.genre 仍能被新 `/commit` fallback 读到
- [ ] `/init` 旧 caller(`{"premise": "..."}`)行为不变,新字段默认为空

### 10.3 测试

- [ ] 所有 §8.1 后端测试通过
- [ ] 所有 §8.2 前端测试通过
- [ ] E2E(§8.3) 完整路径 + 失败路径手工验证通过

### 10.4 文档

- [ ] 本 spec 在 PR 描述里被引用
- [ ] 更新 `docs/superpowers/specs/README.md`(若存在)索引
- [ ] 提交信息格式:`fix(divergence): wire 主+副类型端到端(fuse trigger + commit genre)`

---

## 11. 实施步骤(执行顺序)

> 这部分不是 plan —— spec 完成后另开 plan 文件 `docs/superpowers/plans/2026-09-01-genre-fusion-wiring.md`,按以下顺序执行。

1. **后端 phase 1**:扩展 `/init` body schema + 持久化 `raw_intent` 全字段(§6.1)
2. **后端 phase 2**:补 `/fuse` 错误码 + `FUSION_SAME_GENRE` 防御 + 给 `_mutation_to_idea_variant` 加 `risk_level/fusion_distance` + 加 `_extract_fusion_metadata` helper(§6.2 + §6.4)
3. **后端 phase 3**:改 `/commit` genre 来源逻辑 + 写入 `story_dna.fusion_meta`(§6.3)
4. **后端 phase 4**:修 `/regenerate/{node_id}/regenerate` 对 fusion 走 `/fuse` 而非 INVERSION fallback(§4.4 + D9)
5. **后端 phase 5**:修 `/regenerate/raw-intent` 清完后重跑 `/fuse` 追加 fusion variant(§4.5 + D10)
6. **后端 phase 6**:补 9 个后端测试(§8.1)
7. **前端 phase 7**:`S0AInputStep` 加勾选框 + submit 调 `/fuse` + onComplete 签名扩展(§5.1)
8. **前端 phase 8**:`S0BMutationStep` 加「重新融合」按钮 + fusion variant 卡片 + risk badge(§5.2)
9. **前端 phase 9**:`CreativeDivergenceStep` 透传 `fusionVariant` + 显示 banner(§5.3)
10. **前端 phase 10**:补 4 个前端测试(§8.2)
11. **E2E**:手工跑通 §8.3 三条路径(完整 / 失败 / 回退)

每阶段独立可测试,后端 phase 1-6 可独立发版(前端无依赖);前端 phase 7-10 需要后端 phase 2-3 完成。

**已知的非本 spec 范围工作**(独立 PR):
- §7.1.1 前端 GENRES vs backend catalog IDs 一致性修复(需要 PRD 决策:改 S0A 文案还是补全 catalog)
- canvas_to_concept.yaml 加 `{fusion_secondary_genre}` / `{fusion_risk_level}` 占位符,让 LLM 感知融合语义