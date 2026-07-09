# StoryForge v1.7 技术规划需求文档 (TRD)

> **版本:** 1.0 | **日期:** 2026-06-18 | **状态:** 待评审
>
> 本文档是 StoryForge v1.7 的技术实现规格，基于 v1.7 产品设计文档（storyForge-design-v1.7.md）和 v1.6 实际交付代码，描述在 v1.6 基础上新增和变更的全部技术细节。


## 一、项目概述

### 1.1 v1.7 目标

从"辅助写作"升级到"辅助构思"——接入 CreativeOS 全部创意引擎，让 StoryForge 成为作者的创意伙伴。

```
v1.6                              v1.7
────                              ────
STAGE 1 单轮 LLM 生成              STAGE 1 多轮发散 + 创意画布交互探索
无 CreativeOS                     CreativeOS：Idea Pool / Trope Pool / Mutation Engine /
                                  Contradiction Engine / WhatIf Engine / Genre Fusion Engine /
                                  Novelty Evaluator（共 7 引擎）
无分支模拟                         分支模拟引擎（确定性计算 + LLM 推理，置信度标注）
无语义预检                         语义完整性预检（Tier 3，建议性质，不阻断）
无风格沙盒                         风格沙盒预览（参数调整 + 即时渲染）
无创新豁免                         创新豁免机制（Writer 申请 → 用户审批 → 效果跟踪）
无灵感路由器                       灵感路由器（全阶段自动捕捉 + Tier 3 分类 + 用户纠错）
角色静态创建（表单 + 自动曲线）       成长工坊（可视化曲线设计 + Agent 讨论 + 一致性检查）
用户编辑后无辅助                    用户编辑辅助（Diff + SF_LOG 自动建议）
```

### 1.2 v1.7 增量范围

| 类别 | 新增 | 修改 | 不变 |
|---|---|---|---|
| **CreativeOS** | `idea_pool.py` `trope_pool.py` `mutation_engine.py` `contradiction_engine.py` `whatif_engine.py` `genre_fusion_engine.py` `novelty_evaluator.py` | — | — |
| **Agent** | `creative_director.py` `character_designer.py` | `planner.py`（+ creative_brainstorming/whatif_expansion/novelty_evaluation 任务）、`writer.py`（+ 豁免申请逻辑）、`reviewer.py`（+ 语义预检结果展示 + 豁免审批 UI 入口）、`storyos_agent.py`（+ 用户编辑辅助的 SF_LOG 建议生成） | `summary_archiver.py` |
| **Conductor** | — | `impact_analyzer.py`（+ simulate_branch 方法） | `state_machine.py` `circuit_breaker.py` `checkpoint.py` |
| **MemoryOS** | — | `l4_narrative.py`（已在 v1.6 实现，v1.7 无需变更） | L0/L1/L2/L3/L4 全部 |
| **StoryOS** | — | —（已在 v1.6 完成级联传播 + BFS + 原子提交） | `registries.py` `registry_transaction.py` |
| **ReaderOS** | — | —（已在 v1.6 完成 7 项指标 + 体裁差异化） | `calculator.py` `thresholds.py` |
| **Style Engine** | — | —（L1/L2/L3 已在 v1.6 完成；风格沙盒复用现有 Style Engine 作为 prompt 约束源） | `genre_template.py` `writing_formulas.py` `taboo_constraints.py` |
| **API** | `creative_canvas.py` | `stage1_concept.py`（+ 画布模式切换）、`stage2_world_char.py`（+ 成长工坊端点）、`stage3_outline.py`（+ 分支模拟端点）、`stage4_writing.py`（+ 语义预检触发 + SF_LOG 建议端点 + 豁免审批端点）、`style_extractor.py`（+ 风格沙盒端点）、`settings_api.py`（+ 灵感路由器配置 + 豁免反例查看） | `conductor.py` `project.py` `stage5_diagnosis.py` `stage6_export.py` `storyos.py` |
| **前端** | `CreativeCanvasPage.tsx`、`WhatIfTree.tsx`、`NoveltyIndicator.tsx`、`BranchSimulationPanel.tsx`、`SFLogSuggestionPanel.tsx`、`GrowthCurveVisualizer.tsx`、`ExemptionCard.tsx`、`PreviewComparison.tsx` | `Stage1Page.tsx`（+ 画布入口）、`Stage2Page.tsx`（+ 成长工坊 Tab）、`Stage3Page.tsx`（+ 分支模拟面板）、`Stage4Page.tsx`（+ 叙事影响分析 + 预检结果 + 豁免审批）、`StyleSandboxPage.tsx`（从占位改造为完整功能）、`SettingsPage.tsx`（+ 豁免反例 + 灵感路由器配置） | `InitPage.tsx` `ProjectListPage.tsx` `Stage5Page.tsx` `Stage6Page.tsx` `StoryOSPage.tsx` `ChapterReviewPage.tsx` `ImpactAnalysisPage.tsx` |
| **数据模型** | `creative_os.py` `branch_simulation.py` `exemption.py` `sandbox.py` | `character.py`（+ 成长工坊讨论记录字段）、`progress.py`（+ 豁免记录字段）、`sf_log.py`（+ 预检结果字段） | 其余 6 个模型 |
| **Config** | `trope_catalog.yaml`（内置 50+ 套路模板 + 市场饱和度基线） | `model_tiers.yaml`（+ creative_director + character_designer 映射） | `genre_thresholds.yaml` |
| **基础设施** | — | — | Qdrant / bge-m3 / FastAPI / Pydantic（v1.6 不变） |

### 1.3 Token 预算（v1.7 单章）

v1.6 单章约 117.5K tokens。v1.7 新增语义预检（Tier 3 轻量）、灵感路由器（Tier 3 微量）、用户编辑辅助（Tier 3 手动触发），单章增量约 2.7K tokens。创意画布和分支模拟为 STAGE 1/3 一次性消耗，不计入单章。

| 调用 | Agent | Tier | 模型 | 输入 (tokens) | 输出 (tokens) | 小计 | 新增? |
|---|---|---|---|---|---|---|---|
| Scene 写作 × 3 | Writer | Tier 1 | DeepSeek V4 Pro | 27,000 × 3 | 4,000 × 3 | 93,000 | — |
| Scene 重写（20% 概率缓冲） | Writer | Tier 1 | Claude Opus 4 (fallback) | 2,000 | 600 | 2,600 | — |
| Narrative Guard × 3 | Reviewer | Tier 2 | Claude Sonnet 4 | 9,000 × 3 | 1,500 × 3 | 31,500 | — |
| 语义完整性预检 × 3 | Reviewer | Tier 3 | Claude Haiku | 500 × 3 | 100 × 3 | 1,800 | ★新增 |
| 章摘要 | Summary Archiver | Tier 3 | Claude Haiku | 3,500 | 200 | 3,700 | — |
| L1 重提取（每 5 章摊销） | Summary Archiver | Tier 3 | Claude Haiku | 200 | 20 | 220 | — |
| 讨论话题生成 | Summary Archiver | Tier 3 | Claude Haiku | 2,000 | 200 | 2,200 | — |
| 灵感路由器分类（每章约 5 次） | 灵感路由器 | Tier 3 | Claude Haiku | 50 × 5 | 30 × 5 | 400 | ★新增 |
| 用户编辑辅助（摊销，非每 Scene） | Reviewer | Tier 3 | Claude Haiku | 500 | 100 | 500 | ★新增 |
| **合计** | | | | **~116,800** | **~17,820** | **~134,620** | |

> 以上为峰值估算。实际运行中重写触发率 < 20%，Narrative Guard 输出通常 < 1,000 tokens，用户编辑辅助非每 Scene 触发（摊销约 0.5 Scene/章），典型单章消耗约 **118K-122K tokens**。20 章总消耗约 2.4M tokens。

**一次性消耗（不计入单章）：**

| 调用 | 触发阶段 | Tier | 输入 (tokens) | 输出 (tokens) | 合计 |
|---|---|---|---|---|---|
| WhatIf 树节点展开（典型 25 节点） | STAGE 1 | Tier 1 | 1,000 × 25 | 300 × 25 | 32,500 |
| 分支模拟 LLM 推理（手动触发） | STAGE 3 | Tier 2 | 3,000 | 1,000 | 4,000 |
| 成长工坊 Agent 讨论（手动触发） | STAGE 2 | Tier 1 | 4,000 | 1,500 | 5,500 |
| 风格沙盒预览（3-5 次） | STAGE 4 前 | Tier 3 | 800 × 5 | 600 × 5 | 7,000 |

**成本对比（单章）：**

| 策略 | 模型组合 | v1.6 成本/章 | v1.7 成本/章 |
|---|---|---|---|
| v1.7 推荐 | DeepSeek 写作 + Sonnet NG + Haiku 辅助 | ~$0.75 | ~$0.78 |
| v1.7 轻量 | DeepSeek 写作（NG 关闭 + 预检关闭） | ~$0.35 | ~$0.35 |

> v1.7 单章增量成本约 $0.03（语义预检 ~$0.001/Scene + 灵感路由器 ~$0.00002/次 × 5 + 用户编辑辅助摊销），对总成本影响极小。

### 1.4 技术原则（继承 v1.6）

1. **确定性优先：** CreativeOS 7 引擎中 3 个为纯确定性（Idea Pool / Trope Pool / Novelty Evaluator 3/4 维度）；一致性检查、SF_LOG 解析、ReaderOS、级联传播、回退影响继续零 LLM。仅 WhatIf 展开、Mutation、Contradiction 展开、Genre Fusion、语义预检、Narrative Guard 使用 LLM
2. **文件即数据库：** 所有数据以 JSON/YAML/Markdown 文件存储，延续 v1.5/v1.6 架构。CreativeOS 数据存储在 `<project_dir>/creative_os/`
3. **Agent 无状态：** Agent 之间通过 Conductor 和结构化数据文件共享状态。新增的 Creative Director 和 Character Designer 遵循相同模式
4. **LLM 调用最小化：** 创意画布采用懒惰加载（仅展开用户点击的节点），叶子节点默认 Tier 3 预计算；语义预检仅检测 3 种高重要性事件类型；灵感路由器分类仅消耗 ~50 tokens/次
5. **配置驱动：** Agent 使用哪个模型由 `model_tiers.yaml` 决定；套路饱和度数据由 `trope_catalog.yaml` 驱动
6. **增量部署：** CreativeOS 所有引擎为纯 Python 模块，无新增外部依赖。创意画布保留 v1.6 的"快速模式"作为 fallback
7. **置信度透明：** 分支模拟引擎严格区分确定性计算（🟢 高置信度）和 LLM 推理（🟡 中 / 🟠 低），前端始终可见


## 二、技术架构变更

### 2.1 整体架构（v1.7 增量以 ★ 标记）

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Web Frontend                                   │
│  React 18 + TypeScript + Tailwind CSS                                │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │★CreativeCanvas │ │★BranchSim    │ │★StyleSandbox │                │
│  │  Page (新建)    │ │  Panel (Stage3│ │  Page (改造)  │                │
│  │ WhatIfTree +   │ │  确定性/LLM   │ │  参数调整+    │                │
│  │ NoveltyIndicator│ │  置信度标注)  │ │  即时渲染预览  │                │
│  └────────────────┘ └──────────────┘ └──────────────┘                │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │★GrowthWorkshop │ │★SFLogSug-    │ │★Exemption    │                │
│  │  (Stage2 Tab)  │ │  gestionPanel│ │  Card        │                │
│  │  曲线可视化+    │ │  (Stage4)    │ │  (Stage4)    │                │
│  │  一致性检查     │ │  Diff+建议   │ │  豁免审批     │                │
│  └────────────────┘ └──────────────┘ └──────────────┘                │
│                            │                                          │
│                    REST API (JSON)                                     │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│                      Python Backend                                    │
│  FastAPI + Pydantic + Qdrant + bge-m3                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │★Creative     │ │★Creative     │ │★Character    │                  │
│  │  Director    │ │  OS Engines  │ │  Designer    │                  │
│  │  画布引导    │ │  7 引擎      │ │  成长工坊    │                  │
│  │  WhatIf 方向 │ │              │ │  协同讨论    │                  │
│  └──────────────┘ └──────────────┘ └──────────────┘                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │ Planner      │ │ Writer       │ │ Reviewer     │                  │
│  │ +brainstorming│ │ +豁免申请    │ │ +语义预检    │                  │
│  │ +whatif_expand│ │              │ │ +豁免审批UI  │                  │
│  │ +novelty_eval │ │              │ │              │                  │
│  └──────────────┘ └──────────────┘ └──────────────┘                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │★Branch       │ │★Semantic     │ │★Inspiration  │                  │
│  │  Sim Engine  │ │  Precheck    │ │  Router      │                  │
│  │  确定性+LLM  │ │  Tier 3 检测 │ │  全阶段捕捉  │                  │
│  │  置信度标注   │ │  3 类事件    │ │  Tier 3 分类 │                  │
│  └──────────────┘ └──────────────┘ └──────────────┘                  │
│                            │                                          │
│     File System (JSON/YAML/MD) + Qdrant                               │
│     ★新增: <project_dir>/creative_os/ (7 类数据)                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈变更

| 组件 | v1.6 | v1.7 | 说明 |
|---|---|---|---|
| **向量数据库** | Qdrant (本地单机) | 不变 | L3 冷记忆继续使用 |
| **嵌入模型** | BAAI/bge-m3 (1024维) | 不变 | Novelty Evaluator 套路相似度计算复用 |
| **BM25 索引** | rank-bm25 (Python) | 不变 | L3 混合检索继续使用 |
| **模型路由** | ModelRouter + YAML 配置 | 不变（追加 agent_mapping 条目） | 新增 creative_director / character_designer 映射 |
| **LLM Provider** | Anthropic / DeepSeek / MiniMax | 不变 | — |
| **前端图形库** | — | React Flow (WhatIf 树可视化) / Recharts (新颖度雷达图 + 成长曲线折线图) | 新增依赖 |
| **前端 Diff** | — | diff (轻量文本 diff 库，用户编辑辅助) | 新增依赖 |
| **运行环境** | Python 3.11+ / Node 20+ | 不变 | — |
| **前端框架** | React 18 + Vite + Tailwind | 不变 | — |

### 2.3 基础设施决策

| 考量项 | 决策 | 原因 |
|---|---|---|
| CreativeOS 存储方式 | `<project_dir>/creative_os/` 下 JSON 文件 | 与现有 StoryOS/MemoryOS 存储模式一致，文件即数据库 |
| trope_catalog.yaml 体积 | 内置 50+ 套路模板，约 30KB | 纯文本 YAML，无性能影响 |
| WhatIf 树存储格式 | 画布状态存储为 `<project_dir>/creative_os/canvas_state.json` | 支持刷新/恢复，用户可导出 |
| 创意画布前端图形方案 | React Flow | 支持节点拖拽、缩放、自定义节点渲染，社区活跃 |
| 风格沙盒 LLM 策略 | Tier 3 (Haiku) 轻量渲染 | 成本低（$0.001/次），速度优先 |
| 灵感路由器触发方式 | 被动触发（Agent 对话完成时 + 用户手动触发） | 避免过度消耗，仅在自然断点处触发 |
| 分支模拟 LLM 推理 | 与确定性计算并行展示，视觉明确区分 | 防止用户混淆 LLM 推断与确定性结论 |
| 语义预检 fallback | 不可用时跳过，不阻断 Scene 通过 | Tier 3 服务可能波动，核心链路不受影响 |


## 三、项目目录结构（v1.7 增量）

```
storyforge/
├── backend/
│   ├── main.py                             # 不变
│   ├── config.py                           # 修改：+ trope_catalog 配置加载
│   ├── llm/
│   │   ├── base_provider.py                # 不变
│   │   ├── anthropic_provider.py           # 不变
│   │   ├── deepseek_provider.py            # 不变
│   │   ├── minimax_provider.py             # 不变
│   │   └── model_router.py                 # 不变
│   ├── creative_os/                        # ★新增目录：完整创意引擎
│   │   ├── __init__.py                     # ★新增：模块导出
│   │   ├── idea_pool.py                    # ★新增：灵感种子库 CRUD + 筛选
│   │   ├── trope_pool.py                   # ★新增：套路模式库（饱和度查询 + 标签匹配）
│   │   ├── mutation_engine.py              # ★新增：套路变异器（4 种操作 Prompt）
│   │   ├── contradiction_engine.py         # ★新增：矛盾设定生成器（5 模板 + 正则评分）
│   │   ├── whatif_engine.py                # ★新增：连续发散器（递归树 + 懒惰加载）
│   │   ├── genre_fusion_engine.py          # ★新增：体裁融合器（BFS 距离 + 融合 Prompt）
│   │   └── novelty_evaluator.py            # ★新增：新颖度评估器（4 维评分，75% 确定性）
│   ├── conductor/
│   │   ├── state_machine.py                # 不变
│   │   ├── circuit_breaker.py              # 不变
│   │   ├── checkpoint.py                   # 不变
│   │   ├── impact_analyzer.py              # 修改：+ simulate_branch() 方法
│   │   └── branch_simulator.py             # ★新增：分支模拟引擎（确定性计算 + LLM 推理编排）
│   ├── agents/
│   │   ├── base_agent.py                   # 修改：+ 豁免申请/审批相关基础方法
│   │   ├── planner.py                      # 修改：+ creative_brainstorming / whatif_expansion / novelty_evaluation 任务
│   │   ├── writer.py                       # 修改：+ 豁免申请逻辑（检测约束冲突 → 生成豁免申请）
│   │   ├── reviewer.py                     # 修改：+ 语义预检集成 + 豁免审批 UI 数据组装
│   │   ├── storyos_agent.py                # 修改：+ SF_LOG 建议生成（用户编辑辅助）
│   │   ├── summary_archiver.py             # 不变
│   │   ├── creative_director.py            # ★新增：创意画布引导 Agent（Tier 1）
│   │   └── character_designer.py           # ★新增：角色设计师 Agent（成长工坊讨论，Tier 1）
│   ├── story_os/                           # 不变（v1.6 已完成全部）
│   │   ├── registries.py                   # 不变
│   │   └── registry_transaction.py         # 不变
│   ├── memory_os/                          # 不变（v1.6 已完成五层）
│   │   ├── l0_runtime.py                   # 不变
│   │   ├── l1_hot.py                       # 不变
│   │   ├── l2_warm.py                      # 不变
│   │   ├── l3_cold/                        # 不变
│   │   ├── l4_narrative.py                 # 不变
│   │   └── memory_coordinator.py           # 不变
│   ├── reader_os/                          # 不变（v1.6 已完成 7 项 + 体裁差异化）
│   │   ├── calculator.py                   # 不变
│   │   └── thresholds.py                   # 不变
│   ├── scene_engine/                       # 不变
│   ├── style_engine/                       # 不变（风格沙盒复用 style_engine 的 L2 写作公式作为 prompt 约束）
│   │   ├── genre_template.py               # 不变
│   │   ├── style_extractor.py              # 不变
│   │   ├── writing_formulas.py             # 不变
│   │   └── taboo_constraints.py            # 不变
│   ├── inspiration/                        # ★新增目录：灵感路由器
│   │   ├── __init__.py                     # ★新增：模块导出
│   │   ├── router.py                       # ★新增：灵感路由器主逻辑（捕捉触发 + 分类调度）
│   │   └── classifier.py                   # ★新增：Tier 3 分类器 Prompt + 多分类冲突处理
│   ├── semantic_precheck/                  # ★新增目录：语义完整性预检
│   │   ├── __init__.py                     # ★新增：模块导出
│   │   └── prechecker.py                   # ★新增：3 类事件遗漏检测（Tier 3 Prompt）
│   ├── prompts/
│   │   ├── concept_generation.yaml         # 不变
│   │   ├── world_generation.yaml           # 不变
│   │   ├── character_generation.yaml       # 不变
│   │   ├── outline_generation.yaml         # 不变
│   │   ├── scene_writing.yaml              # 不变
│   │   ├── scene_rewrite.yaml              # 不变
│   │   ├── chapter_summary.yaml            # 不变
│   │   ├── narrative_guard.yaml            # 不变
│   │   ├── creative/                       # ★新增目录：CreativeOS Prompts
│   │   │   ├── whatif_expand.yaml          # ★新增：WhatIf 节点展开 Prompt
│   │   │   ├── mutation_operation.yaml     # ★新增：变异操作 Prompt（Inversion/Fusion/Escalation/Subversion）
│   │   │   ├── contradiction_expand.yaml   # ★新增：矛盾模板展开 Prompt
│   │   │   ├── genre_fusion.yaml           # ★新增：体裁融合分析 Prompt
│   │   │   ├── trope_extraction.yaml       # ★新增：套路标签提取 Prompt（Tier 3）
│   │   │   └── novelty_evaluation_llm.yaml # ★新增：新颖度 LLM 辅助评估 Prompt
│   │   ├── semantic_precheck.yaml          # ★新增：语义完整性预检 Prompt
│   │   ├── inspiration_classify.yaml       # ★新增：灵感分类 Prompt
│   │   ├── sf_log_suggestion.yaml          # ★新增：用户编辑 SF_LOG 建议 Prompt
│   │   ├── growth_workshop_discuss.yaml    # ★新增：成长工坊 Agent 讨论 Prompt
│   │   ├── branch_simulation_llm.yaml      # ★新增：分支模拟 LLM 推理 Prompt
│   │   └── exemption_evaluate.yaml         # ★新增：豁免效果评估 Prompt
│   ├── models/
│   │   ├── project.py                      # 不变
│   │   ├── world.py                        # 不变
│   │   ├── character.py                    # 修改：+ growth_workshop_discussion 字段
│   │   ├── outline.py                      # 不变
│   │   ├── storyos.py                      # 不变
│   │   ├── sf_log.py                       # 修改：+ precheck_result 字段
│   │   ├── checkpoint.py                   # 不变
│   │   ├── progress.py                     # 修改：+ exemptions 数组字段
│   │   ├── reader_os.py                    # 不变
│   │   ├── l2_memory.py                    # 不变
│   │   ├── impact_report.py                # 修改：+ BranchSimulationReport 模型
│   │   ├── creative_os.py                  # ★新增：CreativeOS 全部数据模型（Idea/Trope/MutationResult/WhatIfNode/NoveltyScore 等）
│   │   ├── branch_simulation.py            # ★新增：BranchSimulationReport / LLMInference 模型
│   │   ├── exemption.py                    # ★新增：ExemptionRequest / ExemptionOutcome 模型
│   │   └── sandbox.py                      # ★新增：SandboxPreview / StyleConfig 模型
│   ├── api/
│   │   ├── project.py                      # 不变
│   │   ├── stage1_concept.py               # 修改：+ 画布模式切换查询参数
│   │   ├── stage2_world_char.py            # 修改：+ 成长工坊 3 端点
│   │   ├── stage3_outline.py               # 修改：+ 分支模拟 2 端点
│   │   ├── stage4_writing.py               # 修改：+ 语义预检触发 + SF_LOG 建议 2 端点 + 豁免 5 端点
│   │   ├── stage5_diagnosis.py             # 不变
│   │   ├── stage6_export.py                # 不变
│   │   ├── style_extractor.py              # 修改：+ 风格沙盒 3 端点
│   │   ├── storyos.py                      # 不变
│   │   ├── conductor.py                    # 不变
│   │   ├── settings_api.py                 # 修改：+ 灵感路由器配置 + 豁免反例查看
│   │   └── creative_canvas.py              # ★新增：创意画布 6 端点
│   └── utils/                              # 不变
│
├── config/
│   ├── model_tiers.yaml                    # 修改：+ creative_director + character_designer 映射
│   ├── genre_thresholds.yaml              # 不变
│   └── trope_catalog.yaml                 # ★新增：50+ 套路模板 + 市场饱和度基线
│
├── frontend/
│   └── src/
│       ├── App.tsx                          # 修改：+ /project/:id/stage1/canvas 路由
│       ├── api/
│       │   └── client.ts                   # 修改：+ 21 个新 API 函数
│       ├── hooks/
│       │   ├── useProject.ts               # 不变
│       │   ├── useConductor.ts              # 不变
│       │   ├── useStage4Writing.ts          # 修改：+ 豁免状态 + 语义预检结果
│       │   ├── useCreativeCanvas.ts         # ★新增：创意画布状态管理（树加载/展开/变异/合并/选定）
│       │   ├── useBranchSimulation.ts       # ★新增：分支模拟请求 + 结果解析
│       │   └── useGrowthWorkshop.ts         # ★新增：成长工坊检查/讨论/调整状态
│       ├── components/
│       │   ├── layout/
│       │   │   ├── SideNavBar.tsx           # 修改：+ 创意画布导航项
│       │   │   └── MainLayout.tsx           # 修改：+ 创意画布路由映射
│       │   ├── shared/
│       │   │   ├── GlassPanel.tsx           # 不变
│       │   │   ├── ChapterProgress.tsx      # 不变
│       │   │   ├── ReaderOSDashboard.tsx    # 不变
│       │   │   └── ConfidenceBadge.tsx      # ★新增：置信度标注组件（🟢🟡🟠）
│       │   ├── creative/
│       │   │   ├── WhatIfTree.tsx           # ★新增：基于 React Flow 的交互式发散树
│       │   │   └── NoveltyIndicator.tsx     # ★新增：四维评分雷达图 + 红海/蓝海标注
│       │   └── stage/
│       │       ├── BranchSimulationPanel.tsx # ★新增：分支模拟结果面板（确定性/LLM 分区）
│       │       ├── SFLogSuggestionPanel.tsx  # ★新增：SF_LOG 建议面板
│       │       ├── GrowthCurveVisualizer.tsx # ★新增：成长曲线可视化（时间轴/折线图）
│       │       ├── ExemptionCard.tsx         # ★新增：豁免审批卡片
│       │       ├── ChapterReviewPanel.tsx    # 不变
│       │       ├── ImpactReportPanel.tsx     # 不变
│       │       ├── GrowthCurveEditor.tsx     # 不变
│       │       ├── WritingFormulaPanel.tsx   # 不变
│       │       └── StoryOSPanel.tsx          # 不变
│       ├── components/style/
│       │   └── PreviewComparison.tsx         # ★新增：原文 vs 渲染结果并排展示
│       └── pages/
│           ├── InitPage.tsx                  # 不变
│           ├── ProjectListPage.tsx           # 不变
│           ├── CreativeCanvasPage.tsx        # ★新增：创意画布页面（WhatIf 树 + 操作工具栏）
│           ├── Stage1Page.tsx                # 修改：+ 快速模式 / 画布模式切换
│           ├── Stage2Page.tsx                # 修改：+ 成长工坊 Tab
│           ├── Stage3Page.tsx                # 修改：+ 分支模拟面板入口
│           ├── Stage4Page.tsx                # 修改：+ 叙事影响分析按钮 + 预检结果 + 豁免审批
│           ├── Stage5Page.tsx                # 不变
│           ├── Stage6Page.tsx                # 不变
│           ├── StoryOSPage.tsx               # 不变
│           ├── ChapterReviewPage.tsx          # 不变
│           ├── ImpactAnalysisPage.tsx         # 不变
│           ├── StyleSandboxPage.tsx           # 修改：从占位页面改造为完整功能
│           └── SettingsPage.tsx               # 修改：+ 豁免反例查看 + 灵感路由器配置
│
├── tests/
│   ├── test_creative_os/                    # ★新增目录：CreativeOS 测试
│   │   ├── test_idea_pool.py                # ★新增
│   │   ├── test_trope_pool.py               # ★新增
│   │   ├── test_mutation_engine.py          # ★新增
│   │   ├── test_contradiction_engine.py     # ★新增
│   │   ├── test_whatif_engine.py            # ★新增
│   │   ├── test_genre_fusion_engine.py      # ★新增
│   │   └── test_novelty_evaluator.py        # ★新增
│   ├── test_branch_simulator.py             # ★新增：分支模拟引擎测试
│   ├── test_semantic_precheck.py            # ★新增：语义预检测试
│   ├── test_inspiration_router.py           # ★新增：灵感路由器测试
│   ├── test_growth_workshop.py              # ★新增：成长工坊测试
│   ├── test_exemption.py                    # ★新增：创新豁免测试
│   ├── test_style_sandbox.py                # ★新增：风格沙盒测试
│   ├── test_user_edit_assist.py             # ★新增：用户编辑辅助测试
│   └── test_creative_canvas.py              # ★新增：创意画布集成测试
│
└── projects/{id}/
    ├── project.json                         # 不变
    ├── characters.json                      # 修改：+ growth_workshop_discussion 字段
    ├── progress.json                        # 修改：+ exemptions 数组字段
    ├── creative_os/                         # ★新增目录
    │   ├── idea_pool.json                   # ★新增：灵感种子库
    │   ├── trope_pool.json                  # ★新增：套路模式库（项目级快照）
    │   ├── canvas_state.json               # ★新增：创意画布当前状态
    │   ├── branch_simulations/              # ★新增：分支模拟历史
    │   │   └── sim_{timestamp}.json
    │   └── exemption_antipatterns.json      # ★新增：豁免反例记录
    ├── storyos/                             # 不变
    ├── memory/                              # 不变
    ├── chapter_reviews/                     # 不变
    ├── chapters/                            # 不变
    └── style/
        ├── extracted_style.yaml             # 不变
        ├── stats/                           # 不变
        └── custom/                          # ★新增：自定义风格配置
            └── {style_name}.style.yaml
```


## 四、后端模块详细规格（v1.7 增量）

### 4.1 CreativeOS 引擎模块

#### 4.1.1 灵感种子库（Idea Pool）— `creative_os/idea_pool.py`

**职责：** 项目级灵感 CRUD，支持按类别/来源阶段/关联元素筛选。灵感路由器（F1.7.7）自动写入，用户可手动管理。

**核心类：**
```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

class IdeaCategory(str, Enum):
    SETTING = "设定灵感"
    PLOT = "剧情想法"
    CHARACTER = "角色灵感"
    STYLE = "风格偏好"
    WRITING = "写作灵感"

@dataclass
class Idea:
    id: str                              # "idea_001"
    content: str                         # 灵感文本
    category: IdeaCategory
    source_stage: str                    # "STAGE_1" / "MANUAL" / "INSPIRATION_ROUTER"
    source_context: str                  # 来源上下文描述
    related_elements: list[str]          # ["power_system", "character_林峰"]
    confidence: float                    # 0.0-1.0，灵感路由器分类置信度
    status: str = "active"              # active / promoted / archived
    created_at: str = ""                # ISO 8601
    updated_at: str = ""

class IdeaPool:
    def __init__(self, project_dir: Path) -> None: ...
    def add(self, idea: Idea) -> None: ...
    def list(self, category: Optional[IdeaCategory] = None,
             source_stage: Optional[str] = None,
             status: str = "active") -> list[Idea]: ...
    def get(self, idea_id: str) -> Optional[Idea]: ...
    def update(self, idea_id: str, **kwargs) -> None: ...
    def delete(self, idea_id: str) -> None: ...
    def promote(self, idea_id: str) -> None: ...       # 提升为高优先级
    def archive(self, idea_id: str) -> None: ...
    def filter_by_element(self, element: str) -> list[Idea]: ...  # 按关联元素筛选
```

**存储：** `<project_dir>/creative_os/idea_pool.json`，单文件 JSON 数组。

**确定性：** 全部操作零 LLM。

#### 4.1.2 套路模式库（Trope Pool）— `creative_os/trope_pool.py`

**职责：** 管理网文常见套路及其市场饱和度数据。项目创建时从 `config/trope_catalog.yaml` 系统快照继承。为 Novelty Evaluator 提供饱和度查询。

**核心类：**
```python
@dataclass
class Trope:
    id: str
    name: str
    category: str
    description: str
    market_saturation: float            # 0.0-1.0，越高越饱和
    sub_tropes: list[str]
    common_combinations: list[str]
    novelty_penalty_weight: float = 1.0

class TropePool:
    def __init__(self, project_dir: Path, catalog_path: Path) -> None: ...
    def get_saturation(self, trope_id: str) -> float: ...
    def get_saturation_by_tags(self, tags: list[str]) -> float: ...  # 多标签平均饱和度
    def match_tropes(self, tags: list[str]) -> list[Trope]: ...
    def list_categories(self) -> list[str]: ...
    def update_saturation(self, trope_id: str, new_value: float, source: str = "user") -> None: ...
    def get_vector_index(self) -> dict[str, np.ndarray]: ...  # 套路嵌入向量索引，用于余弦相似度计算
```

**存储：** `<project_dir>/creative_os/trope_pool.json`（项目级快照），`config/trope_catalog.yaml`（系统基线）。

**确定性：** 全部操作零 LLM（向量索引预计算）。

#### 4.1.3 套路变异器（Mutation Engine）— `creative_os/mutation_engine.py`

**职责：** 对套路执行四种变异操作。LLM 调用（Tier 1），在创意画布中用户主动触发。

**核心类：**
```python
from enum import Enum

class MutationOp(str, Enum):
    INVERSION = "inversion"
    FUSION = "fusion"
    ESCALATION = "escalation"
    SUBVERSION = "subversion"

@dataclass
class MutationResult:
    operation: MutationOp
    source_trope_id: str
    source_trope_name: str
    core_premise: str
    core_conflict: str
    novelty_hook: str
    self_consistency_check: str
    tokens_used: int

class MutationEngine:
    def __init__(self, model_router: ModelRouter) -> None: ...
    def mutate(self, trope: Trope, op: MutationOp,
              context: str = "") -> MutationResult: ...
    def fuse(self, trope_a: Trope, trope_b: Trope) -> MutationResult: ...
```

**LLM 配置：** Tier 1（Claude Opus 4 / DeepSeek V4），Prompt 路径 `prompts/creative/mutation_operation.yaml`。输入 ~2K tokens，输出 ~0.5K tokens。

#### 4.1.4 矛盾设定生成器（Contradiction Engine）— `creative_os/contradiction_engine.py`

**职责：** 基于 5 个内置矛盾模板生成核心矛盾的详细展开。LLM 调用（Tier 1）和确定性评分两部分。

**核心类：**
```python
class ContradictionTemplate(str, Enum):
    ABILITY_VS_LIMIT = "能力×限制"
    ETERNAL_VS_FLEETING = "永恒×消逝"
    IDENTITY_VS_SECRET = "身份×秘密"
    GOAL_VS_COST = "目标×代价"
    POWER_AS_WEAKNESS = "力量即弱点"

@dataclass
class ContradictionExpansion:
    template: ContradictionTemplate
    element_a: str                         # 矛盾的第一极（模板决定含义，如能力/永恒/身份/目标/力量）
    element_b: str                         # 矛盾的第二极（模板决定含义，如限制/消逝/秘密/代价/弱点）
    core_tension: str                      # 两极之间的核心张力描述
    character_implications: list[str]
    plot_implications: list[str]
    thematic_depth: str
    tokens_used: int

class ContradictionEngine:
    def __init__(self, model_router: ModelRouter) -> None: ...
    def expand(self, template: ContradictionTemplate,
              context: str = "") -> ContradictionExpansion: ...
    def score_depth(self, text: str) -> int: ...              # 确定性正则评分（零 LLM）
    def detect_templates(self, text: str) -> list[tuple[ContradictionTemplate, float]]: ...
        """正则匹配文本中出现的矛盾模板 + 置信度"""
```

**LLM 配置：** Tier 1，Prompt 路径 `prompts/creative/contradiction_expand.yaml`。输入 ~2K tokens，输出 ~0.8K tokens。

**确定性部分：** `score_depth()` 和 `detect_templates()` 零 LLM，正则匹配 5 个模板 + 额外关键词加分。

#### 4.1.5 连续发散器（WhatIf Engine）— `creative_os/whatif_engine.py`

**职责：** 从核心前提出发递归构建发散树。支持懒惰加载（仅生成用户展开的节点）。

**核心类：**
```python
@dataclass
class WhatIfNode:
    id: str                              # "wi_001_02"
    depth: int
    parent_id: Optional[str]
    content: str
    dimension: str                       # "角色动机" | "世界观规则" | "情节方向" | "读者体验"
    novelty_score: float
    trope_tags: list[str]
    saturation_warning: Optional[str]    # None | "红海" | "蓝海"
    children_ids: list[str] = field(default_factory=list)
    is_expanded: bool = False            # 懒惰加载标记

class WhatIfEngine:
    MAX_DEPTH = 3
    BREADTH = 4

    def __init__(self, model_router: ModelRouter,
                 novelty_evaluator: NoveltyEvaluator) -> None: ...
    def generate_root(self, premise: str) -> WhatIfNode: ...
    def expand_node(self, node: WhatIfNode, path_context: str = "") -> list[WhatIfNode]: ...
        """展开一个节点，生成 4 个子节点。懒惰加载。"""
    def precompute_leaves(self, node: WhatIfNode) -> list[WhatIfNode]: ...
        """Tier 3 预计算叶子节点（深度 3），用户展开时升级为 Tier 1 重生成。"""
    def regenerate_node(self, node: WhatIfNode, tier: str = "tier_1") -> WhatIfNode: ...
        """用指定 Tier 重新生成节点内容。"""
```

**LLM 配置：**
- 用户主动展开：Tier 1，Prompt 路径 `prompts/creative/whatif_expand.yaml`。输入 ~1K tokens，输出 ~0.3K tokens / 节点。
- 预计算叶子节点：Tier 3，同 Prompt。成本优先。

**约束规则（Prompt 中注入）：**
1. 子节点必须是父节点的直接逻辑推论
2. 子节点覆盖不同叙事维度（角色动机 / 世界观规则 / 情节方向 / 读者体验）
3. 叶子节点聚焦"可写的场景钩子"

#### 4.1.6 体裁融合器（Genre Fusion Engine）— `creative_os/genre_fusion_engine.py`

**职责：** 分析两个体裁在结构特征层面的融合可能性，生成融合方案。

**核心类：**
```python
@dataclass
class FusionAnalysis:
    genre_a: str
    genre_b: str
    compatibility: str                         # "高" | "中" | "低"
    genre_distance: int                        # BFS 距离
    fusion_points: dict[str, str]              # 维度 → 融合建议
    # 维度示例: "narrative_rhythm", "character_archetype",
    #          "conflict_type", "world_rules", "emotion_curve"
    caution_areas: list[str]                   # 融合风险提示
    tokens_used: int

class GenreFusionEngine:
    # 体裁兼容性矩阵（硬编码，7×7）
    COMPATIBILITY_MATRIX: dict[str, dict[str, str]]  # "高" | "中" | "低"

    def __init__(self, model_router: ModelRouter) -> None: ...
    def get_compatibility(self, genre_a: str, genre_b: str) -> str: ...
    def compute_distance(self, genre_a: str, genre_b: str) -> int: ...
        """BFS 计算体裁距离。"""
    def analyze_fusion(self, genre_a: str, genre_b: str,
                       premise: str = "") -> FusionAnalysis: ...
        """LLM 分析融合点：叙事节奏/角色原型/冲突类型/世界观规则/情感曲线。"""
```

**LLM 配置：** Tier 1，Prompt 路径 `prompts/creative/genre_fusion.yaml`。输入 ~3K tokens，输出 ~1K tokens。

**体裁距离加成：** BFS 距离 ≥ 3 时，Novelty Evaluator 市场饱和度得分获得 1.2× 加成。

#### 4.1.7 新颖度评估器（Novelty Evaluator）— `creative_os/novelty_evaluator.py`

**职责：** 从 4 个维度量化创意的新颖度，3/4 维确定性计算，仅标签提取使用 Tier 3 LLM。

**核心类：**
```python
@dataclass
class NoveltyScore:
    total: float                         # 0-100
    market_saturation_score: float       # 30% 权重
    trope_similarity_score: float        # 25% 权重
    contradiction_depth_score: float     # 25% 权重
    discussion_potential_score: float    # 20% 权重
    grade: str                           # "高新颖度" | "中等" | "偏低" | "低"
    saturation_warnings: list[str]       # 高饱和度套路标签列表
    blue_ocean_tags: list[str]           # 低饱和度高新颖度方向

class NoveltyEvaluator:
    CONTROVERSY_KEYWORDS = {
        "道德困境": 8, "身份政治": 7, "存在主义": 6,
        "宿命论": 6, "牺牲": 5, "背叛": 4,
    }

    def __init__(self, trope_pool: TropePool,
                 model_router: ModelRouter,
                 embedder: Embedder) -> None: ...      # 复用 v1.6 bge-m3 embedder

    def evaluate(self, content: str) -> NoveltyScore:
        """主入口：执行完整四维评估。"""
        # 1. 市场饱和度（30%）：Tier 3 标签提取 → Trope Pool 饱和度查询
        tags = self._extract_trope_tags(content)        # Tier 3 LLM，~50 tokens
        mkt_score = self._calc_market_saturation(tags)

        # 2. 套路相似度（25%）：bge-m3 嵌入 → 余弦相似度（确定性）
        embedding = self.embedder.encode(content)
        sim_score = self._calc_similarity(embedding)

        # 3. 矛盾深度（25%）：正则匹配 5 模板 + 关键词加分（确定性）
        contra_score = self.contradiction_engine.score_depth(content)

        # 4. 讨论潜力（20%）：关键词匹配 + 身份冲突评分（确定性）
        disc_score = self._calc_discussion_potential(content)

        total = (mkt_score * 0.30 + sim_score * 0.25 +
                 contra_score * 0.25 + disc_score * 0.20)
        ...

    def evaluate_node(self, node: WhatIfNode) -> NoveltyScore: ...
        """评估 WhatIf 节点的新颖度（轻量包装）。"""
```

**确定性：** 4 维中 3 维（套路相似度、矛盾深度、讨论潜力）零 LLM → 75% 权重确定性。

**可复现性：** 同一 content 输入多次评分误差 < ±5 分（LLM 标签提取使用 temperature=0.3）。

### 4.2 分支模拟引擎 — `conductor/branch_simulator.py`

**职责：** 接收用户的分支变更描述，输出 BranchSimulationReport。两阶段：确定性计算（即时）+ LLM 推理（异步，含置信度标注）。

**核心类：**
```python
@dataclass
class LLMInference:
    """LLM 推理结果，封装置信度标注。"""
    content: str           # 推理文本
    confidence: str        # "medium"（🟡中置信度）| "low"（🟠低置信度）
    model: str             # 模型 ID
    tokens_used: int

@dataclass
class BranchSimulationReport:
    branch_point_description: str
    # 确定性部分（零 LLM，即时）
    affected_chapter_range: tuple[int, int]
    affected_characters: list[str]
    affected_foreshadowings: list[str]
    growth_curve_shifts: dict[str, int]    # character_id → chapter_offset
    # LLM 推理部分（含置信度标注）
    tension_curve_projection: LLMInference       # 🟡 中置信度
    foreshadowing_risk_assessment: LLMInference  # 🟡 中置信度
    alternative_suggestions: LLMInference        # 🟠 低置信度
    reader_metrics_projection: dict[str, str]    # 指标名 → "↑12" / "↓5" / "→"
    # 元数据
    created_at: str
    tokens_used_total: int

class BranchSimulator:
    def __init__(self, projects_dir: Path, model_router: ModelRouter,
                 impact_analyzer: ImpactAnalyzer) -> None: ...

    def simulate(self, project_id: str, branch_description: str) -> BranchSimulationReport:
        """主入口：执行两阶段分析。"""
        # Phase 1: 确定性计算（复用 ImpactAnalyzer）
        deterministic = self._run_deterministic_analysis(project_id, branch_description)

        # Phase 2: LLM 推理（4 项，Tier 2）
        llm_results = self._run_llm_inference(project_id, branch_description, deterministic)

        return BranchSimulationReport(...)

    def _run_deterministic_analysis(self, project_id: str, desc: str) -> dict: ...
    def _run_llm_inference(self, project_id: str, desc: str, det: dict) -> dict: ...
```

**LLM 配置：** Tier 2（Claude Sonnet 4），Prompt 路径 `prompts/branch_simulation_llm.yaml`。输入 ~3K tokens，输出 ~1K tokens。

### 4.3 语义完整性预检 — `semantic_precheck/prechecker.py`

**职责：** 在 Fact Guard 之前运行，Tier 3 轻量检测 Writer 可能遗漏的 SF_LOG 标记。仅建议，不阻断。

**核心类：**
```python
@dataclass
class PrecheckSuggestion:
    type: str = "missing_sf_log"
    severity: str = "suggestion"
    event_type: str                      # "twist_reveal" | "registry_create" | "character_relation_change"
    location_hint: str                   # 文本中相关段落的位置提示
    suggested_tag: str                   # 建议添加的 SF_LOG 标记完整文本
    reason: str

@dataclass
class PrecheckResult:
    precheck_passed: bool                # 无建议时 True
    suggestions: list[PrecheckSuggestion]
    tokens_used: int

class SemanticPrechecker:
    # 仅检测 3 种高重要性事件类型
    TARGET_EVENT_TYPES = [
        "twist_reveal",
        "registry_create",
        "character_relation_change",
    ]

    def __init__(self, model_router: ModelRouter) -> None: ...

    def check(self, scene_text: str, scene_plan: dict,
              character_names: list[str]) -> PrecheckResult: ...
        """主入口：分析 Scene 文本，返回建议列表。"""
```

**LLM 配置：** Tier 3（Claude Haiku），Prompt 路径 `prompts/semantic_precheck.yaml`。输入 ~500 tokens，输出 ~100 tokens。

**阻断策略：** ❌ 不阻断。建议在 Reviewer 中 info 级别展示。

### 4.4 灵感路由器 — `inspiration/router.py`

**职责：** 在 Agent 对话完成时被动触发，捕捉用户交互中的灵感，分类后写入 Idea Pool。

**核心类：**
```python
@dataclass
class InspirationCapture:
    content: str
    category: str                        # IdeaCategory
    confidence: float
    tags: list[str]                      # 多标签（跨类标记时）
    source_stage: str
    source_context: str

class InspirationRouter:
    def __init__(self, model_router: ModelRouter, idea_pool: IdeaPool) -> None: ...

    def capture(self, text: str, stage: str, context: str = "") -> Optional[InspirationCapture]:
        """分析一段文本，判断是否包含灵感。返回 None 表示无灵感。"""
        # Tier 3 分类器 → 置信度逻辑 → 分类决策
        ...

    def classify(self, text: str) -> dict[str, float]:
        """Tier 3 分类：输入文本 → 5 类别置信度分布。"""

    def resolve_conflict(self, scores: dict[str, float]) -> list[str]:
        """多分类冲突处理逻辑（确定性）。"""

    def correct(self, capture_id: str, new_category: str) -> None:
        """用户纠错：重新分类。"""

    def split(self, capture_id: str) -> list[str]: ...
    def merge(self, capture_ids: list[str]) -> str: ...
    def mark_invalid(self, capture_id: str) -> None: ...
```

**LLM 配置：** Tier 3（Claude Haiku），Prompt 路径 `prompts/inspiration_classify.yaml`。输入 ~50 tokens，输出 ~30 tokens / 次。

**分类冲突处理（确定性逻辑）：**
- 高置信度（≥0.8）单一分类 → 直接归类
- 中置信度（0.5-0.8）→ 归类 + "待确认"标签
- 多分类差距 > 0.3 → 归类到最高置信度
- 多分类差距 ≤ 0.3 → 多标签"跨类"标记

### 4.5 风格沙盒 — 使用现有 Style Engine + 新 API

**职责：** 复用 Style Engine L2 写作公式的定量规则作为 prompt 约束，Tier 3 轻量模型进行文本风格化渲染。

**核心类（在 `backend/api/style_extractor.py` 中新增端点）：**
```python
@dataclass
class SandboxPreviewRequest:
    text: str                            # 原始测试文本（~500 字）
    params: SandboxParams                # 可调参数

@dataclass
class SandboxParams:
    sentence: SentenceParams
    dialogue: DialogueParams
    rhythm: RhythmParams
    density: DensityParams
    satisfaction: SatisfactionParams

@dataclass
class SandboxPreviewResponse:
    original_text: str
    rendered_text: str
    params_applied: SandboxParams
    tokens_used: int
```

**LLM 配置：** Tier 3（Claude Haiku）。输入 ~800 tokens（测试文本 + 参数描述），输出 ~600 tokens（渲染文本）。

**存储：** 自定义风格配置保存为 `<project_dir>/style/custom/{name}.style.yaml`。

### 4.6 创新豁免 — `backend/agents/writer.py` 扩展 + `backend/models/exemption.py`

**职责：** Writer 检测约束冲突时生成豁免申请；用户审批后 Reviewer 调整规则检测范围。

**核心类：**
```python
@dataclass
class ExemptionRequest:
    id: str
    scene_id: str
    requested_by: str = "writer"
    rule_to_break: dict                  # {layer, rule_id, rule_description, constraint_type}
    creative_intent: str
    expected_effect: str
    status: str = "pending"             # pending / approved / rejected
    requested_at: str
    approved_by: Optional[str] = None
    outcome: Optional[str] = None       # "excellent" | "good" | "poor" | None

@dataclass
class ExemptionAntipattern:
    rule_id: str
    creative_intent_pattern: str        # 相似创作意图的关键词
    count: int                          # 反例数量
    representative_case: str            # 代表性案例摘要

class ExemptionManager:
    def __init__(self, project_dir: Path) -> None: ...
    def submit(self, request: ExemptionRequest) -> None: ...
    def approve(self, exemption_id: str, approved_by: str) -> None: ...
    def reject(self, exemption_id: str, reason: str) -> None: ...
    def evaluate_outcome(self, exemption_id: str, outcome: str) -> None: ...
    def check_antipatterns(self, rule_id: str, intent: str) -> list[ExemptionAntipattern]: ...
        """纯规则匹配，零 ML。"""
    def is_exempted(self, scene_id: str, rule_id: str) -> bool: ...
        """Scene 是否对某规则豁免。"""
```

**存储：**
- 豁免记录：`<project_dir>/progress.json` 的 `exemptions` 数组
- 反例记录：`<project_dir>/creative_os/exemption_antipatterns.json`

### 4.7 成长工坊 — `backend/agents/character_designer.py` + API

**职责：** Character Designer Agent 引导讨论；一致性检查为确定性规则。

**一致性检查规则（确定性，零 LLM）：**
```python
@dataclass
class ConsistencyIssue:
    severity: str                              # "warning" | "error"
    message: str                               # 人类可读的问题描述
    chapter_number: Optional[int] = None       # 关联的章节号
    stage_name: Optional[str] = None           # 关联的成长阶段名称

class GrowthConsistencyChecker:
    def check(self, stages: list[GrowthStage], outline: dict,
              total_chapters: int) -> list[ConsistencyIssue]:
        issues = []
        for stage in stages:
            # 1. 转折点章节缺失剧情事件
            if not self._has_matching_event(stage, outline):
                issues.append(ConsistencyIssue("warning", f"第{stage.chapter_number}章无匹配的{stage.trigger_event_type}事件"))

            # 2. 低谷与冲突不同步
            if stage.stage_name == "低谷" and not self._has_high_intensity_conflict(stage, outline):
                issues.append(ConsistencyIssue("warning", f"低谷章节{stage.chapter_number}无高烈度冲突"))

        # 3. 转折点间隔过密
        for i in range(len(stages) - 1):
            if stages[i+1].chapter_number - stages[i].chapter_number < 2:
                issues.append(ConsistencyIssue("warning", f"转折点间隔过密：第{stages[i].chapter_number}→{stages[i+1].chapter_number}章"))

        # 4. 终点超出范围
        if stages and stages[-1].chapter_number > total_chapters:
            issues.append(ConsistencyIssue("error", f"终点章节{stages[-1].chapter_number}超出总章数{total_chapters}"))

        # 5. 事件类型不匹配
        VALID_TRIGGERS = {"betrayal_experienced", "death_of_loved_one", ...}
        for stage in stages:
            if stage.trigger_event_type not in VALID_TRIGGERS:
                issues.append(ConsistencyIssue("error", f"无效的触发事件类型：{stage.trigger_event_type}"))

        return issues
```

**LLM 配置（Agent 讨论）：** Tier 1（Claude Opus 4 / DeepSeek V4），Prompt 路径 `prompts/growth_workshop_discuss.yaml`。输入 ~4K tokens，输出 ~1.5K tokens。

### 4.8 用户编辑辅助 — `backend/agents/storyos_agent.py` 扩展

**职责：** 分析用户手动修改的 Scene 文本，生成 SF_LOG 建议。

**核心逻辑：**
```python
@dataclass
class SFLogSuggestion:
    type: str                                  # "missing" | "deleted" | "modified"
    severity: str                              # "warning" | "suggestion"
    event_type: str                            # SF_LOG 类型
    suggested_tag: str                         # 建议添加/修改的完整 SF_LOG 标记
    location_hint: str                         # 文本中相关段落的位置提示
    reason: str                                # 建议理由

@dataclass
class SFLogDiffReport:
    original_text: str
    modified_text: str
    deleted_logs: list[dict]                   # 被删除的 SF_LOG 标记
    suggestions: list[SFLogSuggestion]         # 新增/修改建议
    tokens_used: int

class SFLogSuggestionEngine:
    def __init__(self, model_router: ModelRouter) -> None: ...

    def analyze_diff(self, original_text: str, modified_text: str,
                    existing_sf_logs: list[dict],
                    character_names: list[str]) -> SFLogDiffReport:
        """
        Step 1: 文本 Diff → 定位变更段落
        Step 2: SF_LOG 影响分析
          - 删除的 SF_LOG → 🔴 警告
          - 新增内容隐含叙事变化 → Tier 3 分析 → 🟡 建议
          - 修改内容改变已有标记参数 → 🟡 建议
        Step 3: 生成 SFLogDiffReport
        """
        ...

    def apply_suggestions(self, text: str, suggestions: list[SFLogSuggestion]) -> str:
        """将建议的 SF_LOG 标记插入文本中。"""
        ...
```

**LLM 配置：** Tier 3（Claude Haiku），Prompt 路径 `prompts/sf_log_suggestion.yaml`。输入 ~500 tokens，输出 ~100 tokens。

### 4.9 Agent 层扩展

#### 4.9.1 Creative Director — `agents/creative_director.py`（新增）

```python
class CreativeDirector(BaseAgent):
    """创意画布引导 Agent。"""
    AGENT_NAME = "creative_director"

    def suggest_direction(self, current_node: WhatIfNode,
                         canvas_state: dict) -> str: ...
        """基于当前节点和画布状态，建议发散方向。Tier 1。"""

    def recommend_mutation(self, node: WhatIfNode) -> MutationOp: ...
        """推荐最适合当前节点的变异操作。Tier 3。"""

    def evaluate_path(self, path_nodes: list[WhatIfNode]) -> str: ...
        """评估选定路径的整体叙事潜力。Tier 1。"""
```

#### 4.9.2 Character Designer — `agents/character_designer.py`（新增）

```python
class CharacterDesigner(BaseAgent):
    """角色设计师 Agent（成长工坊协同讨论）。"""
    AGENT_NAME = "character_designer"

    def discuss_growth_curve(self, character: dict, outline: dict,
                            conversation_history: list[dict]) -> str: ...
        """引导讨论成长曲线设计。Tier 1。"""

    def analyze_arc(self, character: dict) -> str: ...
        """分析角色弧线的合理性和强度。Tier 2。"""
```

#### 4.9.3 现有 Agent 修改

| Agent | 修改内容 | 影响范围 |
|---|---|---|
| **Planner** | `concept_generation` 任务增加 `mode` 参数（"quick"/"canvas"）；新增 `creative_brainstorming` 任务；新增 `whatif_expansion` 任务；新增 `novelty_evaluation` 任务（LLM 标签提取部分） | `agents/planner.py` + `prompts/creative/` |
| **Writer** | 在 Scene 写作完成后、提交 Fact Guard 前，检测约束冲突 → 如果冲突且有创作意图 → 调用 `ExemptionManager.submit()` | `agents/writer.py` |
| **Reviewer** | `review_scene()` 增加语义预检步骤（在 Fact Guard 之前）；组装豁免审批 UI 数据；组装预检建议展示数据 | `agents/reviewer.py` |
| **StoryOS Agent** | `update_registries()` 增加用户编辑辅助入口函数；新增 `SFLogSuggestionEngine` | `agents/storyos_agent.py` |
| **BaseAgent** | 增加 `exemption_request()` 基础方法 | `agents/base_agent.py` |


## 五、API 设计（v1.7 新增/变更）

### 5.1 创意画布 API（新路由文件）

**路由文件：** `backend/api/creative_canvas.py`
**路由前缀：** `/api/v1/projects/{project_id}/creative/canvas`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/expand` | `{node_id, tier?}` | `{nodes: [WhatIfNode]}` | 展开某节点的 4 个子节点 |
| `POST` | `/mutate` | `{node_id, operation}` | `{node: WhatIfNode}` | 对节点执行变异操作 |
| `POST` | `/merge` | `{node_id_a, node_id_b}` | `{node: WhatIfNode}` | 融合两个分支 |
| `POST` | `/evaluate` | `{node_id}` | `{score: NoveltyScore}` | 重新评估节点新颖度 |
| `POST` | `/select` | `{path_node_ids: [str]}` | `{story_dna: dict}` | 选定路径 → 序列化 Story DNA |
| `GET` | `/state` | — | `{nodes, edges, selected_path}` | 获取当前画布完整状态 |

### 5.2 分支模拟 API（修改现有路由）

**路由文件：** `backend/api/stage3_outline.py`（追加端点）
**路由前缀：** `/api/v1/projects/{project_id}/branches`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/simulate` | `{description: str}` | `BranchSimulationReport` | 提交分支描述，启动两阶段分析 |
| `GET` | `/history` | — | `[{id, description, created_at}]` | 获取分支模拟历史记录 |

### 5.3 风格沙盒 API（修改现有路由）

**路由文件：** `backend/api/style_extractor.py`（追加端点）
**路由前缀：** `/api/v1/projects/{project_id}/style/sandbox`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/preview` | `{text, params: SandboxParams}` | `SandboxPreviewResponse` | 风格化渲染预览 |
| `POST` | `/save` | `{name, params: SandboxParams}` | `{path: str}` | 保存为自定义风格配置 |
| `GET` | `/configs` | — | `[{name, path, created_at}]` | 获取已有自定义风格配置列表 |

### 5.4 成长工坊 API（修改现有路由）

**路由文件：** `backend/api/stage2_world_char.py`（追加端点）
**路由前缀：** `/api/v1/projects/{project_id}/characters/{character_id}/growth/workshop`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/check` | `{stages: [GrowthStage]}` | `{issues: [ConsistencyIssue]}` | 一致性检查（确定性） |
| `POST` | `/discuss` | `{message: str, history: [...]}` | `{reply: str}` | Agent 讨论（Tier 1） |
| `PUT` | `/adjust` | `{stages: [GrowthStage]}` | `{character: dict}` | 保存调整后的成长曲线 |

### 5.5 用户编辑辅助 API（修改现有路由）

**路由文件：** `backend/api/stage4_writing.py`（追加端点）
**路由前缀：** `/api/v1/projects/{project_id}/scenes/{scene_id}`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/sf-log-suggestions` | `{original_text, modified_text}` | `SFLogDiffReport` | 分析修改，返回 SF_LOG 建议 |
| `PUT` | `/sf-logs` | `{suggestions: [...]}` | `{updated_text: str}` | 批量应用建议的 SF_LOG 标记 |

### 5.6 创新豁免 API（修改现有路由）

**路由文件：** `backend/api/stage4_writing.py`（追加端点）
**路由前缀：** `/api/v1/projects/{project_id}/exemptions`

| 方法 | 端点 | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| `POST` | `/` | `ExemptionRequest` | `{id: str}` | 提交豁免申请 |
| `PUT` | `/{id}/approve` | `{approved_by: str}` | `{status: "approved"}` | 批准豁免 |
| `PUT` | `/{id}/reject` | `{reason: str}` | `{status: "rejected"}` | 拒绝豁免 |
| `PUT` | `/{id}/outcome` | `{outcome: str}` | `{status: str}` | 评价豁免效果（Scene 完成后） |
| `GET` | `/{id}/antipatterns` | — | `[ExemptionAntipattern]` | 查询相似豁免的历史反例 |

### 5.7 现有 API 修改摘要

| 路由文件 | 修改内容 |
|---|---|
| `stage1_concept.py` | `POST /generate` 增加查询参数 `?mode=quick|canvas`（默认 quick，保持向后兼容） |
| `stage4_writing.py` | `POST /scenes/{id}/write` 响应体中增加 `precheck_result` 和 `exemption_request` 字段 |
| `settings_api.py` | `GET/PUT /settings` 增加 `inspiration_router` 和 `exemption_antipatterns_view` 配置项 |


## 六、前端页面规格（v1.7 增量）

### 6.1 新建页面：CreativeCanvasPage

**路由：** `/project/:id/stage1/canvas`
**核心组件：** WhatIfTree + NoveltyIndicator
**状态管理：** `useCreativeCanvas` hook

**页面布局：**
```
┌─────────────────────────────────────────────────────┐
│  [← 返回 STAGE 1]  创意画布  [导出画布] [重置]      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌───────────────────────┐  ┌────────────────────┐  │
│  │    WhatIfTree          │  │  NoveltyIndicator   │  │
│  │    (React Flow)        │  │  (Recharts 雷达图)  │  │
│  │                        │  │                     │  │
│  │  [根]─→[子1]─→[孙1]   │  │  市场饱和度: 72     │  │
│  │   │    ├→[子2]─→[孙2] │  │  套路相似度: 65     │  │
│  │   │    └→[子3]         │  │  矛盾深度:   80     │  │
│  │   └→[手动节点]         │  │  讨论潜力:   70     │  │
│  │                        │  │  综合: 🟡 71分      │  │
│  └───────────────────────┘  └────────────────────┘  │
│                                                      │
│  📊 选定路径新颖度趋势：72 → 85 → 88（上升 ✓）       │
│  ⚠️ 节点 wi_001_03 套路饱和度较高 [红海]             │
│  💡 建议：对节点 wi_001_02 尝试 Inversion 变异       │
│                                                      │
│  [选定当前路径 → 生成 Story DNA]                      │
└─────────────────────────────────────────────────────┘
```

### 6.2 改造页面摘要

| 页面 | 新增 Tab/面板 | 新增组件 | API 调用 |
|---|---|---|---|
| **Stage1Page** | 模式切换（快速模式 / 创意画布） | 模式切换按钮 | `?mode=canvas` 重定向到 CreativeCanvasPage |
| **Stage2Page** | 成长工坊 Tab | GrowthCurveVisualizer + 讨论聊天 + 一致性检查结果列表 | `POST /check` + `POST /discuss` + `PUT /adjust` |
| **Stage3Page** | 分支模拟面板（侧边栏） | BranchSimulationPanel + ConfidenceBadge | `POST /branches/simulate` |
| **Stage4Page** | 叙事影响分析按钮 + 预检结果区域 + 豁免审批卡片 | SFLogSuggestionPanel + ExemptionCard | `POST /sf-log-suggestions` + 豁免系列端点 |
| **StyleSandboxPage** | 完整功能：参数滑块 + 文本输入 + 预览并排 | PreviewComparison | `POST /style/sandbox/preview` + `POST /save` |
| **SettingsPage** | 灵感路由器配置区 + 豁免反例查看区 | 开关/滑块 + 反例列表 | `PUT /settings` + `GET /exemptions/{id}/antipatterns` |

### 6.3 新增 hooks

| Hook | 管理状态 | 主要方法 |
|---|---|---|
| `useCreativeCanvas` | 画布树结构、展开状态、选中路径、新颖度评分缓存 | `expandNode(id)` `mutateNode(id, op)` `mergeNodes(a, b)` `selectPath(ids)` `evaluateNode(id)` |
| `useBranchSimulation` | 模拟请求状态、结果（确定性 + LLM）、加载状态 | `simulate(description)` `getHistory()` |
| `useGrowthWorkshop` | 讨论历史、一致性检查结果、曲线编辑状态 | `check(stages)` `discuss(message)` `adjust(stages)` |


## 七、Prompt 设计变更

### 7.1 新增 Prompt 文件

| Prompt 文件 | 使用方 | Tier | 关键变量 | 输出要求 |
|---|---|---|---|---|
| `creative/whatif_expand.yaml` | WhatIf Engine | 1/3 | `{premise} {parent_content} {parent_context} {path_summary} {dimension}` | 4 个 JSON 格式子节点 |
| `creative/mutation_operation.yaml` | Mutation Engine | 1 | `{trope_name} {trope_description} {operation} {context}` | JSON：core_premise / core_conflict / novelty_hook / self_consistency_check |
| `creative/contradiction_expand.yaml` | Contradiction Engine | 1 | `{template_name} {template_structure} {context}` | JSON：element_a/element_b/core_tension/character_implications/plot_implications/thematic_depth |
| `creative/genre_fusion.yaml` | Genre Fusion Engine | 1 | `{genre_a} {genre_b} {compatibility} {genre_distance} {premise}` | JSON：rhythm/prototype/conflict/world_rules/emotion_curve fusion points |
| `creative/trope_extraction.yaml` | Novelty Evaluator | 3 | `{content}` | JSON：trope_tags 数组 |
| `creative/novelty_evaluation_llm.yaml` | Novelty Evaluator | 3 | `{content} {extracted_tags}` | JSON：辅助判断 |
| `semantic_precheck.yaml` | Semantic Prechecker | 3 | `{scene_text} {declared_changes} {character_names}` | JSON：suggestions 数组（限 3 种事件类型） |
| `inspiration_classify.yaml` | Inspiration Router | 3 | `{text} {stage}` | JSON：5 类别置信度分布 |
| `sf_log_suggestion.yaml` | SFLogSuggestionEngine | 3 | `{diff_text} {existing_logs} {character_names}` | JSON：suggestions 数组 |
| `growth_workshop_discuss.yaml` | Character Designer | 1 | `{character} {growth_curve} {outline_summary} {conversation_history}` | 自然语言回复 |
| `branch_simulation_llm.yaml` | Branch Simulator | 2 | `{branch_description} {deterministic_results} {outline_summary} {tension_curve_data}` | JSON：4 项推理结果 |
| `exemption_evaluate.yaml` | ExemptionManager | 3 | `{exemption} {scene_text} {reader_metrics}` | JSON：效果评分 + 建议 |

### 7.2 修改 Prompt 文件

| Prompt 文件 | 修改内容 |
|---|---|
| `concept_generation.yaml` | 增加 `mode` 变量（"quick" 使用现有 Prompt；"canvas" 时从画布路径序列化生成） |
| `character_generation.yaml` | 增加 `growth_workshop` 变量（成长工坊讨论上下文注入） |


## 八、数据模型变更

### 8.1 新增模型

| 模型文件 | 核心类 | 字段数 | 说明 |
|---|---|---|---|
| `creative_os.py` | `Idea` `Trope` `WhatIfNode` `MutationResult` `ContradictionExpansion` `FusionAnalysis` `NoveltyScore` | 各 5-12 字段 | CreativeOS 全部数据结构 |
| `branch_simulation.py` | `BranchSimulationReport` `LLMInference` | 11 + 4 | 分支模拟结果 + 置信度封装 |
| `exemption.py` | `ExemptionRequest` `ExemptionAntipattern` | 10 + 4 | 豁免申请 + 反例记录 |
| `sandbox.py` | `SandboxParams` `SandboxPreviewResponse` `StyleConfig` | 15 + 5 + 4 | 风格沙盒参数 + 预览 + 配置 |

### 8.2 修改模型

| 模型文件 | 新增/修改字段 | 说明 |
|---|---|---|
| `character.py` | `+ growth_workshop_discussion: list[dict]` | 成长工坊 Agent 讨论历史 |
| `progress.py` | `+ exemptions: list[ExemptionRequest]` | 项目级豁免记录 |
| `sf_log.py` | `+ precheck_result: Optional[PrecheckResult]` | 语义预检结果（Scene 级） |
| `impact_report.py` | `+ BranchSimulationReport`（类型引用） | 分支模拟报告模型 |


## 九、开发任务分解（v1.7）

### 第一阶段：CreativeOS 引擎核心（3 周）

| 编号 | 任务 | 优先级 | 预估工时 | 依赖 |
|---|---|---|---|---|
| T1.1 | 创建 `backend/creative_os/` 模块目录 + `__init__.py` | P0 | 0.5d | — |
| T1.2 | 实现 `idea_pool.py`（Idea CRUD + 筛选，全确定性） | P0 | 1d | T1.1 |
| T1.3 | 实现 `trope_pool.py`（Trope Pool + 饱和度查询 + 向量索引） | P0 | 1d | T1.1 |
| T1.4 | 创建 `config/trope_catalog.yaml`（50+ 套路模板初始数据） | P0 | 2d | — |
| T1.5 | 实现 `mutation_engine.py`（4 种操作 Prompt + LLM 调用） | P0 | 2d | T1.3 |
| T1.6 | 实现 `contradiction_engine.py`（5 模板展开 + 确定性评分） | P0 | 2d | — |
| T1.7 | 实现 `whatif_engine.py`（递归树算法 + 懒惰加载 + Tier 分档） | P0 | 3d | — |
| T1.8 | 实现 `genre_fusion_engine.py`（BFS 距离 + 兼容性矩阵 + 融合 Prompt） | P1 | 2d | — |
| T1.9 | 实现 `novelty_evaluator.py`（4 维评分，3/4 确定性） | P0 | 2d | T1.3 T1.6 |
| T1.10 | 编写 CreativeOS 单元测试（目标 ≥ 40 用例） | P0 | 3d | T1.2-T1.9 |
| T1.11 | 创建 6 个 CreativeOS Prompt YAML 文件 | P0 | 2d | T1.5-T1.9 |

### 第二阶段：创意画布 + 分支模拟（3 周）

| 编号 | 任务 | 优先级 | 预估工时 | 依赖 |
|---|---|---|---|---|
| T2.1 | 实现 `creative_director.py` Agent | P0 | 2d | T1.7 |
| T2.2 | 实现 `backend/api/creative_canvas.py`（6 端点） | P0 | 2d | T1.7 T1.9 |
| T2.3 | 实现 `conductor/branch_simulator.py`（确定性 + LLM 编排） | P0 | 2d | — |
| T2.4 | 实现分支模拟 API（`stage3_outline.py` 追加 2 端点） | P0 | 1d | T2.3 |
| T2.5 | 安装/配置 React Flow + Recharts 前端依赖 | P0 | 0.5d | — |
| T2.6 | 实现 `WhatIfTree.tsx`（React Flow 树图 + 交互操作） | P0 | 3d | T2.5 |
| T2.7 | 实现 `NoveltyIndicator.tsx`（Recharts 雷达图 + 红海/蓝海标注） | P0 | 1d | T2.5 |
| T2.8 | 实现 `CreativeCanvasPage.tsx`（完整页面） | P0 | 3d | T2.6 T2.7 |
| T2.9 | 实现 `useCreativeCanvas` hook | P0 | 1.5d | T2.2 |
| T2.10 | 实现 `BranchSimulationPanel.tsx` + `ConfidenceBadge.tsx` | P0 | 2d | T2.4 |
| T2.11 | 改造 `Stage1Page.tsx`（快速模式 / 画布模式切换） | P0 | 1d | T2.8 |
| T2.12 | 改造 `Stage3Page.tsx`（分支模拟面板入口） | P0 | 1d | T2.10 |
| T2.13 | 编写创意画布 + 分支模拟集成测试 | P0 | 2d | T2.1-T2.12 |

### 第三阶段：质量增强 + 写作辅助（2 周）

| 编号 | 任务 | 优先级 | 预估工时 | 依赖 |
|---|---|---|---|---|
| T3.1 | 实现 `semantic_precheck/prechecker.py` | P0 | 1.5d | — |
| T3.2 | 创建 `semantic_precheck.yaml` Prompt | P0 | 0.5d | — |
| T3.3 | 修改 `reviewer.py`：集成语义预检（Fact Guard 之前） | P0 | 1d | T3.1 |
| T3.4 | 修改 `stage4_writing.py`：Scene 写作响应体增加 precheck_result | P0 | 0.5d | T3.3 |
| T3.5 | 实现 `ExemptionManager` + 豁免数据模型 | P0 | 1.5d | — |
| T3.6 | 修改 `writer.py`：约束冲突检测 → 豁免申请逻辑 | P0 | 1.5d | T3.5 |
| T3.7 | 修改 `reviewer.py`：豁免审批 UI 数据组装 | P0 | 1d | T3.5 |
| T3.8 | 实现豁免系列 API 端点（`stage4_writing.py` 追加） | P0 | 1d | T3.5 |
| T3.9 | 实现 `SFLogSuggestionEngine`（`storyos_agent.py` 扩展） | P0 | 1.5d | — |
| T3.10 | 实现用户编辑辅助 API（`stage4_writing.py` 追加 2 端点） | P0 | 0.5d | T3.9 |
| T3.11 | 实现 `SFLogSuggestionPanel.tsx` + `ExemptionCard.tsx` | P0 | 2d | T3.8 T3.10 |
| T3.12 | 改造 `Stage4Page.tsx`（叙事影响分析 + 预检 + 豁免审批） | P0 | 2d | T3.11 |
| T3.13 | 编写质量增强功能测试 | P0 | 1.5d | T3.1-T3.12 |

### 第四阶段：风格沙盒 + 成长工坊 + 灵感路由器（2 周）

| 编号 | 任务 | 优先级 | 预估工时 | 依赖 |
|---|---|---|---|---|
| T4.1 | 实现风格沙盒 API（`style_extractor.py` 追加 3 端点） | P1 | 1.5d | — |
| T4.2 | 实现 `PreviewComparison.tsx` + 改造 `StyleSandboxPage.tsx` | P1 | 2d | T4.1 |
| T4.3 | 实现 `character_designer.py` Agent | P0 | 1.5d | — |
| T4.4 | 实现 `GrowthConsistencyChecker`（确定性规则） | P0 | 1d | — |
| T4.5 | 创建 `growth_workshop_discuss.yaml` Prompt | P0 | 0.5d | — |
| T4.6 | 实现成长工坊 API（`stage2_world_char.py` 追加 3 端点） | P0 | 1d | T4.3 T4.4 |
| T4.7 | 实现 `GrowthCurveVisualizer.tsx`（时间轴/折线图） | P0 | 1.5d | — |
| T4.8 | 改造 `Stage2Page.tsx`（新增成长工坊 Tab） | P0 | 1.5d | T4.7 |
| T4.9 | 实现 `inspiration/router.py` + `classifier.py` | P1 | 2d | T1.2 |
| T4.10 | 灵感路由器 Agent 集成（在各 Agent 对话完成处触发） | P1 | 1.5d | T4.9 |
| T4.11 | 改造 `SettingsPage.tsx`（+ 灵感路由器配置 + 豁免反例查看） | P1 | 1d | T4.9 T3.5 |
| T4.12 | 更新 `model_tiers.yaml`（+ creative_director + character_designer 映射） | P0 | 0.5d | T2.1 T4.3 |
| T4.13 | 端到端集成测试 + 验收标准验证 | P0 | 2d | 全部 |


## 十、验收测试计划

### 10.1 单元测试目标

| 模块 | 测试文件 | 目标用例数 | 覆盖重点 |
|---|---|---|---|
| CreativeOS | `test_creative_os/test_*.py` | ≥ 40 | 引擎核心逻辑、确定性计算正确性、LLM Prompt 模板验证 |
| 分支模拟 | `test_branch_simulator.py` | ≥ 8 | 确定性计算准确性、LLM 推理格式正确性、置信度标注 |
| 语义预检 | `test_semantic_precheck.py` | ≥ 6 | 3 类事件检测准确性、不阻断逻辑验证 |
| 灵感路由器 | `test_inspiration_router.py` | ≥ 8 | 分类逻辑正确性、冲突处理规则、置信度阈值 |
| 成长工坊 | `test_growth_workshop.py` | ≥ 8 | 5 项一致性检查规则、Agent 讨论格式 |
| 创新豁免 | `test_exemption.py` | ≥ 8 | 申请/审批流程、反例匹配、规则豁免生效 |
| 风格沙盒 | `test_style_sandbox.py` | ≥ 5 | 参数解析、LLM 渲染格式、配置保存 |
| 用户编辑辅助 | `test_user_edit_assist.py` | ≥ 6 | Diff 分析、SF_LOG 建议格式、批量应用 |
| 创意画布集成 | `test_creative_canvas.py` | ≥ 5 | 端到端发散→选定流程 |

**v1.7 新增测试用例目标：≥ 94 用例。v1.6 已有 522 用例，v1.7 总计预计 616+ 用例。**

### 10.2 验收标准测试矩阵

| AC | 测试类型 | 测试方法 | 通过条件 |
|---|---|---|---|
| AC-1 | 集成测试 | 从一句话意图启动 WhatIf Engine，计数 ≥ 20 节点 | `len(all_nodes) >= 20` |
| AC-2 | E2E 测试 | 模拟用户在创意画布中的完整操作序列 | 画布状态正确记录所有操作，Story DNA 生成成功 |
| AC-3 | 单元测试 | 同一 content 输入 NoveltyEvaluator.evaluate() 3 次 | `max(scores) - min(scores) <= 4` |
| AC-4 | 前端测试 | 渲染 BranchSimulationPanel，检查置信度标注 DOM 元素 | 🟢🟡🟠 标注元素存在且对应正确分区 |
| AC-5 | 集成测试 | 提供含故意遗漏 twist_reveal 的测试文本 | 预检返回 ≥ 1 条 twist_reveal 建议，Scene 仍然通过 |
| AC-6 | 集成测试 | 风格沙盒传入 [8-20] 句长参数，对比原文和渲染结果的平均句长 | 渲染结果 avg_sentence_length 显著小于原文 |
| AC-7 | 集成测试 | 提交豁免申请 → 批准 → 运行 Style Guard | 豁免的 rule_id 不在违规列表中 |
| AC-8 | 集成测试 | 模拟 10 轮 Agent 对话，触发灵感路由器 | `len(captured_ideas) >= 3` 且人工验证分类准确 |
| AC-9 | 单元测试 | 将低谷章节从 Ch.15 改为 Ch.12，运行一致性检查 | 返回 ≥ 1 条 warning，提示 Ch.12 无高烈度冲突 |
| AC-10 | 集成测试 | 删除含 SF_LOG 的段落 + 新增角色关系变化，调用分析 API | 返回 ≥ 1 条 deleted_log 警告 + ≥ 1 条 relation_change 建议 |

### 10.3 回归测试

v1.6 全部 522 用例必须继续通过。重点回归区域：
- `test_cascade_propagation.py`（级联传播不被创意画布/分支模拟影响）
- `test_stage4_writing.py`（写作流程在增加预检/豁免后核心链路不变）
- `test_impact_analyzer.py`（回退影响分析在增加 simulate_branch 后现有功能不变）


## 十一、前后端接口契约（v1.7 增量）

### 11.1 创意画布发散流程

```
前端 CreativeCanvasPage          后端 creative_canvas.py        WhatIfEngine
      │                                │                          │
      │  POST /expand {node_id}        │                          │
      │──────────────────────────────→│                          │
      │                                │  expand_node(node_id)    │
      │                                │─────────────────────────→│
      │                                │                          │
      │                                │  4 × WhatIfNode          │
      │                                │←─────────────────────────│
      │                                │                          │
      │  200 {nodes: [...]}            │                          │
      │←──────────────────────────────│                          │
      │                                │                          │
      │  (每个节点自动评估新颖度)        │                          │
      │  POST /evaluate {node_id}      │                          │
      │──────────────────────────────→│  NoveltyEvaluator        │
      │  200 {score: NoveltyScore}     │  .evaluate_node()        │
      │←──────────────────────────────│                          │
```

### 11.2 分支模拟流程

```
前端 Stage3Page                   后端 stage3_outline.py        BranchSimulator
      │                                │                          │
      │  POST /branches/simulate       │                          │
      │  {description: "如果..."}      │                          │
      │──────────────────────────────→│                          │
      │                                │  simulate(id, desc)      │
      │                                │─────────────────────────→│
      │                                │                          │
      │                                │  Phase 1: 确定性计算      │
      │                                │  (即时，零 LLM)           │
      │                                │                          │
      │                                │  Phase 2: LLM 推理        │
      │                                │  (异步，4 项 Tier 2)      │
      │                                │                          │
      │                                │  BranchSimulationReport  │
      │                                │←─────────────────────────│
      │                                │                          │
      │  200 BranchSimulationReport    │                          │
      │  {                             │                          │
      │    affected_chapter_range,     │                          │
      │    affected_characters,        │                          │
      │    ...确定性部分                 │                          │
      │    tension_curve_projection:   │                          │
      │      {content, confidence:     │                          │
      │       "medium", ...},          │                          │
      │    ...LLM 推理部分              │                          │
      │  }                             │                          │
      │←──────────────────────────────│                          │
```

### 11.3 语义预检 + 豁免流程

```
Writer                  Reviewer                 API                  Scene通过
  │                        │                       │                      │
  │  Scene 文本生成完成      │                       │                      │
  │───────────────────────→│                       │                      │
  │                        │ 1. 语义预检 (Tier 3)   │                      │
  │                        │    检测 3 类事件遗漏    │                      │
  │                        │                       │                      │
  │                        │ 2. 约束冲突检测          │                      │
  │                        │    检测 Writer 是否     │                      │
  │                        │    违反 L3 禁忌约束      │                      │
  │                        │                       │                      │
  │                        │ 有冲突 + 创作意图?       │                      │
  │                        │ ├── 是 → 生成豁免申请    │                      │
  │  ← 豁免申请展示          │                       │                      │
  │  (用户审批: 批准/拒绝)    │                       │                      │
  │───────────────────────→│                       │                      │
  │                        │ ├── 批准 → 规则豁免      │                      │
  │                        │ └── 拒绝 → 正常规则检测   │                      │
  │                        │                       │                      │
  │                        │ 3. Fact Guard (6 项)    │                      │
  │                        │ 4. Narrative Guard      │                      │
  │                        │ 5. Style Guard (含豁免)  │                      │
  │                        │                       │                      │
  │                        │ 组装预检结果 + 豁免结果   │                      │
  │                        │──────────────────────→│                      │
  │                        │                       │  返回 Scene 评审结果   │
  │                        │                       │─────────────────────→│
```


## 十二、迁移与兼容性

### 12.1 v1.6 项目迁移

v1.6 项目在 v1.7 中打开时：

| 数据项 | 迁移行为 | 说明 |
|---|---|---|
| `project.json` | 自动添加 `creative_os_version: "1.7"` 字段 | 标记项目版本，用于后续兼容性判断 |
| `creative_os/` 目录 | 自动创建目录 + 从 `trope_catalog.yaml` 初始化 `trope_pool.json` | 首次打开时懒初始化 |
| `idea_pool.json` | 创建空文件 | 无历史灵感数据 |
| `canvas_state.json` | 不存在（用户在 STAGE 1 选择"画布模式"时创建） | — |
| `characters.json` | 自动添加 `growth_workshop_discussion: []` 字段 | 空数组，向后兼容 |
| `progress.json` | 自动添加 `exemptions: []` 字段 | 空数组，向后兼容 |

### 12.2 向后兼容

| 兼容项 | 策略 |
|---|---|
| STAGE 1 单轮生成 | 保留为默认模式（`?mode=quick`），v1.6 行为完全不变 |
| API 响应体新增字段 | 所有新增字段为 optional，老前端忽略不认识的字段 |
| ModelRouter 配置文件 | `model_tiers.yaml` 新增条目不影响已有映射，缺失时使用 Tier 默认值 |
| CreativeOS 不可用 | 所有引擎不可用时，创意画布模式不可用（前端隐藏入口），快速模式照常工作 |
| 语义预检不可用 | Tier 3 服务波动时跳过预检，Scene 写作链路不受影响 |
| 风格沙盒不可用 | Tier 3 服务波动时返回错误提示，不阻断 STAGE 4 |
| 灵感路由器不可用 | 静默降级，不影响 Agent 对话和创作流程 |

### 12.3 配置升级

```yaml
# model_tiers.yaml v1.7 追加内容 (追加到 agent_mapping 节)
agent_mapping:
  creative_director:
    creative_brainstorming:
      tier: tier_1
      model: default
    whatif_direction:
      tier: tier_1
      model: default
    mutation_recommendation:
      tier: tier_3
      model: default
    path_evaluation:
      tier: tier_1
      model: default

  character_designer:
    growth_discussion:
      tier: tier_1
      model: default
    arc_analysis:
      tier: tier_2
      model: default

  # planner 追加 3 个任务映射
  planner:
    # ... 原有 4 个任务保持不变 ...
    creative_brainstorming:           # 新增
      tier: tier_1
      model: default
    whatif_expansion:                 # 新增
      tier: tier_1
      model: default
    novelty_evaluation:               # 新增
      tier: tier_2
      model: default
```


## 附录 A: 验收标准对照表

| AC | 对应功能 | 技术实现模块 | 测试类型 |
|---|---|---|---|
| AC-1 | WhatIf 树 ≥ 20 节点 | `whatif_engine.py` | 单元测试 + 集成测试 |
| AC-2 | 创意画布完整流程 | `creative_canvas.py` + `CreativeCanvasPage.tsx` | E2E 测试 |
| AC-3 | 新颖度评分可复现性 | `novelty_evaluator.py` | 单元测试（3 次重复评估） |
| AC-4 | 分支模拟置信度标注 | `branch_simulator.py` + `BranchSimulationPanel.tsx` | 前端测试 + 集成测试 |
| AC-5 | 语义预检检测遗漏标记 | `prechecker.py` + `reviewer.py` | 集成测试 |
| AC-6 | 风格沙盒句长调整 | Style Engine L2 + `style_extractor.py` 沙盒端点 | 集成测试 |
| AC-7 | 创新豁免审批 | `ExemptionManager` + `writer.py` + `reviewer.py` | 集成测试 |
| AC-8 | 灵感路由器捕捉 ≥ 3 条 | `inspiration/router.py` + `classifier.py` | 集成测试 + 人工验证 |
| AC-9 | 成长工坊一致性检查 | `GrowthConsistencyChecker` + `character_designer.py` | 单元测试 |
| AC-10 | 用户编辑 SF_LOG 建议 | `SFLogSuggestionEngine` + `SFLogSuggestionPanel.tsx` | 集成测试 |


## 附录 B: 与 v1.6 TRD 的关键差异

| 维度 | v1.6 TRD | v1.7 TRD |
|---|---|---|
| **核心增量** | 叙事深度（MemoryOS L3/L4、级联传播、ReaderOS 7 指标） | 创意广度（CreativeOS 7 引擎、创意画布、分支模拟） |
| **新增 Python 模块** | ModelRouter、L3 冷记忆（4 文件）、L4 叙事记忆、RegistryTransaction、ImpactAnalyzer、WritingFormulas、TabooConstraints | CreativeOS（7 文件）、BranchSimulator、SemanticPrechecker、InspirationRouter（2 文件）、ExemptionManager |
| **新增 Agent** | 0（修改 5 个现有 Agent） | 2（Creative Director + Character Designer）+ 修改 4 个 |
| **新增 Prompt** | 1（narrative_guard.yaml） | 12（6 CreativeOS + 语义预检 + 灵感分类 + SF_LOG 建议 + 成长工坊 + 分支模拟 + 豁免评估） |
| **新增 API 端点** | ~6 | 21 |
| **新增前端页面** | 1（SettingsPage） | 1（CreativeCanvasPage） |
| **改造前端页面** | 4 | 6 |
| **新增前端组件** | 5 | 7 |
| **基础设施变更** | Qdrant + bge-m3（新增外部依赖） | 无新增外部依赖（React Flow + Recharts 为前端 npm 包） |
| **数据存储变更** | `<project_dir>/storyos/cascade_log.jsonl`、`<project_dir>/memory/l3/`（Qdrant） | `<project_dir>/creative_os/`（7 类 JSON 文件） |
| **测试增量** | +110 用例 | 目标 +94 用例 |
| **Token 增量（单章）** | +47.5K（Narrative Guard 为主） | +2.7K（Tier 3 轻量调用为主） |
| **最大技术风险** | Qdrant + bge-m3 部署复杂度 | WhatIf 树节点爆炸（懒惰加载缓解）+ 创意画布前端复杂度 |
| **独立于 v1.6 的程度** | 高度依赖 v1.5 多章能力 | 高度依赖 v1.6 完整叙事引擎（StoryOS/ReaderOS/Style Engine 均为 v1.7 创意画布和分支模拟的底层支撑） |
