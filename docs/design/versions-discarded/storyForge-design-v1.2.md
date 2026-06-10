# StoryForge 1.2 — 产品设计文档

> v1.2 变更：基于 v1.1 评审报告重新设计用户协作模式。将线性"审核门"升级为多轮"协作门"；增加创意画布、分支模拟、成长工坊、风格沙盒、创新豁免、章节评审会、灵感捕捉七大协作机制。所有系统模块的描述均为完整独立内容，不依赖之前版本。

---

## 核心理念

StoryForge 是一个**人机协作**的创意叙事操作系统。它不是替代作者，而是成为作者的创作伙伴——在创意构思时可以头脑风暴，在情节设计时可以推演对比，在内容写作时可以逐幕审阅和注入灵感。

三个核心目标：

| 核心目标 | 能力链 | 负责系统 |
|---|---|---|
| 构思足够发散、足够创新 | Creative Chain | CreativeOS + Creative Director |
| 剧情足够反转、足够抓人 | Narrative Chain | StoryOS + ReaderOS + Scene Engine + Style Engine |
| 角色/剧情高度一致 | Consistency Chain | MemoryOS + State Machines |

**设计哲学：** 系统负责骨架（一致性、节奏、读者体验），AI 负责血肉（创意发散、文字写作），**用户全程参与决策和灵感注入**。不是"输入→自动输出"的黑盒，而是"讨论→探索→选择→深入"的协作过程。

---

## 一、系统总体架构

```
                             用户层
        意图输入 · 风格样本 · 协作讨论 · 实时审阅
        灵感注入 · 分支选择 · 偏好标记 · 创新审批
                              │
              ┌───────────────▼───────────────┐
              │       Conductor 主控编排器       │
              │  阶段状态机 · 协作门调度 · 仲裁   │
              │  断点续写 · 熔断降级 · 灵感路由   │
              └───────────────┬───────────────┘
                              │
    ┌──────────────┬──────────┼──────────┬──────────────┐
    ▼              ▼          ▼          ▼              ▼
┌────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  ┌──────────┐
│Creative│  │ StoryOS  │  │ReaderOS│  │ MemoryOS │  │ Style    │
│  OS    │  │叙事资产管理│  │读者体验 │  │ 五层记忆  │  │ Engine   │
│创意引擎 │  └──────────┘  └────────┘  └──────────┘  │ 风格引擎  │
└────────┘                    │                     └──────────┘
         │                    │                          │
         ▼                    ▼                          ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────────┐
│  创意画布       │  │  分支模拟引擎   │  │  风格沙盒          │
│  WhatIf树交互   │  │  连锁影响推演   │  │  风格参数实时预览   │
│  偏好标记·剪枝  │  │  情节对比展示   │  │  创新豁免审批      │
└────────────────┘  └────────────────┘  └────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │         Agent 协作层            │
              │  创意总监 · 世界观师 · 角色师     │
              │  大纲师 · 写手 · 审稿 · 归档     │
              └───────────────────────────────┘
```

---

## 二、核心协作模式

### 2.1 协作门（Collaboration Gate）

系统在每个创作阶段提供五种协作模式，用户可根据需要选择。默认模式倾向于协作而非自动化。

| 模式 | 行为 | 适用场景 |
|---|---|---|
| **`discuss`** | Agent 展示成果，主动提出开放问题，提供 3-5 个备选方向供用户比较选择。用户可进行多轮对话、指定新方向要求重新生成、标记偏好分支。 | 创意构思、情节设计（默认推荐） |
| **`review`** | Agent 展示成果，用户逐项提出修改意见，Agent 针对性调整并展示调整后的变化。修改记录可追溯、可回滚。 | 大纲细化、角色调整 |
| **`approve`** | 快速确认模式，用户只需通过或拒绝。但拒绝后自动切入 `discuss` 模式而非终止。 | 作者对方向已有明确想法时 |
| **`live`** | 用户逐幕实时跟进写作过程，每幕完成后立即展示，用户可当场调整方向、重写或标记偏好。 | 内容写作阶段（默认推荐） |
| **`auto`** | 全自动执行，仅在连贯性评分低于阈值或熔断触发时通知用户。 | 用户充分信任系统的批量写作场景 |

**关键原则：每个阶段默认开启协作模式，用户可以选择简化，但不会被动地被排除在创作过程之外。**

### 2.2 灵感路由（Inspiration Router）

在任何阶段的任何讨论中产生的灵感，系统自动识别、分类、存储，确保不会遗失。

```
任何阶段的讨论内容
        │
        ▼
灵感路由器（自动运行，对用户透明）
  ├── 识别灵感信号："如果..."、"或者..."、"能不能..."、"我突然想到..."
  ├── 自动分类：
  │     ├── 新设定灵感 → Idea Pool（标记来源、上下文、关联故事基因）
  │     ├── 新剧情想法 → StoryOS 暂存区（标记关联章节和角色）
  │     ├── 新角色灵感 → 角色设计建议（标记关联故事基因）
  │     ├── 风格偏好   → Style Engine 偏好记录
  │     └── 写作灵感   → Scene 灵感池（在后续写作中供 Writer 参考）
  │
  └── 阶段切换时主动提醒：
        "在概念讨论阶段你产生了3个灵感，是否要在世界观构建中参考？"
```

用户在任何阶段都可以打开"灵感面板"，查看所有历史阶段积累的灵感，拖拽应用到当前阶段。灵感面板中的每一条都记录了产生阶段、原始上下文、关联的故事元素。

---

## 三、六阶段创作流水线

### 3.1 全流程概览

```
INIT ────→ STAGE1 ────→ STAGE2 ────→ STAGE3 ────→ STAGE4 ────→ STAGE5 ────→ STAGE6
项目初始化   概念讨论    世界观与     情节头脑     逐章写作     全书诊断     稿件导出
                       角色工坊     风暴                    与修订

输入:     输入:       输入:        输入:        输入:        输入:        输入:
用户初始   风格配置    Story DNA   Story DNA    全部前置     全部章节     全部章节
偏好      用户意图    world.json   world.json   数据         数据         风格配置
         参考文本                 characters   style_config
                                 .json        outline.json

输出:     输出:       输出:        输出:        输出:        输出:        输出:
project   concept     world       outline      chapter      diagnosis    .md
.json     .json       .json       .json        .md × N      _report      .pdf
          story_dna   characters  foreshadow   review       .json        .epub
          .json       .json       _map.json    _report
          creative                             .json × N
          _path                                progress
          _history                             .json
          .json
```

### 3.2 STAGE 1: 概念讨论 【默认模式：discuss】

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| 用户意图 | 用户直接输入 | 是 | 一句话到一段话的故事想法，可模糊可详细 |
| 风格配置 | Style Sandbox 产出 | 是 | 用户在风格沙盒中选定的风格参数组合（详见 4.4 节） |
| 参考文本 | 用户可选上传 | 否 | 已有章节、喜欢的作家作品，用于风格提炼和创意方向参考 |
| 项目初始偏好 | INIT 阶段 project.json | 是 | 目标总章数、最低单章字数、目标读者定位等基础约束 |

**交互流程：**
- Creative Director 驱动 CreativeOS 全部引擎，生成 3-5 个 Story DNA 变体并结构化展示
- 每个变体展示：核心矛盾设定、体裁融合方案、目标市场定位、四维新颖度评分明细
- 创意画布同步展示完整的 WhatIf 发散树，用户可在树中自由探索（点击展开、标记偏好、剪枝、以节点为新根重新发散、手动添加灵感节点、合并分支）
- 用户操作：选择变体 / 要求融合两个变体的优点 / 指定方向重新生成 / 深入某个创意分支
- 多轮讨论直到用户满意，所有中间创意和选择路径自动保存至 creative_path_history.json

**输出：**

`concept.json` — 概念设定：
```json
{
  "project_id": "proj_001",
  "title": "代码天才重生记",
  "one_liner": "顶级程序员重生回到大学时代，发现这个世界存在代码层面的漏洞",
  "genre": {
    "primary": "cool_novel",
    "fusion": ["mystery", "sci_fi"],
    "fusion_mechanism": "用程序员的系统化思维解构悬疑推理"
  },
  "premise": "主角林峰在2040年作为顶级AI工程师被杀，重生回到2024年大学时代。他发现这个世界的运行规则中存在'代码漏洞'——他能看到并修改他人的'源代码'，但每次修改都在侵蚀自己的记忆......",
  "tone": "dark_balanced",
  "target_audience": "男频",
  "total_chapters": 100,
  "min_words_per_chapter": 4000,
  "themes": ["科技伦理", "人性与力量", "重生与救赎"]
}
```

`story_dna.json` — 故事基因：
```json
{
  "id": "sdna_001",
  "core_contradiction": {
    "id": "cc_001",
    "template": "能力×限制",
    "statement": "能看到并修改他人的源代码，但每次修改都在不可逆地侵蚀自己的记忆",
    "tension_level": "high",
    "novelty_score": 85
  },
  "genre_fusion": {
    "primary_genre": "cool_novel",
    "fusion_genres": ["mystery", "sci_fi"],
    "mechanism": "用系统漏洞概念重构传统悬疑的线索发现过程",
    "distance_from_primary": 2,
    "novelty_bonus": 15
  },
  "selected_mutations": [
    {
      "operation": "fusion",
      "base_trope": "重生",
      "target_trope": "系统文",
      "result": "重生+源代码系统——系统不是外挂，而是以记忆为代价的能力"
    },
    {
      "operation": "inversion",
      "base_trope": "系统文",
      "result": "系统不是助力而是诅咒——每次使用都在消耗使用者的人性"
    }
  ],
  "key_whatif_nodes": [
    {"id": "wi_0032", "premise": "如果源代码修改会影响使用者自身？"},
    {"id": "wi_0041", "premise": "如果世界上不止主角一人能看到源代码？"}
  ],
  "reader_hooks": {
    "main_mystery": "谁杀了主角？为什么这个世界有源代码漏洞？",
    "main_promise": "主角将在失去一切之前找到真相并完成救赎",
    "emotional_core": "在力量与人性之间的痛苦抉择"
  },
  "novelty_scores": {
    "market_saturation": 0.35,
    "trope_similarity": 0.28,
    "contradiction_depth": 0.90,
    "discussion_potential": 0.72,
    "composite": 78
  },
  "hit_potential": 76,
  "constraints": [
    "源代码修改必须有明确代价，不可无限制使用",
    "记忆侵蚀进度必须与剧情节点同步，不可随意加速或减速",
    "世界漏洞的真相必须在最终卷揭示，不可提前泄露"
  ]
}
```

`creative_path_history.json` — 创意路径选择历史：
```json
{
  "initial_intent": "一个程序员重生后发现自己能看到世界的源代码",
  "total_discussion_rounds": 5,
  "steps": [
    {
      "step": 1,
      "action": "expand_node",
      "node_id": "wi_root_03",
      "node_premise": "如果代码修改有代价？",
      "reason": "单纯的能力太无聊，有代价才有张力"
    },
    {
      "step": 2,
      "action": "mark_preference",
      "node_id": "wi_0032",
      "reason": "记忆作为代价——最珍贵的恰恰是记忆"
    },
    {
      "step": 3,
      "action": "prune_branch",
      "node_id": "wi_root_07",
      "reason": "纯爽文方向，与想要的黑暗基调不符"
    },
    {
      "step": 4,
      "action": "merge_nodes",
      "node_ids": ["wi_0032", "wi_0041"],
      "reason": "多人能看到源代码+记忆代价=天然的竞争与联盟关系"
    },
    {
      "step": 5,
      "action": "select_final",
      "node_id": "wi_merged_001",
      "reason": "融合后的设定最完整，矛盾最深刻"
    }
  ],
  "preferences_marked": ["wi_0032", "wi_0041", "wi_0018"],
  "branches_pruned": ["wi_root_07", "wi_root_12", "wi_0055"],
  "final_path": ["root", "wi_root_03", "wi_0032", "wi_merged_001"]
}
```

---

### 3.3 STAGE 2: 世界观与角色工坊 【默认模式：discuss】

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| Story DNA | STAGE 1 story_dna.json | 是 | 核心矛盾、体裁融合方案、读者钩子、约束条件 |
| 创意路径历史 | STAGE 1 creative_path_history.json | 是 | 用户偏好标记、剪枝记录，帮助理解创作意图 |
| 概念设定 | STAGE 1 concept.json | 是 | 书名、基调、目标读者、主题列表 |

**2a. 世界观讨论：**
- Worldbuilder 基于 Story DNA 生成初始世界框架
- 用户与 Agent 讨论：势力格局是否合理、历史事件的逻辑自洽性、地理设定对剧情走向的影响
- 支持多轮调整直到满意

**2b. 角色成长工坊：**
- Character Designer 为每个核心角色生成完整档案和初始成长曲线方案
- 成长曲线包含：起点 → 关键转折点（此时仅绑定剧情事件类型，具体章节号在 STAGE 3 大纲确定后回填）→ 每次成长的代价（能力代价、心理代价、人际关系代价）→ 可能的低谷或倒退 → 终点
- 用户与 Agent 讨论成长节奏、代价充分性、与剧情高潮的同步程度
- 成长阶段与 StoryOS 的叙事资产（冲突、反转、揭秘）显式绑定

**输出：**

`world.json` — 世界观设定：
```json
{
  "project_id": "proj_001",
  "era": {
    "type": "contemporary_near_future",
    "start_year": 2024,
    "description": "表面是当代大学校园，实际存在底层代码层面操控现实的隐秘机制"
  },
  "geography": {
    "primary_setting": "东海大学",
    "main_locations": [
      {
        "id": "loc_001",
        "name": "东海大学主校区",
        "type": "核心舞台",
        "description": "表面普通的985高校，实际是源代码漏洞最密集的区域",
        "significance": "主角活动核心区域，漏洞集中地，各方势力交汇点"
      },
      {
        "id": "loc_002",
        "name": "源层空间",
        "type": "异空间",
        "description": "通过源代码漏洞可进入的底层现实编辑空间",
        "significance": "能力使用和真相揭示的主要场景",
        "entry_conditions": "需要消耗记忆碎片作为进入代价"
      }
    ],
    "travel_rules": "现实世界地点之间可自由移动。进入源层空间需要在特定'漏洞点'且消耗记忆碎片"
  },
  "power_system": {
    "name": "源代码编辑",
    "type": "概念系异能",
    "description": "能看到并编辑现实世界的底层代码——人的行为逻辑、物体的物理属性、事件的概率",
    "stages": [
      {"rank": "一阶·代码阅读", "capability": "只能查看他人源代码，无法修改"},
      {"rank": "二阶·局部编辑", "capability": "可修改单一对象的单一属性"},
      {"rank": "三阶·系统重构", "capability": "可修改复数对象间的关联规则"}
    ],
    "core_rules": [
      "每次编辑消耗记忆，消耗量与修改幅度成正比",
      "被修改者无法感知被修改，但可能产生'既视感'",
      "同一对象被多次修改会产生'代码抗性'，需要递增记忆消耗"
    ],
    "costs": {
      "type": "记忆侵蚀",
      "mechanism": "优先侵蚀远期记忆 → 中期记忆 → 近期记忆 → 核心人格记忆",
      "irreversibility": "被侵蚀的记忆不可恢复"
    },
    "ceilings": {
      "absolute_limit": "不可修改'世界漏洞的根源'本身——这是系统级保护",
      "per_day_limit": "能力的每日使用次数与当日记忆侵蚀量相关，超过安全阈值将触发强制休眠"
    }
  },
  "factions": [
    {
      "id": "fac_001",
      "name": "代码观察者",
      "type": "隐秘组织",
      "goal": "维护源代码世界的稳定，阻止大规模编辑",
      "strength": "组织庞大、历史悠久、掌握源层空间深层知识",
      "attitude_toward_protagonist": "初期监视，中期接触，后期视主角行为决定敌友",
      "key_members": ["char_003"]
    },
    {
      "id": "fac_002",
      "name": "漏洞利用者",
      "type": "松散联盟",
      "goal": "利用源代码漏洞谋取个人利益",
      "strength": "成员分散但数量众多，能力使用激进",
      "attitude_toward_protagonist": "视主角为竞争威胁或可利用资源"
    }
  ],
  "history": [
    {
      "event": "源代码漏洞首次出现",
      "timeline": "约30年前",
      "impact": "一小部分人开始发现自己能'看到'现实的代码层"
    },
    {
      "event": "代码观察者成立",
      "timeline": "约25年前",
      "impact": "建立了源代码使用的隐性规则和监管体系"
    }
  ],
  "naming_conventions": {
    "characters": "中文姓名，核心角色姓名有隐喻（林峰=临风，苏晓晓=苏醒的晓光）",
    "locations": "现实地点用真实风格命名，异空间用抽象概念命名"
  },
  "alias_mapping": {
    "林峰": ["峰哥", "小林", "源代码幽灵"],
    "苏晓晓": ["晓晓", "苏同学"],
    "代码观察者": ["观察者", "守护者", "源层警察"]
  }
}
```

`characters.json` — 角色档案（含成长曲线）：
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
          "mid_term": "找到杀害自己的凶手",
          "deep": "在能力侵蚀一切之前，找到拯救自己的方法"
        },
        "fears": [
          "忘记自己是谁",
          "因为使用能力而伤害到无辜的人"
        ],
        "values": [
          "不利用能力操纵他人的自由意志",
          "不放弃任何可以救赎的人"
        ]
      },
      "current_state": {
        "location": "东海大学主校区",
        "physical": "正常",
        "emotional": "冷静警觉",
        "relationships": {},
        "active_goals": ["goal_001"],
        "known_secrets": ["sec_001"],
        "unknown_to_character": ["sec_003", "sec_005"]
      },
      "ability_progression": [
        {
          "stage": 1,
          "name": "一阶·代码阅读",
          "chapter_range": [1, 25],
          "capabilities": ["查看他人源代码（行为倾向、当前状态、能力值）"],
          "limits": {"max_modifications_per_day": 0, "memory_cost_per_use": 0},
          "cost": "仅阅读不消耗记忆，但长时间阅读会导致头痛和精神疲劳"
        },
        {
          "stage": 2,
          "name": "二阶·局部编辑",
          "chapter_range": [26, 60],
          "capabilities": [
            "修改单一对象的单一属性（如让某人忽略某事、增加物品的某一特性）"
          ],
          "limits": {"max_modifications_per_day": 3, "max_attribute_change": 0.3},
          "cost": "每次编辑消耗约0.5%的记忆总量，优先侵蚀远期记忆"
        },
        {
          "stage": 3,
          "name": "三阶·系统重构",
          "chapter_range": [61, 100],
          "capabilities": [
            "修改复数对象间的关联规则",
            "创建小范围的'代码域'——在域内临时改写现实规则"
          ],
          "limits": {"max_modifications_per_day": 1, "domain_duration_seconds": 60},
          "cost": "每次使用消耗2-5%记忆总量，可能侵蚀中期甚至近期记忆"
        }
      ],
      "growth_curve": {
        "start": {
          "chapter": 1,
          "state": "重生醒来，发现源代码能力，困惑而警惕。人格完整，记忆清晰，对前世遭遇的愤怒是主要驱动力"
        },
        "turning_points": [
          {
            "id": "tp_001",
            "chapter": null,
            "trigger_event_type": "world_truth_revealed",
            "trigger_description": "发现源代码修改会侵蚀记忆的真相",
            "ability_change": "从一阶向二阶过渡的契机——意识到必须主动编辑才能保护自己和他人",
            "psychological_cost": "第一次面对'使用能力=失去自己'的残酷等式",
            "relationship_impact": "对能信任的人更加依赖，同时也更加恐惧连累他人"
          },
          {
            "id": "tp_002",
            "chapter": null,
            "trigger_event_type": "betrayal_experienced",
            "trigger_description": "被最信任的人背叛——此人一直在利用主角的源代码编辑来达成自己的目的",
            "ability_change": "能力被动突破至三阶——在极端情绪下打开了不应打开的能力上限",
            "psychological_cost": "信任体系崩塌，开始怀疑所有关系的真实性。记忆侵蚀加速，开始遗忘前世的关键细节",
            "relationship_impact": "与所有角色的关系重新洗牌"
          },
          {
            "id": "tp_003",
            "chapter": null,
            "trigger_event_type": "personal_identity_crisis",
            "trigger_description": "发现自己是'源代码漏洞'的源头——自己的重生就是最大的漏洞本身",
            "ability_change": "三阶能力的完全掌控——接受自己的本质后，能力不再被动侵蚀而是主动可控",
            "psychological_cost": "接受自己'不是人类'的本质，放弃回归正常人生的幻想",
            "relationship_impact": "与代码观察者达成新的共生关系，与爱人的关系面临'身份鸿沟'的终极考验"
          }
        ],
        "valleys": [
          {
            "chapter": null,
            "description": "背叛事件后的人格崩塌期。短暂失去使用能力的意愿，出现自我毁灭倾向",
            "duration_chapters": 5
          }
        ],
        "end": {
          "chapter": 100,
          "state": "接受了自己作为'源代码漏洞化身'的身份。不再追求消除漏洞，而是追求重建世界的平衡——让源代码层与人类现实和平共存。部分记忆永久失去，但获得了新的记忆和关系"
        }
      },
      "voice_signature": {
        "speech_style": "克制、简短、逻辑性强。愤怒时反而更安静。前世是工程师，习惯用'这里的问题是...'、'逻辑上...'开头的分析式表达",
        "thought_pattern": "先分析利弊再决策，极少冲动。但随着记忆侵蚀加剧，偶尔出现感性的、不符合理性分析的决策——这成为角色变化的重要信号",
        "taboos": [
          "不会在公开场合暴露自己的能力",
          "不会主动伤害无辜者，即使对自己有利",
          "不会放弃已经承诺要保护的人"
        ]
      }
    }
  ]
}
```

> **说明：** growth_curve 中的 `chapter` 字段在 STAGE 2 中为 `null`，在 STAGE 3 情节头脑风暴完成后由 Outliner 回填具体章节号，确保成长节点与剧情里程碑精确绑定。

---

### 3.4 STAGE 3: 情节头脑风暴 【默认模式：discuss】

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| Story DNA | STAGE 1 story_dna.json | 是 | 核心矛盾、读者钩子、约束条件 |
| 世界观 | STAGE 2 world.json | 是 | 时代、地理、能力体系、势力格局 |
| 角色档案 | STAGE 2 characters.json | 是 | 含成长曲线（转折点事件类型已定义但章节号待回填） |

**交互流程：**
- Outliner 基于输入生成初始大纲，包含分卷分章细纲、每章核心爽点/反转/情感弧、全局伏笔映射表
- Agent 主动提出开放问题引导讨论："哪几卷的反转密度需要加强？"、"读者在哪些节点最可能疲劳？"、"有没有角色需要提前或延后出场？"
- 用户可随时触发分支模拟："如果把第 30 章的反派揭示提前到第 20 章会怎样？"——系统推演连锁影响并展示修改前 vs 修改后对比
- 伏笔密度、反转节奏、张力曲线均可与 Agent 讨论调整
- 大纲确定后，系统自动回填 characters.json 中成长曲线各转折点的具体章节号

**输出：**

`outline.json` — 大纲（含伏笔映射 + 成长绑定）：
```json
{
  "project_id": "proj_001",
  "total_volumes": 5,
  "total_chapters": 100,
  "volumes": [
    {
      "volume_number": 1,
      "title": "第一卷·源代码觉醒",
      "chapter_range": [1, 20],
      "summary": "林峰重生回到大学，发现源代码能力的存在，初步掌握代码阅读能力。在校园生活中结识关键盟友，同时发现并非唯一能看见源代码的人。本卷以第一次源代码编辑作为高潮——林峰为救苏晓晓而被迫使用编辑能力，首次体验到记忆侵蚀的代价。",
      "reader_experience_goal": "建立对能力的理解和对角色的情感投入，结尾让读者意识到'代价'的存在，产生对后续的期待",
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
          "narrative_role": "能力介绍+世界观入口+核心悬念建立",
          "scene_plan": [
            {
              "scene_number": 1,
              "goal": "展示前世死亡场景，建立核心谜团'谁杀了我？'",
              "conflict": "林峰 vs 不明袭击者",
              "emotional_arc": "紧张 → 绝望 → 困惑（重生醒来）",
              "narrative_role": "cliffhanger_setup"
            },
            {
              "scene_number": 2,
              "goal": "展示重生后对源代码能力的初次发现",
              "conflict": "林峰 vs 对异常现实的困惑",
              "emotional_arc": "困惑 → 好奇 → 发现能力 → 震惊",
              "narrative_role": "major_reveal"
            },
            {
              "scene_number": 3,
              "goal": "建立校园环境、引入关键配角、结尾建立悬念",
              "conflict": "林峰的新旧身份认知冲突",
              "emotional_arc": "试探 → 适应 → 警惕（发现异常同学）",
              "narrative_role": "setup + cliffhanger"
            }
          ],
          "narrative_asset_changes": {
            "created": [
              {"type": "conflict", "id": "cf_001", "description": "林峰 vs 不明袭击者（前世）"},
              {"type": "mystery", "id": "mys_001", "description": "谁杀了林峰？"},
              {"type": "mystery", "id": "mys_002", "description": "源代码能力的来源和本质是什么？"}
            ],
            "updated": []
          },
          "foreshadowing_operations": [
            {"action": "plant", "foreshadowing_id": "fs_001", "description": "伏笔·代码观察者的存在——班上有人源代码异常"}
          ]
        }
      ]
    }
  ],
  "global_foreshadowing_map": [
    {
      "id": "fs_001",
      "name": "代码观察者的存在",
      "description": "从第一章开始暗示有一个组织在监控所有能看见源代码的人",
      "planted_chapter": 1,
      "clue_chapters": [1, 7, 15, 28],
      "planned_reveal_chapter": 48,
      "linked_mystery": "mys_002",
      "linked_twists": ["tw_002"],
      "linked_characters": ["char_001", "char_003"],
      "status": "planted"
    },
    {
      "id": "fs_002",
      "name": "记忆侵蚀的不可逆性",
      "description": "从主角第一次编辑开始，逐步暗示被侵蚀的记忆不能恢复——这将在后期成为核心悲剧来源",
      "planted_chapter": 22,
      "clue_chapters": [22, 35, 50],
      "planned_reveal_chapter": 72,
      "linked_mystery": "mys_002",
      "linked_twists": ["tw_004"],
      "linked_characters": ["char_001"],
      "status": "planted"
    }
  ],
  "growth_bindings": [
    {
      "character_id": "char_001",
      "turning_point_id": "tp_001",
      "chapter": 26,
      "narrative_event": "林峰首次被迫使用代码编辑救苏晓晓，随后发现记忆出现了空白——一段大学记忆消失了",
      "event_type": "world_truth_revealed",
      "linked_storyos_assets": {
        "twists": ["tw_001"],
        "conflicts": ["cf_003"],
        "reveals": ["rev_001"]
      }
    },
    {
      "character_id": "char_001",
      "turning_point_id": "tp_002",
      "chapter": 58,
      "narrative_event": "苏晓晓揭示自己接近林峰的真正目的——代码观察者派她来监视和评估他",
      "event_type": "betrayal_experienced",
      "linked_storyos_assets": {
        "twists": ["tw_005"],
        "conflicts": ["cf_007"],
        "reveals": ["rev_004"]
      }
    },
    {
      "character_id": "char_001",
      "turning_point_id": "tp_003",
      "chapter": 82,
      "narrative_event": "林峰在源层空间最深处发现真相——自己的重生本身就是源代码漏洞的源头",
      "event_type": "personal_identity_crisis",
      "linked_storyos_assets": {
        "twists": ["tw_008"],
        "reveals": ["rev_010"],
        "mysteries": ["mys_001", "mys_002"]
      }
    }
  ]
}
```

---

### 3.5 STAGE 4: 逐章写作循环 【默认模式：live】

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| 全部前阶段产出 | STAGE 1-3 | 是 | Story DNA、世界观、角色档案（含已回填章节的成长曲线）、大纲、伏笔映射、成长绑定 |
| 风格配置 | style_formula.yaml | 是 | 体裁模板 + 写作公式参数 + 禁忌约束列表 |
| 前置章节 | STAGE 4 已完成的各章 | 增量 | 第 N 章的写作依赖第 1 至 N-1 章的完整内容 |
| 叙事资产当前状态 | StoryOS 七项注册表 | 增量 | 每章更新后的当前状态——哪些冲突活跃、哪些谜团已有线索、哪些伏笔待揭示 |
| 角色当前状态 | MemoryOS L0 | 增量 | 角色当前位置、身体状态、情绪状态、关系最新状态 |
| 读者指标当前值 | ReaderOS | 增量 | 上一章结束后的七项读者指标，用于本章节奏调控 |

**每章内部循环（六步）：**

**Step 1 — Scene 规划评审（用户可介入）：**
Writer 规划本章 3-6 个 Scene，每个 Scene 声明：
```json
{
  "chapter": 1,
  "scenes": [
    {
      "scene_number": 1,
      "goal": "本幕叙事目标",
      "conflict": "当前矛盾的即时表现形式",
      "emotional_arc": "起点情绪 → 转折事件 → 终点情绪",
      "narrative_role": "mini_payoff / major_payoff / setup / transition / cliffhanger",
      "registry_changes": {
        "created": [{"type": "conflict", "data": {...}}],
        "updated": [{"id": "cf_001", "field": "intensity", "new_value": "critical"}]
      },
      "required_logs": ["character_emotion", "conflict_escalate"],
      "innovation_pass_requested": false
    }
  ]
}
```
用户可：调整 Scene 顺序、增删 Scene、指定某 Scene 风格实验方向、为某 Scene 预设创新豁免。

**Step 2 — 逐幕写作 + 用户实时跟进：**
每幕写完后立即展示，不等整章完成。用户选择：接受 / 重写（附方向） / 自己修改（系统自动建议 SF_LOG 调整） / 标记偏好 / 申请创新豁免。

**Step 3 — 自动审查：**
Reviewer 执行三层审稿（详见 12.3 节），不通过则打回重写（最多 3 次，第 3 次触发熔断降级通知用户）。

**Step 4 — 系统更新：**
StoryOS Agent 扫描 SF_LOG → 对比预声明 → 更新七类资产 → 级联传播。MemoryOS L0/L1/L2/L4 增量更新。ReaderOS 重算七项指标。

**Step 5 — 章节评审会（用户可介入）：**
Reviewer 展示质量摘要，主动提问引导讨论。用户可快速通过或深入讨论。

**输出（每章累积产出）：**

`chapters/NNN_title.md` — 章节正文（含 SF_LOG 标记）：
```markdown
# 第1章 死亡回档

<!-- SF_LOG character_emotion char="林峰" emotion="困惑" intensity="high" trigger="重生醒来" -->

林峰睁开眼睛的瞬间，以为自己还在实验室里......

<!-- SF_LOG registry_create type="conflict" data='{"id":"cf_001","owner":"林峰","target":"不明袭击者","type":"revenge","intensity":"critical","created_chapter":1}' -->

<!-- SF_LOG mystery_clue id="mys_001" clue="实验室终端日志显示最后访问者是内部人员" -->

<!-- SF_LOG character_emotion char="林峰" emotion="警惕" intensity="high" trigger="发现源代码异常的同学" -->
```

`review_report.json` — 每章审稿报告：
```json
{
  "chapter": 1,
  "timestamp": "2026-06-10T10:30:00Z",
  "coherence_score": 85,
  "dimension_scores": {
    "timeline_continuity": 22,
    "character_state_consistency": 20,
    "foreshadowing_completeness": 16,
    "world_rules_compliance": 18,
    "taboo_compliance": 9
  },
  "reader_metrics": {
    "curiosity": 72,
    "tension": 55,
    "satisfaction": 35,
    "frustration": 20,
    "fatigue": 30,
    "addiction": 68,
    "discussion_potential": 62
  },
  "fact_guard": {
    "passed": true,
    "retries": 1,
    "circuit_breaker_triggered": false,
    "issues": [
      {
        "check": "required_logs",
        "severity": "blocking",
        "message": "缺少 knowledge_gain 标记：林峰发现源代码能力的日志未嵌入",
        "resolution": "第2次重写时已补充"
      }
    ]
  },
  "narrative_guard": {
    "suggestions": [
      "第2幕到第3幕的过渡略快，建议增加1-2句环境描写作为缓冲",
      "配角李明的出场缺少外貌特征描写，读者难以建立形象"
    ],
    "state_drift_warnings": []
  },
  "style_guard": {
    "taboo_violations": [],
    "style_deviation_notes": [
      {"scene": 3, "note": "句长分布偏长（均句28字），高于爽文体裁的15-25字范围", "severity": "info"}
    ],
    "innovation_passes_used": []
  },
  "tension_curve": {
    "chapter_start": 45,
    "chapter_end": 62,
    "peak_position": "scene_3",
    "trend": "rising"
  },
  "anomalies": [],
  "chapter_review_discussion": {
    "user_participated": true,
    "user_marked_preferences": ["第3幕林峰发现异常同学的写法"],
    "inspirations_captured": [
      {"content": "苏晓晓的源代码异常表现——是否可以作为后续她的隐藏身份伏笔？", "routed_to": "storyos_staging"}
    ]
  }
}
```

`progress.json` — 进度追踪（持续更新）：
```json
{
  "project_id": "proj_001",
  "current_stage": "STAGE4",
  "current_chapter": 42,
  "completed_chapters": 41,
  "total_words": 178000,
  "average_words_per_chapter": 4341,
  "average_coherence_score": 84.5,
  "total_rewrites": 12,
  "circuit_breaker_triggers": 1,
  "cost_tracking": {
    "total_tokens_used": 4820000,
    "total_cost_usd": 48.2,
    "average_cost_per_chapter": 1.18
  },
  "chapter_history": [
    {"chapter": 1, "words": 4250, "coherence": 85, "rewrites": 1, "status": "completed"},
    {"chapter": 2, "words": 4380, "coherence": 88, "rewrites": 0, "status": "completed"}
  ]
}
```

StoryOS 七项注册表更新（详见 7.2-7.3 节，每章写完后由 StoryOS Agent 自动更新）。

---

### 3.6 STAGE 5: 全书诊断与修订 【默认模式：review】

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| 全部章节 | STAGE 4 chapters/ | 是 | 所有已完成章节的正文 |
| 全部审稿报告 | STAGE 4 review_report.json × N | 是 | 每章的连贯性评分、读者指标历史、异常记录 |
| 进度追踪 | STAGE 4 progress.json | 是 | 整体统计数据 |
| 大纲 + 伏笔映射 | STAGE 3 outline.json | 是 | 用于对比检测——实际写了什么 vs 计划写什么 |
| 角色档案 | STAGE 2 characters.json | 是 | 用于对比检测角色一致性 |
| 叙事资产注册表 | StoryOS 当前状态 | 是 | 用于检测逾期伏笔、未规划新伏笔 |

**诊断维度与交互流程：**
系统自动扫描五大类问题，按 P0/P1/P2 分级展示。用户拥有最终决策权——确认修复、跳过（"这个 P0 问题恰恰是我要的效果"）、或要求 Agent 提供替代修复方案。

**输出：**

`diagnosis_report.json` — 全书诊断报告：
```json
{
  "project_id": "proj_001",
  "diagnosis_date": "2026-07-15",
  "total_chapters_analyzed": 100,
  "summary": {
    "total_issues": 47,
    "P0_blocking": 2,
    "P1_quality": 18,
    "P2_optimization": 27
  },
  "issues": {
    "timeline_breaks": [
      {
        "id": "diag_tb_001",
        "priority": "P0",
        "chapter": 42,
        "description": "角色在第40章左臂骨折（chapter_040.md SF_LOG character_physical_change），但第42章第3幕用手格挡攻击且未提及伤势",
        "affected_characters": ["char_004"],
        "fix_suggestion": "在第42章第3幕的格挡处增加伤势描写，或插入 SF_LOG 标记说明骨折已愈合（需前文有治疗场景支撑）",
        "user_decision": null,
        "status": "pending"
      },
      {
        "id": "diag_tb_002",
        "priority": "P0",
        "chapter": 78,
        "description": "角色在第75章结尾已前往北京，第78章开头出现在东海大学，中间无位移标记",
        "affected_characters": ["char_001"],
        "fix_suggestion": "在第78章开头或第76-77章补充位移说明（高铁/航班/能力传送等）",
        "user_decision": null,
        "status": "pending"
      }
    ],
    "character_inconsistencies": [
      {
        "id": "diag_ci_001",
        "priority": "P1",
        "chapter": 35,
        "description": "林峰在第35章直接相信了陌生人的情报未做验证，这与 voice_signature 中'先分析再决策'的思维模式不符",
        "affected_characters": ["char_001"],
        "fix_suggestion": "增加林峰私下验证情报的简短场景，或在对话中加入他分析判断的过程",
        "user_decision": null,
        "status": "pending"
      }
    ],
    "pacing_issues": [
      {
        "id": "diag_pc_001",
        "priority": "P1",
        "chapter_range": [52, 55],
        "description": "连续4章无 mini_payoff，仅在第55章结尾有一个大爽点。中间3章读者可能流失",
        "affected_chapters": [52, 53, 54, 55],
        "tension_impact": "第52-54章张力从68降至42",
        "fix_suggestion": "在第53章中段插入一个知识获取型 mini_payoff（如发现一条关键线索），在第54章插入一个关系推进型 mini_payoff",
        "user_decision": null,
        "status": "pending"
      }
    ],
    "redundancy": [
      {
        "id": "diag_rd_001",
        "priority": "P2",
        "description": "短语'源代码层面'在全书出现 237 次，其中第30-50章密度异常高（平均每章 4.2 次）",
        "fix_suggestion": "在第30-50章中替换约40%的出现为'底层规则'、'代码层'、'源层'等替代表达",
        "user_decision": null,
        "status": "pending"
      }
    ],
    "foreshadowing_tracking": [
      {
        "id": "diag_fs_001",
        "priority": "P1",
        "description": "伏笔'师父的真实身份'（fs_005）计划第58章揭示，至今第100章仍未揭示且无后续线索",
        "foreshadowing_id": "fs_005",
        "planned_reveal_chapter": 58,
        "current_status": "foreshadowing",
        "fix_suggestion": "确认是否遗漏了揭示——如果确实未写，需要在全书修订中补充揭示章节；如果有意延后，需要更新伏笔映射表中的 planned_reveal_chapter 并补充中间线索",
        "user_decision": null,
        "status": "pending"
      },
      {
        "id": "diag_fs_002",
        "priority": "P2",
        "description": "写作中新产生的伏笔'苏晓晓的家族背景'（fs_017，首次出现在第63章）未在大纲的 global_foreshadowing_map 中注册",
        "foreshadowing_id": "fs_017",
        "fix_suggestion": "补充注册到伏笔映射表，并检查该伏笔是否已有足够的线索支撑和计划揭示章节",
        "user_decision": null,
        "status": "pending"
      }
    ]
  }
}
```

`diagnosis_report.json` 中的 `user_decision` 和 `status` 字段在 STAGE 5 修订过程中由用户逐步填充。修订完成后 `status` 变为 `fixed` / `skipped_by_user` / `alternative_applied`。

---

### 3.7 STAGE 6: 稿件导出

**输入：**

| 输入项 | 来源 | 必选 | 说明 |
|---|---|---|---|
| 全部章节 | STAGE 4-5 chapters/ | 是 | 经过 STAGE 5 修订的最终版本 |
| 风格配置 | style_formula.yaml | 是 | 影响 PDF/EPUB 的排版参数（字体、行距、段间距等） |
| 项目元数据 | concept.json | 是 | 书名、作者名、简介——用于生成封面和元数据页 |

**输出格式：**

| 格式 | 说明 | 输出文件 |
|---|---|---|
| **Markdown** | 源格式，保留 SF_LOG 标记（可选项：是否导出标记） | `export/proj_001.md`（单文件合并）或 `export/proj_001/`（分章目录） |
| **PDF** | 排版成品，自动应用风格配置中的版式参数，去除 SF_LOG 标记 | `export/proj_001.pdf` |
| **EPUB** | 电子书格式，支持目录导航、元数据嵌入、封面图 | `export/proj_001.epub` |

导出时自动执行：去除所有 `<!-- SF_LOG ... -->` 标记（除非用户选择保留）、合并分章为完整稿件、生成目录页、嵌入元数据（书名、作者、简介、创作日期）。

---

## 四、七大协作机制详设

### 4.1 创意画布（Creative Canvas）

创意画布将 CreativeOS 的 WhatIf 发散树变成可交互的探索空间，替代传统"输入→输出"的黑盒模式。

用户输入意图后，CreativeOS 生成 WhatIf 创意树（默认 depth=3、breadth=4，最多 84 个节点）。创意画布将完整树结构可视化展示，每个节点显示其前提假设、矛盾强度、新颖度评分、市场定位。

用户在画布中的操作：
- **点击展开：** 点击任意节点查看详细设定——核心矛盾是什么、适合什么体裁、新颖度评分明细
- **偏好标记（♡）：** 标记喜欢的节点，系统将偏好特征注入后续发散，影响变异方向
- **剪枝（✂）：** 移除不感兴趣的分支，清理创意空间，让剩余分支获得更多关注
- **以节点为新根发散（⟳）：** 选中一个节点，要求系统以此为新起点再发散一层
- **手动添加节点（⊕）：** 用户直接输入自己的灵感，作为新节点加入树中
- **合并分支（⊞）：** 选中两个节点，要求 Genre Fusion Engine 尝试将它们融合为一个新创意

每次操作后系统重新计算各节点的新颖度评分。用户满意后选定一条路径（或自定义路径），系统据此生成最终 Story DNA。

产出不仅是 Story DNA，还包括**创意路径选择历史**——用户从哪个节点走到哪个节点、每一步的选择原因——这对后续阶段理解创作意图有重要参考价值。

### 4.2 分支模拟引擎（Branch Simulation）

分支模拟引擎让用户在情节设计阶段可以安全地探索"如果我改了这个会怎样"，而无需真的修改大纲。

用户在 outline 的任意位置提出修改假设。系统首先识别修改的影响范围——受影响的章号、角色、伏笔、冲突。然后推演连锁影响：张力曲线的预期变化（修改前 vs 修改后对比图）、受影响的伏笔列表（哪些需重新规划、哪些可能断裂）、角色成长曲线的偏移（成长节点的章节位置是否需调整）、读者体验指标的预估变化。系统还会在修改存在叙事风险时主动提供替代方案。

分支模拟支持的问题类型举例：
- "如果把第 30 章的反派身份揭示提前到第 20 章，后续伏笔怎么调整？"
- "如果删除这个角色的背叛弧线，哪些冲突会失去动机支撑？"
- "如果第 3 卷延长 10 章（增加过渡内容），张力曲线会如何变化？"
- "如果让这个角色在第 50 章死亡，对他关联的 3 条伏笔和 2 个冲突有什么连锁影响？"

### 4.3 成长工坊（Growth Workshop）

成长工坊将角色设计从"填写档案"升级为"协同设计成长曲线"。

每个核心角色的成长曲线包含以下结构：

```
起点（第1章的状态：能力水平、人格特征、核心关系）
  │
关键转折点 1（第X章）
  触发剧情事件：[关联到 StoryOS 的指定反转/揭秘/冲突解决]
  能力变化：从X阶 → Y阶（能力上限、新能力描述）
  心理代价：获得力量但失去了什么
  关系影响：与哪些角色的关系因此发生变化
  │
关键转折点 2（第Y章）
  触发剧情事件：[...]
  ...
  │
低谷/倒退（第Z章，可选）
  能力或人格的暂时性退化，通常发生在重大打击之后
  │
终点（角色的最终状态，完整的成长弧线）
```

Character Designer 生成初始成长曲线方案后，用户与其深入讨论：成长的节奏分布是否合理（前快后慢还是渐进式？）、每次成长的代价是否充分且有意义、成长节点是否与剧情高潮自然同步、成长过程中角色的人际关系网络如何同步演变。系统以可视化方式展示成长曲线图（X 轴为章节，Y 轴为能力水平/心理成熟度），修改后自动检查与剧情里程碑的一致性——如果某个成长节点失去绑定的剧情事件支撑，系统会提醒。

### 4.4 风格沙盒与创新豁免

**风格沙盒（写作准备阶段）：**

在正式写作前，用户选择目标体裁并可选上传参考文本。Style Extractor 分析参考文本后提取风格特征。风格沙盒用一小段文本（约 500 字）按照不同参数组合生成多个预览版本：默认参数版本、句长+20% 版本、对白比例+15% 版本、环境描写密度+30% 版本等。用户可逐个阅读比较，选择最喜欢的版本，或混合多个版本的参数（如"A 的句长 + B 的对白密度"），形成最终的风格配置，应用于后续所有章节写作。

**创新豁免（写作阶段）：**

Writer 在写作某 Scene 时，如果认为此 Scene 需要突破某条风格规则才能达到最佳效果，可以主动向用户提交创新豁免申请。申请需声明：要突破的具体规则、突破的原因和意图、预期的艺术效果。用户审批通过后，该 Scene 不受对应规则约束，Writer 可自由发挥。创新意图和突破记录被归档，可在章节评审会中讨论该突破的实际效果——如果效果优秀，这个"例外"可以被提炼为新的风格变体规则，供后续作品复用。如果效果不佳，用户可以在评审会中标记"此方向不推荐"，系统记录为反例。

**关键设计：** 创新豁免不是"允许 Writer 随意违规"，而是"Writer 需要有意识地声明创新意图并接受用户审批"——既保证了创新的空间，又保持了用户对风格的最终掌控。

### 4.5 章节评审会（Chapter Review）

每章所有 Scene 完成并通过 Reviewer 审稿后，系统自动进入章节评审会。这是用户与 Reviewer Agent 之间的简短对话。

Reviewer 首先展示本章质量摘要：连贯性评分（含五个维度的明细）、七个读者指标的变化趋势、张力曲线位置、任何异常标记（如某 Scene 触发了两次重写、某处风格偏离被记录等）。

然后 Reviewer 主动提出开放问题引导讨论："本章结尾钩子强度评分一般，是否需要在下一章开篇加强？"、"角色 XXX 本章出场时间较少且无独立场景，是否需要在下一章安排？"、"检测到一段风格偏离，不是违规但不同于常规风格，是否保留这种写法？"

用户可以：标记"这段写法我特别喜欢，后续保持"（更新 Style Engine 的偏好权重）、标记"这个角色这场戏写得很好"（作为后续类似场景的写作参考）、针对任何 Scene 提出修改意见、记录本章产生的灵感（灵感路由器自动捕捉）、或者满意则直接进入下一章。

用户也可以选择"快速通过"——仅浏览质量摘要（<30 秒）即进入下一章，评审会不是强制负担。

### 4.6 灵感捕捉（Inspiration Capture）

灵感路由器在所有阶段的讨论中持续运行。它识别对话中的灵感信号——"如果..."、"或者..."、"能不能..."、"我突然想到..."、"这个设定有点意思..."、"另一种写法是..."——将其自动分类存入对应存储位置。

分类逻辑：新设定灵感进入 Idea Pool（标记来源阶段、原始上下文、关联的故事基因元素）；新剧情想法进入 StoryOS 暂存区（标记关联章节和角色，在情节头脑风暴阶段可被 Outliner 调用）；新角色灵感进入角色设计建议区（标记关联的故事基因和已有角色）；风格偏好进入 Style Engine 偏好记录；写作灵感进入 Scene 灵感池（在写作阶段，Writer 规划 Scene 时可以参考这些灵感）。

阶段切换时灵感路由器主动提醒用户——"在概念讨论阶段你产生了 3 个灵感，是否要在世界观构建中参考？"——避免跨阶段遗忘。

用户在任何阶段都可以打开"灵感面板"查看所有历史阶段积累的灵感。灵感面板按阶段和类型组织，每条灵感记录产生时间、原始上下文摘要、关联的故事元素。用户可以将灵感拖拽应用到当前阶段的工作中。

### 4.7 用户编辑辅助

当用户在 `live` 模式下手动修改某 Scene 的文本后，系统自动执行"变化扫描"——分析用户编辑的内容中隐含的叙事变化（新增了伏笔？改变了角色关系？引入了新冲突？），并向用户建议需要添加或调整的 SF_LOG 标记。用户确认后标记被嵌入文本，确保手动改写的内容也能被 StoryOS 正确追踪，不会因为用户介入而产生叙事资产追踪的盲区。

---

## 五、Style Engine — 风格引擎

### 5.1 设计目标

AI 写作容易"千篇一律"。Style Engine 让作者能够定义和控制作品的风格，从宏观流派模板到微观句式规则。与 v1.1 的纯约束模式不同，v1.2 的 Style Engine 在保持风格一致性的同时，通过风格沙盒和创新豁免为创新写作留出了用户可控的空间。

### 5.2 三层风格控制

**L1 体裁模板（Genre Templates）：**

预定义的流派写作规则，以 YAML 外置，体裁可插拔。系统内置五种体裁模板：

- **爽文（Cool Novel）：** 短句快节奏（平均句长 15-25 字）、段落短小（1-3 句）、对白占比 30%-50%、每章至少 3 个小爽点、每 2-3 幕一个 mini_payoff、结尾必留钩子。禁忌：连续 3 段以上纯描写、主角超过 1 章无积极行动、配角连续 2 个场景比主角出彩
- **严肃文学（Literary）：** 长句铺陈、心理描写深度优先、节奏舒缓、允许留白和余味、环境描写与人物情绪呼应。禁忌：过于直白的情绪表达、脸谱化角色
- **悬疑推理（Mystery）：** 线索密度控制（每章至少 1 条新线索）、信息不对称维持（读者知道的不超过主角知道的 120%）、反转节奏（避免连续 2 章无进展）、逻辑自洽性优先
- **科幻（Sci-Fi）：** 设定自洽性为最高优先级、专业词汇可使用但有密度上限、科技感描写优先于情感描写、逻辑链条必须完整
- **奇幻（Fantasy）：** 世界观一致性（魔法体系的输入输出必须有规则）、种族设定的内部逻辑、史诗感与个人叙事的平衡

**L2 写作公式（Writing Formulas）：**

句子级别的定量约束，控制文字的具体质感：

- **句式模板：** 短句冲击（≤10 字，用于动作和高潮）、长句铺垫（≥30 字，用于氛围和内心）
- **情绪节奏模板：** 压抑→爆发→收获 的三段式情绪曲线，每段的大致字数比例
- **对白节奏公式：** 对白/叙述的比例控制，对话的交替频率（避免一人独白过长）
- **爽点密度公式：** 每章的爽点（mini_payoff）数量和位置分布（前 1/3、中 1/3、后 1/3 各至少一个）
- **环境描写公式：** 描写段落/行动段落的交替比例，避免连续长段描写打断节奏

**L3 禁忌约束（Constraint Layer）：**

分级别的"不能做"规则：

- **全局禁忌：** 禁止在正文中引用章节编号（元引用）、禁止出现真实公司名称或真实人物姓名、禁止虐主超过用户设定的字数上限
- **角色禁忌：** 每个角色在 `characters.json` 中配置的 `taboos` 字段——如"不会在公开场合哭泣"、"不会无原则地原谅"、"金手指不可无故削弱"——系统在审稿时自动扫描违规
- **体裁禁忌：** 特定体裁的禁止模式——如爽文禁止"主角被配角压过风头超过连续 2 个场景"、悬疑禁止"在揭示前给出完整答案"

### 5.3 风格提炼（Style Extractor）

作者上传参考文本（已有章节、喜欢的作家作品），系统自动分析并提取风格特征，生成可复用的 YAML 规则文件：

- **句式分析：** 平均句长（字数）、短句（≤10 字）占比、长句（≥30 字）占比、感叹句密度
- **节奏分析：** 段落长度的分布曲线、对白段/叙述段的交替模式、章节结尾方式（钩子型/留白型/总结型）
- **词汇分析：** 专业词汇密度、口语化程度（对话中口语词占比）、情感词汇的使用偏好
- **结构分析：** 每章的爽点位置分布（前 1/3、中 1/3、后 1/3 的密度）、每章高潮在章节中的位置（如 85% 处）

提取结果自动生成一个 YAML 规则文件，用户可在风格沙盒中预览效果，调整参数后直接应用于写作，或作为自定义体裁模板保存供后续作品复用。

### 5.4 风格沙盒

在正式写作前，用户在风格沙盒中用一小段测试文本（约 500 字）预览不同风格参数组合的效果。系统生成多个变体版本——默认参数、句长+20%、对白比例+15%、环境描写密度+30% 等——用户逐版比较，选择最满意的版本。用户也可以混合多个版本的参数（如"A 版本的句长 + B 版本的对白密度 + C 版本的环境描写"），形成自定义风格配置。

也可以在写作过程中随时回到风格沙盒，用下一章的试写段落测试调整后的参数效果。风格沙盒让"风格"从抽象概念变成可比较、可选择的具象体验。

### 5.5 创新豁免

Writer 在写作过程中，如果认为某个 Scene 需要突破风格规则才能达到最佳效果，可以主动提交创新豁免申请。申请需声明：要突破的具体规则（如"句长限制——此场景为情感高潮，需要长句铺陈"）、突破的创作意图、预期的艺术效果。

用户审批通过后，该 Scene 不受对应规则的约束，Writer 可自由发挥。创新意图和突破记录被归档，后续可在章节评审会中评估效果——如果效果优秀，可以被提炼为新的风格变体规则（"情感高潮场景允许句长突破至 40 字"），供本作品后续章节或未来作品复用。如果效果不佳，用户标记为反例，系统记录以避免重复类似突破。

创新豁免的本质是将"风格一致性"和"创意突破"的平衡权交到用户手中——系统不会擅自突破规则，也不会铁面阻止突破，而是让用户在充分知情的情况下做出选择。

---

## 六、CreativeOS — 创意引擎

### 6.1 设计目标

帮助作者从一个模糊的想法出发，系统化地发散出高新颖度、有市场潜力的故事设定。不替代作者创意，而是提供结构化创意工具。在 v1.2 中，CreativeOS 与创意画布深度集成，用户不再是"输入→接收输出"的旁观者，而是创意探索过程的主动参与者。

### 6.2 七大创意模块

**灵感种子库（Idea Pool）：**

存储和管理所有创意灵感。每条灵感记录：内容描述、标签分类（如"重生/身份颠覆/元叙事"）、来源（用户输入 / Agent 生成 / 灵感路由捕捉）、四维新颖度评分、引用次数、创建时间。灵感可在创意画布中手动添加为节点，也可被灵感路由器自动填充。作者可以随时回顾、组合、升级旧灵感。

**套路模式库（Trope Pool）：**

系统化的网文套路知识库。每个套路记录其核心机制（如"系统文"的核心是"主角获得外挂系统辅助成长"）、市场饱和度（0-1，由人工标注+季度数据爬取更新：低于 0.3 为"蓝海"，高于 0.8 为"红海"）、子变体列表（签到系统、商城系统、属性面板）、融合潜力（可与哪些其他套路跨界融合）、反模式（已烂大街的变体方向，建议避开）。

**套路变异器（Mutation Engine）：**

给定一个基础套路，自动生成新颖变体。四种变异操作：

| 操作 | 说明 | 示例 |
|---|---|---|
| **逆转（Inversion）** | 反转核心预设 | 系统文 → "系统其实是骗局，在污染宿主意识" |
| **融合（Fusion）** | 跨体裁嫁接 | 重生 + 刑侦 = "凶手也重生了，且知道主角重生" |
| **升维（Escalation）** | 矛盾升级 | 主角无敌 → "无敌但无法伤害任何人" |
| **打破（Subversion）** | 颠覆读者预期 | 预设的反派 → 转变为守护者 |

每次变异输出：变异后的核心设定（一句话）、由此产生的核心矛盾、对读者的新奇钩子、设定自洽性检查（是否逻辑闭环）。

**矛盾设定生成器（Contradiction Engine）：**

强设定的本质是内置矛盾。系统提供五个矛盾模板，帮助作者构建天然具有张力的设定：

| 矛盾模板 | 含义 | 示例 |
|---|---|---|
| **能力 × 限制** | 强大能力有苛刻限制 | 能预知他人死亡，但无法预知自己的 |
| **永恒 × 消逝** | 永恒的事物会消逝 | 不死之身，但记忆每百年清零 |
| **身份 × 秘密** | 双重身份矛盾 | 表面是医生，实为器官贩卖网络的受害者 |
| **目标 × 代价** | 达成目标的代价是目标本身 | 追求力量为了保护，但力量在吞噬人性 |
| **力量即弱点** | 最强的力量恰是最大弱点 | 预知能力越强，越清楚一切不可改变 |

**连续发散器（WhatIf Engine）：**

从一个核心前提出发，递归地进行"如果...会怎样？"的发散思考，生成一棵创意树。默认深度 3 层、广度 4 个分支，最多可产生 4+16+64 = 84 个衍生节点。约束条件：每个子节点必须是父节点的直接逻辑推论，不能跳跃，保证逻辑发散而非随机联想。这棵创意树是创意画布的底层数据。

**体裁融合器（Genre Fusion Engine）：**

在结构特征层面融合两个体裁，而非简单叠加标签。系统维护每个体裁的结构特征——核心机制（如重生的"预知+改变命运"）、读者承诺（如系统文的"稳定升级"、刑侦的"烧脑反转"）、兼容体裁列表、冲突体裁列表。当两个体裁存在天然冲突时（如"系统文 × 刑侦"——系统给答案会破坏悬疑），系统设计化解方案。体裁之间的距离通过 BFS 最短路径计算，距离越远新颖度加成越大（相邻 +5、相隔 +15、远距 +30）。

**新颖度评估器（Novelty Evaluator）：**

从四个维度评估创意市场新颖度（0-100）：

| 维度 | 权重 | 评估逻辑 |
|---|---|---|
| **市场饱和度** | 30% | 提取创意中的套路标签，在 Trope Pool 中匹配，取最低饱和度（最蓝海）计算得分。低饱和度=高分 |
| **套路相似度** | 25% | 将创意文本向量化（bge-m3），与 Trope Pool 的向量索引做语义相似度搜索。与已知套路越不相似=分数越高 |
| **矛盾深度** | 25% | 检测创意中是否包含 Contradiction Engine 定义的矛盾模式。多个模板命中=复合矛盾加成 |
| **讨论潜力** | 20% | 基于争议性关键词密度 + 身份冲突元素 + 可预测性反比计算。有争议性=高分 |

综合判定：≥80 高新颖度可推进 | ≥60 中等建议强化矛盾 | ≥40 偏低需显著变异 | <40 建议更换核心创意

**爆款潜力** 在新颖度之外还综合反转密度和讨论潜力：新颖度(40%) + 反转密度(30%) + 讨论潜力(30%)。

### 6.3 创意画布交互层

创意画布将 WhatIf Engine 生成的创意树可视化为可交互探索空间（详见 4.1 节）。用户在画布中点击展开、标记偏好、剪枝、以节点为新根重新发散、手动添加节点、合并分支。每次操作后新颖度评分实时更新。用户选定路径后生成最终 Story DNA。

### 6.4 产出物

**Story DNA（故事基因）：** 核心矛盾设定（id + 矛盾陈述 + 核心张力 + 新颖度评分）、体裁融合方案（主体裁 + 融合体裁 + 嫁接机制 + 新颖度加成）、选定的变异套路组合、关键 WhatIf 节点（最优质的发散分支）、读者钩子设计（主谜团 + 主承诺 + 情感核心）、创意约束条件（为确保设定自洽的规则边界）。

**创意路径选择历史：** 用户从初始 WhatIf 树根节点到最终 Story DNA 的完整选择路径——每一步选择了哪个节点、标记了哪些偏好、剪掉了哪些分支、为什么——为后续阶段理解创作意图提供参考。

---

## 七、StoryOS — 叙事资产管理

### 7.1 设计目标

长篇小说最大的挑战不是写不出来，而是写到后期忘了前期埋了什么。StoryOS 将叙事中的"无形资产"——冲突、承诺、谜团、反转、揭晓、目标、读者期待——显式登记、追踪、管理。每一个伏笔都有生命周期，每一条剧情线都有始有终。在 v1.2 中，StoryOS 还与分支模拟引擎集成，支持用户在大纲阶段推演"如果改了这个会怎样"的连锁影响。

### 7.2 七类叙事资产

| 资产类型 | 追踪的核心问题 | 关键属性 |
|---|---|---|
| **冲突（Conflict）** | 谁和谁在斗？斗到什么程度了？ | 类型（复仇/爱情/权力/生存/意识形态）、所有者、目标、当前强度（低/中/高/临界）、创建章节、预期解决章节、升级历史、解决说明 |
| **承诺（Promise）** | 角色对谁许下了什么？什么时候兑现？ | 内容、说话人、听众、创建章节、截止章节、重要性（低/中/高/关键）、状态（活跃/已兑现/已打破/已延期）、兑现说明 |
| **谜团（Mystery）** | 什么悬念吊着读者？线索够了吗？ | 问题、埋设章节、已给出线索列表（含章节号和线索内容）、计划揭示章节、状态（开放/部分揭示/已揭示）、揭示后的影响级别（世界观级/剧情级/角色级） |
| **反转（Twist）** | 什么颠覆在铺垫？读者现在预期什么？ | 类型（身份/背叛/世界真相/能力来源/关系）、描述、铺垫起始章节、铺垫方式、计划揭示章节、揭示触发条件、影响级别、状态（铺垫中/铺垫完成/已揭示）、铺垫章节列表 |
| **揭晓（Reveal）** | 什么秘密要揭示？谁知道/不知道？ | 秘密内容、已知角色列表、读者是否已知、计划揭示章节、揭示方式、实际影响、状态（隐藏/已铺垫/已揭示） |
| **目标（Goal）** | 角色要达成什么？进展如何？ | 所有者、类型（短期/角色弧/系列）、内容、创建章节、目标章节、状态（活跃/已达成/已失败/已转向）、子目标列表 |
| **读者期待（Expectation）** | 读者现在在期待什么发生？ | 类型（爽点兑现/反转/感情线/能力升级/复仇）、内容、植入章节、读者是否期待、兑现章节、兑现方式（完全/部分/颠覆）、状态（积累中/可兑现/已兑现/已逾期） |

### 7.3 叙事资产关联网络

这些资产不是孤立的，它们之间存在天然的因果关系。系统维护跨资产的外键引用：

```
谜团（Mystery）
  └─ reveals_into → Reveal（谜团揭示对应哪个揭秘）
  └─ linked_twists → Twist（谜团关联哪些反转）
  └─ linked_expectations → Expectation（谜团吊起了哪些读者期待）

反转（Twist）
  └─ reveals_via → Reveal（反转通过哪个揭秘兑现）
  └─ triggers_expectations → Expectation（反转触发哪些读者期待）
  └─ affects_characters → 角色（反转影响哪些角色）

揭晓（Reveal）
  └─ resolves_mysteries → Mystery（揭秘解开了哪些谜团）
  └─ unlocks_twists → Twist（揭秘释放了哪些反转）
  └─ fulfills_expectations → Expectation（揭秘兑现了哪些读者期待）
  └─ may_escalate_conflicts → Conflict（揭秘可能导致哪些冲突升级）

冲突（Conflict）
  └─ linked_mysteries → Mystery
  └─ linked_goals → Goal
  └─ linked_expectations → Expectation

承诺（Promise）
  └─ linked_conflicts → Conflict
  └─ blocks_expectations → Expectation

目标（Goal）
  └─ blocked_by_conflicts → Conflict
  └─ enabled_by_reveals → Reveal
  └─ linked_promises → Promise
```

当一处资产状态变化时，系统自动级联传播更新关联资产——Mystery 状态变为 revealed → 关联的 Reveal 自动变为 revealed → 关联的 Expectation 自动变为 fulfilled。这确保了叙事资产之间的一致性，不需要人工逐一手动更新。

### 7.4 全局伏笔映射表

从大纲规划阶段就建立伏笔的完整生命周期追踪：

- 伏笔"超脑真相"：埋设于第 1 章 → 第 15 章给出第一条线索 → 第 28 章给出第二条线索 → 计划第 48 章揭示 → 关联 Mystery "超脑的真实来源"
- 伏笔"暗物质危机"：埋设于第 15 章 → 计划第 50 章揭示 → 关联 Twist "宇宙的终极真相"
- 伏笔"师父真实身份"：埋设于第 10 章 → 第 20/33/41 章分别铺垫 → 计划第 58 章揭示 → 关联 Reveal "师父是幕后卧底"

每个伏笔追踪其状态（已埋设/铺垫中/可揭示/已揭示）、关联角色、受影响的故事资产。在分支模拟中，如果用户修改了某个情节节点，系统自动分析该修改对伏笔映射表的影响——哪些伏笔需要重新规划、哪些可能断裂。

### 7.5 全书张力曲线

系统实时计算整本书的张力值（0-100），综合当前活跃叙事资产的状态：活跃冲突数量×强度（关键冲突权重翻倍）、即将到来的反转数量（计划揭示章 ≤ 当前章+3）、开放谜团数量、即将兑现的读者期待（状态=ready_to_fulfill）、即将超期的承诺压力。

**智能预警：**
- 连续 3 章张力低于 30 → 严重：节奏过于平缓，建议立即引入新冲突或推进悬念。系统会具体建议：有哪些 setup_complete 的反转可以提前揭示？有哪些 ready_to_fulfill 的读者期待可以兑现？
- 承诺截止章 ≤ 当前章+5 且状态仍为 active → 高度：该兑现了，或者给出延期理由
- 读者期待已超过计划兑现章节但状态仍为 ready_to_fulfill → 中度：读者等太久了，有弃书风险
- 活跃冲突数量不足 3 个 → 轻度：戏剧性可能不足，建议从现有 Mystery 衍生新冲突
- 谜团超过 10 章无新线索 → 轻度：读者可能已遗忘此悬念，建议揭示一条线索

---

## 八、SF_LOG 变化标记机制

### 8.1 设计目标

传统 AI 写作的核心问题：AI 在文字中隐含了角色关系变化、知识获取、冲突升级、伏笔兑现——但这些变化散落在自然语言中，难以被系统精确识别。如果让 LLM 事后"阅读理解"自己的文字来提取这些变化，不仅成本高，而且不稳定、遗漏多。

StoryForge 的做法是：写作时，Writer 在叙事文本的合适位置嵌入"变化标记"。这些标记采用 Markdown 注释语法（`<!-- ... -->`），对读者完全不可见，但系统可以用正则表达式确定性解析。一章写完后，系统自动扫描这些标记，提取所有叙事变化，更新叙事资产库——零 LLM 调用，精确、确定、零遗漏。

### 8.2 变化标记类型

Writer 在写作时，每当以下变化发生，必须在对应叙事位置嵌入标记：

**角色状态变化：**
- `character_relation_change` — 角色关系改变（好感度升降、信任动摇、反目、和解）。记录涉及双方、新状态、触发原因
- `character_emotion` — 角色情绪显著变化。记录角色名、新情绪、强度
- `character_location_change` — 角色位置变化（特别是跨场景移动）
- `character_physical_change` — 角色身体状态变化（受伤、治愈、中毒等）

**叙事资产变化：**
- `knowledge_gain` — 角色获得关键知识（秘密、线索、真相）。记录角色、知识内容、来源
- `conflict_escalate` — 冲突升级。记录冲突 ID、新强度、触发事件
- `mystery_clue` — 谜团的新线索被揭示。记录谜团 ID、线索内容
- `twist_reveal` — 反转被触发。记录反转 ID、触发原因
- `expectation_fulfill` — 读者期待被满足。记录期待 ID、满足方式（完全/部分/颠覆）
- `goal_milestone` — 角色目标达成阶段性进展。记录目标 ID、进度描述
- `registry_create` — 全新的叙事资产在写作中被创建（新的冲突/承诺/谜团等）。记录资产类型和关键数据

### 8.3 工作流程

**写作前：** Writer 在 Scene 规划时为每个 Scene 填写 `registry_changes`（预声明本幕将产生的叙事资产变化）和 `required_logs`（本幕必须嵌入哪些类型的标记）。

**写作中：** Writer 在叙事文本的合适位置嵌入变化标记，标记紧跟在变化发生的叙事位置之后。

**写作后：** StoryOS Agent 用正则解析所有标记（纯确定性代码，无 LLM）。将解析结果与 Writer 的预声明对比——匹配成功的变化被验证通过并应用；预声明了但未找到对应标记的变化被记录为"遗漏"（可能是 Writer 忘记打标记）；出现了但未预声明的变化被接受（Writer 在写作中主动新增的变化）。所有验证通过的变化通过级联规则传播到关联资产。

**用户编辑后（v1.2 新增）：** 当用户在 `live` 模式下手动修改文本后，系统自动分析修改内容中隐含的叙事变化，向用户建议需要添加或调整的 SF_LOG 标记。用户确认后标记被嵌入。这确保了手动改写不会造成叙事资产追踪的盲区。

---

## 九、Scene Engine — 写作执行系统

### 9.1 设计目标

将叙事资产的规划落实到每一幕（Scene）的写作。每个 Scene 不是随意写的，而是带有明确的叙事任务和读者体验目标。在 v1.2 中，Scene Engine 支持用户实时介入、创新豁免申请和用户编辑辅助。

### 9.2 Scene 的叙事规格

每个 Scene 在写作前需要明确三个层面的规划：

**叙事层：**
- 本幕目标：获取线索？推进关系？揭示信息？角色成长时刻？
- 本幕冲突：当前矛盾的即时表现形式
- 情感弧线：从什么情绪出发 → 经历什么事件 → 到达什么情绪（如"压抑 → 冲突爆发 → 短暂释放"）
- 叙事角色：小爽点 / 大爽点 / 铺垫 / 过渡 / 悬念结尾（每章至少安排 1 个大爽点，每 2-3 幕至少 1 个小爽点）

**读者体验层：**
- 本幕是否有反转？如果有，是什么类型的反转？
- 本幕兑现了什么？（伏笔回收？承诺兑现？读者期待满足？）
- 本幕结尾的钩子是什么？读者看完这幕会不会想继续？
- 预期读者反应：震惊 / 紧张 / 满足 / 期待 / 愤怒

**叙事资产管理：**
- `registry_changes`：本幕将涉及哪些叙事资产的状态变化（哪个谜团给线索？哪个冲突升级？）
- `required_logs`：本幕必须嵌入哪些类型的 SF_LOG 标记

### 9.3 Scene 规划评审（用户介入点）

在每章所有 Scene 开始写作前，Writer 展示本章 Scene 规划供用户审阅。用户可以：
- 调整 Scene 的顺序（"把高潮 Scene 放到最后，前面先铺垫"）
- 增删 Scene（"中间再加一幕过渡"、"这个 Scene 没必要，删掉"）
- 指定某 Scene 的风格实验方向（"这个 Scene 我想尝试内心独白的写法"）
- 为某 Scene 预设创新豁免（提前声明某 Scene 需要突破风格规则）

### 9.4 逐幕写作与用户实时跟进

默认 `live` 模式下，每幕写完后立即展示给用户。用户可以：
- **接受：** 满意，直接进入下一幕
- **要求重写：** 不满意，附带修改方向（"这段对话太生硬，角色应该更克制"），Writer 针对性重写
- **自己修改：** 用户直接编辑文本，修改后系统自动建议需添加/调整的 SF_LOG 标记
- **标记偏好：** "这段写法我特别喜欢，后续类似场景保持这种感觉"——更新 Style Engine 偏好权重

### 9.5 写作规范约束

通用写作规范（可按体裁覆盖）：
- 每章至少 4000 字，每幕 800-1500 字
- 每章结尾必须有钩子（悬念/反转/情绪爆发点/新信息揭示）
- 禁止"吃书"：严格遵守 MemoryOS 摘要和 Character State Machine 中的已写内容
- 禁止元引用：不可在正文中引用章节编号或"如前文所述"
- 爽文体裁特化：主角在冲突后 3 章内须完成反制、金手指使用须符合设定上限

---

## 十、MemoryOS — 五层记忆系统

### 10.1 设计目标

长篇写作中，不同时效的信息需要用不同方式管理，精准召回而不污染 AI 的上下文窗口。MemoryOS 设计了五层记忆，按检索优先级从近到远排列。写作时系统按 L0 → L1 → L4 → L2 → L3 的优先级依次注入上下文。

### 10.2 五层结构

**L0 运行时记忆（约 500 tokens，始终在上下文顶部）：**

当前章的即时状态快照，每个 Scene 开始前刷新一次。包含：当前卷号/章号/幕号、活跃角色列表及各自当前位置、活跃冲突 ID 列表、活跃承诺 ID 列表、即将到来的反转和揭秘（计划在本章或近 3 章内揭示的）、当前张力值和读者追更欲值、本章已完成幕的 beat 统计（已写几个小爽点/几个钩子）、最近一次重大事件摘要、待处理预警列表。

L0 是 Writer 写作每幕时"必须知道"的最小信息集，永远放在 prompt 最顶部，确保不被任何其他信息覆盖或冲淡。

**L1 热记忆（约 15K tokens）：**

最近 5 章的完整内容，保证近期剧情的连贯性。每 5 章自动触发一次"关键细节重提取"：LLM 扫描最近 5 章，提取所有"可能在后续被遗忘但重要"的细节——角色身上的装备/物品/伤情、角色间未完成的对话或约定、环境中被提及但尚未探索的线索——生成一份清单，放在 L1 上下文的最顶部。这是 L1 唯一的额外 LLM 调用（约 2.5K tokens），每 5 章触发一次，开销可控。

**L2 温记忆（约 8K tokens）：**

全书的结构化摘要，作为全局导航图。包含：按卷/章组织的摘要树（每章约 100 字摘要，每卷约 200 字摘要）、角色关系图（当前状态的结构化描述）、全书时间轴（关键事件节点列表）、已回收和未回收的伏笔列表。L2 的内容在每章写完后由 Summary Archiver 增量更新。

**L3 冷记忆（按需召回）：**

全书所有内容的向量化语义检索库。将每章按叙事语义单元分块（场景边界切割 → 对话段与叙述段分离 → 每块附带元数据标注其所属章节、涉及角色、涉及地点、是否为对话、情感基调），使用 BAAI/bge-m3 模型生成向量嵌入，存入 Qdrant 向量数据库。检索时采用混合策略：向量语义相似度 + BM25 关键词精确匹配，通过 RRF（Reciprocal Rank Fusion）融合排序，取 top-N 结果。支持交叉引用查询——某个人物/道具/地点在全书中的所有出现。Writer 在写作需要召回几十章前的细节时触发 L3 检索。

**L4 叙事记忆（约 3K tokens）：**

与 StoryOS 强同步的叙事资产摘要。包含所有活跃状态的冲突/承诺/谜团/反转/读者期待的简要列表（ID + 一句话内容 + 当前状态），以及即将到期或逾期的资产。L4 在每章开始时刷新，同章内多个 Scene 共享。

### 10.3 细节防遗忘机制

除 L1 的每 5 章关键细节重提取外，系统还维护一个"活跃物品与线索"追踪表——记录了角色持有但尚未使用的物品（如"第 15 章获得的密钥卡，尚未使用"）、角色受过的伤（如"第 30 章左臂受伤，第 42 章提及尚未痊愈"）、未完成的对话约定（如"第 25 章承诺三天后见面，在第 28 章之前的某天"）。这些信息在写作时被注入 Writer 的上下文，防止"遗忘性吃书"。

---

## 十一、ReaderOS — 读者体验模型

### 11.1 设计目标

作者写完一章后，需要知道读者的阅读体验会是什么样——是紧张刺激想追更，还是平淡拖沓想弃书。ReaderOS 从七个维度量化每章的读者体验，全部基于可计算的指标（叙事资产状态、文本特征、历史数据），不依赖 AI 的"感受判断"。

### 11.2 七个读者状态指标

| 指标 | 衡量什么 | 计算逻辑 |
|---|---|---|
| **好奇心（Curiosity）** | 读者有多想知道接下来发生什么？ | 当前所有开放谜团 × 各自影响权重求和（世界观级=30、剧情级=20、角色级=10），归一化到 0-100 |
| **张力（Tension）** | 读者有多紧张？ | 直接引用 TensionCurve 的综合计算值（活跃冲突数×强度 + 即将反转 + 开放谜团 + 即将兑现期待） |
| **满足感（Satisfaction）** | 读者最近爽了几次？ | 近 3 章内 fulfilled 状态的 Expectation 和 Promise 数量 × 20，上限 100 |
| **挫败感（Frustration）** | 主角是不是太惨了？ | 近 5 章内主角 Goal 被阻断或失败的次数 × 15，上限 100 |
| **疲劳度（Fatigue）** | 读者是不是太累了？ | 近 3 章 Tension 平均值减去 50（超过 50 视为高强度），超额部分 × 1.5 |
| **追更欲（Addiction）** | 读者会不会点下一章？ | 综合公式：好奇心×0.30 + 张力×0.25 + 满足感×0.20 + 结尾钩子质量×0.25。钩子质量通过模式匹配计算（疑问句结尾+25、突发危机+30、新信息揭示+25、情绪爆发点+20，可叠加） |
| **讨论潜力（Discussion Potential）** | 读者会不会在评论区吵架？ | 道德模糊度（活跃冲突数量×10，上限30）+ 预期打破（近3章揭示的 Twist/Reveal 数量×10，上限30）+ 结尾钩子强度×0.25 + 文本争议特征（牺牲/背叛/选择等关键词密度，上限20） |

### 11.3 自动预警

系统在指标触发阈值时自动生成分级预警（预警同时注入下一章的写作提示）：

- **追更欲 < 40（严重）：** 读者可能弃书。建议检查本章结尾钩子质量、近期爽点兑现密度。预警会被注入下一章 Writer 的 Scene 规划阶段
- **挫败感 > 70（高度）：** 主角受挫程度过高，读者可能因心疼而弃书。建议在近 3 章内安排一次明确的胜利或进展
- **疲劳度 > 60（中度）：** 持续高强度内容，读者需要喘息。建议安排轻松场景或情感缓冲幕
- **好奇心 < 30 但追更欲 > 50（中度）：** 读者在"追习惯"而非"追内容"——没有新的悬念吸引他们，但惯性还在。需尽快引入新谜团或推进已有谜团
- **张力 > 60 但讨论潜力 < 30（轻度）：** "爽但无争议"型章节——读者看得很爽但没有讨论的欲望。可考虑增加道德模糊元素或不可调和的选择困境

---

## 十二、一致性保障系统

### 12.1 角色一致性

每个重要角色维护一份完整的人物档案，分为四个层次：

**核心人格层（不轻易改变）：**
- 信念：角色坚信什么（如"家人是一切的核心"、"技术可以改变世界但人性才是根本"）
- 欲望：短期目标、中期追求、深层欲望
- 恐惧：核心创伤和害怕什么
- 价值观：行为底线（如"有仇必报但有底线"、"不放弃任何可以救赎的人"）

**当前状态层（随剧情动态更新）：**
- 位置（现在在哪）、身体状态（正常/轻伤/重伤/特殊状态）、情绪状态
- 与每个重要角色的关系状态（如"苏晓晓：恋人，情感锚点，刚因危险起了争执"）
- 正在追求的目标列表、角色已知的秘密列表、角色还不知道的秘密列表

**能力进化追踪：**
- 角色能力的阶段性升级（如"一阶·绝对理智 → 二阶·万物互联 → 三阶·量子领域"）
- 每阶段的能力上限、每日使用限制、使用代价
- 在 v1.2 中，能力阶段与成长曲线的转折点绑定，每次升级关联具体的剧情事件

**角色声音签名：**
- 说话风格（如"克制、简短、逻辑性强，愤怒时反而更安静"）
- 思维模式（如"先分析利弊再决策，极少冲动"）
- **绝对禁忌（Forbidden）：** 角色绝不会做的事——如"不会在公开场合哭泣"、"不会对真正的敌人讲道德"、"不会无原则地原谅"

**信念变化的严格门槛：**

角色的核心价值观不会因为一件小事改变。信念变化必须满足以下条件：
- 变化来源必须是 SF_LOG 标记（不由 LLM 从文本中推理，避免幻觉）
- 需要至少 2 个独立的叙事触发事件（在近 3 章内）
- 至少 1 个触发事件发生在本章
- 触发事件类型必须在白名单内：被重要人物背叛、重要人物死亡、世界观层面真相揭示、自我身份危机、不可逆的失去、道德觉醒、渐进式认知改变（需 3 章以上有相关证据 + 4 条以上独立证据）、关系质变

### 12.2 剧情线一致性

每条剧情线的完整生命周期：

```
创建（Created）→ 激活（Active）→ 升级（Escalated）→ 解决（Resolved）
                                    ↘ 放弃（Abandoned，仅作者主动决定）
```

**断线检测：** 系统自动检测所有 Active 或 Escalated 但长期未推进的剧情线。超过 10 章未被任何 Scene 的 SF_LOG 标记或预声明引用的剧情线标记为"可能断线"。如果该剧情线的重要性级别为 critical，阈值缩短为 5 章。

### 12.3 三层审稿机制

每幕写完后，Reviewer 自动执行三层审查：

**第一层·事实核查（Fact Guard，硬性阻断）：**

五项确定性检查（全部为规则匹配，零 LLM 调用）：

1. **时间线连续性：** 角色不能同时出现在两个位置。同章内位置变化需要对应的 SF_LOG 标记说明位移。跨章位置变化需与上一章结束时的位置可衔接
2. **角色状态一致性：** 角色不能展示他还不该知道的秘密（比对 `known_secrets` 和 `unknown_to_character`）。角色不能做出其 voice_signature 中 `forbidden` 列表禁止的行为
3. **世界规则一致性：** 角色的能力使用不超过其当前阶段的能力上限。如果角色的能力设定允许"临战突破"（flexibility=cost_required），则突破必须有对应的代价 SF_LOG 标记
4. **叙事资产合规：** 预声明的 `registry_changes` 中，不能将 status=resolved 的条目直接改回 active。引用的 Registry 条目必须存在。cross_refs 引用的条目必须存在且状态兼容
5. **变化标记完整性：** `required_logs` 中声明的标记是否全部在文本中出现。SF_LOG 标签的格式是否正确（严格正则校验）

不通过时，自动打回重写（最多 3 次），每次附带具体修改建议。第 3 次仍不通过时触发熔断降级——标记问题并生成兼容性说明、强制通过、通知用户介入决策。用户可以选择接受（"这个不一致是我有意为之"）或手动修复。

**第二层·叙事建议（Narrative Guard，软性建议，不阻断）：**

检测项包括：节奏是否合适、情绪是否连贯、角色行为是否有充分动机。v1.2 新增**状态漂移检测**——检查 Scene 文本中是否有明显的行为变化（如角色突然表现出与当前 Character State 记录不符的情感或行为）但没有对应的 SF_LOG 标签。如果发现漂移，生成 warning 建议（不是阻断），让用户在章节评审会中注意。

**第三层·风格标签（Style Guard，仅记录）：**

检测是否触犯角色或流派的禁忌规则（L3 Constraint Layer 的 forbidden 列表）。触碰记录被标记但不阻断。**例外：** 如果该 Scene 已被用户批准创新豁免，豁免范围内的风格规则不再检测。

### 12.4 连贯性评分

每章完成后综合评估质量（0-100 分）。低于用户设定的阈值（默认 80）自动触发重写：

| 维度 | 权重 | 扣分规则 |
|---|---|---|
| 时间线连续性 | 25% | 每处断层 -5 分 |
| 人物状态一致性 | 25% | 每处矛盾 -10 分 |
| 伏笔完整性 | 20% | 每个遗漏/意外 -5 分 |
| 世界规则一致性 | 20% | 每处违规 -8 分 |
| 禁忌约束 | 10% | 每处违禁 -15 分（创新豁免除外） |

---

## 十三、多轮修订流水线

### 13.1 全书自动诊断

系统对已完成的所有章节进行一键质量诊断，分五大类问题：

- **时间线断裂：** 角色死亡后复活、事件时序矛盾、同一角色同时出现在两地
- **角色不一致：** 能力前后矛盾、关系无故变化、角色行为与其设定人格不符
- **节奏问题：** 爽点密度分布不均、连续多章无高潮、对白/叙述比例失衡
- **重复冗余：** 高频短语过度重复、相似场景结构重复出现、同一描写反复使用
- **伏笔追踪：** 逾期未收的伏笔（超过计划揭示章仍无进展）、未规划的新伏笔（写作中产生但在大纲中没有的伏笔）

### 13.2 分级修复 + 用户决策

与 v1.1 自动修复不同，v1.2 采用"系统诊断 → 分级展示 → 用户决策"：

```
P0 阻断级 → 系统强烈建议修复，但由用户确认或主动跳过
  - 角色死亡后复活（无合理解释）
  - 金手指能力前后严重矛盾
  - 时间线逻辑断裂（如"三天前"的事件发生在"一周前"的事件之前）

P1 质量级 → 用户逐项决定是否修复
  - 重复短语超过阈值
  - 角色工具化（某角色连续多章无独立场景或主动行为）
  - 爽点分布不均（连续 3 章无 mini_payoff）
  - 逾期未收回的伏笔

P2 优化级 → 用户选择性修复
  - 过渡章节节奏生硬
  - 对话/叙述比例轻度失衡
  - 场景描写密度偏低
```

每级问题附带修复策略建议——时间线断裂可自动插入时间标记、工具化角色可补写 1-2 个独立场景、重复短语可批量替换、节奏问题可在必要时生成过渡章节。但最终决策权在用户手中。

---

## 十四、Agent 协作体系

StoryForge 有七个各司其职的 Agent，每个 Agent 在对应的创作阶段与用户协作：

| Agent | 职责 | 工作阶段 | 协作模式 | 产出物 |
|---|---|---|---|---|
| **Creative Director** 创意总监 | 驱动 CreativeOS 全部引擎，在创意画布中与用户多轮讨论，管理 Idea Pool 和创意路径历史 | STAGE 1 概念讨论 | `discuss` | Story DNA + 创意路径历史 |
| **Worldbuilder** 世界观师 | 基于 Story DNA 构建世界框架——时代、地理、战力/魔法体系、势力格局、科技背景 | STAGE 2 世界观工坊 | `discuss` | world.json |
| **Character Designer** 角色设计师 | 创建完整角色档案（人格/能力/关系/声音签名），在成长工坊中与用户协同设计成长曲线 | STAGE 2 角色工坊 | `discuss` | characters.json（含成长曲线） |
| **Outliner** 大纲师 | 规划分卷分章细纲 + 全局伏笔映射表，支持分支模拟推演，在情节头脑风暴中与用户反复推敲 | STAGE 3 情节头脑风暴 | `discuss` | outline.json（含伏笔映射 + 剧情-成长绑定） |
| **Writer** 写手 | 逐幕写作，嵌入 SF_LOG 变化标记，遵循 Style Engine 约束，支持创新豁免申请 | STAGE 4 逐章写作 | `live` | chapter_draft.md |
| **Reviewer** 审稿 | 三层审查（Fact/Narrative/Style Guard）+ 连贯性评分 + 主持章节评审会 | STAGE 4 每幕/章完成后 | `live` / `review` | review_report.json |
| **Summary Archiver** 归档员 | 生成章摘要、更新 MemoryOS 各层记忆、更新进度追踪、归档写作日志 | STAGE 4 每章完成后 | `auto` | 摘要 + 记忆更新 + progress.json |

### 协作原则

- 每个 Agent 在与用户对话时，都以"创作伙伴"而非"工具"的口吻——主动提问、提供备选、解释原因、接受反驳
- Agent 之间的状态共享通过 Conductor 和 StoryOS 的结构化数据完成，而非 Agent 之间直接对话
- 用户在任意阶段都可以回溯到之前的 Agent 重新讨论（如写到第 30 章时想回退修改角色设定，Conductor 会提醒受影响的章节并引导用户与 Character Designer 重新讨论）

---

## 十五、阶段门控配置

用户通过一个 YAML 配置文件控制整个创作流程的协作模式，无需修改任何代码：

```yaml
# storyforge_config.yaml
project:
  name: "代码天才重生记"
  genre: cool_novel
  style_sample: "samples/"        # 可选：参考文本路径
  total_chapters: 100
  min_words_per_chapter: 4500

workflow:
  concept_stage:      discuss     # discuss / review / approve
  world_char_stage:   discuss     # discuss / review / approve
  plot_stage:         discuss     # discuss / review / approve
  writing_stage:      live        # live / approve / auto
  review_stage:       review      # review / approve / auto
  chapter_error_mode: retry3      # retry3 / stop / skip
  coherence_threshold: 80         # 低于此分触发重写

memory:
  hot_window_chapters: 5
  cold_chunk_size: 500

style_rules:
  inherit: cool_novel
  overrides:
    min_beat_per_chapter: 3
    hook_required: true
    protagonist_taboos:
      - "禁止无故虐主超过300字"
      - "金手指使用须符合设定上限"
    forbidden_content:
      - "禁止出现真实公司名称"
      - "禁止元引用"
```

---

## 十六、项目数据实体

```
Project（一个作品）
│
├── concept.json                    概念设定
│    书名 · 体裁 · 前提 · 基调 · 目标读者 · 总章数 · 主题列表
│
├── world.json                      世界观
│    时代设定 · 核心地理 · 战力/魔法体系 · 势力及其关系 · 科技/魔法背景
│
├── characters.json                 角色档案
│    核心人格层 · 当前状态 · 能力进化阶段 · 成长曲线设计
│    · 声音签名 · 绝对禁忌 · 关系网络
│
├── outline.json                    大纲
│    分卷分章细纲 · 核心爽点/反转/情感弧 · 全局伏笔映射表
│    · 剧情里程碑→角色成长绑定关系
│
├── style_formula.yaml              风格配置
│    体裁模板选择 · 写作公式参数 · 禁忌约束列表 · 创新豁免历史
│
├── progress.json                   进度追踪
│    章状态 · 字数 · 连贯性评分 · 重写次数 · 时间线日志 · 成本追踪
│
├── .storyforge_checkpoint.json     断点续写快照
│    当前阶段 · 已完成操作 · 待执行操作 · 各系统快照
│
├── inspiration_pool.json           灵感池（v1.2 新增）
│    所有阶段积累的灵感 · 分类 · 来源标记 · 关联元素 · 是否已被采用
│
├── creative_path_history.json      创意路径历史（v1.2 新增）
│    从初始意图到最终 Story DNA 的选择路径 · 每步的选择原因
│
└── chapters/                       章节文件
    ├── 001_死亡回档.md
    ├── 002_超脑觉醒.md
    └── ...
```

---

## 十七、创作工作流全景

```
作者输入意图 + 可选参考文本
        │
        ▼
  [风格沙盒] 测试风格参数 → 选定风格配置
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 1: 概念讨论  【协作门：discuss】   │
  │                                          │
  │  Creative Director ←→ 用户多轮讨论       │
  │  ┌──────────────────────────────────┐    │
  │  │        创意画布（交互探索）        │    │
  │  │  WhatIf树可视 · ♡偏好 · ✂剪枝     │    │
  │  │  ⟳重新发散 · ⊕手动添加 · ⊞合并   │    │
  │  └──────────────────────────────────┘    │
  │  产出：Story DNA + 创意路径选择历史       │
  │  灵感路由器：自动捕捉讨论中的新想法        │
  └─────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 2: 世界观与角色工坊  【discuss】   │
  │                                          │
  │  Worldbuilder ←→ 用户讨论世界观           │
  │  ┌──────────────────────────────────┐    │
  │  │        成长工坊                    │    │
  │  │  成长曲线协同设计                  │    │
  │  │  起点→转折点(绑定剧情)→代价→终点   │    │
  │  │  可视化曲线 · 剧情一致性自动检查    │    │
  │  └──────────────────────────────────┘    │
  │  产出：world.json + characters.json       │
  │        （含完整成长曲线设计）              │
  └─────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 3: 情节头脑风暴  【discuss】       │
  │                                          │
  │  Outliner ←→ 用户推敲大纲                 │
  │  ┌──────────────────────────────────┐    │
  │  │        分支模拟引擎                │    │
  │  │  "如果改了这个会怎样？"            │    │
  │  │  张力对比 · 伏笔影响 · 替代方案    │    │
  │  └──────────────────────────────────┘    │
  │  产出：outline.json + 全局伏笔映射表       │
  │        + 剧情里程碑→角色成长绑定关系       │
  └─────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 4: 逐章写作  【协作门：live】      │
  │                                          │
  │  每章循环：                               │
  │    [用户介入] Scene 规划评审              │
  │      调整顺序 · 增删Scene · 风格实验指定   │
  │    逐幕写作 → 用户实时审阅                │
  │      接受 → 下一幕                        │
  │      重写（附修改方向）                    │
  │      自己修改（自动建议SF_LOG标记）         │
  │      标记偏好 · 创新豁免申请               │
  │    Reviewer 三层审稿                      │
  │      Fact Guard（5项硬检+熔断）           │
  │      Narrative Guard（叙事建议+漂移检测）   │
  │      Style Guard（风格标签，豁免Scene除外） │
  │    StoryOS Agent 更新                     │
  │      扫描标记 · 对比预声明 · 级联传播      │
  │    MemoryOS + ReaderOS 更新               │
  │    [用户介入] 章节评审会                   │
  │      质量摘要 · 亮点不足讨论 · 偏好标记     │
  │      灵感路由器捕捉新想法                  │
  │                                          │
  │  灵感路由器全程监听，所有阶段产生的灵感自动归档 │
  └─────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 5: 全书诊断与修订  【review】      │
  │  五大类自动诊断 → P0/P1/P2 分级展示       │
  │  用户逐项决策：确认修复 / 跳过 / 替代方案   │
  └─────────────────────────────────────────┘
        │
        ▼
  STAGE 6: 多格式导出（Markdown / PDF / EPUB）
```

---

## 十八、产品价值总结

StoryForge 1.2 解决长篇小说创作的五个根本难题，**用户全程参与、全程掌控**：

1. **创意枯竭：** 套路库 + 四种变异操作 + 五个矛盾模板 + WhatIf 树 + 体裁融合器，不是"系统替你创意"，而是"系统帮你发散 84 个节点，你在创意画布中选择最心动的方向"。

2. **叙事失控：** 七类叙事资产显式追踪，跨资产关联自动级联，全局伏笔映射表让每个伏笔都有生命周期。分支模拟引擎让你随时试探"如果我改了这个会怎样"——不是"系统替你管理伏笔"，而是"你随时可以推演、对比、调整"。

3. **一致性崩塌：** 角色四层档案 + 成长曲线绑定剧情里程碑 + 信念变化严格门槛 + Fact Guard 五项硬检 + 连贯性评分。不是"系统铁面拒绝违规"，而是"系统标记问题，你来决定接受还是修改"。

4. **质量盲飞：** 七个读者体验指标 + 五维度连贯性评分 + 智能预警 + 章节评审会。不是"系统告诉你好不好"，而是"系统给你数据，你和 Reviewer 一起讨论怎么提升"。

5. **风格复用与创新平衡：** 三层风格控制 + 风格提炼 + 风格沙盒预览 + 创新豁免。不是"系统锁死你的风格"，而是"系统帮你守住风格底线，同时为经你批准的灵感突破留出空间"。
