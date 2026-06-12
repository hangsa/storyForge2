# StoryForge v1.6 — 产品设计文档

> v1.6 目标：从"能写完一部作品"升级到"能写好一部作品"，将叙事资产管理和一致性保障提升到工程化水准。


## 一、版本定位

### 1.1 从 v1.5 到 v1.6

```
v1.5                              v1.6
────                              ────
线性前进，无回退                     支持回退影响传播
L0 + L1 + L2                       L0 + L1 + L2 + L3 + L4
无 Narrative Guard                  Narrative Guard（Tier 2 LLM）
5 项 Fact Guard                    6 项 Fact Guard（+ 语义预检结果复核框架）
字符静态档案                         角色成长曲线 + 剧情里程碑绑定
Style Engine L1                    Style Engine L1 + L2 + L3
追更欲 + 疲劳度（2 项）             全部 7 项指标 + 体裁差异化阈值
无级联传播                           叙事资产级联传播 + 冲突检测
单模型（全部调用同一 Provider）      多模型 Tier 策略 + Agent LLM 配置系统
无章节评审                           每章完成后自动展示质量摘要
```

### 1.2 核心目标

| 目标 | 说明 |
|---|---|
| **叙事深度** | 级联传播让叙事资产的因果链完整闭环；Narrative Guard 主动发现角色行为漂移 |
| **记忆完整** | 五层记忆系统就位：L0 运行时 → L1 热记忆 → L4 叙事记忆 → L2 温记忆 → L3 冷记忆 |
| **一致性工程化** | Conductor 回退影响传播让修改不再"看不见后果"；角色成长曲线将信念变化纳入硬性约束 |
| **成本可控** | 多模型 Tier 策略将单章 token 成本控制在预算内（~117.5K），支持用 DeepSeek 替代 Opus 降低 ~70% 成本 |
| **体裁感知** | ReaderOS 7 项指标按体裁差异化阈值，悬疑推理和爽文不再用同一把尺子衡量 |

### 1.3 版本定位

v1.6 是"叙事引擎完整化"版本。v1.5 解决了"能不能写"（多章量产），v1.6 解决"写得好不好"（叙事质量）。不引入 CreativeOS（那是 v1.7 的创意辅助能力），专注在已有的写作流水线上增加深度保障。


## 二、v1.5 现状回顾

### 2.1 已实现模块

| 模块 | 关键文件 | 状态 |
|---|---|---|
| **LLM Provider** | `anthropic_provider.py` `deepseek_provider.py` `minimax_provider.py` | 三 Provider + 工厂模式 |
| **Conductor** | `state_machine.py` `circuit_breaker.py` `checkpoint.py` | 8 阶段 FSM + 熔断 + 断点 |
| **Agents** | `planner.py` `writer.py` `reviewer.py` `storyos_agent.py` `summary_archiver.py` | 5 Agent 完整 |
| **MemoryOS** | `l0_runtime.py` `l1_hot.py` `l2_warm.py` | L0(~500 tokens) + L1(近 5 章) + L2(章摘要树 + 关系图 + 时间轴) |
| **StoryOS** | `registries.py` | 7 类注册表(Conflict/Mystery/Twist/Goal/Promise/Reveal/Expectation) + 伏笔注册表 |
| **Scene Engine** | `schema.py` `beat_patterns.py` | Schema 2.0 + beat 模式 |
| **Style Engine** | `genre_template.py` `style_extractor.py` | L1 体裁模板 + 风格提炼 |
| **ReaderOS** | `calculator.py` `thresholds.py` | 追更欲 + 疲劳度 |
| **API Routes** | 10 个路由文件 | 端到端 8 阶段完整 |
| **Pydantic Models** | 9 个模型文件 | project/world/character/storyos/sf_log/outline/progress/checkpoint |
| **Prompts** | 7 个 YAML | concept/world/character/outline/scene_writing/scene_rewrite/chapter_summary |
| **Frontend** | 9 页面 + 组件 + hooks | React 18 + Vite + Tailwind，8 阶段全页面 |
| **Tests** | 17 文件 310+ 用例 | unit + integration，关键路径全覆盖 |
| **数据隔离** | 文件系统按 project_id 目录隔离 | 完整，无跨项目泄露 |
| **导出** | `stage6_export.py` | Markdown 导出 + SF_LOG 去除 + 目录 + 书名页 |

### 2.2 当前限制

| 限制 | 影响 |
|---|---|
| 无回退传播 | 修改前期设定后无法知道影响哪些章节，只能手动逐个检查 |
| 无级联传播 | 叙事资产的状态变更不会自动级联到关联资产，需人工维护一致性 |
| L3/L4 记忆缺失 | 无法进行语义检索，长篇写作时上下文召回依赖摘要精度，容易遗漏细节 |
| 无 Narrative Guard | 角色行为漂移完全依赖 Writer 自觉和 Fact Guard 的硬规则，缺少中间层的柔性检测 |
| Style Engine 仅 L1 | 写作公式和禁忌约束未自动执行，风格一致性依赖 Prompt 描述 |
| ReaderOS 仅 2 项 | 好奇心、张力、满足感、挫败感、讨论潜力 5 项指标缺失，无法全面感知叙事节奏 |
| 单模型 | 所有 LLM 调用使用同一个 Provider，写作质量和成本效率无法兼顾 |
| 无 Agent LLM 配置 | Agent 使用哪个模型完全硬编码在 Provider 工厂中，切换模型需要改代码 |
| 角色无成长曲线 | 角色的信念变化无预设轨迹，容易前后不一致 |


## 三、新增功能详设

### F1.6.1 Conductor 回退影响传播

**目标：** 用户修改前期设定后，Conductor 自动计算受影响的章节和资产范围，生成分级影响报告。

**用户场景：**
- 作者写完 20 章后，觉得主角的性格设定需要调整
- 作者修改 STAGE 2 的角色档案（characters.json）或世界观（world.json）
- 系统自动分析哪些章节需要复核或重写
- 作者根据影响报告决定是否执行回退、仅更新元数据、或取消

**Step 1 — 影响范围计算（确定性，零 LLM）：**

| 修改对象 | 检测逻辑 |
|---|---|
| Story DNA (concept_and_dna.json) | 标记所有基于旧 DNA 的产出物为"待复核"——concept → world → characters → outline → 全部已完成章 |
| world.json | 扫描 outline.json 中引用被修改元素（势力名、规则名）的 Scene 计划；扫描已完成章 SF_LOG 中引用被修改元素的条目 |
| characters.json | 扫描 outline.json 中涉及被修改角色的 Scene 计划；扫描已完成章 SF_LOG 中该角色的 relation_change / emotion / location_change 标记 |
| outline.json | 对比新旧大纲差异（Scene 增删、顺序变化、beat_type 变更），按章节列出结构差异 |

**Step 2 — 分级影响报告：**

```
优先级       含义                       示例
─────────────────────────────────────────────────────
P0 必须重写   叙事资产冲突，当前文本不成立    Mystery 的 clue 引用了已删除的角色
P1 建议复核   与新版设定可能存在偏差         角色性格已修改，过去行为可能"不像他"
P2 无影响     改动不影响已完成内容           新增一个后期才出场的角色
```

**Step 3 — 用户决策：**

| 决策 | 行为 |
|---|---|
| 确认执行 | 标记受影响章为"待重写"状态，对应 progress.json 中 scene status 重置为 pending |
| 取消回退 | 恢复原始文件（写入前创建 .bak 备份） |
| 兼容模式 | 仅更新元数据，在 project.json 记录"设定在 Ch.N 后发生变更"，不重置任何状态 |

> **边界：** 此功能仅处理用户手动触发的单次回退。叙事重构模式——影响 ≥ 10 章时的批量处理、分支合并——推迟至 v1.8。

**实现要点：**
- 确定性计算，零 LLM 调用
- 修改检测通过文件 hash 对比（SHA256）判断哪些文件发生了变更
- 影响报告写入 `projects/{id}/impact_report.json`
- 前端：STAGE 2/3 编辑页增加"检测影响"按钮，展示分级报告面板


### F1.6.2 MemoryOS L3（冷记忆）+ L4（叙事记忆）

**目标：** 完善五层记忆系统。L3 提供语义级别的细粒度检索能力，L4 提供与 StoryOS 同步的叙事资产摘要。

**L3 冷记忆 — 矢量语义检索库：**

| 维度 | 规格 |
|---|---|
| **存储内容** | 全书所有已完成章的分块内容，每块 ~500 tokens，重叠 50 tokens |
| **嵌入模型** | BAAI/bge-m3（多语言，中文优化，1024 维） |
| **向量库** | Qdrant（本地部署，单机运行） |
| **混合检索** | 向量语义相似度（cosine）+ BM25 关键词精确匹配，RRF（Reciprocal Rank Fusion）融合排序，权重默认 0.6:0.4 |
| **检索粒度** | 默认返回 top-5 块，可配置 |
| **触发方式** | Writer Agent 上下文组装时触发：组装完 L0/L1/L4/L2 后，若上下文仍感不足（由 Writer 自主判断），发起 L3 查询；查询关键词由 Writer 在 prompt 中生成 |
| **更新时机** | 每章完成后，Summary Archiver 生成章摘要的同时触发 L3 分块和向量化 |

**L4 叙事记忆 — StoryOS 同步摘要：**

| 维度 | 规格 |
|---|---|
| **内容** | 活跃冲突摘要（status=active 的 Conflict 列表 + 当前强度）、未解谜团列表（status=foreshadowing/clue_revealed 的 Mystery）、待兑现承诺（status=pending 的 Promise）、铺垫中的反转（status=planned 的 Twist）、待满足期待（status=ready_to_fulfill 的 Expectation） |
| **容量** | ~3K tokens |
| **同步方式** | 每章 StoryOS Agent 更新注册表后自动重新生成 L4 摘要 |
| **格式** | 结构化自然语言段，直接注入 Writer 上下文 |

**检索优先级（更新后）：**

```
L0（运行时，~500 tokens）→ L1（热记忆，近 5 章）→ L4（叙事记忆，~3K）→ L2（温记忆，~8K）→ L3（冷记忆，矢量检索 top-5）
```

**验收标准：**
- L3 在 5 万字的作品中，Qdrant 检索延迟 < 2 秒
- L4 与 StoryOS 注册表状态完全一致（确定性生成，零 LLM）
- Writer 上下文组装顺序严格遵循 L0 → L1 → L4 → L2 → L3


### F1.6.3 叙事资产级联传播与冲突检测

**目标：** 当 StoryOS Agent 更新某个叙事资产时，自动级联触发关联资产的状态变更，并检测级联路径上的冲突。

**级联规则：**

```
触发条件                              级联效果
─────────────────────────────────────────────────────────────
Mystery → revealed                   → 关联的 Reveal → revealed
                                      → 关联的 Expectation → fulfilled

Twist → revealed                     → 关联的 Expectation → ready_to_fulfill

Reveal → revealed                    → 关联的 Conflict → escalated

Promise → fulfilled                  → 关联的 Expectation → fulfilled

Conflict → resolved                  → 检查是否有未揭示的 Mystery 依赖此冲突
                                        → 若有，标记 Mystery 为 orphaned（警告）
```

**级联前校验（确定性，零 LLM）：**

1. **循环依赖检测：** 广度优先遍历级联路径，若发现 A → B → ... → A 则中断，标记"需人工解耦"，输出完整循环路径
2. **状态冲突检测（禁止转换）：**
   - `resolved` → `active`（已解决不能重新激活）
   - `revealed` → `foreshadowing`（已揭示不能退回铺垫）
   - `fulfilled` → `accumulating`（已满足不能退回累积中）
   - `abandoned` → 任意非 abandoned 状态（警告）
3. **互斥资产冲突检测：** 同一 Mystery 关联的两个 Twist 状态互斥时（如一个 revealed 一个 planned），标记"潜在逻辑冲突"供人工判断

**冲突处理流程：**

```
级联传播启动
    │
    ├── 遍历级联路径
    │     │
    │     ├── 每步前执行三类校验
    │     │     ├── 通过 → 执行状态变更
    │     │     └── 失败 → 中断整条级联链
    │     │               │
    │     │               └── 标记到 chapter_review.json
    │     │
    │     └── 所有步执行完毕 → 写入注册表
    │
    └── 章节评审会展示冲突
          │
          └── 用户选择：解耦 / 强制覆盖 / 标记为已知矛盾
```

**实现要点：**
- 所有级联逻辑在 StoryOS Agent 中实现，确定性代码，零 LLM
- `RegistryTransactionManager` 包装级联更新为事务——全部成功或全部回滚
- 级联日志写入 `projects/{id}/storyos/cascade_log.jsonl`，可追溯


### F1.6.4 Narrative Guard（状态漂移检测）

**目标：** 在 Fact Guard 的硬性规则和 Writer 的自由创作之间增加一层柔性检测——发现角色行为显著变化但缺少对应的 SF_LOG 标记时生成警告。

**执行时机：** Fact Guard 通过后、Scene 最终确认前。

**检测逻辑：**

1. 从 L2 温记忆中加载该角色的历史行为模式摘要（近 5 章的行为统计）
2. 使用 Tier 2 模型（Claude Sonnet 4）对比当前 Scene 文本中该角色的行为与其历史模式
3. 检查是否存在以下漂移且无对应 SF_LOG 标记：
   - **情感突变：** 角色情绪剧烈变化但无 `character_emotion` 标记
   - **关系突变：** 角色对他人的态度显著变化但无 `character_relation_change` 标记
   - **行为矛盾：** 角色做出与其 `voice_signature.taboos` 相悖的行为
   - **知识泄露：** 角色表现出其 `unknown_to_character` 中记录的知识

4. 输出格式：
   - 若发现漂移 → 生成 warning（含漂移类型、严重程度、建议补充的 SF_LOG 类型）
   - 若未发现 → 静默通过

**重要设计约束：**
- **不阻断** Scene 通过——仅作为建议写入 Scene 元数据
- 使用 Tier 2 模型（Claude Sonnet 4），每 Scene 约 9K tokens
- 若 Tier 2 模型不可用 → 静默跳过（Narrative Guard 是增强功能，非必需路径）

**前端展示：** Fact Guard 面板下方展示 Narrative Guard 建议（若有），以柔和的琥珀色而非红色呈现。


### F1.6.5 Fact Guard 第 6 项（语义预检结果复核框架）

**目标：** 为 v1.7 的语义完整性预检建立 Fact Guard 第 6 项检查的框架。

**当前行为（v1.6）：**
- Fact Guard 第 6 项定义为"语义预检结果复核"
- 该项的检查逻辑接受一个可选输入 `semantic_precheck_results: list[CheckResult] | None`
- v1.6 中该输入始终为 None，因此第 6 项始终返回 `passed`
- 框架就绪——v1.7 接入预检引擎时只需传入结果，无需修改 Fact Guard 代码

**检查逻辑框架：**

```python
# check_6_semantic_precheck_review
# v1.6: 空操作，始终通过。v1.7 接入 LLM 预检结果后生效。
def check_6_semantic_precheck_review(
    self,
    semantic_precheck_results: list[CheckResult] | None = None
) -> CheckResult:
    if semantic_precheck_results is None:
        return CheckResult(
            check_id=6,
            name="语义预检结果复核",
            passed=True,
            detail="v1.6 — 语义预检尚未接入，此项检查暂不生效",
        )
    # v1.7: 复核 LLM 预检结果，过滤误报
    ...
```

> **不阻断原因：** 语义预检基于 LLM，存在误报可能，Fact Guard 列出但不阻断。实际预检引擎在 v1.7 实现。


### F1.6.6 角色成长曲线绑定

**目标：** 角色不再只有静态档案，而是有一条从起点到终点的完整成长曲线，并绑定到具体的剧情事件。

**成长曲线结构（扩展 characters.json）：**

```json
{
  "characters": [{
    "id": "char_001",
    "name": "林峰",
    "growth_curve": {
      "arc_type": "positive_change",       // positive_change | negative_arc | flat_arc
      "stages": [
        {
          "stage": "起点",
          "description": "天真冲动的少年，相信努力可以改变一切",
          "trigger_event_type": "world_truth_revealed",
          "bound_chapter": null             // STAGE 3 后回填
        },
        {
          "stage": "第一次重大打击",
          "description": "发现自己的努力被系统性不公抹杀，开始怀疑价值观",
          "trigger_event_type": "betrayal_experienced",
          "bound_chapter": null
        },
        {
          "stage": "低谷",
          "description": "绝望中放弃一切，退回孤独状态",
          "trigger_event_type": "irreversible_loss",
          "bound_chapter": null
        },
        {
          "stage": "觉醒与新信念",
          "description": "在关键人物牺牲后找到新的战斗理由",
          "trigger_event_type": "death_of_loved_one",
          "bound_chapter": null
        }
      ]
    }
  }]
}
```

**STAGE 2 创建：** 角色创建时设计完整的成长曲线：起点 → 关键转折点（绑定触发事件类型）→ 低谷 → 终点。触发事件类型必须在 8 类信念变化白名单内。

**STAGE 3 回填：** 大纲确定后，扫描 outline 中每个 Scene 的 `narrative_role` 和 `registry_changes`，自动将成长曲线的每个 stage 绑定到最匹配的章节号。

**STAGE 4 写作时：** Writer 上下文注入角色当前应处的成长阶段：
```
[角色成长状态]
林峰 — 当前阶段：第一次重大打击 → 低谷（过渡中）
- 下一转折事件类型：irreversible_loss
- 当前应表现：信念动摇、对原有价值观的怀疑加深
- 本章角色应避免的行为：完全恢复信心（与阶段不符）
```

**信念变化严格门槛（已有，保持不变）：**
- 必须源于 SF_LOG 标记（非 LLM 推断）
- ≥ 2 个独立触发事件（近 3 章内）
- ≥ 1 个在本章
- 触发类型必须在 8 类白名单内
- `accumulated_evidence` 特殊规则：≥ 3 章有证据 + ≥ 4 个独立证据片段


### F1.6.7 Style Engine L2 + L3

**目标：** 在现有 L1（体裁模板）基础上，增加 L2 写作公式和 L3 禁忌约束，让风格控制从"描述型"升级到"可量化验证型"。

**L2 写作公式：**

| 公式 | 说明 | 实现方式 |
|---|---|---|
| **句式模板** | 爽文短句快节奏（平均句长 ≤ 30 字），严肃文学长句铺陈（平均句长 ≥ 50 字） | Token 计数统计，写入 Scene 元数据 |
| **情绪节奏模板** | 每 X 字需有一个情绪高点（爽文 X=500，悬疑 X=800） | SF_LOG `character_emotion` 密度统计 |
| **对白节奏公式** | 对白占比（爽文 ≥ 40%）、对白段落长度分布 | 正则匹配引号对话 + 段落长度分布统计 |
| **爽点密度公式** | 每章最少爽点触发次数 = f(体裁, 章节位置) | SF_LOG `expectation_fulfill` + `goal_milestone` 计数 |

**实现方式：**
- L2 公式全部为确定性统计（正则 + Token 计数），零 LLM 调用
- 每章完成后自动计算，结果写入 `projects/{id}/style/stats/ch{XX}_style_stats.json`
- 前端 STAGE 4 写作中心展示当前章的写作公式达标情况

**L3 禁忌约束：**

| 层级 | 约束来源 | 检测方式 |
|---|---|---|
| **全局禁忌** | 禁止元引用（"如果这是一本小说……"）、禁止真实公司/品牌名称 | 正则 + 关键词匹配 |
| **角色禁忌** | 每个角色 `voice_signature.taboos`，如"禁止说脏话"、"禁止主动求助" | 关键词匹配 + LLM 辅助（Tier 3，仅在正则触发后做二次确认） |
| **体裁禁忌** | 爽文禁止无故虐主超 300 字、禁止主角连续失败超 2 次、悬疑禁止提前揭露真凶身份 | 体裁模板 YAML 中定义 + 正则匹配 |

**L3 执行时机：** Reviewer 的 Style Guard 阶段，在 Narrative Guard 之后执行。L3 为**硬性约束**——检测到违规即标记，不阻断 Scene 但写入 Style Guard Report。

**体裁模板扩展（`cool_novel.yaml` → 增加 L2 + L3 字段）：**

```yaml
genre: 爽文
style_formula:
  avg_sentence_length_max: 30
  dialogue_ratio_min: 0.4
  emotional_beat_interval: 500    # 每 500 字至少一次情绪标记
  satisfaction_beat_min: 3        # 每章至少 3 次爽点触发

taboos:
  - pattern: "虐主"
    max_chars: 300                 # 连续虐主描写不超过 300 字
    severity: error
  - pattern: "连续失败"
    max_consecutive: 2
    severity: error
```


### F1.6.8 ReaderOS 全部 7 项指标 + 体裁差异化

**目标：** 在 v1.5 的 2 项指标（追更欲、疲劳度）基础上补齐全部 7 项指标，并按体裁自动配置差异化阈值。

**7 项指标体系（全部确定性计算，零 LLM）：**

| 指标 | 计算逻辑 | 关键输入 |
|---|---|---|
| **追更欲 (Addiction)** | 已有，v1.5 — 未解谜团密度 × 期待值 × 反转力度 / 疲劳度修正 | Mystery.status=foreshadowing, Expectation.ready_to_fulfill, Twist |
| **疲劳度 (Fatigue)** | 已有，v1.5 — 平均句长 + 信息密度 + 连续章节未出现爽点 | 句式统计、Scene 长度 |
| **好奇心 (Curiosity)** | 新增 — 活跃线索数 × 线索揭示进度 / 章节数 | Mystery 注册表 clue 数量 + SF_LOG mystery_clue 密度 |
| **张力 (Tension)** | 新增 — 活跃冲突强度均值 + 冲突升级频率 × 角色危险度 | Conflict 注册表 intensity + SF_LOG conflict_escalate |
| **满足感 (Satisfaction)** | 新增 — 近期爽点触发数 + 承诺兑现率 + 目标进展度 | SF_LOG expectation_fulfill + goal_milestone + Promise.fulfilled 比率 |
| **挫败感 (Frustration)** | 新增 — 主角目标受阻次数 + 连续负面事件序列长度 | Goal.progress 停滞/倒退检测 |
| **讨论潜力 (Discussion)** | 新增 — 争议性关键词匹配 + 身份冲突评分 + 开放式结局暗示 − 可预测性惩罚 | 关键词词库 + 反转/揭示密度 |

**体裁差异化阈值（默认值，用户可覆盖）：**

| 指标 | 爽文 | 严肃文学 | 悬疑推理 | 科幻 | 奇幻 |
|---|---|---|---|---|---|
| 追更欲 严重阈值 | **50** | 30 | 45 | 35 | 40 |
| 挫败感 高度阈值 | **60** | 80 | 65 | 70 | 70 |
| 疲劳度 中度阈值 | **55** | 40 | 60 | 55 | 50 |
| 好奇心 中度阈值 | 35 | **20** | 30 | 25 | 25 |
| 张力 轻度阈值 | 55 | 70 | **60** | 65 | 60 |
| 满足感 中度阈值 | **60** | 40 | 50 | 45 | 50 |
| 讨论潜力 高度阈值 | 50 | **70** | 60 | 55 | 55 |

> 加粗 = 该体裁对此指标最敏感。

**实现方式：**
- 所有计算在 ReaderOS Calculator 中实现，纯 Python 确定性逻辑
- 体裁阈值表存储在 `config/genre_thresholds.yaml`，项目创建时写入 `project.json`
- 用户可在项目设置中覆盖阈值
- 前端：STAGE 4 写作中心右侧面板展示当前章的 7 项指标仪表盘


### F1.6.9 Agent LLM 配置系统

**目标：** v1.6 首次出现三个 LLM Tier 同时使用（Tier 1 创意写作、Tier 2 叙事分析、Tier 3 辅助提取），需要一套配置系统管理"哪个 Agent 的哪项任务使用哪个 Tier 的哪个模型"，而非硬编码在 Provider 工厂中。

**设计原则：**

- **层级与 Agent 解耦：** Tier 定义模型池和默认模型；Agent 映射声明每个任务用哪个 Tier，可覆盖 Tier 默认模型
- **任务粒度：** 一个 Agent 的不同任务可以走不同 Tier（如 Reviewer 的 Fact Guard 走 Tier 0，Narrative Guard 走 Tier 2，Style Guard 走 Tier 0）
- **向前兼容：** v1.7 将 Planner 拆分为 4 个专业 Agent 时，只需在配置文件中增加映射条目，不改变配置系统的代码架构
- **用户可覆盖：** 所有默认值可由用户在配置中调整

**配置结构（`config/model_tiers.yaml`）：**

```yaml
tiers:
  tier_1:                        # 创意核心 —— 写作质量敏感
    description: "Scene 写作、STAGE 1-3 内容生成"
    models:
      - id: claude-opus-4
        provider: anthropic
        cost_per_1k_input: 0.015
        cost_per_1k_output: 0.075
        max_tokens: 8192
      - id: deepseek-v4-pro
        provider: deepseek
        cost_per_1k_input: 0.002
        cost_per_1k_output: 0.008
        max_tokens: 8192
    default: deepseek-v4-pro     # v1.6 默认用 DeepSeek 写 Scene（成本约 Opus 的 1/7）
    retry_on_failure: true
    max_retries: 2
    fallback: claude-opus-4

  tier_2:                        # 分析 —— 推理质量敏感，成本适中
    description: "Narrative Guard 状态漂移检测"
    models:
      - id: claude-sonnet-4
        provider: anthropic
        cost_per_1k_input: 0.003
        cost_per_1k_output: 0.015
        max_tokens: 4096
    default: claude-sonnet-4
    retry_on_failure: true
    max_retries: 1
    fallback: null               # 无降级 → 失败则跳过（Narrative Guard 不阻断）

  tier_3:                        # 辅助 —— 成本优先
    description: "L1 细节重提取、章摘要生成、风格分类"
    models:
      - id: claude-haiku
        provider: anthropic
        cost_per_1k_input: 0.00025
        cost_per_1k_output: 0.00125
        max_tokens: 2048
    default: claude-haiku
    retry_on_failure: true
    max_retries: 1
    fallback: null

  tier_0:                        # 确定性 —— 零 LLM
    description: "Fact Guard、StoryOS SF_LOG 解析、ReaderOS 计算"
    models: []
    default: none

agent_mapping:
  planner:
    concept_generation:        { tier: tier_1, model: default }
    world_generation:          { tier: tier_1, model: default }
    character_generation:      { tier: tier_1, model: default }
    outline_generation:        { tier: tier_1, model: default }

  writer:
    scene_writing:             { tier: tier_1, model: deepseek-v4-pro, fallback: claude-opus-4 }
    scene_rewrite:             { tier: tier_1, model: default }    # 重写用 Tier 1 默认模型
    context_assembly:          { tier: tier_0 }

  reviewer:
    fact_guard:                { tier: tier_0 }
    narrative_guard:           { tier: tier_2, model: default }
    style_guard:               { tier: tier_0 }
    coherence_scoring:         { tier: tier_0 }

  storyos_agent:
    sf_log_parsing:            { tier: tier_0 }
    cascade_propagation:       { tier: tier_0 }
    conflict_detection:        { tier: tier_0 }

  summary_archiver:
    chapter_summary:           { tier: tier_3, model: default }
    l1_reextraction:           { tier: tier_3, model: default }
    style_extraction:          { tier: tier_3, model: default }
```

**运行时模型路由流程：**

```
Agent 发起 LLM 调用请求
        │
        ├── 查询 agent_mapping[agent_name][task_name]
        │     │
        │     ├── tier == tier_0 → 拒绝 LLM 调用，报错
        │     │
        │     └── tier != tier_0 → 获取 tier 配置
        │           │
        │           ├── 使用 agent_mapping 中指定的 model
        │           │   或使用 tier.default
        │           │
        │           ├── 检查 model 是否可用
        │           │    ├── 可用 → 执行调用
        │           │    └── 不可用 → 尝试 agent_mapping.fallback
        │           │              → 尝试 tier.fallback
        │           │              → 都不可用 → 根据 tier.retry_on_failure 决定
        │           │
        │           └── 记录调用到 llm_usage.jsonl
        │                (timestamp, agent, task, tier, model,
        │                 tokens_in, tokens_out, cost)
```

**Token 预算追踪增强：**

```jsonl
{"timestamp":"2026-06-15T14:30:00Z","agent":"writer","task":"scene_writing","tier":"tier_1","model":"deepseek-v4-pro","tokens_in":25000,"tokens_out":4000,"cost":0.082}
{"timestamp":"2026-06-15T14:32:00Z","agent":"reviewer","task":"narrative_guard","tier":"tier_2","model":"claude-sonnet-4","tokens_in":9000,"tokens_out":1500,"cost":0.0495}
{"timestamp":"2026-06-15T14:33:00Z","agent":"summary_archiver","task":"chapter_summary","tier":"tier_3","model":"claude-haiku","tokens_in":3500,"tokens_out":200,"cost":0.00113}
```

**v1.7 扩展方式：** Planner 拆分为 4 个 Agent 时，只需在 `agent_mapping` 中替换 planner 为 `creative_director`、`worldbuilder`、`character_designer`、`outliner`——配置系统代码零改动。


### F1.6.10 章节评审会

**目标：** 每章写作完成后，Writer 和 Reviewer 的输出汇总为一个结构化评审面板，作者在此确认通过或提出修改。

**评审面板内容：**

```
┌──────────────────────────────────────────────────────┐
│  第 N 章评审                                          │
│                                                       │
│  连贯性评分：82 / 100                                   │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ReaderOS 指标                                     │ │
│  │ 追更欲 72（↑3）  疲劳度 38（↓5）  好奇心 65（→）   │ │
│  │ 张力 70（↑8）    满足感 55（↓2）  挫败感 30（↓10）  │ │
│  │ 讨论潜力 60（↑5）                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  📋 本章叙事资产变动：                                  │
│    新增冲突 1 项 / 升级冲突 1 项                         │
│    谜团线索 +2 / 承诺兑现 1 项 / 反转揭示 1 项           │
│    期待满足 2 项 / 铺垫中 3 项                           │
│                                                       │
│  ⚠️ Narrative Guard 建议：                             │
│    林峰在第 3 幕的行为与其一贯风格有偏差                   │
│    → 建议补充 character_emotion 标记                   │
│                                                       │
│  📊 写作公式达标情况：                                  │
│    平均句长 28 字 ✓（爽文标准 ≤ 30）                    │
│    对白占比 42% ✓（爽文标准 ≥ 40%）                     │
│    爽点触发 4 次 ✓（标准 ≥ 3）                          │
│                                                       │
│  💡 讨论话题：                                         │
│    1. 本章的反转力度是否足够？                           │
│    2. 苏晓晓的态度转变是否铺垫充分？                      │
│                                                       │
│  [通过] [快速通过（跳过评审）] [提出修改意见]              │
└──────────────────────────────────────────────────────┘
```

**实现要点：**
- 每章最后一个 Scene 完成后自动触发评审面板
- 评审数据来自：Fact Guard 结果、ReaderOS Calculator、StoryOS Agent 更新摘要、Style Engine 统计
- "讨论话题"由 Summary Archiver 在生成章摘要时一并产出（Tier 3 LLM，~200 tokens）
- 评审结果写入 `projects/{id}/chapter_reviews/ch{N}_review.json`
- 前端：STAGE 4 写作中心在每章完成后弹出评审面板，也可在右上角手动打开


## 四、v1.6 到 v1.5 的变更总结

```
v1.5                             v1.6
────                             ────
线性前进，无回退                   支持回退影响传播（Conductor）
L0 + L1 + L2                     L0 + L1 + L2 + L3（Qdrant）+ L4（叙事记忆）
无级联传播                         级联传播 + 循环依赖检测 + 状态冲突检测
无 Narrative Guard                Narrative Guard（Tier 2，不阻断）
5 项 Fact Guard                  6 项 Fact Guard（+ 语义预检框架）
角色静态档案                       成长曲线 + 剧情里程碑绑定
Style Engine L1                   Style Engine L1 + L2（写作公式）+ L3（禁忌约束）
追更欲 + 疲劳度（2 项）           全部 7 项指标 + 体裁差异化阈值
单模型                             多模型 Tier 策略 + Agent LLM 配置系统
无章节评审                         每章完成后自动展示质量摘要 + 讨论话题
```

## 五、v1.6 验收标准

| 编号 | 验收项 | 对应功能 |
|---|---|---|
| AC-1 | 回退修改 STAGE 2 角色设定后，Conductor 正确识别受影响章节并生成 P0/P1/P2 分级报告 | F1.6.1 |
| AC-2 | 回退报告准确区分"必须重写"和"建议复核"——修改角色名标记为 P0，修改性格描述标记为 P1 | F1.6.1 |
| AC-3 | L3 冷记忆语义检索在 5 万字的作品中，Qdrant 检索延迟 < 2 秒 | F1.6.2 |
| AC-4 | L4 叙事记忆与 StoryOS 7 类注册表状态完全一致，零延迟同步 | F1.6.2 |
| AC-5 | Mystery → revealed 自动触发 Reveal → revealed → Expectation → fulfilled 完整级联链 | F1.6.3 |
| AC-6 | 循环依赖 A → B → A 被正确检测并中断，不会导致无限级联 | F1.6.3 |
| AC-7 | resolved → active 状态冲突被正确拦截，级联中断 | F1.6.3 |
| AC-8 | Narrative Guard 检测到角色行为显著变化但缺少 SF_LOG 标记时生成 warning（不阻断） | F1.6.4 |
| AC-9 | Narrative Guard 在 Tier 2 模型不可用时静默跳过，Scene 写作不受影响 | F1.6.4 |
| AC-10 | 成长曲线中"第一次重大打击"阶段绑定到第 26 章后，Writer 在第 26 章上下文收到正确的成长阶段提示 | F1.6.6 |
| AC-11 | 角色信念变化触发条件不足（仅 1 个触发事件）时，系统标记"信念变化证据不足" | F1.6.6 |
| AC-12 | Style Engine L3 禁忌约束正确拦截"无故虐主超过 300 字"并写入 Style Guard Report | F1.6.7 |
| AC-13 | 爽文体裁项目写作公式：平均句长 ≤ 30 字、对白占比 ≥ 40%、每章 ≥ 3 次爽点触发 | F1.6.7 |
| AC-14 | 悬疑推理体裁项目的追更欲严重阈值自动设为 45，爽文项目自动设为 50 | F1.6.8 |
| AC-15 | 修改 `model_tiers.yaml` 将 Writer 的 model 从 deepseek-v4-pro 切换为 claude-opus-4，下一 Scene 写作立即生效 | F1.6.9 |
| AC-16 | Tier 1 主模型不可用时，Writer 自动降级到 fallback 模型，Scene 写作不中断 | F1.6.9 |
| AC-17 | `llm_usage.jsonl` 按 Agent/Tier/Model 三维度正确记录每次调用 | F1.6.9 |
| AC-18 | 每章最后一个 Scene 完成后，章节评审面板自动展示，包含 ReaderOS 指标、叙事资产变动、Narrative Guard 建议、写作公式达标情况 | F1.6.10 |
| AC-19 | 单章 token 消耗在预算范围内（~133K 峰值 / ~110K-120K 典型） | 全局 |
| AC-20 | 全部新增确定性代码（级联传播、L3 约束、ReaderOS 5 项新指标、回退影响计算）通过单元测试，覆盖率 > 85% | 全局 |


## 六、技术影响范围

### 6.1 后端变更

| 模块 | 变更类型 | 说明 |
|---|---|---|
| `conductor/state_machine.py` | 修改 | 增加 `impact_propagation()` 方法 |
| `conductor/impact_analyzer.py` | **新增** | 回退影响范围计算（确定性） |
| `memory_os/l3_cold/` | **新增** | L3 冷记忆 — Qdrant 集成、嵌入、BM25 索引、混合检索 |
| `memory_os/l4_narrative.py` | **新增** | L4 叙事记忆 — StoryOS 同步、摘要生成 |
| `story_os/registry_transaction.py` | **新增** | 级联传播 + 事务管理 |
| `story_os/registries.py` | 修改 | 增加级联触发钩子 |
| `agents/reviewer.py` | 修改 | 增加 Narrative Guard（Tier 2 LLM）、第 6 项 Fact Guard 框架、Style Guard L3 |
| `agents/writer.py` | 修改 | 上下文组装增加 L4 → L3 检索、角色成长阶段注入 |
| `agents/summary_archiver.py` | 修改 | 增加 L3 分块触发、评审讨论话题生成 |
| `reader_os/calculator.py` | 修改 | 增加 5 项新指标计算 |
| `reader_os/thresholds.py` | 修改 | 增加体裁差异化阈值表 |
| `style_engine/writing_formulas.py` | **新增** | L2 写作公式统计 |
| `style_engine/taboo_constraints.py` | **新增** | L3 禁忌约束检测 |
| `config/model_tiers.yaml` | **新增** | Agent LLM 配置 |
| `llm/model_router.py` | **新增** | 运行时模型路由 |
| `api/conductor.py` | 修改 | 增加回退影响检测端点 |
| `api/stage4_writing.py` | 修改 | 增加章节评审触发 |
| `models/character.py` | 修改 | 增加 growth_curve 字段 |
| `models/progress.py` | 修改 | 增加 chapter_review 结构 |

### 6.2 前端变更

| 页面/组件 | 变更类型 | 说明 |
|---|---|---|
| `Stage4Page.tsx` | 修改 | 增加 ReaderOS 7 项指标面板、写作公式达标面板 |
| `ChapterReviewPanel.tsx` | **新增** | 章节评审面板（模态或侧边栏） |
| `ImpactReportPanel.tsx` | **新增** | 回退影响报告面板 |
| `Stage2Page.tsx` | 修改 | 增加角色成长曲线编辑 |
| `StoryOSPanel.tsx` | 修改 | 展示级联传播结果、冲突告警 |
| `SettingsPage.tsx` | **新增** | 项目设置页 — 体裁阈值覆盖、LLM 模型选择 |

### 6.3 基础设施变更

| 组件 | 说明 |
|---|---|
| **Qdrant** | 新增依赖 — 本地单机部署，存储 L3 向量 |
| **bge-m3** | 新增依赖 — 嵌入模型，通过 sentence-transformers 或 API 调用 |
| **PyYAML** | 已有 — model_tiers.yaml、genre_thresholds.yaml 配置解析 |


## 七、预估工作量

| 功能 | 预估工时 | 优先级 |
|---|---|---|
| F1.6.9 Agent LLM 配置系统 | 12h | P0（基础设施，所有 LLM 调用的前提） |
| F1.6.3 叙事资产级联传播 + 冲突检测 | 16h | P0（叙事引擎核心） |
| F1.6.4 Narrative Guard | 10h | P0（新 Agent 能力，Tier 2 集成） |
| F1.6.5 Fact Guard 第 6 项框架 | 2h | P1（框架就位即可，逻辑在 v1.7） |
| F1.6.2 L3 + L4 记忆 | 24h | P1（L3 基础设施较重） |
| F1.6.1 Conductor 回退影响传播 | 12h | P1 |
| F1.6.8 ReaderOS 全部 7 项指标 | 14h | P1 |
| F1.6.10 章节评审会 | 10h | P1（前端重度） |
| F1.6.6 角色成长曲线 | 12h | P2 |
| F1.6.7 Style Engine L2 + L3 | 14h | P2 |
| **合计** | **~126h** | |


## 八、Token 预算（v1.6 单章）

v1.5 单章约 70K tokens。v1.6 新增 Narrative Guard（Tier 2 LLM）和 L1 重提取（Tier 3 LLM 摊销），预算调整为 ~133K。

| 调用 | Agent | Tier | 模型 | 输入 (tokens) | 输出 (tokens) | 小计 |
|---|---|---|---|---|---|---|
| Scene 写作 × 3 | Writer | Tier 1 | DeepSeek V4 Pro | 27,000 × 3 | 4,000 × 3 | 93,000 |
| Scene 重写（20% 概率缓冲） | Writer | Tier 1 | Claude Opus 4 (fallback) | 2,000 | 600 | 2,600 |
| Narrative Guard × 3 | Reviewer | Tier 2 | Claude Sonnet 4 | 27,000 | 4,500 | 31,500 |
| 章摘要 | Summary Archiver | Tier 3 | Claude Haiku | 3,500 | 200 | 3,700 |
| L1 重提取（每 5 章摊销） | Summary Archiver | Tier 3 | Claude Haiku | 200 | 20 | 220 |
| 讨论话题生成 | Summary Archiver | Tier 3 | Claude Haiku | 2,000 | 200 | 2,200 |
| **合计** | | | | **~115,700** | **~17,520** | **~133,200** |

> 以上为峰值估算（含重写缓冲，输入/输出已按概率折算）。实际运行中重写触发率 < 20%，Narrative Guard 输出通常 < 1,000 tokens，典型单章消耗约 **110K-120K tokens**。

**成本对比（单章）：**

| 策略 | 成本/章 | 20 章总成本 |
|---|---|---|
| v1.5 全 Opus 写作 | ~$1.50 | ~$30.00 |
| v1.6 DeepSeek 写作 + Sonnet NG | ~$0.75 | ~$15.00 |
| v1.6 DeepSeek 写作（NG 关闭） | ~$0.35 | ~$7.00 |


## 九、向后兼容与迁移

### 9.1 v1.5 项目升级

v1.5 项目在 v1.6 中打开时，系统自动补齐缺失字段：

| 数据文件 | 缺失字段 | 默认值 |
|---|---|---|
| `characters.json` | `growth_curve` | `null`（无成长曲线，写作时跳过成长阶段注入） |
| `characters.json` | `personality.core_traits` 等嵌套字段 | 已有 v1.5 fallback 逻辑，保持不变 |
| `project.json` | `genre_thresholds` | 从 `config/genre_thresholds.yaml` 按项目 genre 自动填充 |
| `progress.json` | `chapter_review` 结构 | 首次触发章节评审时创建 |

### 9.2 配置文件缺失

若 `config/model_tiers.yaml` 不存在（v1.5 项目直接升级），ModelRouter 使用内置硬编码默认值（等同于 v1.5 行为：全部 LLM 调用使用 `create_provider()` 工厂的默认 Provider），并在首次启动时自动生成配置文件。

### 9.3 L3/L4 冷启动

v1.5 项目首次在 v1.6 中打开时：
- L3 Qdrant 集合为空，需执行一次性全量索引（遍历所有已完成章、分块、向量化、写入 Qdrant）
- L4 从现有 StoryOS 注册表文件直接生成（确定性，零 LLM）
- 索引过程中 STAGE 4 写作仍可进行，仅 L3 检索返回空结果直至索引完成

