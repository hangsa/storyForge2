# StoryForge v1.4-MVP — 最小可运行版本设计文档

> 本文档从 v1.4 完整设计方案中抽取最小可运行子集。MVP 目标：**完成一章小说端到端写作** — 从项目创建到一章成稿，打通 Planner → Writer（含 SF_LOG 标记）→ Reviewer（Fact Guard 硬检 + 熔断降级）→ StoryOS 更新（正则解析）的核心链路。


## 一、MVP 范围与取舍

### 1.1 纳入 MVP 的内容

| 模块 | 纳入范围 | 依据 |
|---|---|---|
| **Conductor** | 阶段状态机（6 阶段线性推进，无回退）、P0 熔断降级、Scene 级断点续写 | 一章写作必需的主控调度 |
| **INIT** | 最简向导：意图输入 → 基础参数 → 生成 project.json | 项目创建是入口 |
| **STAGE 1** | 简化概念讨论：直接产出 concept.json + story_dna.json（单轮生成，无 WhatIf 树） | 为写作提供故事方向 |
| **STAGE 2** | 简化世界观+角色：world.json + characters.json（单角色，无成长曲线） | 为写作提供基本设定 |
| **STAGE 3** | 简化大纲：outline.json（仅包含当前章，含 Scene 规划 + 伏笔声明 + 叙事资产预声明） | 为 Writer 提供章节蓝图 |
| **STAGE 4** | **完整一章写作循环**：Scene 规划 → 逐幕写作(SF_LOG) → Fact Guard 5 项硬检 → StoryOS 正则解析更新 → checkpoint | MVP 核心链路 |
| **STAGE 5/6** | 不纳入 | 一章无需全书诊断和导出 |
| **StoryOS** | 4 类叙事资产注册表（Conflict / Mystery / Twist / Goal），无级联传播 | 追踪一章内的叙事变化 |
| **SF_LOG** | 7 种标记类型，正则解析，required_logs 硬检 | 确定性叙事追踪的核心机制 |
| **MemoryOS** | L0（运行时）+ L1（热记忆，最近章节内容），无 L2/L3/L4 | 一章写作的记忆需求极低 |
| **Reviewer** | Fact Guard 5 项确定性硬检 + 熔断降级（3 次重试），无 Narrative Guard / Style Guard | 一致性保障的最小闭环 |
| **Scene Engine** | Scene Schema 基本结构 + beat 模式 + SF_LOG 标记规范 | Writer 写作的执行框架 |
| **Style Engine** | 仅 L1 体裁模板（内置爽文一个模板） | 给 Writer 基本的风格指引 |
| **Agent 层** | Planner + Writer + Reviewer + StoryOS Agent（4 个 Agent） | 一章写作的最小 Agent 集合 |

### 1.2 明确不纳入 MVP 的内容

| 不纳入 | 原因 | 后续版本 |
|---|---|---|
| CreativeOS 全套引擎（Mutation / Contradiction / WhatIf / Genre Fusion / Novelty Evaluator） | 一章不需要完整创意发散 | v1.5 |
| 创意画布交互探索 | 需要 WhatIf 树支撑 | v1.5 |
| 成长工坊（Growth Workshop） | 一章不需要完整成长曲线 | v1.5 |
| 分支模拟引擎 | 一章不需要推演分支 | v1.5 |
| ReaderOS 七项读者指标 | 一章无法建立有意义的读者模型 | v1.5 |
| MemoryOS L2/L3/L4 | 一章写作上下文很短，L0+L1 足够 | v1.5 |
| 语义完整性预检 | Tier 3 LLM 额外调用，一章内 SF_LOG 遗漏风险低 | v1.5 |
| 叙事资产级联传播与冲突检测 | 一章内资产关系简单，手动管理即可 | v1.5 |
| 叙事重构模式 | 一章不存在"后期偏离"场景 | v1.5 |
| 跨作品资产复用 | 一章无需跨项目 | v1.5 |
| 协作疲劳感知 | 一章写作时长远低于触发阈值 | v1.5 |
| 灵感路由器 | 一章内讨论少，手动记录即可 | v1.5 |
| 风格沙盒 / 创新豁免 | 一章不需要风格微调 | v1.5 |
| 回退影响传播机制 | 一章无需回退 | v1.5 |
| Mid-Scene 草稿缓存 | 崩溃恢复优化，非核心功能 | v1.5 |
| 体裁差异化阈值 | 仅支持一种体裁 | v1.5 |
| 多模型 Tier 策略 | MVP 用单一模型 | v1.5 |
| 全书诊断（STAGE 5） | 一章无需诊断 | v1.5 |
| 多格式导出（STAGE 6） | 一章直接输出 .md 即可 | v1.5 |


## 二、MVP 系统架构

```
                        用户
                         │
                         ▼
              ┌─────────────────────┐
              │  Conductor（简化版）  │
              │  · 阶段状态机        │
              │  · P0 熔断降级       │
              │  · Scene 级断点续写  │
              └─────────┬───────────┘
                        │
    ┌──────────┬────────┼────────┬──────────┐
    ▼          ▼        ▼        ▼          ▼
┌──────┐ ┌─────────┐ ┌──────┐ ┌──────┐ ┌──────────┐
│INIT  │ │STAGE1-3 │ │STAGE4│ │Story │ │ MemoryOS │
│向导   │ │简化概念  │ │写作   │ │OS    │ │ L0 + L1  │
│      │ │世界观    │ │循环   │ │4类资产│ │          │
│      │ │大纲      │ │      │ │      │ │          │
└──────┘ └─────────┘ └──────┘ └──────┘ └──────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │    Agent 层（4个）    │
              │ Planner · Writer    │
              │ Reviewer · StoryOS  │
              │        Agent        │
              └─────────────────────┘
```


## 三、Conductor（简化版）

### 3.1 阶段状态机

MVP 仅支持线性前进，不支持回退：

```
INIT ──→ STAGE1 ──→ STAGE2 ──→ STAGE3 ──→ STAGE4 ──→ 完成
```

| 转换 | 触发条件 | 前置校验 |
|---|---|---|
| INIT → STAGE1 | project.json 创建完成 | title 和 genre 非空 |
| STAGE1 → STAGE2 | concept.json + story_dna.json 产出 | core_contradiction 非空 |
| STAGE2 → STAGE3 | world.json + characters.json 产出 | 至少 1 个角色 |
| STAGE3 → STAGE4 | outline.json 产出（含至少 1 章） | 目标章有 Scene 规划 |
| STAGE4 → 完成 | 目标章写作完成 + Fact Guard 通过 | 章节文件存在 |

### 3.2 熔断降级

同一 Scene 的 Fact Guard 重试达到 3 次仍未通过：

1. **立即熔断：** 停止该 Scene 的自动重试循环
2. **降级处理：** 生成兼容性说明，列出未通过的检查项及原因
3. **用户通知：** 展示 Scene 内容和问题说明，用户选择：
   - 接受当前版本（标记 `force_passed`）
   - 手动修改文本
   - 跳过此 Scene（标记 `skipped`）
4. **记录归档：** 熔断事件记录到 progress.json

### 3.3 断点续写

Scene 级别粒度。每个 Scene 完成后写入 `.storyforge_checkpoint.json`（覆盖模式）：

```json
{
  "project_id": "proj_001",
  "checkpoint_time": "2026-06-10T14:30:00Z",
  "pipeline_stage": "STAGE4",
  "current_chapter": 1,
  "current_scene": 2,
  "snapshots": {
    "l0_runtime": {},
    "storyos_registries": {},
    "character_states": {}
  },
  "recovery_instructions": "从第1章第3幕开始"
}
```

恢复时 Conductor 读取 checkpoint，从断点继续。


## 四、INIT 阶段（简化版）

### 4.1 流程

两步式向导，约 2-3 分钟：

**Step 1 — 意图输入：**

用户输入一句话到一段话的故事想法，或选择"跳过，以后再说"使用默认设置。

**Step 2 — 基础参数：**

```
┌─────────────────────────────────────────┐
│         基础创作参数                      │
│                                          │
│  目标体裁：    [爽文 ▼]                   │
│  目标章数：    [1] 章（MVP 仅支持单章）    │
│  最低单章字数： [4000] 字                 │
│  创作语言：    [简体中文]                  │
│                                          │
│  [确认]                                  │
└─────────────────────────────────────────┘
```

### 4.2 产出物

`project.json`:

```json
{
  "project_id": "proj_001",
  "created_at": "2026-06-10T10:00:00Z",
  "title": "代码天才重生记",
  "initial_intent": "顶级程序员重生回到大学，发现世界的底层是一套可以修改的源代码",
  "constraints": {
    "total_chapters": 1,
    "min_words_per_chapter": 4000,
    "language": "zh_CN"
  },
  "genre": "cool_novel",
  "current_stage": "INIT"
}
```


## 五、STAGE 1 — 概念讨论（简化版）

### 5.1 设计说明

MVP 中 CreativeOS 不完整。Planner Agent 基于用户意图**单轮生成**概念设定和故事基因，不经过 WhatIf 树发散和创意画布交互。用户审阅后可要求重新生成，但不支持多轮深度讨论。

### 5.2 交互流程

1. Planner 读取 project.json 中的 `initial_intent`
2. 调用 LLM 生成 concept.json + story_dna.json
3. 展示给用户，用户选择：确认 / 重新生成 / 手动编辑

### 5.3 产出物

`concept.json`:

```json
{
  "project_id": "proj_001",
  "title": "代码天才重生记",
  "one_liner": "顶级程序员重生回到大学时代，发现这个世界存在代码层面的漏洞",
  "genre": "cool_novel",
  "premise": "主角林峰在2040年作为顶级AI工程师被杀，重生回到2024年大学时代...",
  "tone": "dark_balanced",
  "target_audience": "男频",
  "themes": ["科技伦理", "人性与力量"]
}
```

`story_dna.json`:

```json
{
  "id": "sdna_001",
  "core_contradiction": {
    "template": "能力×限制",
    "statement": "能看到并修改他人的源代码，但每次修改都在不可逆地侵蚀自己的记忆",
    "tension_level": "high"
  },
  "reader_hooks": {
    "main_mystery": "谁杀了主角？为什么这个世界有源代码漏洞？",
    "main_promise": "主角将在失去一切之前找到真相",
    "emotional_core": "在力量与人性之间的痛苦抉择"
  },
  "constraints": [
    "源代码修改必须有明确代价，不可无限制使用",
    "记忆侵蚀进度必须与剧情节点同步"
  ]
}
```


## 六、STAGE 2 — 世界观与角色（简化版）

### 6.1 设计说明

MVP 中仅创建**一个核心角色**和**最简世界观**。不包含成长工坊、多角色关系网络、势力格局深度设计。

### 6.2 交互流程

1. Planner 读取 concept.json + story_dna.json
2. 调用 LLM 生成 world.json + characters.json（单角色）
3. 展示给用户，用户选择：确认 / 重新生成 / 手动编辑

### 6.3 产出物

`world.json`（精简版）:

```json
{
  "project_id": "proj_001",
  "era": {
    "type": "contemporary_near_future",
    "start_year": 2024,
    "description": "表面是当代大学校园，实际存在底层代码层面操控现实的隐秘机制"
  },
  "primary_setting": {
    "name": "东海大学主校区",
    "description": "主角活动核心区域，源代码漏洞最密集的区域"
  },
  "power_system": {
    "name": "源代码编辑",
    "type": "概念系异能",
    "description": "能看到并编辑现实世界的底层代码",
    "core_rules": [
      "每次编辑消耗记忆，消耗量与修改幅度成正比",
      "同一对象被多次修改会产生'代码抗性'"
    ],
    "costs": {
      "type": "记忆侵蚀",
      "mechanism": "优先侵蚀远期记忆，被侵蚀的记忆不可恢复"
    },
    "ceilings": {
      "absolute_limit": "不可修改'世界漏洞的根源'本身",
      "per_day_limit": "每日使用次数与记忆侵蚀量相关"
    }
  },
  "naming_conventions": {
    "characters": "中文姓名",
    "locations": "现实地点用真实风格命名"
  }
}
```

`characters.json`（精简版，单角色）:

```json
{
  "project_id": "proj_001",
  "characters": [
    {
      "id": "char_001",
      "name": "林峰",
      "role": "protagonist",
      "appearance": {
        "age": 19,
        "features": "重生后外表是大学新生，眼神中偶尔流露出不符合年龄的沧桑"
      },
      "core_personality": {
        "beliefs": [
          "技术可以改变世界但人性才是根本",
          "有些事情比活着更重要"
        ],
        "desires": {
          "short_term": "适应重生生活，理解源代码能力",
          "deep": "找到杀害自己的凶手"
        },
        "fears": [
          "忘记自己是谁",
          "因为使用能力而伤害到无辜的人"
        ],
        "values": [
          "不利用能力操纵他人的自由意志"
        ]
      },
      "current_state": {
        "location": "东海大学主校区",
        "physical": "正常",
        "emotional": "冷静警觉",
        "relationships": {},
        "known_secrets": [],
        "unknown_to_character": ["sec_001"]
      },
      "voice_signature": {
        "speech_style": "克制、简短、逻辑性强。愤怒时反而更安静",
        "taboos": [
          "不会在公开场合暴露自己的能力",
          "不会主动伤害无辜者",
          "不会放弃已经承诺要保护的人"
        ]
      }
    }
  ]
}
```


## 七、STAGE 3 — 情节头脑风暴（简化版）

### 7.1 设计说明

MVP 仅规划**一章**的大纲，包含 Scene 拆分、每 Scene 的叙事目标、叙事资产预声明和 SF_LOG 预声明。

### 7.2 交互流程

1. Planner 读取所有前置产出物
2. 调用 LLM 生成 outline.json（仅含第一章的完整规划）
3. 展示给用户，用户选择：确认 / 重新生成 / 手动编辑

### 7.3 产出物

`outline.json`（精简版，单章）:

```json
{
  "project_id": "proj_001",
  "total_chapters": 1,
  "chapters": [
    {
      "chapter_number": 1,
      "title": "死亡回档",
      "summary": "林峰在2040年的实验室中被杀，醒来发现自己回到了2024年的大学开学典礼。他很快发现这不是普通的重生——他能看到每个人头顶的'源代码'。",
      "beats": [
        {"type": "setup", "description": "建立前世背景和死亡悬念"},
        {"type": "mini_payoff", "description": "重生+源代码能力的首次展示"},
        {"type": "cliffhanger", "description": "发现班上有一个人——源代码显示为'[数据损坏]'"}
      ],
      "emotional_arc": "困惑 → 震惊 → 警惕",
      "scene_plan": [
        {
          "scene_number": 1,
          "goal": "展示前世死亡场景，建立核心谜团'谁杀了我？'",
          "conflict": "林峰 vs 不明袭击者",
          "emotional_arc": "紧张 → 绝望 → 困惑（重生醒来）",
          "narrative_role": "cliffhanger_setup",
          "registry_changes": {
            "created": [
              {"type": "conflict", "id": "cf_001", "description": "林峰 vs 不明袭击者"},
              {"type": "mystery", "id": "mys_001", "description": "谁杀了林峰？"}
            ]
          },
          "required_logs": ["character_emotion", "registry_create"]
        },
        {
          "scene_number": 2,
          "goal": "展示重生后对源代码能力的初次发现",
          "conflict": "林峰 vs 对异常现实的困惑",
          "emotional_arc": "困惑 → 好奇 → 发现能力 → 震惊",
          "narrative_role": "major_reveal",
          "registry_changes": {
            "created": [
              {"type": "mystery", "id": "mys_002", "description": "源代码能力的来源和本质是什么？"}
            ]
          },
          "required_logs": ["knowledge_gain", "registry_create"]
        },
        {
          "scene_number": 3,
          "goal": "建立校园环境、引入关键配角、结尾建立悬念",
          "conflict": "林峰的新旧身份认知冲突",
          "emotional_arc": "试探 → 适应 → 警惕（发现异常同学）",
          "narrative_role": "setup + cliffhanger",
          "registry_changes": {
            "created": []
          },
          "required_logs": ["character_emotion"]
        }
      ]
    }
  ],
  "global_foreshadowing_map": [
    {
      "id": "fs_001",
      "name": "代码观察者的存在",
      "description": "暗示有一个组织在监控所有能看见源代码的人",
      "planted_chapter": 1,
      "linked_mystery": "mys_002",
      "status": "planted"
    }
  ]
}
```


## 八、STAGE 4 — 逐章写作循环（MVP 核心）

这是 MVP 的核心——完整的一章写作流水线。

### 8.1 每章内部循环（五步）

```
Step 1 — Scene 规划确认
    │
    ▼
Step 2 — 逐幕写作（嵌入 SF_LOG 标记）
    │
    ▼
Step 3 — Fact Guard 5 项硬检
    │   ├── 通过 → Step 4
    │   └── 不通过 → 重写（最多 3 次） → 第 3 次仍不通过 → 熔断降级
    ▼
Step 4 — StoryOS 更新（正则解析 SF_LOG → 更新注册表）
    │
    ▼
Step 5 — MemoryOS 更新 + checkpoint 写入
```

### 8.2 输入

| 输入项 | 来源 | 说明 |
|---|---|---|
| world.json + characters.json | STAGE 2 | 世界观和角色设定 |
| outline.json | STAGE 3 | 章节 Scene 规划 + 叙事资产预声明 |
| L0 运行时记忆 | MemoryOS | 当前章的即时状态快照 |
| L1 热记忆 | MemoryOS | 最近章节内容（MVP 中仅当前章的前置 Scene） |
| StoryOS 注册表 | StoryOS | 当前叙事资产状态 |

### 8.3 Step 1 — Scene 规划确认

Writer（Planner 角色）从 outline.json 中读取当前 Scene 的规划，展示给用户确认。MVP 中用户可选：确认执行 / 手动调整后执行。

### 8.4 Step 2 — 逐幕写作

Writer 调用 LLM 生成 Scene 文本，在合适位置嵌入 SF_LOG 标记。

**写作上下文组装顺序：** L0（运行时快照）→ characters.json 当前角色状态 → world.json 相关设定 → outline.json 本 Scene 规划 → `required_logs` 提醒 → L1（前几个 Scene 的内容）。

**SF_LOG 标记格式：** Markdown 注释语法，对读者不可见。

```
<!-- SF_LOG character_emotion char="林峰" emotion="警惕" intensity="高" -->
<!-- SF_LOG knowledge_gain char="林峰" content="能看到每个人头顶的源代码" -->
<!-- SF_LOG registry_create type="mystery" data='{"id":"mys_001","question":"谁杀了林峰？"}' -->
```

### 8.5 Step 3 — Fact Guard 5 项硬检

全部为确定性规则匹配，**零 LLM 调用**。

**检查 1 — 时间线连续性：**
- 角色不能同时出现在两个位置
- 同 Scene 内位置变化需要对应的 SF_LOG 标记（`character_location_change`）

**检查 2 — 角色状态一致性：**
- 角色不能展示 `unknown_to_character` 中的秘密
- 角色不能做出 `voice_signature.taboos` 中禁止的行为
- 检测方法：关键词 + 模式匹配

**检查 3 — 世界规则一致性：**
- 能力使用不超过 `power_system.ceilings` 中定义的上限
- 如有代价体系，代价必须在文本中体现或通过 SF_LOG 标记声明

**检查 4 — 叙事资产合规：**
- 引用的注册表条目必须存在（如 `mys_001` 已在注册表中注册）
- 不能将已解决的条目直接改回 active

**检查 5 — 变化标记完整性：**
- `required_logs` 中声明的每种标记类型必须在 Scene 文本中出现至少一次
- SF_LOG 标签格式必须通过严格正则校验

**重试与熔断：**

```
Fact Guard 检查
    │
    ├── 全部通过 → 进入 Step 4
    │
    └── 有未通过项 → 生成修改提示 → Writer 重写 → 再次检查
         │
         ├── 第 1-2 次重试 → 附带具体修改建议
         │
         └── 第 3 次仍不通过 → 熔断降级
              · 标记该 Scene 的问题列表
              · 生成兼容性说明
              · 用户决策：接受 / 手动修改 / 跳过
```

### 8.6 Step 4 — StoryOS 更新

StoryOS Agent 用正则表达式解析 SF_LOG 标记（确定性，零 LLM）。

**支持的 7 种标记类型（MVP）：**

| 标记类型 | 含义 | 正则匹配要点 |
|---|---|---|
| `character_emotion` | 角色情绪变化 | `char`, `emotion`, `intensity` |
| `character_relation_change` | 角色关系变化 | `char_a`, `char_b`, `status`, `trigger` |
| `character_location_change` | 角色位置变化 | `char`, `from`, `to` |
| `knowledge_gain` | 角色获取新知识 | `char`, `content`, `source` |
| `conflict_escalate` | 冲突升级 | `id`, `new_intensity`, `trigger` |
| `mystery_clue` | 谜团新线索 | `id`, `clue` |
| `registry_create` | 新叙事资产创建 | `type`(conflict/mystery/twist/goal), `data`(JSON) |

**处理流程：**

1. 正则提取所有 `<!-- SF_LOG ... -->` 标记
2. 解析每个标记的类型和参数
3. 对比 `registry_changes.created`：匹配成功 → 验证通过；预声明但未出现 → 记录为遗漏（已在 Fact Guard 第 5 项阻断）
4. 出现但未预声明的标记 → 接受（Writer 主动新增）
5. 更新对应注册表

### 8.7 Step 5 — MemoryOS 更新 + Checkpoint

- 更新 L0 运行时记忆（角色当前状态快照）
- 追加 L1 热记忆（当前 Scene 内容）
- 写入 `.storyforge_checkpoint.json`

### 8.8 产出物

- `chapters/001_死亡回档.md` — 章节正文（含 SF_LOG 标记）
- `progress.json` — 进度追踪
- StoryOS 注册表更新
- `.storyforge_checkpoint.json` — 断点快照


## 九、SF_LOG 变化标记机制

### 9.1 标记规范

所有 SF_LOG 标记采用统一格式：

```
<!-- SF_LOG <type> <key1>="value1" <key2>="value2" ... -->
```

### 9.2 七种标记类型详定义

**character_emotion — 角色情绪变化：**

```
<!-- SF_LOG character_emotion char="林峰" emotion="警惕" intensity="高" trigger="发现源代码异常" -->
```

参数：`char`（角色名）、`emotion`（情绪标签）、`intensity`（高/中/低）、`trigger`（触发原因，可选）

**character_relation_change — 角色关系变化：**

```
<!-- SF_LOG character_relation_change char_a="林峰" char_b="苏晓晓" status="裂痕" trigger="争执" -->
```

参数：`char_a`、`char_b`、`status`（新关系状态）、`trigger`

**character_location_change — 角色位置变化：**

```
<!-- SF_LOG character_location_change char="林峰" from="教室" to="实验室" -->
```

参数：`char`、`from`、`to`

**knowledge_gain — 角色获取新知识：**

```
<!-- SF_LOG knowledge_gain char="林峰" content="能看到每个人头顶的源代码" source="首次观察" -->
```

参数：`char`、`content`、`source`

**conflict_escalate — 冲突升级：**

```
<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="critical" trigger="发现证据" -->
```

参数：`id`（冲突 ID）、`new_intensity`、`trigger`

**mystery_clue — 谜团新线索：**

```
<!-- SF_LOG mystery_clue id="mys_001" clue="实验室监控录像被删除的时间与死亡时间吻合" -->
```

参数：`id`（谜团 ID）、`clue`

**registry_create — 新叙事资产创建：**

```
<!-- SF_LOG registry_create type="conflict" data='{"id":"cf_001","owner":"林峰","target":"不明袭击者","type":"survival","intensity":"critical"}' -->
```

参数：`type`（conflict / mystery / twist / goal）、`data`（JSON 字符串，包含该资产类型的必要字段）

### 9.3 正则解析

StoryOS Agent 使用以下正则提取所有 SF_LOG 标记：

```
<!-- SF_LOG (\w+) (.*?) -->
```

然后根据标记类型解析 `key="value"` 参数对。解析失败（格式错误）的标记在 Fact Guard 第 5 项被拦截。


## 十、StoryOS — 叙事资产注册表（简化版）

### 10.1 四类叙事资产

MVP 中仅追踪四类最关键的叙事资产：

| 资产类型 | 追踪的核心问题 | 关键字段 |
|---|---|---|
| **冲突（Conflict）** | 谁和谁在斗？斗到什么程度了？ | id, owner, target, type, intensity, status, created_chapter |
| **谜团（Mystery）** | 什么悬念吊着读者？线索够了吗？ | id, question, clues[], status, created_chapter |
| **反转（Twist）** | 什么颠覆在铺垫？ | id, description, foreshadowing_chapters[], status, created_chapter |
| **目标（Goal）** | 角色要达成什么？进展如何？ | id, owner, content, progress, status, created_chapter |

### 10.2 注册表存储

每种资产类型一个 JSON 文件，存储在 `projects/{id}/storyos/` 下：

```
projects/proj_001/storyos/
├── conflicts.json
├── mysteries.json
├── twists.json
└── goals.json
```

### 10.3 注册表更新

StoryOS Agent 在每 Scene 完成后：
1. 正则解析 SF_LOG 中的 `registry_create` 标记
2. 根据 `type` 字段将新资产写入对应注册表文件
3. 正则解析 SF_LOG 中的 `conflict_escalate`、`mystery_clue` 等标记
4. 更新对应资产的状态字段

MVP 中**不做级联传播**——四类资产独立更新，不触发跨资产自动关联。


## 十一、MemoryOS（简化版）

### 11.1 L0 运行时记忆

约 500 tokens，始终在 Writer 上下文顶部。包含：

```json
{
  "current_chapter": 1,
  "current_scene": 2,
  "character_states": {
    "char_001": {
      "name": "林峰",
      "location": "东海大学主校区·教室",
      "physical": "正常",
      "emotional": "警惕",
      "active_goals": [],
      "recent_knowledge_gains": ["能看到每个人头顶的源代码"]
    }
  },
  "open_conflicts": ["cf_001"],
  "open_mysteries": ["mys_001", "mys_002"]
}
```

### 11.2 L1 热记忆

当前章节已完成 Scene 的完整内容（不含 SF_LOG 标记后的注释部分）。MVP 中一章最多 6 个 Scene，L1 总量在可接受范围内。


## 十二、一致性保障系统（简化版）

### 12.1 Reviewer — Fact Guard 五项硬检

全部为确定性规则匹配，零 LLM 调用。详见第八节 Step 3。

### 12.2 连贯性评分（简化版）

每 Scene 完成后计算，用于判断是否需要重写：

| 维度 | 权重 | 扣分规则 |
|---|---|---|
| 时间线连续性 | 30% | 每处断层 -10 分 |
| 人物状态一致性 | 30% | 每处矛盾 -15 分 |
| 世界规则一致性 | 20% | 每处违规 -10 分 |
| 标记完整性 | 20% | 每遗漏一个 required_log -20 分 |

默认阈值：60 分（低于 60 分触发重写）。


## 十三、Style Engine（最简版）

MVP 仅内置一个体裁模板——**爽文（Cool Novel）**。以 YAML 文件存储：

```yaml
# style/cool_novel.yaml
name: "爽文"
avg_sentence_length: {min: 12, max: 25}
dialogue_ratio: 0.40
description_density: 0.15
hook_style: "cliffhanger_preferred"
min_beat_per_chapter: 3
hook_required: true

protagonist_taboos:
  - "禁止无故虐主超过300字"

forbidden_content:
  - "禁止元引用（如'这本小说''读者们'）"

beat_patterns:
  - ["setup", "mini_payoff", "cliffhanger"]
  - ["setup", "tension_build", "mini_payoff", "cliffhanger"]
```

Writer 在写作时将此模板作为风格指引注入上下文。


## 十四、Agent 协作体系（MVP）

MVP 包含 4 个 Agent：

| Agent | 职责 | 工作阶段 | 产出物 |
|---|---|---|---|
| **Planner** | 生成 concept / story_dna / world / characters / outline | STAGE 1-3 | concept.json, story_dna.json, world.json, characters.json, outline.json |
| **Writer** | 逐 Scene 写作，嵌入 SF_LOG 标记，遵循 Style Engine 约束 | STAGE 4 | 章节草稿（含 SF_LOG） |
| **Reviewer** | Fact Guard 5 项硬检 + 连贯性评分 | STAGE 4 每 Scene 完成后 | 检查结果（通过/不通过 + 修改建议） |
| **StoryOS Agent** | 正则解析 SF_LOG → 更新叙事资产注册表 | STAGE 4 每 Scene 完成后 | 注册表更新 |

Agent 之间的状态共享通过 Conductor 调度和结构化数据文件完成，Agent 之间不直接对话。


## 十五、Scene 写作流水线（完整时序）

```
┌──────────────────────────────────────────────────────────┐
│  STAGE 4 单 Scene 写作流水线                              │
│                                                          │
│  1. Conductor 读取 outline.json → 当前 Scene 规划         │
│                          │                               │
│  2. Writer 组装上下文：                                   │
│     L0 快照 → character 状态 → world 规则                 │
│     → Scene 规划(registry_changes + required_logs)        │
│     → Style 模板 → L1 前置 Scene 内容                     │
│                          │                               │
│  3. Writer 调用 LLM 生成 Scene 文本 + SF_LOG 标记         │
│                          │                               │
│  4. Reviewer 执行 Fact Guard 5 项硬检：                   │
│     ├── 时间线连续性                                      │
│     ├── 角色状态一致性                                    │
│     ├── 世界规则一致性                                    │
│     ├── 叙事资产合规                                      │
│     └── 变化标记完整性（含 SF_LOG 格式校验）               │
│                          │                               │
│     ├── 全部通过 ──────────────────┐                      │
│     │                              ▼                      │
│     │   5. StoryOS Agent 正则解析 SF_LOG                  │
│     │      → 提取 registry_create → 写入注册表            │
│     │      → 提取 conflict_escalate → 更新冲突状态         │
│     │      → 提取 mystery_clue → 追加谜团线索             │
│     │      → 提取 character_* → 更新角色状态              │
│     │                              │                      │
│     │   6. MemoryOS 更新：                                │
│     │      L0 快照更新（角色新状态）                       │
│     │      L1 追加（本 Scene 内容）                        │
│     │                              │                      │
│     │   7. Checkpoint 写入                                │
│     │                              │                      │
│     │   8. 下一 Scene 或完成                               │
│     │                                                     │
│     └── 不通过 ──→ 生成修改提示 ──→ Writer 重写            │
│                    （最多 3 次，第 3 次熔断降级）          │
└──────────────────────────────────────────────────────────┘
```


## 十六、项目文件结构（MVP）

```
projects/proj_001/
├── project.json                    项目基础配置
├── concept.json                    概念设定
├── story_dna.json                  故事基因
├── world.json                      世界观（精简版）
├── characters.json                 角色档案（单角色）
├── outline.json                    大纲（单章）
├── style_formula.yaml              风格配置
├── progress.json                   进度追踪
├── .storyforge_checkpoint.json     断点快照
├── storyos/
│   ├── conflicts.json              冲突注册表
│   ├── mysteries.json              谜团注册表
│   ├── twists.json                 反转注册表
│   └── goals.json                  目标注册表
└── chapters/
    └── 001_死亡回档.md             章节正文（含 SF_LOG 标记）
```


## 十七、Token 预算估算（MVP）

单章（3 个 Scene）的 LLM 调用估算：

| 调用 | 模型 | Token 估算 |
|---|---|---|
| STAGE 1 概念生成 | 单次 | ~3K |
| STAGE 2 世界观+角色生成 | 单次 | ~4K |
| STAGE 3 大纲生成 | 单次 | ~3K |
| STAGE 4 Scene 1 写作 | 单次 | ~8K |
| STAGE 4 Scene 1 Fact Guard | 零 LLM | 0 |
| STAGE 4 Scene 2 写作 | 单次 | ~8K |
| STAGE 4 Scene 2 Fact Guard | 零 LLM | 0 |
| STAGE 4 Scene 3 写作 | 单次 | ~8K |
| STAGE 4 Scene 3 Fact Guard | 零 LLM | 0 |
| StoryOS Agent 解析 | 零 LLM | 0 |
| **合计** | | **~34K tokens** |

> 对比 v1.4 完整版每章 ~117.5K tokens，MVP 约为完整版的 29%。Fact Guard 和 StoryOS 的零 LLM 设计在 MVP 阶段就已体现价值。


## 十八、MVP 验收标准

| 编号 | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | INIT → STAGE1 → STAGE2 → STAGE3 → STAGE4 线性走通，产出 1 章完整小说 | 端到端运行 |
| AC-2 | Scene 文本中包含格式正确的 SF_LOG 标记 | 正则匹配验证 |
| AC-3 | Fact Guard 至少捕获 1 处一致性错误（故意注入） | 注入角色位置矛盾，验证阻断 |
| AC-4 | Fact Guard 第 3 次重试失败后触发熔断降级，用户可选择 force_pass | 注入无法修复的错误 |
| AC-5 | StoryOS Agent 正则解析 SF_LOG 后正确更新注册表 JSON 文件 | 对比解析结果与预期注册表状态 |
| AC-6 | StoryOS Agent 零 LLM 调用 | 检查代码路径，确认无 LLM 调用 |
| AC-7 | 系统崩溃后能从 checkpoint 恢复到崩溃前的 Scene | 模拟崩溃后重新启动 |
| AC-8 | 单章总 token 消耗 < 50K | 记录实际消耗 |
| AC-9 | required_logs 中声明的标记缺失时 Fact Guard 第 5 项阻断 | 故意缺失标记 |
| AC-10 | SF_LOG 格式错误（如缺少引号）时 Fact Guard 第 5 项阻断 | 注入格式错误的标记 |


## 十九、MVP 到 v1.5 的升级路径

| MVP 限制 | v1.5 升级方向 |
|---|---|
| 单章写作 | 多章连续写作，章间状态传递 |
| 线性前进无回退 | Conductor 回退影响传播机制 |
| 单角色 | 多角色 + 关系网络 |
| 4 类叙事资产 | 7 类完整叙事资产 + 级联传播 |
| 无 ReaderOS | 7 项读者指标 + 体裁差异化阈值 |
| L0+L1 记忆 | 完整 MemoryOS L0-L4 |
| 5 项 Fact Guard | 6 项 Fact Guard（含语义预检结果复核） |
| 无 Narrative Guard | Narrative Guard 状态漂移检测 |
| 无 CreativeOS | CreativeOS 全部引擎 + 创意画布 |
| 单一爽文体裁 | 5 种体裁模板 + 风格沙盒 |
| 单模型 | 模型 Tier 策略（Tier 1/2/3） |
| 无跨项目复用 | Global Trope Pool + Global Idea Pool |
