# StoryForge — 长篇小说 AI 创作系统设计文档

> 综合 LibriScribe 的 Agent 分工架构 + ai-novel-lab 的细粒度写作规则约束 + AI-Novel-Writing-Assistant 的写作公式提炼能力 + 向量语义检索，设计的新一代长篇 AI 创作系统。

---

## 一、设计目标与核心原则

### 1.1 解决的核心痛点

| 痛点 | 来源项目 | StoryForge 方案 |
|---|---|---|
| 流程碎片，各模块孤立 | AI-Novel-Assistant | Conductor 统一编排，阶段门控串联 |
| 强体裁绑定，通用性差 | ai-novel-lab | YAML 外置写法规则，体裁可插拔 |
| 无上下文管理，长篇必失忆 | 三者共有 | 三层记忆架构 + 向量检索 |
| 缺连贯性保障机制 | AI-Novel-Assistant | 独立 Coherence Guard 守卫 Agent |
| 风格无法复用 | ai-novel-lab / LibriScribe | Style Engine 提炼 + 模板库 |
| 无真实大规模验证 | LibriScribe | 内置质量评分 + 多轮修订流水线 |

### 1.2 设计原则

- **工程化优先**：一切创作资源（设定、规则、摘要）都是可查询的结构化数据，而非散文。
- **分工原子化**：每个 Agent 职责单一，可单独替换/微调，不影响其他组件。
- **人机协作**：关键阶段设置"人工审核门"，作者保持最终控制权。
- **记忆分层**：不同时效的信息用不同存储介质，精准召回，不污染上下文。
- **可观测性**：所有 Agent 行为可追溯，连贯性评分实时可见。

---

## 二、系统整体架构

```
┌────────────────────────────────────────────┐
│                  用户层                     │
│  创作意图 · 风格样本 · 审核操作 · 进度监控  │
└──────────────────┬─────────────────────────┘
                   │
┌──────────────────▼─────────────────────────┐
│          Conductor（主控编排器）             │
│  状态机管理 · 阶段门控 · 人工审核点调度      │
└──────────────────┬─────────────────────────┘
                   │
┌──────────────────▼─────────────────────────┐
│         Style Engine（写法引擎）             │
│  体裁规则库 · YAML Prompt模板 · 风格提炼    │
└──────────────────┬─────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
  [概念生成]  [世界观构建]  [角色设计]   ← 前置三 Agent（一次性）
  [大纲规划]  [章节写作]   [编辑审校]   ← 核心写作循环 Agent
                            [摘要归档]   ← 后置 Agent
                   │
┌──────────────────▼─────────────────────────┐
│      Coherence Guard（连贯性守卫）           │
│  时间线校验 · 人物状态比对 · 伏笔追踪        │
└──────────────────┬─────────────────────────┘
                   │
┌──────────┬───────▼────────┬───────────────┐
│  L1 热记忆│   L2 温记忆    │   L3 冷记忆   │
│ 近5章全文 │ 卷级摘要树     │ 向量检索库    │
│ 状态快照  │ 人物关系图     │ BM25+语义混合 │
└──────────┴────────────────┴───────────────┘
                   │
        持久化存储（PostgreSQL + Qdrant + Git）
```

---

## 三、核心组件详细设计

### 3.1 Conductor — 主控编排器

Conductor 是整个系统的"大脑"，负责驱动状态机，控制 Agent 的调用顺序和条件分支。

#### 3.1.1 创作阶段状态机

```
INIT
  → CONCEPT_GEN        （概念生成）
  → [人工审核门 1]
  → WORLDBUILDING       （世界观构建）
  → CHARACTER_DESIGN    （角色设计）
  → [人工审核门 2]
  → OUTLINE_PLANNING    （大纲规划）
  → [人工审核门 3]
  ↓
CHAPTER_LOOP（每章循环）:
  → CHAPTER_WRITE       （章节写作）
  → COHERENCE_CHECK     （连贯性守卫检查）
    ├── PASS → EDIT_REVIEW（编辑审校）
    └── FAIL → CHAPTER_WRITE（重写，最多3次）
  → SUMMARY_ARCHIVE     （摘要归档 + 记忆更新）
  → [可选人工审核门]
  → 下一章 / END
  ↓
MANUSCRIPT_EXPORT（导出）
```

#### 3.1.2 阶段门控配置（YAML）

```yaml
# conductor_config.yaml
gates:
  concept_approval: prompt      # prompt=人工审核 / auto=自动通过 / skip=跳过
  worldbuild_review: auto
  outline_review: prompt
  chapter_writing: auto
  chapter_error_mode: retry3    # retry3=重试3次 / stop=停止 / skip=跳过
  coherence_threshold: 80       # 连贯性评分低于80分触发重写
  formatting: auto
  output_format: markdown       # markdown / pdf / epub
```

#### 3.1.3 断点续写

Conductor 维护 `.storyforge_status.json`，记录每章的完成状态（`pending` / `writing` / `review` / `done`），中断后可精确从断点继续，不丢失已完成内容。

```json
{
  "project_id": "my_novel_001",
  "current_stage": "CHAPTER_LOOP",
  "current_chapter": 23,
  "chapters": {
    "1": {"status": "done", "word_count": 4821, "coherence_score": 92},
    "22": {"status": "done", "word_count": 5102, "coherence_score": 88},
    "23": {"status": "writing", "word_count": 0, "coherence_score": null}
  }
}
```

---

### 3.2 Style Engine — 写法引擎

Style Engine 是从 AI-Novel-Writing-Assistant 的"写作公式模块"演化而来的核心创新，负责将"如何写"系统化。

#### 3.2.1 写法规则的三层结构

```
Style Engine
├── L1 体裁层（Genre Layer）
│   ├── 爽文.yaml
│   ├── 严肃文学.yaml
│   ├── 悬疑推理.yaml
│   ├── 奇幻.yaml
│   └── 科幻.yaml
│
├── L2 写作公式层（Formula Layer）
│   ├── 句式模板（短句冲击 / 长句铺垫）
│   ├── 情绪节奏模板（压抑→爆发→收获）
│   ├── 装逼打脸公式
│   ├── 对话节奏公式
│   └── 环境描写公式
│
└── L3 禁忌约束层（Constraint Layer）
    ├── 全局禁忌（禁止元引用 / 禁止虐主）
    ├── 人物一致性约束（金手指不可随意削弱）
    └── 体裁特有禁忌
```

#### 3.2.2 风格提炼功能（Style Extractor）

这是 AI-Novel-Writing-Assistant 独有但未落地的能力，在 StoryForge 中完整实现：

```python
class StyleExtractor:
    """
    从用户上传的参考文本中提取写作公式，
    生成可复用的 YAML 规则模板。
    """
    def extract(self, sample_texts: list[str]) -> StyleFormula:
        # 1. 句式分析：平均句长、短句占比、感叹句密度
        # 2. 节奏分析：段落长度分布、对话/叙述比例
        # 3. 词汇分析：专业词密度、口语化程度
        # 4. 结构分析：每章爽点位置分布
        # 5. 输出 YAML 规则文件
        pass
```

提取结果示例（爽文风格）：

```yaml
# extracted_style_xianxia_cool.yaml
name: "玄幻爽文风格"
extracted_from: "user_samples/"
sentence_style:
  avg_length: 18          # 平均句长（字数）
  short_ratio: 0.65       # 短句（≤10字）占比
  exclamation_density: 0.03
rhythm:
  paragraph_max_chars: 200
  dialog_ratio: 0.40      # 对话占全章比例
  action_density: "high"  # 动作描写密度
power_fantasy:
  coolness_beat_per_chapter: 3   # 每章小爽点数
  climax_position: 0.85          # 大高潮在章节中的位置
  pacing: "fast"
vocabulary:
  tech_term_density: 0.02        # 专业词汇密度
  colloquial_level: "medium"
constraints:
  - "禁止虐主超过200字"
  - "反派必须在3章内被反制"
  - "主角金手指不可削弱"
  - "禁止元引用（引用章节号）"
```

#### 3.2.3 Prompt 模板系统（继承 LibriScribe）

15 个 Agent 各有独立 YAML 模板，不需改代码就能定制 AI 人格：

```yaml
# prompts/templates/chapter_writer_xianxia.yaml
name: "玄幻爽文写作专家"
cost_tier: "high"
settings:
  max_tokens: 6000
  min_words: 4000
  suggested_models:
    - "claude-opus-4-6"
    - "deepseek-chat"
template: |
  你是一位专业的玄幻爽文写作专家，擅长创作高爽点、快节奏的网络小说。

  ## 本章任务
  - 章节编号：{chapter_number}
  - 章节标题：{chapter_title}
  - 核心爽点：{core_beat}
  - 情绪弧线：{emotion_arc}

  ## 上下文
  ### 前情摘要（最近3章）
  {recent_summary}

  ### 本章细纲
  {chapter_outline}

  ### 登场人物状态
  {character_states}

  ### 活跃伏笔
  {active_hooks}

  ### 写作规则
  {style_rules}

  ## 要求
  - 字数：不少于 {min_words} 字
  - 每章至少 3 个小爽点，1 个大高潮
  - 结尾必须留钩子，引导读者继续
  - 多用短句，节奏紧凑
  - 禁止出现：{constraints}

  请直接输出章节正文，不要包含任何说明或注释。
```

---

### 3.3 七大专职 Agent

继承 LibriScribe 的分工思想，并增加了 Coherence Guard 和 Summary Archiver：

#### Agent 1: ConceptAgent — 概念生成

**输入**：用户的创作意图（一句话到一段话）
**输出**：`concept.json`

```json
{
  "title": "代码天才重生记",
  "genre": "都市重生·科技爽文",
  "premise": "顶级程序员意外重生，携带未来十年技术记忆...",
  "tone": "快节奏·高爽感·技术流",
  "target_audience": "18-35岁技术从业者",
  "total_chapters": 100,
  "themes": ["逆袭", "技术与人性", "商业战争"]
}
```

---

#### Agent 2: WorldbuilderAgent — 世界观构建

**输入**：`concept.json`
**输出**：`world.json`（按体裁生成不同维度）

```json
{
  "time_setting": "2018-2028",
  "geography": {"tech_hubs": ["京州市", "临安市", "深海市"]},
  "power_system": {
    "name": "程序员修仙体系",
    "levels": ["码农(练气)", "工程师(筑基)", "架构师(金丹)", "CTO(化神)"]
  },
  "factions": [
    {"name": "云腾帝国", "type": "电商+金融", "role": "初始对立方"},
    {"name": "巅峰智能", "type": "AI+量子", "role": "主角阵营"}
  ],
  "tech_background": "移动互联末期到奇点降临",
  "forbidden_real_names": true,
  "alias_map": {"阿里/腾讯混合": "云腾", "字节": "烽火", "谷歌": "天际"}
}
```

---

#### Agent 3: CharacterAgent — 角色设计

**输入**：`concept.json` + `world.json`
**输出**：`characters.json`（结构化多维人物档案）

```json
{
  "protagonist": {
    "name": "林峰",
    "age": 28,
    "archetype": "重生者·技术奇才",
    "core_trait": "外冷内热，拒绝成神选择成人",
    "golden_finger": "超脑黑客·绝对理智·万物代码化",
    "anchor": "苏晓晓（唯一能让他退出超频状态的人）",
    "growth_arc": "底层码农 → 科技帝国掌舵者 → 星际探索者",
    "taboos": ["不可无故虐主", "金手指设定不可削弱"],
    "voice": "冷静克制，偶尔毒舌，技术碾压时话少而精"
  },
  "characters": [...]
}
```

---

#### Agent 4: OutlinerAgent — 大纲规划

**输入**：`concept.json` + `world.json` + `characters.json`
**输出**：`outline.json`（分卷+分章细纲）

大纲设计要解决的核心问题：
- 全书爽点密度分布（防止前紧后松）
- 伏笔埋设与收回的章节映射
- 人物弧线的完整闭环
- 卷与卷之间的节奏变化

```json
{
  "volumes": [
    {
      "volume_id": 1,
      "title": "潜龙出渊",
      "chapter_range": [1, 20],
      "arc_theme": "职场逆袭·建立基业",
      "key_hooks": ["重生觉醒", "碾压面试", "超脑升级"],
      "chapters": [
        {
          "chapter_id": 1,
          "title": "死亡回档",
          "core_beat": "重生觉醒·获得超脑",
          "emotion_arc": "压抑→震撼→兴奋",
          "key_events": ["猝死重生", "照镜确认", "激活超脑", "刷完题库"],
          "foreshadowing": ["超脑来源之谜"],
          "payoff": null,
          "min_words": 4500
        }
      ]
    }
  ],
  "global_foreshadowing_map": {
    "超脑真相": {"planted": 1, "payoff": 48},
    "暗物质危机": {"planted": 15, "payoff": 50}
  }
}
```

---

#### Agent 5: ChapterWriterAgent — 章节写作（核心）

这是系统最关键的 Agent，每次写作前必须执行完整的上下文组装协议：

**写作前上下文组装（来自 ai-novel-lab 的 Phase 1 精髓）**：

```python
class ChapterWriterAgent:
    def build_context(self, chapter_id: int) -> WritingContext:
        # Step 1: 热记忆 - 直接读取（无需检索）
        hot = self.memory_l1.get(
            recent_chapters=5,
            current_outline=chapter_id,
            character_states="snapshot",
            active_hooks="all"
        )

        # Step 2: 温记忆 - 摘要树查询
        warm = self.memory_l2.get(
            chapter_summary_tree="current_volume",
            relationship_graph="latest",
            timeline="full"
        )

        # Step 3: 冷记忆 - 向量语义检索（关键创新）
        cold = self.memory_l3.semantic_search(
            queries=[
                f"第{chapter_id}章涉及人物的最近状态",
                f"本章核心道具/地点的历史描写",
                f"本章爽点类型的成功案例段落"
            ],
            top_k=5,
            filter={"doc_type": ["chapter", "world", "character"]}
        )

        # Step 4: 拼装最终 prompt
        return WritingContext(
            chapter_outline=self.outline.get(chapter_id),
            style_rules=self.style_engine.get_rules(),
            hot_memory=hot,
            warm_summary=warm,
            retrieved_refs=cold,
            constraints=self.style_engine.get_constraints()
        )
```

**写作规范约束（来自 ai-novel-lab 精髓，通用化改造）**：

```yaml
# 通用写作规范（可按体裁覆盖）
writing_rules:
  min_words_per_chapter: 4000
  mandatory_elements:
    - "章节结尾必须有 Hook（钩子）"
    - "每章至少 1 个关键人物塑造场景"
  forbidden:
    - "禁止吃书：严格遵守摘要中的已写内容"
    - "禁止元引用：不可在正文中引用章节编号"
    - "禁止断章：不可在关键悬念处强行结尾"
  genre_specific:
    cool_novel:
      - "主角必须在冲突后3章内完成反制"
      - "金手指使用须符合设定上限"
      - "反派需智商在线但运气极差"
```

---

#### Agent 6: EditorAgent — 编辑审校

**输入**：`chapter_draft.md`
**输出**：`chapter_reviewed.md` + `review_report.json`

审校维度：

```python
class EditorAgent:
    def review(self, draft: str, context: WritingContext) -> ReviewResult:
        checks = {
            "word_count": self.check_word_count(draft),        # ≥4000字
            "hook_present": self.check_hook(draft),             # 结尾钩子
            "beat_density": self.check_beat_density(draft),     # 爽点密度
            "style_consistency": self.check_style(draft),       # 风格一致性
            "repetition": self.check_repetition(draft),         # 重复词句
            "pacing": self.check_pacing(draft),                 # 节奏
        }
        return ReviewResult(checks, suggestions=self.generate_suggestions(checks))
```

---

#### Agent 7（守卫）: CoherenceGuard — 连贯性守卫

这是从 ai-novel-lab 的经验教训中提炼出的最重要组件，前三个项目都没有把它做成独立 Agent。

**五大检查项**：

```python
class CoherenceGuard:
    def check(self, chapter: str, context: WritingContext) -> CoherenceReport:
        results = {}

        # 1. 时间线一致性
        results["timeline"] = self.timeline_checker.check(
            chapter, context.timeline_snapshot
        )  # 检测：章节内时间戳是否与前文连续

        # 2. 人物状态一致性
        results["character_state"] = self.character_checker.check(
            chapter, context.character_states
        )  # 检测：人物的能力/伤势/位置/关系是否与前文一致

        # 3. 伏笔追踪
        results["foreshadowing"] = self.hook_tracker.check(
            chapter, context.active_hooks, context.outline_payoffs
        )  # 检测：是否引入了大纲未规划的新伏笔；是否遗漏了应收的伏笔

        # 4. 世界规则一致性
        results["world_rules"] = self.world_checker.check(
            chapter, context.world_json
        )  # 检测：是否违反了设定的世界规则（金手指上限等）

        # 5. 禁忌约束检测
        results["constraints"] = self.constraint_checker.check(
            chapter, context.style_rules.constraints
        )  # 检测：是否出现了真实人名、元引用等禁忌内容

        score = self.calculate_score(results)
        return CoherenceReport(score=score, issues=results, passed=score >= 80)
```

**评分机制**（参考 ai-novel-lab 的 73→93 分方法论）：

| 维度 | 权重 | 扣分规则 |
|---|---|---|
| 时间线连续性 | 25% | 每处断层 -5 分 |
| 人物状态一致 | 25% | 每处矛盾 -10 分 |
| 伏笔完整性 | 20% | 每个遗漏/意外 -5 分 |
| 世界规则一致 | 20% | 每处违规 -8 分 |
| 禁忌约束 | 10% | 每处违禁 -15 分 |

当评分低于 80 分，自动触发重写，并将问题清单注入下一次写作上下文。

---

#### Agent 8: SummaryArchiver — 摘要归档

每章写作完成后自动执行：

```python
class SummaryArchiver:
    def archive(self, chapter: str, chapter_id: int):
        # 1. 生成本章摘要（200-400字，突出关键事件/人物变化/新伏笔）
        summary = self.llm.summarize(chapter, style="key_events_only")

        # 2. 更新 L2 温记忆的摘要树
        self.memory_l2.update_chapter_summary(chapter_id, summary)

        # 3. 更新人物状态快照
        state_changes = self.extract_state_changes(chapter)
        self.memory_l2.update_character_states(state_changes)

        # 4. 更新伏笔档案（新增/收回）
        hook_changes = self.extract_hook_changes(chapter)
        self.memory_l2.update_hooks(hook_changes)

        # 5. 更新 L3 冷记忆的向量索引（增量更新）
        chunks = self.chunker.split(chapter, chunk_size=500, overlap=100)
        embeddings = self.embedder.embed(chunks)
        self.memory_l3.upsert(chapter_id, chunks, embeddings)

        # 6. 更新进度文件
        self.progress.mark_done(chapter_id, word_count=len(chapter))
```

---

### 3.4 三层记忆系统（核心创新）

这是 StoryForge 区别于所有现有项目的最关键设计。

#### L1 热记忆 — 滑动窗口

```python
class HotMemory:
    """
    始终保持在 LLM 上下文窗口内，无需检索，直接拼入 Prompt。
    容量约 20k tokens。
    """
    def get(self) -> dict:
        return {
            "recent_chapters_full": self.get_last_n_chapters(n=5),  # 5章全文
            "current_chapter_outline": self.current_outline,
            "character_states": self.character_snapshot,           # 所有人物当前状态
            "active_hooks": self.unfulfilled_hooks,                # 未收回的伏笔列表
            "recent_timeline": self.last_timeline_entry            # 最近时间节点
        }
```

#### L2 温记忆 — 压缩摘要树

```python
class WarmMemory:
    """
    全书已写内容的结构化摘要，按卷/章组织成树状结构。
    大约 10k tokens，作为全局导航图。
    """
    structure = {
        "volume_1": {
            "summary": "...",         # 卷级摘要（~200字）
            "chapters": {
                "ch_1": "...",        # 章级摘要（~100字）
                "ch_2": "...",
            }
        },
        "character_arcs": {...},      # 人物成长弧线摘要
        "relationship_graph": {...},  # 人物关系图（结构化）
        "timeline": [...],            # 全书时间轴（关键节点列表）
        "fulfilled_hooks": [...],     # 已收回的伏笔
        "active_hooks": [...]         # 未收回的伏笔（带预计收回章节）
    }
```

#### L3 冷记忆 — 向量检索库

这是三个参考项目都缺少的核心能力：

```python
class ColdMemory:
    """
    全书所有内容的向量化索引，支持语义检索。
    使用 Qdrant 作为向量数据库。
    """
    def __init__(self):
        self.qdrant = QdrantClient()
        self.embedder = SentenceTransformer("BAAI/bge-m3")  # 中英文双语
        self.bm25 = BM25Index()  # 关键词检索回退

    def semantic_search(self, query: str, top_k: int = 5,
                        filter: dict = None) -> list[Chunk]:
        """
        混合检索：向量语义 + BM25 关键词，RRF 融合排名。
        """
        # 语义检索
        query_vec = self.embedder.encode(query)
        semantic_results = self.qdrant.search(
            collection_name="novel_chunks",
            query_vector=query_vec,
            query_filter=filter,
            limit=top_k * 2
        )

        # BM25 关键词检索
        keyword_results = self.bm25.search(query, top_k=top_k * 2)

        # RRF 融合
        return self.rrf_merge(semantic_results, keyword_results)[:top_k]

    def xref_query(self, entity_name: str) -> list[Co-occurrence]:
        """
        交叉引用查询：找出某个人物/道具/地点在全书中的所有出现。
        类似 LibriScribe 的 xref 功能，但升级为语义层面。
        """
        return self.cross_reference_graph.query(entity_name)
```

**分块策略**：

```python
class NovelChunker:
    """
    小说专用分块器，不按固定字数切割，而是按语义单元。
    """
    def split(self, chapter: str) -> list[Chunk]:
        segments = []

        # 1. 场景级分块（按空行、地点变化切割）
        scenes = self.split_by_scene(chapter)

        # 2. 对话段落独立成块（保持完整性）
        for scene in scenes:
            dialogs = self.extract_dialogs(scene)
            narrations = self.extract_narrations(scene)
            segments.extend(dialogs + narrations)

        # 3. 每块附加元数据
        return [Chunk(
            text=seg,
            metadata={
                "chapter_id": self.current_chapter,
                "doc_type": "chapter",
                "characters_mentioned": self.extract_characters(seg),
                "locations_mentioned": self.extract_locations(seg),
                "is_dialog": seg.is_dialog,
                "emotion_tone": self.classify_tone(seg)
            }
        ) for seg in segments]
```

---

### 3.5 进度追踪系统（来自 ai-novel-lab 精髓）

`progress.json` — 实时进度追踪，继承 ai-novel-lab 的 `progress.md` 思想，但结构化为 JSON：

```json
{
  "novel_title": "代码天才重生记",
  "total_chapters": 100,
  "completed_chapters": 23,
  "total_words": 112450,
  "avg_words_per_chapter": 4889,
  "avg_coherence_score": 87.3,
  "chapters": [
    {
      "id": 1, "title": "死亡回档",
      "status": "done", "words": 4821,
      "coherence_score": 92, "rewrites": 0,
      "completed_at": "2026-01-15"
    },
    {
      "id": 23, "title": "巅峰前夜",
      "status": "done", "words": 5102,
      "coherence_score": 85, "rewrites": 1,
      "completed_at": "2026-02-10"
    }
  ],
  "writing_log": [
    {"date": "2026-02-10", "action": "完成第23章，连贯性评分85（第1次重写后通过）"}
  ]
}
```

---

## 四、数据模型设计

### 4.1 核心实体关系

```
Project
  ├── ConceptDoc (1:1)
  ├── WorldDoc (1:1)
  ├── CharacterDoc[] (1:N)
  ├── OutlineDoc (1:1)
  │    └── ChapterOutline[] (1:N)
  ├── Chapter[] (1:N)
  │    ├── ChapterDraft (写作中间产物)
  │    ├── CoherenceReport (连贯性报告)
  │    └── ChapterSummary (归档摘要)
  ├── StyleFormula (1:1) — 写法公式
  ├── MemorySnapshot (1:1) — 记忆快照
  └── ProgressLog[] (1:N)
```

### 4.2 人物档案 Schema（characters.json）

```json
{
  "character_id": "protagonist_001",
  "name": "林峰",
  "aliases": ["林大神", "超脑宿主"],
  "role": "protagonist",
  "archetype": "重生者·技术奇才",
  "appearance": "28岁，清瘦，眼神锐利",
  "personality": {
    "core_traits": ["冷静克制", "高度理性", "有底线的复仇"],
    "growth_curve": "冷漠 → 重拾人性 → 拒绝成神"
  },
  "abilities": {
    "golden_finger": "超脑黑客",
    "limits": ["每日超频不超过4小时", "情感锚点为苏晓晓"],
    "evolution_stages": [
      {"chapter": 1, "level": "一阶·绝对理智"},
      {"chapter": 15, "level": "二阶·万物互联"},
      {"chapter": 30, "level": "三阶·量子领域"}
    ]
  },
  "relationships": {
    "苏晓晓": {"type": "romantic", "anchor": true},
    "张伟": {"type": "antagonist→redeemed", "arc_end": 47}
  },
  "voice": "克制，偶尔毒舌，技术碾压时话少而精",
  "taboos": ["不可无故虐主", "金手指不可无缘由削弱"],
  "current_state": {
    "location": "临安市·巅峰智能总部",
    "health": "正常",
    "key_possessions": ["玉佩（父亲传家宝）"],
    "emotional_state": "事业巅峰，内心开始回归人性",
    "last_updated_chapter": 46
  }
}
```

---

## 五、多轮修订流水线

参考 ai-novel-lab 的"73→93分"迭代方法论，StoryForge 将修订自动化：

### 5.1 自动诊断

```python
class RevisionPipeline:
    def diagnose(self, project_id: str) -> DiagnosisReport:
        """
        全书质量诊断，分五大类问题。
        """
        all_chapters = self.load_all_chapters(project_id)
        coherence_reports = self.load_coherence_reports(project_id)

        return DiagnosisReport(
            timeline_issues=self.find_timeline_breaks(all_chapters),
            character_inconsistencies=self.find_char_issues(all_chapters),
            pacing_problems=self.analyze_pacing(all_chapters),
            repetition_density=self.find_repetitions(all_chapters),
            beat_distribution=self.analyze_beat_distribution(all_chapters),
            overall_score=self.calculate_overall_score(coherence_reports)
        )
```

### 5.2 修订优先级（P0-P2 波次，来自 ai-novel-lab 方法论）

```
P0（阻断级，必须修复）:
  - 人物死亡后复活
  - 金手指能力前后矛盾
  - 时间线逻辑断裂

P1（质量级，应该修复）:
  - 重复短语超过阈值
  - 人物工具化（某角色多章无独立场景）
  - 爽点分布不均（连续3章无爽点）
  - 悬而未决的伏笔（超过计划收回章节）

P2（优化级，可选修复）:
  - 过渡章节节奏生硬
  - 对话/叙述比例失衡
  - 场景描写密度不足
```

### 5.3 修复策略

- **时间线修复**：自动在相关章节插入时间标记
- **人物工具化**：由 ChapterWriterAgent 为该人物补写 1-2 个独立场景
- **重复短语**：提取词频表，由 EditorAgent 批量替换
- **节奏修复**：必要时生成过渡章节（如 ai-novel-lab 的"新增10章过渡章"方案）

---

## 六、技术栈选型

| 层次 | 组件 | 技术选型 | 理由 |
|---|---|---|---|
| 编排框架 | Conductor | Python + asyncio | 轻量、可控、易调试 |
| Agent 框架 | 七大 Agent | 自实现（不依赖 LangChain） | 避免黑盒，更好控制 |
| LLM 接入 | 统一客户端 | OpenRouter（多模型回退） | 继承 LibriScribe 成本优化 |
| 向量数据库 | L3 冷记忆 | Qdrant（本地部署） | 开源、高性能、支持元数据过滤 |
| 向量模型 | 文本嵌入 | BAAI/bge-m3 | 中英文双语、效果最佳 |
| 关键词检索 | BM25 回退 | rank-bm25 | 兼容 LibriScribe 的回退策略 |
| 关系数据库 | 结构化存储 | PostgreSQL | 角色/大纲/进度等结构化数据 |
| 版本控制 | 章节文件 | Git | 完整的写作历史和回滚 |
| 前端 | Web UI | Next.js + React | 继承 AI-Novel-Assistant 的 UI 思路 |
| 导出 | 多格式 | Pandoc | Markdown → PDF/EPUB/DOCX |
| 成本追踪 | LLM 花费 | llm_usage.jsonl | 继承 LibriScribe |

---

## 七、项目目录结构

```
storyforge/
├── conductor/
│   ├── state_machine.py          # 创作阶段状态机
│   ├── gate_controller.py        # 人工审核门控制
│   └── checkpoint.py             # 断点续写管理
│
├── style_engine/
│   ├── extractor.py              # 写法公式提炼（来自 AI-Novel-Assistant）
│   ├── validator.py              # 风格一致性验证
│   └── templates/                # YAML 体裁模板库
│       ├── cool_novel.yaml
│       ├── literary.yaml
│       ├── mystery.yaml
│       └── scifi.yaml
│
├── agents/
│   ├── base_agent.py             # Agent 基类（统一 LLM 调用 + 成本追踪）
│   ├── concept_agent.py
│   ├── worldbuilder_agent.py
│   ├── character_agent.py
│   ├── outliner_agent.py
│   ├── chapter_writer_agent.py   # 核心 Agent
│   ├── editor_agent.py
│   ├── coherence_guard.py        # 连贯性守卫（最关键）
│   └── summary_archiver.py
│
├── memory/
│   ├── hot_memory.py             # L1：滑动窗口
│   ├── warm_memory.py            # L2：压缩摘要树
│   ├── cold_memory.py            # L3：向量检索
│   └── chunker.py                # 小说专用分块器
│
├── prompts/
│   └── templates/                # 15 个 Agent 的 YAML Prompt 模板
│       ├── concept_generator.yaml
│       ├── worldbuilder.yaml
│       ├── character_generator.yaml
│       ├── outliner.yaml
│       ├── chapter_writer_cool.yaml
│       ├── chapter_writer_literary.yaml
│       ├── editor.yaml
│       ├── coherence_checker.yaml
│       └── summarizer.yaml
│
├── storage/
│   ├── models.py                 # PostgreSQL 数据模型
│   ├── vector_store.py           # Qdrant 向量存储
│   └── file_manager.py           # 章节文件管理
│
├── revision/
│   ├── diagnostic.py             # 全书诊断
│   └── repair_pipeline.py        # P0/P1/P2 修复流水线
│
├── api/                          # FastAPI 后端
├── web/                          # Next.js 前端
│
├── projects/                     # 用户项目数据
│   └── {project_id}/
│       ├── concept.json
│       ├── world.json
│       ├── characters.json
│       ├── outline.json
│       ├── progress.json
│       ├── .storyforge_status.json
│       ├── llm_usage.jsonl
│       └── chapters/
│           ├── 001_死亡回档.md
│           └── ...
│
├── examples/                     # 示例配置
│   ├── cool_novel_config.yaml
│   └── literary_novel_config.yaml
│
├── AGENTS.md                     # Agent 操作指南（继承 ai-novel-lab 思路）
└── requirements.txt
```

---

## 八、Expert 配置文件示例

继承并增强 LibriScribe 的 Expert 模式：

```yaml
# examples/cool_novel_config.yaml
version: 2
project:
  name: 代码天才重生记
  genre: cool_novel                     # 直接指定体裁规则包
  style_sample: "samples/target_style/" # 上传参考文本，自动提炼写法公式
  total_chapters: 100
  min_words_per_chapter: 4500
  language: zh-CN

llm:
  provider: openrouter
  primary_model: anthropic/claude-opus-4-6
  fallback_chain:
    - deepseek/deepseek-chat
    - anthropic/claude-sonnet-4-6
  agent_models:
    chapter_writer: anthropic/claude-opus-4-6   # 写作用最强模型
    editor: anthropic/claude-sonnet-4-6          # 编辑用次强模型
    summarizer: deepseek/deepseek-chat           # 摘要用低成本模型

memory:
  hot_window_chapters: 5           # L1 热记忆保留最近几章全文
  warm_summary_depth: "full"       # L2 温记忆摘要粒度
  cold_chunk_size: 500             # L3 向量分块大小（字）
  cold_chunk_overlap: 100
  embedding_model: "BAAI/bge-m3"

coherence:
  check_enabled: true
  pass_threshold: 80               # 连贯性评分门槛
  max_rewrites: 3                  # 最多重写次数

workflow:
  concept_approval: prompt         # 人工审核
  outline_review: prompt           # 人工审核
  chapter_writing: auto
  coherence_check: auto
  chapter_error_mode: retry3
  output_format: markdown

style_rules:
  inherit: cool_novel              # 继承内置爽文规则
  overrides:
    min_beat_per_chapter: 3
    hook_required: true
    protagonist_taboos:
      - "禁止无故虐主超过 300 字"
      - "金手指使用须符合设定上限"
    forbidden_content:
      - "禁止出现真实公司名称"
      - "禁止元引用（引用章节编号）"
```

---

## 九、与参考项目的能力对比

| 能力 | AI-Novel-Assistant | ai-novel-lab | LibriScribe | **StoryForge** |
|---|:---:|:---:|:---:|:---:|
| Agent 分工架构 | ✗ | ✗ | ✓ | ✓✓ |
| 端到端流程自动化 | ✗ | ✓（单作品） | ✓ | ✓✓ |
| 写法公式提炼 | ✓（未落地） | ✗ | ✗ | ✓✓ |
| 细粒度写作规则 | ✗ | ✓（强体裁绑定） | △ | ✓✓（通用化） |
| 三层记忆系统 | ✗ | ✗（文件级） | ✗（BM25） | ✓✓ |
| 向量语义检索 | ✗ | ✗ | ✗（规划中） | ✓✓ |
| 连贯性守卫 Agent | ✗ | ✗（手动修复） | ✗ | ✓✓ |
| 多轮修订流水线 | ✗ | ✓（手动） | ✗ | ✓✓（自动化） |
| 体裁通用性 | △ | ✗ | ✓ | ✓✓ |
| 断点续写 | ✗ | ✗ | ✓ | ✓✓ |
| 成本追踪 | ✗ | ✗ | ✓ | ✓✓ |
| Web UI | ✓ | ✗ | ✗ | ✓ |

---

## 十、开发路线图

### Phase 1（MVP，4 周）
- [x] Conductor 状态机 + 基础 5 个 Agent
- [x] L1/L2 记忆系统（文件级）
- [x] 基础连贯性检查（关键词匹配）
- [x] YAML 写法规则系统
- [x] 进度追踪 + 断点续写

### Phase 2（8 周）
- [ ] L3 冷记忆 — Qdrant 向量检索接入
- [ ] 混合检索（BM25 + 语义，RRF 融合）
- [ ] Style Extractor（写法公式自动提炼）
- [ ] 完整连贯性守卫（五维检查）
- [ ] 自动修订流水线（P0-P2）

### Phase 3（12 周）
- [ ] Web UI（Next.js）
- [ ] 多格式导出（PDF / EPUB）
- [ ] 角色关系图可视化
- [ ] 时间线可视化
- [ ] 多人协作写作

---

*StoryForge — 让长篇创作从"靠记忆"变成"靠架构"。*
