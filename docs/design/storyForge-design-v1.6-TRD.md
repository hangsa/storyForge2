# StoryForge v1.6 技术规划需求文档 (TRD)

> **版本:** 1.0 | **日期:** 2026-06-12 | **状态:** 待评审
>
> 本文档是 StoryForge v1.6 的技术实现规格，基于 v1.6 产品设计文档（storyForge-design-v1.6.md）和 v1.5 实际交付代码，描述在 v1.5 基础上新增和变更的全部技术细节。


## 一、项目概述

### 1.1 v1.6 目标

从"能写完一部作品"升级到"能写好一部作品"——将叙事资产管理和一致性保障提升到工程化水准。

```
v1.5                              v1.6
────                              ────
线性前进，无回退                     支持回退影响传播（Conductor）
L0 + L1 + L2                       L0 + L1 + L2 + L3（Qdrant）+ L4（叙事记忆）
无 Narrative Guard                  Narrative Guard（Tier 2 LLM，不阻断）
5 项 Fact Guard                    6 项 Fact Guard（+ 语义预检框架）
字符静态档案                         角色成长曲线 + 剧情里程碑绑定
Style Engine L1                    Style Engine L1 + L2 + L3
追更欲 + 疲劳度（2 项）             全部 7 项指标 + 体裁差异化阈值
无级联传播                           叙事资产级联传播 + 循环依赖检测 + 状态冲突检测
单模型（全部调用同一 Provider）      多模型 Tier 策略 + Agent LLM 配置系统
无章节评审                           每章完成后自动展示质量摘要 + 讨论话题
```

### 1.2 v1.6 增量范围

| 类别 | 新增 | 修改 | 不变 |
|---|---|---|---|
| **Agent LLM 配置** | `model_router.py`、`config/model_tiers.yaml` | `base_agent.py`（接入 ModelRouter） | Provider 实现（anthropic/deepseek/minimax） |
| **Agent** | — | `reviewer.py`（+ Narrative Guard + Style Guard L3 + 第 6 项 FG 框架）、`writer.py`（+ L4 + L3 检索 + 成长阶段注入）、`storyos_agent.py`（+ 级联传播 + 冲突检测）、`summary_archiver.py`（+ L3 分块触发 + 讨论话题）、`planner.py`（+ 成长曲线生成） | — |
| **MemoryOS** | `l3_cold/`（Qdrant + BM25 + 嵌入）、`l4_narrative.py`（StoryOS 同步摘要） | — | L0、L1、L2 |
| **StoryOS** | `registry_transaction.py`（级联事务管理） | `registries.py`（+ 级联触发钩子） | 7 类注册表文件格式 |
| **ReaderOS** | — | `calculator.py`（+ 5 项新指标）、`thresholds.py`（+ 体裁差异化） | 追更欲 + 疲劳度（已有） |
| **Style Engine** | `writing_formulas.py`（L2 写作公式）、`taboo_constraints.py`（L3 禁忌约束） | `genre_template.py`（+ L2/L3 字段） | style_extractor.py |
| **Conductor** | `impact_analyzer.py`（回退影响计算） | `state_machine.py`（+ impact_propagation） | circuit_breaker、checkpoint |
| **API** | — | `conductor.py`（+ 回退影响检测端点）、`stage4_writing.py`（+ 章节评审触发） | stage1-3、stage5、stage6 |
| **前端** | `ChapterReviewPanel.tsx`、`ImpactReportPanel.tsx`、`SettingsPage.tsx` | `Stage4Page.tsx`（+ ReaderOS 仪表盘 + 写作公式面板）、`Stage2Page.tsx`（+ 成长曲线编辑）、`StoryOSPanel.tsx`（+ 级联传播结果 + 冲突告警） | Stage1Page、Stage3Page、Stage5Page、Stage6Page |
| **数据模型** | — | `character.py`（+ growth_curve）、`progress.py`（+ chapter_review） | 其余 7 个模型 |
| **基础设施** | Qdrant（本地单机）、bge-m3（嵌入模型） | — | FastAPI、Pydantic、文件系统存储 |

### 1.3 Token 预算（v1.6 单章）

v1.5 单章约 70K tokens。v1.6 新增 Narrative Guard（Tier 2 LLM）和讨论话题生成（Tier 3 LLM），预算调整为 ~133K。

| 调用 | Agent | Tier | 模型 | 输入 (tokens) | 输出 (tokens) | 小计 |
|---|---|---|---|---|---|---|
| Scene 写作 × 3 | Writer | Tier 1 | DeepSeek V4 Pro | 27,000 × 3 | 4,000 × 3 | 93,000 |
| Scene 重写（20% 概率缓冲） | Writer | Tier 1 | Claude Opus 4 (fallback) | 2,000 | 600 | 2,600 |
| Narrative Guard × 3 | Reviewer | Tier 2 | Claude Sonnet 4 | 27,000 | 4,500 | 31,500 |
| 章摘要 | Summary Archiver | Tier 3 | Claude Haiku | 3,500 | 200 | 3,700 |
| L1 重提取（每 5 章摊销） | Summary Archiver | Tier 3 | Claude Haiku | 200 | 20 | 220 |
| 讨论话题生成 | Summary Archiver | Tier 3 | Claude Haiku | 2,000 | 200 | 2,200 |
| **合计** | | | | **~115,700** | **~17,520** | **~133,200** |

> 以上为峰值估算（含重写缓冲，输入/输出已按概率折算）。实际运行中重写触发率 < 20%，Narrative Guard 输出通常 < 1,000 tokens，典型单章消耗约 **110K-120K tokens**。20 章总消耗约 2.2M-2.5M tokens。

**成本对比（单章）：**

| 策略 | 模型组合 | 成本/章 |
|---|---|---|
| v1.5 模式 | 全 Opus 写作 | ~$1.50 |
| v1.6 推荐 | DeepSeek 写作 + Sonnet NG + Haiku 摘要 | ~$0.75 |
| v1.6 轻量 | DeepSeek 写作（NG 关闭） | ~$0.35 |

### 1.4 技术原则（继承 v1.5）

1. **确定性优先：** 一致性检查、SF_LOG 解析、ReaderOS 计算、级联传播、回退影响计算、Style Guard L3 全部零 LLM。仅 Narrative Guard、讨论话题使用 LLM
2. **文件即数据库：** 所有数据以 JSON/YAML/Markdown 文件存储，延续 v1.5 架构
3. **Agent 无状态：** Agent 之间通过 Conductor 和结构化数据文件共享状态
4. **LLM 调用最小化：** 仅 STAGE 1-3 生成、Scene 写作、Narrative Guard、Summary Archiver 调用 LLM。Narrative Guard 不可用时静默降级
5. **配置驱动：** Agent 使用哪个模型由 `model_tiers.yaml` 决定，代码中无硬编码模型名
6. **增量部署：** Qdrant 和 bge-m3 作为可选依赖，未安装时 L3 检索返回空，不影响核心写作链路


## 二、技术架构变更

### 2.1 整体架构（v1.6 增量以 ★ 标记）

```
┌──────────────────────────────────────────────────────────────┐
│                        Web Frontend                          │
│  React + TypeScript + Tailwind CSS + Material Symbols        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │STAGE 2   │ │STAGE 4   │ │STAGE 4   │ │  STAGE 4       │  │
│  │★成长曲线  │ │★ReaderOS │ │★章节评审  │ │  写作中心       │  │
│  │  编辑     │ │  仪表盘   │ │  面板★   │ │                │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐                                  │
│  │★回退影响  │ │★设置页   │                                  │
│  │  报告面板  │ │体裁+模型  │                                  │
│  └──────────┘ └──────────┘                                  │
│                            │                                  │
│                    REST API (JSON)                            │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                      Python Backend                           │
│  FastAPI + Pydantic + ★Qdrant + ★bge-m3                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │Conductor │ │ Planner  │ │ Writer   │ │  StoryOS      │  │
│  │★回退影响  │ │★成长曲线  │ │★L4+L3   │ │  Agent        │  │
│  │  传播     │ │  生成     │ │  上下文   │ │  ★级联传播    │  │
│  └──────────┘ └──────────┘ └──────────┘ │  ★冲突检测    │  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ └───────────────┘  │
│  │Reviewer  │ │MemoryOS  │ │ReaderOS  │ ┌──────────────┐   │
│  │★N.Guard  │ │L0+L1+L2  │ │★7项指标  │ │Summary       │   │
│  │★S.Guard  │ │★L3(Qdrant│ │★体裁差异化│ │Archiver      │   │
│  │  L3       │ │ +BM25)   │ │  阈值     │ │★L3分块+话题  │   │
│  │★FG #6 框 │ │★L4叙事   │ │          │ │              │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │Style     │ │★Model    │ │★Impact   │                    │
│  │Engine    │ │ Router   │ │ Analyzer │                    │
│  │★L2写作公式│ │ 配置驱动  │ │ 确定性    │                    │
│  │★L3禁忌   │ │          │ │          │                    │
│  └──────────┘ └──────────┘ └──────────┘                    │
│                            │                                  │
│              File System (JSON/YAML/MD) + ★Qdrant             │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈变更

| 组件 | v1.5 | v1.6 | 说明 |
|---|---|---|---|
| **向量数据库** | 无 | Qdrant (本地单机) | L3 冷记忆矢量检索 |
| **嵌入模型** | 无 | BAAI/bge-m3 (1024维) | 中文优化多语言嵌入 |
| **BM25 索引** | 无 | rank-bm25 (Python) | L3 混合检索关键词匹配 |
| **模型路由** | Provider 工厂硬编码 | ModelRouter + YAML 配置 | Tier 策略驱动 |
| **LLM Provider** | Anthropic / DeepSeek / MiniMax | 不变 | 现有三 Provider 保持 |
| **运行环境** | Python 3.11+ / Node 20+ | 不变 | — |
| **前端框架** | React 18 + Vite + Tailwind | 不变 | — |

### 2.3 基础设施决策

| 考量项 | 决策 | 原因 |
|---|---|---|
| Qdrant 部署方式 | 本地单机 (Docker / pip) | 数据量可控（20章 ≈ 100 个分块），无需集群 |
| bge-m3 调用方式 | sentence-transformers 本地加载 | 离线可用，1024 维向量内存占用 ~4MB/百块 |
| Qdrant 不可用降级 | L3 检索返回空，不阻断写作 | L3 是增强功能，核心链路不受影响 |
| BM25 实现 | rank-bm25 Python 库 | 轻量级，无需额外服务 |
| ModelRouter 配置格式 | YAML (`config/model_tiers.yaml`) | 与现有 Prompt YAML 一致，人类可编辑 |
| 流式输出 (SSE) | 不引入 | 推迟到 v1.7 |


## 三、项目目录结构（v1.6 增量）

```
storyforge/
├── backend/
│   ├── main.py                             # 不变
│   ├── config.py                           # 修改：+ model_tiers 配置加载
│   ├── llm/
│   │   ├── base_provider.py                # 不变
│   │   ├── anthropic_provider.py           # 不变
│   │   ├── deepseek_provider.py            # 不变
│   │   ├── minimax_provider.py             # 不变
│   │   └── model_router.py                 # ★新增：ModelRouter 配置驱动路由
│   ├── conductor/
│   │   ├── state_machine.py                # 修改：+ impact_propagation()
│   │   ├── circuit_breaker.py              # 不变
│   │   ├── checkpoint.py                   # 不变
│   │   └── impact_analyzer.py              # ★新增：回退影响范围计算
│   ├── agents/
│   │   ├── base_agent.py                   # 修改：接入 ModelRouter，增加 tier/task 参数
│   │   ├── planner.py                      # 修改：+ 成长曲线生成 prompt
│   │   ├── writer.py                       # 修改：+ L4 注入 + L3 检索触发 + 成长阶段注入
│   │   ├── reviewer.py                     # 修改：+ Narrative Guard + Style Guard L3 + FG #6 框架
│   │   ├── storyos_agent.py                # 修改：+ 级联传播 + 冲突检测
│   │   └── summary_archiver.py             # 修改：+ L3 分块触发 + 讨论话题生成
│   ├── story_os/
│   │   ├── registries.py                   # 修改：+ 级联触发钩子（on_status_change）
│   │   └── registry_transaction.py         # ★新增：事务管理 + 级联引擎
│   ├── memory_os/
│   │   ├── l0_runtime.py                   # 不变
│   │   ├── l1_hot.py                       # 不变
│   │   ├── l2_warm.py                      # 不变
│   │   ├── l3_cold/                        # ★新增目录
│   │   │   ├── __init__.py                 # ★新增：L3ColdMemory 主类
│   │   │   ├── chunker.py                  # ★新增：文本分块（500 tokens，50 重叠）
│   │   │   ├── embedder.py                 # ★新增：bge-m3 嵌入
│   │   │   ├── bm25_index.py              # ★新增：BM25 关键词索引
│   │   │   └── hybrid_search.py           # ★新增：RRF 混合检索
│   │   └── l4_narrative.py                # ★新增：L4 叙事记忆 — StoryOS 同步
│   ├── reader_os/
│   │   ├── __init__.py                     # 不变
│   │   ├── calculator.py                   # 修改：+ 5 项新指标（好奇心/张力/满足感/挫败感/讨论潜力）
│   │   └── thresholds.py                   # 修改：+ 体裁差异化阈值表
│   ├── scene_engine/                       # 不变
│   ├── style_engine/
│   │   ├── genre_template.py               # 修改：+ L2/L3 字段解析
│   │   ├── style_extractor.py              # 不变
│   │   ├── writing_formulas.py             # ★新增：L2 写作公式统计
│   │   └── taboo_constraints.py            # ★新增：L3 禁忌约束检测
│   ├── prompts/
│   │   ├── concept_generation.yaml         # 不变
│   │   ├── world_generation.yaml           # 不变
│   │   ├── character_generation.yaml       # 修改：+ 成长曲线设计指令
│   │   ├── outline_generation.yaml         # 不变
│   │   ├── scene_writing.yaml              # 修改：+ L4 叙事记忆变量 + 成长阶段变量 + L3 查询指令
│   │   ├── scene_rewrite.yaml              # 修改：+ L4 叙事记忆变量
│   │   ├── chapter_summary.yaml            # 修改：+ 讨论话题生成指令
│   │   └── narrative_guard.yaml            # ★新增：Narrative Guard 检测 prompt
│   ├── models/
│   │   ├── project.py                      # 修改：+ genre_thresholds 字段
│   │   ├── world.py                        # 不变
│   │   ├── character.py                    # 修改：+ growth_curve 字段
│   │   ├── outline.py                      # 不变
│   │   ├── storyos.py                      # 不变（已在 v1.5 完成 7 类）
│   │   ├── sf_log.py                       # 不变
│   │   ├── checkpoint.py                   # 不变
│   │   ├── progress.py                     # 修改：+ chapter_review 结构
│   │   ├── reader_os.py                    # 修改：+ 5 项新指标类型
│   │   ├── l2_memory.py                    # 不变
│   │   └── impact_report.py                # ★新增：回退影响报告模型
│   ├── api/
│   │   ├── project.py                      # 不变
│   │   ├── stage1_concept.py               # 不变
│   │   ├── stage2_world_char.py            # 修改：+ 成长曲线读写端点
│   │   ├── stage3_outline.py               # 不变
│   │   ├── stage4_writing.py               # 修改：+ 章节评审触发 + ReaderOS 数据返回
│   │   ├── stage5_diagnosis.py             # 不变
│   │   ├── stage6_export.py                # 不变
│   │   ├── style_extractor.py              # 不变
│   │   ├── conductor.py                    # 修改：+ 回退影响检测端点 + 设置端点
│   │   └── settings_api.py                 # ★新增：项目设置 CRUD（阈值覆盖 + 模型选择）
│   └── utils/                              # 不变
│
├── config/
│   ├── model_tiers.yaml                    # ★新增：Agent LLM 配置
│   └── genre_thresholds.yaml              # ★新增：体裁差异化阈值默认值
│
├── frontend/
│   └── src/
│       ├── App.tsx                          # 修改：+ /settings 路由
│       ├── api/
│       │   └── client.ts                   # 修改：+ 新 API 函数（设置、回退影响、L3 搜索）
│       ├── hooks/
│       │   ├── useProject.ts               # 不变
│       │   ├── useConductor.ts              # 修改：+ impact_propagation
│       │   └── useStage4Writing.ts          # 修改：+ chapter_review 状态
│       ├── components/
│       │   ├── layout/
│       │   │   ├── SideNavBar.tsx           # 修改：+ 设置页导航项
│       │   │   └── MainLayout.tsx           # 修改：+ 新路由映射
│       │   ├── shared/
│       │   │   ├── GlassPanel.tsx           # 不变
│       │   │   ├── ChapterProgress.tsx      # 修改：+ 章节评审按钮
│       │   │   └── ReaderOSDashboard.tsx    # ★新增：7 项指标仪表盘
│       │   └── stage/
│       │       ├── ChapterReviewPanel.tsx   # ★新增：章节评审面板
│       │       ├── ImpactReportPanel.tsx    # ★新增：回退影响报告面板
│       │       ├── GrowthCurveEditor.tsx    # ★新增：角色成长曲线编辑器
│       │       ├── WritingFormulaPanel.tsx  # ★新增：写作公式达标面板
│       │       └── StoryOSPanel.tsx         # 修改：+ 级联传播结果 + 冲突告警
│       └── pages/
│           ├── Stage2Page.tsx               # 修改：+ 成长曲线编辑 Tab
│           ├── Stage4Page.tsx               # 修改：+ ReaderOS 仪表盘 + 写作公式面板 + 章节评审触发
│           ├── Stage5Page.tsx               # 不变
│           ├── Stage6Page.tsx               # 不变
│           └── SettingsPage.tsx             # ★新增：项目设置页
│
└── projects/{id}/
    ├── project.json                         # 修改：+ genre_thresholds 用户覆盖值
    ├── characters.json                      # 修改：+ growth_curve 字段
    ├── progress.json                        # 修改：+ chapter_review 字段
    ├── impact_report.json                   # ★新增：回退影响分析结果
    ├── storyos/
    │   ├── conflicts.json                   # 不变
    │   ├── mysteries.json                   # 不变
    │   ├── twists.json                      # 不变
    │   ├── goals.json                       # 不变
    │   ├── promises.json                    # 不变
    │   ├── reveals.json                     # 不变
    │   ├── expectations.json                # 不变
    │   ├── foreshadowing.json               # 不变
    │   └── cascade_log.jsonl               # ★新增：级联传播日志
    ├── memory/
    │   ├── l2/                              # 不变
    │   └── l3/                              # ★新增：Qdrant 集合数据（外部存储）
    ├── chapter_reviews/                     # ★新增
    │   └── ch{N}_review.json               # 每章评审结果
    └── style/
        ├── extracted_style.yaml             # 不变
        └── stats/                           # ★新增：写作公式统计
            └── ch{N}_style_stats.json
```


## 四、后端模块详细规格（v1.6 增量）

### 4.1 ModelRouter — LLM 配置驱动路由（P0）

#### 4.1.1 模块位置

`backend/llm/model_router.py` — 新增文件。

#### 4.1.2 职责

根据 `config/model_tiers.yaml` 中的 Tier 定义和 Agent 任务映射，为每个 LLM 调用请求路由到正确的 Provider 和模型。

#### 4.1.3 核心类

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class TierConfig:
    description: str
    models: list[dict]           # [{id, provider, cost_per_1k_input, cost_per_1k_output, max_tokens}]
    default: str                 # 默认模型 id
    retry_on_failure: bool
    max_retries: int
    fallback: Optional[str]      # 降级模型 id

@dataclass
class AgentTaskMapping:
    tier_name: str
    model: Optional[str]         # None 表示使用 tier.default
    fallback: Optional[str]      # 任务级 fallback，覆盖 tier 级 fallback

@dataclass
class RoutingDecision:
    provider_name: str
    model_id: str
    tier_name: str
    max_tokens: int
    cost_per_1k_input: float
    cost_per_1k_output: float


class ModelRouter:
    """配置驱动的 LLM 模型路由器。"""

    def __init__(self, config_path: Path) -> None:
        self._config = self._load_config(config_path)
        self._tiers: dict[str, TierConfig] = {}
        self._mappings: dict[str, dict[str, AgentTaskMapping]] = {}
        self._provider_status: dict[str, bool] = {}  # provider → 可用状态
        self._parse_config()

    def resolve(
        self,
        agent_name: str,
        task_name: str,
        force_model: Optional[str] = None,  # 用户覆盖
    ) -> RoutingDecision:
        """
        解析 Agent 任务 → 具体 Provider + 模型。

        解析顺序：
        1. force_model（用户覆盖）
        2. agent_mapping[agent][task].model（任务指定模型）
        3. tier.default（Tier 默认模型）
        4. 可用性检查 → 尝试 fallback
        """
        ...

    def execute(
        self,
        agent_name: str,
        task_name: str,
        messages: list[dict],
        **kwargs,
    ) -> dict:
        """
        执行一次完整的 LLM 调用（路由 + 调用 + 用量记录）。

        返回：{"content": str, "usage": {"input": int, "output": int}, "model": str, "tier": str}
        """
        ...

    def record_usage(
        self,
        agent_name: str,
        task_name: str,
        tier_name: str,
        model_id: str,
        tokens_in: int,
        tokens_out: int,
        cost: float,
    ) -> None:
        """写入 llm_usage.jsonl"""
        ...

    def check_provider_health(self, provider_name: str) -> bool:
        """检查 Provider API 连通性"""
        ...

    def reload_config(self) -> None:
        """运行时重新加载配置（支持热更新）"""
        ...
```

#### 4.1.4 配置文件格式

`config/model_tiers.yaml` 完整格式参见 v1.6 PDD §F1.6.9。关键设计约束：

- **tier_0 不包含 models：** 任何对 tier_0 的 LLM 调用请求都应抛出 `ValueError`
- **fallback 链：** agent_mapping fallback → tier fallback → 若都为 null 且 model 不可用 → 抛出 `ModelUnavailableError`
- **热更新：** 调用 `POST /api/settings/reload-config` 或 SIGHUP 信号触发 `reload_config()`

#### 4.1.5 与 BaseAgent 集成

修改 `backend/agents/base_agent.py`：

```python
class BaseAgent:
    def __init__(self, ..., model_router: ModelRouter, agent_name: str):
        self._router = model_router
        self._agent_name = agent_name

    async def generate_with_tier(
        self, task_name: str, messages: list[dict], **kwargs
    ) -> dict:
        """替代直接调用 self.provider.generate()。通过 ModelRouter 路由。"""
        return await self._router.execute(
            agent_name=self._agent_name,
            task_name=task_name,
            messages=messages,
            **kwargs,
        )
```

现有 Agent 中所有 `self.provider.generate(...)` 调用改为 `self.generate_with_tier(task_name, ...)`。

#### 4.1.6 降级策略

| 场景 | 行为 |
|---|---|
| Tier 1 主模型不可用 | 尝试 agent_mapping.fallback → tier.fallback → 抛出 ModelUnavailableError |
| Tier 2 模型不可用 (Narrative Guard) | 静默跳过，返回空 warning 列表 |
| Tier 3 模型不可用 | 静默跳过，返回空摘要/话题列表 |
| 用户通过 Settings API 覆盖模型 | force_model 参数跳过所有默认值 |


### 4.2 叙事资产级联传播与冲突检测（P0）

#### 4.2.1 模块位置

`backend/story_os/registry_transaction.py` — 新增文件。
`backend/story_os/registries.py` — 修改，增加级联钩子。

#### 4.2.2 核心类

```python
from enum import Enum
from dataclasses import dataclass, field

class CascadeTrigger(str, Enum):
    MYSTERY_REVEALED = "mystery_revealed"
    TWIST_REVEALED = "twist_revealed"
    REVEAL_REVEALED = "reveal_revealed"
    PROMISE_FULFILLED = "promise_fulfilled"
    CONFLICT_RESOLVED = "conflict_resolved"

@dataclass
class CascadeStep:
    trigger: CascadeTrigger
    source_asset_type: str       # "mystery" / "twist" / "reveal" / "promise" / "conflict"
    source_asset_id: str
    target_asset_type: str
    target_asset_id: str
    new_status: str
    reason: str                  # 人类可读的级联原因

@dataclass
class CascadeResult:
    success: bool
    steps_executed: list[CascadeStep]
    blocked_steps: list[CascadeStep]   # 被冲突检测阻断
    cycle_detected: bool
    cycle_path: list[str]              # 循环依赖路径
    conflict_details: list[str]        # 冲突描述


class RegistryTransactionManager:
    """
    叙事资产级联传播事务管理器。

    核心行为：
    1. 接收一个触发事件（如 "mystery mys_001 → revealed"）
    2. 展开所有级联影响（BFS 遍历关联资产）
    3. 每步执行前运行三类校验（循环依赖 / 状态冲突 / 互斥冲突）
    4. 全部通过则原子写入，任一失败则全部回滚
    """

    # 级联规则表
    CASCADE_RULES: dict[CascadeTrigger, list[tuple[str, str]]] = {
        CascadeTrigger.MYSTERY_REVEALED: [
            ("reveal", "revealed"),
            ("expectation", "fulfilled"),
        ],
        CascadeTrigger.TWIST_REVEALED: [
            ("expectation", "ready_to_fulfill"),
        ],
        CascadeTrigger.REVEAL_REVEALED: [
            ("conflict", "escalated"),
        ],
        CascadeTrigger.PROMISE_FULFILLED: [
            ("expectation", "fulfilled"),
        ],
        CascadeTrigger.CONFLICT_RESOLVED: [
            # 特殊处理：检查 Mystery 依赖 → 标记 orphaned（警告，不阻断）
        ],
    }

    # 禁止状态转换
    FORBIDDEN_TRANSITIONS: set[tuple[str, str]] = {
        ("resolved", "active"),
        ("revealed", "foreshadowing"),
        ("fulfilled", "accumulating"),
    }

    def propagate(
        self,
        project_id: str,
        trigger: CascadeTrigger,
        source_asset_type: str,
        source_asset_id: str,
    ) -> CascadeResult:
        """
        执行级联传播。

        Step 1: 展开级联路径（BFS）
        Step 2: 对每步执行校验
        Step 3: 原子写入或回滚
        """
        ...

    def _expand_cascade_path(
        self, trigger: CascadeTrigger, source_type: str, source_id: str
    ) -> list[CascadeStep]:
        """BFS 遍历关联资产，展开完整级联路径"""
        ...

    def _validate_step(self, step: CascadeStep) -> tuple[bool, str]:
        """
        对单个级联步骤执行三类校验：
        1. 循环依赖检测（BFS 路径上是否已出现过 target_asset_id）
        2. 状态冲突检测（FORBIDDEN_TRANSITIONS）
        3. 互斥资产冲突检测（同一 Mystery 关联的 Twist 状态互斥）
        返回 (通过?, 失败原因)
        """
        ...

    def _atomic_commit(
        self, project_id: str, steps: list[CascadeStep]
    ) -> None:
        """原子写入所有级联步骤，写入前备份原始状态"""
        ...
```

#### 4.2.3 与 Registries 集成

修改 `backend/story_os/registries.py`：

```python
class RegistryManager:
    def __init__(self, project_id: str, projects_dir: Path):
        ...
        self._transaction_mgr = RegistryTransactionManager(projects_dir)

    def update_asset_status(self, asset_type: str, asset_id: str, new_status: str):
        """更新资产状态 → 触发级联传播 → 写入注册表"""
        old_status = self._get_status(asset_type, asset_id)

        # 检测是否触发级联
        trigger = self._detect_cascade_trigger(asset_type, old_status, new_status)
        if trigger:
            result = self._transaction_mgr.propagate(
                self.project_id, trigger, asset_type, asset_id
            )
            if not result.success:
                # 部分阻断 → 写入 cascade_log + chapter_review
                self._log_blocked_cascade(result)
                # 仅执行通过的步骤
                self._apply_steps(result.steps_executed)
        else:
            # 无级联，直接写入
            self._write_asset_status(asset_type, asset_id, new_status)

    def _detect_cascade_trigger(
        self, asset_type: str, old_status: str, new_status: str
    ) -> Optional[CascadeTrigger]:
        """根据状态变更判断是否触发级联。

        特殊处理：Conflict → resolved 不触发标准级联链，
        而是触发 _check_orphaned_mysteries() 检查依赖此冲突的 Mystery。
        """
        if asset_type == "conflict" and new_status == "resolved":
            self._check_orphaned_mysteries(asset_id)
            return None  # 不触发级联，仅做孤儿检查

        ...
```

#### 4.2.4 级联日志

写入 `projects/{id}/storyos/cascade_log.jsonl`：

```jsonl
{"timestamp":"2026-06-15T14:35:00Z","trigger":"mystery_revealed","source":"mystery:mys_001","steps_executed":3,"steps_blocked":0,"cycle_detected":false}
{"timestamp":"2026-06-15T14:40:00Z","trigger":"twist_revealed","source":"twist:tw_003","steps_executed":2,"steps_blocked":1,"blocked_reason":"状态冲突: expectation exp_005 resolved → active"}
```


### 4.3 Narrative Guard（P0）

#### 4.3.1 模块位置

在 `backend/agents/reviewer.py` 中新增方法。新增 prompt 文件 `backend/prompts/narrative_guard.yaml`。

#### 4.3.2 执行流程

```
Scene 文本 → Reviewer 组装 Prompt 输入
    │
    ├── {scene_text}: 当前 Scene 草稿文本，截取至 ~6K tokens
    ├── {character_behavior_summary}: 从 L2 温记忆读取（FileManager 读取 l2/ 目录下角色行为摘要）
    ├── {voice_signatures}: 从 characters.json 读取各角色的 voice_signature.taboos
    └── {unknown_to_character}: 从 characters.json 读取各角色的 unknown_to_character 列表
    │
    ▼
Narrative Guard Prompt（Tier 2: Claude Sonnet 4）
    │  输出：JSON { "drifts": [...], "overall_assessment": "..." }
    │
    ▼
后处理（确定性）：
    ├── 对每个 drift，检查是否存在对应 SF_LOG 标记
    │   ├── 有对应标记 → 过滤掉（已由 Writer 主动标记）
    │   └── 无对应标记 → 确认为 warning
    └── 输出 NarrativeGuardResult
```

#### 4.3.3 数据类型

```python
@dataclass
class NarrativeDrift:
    drift_type: str          # "emotion_surge" / "relation_shift" / "behavior_contradiction" / "knowledge_leak"
    character_name: str
    severity: str            # "high" / "medium" / "low"
    description: str         # 人类可读的漂移描述
    suggested_log_type: str  # 建议补充的 SF_LOG 类型

@dataclass
class NarrativeGuardResult:
    drifts: list[NarrativeDrift]
    overall_assessment: str
    model_used: str          # 实际使用的模型
    tokens_used: int
```

#### 4.3.4 降级策略

```python
async def run_narrative_guard(self, scene_text: str, ...) -> NarrativeGuardResult:
    try:
        response = await self.generate_with_tier("narrative_guard", messages)
        return self._parse_narrative_guard_response(response)
    except ModelUnavailableError:
        # Tier 2 不可用 → 静默跳过
        return NarrativeGuardResult(drifts=[], overall_assessment="Narrative Guard 不可用，已跳过", model_used="none", tokens_used=0)
```

#### 4.3.5 Prompt 模板

`backend/prompts/narrative_guard.yaml`：

```yaml
system: |
  你是一个叙事一致性分析师。你的任务是检测当前场景中角色的行为是否有显著漂移，
  并判断这种漂移是否已经被 SF_LOG 标记覆盖。

  你不是一个审查者，你是一个帮助作者发现盲点的伙伴。
  保持克制——只有在你确信存在显著漂移时才报告。

  输出 JSON 格式：
  {
    "drifts": [
      {
        "drift_type": "emotion_surge | relation_shift | behavior_contradiction | knowledge_leak",
        "character_name": "角色名",
        "severity": "high | medium | low",
        "description": "人类可读的漂移描述",
        "suggested_log_type": "character_emotion | character_relation_change | knowledge_gain"
      }
    ],
    "overall_assessment": "整体评估（1-2 句话）"
  }

user: |
  ## 当前场景文本
  {scene_text}

  ## 角色历史行为模式
  {character_behavior_summary}

  ## 角色设定
  声音特征（禁忌行为）：
  {voice_signatures}

  角色不应该知道的信息：
  {unknown_to_character}
```


### 4.4 Fact Guard 第 6 项框架（P1）

#### 4.4.1 模块位置

`backend/agents/reviewer.py` — `Reviewer` 类中新增 `check_6_semantic_precheck_review()` 方法。

#### 4.4.2 实现

```python
def check_6_semantic_precheck_review(
    self,
    semantic_precheck_results: list[CheckResult] | None = None,
) -> CheckResult:
    """
    Fact Guard 第 6 项：语义预检结果复核。

    v1.6: semantic_precheck_results 始终为 None → 始终 passed
    v1.7: 接入 LLM 语义完整性预检结果，复核并过滤误报

    此项不阻断——语义预检基于 LLM，存在误报可能。
    """
    if semantic_precheck_results is None:
        return CheckResult(
            check_id=6,
            name="语义预检结果复核",
            passed=True,
            detail="v1.6 — 语义预检尚未接入，此项暂不生效",
        )

    # v1.7: 以下为预留逻辑
    failed_checks = [c for c in semantic_precheck_results if not c.passed]
    if not failed_checks:
        return CheckResult(check_id=6, name="语义预检结果复核", passed=True)

    # 对每个失败项检查是否有 SF_LOG 覆盖
    verified_failures = [
        c for c in failed_checks
        if not self._has_corresponding_log(c)  # 未来实现
    ]

    return CheckResult(
        check_id=6,
        name="语义预检结果复核",
        passed=len(verified_failures) == 0,
        detail=f"语义预检 {len(failed_checks)} 项未通过，经复核 {len(verified_failures)} 项确认为有效问题（不阻断）",
    )
```

#### 4.4.3 Fact Guard 运行顺序（更新后）

```
check_1_timeline          # 时间线连续性 — 零 LLM
check_2_character_state   # 角色状态一致性 — 零 LLM
check_3_world_rules       # 世界规则合规 — 零 LLM
check_4_asset_compliance  # 注册表合规性 — 零 LLM
check_5_log_completeness  # 日志完整性 — 零 LLM
check_6_semantic_precheck # 语义预检复核 — 零 LLM（v1.6 空操作）
```


### 4.5 MemoryOS L3 + L4（P1）

#### 4.5.1 L3 冷记忆

**目录：** `backend/memory_os/l3_cold/`

```
l3_cold/
├── __init__.py          # L3ColdMemory 主类 — 统一入口
├── chunker.py           # TextChunker — 分块（500 tokens，50 重叠）
├── embedder.py          # BgeM3Embedder — bge-m3 嵌入（1024维）
├── bm25_index.py        # BM25Index — BM25 关键词索引
└── hybrid_search.py     # HybridSearcher — RRF 融合（向量 0.6: 关键词 0.4）
```

**核心类：**

```python
class L3ColdMemory:
    """L3 冷记忆 — 矢量语义检索。"""

    def __init__(self, project_id: str, projects_dir: Path):
        self._project_id = project_id
        self._embedder = BgeM3Embedder()
        self._bm25 = BM25Index()
        self._qdrant = QdrantClient(...)     # 本地 Qdrant

    def index_chapter(self, chapter_number: int, chapter_text: str) -> None:
        """分块 → 嵌入 → 写入 Qdrant + BM25 索引。每章完成后调用。"""
        chunks = TextChunker.chunk(chapter_text, size=500, overlap=50)
        vectors = self._embedder.encode_batch(chunks)
        self._qdrant.upsert(
            collection_name=f"project_{self._project_id}",
            points=[...],   # id, vector, payload={chunk_text, chapter, scene}
        )
        self._bm25.add_documents(chunks)

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        """
        混合检索：向量 cosine + BM25 → RRF 融合 → top_k。
        返回：[{text, chapter, scene, score}, ...]
        """
        semantic_results = self._qdrant.search(query, limit=top_k * 2)
        keyword_results = self._bm25.search(query, limit=top_k * 2)
        fused = HybridSearcher.rrf_fusion(semantic_results, keyword_results, k=60)
        return fused[:top_k]

    def search_available(self) -> bool:
        """Qdrant 是否可用。不可用时核心链路不依赖 L3。"""
        ...

    def reindex_all(self) -> None:
        """v1.5 项目升级：遍历所有已完成章，全量重建索引。"""
        ...


class BgeM3Embedder:
    """BAAI/bge-m3 嵌入模型封装。"""

    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer("BAAI/bge-m3")

    def encode_batch(self, texts: list[str]) -> list[list[float]]:
        """批量编码 → 1024 维向量"""
        ...


class HybridSearcher:
    """RRF (Reciprocal Rank Fusion) 混合排序。"""

    @staticmethod
    def rrf_fusion(
        semantic: list[dict],
        keyword: list[dict],
        k: int = 60,
        semantic_weight: float = 0.6,
        keyword_weight: float = 0.4,
    ) -> list[dict]:
        ...
```

#### 4.5.2 L4 叙事记忆

**文件：** `backend/memory_os/l4_narrative.py`

```python
@dataclass
class L4NarrativeSummary:
    active_conflicts: str       # "3 个活跃冲突：cf_001(强度7/10)..."
    unresolved_mysteries: str   # "2 个未解谜团：mys_002(3条线索)..."
    pending_promises: str       # "1 个待兑现承诺：pr_001..."
    planned_twists: str         # "2 个铺垫中反转：tw_001..."
    ready_expectations: str     # "1 个待满足期待：exp_003..."

class L4NarrativeMemory:
    """
    L4 叙事记忆 — 与 StoryOS 七类注册表强同步。

    零 LLM 调用：直接从 JSON 注册表文件读取并格式化为自然语言摘要。
    容量 ~3K tokens。
    """

    def generate(self, project_id: str) -> L4NarrativeSummary:
        """从 StoryOS 注册表生成 L4 摘要（确定性）。"""
        ...

    def to_context_string(self, summary: L4NarrativeSummary) -> str:
        """格式化为 Writer 上下文注入字符串。"""
        ...
```

**L4 更新时机：** 每章 StoryOS Agent 完成 SF_LOG 解析和注册表更新后，`L4NarrativeMemory.generate()` 由 STAGE 4 路由自动调用。

**Writer 上下文组装（更新后）：**

```python
# backend/agents/writer.py — _assemble_context()
context_parts = []

# L0: 运行时状态（~500 tokens）
context_parts.append(self._l0.get_context_string(project_id))

# L1: 热记忆 — 近 5 章文本（~5K tokens）
context_parts.append(self._l1.get_context_string(project_id))

# L4: 叙事记忆（~3K tokens）★ 新增
l4_summary = self._l4.generate(project_id)
context_parts.append(self._l4.to_context_string(l4_summary))

# L2: 温记忆 — 章摘要 + 关系图 + 时间轴（~8K tokens）
context_parts.append(self._l2.get_context_string(project_id))

# L3: 冷记忆 — 按需矢量检索（~2.5K tokens）★ 新增
if self._l3.search_available():
    l3_query = self._generate_l3_query(...)  # Writer 在 prompt 中生成查询
    l3_results = self._l3.search(l3_query, top_k=5)
    context_parts.append(self._format_l3_results(l3_results))

# ★ 新增：角色成长阶段
context_parts.append(self._get_growth_stage_context(chapter_number))

return "\n\n".join(context_parts)
```


### 4.6 Conductor 回退影响传播（P1）

#### 4.6.1 模块位置

`backend/conductor/impact_analyzer.py` — 新增文件。

#### 4.6.2 核心类

```python
from enum import Enum
from dataclasses import dataclass

class ImpactPriority(str, Enum):
    P0_MUST_REWRITE = "P0"     # 必须重写 — 叙事资产冲突
    P1_SUGGEST_REVIEW = "P1"   # 建议复核 — 与新版设定可能存在偏差
    P2_NO_IMPACT = "P2"        # 无影响

@dataclass
class ImpactEntry:
    chapter_number: int
    scene_numbers: list[int]
    priority: ImpactPriority
    reason: str
    affected_assets: list[str]   # 受影响的叙事资产 ID

@dataclass
class ImpactReport:
    project_id: str
    modified_files: list[str]     # 哪些文件被修改（hash 对比）
    entries: list[ImpactEntry]
    summary: dict[str, int]       # {"P0": 2, "P1": 5, "P2": 10}


class ImpactAnalyzer:
    """
    回退影响范围计算器。

    零 LLM 调用：全部检测逻辑基于文件 hash 对比 + JSON 字段差异分析。
    """

    def __init__(self, projects_dir: Path):
        self._projects_dir = projects_dir

    def analyze(
        self,
        project_id: str,
        modified_files: list[str],    # 用户修改了哪些文件（由 API 层传入）
    ) -> ImpactReport:
        """
        计算影响范围。

        Step 1: hash 对比确定修改内容
        Step 2: 按修改对象类型分发检测逻辑
        Step 3: 汇总 P0/P1/P2 分级报告
        """
        ...

    def _analyze_story_dna_change(self, project_id: str) -> list[ImpactEntry]:
        """Story DNA 变更 → 标记全部产出物为待复核"""
        ...

    def _analyze_world_change(
        self, project_id: str, old_world: dict, new_world: dict
    ) -> list[ImpactEntry]:
        """world.json 变更 → 扫描 outline + SF_LOG 引用"""
        ...

    def _analyze_character_change(
        self, project_id: str, old_characters: dict, new_characters: dict
    ) -> list[ImpactEntry]:
        """characters.json 变更 → 扫描涉及角色的 Scene 计划 + SF_LOG"""
        ...

    def _analyze_outline_change(
        self, project_id: str, old_outline: dict, new_outline: dict
    ) -> list[ImpactEntry]:
        """outline.json 变更 → 对比 Scene 增删、顺序变化、beat_type 变更"""
        ...

    def _classify_impact(self, entry: ImpactEntry) -> ImpactPriority:
        """
        分类规则：
        - 叙事资产冲突（Mystery clue 引用已删除角色） → P0
        - 角色设定变更影响已完成 Scene 中的行为 → P1
        - 仅新增内容、不影响已完成章 → P2
        """
        ...

    def _compute_file_hash(self, project_id: str, filename: str) -> str:
        """SHA256 hash of project file"""
        ...
```

#### 4.6.3 API 端点

新增端点 `POST /api/conductor/analyze-impact`：

```python
@router.post("/analyze-impact")
async def analyze_impact(data: dict):
    """
    请求：{"project_id": "...", "modified_files": ["world.json", "characters.json"]}
    响应：ImpactReport（分级影响列表 + 摘要统计）
    """
    ...

@router.post("/execute-rollback")
async def execute_rollback(data: dict):
    """
    执行回退：{"project_id": "...", "action": "confirm"|"cancel"|"compat_mode"}
    - confirm: 标记受影响 Scene 为 pending
    - cancel: 从 .bak 恢复原始文件
    - compat_mode: 仅记录元数据
    """
    ...
```


### 4.7 角色成长曲线（P2）

#### 4.7.1 数据模型变更

扩展 `backend/models/character.py`：

```python
class GrowthStage(BaseModel):
    stage: str                          # "起点" / "第一次重大打击" / "低谷" / ...
    description: str                    # 人类可读的成长阶段描述
    trigger_event_type: str             # 8 类白名单之一
    bound_chapter: Optional[int] = None # STAGE 3 后回填

class GrowthCurve(BaseModel):
    arc_type: str = "positive_change"   # positive_change | negative_arc | flat_arc
    stages: list[GrowthStage] = []

class Character(BaseModel):
    ...
    growth_curve: Optional[GrowthCurve] = None  # ★新增字段
```

#### 4.7.2 STAGE 2 生成

Planner Agent 的 `generate_character()` 生成角色时，prompt 中增加成长曲线设计指令。

#### 4.7.3 STAGE 3 回填

大纲确定后，自动扫描 outline 中每个 Scene 的 `narrative_role` 和 `registry_changes`，将成长曲线 stage 绑定到最匹配的章节号：

```python
def bind_growth_curve_to_outline(
    growth_curve: GrowthCurve,
    outline: Outline,
) -> GrowthCurve:
    """确定性算法：匹配 trigger_event_type 与 Scene 的 registry_changes"""
    for stage in growth_curve.stages:
        for chapter in outline.chapters:
            for scene_plan in chapter.scene_plan:
                for change in scene_plan.registry_changes.created + scene_plan.registry_changes.updated:
                    # 匹配触发事件类型
                    if self._match_trigger(stage.trigger_event_type, change):
                        stage.bound_chapter = chapter.chapter_number
                        break
    return growth_curve
```

#### 4.7.4 STAGE 4 上下文注入

Writer 上下文组装时注入当前角色的成长阶段（参见 §4.5.2）。


### 4.8 Style Engine L2 + L3（P2）

#### 4.8.1 L2 写作公式

`backend/style_engine/writing_formulas.py`：

```python
@dataclass
class WritingFormulaStats:
    avg_sentence_length: float
    dialogue_ratio: float
    emotional_beat_density: float     # 每千字情绪标记数
    satisfaction_beat_count: int

class WritingFormulaAnalyzer:
    """L2 写作公式统计 — 全部确定性计算，零 LLM。"""

    def analyze(self, scene_text: str, genre_template: dict) -> WritingFormulaStats:
        ...

    def check_compliance(
        self, stats: WritingFormulaStats, formula: dict
    ) -> list[ComplianceResult]:
        """
        对比实际统计值与体裁模板的写作公式标准。
        返回：[{metric, expected, actual, passed}, ...]
        """
        ...
```

#### 4.8.2 L3 禁忌约束

`backend/style_engine/taboo_constraints.py`：

```python
@dataclass
class TabooViolation:
    pattern_name: str
    severity: str              # "error" | "warning"
    location: str              # 违规文本片段
    context: str               # 上下文

class TabooConstraintChecker:
    """L3 禁忌约束检测 — 三层检测，仅角色禁忌使用 Tier 3 LLM 二次确认。"""

    def check(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[str]
    ) -> list[TabooViolation]:
        """
        三层检测（按顺序）：
        1. 全局禁忌：正则 + 关键词匹配 → 直接判定，零 LLM
        2. 体裁禁忌：正则匹配（基于体裁模板 YAML 定义的 pattern）→ 直接判定，零 LLM
        3. 角色禁忌：关键词匹配 → 候选列表 → Tier 3 LLM 二次确认（仅为减少误报）
        返回：合并的确认违规列表
        """
        ...

    def _check_global_taboos(self, scene_text: str) -> list[TabooViolation]:
        """全局禁忌检测（正则 + 关键词，零 LLM）。"""
        ...

    def _check_genre_taboos(self, scene_text: str, genre_taboos: list[dict]) -> list[TabooViolation]:
        """体裁禁忌检测（正则匹配，零 LLM）。"""
        ...

    def _check_character_taboos(
        self, scene_text: str, character_taboos: list[str]
    ) -> list[TabooViolation]:
        """角色禁忌检测：关键词匹配 → Tier 3 LLM 二次确认。"""
        ...
```

**执行时机：** Reviewer 的 Style Guard 阶段，在 Narrative Guard 之后。不阻断 Scene。

#### 4.8.3 体裁模板扩展

`data/style/cool_novel.yaml` 增加 L2 + L3 字段：

```yaml
genre: 爽文
style_formula:           # ★新增
  avg_sentence_length_max: 30
  dialogue_ratio_min: 0.4
  emotional_beat_interval: 500
  satisfaction_beat_min: 3

taboos:                   # ★新增
  - pattern: "虐主"
    max_chars: 300
    severity: error
  - pattern: "连续失败"
    max_consecutive: 2
    severity: error
```


### 4.9 ReaderOS 全部 7 项指标（P1）

#### 4.9.1 5 项新增指标

修改 `backend/reader_os/calculator.py`，在现有 `addiction` 和 `fatigue` 基础上增加：

```python
class ReaderOSCalculator:
    def calculate_all(self, project_id: str, chapter_number: int) -> dict[str, float]:
        return {
            "addiction": self._calc_addiction(...),       # 已有
            "fatigue": self._calc_fatigue(...),            # 已有
            "curiosity": self._calc_curiosity(...),        # ★新增
            "tension": self._calc_tension(...),            # ★新增
            "satisfaction": self._calc_satisfaction(...),  # ★新增
            "frustration": self._calc_frustration(...),    # ★新增
            "discussion": self._calc_discussion(...),      # ★新增
        }

    def _calc_curiosity(self, mysteries: list, sf_logs: list, chapter: int) -> float:
        """好奇心 = 活跃线索数 × 线索揭示进度 / 章节数。范围 0-100。"""
        ...

    def _calc_tension(self, conflicts: list, sf_logs: list) -> float:
        """张力 = 活跃冲突强度均值 + 冲突升级频率 × 角色危险度。范围 0-100。"""
        ...

    def _calc_satisfaction(self, sf_logs: list, promises: list, goals: list) -> float:
        """满足感 = 近期爽点触发数 + 承诺兑现率 + 目标进展度。范围 0-100。"""
        ...

    def _calc_frustration(self, goals: list, sf_logs: list) -> float:
        """挫败感 = 主角目标受阻次数 + 连续负面事件序列长度。范围 0-100。"""
        ...

    def _calc_discussion(self, sf_logs: list, keywords: dict) -> float:
        """讨论潜力 = 争议性关键词 + 身份冲突评分 + 反转密度 - 可预测性惩罚。范围 0-100。"""
        ...
```

#### 4.9.2 体裁差异化阈值

`backend/reader_os/thresholds.py` — 加载 `config/genre_thresholds.yaml`：

```python
GENRE_THRESHOLDS = {
    "爽文":    {"addiction_critical": 50, "frustration_high": 60, "fatigue_moderate": 55, ...},
    "严肃文学": {"addiction_critical": 30, "frustration_high": 80, ...},
    "悬疑推理": {"addiction_critical": 45, "frustration_high": 65, ...},
    "科幻":    {"addiction_critical": 35, "frustration_high": 70, ...},
    "奇幻":    {"addiction_critical": 40, "frustration_high": 70, ...},
}

def get_thresholds(project_id: str, genre: str, user_overrides: dict | None = None) -> dict:
    """加载阈值：默认值 ← 体裁默认 ← 用户覆盖"""
    ...
```


### 4.10 章节评审会（P1）

#### 4.10.1 触发机制

STAGE 4 写作循环中，每章**最后一个 Scene** 完成后自动触发。检测方式：

```python
# backend/api/stage4_writing.py
# 在 write_scene 完成后：
current_chapter = progress.get("current_chapter")
chapter_scenes = [
    s for ch in progress.get("chapters", [])
    if ch.get("chapter_number") == current_chapter
    for s in ch.get("scenes", [])
]
all_scenes_done = all(
    s.get("status") in ("completed", "force_passed")
    for s in chapter_scenes
)
if all_scenes_done:
    review_data = self._build_chapter_review(project_id, current_chapter)
    self._fm.write_json(project_id, f"chapter_reviews/ch{current_chapter}_review.json", review_data)
```

#### 4.10.2 评审数据结构

```json
{
  "chapter_number": 15,
  "timestamp": "2026-06-15T14:40:00Z",
  "coherence_score": 82,
  "reader_os": {
    "addiction": 72, "fatigue": 38, "curiosity": 65,
    "tension": 70, "satisfaction": 55, "frustration": 30, "discussion": 60
  },
  "narrative_assets": {
    "new_conflicts": 1, "escalated_conflicts": 1,
    "new_clues": 2, "fulfilled_promises": 1, "revealed_twists": 1,
    "fulfilled_expectations": 2, "planned_foreshadowing": 3
  },
  "narrative_guard": {
    "warnings": [
      {"drift_type": "emotion_surge", "character": "林峰", "description": "第3幕情绪突变与历史模式不符"}
    ]
  },
  "writing_formula_compliance": [
    {"metric": "avg_sentence_length", "expected": "≤30", "actual": 28, "passed": true},
    {"metric": "dialogue_ratio", "expected": "≥40%", "actual": 42, "passed": true},
    {"metric": "satisfaction_beats", "expected": "≥3", "actual": 4, "passed": true}
  ],
  "discussion_topics": [
    "本章的反转力度是否足够？",
    "苏晓晓的态度转变是否铺垫充分？"
  ],
  "decision": null
}
```

#### 4.10.3 讨论话题生成

Summary Archiver 在生成章摘要时一并产出（Tier 3 LLM，~200 tokens 输出）。Prompt 指令加在 `chapter_summary.yaml` 中：

```yaml
# 在章摘要 prompt 末尾增加：
discussion_instruction: |
  基于以上章节分析，提出 2-3 个作者可能需要思考的叙事问题，
  聚焦于角色一致性、节奏、反转力度和铺垫充分性。
  每个问题一行，以 "1. " 开头。
```


## 五、API 设计（v1.6 变更）

### 5.1 新增端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stage4/chapter-review?project_id=&chapter=` | 获取指定章的评审数据 |
| POST | `/api/stage4/chapter-review/decide` | 作者对评审面板的决策（通过/修改意见） |
| POST | `/api/conductor/analyze-impact` | 回退影响分析 |
| POST | `/api/conductor/execute-rollback` | 执行回退操作 |
| GET | `/api/settings/thresholds?project_id=` | 获取当前项目的体裁阈值 |
| PUT | `/api/settings/thresholds` | 更新用户自定义阈值 |
| GET | `/api/settings/model-config` | 获取当前 model_tiers 配置 |
| POST | `/api/settings/reload-config` | 热重载配置文件 |
| GET | `/api/stage4/reader-os?project_id=&chapter=` | 获取指定章的 ReaderOS 指标 |
| GET | `/api/storyos/cascade-log?project_id=&limit=` | 获取级联传播日志（StoryOSPanel 展示用） |

### 5.2 修改端点

| 方法 | 路径 | 变更说明 |
|---|---|---|
| POST | `/api/stage4/write-scene` | 响应增加 `chapter_review_ready: bool` 字段 |
| GET | `/api/stage4/progress` | 响应增加 `chapter_review` 状态 |
| POST | `/api/stage2/generate-character` | prompt 增加成长曲线设计指令 |
| PUT | `/api/stage2/character` | 支持写入 growth_curve 字段 |


## 六、前端页面规格（v1.6 增量）

### 6.1 Stage4Page — ReaderOS 仪表盘

在 STAGE 4 写作中心右侧面板顶部增加 7 项指标仪表盘：

```
┌─────────────────────┐
│  📊 本章读者指标      │
│                      │
│  追更欲  ████████░ 72 │
│  疲劳度  ███░░░░░░ 38 │
│  好奇心  ██████░░░ 65 │
│  张力    ███████░░ 70 │
│  满足感  █████░░░░ 55 │
│  挫败感  ███░░░░░░ 30 │
│  讨论潜力 ██████░░░ 60 │
└─────────────────────┘
```

颜色编码：绿色（安全区）→ 黄色（警告区）→ 红色（危险区），按体裁差异化阈值。

### 6.2 ChapterReviewPanel — 章节评审面板

每章最后一个 Scene 完成后自动弹出模态面板。内容参见 v1.6 PDD §F1.6.10 的 ASCII 线框图。

三个决策按钮：
- **[通过]** — 标记 chapter_review.decision = "approved"
- **[快速通过]** — 跳过后续章的评审面板（可恢复）
- **[提出修改意见]** — 打开文本输入框，将意见写入 chapter_review

### 6.3 ImpactReportPanel — 回退影响报告

STAGE 2/3 编辑页的"检测影响"按钮触发。展示：

- 修改的文件列表（hash 对比结果）
- P0 列表（红色 — 必须重写）
- P1 列表（黄色 — 建议复核）
- P2 列表（灰色 — 无影响）
- 底部操作按钮：确认执行 / 取消 / 兼容模式

### 6.4 新增 SettingsPage

路由 `/project/:id/settings`，包含两个设置卡：

**体裁阈值设置卡：**
- 7 项指标的滑块控件（范围 0-100）
- 底部"恢复默认"按钮
- 当前体裁的默认值以虚线标记

**LLM 模型设置卡：**
- 展示当前 model_tiers.yaml 配置（只读表格）
- 每个 Agent 任务可选择覆盖模型（下拉菜单：Tier 默认 / 备选模型）
- "重载配置"按钮

### 6.5 StoryOSPanel — 级联传播与冲突告警

修改现有 `StoryOSPanel.tsx`，增加以下展示内容：

- **级联传播日志：** 读取 `storyos/cascade_log.jsonl`，以时间线形式展示最近的级联事件（触发源 → 级联步骤数 → 阻断数）
- **冲突告警：** 当级联传播被阻断时，以琥珀色警告条展示冲突详情（循环依赖路径 / 禁止转换 / 互斥资产冲突）
- **资产关联图：** 以简单的缩进树展示当前活跃叙事资产之间的依赖关系（Mystery → Reveal → Expectation → Conflict）

数据来源：`GET /api/storyos/cascade-log?project_id=`（新增端点，在 `storyos_agent.py` 路由中实现）。


## 七、Prompt 设计变更

| Prompt 文件 | 变更类型 | 说明 |
|---|---|---|
| `scene_writing.yaml` | 修改 | 增加 `{l4_narrative_memory}`（L4 叙事资产摘要）、`{character_growth_stage}`（成长阶段）、`{l3_query_instruction}`（L3 检索指令）变量 |
| `scene_rewrite.yaml` | 修改 | 增加 `{l4_narrative_memory}` 变量 |
| `character_generation.yaml` | 修改 | 增加成长曲线设计指令（起点 → 转折点 → 低谷 → 终点） |
| `chapter_summary.yaml` | 修改 | 增加讨论话题生成指令 |
| `narrative_guard.yaml` | **新增** | Narrative Guard 系统 prompt + user 模板 |


## 八、数据模型变更

### 8.1 修改的模型

**`backend/models/character.py`：**
```python
class GrowthStage(BaseModel):       # ★新增类
    stage: str
    description: str
    trigger_event_type: str
    bound_chapter: Optional[int] = None

class GrowthCurve(BaseModel):       # ★新增类
    arc_type: str = "positive_change"
    stages: list[GrowthStage] = []

class Character(BaseModel):
    ...
    growth_curve: Optional[GrowthCurve] = None  # ★新增字段
```

**`backend/models/progress.py`：**
```python
class ChapterReviewData(BaseModel):  # ★新增类
    chapter_number: int
    timestamp: str
    coherence_score: int
    reader_os: dict[str, float]
    narrative_assets: dict[str, int]
    narrative_guard_warnings: list[dict]
    writing_formula_compliance: list[dict]
    discussion_topics: list[str]
    decision: Optional[str] = None
```

**`backend/models/reader_os.py`：**
```python
class ReaderOSSnapshot(BaseModel):
    addiction: float       # 已有
    fatigue: float         # 已有
    curiosity: float       # ★新增
    tension: float         # ★新增
    satisfaction: float    # ★新增
    frustration: float     # ★新增
    discussion: float      # ★新增
```

**`backend/models/project.py`：**
```python
class Project(BaseModel):
    ...
    genre_thresholds: Optional[dict[str, int]] = None  # ★新增：用户自定义阈值覆盖
```

### 8.2 新增模型

**`backend/models/impact_report.py`：**
```python
class ImpactEntry(BaseModel):
    chapter_number: int
    scene_numbers: list[int]
    priority: str          # "P0" | "P1" | "P2"
    reason: str
    affected_assets: list[str]

class ImpactReport(BaseModel):
    project_id: str
    modified_files: list[str]
    entries: list[ImpactEntry]
    summary: dict[str, int]
```

### 8.3 项目文件变更

| 数据文件 | 变更 |
|---|---|
| `project.json` | + `genre_thresholds`（用户自定义阈值覆盖） |
| `characters.json` | + 每个角色可包含 `growth_curve` |
| `progress.json` | + 每章可包含 `chapter_review` 结构 |
| `impact_report.json` | **新增** — 回退影响分析结果 |
| `chapter_reviews/ch{N}_review.json` | **新增** — 每章评审结果 |
| `style/stats/ch{N}_style_stats.json` | **新增** — 写作公式统计 |
| `storyos/cascade_log.jsonl` | **新增** — 级联传播日志 |


## 九、开发任务分解（v1.6）

### Phase 0: 基础设施（P0 优先）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 0.1 | 创建 `config/model_tiers.yaml` 和 `config/genre_thresholds.yaml` | 2h | — |
| 0.2 | 实现 `ModelRouter` (`backend/llm/model_router.py`) | 8h | 0.1 |
| 0.3 | 修改 `BaseAgent` 接入 `ModelRouter` | 4h | 0.2 |
| 0.4 | 修改 LLM 调用 Agent（Writer/Planner/SummaryArchiver/Reviewer 的 Narrative Guard）将 `provider.generate()` 替换为 `generate_with_tier()`（Tier 0 任务不变） | 4h | 0.3 |
| 0.5 | Qdrant + bge-m3 环境搭建（Docker Compose / pip dependencies） | 4h | — |

### Phase 1: 叙事引擎核心（P0）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 1.1 | 实现 `RegistryTransactionManager` + 级联引擎 | 8h | — |
| 1.2 | 实现循环依赖检测 + 状态冲突检测 | 4h | 1.1 |
| 1.3 | 修改 `Registries` 增加级联触发钩子 | 4h | 1.2 |
| 1.4 | 创建 `narrative_guard.yaml` prompt | 2h | — |
| 1.5 | 实现 `Reviewer.run_narrative_guard()` | 6h | 0.3, 1.4 |
| 1.6 | 实现 Fact Guard 第 6 项框架 | 2h | — |

### Phase 2: 记忆系统（P1）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 2.1 | 实现 L3 `TextChunker` + `BgeM3Embedder` | 4h | 0.5 |
| 2.2 | 实现 L3 `BM25Index` + `HybridSearcher` | 4h | 2.1 |
| 2.3 | 实现 `L3ColdMemory` 主类 + Qdrant 集成 | 6h | 2.2 |
| 2.4 | 实现 `L4NarrativeMemory`（StoryOS 同步摘要） | 4h | — |
| 2.5 | 修改 `Writer._assemble_context()` 增加 L4 + L3 + 成长阶段 | 4h | 2.3, 2.4 |
| 2.6 | 修改 `SummaryArchiver` 增加 L3 分块触发 | 2h | 2.3 |

### Phase 3: 回退与质量保障（P1）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 3.1 | 实现 `ImpactAnalyzer` | 8h | — |
| 3.2 | 新增 API 端点（analyze-impact / execute-rollback） | 3h | 3.1 |
| 3.3 | 实现 ReaderOS 5 项新指标 | 8h | — |
| 3.4 | 实现体裁差异化阈值加载 + 用户覆盖 | 3h | 3.3 |
| 3.5 | 实现章节评审数据组装 + API | 6h | 3.3 |
| 3.6 | 实现讨论话题生成（Summary Archiver 扩展） | 3h | 0.3 |

### Phase 4: 角色与风格（P2）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 4.1 | 角色成长曲线模型 + STAGE 2 生成 + STAGE 3 回填 | 6h | — |
| 4.2 | Writer 成长阶段上下文注入（已在 2.5 中实现） | — | 4.1 |
| 4.3 | 实现 `WritingFormulaAnalyzer`（L2 写作公式） | 4h | — |
| 4.4 | 实现 `TabooConstraintChecker`（L3 禁忌约束） | 6h | 0.3 |
| 4.5 | 体裁模板扩展（cool_novel.yaml + L2/L3 字段） | 2h | 4.3, 4.4 |

### Phase 5: 前端（P1-P2）

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 5.1 | `ReaderOSDashboard` 组件（7 项指标仪表盘） | 4h | 3.3 |
| 5.2 | `ChapterReviewPanel` 组件（章节评审模态） | 6h | 3.5 |
| 5.3 | `ImpactReportPanel` 组件（回退影响报告） | 4h | 3.2 |
| 5.4 | `SettingsPage`（体裁阈值 + 模型设置） | 6h | 0.1 |
| 5.5 | `GrowthCurveEditor` 组件 | 4h | 4.1 |
| 5.6 | `WritingFormulaPanel` 组件 | 2h | 4.3 |
| 5.7 | 修改 `Stage4Page` 集成全部新组件 | 4h | 5.1-5.6 |
| 5.8 | 修改 `Stage2Page` 增加成长曲线 Tab | 3h | 5.5 |
| 5.9 | `App.tsx` 路由 + `SideNavBar` 导航项更新 | 2h | 5.4 |

### Phase 6: 测试

| Step | 任务 | 预估 | 依赖 |
|---|---|---|---|
| 6.1 | `test_model_router.py`（路由决策 + 降级 + 热更新） | 4h | 0.2 |
| 6.2 | `test_cascade_propagation.py`（级联传播 + 循环检测 + 冲突检测） | 6h | 1.2 |
| 6.3 | `test_narrative_guard.py`（漂移检测 + 降级行为） | 4h | 1.5 |
| 6.4 | `test_l3_cold_memory.py`（分块 + 嵌入 + 混合检索） | 4h | 2.3 |
| 6.5 | `test_impact_analyzer.py`（影响计算 + 分级报告） | 4h | 3.1 |
| 6.6 | `test_reader_os_extended.py`（5 项新指标） | 4h | 3.3 |
| 6.7 | `test_writing_formulas.py` + `test_taboo_constraints.py` | 4h | 4.3, 4.4 |
| 6.8 | 集成测试更新（端到端 + 级联 + Narrative Guard） | 4h | 全部 |


## 十、验收测试计划

### 10.1 自动化测试用例（新增）

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `test_model_router.py` | 15 | 路由决策正确性、降级链、热更新、tier_0 拒绝 LLM 调用、不可用降级 |
| `test_cascade_propagation.py` | 20 | 完整级联链、循环依赖检测、禁止转换、互斥检测、原子写入/回滚 |
| `test_narrative_guard.py` | 10 | 漂移检测、LLM mock、降级跳过、Prompt 格式验证 |
| `test_l3_cold_memory.py` | 12 | 分块正确性、嵌入维度、BM25 索引、RRF 融合排序、Qdrant 不可用降级 |
| `test_l4_narrative.py` | 8 | StoryOS 同步正确性、摘要格式、容量限制（< 3K tokens） |
| `test_impact_analyzer.py` | 12 | 各级修改检测、P0/P1/P2 分级准确性、hash 对比 |
| `test_reader_os_extended.py` | 20 | 5 项新指标计算、体裁阈值加载、用户覆盖 |
| `test_writing_formulas.py` | 8 | 句长统计、对白占比、情绪密度、爽点计数 |
| `test_taboo_constraints.py` | 10 | 虐主检测、连续失败检测、角色禁忌、体裁禁忌 |
| `test_chapter_review.py` | 6 | 评审数据组装、API 端点、决策写入 |
| **合计** | **~121** | |

### 10.2 手动验收

对照 v1.6 PDD §五 的 20 项验收标准逐项验收。关键验收场景：

1. **回退影响传播：** 修改角色名 → P0 报告、修改性格描述 → P1 报告、新增内容 → P2 报告
2. **L3 检索：** 写 5 万字后，用自然语言查询 → < 2 秒返回相关上下文
3. **级联完整链：** 创建 Mystery → 关联 Reveal → 关联 Expectation → 揭示 Mystery → 验证自动级联
4. **Narrative Guard 降级：** 断网 → NG 跳过 → Scene 写作正常完成
5. **热更新：** 修改 model_tiers.yaml → 调用 reload → 下次调用生效


## 十一、前后端接口契约（v1.6 增量）

### 11.1 章节评审

```
GET /api/stage4/chapter-review?project_id={id}&chapter={n}
→ 200: { error: false, detail: ChapterReviewData }
→ 404: { error: true, code: "REVIEW_NOT_FOUND" }

POST /api/stage4/chapter-review/decide
← { project_id, chapter_number, decision: "approved"|"fast_pass"|"revise", feedback?: string }
→ 200: { error: false, detail: { status: "ok" } }
```

### 11.2 回退影响分析

```
POST /api/conductor/analyze-impact
← { project_id, modified_files: ["characters.json"] }
→ 200: { error: false, detail: ImpactReport }

POST /api/conductor/execute-rollback
← { project_id, action: "confirm"|"cancel"|"compat_mode" }
→ 200: { error: false, detail: { status, affected_chapters, ... } }
```

### 11.3 项目设置

```
GET /api/settings/thresholds?project_id={id}
→ 200: { error: false, detail: { genre, defaults: {...}, overrides: {...} } }

PUT /api/settings/thresholds
← { project_id, overrides: { "addiction_critical": 55 } }
→ 200: { error: false, detail: { status: "updated" } }

GET /api/settings/model-config
→ 200: { error: false, detail: { tiers: {...}, agent_mapping: {...} } }

POST /api/settings/reload-config
← {}
→ 200: { error: false, detail: { status: "reloaded" } }
```

### 11.4 ReaderOS 指标

```
GET /api/stage4/reader-os?project_id={id}&chapter={n}
→ 200: { error: false, detail: {
    addiction: 72, fatigue: 38, curiosity: 65,
    tension: 70, satisfaction: 55, frustration: 30, discussion: 60,
    thresholds: { addiction_critical: 50, ... }
  }
}
```

### 11.5 级联传播日志

```
GET /api/storyos/cascade-log?project_id={id}&limit=20
→ 200: { error: false, detail: {
    entries: [
      { timestamp, trigger, source, steps_executed, steps_blocked, cycle_detected, blocked_reason }
    ]
  }
}
```


## 十二、迁移与兼容性

### 12.1 v1.5 项目自动升级

v1.5 项目在 v1.6 中首次打开时，系统自动补齐缺失字段：

| 数据文件 | 缺失字段 | 默认值 | 升级触发时机 |
|---|---|---|---|
| `characters.json` 每个角色 | `growth_curve` | `null` | 首次读取 characters.json 时 |
| `project.json` | `genre_thresholds` | 从 `config/genre_thresholds.yaml` 按 genre 自动填充 | 首次读取 project.json 时 |
| 无 `impact_report.json` | — | 不创建，首次分析时生成 | `POST /analyze-impact` |
| 无 `chapter_reviews/` 目录 | — | 不创建，首次评审时生成 | 每章最后一个 Scene 完成 |
| 无 Qdrant 集合 | — | 显示"索引未就绪"，用户可选择全量索引 | 首次打开 STAGE 4 |

### 12.2 配置文件缺失处理

若 `config/model_tiers.yaml` 不存在（v1.5 项目直接升级）：

- `ModelRouter` 使用内置硬编码默认值（等同于 v1.5 行为：全部 LLM 调用通过 `create_provider()` 工厂的默认 Provider）
- 首次启动时自动将内置默认值写入 `config/model_tiers.yaml`
- 用户后续可编辑 YAML 自定义

### 12.3 L3 冷启动流程

```
用户打开 v1.5 项目（已有 15 章）
    │
    ▼
L3ColdMemory.is_indexed() → False
    │
    ▼
前端提示："L3 语义检索未就绪，建议执行一次性全量索引（约需 2-3 分钟）"
    │
    ├── [立即索引] → 后台遍历 ch01-ch15 草稿 → 分块 → 嵌入 → Qdrant
    │               → 进度条实时更新 → 索引完成后 L3 可用
    │
    └── [稍后] → STAGE 4 写作正常进行，L3 检索返回空
                 → 每完成新的一章自动增量索引
```

### 12.4 忽略非 v1.6 需求

以下 v1.4-iteration 文档中的需求不在 v1.6 范围：
- **叙事重构模式（影响 ≥ 10 章的批量处理）** → v1.8
- **语义完整性预检引擎（LLM）** → v1.7
- **CreativeOS（Idea Pool / Mutation Engine / WhatIf Engine / Novelty Evaluator）** → v1.7
- **多格式导出（PDF / EPUB）** → v1.8
- **流式输出 (SSE)** → v1.7


## 附录 A: 验收标准对照表

| 编号 | 验收项 | 对应功能 | 测试方式 |
|---|---|---|---|
| AC-1 | 回退修改角色设定 → 生成 P0/P1/P2 分级报告 | F1.6.1 | 自动化 + 手动 |
| AC-2 | P0/P1 准确区分（修改角色名 → P0，修改性格 → P1） | F1.6.1 | 自动化 |
| AC-3 | L3 检索 5 万字作品延迟 < 2 秒 | F1.6.2 | 手动（性能基准） |
| AC-4 | L4 与 StoryOS 注册表状态一致 | F1.6.2 | 自动化 |
| AC-5 | Mystery → revealed 完整级联链 | F1.6.3 | 自动化 |
| AC-6 | 循环依赖被检测并中断 | F1.6.3 | 自动化 |
| AC-7 | resolved → active 被正确拦截 | F1.6.3 | 自动化 |
| AC-8 | Narrative Guard 检测漂移 → 生成 warning | F1.6.4 | 自动化（LLM mock） |
| AC-9 | Tier 2 不可用 → NG 静默跳过 | F1.6.4 | 自动化 |
| AC-10 | 成长曲线绑定章节 → Writer 上下文正确 | F1.6.6 | 自动化 |
| AC-11 | 信念变化触发条件不足 → 标记证据不足 | F1.6.6 | 自动化 |
| AC-12 | L3 禁忌拦截"无故虐主超 300 字" | F1.6.7 | 自动化 |
| AC-13 | 爽文写作公式达标检测 | F1.6.7 | 自动化 |
| AC-14 | 体裁阈值自动配置 | F1.6.8 | 自动化 |
| AC-15 | 修改 model_tiers.yaml → 下次调用生效 | F1.6.9 | 自动化 |
| AC-16 | Tier 1 降级 → Scene 写作不中断 | F1.6.9 | 自动化 |
| AC-17 | llm_usage.jsonl 三维度记录 | F1.6.9 | 自动化 |
| AC-18 | 章节评审面板自动展示 | F1.6.10 | 手动 |
| AC-19 | 单章 token 消耗 ~133K（峰值）/ ~110K-120K（典型） | 全局 | 手动（汇总统计） |
| AC-20 | 确定性代码覆盖率 > 85% | 全局 | 自动化 |


## 附录 B: 与 v1.5 TRD 的关键差异

| 维度 | v1.5 TRD | v1.6 TRD |
|---|---|---|
| **基础设施** | 无新增依赖 | ★ Qdrant + bge-m3 + rank-bm25 |
| **LLM 调用模式** | 单 Provider 工厂模式 | ★ ModelRouter 配置驱动多 Tier |
| **Agent 数量** | 5 个（+1 Summary Archiver） | 5 个（不变，各 Agent 能力增强） |
| **MemoryOS 层级** | 3 层（L0/L1/L2） | 5 层（+ L3 冷记忆 + L4 叙事记忆） |
| **ReaderOS 指标** | 2 项（追更欲/疲劳度） | 7 项（+ 好奇心/张力/满足感/挫败感/讨论潜力） |
| **Style Engine 层级** | 1 层（L1 体裁模板） | 3 层（+ L2 写作公式 + L3 禁忌约束） |
| **叙事资产** | 7 类注册表独立管理 | 7 类 + 级联传播 + 冲突检测 |
| **Fact Guard** | 5 项 | 6 项（+ 语义预检框架） |
| **回退能力** | 无 | ★ 影响范围计算 + 分级报告 |
| **章节评审** | 无 | ★ 每章完成自动评审面板 |
| **配置系统** | 环境变量 + settings | ★ YAML 配置 + 热重载 |
| **测试用例** | 152 → 310+ | 310+ → 430+ |
| **总工时** | ~169h (3 phases) | ~126h (6 phases) |
