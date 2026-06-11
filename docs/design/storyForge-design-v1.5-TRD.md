# StoryForge v1.5 技术规划需求文档 (TRD)

> **版本:** 1.0 | **日期:** 2026-06-11 | **状态:** 待评审
>
> 本文档是 StoryForge v1.5 的技术实现规格，基于 v1.5 产品设计文档和 v1.4-MVP TRD，描述在 MVP 基础上新增和变更的全部技术细节。


## 一、项目概述

### 1.1 v1.5 目标

从"能写一章"升级到"能写完一部作品"——建立多章连续写作的量产能力。

```
v1.4-mvp                          v1.5
───────                           ────
1 章端到端                         多章连续写作（典型 20-100 章）
4 类叙事资产                        7 类叙事资产 + 伏笔注册表
5 项 Fact Guard                    5 项 Fact Guard（不变）
L0 + L1 记忆                       L0 + L1 + L2
无 ReaderOS                        追更欲 + 疲劳度
无 STAGE 5 / STAGE 6               基础诊断 + .md 导出
单角色                             多角色 + 关系网络
无风格提炼                          风格提炼（Style Extractor）
7 种 SF_LOG（后端解析）              11 种 SF_LOG（后端完整实现）
4 个 Agent                         5 个 Agent（+ Summary Archiver）
```

### 1.2 v1.5 增量范围

| 类别 | 新增 | 修改 | 不变 |
|---|---|---|---|
| **Agent** | Summary Archiver | Writer（多角色上下文）、Planner（多角色生成） | Reviewer、StoryOS Agent（扩展 type 分支） |
| **MemoryOS** | L2 温记忆 | L1（裁剪逻辑） | L0 |
| **StoryOS** | Promise / Reveal / Expectation / Foreshadowing 注册表 | RegistryManager（扩展 type 分支） | Conflict / Mystery / Twist / Goal |
| **ReaderOS** | 全部（追更欲 + 疲劳度） | — | — |
| **Conductor** | — | StateMachine（+STAGE5/6）、Checkpoint（+chapter） | CircuitBreaker |
| **API** | stage5_diagnosis / stage6_export / style_extractor | stage4_writing（多章） | stage1-3 |
| **前端** | Stage5Page / Stage6Page | Stage4Page（多章）、Stage2Page（多角色） | Stage1Page / Stage3Page |

### 1.3 Token 预算（v1.5）

| 阶段 | 调用次数 | 输入 (tokens) | 输出 (tokens) | 小计 |
|---|---|---|---|---|
| STAGE 1-3 生成（同 MVP） | 4 | 13,000 | 6,500 | 19,500 |
| STAGE 4 Scene 写作 × 3 | 3 | 10,000 × 3 | 3,000 × 3 | 39,000 |
| STAGE 4 重写（缓冲区） | ≤ 2 | 10,000 × 2 | 3,000 × 2 | 10,400 |
| Summary Archiver 章摘要 | 1 | 3,500 | 200 | 3,700 |
| L1 重提取（每 5 章摊销） | 0.2 | 5,000 | 500 | 1,100 |
| Style Extractor | 1 | 2,000 | 500 | 2,500 |
| **合计（单章）** | **~7-9** | **~53,500** | **~16,700** | **~70,200** |

> **对比 MVP：** 单章增加约 17K tokens，主要来自多角色上下文（+3K/Scene）和 Summary Archiver（+3.7K/章）。20 章总量约 1.4M tokens。

### 1.4 技术原则（继承 MVP）

1. **确定性优先：** 一致性检查、SF_LOG 解析、ReaderOS 计算、STAGE 5 诊断全部零 LLM
2. **文件即数据库：** 所有数据以 JSON/YAML/Markdown 文件存储
3. **Agent 无状态：** Agent 之间通过 Conductor 和结构化数据文件共享状态
4. **LLM 调用最小化：** 仅 STAGE 1-3 生成、Scene 写作、Summary Archiver、Style Extractor 调用 LLM


## 二、技术架构变更

### 2.1 整体架构（v1.5 增量部分以 ★ 标记）

```
┌─────────────────────────────────────────────────────────────┐
│                        Web Frontend                         │
│  React + TypeScript + Tailwind CSS + Material Symbols       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │INIT 向导│ │STAGE 1  │ │STAGE 2-3│ │   STAGE 4 写作   │  │
│  │         │ │概念讨论  │ │世界观    │ │   中心 (核心)     │  │
│  │         │ │         │ │★多角色  │ │★多章 + 进度      │  │
│  └─────────┘ └─────────┘ └─────────┘ └──────────────────┘  │
│  ┌──────────────────┐ ┌──────────────────┐                  │
│  │  STAGE 5 ★       │ │  STAGE 6 ★       │                  │
│  │  全书诊断         │ │  导出中心         │                  │
│  └──────────────────┘ └──────────────────┘                  │
│                            │                                 │
│                    REST API (JSON)                           │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      Python Backend                          │
│  FastAPI + Pydantic                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │Conductor │ │ Planner  │ │ Writer   │ │  StoryOS      │  │
│  │★STAGE5/6 │ │★多角色   │ │★多角色   │ │  Agent        │  │
│  │★跨章恢复 │ │  生成     │ │  上下文   │ │  ★4种新type  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │Reviewer  │ │MemoryOS  │ │ReaderOS★ │ │Summary       │   │
│  │Fact Guard│ │L0+L1★+L2│ │追更欲    │ │Archiver★     │   │
│  │(不变)    │ │         ★│ │疲劳度    │ │章摘要+L1重提 │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
│                            │                                 │
│                    File System (JSON/YAML/MD)                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈（无变化）

与 v1.4-MVP TRD §2.2 完全一致。v1.5 不引入新的基础设施依赖。

### 2.3 新增基础设施考量

| 考量项 | 决策 | 原因 |
|---|---|---|
| 数据库 | 不引入 | 20 章数据量仍可控（~5MB JSON），文件系统足够 |
| 消息队列 | 不引入 | Summary Archiver 同步执行（每章 ~3s），不影响用户体验 |
| 向量数据库 | 不引入 | L3 冷记忆推迟到 v1.6 |
| 流式输出 (SSE) | 不引入 | 推迟到 v1.6，v1.5 保持同步请求-响应 |


## 三、项目目录结构（v1.5 增量）

```
storyforge/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── llm/                             # 不变
│   ├── conductor/
│   │   ├── state_machine.py            # 修改：+ STAGE5/STAGE6 + PRECONDITIONS
│   │   ├── circuit_breaker.py          # 不变
│   │   └── checkpoint.py               # 修改：+ chapter_number + 跨章恢复
│   ├── agents/
│   │   ├── base_agent.py               # 不变
│   │   ├── planner.py                  # 修改：generate_character() 支持多角色
│   │   ├── writer.py                   # 修改：多角色上下文组装 + ReaderOS 预警注入
│   │   ├── reviewer.py                 # 不变
│   │   ├── storyos_agent.py            # 修改：+ 4 种新 type 的 handler
│   │   └── summary_archiver.py         # ★新增：章摘要 + L1 重提取
│   ├── story_os/
│   │   ├── registries.py               # 修改：+ 4 种新注册表文件
│   │   ├── promise_registry.py         # ★新增
│   │   ├── reveal_registry.py          # ★新增
│   │   ├── expectation_registry.py     # ★新增
│   │   └── foreshadowing_registry.py   # ★新增
│   ├── memory_os/
│   │   ├── l0_runtime.py               # 不变
│   │   ├── l1_hot.py                   # 修改：+ trim_to_last_n_chapters()
│   │   └── l2_warm.py                  # ★新增：L2 温记忆管理
│   ├── reader_os/                       # ★新增目录
│   │   ├── __init__.py                 # ★新增：ReaderOS 主类
│   │   ├── calculator.py               # ★新增：追更欲 + 疲劳度公式
│   │   └── thresholds.py              # ★新增：体裁差异化阈值
│   ├── scene_engine/                    # 不变
│   ├── style_engine/
│   │   ├── genre_template.py           # 不变
│   │   └── style_extractor.py          # ★新增：风格提炼
│   ├── prompts/
│   │   ├── concept_generation.yaml     # 不变
│   │   ├── world_generation.yaml       # 不变
│   │   ├── character_generation.yaml   # 修改：支持多角色生成
│   │   ├── outline_generation.yaml     # 不变
│   │   ├── scene_writing.yaml          # 修改：多角色上下文变量
│   │   ├── scene_rewrite.yaml          # 修改：多角色上下文变量
│   │   └── chapter_summary.yaml        # ★新增：Summary Archiver prompt
│   ├── models/
│   │   ├── project.py                  # 修改：+ relations 字段
│   │   ├── world.py                    # 不变
│   │   ├── character.py               # 修改：多角色 + relations
│   │   ├── outline.py                  # 不变
│   │   ├── storyos.py                  # 修改：+ Promise/Reveal/Expectation/Foreshadowing
│   │   ├── sf_log.py                   # 修改：+ 4 种新 log type
│   │   ├── checkpoint.py              # 修改：+ chapter_number + scene_number
│   │   ├── progress.py                # 修改：+ current_chapter + character_appearances
│   │   ├── reader_os.py               # ★新增：ReaderOS 数据模型
│   │   └── l2_memory.py               # ★新增：L2 数据结构
│   ├── api/
│   │   ├── project.py                  # 不变
│   │   ├── stage1_concept.py           # 不变
│   │   ├── stage2_world_char.py        # 修改：+ character_index / character_type 参数
│   │   ├── stage3_outline.py           # 不变
│   │   ├── stage4_writing.py           # 修改：_load_context() 重构 + advance-chapter
│   │   ├── stage5_diagnosis.py         # ★新增
│   │   ├── stage6_export.py            # ★新增
│   │   ├── style_extractor.py          # ★新增
│   │   └── conductor.py               # 修改：+ STAGE5/STAGE6 推进
│   └── utils/                           # 不变
│
├── frontend/
│   └── src/
│       ├── App.tsx                      # 修改：+ /stage5 + /stage6 路由
│       ├── api/
│       │   └── client.ts               # 修改：+ 新 API 函数
│       ├── hooks/
│       │   ├── useProject.ts           # 不变
│       │   ├── useConductor.ts          # 修改：+ STAGE5/STAGE6
│       │   └── useStage4Writing.ts      # 修改：+ chapter_number 参数
│       ├── components/
│       │   ├── layout/
│       │   │   ├── SideNavBar.tsx       # 修改：+ STAGE5/STAGE6 导航项
│       │   │   └── MainLayout.tsx       # 修改：+ 新路由映射
│       │   ├── shared/
│       │   │   └── ChapterProgress.tsx  # ★新增：章节进度条
│       │   └── stage/
│       │       ├── CharacterCard.tsx    # ★新增：多角色卡片
│       │       ├── RelationGraph.tsx    # ★新增：角色关系网络图
│       │       └── DiagnosisTable.tsx   # ★新增：诊断报告表格
│       └── pages/
│           ├── Stage2Page.tsx           # 修改：多角色卡片切换
│           ├── Stage4Page.tsx           # 修改：章选择器 + 进度条
│           ├── Stage5Page.tsx           # ★新增：全书诊断页
│           └── Stage6Page.tsx           # ★新增：导出中心页
│
└── projects/{id}/
    ├── project.json                     # 修改：+ relations 字段
    ├── characters.json                  # 修改：[单角色] → {characters: [...]}
    ├── outline.json                     # 不变（已支持多章）
    ├── progress.json                    # 修改：+ current_chapter + character_appearances
    ├── .storyforge_checkpoint.json      # 修改：+ chapter_number + scene_number
    ├── storyos/
    │   ├── conflicts.json               # 不变
    │   ├── mysteries.json               # 不变
    │   ├── twists.json                   # 不变
    │   ├── goals.json                   # 不变
    │   ├── promises.json                # ★新增
    │   ├── reveals.json                 # ★新增
    │   ├── expectations.json            # ★新增
    │   └── foreshadowing.json           # ★新增
    ├── memory/
    │   └── l2/                           # ★新增
    │       ├── chapter_summaries/        # ch_001_summary.json ...
    │       ├── relationship_graph.json
    │       ├── timeline.json
    │       └── active_narrative_state.json
    ├── diagnosis_report.json            # ★新增
    ├── exports/                          # ★新增
    │   └── novel.md
    └── style/
        └── extracted_style.yaml         # ★新增
```


## 四、后端模块详细规格（v1.5 增量）

### 4.1 Conductor — 变更

#### 4.1.1 阶段状态机扩展 (`conductor/state_machine.py`)

```python
class Stage(str, Enum):
    INIT = "INIT"
    STAGE1 = "STAGE1"
    STAGE2 = "STAGE2"
    STAGE3 = "STAGE3"
    STAGE4 = "STAGE4"
    STAGE5 = "STAGE5"     # ★新增
    STAGE6 = "STAGE6"     # ★新增
    COMPLETED = "COMPLETED"

STAGE_ORDER = [
    Stage.INIT, Stage.STAGE1, Stage.STAGE2, Stage.STAGE3,
    Stage.STAGE4, Stage.STAGE5, Stage.STAGE6,  # ★新增两阶段
    Stage.COMPLETED,
]
```

**新增前置校验：**

| 转换 | 校验逻辑 |
|---|---|
| STAGE4 → STAGE5 | `progress.json` 存在，所有 chapters 的 scenes 状态均为 `completed` 或 `force_passed` |
| STAGE5 → STAGE6 | `diagnosis_report.json` 存在，所有 P0 问题状态为 `resolved` 或 `accepted` |
| STAGE6 → COMPLETED | `exports/novel.md` 存在 |

#### 4.1.2 Checkpoint 跨章恢复 (`conductor/checkpoint.py`)

```python
class Checkpoint(BaseModel):
    project_id: str
    pipeline_stage: str           # "scene_writing" | "review" | "storyos_update"
    chapter_number: int           # ★新增
    scene_number: int             # ★新增（原仅有 scene_number 但不规范）
    snapshots: CheckpointSnapshots
    recorded_at: datetime

class CheckpointSnapshots(BaseModel):
    l0_runtime: dict
    storyos_registries: dict      # 所有注册表的状态快照
    character_states: dict        # 所有角色的 current_state
    scene_draft_cache: str | None # 当前 Scene 草稿（如果 mid-scene 中断）

class CheckpointManager:
    def save(self, project_id: str, checkpoint: Checkpoint) -> None: ...
    def load(self, project_id: str) -> Checkpoint | None: ...
    def recover(self, project_id: str) -> RecoveryState:
        """
        恢复逻辑：
        1. 读取 checkpoint
        2. 验证 progress.json 当前状态与 checkpoint 一致性
        3. 一致 → 返回 (chapter_number, scene_number) 恢复点
        4. 不一致 → 跳到下一个未完成 Scene
        """
```

### 4.2 Summary Archiver Agent（★新增）

`backend/agents/summary_archiver.py`

```python
class SummaryArchiver(BaseAgent):
    """Tier 3 Agent — 使用轻量模型生成章摘要和 L1 重提取"""

    async def archive_chapter(
        self, chapter_number: int, scene_drafts: list[str],
        sf_logs: list[ParsedLog], character_states: dict
    ) -> ChapterSummary:
        """
        输入：一章中所有 Scene 的草稿文本 + SF_LOG 解析结果
        输出：结构化章摘要

        LLM Prompt: prompts/chapter_summary.yaml
        要求输出 JSON：
        {
          "summary": "本章核心事件（~200 tokens）",
          "key_events": ["事件1", "事件2"],
          "character_changes": {
            "角色A": {"location": "新位置", "emotion": "新情绪"},
            "角色B": {"relation_change": "与角色C的关系变化"}
          },
          "narrative_assets_affected": {
            "conflicts_escalated": ["cf_001"],
            "mystery_clues_added": ["mys_003"],
            "promises_fulfilled": ["pr_002"]
          },
          "hooks_planted": ["章末悬念描述"]
        }
        """

    async def reextract_l1_details(
        self, chapter_range: tuple[int, int], scene_drafts: list[str]
    ) -> list[dict]:
        """
        每 5 章触发一次。从最近 5 章中提取关键细节补充到 L1。
        Tier 3 模型，输出结构化关键细节列表。
        """

    def update_l2_memory(
        self, project_id: str, summary: ChapterSummary,
        sf_logs: list[ParsedLog]
    ) -> None:
        """
        确定性操作，零 LLM：
        1. 写入 chapter_summaries/ch_{n}_summary.json
        2. 从 character_relation_change log 增量更新 relationship_graph.json
        3. 从 scene_plan time_point 更新 timeline.json
        4. 更新 active_narrative_state.json（unresolved/open/pending 资产列表）
        """
```

**`prompts/chapter_summary.yaml` 结构：**

```yaml
name: chapter_summary
provider: deepseek
model: deepseek-chat
temperature: 0.3
max_tokens: 1024
system_prompt: |
  你是一个专业的小说编辑，负责为已完成章节撰写结构化摘要。
  摘要必须简洁、准确、聚焦于叙事资产变化。
user_prompt_template: |
  ## 章节草稿
  {scene_drafts}

  ## SF_LOG 解析结果
  {sf_logs_summary}

  ## 当前角色状态
  {character_states}

  请生成本章的结构化摘要。
output_format:
  type: json
  schema:
    summary: string
    key_events: list[string]
    character_changes: dict
    narrative_assets_affected: dict
    hooks_planted: list[string]
```

### 4.3 MemoryOS L2（★新增）

`backend/memory_os/l2_warm.py`

```python
class L2WarmMemory:
    """温记忆 — 全书级结构化摘要，约 4K-8K tokens"""

    def __init__(self, project_id: str): ...

    def get_chapter_summaries(
        self, chapter_range: tuple[int, int] | None = None
    ) -> list[dict]:
        """获取指定范围（默认全部）的章摘要"""

    def get_relationship_graph(self) -> dict:
        """返回当前角色关系图 {nodes: [...], edges: [...]}"""

    def get_timeline(self) -> list[dict]:
        """返回全书时间轴"""

    def get_active_narrative_state(self) -> dict:
        """返回当前叙事状态快照"""

    def get_context_string(self, max_tokens: int = 8000) -> str:
        """
        序列化为自然语言上下文，注入 Writer。
        优先级：active_narrative_state > 最近 5 章摘要 > 关系图 > 时间轴
        """

    def update_from_summary(self, summary: ChapterSummary) -> None:
        """章完成后增量更新 L2 数据"""

    def update_relations(self, relation_changes: list[dict]) -> None:
        """从 character_relation_change SF_LOG 更新关系图"""
```

**L1 裁剪 (`memory_os/l1_hot.py` 修改）：**

```python
class L1Hot:
    # ... 原有方法不变 ...

    def trim_to_last_n_chapters(self, n: int = 5) -> None:
        """
        裁剪 L1 至仅保留最近 n 章的 Scene drafts。
        在 Summary Archiver 确认章摘要已写入 L2 后调用。
        """
        # 按 chapter_number 分组 scenes
        # 保留最近 n 个 chapter 的 scenes
        # 删除其余

    def get_token_estimate(self) -> int:
        """估算当前 L1 总 token 数"""
```

### 4.4 StoryOS — 新增 4 种注册表

#### 4.4.1 Promise 注册表 (`story_os/promise_registry.py`)

```python
class PromiseRegistry:
    REGISTRY_FILE = "promises.json"

    def create(self, entry: Promise) -> None: ...
    def get(self, promise_id: str) -> Promise | None: ...
    def update_status(self, promise_id: str, status: str,
                      fulfilled_chapter: int | None = None) -> None: ...
    def list_pending(self) -> list[Promise]: ...
    def list_fulfilled(self, chapter_range: tuple[int, int]) -> list[Promise]: ...
```

#### 4.4.2 Reveal 注册表 (`story_os/reveal_registry.py`)

```python
class RevealRegistry:
    REGISTRY_FILE = "reveals.json"

    def create(self, entry: Reveal) -> None: ...
    def get(self, reveal_id: str) -> Reveal | None: ...
    def reveal(self, reveal_id: str, chapter: int, method: str) -> None:
        """标记为 revealed，记录揭示章号和方式"""
    def list_hidden_from(self, character_id: str) -> list[Reveal]: ...
```

#### 4.4.3 Expectation 注册表 (`story_os/expectation_registry.py`)

```python
class ExpectationRegistry:
    REGISTRY_FILE = "expectations.json"

    def create(self, entry: Expectation) -> None: ...
    def get(self, expectation_id: str) -> Expectation | None: ...
    def update_intensity(self, expectation_id: str, delta: int) -> None: ...
    def fulfill(self, expectation_id: str, chapter: int) -> None: ...
    def list_accumulating(self) -> list[Expectation]:
        """返回所有 accumulating 状态的期待，按 intensity 降序"""
```

#### 4.4.4 Foreshadowing 注册表 (`story_os/foreshadowing_registry.py`)

```python
class ForeshadowingRegistry:
    REGISTRY_FILE = "foreshadowing.json"

    def create(self, entry: Foreshadowing) -> None: ...
    def get(self, fs_id: str) -> Foreshadowing | None: ...
    def add_clue(self, fs_id: str, clue: dict) -> None:
        """追加线索，状态 planted → developing"""
    def reveal(self, fs_id: str, chapter: int, detail: str) -> None:
        """标记为 revealed"""
    def mark_dead(self, fs_id: str) -> None:
        """标记为 dead（≥ 5 章无新线索）"""
    def list_dead(self) -> list[Foreshadowing]:
        """用于 STAGE 5 诊断"""
    def list_planted_without_clues(self, min_chapters: int = 5) -> list[Foreshadowing]:
        """planted 状态 ≥ N 章仍无线索的伏笔"""
```

#### 4.4.5 StoryOS Agent 扩展 (`agents/storyos_agent.py`)

```python
class StoryOSAgent:
    # 新增 VALID_LOG_TYPES
    VALID_LOG_TYPES = {
        # MVP 原有 7 种
        "character_emotion", "character_relation_change",
        "character_location_change", "knowledge_gain",
        "conflict_escalate", "mystery_clue", "registry_create",
        # v1.5 新增 4 种
        "twist_reveal", "expectation_fulfill",
        "goal_milestone", "character_physical_change",
    }

    def _handle_registry_create(self, log: ParsedLog, report: RegistryUpdateReport):
        reg_type = log.params.get("type", "")
        # ... 原有 conflict/mystery/twist/goal 分支 ...
        # ★新增分支：
        elif reg_type == "promise":
            self.promise_registry.create(data)
        elif reg_type == "reveal":
            self.reveal_registry.create(data)
        elif reg_type == "expectation":
            self.expectation_registry.create(data)
        elif reg_type == "foreshadowing":
            self.foreshadowing_registry.create(data)

    # ★新增 handler：
    def _handle_twist_reveal(self, log: ParsedLog, report: RegistryUpdateReport): ...
    def _handle_expectation_fulfill(self, log: ParsedLog, report: RegistryUpdateReport): ...
    def _handle_goal_milestone(self, log: ParsedLog, report: RegistryUpdateReport): ...
    def _handle_physical_change(self, log: ParsedLog, report: RegistryUpdateReport): ...

    def _collect_character_update(self, log: ParsedLog, report: RegistryUpdateReport):
        # ... 原有分支 ...
        # ★新增分支：
        elif log.type == "character_physical_change":
            char = log.params.get("char", "")
            change = log.params.get("change", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["physical_change"] = change
```

### 4.5 ReaderOS（★新增）

`backend/reader_os/calculator.py`

```python
class ReaderOS:
    """零 LLM — 全部公式计算"""

    def __init__(self, project_id: str): ...

    def calculate_addiction(self, chapter_number: int) -> float:
        """
        追更欲 = 好奇心 × 0.30 + 张力 × 0.25 + 满足感 × 0.20 + 结尾钩子 × 0.25

        好奇心 = Σ(open_mysteries × weight) → normalize 0-100
          weight: 世界观级=30, 剧情级=20, 角色级=10

        张力 = avg(active_conflicts.intensity)
          intensity 映射: low=20, medium=40, high=70, critical=95

        满足感 = min(100, fulfilled_count_last_3_chapters × 20)
          fulfilled_count = fulfilled expectations + fulfilled promises

        结尾钩子 = last_scene.narrative_role == "cliffhanger" ? 100
                  : last_scene.narrative_role == "mini_payoff" ? 50 : 0
        """

    def calculate_fatigue(self, chapter_number: int, genre: str = "cool_novel") -> float:
        """
        爽文体裁:
          fatigue = max(0, avg_tension_3_chapters - 60) × 1.0

        通用体裁:
          fatigue = max(0, avg_tension_3_chapters - 50) × 1.5
        """

    def get_warnings(self, chapter_number: int) -> list[dict]:
        """
        返回预警列表：
        - addiction < 50 → {level: "severe", metric: "addiction", value: X,
                            hint: "当前追更欲偏低，考虑增加反转或悬念"}
        - addiction < 35 → {level: "critical", ...}
        - fatigue > 55 → {level: "moderate", metric: "fatigue", value: X,
                          hint: "读者疲劳度上升，考虑安排过渡章"}
        """

    def get_trend(self, metric: str, window: int = 5) -> list[float]:
        """返回最近 N 章的趋势数据"""
```

`backend/reader_os/thresholds.py`

```python
GENRE_THRESHOLDS = {
    "cool_novel": {
        "addiction_severe": 50,
        "addiction_critical": 35,
        "fatigue_moderate": 55,
        "fatigue_formula": {"threshold": 60, "decay": 1.0},
    },
    "generic": {
        "addiction_severe": 40,
        "addiction_critical": 30,
        "fatigue_moderate": 50,
        "fatigue_formula": {"threshold": 50, "decay": 1.5},
    },
}
```

### 4.6 Writer Agent — 变更

`backend/agents/writer.py`

```python
class WriterAgent(BaseAgent):
    async def write_scene(self, context: WritingContext) -> SceneDraft:
        """
        上下文组装顺序（v1.5 变更）：
          1. L0 Runtime 快照（所有角色当前状态）
          2. characters.json → 所有角色（★多角色）
             - 主视角角色：完整 personality + voice_signature + unknown_to_character
             - 次要角色：仅 current_state + 基础关系
          3. world.json → power_system.ceilings + core_rules
          4. outline.json → 当前 Scene.scene_plan[i]
          5. style/cool_novel.yaml → 风格指导
          6. L1 热记忆 → 最近 5 章已完成 Scene 内容（★裁剪后）
          7. L2 温记忆 → 最近 5 章摘要 + active_narrative_state（★新增）
          8. ReaderOS 预警 → 当前章追更欲/疲劳度 + 预警提示（★新增）
        """

    async def rewrite_scene(
        self, original_draft: SceneDraft, retry_hints: list[str], context: WritingContext
    ) -> SceneDraft:
        """重写时同样注入多角色上下文和 ReaderOS 预警"""
```

### 4.7 Planner Agent — 变更

`backend/agents/planner.py`

```python
class PlannerAgent(BaseAgent):
    async def generate_character(
        self, project_id: str, character_index: int = 0,
        character_type: str = "protagonist",
        existing_characters: list[dict] | None = None
    ) -> Character:
        """
        v1.5 变更：
        - character_index: 第几个角色（0 = 主角）
        - character_type: protagonist / antagonist / supporting / mentor
        - existing_characters: 已有角色摘要（避免性格/能力重叠）
        - 首次调用（character_index=0）生成主角（is_core_character=True）
        - 后续调用生成配角（is_core_character=False）
        - 角色间 relations 初始化为 neutral
        """

    async def generate_characters_batch(
        self, project_id: str, count: int, types: list[str]
    ) -> list[Character]:
        """
        批量生成多个角色。
        输入：project.json + concept_and_dna.json + world.json + 角色类型列表
        限制：核心角色 ≤ 5 个
        """
```

### 4.8 Style Extractor（★新增）

`backend/style_engine/style_extractor.py`

```python
class StyleExtractor:
    """分析参考文本的写作风格特征。句式/词汇/节奏为确定性计算，描写分类使用 Tier 3 LLM"""

    def extract(self, reference_text: str) -> ExtractedStyle:
        """
        分析流程：
        1. 分词 + 句长统计 → sentence features（确定性）
        2. 正则匹配引号内文本 → dialogue features（确定性）
        3. 词频统计 + 成语检测 → vocabulary features（确定性）
        4. LLM 分类描写类型 → description features（Tier 3）
        5. LLM 判断节奏特征 → rhythm features（Tier 3）

        输出：ExtractedStyle (dataclass)
        """

    def save(self, project_id: str, style: ExtractedStyle) -> Path:
        """保存为 projects/{id}/style/extracted_style.yaml"""
```


## 五、API 设计（v1.5 变更）

### 5.1 新增 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/stage4/advance-chapter` | ★新增 — 完成当前章，推进到下一章 |
| POST | `/api/stage5/diagnose` | ★新增 — 执行全书诊断 |
| GET | `/api/stage5/diagnosis` | ★新增 — 获取诊断报告 |
| POST | `/api/stage5/resolve/{issue_id}` | ★新增 — 标记问题已处理/跳过 |
| POST | `/api/stage6/export` | ★新增 — 执行导出 |
| GET | `/api/stage6/download` | ★新增 — 下载导出文件 |
| POST | `/api/style/extract` | ★新增 — 上传文本，执行风格分析 |

### 5.2 修改 API

#### `POST /api/stage4/write-scene` — 参数变更

**请求（v1.5）：**
```json
{
  "project_id": "proj_001",
  "chapter_number": 5,
  "scene_number": 2
}
```

**处理流程（v1.5 增量以 ★ 标记）：**
```
1. Conductor 检查当前阶段 = STAGE4
2. 读取 outline.json → ★查找指定 chapter_number 的章节
3. 组装 WritingContext（L0 + ★所有角色 + world + scene_plan + style + ★裁剪后 L1 + ★L2）
4. ★读取 ReaderOS 预警 → 注入 Writer 上下文
5. Writer Agent 调用 LLM 生成 Scene 文本
6. Reviewer 执行 Fact Guard 5 项硬检
   ├── 全部通过 → 7
   └── 不通过 → retry_count < 3 ? 返回 retry_hints : 触发 CircuitBreaker
7. StoryOS Agent 正则解析 SF_LOG → 更新注册表（★含 4 种新 type）
8. MemoryOS L0/L1 更新
9. Checkpoint 写入（★含 chapter_number）
```

#### `POST /api/stage4/advance-chapter` — ★新增核心 API

**请求：**
```json
{
  "project_id": "proj_001"
}
```

**处理流程：**
```
1. 验证当前章所有 Scene 状态为 completed 或 force_passed
2. ★触发 Summary Archiver：
   a. 读取本章所有 Scene drafts + SF_LOG 解析结果
   b. LLM 生成章摘要 → 写入 L2
   c. 更新关系图、时间轴、active_narrative_state
   d. 裁剪 L1 至最近 5 章
3. ★触发 ReaderOS 计算：
   a. calculate_addiction(chapter_number)
   b. calculate_fatigue(chapter_number)
   c. 结果写入 progress.json
4. 更新 progress.json：
   - 当前章 status → "completed"
   - current_chapter += 1
5. 写入 checkpoint
```

**响应：**
```json
{
  "status": "advanced",
  "from_chapter": 5,
  "to_chapter": 6,
  "reader_os_snapshot": {
    "addiction": 72,
    "fatigue": 38,
    "warnings": []
  },
  "l2_summary": {
    "summary": "本章核心事件...",
    "key_events": ["事件1", "事件2"]
  }
}
```

#### `POST /api/stage2/generate-character` — 参数变更

**请求（v1.5）：**
```json
{
  "project_id": "proj_001",
  "character_index": 1,
  "character_type": "antagonist"
}
```

#### `GET /api/stage4/progress` — 响应变更

**响应（v1.5 增量字段以注释标记）：**
```json
{
  "project_id": "proj_001",
  "current_stage": "STAGE4",
  "current_chapter": 5,
  "total_chapters": 20,
  "chapters": [
    {
      "chapter_number": 1,
      "status": "completed",
      "reader_os": {                              // ★新增
        "addiction": 68,
        "fatigue": 25
      },
      "character_appearances": {                  // ★新增
        "char_001": {"scene_count": 3, "pov": true},
        "char_002": {"scene_count": 1, "pov": false}
      },
      "scenes": [
        {"scene_number": 1, "status": "completed", "retry_count": 0, "coherence_score": 85}
      ]
    }
  ]
}
```

#### `POST /api/stage5/diagnose` — ★新增

**请求：**
```json
{
  "project_id": "proj_001"
}
```

**处理流程（全部确定性，零 LLM）：**
```
1. 扫描所有章的 Scene drafts
2. 时间线检测：
   - 提取所有 character_location_change 标记
   - 逐章比对角色位置序列
   - 检测无标记的位置跳跃
3. 叙事资产遗留检测：
   - 遍历 conflicts.json: status != "resolved" → P1 问题
   - 遍历 mysteries.json: status != "revealed" → P1 问题
   - 遍历 promises.json: status = "pending" 且 deadline_chapter < current → P1 问题
4. 伏笔完整性检测：
   - 遍历 foreshadowing.json
   - status = "dead" → P1 问题
   - status = "planted" 且 planted_chapter 距今 ≥ 5 → P1 问题
5. 生成 diagnosis_report.json
```

**响应：**
```json
{
  "status": "completed",
  "total_chapters": 20,
  "issues": [
    {
      "id": "diag_001",
      "priority": "P0",
      "category": "timeline_break",
      "chapter": 8,
      "description": "林峰在第7章末位于城西烂尾楼，第8章开头位于家中，缺少位置变更标记",
      "suggestion": "在第8章开头添加 <!-- SF_LOG character_location_change char=\"林峰\" from=\"城西烂尾楼\" to=\"家中\" -->",
      "status": "open"
    }
  ],
  "summary": {"p0_count": 2, "p1_count": 5, "p2_count": 8}
}
```

#### `POST /api/stage6/export` — ★新增

**请求：**
```json
{
  "project_id": "proj_001",
  "options": {
    "strip_sf_logs": true,
    "add_toc": true,
    "include_title_page": true
  }
}
```

**处理流程：**
```
1. 读取所有章的 Scene drafts
2. 按 chapter_number → scene_number 排序
3. （可选）每个 Scene 前插入 "## 第X章 · Scene Y" 标题
4. strip_sf_logs=true → 正则替换移除所有 <!-- SF_LOG ... -->
5. add_toc=true → 生成目录插入文件头部
6. include_title_page=true → 生成书名页插入文件头部
7. 写入 exports/novel.md
```

#### `POST /api/style/extract` — ★新增

**请求：**
```json
{
  "project_id": "proj_001",
  "reference_text": "上传的参考文本..."
}
```

**响应：**
```json
{
  "sentence": {
    "avg_length": 28,
    "distribution": {"short_pct": 35, "medium_pct": 45, "long_pct": 20}
  },
  "dialogue": {"ratio": 0.35, "avg_turn_length": 18},
  "description": {
    "environment_pct": 15, "action_pct": 40,
    "psychology_pct": 25, "other_pct": 20
  },
  "vocabulary": {
    "top_words": ["突然", "心中", "猛然"],
    "idiom_frequency": 0.08,
    "unique_word_ratio": 0.62
  },
  "rhythm": {
    "scene_change_frequency": "每 ~800 字",
    "emotional_peak_density": "每 ~1200 字"
  }
}
```


## 六、前端页面规格（v1.5 增量）

### 6.1 Stage2Page — 多角色支持

**变更：** 从单角色展示升级为多角色卡片列表。

```
┌──────────────────────────────────────────────┐
│  世界观与角色                                  │
│                                              │
│  [世界观] [角色设定]  ← Tab 切换               │
│                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ ★林峰  │ │  苏晓晓 │ │ + 添加 │           │
│  │ 主角   │ │  女主   │ │  角色   │           │
│  │ ●活跃  │ │ ○活跃  │ │        │           │
│  └────────┘ └────────┘ └────────┘           │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ 选中角色的详细信息（人格层/状态/签名）  │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  角色关系网络（★新增）：                      │
│  ┌──────────────────────────────────────┐    │
│  │  林峰 ───裂痕───→ 苏晓晓              │    │
│  │   │                │                 │    │
│  │  师徒            信任                │    │
│  │   │                │                 │    │
│  │   ▼                ▼                 │    │
│  │  师父 ←──敌对──→ 神秘人              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

**新增子组件：**
- `CharacterCard.tsx` — 角色卡片（头像、名称、类型标签、状态指示灯）
- `RelationGraph.tsx` — 简易角色关系网络图（SVG/Canvas 力导向图或静态网格布局）

### 6.2 Stage4Page — 多章支持

**变更：** 增加章选择器和章节进度条。

```
┌──────────────────────────────────────────────┐
│  写作中心                                     │
│                                              │
│  ★ 章选择器: [◀] 第 5 章 / 共 20 章 [▶]      │
│  ★ 进度条: ████████░░░░░░░░░░ 40%           │
│                                              │
│  场景: [1] [2●] [3] [4]                       │
│                                              │
│  ... (原有三面板布局不变) ...                  │
│                                              │
│  ★ 章完成后出现: [进入下一章 →]               │
└──────────────────────────────────────────────┘
```

**新增子组件：**
- `ChapterProgress.tsx` — 章节进度条（当前章/总章数 + 进度百分比）

### 6.3 Stage5Page — ★新增

```
┌──────────────────────────────────────────────┐
│  全书诊断                                     │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  诊断摘要                             │    │
│  │  P0 严重: 2    P1 重要: 5    P2 建议: 8 │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  筛选: [全部 ▼] [P0] [P1] [P2]              │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  P0 | 时间线断裂 | 第 8 章            │    │
│  │  林峰在第7章末位于城西烂尾楼...        │    │
│  │  建议: 添加 character_location_change  │    │
│  │  [标记已处理] [跳过]                   │    │
│  ├──────────────────────────────────────┤    │
│  │  P1 | 叙事资产遗留 | mys_003          │    │
│  │  Mystery '超脑起源' 自第3章后无新线索  │    │
│  │  [标记已处理] [跳过]                   │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  [重新诊断] [全部标记已处理 → 进入导出]       │
└──────────────────────────────────────────────┘
```

**状态管理：**
```tsx
const [diagnosis, setDiagnosis] = useState<DiagnosisReport | null>(null);
const [filter, setFilter] = useState<"all" | "P0" | "P1" | "P2">("all");
const [resolvedIssues, setResolvedIssues] = useState<Set<string>>(new Set());
```

### 6.4 Stage6Page — ★新增

```
┌──────────────────────────────────────────────┐
│  导出中心                                     │
│                                              │
│  导出选项：                                   │
│  ☑ 去除 SF_LOG 标记（推荐）                   │
│  ☑ 添加章节目录                               │
│  ☑ 包含书名页                                 │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  预览（前 500 字）...                  │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  [导出 .md]  [下载]                           │
└──────────────────────────────────────────────┘
```

### 6.5 SideNavBar 更新

```tsx
const STAGES = [
  // ... 原有 ...
  { key: "STAGE5", label: "全书诊断", icon: "diagnostics", path: "stage5" },    // ★新增
  { key: "STAGE6", label: "导出中心", icon: "download", path: "stage6" },       // ★新增
];
```


## 七、Prompt 设计变更

### 7.1 Scene Writing Prompt 变更 (`prompts/scene_writing.yaml`)

```
新增变量：
  {characters_context}       — 所有角色的状态摘要（主视角角色完整 + 次要角色基础）
  {l2_context}               — L2 温记忆上下文（最近 5 章摘要 + 叙事状态快照）
  {reader_os_warnings}       — ReaderOS 预警（如有）

User Prompt 新增节：
  ## 其他角色状态
  {characters_context}

  ## 全书叙事状态
  {l2_context}

  ## ⚠️ 读者体验预警
  {reader_os_warnings}
```

### 7.2 Character Generation Prompt 变更 (`prompts/character_generation.yaml`)

```
新增变量：
  {existing_characters_summary}  — 已有角色摘要（首次为空）
  {character_type}                — 角色类型（protagonist / antagonist / supporting / mentor）

User Prompt 新增节：
  ## 已有角色（避免性格和能力重叠）
  {existing_characters_summary}

  ## 角色定位
  请生成一个{character_type}类型的角色。
```

### 7.3 Chapter Summary Prompt（★新增）

参见 §4.2 `prompts/chapter_summary.yaml` 结构。


## 八、数据模型变更

### 8.1 SF_LOG 类型 (`models/sf_log.py`)

```python
class SfLogType(str, Enum):
    # MVP 原有 7 种
    CHARACTER_EMOTION = "character_emotion"
    CHARACTER_RELATION_CHANGE = "character_relation_change"
    CHARACTER_LOCATION_CHANGE = "character_location_change"
    KNOWLEDGE_GAIN = "knowledge_gain"
    CONFLICT_ESCALATE = "conflict_escalate"
    MYSTERY_CLUE = "mystery_clue"
    REGISTRY_CREATE = "registry_create"
    # v1.5 新增 4 种
    TWIST_REVEAL = "twist_reveal"
    EXPECTATION_FULFILL = "expectation_fulfill"
    GOAL_MILESTONE = "goal_milestone"
    CHARACTER_PHYSICAL_CHANGE = "character_physical_change"
```

### 8.2 Character (`models/character.py`)

```python
class Character(BaseModel):
    id: str
    name: str
    is_core_character: bool                    # ★新增
    character_type: str = "protagonist"        # ★新增: protagonist/antagonist/supporting/mentor
    personality: Personality
    current_state: CharacterCurrentState
    voice_signature: VoiceSignature
    unknown_to_character: list[str]
    relations: dict[str, RelationStatus] = {}  # ★新增: {char_id: {status, history}}

class RelationStatus(BaseModel):               # ★新增
    status: str                                # "信任" / "敌对" / "裂痕" / "师徒" / ...
    history: list[RelationChangeEvent] = []
    last_update_chapter: int = 0

class RelationChangeEvent(BaseModel):          # ★新增
    chapter: int
    from_status: str
    to_status: str
    trigger: str
```

### 8.3 Progress (`models/progress.py`)

```python
class SceneProgress(BaseModel):
    scene_number: int
    status: str                    # "pending" | "writing" | "completed" | "force_passed" | "skipped"
    retry_count: int = 0
    draft_file: str | None = None
    coherence_score: int = 0

class ChapterProgress(BaseModel):
    chapter_number: int
    status: str                    # "pending" | "in_progress" | "completed"
    scenes: list[SceneProgress]
    reader_os: ReaderOSSnapshot | None = None             # ★新增
    character_appearances: dict[str, CharacterAppearance]  # ★新增

class CharacterAppearance(BaseModel):                      # ★新增
    scene_count: int
    pov: bool  # 是否为 POV 角色

class ProgressFile(BaseModel):
    project_id: str
    current_stage: str
    current_chapter: int = 1              # ★新增（原为硬编码 1）
    total_chapters: int
    chapters: list[ChapterProgress]
    circuit_breaker_events: list[dict] = []
```

### 8.4 StoryOS 新模型 (`models/storyos.py`)

```python
class Promise(BaseModel):
    id: str                           # "pr_001"
    promiser: str                     # 承诺人
    promisee: str                     # 被承诺人
    content: str
    deadline_chapter: int | None
    status: str                       # "pending" | "fulfilled" | "broken"
    created_chapter: int
    fulfilled_chapter: int | None
    fulfillment_detail: str | None

class Reveal(BaseModel):
    id: str                           # "rev_001"
    secret: str
    revealed_to: list[str]
    still_hidden_from: list[str]
    reveal_chapter: int | None
    method: str | None
    linked_mystery: str | None
    cascade_effect: str | None

class Expectation(BaseModel):
    id: str                           # "exp_001"
    description: str
    planted_chapter: int
    expected_fulfillment_chapter: int | None
    status: str                       # "accumulating" | "fulfilled" | "dissipated"
    intensity: int = 0                # 0-100
    linked_conflicts: list[str] = []
    linked_promises: list[str] = []

class Foreshadowing(BaseModel):
    id: str                           # "fs_001"
    description: str
    planted_chapter: int
    planted_scene: int
    status: str                       # "planted" | "developing" | "revealed" | "dead"
    expected_payoff_chapter: int | None
    clues: list[ForeshadowingClue] = []
    revealed_chapter: int | None
    payoff_detail: str | None
    linked_mysteries: list[str] = []
    linked_characters: list[str] = []

class ForeshadowingClue(BaseModel):
    chapter: int
    scene: int
    description: str
```


## 九、开发任务分解（v1.5）

### Step 1: 多角色支持（8h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S1.1 | `models/character.py` 增加 relations / character_type 字段 | 1h | 数据模型更新 |
| S1.2 | `planner.py` 重构 `generate_character()` 支持多角色 | 3h | 多角色生成 API |
| S1.3 | `characters.json` schema 迁移：单对象 → `{characters: [...]}` | 1h | 向后兼容迁移逻辑 |
| S1.4 | `writer.py` 上下文组装支持多角色 | 2h | 多角色上下文注入 |
| S1.5 | 前端 Stage2Page 多角色卡片列表 | 1h | CharacterCard + RelationGraph |

### Step 2: 多章写作循环（15h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S2.1 | `progress.json` 扩展 `current_chapter` / `character_appearances` | 1h | 数据模型更新 |
| S2.2 | `stage4_writing.py` `_load_context()` 重构支持指定章节号 | 3h | 多章上下文加载 |
| S2.3 | `checkpoint.py` 增加 `chapter_number` + 跨章恢复逻辑 | 3h | 跨章断点续写 |
| S2.4 | `POST /advance-chapter` 端点实现 | 4h | 章推进 API |
| S2.5 | `state_machine.py` 增加 STAGE5/STAGE6 枚举 + 前置校验 | 2h | 阶段状态机扩展 |
| S2.6 | 前端 Stage4Page 章选择器 + 进度条 | 2h | ChapterProgress 组件 |

### Step 3: L2 温记忆（8h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S3.1 | `summary_archiver.py` Agent 实现 | 3h | 章摘要 Agent |
| S3.2 | `prompts/chapter_summary.yaml` | 1h | Prompt 模板 |
| S3.3 | `l2_warm.py` 数据结构管理 | 2h | L2 存储 + 检索 |
| S3.4 | `l1_hot.py` 增加 `trim_to_last_n_chapters()` | 1h | L1 裁剪 |
| S3.5 | 集成到 `advance-chapter` 流程 | 1h | 章完成后自动触发 |

### Step 4: 7 类叙事资产 + 伏笔注册表（6h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S4.1 | `models/storyos.py` 新增 4 个 Pydantic 模型 | 1h | Promise/Reveal/Expectation/Foreshadowing |
| S4.2 | 4 个注册表文件实现 | 2h | promise/reveal/expectation/foreshadowing_registry.py |
| S4.3 | `storyos_agent.py` 扩展 handler + 4 种新 type | 2h | SF_LOG 解析 + 注册表更新 |
| S4.4 | `regex_patterns.py` VALID_LOG_TYPES 扩展至 11 | 0.5h | 正则常量更新 |
| S4.5 | 前端 Stage4Page LOG_TYPE_LABELS 修正为完整 11 种 | 0.5h | 标签显示完整 |

### Step 5: 基础 ReaderOS（6h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S5.1 | `reader_os/calculator.py` 追更欲 + 疲劳度公式 | 2h | 计算引擎 |
| S5.2 | `reader_os/thresholds.py` 体裁差异化阈值 | 1h | 阈值配置 |
| S5.3 | `writer.py` ReaderOS 预警注入 | 1h | Writer 上下文扩展 |
| S5.4 | `advance-chapter` 集成：每章完成后自动计算 | 1h | 自动触发 |
| S5.5 | 单元测试（≥ 10 用例） | 1h | 公式验证 |

### Step 6: STAGE 5 基础诊断（10h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S6.1 | `stage5_diagnosis.py` 后端诊断逻辑（全部确定性） | 4h | 3 类检测 + 问题分级 |
| S6.2 | API 端点实现 | 1h | diagnose / diagnosis / resolve |
| S6.3 | 前端 Stage5Page | 4h | 诊断报告展示 + 问题处理 UI |
| S6.4 | 单元测试（注入 3 个故意问题验证） | 1h | AC-5 验证 |

### Step 7: STAGE 6 .md 导出（4h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S7.1 | `stage6_export.py` 导出逻辑 | 2h | 拼接 + SF_LOG 去除 + TOC 生成 |
| S7.2 | API 端点实现 | 1h | export / download |
| S7.3 | 前端 Stage6Page | 1h | 导出选项 + 预览 + 下载 |

### Step 8: 风格提炼（8h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S8.1 | `style_extractor.py` 确定性分析（句式/词汇） | 3h | 分词 + 统计 |
| S8.2 | `style_extractor.py` LLM 辅助分析（描写/节奏） | 2h | Tier 3 分类 |
| S8.3 | API 端点 + 前端面板 | 3h | 上传 → 分析 → 展示 → 保存 |

### Step 9: 前端适配（10h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S9.1 | SideNavBar + MainLayout 路由更新 | 1h | STAGE5/STAGE6 导航 |
| S9.2 | Stage4Page 多章 UI（章选择器 + 进度条） | 2h | 多章支持 |
| S9.3 | Stage5Page 完整实现 | 3h | 诊断页 |
| S9.4 | Stage6Page 完整实现 | 2h | 导出页 |
| S9.5 | `api/client.ts` 新增 API 函数 | 2h | 类型化 API 调用 |

### Step 10: 集成测试 + 端到端验证（8h）

| ID | 任务 | 预估 | 产出 |
|---|---|---|---|
| S10.1 | 端到端测试：连续 20 章写作 | 3h | AC-1 验证 |
| S10.2 | 新增模块单元测试 | 3h | 覆盖率 ≥ 80% |
| S10.3 | 回归测试：152 个现有测试继续通过 | 2h | AC-10 验证 |

**总预估：~83h / 4 周**


## 十、验收测试计划

### 10.1 自动化测试

| 测试项 | 测试方法 | 覆盖内容 |
|---|---|---|
| SF_LOG 新类型解析 | `pytest` 单元测试 | 4 种新 type 正确解析、handler 正确触发 |
| L2 数据结构 CRUD | `pytest` 单元测试 | 章摘要写入/读取、关系图更新、时间轴追加 |
| ReaderOS 计算 | `pytest` 单元测试 | 追更欲/疲劳度公式正确性、阈值触发 |
| STAGE 5 诊断 | `pytest` 单元测试 | 3 类检测各 ≥ 5 个测试用例 |
| 多角色生成 | `pytest` 单元测试 | 主角/配角生成、性格去重 |
| 阶段状态机扩展 | `pytest` 单元测试 | STAGE4→5→6→COMPLETED 转换 |
| 回归测试 | `pytest` 全部 | 152 个现有测试继续通过 |

### 10.2 手动验收测试（AC-1 ~ AC-10）

| AC | 测试步骤 |
|---|---|
| **AC-1** 20 章连续写作 | 从 STAGE3 生成 20 章大纲 → STAGE4 逐章写作 → 验证章间角色位置/情绪/关系状态正确传递 |
| **AC-2** 7 类叙事资产 | 检查 storyos/ 目录，确认 7 个 JSON 文件非空且数据正确 |
| **AC-3** ReaderOS 预警 | 连续写 5 章后检查 progress.json 中 reader_os 字段，确认预警在 Writer 上下文中可见 |
| **AC-4** L2 < 8K tokens | 完成 20 章后检查 L2 文件总大小 < 8K tokens |
| **AC-5** STAGE 5 诊断注入测试 | 故意制造 1 个位置跳跃 + 1 个未解决冲突 + 1 个死伏笔 → 确认诊断报告输出 3 个问题 |
| **AC-6** STAGE 6 导出 | 导出 .md 文件，确认 SF_LOG 标记已去除、TOC 正确 |
| **AC-7** Style Extractor | 上传 500 字参考文本，确认句式/词汇分析结果正确 |
| **AC-8** 多角色关系网络 | 生成 3 个角色，写作过程中检查关系状态在双向同步 |
| **AC-9** 多角色生成 | STAGE2 生成 ≥ 3 个角色，写作上下文正确注入各角色特定信息 |
| **AC-10** 回归测试 | 运行全部现有测试 + 新增测试，确认全部通过 |


## 十一、前后端接口契约（v1.5 增量）

### 11.1 数据流（advance-chapter 关键路径）

```
前端                          后端                        文件系统
 │                             │                            │
 │── POST /stage4/write-scene →│ (多章上下文组装)            │
 │   {chapter_number: 5,       │── 读取 outline.json Ch5 ──→│
 │    scene_number: 2}         │── 读取 characters (all) ──→│
 │                             │── 读取 L1 (最近5章) ──────→│
 │                             │── 读取 L2 (摘要) ──────────→│
 │                             │── 读取 ReaderOS 预警 ──────→│
 │                             │── Writer LLM 调用           │
 │                             │── Reviewer Fact Guard       │
 │                             │── StoryOS Agent 解析        │
 │←── SceneDraft + Results ────│                            │
 │                             │                            │
 │── POST /advance-chapter ───→│                            │
 │                             │── Summary Archiver ────────→│ (章摘要 → L2)
 │                             │── L1.trim_to_last_5()       │
 │                             │── ReaderOS.calculate() ────→│ (写入 progress.json)
 │                             │── progress.current_chapter++│
 │←── {advanced, reader_os} ───│                            │
```

### 11.2 错误码补充

| Code | HTTP | 说明 |
|---|---|---|
| `CHAPTER_NOT_FOUND` | 404 | 指定章节号在 outline.json 中不存在 |
| `CHAPTER_NOT_COMPLETE` | 400 | advance-chapter 时当前章尚有 Scene 未完成 |
| `STAGE5_NOT_READY` | 400 | STAGE4 未完成时尝试 STAGE5 操作 |
| `DIAGNOSIS_IN_PROGRESS` | 409 | 诊断正在执行中，请等待 |
| `EXPORT_FAILED` | 500 | 导出过程中文件操作失败 |
| `STYLE_EXTRACTION_FAILED` | 500 | 风格提炼失败（文本过短或格式不支持） |


## 十二、迁移与兼容性

### 12.1 characters.json 迁移

```
v1.4-MVP 格式:                   v1.5 格式:
{                                 {
  "name": "林峰",                   "characters": [
  "personality": {...},               {
  ...                                   "id": "char_001",
}                                       "name": "林峰",
                                        "is_core_character": true,
                                        "character_type": "protagonist",
                                        "relations": {},
                                        ...
                                      }
                                    ]
                                  }
```

迁移逻辑（`_load_context()` 中自动处理）：
```python
# 读取 characters.json
char_data = fm.read_json(project_id, "characters.json")
if isinstance(char_data, dict) and "characters" not in char_data:
    # 旧格式：单角色对象
    char_data = {"characters": [char_data]}
```

### 12.2 progress.json 迁移

新增字段（`current_chapter`, `reader_os`, `character_appearances`）均有默认值，旧格式文件自动兼容。

### 12.3 现有测试兼容

- 152 个现有测试全部使用单章/单角色数据，v1.5 变更不应破坏现有测试
- 新增测试使用独立的测试 fixture（多角色、多章）


## 附录 A: 验收标准对照表

| AC | 描述 | 对应测试 |
|---|---|---|
| AC-1 | 连续写作 20 章，章间状态正确传递 | 手动端到端 |
| AC-2 | 7 类叙事资产正确创建和更新 | 自动（注册表状态校验） |
| AC-3 | 追更欲/疲劳度每章自动计算，预警正确注入 | 自动（ReaderOS 单元测试 + Writer 上下文检查） |
| AC-4 | L2 温记忆 20 章时 < 8K tokens | 自动（token 统计） |
| AC-5 | STAGE 5 诊断正确识别 3 个注入问题 | 自动（诊断注入测试） |
| AC-6 | STAGE 6 导出 .md，SF_LOG 已去除，TOC 正确 | 自动（文件对比） |
| AC-7 | Style Extractor 正确产出分析结果 | 手动 + 自动（结果 schema 校验） |
| AC-8 | 3 个角色关系网络正确追踪 | 自动（relations 双向同步校验） |
| AC-9 | STAGE2 支持 ≥ 3 个角色，上下文正确注入 | 手动 + 自动（character_count 断言） |
| AC-10 | 152 个现有测试继续通过 + 新模块覆盖率 ≥ 80% | 自动（pytest） |

## 附录 B: 与 v1.4-MVP TRD 的关键差异

| 维度 | v1.4-MVP | v1.5 |
|---|---|---|
| 章节范围 | 1 章 | 20-100 章 |
| 叙事资产 | 4 类注册表 | 7 类 + 伏笔注册表 |
| SF_LOG 类型 | 7 种（后端） | 11 种（后端） |
| Agent | 4 个 | 5 个（+ Summary Archiver） |
| MemoryOS | L0 + L1（无界增长） | L0 + L1（裁剪至 5 章） + L2 |
| ReaderOS | 无 | 追更欲 + 疲劳度 |
| STAGE | 5 阶段（INIT→S4→COMPLETED） | 7 阶段（+S5+S6） |
| 角色 | 单角色 | 多角色 + 关系网络 |
| 风格提炼 | 无 | Style Extractor |
| 导出 | 无 | STAGE 6 .md 导出 |
| API 端点 | 16 | 22（+6） |
| 前端页面 | 6 | 8（+ Stage5Page + Stage6Page） |
| 测试用例 | 152 | 200+ |
| Token 预算（单章） | ~53.5K | ~70.2K |
| 总工时 | ~144h | ~83h（增量） |
