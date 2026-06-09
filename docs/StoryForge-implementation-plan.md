# StoryForge 开发规划

> 基于 storyForge-design-v3.0.md | 结合 agents-and-prompts-audit-v2 当前实现状态
> 版本：2026-06-09

---

## 阅读说明

- **粗体**条目 = 当前 audit-v2 已实现，本规划明确其质量标准
- 普通条目 = 待开发
- `[AUDIT-GAP]` = audit-v2 发现的已知缺口，本规划补充
- 每个版本末尾有**可验证验收标准**，通过才进入下一版本

---

## 版本地图

```
MVP-0  基础写作闭环（当前可验证起点）
  ↓
v0.5   叙事资产完整初始化（修补最大缺口）
  ↓
v1.0   Consistency Chain 完整（一卷可靠产出）
  ↓
v1.5   Narrative Chain 完整（张力驱动写作）
  ↓
v2.0   Creative Chain 完整（从意图到 Story DNA）
  ↓
v2.5   Style Engine + 成本优化（工业化就绪）
  ↓
v3.0   全链路闭合（百万字可控产出）
```

---

## MVP-0 — 基础写作闭环

**目标**：验证核心管道端到端可跑通。系统能给定章节大纲，产出含 SF_LOG 标签的场景文本，并完成一次 Registry 更新。

**范围**：已实现组件的质量加固 + 最小可测试集成

### 已实现（需加固质量）

**BaseAgent + render_and_chat**
- 补充：模板变量缺失时抛出明确异常（当前行为未知）
- 补充：LLM 返回非 JSON 时的自愈解析（strip 代码块、重试一次）
- 补充：每次调用写入 `llm_usage.jsonl`（调用时机/tokens/模型/耗时）

**Writer（scene_writer.yaml）**
- 加固：`build_context` 的 7 步顺序已是 L0→L1→L4→CS→L2→L3（audit-v2 已修正）
- 加固：验证 L4 传入为空时 Writer 不崩溃，降级为只使用 L0/L1
- `[AUDIT-GAP]` Writer 风格选择机制缺失：当前硬连 `scene_writer.yaml`，需增加 `genre` 参数路由到对应模板（`scene_writer_cool` / `scene_writer_literary` / `scene_writer_mystery`）

**FactGuard（6项确定性检查）**
- 加固：补充 `_detect_power_level` 对 T 级别以外格式的覆盖（如"境界"、"阶"等自定义词汇）
- 加固：`_check_log_format` 的正则需覆盖多行属性值场景

**StoryOSAgent（SF_LOG 解析）**
- 加固：9 种 log 类型的所有 handler 需有单元测试覆盖
- 加固：`registry_create` handler 需验证传入 data JSON 的必填字段

**Reviewer（3层 Guard）**
- 加固：熔断器触发后的 `compatibility_note` 生成需覆盖所有 FactIssue 类型
- `[AUDIT-GAP]` Reviewer 与 Conductor 的解耦：Reviewer 构造函数中无 `conductor` 参数，`_gen_compatibility_note` 应移入 Reviewer 自身，Conductor 只处理调度

**Planner（chapter_planner.yaml）**
- 加固：`plan_chapter` 输出的 `SceneSchema` 必须包含 `required_logs` 字段；当前 Planner 未必声明，需在 prompt 中强制要求

**pipeline.py（state_extractor.yaml 调用）**
- `[AUDIT-GAP]` 当前绕过 `render_and_chat`，直接调用 `prompts.render()` + `llm.chat()`，与成本追踪脱轨
- 改造：封装为 `CharacterStateMachineAgent` 或在 `pipeline.py` 中补充 `llm_usage.jsonl` 写入

### 待开发

**Conductor 基础状态机**
- 实现 `pipeline_stage` 枚举：`SCENE_PLANNING → SCENE_WRITING → SCENE_REVIEW → STORYOS_UPDATE → CHAPTER_ASSEMBLY`
- 实现 Scene 级 Checkpoint 写入/读取（§12.1 Schema）
- 实现崩溃恢复的 4 条路径（§12.2）

**ContextCache**
- `PER_SCENE_KEYS = {"char_states"}` 的 per-scene 刷新逻辑
- Chapter 切换时清空缓存
- L1/L4/L2 的 per-chapter 缓存命中日志（用于验证缓存有效率）

**StoryOS 基础 CRUD**
- Conflict / Promise / Mystery 三个 Registry 的 JSON 读写
- `storyos.snapshot()` 和 `storyos.restore(snapshot)` 用于事务回滚
- `storyos.exists(registry_type, entry_id)` 用于 FactGuard 的引用完整性检查

### MVP-0 验收标准

```
✓ 给定一份手写的 chapter_outline，系统完整执行：
  Planner.plan_chapter → Writer.write_scene（3次）
  → Reviewer.review_scene → StoryOSAgent.update_after_scene
  → ContextCache 正确命中 L1/L4

✓ Writer 输出的每个 Scene 包含至少 2 个 SF_LOG 标签

✓ FactGuard 能拦截以下 3 种注入问题：
  - 缺少 required_log 标签
  - SF_LOG 格式错误（属性值含未转义引号）
  - Registry 引用不存在的 conflict_id

✓ StoryOS Agent 在 3 个 Scene 后，Registry 状态与
  SF_LOG 声明一致（手工对比 JSON）

✓ 系统崩溃后从 Checkpoint 恢复，输出与未崩溃路径相同

✓ llm_usage.jsonl 记录每次 LLM 调用（含 pipeline.py 的调用）
```

---

## v0.5 — 叙事资产完整初始化

**目标**：修补 audit-v1 发现的最大缺口——Twist / Reveal / Goal / Expectation Registry 从未被初始化。完成后，TensionCurve 的所有计算项才有真实数据。

### 核心工作

**Planner.plan_creative（启用 creative_planning.yaml）**

`plan_creative` 方法和 `creative_planning.yaml` 已存在（audit-v2 已启用），但需验证输出字段完整性：

```python
# creative_planning.yaml 输出必须包含：
{
  "initial_registry_entries": {
    "twists": [
      {
        "id": "tw_001",
        "type": "betrayal",
        "description": "...",
        "setup_chapter": 15,
        "setup_method": "...",
        "reveal_chapter": 58,
        "reveal_trigger": "...",
        "impact": "high",
        "status": "setup_in_progress",
        "foreshadow_chapters": [20, 33, 41],
        "reader_expectation_before": "...",
        "reader_shock_target": "...",
        "cross_refs": { "reveals_via": "rev_010", ... }
      }
    ],
    "reveals": [...],
    "goals": [...],
    "expectations": [...]
  }
}
```

需在 `creative_planning.yaml` 的 system prompt 中明确要求这 4 类 Registry 必须输出，且 cross_refs 外键不能为空。

**seed_initial_registry 扩展**

当前 `seed_initial_registry(conflicts, mysteries)` 只接受 2 类。扩展为接受全部 7 类：

```python
def seed_initial_registry(
    self,
    conflicts: list, mysteries: list,
    promises: list = None, twists: list = None,
    reveals: list = None, goals: list = None,
    expectations: list = None
) -> None
```

**RegistryTransactionManager（§3.3）**

实现跨 Registry 级联：
- Mystery `revealed` → 触发关联 Reveal `revealed`
- Reveal `revealed` → 触发关联 Expectation `fulfilled`
- Twist `revealed` → 触发关联 Expectation `ready_to_fulfill`
- Reveal `revealed` → 触发关联 Conflict `escalated`

实现 `_validate_all_refs()`：全量扫描所有 cross_refs，返回悬空引用列表

**L4 Narrative Memory（§6，与 StoryOS 同步）**

L4 是 Twist/Reveal/Expectation 对 Writer 可见的窗口，格式为：

```json
{
  "active_conflicts": [{ "id": "cf_001", "summary": "林峰 vs 张伟，复仇中" }],
  "active_promises": [{ "id": "promise_017", "content": "替妹报仇", "deadline": 70 }],
  "active_mysteries": [{ "id": "mys_003", "question": "超脑来源", "clues_count": 2 }],
  "pending_twists": [{ "id": "tw_001", "hint": "信任关系将被颠覆", "reveal_chapter": 58 }],
  "approaching_reveals": [{ "id": "rev_005", "reveal_chapter": 48, "chapters_remaining": 3 }],
  "ready_expectations": [{ "id": "exp_007", "content": "林峰清算王霸天", "overdue_chapters": 3 }]
}
```

L4 在每个 Scene 前由 Conductor 调用 `update_l4()` 刷新（per-chapter 缓存）。

### v0.5 验收标准

```
✓ plan_creative 输出包含至少 3 个 Twist、3 个 Reveal、5 个 Expectation 条目

✓ seed_initial_registry 成功将全部 7 类 Registry 写入 storyos/

✓ TensionCurve.calculate_chapter_tension(ch=1) 返回非零值
  （active_conflicts + open_mysteries 的贡献）

✓ TensionCurve.calculate_chapter_tension(ch=55)
  的 approaching_twists 项返回非零值
  （tw_001 的 reveal_chapter=58，距今3章，应命中）

✓ Mystery "revealed" 后 RegistryTransactionManager 自动
  将关联 Reveal 状态改为 "revealed"（事务级联测试）

✓ Writer 的 L4 context 中包含 pending_twists 和 approaching_reveals 信息
```

---

## v1.0 — Consistency Chain 完整

**目标**：一卷（20章）可靠产出，角色状态不崩坏，剧情线不断线。这是第一个可以给真实用户试用的版本。

### 核心工作

**CharacterStateMachine 完整实现（§7）**

- `update_after_chapter`：log 标签提取（已有）+ LLM state_extractor（已启用）合并逻辑
- `_has_sufficient_trigger`：完整实现包括 `accumulated_evidence` 特殊规则（min 3章 / 4条证据）
- `_merge_changes`：log 来源与 LLM 来源去重（同字段以 log 来源为准）
- 为所有初始角色生成 `CharacterProfile`（`beliefs/desires/fears/values/voice_signature/forbidden`）

**PlotStateMachine 断线检测（§8）**

- 实现 `detect_broken_threads(current_chapter)`：active 超过 10 章未引用 → 返回警告
- critical 条目阈值降为 5 章
- 每章写作开始前由 Conductor 调用，将断线警告注入 Planner 的场景规划上下文

**MemoryOS L0 完整更新机制（§6.2）**

L0 在每个 Scene 前由 Conductor 同步刷新，更新来源的数据绑定：

| L0 字段 | 数据来源 | 更新时机 |
|---|---|---|
| `active_characters` | 上一 Scene SF_LOG `character_emotion` | Scene 后 |
| `active_conflicts` | StoryOS Conflict Registry 查询 | Scene 后 |
| `approaching_twists` | Twist Registry `reveal_chapter <= ch+3` | Scene 后 |
| `tension_level` | TensionCurve 上一章结果 | Chapter 后 |
| `pending_warnings` | TensionCurve.get_warnings() | Scene 前 |
| `chapter_beat_so_far` | Planner Scene Planning 预声明汇总 | Scene Planning 后 |

**MemoryOS L1 细节重提取（§6.3）**

- `chapter_id % 5 == 0` 时触发 `_extract_key_details`
- 使用 Tier 3 模型（Claude Haiku）
- 输出格式：每条一行，含章节来源，置于 L1 context 顶部
- 计入 `llm_usage.jsonl`

**Narrator Guard 状态漂移检测（§9.5 `_detect_state_drift`）**

- 从 Scene 文本中检测情感极性反转（如当前状态"冷静"但文本出现"暴怒"关键词）
- 无对应 SF_LOG `character_emotion` 标签 → 生成 Narrative Guard 警告（不阻断）
- 将警告注入下一 Scene 的 Planner prompt

**Conductor 完整阶段门控**

- 实现 `expert_config.yaml` 读取：`chapter_writing: auto / prompt / skip`
- 实现人工审核门（`prompt` 模式）：暂停 pipeline，等待用户 `approve` / `edit` / `reject`
- 实现 `TENSION_CRITICAL`（连续3章低于30）信号的 Planner 介入：触发时下一章强制有 major_payoff

**OutlinePlanner → 全书大纲写入 L2**

- `plan_outline` 输出写入 `l2_warm_summaries/outline.json`
- 章节完成后 `chapter_summary` 写入对应条目（由 StoryOSAgent chapter assembly 后触发）
- L2 摘要树在 Writer 的 `build_context` 中正确加载

### v1.0 验收标准

```
✓ 20章连续产出，中途不手动干预

✓ CharacterStateMachine 在以下情况下拒绝状态更新：
  - 信念变化无 SF_LOG 标签支撑
  - 触发事件不在 valid_trigger_types 列表中

✓ PlotStateMachine 在第12章写作前正确检测到：
  第1章创建的某 conflict 超过10章未在任何 scene 中被引用

✓ L1 在第5章、第10章、第15章触发细节重提取，
  输出清单包含前5章中的具体道具/伤情/约定

✓ TensionCurve 预警在低张力时（测试：清空所有 Registry 后写作）
  正确返回 suggestions 列表，且 Writer 的 L0 context 包含该预警

✓ 20章完成后对比 Registry 状态与章节文本：
  所有 SF_LOG `conflict_escalate` 均正确反映在 Conflict Registry 的
  escalation_history 中

✓ 断点恢复测试：在第8章第2个 Scene 写作中途中断，
  重启后从正确的 Scene 恢复，Registry 无重复更新
```

---

## v1.5 — Narrative Chain 完整

**目标**：张力驱动写作生效——TensionCurve 的预警能主动改变 Planner 的场景规划，ReaderOS 指标可观测，跨 Registry 级联经过完整一卷的实战验证。

### 核心工作

**ReaderOS 完整实现（§4，零 LLM 调用）**

七个指标全部基于 Registry 数据计算：

| 指标 | 计算来源 | 关键参数 |
|---|---|---|
| Curiosity | 开放谜团加权：world_level×30 / plot_level×20 / char_level×10，满分150归一化 | Mystery.status = open/partially_revealed |
| Tension | 直接引用 TensionCurve | — |
| Satisfaction | 近3章 fulfilled Expectation+Promise 数×20，上限100 | — |
| Frustration | 近5章 Goal failed/blocked 数×15，上限100 | — |
| Fatigue | 近3章平均 Tension > 50 的超出部分 × 1.5 | — |
| Addiction | Curiosity×0.30 + Tension×0.25 + Satisfaction×0.20 + HookQuality×0.25 | HookQuality: 结尾500字模式匹配 |
| Discussion | moral_ambiguity + subversion_score + hook_score + controversy_text | 全部公式，无 LLM |

`_calc_hook_quality` 的 4 个模式（疑问句/突发危机/揭示/情绪爆发）实现为正则匹配，每次命中叠加分值，上限 100。

`reader_state_history.jsonl` 每章追加一条，供后续分析。

**TensionCurve 与写作循环集成**

- Conductor 在每章 Scene Planning 前调用 `get_warnings(chapter_id)`
- 返回 warnings 注入 Planner 的 `chapter_planner.yaml` 的 `{{tension_warnings}}` 变量（当前模板已有该变量槽）
- `_suggest_tension_boosts` 的 4 条规则需有对应的集成测试：各条建议能在对应 Registry 状态下被触发

**L3 Cold Memory — 向量检索（§6.4）**

- 部署 Qdrant（本地 Docker）
- 实现 `NovelChunker`：按场景边界切割，对话/叙事分离，附加 metadata（characters/locations/emotion_keywords）
- 实现 `ColdMemory.hybrid_search`：bge-m3 语义 + BM25 关键词 + RRF 融合
- 实现 `dedup_by_chunk_id`
- 每章 assembly 完成后增量 upsert 向量索引
- `build_context` 的 L3 查询触发条件：Scene Schema 中引用了 5 章以前的角色/地点/道具

**Narrative Guard prompt 提升**

`narrative_guard.yaml` 当前覆盖叙事品质，补充以下检测维度：
- 本章 mini_payoff 密度：实际 `<!-- SF_LOG expectation_fulfill -->` 数量 vs Beat Pattern 要求
- 人物工具化：角色连续 3 个 Scene 无独立台词或内心活动
- 结尾钩子强度：与 `_calc_hook_quality` 结果对比，低于 40 时附具体建议

### v1.5 验收标准

```
✓ 写完一卷（20章）后，reader_state_history.jsonl 中：
  - Addiction 均值 ≥ 55
  - Frustration 峰值 < 85（如超过，系统应在当章产生了警告）

✓ 在测试场景中人工将前3章的 Expectation 全部标为 delayed，
  ReaderOS 的 Addiction 下降至 < 40，且 Conductor 触发了
  READER_ADDICTION_LOW 信号通知

✓ TensionCurve 预警触发记录：一卷内至少出现2次
  "即将超期 Promise" 警告，且对应章节的 Scene Planning
  中出现了该 Promise 的推进场景

✓ L3 向量检索能正确召回：
  - 查询"苏晓晓持有的物品"能命中第3章中苏晓晓获得密钥卡的段落
  - 查询召回结果的 chapter_id 正确

✓ Registry 级联测试：手动将 Mystery mys_003 状态改为 revealed，
  触发 RegistryTransactionManager 后 Reveal rev_005 自动变为 revealed，
  Expectation exp_011 自动变为 fulfilled（跨3个 Registry）
```

---

## v2.0 — Creative Chain 完整

**目标**：从用户一句话意图出发，系统自动产出 Story DNA → Novel Blueprint。CreativeOS 全部 Engine 可运行，Novelty Evaluator 四维度可复现。

### 核心工作

**CreativeOS 引擎迁移至 YAML 模板（§2，解决 audit-v2 问题3）**

当前 CreativeOS 5 个引擎使用硬编码 prompt，与 BaseAgent 体系脱离。v2.0 改造：

每个引擎的 LLM 调用改为通过 `BaseAgent.render_and_chat(template_path, model, **vars)`，对应模板文件（需新建，因 audit-v2 已删除旧版）：

```
prompts/creative/
├── contradiction_engine.yaml   # 矛盾模板填充
├── mutation_engine.yaml        # 变异操作（含 few-shot）
├── whatif_engine.yaml          # 递归发散（单层扩展）
├── genre_fusion.yaml           # 体裁融合（含冲突化解）
└── novelty_evaluator.yaml      # 仅用于 trope 标签提取（Tier 3 模型）
```

改造后的引擎保持原有 Python 接口不变，只是 prompt 字符串移入 YAML。

**Novelty Evaluator 四维度实现（§2.7）**

| 维度 | 实现方式 | LLM？ |
|---|---|---|
| market_saturation | 从 idea 提取套路标签 → 查 Trope Pool 的 market_saturation，取最小值归一化 | 仅标签提取（Haiku）|
| trope_similarity | bge-m3 向量化 idea → 在 Trope Pool 向量索引搜索 → (1-max_sim)×100 | 否（本地向量）|
| contradiction_depth | 5个矛盾模板的正则匹配，多模板命中×1.3加成 | 否（纯正则）|
| discussion_potential | 争议关键词计数×10 + 身份冲突关键词×12 - 可预测结尾×15 | 否（纯公式）|

`_calc_market_saturation` 的 LLM 调用只负责提取标签名称（非评分），输出枚举值，使用 Tier 3 模型。

**Trope Pool 初始数据**

需人工标注 30+ 条初始 Trope 条目，覆盖主流网文套路，标注 `market_saturation`（0-1）。这是 Novelty Evaluator 可靠运行的数据基础。

**WhatIf Engine 递归发散（§2.5）**

- `depth=3, breadth=4` 作为默认参数
- 每层发散是独立 LLM 调用（Tier 2 模型）
- 限制：每个节点的子节点生成加入"必须是父节点的直接逻辑推论"约束
- 树结构序列化写入 `story_dna.json` 的 `key_whatif_nodes` 字段（取深度2的高分叶节点）

**Genre Fusion Engine（§2.6）**

- `GENRE_STRUCTURES` 字典定义至少 8 种体裁的结构特征
- `_genre_distance` 的 BFS 路径搜索
- `_check_promise_conflict` 用 LLM 判断读者承诺是否矛盾（Tier 2，单次调用）
- `_design_conflict_resolution` 用 LLM 设计化解方案（Tier 1，单次调用）

**Creative Director 完整工作流（§9.2）**

```python
async def generate_story_dna(concept, genre, secondary_genre) -> StoryDNA:
    # 7 步串行流水线
    # 1. IdeaPool 播种
    # 2. ContradictionEngine.generate(concept, n=5) → 选最高 novelty_score
    # 3. WhatIfEngine.expand(seed=core_contradiction.statement, depth=3, breadth=4)
    # 4. MutationEngine（INVERSION × 2 + SUBVERSION × 2）
    # 5. GenreFusionEngine.fuse(genre, secondary_genre) 如有副类型
    # 6. NoveltyEvaluator.evaluate(assembled_idea)
    # 7. 组装 StoryDNA 对象
```

**人工审核门（Creative Director → Planner）**

Story DNA 生成后，`conductor_config.yaml` 的 `concept_approval: prompt` 触发暂停，展示 Story DNA 摘要，等待用户：
- `approve`：进入 Planner 双阶段规划
- `edit`：用户修改 `story_dna.json` 后手动触发
- `regenerate`：重新执行 Creative Director

### v2.0 验收标准

```
✓ 给定一句话意图（如"重生都市，主角有预知能力"），系统自动产出：
  - story_dna.json 包含 core_contradiction、genre_fusion、novelty_score
  - novelty_score ≥ 75（对应设计文档的"高新颖度"阈值）

✓ Novelty Evaluator 四维度可复现：
  对同一 idea 运行 3 次，breakdown 各维度偏差 < 2（确定性部分偏差为0）

✓ Trope Pool 覆盖测试：对"重生系统文"进行评估，
  market_saturation 得分应 < 20（高饱和度套路应被扣分）

✓ WhatIf Engine 输出的发散树：
  深度3可达，叶节点与根节点有可追溯的逻辑链

✓ CreativeOS 5 个引擎的所有 LLM 调用均出现在 llm_usage.jsonl 中
  （验证已迁移至 YAML 模板 + render_and_chat 体系）

✓ 完整流程（意图 → Story DNA → plan_creative → seed_registry → 写章）
  端到端跑通，首章产出的 L4 context 包含来自 plan_creative 的 Twist 条目
```

---

## v2.5 — Style Engine + 成本优化

**目标**：Style Engine 三层约束生效，模型分层路由上线，每章 Token 成本达到 v3.0 设计预期（~117.5K tokens）。

### 核心工作

**Style Engine 完整实现（§10）**

L1 Genre Templates：
- `style_engine/templates/cool_novel.yaml`（已有）补充 `beat_rules` 和 `forbidden` 的完整条目
- 新建 `mystery.yaml`、`literary.yaml`（`scifi.yaml` 可后续追加）

L2 Writing Formulas（`WritingFormula.validate_scene`）：
- `_split_sentences`：中文句子切分（基于标点）
- `_calc_dialog_ratio`：引号包围文本占全文比
- `_calc_paragraph_dist`：段落长度直方图
- `_detect_violations`：调用 L3 ConstraintLayer + L1 规则检查

L3 Constraint Layer：
- `CHARACTER_TABOO_PATTERNS` 扩展：为常见角色类型（复仇者/天才/穿越者）各增加 5 条
- `GENRE_TABOO_PATTERNS` 的结构性检查规则（标记为 0.0 的）迁移到 Narrative Guard 处理
- `_is_char_speaking` 升级：检测对话标签或"角色名+说/道/想"的上下文模式

Style Extractor（§10.5）：
- 确定性统计部分（句长/对白比/段落分布/情绪词密度）完整实现
- LLM 风格分类：单次调用，输出枚举值（5选1），使用 Tier 3 模型
- 输出 `extracted_profile.yaml` 写入项目目录

**Writer 风格路由（解决 audit-v2 问题1的 Writer 侧）**

```python
# writer.py
def _get_template_path(self, genre: str) -> str:
    mapping = {
        "cool_novel": "writing/scene_writer_cool",
        "literary":   "writing/scene_writer_literary",
        "mystery":    "writing/scene_writer_mystery",
    }
    return mapping.get(genre, "writing/scene_writer")  # 默认回退
```

`expert_config.yaml` 新增 `genre` 字段，Conductor 在初始化 Writer 时传入。

**模型分层路由（§11.2）**

实现 `cost/model_router.py`：

```python
class ModelRouter:
    TIER_MAPPING = {
        "scene_writing":        Tier.ONE,    # claude-opus-4-6
        "narrative_guard":      Tier.TWO,    # claude-sonnet-4-6
        "character_state":      Tier.TWO,
        "whatif_engine":        Tier.TWO,
        "l1_detail_extraction": Tier.THREE,  # claude-haiku
        "novelty_tag_extract":  Tier.THREE,
        "style_classify":       Tier.THREE,
        "contradiction_engine": Tier.ONE,
        "mutation_engine":      Tier.ONE,
    }
    
    def get_model(self, operation: str) -> str:
        tier = self.TIER_MAPPING.get(operation, Tier.TWO)
        return self.config["tiers"][tier.name]["model"]
```

`model_tiers.yaml` 配置文件，支持通过修改配置切换模型（无需改代码）。

**Token 预算追踪（§11.1）**

`cost/token_budget.py`：
- 每章写作开始时初始化预算计数器
- 每次 LLM 调用后累加（从 `llm_usage.jsonl` 实时读取）
- 章节完成后输出 cost report：实际消耗 vs 预算（117.5K/章）
- 超预算 20% 时记录警告

**Context 缓存命中率监控**

在 `ContextCache.get_or_compute` 中增加 hit/miss 计数，每章结束后写入进度文件，目标命中率 > 60%（L1/L4/L2 在同章内命中）。

### v2.5 验收标准

```
✓ 爽文风格下，Style Guard 检测到违规示例：
  - 连续4段纯描写（无对白）触发 "连续3段以上纯描写" 违规
  - 角色"林峰"在测试场景中"在众人面前流泪"触发 character_taboo

✓ Style Extractor 对一段 2000 字样本文本输出：
  avg_sentence_length、dialog_ratio、paragraph_length_mean 的值
  与人工统计误差 < 10%

✓ 模型路由测试：scene_writing 使用 Tier 1 模型，
  l1_detail_extraction 使用 Tier 3 模型（从 llm_usage.jsonl 验证）

✓ 20章成本报告：
  - 平均每章 Token ≤ 130K（允许10%浮动）
  - Tier 0（确定性代码）调用占比 > 40%

✓ ContextCache 命中率报告：一章（3 Scene）内 L1/L4 各命中 2 次以上
```

---

## v3.0 — 全链路闭合

**目标**：三条能力链全部端到端验证，系统能从一句话产出完整一卷（20章）且中途无人工干预，全书 Coherence 指标可计算。

### 核心工作

**全链路集成测试套件**

为每条能力链建立端到端测试：

```
Creative Chain 测试：
  输入：用户意图一句话
  验证：Story DNA.novelty_score ≥ 75
        Novel Blueprint.storyos_initial_state 所有 7 类 Registry 非空

Narrative Chain 测试：
  前提：Novel Blueprint 已完成
  验证：20章后 TensionCurve 无连续3章低于30
        20章后有至少2个 Twist 被正确揭示（SF_LOG + Registry 均变更）

Consistency Chain 测试：
  验证：20章后 CharacterStateMachine 中
        无未被 SF_LOG 支撑的信念变化
        PlotStateMachine 无超过15章的断线
```

**Novel Blueprint 完整输出（§9.3 Planner 双阶段补全）**

`novel_blueprint.json` 的最终结构必须包含：
- `story_dna`（来自 Creative Director）
- `world`（来自 Worldbuilder）
- `characters`（来自 CharacterDesigner，含 CharacterStateMachine 初始状态）
- `outline`（来自 OutlinePlanner，含 `registry_seeds`）
- `storyos_initial_state`（来自 Planner.plan_creative，7 类 Registry 完整）

当前 CharacterDesigner 和 Worldbuilder 是独立 Agent，需在 Conductor 的前置阶段（WORLDBUILDING → CHARACTER_DESIGN → OUTLINE_PLANNING → CREATIVE_PLANNING）串联执行，产物合并写入 `novel_blueprint.json`。

**全书质量指标计算**

一卷完成后自动生成 `quality_report.json`：

```json
{
  "coherence_score": 88,
  "breakdown": {
    "timeline_continuity": 95,
    "character_consistency": 87,
    "registry_compliance": 92,
    "hook_coverage": 82,
    "tension_distribution": 78
  },
  "issues": [
    { "chapter": 12, "type": "broken_thread", "event": "cf_003 超过10章未推进" }
  ],
  "cost_summary": {
    "total_tokens": 2350000,
    "avg_per_chapter": 117500,
    "tier_breakdown": { "T1": 60, "T2": 25, "T3": 5, "T0": 10 }
  }
}
```

`coherence_score` 计算：
- timeline_continuity：FactGuard 时间线检查通过率
- character_consistency：CharacterStateMachine 状态更新接受率
- registry_compliance：FactGuard Registry 合规检查通过率（首次不触发重写的比例）
- hook_coverage：有 `<!-- SF_LOG expectation_fulfill -->` 或 hook 模式结尾的章节占比
- tension_distribution：TensionCurve 各章值的标准差（越均匀越高分，需在合理范围内）

**多项目并发支持**

`projects/{project_id}/` 的隔离已有，v3.0 补充：
- 项目切换时完整加载对应的 StoryOS Registry、CharacterStateMachine、MemoryOS
- 同一进程支持多个项目 Conductor 实例（使用 project_id 作为命名空间）

### v3.0 验收标准

```
✓ 全链路测试：从意图输入到20章产出，零人工干预
  （conductor_config.yaml 所有门控设为 auto）

✓ quality_report.json 的 coherence_score ≥ 82

✓ 20章内所有 Twist Registry 条目：
  setup 阶段对应的 foreshadow_chapters 在章节文本中确实出现了伏笔
  （人工抽查3个 Twist）

✓ 全书成本报告：总 Token ≤ 2.5M（20章 × 125K）

✓ 连续运行 3 个不同意图的项目（都市/玄幻/悬疑），
  每个项目的 quality_report.coherence_score ≥ 80

✓ 一卷产出后，切换到第二个项目，第一个项目的
  Registry 状态不被污染（隔离验证）
```

---

## 附录一：当前实现状态快照

基于 agents-and-prompts-audit-v2，整理各版本关联的已实现项：

| 组件 | 状态 | 对应版本 |
|---|---|---|
| BaseAgent + render_and_chat | ✅ 已实现，需加固 | MVP-0 |
| Writer + scene_writer.yaml | ✅ 已实现，需风格路由 | MVP-0 / v2.5 |
| FactGuard（6项） | ✅ 已实现，需加固 | MVP-0 |
| StoryOSAgent（SF_LOG 解析） | ✅ 已实现，需单元测试 | MVP-0 |
| Reviewer（3层 Guard） | ✅ 已实现，需解耦 | MVP-0 |
| Planner.plan_chapter | ✅ 已实现 | MVP-0 |
| Planner.plan_creative | ✅ 已启用，需补全输出字段 | v0.5 |
| state_extractor.yaml | ✅ 已启用（绕过 render_and_chat）| v1.0 / MVP-0 加固 |
| CharacterDesigner | ✅ 已实现 | v1.0 |
| Worldbuilder | ✅ 已实现 | v1.0 |
| OutlinePlanner | ✅ 已实现 | v1.0 |
| ContextCache | 🔶 架构已有，需完善 | MVP-0 |
| CharacterStateMachine | 🔶 部分实现 | v1.0 |
| RegistryTransactionManager | ❌ 未实现 | v0.5 |
| L4 Narrative Memory | ❌ 未实现 | v0.5 |
| ReaderOS | ❌ 未实现 | v1.5 |
| TensionCurve.get_warnings | ❌ 未实现 | v1.5 |
| L3 Cold Memory（Qdrant） | ❌ 未实现 | v1.5 |
| CreativeOS 引擎（YAML化） | ❌ 硬编码 | v2.0 |
| Novelty Evaluator（4维度） | ❌ 未实现 | v2.0 |
| Style Engine（3层） | ❌ 未实现 | v2.5 |
| 模型分层路由 | ❌ 未实现 | v2.5 |
| Novel Blueprint 完整输出 | ❌ 未实现 | v3.0 |
| 全书质量指标 | ❌ 未实现 | v3.0 |

---

## 附录二：各版本工时估算

| 版本 | 预估工时 | 主要依赖 |
|---|---|---|
| MVP-0 | 1.5 周 | 无（现有代码加固） |
| v0.5 | 2 周 | MVP-0 验收通过 |
| v1.0 | 3 周 | v0.5 验收通过 |
| v1.5 | 3 周 | v1.0 验收通过 + Qdrant 环境 |
| v2.0 | 4 周 | v1.5 + Trope Pool 人工标注 |
| v2.5 | 2 周 | v2.0 验收通过 |
| v3.0 | 3 周 | v2.5 + 完整集成测试设施 |
| **合计** | **~18 周** | 串行执行 |

---

## 附录三：需要外部资源的依赖项

| 依赖 | 用途 | 版本 | 备注 |
|---|---|---|---|
| Qdrant | L3 向量检索 | v1.5 | 本地 Docker 即可 |
| BAAI/bge-m3 | 文本嵌入 | v1.5 | 本地模型，约 2GB |
| Trope Pool 人工标注 | Novelty Evaluator market_saturation | v2.0 | 需 2 名标注员，30+ 条目 |
| Claude Opus 4 / Sonnet 4 / Haiku | Tier 1/2/3 模型 | v2.5 | API 配置 |
| 参考文本样本（风格提炼） | StyleExtractor | v2.5 | 用户提供或内置样本 |
