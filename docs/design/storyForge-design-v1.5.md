# StoryForge v1.5 — 产品设计文档

> v1.5 目标：从"能写一章"升级到"能写完一部作品"，建立多章连续写作的量产能力。

---

## 一、版本定位

### 1.1 从 v1.4-mvp 到 v1.5

```
v1.4-mvp                          v1.5
───────                           ────
1 章端到端                         多章连续写作（典型 20-100 章）
4 类叙事资产                        7 类叙事资产
5 项 Fact Guard                    5 项 Fact Guard（不变）
L0 + L1 记忆                       L0 + L1 + L2
无 ReaderOS                        追更欲 + 疲劳度
无 STAGE 5 / STAGE 6               基础诊断 + .md 导出
单角色                             多角色 + 关系网络
无风格提炼                          风格提炼（Style Extractor）
7 种 SF_LOG 标记（后端解析）         11 种 SF_LOG 标记（后端完整实现）
4 个 Agent                         5 个 Agent（+ Summary Archiver）
单模型                             单模型（多 Tier 在 v1.6）
```

### 1.2 核心目标

| 目标 | 说明 |
|---|---|
| **量产能力** | 连续写作 20 章，章间状态自动传递，无需人工干预 |
| **记忆扩展** | L2 温记忆提供全书级结构化摘要，保持长篇上下文连贯 |
| **叙事完整性** | 7 类叙事资产全覆盖，追踪从铺垫到揭示的完整生命周期 |
| **读者感知** | 追更欲 + 疲劳度两项核心指标，预警节奏问题 |
| **质量兜底** | STAGE 5 基础诊断 + STAGE 6 .md 导出 |

---

## 二、v1.4-mvp 现状回顾

### 2.1 已实现模块

| 模块 | 文件 | 状态 |
|---|---|---|
| **LLM Provider** | `anthropic_provider.py` `deepseek_provider.py` `minimax_provider.py` | 三 Provider + 工厂模式 |
| **Conductor** | `state_machine.py` `circuit_breaker.py` `checkpoint.py` | 5 阶段 FSM + 熔断 + 断点 |
| **Agents** | `planner.py` `writer.py` `reviewer.py` `storyos_agent.py` | 4 Agent 完整 |
| **MemoryOS** | `l0_runtime.py` `l1_hot.py` | L0(~500 tokens) + L1(近 5 章) |
| **StoryOS** | `registries.py` | 4 类注册表(Conflict/Mystery/Twist/Goal) |
| **Scene Engine** | `schema.py` `beat_patterns.py` | Schema 2.0 + beat 模式 |
| **Style Engine** | `genre_template.py` | L1 体裁模板(cool_novel.yaml) |
| **API Routes** | 7 个路由文件 | 端到端一章通 |
| **Pydantic Models** | 8 个模型文件 | project/world/character/storyos/sf_log/outline/progress/checkpoint |
| **Prompts** | 6 个 YAML | concept/world/character/outline/scene_writing/scene_rewrite |
| **Frontend** | 6 页面 + 6 共享组件 + 3 hooks | React 18 + Vite + Tailwind |
| **Tests** | 10 文件 152 用例 | unit + integration |

### 2.2 当前限制

| 限制 | 影响 |
|---|---|
| 单章写作 | 仅能生成第 1 章，无法继续 |
| 单角色 | characters.json 仅支持 1 个角色 |
| 4 类叙事资产 | 缺少 Promise/Reveal/Expectation |
| L0+L1 记忆 | 5 章后 L1 溢出，无全书摘要 |
| 无 ReaderOS | 无法感知读者体验趋势 |
| 无 STAGE 5/6 | 无诊断和导出能力 |
| 无风格提炼 | 无法从参考文本学习风格 |
| 后端仅 5 阶段 | STAGE5/STAGE6 未定义在 StateMachine |

---

## 三、新增功能详设

### F1.5.1 多章 STAGE 4 写作循环

**目标：** 从单章扩展到完整的逐章循环，章间自动推进。

**当前状态（v1.4-mvp）：**
- `write_scene` 端点硬编码读取 `chapters[0]`
- `_load_context()` 取 `chapters[0]` 和 `characters[0]`
- checkpoint 仅记录 scene_number，无 chapter 上下文

**v1.5 变更：**

#### 3.1.1 Conductor 章节进度管理

在 `progress.json` 中增加 `current_chapter` 追踪：

```json
{
  "project_id": "proj_xxx",
  "current_stage": "STAGE4",
  "current_chapter": 5,
  "total_chapters": 20,
  "chapters": [
    {
      "chapter_number": 1,
      "status": "completed",
      "scenes": [
        {"scene_number": 1, "status": "completed", "retry_count": 0, "coherence_score": 85},
        {"scene_number": 2, "status": "completed", "retry_count": 1, "coherence_score": 78}
      ]
    }
  ]
}
```

#### 3.1.2 章间状态传递

每章完成时，以下状态自动传递到下一章：

| 状态类型 | 来源 | 传递方式 |
|---|---|---|
| 角色当前位置 | L0 Runtime | `character_location` log → L0 snapshot |
| 角色当前情绪 | L0 Runtime | `character_emotion` log → L0 snapshot |
| 角色关系状态 | StoryOS registries | `character_relation_change` log → registry |
| 活跃冲突 | conflicts.json | registry 持久化 |
| 开放谜团 | mysteries.json | registry 持久化 |
| 角色已知信息 | L0 Runtime | `knowledge_gain` log → L0 snapshot |

#### 3.1.3 `_load_context()` 重构

```python
def _load_context(project_id: str, chapter_number: int = None) -> dict:
    """加载写作上下文，支持指定章节号"""
    outline = fm.read_json(project_id, "outline.json") or {}
    if "chapters" not in outline and "scene_plan" in outline:
        outline = {"chapters": [outline]}

    chapters = outline.get("chapters", [])

    # 查找指定章节
    chapter = None
    if chapter_number:
        chapter = next((c for c in chapters if c.get("chapter_number") == chapter_number), None)
    if chapter is None:
        chapter = chapters[0] if chapters else {}

    characters = characters_data.get("characters", [])

    # L1 加载：最近 5 章的 Scene drafts（裁剪逻辑见 F1.5.2）
    l1 = L1Hot()  # 注：类名 L1Hot 来自 backend/memory_os/l1_hot.py
    for draft_file in sorted(chapters_dir.glob("ch*_scene_*_draft.md")):
        text = draft_file.read_text(encoding="utf-8")
        l1.append_scene(0, text)

    return {
        "chapter": chapter,
        "characters": characters,
        "l1_context": l1.get_context_string(),
    }
```

#### 3.1.4 STAGE4 API 变更

| 端点 | 变更 |
|---|---|
| `POST /write-scene` | 新增 `chapter_number` 参数（已支持，需完善） |
| `GET /scene-plan/{scene_num}` | 新增 `chapter_number` 参数 |
| `GET /progress` | 返回增加 `current_chapter`、`current_scene` |
| `POST /advance-chapter` | **新增** — 完成当前章，推进到下一章 |

#### 3.1.5 Stage State Machine 扩展

```python
class Stage(str, Enum):
    INIT = "INIT"
    STAGE1 = "STAGE1"
    STAGE2 = "STAGE2"
    STAGE3 = "STAGE3"
    STAGE4 = "STAGE4"
    STAGE5 = "STAGE5"   # 新增
    STAGE6 = "STAGE6"   # 新增
    COMPLETED = "COMPLETED"

# STAGE4 → STAGE5 前置校验
STAGE5_PREREQUISITES = [
    ("progress.json", "chapters", lambda v: all chapters completed),
]
```

#### 3.1.6 Checkpoint 跨章恢复

Checkpoint 增加章节维度，支持从任意章/Scene 位置恢复：

```json
// .storyforge_checkpoint.json
{
  "project_id": "proj_xxx",
  "pipeline_stage": "scene_writing",
  "chapter_number": 5,
  "scene_number": 2,
  "snapshots": {
    "l0_runtime": { ... },
    "storyos_registries": { ... },
    "character_states": { ... }
  },
  "recorded_at": "2026-06-11T..."
}
```

**恢复行为：**
- 从 checkpoint 恢复时，Conductor 先验证 `progress.json` 中的章节和 Scene 状态与 checkpoint 一致
- 状态一致 → 从中断的 Scene 重新开始
- 状态不一致（如 progress.json 已标记该 Scene 为 completed）→ 跳过已完成 Scene，从下一个未完成 Scene 继续
- 回退策略：用户可选择"从当前章开头重新开始"而非从中断 Scene 恢复

---

### F1.5.2 MemoryOS L2（温记忆）

**目标：** 提供全书级的结构化摘要，保持长篇上下文连贯。

**当前状态（v1.4-mvp）：**
- 仅有 L0（实时，~500 tokens）和 L1（近 5 章 Scene drafts，无限增长）
- L1 在 10 章后会膨胀到数万 tokens，无法作为有效的写作上下文

**v1.5 设计：**

#### 3.2.1 Summary Archiver Agent

新增 Agent，每章完成后自动执行：

```python
class SummaryArchiver(BaseAgent):
    """Tier 3 Agent — 使用轻量模型生成章摘要"""

    async def archive_chapter(self, chapter_number: int, scene_drafts: list[str]) -> dict:
        """
        输入：一章中所有 Scene 的草稿文本
        输出：结构化章摘要
        """
        return {
            "chapter_number": chapter_number,
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
            "hooks_planted": ["章末悬念描述"],
            "generated_at": "2026-06-11T..."
        }
```

#### 3.2.2 L2 数据结构

```
MemoryOS L2 (温记忆)
├── chapter_summaries/           # 每章摘要（~200 tokens/章）
│   ├── ch_001_summary.json
│   ├── ch_002_summary.json
│   └── ...
├── relationship_graph.json      # 角色关系图（增量更新）
│   {
│     "nodes": ["林峰", "苏晓晓", "师父"],
│     "edges": [
│       {"a": "林峰", "b": "苏晓晓", "status": "裂痕", "last_update_ch": 5}
│     ]
│   }
├── timeline.json                # 全书时间轴
│   [
│     {"chapter": 1, "time_point": "深夜·末班地铁", "events": [...]},
│     {"chapter": 2, "time_point": "次日清晨·家中", "events": [...]}
│   ]
└── active_narrative_state.json  # 当前叙事状态快照
    {
      "unresolved_conflicts": ["cf_001", "cf_003"],
      "open_mysteries": ["mys_002"],
      "pending_promises": ["pr_001"],
      "planted_twists": ["tw_001"]
    }
```

#### 3.2.3 检索优先级（不变）

```
L0 → L1 → L2
```

L2 为 L1 溢出时的主要后备。20 章时 L2 总量约 4K tokens（20 章 × 200 tokens），40 章约 8K tokens。

#### 3.2.4 触发时机

- **章摘要生成：** 每章最后一个 Scene 完成后，Summary Archiver 自动生成
- **关系图更新：** 从 `character_relation_change` SF_LOG 增量更新
- **时间轴更新：** 从 Scene 规划中的 `time_point` 和实际产出事件更新
- **L1 裁剪：** 每章完成后裁剪 L1 至仅保留最近 5 章的 Scene drafts，旧数据已由 L2 摘要覆盖；裁剪前 Summary Archiver 确认该章摘要已写入 L2
- **L1 重提取：** 每 5 章触发一次，Haiku 从最近 5 章中提取关键细节补充到 L1（替代简单裁剪可能丢失的细节）

#### 3.2.5 L1→L2 过渡策略

```
章完成 → Summary Archiver 生成章摘要 → 写入 L2
       → 裁剪 L1：保留最近 5 章原始 Scene drafts
       → 如 当前章号 % 5 == 0 → L1 重提取（补充细节）
```

L1 保持 ~15K tokens 上限（约 5 章 × 3 Scene/章 × 1K tokens/Scene 摘要），20 章时 L2 约 4K tokens（20 × 200 tokens），L0+L1+L2 合计 ~20K tokens，在单章 Token 预算内可控。

---

### F1.5.3 StoryOS 扩展至 7 类叙事资产 + 伏笔注册表

**目标：** 从 MVP 的 4 类扩展到完整的 7 类叙事资产（外加伏笔注册表），覆盖从铺垫到揭示的完整生命周期。

**当前状态（v1.4-mvp）— 后端实际实现：**
- 注册表：Conflict / Mystery / Twist / Goal（4 类）
- SF_LOG 后端解析（`regex_patterns.py:VALID_LOG_TYPES`）：7 种
  - `character_emotion` / `character_relation_change` / `character_location_change`
  - `knowledge_gain` / `conflict_escalate` / `mystery_clue` / `registry_create`
- 注：前端 `Stage4Page.tsx` 的 `LOG_TYPE_LABELS` 已预留 11 种标签显示，但后端仅解析上述 7 种

**v1.5 新增 3 类叙事资产 + 1 类伏笔辅助资产：**

#### 3.3.1 Promise（承诺）注册表

追踪角色对谁的承诺、何时兑现。

```json
// storyos/promises.json
[
  {
    "id": "pr_001",
    "promiser": "林峰",
    "promisee": "苏晓晓",
    "content": "答应在她生日那天告诉她真相",
    "deadline_chapter": 8,
    "status": "pending",
    "created_chapter": 3,
    "fulfilled_chapter": null,
    "fulfillment_detail": null
  }
]
```

**SF_LOG 标记：**
```
<!-- SF_LOG registry_create type="promise" data='{"id":"pr_001","promiser":"林峰","promisee":"苏晓晓","content":"..."}' -->
```

#### 3.3.2 Reveal（揭晓）注册表

追踪什么秘密揭示了、谁知道/不知道。

```json
// storyos/reveals.json
[
  {
    "id": "rev_001",
    "secret": "师父的真实身份",
    "revealed_to": ["林峰"],
    "still_hidden_from": ["苏晓晓", "其他角色"],
    "reveal_chapter": 12,
    "method": "师父临终遗言",
    "linked_mystery": "mys_003",
    "cascade_effect": "触发 Expectation exp_001 进入 ready_to_fulfill"
  }
]
```

#### 3.3.3 Expectation（读者期待）注册表

追踪读者当前在期待什么发生。

```json
// storyos/expectations.json
[
  {
    "id": "exp_001",
    "description": "林峰与师父的对决",
    "planted_chapter": 5,
    "expected_fulfillment_chapter": 15,
    "status": "accumulating",
    "intensity": 78,
    "linked_conflicts": ["cf_001"],
    "linked_promises": ["pr_003"]
  }
]
```

**SF_LOG 标记变更（后端 VALID_LOG_TYPES）：**

后端从 7 种扩展到 11 种，新增 4 种：

| 新增标记 | 用途 | 处理方式 |
|---|---|---|
| `twist_reveal` | 标记转折被揭示 | StoryOS Agent 更新 twists.json 状态 |
| `expectation_fulfill` | 标记某个期待的满足 | StoryOS Agent 更新 expectations.json 状态 |
| `goal_milestone` | 标记目标里程碑达成 | StoryOS Agent 更新 goals.json 进度 |
| `character_physical_change` | 标记角色物理状态变化（受伤/觉醒等） | StoryOS Agent 收集角色状态更新 |

注：`character_location_change` 在 MVP 后端已实现（`_collect_character_update()` 处理），v1.5 保持不变。`character_physical_change` 在 MVP 后端 **未实现**（不在 VALID_LOG_TYPES 中），是 v1.5 真正的新增类型。

> 变更汇总：后端 VALID_LOG_TYPES 7 → 11，前端 10 种标签修正为完整 11 种。

#### 3.3.4 Foreshadowing（伏笔）注册表

追踪伏笔从种植到揭示的完整生命周期（此注册表同时支撑 STAGE 5 诊断的伏笔完整性检测）。

```json
// storyos/foreshadowing.json
[
  {
    "id": "fs_001",
    "description": "师父书房暗格中的旧照片",
    "planted_chapter": 2,
    "planted_scene": 1,
    "status": "planted",
    "expected_payoff_chapter": 15,
    "clues": [
      {"chapter": 3, "scene": 2, "description": "林峰注意到师父每次提起师母时眼神闪烁"},
      {"chapter": 5, "scene": 1, "description": "老管家说漏嘴提到'那场事故'"}
    ],
    "revealed_chapter": null,
    "payoff_detail": null,
    "linked_mysteries": ["mys_001"],
    "linked_characters": ["char_001", "char_003"]
  }
]
```

| 状态 | 说明 |
|---|---|
| `planted` | 已种植，等待后续线索展开 |
| `developing` | 有 ≥ 1 条线索，正在展开中 |
| `revealed` | 已揭示/回收 |
| `dead` | 无后续线索 ≥ 5 章，标记为死伏笔 |

**SF_LOG 标记：**
```
<!-- SF_LOG registry_create type="foreshadowing" data='{"id":"fs_001","description":"..."}' -->
<!-- SF_LOG mystery_clue id="fs_001" clue="林峰注意到师父每次提起师母时眼神闪烁" -->
```

#### 3.3.5 注册表管理增强

- `RegistryManager` 新增 4 个 JSON 文件：`promises.json` / `reveals.json` / `expectations.json` / `foreshadowing.json`
- `_handle_registry_create()` 扩展 type 分支
- 级联传播规则暂不在 v1.5 实现（推迟到 v1.6）

---

### F1.5.4 基础 ReaderOS（追更欲 + 疲劳度）

**目标：** 引入两个最关键的读者体验指标，在连续写作中预警节奏问题。

**设计原则：** 全部公式计算，零 LLM 调用。

#### 3.4.1 追更欲（Addiction）

```
追更欲 = 好奇心 × 0.30 + 张力 × 0.25 + 满足感 × 0.20 + 结尾钩子 × 0.25
```

| 子指标 | 计算方式 | 数据来源 |
|---|---|---|
| **好奇心** | Σ(开放谜团 × 影响权重) → 归一化 0-100<br>世界观级=30 / 剧情级=20 / 角色级=10 | `mysteries.json` |
| **张力** | 当前活跃冲突的强度均值 | `conflicts.json` |
| **满足感** | 近 3 章 fulfilled 的 Expectation + Promise 数量 × 20，上限 100 | `expectations.json` + `promises.json` |
| **结尾钩子** | 每章结尾 cliffhanger 存在性<br>有=100 / 部分=50 / 无=0 | `scene_plan[last].narrative_role == "cliffhanger"` |

#### 3.4.2 疲劳度（Fatigue）

```
疲劳度 = max(0, 近3章张力均值 - 50) × 1.5
```

连续高强度章节会累积疲劳。

#### 3.4.3 预警阈值（爽文体裁）

| 指标 | 阈值 | 预警级别 |
|---|---|---|
| 追更欲 < 50 | 严重 | Writer 上下文注入 "当前追更欲偏低，考虑增加反转或悬念" |
| 追更欲 < 35 | 严重 | 触发章节评审会重点提醒 |
| 疲劳度 > 55 | 中度 | Writer 上下文注入 "读者疲劳度上升，考虑安排过渡章" |

#### 3.4.4 体裁校准

爽文体裁（`cool_novel`，当前默认体裁）通常保持较高张力水平，疲劳度公式增加体裁衰减因子以避免误报：

```
疲劳度 = max(0, avg_tension_3_chapters - 60) × 1.0    # 爽文体裁（阈值从 50 提高到 60，衰减从 1.5 降到 1.0）
疲劳度 = max(0, avg_tension_3_chapters - 50) × 1.5    # 通用体裁
```

这也意味着后续引入多体裁（v1.6）时，阈值将成为体裁模板配置的一部分。

#### 3.4.5 实现

```python
# backend/reader_os/__init__.py
class ReaderOS:
    """零 LLM — 全部公式计算"""

    def calculate_addiction(self, chapter_number: int) -> float: ...
    def calculate_fatigue(self, chapter_number: int, genre: str = "cool_novel") -> float: ...
    def get_warnings(self, chapter_number: int) -> list[dict]: ...
    def get_trend(self, metric: str, window: int = 5) -> list[float]: ...
```

每章完成后自动计算，结果写入 `progress.json` 的章节记录中。

---

### F1.5.5 STAGE 5 全书诊断（基础版）

**目标：** 全书写作完成后，自动扫描三大类一致性问题。

#### 3.5.1 诊断类别

| 类别 | 检测内容 | 检测方式 |
|---|---|---|
| **时间线断裂** | 角色位置跳跃无 `character_location_change` 标记 | 规则匹配 — 扫描相邻章节的角色位置变化 |
| **叙事资产遗留** | 未解决的 Conflict、未揭示的 Mystery、未兑现的 Promise | 注册表遍历 — 扫描状态不为 resolved/revealed/fulfilled 的资产 |
| **伏笔完整性** | 伏笔是否有始有终（planted → clues → revealed）、是否有 planted 但无后续的"死伏笔" | 伏笔映射表遍历 |

#### 3.5.2 问题分级

| 优先级 | 定义 | 示例 |
|---|---|---|
| **P0** | 叙事逻辑矛盾 | 角色第 5 章在北京，第 6 章在上海且无移动标记 |
| **P1** | 叙事资产未闭环 | 第 3 章 planted 的 Mystery 到结局未揭示 |
| **P2** | 建议优化 | 连续 5 章无 cliffhanger，节奏可能偏平 |

#### 3.5.3 诊断报告格式

```json
// diagnosis_report.json
{
  "generated_at": "...",
  "total_chapters": 20,
  "issues": [
    {
      "id": "diag_001",
      "priority": "P0",
      "category": "timeline_break",
      "chapter": 8,
      "description": "林峰在第 7 章末位于城西烂尾楼，第 8 章开头位于家中，缺少位置变更标记",
      "suggestion": "在第 8 章开头添加 <!-- SF_LOG character_location_change char=\"林峰\" from=\"城西烂尾楼\" to=\"家中\" -->",
      "status": "open"
    }
  ],
  "summary": {
    "p0_count": 2,
    "p1_count": 5,
    "p2_count": 8
  }
}
```

#### 3.5.4 STAGE5 API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/stage5/diagnose` | POST | 执行全书诊断 |
| `/api/stage5/diagnosis` | GET | 获取诊断报告 |
| `/api/stage5/resolve/{issue_id}` | POST | 标记问题为已处理/跳过 |

---

### F1.5.6 STAGE 6 基础导出

**目标：** 将完成的章节拼接为可读的 Markdown 文件。

#### 3.6.1 导出选项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `strip_sf_logs` | true | 去除所有 `<!-- SF_LOG ... -->` 标记 |
| `add_toc` | true | 添加章节目录 |
| `include_title_page` | true | 包含书名和作者信息 |

#### 3.6.2 导出流程

```
1. 读取所有章节的 Scene drafts
2. 按 chapter_number → scene_number 排序
3. 每个 Scene 前插入场景标题（可选）
4. 去除 SF_LOG 标记（正则替换）
5. 拼接为完整 .md 文件
6. 写入 projects/{id}/exports/novel.md
```

#### 3.6.3 STAGE6 API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/stage6/export` | POST | 执行导出 |
| `/api/stage6/download` | GET | 下载导出文件 |

---

### F1.5.7 风格提炼（Style Extractor）

**目标：** 作者上传参考文本，系统分析其写作风格特征，生成可复用的风格配置。

#### 3.7.1 分析维度

| 维度 | 提取内容 | 方法 |
|---|---|---|
| **句式特征** | 平均句长、句长分布（短/中/长句比例）、段落长度分布 | 分词 + 统计 |
| **对话特征** | 对话占比、对话平均长度、对话标记词分布 | 正则匹配引号内文本 |
| **描写密度** | 环境描写占比、动作描写占比、心理描写占比 | LLM 分类（Tier 3） |
| **词汇特征** | 高频词 Top 50、独特词汇占比、成语使用频率 | 分词 + 词频统计 |
| **节奏特征** | 场景切换频率、情绪起伏密度 | LLM 辅助判断（Tier 3） |

#### 3.7.2 输出格式

```yaml
# projects/{id}/style/extracted_style.yaml
name: "用户自定义风格"
source_text_length: 500

sentence:
  avg_length: 28
  distribution:
    short_pct: 35    # < 15字
    medium_pct: 45   # 15-40字
    long_pct: 20     # > 40字

dialogue:
  ratio: 0.35
  avg_turn_length: 18

description:
  environment_pct: 15
  action_pct: 40
  psychology_pct: 25
  other_pct: 20

vocabulary:
  top_words: ["突然", "心中", "猛然", "冷声", "沉默"]
  idiom_frequency: 0.08
  unique_word_ratio: 0.62

rhythm:
  scene_change_frequency: "每 ~800 字"
  emotional_peak_density: "每 ~1200 字"
```

#### 3.7.3 API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/style/extract` | POST | 上传文本，执行风格分析 |

---

### F1.5.8 多角色支持

**目标：** 从单角色扩展到多角色，支持角色关系网络追踪。

#### 3.8.1 characters.json 结构变更

```json
{
  "characters": [
    {
      "id": "char_001",
      "name": "林峰",
      "is_core_character": true,
      "personality": {...},
      "current_state": {...},
      "voice_signature": {...},
      "unknown_to_character": [...],
      "relations": {
        "char_002": {"status": "裂痕", "history": [...]},
        "char_003": {"status": "师徒", "history": [...]}
      }
    },
    {
      "id": "char_002",
      "name": "苏晓晓",
      "is_core_character": false,
      ...
    }
  ]
}
```

#### 3.8.2 STAGE 2 角色生成增强

**生成流程：**

```
用户请求生成角色
      │
      ├── 首次生成 → Planner 生成主角（core_character = true）
      │               输入：project.json + concept_and_dna.json + world.json
      │
      ├── 添加角色 → 用户指定角色定位（如"反派"、"女主"、"导师"）
      │               Planner 生成配角（core_character = false）
      │               输入：project.json + concept_and_dna.json + world.json
      │                    + 已有角色摘要（避免性格/能力重叠）
      │
      └── 批量生成 → 用户指定角色数量（如"生成 4 个角色"）
                      Planner 一次性生成主角 + 3 个配角
                      输入：project.json + concept_and_dna.json + world.json
                           + 角色类型列表
```

- `POST /stage2/generate-character` 新增 `character_index` 参数（生成第 N 个角色）和 `character_type` 参数（如 "protagonist" / "antagonist" / "supporting"）
- 前端 Stage2Page 支持多角色卡片切换 + "添加角色"按钮
- 建议核心角色 ≤ 5 个，配角数量不限但仅追踪出场和基础关系

**`relations` 数据一致性：** 角色关系记录在各角色 `relations` 字段中。为保持双向关系一致，StoryOS Agent 在解析 `character_relation_change` 日志时同时更新两个角色的 `relations` 字段（如更新 char_001.relations[char_002] 和 char_002.relations[char_001]）。

#### 3.8.3 Writer 上下文组装

- 写作上下文注入时，遍历所有角色的 `current_state` 和 `voice_signature`
- 主视角角色获得完整信息，次要角色仅注入基础状态
- 各角色的 `unknown_to_character` 交叉校验，避免知识泄漏

#### 3.8.4 角色出场追踪

在 `progress.json` 中增加 `character_appearances`：

```json
{
  "chapters": [
    {
      "chapter_number": 1,
      "character_appearances": {
        "char_001": {"scene_count": 3, "pov": true},
        "char_002": {"scene_count": 1, "pov": false}
      }
    }
  ]
}
```

---

## 四、前端变更

### 4.1 Stage4Page 多章支持

- 章选择器支持跳转到已完成的章查看草稿
- "下一章"按钮在章完成后出现，自动推进
- 章节进度条显示当前章号/总章数

### 4.2 新增页面

| 页面 | 路由 | 说明 |
|---|---|---|
| **Stage5Page** | `/project/:id/stage5` | 全书诊断结果展示 + 问题处理 |
| **Stage6Page** | `/project/:id/stage6` | 导出选项配置 + 下载 |

### 4.3 Stage2Page 多角色

- 角色卡片列表，支持切换查看/编辑
- "添加角色"按钮触发新角色生成
- 角色关系图可视化为简易网络图

### 4.4 Style Extractor UI

- 独立面板：文本输入区 + 分析结果展示
- 保存/应用风格配置

### 4.5 SideNavBar 更新

```
叙事阶段：
  概念讨论
  世界观+角色
  情节头脑风暴
  写作中心
  全书诊断        ← 新增
  导出中心        ← 新增
```

---

## 五、后端变更汇总

### 5.1 新增文件

| 文件 | 说明 |
|---|---|
| `backend/agents/summary_archiver.py` | 章摘要 + L1 重提取 Agent |
| `backend/reader_os/__init__.py` | ReaderOS 计算引擎 |
| `backend/reader_os/calculator.py` | 追更欲 + 疲劳度公式 |
| `backend/reader_os/thresholds.py` | 体裁差异化阈值 |
| `backend/api/stage5_diagnosis.py` | STAGE 5 API |
| `backend/api/stage6_export.py` | STAGE 6 API |
| `backend/api/style_extractor.py` | 风格提炼 API |
| `backend/story_os/promise_registry.py` | Promise 注册表 |
| `backend/story_os/reveal_registry.py` | Reveal 注册表 |
| `backend/story_os/expectation_registry.py` | Expectation 注册表 |
| `backend/story_os/foreshadowing_registry.py` | Foreshadowing 伏笔注册表 |

### 5.2 修改文件

| 文件 | 变更 |
|---|---|
| `stage4_writing.py` | `_load_context()` 支持指定章节号；多角色上下文注入 |
| `state_machine.py` | 新增 STAGE5/STAGE6 枚举值 + 前置校验 |
| `storyos_agent.py` | 新增 4 种 log type 的 registry_create 处理 + 解析 4 种新增 SF_LOG 类型 |
| `writer.py` | 多角色上下文组装；ReaderOS 预警注入 |
| `characters.json` schema | 多角色 + relations 字段（双向同步） |
| `progress.json` schema | chapter 级别扩展字段 + character_appearances |
| `checkpoint.py` | 增加 chapter_number + scene_number 字段；跨章恢复逻辑 |
| `l1_hot.py` | 增加裁剪方法（trim_to_last_n_chapters） |
| `prompts/scene_writing.yaml` | 多角色上下文变量 |
| `prompts/scene_rewrite.yaml` | 多角色上下文变量 |

---

## 六、验收标准

| 编号 | 验收项 |
|---|---|
| **AC-1** | 连续写作 20 章，章间角色位置/情绪/关系状态正确传递，无状态丢失 |
| **AC-2** | 7 类叙事资产注册表（Conflict/Mystery/Twist/Goal/Promise/Reveal/Expectation）正确创建和更新 |
| **AC-3** | 追更欲和疲劳度每章结束后自动计算，预警在下一章 Writer 上下文正确注入 |
| **AC-4** | L2 温记忆在每章完成后自动更新，20 章时总量 < 8K tokens |
| **AC-5** | STAGE 5 诊断正确识别出故意注入的 3 个问题（1 时间线断裂 + 1 未解决冲突 + 1 死伏笔） |
| **AC-6** | STAGE 6 导出 .md 文件，SF_LOG 标记已去除，章节目录正确 |
| **AC-7** | 上传 500 字参考文本，Style Extractor 正确产出句式/节奏/词汇三类分析结果 |
| **AC-8** | 3 个角色的关系网络（双向关系状态）在章节写作中正确追踪 |
| **AC-9** | STAGE2 支持生成 ≥ 3 个角色，写作上下文正确注入角色特定信息 |
| **AC-10** | 所有现有 152 个测试继续通过，新增模块测试覆盖率 ≥ 80% |

---

## 七、实施计划

### 7.1 实施顺序（按依赖关系）

```
F1.5.8 多角色支持
    │
    ▼
F1.5.1 多章写作循环  ←──  依赖多角色上下文组装
    │
    ├──→ F1.5.2 L2 温记忆  ←──  依赖多章完成触发
    │
    ├──→ F1.5.3 7 类叙事资产  ←──  可与多章并行
    │
    ├──→ F1.5.4 基础 ReaderOS  ←──  依赖多章数据
    │
    ├──→ F1.5.5 STAGE 5 诊断  ←──  依赖所有章完成
    │
    ├──→ F1.5.6 STAGE 6 导出  ←──  依赖所有章完成
    │
    └──→ F1.5.7 风格提炼  ←──  独立模块，可并行
```

### 7.2 分步实施

| 步骤 | 内容 | 预估工时 |
|---|---|---|
| **Step 1** | 多角色支持（后端模型 + STAGE2 生成 + Writer 上下文） | 8h |
| **Step 2** | 多章写作循环（Conductor 进度 + `_load_context` 重构 + checkpoint 跨章恢复 + API） | 15h |
| **Step 3** | L2 温记忆（Summary Archiver + 摘要存储 + 关系图 + 时间轴） | 8h |
| **Step 4** | 7 类叙事资产（新增 3 种注册表 + SF_LOG 补充） | 6h |
| **Step 5** | 基础 ReaderOS（追更欲 + 疲劳度 + 预警注入） | 6h |
| **Step 6** | STAGE 5 基础诊断（3 类检测 + 问题分级 + 前端页面） | 10h |
| **Step 7** | STAGE 6 .md 导出（导出逻辑 + 前端页面） | 4h |
| **Step 8** | 风格提炼（文本分析 + YAML 生成 + 前端面板） | 8h |
| **Step 9** | 前端适配（Stage4 多章 + Stage5/6 页面 + SideNavBar） | 10h |
| **Step 10** | 集成测试 + 端到端验证 | 8h |
| **合计** | | **~83h / 4 周** |

---

## 八、风险与缓解

| 风险 | 概率 | 缓解措施 |
|---|---|---|
| L1 上下文在多章后膨胀导致 Token 超预算 | 中 | L2 摘要逐步替代 L1 原始文本；L1 仅保留近 5 章 |
| 多角色导致单章 Token 消耗翻倍 | 中 | 次要角色仅注入基础状态，不全量注入 voice_signature |
| 角色关系网络复杂度随角色数指数增长 | 低 | 限制核心角色 ≤ 5 个，配角仅追踪出场和基础关系 |
| ReaderOS 预警阈值不适用于非爽文体裁 | 中 | 非爽文体裁使用宽松阈值，v1.6 实现体裁差异化 |
| Style Extractor Tier 3 模型质量不足 | 低 | 句长/词频等为确定性计算，LLM 仅用于描写分类 |
