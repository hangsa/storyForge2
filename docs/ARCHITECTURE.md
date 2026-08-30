# 创意发散 → 概念 DNA → 世界观 → 角色设计 → 地图系统 → 全文大纲 → 章节大纲 全链路架构

> 本文档梳理从 `Stage 0 创意发散` 到 `Stage 3b 章节大纲` 的七阶段创意流水线，作为后续改造与跨阶段问题排查的参考。
> 数据流方向以单向前进为主，但 **Stage 3a / 3b 会反向回写 `characters.json`**——这是链路里最隐蔽的耦合点。
> 链路里所有阶段产物以 JSON 文件形式落地到 `<project>/`，是真正的 source of truth；LLM 调用与人工编辑（PUT）共享同一文件目标。

---

## 0. 链路全景

```
[Stage 0 创意发散]  ──→  concept_and_dna.json  ──→  [Stage 1 概念DNA]
                                                            │
                                                            ↓
                                              world.json + characters.json
                                                            │
                                                            ↓ [Stage 2b Growth Workshop]
                                                            │
                                                            ↓
                                              novel_outline.json (全文大纲)
                                                            │
                                                            ↓
                                              outline.json (章节大纲，scene_plan)
                                                            │
                                                            ↓ [Stage 4 写作 + StoryOS]
```

| 阶段 | 文件落地 | 路由前缀 | Agent |
|---|---|---|---|
| 0 创意发散（Canvas / Divergence） | `creative_os/canvas_state.json` 或 `creative_divergence.json` | `/api/v1/projects/{id}/creative/canvas/*` 或 `/api/projects/{id}/creative-divergence/*` | CreativeDirector / PlannerAgent |
| 1 概念 DNA | `concept_and_dna.json` | `/api/stage1/*` | PlannerAgent |
| 2 世界观 | `world.json` | `/api/stage2/*` | PlannerAgent |
| 2 角色设计 | `characters.json` | `/api/stage2/*` | PlannerAgent |
| 2b Growth Workshop | `characters.json`（回写 `growth_curve.stages[]`） | `/api/v1/projects/{id}/characters/{cid}/growth/workshop/*` | CharacterDesigner（仅 `/discuss`） |
| 3a 全文大纲 | `novel_outline.json` | `/api/stage3/*` | PlannerAgent |
| 3b 章节大纲 | `outline.json` | `/api/stage3/*` | PlannerAgent |

---

## 1. Stage 0 — 创意发散（**两条并行路径，能力不对称**）

链路里最不一致的环节。后端同时存在两套实现：

### 1.1 Path A — Creative Canvas（完整 CreativeOS）

- 后端：`backend/api/creative_canvas.py`、引擎在 `backend/creative_os/`
- 入口：路由 `/api/v1/projects/{id}/creative/canvas/*`（独立页面 `/creative-canvas`）
- 引擎：
  - `MutationEngine`（4 ops：inversion / fusion / escalation / subversion）
  - `WhatIfEngine`（depth=3, breadth=3）
  - `ContradictionEngine`（5 模板：ABILITY_VS_LIMIT / ETERNAL_VS_FLEETING / IDENTITY_VS_SECRET / GOAL_VS_COST / POWER_AS_WEAKNESS）
  - `GenreFusionEngine`（BFS 距离矩阵）
  - `NoveltyEvaluator`（4 维评分：market_saturation 30% + trope_similarity 25% + contradiction_depth 25% + discussion_potential 20%）
- 落地：`<project>/creative_os/canvas_state.json`（schema_version=2，含 nodes / edges / branch_choices / selected_path）
- 提交：`/commit` 调用 `PlannerAgent.generate_concept_from_canvas`（独立模板 `canvas_to_concept.yaml`）→ `concept_and_dna.json`，**写入 `source="canvas"`**
- 前端：`frontend/src/components/creative-canvas/`（CanvasNode、WhatIfTree、NoveltyRadar、MutationSuggestion、NodeDetailPanel）

### 1.2 Path B — Creative Divergence Step（**占位实现**）

- 后端：`backend/api/creative_divergence.py`
- 入口：路由 `/api/projects/{id}/creative-divergence/*`，Wizard 第 1 步 `CreativeDivergenceStep.tsx`
- `_generate_variants` 是**确定性 stub**：仅从 prompt 文本合成变体标题，**完全不调用 LLM 引擎**。文件自身注释承认 `backend.creative_os.mutation_engine.mutate_idea` 与 `idea_pool.sample_idea_pool` 在当前代码库里不存在
- 落地：`<project>/creative_divergence.json` → 选中后写 `concept_and_dna.json`，**写入 `source="creative_divergence"`**

### 1.3 架构含义

走 Wizard（Path B）的用户**永远拿不到**创意发散引擎的真实能力（变异推荐、What-If 树、新颖度评分、Trope 饱和度）。

源标记的合法性边界：

- `ALLOWED_CONCEPT_SOURCES = {"manual", "creative_divergence"}`（`stage1_concept.py`）
- Canvas 路径的 `source="canvas"` 只能通过 `/commit` 写入，普通 PUT 不接受
- 若用户走完 Canvas 后再回到 Step 1 手动改写，必须经 `/api/stage1/concept` PUT，会被改写成 `source="manual"`

详见 `project_creative_divergence_two_paths.md`（CLAUDE.md 已记忆）。

---

## 2. Stage 1 — 概念 DNA

| 维度 | 内容 |
|---|---|
| 后端 | `backend/api/stage1_concept.py` |
| Agent | `PlannerAgent.generate_concept_and_dna`，模板 `backend/prompts/concept_generation.yaml` |
| 输入 | `_read_creative_intent()` → 读 `creative_divergence.json.prompt` |
| 守卫 | 若 `creative_divergence.json` 缺失或空 → **400 `INTENT_MISSING`**（强制 Stage 0 前置依赖） |
| 输出 | `<project>/concept_and_dna.json`，结构 `{concept: {...}, story_dna: {core_contradiction, value_stack[4 levels]}}` |
| 写回 | `PUT /api/stage1/concept`、`POST /api/stage1/regenerate-section` |

**概念字段**：`title / genre / premise / tone / theme / target_audience / style_template`。
**Story DNA 字段**：`core_contradiction.{statement, side_a, side_b}` + `value_stack[4 levels]`。

注意：v2.x 移除了 `project.json.initial_intent.free_text` 兜底——旧项目必须回访 Step 1 才能继续推进。

---

## 3. Stage 2 — 世界观 + 角色设计

后端合在同一 router（`stage2_world_char.py`），但产物是两个独立文件。

### 3.1 世界观（WorldStep）

| 维度 | 内容 |
|---|---|
| 输入 | `concept_and_dna.json` |
| 输出 | `<project>/world.json`，字段 `era / geography / social_structure / cultural_history / power_systems[] / core_rules / factions` |
| LLM 介入 | `PlannerAgent.generate_world`（模板 `world_generation`） |
| 局部重生 | `/regenerate-power-system-item`（`regenerate_power_system`，独立模板 `world_power_system_rewrite`） |
| 模型 | `backend/models/world.py`（含 `_raw_power_systems_list` 等 validator） |

`World.model_validate(data).model_dump()` 是**防御性 schema 强制**——LLM 输出畸形时自动 coerce（参考 proj_ec67d3e2 的修复案例）；最坏情况下原始数据被写入，由前端 `normalizeLegacyWorld()` 兜底。

### 3.2 角色设计（CharacterStep）

| 维度 | 内容 |
|---|---|
| 输入 | `concept_and_dna.json` + `world.json` |
| 输出 | `<project>/characters.json`，结构 `{"characters": [...]}` |
| LLM 介入 | `PlannerAgent.generate_character`（模板 `character_generation`），**每个角色一次 LLM 调用**，append 到列表 |
| 模型 | `backend/models/character.py` — `Character / Personality / VoiceSignature（含 behavior_examples）/ GrowthCurve / GrowthStage / GrowthEventType`（**8 类硬编码白名单**） |
| 局部重生 | `/regenerate-character-section`，**特殊保护**：`voice_signature` 重生时显式保留 `behavior_examples` 字段，避免被 LLM 输出覆盖 |

---

## 4. Stage 2b — Growth Curve Workshop（**非 wizard 必经步骤**）

这是与 CharacterStep **并列**的交互式编辑器：

| 维度 | 内容 |
|---|---|
| 后端 | `backend/api/growth_workshop.py` |
| 端点 | `POST /check`（一致性检查）、`PUT /adjust`（写回）、`POST /discuss`（自由讨论） |
| 5 条确定性规则 | `out_of_range / invalid_event_type / missing_event / low_misaligned / tight_spacing`（`consistency_checker.py`，**零 LLM**） |
| LLM 介入 | `CharacterDesigner.discuss`（Tier 1，模板 `character_designer/growth_discuss`） |
| 写回保护 | `adjust` 是**链路中唯一会阻塞写回的端点**——若一致性检查返回 `severity="error"` 直接 422 拒绝（增长曲线一旦错乱最难回滚） |
| 落点 | 写回同一 `characters.json` 的 `growth_curve.stages[]` |

---

## 5. 地图系统（MapStep）— **当前是占位符**

| 维度 | 内容 |
|---|---|
| 组件 | `frontend/src/components/wizard/MapStep.tsx`，约 35 行 |
| 状态 | 只有一个 "Skip" 按钮，文案 "功能即将推出，可在工作台内补做此步" |
| 落地 | `map.json` 几乎从不写入 |
| 后端 fallback | `PlannerAgent.generate_novel_outline` 接收 `map_data=None` 时，prompt 注入 "（暂无地图系统信息）" |

**链路里最薄的一环**。全文大纲生成时地图信息直接缺失。

---

## 6. Stage 3a — 全文大纲（novel outline）

| 维度 | 内容 |
|---|---|
| 后端 | `backend/api/stage3_outline.py`，端点 `POST /stage3/generate-novel-outline`、`POST /regenerate-novel-outline-section` |
| Agent | `PlannerAgent.generate_novel_outline`，模板 `novel_outline_generation` |
| 输入 | `concept_and_dna.json` + `world.json` + `characters.json` |
| 输出 | `<project>/novel_outline.json`，结构 `{core_conflict_theme, volumes[], mc_growth_arc[], key_plot_points[], generated_at, updated_at}` |
| 后处理1 | `_realign_growth_curves(characters, novel_outline)` → `align_growth_curves` 重写 `characters.json.target_chapter_range`（**全文大纲是 growth curve 阶段范围的唯一驱动者**） |
| 后处理 2 | `_reject_if_forbidden_terms` 扫描全文大纲 vs `world.power_systems[*].stages` 修仙术语白名单，违规则 422（proj_1a7d7fcf 2026-08-22 "一剑斩灭元婴级追兵"事件） |
| 解析器 | `backend/outline_context/volumes.py` — `parse_volumes`（正则切卷）、`planned_total`、`locate_volume` |

---

## 7. Stage 3b — 章节大纲（chapter outline）

| 维度 | 内容 |
|---|---|
| 后端 | 同一 `stage3_outline.py`，端点 `POST /stage3/generate`、`POST /regenerate-chapter-outline`、`PUT /stage3/outline` |
| Agent | `PlannerAgent.generate_outline`，模板 `outline_generation` |
| 输入 | 上游全部产物 + 当前卷切片 + 前 3 章摘要 + growth curve context |
| 输出 | `<project>/outline.json`，结构 `{chapters: [{chapter_number, title, scene_plan: [{scene_number, goal, conflict, emotional_arc, narrative_role, beat_type, registry_changes, required_logs}]}]}` |
| 上下文组装 | `backend/outline_context/builder.py` — `build_volume_context`（当前卷+邻居卷+匹配的 key_plot_points）、`build_recent_chapters_context`（同卷前 3 章） |
| growth curve 上下文 | `backend/growth_curve/context.py` — `compute_character_growth_context` |
| 后处理 | `bind_growth_curve_to_outline` 通过 scene 的 `registry_changes` 关键字匹配 `trigger_event_type` → 设置每个 growth stage 的 `bound_chapter`，**再次回写 `characters.json`** |
| 端点策略 | `ChapterOutlineStep` **只自动生成第 1 章**；后续章节由 autopilot runner 或工作台手动 `/regenerate-chapter-outline` 触发——**不预生成完整大纲** |

`scene_plan` 中 `registry_changes`（预声明改动）和 `required_logs`（必须打的 SF_LOG 标签）是 Stage 4 Writer 受约束的"契约"。

---

## 8. 阶段间输入输出总表

| 上游阶段 | 下游消费方 | 下游读取的字段 |
|---|---|---|
| Stage 0 Canvas | Stage 1 | `canvas_state.json.selected_path` → 经 `canvas_to_concept` 模板生成 `concept_and_dna` |
| Stage 0 Divergence | Stage 1 | `creative_divergence.json.prompt`（必填，否则 400） |
| Stage 1 概念 DNA | Stage 2 / 3a / 3b | 整文件作为世界观 / 角色 / 大纲生成的种子语境 |
| Stage 2 世界观 | Stage 3a / 3b | `power_systems[*].stages`（修仙术语白名单）、`factions` 等 |
| Stage 2 角色 | Stage 2b / 3a / 3b | `growth_curve.stages[]`（含 `bound_chapter`）、`behavior_examples` |
| Stage 3a 全文大纲 | Stage 3b / 角色 | `volumes[]` 切片 + `mc_growth_arc[]` → 回写 `characters.json.target_chapter_range` |
| Stage 3b 章节大纲 | Stage 4 写作 | `scene_plan[*].registry_changes`（预声明）+ `required_logs`（必打标签）+ `goal / conflict / emotional_arc`（写作指令） |

---

## 9. 链路里的两个"自回写"副作用

**最容易踩坑的耦合点**：

1. **`_realign_growth_curves` 在全文大纲生成时反向写角色文件**——任何修改全文大纲都会重算 `characters.json` 里所有角色的 `target_chapter_range`。把 `auto_generator.reverse_inference` 替换成它正是因为旧的会把所有阶段冻结到第 1 章的退化状态。

2. **`bind_growth_curve_to_outline` 在章节大纲生成时反向写角色文件**——按 scene 的 `registry_changes` 关键字匹配 `trigger_event_type`，给每个 growth stage 设 `bound_chapter`。两次回写是**独立代码路径**，都改 `characters.json`，没有统一入口。

---

## 10. LLM 介入层次矩阵

| 链路节点 | Tier | 是否真用 LLM |
|---|---|---|
| `MutationEngine.mutate / fuse` | Tier 1 | ✅ |
| `WhatIfEngine.expand_node` | Tier 1 | ✅ |
| `ContradictionEngine.expand` | Tier 1 | ✅（深度评分走关键词） |
| `GenreFusionEngine.analyze_fusion` | Tier 1 | ✅（距离矩阵走 BFS） |
| `NoveltyEvaluator.evaluate` | **Tier 0** | ❌（75% 确定性；Trope 标签提取是 TODO，market_saturation 退化到默认 50.0） |
| **Stage 0 Divergence Step `_generate_variants`** | **Tier 0** | **❌ 占位 stub** |
| Stage 1 `generate_concept_and_dna` | Tier 1 | ✅ |
| Stage 2 `generate_world / character` | Tier 1 | ✅ |
| Stage 3a `generate_novel_outline` | Tier 1 | ✅ |
| Stage 3b `generate_outline` | Tier 1 | ✅（带 volume 切片 + 前 3 章 + growth context） |
| Workshop `discuss` | Tier 1 | ✅ |
| Workshop `check / adjust` | Tier 0 | ❌（5 条规则） |
| `_realign_growth_curves` | Tier 0 | ❌ |
| `bind_growth_curve_to_outline` | Tier 0 | ❌ |
| Outline term guard | Tier 0 | ❌ |
| `parse_volumes` | Tier 0 | ❌（正则） |

---

## 11. Wizard → 后端映射

| Wizard 步骤（旧/新编号） | 组件 | LLM 端点 | 落地文件 | 备注 |
|---|---|---|---|---|
| 1 / 2 概念 DNA | `ConceptStep.tsx` | `POST /api/stage1/generate`、`PUT /api/stage1/concept`、`POST /api/stage1/regenerate-section` | `concept_and_dna.json` | 读 `_read_creative_intent()`，缺则 400 |
| 2 / 3 世界观 | `WorldStep.tsx` | `POST /api/stage2/generate-world`、`/regenerate-world-section`、`/regenerate-power-system-item`、`PUT /api/stage2/world` | `world.json` | schema validator 自动 coerce |
| 3 / 4 角色设计 | `CharacterStep.tsx` | `POST /api/stage2/generate-character`、`PATCH /stage2/character/{id}`、`DELETE`、`/regenerate-examples`、`/regenerate-character-section` | `characters.json` | `voice_signature` 重生时保护 `behavior_examples` |
| 4 / 5 地图 | `MapStep.tsx` | （无） | （无） | **占位**，35 行只有 Skip 按钮 |
| 5 / 6 全文大纲 | `OutlineStep.tsx` | `POST /api/stage3/generate-novel-outline`、`PUT /api/stage3/novel-outline`、`/regenerate-novel-outline-section` | `novel_outline.json` | 触发 `_realign_growth_curves` 回写 `characters.json` |
| 6 / 7 章节大纲 | `ChapterOutlineStep.tsx` | `POST /api/stage3/generate`、`PUT /api/stage3/outline`、`/regenerate-chapter-outline` | `outline.json` | 触发 `bind_growth_curve_to_outline` 回写 `characters.json` |
| （仅新 wizard 第 1 步） | `CreativeDivergenceStep.tsx` | `POST /api/projects/{id}/creative-divergence/generate`、`/select`、`GET`、`/prefill-check` | `creative_divergence.json` + `concept_and_dna.json`（选中时） | 当前是 deterministic stub |

旧编号对应 `InitWizardModal`（标记 DEPRECATED 2026-08-30），新编号对应 `WorkspaceWizardPanel`。两者并存，新 wizard 在 Stage 0 之前插入 CreativeDivergenceStep。

---

## 12. 项目目录落地一览

```
<project>/
├── project.json                  # 阶段状态 + 元数据
├── concept_and_dna.json          # Stage 1
├── world.json                    # Stage 2
├── characters.json               # Stage 2（含 growth_curve + behavior_examples）
├── novel_outline.json            # Stage 3a
├── outline.json                  # Stage 3b（scene_plan 含 registry_changes + required_logs）
├── progress.json                 # 写作进度
├── map.json                      # 几乎不写
├── chapters/                     # 章节草稿
├── autopilot/                    # 托管模式会话状态
│   ├── session.json
│   └── chunks/
├── storyos/                      # Stage 4 写作期更新（7 资产 + cascade_log）
│   ├── conflicts.json
│   ├── mysteries.json
│   ├── twists.json
│   ├── goals.json
│   ├── promises.json
│   ├── reveals.json
│   ├── expectations.json
│   ├── foreshadowing.json
│   └── cascade_log.jsonl
├── creative_os/                  # Stage 0 Canvas 产物
│   ├── canvas_state.json
│   ├── idea_pool.json
│   └── trope_pool.json
├── creative_divergence.json      # Stage 0 Divergence Step 产物
├── behavior_examples/            # 持久化的行为示例草稿（如有）
├── llm_usage.jsonl               # Token 用量日志
└── baseline_manifest.json        # 测试 fixture
```

---

## 13. 待解决的架构问题

1. **Stage 0 两条路径能力不对称**：Wizard 用户拿不到 CreativeOS 真实能力（变异 / 新颖度 / What-If），CLAUDE.md 的 `project_creative_divergence_two_paths.md` 已记忆。
2. **`NoveltyEvaluator` 缺 LLM 标签提取**：4 维评分里 market_saturation 维度因 `tags=[]` 退化。
3. **`MapStep` 全空**：地图系统未实现，`map.json` 几乎不写，全文大纲 prompt 注入"暂无地图系统信息"。
4. **`auto_generator.py` 被删除后的两段独立回写**：`_realign_growth_curves` + `bind_growth_curve_to_outline` 都改 `characters.json`，无统一入口。
5. **Wizard 步骤编号漂移**：旧 `InitWizardModal`（ConceptStep=1）和新 `WorkspaceWizardPanel`（CreativeDivergenceStep=1）编号不一致；前者已标记 DEPRECATED 但仍有测试引用。
6. **Stage1 强前置守卫**：移除 `project.json.initial_intent.free_text` 兜底后，旧项目必须回访第 1 步才能继续。
7. **`OutlineStep` 与 `ChapterOutlineStep` 同文件但端点分散**：所有 stage3 端点都在 `stage3_outline.py`，但前端调用分散在不同步骤组件，缺少统一 facade。

---

## 14. 相关文档

- `docs/wizard-inventory.md` — Wizard 与工作台融合现状
- `docs/design/webmain/DESIGN.md` — UI 设计 token
- `docs/design/workspace-wizard/DESIGN.md` — 工作台 Wizard 设计
- CLAUDE.md 已记忆：`project_creative_divergence_two_paths.md`