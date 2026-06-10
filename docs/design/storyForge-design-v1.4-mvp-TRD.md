# StoryForge v1.4-MVP 技术规划需求文档 (TRD)

> **版本:** 1.0 | **日期:** 2026-06-10 | **状态:** 待评审
>
> 本文档是 StoryForge v1.4-MVP 的技术实现规格，整合了 v1.4 完整设计方案、v1.4-MVP 最小可运行版本设计、以及 web UI 设计文档，作为开发团队的技术执行依据。


## 一、项目概述

### 1.1 MVP 目标

完成**一章小说端到端写作**——从项目创建到一章成稿，打通核心链路：

```
INIT → STAGE1(概念) → STAGE2(世界观+角色) → STAGE3(大纲) → STAGE4(写作+审稿+资产更新) → 完成
```

### 1.2 核心约束

| 约束项 | 值 | 说明 |
|---|---|---|
| 章节范围 | 1 章（3-6 个 Scene） | MVP 仅单章 |
| 叙事资产 | 4 类（Conflict / Mystery / Twist / Goal） | 无级联传播 |
| 一致性保障 | Fact Guard 5 项硬检（零 LLM） | 无 Narrative Guard / Style Guard |
| 记忆系统 | L0（运行时）+ L1（热记忆） | 无 L2/L3/L4 |
| 角色数量 | 1 个核心角色 | 无多角色关系网络 |
| Style Engine | 1 个内置体裁模板（爽文） | 无风格沙盒 |
| 模型策略 | 单一 LLM 模型 | 无 Tier 策略 |
| 回退 | 不支持 | 仅线性前进 |
| 导出 | 无 | 直接输出 .md 文件 |

### 1.3 Token 预算

| 阶段 | 调用次数 | 输入 (tokens) | 输出 (tokens) | 小计 |
|---|---|---|---|---|
| STAGE 1 概念生成 | 1 | 2,000 | 1,500 | 3,500 |
| STAGE 2 世界观生成 | 1 | 3,000 | 1,500 | 4,500 |
| STAGE 2 角色生成 | 1 | 3,000 | 1,500 | 4,500 |
| STAGE 3 大纲生成 | 1 | 5,000 | 2,000 | 7,000 |
| STAGE 4 Scene 写作 × 3 | 3 | 7,000 × 3 | 3,000 × 3 | 30,000 |
| STAGE 4 重写（缓冲区） | ≤ 2 | 7,000 × 2 | 3,000 × 2 | 8,400 |
| **合计** | **7-9** | **~38,000** | **~15,500** | **~53,500** |

> **说明:** 不含重写的基线约 35K tokens，含 2 次重写缓冲约 53.5K tokens。AC-8 上限 50K 基于"平均每人章节 0-1 次重写"的假设。上下文组装复用 L0/L1 缓存，每次 Scene 写作实际新增上下文约 5-7K tokens。

### 1.4 技术原则

1. **确定性优先：** 一致性检查、SF_LOG 解析、状态追踪全部使用确定性代码，零 LLM 调用
2. **文件即数据库：** 所有数据以 JSON/YAML/Markdown 文件存储，无需外部数据库
3. **Agent 无状态：** Agent 之间的状态通过 Conductor 和结构化数据文件共享，不直接对话
4. **LLM 调用最小化：** 仅 STAGE 1-3 生成和 Scene 写作调用 LLM，其余全部确定性


## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Web Frontend                         │
│  React + TypeScript + Tailwind CSS + Material Symbols       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │INIT 向导│ │STAGE 1  │ │STAGE 2-3│ │   STAGE 4 写作   │  │
│  │         │ │概念讨论  │ │世界观    │ │   中心 (核心)     │  │
│  │         │ │         │ │角色+大纲 │ │ Scene规划+写作    │  │
│  │         │ │         │ │         │ │ +Fact Guard+日志  │  │
│  └─────────┘ └─────────┘ └─────────┘ └──────────────────┘  │
│                            │                                 │
│                    REST API (JSON)                           │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      Python Backend                          │
│  FastAPI + Pydantic                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │Conductor │ │ Planner  │ │ Writer   │ │  StoryOS      │  │
│  │状态机    │ │ Agent    │ │ Agent    │ │  Agent        │  │
│  │熔断降级  │ │          │ │          │ │  SF_LOG解析   │  │
│  │断点续写  │ │          │ │          │ │  注册表更新   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │Reviewer  │ │MemoryOS  │ │Scene     │                    │
│  │Fact Guard│ │L0 + L1   │ │Engine    │                    │
│  │5项硬检   │ │          │ │Schema    │                    │
│  └──────────┘ └──────────┘ └──────────┘                    │
│                            │                                 │
│                    File System (JSON/YAML/MD)                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层 | 技术 | 版本 | 选型理由 |
|---|---|---|---|
| **Backend Framework** | Python + FastAPI | 3.11+ / 0.110+ | 高性能异步、Pydantic 数据校验、自动 API 文档 |
| **LLM SDK** | Anthropic SDK / OpenAI SDK / DeepSeek SDK / MiniMax SDK | latest | 多 Provider 支持，通过统一抽象层切换 |
| **Frontend Framework** | React + TypeScript | 18+ | 组件化、类型安全 |
| **CSS Framework** | Tailwind CSS | 3.4+ | 与 web UI 设计文档一致（所有 HTML 均用 Tailwind） |
| **Icons** | Material Symbols (Google Fonts) | latest | 与 web UI 设计一致 |
| **Fonts** | Hanken Grotesk / Inter / JetBrains Mono | latest | 设计系统指定字体 |
| **State Management** | React Context + useReducer | - | MVP 规模小，无需 Redux |
| **HTTP Client** | fetch / axios | latest | 前后端通信 |
| **Markdown Rendering** | react-markdown + remark-gfm | latest | STAGE 4 写作区域渲染 |
| **Data Validation** | Pydantic v2 | latest | 后端数据校验 |
| **LLM Prompt Management** | YAML 文件 | - | Prompts 外置，方便调优 |
| **Logging** | Python logging + JSON Lines | - | LLM 调用日志（llm_usage.jsonl） |

### 2.3 不引入的基础设施

| 不引入 | 原因 | MVP 替代方案 |
|---|---|---|
| 数据库（PostgreSQL/MySQL） | 单章数据量极小 | JSON 文件直接读写 |
| Redis / 消息队列 | 无异步任务需求 | 同步请求-响应 |
| Qdrant / 向量数据库 | L3 冷记忆不在 MVP 范围 | 无 |
| Docker / K8s | MVP 本地运行 | 直接 Python 进程 + Vite dev server |
| 用户认证系统 | MVP 单用户本地使用 | 无 |
| 版本控制集成 | MVP 无分支管理 | 文件系统即版本 |


## 三、项目目录结构

```
storyforge/
├── backend/
│   ├── main.py                        # FastAPI 入口，路由注册
│   ├── config.py                      # 配置管理（路径、LLM Provider、模型参数）
│   ├── llm/                            # LLM Provider 抽象层
│   │   ├── __init__.py
│   │   ├── base_provider.py            # Provider 抽象基类
│   │   ├── anthropic_provider.py       # Anthropic (Claude) Provider
│   │   ├── deepseek_provider.py        # DeepSeek Provider
│   │   └── minimax_provider.py         # MiniMax Provider
│   ├── conductor/
│   │   ├── __init__.py
│   │   ├── state_machine.py           # 阶段状态机 + 转换规则
│   │   ├── circuit_breaker.py         # 熔断降级（3 次重试 → force_pass）
│   │   └── checkpoint.py              # Scene 级断点续写
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── base_agent.py              # Agent 基类（LLM 调用封装）
│   │   ├── planner.py                 # STAGE 1-3 内容生成
│   │   ├── writer.py                  # Scene 写作 + SF_LOG 嵌入
│   │   ├── reviewer.py                # Fact Guard 5 项硬检 + 连贯性评分
│   │   └── storyos_agent.py           # SF_LOG 正则解析 + 注册表更新
│   ├── story_os/
│   │   ├── __init__.py
│   │   ├── registries.py              # 4 类资产注册表 CRUD
│   │   └── sf_log_parser.py           # SF_LOG 正则提取器
│   ├── memory_os/
│   │   ├── __init__.py
│   │   ├── l0_runtime.py              # L0 运行时记忆（~500 tokens）
│   │   └── l1_hot.py                  # L1 热记忆（当前章 Scene 内容）
│   ├── scene_engine/
│   │   ├── __init__.py
│   │   ├── schema.py                  # Scene Schema 数据结构
│   │   └── beat_patterns.py           # Beat 模式定义
│   ├── style_engine/
│   │   └── genre_template.py          # 读取 cool_novel.yaml
│   ├── prompts/                       # LLM Prompt 模板（YAML）
│   │   ├── concept_generation.yaml    # STAGE 1 概念生成
│   │   ├── world_generation.yaml      # STAGE 2 世界观生成
│   │   ├── character_generation.yaml  # STAGE 2 角色生成
│   │   ├── outline_generation.yaml    # STAGE 3 大纲生成
│   │   ├── scene_writing.yaml         # STAGE 4 Scene 写作
│   │   └── scene_rewrite.yaml         # Scene 重写（含修改提示）
│   ├── models/                        # Pydantic 数据模型
│   │   ├── __init__.py
│   │   ├── project.py                 # Project, Concept, StoryDNA
│   │   ├── world.py                   # World, PowerSystem, Faction
│   │   ├── character.py               # Character, Personality, VoiceSignature
│   │   ├── outline.py                 # Outline, Chapter, ScenePlan
│   │   ├── storyos.py                 # Conflict, Mystery, Twist, Goal
│   │   ├── sf_log.py                  # SFLogEntry 及 7 种类型
│   │   ├── checkpoint.py              # Checkpoint
│   │   └── progress.py                # Progress, CircuitBreakerEvent
│   ├── api/
│   │   ├── __init__.py
│   │   ├── project.py                 # /api/project/* 路由
│   │   ├── stage1_concept.py          # /api/stage1/* 路由
│   │   ├── stage2_world_char.py       # /api/stage2/* 路由
│   │   ├── stage3_outline.py          # /api/stage3/* 路由
│   │   ├── stage4_writing.py          # /api/stage4/* 路由（核心）
│   │   └── conductor.py               # /api/conductor/* 路由
│   └── utils/
│       ├── __init__.py
│       ├── file_manager.py            # 项目文件读写封装
│       ├── regex_patterns.py          # SF_LOG 正则模式
│       └── token_counter.py           # Token 计数（API response.usage 优先，tiktoken 补充）
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts             # 设计系统 Token（来自 DESIGN.md）
│   ├── index.html
│   └── src/
│       ├── main.tsx                   # React 入口
│       ├── App.tsx                    # 路由 + 全局布局
│       ├── api/                       # API 调用封装
│       │   └── client.ts              # fetch 封装 + 类型
│       ├── hooks/                     # 自定义 Hooks
│       │   ├── useProject.ts          # 项目状态管理
│       │   ├── useConductor.ts        # 阶段状态 + 转换
│       │   └── useStage4Writing.ts    # STAGE 4 写作流状态
│       ├── components/                # 共享组件
│       │   ├── layout/
│       │   │   ├── TopHeader.tsx       # 顶部导航栏
│       │   │   ├── SideNavBar.tsx     # 左侧阶段导航
│       │   │   └── MainLayout.tsx     # 整体布局容器
│       │   ├── shared/
│       │   │   ├── GlassPanel.tsx     # 玻璃面板容器
│       │   │   ├── NarrativeChip.tsx  # 冲突强度/谜团状态标签
│       │   │   ├── SFLogFeed.tsx      # SF_LOG 实时展示
│       │   │   ├── CircuitBreaker.tsx # 熔断降级弹窗
│       │   │   └── ProgressBar.tsx    # 进度条
│       │   └── stage/                 # 各阶段专用组件
│       ├── pages/
│       │   ├── InitPage.tsx           # INIT 向导页
│       │   ├── Stage1Page.tsx         # 概念讨论页
│       │   ├── Stage2WorldPage.tsx    # 世界观工坊页
│       │   ├── Stage2CharPage.tsx     # 角色工坊页
│       │   ├── Stage3Page.tsx         # 情节头脑风暴页
│       │   └── Stage4Page.tsx         # 写作中心页（核心）
│       └── styles/
│           └── globals.css            # 全局样式 + 设计 Token CSS 变量
│
├── data/
│   └── style/
│       └── cool_novel.yaml            # 爽文体裁模板
│
└── projects/                          # 用户项目数据（运行时生成）
    └── proj_001/
        ├── project.json
        ├── concept.json
        ├── story_dna.json
        ├── world.json
        ├── characters.json
        ├── outline.json
        ├── style_formula.yaml
        ├── progress.json
        ├── .storyforge_checkpoint.json
        ├── storyos/
        │   ├── conflicts.json
        │   ├── mysteries.json
        │   ├── twists.json
        │   └── goals.json
        ├── chapters/
        │   └── 001_死亡回档.md
        └── llm_usage.jsonl
```


## 四、后端模块详细规格

### 4.1 Conductor — 主控编排器

#### 4.1.1 阶段状态机 (`conductor/state_machine.py`)

```
类: StageStateMachine
  - stages: list[Stage] = [INIT, STAGE1, STAGE2, STAGE3, STAGE4, COMPLETED]
  - current_stage: Stage
  - stage_history: list[StageTransition]

  transition_check(target: Stage) -> bool:
    # 检查是否允许从 current_stage 转换到 target
    # 仅支持相邻阶段线性前进：INIT→S1→S2→S3→S4
    # 返回 False 如果 target 不是 current 的下一个阶段

  get_precondition(target: Stage) -> PreconditionResult:
    # 返回目标阶段的前置条件及当前满足状态

  advance() -> StageTransition:
    # 执行阶段前进
    # 更新 project.json 的 current_stage 和 stage_history
```

**阶段前置校验规则：**

| 转换 | 校验逻辑 |
|---|---|
| INIT → S1 | project.json 存在，`title` 非空，`genre` 为非空字符串 |
| S1 → S2 | concept.json + story_dna.json 存在，`core_contradiction.statement` 非空 |
| S2 → S3 | world.json + characters.json 存在，`characters` 数组 length >= 1 |
| S3 → S4 | outline.json 存在，`chapters[0]` 存在，`chapters[0].scene_plan` 非空 |
| S4 → COMPLETED | 章节 .md 文件存在，progress.json 中所有 Scene 状态为 completed 或 force_passed |

#### 4.1.2 熔断降级 (`conductor/circuit_breaker.py`)

```
类: CircuitBreaker
  - max_retries: int = 3
  - retry_count: dict[scene_id, int]

  check(scene_id: str, fact_guard_results: list[CheckResult]) -> BreakerDecision:
    # 如果所有检查通过 → return PASS
    # 如果 retry_count < 3 → return RETRY(修改提示列表)
    # 如果 retry_count >= 3 → return BREAK(兼容性说明)

  generate_retry_hints(failed_checks: list[CheckResult]) -> list[str]:
    # 根据失败类型生成具体修改建议
    # 例：检查1失败 → "角色 X 在第 Y 行位于 A，第 Z 行位于 B，缺少 location_change 标记"
```

**熔断后的用户选项：**
- `FORCE_PASS` — 接受当前版本，标记 `force_passed`
- `MANUAL_EDIT` — 用户手动修改文本
- `SKIP` — 跳过此 Scene，标记 `skipped`

#### 4.1.3 断点续写 (`conductor/checkpoint.py`)

```
类: CheckpointManager
  save(project_id: str, checkpoint: Checkpoint) -> None:
    # 写入 projects/{id}/.storyforge_checkpoint.json（覆盖）

  load(project_id: str) -> Checkpoint | None:
    # 读取 checkpoint，不存在返回 None

  recover(project_id: str) -> RecoveryState:
    # 返回恢复所需的状态快照和 recovery_instructions
```

#### 4.1.4 进度追踪 (`models/progress.py`)

`projects/{id}/progress.json` 结构：

```python
class SceneProgress(BaseModel):
    scene_number: int
    status: str                    # "pending" | "writing" | "completed" | "force_passed" | "skipped"
    retry_count: int = 0
    draft_file: str | None = None  # 草稿文件路径（如 scene_001_draft.md）
    coherence_score: int = 0       # Fact Guard 连贯性评分 0-100

class ChapterProgress(BaseModel):
    chapter_number: int
    status: str                    # "pending" | "in_progress" | "completed"
    scenes: list[SceneProgress]

class ProgressFile(BaseModel):
    project_id: str
    current_stage: str             # INIT / STAGE1 / STAGE2 / STAGE3 / STAGE4 / COMPLETED
    current_chapter: int
    total_chapters: int
    chapters: list[ChapterProgress]
    circuit_breaker_events: list[dict] = []  # 熔断事件历史
```

**文件示例：**
```json
{
  "project_id": "proj_001",
  "current_stage": "STAGE4",
  "current_chapter": 1,
  "total_chapters": 1,
  "chapters": [{
    "chapter_number": 1,
    "status": "in_progress",
    "scenes": [
      {"scene_number": 1, "status": "completed", "retry_count": 0, "coherence_score": 88},
      {"scene_number": 2, "status": "completed", "retry_count": 2, "coherence_score": 72},
      {"scene_number": 3, "status": "pending", "retry_count": 0, "coherence_score": 0}
    ]
  }],
  "circuit_breaker_events": []
}
```

### 4.2 LLM Provider 抽象层 (`backend/llm/`)

统一封装多Provider SDK，对上层 Agent 暴露一致的调用接口，支持 Anthropic Claude / DeepSeek / MiniMax 三套 SDK。

#### 4.2.1 Provider 抽象基类 (`llm/base_provider.py`)

```
类: BaseLLMProvider (ABC)
  - api_key: str                   # API Key
  - model: str                     # 模型名称
  - base_url: str | None           # 自定义 API 端点（DeepSeek/MiniMax 兼容 OpenAI 协议时使用）
  - default_max_tokens: int
  - default_temperature: float

  @abstractmethod
  generate(system_prompt: str, user_prompt: str, **kwargs) -> LLMResponse:
    # 子类实现具体 SDK 调用逻辑
    # 返回统一格式: LLMResponse(text, tokens_in, tokens_out, model, provider)

  @abstractmethod
  supports_json_mode() -> bool:
    # 是否原生支持 JSON 模式输出
```

#### 4.2.2 Anthropic Provider (`llm/anthropic_provider.py`)

```
类: AnthropicProvider(BaseLLMProvider)
  基于 anthropic Python SDK

  generate(...) -> LLMResponse:
    # 使用 messages API
    # 支持 system prompt 独立参数
    # 支持 JSON mode (tools forcing)
    # 返回 LLMResponse
```

#### 4.2.3 DeepSeek Provider (`llm/deepseek_provider.py`)

```
类: DeepSeekProvider(BaseLLMProvider)
  基于 OpenAI 兼容协议（deepseek-chat API）

  generate(...) -> LLMResponse:
    # 使用 OpenAI SDK 兼容模式
    # base_url: https://api.deepseek.com/v1
    # 支持 JSON mode: response_format={"type": "json_object"}
    # 返回 LLMResponse
```

#### 4.2.4 MiniMax Provider (`llm/minimax_provider.py`)

```
类: MiniMaxProvider(BaseLLMProvider)
  基于 OpenAI 兼容协议

  generate(...) -> LLMResponse:
    # 使用 OpenAI SDK 兼容模式
    # base_url: https://api.minimax.chat/v1
    # 支持 JSON mode: response_format={"type": "json_object"}
    # 返回 LLMResponse
```

#### 4.2.5 统一数据结构

```
类: LLMResponse (dataclass)
  - text: str                      # 生成文本
  - tokens_in: int                 # 输入 token 数
  - tokens_out: int                # 输出 token 数
  - model: str                     # 实际使用的模型名
  - provider: str                  # Provider 标识（anthropic/deepseek/minimax）
  - finish_reason: str             # stop / length / content_filter
```

#### 4.2.6 Provider 工厂 (`llm/__init__.py`)

```
create_provider(provider: str, config: LLMConfig) -> BaseLLMProvider:
  # provider: "anthropic" | "deepseek" | "minimax"
  # 根据 config.py 中的 LLM_PROVIDER 环境变量创建对应的 Provider 实例

LLMConfig (dataclass):
  - provider: str                  # anthropic / deepseek / minimax
  - model: str                     # 模型名称
  - api_key: str                   # API Key
  - base_url: str | None           # 自定义端点
  - max_tokens: int = 8192
  - temperature: float = 0.7
```

### 4.3 Agent 层

#### 4.3.1 Agent 基类 (`agents/base_agent.py`)

```
类: BaseAgent
  - provider: BaseLLMProvider       # LLM Provider（Anthropic/DeepSeek/MiniMax）
  - prompts_dir: Path               # Prompt YAML 文件目录

  load_prompt(name: str) -> PromptTemplate:
    # 从 prompts/{name}.yaml 加载
    # 返回 PromptTemplate(system_prompt, user_prompt_template, output_schema)

  generate(system_prompt: str, user_prompt: str, output_schema: dict | None = None) -> dict:
    # 通过 self.provider.generate() 调用 LLM
    # 要求 LLM 输出 JSON，校验是否符合 output_schema
    # JSON 解析失败时重试最多 2 次
    # 返回解析后的 dict

  log_usage(task: str, tokens_in: int, tokens_out: int):
    # 追加到 llm_usage.jsonl
```

#### 4.3.2 Planner Agent (`agents/planner.py`)

```
类: PlannerAgent(BaseAgent)
  负责 STAGE 1-3 的内容生成

  generate_concept(project: Project) -> ConceptAndDNA:
    # 输入：project.initial_intent, project.genre
    # 输出：concept.json + story_dna.json
    # 调用 LLM 单轮生成，无 WhatIf 树

  generate_world(concept: Concept, story_dna: StoryDNA) -> World:
    # 输入：concept + story_dna
    # 输出：world.json（精简版）

  generate_character(concept: Concept, story_dna: StoryDNA, world: World) -> CharacterSet:
    # 输入：concept + story_dna + world
    # 输出：characters.json（单角色）

  generate_outline(all_context: Stage1To3Context) -> Outline:
    # 输入：concept + story_dna + world + characters
    # 输出：outline.json（单章，含 Scene 规划 + required_logs）
```

#### 4.3.3 Writer Agent (`agents/writer.py`)

```
类: WriterAgent(BaseAgent)
  负责 STAGE 4 的 Scene 文本生成

  write_scene(context: WritingContext) -> SceneDraft:
    # context 组装顺序：
    #   1. L0 运行时快照（角色当前状态）
    #   2. characters.json → 当前角色 Voice Signature + Taboos
    #   3. world.json → power_system.ceilings + core_rules
    #   4. outline.json → 当前 Scene.scene_plan[i]
    #      (包含 registry_changes + required_logs)
    #   5. style/cool_novel.yaml → 风格指导
    #   6. L1 热记忆 → 已完成 Scene 内容
    #
    # 调用 LLM，生成文本 + SF_LOG 标记
    # 返回 SceneDraft(text, detected_logs)

  rewrite_scene(original_draft: SceneDraft, retry_hints: list[str]) -> SceneDraft:
    # Fact Guard 失败后的重写
    # 注入修改建议作为额外上下文
```

**写作上下文字段详细定义：**

```
类: WritingContext(pydantic.BaseModel)
  - l0_runtime: L0Snapshot           # 角色即时状态
  - character: Character             # 当前角色完整档案
  - world_rules: WorldRulesSummary   # 世界观规则摘要（提取 power_system、ceilings）
  - scene_plan: ScenePlan            # 当前 Scene 规划
  - style_template: StyleTemplate    # 风格模板内容
  - l1_previous_scenes: list[str]    # 已完成 Scene 文本
  - storyos_state: StoryOSSummary    # 当前叙事资产状态摘要
```

#### 4.3.4 Reviewer Agent (`agents/reviewer.py`)

```
类: ReviewerAgent(BaseAgent)  # 注意：Fact Guard 虽然是 Reviewer 的职责，但零 LLM 调用

  run_fact_guard(draft: SceneDraft, context: WritingContext) -> FactGuardResult:
    # 五项确定性检查，零 LLM 调用

  check_1_timeline(draft: SceneDraft, character: Character) -> CheckResult:
    # 提取所有 character_location_change 标记
    # 检查同一角色不会同时出现在两个位置
    # 检查位置变化都有对应标记

  check_2_character_state(draft: SceneDraft, character: Character) -> CheckResult:
    # 检查文本中未展示 character.unknown_to_character 中的秘密
    # 检查未违反 voice_signature.taboos 中的禁止行为
    # 方法：关键词 + 模式匹配

  check_3_world_rules(draft: SceneDraft, world: World) -> CheckResult:
    # 检查能力使用未超过 power_system.ceilings
    # 如有代价体系，检查代价是否在文本中体现或通过 SF_LOG 声明

  check_4_asset_compliance(draft: SceneDraft, storyos: StoryOSState) -> CheckResult:
    # 检查引用的注册表条目存在
    # 检查未将已解决条目改回 active

  check_5_log_completeness(draft: SceneDraft, scene_plan: ScenePlan) -> CheckResult:
    # 检查 required_logs 中每种类型至少出现一次
    # 检查所有 SF_LOG 标签格式正确（严格正则）

  compute_coherence_score(fact_guard_results: list[CheckResult]) -> int:
    # 时间线连续性 30% + 人物状态一致性 30%
    # + 世界规则一致性 20% + 标记完整性 20%
    # 返回 0-100
```

**Fact Guard 五项检查的实现方式总览：**

| 检查项 | 实现方式 | 需要的数据 |
|---|---|---|
| 1. 时间线 | 正则提取所有 `character_location_change` → 比对位置序列 | characters.json current_state.location, SF_LOG |
| 2. 角色状态 | 关键词匹配 `unknown_to_character` + `taboos` 列表 | characters.json |
| 3. 世界规则 | 正则提取能力使用描述 → 比对 `ceilings` | world.json power_system |
| 4. 资产合规 | 正则提取注册表 ID 引用 → 到注册表 JSON 文件查存在性和状态 | conflicts.json, mysteries.json, etc. |
| 5. 标记完整性 | 正则提取所有 SF_LOG 类型 → 比对 `required_logs` → 正则校验格式 | outline.json scene_plan, SF_LOG regex |

#### 4.3.5 StoryOS Agent (`agents/storyos_agent.py`)

```
类: StoryOSAgent
  零 LLM 调用，全部为确定性正则解析

  parse_sf_logs(text: str) -> list[ParsedLog]:
    # 正则：<!-- SF_LOG (\w+) (.*?) -->
    # 返回所有解析成功的日志条目

  parse_log_params(log_type: str, params_str: str) -> dict:
    # 根据 log_type 解析 key="value" 参数对
    # 处理 data='{...}' JSON 内嵌字段

  validate_log_format(text: str) -> list[FormatError]:
    # 检查所有疑似 SF_LOG 的字符串是否格式正确
    # 返回格式错误列表（如缺少引号、类型名拼写错误）

  update_registries(parsed_logs: list[ParsedLog], project_id: str) -> RegistryUpdateReport:
    # 处理 registry_create → 写入对应注册表文件
    # 处理 conflict_escalate → 更新 conflicts.json 中对应条目
    # 处理 mystery_clue → 追加到 mysteries.json 中对应条目的 clues[]
    # 处理 character_emotion/relation/location → 返回角色状态更新（由 MemoryOS 消费）
    # 返回更新报告（创建了哪些、更新了哪些、未预声明的新增）
```

**SF_LOG 正则表达式规范：**

```python
# 顶层提取
SF_LOG_PATTERN = re.compile(r'<!-- SF_LOG (\w+) (.*?) -->', re.DOTALL)

# 参数解析
PARAM_PATTERN = re.compile(r'(\w+)="([^"]*)"')

# 格式校验
FORMAT_CHECK_PATTERN = re.compile(
    r'<!-- SF_LOG \w+ (?:[\w-]+="[^"]*"\s*)+ -->'
)

# 支持的标记类型
VALID_LOG_TYPES = {
    'character_emotion',
    'character_relation_change',
    'character_location_change',
    'knowledge_gain',
    'conflict_escalate',
    'mystery_clue',
    'registry_create',
}
```

**Fact Guard 专用正则（`utils/regex_patterns.py`）：**

Fact Guard 五项检查中的四项依赖正则提取，与 SF_LOG 顶层解析共用 `regex_patterns.py`：

```python
# --- Check 1: 时间线连续性 ---
# 提取所有位置变化标记
LOCATION_CHANGE_PATTERN = re.compile(
    r'<!-- SF_LOG character_location_change char="(\w+)" from="([^"]*)" to="([^"]*)" -->'
)

# 提取所有角色位置声明（用于推断隐含位置）
LOCATION_MENTION_PATTERN = re.compile(
    r'(?:位于|在|来到|到达|回到|进入|离开)(["“][^"”]*["”]|[^\s，。；,\.;]+)'
)

# --- Check 2: 角色状态一致性 ---
# 无独立正则，使用关键词集合匹配
# from characters.json → unknown_to_character[], voice_signature.taboos[]

# --- Check 3: 世界规则 ---
# 提取能力使用描述
POWER_USAGE_PATTERN = re.compile(
    r'(?:发动|释放|施展|使用|启动)(?:\w+·)?(\w+(?:\s*\w+)*)'
)

# 提取代价声明
COST_DECLARATION_PATTERN = re.compile(
    r'<!-- SF_LOG registry_create type="cost" data=\'({[^}]*})\' -->'
)

# --- Check 4: 叙事资产合规 ---
# 提取注册表 ID 引用
ASSET_REF_PATTERN = re.compile(
    r'(?:cf_\d+|mys_\d+|tw_\d+|goal_\d+)'
)

# --- Check 5: 标记完整性 ---
# 统计已嵌入的 SF_LOG 类型，与 required_logs 比对
# 格式校验正则（已在上述 SF_LOG_PATTERN / FORMAT_CHECK_PATTERN 中定义）
```

### 4.4 StoryOS — 叙事资产注册表

#### 4.4.1 数据结构 (`models/storyos.py`)

```python
class Conflict(BaseModel):
    id: str                           # "cf_001"
    owner: str                        # "林峰"
    target: str                       # "不明袭击者"
    type: str                         # "survival" | "ideological" | "personal" | ...
    intensity: str                    # "low" | "medium" | "high" | "critical"
    status: str                       # "active" | "escalated" | "resolved" | "abandoned"
    description: str
    created_chapter: int
    escalation_history: list[EscalationEvent] = []

class Mystery(BaseModel):
    id: str                           # "mys_001"
    question: str                     # "谁杀了林峰？"
    clues: list[Clue] = []            # 线索列表
    status: str                       # "open" | "partially_revealed" | "revealed"
    created_chapter: int
    linked_characters: list[str] = []

class Twist(BaseModel):
    id: str
    description: str
    status: str                       # "foreshadowing" | "ready_to_reveal" | "revealed"
    created_chapter: int
    planned_reveal_chapter: int | None = None

class Goal(BaseModel):
    id: str
    owner: str                        # "char_001"
    content: str                      # "找到杀害自己的凶手"
    progress: str                     # "T0" → "T5" → "T10"
    status: str                       # "active" | "achieved" | "abandoned"
    created_chapter: int
```

#### 4.4.2 注册表文件操作 (`story_os/registries.py`)

```python
class RegistryManager:
    def __init__(self, project_dir: Path): ...

    # 通用 CRUD
    def create(self, registry_type: str, entry: BaseModel) -> None: ...
    def get(self, registry_type: str, entry_id: str) -> dict | None: ...
    def update(self, registry_type: str, entry_id: str, updates: dict) -> None: ...
    def list_all(self, registry_type: str) -> list[dict]: ...

    # 专用方法
    def add_clue(self, mystery_id: str, clue: Clue) -> None: ...
    def escalate_conflict(self, conflict_id: str, event: EscalationEvent) -> None: ...
```

### 4.5 MemoryOS — 记忆系统

#### 4.5.1 L0 运行时记忆 (`memory_os/l0_runtime.py`)

```python
class L0Runtime:
    """约 500 tokens，始终在 Writer 上下文顶部"""
    data: L0Snapshot  # 参见 models 中的定义

    def update_from_logs(self, parsed_logs: list[ParsedLog]) -> None:
        # 根据 character_emotion → 更新 emotional
        # 根据 character_location_change → 更新 location
        # 根据 knowledge_gain → 追加到 recent_knowledge_gains
        # 根据 registry_create → 追加到 open_conflicts/open_mysteries

    def get_context_string(self) -> str:
        # 序列化为自然语言，注入 Writer 上下文
```

#### 4.5.2 L1 热记忆 (`memory_os/l1_hot.py`)

```python
class L1HotMemory:
    """当前章节已完成 Scene 的完整内容"""
    scenes: list[str] = []

    def append_scene(self, scene_text: str) -> None:
        # 追加 Scene 文本（去除 SF_LOG 注释后）

    def get_context_string(self, max_scenes: int = 6) -> str:
        # 返回已完成 Scene 的文本
```

### 4.6 Scene Engine (`scene_engine/schema.py`)

```python
class ScenePlan(BaseModel):
    scene_number: int
    goal: str                         # 本幕叙事目标
    conflict: str                     # 本幕核心冲突
    emotional_arc: str                # 情感弧线
    narrative_role: str               # setup / mini_payoff / cliffhanger / major_reveal
    registry_changes: RegistryChanges
    required_logs: list[str]          # 必须嵌入的 SF_LOG 类型列表

class RegistryChanges(BaseModel):
    created: list[AssetCreation] = [] # 本幕将创建的叙事资产
    updated: list[AssetUpdate] = []   # 本幕将更新的叙事资产

class BeatType(str, Enum):
    SETUP = "setup"
    TENSION_BUILD = "tension_build"
    MINI_PAYOFF = "mini_payoff"
    MAJOR_PAYOFF = "major_payoff"
    CLIFFHANGER = "cliffhanger"
    TRANSITION = "transition"
```


## 五、API 设计

### 5.1 API 总览

所有 API 返回 JSON，统一错误格式：

```json
{"error": true, "code": "STAGE_NOT_READY", "message": "当前阶段为 INIT，无法执行 STAGE 4 操作"}
```

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/project/create` | 创建新项目（INIT） |
| GET | `/api/project/{id}/status` | 获取项目当前状态 |
| POST | `/api/conductor/advance` | 推进到下一阶段 |
| POST | `/api/stage1/generate` | STAGE 1 概念生成 |
| PUT | `/api/stage1/concept` | 手动编辑 concept + story_dna |
| POST | `/api/stage2/generate-world` | STAGE 2 世界观生成 |
| POST | `/api/stage2/generate-character` | STAGE 2 角色生成 |
| PUT | `/api/stage2/world` | 手动编辑 world.json |
| PUT | `/api/stage2/character` | 手动编辑 characters.json |
| POST | `/api/stage3/generate` | STAGE 3 大纲生成 |
| PUT | `/api/stage3/outline` | 手动编辑 outline.json |
| GET | `/api/stage4/scene-plan/{scene_num}` | 获取 Scene 规划 |
| POST | `/api/stage4/write-scene` | **执行 Scene 写作 + Fact Guard + StoryOS 更新** |
| POST | `/api/stage4/force-pass` | 熔断后用户选择 force_pass |
| POST | `/api/stage4/skip-scene` | 熔断后用户选择 skip |
| GET | `/api/stage4/progress` | 获取写作进度 |
| GET | `/api/storyos/{registry_type}` | 查询叙事资产注册表 |

### 5.2 核心 API 详细定义

#### `POST /api/stage4/write-scene` — MVP 核心 API

**请求：**
```json
{
  "project_id": "proj_001",
  "chapter_number": 1,
  "scene_number": 2
}
```

**处理流程（后端内部）：**
```
1. Conductor 检查当前阶段 = STAGE4
2. 读取 outline.json → 获取 Scene Plan
3. 组装 WritingContext（L0 + character + world + scene_plan + style + L1）
4. Writer Agent 调用 LLM 生成 Scene 文本
5. Reviewer 执行 Fact Guard 5 项硬检
   ├── 全部通过 → 6
   └── 不通过 → retry_count < 3 ? 返回 retry_hints : 触发 CircuitBreaker
6. StoryOS Agent 正则解析 SF_LOG → 更新注册表
7. MemoryOS L0/L1 更新
8. Checkpoint 写入
```

**响应（通过）：**
```json
{
  "status": "passed",
  "scene_number": 2,
  "draft_text": "林峰睁开眼睛的瞬间...",
  "parsed_logs": [
    {"type": "character_emotion", "params": {"char": "林峰", "emotion": "警惕"}},
    {"type": "registry_create", "params": {"type": "mystery", "data": {...}}}
  ],
  "fact_guard_results": {
    "all_passed": true,
    "checks": [
      {"check_id": 1, "name": "时间线连续性", "passed": true},
      {"check_id": 2, "name": "角色状态一致性", "passed": true},
      {"check_id": 3, "name": "世界规则一致性", "passed": true},
      {"check_id": 4, "name": "叙事资产合规", "passed": true},
      {"check_id": 5, "name": "变化标记完整性", "passed": true}
    ],
    "coherence_score": 85
  },
  "registry_updates": {
    "created": ["mys_002"],
    "updated": []
  },
  "l0_snapshot": {...}
}
```

**响应（需重写）：**
```json
{
  "status": "retry",
  "scene_number": 2,
  "retry_count": 1,
  "draft_text": "林峰睁开眼睛的瞬间...",
  "fact_guard_results": {
    "all_passed": false,
    "checks": [
      {"check_id": 1, "name": "时间线连续性", "passed": false,
       "detail": "角色'林峰'在第12行位于'教室'，第45行位于'实验室'，但未发现 character_location_change 标记"}
    ],
    "coherence_score": 55
  },
  "retry_hints": [
    "请在第45行附近添加：<!-- SF_LOG character_location_change char=\"林峰\" from=\"教室\" to=\"实验室\" -->"
  ]
}
```

**响应（熔断）：**
```json
{
  "status": "circuit_breaker_triggered",
  "scene_number": 2,
  "retry_count": 3,
  "draft_text": "...",
  "persistent_failures": [...],
  "compatibility_note": "第 3 次重写后检查项 1 仍未通过...",
  "user_options": ["force_pass", "manual_edit", "skip"]
}
```

**重写（Retry）流程：**

```
前端收到 status="retry"
  → 展示 retry_hints 给用户
  → 用户点击"重写"按钮（或自动触发）
  → 再次调用 POST /api/stage4/write-scene（相同 scene_number）
  → 后端 CircuitBreaker 通过 retry_count[scene_id] 识别这是第 N 次重试
  → Writer.rewrite_scene() 注入 retry_hints 作为额外上下文
  → 重复 Review → StoryOS → Checkpoint 流程
```

**流式输出说明：**

MVP 阶段 LLM 生成为同步请求-响应模式。`isStreaming` 字段预留给 v1.5+ 升级为 SSE（Server-Sent Events）流式输出，届时写作体验将从"等待完整结果"变为"逐 token 展示生成过程"。


## 六、前端页面规格

### 6.1 全局布局组件

#### 6.1.1 MainLayout — 整体布局容器

参照 web UI 设计中所有页面的统一布局模式：

```
┌──────────────────────────────────────────────────────┐
│ TopHeader (fixed, h-16)                              │
│ [StoryForge] [项目名] [阶段] [模式]    [搜索] [通知] [头像] │
├──────────┬───────────────────────────────────────────┤
│SideNavBar│          Main Content Area                 │
│(fixed,   │                                            │
│ w-70,    │                                            │
│ h-full)  │                                            │
│          │                                            │
│ 项目     │                                            │
│ 仪表板   │                                            │
│ ──────── │                                            │
│ 阶段1-6  │                                            │
│ ──────── │                                            │
│ 灵感库   │                                            │
│ 风格沙盒 │                                            │
│ 资产中心 │                                            │
│ ──────── │                                            │
│ 设置     │                                            │
└──────────┴───────────────────────────────────────────┘
```

**Tailwind 实现要点：**
- Header: `fixed top-0 left-0 w-full z-50 h-16 bg-surface-container-low border-b border-outline-variant`
- Sidebar: `fixed left-0 top-16 w-[280px] h-[calc(100vh-64px)] bg-surface-container-low border-r border-outline-variant`
- Content: `ml-[280px] mt-16`
- 字体：Header 用 `font-display-lg`（Hanken Grotesk），Sidebar 导航用 `font-label-mono`（JetBrains Mono），内容区用 `font-body-ui`（Inter）

#### 6.1.2 TopHeader 组件

```tsx
interface TopHeaderProps {
  projectName: string;
  currentStage: string;      // "INIT" | "STAGE1" | ... | "STAGE4"
  collaborationMode: string; // "live" | "discuss"
  autoSaveStatus: "saved" | "saving" | "error";
}
```

- 左侧：StoryForge Logo + 项目名 + 阶段标签 + 模式指示灯
- 右侧：搜索框 + 通知按钮 + 用户头像
- 设计系统配色：`text-primary-container`、`bg-surface-container`、`border-outline-variant`

#### 6.1.3 SideNavBar 组件

```tsx
interface SideNavBarProps {
  currentStage: string;
  onNavigate: (stage: string) => void;
}
```

- 项目操作区（项目库、仪表板）
- 叙事阶段导航（6 个阶段，当前阶段高亮 `bg-primary-container/10 border-l-2 border-primary-container`）
- 工作区（灵感库、风格沙盒、资产中心——MVP 中标记为 disabled）
- 底部设置

### 6.2 INIT 向导页 (`pages/InitPage.tsx`)

**对应 MVP 设计:** 第四节 INIT 阶段

**UI 组件结构：**
```
┌─────────────────────────────────────┐
│        欢迎使用 StoryForge           │
│                                      │
│  Step 1: 意图输入                    │
│  ┌─────────────────────────────┐    │
│  │ 你想写一个什么样的故事？     │    │
│  │                             │    │
│  │ [                    ]      │    │
│  │                             │    │
│  │ [给我一些热门的灵感] [上传]  │    │
│  └─────────────────────────────┘    │
│                                      │
│  Step 2: 基础参数                    │
│  目标体裁: [爽文 ▼]                  │
│  最低字数: [4000]                    │
│                                      │
│  [开始创作]                          │
└─────────────────────────────────────┘
```

**状态管理：**
```tsx
const [step, setStep] = useState<1 | 2>(1);
const [intent, setIntent] = useState("");
const [genre, setGenre] = useState("cool_novel");
const [minWords, setMinWords] = useState(4000);
```

**API 调用：** `POST /api/project/create` → 创建 project.json → 推进到 STAGE1

### 6.3 STAGE 1 概念讨论页 (`pages/Stage1Page.tsx`)

**对应 MVP 设计:** 第五节 STAGE 1

**UI 组件结构：**
```
┌──────────────────────────────────────────────┐
│  阶段 1 · 概念讨论                            │
│                                              │
│  ┌────────────────────┐ ┌──────────────────┐ │
│  │ 您的故事意图        │ │ 生成的 Story DNA  │ │
│  │                    │ │                  │ │
│  │ "顶级程序员重生..." │ │ 核心矛盾：       │ │
│  │                    │ │ 能力×限制        │ │
│  │                    │ │                  │ │
│  └────────────────────┘ └──────────────────┘ │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ concept.json 预览                     │    │
│  │ 书名 / 体裁 / 前提 / 基调 / 主题      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  [重新生成] [手动编辑] [确认并继续 → STAGE 2]  │
└──────────────────────────────────────────────┘
```

**API 调用：** `POST /api/stage1/generate` → 返回 concept + story_dna → 用户确认或重新生成

### 6.4 STAGE 2 世界观+角色页 (`pages/Stage2WorldPage.tsx` + `pages/Stage2CharPage.tsx`)

**对应 MVP 设计:** 第六节 STAGE 2
**对应 Web UI:** storyforge_stage_2_world/code.html + storyforge_stage_2_character/code.html

> **页面组织:** SideNavBar 中 STAGE 2 为单一路由入口，页面内部通过 Tab 切换"世界观工坊"和"角色工坊"两个子面板。两个 `*.tsx` 文件为独立组件，由 `Stage2Page.tsx` 容器组件通过 `activeTab` 状态管理切换。

**世界观 Tab 布局（参照 web UI）：**
- 左侧：结构树（时代 → 地理 → 能力体系 → 势力）
- 右侧：详情卡片（Power System Card 含能力阶段、规则、代价、上限）

**角色 Tab 布局（参照 web UI）：**
- 核心人格层（信念/欲望/恐惧/价值观）
- 当前状态（位置/身体/情绪/已知秘密）
- 声音签名（说话风格/思维模式/禁忌行为）

**API 调用：** `POST /api/stage2/generate-world` + `POST /api/stage2/generate-character`

### 6.5 STAGE 3 情节头脑风暴页 (`pages/Stage3Page.tsx`)

**对应 MVP 设计:** 第七节 STAGE 3
**对应 Web UI:** storyforge_stage_3_/code.html

**UI 组件结构：**
```
┌──────────────────────────────────────────────┐
│  阶段 3 · 情节头脑风暴                        │
│                                              │
│  章节概览: 第1章 · 死亡回档                    │
│                                              │
│  Scene 规划 (3 列网格，参照 web UI Stage4):   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Scene 1  │ │ Scene 2  │ │ Scene 3  │     │
│  │ 前世死亡  │ │ 能力发现  │ │ 校园悬念  │     │
│  │ cf_001   │ │ mys_002  │ │          │     │
│  │ mys_001  │ │          │ │          │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│                                              │
│  伏笔映射表:                                  │
│  fs_001 · 代码观察者 · planted · 关联 mys_002 │
│                                              │
│  [重新生成] [手动编辑] [确认 → 开始写作]       │
└──────────────────────────────────────────────┘
```

**API 调用：** `POST /api/stage3/generate`

### 6.6 STAGE 4 写作中心页 (`pages/Stage4Page.tsx`) — MVP 核心

**对应 MVP 设计:** 第八节 STAGE 4
**对应 Web UI:** storyforge_stage_4/code.html

#### 6.6.1 整体布局

参照 web UI Stage 4 的三面板布局：

```
┌──────────────────────────────────────────────────────────────┐
│ TopHeader: 代码天才重生记 | 实时写作模式 | 第1章 / Scene 2      │
├──────────┬───────────────────────────────────┬───────────────┤
│SideNavBar│     Central Creative Canvas       │  Right Panel  │
│          │                                   │               │
│          │  Scene Planner (3 列网格)          │  StoryOS      │
│          │  ┌──────┐ ┌──────┐ ┌──────┐      │  资产状态     │
│          │  │S1 ✓ │ │S2 ● │ │ S3   │      │               │
│          │  └──────┘ └──────┘ └──────┘      │  活跃冲突:2   │
│          │                                   │  开放谜团:2   │
│          │  Rich Text Editor                 │               │
│          │  ┌─────────────────────────┐      │  SF_LOG Feed  │
│          │  │                         │      │  ───────────  │
│          │  │  第三章：编译第一个...    │      │  emotion     │
│          │  │                         │      │  knowledge   │
│          │  │  <!-- SF_LOG ... -->    │      │  registry_   │
│          │  │                         │      │  create      │
│          │  └─────────────────────────┘      │               │
│          │                                   │  Fact Guard   │
│          │  操作栏: [接受] [重写] [修改]       │  ☑ 时间线     │
│          │                                   │  ☑ 角色状态   │
│          │                                   │  ☑ 世界规则   │
│          │                                   │  ☑ 资产合规   │
│          │                                   │  ☑ 标记完整性 │
│          │                                   │  得分: 85     │
└──────────┴───────────────────────────────────┴───────────────┘
```

#### 6.6.2 Scene Planner 子组件

```tsx
interface ScenePlannerProps {
  scenes: ScenePlan[];
  currentScene: number;
  sceneStatuses: Record<number, 'pending' | 'writing' | 'completed' | 'skipped'>;
}
```

- 3 列网格展示（参照 web UI 的 `grid grid-cols-3 gap-4 p-gutter`）
- 每个 Scene 卡片显示：目标、冲突、进度条、状态图标
- 当前 Scene 高亮（`border-primary-container/50 shadow-[0_0_10px_rgba(0,240,255,0.1)]`）
- 已完成 Scene 显示 ✓

#### 6.6.3 Rich Text Editor 子组件

```tsx
interface WritingCanvasProps {
  draftText: string;
  isStreaming: boolean;        // MVP 暂不支持流式，保留字段为 v1.5 SSE 扩展做准备
  onAccept: () => void;
  onRewrite: () => void;       // 触发重写（调用 POST /api/stage4/write-scene，后端自动识别 retry_count）
  onManualEdit: (newText: string) => void;
}
```

- 参照 web UI：`max-w-3xl mx-auto pb-32` 的阅读宽栏布局
- 文本使用 `font-body-narrative text-body-narrative`（Inter 18px, leading-relaxed）
- SF_LOG 标记以 `sf-log-inline` 样式展示（参照 web UI：`bg-primary-container/5 border-l-2 border-primary-container font-code-sm text-system-log`）
- 光标颜色：`caret-primary-container`

#### 6.6.4 Fact Guard 结果面板

```tsx
interface FactGuardPanelProps {
  results: FactGuardResults;
  coherenceScore: number;
  onForcePass: () => void;
}
```

- 参照 web UI DESIGN.md 中的设计：
  - "Fact Guards (Strict): Use perfectly sharp 0px corners to signal rigidity"
  - 通过项：绿色 `tertiary` 对勾
  - 失败项：红色 `error-p0` 叉号 + 详细说明
  - 熔断状态：红色终端风格警告弹窗（CircuitBreaker 组件）

#### 6.6.5 SF_LOG Feed 子组件

```tsx
interface SFLogFeedProps {
  logs: ParsedLog[];
}
```

- 右侧面板底部，滚动列表
- 参照 web UI DESIGN.md："A scrolling, vertical list of monospaced text... showing real-time token processing"
- 字体：`font-code-sm`（JetBrains Mono 11px）
- 颜色：`text-system-log`（#64748B）

#### 6.6.6 STAGE 4 状态机

```tsx
type Stage4State =
  | { phase: 'scene_planning' }                    // 展示 Scene 规划
  | { phase: 'writing'; sceneNumber: number }       // Writer 生成中（streaming）
  | { phase: 'reviewing'; draft: SceneDraft }      // 展示草稿 + Fact Guard 结果
  | { phase: 'retry'; retryCount: number; hints: string[] }  // 需重写
  | { phase: 'circuit_breaker'; note: string }     // 熔断降级
  | { phase: 'completed'; sceneNumber: number }    // Scene 完成
  | { phase: 'chapter_done' };                    // 全部 Scene 完成
```

状态流转由 `POST /api/stage4/write-scene` 的响应驱动。

#### 6.6.7 错误边界处理

考虑到 LLM 生成可能出现非预期输出（格式损坏的 JSON、超长文本、无 SF_LOG 标记等），在 Stage4Page 层面包裹 React Error Boundary：

```tsx
// components/shared/StageErrorBoundary.tsx
<ErrorBoundary
  fallback={({ error, reset }) => (
    <CircuitBreaker
      title="页面渲染异常"
      message={error.message}
      userOptions={[
        { label: "重试渲染", action: reset },
        { label: "回退到草稿", action: () => navigate(`/project/${id}/stage4`) },
        { label: "查看原始数据", action: () => showRawJSON(draftText) }
      ]}
    />
  )}
>
  <Stage4Page />
</ErrorBoundary>
```
- 捕获 LLM 输出渲染异常、Markdown 解析异常、数据格式异常
- 降级策略：显示 CircuitBreaker 弹窗 → 用户选择重试/查看原始数据/回退

### 6.7 设计系统 CSS 变量

从 DESIGN.md 提取，定义在 `frontend/src/styles/globals.css`：

```css
:root {
  /* Surface */
  --color-canvas-bg: #020617;
  --color-surface: #0b1326;
  --color-surface-panel: #1E293B;
  --color-surface-container: #171f33;
  --color-surface-container-low: #131b2e;
  --color-surface-container-lowest: #060e20;
  --color-surface-container-high: #222a3d;

  /* Primary (Tech Blue) */
  --color-primary: #dbfcff;
  --color-primary-container: #00f0ff;
  --color-primary-fixed-dim: #00dbe9;
  --color-on-primary: #00363a;
  --color-on-primary-container: #006970;

  /* Secondary (Ether Purple) */
  --color-secondary: #d0bcff;
  --color-secondary-container: #571bc1;

  /* Tertiary (Vitality Green) */
  --color-tertiary: #d8ffe7;
  --color-tertiary-container: #65f2b5;
  --color-tertiary-fixed-dim: #4edea3;

  /* Semantic */
  --color-error-p0: #DC2626;
  --color-warning-p1: #F59E0B;
  --color-system-log: #64748B;
  --color-novelty-high: #3B82F6;
  --color-saturation-high: #EF4444;

  /* Typography */
  --font-display: 'Hanken Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

这些 CSS 变量作为 Tailwind `extend.colors` 的映射源。

**Tailwind 颜色映射规则（T2.1 任务中执行）：**

```
tailwind.config.ts: extend.colors
  primary: {
    DEFAULT: 'var(--color-primary)',
    container: 'var(--color-primary-container)',
    'fixed-dim': 'var(--color-primary-fixed-dim)',
    'on-primary': 'var(--color-on-primary)',
    'on-container': 'var(--color-on-primary-container)',
  },
  secondary: {
    DEFAULT: 'var(--color-secondary)',
    container: 'var(--color-secondary-container)',
  },
  tertiary: {
    DEFAULT: 'var(--color-tertiary)',
    container: 'var(--color-tertiary-container)',
    'fixed-dim': 'var(--color-tertiary-fixed-dim)',
  },
  surface: {
    DEFAULT: 'var(--color-surface)',
    panel: 'var(--color-surface-panel)',
    container: 'var(--color-surface-container)',
    'container-low': 'var(--color-surface-container-low)',
    'container-lowest': 'var(--color-surface-container-lowest)',
    'container-high': 'var(--color-surface-container-high)',
  },
  canvas: { bg: 'var(--color-canvas-bg)' },
  error:   { p0: 'var(--color-error-p0)' },
  warning: { p1: 'var(--color-warning-p1)' },
  system:  { log: 'var(--color-system-log)' },
  novelty: { high: 'var(--color-novelty-high)' },
  saturation: { high: 'var(--color-saturation-high)' },
```

> **使用示例:** `bg-primary-container` / `text-system-log` / `border-error-p0` / `shadow-primary-container/10`


## 七、Prompt 设计

### 7.1 Prompt 管理方式

所有 Prompt 以 YAML 文件存储在 `backend/prompts/`，格式统一：

```yaml
name: scene_writing
provider: deepseek              # anthropic / deepseek / minimax
model: deepseek-chat            # 模型名称（对应 provider 的模型 ID）
temperature: 0.7
max_tokens: 8192
system_prompt: |
  你是一个专业网文写手...
user_prompt_template: |
  ## 世界观设定
  {world_context}

  ## 角色设定
  {character_context}

  ## 本幕规划
  {scene_plan}

  ## 必须嵌入的 SF_LOG 标记
  {required_logs_instruction}

  ## 已完成内容
  {l1_context}

  请写出本幕内容。
output_format:
  type: json
  schema:
    text: string
    embedded_logs: list

### 7.2 STAGE 4 Scene 写作 Prompt 结构 (`prompts/scene_writing.yaml`)

```
System:
  你是一个专业网文写手，擅长{genre}风格写作。
  你的任务是写一个约{min_words}字的小说场景。
  
  写作规则：
  1. 使用简洁有力的中文
  2. 在文本中嵌入 SF_LOG 标记来追踪叙事变化
  3. 严格遵循角色设定和世界观规则
  4. 每段不超过 200 字，保持阅读节奏

User:
  ## 故事背景
  {story_dna.core_contradiction}
  {concept.premise}
  
  ## 世界观规则
  能力体系：{world.power_system.name} — {world.power_system.description}
  核心规则：{world.power_system.core_rules}
  能力上限：{world.power_system.ceilings}
  
  ## 当前角色状态
  角色：{character.name}
  当前位置：{character.current_state.location}
  当前情绪：{character.current_state.emotional}
  角色不能做的事：{character.voice_signature.taboos}
  角色不知道的事：{character.unknown_to_character}
  
  ## 本幕目标
  叙事目标：{scene_plan.goal}
  核心冲突：{scene_plan.conflict}
  情感弧线：{scene_plan.emotional_arc}
  叙事角色：{scene_plan.narrative_role}
  
  ## SF_LOG 标记要求
  本幕必须嵌入以下类型的标记：
  {required_logs_list}
  
  标记格式：
  <!-- SF_LOG <类型> <参数名>="<参数值>" ... -->
  
  ## 前文回顾
  {l1_context}
  
  请开始写作本幕。
```

### 7.3 Scene 重写 Prompt 结构 (`prompts/scene_rewrite.yaml`)

重写采用**全量上下文重传**策略：

```
System:
  与 scene_writing 相同，追加：
  "你之前的版本未能通过以下检查。请根据修改建议重写。"

User:
  [完整原始上下文：L0 Runtime + character + world + scene_plan + style + L1]
  
  ## 上一版本问题
  {retry_hints}
  
  ## 上一版本草稿（供参考）
  {previous_draft}
  
  请重写本幕，确保解决以上问题。
```

> **Token 成本:** 每次重写额外消耗约 10K tokens（原始上下文 ~7K + retry_hints + previous_draft）。MVP 单 Scene 最多 3 次重写尝试，额外缓冲区见 §1.3 Token 预算。


## 八、开发任务分解

### Phase 0: 项目脚手架（Week 1, Day 1-2）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| T0.1 | 初始化 Python 项目结构 | 2h | `backend/` 目录 + `requirements.txt` |
| T0.2 | 初始化 React + Vite + Tailwind 项目 | 2h | `frontend/` 目录，Tailwind 配置与设计 Token 对齐 |
| T0.3 | 创建 Pydantic 数据模型 | 4h | `backend/models/` 全部 8 个模型文件 |
| T0.4 | 创建 FastAPI 入口 + 路由骨架 | 2h | `main.py` + `api/` 路由占位 |
| T0.5 | 创建 Prompt YAML 模板文件 | 3h | `backend/prompts/` 6 个模板 |
| T0.6 | 创建前端共享组件骨架 | 3h | `MainLayout`, `TopHeader`, `SideNavBar` |

### Phase 1: 后端核心链路（Week 1-2）

| ID | 任务 | 预估 | 依赖 |
|---|---|---|---|
| T1.1 | Conductor 阶段状态机 | 4h | T0.3 |
| T1.2 | Conductor 熔断降级 | 3h | T1.1 |
| T1.3 | Conductor 断点续写 | 3h | T1.1 |
| T1.4 | BaseAgent + LLM 调用封装 | 4h | T0.5 |
| T1.5 | Planner Agent（STAGE 1-3 生成） | 8h | T1.4 |
| T1.6 | Writer Agent（Scene 写作） | 8h | T1.4 |
| T1.7 | Reviewer — Fact Guard 5 项硬检 | 12h | T0.3 |
| T1.8 | StoryOS Agent — SF_LOG 正则解析 | 6h | T0.3 |
| T1.9 | RegistryManager — 注册表 CRUD | 4h | T0.3 |
| T1.10 | MemoryOS L0 + L1 | 4h | T1.8 |
| T1.11 | API 路由实现 | 8h | T1.1-T1.10 |
| T1.12 | 集成测试：端到端一章写作 | 4h | T1.11 |

### Phase 2: 前端页面（Week 2-3）

| ID | 任务 | 预估 | 依赖 |
|---|---|---|---|
| T2.1 | 设计 Token + 全局 CSS + Tailwind 配置 | 3h | T0.2 |
| T2.2 | MainLayout + TopHeader + SideNavBar 实现 | 6h | T2.1 |
| T2.3 | INIT 向导页 | 4h | T2.2 |
| T2.4 | STAGE 1 概念讨论页 | 6h | T2.2 |
| T2.5 | STAGE 2 世界观+角色页（Tab 切换） | 8h | T2.2 |
| T2.6 | STAGE 3 情节头脑风暴页 | 6h | T2.2 |
| T2.7 | STAGE 4 写作中心页 — Scene Planner | 4h | T2.2 |
| T2.8 | STAGE 4 写作中心页 — Writing Canvas | 8h | T2.7 |
| T2.9 | STAGE 4 写作中心页 — Fact Guard 面板 | 4h | T2.7 |
| T2.10 | STAGE 4 写作中心页 — SF_LOG Feed | 3h | T2.7 |
| T2.11 | STAGE 4 写作中心页 — CircuitBreaker 弹窗 | 3h | T2.7 |
| T2.12 | API Client 封装 + 前后端联调 | 6h | T1.11, T2.3-T2.11 |

### Phase 3: 测试与打磨（Week 3-4）

| ID | 任务 | 预估 | 依赖 |
|---|---|---|---|
| T3.1 | 验收测试：AC-1 ~ AC-10 | 8h | T1.12, T2.12 |
| T3.2 | Bug 修复 | 8h | T3.1 |
| T3.3 | UI 细节与设计对齐 | 4h | T2.12 |
| T3.4 | 错误处理与边界情况 | 4h | T3.1 |
| T3.5 | 性能优化（LLM streaming、大文本渲染） | 4h | T3.1 |

**总预估：** 约 18 个工作日（~144 小时），与 CLAUDE.md 中 Phase 1 的 4 周一致。

### 优先级标记

- **P0（阻塞）:** T0.3, T1.1, T1.4, T1.6, T1.7, T1.8 —— 核心链路
- **P1（关键）:** T1.5, T2.8, T2.12 —— 主要功能
- **P2（重要）:** T2.3-T2.7, T2.9-T2.11 —— 辅助页面
- **P3（优化）:** T3.3, T3.5 —— 打磨


## 九、验收测试计划

### 9.1 自动化测试

| 测试项 | 测试方法 | 覆盖内容 |
|---|---|---|
| SF_LOG 正则解析 | `pytest` 单元测试 | 7 种标记类型正确解析、格式错误正确拦截、JSON data 内嵌正确提取 |
| Fact Guard 5 项检查 | `pytest` 单元测试 | 每项检查的通过/不通过场景各 ≥ 3 个测试用例 |
| 注册表 CRUD | `pytest` 单元测试 | 创建/读取/更新/列表，并发写入安全 |
| 阶段状态机转换 | `pytest` 单元测试 | 合法转换通过、非法转换拒绝、前置校验 |
| API 端点 | `pytest` + FastAPI TestClient | 所有端点 200/4xx/5xx 响应 |

### 9.2 手动验收测试（对应 MVP AC-1 ~ AC-10）

| AC | 测试步骤 |
|---|---|
| AC-1 端到端 | 从 INIT 向导开始 → 完成所有阶段 → 获得一章完整小说 |
| AC-2 SF_LOG 标记 | 检查生成的 Scene 文本，确认包含格式正确的 SF_LOG 标记 |
| AC-3 Fact Guard 捕获错误 | 手动编辑 Scene 文本故意制造位置矛盾 → 确认 Fact Guard 阻断 |
| AC-4 熔断降级 | 注入无法修复的持久错误 → 确认 3 次重试后触发 CircuitBreaker 弹窗 |
| AC-5 注册表更新 | 对比 StoryOS Agent 解析结果与预期注册表状态 |
| AC-6 零 LLM | 审查代码路径，确认 Fact Guard 和 StoryOS Agent 无 LLM 调用 |
| AC-7 断点恢复 | 写作过程中 kill 进程 → 重启 → 确认从 checkpoint 恢复 |
| AC-8 Token < 50K | 记录完整一章的 LLM token 消耗 |
| AC-9 required_log 缺失阻断 | 故意在 outline 中声明 required_log 但 Writer 未生成 → 确认阻断 |
| AC-10 格式错误阻断 | 注入格式错误的 SF_LOG → 确认 Fact Guard Check 5 阻断 |


## 十、前后端接口契约

### 10.1 数据流

```
前端                          后端                        文件系统
 │                             │                            │
 │── POST /project/create ────→│── 写入 project.json ──────→│
 │←── project.json ────────────│←───────────────────────────│
 │                             │                            │
 │── POST /stage1/generate ───→│── Planner LLM 调用 ──────→ │
 │                             │── 写入 concept.json ──────→│
 │                             │── 写入 story_dna.json ────→│
 │←── {concept, story_dna} ───│←───────────────────────────│
 │                             │                            │
 │── ... STAGE 2/3 类似 ...   │                            │
 │                             │                            │
 │── POST /stage4/write-scene →│                            │
 │                             │── 读取所有前置数据          │
 │                             │── 组装 WritingContext       │
 │                             │── Writer LLM 调用           │
 │                             │── Reviewer Fact Guard       │
 │                             │    ├── 通过 → 继续          │
 │                             │    └── 不通过 → 返回 retry  │
 │                             │── StoryOS Agent 解析        │
 │                             │── 更新注册表 JSON            │
 │                             │── 写入 checkpoint            │
 │←── SceneDraft + Results ────│                            │
 │                             │                            │
 │── POST /stage4/force-pass ─→│── 标记 force_passed       │
 │── POST /stage4/skip-scene ──→│── 标记 skipped            │
```

### 10.2 错误处理规范

所有 API 返回统一错误格式：

```json
{
  "error": true,
  "code": "ERROR_CODE",
  "message": "人类可读的错误描述",
  "detail": {} 
}
```

**错误码列表：**

| Code | HTTP | 说明 |
|---|---|---|
| `PROJECT_NOT_FOUND` | 404 | 项目 ID 不存在 |
| `STAGE_NOT_READY` | 400 | 当前阶段不允许此操作 |
| `STAGE_TRANSITION_INVALID` | 400 | 不能跳跃阶段 |
| `PRECONDITION_FAILED` | 400 | 阶段前置条件未满足 |
| `LLM_PROVIDER_NOT_SUPPORTED` | 400 | 不支持的 LLM Provider（须为 anthropic/deepseek/minimax 之一） |
| `LLM_API_KEY_MISSING` | 400 | 当前 Provider 的 API Key 未配置 |
| `LLM_GENERATION_FAILED` | 500 | LLM 调用失败（网络/API错误） |
| `LLM_JSON_PARSE_FAILED` | 500 | LLM 返回的 JSON 无法解析 |
| `CHECKPOINT_CORRUPTED` | 500 | checkpoint 文件损坏 |
| `FILE_WRITE_FAILED` | 500 | 文件写入失败 |


## 十一、LLM 调用日志规范

每次 LLM 调用记录到 `projects/{id}/llm_usage.jsonl`：

```json
{
  "timestamp": "2026-06-10T14:30:00.123Z",
  "agent": "writer",
  "task": "scene_writing",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tokens_in": 25000,
  "tokens_out": 4000,
  "cost_estimate_usd": 0.035,
  "scene_number": 2,
  "chapter_number": 1,
  "retry_count": 0
}
```


## 十二、环境与运行

### 12.1 开发环境

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev    # Vite dev server on :5173
```

**Python 依赖 (`backend/requirements.txt`):**
```
fastapi==0.110+
uvicorn[standard]==0.27+
pydantic==2.6+
anthropic==0.39+          # Anthropic Claude SDK
openai==1.12+             # OpenAI 兼容协议 SDK（DeepSeek/MiniMax 均支持）
tiktoken==0.6+            # Token 计数（仅 OpenAI 模型族，其他 Provider 取 API response.usage）
pyyaml==6.0+
```

> **MiniMax 说明:** MiniMax 使用 OpenAI 兼容协议 (`openai` SDK 切换到 `base_url=https://api.minimax.chat/v1`)，无需额外安装专属 SDK。
>
> **Token 计数策略:** 优先使用 LLM API 响应中的 `usage.total_tokens` / `usage.prompt_tokens` / `usage.completion_tokens` 字段；仅在 Anthropic/OpenAI 场景下 `tiktoken` 作为预估算的补充。
>
> **API Key 获取:**
> - Anthropic: https://console.anthropic.com/
> - DeepSeek: https://platform.deepseek.com/
> - MiniMax: https://platform.minimax.chat/

### 12.2 环境变量

```bash
# .env
# --- LLM Provider 配置（三选一） ---
LLM_PROVIDER=deepseek                  # anthropic / deepseek / minimax
LLM_MODEL=deepseek-chat                # 模型 ID

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# MiniMax
MINIMAX_API_KEY=eyJhbG...
MINIMAX_BASE_URL=https://api.minimax.chat/v1

# --- 通用配置 ---
LLM_MAX_TOKENS=8192
LLM_TEMPERATURE=0.7
PROJECTS_DIR=./projects
PROMPTS_DIR=./backend/prompts
STYLE_DIR=./data/style
```


## 附录 A: MVP 验收标准对照表

| AC | 描述 | 对应测试 |
|---|---|---|
| AC-1 | INIT→S1→S2→S3→S4 走通，产出 1 章小说 | 手动端到端 |
| AC-2 | SF_LOG 标记格式正确 | 手动 + 自动正则验证 |
| AC-3 | Fact Guard 捕获一致性错误 | 自动（注入测试） |
| AC-4 | 3 次重试后熔断降级 | 自动（注入测试） |
| AC-5 | StoryOS 注册表正确更新 | 自动（对比测试） |
| AC-6 | StoryOS Agent 零 LLM 调用 | 代码审查 |
| AC-7 | 崩溃后 checkpoint 恢复 | 手动（kill 进程测试） |
| AC-8 | Token < 50K | 自动（日志统计） |
| AC-9 | required_log 缺失阻断 | 自动（注入测试） |
| AC-10 | SF_LOG 格式错误阻断 | 自动（注入测试） |

## 附录 B: 与 v1.4 完整版的关键差异

| 维度 | MVP | v1.4 完整版 |
|---|---|---|
| 篇章 | 1 章 | 100 章 |
| 叙事资产 | 4 类 | 7 类 + 级联传播 |
| Fact Guard | 5 项 | 6 项 |
| MemoryOS | L0+L1 | L0-L4 |
| 角色 | 1 个 | 多角色 + 成长曲线 |
| Style | 1 个模板 | 3 层 + 沙盒 |
| ReaderOS | 无 | 7 项指标 + 体裁差异 |
| CreativeOS | 无 | 7 引擎 + 画布 |
| 模型 | 单模型 | 3 Tier + 配置系统 |
| Web UI | 6 个页面 | 6 页面 + 灵感库 + 风格沙盒 + 资产中心 |
