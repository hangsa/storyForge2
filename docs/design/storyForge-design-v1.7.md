# StoryForge v1.7 — 产品设计需求文档

> v1.7 目标：从"辅助写作"升级到"辅助构思"，接入 CreativeOS 全部创意引擎，让 StoryForge 成为作者的创意伙伴。


## 一、版本定位

### 1.1 从 v1.6 到 v1.7

```
v1.6                              v1.7
────                              ────
STAGE 1 单轮 LLM 生成              STAGE 1 多轮发散 + 创意画布交互探索
无 CreativeOS                     全部 7 个 CreativeOS 引擎
无分支模拟                         分支模拟引擎（确定性 + LLM 推理，置信度标注）
无语义预检                         语义完整性预检（Tier 3，建议性质，不阻断）
无风格沙盒                         风格沙盒预览（调整参数即时渲染）
无创新豁免                         创新豁免机制（Writer 申请 → 用户审批）
无灵感路由器                       灵感路由器（全阶段自动捕捉 + 多分类 + 用户纠错）
角色静态创建                        成长工坊（可视化成长曲线协同设计 + 自动一致性检查）
用户编辑后无辅助                    用户编辑辅助（SF_LOG 自动建议）
```

### 1.2 核心目标

| 目标 | 说明 |
|---|---|
| **创意广度** | 从一句话的念头系统化发散出高新颖度的完整故事设定，辅助作者从 0 到 1 构思 |
| **方向探索** | 分支模拟引擎让作者在落笔前安全探索和对比不同的叙事方向，降低"写废"风险 |
| **创新辅助** | 创意画布实时标注 [红海]/[蓝海] 方向，新颖度评估器从 4 个维度量化创意质量 |
| **质量控制前置** | 语义预检在 Scene 写作完成后、Fact Guard 之前先行检测遗漏的 SF_LOG 标记 |
| **风格探索** | 风格沙盒让作者在写作前预览不同风格参数组合的效果，降低风格选型成本 |
| **灵感管理** | 灵感路由器在全部阶段持续运行，自动捕捉、分类、存储灵感，避免遗忘 |

### 1.3 版本定位

v1.7 是"创意引擎完整化"版本。v1.5 解决了"能不能写"（多章量产），v1.6 解决了"写得好不好"（叙事质量），v1.7 解决"构思从哪来"（创意辅助）。

v1.7 的核心升级是 **STAGE 1 的重构**：从 v1.6 的"用户填写表单 → LLM 单轮生成 Story DNA"升级为"用户输入一句话意图 → 多轮发散探索 → 创意画布可视化交互 → 选定路径生成 Story DNA"。这是 v1.7 工作量最大的部分。

不引入协作疲劳感知、叙事重构模式、跨作品资产复用——这些是 v1.8 的范围。


## 二、v1.6 基线状态

### 2.1 已实现模块（v1.7 的起点）

| 模块 | 关键文件 | v1.6 状态 |
|---|---|---|
| **LLM Provider** | `anthropic_provider.py` `deepseek_provider.py` `minimax_provider.py` | 三 Provider + 工厂模式 |
| **ModelRouter** | `model_router.py` | Agent → Task → Tier → Model 四级路由，配置文件驱动 |
| **Conductor** | `state_machine.py` `circuit_breaker.py` `checkpoint.py` `impact_analyzer.py` | 8 阶段 FSM + 熔断 + 断点续写 + 回退影响传播（SHA256 + SF_LOG 扫描） |
| **Agents** | `planner.py` `writer.py` `reviewer.py` `storyos_agent.py` `summary_archiver.py` | 5 Agent 完整 |
| **MemoryOS** | `l0_runtime.py` `l1_hot.py` `l2_warm.py` `l3_cold.py`+`l3_bm25.py`+`l3_chunker.py` `l4_narrative.py` `memory_coordinator.py` | 五层记忆完整：L0(~500 tokens) + L1(近 5 章) + L2(章摘要+关系图+时间轴) + L3(Qdrant+BM25 混合检索) + L4(叙事资产摘要，~3K tokens) |
| **StoryOS** | `registries.py` `registry_transaction.py` | 7+1 类注册表(Mystery/Twist/Reveal/Conflict/Goal/Promise/Expectation/Foreshadowing) + 级联传播(BFS)+ 冲突检测(循环依赖/禁止状态转换/互斥冲突)+ 原子提交+ 回滚 |
| **Scene Engine** | `schema.py` `beat_patterns.py` | Schema 2.0 + beat 模式 + SF_LOG 11 种标记类型 |
| **Style Engine** | `genre_template.py` `style_extractor.py` `writing_formulas.py` `taboo_constraints.py` | L1(体裁模板)+ L2(写作公式)+ L3(禁忌约束) 三层完整 |
| **ReaderOS** | `calculator.py` `thresholds.py` | 7 项指标(好奇心/张力/满足感/挫败感/疲劳度/追更欲/讨论潜力)+ 体裁差异化阈值 YAML 驱动 |
| **Growth Curve** | `auto_generator.py` `binder.py` `context.py` | 自动生成(确定性)+ 大纲绑定 + 写作上下文注入 |
| **API Routes** | 11 个路由文件（conductor/project/settings_api/stage1-6/storyos/style_extractor） | STAGE INIT/1/2/3/4/5/6 完整 + 项目 CRUD + StoryOS 查询 + 控制面板 + Settings CRUD |
| **Pydantic Models** | 9 个模型文件 | project/world/character/storyos/sf_log/outline/progress/checkpoint/impact_report |
| **Prompts** | 7 个 YAML | concept/world/character/outline/scene_writing/scene_rewrite/chapter_summary |
| **Frontend** | 13 页面 + 组件 + hooks | React 18 + Vite + Tailwind，INIT → STAGE 1-6 全页面 + 项目管理 + StoryOS 仪表盘 + 章节评审 + Settings + 影响分析 + 风格沙盒占位 |
| **Tests** | 522 用例 | unit + integration，关键路径全覆盖 |
| **Config** | `model_tiers.yaml` `genre_thresholds.yaml` | Tier 定义 + Agent 映射 + 体裁阈值 YAML 驱动 |

### 2.2 v1.6 限制（v1.7 要解决）

| 限制 | 影响 |
|---|---|
| STAGE 1 仅单轮生成 | 概念生成是一次性的 LLM 调用，用户无法探索多个方向、对比优劣、迭代细化 |
| 无创意引擎 | 没有 Idea Pool、Trope Pool、Mutation Engine 等创意辅助工具，概念质量完全依赖 Planner 的单次 Prompt |
| 无分支模拟 | 用户无法预览"如果改成 X 会怎样"，修改设定的决策缺乏数据支撑 |
| 无语义预检 | Writer 可能遗漏 SF_LOG 标记，Fact Guard 的第 5 项（required_logs）只能检测声明了但未标记的情况，无法检测应该标记但未声明的遗漏 |
| 无风格沙盒 | 风格参数调整后只能在正式写作中看到效果，试错成本高 |
| 无创新豁免 | Writer 无法主动突破规则约束，创意自由度受限 |
| 无灵感管理 | 用户在讨论中产生的灵感一闪而过，没有系统化的捕捉和整理机制 |
| 角色创建为表单式 | 成长曲线虽然是自动生成的，但用户与 Agent 的角色设计交互仍是表单填写，缺乏深度讨论 |
| 用户编辑无辅助 | 用户手动修改 Scene 文本后，SF_LOG 标记不更新，导致 StoryOS 状态与实际文本脱节 |


## 三、新增功能详设

### F1.7.1 CreativeOS 全部引擎

**目标：** 建立完整的创意辅助引擎体系，让系统具备从零构思一个高新颖度故事的能力。

**模块结构：**

```
backend/creative_os/
├── __init__.py
├── idea_pool.py              # 灵感种子库
├── trope_pool.py             # 套路模式库
├── mutation_engine.py        # 套路变异器（4 种操作）
├── contradiction_engine.py   # 矛盾设定生成器（5 个模板）
├── whatif_engine.py          # 连续发散器（递归树，深度=3 广度=4）
├── genre_fusion_engine.py    # 体裁融合器（BFS 体裁距离）
└── novelty_evaluator.py      # 新颖度评估器（4 维评分）
```

#### F1.7.1.1 灵感种子库（Idea Pool）

**存储位置：** `<project_dir>/creative_os/idea_pool.json`

**数据结构：**
```json
{
  "ideas": [
    {
      "id": "idea_001",
      "content": "主角的能力来源于对他人记忆的吞噬",
      "category": "设定灵感",
      "source_stage": "STAGE_1",
      "source_context": "WhatIf 发散节点 #14",
      "related_elements": ["power_system", "character_林峰"],
      "confidence": 0.85,
      "status": "active",
      "created_at": "2026-07-01T10:00:00Z"
    }
  ]
}
```

**类别体系：**
| 类别 | 说明 | 来源 |
|---|---|---|
| 设定灵感 | 世界观、力量体系、世界观规则 | STAGE 1/2 讨论、灵感路由器 |
| 剧情想法 | 具体情节点、转折、冲突构思 | STAGE 3 讨论、分支模拟 |
| 角色灵感 | 角色设定、关系、成长方向 | STAGE 2 讨论、成长工坊 |
| 风格偏好 | 写作风格、句式偏好、节奏取向 | Style Extractor、风格沙盒 |
| 写作灵感 | 具体场景的写法灵感 | STAGE 4 讨论、用户编辑 |

**操作：**
- 灵感路由器（F1.7.7）自动捕捉并分类
- 用户可手动添加、编辑、删除、提升（标记为高优先级）
- 新建项目时可从 Global Idea Pool（跨项目灵感库，v1.8 实现）导入
- 支持按类别、来源阶段、关联元素筛选

#### F1.7.1.2 套路模式库（Trope Pool）

**存储位置：** `<project_dir>/creative_os/trope_pool.json`

**初始数据来源：** `config/trope_catalog.yaml` — 内置网文常见套路及市场饱和度基线数据。初始版本计划覆盖 **50+ 套路模板**，涵盖以下类别：主角成长（12 个）、世界观设定（10 个）、感情线（8 个）、反派设定（7 个）、情节结构（8 个）、爽点类型（10 个）。市场饱和度数据基于网文市场公开数据分析（各平台热门榜单 + 关键词搜索量），随系统版本更新。首次使用时从 YAML 快照加载到项目级 `trope_pool.json`。

**数据结构：**
```json
{
  "tropes": [
    {
      "id": "trope_001",
      "name": "废柴逆袭",
      "category": "主角成长",
      "description": "主角起点极低，通过机缘和努力逐步崛起",
      "market_saturation": 0.82,
      "sub_tropes": ["被退婚后觉醒了", "重生回到悲剧发生前"],
      "common_combinations": ["trope_015", "trope_023"],
      "novelty_penalty_weight": 1.0
    }
  ]
}
```

**市场饱和度更新机制：**
- 项目创建时从 `config/trope_catalog.yaml` 系统快照继承
- 用户可在设置中标注"这个套路最近很火"或"这个套路已经过时"，影响饱和度权重
- 跨项目共享（v1.8）前保持项目级隔离

**在新颖度评估中的作用：**
- 套路提取：LLM 从创意描述中提取套路标签
- 饱和度查询：在 Trope Pool 中匹配标签 → 获得 market_saturation 值
- 饱和度得分：`score = (1 - avg_saturation_of_matched_tropes) × 100`

#### F1.7.1.3 套路变异器（Mutation Engine）

**四种变异操作：**

| 操作 | 说明 | 示例 |
|---|---|---|
| **Inversion（逆转）** | 将套路的核心前提翻转 | "废柴逆袭"→"天才陨落"——主角起点极高但因某个决定失去一切 |
| **Fusion（融合）** | 将两个不同类别的套路合并 | "废柴逆袭"+"身份之谜"→ 主角的废柴身份是刻意安排的伪装 |
| **Escalation（升维）** | 将套路的规模或后果提升一个级别 | "退婚流"→ 退婚的背后涉及世界存亡的赌局 |
| **Subversion（打破）** | 颠覆读者对套路的预期 | 读者以为主角要逆袭了 → 但逆袭成功后才发现这一切是更大的陷阱 |

**输出结构：**
```json
{
  "operation": "inversion",
  "source_trope": "trope_001",
  "result": {
    "core_premise": "曾经站在巅峰的天才因触碰禁忌知识被剥夺全部力量...",
    "core_conflict": "在失去力量的世界中重新定义'强大'的含义",
    "novelty_hook": "主角的'废'不是能力不足，而是力量被刻意封印——解开封印的代价是...",
    "self_consistency_check": "世界观需要设定'力量封印'机制；主角的成长不再是修炼而是'解封'，每解封一层都面临道德抉择"
  }
}
```

**LLM 配置：** Tier 1 模型（Claude Opus 4 / DeepSeek V4），每次变异约 2K tokens 输入 + 0.5K tokens 输出。

**调用时机：** 创意画布中用户对节点执行变异操作时触发。

#### F1.7.1.4 矛盾设定生成器（Contradiction Engine）

**五个内置矛盾模板：**

| 模板 | 矛盾结构 | 说明 |
|---|---|---|
| **能力×限制** | 主角拥有强大的能力，但使用它的代价或限制同样强大 | 能力越强，限制越大——形成"使用能力的每一刻都在做选择"的张力 |
| **永恒×消逝** | 追求永恒与接受消逝之间的冲突 | 长生种面对有限生命时的存在主义困境 |
| **身份×秘密** | 表面身份与隐藏真相之间的张力 | 双重身份或多重身份，每个身份都有自己的关系网络和承诺 |
| **目标×代价** | 达成目标必须付出的代价与目标本身的价值之间的矛盾 | "拯救世界需要牺牲所爱之人——还值得吗" |
| **力量即弱点** | 角色最大的力量同时也是其最大的弱点 | 读心术让主角洞察一切，但也让ta无法信任任何人 |

**输出结构：**
```json
{
  "template": "能力×限制",
  "expansion": {
    "ability_description": "...",
    "constraint_description": "...",
    "core_tension": "...",
    "character_implications": ["..."],
    "plot_implications": ["..."],
    "thematic_depth": "..."
  }
}
```

**评分机制（用于新颖度评估器的矛盾深度维度）：**
- 单一模板匹配：基础分 60
- 双模板交叉（如"身份×秘密"+"力量即弱点"）：基础分 80，1.3× 加成
- 三模板交叉：基础分 95，1.5× 加成
- 额外关键词加分：不可逆后果 (+5)、道德灰色地带 (+5)、反直觉设计 (+8)

**LLM 配置：** Tier 1 模型，每次展开约 2K tokens 输入 + 0.8K tokens 输出。

#### F1.7.1.5 连续发散器（WhatIf Engine）

**算法：** 从核心前提出发，递归构建发散树。

**参数：**
- 深度（depth）：3 层
- 广度（breadth）：每节点 4 个子节点
- 最大节点数：1（根）+ 4 + 16 + 64 = 84 个节点

**约束规则：**
1. 每个子节点必须是父节点的直接逻辑推论（不可跳跃）
2. 子节点之间应覆盖不同的叙事维度（角色动机 / 世界观规则 / 情节方向 / 读者体验）
3. 叶子节点（第 3 层）聚焦在"可写的场景钩子"——足够具体让 Writer 直接使用
4. 每个节点的生成 Prompt 注入当前路径的上下文摘要（父节点 + 祖父节点）

**节点数据结构：**
```json
{
  "id": "wi_003_02",
  "depth": 2,
  "parent_id": "wi_001_01",
  "content": "如果在废土世界中，主角发现避难所的能源即将耗尽...",
  "dimension": "情节方向",
  "novelty_score": 72,
  "trope_tags": ["废土生存", "资源危机"],
  "saturation_warning": null
}
```

**Token 估算：**
- 每个节点的 LLM 生成约 1K tokens 输入 + 0.3K tokens 输出
- 84 节点全量生成：~110K tokens
- 用户通常不会展开全部 84 节点（懒惰加载），实际消耗远小于此

**LLM 配置：**
- 用户主动展开的节点：Tier 1（质量优先）
- 自动预计算的叶子节点：Tier 3（成本控制），用户展开时再升级为 Tier 1 重生成

#### F1.7.1.6 体裁融合器（Genre Fusion Engine）

**算法流程：**
1. 确定源体裁和目标体裁
2. 在体裁兼容性矩阵中查询兼容度
3. 通过 BFS 计算体裁距离（在体裁关系图中）
4. 分析两个体裁在结构特征层面的融合点：叙事节奏、角色原型、冲突类型、世界观规则、情感曲线
5. 生成融合方案

**体裁兼容性矩阵（内置，用户可扩展）：**

| | 爽文 | 严肃文学 | 悬疑推理 | 科幻 | 奇幻 | 武侠 | 都市 |
|---|---|---|---|---|---|---|---|
| **爽文** | - | 中 | 高 | 高 | 高 | 高 | 高 |
| **严肃文学** | 中 | - | 中 | 高 | 中 | 低 | 高 |
| **悬疑推理** | 高 | 中 | - | 高 | 中 | 中 | 高 |
| **科幻** | 高 | 高 | 高 | - | 高 | 低 | 中 |
| **奇幻** | 高 | 中 | 中 | 高 | - | 高 | 低 |
| **武侠** | 高 | 低 | 中 | 低 | 高 | - | 低 |
| **都市** | 高 | 高 | 高 | 中 | 低 | 低 | - |

**体裁距离加成：** BFS 距离 ≥ 3 时，新颖度评估器的市场饱和度得分获得 1.2× 加成。

**LLM 配置：** Tier 1 模型，每次融合分析约 3K tokens 输入 + 1K tokens 输出。

#### F1.7.1.7 新颖度评估器（Novelty Evaluator）

**四维评估体系：**

| 维度 | 权重 | 计算方式 | LLM 调用 |
|---|---|---|---|
| **市场饱和度** | 30% | LLM 提取套路标签 → Trope Pool 匹配 → 计算 `(1 - avg_saturation) × 100` | Tier 3（标签提取） |
| **套路相似度** | 25% | bge-m3 嵌入 → Trope Pool 向量索引余弦相似度 → `(1 - max_similarity) × 100` | 零 LLM |
| **矛盾深度** | 25% | 正则匹配 5 种矛盾模板，加权评分（单模板 60 / 双模板交叉 80×1.3 / 三模板 95×1.5）+ 额外关键词加分 | 零 LLM |
| **讨论潜力** | 20% | 关键词争议性评分 + 身份冲突评分 - 可预测性惩罚 | 零 LLM |

**讨论潜力子维度计算细节：**
```
争议性评分 = Σ(争议关键词权重) / 关键词总数 × 100
  争议关键词：道德困境(8)、身份政治(7)、存在主义(6)、宿命论(6)、牺牲(5)、背叛(4)
身份冲突评分：
  - 双身份冲突：50 分
  - 多身份冲突：75 分
  - 身份不可调和：100 分
可预测性惩罚：
  - 套路组合常见度过高：-15
  - 反转设置过于线性：-10
  - 结尾暗示过于明确：-5
讨论潜力 = min(100, 争议性评分 × 0.6 + 身份冲突评分 × 0.4 - 可预测性惩罚)
```

**综合判定：**
| 分数 | 等级 | 建议 |
|---|---|---|
| ≥ 80 | 🟢 高新颖度 | 推荐选定，预期市场差异化明显 |
| 60-79 | 🟡 中等 | 可用，建议通过变异器微调提升 |
| 40-59 | 🟠 偏低 | 建议尝试变异或换方向 |
| < 40 | 🔴 低 | 强烈建议更换核心设定方向 |

**可复现性保证：**
- 市场饱和度：同一套路的 saturation 值在 Trope Pool 中固定（不含时间衰减时），多次评分一致
- 套路相似度：同一嵌入向量 + 同一向量库 → 余弦相似度固定
- 矛盾深度：正则匹配确定性计算，多次评分一致
- 讨论潜力：关键词匹配确定性计算
- LLM 参与的标签提取（Tier 3）存在微小波动，但权重低（30%），且标签提取本身是低温度（temperature=0.3）操作

**评分波动范围：** < ±5 分。

### F1.7.2 创意画布交互探索

**目标：** 将 WhatIf 树可视化为可交互的创意探索空间，让作者在 STAGE 1 完成"发散→探索→标记→剪枝→选定路径→生成 Story DNA"的完整流程。

**前端页面：** `frontend/src/pages/CreativeCanvasPage.tsx`（新建）

**画布布局：**
```
┌──────────────────────────────────────────────────────┐
│  创意画布 — 「当废柴主角发现ta的弱小是一种封印」       │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ 根节点       │  │ 子节点 1.1  │  │ 孙节点 1.1.1│   │
│  │ 废柴逆袭    │→│ 能力源于   │→│ 解封第一层  │   │
│  │ 🟡 72分     │  │ 封印的记忆 │  │ 发现真相    │   │
│  │ [♡] [✂]   │  │ 🟢 85分    │  │ 🟢 88分     │   │
│  └─────────────┘  │ [♡] [⟳]  │  │ [♡] [⊕]   │   │
│                    └─────────────┘  └─────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ [⊕ 手动添加] │  │ 子节点 1.2  │  │ 孙节点 1.2.1│   │
│  │              │  │ 能力代价是 │→│ 每次使用    │   │
│  │              │  │ 失去记忆    │  │ 忘记一个人  │   │
│  │              │  │ 🟡 68分     │  │ 🟠 55分     │   │
│  └─────────────┘  │ [♡] [✂]   │  │ [✂]        │   │
│                    └─────────────┘  └─────────────┘   │
│                                                       │
│  📊 选定路径新颖度趋势：72 → 85 → 88（上升 ✓）        │
│  ⚠️ 节点 1.3 套路饱和度较高 [红海]                    │
│  💡 建议：尝试对节点 1.2 执行 Inversion 变异           │
│                                                       │
│  [选定当前路径 → 生成 Story DNA]  [导出画布]  [重置]  │
└──────────────────────────────────────────────────────┘
```

**用户操作清单：**

| 操作 | 触发方式 | 行为 |
|---|---|---|
| **点击展开** | 点击节点 | 展开该节点的 4 个子节点（懒惰加载），调用 WhatIf Engine 生成 |
| **偏好标记（♡）** | 点击 ♡ 图标 | 标记感兴趣的节点，该标记影响后续发散方向（子节点生成 Prompt 中强调偏好倾向） |
| **剪枝（✂）** | 点击 ✂ 图标 | 隐藏该分支（可恢复），已隐藏分支的子节点不再自动生成 |
| **以节点为新根发散（⟳）** | 点击 ⟳ 图标 | 将当前节点作为新的根节点，清空其他分支，重新发散 3 层 |
| **手动添加节点（⊕）** | 点击 ⊕ 图标 | 弹出输入框，用户直接输入创意想法，系统自动为其生成子节点 |
| **合并分支（⊞）** | 选择两个节点后点击 ⊞ | 调用 Mutation Engine 的 Fusion 操作，融合两个分支的优点生成新节点 |
| **变异节点** | 右键节点 → 选择变异操作 | 调用 Mutation Engine 对当前节点执行 Inversion/Fusion/Escalation/Subversion |

**实时反馈：**
- 每次操作后自动重新计算各节点的新颖度评分
- 高饱和度节点标注 🔴 [红海] 警告
- 低饱和度高新颖度节点标注 🟢 [蓝海] 推荐
- 选定路径后显示路径新颖度趋势折线图
- 用户满意后点击"选定路径 → 生成 Story DNA"，系统将路径上所有节点的内容序列化为完整的 Story DNA JSON

**后端 API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/creative/canvas/expand` | POST | 展开某节点的子节点（调用 WhatIf Engine） |
| `/api/v1/projects/{id}/creative/canvas/mutate` | POST | 对节点执行变异操作（调用 Mutation Engine） |
| `/api/v1/projects/{id}/creative/canvas/merge` | POST | 融合两个分支（调用 Mutation Engine Fusion） |
| `/api/v1/projects/{id}/creative/canvas/evaluate` | POST | 重新评估某节点的新颖度（调用 Novelty Evaluator） |
| `/api/v1/projects/{id}/creative/canvas/select` | POST | 选定路径 → 序列化为 Story DNA |
| `/api/v1/projects/{id}/creative/canvas/state` | GET | 获取当前画布完整状态（含所有已展开节点） |

### F1.7.3 分支模拟引擎

**目标：** 在 STAGE 3 情节设计阶段，让用户安全地探索"如果我改了这个会怎样"，在做出实际修改决策前预览影响。

**触发入口：** STAGE 3 页面新增"模拟分支"按钮，用户在 outline 中选择一个分支点（如"如果第 15 章的反派不是 A 而是 B 会怎样？"）后启动模拟。

**两阶段分析：**

#### 阶段一：确定性计算（零 LLM，即时）

| 分析项 | 计算方式 | 输出示例 |
|---|---|---|
| 受影响章号范围 | 遍历 outline.json 中章节依赖闭包 | "第 12-18 章受影响（共 7 章）" |
| 受影响角色列表 | 扫描章节中提及的角色 | "林峰、苏晓晓、反派 B（新增）" |
| 受影响伏笔列表 | 结构对比 foreshadowing 注册表中的 `related_chapter` | "伏笔 fs_003 的揭示章节从 15 变为 16" |
| 成长曲线章节偏移 | 计算角色 `growth_curve.stages[].chapter_number` 的变化 | "林峰的'觉醒'转折点从第 15 章偏移到第 17 章" |

**实现：**
- 复用 ImpactAnalyzer 的 SHA256 hash diff 和 SF_LOG 扫描能力
- 扩展 ImpactAnalyzer 增加 `simulate_branch(project_id, branch_point)` 方法
- 输出 `BranchSimulationReport` 含确定性部分和 LLM 推理部分

#### 阶段二：LLM 推理（含置信度标注）

| 分析项 | 模型 | 置信度 | 说明 |
|---|---|---|---|
| 张力曲线变化趋势 | Tier 2 (Sonnet 4) | 🟡 中 | 基于当前 tension_curve 推演变更后的走势 |
| 伏笔断裂风险评估 | Tier 2 (Sonnet 4) | 🟡 中 | 检测替换角色/事件后哪些伏笔的铺垫链断裂 |
| 替代方案建议 | Tier 2 (Sonnet 4) | 🟠 低 | LLM 建议的替代叙事方案，仅供参考 |
| 读者体验指标预估变化 | Tier 2 (Sonnet 4) | 🟡 中 | 预估 7 项 ReaderOS 指标的变化方向（↑/↓/→）和幅度 |

**置信度标注体系：**
| 标注 | 含义 | 用户应如何看待 |
|---|---|---|
| 🟢 高置信度 | 确定性计算，无 LLM 参与 | 可作为决策依据 |
| 🟡 中置信度 | LLM 推理，基于历史数据和叙事规则 | 作为参考，结合自身判断 |
| 🟠 低置信度 | LLM 推理，推测性质 | 仅供参考，不可作为决策依据 |

**前端展示：** STAGE 3 页面新增"分支模拟"面板，确定性计算和 LLM 推理结果使用不同的视觉样式明确区分，置信度标注始终可见。

**后端模型：**
```python
@dataclass
class LLMInference:
    """LLM 推理结果，封装置信度标注和推理内容。"""
    content: str           # 推理文本
    confidence: str        # "medium"（🟡中置信度）| "low"（🟠低置信度）
    model: str             # 使用的模型 ID（如 claude-sonnet-4）
    tokens_used: int       # 该推理消耗的 token 数

@dataclass
class BranchSimulationReport:
    branch_point_description: str          # 用户描述的分支变更
    # 确定性部分
    affected_chapter_range: tuple[int, int]
    affected_characters: list[str]
    affected_foreshadowings: list[str]
    growth_curve_shifts: dict[str, int]    # character_id → chapter_offset
    # LLM 推理部分（含置信度）
    tension_curve_projection: LLMInference  # 🟡 中置信度
    foreshadowing_risk_assessment: LLMInference  # 🟡 中置信度
    alternative_suggestions: LLMInference  # 🟠 低置信度
    reader_metrics_projection: dict[str, str]  # 指标名 → "↑12" / "↓5" / "→"
```

**API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/branches/simulate` | POST | 提交分支描述，返回 BranchSimulationReport |
| `/api/v1/projects/{id}/branches/history` | GET | 获取该项目的分支模拟历史记录 |

### F1.7.4 语义完整性预检

**目标：** 在 Fact Guard 之前运行，使用 Tier 3 轻量模型检测 Writer 可能遗漏的 SF_LOG 标记。纯建议性质，不阻断 Scene 通过。

**在 Pipeline 中的位置：**
```
Scene 写作完成
  → 语义完整性预检（新增，Tier 3，~500 tokens，建议性质）
    → Fact Guard（确定性 6 项，硬阻断）
      → Narrative Guard（Tier 2，建议性质）
        → Style Guard（确定性，tag 日志）
```

**预检范围（仅 3 种高重要性事件类型）：**

| 检测类型 | 检测逻辑 | 示例 |
|---|---|---|
| `twist_reveal` | 文本中出现重大信息颠覆（角色真实身份的揭露 / 世界观规则的突破 / 关键人物关系的反转），但没有对应的 SF_LOG 标记 | 文本写"原来林峰就是预言中的那个人"，但无 `twist_reveal` 标签 → 建议添加 |
| `registry_create` | 文本中创建了明显的新叙事资产（新冲突苗头 / 新谜团线索 / 新角色承诺），但 Writer 未在 scene_plan 中声明 | 文本写"苏晓晓许下'我一定会回来'的承诺"，但无 `registry_create type="promise"` → 建议添加 |
| `character_relation_change` | 文本中角色间的关系发生明显变化（从信任到怀疑 / 从友好到敌对），但没有对应的标记 | 文本写"林峰第一次对师父的话产生了怀疑"，但无 `character_relation_change` → 建议添加 |

**输出格式：**
```json
{
  "precheck_passed": true,
  "suggestions": [
    {
      "type": "missing_sf_log",
      "severity": "suggestion",
      "event_type": "twist_reveal",
      "location_hint": "第3幕，林峰发现身份真相的段落",
      "suggested_tag": "<!-- SF_LOG twist_reveal id=\"tw_003\" trigger=\"记忆复苏\" -->",
      "reason": "检测到角色身份信息的重大颠覆，但未找到对应的 twist_reveal 标记"
    }
  ],
  "tokens_used": 480
}
```

**LLM 配置：**
- 模型：Tier 3 (Claude Haiku)
- 单 Scene 输入：~500 tokens（仅传当前 Scene 文本的关键段落 + Scene Schema 中已声明的 registry_changes）
- 单 Scene 输出：~100 tokens
- 成本：$0.000375 / Scene（0.5K × $0.00025 + 0.1K × $0.00125）

**阻断策略：**
- ❌ **不阻断** Scene 通过——LLM 判断可能误报
- 建议以 info 级别展示在 Reviewer 的检查结果中
- 用户可选择"接受建议（自动添加标记）"/"忽略"/"手动修改文本后重检"

**与 Fact Guard 第 5 项的关系：**
- Fact Guard 第 5 项（required_logs）：检查 Writer 在 scene_plan 中**声明了**的 required_logs 是否都有对应的 SF_LOG 标记——这是硬阻断
- 语义预检：检测 Writer **应该声明但未声明**的遗漏——这是建议
- 两者互补：前者保证"承诺的做到了"，后者提醒"可能漏掉了什么"

### F1.7.5 风格沙盒

**目标：** 让作者在写作前用约 500 字测试文本预览不同风格参数组合的效果，降低风格选型的试错成本。

**已有基础：** 前端 `StyleSandboxPage.tsx` 占位页面已存在，后端 Style Engine L1+L2+L3 已完整。风格沙盒是在现有 Style Engine 基础上增加一个"预览渲染"通道。

**功能流程：**
1. 用户输入或粘贴一段测试文本（~500 字），或从已有 Scene 中选取一段
2. 调整风格参数（句长范围 / 对白比例 / 描述密度 / 情绪节奏 / 爽点密度）
3. 点击"预览"
4. 系统根据当前参数对测试文本进行风格化渲染（Tier 3 轻量重写，仅调整句式和节奏，不改变内容。实现上复用 Style Engine L2 写作公式的定量规则作为 prompt 中的约束描述，由 LLM 负责具体的文本改写）
5. 并排展示原文 vs 渲染结果
6. 用户满意后保存为自定义风格配置（`.style.yaml`）

**可调参数：**
```yaml
# 风格沙盒可调参数
sandbox_params:
  sentence:
    avg_length_range: [15, 45]      # 平均句长范围（字数）
    short_sentence_ratio: 0.3       # 短句（≤15字）占比
    paragraph_length_range: [80, 200]  # 段落长度范围

  dialogue:
    ratio: 0.35                     # 对白占比
    turn_length_range: [10, 60]    # 单次对白长度范围

  rhythm:
    emotional_peak_interval: 300    # 情绪高点间隔（字数）
    action_to_reflection_ratio: 0.6 # 动作与内心戏比例

  density:
    description_ratio: 0.25         # 描述占比
    metaphor_frequency: low         # 修辞频率：low/medium/high
    adjective_density: medium       # 形容词密度：low/medium/high

  satisfaction:
    min_shuang_points: 2            # 最少爽点触发次数（仅爽文体裁）
    cliffhanger_required: true      # 结尾是否必须有钩子
```

**LLM 配置：**
- 模型：Tier 3 (Claude Haiku)
- 输入：~800 tokens（测试文本 + 风格参数描述）
- 输出：~600 tokens（渲染后文本）
- 成本：$0.00095 / 次预览
- 典型使用场景：用户在一次创作中预览 3-5 次 → 总成本 < $0.005

**保存：**
- 用户满意的参数组合保存为 `.style.yaml` 文件到 `<project_dir>/styles/`
- STAGE 4 写作时在风格配置下拉列表中可见
- 跨项目共享（v1.8）前保持项目级

**后端 API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/style/sandbox/preview` | POST | 传入文本 + 参数，返回渲染结果 |
| `/api/v1/projects/{id}/style/sandbox/save` | POST | 保存当前参数组合为自定义风格配置 |
| `/api/v1/projects/{id}/style/sandbox/configs` | GET | 获取已有的自定义风格配置列表 |

### F1.7.6 创新豁免

**目标：** 当 Writer 认为某个创意意图需要突破现有规则约束时，可以主动提交豁免申请，由用户审批。在保障一致性体系权威的同时，为创意留下灵活空间。

**触发流程：**
```
Scene 写作中 Writer 产生创意意图
        │
        ├── 意图与现有约束冲突
        │     │
        │     ├── Writer 提交豁免申请
        │     │   声明：突破的规则、创作意图、预期效果
        │     │
        │     ├── 用户审批
        │     │    ├── 批准 → 该 Scene 不受对应规则约束
        │     │    └── 拒绝 → Writer 按照规则重写
        │     │
        │     └── 后续跟踪（Scene 完成后）
        │          ├── 效果优秀 → 用户标记"提炼为新规则"
        │          └── 效果不佳 → 系统标记为反例，未来类似豁免降低审批优先级
        │
        └── 意图不违反约束 → 正常写作流程
```

**豁免申请数据结构：**
```json
{
  "id": "exemption_001",
  "scene_id": "ch15_scene_3",
  "requested_by": "writer",
  "rule_to_break": {
    "layer": "L3",
    "rule_id": "taboo_sadistic_mc",
    "rule_description": "爽文体裁禁止无故虐主超过 300 字",
    "constraint_type": "体裁禁忌"
  },
  "creative_intent": "本章需要展示主角为保护同伴而主动承受折磨——这是角色信念从'利己'转向'利他'的关键转折点，虐主的'因'是充分的",
  "expected_effect": "为第 20 章主角做出牺牲选择建立情感基础",
  "status": "pending",
  "requested_at": "2026-07-15T10:00:00Z",
  "approved_by": null,
  "outcome": null
}
```

**审批 UI：** 在 STAGE 4 的 Reviewer 检查结果中，当存在豁免申请时展示：
```
┌─────────────────────────────────────────────┐
│  🎨 创新豁免申请                              │
│                                              │
│  Writer 申请突破规则：                        │
│  「无故虐主超过 300 字」                      │
│                                              │
│  创作意图：                                   │
│  展示主角为保护同伴主动承受折磨——这是角色信念  │
│  从'利己'转向'利他'的关键转折点               │
│                                              │
│  预期效果：为第 20 章主角做出牺牲选择建立情感基础│
│                                              │
│  [批准] [拒绝] [要求修改后重新申请]             │
└─────────────────────────────────────────────┘
```

**效果跟踪：**
- 豁免批准后记录 `exemption_id`
- Scene 完成后用户可从以下维度评价：叙事效果 / 角色弧线贡献 / 读者体验
- 效果优秀 → 用户标记 → 系统分析该豁免的模式 → 建议提炼为新的 L3 规则或例外条件
- 效果不佳 → 标记为反例 → 存储反例特征 → 未来类似豁免申请时展示反例警告

**反例学习（简化版，v1.7 不做完整 ML）：**
- 反例存储在 `<project_dir>/creative_os/exemption_antipatterns.json`
- 新豁免申请时检查：相似规则 + 相似创作意图 → 展示历史反例数量和代表性案例
- 纯规则匹配，零 ML

### F1.7.7 灵感路由器

**目标：** 在所有阶段的 Agent 对话和用户交互中持续运行，自动捕捉、分类、存储灵感，避免一闪而过的创意被遗忘。

**运行机制：**

**触发时机（全阶段覆盖）：**
| 阶段 | 触发场景 | 捕捉内容 |
|---|---|---|
| INIT | 项目初始化 Agent 讨论 | 世界观灵感、角色构思 |
| STAGE 1 | 创意画布交互 | 用户偏好的方向、标记的节点 |
| STAGE 2 | 世界观/角色设计讨论 | 新角色想法、世界观细节 |
| STAGE 3 | 大纲/情节讨论 | 情节转折想法、伏笔构思 |
| STAGE 4 | Scene 写作 | Writer 在写作中产生的"可以这样写"的灵感 |
| STAGE 5 | 诊断讨论 | 修复建议、改进方向 |
| 全部阶段 | 用户手动触发"捕捉灵感" | 用户在讨论中随时想到的任何东西 |

**分类逻辑（Tier 3 模型）：**

```
用户输入（对话文本 / 手动捕捉内容）
        │
        ▼
  Tier 3 分类器（~50 tokens）
        │
        ├── 置信度 ≥ 0.8 单一分类 → 直接归入对应 Idea Pool 类别
        ├── 置信度 0.5-0.8 → 归类 + "待确认"标签
        ├── 多分类差距 > 0.3 → 归类到最高置信度
        └── 多分类差距 ≤ 0.3 → 多标签"跨类"标记
```

**多分类冲突处理示例：**
- "如果主角的能力不是修炼来的而是被植入的" → 设定灵感(0.6) 剧情想法(0.55) → 差距 0.05 ≤ 0.3 → 双标签"跨类-设定/剧情"
- "林峰和苏晓晓其实是失散多年的兄妹" → 剧情想法(0.7) 角色灵感(0.3) → 差距 0.4 > 0.3 → 归类为"剧情想法"

**用户纠错操作：**
| 操作 | 说明 |
|---|---|
| 重新分类 | 用户将灵感从"设定灵感"改为"角色灵感" |
| 拆分 | 一条灵感包含多个独立想法，拆分为多条 |
| 合并 | 两条灵感本质上是同一个想法，合并 |
| 标记无效 | 标记为噪音，不计入分类准确率统计 |
| 编辑内容 | 修改灵感文本，使其更精炼 |

**存储：** 灵感路由器的输出存储到 Idea Pool（F1.7.1.1），与其他来源（创意画布、手动添加）的灵感统一管理。

**LLM 成本：**
- 分类：Tier 3，~50 tokens 输入 + ~30 tokens 输出 → ~$0.00005 / 次
- 假设每章写作中触发 5 次（跨 3 个 Agent 对话 + 2 次用户交互），20 章合计 100 次 → $0.005
- 几乎零成本

### F1.7.8 成长工坊（Growth Workshop）

**目标：** 将角色创建从"填写档案表单"升级为"与 Agent 协同设计成长曲线"。

**已有基础：**
- `auto_generator.py` 已实现：从 outline 的 registry_changes 自动生成 3-5 个 GrowthStage
- `binder.py` 已实现：将 GrowthStage 的 `trigger_event_type` 绑定到具体章节
- `context.py` 已实现：写作时注入角色成长阶段上下文

**成长工坊在已有基础上的增强：**

**新增交互流程（STAGE 2 角色创建后）：**
```
角色创建完成 → 生成初始档案和初始成长曲线
        │
        ▼
  成长工坊（新页面/面板）
        │
        ├── 可视化：起点 → 转折点（绑事件类型）→ 低谷 → 终点
        │     用时间轴/折线图展示成长曲线的 4 个关键节点
        │
        ├── Agent 讨论：Character Designer Agent（Tier 1）引导讨论
        │     • 节奏是否合适？（转折点之间的章节间隔是否均衡）
        │     • 代价是否充分？（到达低谷的代价是否有说服力）
        │     • 与剧情高潮是否同步？（角色低谷是否与剧情高潮错位？）
        │     • 成长方向是否与故事主题一致？
        │
        ├── 用户调整：
        │     • 拖拽调整转折点的章节位置
        │     • 修改成长阶段的描述
        │     • 增加/删除转折点
        │     • 修改 trigger_event_type
        │
        └── 一致性检查（确定性）：
              • 检查：调整后的转折点章节是否在 outline 中有对应的剧情事件
              • 检查：角色低谷章节是否与 outline 中的重大冲突章节对齐
              • 检查：终点章节是否在全书范围内（不超出总章数）
              • 冲突 → 提示用户并给出建议
```

**前端页面：** 在 STAGE 2 页面中新增"成长工坊"Tab 或面板，不必新建独立页面。

**一致性检查规则（确定性，零 LLM）：**

| 检查项 | 规则 | 严重级别 |
|---|---|---|
| 转折点章节缺失剧情事件 | `stage.chapter_number` 对应的 outline 章节中无匹配的 `trigger_event_type` 事件 | ⚠️ 警告 |
| 低谷与冲突不同步 | `stage.stage_name == "低谷"` 的章节中 outline 无高烈度 conflict | ⚠️ 警告 |
| 转折点间隔过密 | 两个连续 `stage.chapter_number` 差距 < 2 章 | ⚠️ 警告 |
| 终点超出范围 | `stages[-1].chapter_number > outline.total_chapters` | 🔴 错误 |
| 事件类型不匹配 | `stage.trigger_event_type` 不在 8 类触发类型白名单中 | 🔴 错误 |

**后端 API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/characters/{cid}/growth/workshop/check` | POST | 对某角色的成长曲线执行一致性检查 |
| `/api/v1/projects/{id}/characters/{cid}/growth/workshop/discuss` | POST | 与 Agent 讨论成长曲线设计（Tier 1） |
| `/api/v1/projects/{id}/characters/{cid}/growth/workshop/adjust` | PUT | 更新成长曲线（用户调整后保存） |

### F1.7.9 用户编辑辅助（SF_LOG 自动建议）

**目标：** 用户在"live"模式下手动修改 Scene 文本后，系统自动分析修改内容中隐含的叙事变化，向用户建议需要添加或调整的 SF_LOG 标记，确保手动改写也能被 StoryOS 正确追踪。

**触发时机：** 用户在 STAGE 4 的 Scene 编辑器中手动修改文本后，点击"分析叙事影响"或自动在保存时触发。

**分析流程（确定性 + Tier 3 轻量 LLM）：**

#### Step 1：文本 Diff（确定性）

对比修改前后的文本，定位变更段落：
- 新增的段落 → 需要检查是否引入了新的叙事事件
- 删除的段落 → 需要检查删除的段落中是否含有 SF_LOG 标记
- 修改的段落 → 需要重新分析该段落的叙事含义

#### Step 2：SF_LOG 影响分析

| 检查项 | 检测方式 | 处理 |
|---|---|---|
| 删除了含 SF_LOG 的段落 | 正则匹配原文本中的 SF_LOG 标记，与修改后文本对比 | 🔴 警告："检测到删除了 X 个 SF_LOG 标记，对应的叙事资产将失去追踪。是否保留这些标记？" |
| 新增内容隐含叙事变化 | Tier 3 轻量分析（~300 tokens） | 🟡 建议：生成建议添加的 SF_LOG 标记，用户逐个确认或批量接受 |
| 修改内容改变了已有标记的参数 | 对比 diff 区域前后的 SF_LOG 参数 | 🟡 建议："检测到角色关系描述变化，是否更新对应的 character_relation_change 标记？" |

#### Step 3：建议展示

```
┌─────────────────────────────────────────────┐
│  📋 叙事影响分析                              │
│                                              │
│  🔴 需要处理（1 项）：                        │
│  • 删除了 SF_LOG/conflict_escalate cf_001    │
│    → 冲突 cf_001 将失去本章的升级记录          │
│    [保留标记] [忽略]                           │
│                                              │
│  🟡 建议添加（2 项）：                        │
│  • 建议添加 character_relation_change         │
│    检测到林峰和苏晓晓的关系描述从"信任"变为"怀疑"│
│    建议标记：char_a="林峰" char_b="苏晓晓"     │
│    status="裂痕" trigger="争执"               │
│    [添加] [修改] [忽略]                       │
│                                              │
│  • 建议添加 character_emotion                 │
│    检测到林峰的情绪描述新增了"愤怒"相关内容      │
│    建议标记：char="林峰" emotion="愤怒"         │
│    [添加] [忽略]                               │
│                                              │
│  [全部接受] [全部忽略] [逐项处理]              │
└─────────────────────────────────────────────┘
```

**LLM 配置：**
- 模型：Tier 3 (Claude Haiku)
- 输入：~500 tokens（diff 区域的文本片段 + 已有 SF_LOG 列表 + 角色名称列表）
- 输出：~100 tokens（建议的 SF_LOG 标记列表）
- 成本：$0.00025 / 次分析

**后端 API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/scenes/{scene_id}/sf-log-suggestions` | POST | 分析修改后的文本，返回 SF_LOG 建议 |
| `/api/v1/projects/{id}/scenes/{scene_id}/sf-logs` | PUT | 批量应用建议的 SF_LOG 标记到文本中 |

### F1.7.10 Agent 层扩展（支撑性变更）

为支持上述 9 项功能，v1.6 的 5 个 Agent 需要以下扩展：

**新增 Agent：**

| Agent | 文件名 | 职责 | 主要 LLM Tier |
|---|---|---|---|
| **Creative Director** | `agents/creative_director.py` | 创意画布发散引导、WhatIf 树方向建议、变异操作推荐 | Tier 1（方向建议）/ Tier 3（节点预计算） |
| **Character Designer** | `agents/character_designer.py` | 成长工坊协同讨论、成长曲线合理性分析、角色弧线诊断 | Tier 1 |

**现有 Agent 扩展：**

| Agent | 扩展内容 |
|---|---|
| **Planner** | 增加 `creative_brainstorming` 任务（创意画布中替代单轮生成）；增加 `whatif_expansion` 任务（节点展开 Prompt）；增加 `novelty_evaluation` 任务（LLM 标签提取部分） |
| **Writer** | 增加豁免申请逻辑（检测约束冲突 → 生成豁免申请）；接收豁免审批结果（批准/拒绝后的行为分支） |
| **Reviewer** | 集成语义预检结果展示（在 Fact Guard 之前）；集成豁免审批 UI 入口 |

**配置文件更新：** `model_tiers.yaml` 的 `agent_mapping` 中新增 `creative_director` 和 `character_designer` 条目，`planner` 条目追加 3 个新任务映射（参见设计迭代文档 Section 4.2 F1.6.9 中的 v1.7 扩展示例）。


## 四、前端页面规划

### 4.1 新建页面

| 页面 | 文件名 | 路由 | 说明 |
|---|---|---|---|
| 创意画布 | `CreativeCanvasPage.tsx` | `/project/:id/stage1/canvas` | v1.7 核心新增页面，WhatIf 树交互探索 |

### 4.2 改造页面

| 页面 | 文件名 | 改造内容 |
|---|---|---|
| STAGE 1 概念 | `Stage1Page.tsx` | 新增入口：从"单轮生成"切换为"创意画布发散"模式；保留原单轮生成作为"快速模式" |
| STAGE 2 角色 | `Stage2Page.tsx` | 新增"成长工坊"Tab/面板，可视化成长期曲线 + Agent 讨论 + 一致性检查 |
| STAGE 3 大纲 | `Stage3Page.tsx` | 新增"分支模拟"面板入口，展示 BranchSimulationReport |
| STAGE 4 写作 | `Stage4Page.tsx` | Scene 编辑器增加"叙事影响分析"按钮，展示 SF_LOG 建议面板 |
| 风格沙盒 | `StyleSandboxPage.tsx` | 从占位页面改造为完整功能页面，接入后端 API |
| Settings | `SettingsPage.tsx` | 新增创新豁免反例查看、灵感路由器配置项 |

### 4.3 新增组件

| 组件 | 路径 | 说明 |
|---|---|---|
| WhatIf 树可视化 | `components/creative/WhatIfTree.tsx` | 基于 React Flow 的交互式树图 |
| 新颖度指示器 | `components/creative/NoveltyIndicator.tsx` | 四维评分雷达图 + 红海/蓝海标注 |
| 分支模拟面板 | `components/stage/BranchSimulationPanel.tsx` | 确定性 vs LLM 推理分区展示，置信度标注 |
| SF_LOG 建议面板 | `components/stage/SFLogSuggestionPanel.tsx` | 用户编辑后的 SF_LOG 建议展示和批量操作 |
| 成长曲线可视化 | `components/stage/GrowthCurveVisualizer.tsx` | 时间轴/折线图展示成长曲线 + 一致性检查结果 |
| 豁免审批卡片 | `components/stage/ExemptionCard.tsx` | Writer 豁免申请的审批 UI |
| 风格预览对比 | `components/style/PreviewComparison.tsx` | 原文 vs 渲染结果并排展示 |


## 五、验收标准

| 编号 | 验收项 | 对应功能 |
|---|---|---|
| AC-1 | 从一句话意图出发，WhatIf 树生成 ≥ 20 个有效衍生节点（含用户展开的和自动预计算的） | F1.7.2 |
| AC-2 | 创意画布中用户可完成完整的"发散→探索→偏好标记→剪枝→以节点为新根发散→合并分支→选定路径→生成 Story DNA"流程 | F1.7.2 |
| AC-3 | 新颖度评估器对同一创意的多次评分误差 < 5 分（可复现性验证：同一 Story DNA 输入 → 连续 3 次评估 → 分数极差 ≤ 4） | F1.7.1 |
| AC-4 | 分支模拟引擎正确区分确定性计算和 LLM 推理结果，置信度标注（🟢🟡🟠）在前端始终可见 | F1.7.3 |
| AC-5 | 语义预检检测到故意遗漏的 `twist_reveal` 标记（在测试文本中写"原来他是叛徒"但不加标记），正确建议用户补充，且不阻断 Scene 通过 | F1.7.4 |
| AC-6 | 风格沙盒调整句长参数（从 [15-45] 改为 [8-20]）后，500 字测试文本的渲染结果平均句长显著下降，且内容含义不变 | F1.7.5 |
| AC-7 | 创新豁免审批通过后，Style Guard 不再对该 Scene 的豁免规则（如"无故虐主超过 300 字"）进行检测；豁免拒绝后规则正常生效 | F1.7.6 |
| AC-8 | 灵感路由器从一次 10 轮讨论中正确捕捉 ≥ 3 条灵感，且分类准确（人工验证分类标签与内容匹配） | F1.7.7 |
| AC-9 | 成长工坊修改某角色的低谷章节从 Ch.15 改为 Ch.12 后，一致性检查检测到 Ch.12 无匹配的高烈度冲突事件并给出警告 | F1.7.8 |
| AC-10 | 用户手动修改 Scene 文本（删除含 SF_LOG 的段落 + 新增一段角色关系变化描写），系统正确建议：保留被删标记 + 新增 character_relation_change 标记 | F1.7.9 |


## 六、Token 预算

### 6.1 v1.7 增量消耗

| 新增 LLM 调用 | 模型 | 单次 tokens | 频率 | 每章增量 |
|---|---|---|---|---|
| 语义预检 | Tier 3 (Haiku) | ~500 in + 100 out | 每 Scene × 3 | ~1.8K |
| 灵感路由器分类 | Tier 3 (Haiku) | ~50 in + 30 out | 每章约 5 次 | ~0.4K |
| 用户编辑辅助 | Tier 3 (Haiku) | ~500 in + 100 out | 用户手动触发（非每 Scene） | 摊销 ~0.5K |
| 创意画布 WhatIf（摊销） | Tier 1 (Opus/DeepSeek) | ~1K in + 0.3K out / 节点 | STAGE 1 一次性 | 不计入单章 |
| 分支模拟 LLM 推理（摊销） | Tier 2 (Sonnet) | ~3K in + 1K out | 用户手动触发 | 不计入单章 |

**v1.7 单章 token 增量：~2.7K tokens（主要是 Tier 3 轻量调用），单章总消耗约 ~120K tokens。**

### 6.2 各版本 Token 对比

| 版本 | 单章 token 消耗 | 主要增量来源 |
|---|---|---|
| v1.4-mvp | ~34K | Scene 写作（3 × 8K）+ STAGE 1-3 生成（10K） |
| v1.5 | ~50K | + Summary Archiver 章摘要 + 多角色上下文 |
| v1.6 | ~117.5K | + Narrative Guard（3 × 9K）+ L1 重提取 + L3 检索嵌入 |
| v1.7 | ~120K | + 语义预检（3 × 0.6K）+ 灵感路由器（摊销）+ 用户编辑辅助（摊销） |
| v1.8 | ~120K | 与 v1.7 基本持平（协作增强功能主要在确定性层面） |


## 七、风险评估与缓解

| 风险 | 严重度 | 缓解措施 |
|---|---|---|
| **WhatIf 树节点爆炸** | 🔴 高 | 懒惰加载（仅展开用户点击的节点）+ 默认仅预计算深度 1-2 层 + 深度 3 的叶子节点使用 Tier 3 轻量生成，用户展开时升级为 Tier 1 重生成 |
| **创意画布复杂度超预期** | 🟡 中 | 保留 v1.6 的"快速模式"作为 fallback——用户可跳过画布直接用单轮生成，创意画布为可选增强 |
| **语义预检误报率高** | 🟡 中 | 仅建议不阻断 + 低 temperature（0.3）+ 限制检测范围到 3 种高重要性事件类型 + 用户可一键忽略全部建议 |
| **新颖度评估可复现性不足** | 🟡 中 | 4 个维度中 3 个是确定性计算（75% 权重）；LLM 参与的标签提取使用低温度 + 固定 prompt；目标波动范围 < ±5 分 |
| **分支模拟 LLM 推断误导用户** | 🟡 中 | 置信度标注体系 + 确定性/LLM 视觉区分 + 用户决策时系统提醒置信度水平 + 低置信度建议明确标注"仅供参考" |
| **灵感路由器噪音过多** | 🟢 低 | 用户可标记无效 + 置信度阈值控制 + 用户可在设置中配置捕捉灵敏度 |
| **CreativeOS 引擎 Prompt 工程量大** | 🟡 中 | 7 个引擎中 3 个为确定性（Idea Pool / Trope Pool / Novelty Evaluator 3/4 维度），仅 4 个需要 LLM Prompt 设计；复用 v1.6 的 Agent Prompt 风格和结构 |
| **前后端开发工作量大** | 🟡 中 | 创意画布是唯一全新建页面（复杂度最高），其他页面为改造/增强；Agent 层可优先保证核心路径（发散→选定），交互细节可分阶段迭代 |


## 八、迭代计划（v1.7 内部阶段）

### 第一阶段：CreativeOS 引擎核心（3 周）

- Idea Pool + Trope Pool（确定性数据结构 + 存储）
- Mutation Engine（4 种操作 Prompt + API）
- Contradiction Engine（5 个模板 + 展开 Prompt）
- WhatIf Engine（递归树算法 + 懒惰加载 API）
- Genre Fusion Engine（BFS 距离 + 融合 Prompt）
- Novelty Evaluator（4 维评分：3 维确定性 + 1 维 LLM 标签提取）
- 单元测试（目标 ≥ 40 个 CreativeOS 相关测试）

### 第二阶段：创意画布 + 分支模拟（3 周）

- 创意画布前端页面（WhatIfTree + NoveltyIndicator 组件）
- 画布后端 API（expand / mutate / merge / evaluate / select / state）
- 分支模拟引擎（ImpactAnalyzer 扩展 + LLM 推理 + 置信度标注）
- STAGE 3 分支模拟面板
- STAGE 1 改造（快速模式 / 画布模式切换）
- 集成测试

### 第三阶段：质量增强 + 写作辅助（2 周）

- 语义完整性预检（Prompt + API + Reviewer 集成）
- 用户编辑辅助（Diff + Tier 3 分析 + 建议面板）
- 创新豁免（申请/审批/跟踪流程）
- STAGE 4 增强（预检结果展示 + 豁免审批 + SF_LOG 建议面板）

### 第四阶段：风格沙盒 + 成长工坊 + 灵感路由器（2 周）

- 风格沙盒完整实现（preview / save API + StyleSandboxPage 改造）
- 成长工坊（一致性检查 + Agent 讨论 + GrowthCurveVisualizer 组件）
- 灵感路由器（分类器 + 捕捉逻辑 + 用户纠错 UI）
- Settings 页面增强
- 端到端集成测试 + 验收标准验证


## 九、v1.7 到 v1.6 的变更总结

```
v1.6                              v1.7
────                              ────
STAGE 1 单轮生成                   STAGE 1 多轮发散 + 创意画布交互探索
无 CreativeOS                      CreativeOS：7 个引擎
                                   ├── Idea Pool（灵感种子库）
                                   ├── Trope Pool（套路模式库，内置饱和度数据）
                                   ├── Mutation Engine（4 种变异操作）
                                   ├── Contradiction Engine（5 个矛盾模板）
                                   ├── WhatIf Engine（递归发散树，depth=3 breadth=4）
                                   ├── Genre Fusion Engine（BFS 体裁距离 + 融合）
                                   └── Novelty Evaluator（4 维评分，3/4 确定性）
无分支模拟                          分支模拟引擎
                                   ├── 确定性计算（4 项，复用 ImpactAnalyzer）
                                   └── LLM 推理（4 项，置信度标注：🟢🟡🟠）
无语义预检                          语义完整性预检
                                   ├── Tier 3 轻量检测 3 种高重要性事件遗漏
                                   └── 建议性质，不阻断
无风格沙盒                          风格沙盒
                                   ├── 参数调整 + 即时渲染预览
                                   └── 原文 vs 渲染结果并排展示
无创新豁免                          创新豁免机制
                                   ├── Writer 申请 → 用户审批 → 效果跟踪
                                   └── 反例学习（规则匹配）
无灵感路由器                        灵感路由器
                                   ├── 全阶段自动捕捉 + Tier 3 分类
                                   └── 用户纠错（重新分类/拆分/合并）
角色静态创建（表单 + 自动生成曲线）   成长工坊
                                   ├── 可视化成长曲线 + Agent 讨论
                                   └── 一致性检查（确定性，5 项规则）
用户编辑后无辅助                     用户编辑辅助
                                   ├── 文本 Diff + SF_LOG 影响分析
                                   └── 建议面板（保留/添加/修改标记）

前端：13 页面                        前端：+1 新建页面（创意画布）+ 6 页面改造
后端：11 路由文件                     后端：+1 CreativeOS 模块（7 文件）+ 1 新路由文件（creative_canvas.py）+ 16 新 API 端点 + 3 Agent 扩展（creative_director / character_designer / writer 扩展）
测试：522 用例                       测试：预计 600+ 用例
Token：~117.5K / 章                  Token：~120K / 章（+2.7K，主要是 Tier 3 轻量调用）
```


## 十、v1.8 展望

v1.8 聚焦"协作体验优化与跨作品资产复用"，是 StoryForge 从"写一部作品"到"长期创作伙伴"的最后一块拼图：

| v1.7 | v1.8 |
|---|---|
| Idea Pool 项目级 | → Global Idea Pool 跨项目 |
| Trope Pool 项目级 | → Global Trope Pool（用户反馈标注 + 系统快照版本管理） |
| 用户手动触发回退分析 | → 叙事重构模式（自动检测 + 批量处理） |
| 无疲劳感知 | → 协作疲劳感知（4 种信号，全部可配置） |
| Scene 级断点续写 | → Mid-Scene 草稿缓存（Beat 粒度恢复） |
| .md 导出 | → PDF + EPUB 多格式导出 |
| 风格配置项目级 | → 风格/体裁模板跨项目共享 |
| STAGE 5 常规诊断 | → 重构区域专项诊断（新旧设定残留扫描 + 边界连贯性检查） |
| Contradiction 模板系统内置 | → 用户自定义矛盾模板 |
| 创新豁免反例项目级 | → 跨项目豁免模式学习 |

v1.7 的 CreativeOS 引擎、Idea Pool、Trope Pool 是 v1.8 跨作品复用的基础——v1.7 先在项目级验证引擎的正确性和稳定性，v1.8 将其提升到用户级共享。
