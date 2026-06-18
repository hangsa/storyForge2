# StoryForge v1.7 Phase 1 — CreativeOS 引擎核心实现设计

> **日期:** 2026-06-18 | **状态:** 已批准 | **基于:** storyForge-design-v1.7-TRD.md

## 一、目标

实现 CreativeOS 7 引擎的后端核心，全部为纯 Python 模块，存储在 `backend/creative_os/`。引擎在上层被创意画布和 Creative Director Agent 调用（Phase 2），Phase 1 保证引擎本身可独立运行和测试。

## 二、架构原则

1. **CreativeOS 不依赖 StoryOS/MemoryOS/ReaderOS** — 仅依赖 ModelRouter、Embedder、trope_catalog.yaml、Prompt YAML
2. **确定性优先** — 7 引擎中 3 个纯粹确定性（Idea Pool / Trope Pool / Novelty Evaluator 3/4 维度）
3. **LLM 复用现有基础设施** — ModelRouter + BaseAgent.load_prompt() 模式
4. **文件即数据库** — 数据存储在 `<project_dir>/creative_os/` 下 JSON 文件

## 三、引擎间依赖关系

```
trope_catalog.yaml ──→ Trope Pool ──→ Novelty Evaluator
                    ──→ Mutation Engine
                    
Idea Pool (独立)

Contradiction Engine ──→ Novelty Evaluator

WhatIf Engine ──→ Novelty Evaluator

Genre Fusion Engine (独立，仅依赖 BFS 矩阵)
```

## 四、实现批次

### Batch 1: 基础设施 + 确定性引擎 (1d)

**`backend/creative_os/__init__.py`** — 导出所有引擎类和数据类型

**`backend/creative_os/idea_pool.py`** — IdeaPool 类
- 存储：`<project_dir>/creative_os/idea_pool.json`（JSON 数组）
- 方法：`add / list / get / update / delete / promote / archive / filter_by_element`
- 全确定性，零 LLM，零外部依赖
- 首次访问时自动创建空文件

**`backend/creative_os/trope_pool.py`** — TropePool 类
- 存储：从 `config/trope_catalog.yaml` 初始化为项目级 `trope_pool.json`
- 方法：`get_saturation / get_saturation_by_tags / match_tropes / list_categories / update_saturation / get_vector_index`
- 向量索引：加载时预计算标签嵌入（bge-m3），存储为 numpy 数组
- 全确定性，零 LLM

**`config/trope_catalog.yaml`** — 50+ 套路模板基线数据
- 结构：id / name / category / description / market_saturation / sub_tropes / common_combinations / novelty_penalty_weight

### Batch 2: 矛盾设定生成器 (1.5d)

**`backend/creative_os/contradiction_engine.py`**
- 5 个矛盾模板：能力×限制 / 永恒×消逝 / 身份×秘密 / 目标×代价 / 力量即弱点
- `expand(template, context)` → Tier 1 LLM 调用，返回 ContradictionExpansion
- `score_depth(text)` → 确定性正则评分（5 模板匹配 + 关键词加权），零 LLM
- `detect_templates(text)` → 正则检测文本中出现的矛盾模板 + 置信度

LLM 依赖：ModelRouter (Tier 1)，Prompt 路径 `prompts/creative/contradiction_expand.yaml`

### Batch 3: 新颖度评估器 (2d)

**`backend/creative_os/novelty_evaluator.py`**
- 主入口 `evaluate(content)` → NoveltyScore (total 0-100 + grade)
- 4 维加权计算：
  1. 市场饱和度 (30%)：Tier 3 LLM 提取标签 → TropePool 饱和度查询
  2. 套路相似度 (25%)：bge-m3 嵌入 → 余弦相似度（确定性）
  3. 矛盾深度 (25%)：调用 ContradictionEngine.score_depth()（确定性）
  4. 讨论潜力 (20%)：CONTROVERSY_KEYWORDS 字典匹配（确定性）
- `evaluate_node(node)` — WhatIf 节点轻量包装
- 可复现性：同一输入多次评分误差 < ±5 分（LLM 标签提取 temperature=0.3）

依赖：TropePool + ContradictionEngine + Embedder (bge-m3)
确定性占比：75%（3/4 维度零 LLM）

### Batch 4: 套路变异器 (1.5d)

**`backend/creative_os/mutation_engine.py`**
- 4 种操作：Inversion / Fusion / Escalation / Subversion
- `mutate(trope, op, context)` → Tier 1 LLM → MutationResult
- `fuse(trope_a, trope_b)` → Tier 1 LLM → MutationResult
- 输出：core_premise / core_conflict / novelty_hook / self_consistency_check

依赖：TropePool（获取套路信息），ModelRouter (Tier 1)

### Batch 5: 连续发散器 (2.5d)

**`backend/creative_os/whatif_engine.py`**
- 递归树：MAX_DEPTH=3, BREADTH=4 → 最大 84 节点
- `generate_root(premise)` → 根节点 WhatIfNode
- `expand_node(node, path_context)` → 生成 4 个子节点（懒惰加载）
- `precompute_leaves(node)` → Tier 3 预计算叶子节点
- `regenerate_node(node, tier)` → 指定 Tier 重新生成
- 约束规则（注入 Prompt）：子节点覆盖不同叙事维度 / 叶子聚焦"可写场景钩子"

依赖：NoveltyEvaluator（评估每个节点新颖度），ModelRouter (Tier 1/3)

### Batch 6: 体裁融合器 (1.5d)

**`backend/creative_os/genre_fusion_engine.py`**
- 7×7 兼容性矩阵（硬编码）：高/中/低
- `get_compatibility(genre_a, genre_b)` → str
- `compute_distance(genre_a, genre_b)` → BFS 距离
- `analyze_fusion(genre_a, genre_b, premise)` → Tier 1 LLM → FusionAnalysis
- 体裁距离 ≥ 3 时 Novelty Evaluator 获得 1.2× 加成

依赖：ModelRouter (Tier 1)

### Batch 7: Prompt 文件 (1d)

6 个 YAML 文件，遵循现有 `BaseAgent.load_prompt()` 格式：
- `prompts/creative/whatif_expand.yaml` — WhatIf 节点展开 (Tier 1/3)
- `prompts/creative/mutation_operation.yaml` — 变异操作 (Tier 1)
- `prompts/creative/contradiction_expand.yaml` — 矛盾模板展开 (Tier 1)
- `prompts/creative/genre_fusion.yaml` — 体裁融合分析 (Tier 1)
- `prompts/creative/trope_extraction.yaml` — 套路标签提取 (Tier 3)
- `prompts/creative/novelty_evaluation_llm.yaml` — 新颖度 LLM 辅助评估 (Tier 3)

每个 Prompt 格式：`system_prompt + user_prompt_template + output_format: {type: json}`

### Batch 8: 单元测试 (2d)

`tests/test_creative_os/` 目录，目标 ≥ 40 用例：
- `test_idea_pool.py` — CRUD + 筛选 + 边界情况
- `test_trope_pool.py` — 饱和度查询 + 标签匹配 + 向量索引
- `test_mutation_engine.py` — 4 操作 Prompt 模板验证
- `test_contradiction_engine.py` — 确定性评分正确性 + 模板检测
- `test_whatif_engine.py` — 树结构正确性 + 懒惰加载 + 深度/广度限制
- `test_genre_fusion_engine.py` — BFS 距离 + 兼容性矩阵
- `test_novelty_evaluator.py` — 4 维计算 + 可复现性 (3 次重复评估)

测试策略：确定性部分验证输出正确性；LLM 部分验证 Prompt 模板格式和输出 JSON schema（不实际调用 LLM）。

## 五、新增文件清单

```
backend/creative_os/
├── __init__.py                    # 模块导出
├── idea_pool.py                   # Batch 1 — 灵感种子库
├── trope_pool.py                  # Batch 1 — 套路模式库
├── mutation_engine.py             # Batch 4 — 套路变异器
├── contradiction_engine.py        # Batch 2 — 矛盾设定生成器
├── whatif_engine.py               # Batch 5 — 连续发散器
├── genre_fusion_engine.py         # Batch 6 — 体裁融合器
└── novelty_evaluator.py           # Batch 3 — 新颖度评估器

config/
└── trope_catalog.yaml             # Batch 1 — 50+ 套路模板

backend/prompts/creative/
├── whatif_expand.yaml             # Batch 7
├── mutation_operation.yaml        # Batch 7
├── contradiction_expand.yaml      # Batch 7
├── genre_fusion.yaml              # Batch 7
├── trope_extraction.yaml          # Batch 7
└── novelty_evaluation_llm.yaml    # Batch 7

tests/test_creative_os/
├── test_idea_pool.py              # Batch 8
├── test_trope_pool.py             # Batch 8
├── test_mutation_engine.py        # Batch 8
├── test_contradiction_engine.py   # Batch 8
├── test_whatif_engine.py          # Batch 8
├── test_genre_fusion_engine.py    # Batch 8
└── test_novelty_evaluator.py      # Batch 8
```

## 六、数据模型

所有模型定义在 `backend/models/creative_os.py`（新建），包含：
- `IdeaCategory` (Enum) / `Idea` / `Trope`
- `MutationOp` (Enum) / `MutationResult`
- `ContradictionTemplate` (Enum) / `ContradictionExpansion`
- `WhatIfNode`
- `FusionAnalysis`
- `NoveltyScore`

## 七、配置变更

`config/model_tiers.yaml` `agent_mapping` 节追加 `creative_director` 和 `character_designer` 映射（Phase 2 使用），`planner` 追加 3 个新任务映射。

## 八、不在范围内

- ❌ CreativeCanvasPage 前端
- ❌ Creative Director Agent
- ❌ 创意画布 API 端点
- ❌ 分支模拟引擎
- ❌ 语义预检 / 灵感路由器 / 风格沙盒 / 成长工坊 / 创新豁免
- 以上均为 Phase 2-4 内容
