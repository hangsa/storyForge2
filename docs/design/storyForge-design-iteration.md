# StoryForge v1.4 迭代规划 — 从 MVP 到完整版

> 本文档基于 v1.4 完整设计方案与 v1.4-mvp 最小可运行版本之间的差距，规划四个迭代版本（v1.5 ~ v1.8），每个版本有明确的功能范围、依赖关系和验收标准。


## 一、迭代总览

```
v1.4-mvp          v1.5              v1.6              v1.7              v1.8
  1章端到端        多章连续写作       完整叙事引擎       完整创意引擎      协作增强与
                                                                   跨作品复用
    │                │                 │                 │                 │
    ▼                ▼                 ▼                 ▼                 ▼
┌────────┐     ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│ 核心链路 │ ──→ │ 量产能力    │ ──→ │ 叙事深度    │ ──→ │ 创意广度    │ ──→ │ 作者体验    │
│ 可运行   │     │ 可持续产出  │     │ 工程化程度  │     │ 创新辅助    │     │ 长期陪伴    │
└────────┘     └────────────┘    └────────────┘    └────────────┘    └────────────┘
```

| 版本 | 核心目标 | 预计工作量 | 依赖 |
|---|---|---|---|
| **v1.5** | 从 1 章扩展到多章连续写作，具备量产能力 | 6 周 | v1.4-mvp |
| **v1.6** | 完善叙事资产管理和一致性保障，达到工程化水准 | 8 周 | v1.5 |
| **v1.7** | 接入完整创意引擎，辅助作者从 0 到 1 构思 | 10 周 | v1.6 |
| **v1.8** | 协作体验优化和跨作品资产复用，支撑长期创作 | 6 周 | v1.7 |


## 二、版本差距分析

以下列出 v1.4 完整设计中在 MVP 阶段被裁剪的全部功能，以及它们在哪个迭代版本被回填。

| 裁剪功能 | v1.4 章节 | MVP 状态 | 回填版本 |
|---|---|---|---|
| 多章写作循环 | 五·5.5 | 仅单章 | v1.5 |
| MemoryOS L2（温记忆，结构化摘要） | 十三·13.2 | 无 | v1.5 |
| StoryOS 全部 7 类叙事资产 | 十·10.2 | 仅 4 类 | v1.5 |
| 基础 ReaderOS（追更欲 + 疲劳度） | 十四·14.2 | 无 | v1.5 |
| STAGE 5 全书诊断（基础版） | 五·5.6 | 无 | v1.5 |
| STAGE 6 基础导出（.md） | 五·5.7 | 无 | v1.5 |
| 风格提炼（Style Extractor） | 八·8.3 | 无 | v1.5 |
| 多角色 + 角色关系网络 | 五·5.3 | 单角色 | v1.5 |
| Conductor 回退影响传播 | 二·2.2 | 无 | v1.6 |
| MemoryOS L3（Qdrant + BM25）+ L4（叙事记忆） | 十三·13.2 | 无 | v1.6 |
| 叙事资产级联传播 + 冲突检测 | 十·10.4 | 无 | v1.6 |
| Narrative Guard（状态漂移检测） | 十五·15.3 | 无 | v1.6 |
| Fact Guard 第 6 项（语义预检结果复核） | 十五·15.3 | 无 | v1.6 |
| 角色成长曲线 + 剧情里程碑绑定 | 五·5.3 / 五·5.4 | 无 | v1.6 |
| Style Engine L2（写作公式）+ L3（禁忌约束） | 八·8.2 | 仅 L1 | v1.6 |
| ReaderOS 全部 7 项指标 + 体裁差异化阈值 | 十四·14.2-14.4 | 无 | v1.6 |
| 多模型 Tier 策略 | CLAUDE.md | 单模型 | v1.6 |
| 章节评审会 | 六·6.5 | 无 | v1.6 |
| CreativeOS 全部引擎 | 九·9.2 | 无 | v1.7 |
| 创意画布交互探索 | 六·6.1 | 无 | v1.7 |
| 分支模拟引擎 | 六·6.2 | 无 | v1.7 |
| 语义完整性预检 | 十一·11.4 | 无 | v1.7 |
| 风格沙盒 | 六·6.4 / 八·8.4 | 无 | v1.7 |
| 创新豁免 | 六·6.4 / 八·8.5 | 无 | v1.7 |
| 灵感路由器 | 三·3.3-3.4 | 无 | v1.7 |
| 成长工坊（Growth Workshop） | 六·6.3 | 无 | v1.7 |
| 用户编辑辅助（SF_LOG 自动建议） | 六·6.7 | 无 | v1.7 |
| 叙事重构模式 | 六·6.8 | 无 | v1.8 |
| 协作疲劳感知 | 三·3.2 | 无 | v1.8 |
| Mid-Scene 草稿缓存 | 二·2.6 | 无 | v1.8 |
| 跨作品资产复用（Global Trope/Idea Pool、风格模板） | 七 | 无 | v1.8 |
| STAGE 6 多格式导出（PDF、EPUB） | 五·5.7 | 无 | v1.8 |
| 用户自定义矛盾模板 | 九·9.2 | 无 | v1.8 |


## 三、v1.5 — 多章连续写作

### 3.1 目标

从"能写一章"升级到"能写完一部作品"。核心是建立章与章之间的状态传递、叙事资产的持续追踪、以及基本的全书质量诊断能力。

### 3.2 新增功能

#### F1.5.1 多章 STAGE 4 写作循环

从单章扩展到完整的逐章循环。每章内部保持 MVP 的五步流程（Scene 规划 → 逐幕写作 → Fact Guard → StoryOS 更新 → checkpoint），章间自动推进到下一章。

**关键变更：**
- Conductor 维护章节进度计数器
- 每章完成后自动加载下一章的 outline 数据
- 章间的角色状态、叙事资产状态通过 L0 快照 + StoryOS 注册表传递
- 支持暂停/恢复——checkpoint 记录当前章号和 Scene 号

#### F1.5.2 MemoryOS L2（温记忆）

随着章节数增加，Writer 需要全书级别的结构化摘要来保持上下文连贯。

**实现：**
- 每章完成后，Summary Archiver Agent 自动生成章摘要（~200 tokens/章）
- L2 包含：按卷/章组织的摘要树、角色关系图（增量更新）、全书时间轴
- 检索优先级保持：L0 → L1 → L2
- 总容量控制在 ~8K tokens 以内（约 40 章的摘要）

**触发时机：** 每章写作完成后由 Summary Archiver Agent 自动执行。

#### F1.5.3 StoryOS 扩展至 7 类叙事资产

从 MVP 的 4 类（Conflict / Mystery / Twist / Goal）扩展到完整 7 类：

| 新增资产 | 追踪内容 | 新增标记类型 |
|---|---|---|
| **Promise（承诺）** | 角色对谁许下了什么、何时兑现 | `registry_create type="promise"` |
| **Reveal（揭晓）** | 什么秘密要揭示、谁知道/不知道 | `registry_create type="reveal"` |
| **Expectation（读者期待）** | 读者现在在期待什么发生 | `registry_create type="expectation"` |

新增对应的 SF_LOG 标记类型（共 11 种，新增 4 种）：`expectation_fulfill`、`twist_reveal`、`goal_milestone`、`character_physical_change`。

#### F1.5.4 基础 ReaderOS（追更欲 + 疲劳度）

在连续多章写作中，作者需要知道读者的阅读体验趋势。MVP 阶段完全不追踪读者指标，v1.5 引入两个最关键指标：

**追更欲（Addiction）：**
```
追更欲 = 好奇心×0.30 + 张力×0.25 + 满足感×0.20 + 结尾钩子质量×0.25
```
- 好奇心：当前所有开放谜团 × 影响权重求和（世界观级=30、剧情级=20、角色级=10），归一化到 0-100
- 张力：当前活跃冲突的强度和数量
- 满足感：近 3 章内 fulfilled 状态的 Expectation 和 Promise 数量 × 20，上限 100
- 结尾钩子质量：每章结尾是否有 cliffhanger（有=100/无=0/部分=50）

**疲劳度（Fatigue）：**
```
疲劳度 = 近 3 章 Tension 平均值减去 50（超过 50 视为高强度），超额部分 × 1.5
```

**预警阈值（仅爽文体裁）：**
- 追更欲 < 50 → 严重预警
- 疲劳度 > 55 → 中度预警

预警在下一章 Scene 规划时注入 Writer 的写作提示。

> 全部 7 项指标和体裁差异化阈值在 v1.6 实现。

#### F1.5.5 STAGE 5 全书诊断（基础版）

全书写作完成后，系统自动扫描三大类问题：

| 类别 | 检测内容 | 检测方式 |
|---|---|---|
| **时间线断裂** | 角色位置跳跃无标记、事件时间顺序矛盾 | 规则匹配 |
| **叙事资产遗留** | 未解决的 Conflict、未揭示的 Mystery、未兑现的 Promise | 注册表遍历 |
| **伏笔状态** | 伏笔是否有始有终（planted → clues → revealed）、是否有 planted 但无后续的"死伏笔" | 伏笔映射表遍历 |

诊断结果按 P0/P1/P2 分级展示，用户逐项决定修复或跳过。

#### F1.5.6 STAGE 6 基础导出

从写作完成状态导出为 Markdown 文件：
- 可选保留或去除 SF_LOG 标记（默认去除）
- 按章节顺序拼接
- 添加章节目录

#### F1.5.7 风格提炼（Style Extractor）

作者可上传参考文本（如喜欢的作家作品片段），系统自动分析：
- 平均句长分布
- 对话比例
- 描述密度
- 高频词汇特征

提炼结果生成 YAML 规则文件，可保存为自定义体裁模板。

#### F1.5.8 多角色支持

从 MVP 的单角色扩展到多角色：
- characters.json 支持多个角色
- 角色关系网络：双向关系状态追踪（信任/敌对/暧昧/师徒等）
- 角色出场追踪：哪些角色在哪些章出场

### 3.3 v1.5 验收标准

| 编号 | 验收项 |
|---|---|
| AC-1 | 连续写作 20 章，章间状态正确传递，无角色位置/状态丢失 |
| AC-2 | 7 类叙事资产注册表正确创建和更新 |
| AC-3 | 追更欲和疲劳度每章结束后自动计算，预警正确触发 |
| AC-4 | L2 温记忆在每章完成后自动更新，总量 < 8K tokens |
| AC-5 | STAGE 5 诊断正确识别出故意注入的 3 个问题（1 时间线断裂 + 1 未解决冲突 + 1 死伏笔） |
| AC-6 | STAGE 6 导出 .md 文件，SF_LOG 标记已去除，章节目录正确 |
| AC-7 | 上传 500 字参考文本，Style Extractor 正确产出句式/节奏/词汇三类分析结果 |
| AC-8 | 3 个角色的关系网络在章节写作中正确追踪 |

### 3.4 v1.5 到 v1.4-mvp 的变更总结

```
v1.4-mvp                        v1.5
───────                         ────
1 章                             多章（典型 20-100 章）
4 类叙事资产                      7 类叙事资产
5 项 Fact Guard                  5 项 Fact Guard（不变）
L0 + L1 记忆                     L0 + L1 + L2
无 ReaderOS                      追更欲 + 疲劳度
无 STAGE 5 / STAGE 6             基础诊断 + .md 导出
单角色                            多角色 + 关系网络
无风格提炼                         风格提炼
4 个 Agent                       5 个 Agent（+ Summary Archiver）
无故事件标记类型                   11 种 SF_LOG 标记类型
```


## 四、v1.6 — 完整叙事引擎

### 4.1 目标

将叙事资产管理和一致性保障提升到工程化水准。核心是引入级联传播与冲突检测、完整的五层记忆系统、体裁差异化指标、以及模型分层策略——让系统在长篇小说尺度下保持可维护性和经济性。

### 4.2 新增功能

#### F1.6.1 Conductor 回退影响传播

用户在写作中期需要回退修改前期设定时，Conductor 自动计算影响范围。

**Step 1 — 影响范围计算（确定性）：**
- 修改 Story DNA → 标记所有基于旧 DNA 的产出物为"待复核"
- 修改 world.json / characters.json → 扫描 outline.json 中引用被修改元素的伏笔、扫描已完成章的 SF_LOG
- 修改 outline.json → 对比新旧大纲差异，标记结构变化章节

**Step 2 — 分级影响报告：**
- P0 必须重写（叙事资产冲突）
- P1 建议复核（与新版设定可能存在偏差）
- P2 无影响

**Step 3 — 用户决策：** 确认执行 / 取消回退 / 仅更新元数据（标记为兼容模式）。

> 叙事重构模式（影响 ≥ 10 章的批量处理）在 v1.8 实现。

#### F1.6.2 MemoryOS L3（冷记忆）+ L4（叙事记忆）

**L3 冷记忆 — 矢量语义检索库：**
- 存储：全书所有章节的分块内容（每块 ~500 tokens）
- 嵌入模型：BAAI/bge-m3
- 向量库：Qdrant
- 混合检索：向量语义相似度 + BM25 关键词精确匹配，RRF 融合排序
- 检索触发：Writer 在写作时发现上下文缺失时主动查询

**L4 叙事记忆 — 叙事资产摘要：**
- 与 StoryOS 七类注册表强同步
- 包含：活跃冲突摘要、未解谜团列表、待兑现承诺、铺垫中的反转
- 约 3K tokens
- 检索优先级调整为：L0 → L1 → L4 → L2 → L3

#### F1.6.3 叙事资产级联传播与冲突检测

**级联规则：**
- Mystery → revealed → 关联的 Reveal → revealed → 关联的 Expectation → fulfilled
- Twist → revealed → 关联的 Expectation → ready_to_fulfill
- Reveal → revealed → 关联的 Conflict → escalated

**级联前校验：**
1. **循环依赖检测：** 遍历传播路径，发现 A → B → ... → A 则中断并标记"需人工解耦"
2. **状态冲突检测：** resolved → active（禁止）、revealed → foreshadowing（禁止）、fulfilled → accumulating（禁止）、abandoned → 任意状态（警告）
3. **互斥资产冲突检测：** 同一 Mystery 关联的两个 Twist 状态互斥时标记"潜在逻辑冲突"

**冲突处理：** 中断级联链 → 章节评审会展示 → 用户选择：解耦 / 强制覆盖 / 进入叙事重构模式（v1.8）

#### F1.6.4 Narrative Guard（状态漂移检测）

在 Fact Guard 之后执行，检测角色行为变化是否缺乏对应的 SF_LOG 标记：

- 对比当前 Scene 中角色的行为模式与 L2 中记录的历史行为模式
- 发现显著偏差但无对应 character_emotion / character_relation_change 标记 → 生成 warning
- **不阻断** Scene 通过——仅建议

使用 Tier 2 模型（Claude Sonnet 4），每 Scene 约 9K tokens。

#### F1.6.5 Fact Guard 第 6 项（语义预检结果复核）

> 语义完整性预检本身在 v1.7 实现。v1.6 先建立第 6 项检查的框架——当预检结果存在时，Fact Guard 列出但**不阻断**（因为预检基于 LLM，存在误报可能）。在 v1.7 预检就位前，此项检查为空操作。

#### F1.6.6 角色成长曲线绑定

- STAGE 2 角色创建时设计完整成长曲线：起点 → 关键转折点（绑定剧情事件类型）→ 低谷 → 终点
- STAGE 3 大纲确定后，自动回填转折点的具体章节号
- STAGE 4 写作时，Writer 上下文注入角色当前应处的成长阶段
- 信念变化严格门槛：≥ 2 个独立触发事件（近 3 章内）、≥ 1 个在本章、触发类型在 8 类白名单内

#### F1.6.7 Style Engine L2 + L3

**L2 写作公式：**
- 句式模板：爽文短句快节奏 / 严肃文学长句铺陈
- 情绪节奏模板：每 X 字需有一个情绪高点
- 对白节奏公式：对白占比、对白段落长度分布
- 爽点密度公式：每章最少爽点触发次数

**L3 禁忌约束：**
- 全局禁忌（如禁止元引用、禁止真实公司名称）
- 角色禁忌（每个角色 voice_signature.taboos）
- 体裁禁忌（如爽文禁止无故虐主超过 300 字）
- 检测方式：正则 + 关键词匹配，零 LLM 调用

#### F1.6.8 ReaderOS 全部 7 项指标 + 体裁差异化

在 v1.5 的追更欲和疲劳度基础上，增加全部 7 项指标：好奇心、张力、满足感、挫败感、疲劳度（已有）、追更欲（已有）、讨论潜力。

**体裁差异化阈值：**

| 指标 | 爽文 | 严肃文学 | 悬疑推理 | 科幻 | 奇幻 |
|---|---|---|---|---|---|
| 追更欲严重阈值 | 50 | 30 | 45 | 35 | 40 |
| 挫败感高度阈值 | 60 | 80 | 65 | 70 | 70 |
| 疲劳度中度阈值 | 55 | 40 | 60 | 55 | 50 |
| 好奇心中度阈值 | 35 | 20 | 30 | 25 | 25 |
| 张力轻度阈值 | 55 | 70 | 60 | 65 | 60 |

项目创建时根据选定体裁自动配置，用户可覆盖。

#### F1.6.9 Agent LLM 配置系统

v1.6 首次出现三个 LLM Tier 同时使用（Tier 1 创意写作、Tier 2 叙事分析、Tier 3 辅助提取），需要一套配置系统来管理"哪个 Agent 的哪项任务使用哪个 Tier 的哪个模型"，而非硬编码。

**设计原则：**

- **层级与 Agent 解耦：** Tier 定义模型池和默认模型；Agent 映射声明每个任务用哪个 Tier，可覆盖 Tier 默认模型
- **任务粒度：** 一个 Agent 的不同任务可以走不同 Tier（如 Reviewer 的 Fact Guard 走 Tier 0，Narrative Guard 走 Tier 2）
- **向前兼容：** v1.7 将 Planner 拆分为 4 个专业 Agent 时，只需在配置文件中增加映射条目，不改变配置系统的代码架构
- **用户可覆盖：** 所有默认值可由用户在配置中调整（如用 DeepSeek 替代 Claude Opus 降低成本）

**配置结构（`config/model_tiers.yaml`）：**

```yaml
# ============================================================
# StoryForge Agent LLM 配置
# 两部分：Tier 定义（模型池）+ Agent 映射（任务 → Tier → 模型）
# ============================================================

# ─── 第一部分：模型 Tier 定义 ───
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
    default: claude-opus-4       # 默认模型
    retry_on_failure: true
    max_retries: 2
    fallback: deepseek-v4-pro    # 主模型不可用时的降级模型

  tier_2:                        # 分析 —— 推理质量敏感，成本适中
    description: "Narrative Guard 状态漂移检测、角色状态机分析"
    models:
      - id: claude-sonnet-4
        provider: anthropic
        cost_per_1k_input: 0.003
        cost_per_1k_output: 0.015
        max_tokens: 4096
    default: claude-sonnet-4
    retry_on_failure: true
    max_retries: 1
    fallback: null               # 无降级模型，失败则跳过（Narrative Guard 不阻断）

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

  tier_0:                        # 确定性 —— 零 LLM 调用
    description: "Fact Guard、StoryOS Agent SF_LOG 解析、ReaderOS 指标计算"
    models: []
    default: none

# ─── 第二部分：Agent → 任务 → Tier 映射 ───
agent_mapping:
  # ── Planner（v1.6 中为合并角色，v1.7 拆分为 4 个专业 Agent）──
  planner:
    concept_generation:          # STAGE 1：概念设定 + Story DNA 生成
      tier: tier_1
      model: default             # 使用 tier_1 的 default 模型
    world_generation:            # STAGE 2：世界观生成
      tier: tier_1
      model: default
    character_generation:        # STAGE 2：角色档案生成
      tier: tier_1
      model: default
    outline_generation:          # STAGE 3：大纲 + Scene 规划生成
      tier: tier_1
      model: default

  # ── Writer ──
  writer:
    scene_writing:               # STAGE 4：Scene 文本生成（吞吐和成本敏感）
      tier: tier_1
      model: deepseek-v4-pro     # v1.6 默认用 DeepSeek 写 Scene（成本约为 Opus 的 1/7）
      fallback: claude-opus-4    # DeepSeek 不可用时降级到 Opus
    scene_rewrite:               # Fact Guard 打回后的重写
      tier: tier_1
      model: default             # 重写用 Tier 1 默认模型（质量优先）
    context_assembly:            # 上下文组装（确定性 + L3 检索触发）
      tier: tier_0               # 上下文组装本身不调 LLM

  # ── Reviewer ──
  reviewer:
    fact_guard:                  # 5+1 项确定性硬检
      tier: tier_0               # 零 LLM
    narrative_guard:             # 状态漂移检测
      tier: tier_2
      model: default             # claude-sonnet-4
    style_guard:                 # 风格禁忌检测
      tier: tier_0               # 正则 + 关键词匹配，零 LLM
    coherence_scoring:           # 连贯性评分计算
      tier: tier_0               # 确定性公式计算

  # ── StoryOS Agent ──
  storyos_agent:
    sf_log_parsing:              # SF_LOG 正则解析 + 注册表更新
      tier: tier_0               # 零 LLM
    cascade_propagation:         # 级联传播（确定性）
      tier: tier_0
    conflict_detection:          # 级联冲突检测（确定性）
      tier: tier_0

  # ── Summary Archiver ──
  summary_archiver:
    chapter_summary:             # 每章完成后生成 ~200 token 摘要
      tier: tier_3
      model: default             # claude-haiku
    l1_reextraction:             # 每 5 章触发一次 L1 关键细节重提取
      tier: tier_3
      model: default
    style_extraction:            # Style Extractor 参考文本分析
      tier: tier_3
      model: default
```

**运行时模型路由流程：**

```
Agent 发起 LLM 调用请求
        │
        ├── 查询 agent_mapping[agent_name][task_name]
        │     │
        │     ├── tier == tier_0 → 拒绝 LLM 调用，报错（不应走到这一步）
        │     │
        │     └── tier != tier_0 → 获取 tier 配置
        │           │
        │           ├── 使用 agent_mapping 中指定的 model（如有）
        │           │   或使用 tier.default
        │           │
        │           ├── 检查 model 是否可用（API 连通性）
        │           │    ├── 可用 → 执行调用
        │           │    └── 不可用 → 尝试 agent_mapping.fallback
        │           │              → 尝试 tier.fallback
        │           │              → 都不可用 → 根据 tier.retry_on_failure 决定
        │           │                            重试或降级处理
        │           │
        │           └── 记录调用到 token 预算追踪
        │                (model, tokens_in, tokens_out, cost, task, agent)
        │
        └── Token 预算追踪（llm_usage.jsonl）：
             {"timestamp":"...", "agent":"writer", "task":"scene_writing",
              "tier":"tier_1", "model":"deepseek-v4-pro",
              "tokens_in": 25000, "tokens_out": 4000, "cost": 0.082}
```

**v1.7 扩展方式（Planner 拆分为 4 个 Agent 时）：**

v1.7 中 Planner 的角色拆分为 Creative Director、Worldbuilder、Character Designer、Outliner 四个独立 Agent。只需在 `agent_mapping` 中替换 `planner` 为四个新条目，配置系统代码无需任何改动：

```yaml
# v1.7 追加（替代 v1.6 的 planner 条目）:
agent_mapping:
  creative_director:
    creative_brainstorming:       # 多轮创意讨论
      tier: tier_1
      model: default
    whatif_expansion:            # WhatIf 树节点发散
      tier: tier_1
      model: default
    novelty_evaluation:          # 新颖度评分（部分 LLM）
      tier: tier_2
      model: default

  worldbuilder:
    world_generation:            # 世界观构建
      tier: tier_1
      model: default

  character_designer:
    character_generation:        # 角色档案生成
      tier: tier_1
      model: default
    growth_curve_design:         # 成长曲线设计
      tier: tier_1
      model: default

  outliner:
    outline_generation:          # 大纲生成
      tier: tier_1
      model: default
    branch_simulation_llm:       # 分支模拟 LLM 推演部分
      tier: tier_2
      model: default
    foreshadowing_design:        # 伏笔映射表设计
      tier: tier_1
      model: default

  # ... writer / reviewer / storyos_agent / summary_archiver 保持不变
```

**Token 预算追踪增强：**

v1.6 的 token 预算追踪在 MVP 的基础上增加 `tier` 和 `model` 维度：

```jsonl
{"timestamp":"2026-06-10T14:30:00Z","agent":"writer","task":"scene_writing","tier":"tier_1","model":"deepseek-v4-pro","tokens_in":25000,"tokens_out":4000,"cost":0.082}
{"timestamp":"2026-06-10T14:32:00Z","agent":"reviewer","task":"narrative_guard","tier":"tier_2","model":"claude-sonnet-4","tokens_in":9000,"tokens_out":1500,"cost":0.0495}
{"timestamp":"2026-06-10T14:33:00Z","agent":"summary_archiver","task":"chapter_summary","tier":"tier_3","model":"claude-haiku","tokens_in":3500,"tokens_out":200,"cost":0.00113}
```

每次启动时汇总展示本次会话的模型使用分布和成本。按 Agent 维度、Tier 维度、Model 维度均可聚合查询。

#### F1.6.10 章节评审会

每章完成后 Reviewer 展示质量摘要并主动提问：

```
┌─────────────────────────────────────────┐
│  第 15 章评审                            │
│                                          │
│  连贯性评分：82 / 100                     │
│  追更欲：72（↑3）  疲劳度：38（↓5）       │
│                                          │
│  📋 本章叙事资产变动：                    │
│    新增冲突 1 项 / 升级冲突 1 项           │
│    谜团线索 +2 / 承诺兑现 1 项             │
│                                          │
│  ⚠️ Narrative Guard 建议：               │
│    林峰在第 3 幕的行为与其一贯风格有偏差    │
│                                          │
│  💡 讨论话题：                            │
│    1. 本章的反转力度是否足够？             │
│    2. 苏晓晓的态度转变是否铺垫充分？        │
│                                          │
│  [通过] [提出修改意见] [快速通过]          │
└─────────────────────────────────────────┘
```

### 4.3 v1.6 验收标准

| 编号 | 验收项 |
|---|---|
| AC-1 | 回退修改 STAGE 2 角色设定后，Conductor 正确识别受影响章节并生成分级报告 |
| AC-2 | L3 冷记忆语义检索在 5 万字的作品中，召回相关上下文的时间 < 2 秒 |
| AC-3 | 级联传播：Mystery revealed → Reveal revealed → Expectation fulfilled 自动执行 |
| AC-4 | 循环依赖被正确检测并中断，不会导致无限级联 |
| AC-5 | Narrative Guard 检测到角色行为显著变化但缺少 SF_LOG 标记时生成 warning |
| AC-6 | 成长曲线中 tp_001 绑定到第 26 章后，Writer 在第 26 章上下文收到正确的成长阶段提示 |
| AC-7 | Style Engine L3 禁忌约束正确拦截"无故虐主超过 300 字"并通知 Reviewer |
| AC-8 | 悬疑推理体裁项目的追更欲严重阈值自动设为 45，爽文项目自动设为 50 |
| AC-9 | Scene Writing 使用 Tier 1 模型（DeepSeek V4），Narrative Guard 使用 Tier 2 模型（Sonnet 4），L1 重提取使用 Tier 3 模型（Haiku）——全部由配置文件驱动，无硬编码 |
| AC-10 | 修改 `model_tiers.yaml` 将 Writer 的 `model` 从 `deepseek-v4-pro` 切换为 `claude-opus-4`，下一 Scene 写作立即生效 |
| AC-11 | Tier 1 主模型（DeepSeek）不可用时，Writer 自动降级到 fallback 模型（Claude Opus），Scene 写作不中断 |
| AC-12 | `llm_usage.jsonl` 按 Agent/Tier/Model 三维度正确记录每次调用，会话结束汇总展示 |
| AC-13 | 单章 token 消耗在预算范围内（~117.5K tokens） |

### 4.4 v1.6 到 v1.5 的变更总结

```
v1.5                             v1.6
────                             ────
线性前进，无回退                   支持回退影响传播
L0 + L1 + L2                     L0 + L1 + L2 + L3 + L4
无级联传播                         级联传播 + 冲突检测
无 Narrative Guard                Narrative Guard（Tier 2）
5 项 Fact Guard                  6 项 Fact Guard
角色静态档案                       成长曲线 + 剧情里程碑绑定
Style Engine L1                   Style Engine L1 + L2 + L3
追更欲 + 疲劳度                   全部 7 项指标 + 体裁差异化
单模型                             多模型 Tier 策略 + Agent LLM 配置系统（model_tiers.yaml）
无章节评审会                       章节评审会
```


## 五、v1.7 — 完整创意引擎

### 5.1 目标

从"辅助写作"升级到"辅助构思"。接入 CreativeOS 全部引擎，让作者从一句话的想法开始，系统化地发散出高新颖度的故事设定。创意画布和分支模拟引擎让作者在落笔之前就能探索和对比不同的叙事方向。

### 5.2 新增功能

#### F1.7.1 CreativeOS 全部引擎

**灵感种子库（Idea Pool）：**
- 项目级存储，灵感路由器（F1.7.7）自动捕捉
- 按类别组织：设定灵感 / 剧情想法 / 角色灵感 / 风格偏好 / 写作灵感
- 每条记录来源阶段、原始上下文、关联的故事元素

**套路模式库（Trope Pool）：**
- 内置网文常见套路及其市场饱和度数据
- 项目创建时从系统快照继承
- 在创意画布中影响 WhatIf 发散方向和新颖度评分

**套路变异器（Mutation Engine）：**
- 四种变异操作：逆转（Inversion）、融合（Fusion）、升维（Escalation）、打破（Subversion）
- 每次变异输出：核心设定、核心矛盾、新奇钩子、自洽性检查
- 使用 Tier 1 模型

**矛盾设定生成器（Contradiction Engine）：**
- 五个内置矛盾模板：能力×限制、永恒×消逝、身份×秘密、目标×代价、力量即弱点
- 生成核心矛盾的详细展开
- 使用 Tier 1 模型

**连续发散器（WhatIf Engine）：**
- 从核心前提出发递归发散
- 深度 3 层、广度 4 分支，最多 84 个衍生节点
- 约束：每个子节点必须是父节点的直接逻辑推论
- 使用 Tier 1 模型

**体裁融合器（Genre Fusion Engine）：**
- 在结构特征层面融合两个体裁
- 体裁兼容性矩阵内置，用户可扩展
- 体裁距离通过 BFS 计算，距离越远新颖度加成越大

**新颖度评估器（Novelty Evaluator）：**
- 四维评估：市场饱和度（30%）+ 套路相似度（25%）+ 矛盾深度（25%）+ 讨论潜力（20%）
- 市场饱和度：LLM 提取套路标签 → Trope Pool 匹配 → 计算
- 套路相似度：bge-m3 嵌入 → 向量余弦相似度
- 矛盾深度：正则匹配 5 种矛盾模板，加权评分
- 讨论潜力：关键词争议性评分 + 身份冲突评分 - 可预测性惩罚
- 综合判定：≥80 高新颖度 / ≥60 中等 / ≥40 偏低 / <40 建议更换

#### F1.7.2 创意画布交互探索

将 WhatIf 树可视化为可交互探索空间：

**用户操作：**
- **点击展开：** 展开某节点的子节点
- **偏好标记（♡）：** 标记感兴趣的节点，影响后续发散方向
- **剪枝（✂）：** 移除不感兴趣的分支
- **以节点为新根发散（⟳）：** 聚焦某个节点重新发散
- **手动添加节点（⊕）：** 用户直接输入创意想法
- **合并分支（⊞）：** 融合两个分支的优点

**实时反馈：**
- 每次操作后重新计算各节点的新颖度评分
- 高饱和度方向标注"[红海]"警告
- 低饱和度方向标注"[蓝海]"推荐
- 用户满意后选定路径 → 生成最终 Story DNA

#### F1.7.3 分支模拟引擎

在 STAGE 3 情节设计阶段，让用户安全地探索"如果我改了这个会怎样"：

**确定性计算（零 LLM）：**
- 受影响章号范围（遍历依赖闭包）
- 受影响角色列表（扫描角色引用）
- 受影响伏笔列表（结构对比）
- 成长曲线章节偏移

**LLM 推理（含置信度标注）：**
- 🟡 张力曲线变化趋势（中置信度）
- 🟡 伏笔断裂风险评估（中置信度）
- 🟠 替代方案建议（低置信度）
- 🟡 读者体验指标预估变化（中置信度）

结果展示明确标注确定性/LLM 推理边界，用户做决策时系统提醒置信度水平。

#### F1.7.4 语义完整性预检

在 Fact Guard 之前运行，检测 Writer 可能遗漏的 SF_LOG 标记（Tier 3 模型，建议性质不阻断）：

**预检范围：** 仅对 3 种高重要性事件类型：
- `twist_reveal` — 检测未标记的重大信息颠覆
- `registry_create` — 检测未标记的新叙事资产创建
- `character_relation_change` — 检测未标记的关系变化

**开销：** 单 Scene 约 500 tokens（Tier 3），全书 400 Scene 累计约 200K tokens（<$0.02）。

#### F1.7.5 风格沙盒

写作前用约 500 字测试文本预览不同风格参数组合的效果：
- 调整参数（句长、对白比例、描述密度）→ 即时看到渲染效果
- 可混合多版本参数
- 满意后保存为自定义风格配置

#### F1.7.6 创新豁免

Writer 可主动提交豁免申请：
- 声明突破的规则、创作意图、预期效果
- 用户审批通过后该 Scene 不受对应规则约束
- 效果优秀 → 提炼为新规则
- 效果不佳 → 标记为反例

#### F1.7.7 灵感路由器

在所有阶段的讨论中持续运行（Tier 3 模型）：

**自动分类：**
- 新设定灵感 → Idea Pool
- 新剧情想法 → StoryOS 暂存区
- 新角色灵感 → 角色设计建议
- 风格偏好 → Style Engine 偏好记录
- 写作灵感 → Scene 灵感池

**多分类冲突处理：**
- 高置信度（≥0.8）单一分类 → 直接归类
- 中置信度（0.5-0.8）→ 归类 + "待确认"标签
- 多分类置信度差距 > 0.3 → 归类到最高置信度
- 多分类置信度差距 ≤ 0.3 → 多标签"跨类"标记

**用户纠错：** 重新分类、拆分、合并、标记无效、编辑内容

#### F1.7.8 成长工坊（Growth Workshop）

将角色创建从"填写档案"升级为"协同设计成长曲线"：
- Character Designer 生成初始成长曲线方案
- 可视化：起点 → 转折点（绑定剧情事件类型）→ 低谷 → 终点
- 用户与 Agent 讨论：节奏是否合适、代价是否充分、与剧情高潮是否同步
- 修改后自动检查与剧情里程碑的一致性

#### F1.7.9 用户编辑辅助

用户在 `live` 模式下手动修改 Scene 文本后：
- 系统自动分析修改内容中隐含的叙事变化
- 向用户建议需要添加或调整的 SF_LOG 标记
- 确保手动改写也能被 StoryOS 正确追踪

### 5.3 v1.7 验收标准

| 编号 | 验收项 |
|---|---|
| AC-1 | 从一句话意图出发，WhatIf 树生成 ≥ 20 个有效衍生节点 |
| AC-2 | 创意画布中用户可完成完整的"发散→探索→偏好标记→剪枝→选定路径"流程 |
| AC-3 | 新颖度评估器对同一创意的多次评分误差 < 5 分（可复现性） |
| AC-4 | 分支模拟引擎正确区分确定性计算和 LLM 推理结果，置信度标注可见 |
| AC-5 | 语义预检检测到故意遗漏的 twist_reveal 标记，建议用户补充（不阻断） |
| AC-6 | 风格沙盒调整句长参数后，500 字测试文本即时反映变化 |
| AC-7 | 创新豁免审批通过后，Style Guard 不再对该 Scene 的豁免规则进行检测 |
| AC-8 | 灵感路由器从一次 10 轮讨论中正确捕捉 ≥ 3 条灵感并分类 |
| AC-9 | 成长工坊修改转折点后，自动检测到与剧情里程碑的矛盾并提示 |
| AC-10 | 用户手动修改 Scene 文本后，系统正确建议了需要添加的 SF_LOG 标记 |

### 5.4 v1.7 到 v1.6 的变更总结

```
v1.6                             v1.7
────                             ────
STAGE 1 单轮生成                  STAGE 1 多轮发散 + 创意画布
无 CreativeOS                    全部 7 个 CreativeOS 引擎
无分支模拟                         分支模拟引擎（确定性 + LLM 推理）
无语义预检                         语义完整性预检（Tier 3，建议性质）
无风格沙盒                         风格沙盒预览
无创新豁免                         创新豁免机制
无灵感路由器                       灵感路由器（自动捕捉 + 多分类 + 纠错）
无成长工坊                         成长工坊（可视化 + 一致性检查）
用户编辑后无辅助                    用户编辑后 SF_LOG 自动建议
```


## 六、v1.8 — 协作增强与跨作品复用

### 6.1 目标

让 StoryForge 从"写一部作品的工具"升级为"长期创作伙伴"。核心是降低后期大规模修改的成本（叙事重构）、保护作者的创作状态（疲劳感知）、以及让第二部作品不从零开始（跨作品资产复用）。

### 6.2 新增功能

#### F1.8.1 叙事重构模式

当用户在写作中后期提出全局性创意偏离时，批量处理而非逐条确认：

**触发条件：**
- 用户声明"我想要一个大的情节转向"
- 修改 STAGE 1-3 产出物且影响 ≥ 10 章
- 连续 3 章标记"此方向需要大幅调整前文"

**四步流程：**

**Step 1 — 意图声明：** 用户用自然语言描述偏离意图

**Step 2 — 全量影响推算：** Conductor 联合 StoryOS 和 Outliner：
- 直接影响：哪些产出物需要修改
- 章节影响：P0 必须重写 / P1 建议调整 / P2 兼容
- 叙事资产影响：哪些 Twist/Conflict/Mystery 需重新定义
- 预估工作量

**Step 3 — 批量执行：**
1. 更新受影响的产出物
2. 标记受影响章节状态（`pending_rewrite` / `pending_revision` / `compatible`）
3. P0 章节进入重写队列，注入"重构上下文"（新旧设定差异摘要）
4. P1 章节在评审会中附带"重构对齐检查"

**Step 4 — 重构追踪：** 生成 `restructuring_log.json`：
- 原始设定 vs 新设定的差异
- 受影响文件和章节清单
- 每项修改的完成状态
- STAGE 5 诊断时重点扫描重构区域

#### F1.8.2 协作疲劳感知

保护作者的创作状态，在检测到疲劳信号时温和提醒：

| 信号 | 判定条件 | 系统响应 |
|---|---|---|
| 快速连续跳过 | 连续 ≥ 10 个 Scene 选择"快速通过" | 提示切换到 auto 模式 |
| 长时间会话 | 单次会话 > 90 分钟 | 提示休息，自动保存 |
| 深夜模式 | 23:00-06:00 且连续操作 > 30 分钟 | 温和提醒保存休息 |
| 决策质量下降 | 连续 ≥ 5 个 Scene 快速通过后连贯性评分下降 > 5 分 | 建议切换到 review 模式 |

全部可配置关闭。

#### F1.8.3 Mid-Scene 草稿缓存

Scene 写作过程中也可能发生崩溃，草稿缓存提供更细粒度的恢复：

- Writer 每生成一幕文本后，立即写入 `.storyforge_draft_cache.json`
- 包含：已完成 beats、当前 beat、已嵌入日志数量
- 恢复时 Conductor 检测到未完成的 Scene 有草稿缓存 → 询问用户从草稿继续或重新开始
- 与 checkpoint 分离，Scene 完成后自动清除

#### F1.8.4 跨作品资产复用

写完一部作品后，积累的资产自动带到下一部：

**Global Trope Pool（用户级）：**
- 套路模式知识库，所有项目共享
- 市场饱和度数据：系统内置快照（随版本更新）+ 用户反馈标注
- 用户标注优先级高于系统快照

**Global Idea Pool（用户级）：**
- 跨项目灵感库
- 来源：项目灵感路由器捕捉、用户手动添加、项目完成后"提升"
- 新项目可从 Global Idea Pool 导入相关灵感

**风格模板共享：**
- 用户自定义风格配置保存为 `.style.yaml` 文件
- 新项目 INIT 阶段出现在"我的自定义模板"列表中

**SF_LOG 模式库：**
- 用户标记为"优秀"的 Scene → 其 SF_LOG 模式提取为参考模板
- 供新项目的 Writer 参考

**Contradiction Templates 共享：**
- 内置 5 个（系统级，随版本更新）
- 用户自定义存储到 `~/storyforge/global/contradiction_templates.json`，跨项目共享

**三级共享范围：**
- 用户私有（默认）
- 团队共享（协作场景）
- 公共匿名（社区贡献）

#### F1.8.5 STAGE 6 多格式导出

在 v1.5 的 .md 导出基础上增加：
- **PDF：** 排版成品，自动去除 SF_LOG 标记，可配置字体/行距/页边距
- **EPUB：** 电子书格式，支持目录导航、元数据嵌入、封面图

#### F1.8.6 重构区域专项诊断（STAGE 5 增强）

当项目存在 `restructuring_log.json` 时，STAGE 5 自动激活重构区域专项扫描：

1. **新旧设定残留检测：** 扫描重构章节中是否残留旧设定痕迹
2. **重构边界连贯性：** 检查 P0/P1 章节与 P2 兼容章节之间的叙事衔接
3. **叙事资产对齐验证：** 验证重构日志中的资产变更是否全部生效
4. **重构完整性检查：** 核验 completion_status 为 completed 的修改项是否确实已更新

### 6.3 v1.8 验收标准

| 编号 | 验收项 |
|---|---|
| AC-1 | 叙事重构影响分析正确覆盖所有受影响章节和叙事资产 |
| AC-2 | 重构执行后 STAGE 5 专项诊断正确检测到 1 处新旧设定残留 |
| AC-3 | 连续快速通过 10 个 Scene 后系统正确提示切换模式 |
| AC-4 | Scene 写作中崩溃后，重启时系统正确检测到草稿缓存并提供恢复选项 |
| AC-5 | 完成第一部作品后，Global Trope Pool 和 Global Idea Pool 正确保存可复用数据 |
| AC-6 | 第二部作品的 INIT 阶段可选择第一部保存的自定义风格模板 |
| AC-7 | STAGE 6 成功导出 PDF 和 EPUB 格式 |
| AC-8 | 所有疲劳感知检测可在配置中关闭 |

### 6.4 v1.8 到 v1.7 的变更总结

```
v1.7                             v1.8
────                             ────
后期偏离需逐条确认                 叙事重构模式（批量处理）
无疲劳感知                         协作疲劳感知（4 种信号）
Scene 粒度断点续写                 + Mid-Scene 草稿缓存
项目间数据隔离                     跨作品资产复用
.md 导出                          多格式导出（.md + PDF + EPUB）
STAGE 5 常规诊断                   + 重构区域专项诊断
```


## 七、版本依赖关系图

```
                    v1.4-mvp
                       │
                       ▼
                      v1.5
                       │
                       ▼
                      v1.6
                       │
                       ▼
                      v1.7
                       │
                       ▼
                      v1.8
```

所有版本为严格线性依赖，每个版本必须在上一个版本验收通过后才能开始。

### 关键依赖说明

| 依赖关系 | 原因 |
|---|---|
| v1.6 依赖 v1.5 的多章能力 | 级联传播、L3 检索、ReaderOS 全部指标都需要多章数据才有意义 |
| v1.7 依赖 v1.6 的完整叙事引擎 | 创意画布和分支模拟需要完整的 StoryOS 注册表支撑 |
| v1.8 依赖 v1.7 的创意引擎 | 跨作品复用的 Trope Pool 和 Idea Pool 依赖 CreativeOS 引擎产出 |


## 八、各版本功能矩阵总览

| 功能 | MVP | v1.5 | v1.6 | v1.7 | v1.8 |
|---|---|---|---|---|---|
| **写作能力** | | | | | |
| 单章写作 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 多章连续写作 | | ✓ | ✓ | ✓ | ✓ |
| 章间状态传递 | | ✓ | ✓ | ✓ | ✓ |
| Mid-Scene 崩溃恢复 | | | | | ✓ |
| **Conductor** | | | | | |
| 阶段状态机（线性） | ✓ | ✓ | ✓ | ✓ | ✓ |
| 熔断降级 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scene 级断点续写 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 回退影响传播 | | | ✓ | ✓ | ✓ |
| 叙事重构编排 | | | | | ✓ |
| **StoryOS** | | | | | |
| 4 类叙事资产 | ✓ | | | | |
| 7 类叙事资产 | | ✓ | ✓ | ✓ | ✓ |
| 级联传播 + 冲突检测 | | | ✓ | ✓ | ✓ |
| **SF_LOG** | | | | | |
| 7 种标记类型 | ✓ | | | | |
| 11 种标记类型 | | ✓ | ✓ | ✓ | ✓ |
| 语义完整性预检 | | | | ✓ | ✓ |
| **一致性保障** | | | | | |
| Fact Guard 5 项 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fact Guard 第 6 项 | | | ✓ | ✓ | ✓ |
| Narrative Guard | | | ✓ | ✓ | ✓ |
| Style Guard | | | ✓ | ✓ | ✓ |
| 连贯性评分（简化版） | ✓ | ✓ | | | |
| 连贯性评分（完整版） | | | ✓ | ✓ | ✓ |
| **MemoryOS** | | | | | |
| L0 + L1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| L2（温记忆） | | ✓ | ✓ | ✓ | ✓ |
| L3（冷记忆·矢量检索） | | | ✓ | ✓ | ✓ |
| L4（叙事记忆） | | | ✓ | ✓ | ✓ |
| **ReaderOS** | | | | | |
| 无 | ✓ | | | | |
| 2 项指标（追更欲 + 疲劳度） | | ✓ | | | |
| 7 项指标 + 体裁差异化 | | | ✓ | ✓ | ✓ |
| **CreativeOS** | | | | | |
| 无（STAGE 1 单轮生成） | ✓ | ✓ | ✓ | | |
| 全部 7 个引擎 | | | | ✓ | ✓ |
| 创意画布交互 | | | | ✓ | ✓ |
| 分支模拟引擎 | | | | ✓ | ✓ |
| **Style Engine** | | | | | |
| L1（单体裁模板） | ✓ | ✓ | ✓ | ✓ | ✓ |
| L2 + L3 | | | ✓ | ✓ | ✓ |
| 风格提炼 | | ✓ | ✓ | ✓ | ✓ |
| 风格沙盒 | | | | ✓ | ✓ |
| 创新豁免 | | | | ✓ | ✓ |
| **协作体验** | | | | | |
| 章节评审会 | | | ✓ | ✓ | ✓ |
| 灵感路由器 | | | | ✓ | ✓ |
| 成长工坊 | | | | ✓ | ✓ |
| 用户编辑辅助 | | | | ✓ | ✓ |
| 协作疲劳感知 | | | | | ✓ |
| 叙事重构模式 | | | | | ✓ |
| **跨作品复用** | | | | | |
| Global Trope/Idea Pool | | | | | ✓ |
| 风格/体裁模板共享 | | | | | ✓ |
| SF_LOG 模式库 | | | | | ✓ |
| Contradiction 模板共享 | | | | | ✓ |
| **导出** | | | | | |
| 无 | ✓ | | | | |
| .md 导出 | | ✓ | ✓ | ✓ | ✓ |
| PDF + EPUB 导出 | | | | | ✓ |
| **模型策略** | | | | | |
| 单模型 | ✓ | ✓ | | | |
| 多模型 Tier 策略 | | | ✓ | ✓ | ✓ |
| Agent LLM 配置系统（model_tiers.yaml） | | | ✓ | ✓ | ✓ |
| Token 预算追踪（按 Agent/Tier/Model） | | | ✓ | ✓ | ✓ |
| **STAGE 覆盖** | | | | | |
| INIT | ✓ | ✓ | ✓ | ✓ | ✓ |
| STAGE 1（概念） | ✓（简化） | ✓（简化） | ✓（简化） | ✓（完整） | ✓（完整） |
| STAGE 2（世界观+角色） | ✓（简化） | ✓（多角色） | ✓（+成长曲线） | ✓（+成长工坊） | ✓ |
| STAGE 3（情节） | ✓（简化） | ✓ | ✓（+分支模拟） | ✓（+创意画布） | ✓ |
| STAGE 4（写作） | ✓（核心） | ✓（多章） | ✓（完整） | ✓ | ✓ |
| STAGE 5（诊断） | | ✓（基础） | ✓ | ✓ | ✓（+重构专项） |
| STAGE 6（导出） | | ✓（.md） | ✓ | ✓ | ✓（+.pdf+.epub） |


## 九、Token 预算演变

| 版本 | 单章 token 消耗 | 主要增量来源 |
|---|---|---|
| v1.4-mvp | ~34K | Scene 写作（3 × 8K）+ STAGE 1-3 生成（10K） |
| v1.5 | ~50K | + Summary Archiver 章摘要 + 多角色上下文 + ReaderOS（零 LLM） |
| v1.6 | ~117.5K | + Narrative Guard（3 × 9K）+ L1 重提取 + L3 检索嵌入 |
| v1.7 | ~130K | + 语义预检（3 × 0.5K）+ 灵感路由器（摊销） |
| v1.8 | ~130K | 与 v1.7 基本持平（协作增强功能主要在确定性层面） |


## 十、风险与缓解

| 风险 | 影响版本 | 缓解措施 |
|---|---|---|
| L3 冷记忆的 Qdrant + bge-m3 部署复杂度超预期 | v1.6 | 可先用简单的本地 JSON + TF-IDF 替代，v1.7 再升级到完整方案 |
| 多模型 Tier 策略的成本控制 | v1.6 | 默认使用 Tier 2 模型写 Scene，Tier 1 仅用于关键创意节点 |
| CreativeOS WhatIf 树节点爆炸（84 节点 × 每节点 LLM 调用） | v1.7 | 非关键节点使用 Tier 3 轻量生成 + 用户主动剪枝限制探索范围 |
| 叙事重构模式的全量推算准确性 | v1.8 | 影响分析中的"受影响章号范围"为确定性计算（可靠），LLM 推演部分标注置信度 |
| 跨作品复用的数据隐私 | v1.8 | 全部用户数据存储在本地 `~/storyforge/`，公共匿名共享为可选 opt-in |


## 十一、里程碑与交付物

| 版本 | 预计完成 | 关键交付物 | 阶段门控 |
|---|---|---|---|
| **v1.4-mvp** | 当前 | 1 章端到端可运行代码 | AC-1 ~ AC-10 全部通过 |
| **v1.5** | MVP + 6 周 | 20 章作品可量产 | 连续 20 章无人工干预通过 Fact Guard |
| **v1.6** | v1.5 + 8 周 | 完整叙事引擎 | 100 章作品通过 STAGE 5 诊断，P0 问题 = 0 |
| **v1.7** | v1.6 + 10 周 | 完整创意引擎 | 从一句话生成 Story DNA，新颖度评分 ≥ 75 |
| **v1.8** | v1.7 + 6 周 | 完整产品 | 写完第一部作品后，第二部 INIT 时间 < 第一部 INIT 时间的 50% |
