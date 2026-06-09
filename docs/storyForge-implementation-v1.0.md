# StoryForge 3.1 — Creative Narrative Operating System
## 完整工程化设计文档

> v3.1 变更摘要（相对于 v3.0）：
> - 补全所有审查发现的未定义函数（`_genre_distance`、`_ref_key_to_registry`、`_find_matching_log`、Fact Guard 检查方法、Style Engine 禁忌匹配、`_match_forbidden`）
> - 修正 `_calc_contradiction_depth` 噪声正则
> - 修正 ReaderOS `moral_ambiguity` 校准系数
> - 修正 ContextCache `char_states` 为 per-scene 缓存
> - 新增 Fact Guard log 格式校验
> - 新增 Reviewer 状态漂移检测
> - Character State Machine 增加 `accumulated_evidence` 和 `relationship_transformation` 触发类型
> - 上调 Narrative Guard Token 估算至 9K
>
> v3.0 变更摘要（相对于 v2.0）：
> - **P0**：`<log>` 标签机制替代隐含变化 LLM 盲猜；Fact Guard 熔断器；所有未定义函数已补全
> - **P1**：ReaderOS 完全去 LLM 化（公式计算）；模型分层策略 & Token 预算；Context 缓存复用
> - **P2**：跨 Registry 强制外键；Genre Fusion Engine 完整设计；Style Engine 重新集成；断点续写粒度定义；L0 更新机制定义

---

## 核心理念

**v1.0 解决了：如何管理小说**
**v2.0 解决了：如何创造爆款小说**
**v3.0 解决了：如何在工程上可靠地、经济地创造爆款小说**

三条独立能力链，对应三个核心目标：

| 核心目标 | 能力链 | 负责系统 |
|---|---|---|
| 构思足够发散、足够创新 | Creative Chain | CreativeOS + Creative Director |
| 剧情足够反转、足够抓人 | Narrative Chain | StoryOS + ReaderOS + Scene Engine + Style Engine |
| 角色/剧情高度一致 | Consistency Chain | MemoryOS + State Machines |

---

## 一、系统总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                            用户层                                 │
│         意图输入 · 风格样本 · 审核操作 · 进度监控 · 熔断介入        │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                 Conductor（主控编排器）                            │
│   流程状态机 · 阶段门控 · OS 间仲裁 · 断点续写 · 熔断降级调度       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
  │CreativeOS│  │   StoryOS    │  │  ReaderOS    │
  │ 创意引擎 │  │ 叙事资产内核  │  │ 读者模型引擎  │
  └──────────┘  └──────────────┘  └──────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
  │MemoryOS  │  │  Scene Engine│  │ Style Engine │
  │ 记忆系统 │  │  写作执行层   │  │  风格约束层   │
  └──────────┘  └──────────────┘  └──────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                      Agent 层（6个）                              │
│  Conductor · Creative Director · Planner                         │
│  Writer · Reviewer · StoryOS Agent                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、CreativeOS — 创意引擎（完整工程化）

### 2.1 整体结构

```
CreativeOS
├── Idea Pool          # 灵感种子库
├── Trope Pool         # 套路模式库
├── Mutation Engine    # 套路变异器
├── Contradiction Engine  # 矛盾设定生成器
├── WhatIf Engine      # 连续发散器
├── Genre Fusion Engine   # 体裁融合器（v3.0 补全设计）
└── Novelty Evaluator  # 新颖度评估器（v3.0 补全所有未定义函数）
```

### 2.2 Idea Pool & Trope Pool（数据层）

**Idea Pool Schema：**
```json
{
  "id": "idea_042",
  "content": "重生者发现自己是NPC",
  "tags": ["重生", "身份颠覆", "元叙事"],
  "source": "user_input",
  "novelty_score": 82,
  "used_count": 0,
  "created_at": "2025-01-01"
}
```

**Trope Pool Schema：**
```json
{
  "id": "trope_007",
  "name": "系统文",
  "category": "金手指",
  "core_mechanic": "主角获得外挂系统辅助成长",
  "market_saturation": 0.91,
  "sub_variants": ["签到系统", "商城系统", "属性面板"],
  "fusion_potential": ["克苏鲁", "末世", "直播", "刑侦"],
  "anti_patterns": ["系统消失", "系统背叛宿主", "系统是AI"]
}
```

**`market_saturation` 说明：**

初始值人工标注，标注标准：由至少 2 名标注员根据"该套路在过去 12 个月头部网文中的出现频率"独立打分（0-1），取平均值。后续通过爬取网文平台新书标签频率做半自动更新，每季度一次。低于 0.3 的套路标记为"蓝海"，高于 0.8 的标记为"红海"。

### 2.3 Mutation Engine（套路变异器）

**实现方式：Few-shot Prompt Chain**

四种变异操作：

```python
class VariationOp(Enum):
    INVERSION   = "逆转核心预设"      # 系统文→系统是骗局
    FUSION      = "跨体裁嫁接"        # 重生+刑侦=凶手也重生了
    ESCALATION  = "矛盾升维"          # 主角无敌→无敌但无法伤害任何人
    SUBVERSION  = "读者预期打破"       # 反派转变为守护者
```

**Mutation Engine Prompt：**

```yaml
# prompts/creative/mutation_engine.yaml
system: |
  你是一个专业的网文创意变异器。给定一个基础套路，
  你必须使用指定的变异操作生成新颖的变体。
  要求：变异后的设定必须保持内在逻辑自洽。

few_shots:
  - base_trope: "系统文（主角获得外挂系统）"
    op: INVERSION
    output:
      variant: "系统其实在污染宿主意识，每次使用都在侵蚀人格"
      core_conflict: "主角越强大越不像自己"
      novelty_hook: "力量的代价是自我消亡"

  - base_trope: "重生文（主角重返过去）"
    op: FUSION
    fuse_with: "刑侦悬疑"
    output:
      variant: "主角重生，但凶手也重生了，且知道主角重生"
      core_conflict: "两个掌握未来信息的人的博弈"
      novelty_hook: "信息对称的猫鼠游戏"

template: |
  基础套路：{base_trope}
  变异操作：{op}
  {fusion_target}
  
  请生成3个不同程度的变异版本，每个包含：
  - variant（变异后的核心设定，1句话）
  - core_conflict（由此产生的核心矛盾）
  - novelty_hook（对读者的新奇钩子）
  - self_consistency_check（设定是否自洽，yes/no + 原因）
  
  以JSON数组输出，不要包含任何解释文字。
```

### 2.4 Contradiction Engine（矛盾设定生成器）

五个矛盾模板：

```python
class ContradictionEngine:
    """
    通过结构化矛盾模板生成强设定。
    不依赖 LLM 自由发挥，而是填充矛盾模板。
    """
    
    CONTRADICTION_TEMPLATES = [
        "{power} × {hard_limit}",           # 能力矛盾
        "{eternal_trait} × {decay}",        # 永恒×消逝
        "{identity_a} × {secret_identity_b}", # 身份矛盾
        "{goal} × {cost_is_goal_itself}",    # 目标悖论
        "{strength} × {weakness_is_strength}", # 力量即弱点
    ]
    
    def generate(self, concept: dict, n: int = 10) -> list[Contradiction]:
        power_words = concept.get("power_system_keywords", [])
        
        candidates = []
        for template in self.CONTRADICTION_TEMPLATES:
            filled = self.llm.fill_template(
                template=template,
                context=concept,
                n=3
            )
            candidates.extend(filled)
        
        # 自洽性检查
        valid = [c for c in candidates if c.self_consistent]
        
        # 按 Novelty Evaluator 得分排序
        return sorted(valid, key=lambda x: x.novelty_score, reverse=True)[:n]
```

**输出示例：**
```json
{
  "id": "contra_031",
  "template_used": "{power} × {hard_limit}",
  "contradiction": "主角拥有预知未来的能力，但只能预知他人的死亡，无法预知自己的",
  "core_tension": "救得了所有人却救不了自己",
  "self_consistent": true,
  "story_potential": "high",
  "novelty_score": 87
}
```

### 2.5 WhatIf Engine（连续发散器）

```python
class WhatIfEngine:
    def expand(self, seed: str, depth: int = 3, breadth: int = 4) -> WhatIfTree:
        """
        递归发散，生成 WhatIf 树。
        depth=3, breadth=4 → 最多 4+16+64=84 个节点
        """
        root = WhatIfNode(premise=seed, depth=0)
        self._expand_node(root, depth, breadth)
        return WhatIfTree(root=root)
    
    def _expand_node(self, node: WhatIfNode, remaining_depth: int, breadth: int):
        if remaining_depth == 0:
            return
        
        children_premises = self.llm.generate_whatif(
            parent=node.premise,
            n=breadth,
            constraint="每个假设必须是父假设的直接逻辑推论，不能跳跃"
        )
        
        for premise in children_premises:
            child = WhatIfNode(premise=premise, depth=node.depth + 1)
            node.children.append(child)
            self._expand_node(child, remaining_depth - 1, breadth)
```

### 2.6 Genre Fusion Engine（v3.0 完整补全）

v2.0 仅在目录结构中列出了该模块。v3.0 完整定义其算法和接口。

**设计原理：** 爆款往往来自两个看似不相关体裁的深度嫁接。Genre Fusion 不是简单的"添加元素"，而是在两个体裁的**结构特征**层面进行融合——找出它们的矛盾点和共振点。

```python
class GenreFusionEngine:
    """
    体裁融合器。不是简单叠加标签，而是在结构层面融合。
    """
    
    # 每个体裁的结构特征定义
    GENRE_STRUCTURES = {
        "重生": {
            "core_mechanic": "主角携带未来信息回到过去",
            "narrative_drive": "预知 + 改变命运",
            "reader_promise": "弥补遗憾、逆袭打脸",
            "compatible_with": ["商战", "刑侦", "修仙", "娱乐圈"],
            "conflict_with": ["日常", "慢热"]  # 重生文天然要求有冲突
        },
        "系统文": {
            "core_mechanic": "量化的成长路径 + 任务奖励",
            "narrative_drive": "升级 + 解锁",
            "reader_promise": "稳定成长、可控变强",
            "compatible_with": ["末世", "无限流", "修仙", "游戏"],
            "conflict_with": []
        },
        "刑侦悬疑": {
            "core_mechanic": "信息不对称 + 证据链推进",
            "narrative_drive": "线索→推理→反转→真相",
            "reader_promise": "烧脑、反转、正义",
            "compatible_with": ["重生", "灵异", "谍战"],
            "conflict_with": ["系统文"]  # 系统给答案会破坏悬疑
        }
        # ... 更多体裁定义
    }
    
    def fuse(self, primary: str, secondary: str) -> FusionResult:
        """
        执行体裁融合，输出融合方案和风险评估。
        
        步骤：
        1. 加载两个体裁的结构特征
        2. 检查兼容性矩阵
        3. 如果有 conflict_with 关系，LLM 设计化解方案
        4. 生成融合 mechanic（嫁接点）
        5. 评估融合后的读者承诺是否冲突
        """
        p = self.GENRE_STRUCTURES[primary]
        s = self.GENRE_STRUCTURES[secondary]
        
        # 兼容性检查
        if secondary in p.get("conflict_with", []):
            # 存在天然冲突，需要 LLM 设计化解
            resolution = self._design_conflict_resolution(p, s)
        else:
            resolution = None
        
        # 生成融合 mechanic
        fusion_mechanic = self.llm.generate_fusion(
            primary_genre=primary,
            secondary_genre=secondary,
            primary_structure=p,
            secondary_structure=s,
            conflict_resolution=resolution
        )
        
        # 读者承诺冲突检测
        promise_conflict = self._check_promise_conflict(p, s, fusion_mechanic)
        
        return FusionResult(
            primary=primary,
            secondary=secondary,
            fusion_mechanic=fusion_mechanic,
            conflict_resolution=resolution,
            promise_conflict_warning=promise_conflict if promise_conflict else None,
            novelty_boost=self._estimate_novelty_boost(primary, secondary)  # 体裁越远新颖度加成越大
        )
    
    def _design_conflict_resolution(self, primary, secondary) -> str:
        """
        当两个体裁存在天然冲突时，LLM 设计化解方案。
        例如：系统文 × 刑侦 — 冲突在于系统给答案破坏悬疑
        化解方案：系统只能提供线索不能给答案，或系统本身是案件的一部分
        """
        return self.llm.generate_conflict_resolution(
            primary=primary, secondary=secondary,
            prompt="design_resolution"  # 专用 prompt
        )
    
    def _check_promise_conflict(self, p, s, fusion_mechanic) -> str | None:
        """
        检测两个体裁的读者承诺是否冲突。
        例如：系统文承诺"稳定升级"，刑侦承诺"不确定性"——两者矛盾。
        返回冲突描述，或 None。
        """
        if p["reader_promise"] != s["reader_promise"]:
            if self.llm.check_promise_clash(p["reader_promise"], s["reader_promise"], fusion_mechanic):
                return f"读者承诺冲突：{p['reader_promise']} vs {s['reader_promise']}"
        return None
    
    def _estimate_novelty_boost(self, primary_name: str, secondary_name: str) -> int:
        """
        体裁越远，新颖度加成越大。
        距离 = 在体裁兼容图上的最短路径长度。
        相邻体裁（路径=1）：+5；相隔（路径=2）：+15；远距（路径≥3）：+30
        """
        distance = self._genre_distance(primary_name, secondary_name)
        if distance <= 1:
            return 5
        elif distance == 2:
            return 15
        else:
            return 30
    
    def _genre_distance(self, primary_name: str, secondary_name: str) -> int:
        """
        在体裁兼容图上做 BFS 最短路径搜索。
        
        体裁兼容图定义（邻接表）：
        每个体裁的 compatible_with 列表定义了图中的边。
        如果 A.compatible_with 包含 B，则 A 和 B 之间存在一条边。
        
        距离计算：
        - 0：同一体裁
        - 1：直接兼容（在对方的 compatible_with 列表中）
        - 2：通过一个中间体裁可达
        - 3：通过两个中间体裁可达，或不可达（视为远距融合，新颖度加成最大）
        - ∞→3：图中不存在可达路径，视为远距
        """
        if primary_name == secondary_name:
            return 0
        
        # BFS
        visited = {primary_name}
        queue = [(primary_name, 0)]
        
        while queue:
            current, dist = queue.pop(0)
            current_genre = self.GENRE_STRUCTURES.get(current)
            if not current_genre:
                continue
            
            for neighbor in current_genre.get("compatible_with", []):
                if neighbor == secondary_name:
                    return dist + 1
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))
        
        # 不可达 → 视为远距融合
        return 3
```

**输出示例：**
```json
{
  "primary": "都市重生",
  "secondary": "刑侦悬疑",
  "fusion_mechanic": "主角重生后发现凶手也重生了，且知道主角重生。两个掌握未来信息的人在已知结局的前提下展开博弈——主角要阻止案件，凶手要确保案件发生。信息对称意味着预知不再是单方面优势。",
  "conflict_resolution": null,
  "promise_conflict_warning": null,
  "novelty_boost": 15
}
```

### 2.7 Novelty Evaluator（新颖度评估器）— v3.0 完整补全

v2.0 中以下函数被引用但未定义。v3.0 全部补全。

**四个评分维度，四种计算方法：**

```python
class NoveltyEvaluator:
    
    def evaluate(self, idea: str, context: dict) -> NoveltyScore:
        scores = {
            "market_saturation": self._calc_market_saturation(idea),
            "trope_similarity":   self._calc_trope_distance(idea),
            "contradiction_depth": self._calc_contradiction_depth(idea),
            "discussion_potential": self._calc_discussion_potential(idea),
        }
        
        weights = {
            "market_saturation": 0.30,
            "trope_similarity":  0.25,
            "contradiction_depth": 0.25,
            "discussion_potential": 0.20,
        }
        
        final_score = sum(scores[k] * weights[k] for k in scores)
        
        return NoveltyScore(
            total=round(final_score),
            breakdown=scores,
            verdict=self._verdict(final_score),
            improvement_hint=self._gen_hint(scores)
        )
    
    # ── 维度1：市场饱和度 ──
    def _calc_market_saturation(self, idea: str) -> float:
        """
        提取 idea 中的套路标签，在 Trope Pool 中查找对应的 market_saturation。
        取所有匹配套路的 saturation 最低值（即最蓝海的那个），映射到 0-100 分。
        
        算法：
        1. LLM 从 idea 中提取套路标签列表（仅标签，不做评分）
        2. 在 Trope Pool 中精确匹配
        3. score = (1 - min_matched_saturation) * 100
        
        取最小值的原因：一个创意可能包含多个套路，如果其中
        有一个蓝海套路，整个创意的市场饱和度就低。
        """
        tags = self.llm.extract_trope_tags(idea)  # 仅提取标签名，非评分任务
        matched_saturations = []
        for tag in tags:
            trope = self.trope_pool.find(tag)
            if trope:
                matched_saturations.append(trope.market_saturation)
        
        if not matched_saturations:
            return 50.0  # 无匹配 → 中性分数
        
        min_sat = min(matched_saturations)
        return round((1 - min_sat) * 100, 1)
    
    # ── 维度2：套路相似度 ──
    def _calc_trope_distance(self, idea: str) -> float:
        """
        用 BAAI/bge-m3 对 idea 做 embedding，在 Trope Pool 的向量索引中
        做语义相似度搜索。取与已知套路最高相似度：
        score = (1 - max_similarity) * 100
        
        与已知套路越不相似，分数越高。
        使用本地向量检索，不调用 LLM。
        """
        idea_vec = self.embedder.encode(idea)
        hits = self.trope_vector_index.search(idea_vec, top_k=5)
        
        if not hits:
            return 100.0  # 没有任何已知套路相似 → 全新
        
        max_sim = max(h.score for h in hits)
        return round((1 - max_sim) * 100, 1)
    
    # ── 维度3：矛盾深度 ──
    def _calc_contradiction_depth(self, idea: str) -> float:
        """
        检测 idea 中是否包含 Contradiction Engine 定义的矛盾模式。
        
        方法：用正则 + 关键词匹配检测五种矛盾模板的结构特征，
        而非用 LLM 评分。
        
        五种模板的检测方式：
        """
        patterns = [
            # {power} × {hard_limit}：检测 "能力词 + 限制词" 的转折结构
            # v3.1 修正：增加能力词前置条件，避免纯转折词误匹配
            (r'(?=.*(最强|无敌|全能|掌控|预知|穿越|系统|重生|不死|长生|无限|至强|无解))'
             r'(?=.*(但是|但|却|然而|无法|不能|不可|限制|代价))', 15),
            # {eternal_trait} × {decay}：检测 "永远/永恒/不死" + "失去/消失/遗忘"
            (r'(?=.*(永远|永恒|不死|长生|无限))(?=.*(失去|消失|遗忘|消逝|衰))', 25),
            # {identity_a} × {secret_identity_b}：检测 "其实是/真实身份/真正的是/原来是"
            (r'(?=.*(其实是|真实身份|真正的是|原来是|本是|身份|伪装|卧底))'
             r'(?=.*(其实是|真实身份|真正的是|原来是|本是))', 20),
            # {goal} × {cost_is_goal_itself}：检测 "代价是/代价却是/后果是" + "自己/自身"
            (r'(?=.*(代价|后果))(?=.*(自己|自身|自我))', 25),
            # {strength} × {weakness_is_strength}：检测 "强/无敌/最强" + "弱点/代价" 的悖论
            (r'(?=.*(最强|无敌|至强|无解))(?=.*(弱点|代价|限制|无法))', 20),
        ]
        
        score = 0.0
        matched_templates = []
        for pattern, weight in patterns:
            if re.search(pattern, idea):
                score += weight
                matched_templates.append(pattern)
        
        # 多个矛盾模板同时命中，额外加成（复合矛盾 > 单一矛盾）
        if len(matched_templates) >= 2:
            score *= 1.3  # 复合矛盾加成
        
        return min(100.0, score)
    
    # ── 维度4：讨论潜力 ──
    def _calc_discussion_potential(self, idea: str) -> float:
        """
        基于结构性指标组合计算，不用 LLM 模拟读者。
        
        三个子指标：
        - 争议性：是否包含对立价值/道德困境关键词（牺牲、出卖、背叛、选择、要么、两者）
        - 可预测性反比：设定是否有明确的"正确答案"（可预测=讨论少）
        - 身份冲突：是否包含身份/角色冲突（卧底、双重、伪装、假装）
        
        每种命中 +20 分，上限 100。
        """
        controversy_kw = ["牺牲", "出卖", "背叛", "选择", "要么", "两者", "代价", 
                          "交换", "取舍", "背叛", "正义", "对错"]
        identity_kw = ["卧底", "双重身份", "假装", "伪装", "冒充", "其实是", 
                       "真实身份", "隐藏", "秘密"]
        
        controversy_score = sum(1 for kw in controversy_kw if kw in idea) * 10
        identity_score = sum(1 for kw in identity_kw if kw in idea) * 12
        
        # 可预测性反比：如果 idea 包含经典套路结尾关键词则降低分数
        predictability_penalty = 0
        predictable_kw = ["最终成为最强", "抱得美人归", "一统天下", "完美结局"]
        for kw in predictable_kw:
            if kw in idea:
                predictability_penalty += 15
        
        raw = controversy_score + identity_score - predictability_penalty
        return max(0.0, min(100.0, raw))
    
    # ── 综合判定函数 ──
    def _verdict(self, total_score: float) -> str:
        """基于总分给出判定"""
        if total_score >= 80:
            return "高新颖度，可推进"
        elif total_score >= 60:
            return "中等新颖度，建议强化矛盾或增加跨体裁元素"
        elif total_score >= 40:
            return "偏低新颖度，需显著变异或引入矛盾设定"
        else:
            return "低新颖度，建议更换核心创意"

    def _gen_hint(self, scores: dict) -> str:
        """
        找出最拖分的维度，给出针对性改进建议。
        不使用 LLM，纯模板匹配。
        """
        weakest = min(scores, key=scores.get)
        hints = {
            "market_saturation": "市场饱和度偏高，建议：1) 更换蓝海套路标签 2) 与饱和度<0.5的套路做融合 3) 使用 Mutation Engine 做深变异",
            "trope_similarity": "套路相似度偏高，建议：1) Contradiction Engine 引入强矛盾 2) WhatIf Engine 递归发散≥2层 3) 跨两个非相邻体裁融合",
            "contradiction_depth": "矛盾深度偏低，建议：1) 从 Contradiction Engine 的五个模板中选取至少一个 2) 尝试能力×限制或力量即弱点模式 3) 复合矛盾（同时命中两个模板）",
            "discussion_potential": "讨论潜力偏低，建议：1) 增加道德困境因素 2) 引入不可调和的身份冲突 3) 让核心矛盾没有'正确答案'",
        }
        return hints.get(weakest, "建议综合优化各维度")


# viral_potential 的计算
def calc_viral_potential(self, idea: str, twist_density: int) -> int:
    """
    爆款潜力 = 新颖度 × 0.4 + 反转密度 × 0.3 + 讨论潜力 × 0.3
    
    twist_density 来源：
    - 构思阶段：Planner 在 Novel Blueprint 中规划的 twist 总数 / 预估章数 × 100
    - 写作阶段：Twist Registry 中实际注册的 twist 总数 / 已完成章数 × 100
    """
    novelty = self.evaluate(idea).total
    discussion = self.evaluate(idea).breakdown["discussion_potential"]
    return round(novelty * 0.4 + twist_density * 0.3 + discussion * 0.3)
```

**输出示例：**
```json
{
  "total": 84,
  "breakdown": {
    "market_saturation": 91,
    "trope_similarity": 78,
    "contradiction_depth": 88,
    "discussion_potential": 72
  },
  "verdict": "高新颖度，可推进",
  "improvement_hint": "讨论潜力偏低，建议：1) 增加道德困境因素 2) 引入不可调和的身份冲突 3) 让核心矛盾没有'正确答案'"
}
```

### 2.8 Story DNA（CreativeOS → Planner 接口）

```json
{
  "story_dna_version": "3.0",
  "project_id": "proj_001",
  "generated_at": "2025-01-01T00:00:00Z",
  
  "core_contradiction": {
    "id": "contra_031",
    "statement": "主角拥有预知他人死亡的能力，但无法预知自己的",
    "core_tension": "救得了所有人却救不了自己",
    "novelty_score": 87
  },
  
  "genre_fusion": {
    "primary": "都市重生",
    "secondary": "刑侦悬疑",
    "fusion_mechanic": "凶手也重生了，且知道主角重生",
    "novelty_boost": 15
  },
  
  "selected_tropes": [
    {"id": "trope_007", "name": "系统文", "mutation": "系统是死去未来自我的意识残留"}
  ],
  
  "key_whatif_nodes": [
    "如果揭穿假系统的代价是失去所有能力",
    "如果反派也有系统，且两个系统在竞争"
  ],
  
  "reader_hooks": {
    "main_mystery": "系统的真实来源",
    "main_promise": "主角会不会查出自己的死因",
    "emotional_core": "救人者无法自救的孤独"
  },
  
  "novelty_score": 84,
  "viral_potential": 79,
  
  "creative_constraints": [
    "主角能力必须有代价，不能无限制使用",
    "反派在信息上不能处于完全劣势",
    "核心矛盾在第80%章之前不能完全解决"
  ]
}
```

---

## 三、StoryOS — 叙事资产内核（v3.0 增强：跨 Registry 强制外键）

### 3.1 完整 Registry 清单

```
StoryOS
├── Conflict Registry    # 冲突登记簿
├── Promise Registry     # 承诺登记簿
├── Mystery Registry     # 谜团登记簿
├── Twist Registry       # 反转登记簿
├── Reveal Registry      # 揭晓登记簿
├── Goal Registry        # 目标登记簿
├── Expectation Registry # 读者期待登记簿
└── Tension Curve        # 全书张力曲线
```

### 3.2 所有 Registry 完整 Schema（含跨 Registry 外键）

**Conflict Registry：**
```json
{
  "id": "cf_001",
  "type": "revenge | love | power | survival | ideology",
  "owner": "char_001",
  "target": "char_002",
  "created_chapter": 5,
  "status": "active | escalated | resolved | abandoned",
  "intensity": "low | medium | high | critical",
  "expected_resolution": 80,
  "escalation_history": [
    {"chapter": 12, "trigger": "张伟陷害林峰", "new_intensity": "high"}
  ],
  "resolution_note": null,
  
  "cross_refs": {
    "linked_mysteries": ["mys_005"],
    "linked_goals": ["goal_002"],
    "linked_expectations": ["exp_003"]
  }
}
```

**Promise Registry：**
```json
{
  "id": "promise_017",
  "content": "林峰答应替妹妹报仇",
  "speaker": "char_001",
  "audience": "char_003",
  "created_chapter": 17,
  "deadline_chapter": 70,
  "status": "active | fulfilled | broken | extended",
  "importance": "low | medium | high | critical",
  "fulfillment_note": null,
  "extension_reason": null,
  
  "cross_refs": {
    "linked_conflicts": ["cf_001"],
    "linked_goals": ["goal_005"],
    "blocks_expectations": ["exp_007"]
  }
}
```

**Mystery Registry：**
```json
{
  "id": "mys_003",
  "question": "超脑的真实来源是什么",
  "planted_chapter": 3,
  "clues_given": [
    {"chapter": 15, "clue": "超脑有独立意识迹象"},
    {"chapter": 28, "clue": "超脑知道林峰不知道的事"}
  ],
  "reveal_chapter": 48,
  "status": "open | partially_revealed | revealed",
  "impact_on_reveal": "world_level | plot_level | character_level",
  
  "cross_refs": {
    "reveals_into": "rev_005",
    "linked_twists": ["tw_002"],
    "linked_expectations": ["exp_011"]
  }
}
```

**Twist Registry（v2.0 新增，v3.0 增加外键）：**
```json
{
  "id": "tw_001",
  "type": "identity | betrayal | world_truth | power_origin | relationship",
  "description": "师父是幕后反派的卧底",
  "setup_chapter": 15,
  "setup_method": "多次强调师父的忠诚和牺牲，建立读者信任",
  "reveal_chapter": 58,
  "reveal_trigger": "林峰发现师父的秘密联络记录",
  "impact": "low | medium | high | catastrophic",
  "status": "setup_in_progress | setup_complete | revealed",
  "foreshadow_chapters": [20, 33, 41],
  "reader_expectation_before": "师父是最值得信任的人",
  "reader_shock_target": "完全颠覆信任关系",
  
  "cross_refs": {
    "reveals_via": "rev_010",
    "affects_characters": ["char_001", "char_005"],
    "triggers_expectations": ["exp_007"],
    "linked_mysteries": ["mys_008"]
  }
}
```

**Reveal Registry（v2.0 新增，v3.0 增加外键）：**
```json
{
  "id": "rev_005",
  "secret": "超脑来源于观察者文明遗留",
  "known_by_characters": [],
  "known_by_reader": false,
  "reveal_chapter": 48,
  "reveal_method": "林峰直接与超脑深层对话",
  "impact": "world_level",
  "status": "hidden | foreshadowed | revealed",
  
  "cross_refs": {
    "resolves_mysteries": ["mys_003"],
    "unlocks_twists": ["tw_002"],
    "fulfills_expectations": ["exp_011"],
    "may_escalate_conflicts": ["cf_004"]
  }
}
```

**Goal Registry（v2.0 补全，v3.0 增加外键）：**
```json
{
  "id": "goal_002",
  "owner": "char_001",
  "type": "short_term | arc | series",
  "content": "在第一卷内从 T5 晋升到 T9",
  "created_chapter": 1,
  "target_chapter": 20,
  "status": "active | achieved | failed | pivoted",
  "sub_goals": ["goal_003", "goal_004"],
  
  "cross_refs": {
    "blocked_by_conflicts": ["cf_001"],
    "enabled_by_reveals": ["rev_005"],
    "linked_promises": ["promise_017"]
  },
  
  "achievement_note": null
}
```

**Expectation Registry（v2.0 补全，v3.0 增加外键）：**
```json
{
  "id": "exp_007",
  "type": "payoff | twist | romance | power_up | revenge",
  "content": "读者期待林峰对王霸天的全面清算",
  "planted_chapter": 6,
  "expected_by_reader": true,
  "fulfillment_chapter": 29,
  "fulfillment_type": "full | partial | subverted",
  "status": "building | ready_to_fulfill | fulfilled | delayed",
  "delay_reason": null,
  
  "cross_refs": {
    "triggered_by_twists": ["tw_001"],
    "linked_conflicts": ["cf_001"],
    "linked_mysteries": ["mys_003"]
  }
}
```

### 3.3 跨 Registry 事务一致性保障（v3.0 新增）

**强制外键约束机制：**

当 StoryOS Agent 更新某个 Registry 条目时，事务管理器自动检查：

```python
class RegistryTransactionManager:
    """
    确保跨 Registry 更新的原子性和引用完整性。
    """
    
    def apply_with_cascade(self, registry_type: str, entry_id: str,
                           changes: dict) -> TransactionResult:
        """
        应用变更并自动级联更新所有外键关联的 Registry 条目。
        
        规则：
        - Mystery status→revealed → 自动检查 reveals_into，将对应 Reveal status 设为 revealed
        - Reveal status→revealed → 自动检查 fulfills_expectations，将对应 Expectation 设为 fulfilled
        - Twist status→revealed → 自动检查 triggers_expectations，将对应 Expectation 设为 ready_to_fulfill
        - Conflict status→resolved → 自动检查 linked_expectations，评估是否需要更新
        """
        
        # 1. 记录变更前的快照（用于回滚）
        snapshot = self.storyos.snapshot()
        
        try:
            # 2. 应用主变更
            self.storyos.apply(registry_type, entry_id, changes)
            
            # 3. 级联传播（基于 cross_refs 外键）
            cascade_changes = self._compute_cascade(registry_type, entry_id, changes)
            
            for cascade_type, cascade_id, cascade_change in cascade_changes:
                self.storyos.apply(cascade_type, cascade_id, cascade_change)
                self.log_cascade(entry_id, cascade_id, cascade_change)
            
            # 4. 验证引用完整性
            broken_refs = self._validate_all_refs()
            if broken_refs:
                # 标记为待人工修复，不自动回滚（已应用的主变更是正确的）
                self.flag_for_manual_fix(broken_refs)
            
            return TransactionResult(
                applied=changes,
                cascaded=cascade_changes,
                broken_refs=broken_refs
            )
            
        except Exception as e:
            # 5. 回滚到快照
            self.storyos.restore(snapshot)
            raise RegistryTransactionError(f"事务失败已回滚: {e}")
    
    def _compute_cascade(self, registry_type: str, entry_id: str,
                         changes: dict) -> list[tuple]:
        """基于 cross_refs 外键计算级联变更"""
        cascades = []
        entry = self.storyos.get(registry_type, entry_id)
        cross_refs = entry.get("cross_refs", {})
        
        # Mystery → Reveal 级联
        if registry_type == "mystery" and changes.get("status") == "revealed":
            for reveal_id in cross_refs.get("reveals_into", []):
                cascades.append(("reveal", reveal_id, {"status": "revealed"}))
        
        # Reveal → Expectation 级联
        if registry_type == "reveal" and changes.get("status") == "revealed":
            for exp_id in cross_refs.get("fulfills_expectations", []):
                cascades.append(("expectation", exp_id, {"status": "fulfilled"}))
        
        # Twist → Expectation 级联
        if registry_type == "twist" and changes.get("status") == "revealed":
            for exp_id in cross_refs.get("triggers_expectations", []):
                cascades.append(("expectation", exp_id, {"status": "ready_to_fulfill"}))
        
        # Reveal → Conflict 级联
        if registry_type == "reveal" and changes.get("status") == "revealed":
            for cf_id in cross_refs.get("may_escalate_conflicts", []):
                cascades.append(("conflict", cf_id, {"status": "escalated"}))
        
        return cascades
    
    # cross_refs key → Registry 类型映射表（v3.1 补全）
    REF_KEY_MAPPING = {
        # Conflict
        "linked_mysteries": "mystery",
        "linked_goals": "goal",
        "linked_expectations": "expectation",
        # Promise
        "linked_conflicts": "conflict",
        "blocks_expectations": "expectation",
        # Mystery
        "reveals_into": "reveal",
        "linked_twists": "twist",
        # Twist
        "reveals_via": "reveal",
        "affects_characters": None,  # 角色引用走 Character State Machine
        "triggers_expectations": "expectation",
        # Reveal
        "resolves_mysteries": "mystery",
        "unlocks_twists": "twist",
        "fulfills_expectations": "expectation",
        "may_escalate_conflicts": "conflict",
        # Goal
        "blocked_by_conflicts": "conflict",
        "enabled_by_reveals": "reveal",
        "linked_promises": "promise",
        # Expectation
        "triggered_by_twists": "twist",
        # 通用（如果引用的是同类型条目，key 名本身不是决定性因素，
        # 对于无法映射的 key，返回 None）
    }
    
    def _ref_key_to_registry(self, ref_key: str) -> str | None:
        """将 cross_refs key 映射到 Registry 类型名"""
        return self.REF_KEY_MAPPING.get(ref_key)
    
    def _validate_all_refs(self) -> list[BrokenRef]:
        """
        全量校验所有 cross_refs 引用的条目是否存在且状态一致。
        """
        broken = []
        all_entries = self.storyos.all_entries()
        
        for entry in all_entries:
            for ref_type, ref_ids in entry.get("cross_refs", {}).items():
                # 将 cross_refs key 映射到 Registry 类型
                registry_type = self._ref_key_to_registry(ref_type)
                if registry_type is None:
                    continue
                # 确保 ref_ids 是列表
                ids = ref_ids if isinstance(ref_ids, list) else [ref_ids]
                for ref_id in ids:
                    if not self.storyos.exists(registry_type, ref_id):
                        broken.append(BrokenRef(
                            source=entry["id"],
                            target_type=registry_type,
                            target_id=ref_id,
                            reason="引用目标不存在"
                        ))
        
        return broken
```

### 3.4 Tension Curve（张力曲线引擎）

v2.0 中 `_suggest_tension_boosts()` 被引用但未定义，v3.0 补全。

```python
class TensionCurve:
    def calculate_chapter_tension(self, chapter_id: int) -> float:
        """
        综合多个 Registry 的活跃状态计算当前章节张力值（0-100）
        """
        storyos = self.storyos
        
        active_conflicts = storyos.conflicts.count(
            status="active|escalated", chapter=chapter_id
        )
        critical_conflicts = storyos.conflicts.count(
            status="escalated", chapter=chapter_id
        )
        open_mysteries = storyos.mysteries.count(
            status="open|partially_revealed", chapter=chapter_id
        )
        approaching_reveals = storyos.reveals.count(
            reveal_chapter__lte=chapter_id + 5,
            status="foreshadowed"
        )
        approaching_twists = storyos.twists.count(
            reveal_chapter__lte=chapter_id + 3,
            status="setup_complete"
        )
        unfulfilled_expectations = storyos.expectations.count(
            status="ready_to_fulfill"
        )
        
        tension = (
            active_conflicts      * 8  +
            critical_conflicts    * 12 +
            open_mysteries        * 6  +
            approaching_reveals   * 10 +
            approaching_twists    * 15 +
            unfulfilled_expectations * 5
        )
        
        return min(100.0, tension)
    
    def get_warnings(self, chapter_id: int) -> list[TensionWarning]:
        """
        生成预警列表，注入 Writer 的写作 prompt
        """
        warnings = []
        
        # 连续低张力检测
        recent_tensions = [
            self.calculate_chapter_tension(c)
            for c in range(max(1, chapter_id-3), chapter_id)
        ]
        if recent_tensions and max(recent_tensions) < 30:
            warnings.append(TensionWarning(
                level="critical",
                message=f"连续{len(recent_tensions)}章张力值低于30，需要立即引入新冲突或推进悬念",
                suggestions=self._suggest_tension_boosts(chapter_id)
            ))
        
        # 即将超期的 Promise
        expiring = self.storyos.promises.filter(
            status="active",
            deadline_chapter__lte=chapter_id + 5
        )
        for p in expiring:
            warnings.append(TensionWarning(
                level="high",
                message=f"承诺[{p.id}]「{p.content}」将在第{p.deadline_chapter}章到期，距今{p.deadline_chapter-chapter_id}章",
                registry_id=p.id
            ))
        
        # 积压的读者期待
        overdue = self.storyos.expectations.filter(
            status="ready_to_fulfill",
            fulfillment_chapter__lt=chapter_id
        )
        for e in overdue:
            warnings.append(TensionWarning(
                level="medium",
                message=f"读者期待[{e.id}]「{e.content}」已逾期{chapter_id - e.fulfillment_chapter}章未兑现"
            ))
        
        return warnings
    
    def _suggest_tension_boosts(self, chapter_id: int) -> list[str]:
        """
        基于当前 Registry 状态，生成具体的张力提升建议。
        v3.0 补全：基于结构化数据分析，不调用 LLM。
        """
        suggestions = []
        storyos = self.storyos
        
        # 检查是否有可用的 twist 可以提前揭示
        ready_twists = storyos.twists.filter(
            status="setup_complete",
            reveal_chapter__gte=chapter_id  # 计划在未来揭示
        )
        if ready_twists:
            t = ready_twists[0]
            suggestions.append(
                f"Twist [{t.id}]「{t.description}」已准备就绪，可考虑提前至本章揭示"
            )
        
        # 检查是否有逾期未兑现的 expectation
        overdue = storyos.expectations.filter(
            status="ready_to_fulfill",
            fulfillment_chapter__lt=chapter_id
        )
        if overdue:
            e = overdue[0]
            suggestions.append(
                f"兑现已逾期的读者期待 [{e.id}]「{e.content}」"
            )
        
        # 检查是否可以引入新的 conflict
        if storyos.conflicts.count(status="active") < 3:
            suggestions.append(
                "活跃冲突数不足3个，建议引入新冲突：可从现有 Mystery 中衍生或从角色关系中自然产生"
            )
        
        # 检查是否有 unresolved mystery 可以推进
        stale_mysteries = storyos.mysteries.filter(
            status="open",
            planted_chapter__lt=chapter_id - 10  # 超过10章未推进
        )
        if stale_mysteries:
            m = stale_mysteries[0]
            suggestions.append(
                f"Mystery [{m.id}]「{m.question}」已超过10章未推进，建议揭示一条新线索"
            )
        
        # 如果没有任何建议，给出通用指导
        if not suggestions:
            suggestions.append("建议引入短期子冲突（如角色间争执、新威胁出现），提升即时张力")
        
        return suggestions
```

### 3.5 StoryOS 的状态更新责任归属（含 `<log>` 标签机制）

这是 v3.0 最关键的架构变更：**取消 LLM 盲猜"隐含变化"，改为 Writer 强制嵌入结构化日志标签。**

| 触发时机 | 更新操作 | 执行者 |
|---|---|---|
| Scene 写作时 | Writer 嵌入 `<log>` 标签声明状态变化 | **Writer Agent** 强制嵌入 |
| Scene 写作完成后 | 正则解析 `<log>` 标签，提取变化 | **StoryOS Agent** 自动执行（确定性代码） |
| Chapter Assembly 完成后 | 更新章节级 Registry（conflict intensity 等） | **StoryOS Agent** 自动执行 |
| Writer 在 Scene Planning 时 | 声明本 Scene 将触发的 Registry 变化（预声明） | **Writer Agent** 主动填写 |
| Twist/Reveal 兑现时 | 更新 status 为 revealed | **Reviewer** 的 Fact Guard 校验后确认 |
| 人工介入时 | 手动修改任意 Registry 条目 | **用户** 通过 Conductor 界面 |

**`<log>` 标签规范（v3.0 核心新增）：**

Writer 在生成 Scene 文本时，必须在合适的叙事位置嵌入不可见的日志标签。这些标签对人类读者透明（Markdown 注释语法），但 StoryOS Agent 用正则直接解析，无需 LLM。

```xml
<!-- SF_LOG character_relation_change char_a="林峰" char_b="苏晓晓" status="裂痕" trigger="争执超脑使用" -->

<!-- SF_LOG character_emotion char="林峰" emotion="压抑愤怒" intensity="high" -->

<!-- SF_LOG knowledge_gain char="林峰" content="师父的秘密联络记录" source="实验室终端" -->

<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="critical" trigger="发现张伟与师父的联系" -->

<!-- SF_LOG mystery_clue id="mys_003" clue="超脑认识观察者文明的符号" -->

<!-- SF_LOG twist_reveal id="tw_001" trigger="终端日志记录" -->

<!-- SF_LOG expectation_fulfill id="exp_007" method="partial" note="林峰开始调查但未完全清算" -->

<!-- SF_LOG goal_milestone id="goal_002" progress="T5→T7" -->

<!-- SF_LOG registry_create type="conflict" data='{"owner":"林峰","target":"师父","type":"betrayal"}' -->
```

**StoryOS Agent 解析（v3.0 改造——纯确定性代码）：**

```python
class StoryOSAgent:
    
    # 正则模式，匹配所有 SF_LOG 标签
    LOG_PATTERN = re.compile(r'<!--\s*SF_LOG\s+(\w+)\s+(.*?)\s*-->', re.DOTALL)
    
    LOG_HANDLERS = {
        "character_relation_change": "_handle_relation_change",
        "character_emotion": "_handle_emotion_change",
        "knowledge_gain": "_handle_knowledge",
        "conflict_escalate": "_handle_conflict_escalation",
        "mystery_clue": "_handle_mystery_clue",
        "twist_reveal": "_handle_twist_reveal",
        "expectation_fulfill": "_handle_expectation",
        "goal_milestone": "_handle_goal_milestone",
        "registry_create": "_handle_registry_create",
    }
    
    def update_after_scene(self, chapter_id: int, scene_id: str,
                           scene_text: str, declared_changes: list) -> UpdateReport:
        """
        每个 Scene 写完后执行：
        1. 正则解析 <log> 标签（确定性，无 LLM 调用）
        2. 对比 Writer 的预声明和实际 log
        3. 应用已验证的变化
        4. 检测预声明外的 log 声明
        """
        # 1. 解析 log 标签
        parsed_logs = self._parse_logs(scene_text)
        
        # 2. 对比预声明和实际 log
        verified = []
        unmatched_declared = []
        for change in declared_changes:
            matching_log = self._find_matching_log(change, parsed_logs)
            if matching_log:
                verified.append(change)
                parsed_logs.remove(matching_log)  # 已匹配，避免重复处理
            else:
                unmatched_declared.append(change)
        
        # 记录预声明但未实际 log 的变化（可能是 Writer 遗漏标签）
        for change in unmatched_declared:
            self.log_unverified(change, scene_id)
        
        # 3. 处理预声明外但在 log 中声明的变化（这些是 Writer 主动打点的新变化）
        additional = [self._apply_parsed_log(log) for log in parsed_logs]
        
        # 4. 应用所有变化
        all_changes = verified + additional
        self.storyos.apply_batch(all_changes)
        
        # 5. 跨 Registry 事务级联
        for change in all_changes:
            self.registry_tx.apply_with_cascade(
                change.registry_type, change.entry_id, change.data
            )
        
        # 6. 更新 Tension Curve
        self.storyos.tension_curve.update(chapter_id)
        
        return UpdateReport(
            verified=verified,
            from_logs=additional,
            tension_new=self.storyos.tension_curve.calculate_chapter_tension(chapter_id)
        )
    
    def _parse_logs(self, scene_text: str) -> list[LogEntry]:
        """正则解析所有 SF_LOG 标签，纯确定性代码"""
        logs = []
        for match in self.LOG_PATTERN.finditer(scene_text):
            log_type = match.group(1)
            attrs_str = match.group(2)
            attrs = self._parse_attrs(attrs_str)
            logs.append(LogEntry(type=log_type, attrs=attrs))
        return logs
    
    def _parse_attrs(self, attrs_str: str) -> dict:
        """
        解析标签属性：key="value" 格式。
        支持 JSON 格式的 data 属性。
        """
        attrs = {}
        # 匹配 key="value" 或 key='value'，其中 value 可含空格
        for m in re.finditer(r'(\w+)=(?:"([^"]*)"|\'([^\']*)\')', attrs_str):
            key = m.group(1)
            value = m.group(2) if m.group(2) is not None else m.group(3)
            # 尝试解析 JSON
            if value.startswith('{') or value.startswith('['):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    pass
            attrs[key] = value
        return attrs
    
    def _find_matching_log(self, change: RegistryChange, 
                           parsed_logs: list[LogEntry]) -> LogEntry | None:
        """
        匹配预声明变化与实际 log 标签。
        
        匹配规则（按优先级）：
        1. 精确 ID + 类型匹配：change 的 (registry_type, entry_id) 与 log 的 type/id 完全一致
        2. 类型 + 数据匹配（用于 registry_create）：log type 与 change registry_type 一致，
           且 log 的 attrs 中包含 change data 的关键字段
        3. 宽松匹配（用于 add_clue/add_foreshadow 等无独立 ID 的操作）：
           log type 与 change action 类型一致，且 log 中包含相同的章节引用
        
        返回匹配的 LogEntry 或 None。
        """
        # 规则1：精确 ID 匹配
        change_id = change.get("id")
        change_type = change.get("registry")
        change_action = change.get("action")
        
        for log in parsed_logs:
            # 直接 ID 匹配
            if change_id and log.attrs.get("id") == change_id:
                # 类型一致性检查
                expected_log_type = self._registry_action_to_log_type(change_type, change_action)
                if expected_log_type and log.type == expected_log_type:
                    return log
            
            # 规则2：registry_create 匹配——log 中 data 包含相同 owner/target
            if change_action == "create" and log.type == "registry_create":
                log_data = log.attrs.get("data", {})
                if isinstance(log_data, dict):
                    change_data = change.get("data", {})
                    if (log_data.get("owner") == change_data.get("owner") and
                        log_data.get("target") == change_data.get("target")):
                        return log
            
            # 规则3：章节内操作匹配（add_clue 等）
            if change_action == "add_clue" and log.type == "mystery_clue":
                if log.attrs.get("id") == change_id:
                    return log
            if change_action == "add_foreshadow" and log.type in ("mystery_clue", "twist_reveal"):
                if log.attrs.get("id") == change_id:
                    return log
        
        return None
    
    # registry action → log type 映射
    ACTION_TO_LOG_TYPE = {
        ("mystery", "add_clue"): "mystery_clue",
        ("mystery", "reveal"): "mystery_clue",
        ("twist", "reveal"): "twist_reveal",
        ("twist", "add_foreshadow"): "twist_reveal",
        ("conflict", "create"): "registry_create",
        ("conflict", "escalate"): "conflict_escalate",
        ("expectation", "fulfill"): "expectation_fulfill",
        ("goal", "milestone"): "goal_milestone",
        ("reveal", "reveal"): "twist_reveal",
    }
    
    def _registry_action_to_log_type(self, registry_type: str, action: str) -> str | None:
        """将 (registry_type, action) 映射到对应的 log 标签类型"""
        return self.ACTION_TO_LOG_TYPE.get((registry_type, action))
    
    def check_warnings(self, chapter_id: int) -> list[StoryOSWarning]:
        """每章开始前调用，生成叙事资产预警"""
        return self.storyos.tension_curve.get_warnings(chapter_id)
```

**Writer 写作 Prompt 中注入的 log 指令：**

```yaml
# prompts/writing/scene_writer_cool.yaml 中增加：
log_instructions: |
  在写作过程中，当出现以下情况时，必须在对应位置嵌入 SF_LOG 标签：
  
  1. 角色关系发生改变（好感度变化、信任动摇、反目、和解）
  2. 角色获得关键知识（秘密、线索、真相）
  3. 冲突升级或新增
  4. 谜团线索被揭示
  5. 反转被兑现
  6. 读者期待被满足
  7. 角色目标达成阶段性进展
  8. 任何需要写入 Registry 的新叙事资产被创建
  
  SF_LOG 标签格式：
  <!-- SF_LOG <类型> <属性1>="值1" <属性2>="值2" -->
  
  标签放在对应的叙事位置之后。这些标签是 Markdown 注释，
  人类读者不可见，但系统需要它们来维护叙事状态。
```

---

## 四、ReaderOS — 完全去 LLM 化（v3.0 重大改造）

### 4.1 七个读者状态指标

```
ReaderOS
├── Curiosity          # 好奇心（当前未解谜团的吸引力）→ 纯公式
├── Tension            # 张力（直接来自 Tension Curve）→ 直接引用
├── Satisfaction       # 满足感（近期 payoff 密度）→ 纯公式
├── Frustration        # 挫败感（主角连续受虐程度）→ 纯公式
├── Fatigue            # 疲劳度（连续高强度内容）→ 纯公式
├── Addiction          # 追更欲（综合指标）→ 公式为主 + 结尾模式检测
└── Discussion Potential  # 讨论度 → 纯公式（v3.0 完全去 LLM 化）
```

### 4.2 每个指标的计算方法（v3.0：零 LLM 调用）

**核心原则改动：v2.0 仍保留了 discussion_potential 和 addiction 中的 LLM 调用。v3.0 彻底去掉所有 LLM 调用，全部改为基于结构化数据的公式计算。**

```python
class ReaderOS:
    def update(self, chapter_id: int, chapter_text: str) -> ReaderState:
        storyos = self.storyos
        
        # ── 所有指标均从 Registry 数据或模式匹配计算，零 LLM 调用 ──
        
        # Curiosity：开放谜团加权数
        curiosity = self._calc_curiosity(storyos, chapter_id)
        
        # Tension：直接从 TensionCurve 获取
        tension = storyos.tension_curve.calculate_chapter_tension(chapter_id)
        
        # Satisfaction：近3章 fulfilled Expectation/Promise 数量
        recent_payoffs = storyos.count_fulfilled(
            chapter_range=(chapter_id-3, chapter_id),
            types=["expectation", "promise"]
        )
        satisfaction = min(100, recent_payoffs * 20)
        
        # Frustration：近5章内主角的 Goal 失败/阻断次数
        recent_blocks = storyos.goals.count(
            status="failed|blocked",
            chapter_range=(chapter_id-5, chapter_id)
        )
        frustration = min(100, recent_blocks * 15)
        
        # Fatigue：近3章 Tension 平均值（持续高张力=疲劳）
        recent_tensions = [
            storyos.tension_curve.calculate_chapter_tension(c)
            for c in range(max(1, chapter_id-3), chapter_id+1)
        ]
        avg_tension = sum(recent_tensions) / len(recent_tensions)
        fatigue = max(0, avg_tension - 50) * 1.5
        
        # Addiction：综合公式，结尾 Hook 质量用模式匹配
        hook_quality = self._calc_hook_quality(chapter_text)
        addiction = (
            curiosity    * 0.30 +
            tension      * 0.25 +
            satisfaction * 0.20 +
            hook_quality * 0.25
        )
        
        # Discussion Potential：完全公式化（v3.0 重大变更）
        discussion = self._calc_discussion_potential(chapter_id, chapter_text)
        
        return ReaderState(
            chapter_id=chapter_id,
            curiosity=round(curiosity),
            tension=round(tension),
            satisfaction=round(satisfaction),
            frustration=round(frustration),
            fatigue=round(fatigue),
            addiction=round(addiction),
            discussion_potential=round(discussion),
            warnings=self._generate_warnings(
                curiosity, tension, satisfaction, frustration, fatigue, addiction
            )
        )
    
    def _calc_curiosity(self, storyos, chapter_id: int) -> float:
        """
        好奇心 = Σ(开放谜团的重要性权重) / 最大可能值 × 100
        
        impact 权重：world_level=30, plot_level=20, character_level=10
        """
        open_mysteries = storyos.mysteries.filter(
            status="open|partially_revealed"
        )
        impact_weights = {"world_level": 30, "plot_level": 20, "character_level": 10}
        total_weight = sum(
            impact_weights.get(m.impact_on_reveal, 10) for m in open_mysteries
        )
        # 归一化：最多 5 个 world_level 谜团 = 150 为满分
        return min(100.0, total_weight / 150 * 100)
    
    def _calc_hook_quality(self, chapter_text: str) -> float:
        """
        结尾钩子质量：基于模式匹配，不使用 LLM。
        
        检测本章最后 500 字中的钩子模式：
        - 疑问句结尾（"难道...?" / "究竟..."）→ +25
        - 突发危机/意外发现 → +30
        - 新信息揭示（"原来..." / "竟然是..."）→ +25
        - 情绪爆发点（角色关系转折预告）→ +20
        - 以上均无 → 0（本章无有效钩子）
        
        多个模式命中可叠加，上限 100。
        """
        tail = chapter_text[-500:] if len(chapter_text) > 500 else chapter_text
        
        score = 0
        # 疑问句结尾
        if re.search(r'(难道|究竟|到底|莫非|该不会).*[？?]', tail):
            score += 25
        # 突发危机
        if re.search(r'(突然|忽然|就在这时|不料|没想到|骤然)', tail[-200:]):
            score += 30
        # 新信息揭示
        if re.search(r'(原来|竟然是|真正的.*是|一切.*因为|背后.*是)', tail):
            score += 25
        # 情绪爆发点
        if re.search(r'(眼中.*杀意|握紧.*拳头|彻底|再也|从今以后)', tail):
            score += 20
        
        return min(100.0, score)
    
    def _calc_discussion_potential(self, chapter_id: int, chapter_text: str) -> float:
        """
        讨论度潜力：完全公式化计算（v3.0 不再使用 LLM 模拟三种读者）。
        
        四个子指标：
        1. 道德模糊度（25%）：Registry 中不可调和冲突的存在
        2. 预期打破（30%）：近期 twist/reveal 的数量
        3. Hook 强度（25%）：结尾钩子质量
        4. 争议性文本特征（20%）：章节文本中的对立/争议关键词密度
        """
        storyos = self.storyos
        
        # 1. 道德模糊度：检测不可调和的活跃冲突（没有正确答案的冲突）
        active_conflicts = storyos.conflicts.filter(
            status="active|escalated",
            chapter=chapter_id
        )
        moral_ambiguity = min(30, len(active_conflicts) * 10)  # v3.1 修正：每冲突10分，3冲突触及上限
        
        # 2. 预期打破：近3章的 twist/reveal 数量
        recent_twists = storyos.twists.count(
            status="revealed",
            reveal_chapter__gte=chapter_id-3,
            reveal_chapter__lte=chapter_id
        )
        recent_reveals = storyos.reveals.count(
            status="revealed",
            reveal_chapter__gte=chapter_id-3,
            reveal_chapter__lte=chapter_id
        )
        subversion_score = min(30, (recent_twists + recent_reveals) * 10)
        
        # 3. Hook 强度
        hook_score = self._calc_hook_quality(chapter_text) * 0.25
        
        # 4. 争议性文本特征
        controversy_score = self._calc_text_controversy(chapter_text)
        
        return round(
            moral_ambiguity + subversion_score + hook_score + controversy_score
        )
    
    def _calc_text_controversy(self, chapter_text: str) -> float:
        """
        检测章节文本中的争议性特征：
        - 道德困境关键词（牺牲/出卖/背叛/选择/要么）
        - 角色间对立观点的直接表达
        - 决策的两难性质
        
        纯关键词 + 模式匹配，上限 20 分。
        """
        controversy_kw = [
            ("牺牲", 5), ("出卖", 5), ("背叛", 5), 
            ("要么", 3), ("对错", 3), ("对的", 3),
            ("不配", 4), ("活该", 4), ("凭什么", 4),
            ("对得起", 3), ("对不起", 3), ("有什么资格", 5),
        ]
        
        score = 0
        for kw, weight in controversy_kw:
            score += chapter_text.count(kw) * weight * 0.1  # 归一化
        
        return min(20.0, score)
    
    def _generate_warnings(self, **metrics) -> list[ReaderWarning]:
        warnings = []
        
        if metrics["addiction"] < 40:
            warnings.append(ReaderWarning(
                level="critical",
                message="追更欲过低（<40），建议检查章节结尾钩子和近期爽点密度"
            ))
        if metrics["frustration"] > 70:
            warnings.append(ReaderWarning(
                level="high",
                message="主角受挫程度过高（>70），读者可能弃书，需安排胜利或进展"
            ))
        if metrics["fatigue"] > 60:
            warnings.append(ReaderWarning(
                level="medium",
                message="读者疲劳度高（>60），建议安排轻松场景或情感缓冲"
            ))
        if metrics["curiosity"] < 30 and metrics["addiction"] > 50:
            warnings.append(ReaderWarning(
                level="medium",
                message="好奇心低但追更欲尚可——读者在'追习惯'而非'追内容'，需尽快引入新谜团"
            ))
        if metrics["discussion_potential"] < 30 and metrics["tension"] > 60:
            warnings.append(ReaderWarning(
                level="low",
                message="张力高但讨论度低——可能是'爽但无争议'型章节，考虑增加道德模糊元素"
            ))
        
        return warnings
```

---

## 五、Scene Engine 2.0 — 写作执行层（含 `<log>` 标签嵌入）

### 5.1 Scene Schema 2.0（完整版，增加 log 要求）

```json
{
  "scene_id": "58_3",
  "chapter_id": 58,
  "sequence": 3,
  
  "narrative_spec": {
    "goal": "林峰获得关键线索",
    "conflict": "超脑失控风险 vs 必须推进调查",
    "emotion_arc": "压抑 → 爆发 → 短暂释放",
    "narrative_role": "mini_payoff | major_payoff | setup | bridge | cliffhanger"
  },
  
  "engagement_spec": {
    "twist": "获得的线索是假的，是反派故意设置的",
    "payoff": "揭露幕后黑手的存在",
    "hook": "假线索引出更深的谜团",
    "reader_effect": "震惊 | 紧张 | 满足 | 期待 | 愤怒"
  },
  
  "context_spec": {
    "characters": ["林峰", "苏晓晓"],
    "location": "地下实验室",
    "time": "深夜",
    "preceding_state": "林峰刚从险境脱出，超脑处于过热状态"
  },
  
  "registry_changes": [
    {"registry": "mystery", "id": "mys_003", "action": "add_clue"},
    {"registry": "twist", "id": "tw_002", "action": "add_foreshadow", "chapter": 58}
  ],
  
  "required_logs": [
    {"type": "mystery_clue", "id": "mys_003"},
    {"type": "twist_reveal", "id": "tw_002"}
  ],
  
  "beat_requirements": {
    "min_words": 800,
    "max_words": 1500,
    "must_include_payoff": true,
    "must_end_with_hook": true
  }
}
```

### 5.2 Scene 写作流水线（v3.0 完整版）

```
Chapter Outline（Planner 生成）
        ↓
Scene Planning（Writer 规划本章 3-6 个 Scene）
  ├── 读取 TensionCurve.get_warnings(chapter_id)
  ├── 读取 ReaderOS.get_state(chapter_id)
  ├── 为每个 Scene 填写完整 Scene Schema 2.0
  └── 声明 registry_changes + required_logs
        ↓
Scene Writing（逐 Scene 生成）
  ├── 注入 MemoryOS 上下文（L0→L1→L4→L2→L3）[利用缓存，见第十一节]
  ├── 注入 Character State Machine（强制读取）
  ├── 注入 Scene Schema 2.0 作为写作 spec
  ├── 注入 TensionCurve.get_warnings() 作为提示
  └── 注入 log_instructions（强制嵌入 SF_LOG 标签）
        ↓
Scene Review（Reviewer 三层 Guard + 熔断器）[v3.0 重大变更]
  ├── Fact Guard（硬规则）：通过/阻断/熔断降级
  ├── Narrative Guard（建议层）：注入下一 Scene 的 prompt
  └── Style Guard（标签层）：记录，不阻断
  │
  ├─[如果 Fact Guard 阻断]→ 重写（最多3次）
  │   └─[第3次仍阻断]→ 熔断降级：标记 + 追加兼容性注释 + 通过
  │       └─ 通知用户介入（可选）
  │
  └─[通过]→ 继续
        ↓
Scene Refining（Fact Guard 阻断时执行，含重试计数）
        ↓
Chapter Assembly（所有 Scene 拼装）
  ├── 检查 Scene 间过渡自然度
  ├── 检查全章 Beat Pattern（mini_payoff 密度）
  └── Final Review（章节整体 Fact Guard + 熔断器）
        ↓
StoryOS & MemoryOS Update
  ├── StoryOS Agent 正则解析 <log> 标签（确定性代码，无 LLM）
  ├── 对比预声明与实际 log，标记差异
  ├── 跨 Registry 事务级联（RegistryTransactionManager）
  ├── MemoryOS 更新 L0 Runtime、L1 Hot、L2 Warm
  └── MemoryOS 增量更新 L3 Cold（向量索引）
        ↓
ReaderOS Update
  └── 公式重新计算所有读者指标（零 LLM 调用）
```

---

## 六、MemoryOS — 五层记忆系统

### 6.1 五层结构

```
L0 Runtime Memory     ← 当前章节运行时状态（约 500 tokens，永远在 context 顶部）
L1 Hot Memory         ← 近5章全文 + 关键快照（约 15k tokens）
L2 Warm Memory        ← 卷/章摘要树 + 人物关系图 + 时间线（约 8k tokens）
L3 Cold Memory        ← 向量语义检索库（Qdrant + BM25 混合，按需召回）
L4 Narrative Memory   ← 叙事资产专库（与 StoryOS 强同步，约 3k tokens）
```

**检索优先级：L0 → L1 → L4 → L2 → L3**

### 6.2 L0 Runtime（完整 Schema + 更新机制定义）

**更新机制（v3.0 补全）：**

L0 Runtime 由 **Conductor** 在每个 Scene 开始前调用 `MemoryOS.update_l0()` 更新。更新来源：
- `active_characters` / `character_last_location` → 来自 StoryOS Agent 解析上一 Scene 的 `<log>` 标签
- `active_conflicts` / `active_promises` / `approaching_twists` / `approaching_reveals` → 来自 StoryOS Registry 当前状态
- `tension_level` → 来自 TensionCurve 上一章的计算结果
- `reader_addiction` → 来自 ReaderOS 上一章的计算结果
- `chapter_beat_so_far` → 来自 Writer 的 Scene Planning 阶段预声明汇总
- `pending_warnings` → 来自 TensionCurve.get_warnings()

**更新频率：** 每个 Scene 开始前更新一次（同步刷新），不在 Scene 写作过程中修改。

```json
{
  "current_volume": 3,
  "current_chapter": 58,
  "current_scene": 3,
  
  "active_characters": ["林峰", "苏晓晓"],
  "character_last_location": {
    "林峰": "地下实验室",
    "苏晓晓": "实验室门口"
  },
  
  "active_conflicts": ["cf_001", "cf_008"],
  "active_promises": ["promise_017", "promise_023"],
  "approaching_twists": ["tw_001"],
  "approaching_reveals": ["rev_005"],
  
  "tension_level": 72,
  "reader_addiction": 68,
  "current_emotion_arc": "tension_building",
  
  "chapter_beat_so_far": {
    "mini_payoffs": 1,
    "hooks_set": 2,
    "scenes_completed": 2
  },
  
  "last_major_event": "林峰发现实验室异常信号（第58章第2幕）",
  "pending_warnings": [
    "promise_017 将在第70章到期，距今12章",
    "读者对张伟反制的期待已逾期3章"
  ]
}
```

### 6.3 L1 Hot Memory — 细节衰减缓解（v3.0 新增）

v2.0 审查报告指出 L1 长上下文存在"大海捞针"退化——LLM 忽略前几章的小细节。

**v3.0 缓解策略：周期细节重提取**

```python
class L1HotMemory:
    def get_context(self, chapter_id: int) -> str:
        """
        组装 L1 上下文。每 5 章触发一次关键细节重提取，
        将分散在多章中的细节汇总成"关键细节清单"，放在 L1 上下文的顶部。
        """
        recent_chapters = self.load_recent(n=5, from_chapter=chapter_id)
        full_text = "\n\n".join(recent_chapters)
        
        # 每 5 章触发一次细节重提取
        if chapter_id % 5 == 0:
            detail_checklist = self._extract_key_details(recent_chapters)
            full_text = detail_checklist + "\n\n---\n\n" + full_text
        
        return full_text
    
    def _extract_key_details(self, chapters: list[str]) -> str:
        """
        LLM 提取最近5章中的关键状态细节，以清单格式输出。
        注意：这是 L1 唯一的一次额外 LLM 调用，每 5 章触发一次，
        开销可控（约 2000 tokens input / 500 tokens output）。
        
        输出格式：
        - 林峰左手受伤（第55章），至今未愈
        - 苏晓晓持有地下实验室的密钥卡（第56章）
        - 张伟的最后对话暗示他知道超脑秘密（第57章）
        - ...
        """
        prompt = """
        从以下章节内容中提取所有"可能在后续章节被遗忘但重要的细节"：
        - 角色身上的装备/物品/伤情
        - 角色间未完成的对话/约定
        - 环境中被提及但未探索的线索
        - 角色临时离开/进入的位置状态
        
        以清单格式输出，每条一行。只提取明确出现在文本中的内容。
        """
        return self.llm.generate(prompt + "\n\n" + "\n---\n".join(chapters), 
                                 model="fast")
```

### 6.4 L3 Cold Memory — 向量检索

分块器与混合检索同 v2.0，保持不变。以下仅列出关键方法签名：

```python
class NovelChunker:
    def chunk(self, chapter: str, chapter_id: int) -> list[Chunk]:
        """按叙事语义单元切割（场景边界→对话/叙事分离）"""
        ...

class ColdMemory:
    def hybrid_search(self, queries: list[str], top_k: int = 5,
                      filter: dict = None) -> list[Chunk]:
        """BM25 + 语义 RRF 融合"""
        ...
    
    def dedup_by_chunk_id(self, results: list[ScoredChunk], top_k: int) -> list[ScoredChunk]:
        """
        按 chunk_id 去重，保留最高分。
        v3.0 补全实现。
        """
        seen = {}
        for r in sorted(results, key=lambda x: x.score, reverse=True):
            if r.chunk_id not in seen:
                seen[r.chunk_id] = r
        return list(seen.values())[:top_k]
```

---

## 七、Character State Machine — 一致性保障（v3.0 补全）

### 7.1 完整 Schema

```json
{
  "character_id": "char_001",
  "name": "林峰",
  
  "core_psychology": {
    "beliefs": [
      "家人是一切的核心，事业是手段而非目的",
      "技术可以改变世界，但人性才是根本"
    ],
    "desires": [
      "短期：彻底打败王霸天和张伟",
      "中期：建立一个不内卷的科技公司",
      "深层：证明自己不是那个猝死的失败者"
    ],
    "fears": [
      "再次失去妹妹（核心创伤）",
      "变成自己最痛恨的那种资本家",
      "超脑失控让自己失去人性"
    ],
    "values": [
      "有仇必报（但有底线）",
      "技术应该为人服务而非控制人",
      "不放弃任何可以救赎的人"
    ]
  },
  
  "current_state": {
    "chapter": 58,
    "location": "地下实验室",
    "physical": "超脑过热，轻微头痛",
    "emotional": "高度警觉，压抑愤怒",
    "relationships": {
      "苏晓晓": "恋人，情感锚点，刚刚因危险起了争执",
      "张伟": "待清算，暂时在监狱",
      "师父": "信任，尚未发现其真实身份"
    },
    "active_goals": ["goal_002", "goal_005"],
    "known_secrets": ["超脑有意识", "王霸天幕后有人"],
    "unknown_to_character": ["师父是卧底", "超脑来源于观察者文明"]
  },
  
  "arc_stage": "成长期（从复仇者转向守护者）",
  
  "voice_signature": {
    "speech_style": "克制、简短、逻辑性强，愤怒时反而更安静",
    "thought_pattern": "先分析利弊，再决策，极少冲动",
    "forbidden": [
      "不会在公开场合哭泣",
      "不会对真正的敌人讲道德",
      "不会无原则地原谅（必须有实质性悔改）"
    ]
  }
}
```

### 7.2 状态更新机制（含 `_has_sufficient_trigger` 完整定义）

```python
class CharacterStateMachine:
    
    # v3.0：信念变化所需的叙事触发阈值
    BELIEF_CHANGE_TRIGGERS = {
        # 信念变化需要 >2 个独立叙事事件，且至少 1 个是本章内容
        "min_events_required": 2,
        "min_events_in_current_chapter": 1,
        # 允许的触发类型（硬编码，防止 LLM 幻觉）
        "valid_trigger_types": [
            "betrayal_experienced",       # 被重要人物背叛
            "death_of_loved_one",          # 重要人物死亡
            "world_truth_revealed",        # 世界观层面的真相揭示
            "personal_identity_crisis",    # 自我身份危机
            "irreversible_loss",           # 不可逆的失去
            "moral_awakening",             # 道德觉醒（亲眼见证自己行为的后果）
            "accumulated_evidence",        # v3.1 新增：渐进式认知改变
            "relationship_transformation", # v3.1 新增：关系质变（从信任到敌对/从疏远到亲密等）
        ],
        # v3.1 新增：accumulated_evidence 的特殊规则
        # 不要求单一重大事件，而是要求连续多章中出现一致指向
        "accumulated_evidence_rule": {
            "min_chapters_with_evidence": 3,  # 至少 3 个章节中有相关证据
            "min_total_evidence": 4,           # 总共至少 4 条独立证据
        }
    }
    
    def update_after_chapter(self, chapter_id: int, chapter_text: str,
                              char_id: str) -> StateChange:
        """
        StoryOS Agent 调用，章节写完后自动更新角色状态。
        v3.0：主要依赖 <log> 标签，LLM 仅用于验证。
        """
        char = self.get(char_id)
        
        # 1. 从 <log> 标签提取变化（确定性代码）
        log_changes = self._extract_from_logs(chapter_text, char.name)
        
        # 2. 只对常规变化（location/emotion/relationship/knowledge/physical）调用 LLM 验证
        #    信念变化只接受 <log> 标签来源 + sufficient_trigger 验证
        llm_changes = self.llm.extract_state_changes(
            text=chapter_text,
            character=char.name,
            current_state=char.current_state,
            prompt=STATE_EXTRACTION_PROMPT,
            exclude_types=["belief_change"]  # v3.0：信念变化不由 LLM 提取
        )
        
        # 3. 合并 <log> 来源和 LLM 来源
        all_changes = self._merge_changes(log_changes, llm_changes)
        
        # 4. 对信念变化做严格触发验证
        for change in all_changes:
            if change.type == "belief_change":
                if not self._has_sufficient_trigger(chapter_text, change, char):
                    all_changes.remove(change)
                    self.log_rejected_change(change, reason="insufficient_trigger")
        
        # 5. 应用变化
        self.apply_changes(char_id, all_changes, chapter_id)
        return StateChange(applied=all_changes, chapter_id=chapter_id)
    
    def _has_sufficient_trigger(self, chapter_text: str, change: StateChange,
                                 char: Character) -> bool:
        """
        验证信念变化是否有充分的叙事触发。
        
        判定标准：
        1. 变化必须是 <log> 标签声明的（不由 LLM 盲猜）
        2. 在近期章节（含本章）中至少存在 min_events_required 个触发事件
        3. 至少 min_events_in_current_chapter 个触发事件在本章
        4. 触发事件类型必须属于 valid_trigger_types
        
        返回 True 表示触发充分，接受变化。
        """
        # 信念变化必须来自 <log> 标签
        if change.source != "log_tag":
            return False
        
        # 统计近期章节中的触发事件
        recent_chapters_range = range(
            max(1, change.chapter_id - 3),  # 最多回看 3 章
            change.chapter_id + 1
        )
        
        trigger_events = []
        for ch_id in recent_chapters_range:
            logs = self._extract_from_logs(
                self.memory.l1.get_chapter(ch_id), char.name
            )
            for log in logs:
                if log.type in self.BELIEF_CHANGE_TRIGGERS["valid_trigger_types"]:
                    trigger_events.append({
                        "chapter": ch_id,
                        "type": log.type,
                        "detail": log.attrs
                    })
        
        events_in_current = sum(
            1 for e in trigger_events if e["chapter"] == change.chapter_id
        )
        total_events = len(trigger_events)
        
        # accumulated_evidence 使用特殊规则
        if any(e["type"] == "accumulated_evidence" for e in trigger_events):
            acc_rule = self.BELIEF_CHANGE_TRIGGERS["accumulated_evidence_rule"]
            unique_chapters = set(e["chapter"] for e in trigger_events)
            meets_accumulated = (
                len(unique_chapters) >= acc_rule["min_chapters_with_evidence"] and
                total_events >= acc_rule["min_total_evidence"]
            )
            if meets_accumulated:
                return True
        
        meets_min_total = total_events >= self.BELIEF_CHANGE_TRIGGERS["min_events_required"]
        meets_min_current = events_in_current >= self.BELIEF_CHANGE_TRIGGERS["min_events_in_current_chapter"]
        
        if not meets_min_total or not meets_min_current:
            self.log_rejected_change(change, reason={
                "total_events": total_events,
                "events_in_current": events_in_current,
                "required_total": self.BELIEF_CHANGE_TRIGGERS["min_events_required"],
                "required_current": self.BELIEF_CHANGE_TRIGGERS["min_events_in_current_chapter"],
            })
            return False
        
        return True
    
    def _extract_from_logs(self, text: str, char_name: str) -> list[StateChange]:
        """从 <log> 标签中提取与指定角色相关的状态变化"""
        logs = StoryOSAgent._parse_logs(text)  # 复用解析器
        changes = []
        for log in logs:
            if log.attrs.get("char") == char_name:
                changes.append(StateChange.from_log(log))
        return changes
```

**STATE_EXTRACTION_PROMPT（v3.0 精简版——排除信念变化）：**

```yaml
# prompts/consistency/state_extractor.yaml
system: |
  你是一个严格的角色状态追踪器。
  根据章节内容，提取角色状态的实际变化。
  
  重要规则：
  1. 只提取章节中明确发生的变化，不推断隐含的变化
  2. 信念/价值观的改变不由你提取（这些由系统的 log 标签机制处理）
  3. 人际关系的变化必须有对话或行为依据
  4. 如果没有变化，返回空数组
  5. 不要推断"隐含的"情感变化——只提取文本中明确描述的

template: |
  角色：{character_name}
  当前状态：{current_state_json}
  
  章节内容：
  {chapter_text}
  
  请提取该角色在本章发生的状态变化（location/emotion/relationship/knowledge/physical），
  以JSON数组格式输出。不要包含 belief_change 类型。
  
  如无变化，返回 []
```

---

## 八、Plot State Machine

### 8.1 状态定义

```
Created → Active → Escalated → Resolved
                ↘ Abandoned（如果作者决定放弃某条剧情线）
```

### 8.2 状态转换规则与责任归属

| 转换 | 触发条件 | 执行者 |
|---|---|---|
| Created → Active | Scene Planning 时 Writer 预声明 | Writer（预声明） |
| Active → Escalated | StoryOS Agent 检测到 `<log>` 标签中的 conflict_escalate | StoryOS Agent（确定性代码） |
| Active → Resolved | Writer 预声明，Reviewer Fact Guard 校验 | Writer + Reviewer |
| Active → Abandoned | 用户主动决定 | 用户（通过 Conductor） |
| Escalated → Resolved | Writer 预声明，Reviewer Fact Guard 校验 | Writer + Reviewer |

### 8.3 断线检测

```python
class PlotStateMachine:
    def detect_broken_threads(self, current_chapter: int) -> list[BrokenThread]:
        """
        检测所有 Active/Escalated 但长期未推进的剧情线。
        
        判定标准：
        - 超过 10 章未在任何 Scene 的 <log> 标签或预声明中被引用
        - 如果 importance=critical，阈值为 5 章
        """
        broken = []
        
        active_events = self.storyos.all_registries_active(chapter=current_chapter)
        
        for event in active_events:
            last_referenced = self.get_last_reference_chapter(event)
            gap = current_chapter - last_referenced
            
            threshold = 5 if event.importance == "critical" else 10
            
            if gap > threshold:
                broken.append(BrokenThread(
                    event=event,
                    dormant_chapters=gap,
                    severity="high" if event.importance == "critical" or gap > 15 else "medium"
                ))
        
        return broken
```

---

## 九、Agent 体系（6个）

### 9.1 Conductor — 信号仲裁（含熔断降级调度）

```python
class SignalPriority(Enum):
    FACT_GUARD_BLOCK    = 0   # 最高：Reviewer 的 Fact Guard 阻断
    CONSISTENCY_CRITICAL = 1  # 高：一致性严重违规
    TENSION_CRITICAL    = 2   # 高：张力连续三章低于阈值
    READER_ADDICTION_LOW = 3  # 中：追更欲低于40
    PROMISE_EXPIRING    = 4   # 中：承诺即将超期
    NARRATIVE_SUGGEST   = 5   # 低：叙事层建议
    STYLE_TAG           = 6   # 最低：风格标签建议

class Conductor:
    def handle_circuit_breaker(self, scene_id: str, fail_count: int,
                                fact_guard_issues: list) -> CircuitBreakerAction:
        """
        Fact Guard 熔断器：当同一 Scene 被拒绝 3 次后触发降级。
        v3.0 新增。
        """
        if fail_count < 3:
            return CircuitBreakerAction.RETRY
        
        # 熔断降级：标记问题，强制通过
        self.log_circuit_breaker_trip(scene_id, fail_count, fact_guard_issues)
        
        # 生成兼容性注释，注入章节
        compatibility_note = self._gen_compatibility_note(fact_guard_issues)
        
        # 通知用户（如果设置了人工审核门控）
        if self.user_config.human_review_on_circuit_breaker:
            self.notify_user(scene_id, fact_guard_issues, compatibility_note)
        
        return CircuitBreakerAction.FORCE_PASS_WITH_NOTE(note=compatibility_note)
    
    def _gen_compatibility_note(self, issues: list) -> str:
        """生成兼容性注释，解释为什么某个设定被允许突破"""
        notes = []
        for issue in issues:
            if issue.type == "power_ceiling_breach":
                notes.append(f"[设定修正] 角色 {issue.char_name} 在本场景突破了 {issue.rule} 的能力上限。"
                           f"原因：{issue.context}。建议后续章节将该突破纳入角色成长轨迹。")
            elif issue.type == "resolved_conflict_reactivated":
                notes.append(f"[设定修正] 已解决的冲突 {issue.conflict_id} 被重新激活。"
                           f"原因：{issue.context}。原解决方案可能不完整。")
        return "\n".join(notes)
```

### 9.2 Creative Director

职责与工作流程同 v2.0，无结构性变更。驱动 CreativeOS 全部引擎（包括 v3.0 新增的 Genre Fusion Engine），输出 Story DNA。

### 9.3 Planner

双阶段规划流程同 v2.0。Novel Blueprint Schema 不变。

### 9.4 Writer — 强制上下文组装 + Log 嵌入

```python
class Writer:
    def build_context(self, chapter_id: int, scene_schema: SceneSchema) -> WritingContext:
        """
        写作前必须完成的 7 步上下文组装。
        v3.0：利用缓存减少重复 LLM 调用（见第十一节）。
        """
        return WritingContext(
            # 1. L0 Runtime（永远注入）
            runtime=self.memory.l0.get(),
            # 2. L1 Hot（近5章全文，利用缓存）
            recent_chapters=self.memory.l1.get_recent(n=5, use_cache=True),
            # 3. L4 Narrative（当前活跃叙事资产，利用缓存）
            narrative_assets=self.memory.l4.get_active(chapter_id, use_cache=True),
            # 4. 相关 Character State Machine
            char_states=self.char_sm.get_all_relevant(scene_schema.characters),
            # 5. Scene Schema 2.0（含 required_logs）
            scene_spec=scene_schema,
            # 6. TensionCurve 预警
            tension_warnings=self.storyos.tension_curve.get_warnings(chapter_id),
            # 7. L3 语义检索（仅在需要历史细节时触发）
            retrieved_refs=self.memory.l3.hybrid_search(
                queries=self._build_retrieval_queries(scene_schema),
                top_k=3
            )
        )
    
    def inject_log_instructions(self, scene_schema: SceneSchema) -> str:
        """
        根据 Scene Schema 的 required_logs，生成具体的 log 嵌入指令。
        注入 Writer 的写作 Prompt。
        """
        instructions = []
        for log_req in scene_schema.get("required_logs", []):
            if log_req["type"] == "mystery_clue":
                instructions.append(
                    f'在揭示线索时嵌入：<!-- SF_LOG mystery_clue id="{log_req["id"]}" clue="[线索内容]" -->'
                )
            elif log_req["type"] == "twist_reveal":
                instructions.append(
                    f'在反转揭示时嵌入：<!-- SF_LOG twist_reveal id="{log_req["id"]}" trigger="[触发原因]" -->'
                )
            # ... 其他 log 类型
        
        return "\n".join(instructions)
```

### 9.5 Reviewer — 三层 Guard + 熔断器（v3.0 重大变更）

```python
class Reviewer:
    MAX_RETRIES = 3  # v3.0 新增：最大重试次数
    
    def review_scene(self, scene_text: str, scene_schema: SceneSchema,
                     retry_count: int = 0) -> ReviewResult:
        """
        三层 Guard 审查。Fact Guard 如不通过，最多重试 3 次。
        v3.0：增加熔断降级机制。
        """
        # Fact Guard（硬规则）
        fact_issues = self.fact_guard.check(scene_text, scene_schema)
        
        if fact_issues:
            if retry_count < self.MAX_RETRIES:
                return ReviewResult(
                    passed=False,
                    action="retry",
                    retry_count=retry_count + 1,
                    issues=fact_issues,
                    retry_hints=self._gen_retry_hints(fact_issues)
                )
            else:
                # 熔断降级：标记 + 追加兼容性注释 + 通过
                return ReviewResult(
                    passed=True,
                    action="force_pass_with_note",
                    circuit_breaker_tripped=True,
                    issues=fact_issues,
                    compatibility_note=self.conductor._gen_compatibility_note(fact_issues)
                )
        
        # Narrative Guard（建议层，不阻断）
        narrative_suggestions = self.narrative_guard.check(scene_text, scene_schema)
        
        # v3.1 新增：状态漂移检测——检查场景文本中是否有
        # 明显的行为变化但无对应 log 标签
        drift_warnings = self._detect_state_drift(scene_text, scene_schema)
        if drift_warnings:
            narrative_suggestions.extend(drift_warnings)
        
        # Style Guard（标签层，记录不阻断）
        style_tags = self.style_guard.check(scene_text, scene_schema)
        
        return ReviewResult(
            passed=True,
            action="continue",
            narrative_suggestions=narrative_suggestions,
            style_tags=style_tags
        )
    
    def _detect_state_drift(self, scene_text: str, 
                            scene_schema: SceneSchema) -> list[str]:
        """
        v3.1 新增：状态漂移检测。
        
        检测场景文本中是否有明显的行为变化但无对应 log 标签。
        这是对 <log> 标签机制的安全网——防止 Writer 遗漏标签导致
        状态不一致。
        
        检测逻辑（确定性代码）：
        1. 提取场景中所有角色的行为和情感关键词
        2. 与 Character State Machine 的当前状态比对
        3. 如果发现明显变化但无对应 log → 生成 warning（不阻断）
        """
        warnings = []
        characters = scene_schema.get("context_spec", {}).get("characters", [])
        
        for char_name in characters:
            char_state = self.char_sm.get(char_name)
            if not char_state:
                continue
            
            current_emotion = char_state.current_state.get("emotional", "")
            current_relationships = char_state.current_state.get("relationships", {})
            
            # 检测情感关键词变化
            emotion_keywords = {
                "愤怒": ["暴怒", "怒不可遏", "暴起"],
                "冷静": ["慌乱", "手足无措", "慌张"],
                "信任": ["怀疑", "质疑", "不可置信地看着"],
                "友善": ["冷淡", "冷漠地", "冰冷的眼神"],
            }
            
            # 对于当前情感的每个相反极性关键词，检查是否出现
            for baseline, drift_keywords in emotion_keywords.items():
                if baseline in current_emotion:
                    for kw in drift_keywords:
                        if kw in scene_text and char_name in scene_text[
                            max(0, scene_text.index(kw)-50):
                            min(len(scene_text), scene_text.index(kw)+50)
                        ]:
                            # 检查是否有对应 log
                            has_log = bool(re.search(
                                rf'<!--\s*SF_LOG\s+character_emotion\s+char="{char_name}"',
                                scene_text
                            ))
                            if not has_log:
                                warnings.append(
                                    f"[状态漂移] 角色 {char_name} 表现出与当前状态"
                                    f"「{current_emotion}」不符的行为（检测到: {kw}），"
                                    f"但无对应 SF_LOG character_emotion 标签"
                                )
        
        return warnings
    
    def _gen_retry_hints(self, issues: list) -> list[str]:
        """
        为 Writer 生成具体重写建议。
        不使用 LLM，基于问题类型的模板匹配。
        """
        hints = []
        for issue in issues:
            if issue.type == "timeline_break":
                hints.append(f"时间线冲突：角色 {issue.char_name} 在第{issue.chapter_a}章位于"
                           f"{issue.location_a}，第{issue.chapter_b}章不能同时位于{issue.location_b}。"
                           f"请修正时间顺序或增加位移说明。")
            elif issue.type == "power_ceiling_breach":
                hints.append(f"能力超限：{issue.char_name} 的设定能力上限为 {issue.ceiling}，"
                           f"本场景使用了 {issue.observed}。"
                           f"选项1：修改本场景使其不超限。选项2：在本场景提供突破的叙事理由（生死关头/代价）。")
            elif issue.type == "resolved_conflict_reactivated":
                hints.append(f"冲突 {issue.conflict_id} 已在第{issue.resolved_chapter}章解决，"
                           f"不能直接重新激活。如需重开此冲突，需提供新的触发事件。")
            elif issue.type == "registry_violation":
                hints.append(f"Registry 违规：{issue.description}。"
                           f"请检查 Scene Schema 的 registry_changes 是否符合当前 Registry 状态。")
        return hints


class FactGuard:
    """
    v3.0 硬规则检查项（确定性代码，不调用 LLM）：
    - 时间线连续性 → 比对 L2 Warm 中的 timeline 记录 + <log> 标签的 location 变化
    - 人物状态一致性 → 比对 Character State Machine 的 current_state
    - 世界规则一致性 → 比对 World Rules JSON（能力上限/规则约束）
    - Registry 合规 → 比对 StoryOS Registry 当前状态（resolved 不能变 active）
    - Log 标签完整性 → 检查 required_logs 是否全部出现在文本中
    - Log 标签格式校验 → v3.1 新增：防止格式错误导致解析失败
    """
    
    def check(self, scene_text: str, scene_schema: SceneSchema) -> list[FactIssue]:
        issues = []
        issues.extend(self._check_timeline(scene_text, scene_schema))
        issues.extend(self._check_character_state(scene_text, scene_schema))
        issues.extend(self._check_world_rules(scene_text, scene_schema))
        issues.extend(self._check_registry_compliance(scene_schema))
        issues.extend(self._check_required_logs(scene_text, scene_schema))
        issues.extend(self._check_log_format(scene_text))  # v3.1 新增
        return issues
    
    def _check_timeline(self, scene_text: str, scene_schema: SceneSchema) -> list[FactIssue]:
        """
        时间线连续性检查（确定性代码）。
        
        检查项：
        1. 场景位置与 L2 Warm timeline 记录的上一位置是否可衔接
        2. 同一角色不能同时出现在两个位置（如果本 Scene 包含多角色）
        3. 时间方向：如果是明确时间标记，检查是否倒退
        """
        issues = []
        characters = scene_schema.get("context_spec", {}).get("characters", [])
        current_location = scene_schema.get("context_spec", {}).get("location")
        
        for char_name in characters:
            char_state = self.char_sm.get(char_name)
            if not char_state:
                continue
            
            last_location = char_state.current_state.get("location")
            last_chapter = char_state.current_state.get("chapter")
            current_chapter = scene_schema.get("chapter_id")
            
            # 跨章节位置变化（允许），同章节内位置冲突检查
            if last_chapter == current_chapter and last_location != current_location:
                # 同章内位置变化需要 log 标签声明
                if not self._has_location_change_log(scene_text, char_name):
                    issues.append(FactIssue(
                        type="timeline_break",
                        char_name=char_name,
                        chapter_a=last_chapter, location_a=last_location,
                        chapter_b=current_chapter, location_b=current_location,
                        description=f"角色 {char_name} 同章内从 {last_location} 移动到 {current_location}，缺少位移 log"
                    ))
        
        return issues
    
    def _has_location_change_log(self, scene_text: str, char_name: str) -> bool:
        """检查是否有 character_relation_change 或专用 location 变化 log"""
        pattern = rf'<!--\s*SF_LOG\s+\w+\s+.*?char="{char_name}".*?-->'
        return bool(re.search(pattern, scene_text))
    
    def _check_character_state(self, scene_text: str, scene_schema: SceneSchema) -> list[FactIssue]:
        """
        角色状态一致性检查（确定性代码）。
        
        检查项：
        1. 角色不能表现出 voice_signature.forbidden 中列出的行为
        2. 角色知识一致性：已知的秘密不能被当作未知，反之亦然
        （注：此检查依赖 <log> 标签的 knowledge_gain 声明）
        """
        issues = []
        characters = scene_schema.get("context_spec", {}).get("characters", [])
        
        for char_name in characters:
            char = self.char_sm.get(char_name)
            if not char:
                continue
            
            # 检查已知/未知知识的一致性
            known = set(char.current_state.get("known_secrets", []))
            unknown = set(char.current_state.get("unknown_to_character", []))
            
            # 从文本和 log 标签中提取角色展示的知识
            displayed_knowledge = self._extract_displayed_knowledge(scene_text, char_name)
            
            for secret in unknown:
                if secret in displayed_knowledge:
                    issues.append(FactIssue(
                        type="knowledge_leak",
                        char_name=char_name,
                        description=f"角色 {char_name} 展示了不应知道的秘密：{secret}"
                    ))
        
        return issues
    
    def _extract_displayed_knowledge(self, scene_text: str, char_name: str) -> set[str]:
        """从知识相关的 log 标签和对话中提取角色展示的知识"""
        knowledge = set()
        # 检查 knowledge_gain log 标签
        pattern = rf'<!--\s*SF_LOG\s+knowledge_gain\s+char="{char_name}"\s+content="([^"]*)"'
        for m in re.finditer(pattern, scene_text):
            knowledge.add(m.group(1))
        return knowledge
    
    def _check_world_rules(self, scene_text: str, scene_schema: SceneSchema) -> list[FactIssue]:
        """
        世界规则一致性检查（确定性代码）。
        
        检查项（根据 World Rules JSON 配置）：
        1. 能力上限：角色的能力使用不超过设定的 ceiling
        2. 规则例外：如存在允许临战突破的规则（flexibility window），
           则检查该突破是否有代价/后遗症在文本中体现
        """
        issues = []
        world_rules = self.world_rules  # 从 Novel Blueprint 加载
        
        for rule in world_rules.get("power_ceilings", []):
            char_name = rule.get("character")
            ceiling = rule.get("max_level")
            flexibility = rule.get("flexibility", "none")  # none / cost_required / allowed
            
            # 检查 Scene 中是否出现超上限行为
            observed_level = self._detect_power_level(scene_text, char_name)
            if observed_level and observed_level > ceiling:
                if flexibility == "none":
                    issues.append(FactIssue(
                        type="power_ceiling_breach",
                        char_name=char_name,
                        ceiling=ceiling,
                        observed=observed_level,
                        description=f"角色 {char_name} 突破了能力上限 {ceiling}"
                    ))
                elif flexibility == "cost_required":
                    # 检查是否有代价 log 标签
                    if not re.search(rf'<!--\s*SF_LOG\s+.*?char="{char_name}".*?cost', scene_text):
                        issues.append(FactIssue(
                            type="power_ceiling_breach_no_cost",
                            char_name=char_name,
                            description=f"角色 {char_name} 突破上限但未声明代价"
                        ))
        
        return issues
    
    def _detect_power_level(self, scene_text: str, char_name: str) -> int | None:
        """从文本中检测角色能力水平（通过 T级/等级 等关键词）"""
        pattern = rf'{char_name}.*?[Tt](\d+)|[Tt](\d+).*?{char_name}'
        match = re.search(pattern, scene_text)
        if match:
            level = int(match.group(1) or match.group(2))
            return level
        return None
    
    def _check_registry_compliance(self, scene_schema: SceneSchema) -> list[FactIssue]:
        """
        Registry 合规检查（确定性代码）。
        
        检查项：
        1. 预声明的 registry_changes 不能将 status="resolved" 的条目直接改回 active
        2. 预声明的 change 引用的 Registry 条目必须存在
        3. cross_refs 引用的条目必须存在且状态兼容
        """
        issues = []
        
        for change in scene_schema.get("registry_changes", []):
            registry_type = change.get("registry")
            entry_id = change.get("id")
            action = change.get("action")
            
            entry = self.storyos.get(registry_type, entry_id)
            if not entry:
                issues.append(FactIssue(
                    type="registry_violation",
                    description=f"Registry 条目 {registry_type}/{entry_id} 不存在"
                ))
                continue
            
            # 已 resolve 的不能直接变 active
            if action == "reactivate" and entry.get("status") == "resolved":
                issues.append(FactIssue(
                    type="resolved_conflict_reactivated",
                    conflict_id=entry_id,
                    resolved_chapter=entry.get("resolution_chapter", "unknown"),
                    description=f"已解决的 {registry_type} [{entry_id}] 被尝试重新激活"
                ))
        
        return issues
    
    # ── v3.1 新增：Log 标签格式校验 ──
    
    # 合法的 SF_LOG 标签正则（严格版）
    LOG_FORMAT_PATTERN = re.compile(
        r'<!--\s*SF_LOG\s+(\w+)\s+((?:\w+=(?:"[^"]*"|\'[^\']*\')\s*)+)\s*-->'
    )
    
    def _check_log_format(self, scene_text: str) -> list[FactIssue]:
        """
        v3.1 新增：检查 SF_LOG 标签的格式正确性。
        
        格式错误示例：
        - 属性值中包含未转义的引号（嵌套引号）
        - 属性名不合法
        - 标签未正确闭合
        """
        issues = []
        
        # 查找所有可能的 SF_LOG 标签
        all_log_matches = re.finditer(r'<!--\s*SF_LOG\s+.*?-->', scene_text, re.DOTALL)
        for match in all_log_matches:
            tag = match.group(0)
            if not self.LOG_FORMAT_PATTERN.fullmatch(tag):
                issues.append(FactIssue(
                    type="log_format_error",
                    description=f"SF_LOG 标签格式不正确: {tag[:80]}..."
                ))
        
        return issues
    
    def _check_required_logs(self, scene_text: str, scene_schema: SceneSchema) -> list[FactIssue]:
        """检查 required_logs 中的日志标签是否都在文本中出现"""
        issues = []
        required = scene_schema.get("required_logs", [])
        for req in required:
            # 检查是否有对应的 SF_LOG 标签（用严格格式正则）
            pattern = f'<!--\\s*SF_LOG\\s+{req["type"]}\\s+.*?id="{req["id"]}".*?-->'
            if not re.search(pattern, scene_text):
                issues.append(FactIssue(
                    type="missing_log",
                    description=f"缺少必需的 log 标签：{req['type']} id={req['id']}"
                ))
        return issues
```

### 9.6 StoryOS Agent

职责同 v2.0，但核心更新方法已变更为 `<log>` 标签正则解析（见 3.5 节完整代码），不再有 LLM 盲猜的 `extract_implicit_changes`。

---

## 十、Style Engine — 重新集成（v3.0 补全）

v1.0 / CLAUDE.md 中 Style Engine 是核心组件，v2.0 设计文档中仅有架构图中的一个名字。v3.0 完整补全。

### 10.1 三层风格约束

```
Style Engine
├── L1 Genre Templates      # 流派/类型写作模板（爽文/悬疑/科幻/言情）
├── L2 Writing Formulas     # 写作公式模板（句子节奏/对白密度/拍子模式）
└── L3 Constraint Layer     # 禁忌检测（角色不得做的事/风格底线）
```

### 10.2 L1 — Genre Templates

以 YAML 定义每个流派的写作规则：

```yaml
# style_engine/templates/cool_novel.yaml
genre: "爽文（Cool Novel）"
version: "3.0"

sentence_rules:
  avg_sentence_length: 15-25  # 短句为主，易于快速阅读
  max_sentence_length: 40
  paragraph_length: "1-3句"   # 段落短小，增加节奏感
  
dialog_rules:
  dialog_to_narration_ratio: "0.3-0.5"  # 对白占30%-50%
  inner_monologue_max_per_scene: 200     # 内心独白不宜过多

beat_rules:
  mini_payoff_spacing: "每2-3个Scene至少1个mini_payoff"  # 爽点密度
  hook_required: "每章结尾必须有钩子"
  
forbidden:
  - "连续3段以上纯描写（无对白/无动作）"
  - "主角超过1章无积极行动"
  - "配角比主角更出彩的场景超过连续2个"
```

### 10.3 L2 — Writing Formulas

写作公式模板，定义句法级别的规则：

```python
class WritingFormula:
    """写作公式：句子级别的定量约束"""
    
    def __init__(self, formula_config: dict):
        self.name = formula_config["name"]
        self.dialog_pacing = formula_config.get("dialog_pacing", {})
        self.sentence_rhythm = formula_config.get("sentence_rhythm", {})
        self.beat_pattern = formula_config.get("beat_pattern", {})
    
    def validate_scene(self, scene_text: str) -> FormulaReport:
        """
        对 Scene 文本做公式合规检查，生成量化报告。
        全部由确定性代码执行，不调用 LLM。
        """
        sentences = self._split_sentences(scene_text)
        
        return FormulaReport(
            avg_sentence_length=statistics.mean(len(s) for s in sentences),
            sentence_length_variance=statistics.variance(len(s) for s in sentences),
            dialog_ratio=self._calc_dialog_ratio(scene_text),
            paragraph_length_distribution=self._calc_paragraph_dist(scene_text),
            violations=self._detect_violations(scene_text)
        )
```

### 10.4 L3 — Constraint Layer（禁忌检测）

每个角色和流派的禁忌规则（Forbidden Patterns）——确定性检查：

```python
class ConstraintLayer:
    def check(self, scene_text: str, character: Character, genre: str) -> list[ConstraintViolation]:
        """检测禁忌违规，纯模式匹配，不调用 LLM"""
        violations = []
        
        # 角色禁忌检测
        for forbidden in character.voice_signature.get("forbidden", []):
            if self._match_forbidden(scene_text, forbidden, character.name):
                violations.append(ConstraintViolation(
                    type="character_taboo",
                    character=character.name,
                    rule=forbidden,
                    suggestion=f"角色 {character.name} 不应{forbidden}"
                ))
        
        # 流派禁忌检测
        genre_rules = self.genre_templates.get(genre, {})
        for forbidden in genre_rules.get("forbidden", []):
            if self._match_genre_forbidden(scene_text, forbidden):
                violations.append(ConstraintViolation(
                    type="genre_taboo",
                    rule=forbidden
                ))
        
        return violations
    
    # ── 角色禁忌模式库（v3.1 补全）──
    CHARACTER_TABOO_PATTERNS = {
        "不会在公开场合哭泣": [
            (r'(在众人面前|在大家面前|当众|公开场合).{0,20}(流泪|哭泣|落泪|哭了出来)', 1.0)
        ],
        "不会对真正的敌人讲道德": [
            (r'(放过|宽恕|原谅|怜悯|同情).{0,10}(敌人|仇人|对手)', 0.8),
            (r'对.{0,5}(敌人|仇人).{0,10}(说教|讲道理|讲道德)', 0.9)
        ],
        "不会无原则地原谅": [
            (r'(原谅|宽恕).{0,10}(没有|毫无|没有任何).{0,10}(悔改|道歉|后悔|歉意)', 1.0),
            (r'毫无(理由|原因|征兆)地.{0,10}(原谅|宽恕)', 0.8)
        ],
    }
    
    # ── 流派禁忌模式库（v3.1 补全）──
    GENRE_TABOO_PATTERNS = {
        "连续3段以上纯描写（无对白/无动作）": [
            # 检测连续3段超过一定长度的纯描写段落（无引号/无动作动词）
            (r'', 0.0)  # 此规则需要在段落级别检测，此处标记为结构性检查
        ],
        "主角超过1章无积极行动": [
            (r'', 0.0)  # 跨章检测，由 Narrative Guard 负责
        ],
        "配角比主角更出彩的场景超过连续2个": [
            (r'', 0.0)  # 跨 Scene 检测，由 Narrative Guard 负责
        ],
    }
    
    def _match_forbidden(self, scene_text: str, forbidden_rule: str, 
                         char_name: str) -> bool:
        """
        检测角色禁忌规则是否在场景文本中被违反。
        
        方法：在 CHARACTER_TABOO_PATTERNS 中查找该规则的匹配模式。
        如果规则不在模式库中，使用通用启发式检测。
        
        返回 True 表示违规。
        """
        patterns = self.CHARACTER_TABOO_PATTERNS.get(forbidden_rule, [])
        
        for pattern, threshold in patterns:
            match = re.search(pattern, scene_text)
            if match:
                # 确认匹配与角色相关
                context_start = max(0, match.start() - 30)
                context_end = min(len(scene_text), match.end() + 30)
                context = scene_text[context_start:context_end]
                if char_name in context or self._is_char_speaking(context, char_name):
                    return True
        
        return False
    
    def _match_genre_forbidden(self, scene_text: str, forbidden_rule: str) -> bool:
        """
        检测流派禁忌规则是否在场景文本中被违反。
        
        如果规则在 GENRE_TABOO_PATTERNS 中标记为结构性检查（score=0.0），
        返回 False（由 Narrative Guard 等跨章检查负责）。
        """
        patterns = self.GENRE_TABOO_PATTERNS.get(forbidden_rule, [])
        
        for pattern, threshold in patterns:
            if threshold == 0.0:
                continue  # 结构性检查，跳过
            if re.search(pattern, scene_text):
                return True
        
        return False
    
    def _is_char_speaking(self, context: str, char_name: str) -> bool:
        """检测上下文是否包含该角色的对话/行动"""
        # 简单启发式：检查角色名是否出现在附近
        return char_name in context
```

### 10.5 Style Extractor（从参考文本自动提取风格规则）

```python
class StyleExtractor:
    """
    分析参考文本（如已有章节、喜欢的作家作品），
    自动提取风格特征，输出 YAML 规则文件。
    """
    def extract(self, reference_text: str, genre: str = "auto") -> StyleProfile:
        # 1. 统计特征提取（确定性）
        stats = {
            "avg_sentence_length": self._calc_avg_sentence_length(reference_text),
            "dialog_ratio": self._calc_dialog_ratio(reference_text),
            "paragraph_length_mean": self._calc_paragraph_stats(reference_text),
            "sentence_length_distribution": self._calc_sentence_dist(reference_text),
            "emotion_keyword_density": self._count_emotion_keywords(reference_text),
            "action_verb_density": self._count_action_verbs(reference_text),
        }
        
        # 2. 模式特征（确定性）
        patterns = {
            "chapter_ending_patterns": self._extract_ending_patterns(reference_text),
            "dialog_tag_preferences": self._extract_dialog_tags(reference_text),
            "transition_phrases": self._extract_transitions(reference_text),
        }
        
        # 3. LLM 仅分析文本的宏观风格类别（单次调用，输出枚举值）
        macro_style = self.llm.classify_style(
            reference_text,
            options=["cool_novel", "literary", "mystery", "romance", "scifi"]
        )
        
        return StyleProfile(
            genre=genre if genre != "auto" else macro_style,
            stats=stats,
            patterns=patterns,
            generated_rules_yaml=self._to_yaml_template(stats, patterns, macro_style)
        )
```

---

## 十一、成本与模型策略（v3.0 新增）

### 11.1 Token 预算模型

| 操作 | 调用时机 | Token 估算（输入+输出） | 推荐模型 |
|------|---------|----------------------|---------|
| Scene Writing | 每 Scene 1次 | 25K + 2K = 27K | Claude Opus 4 / DeepSeek V4 |
| Fact Guard（确定性） | 每 Scene 1次 | 0（纯代码） | N/A |
| Narrative Guard | 每 Scene 1次 | 8K + 1K = 9K | Claude Sonnet 4 |
| Style Guard（确定性） | 每 Scene 1次 | 0（纯代码） | N/A |
| StoryOS Agent 更新 | 每 Scene 1次 | 0（正则解析） | N/A |
| Character State Machine | 每 Chapter 1次 | 8K + 1K = 9K | Claude Sonnet 4 |
| ReaderOS 更新 | 每 Chapter 1次 | 0（纯公式） | N/A |
| L3 Cold 向量检索 | 每 Scene 1次 | 0（本地计算） | N/A |
| L1 细节重提取 | 每 5 Chapter 1次 | 2K + 0.5K = 2.5K | Claude Haiku / 小模型 |
| Contradiction Engine | 构思阶段 | 3K + 2K = 5K × 3次 | Claude Opus 4 |
| Mutation Engine | 构思阶段 | 2K + 1K = 3K × 4次 | Claude Opus 4 |
| WhatIf Engine | 构思阶段 | 2K + 1K = 3K × 递归 | Claude Sonnet 4 |
| Novelty Evaluator | 构思阶段 | 1K + 0K = 1K | 仅 LLM 提取标签 |

**一章（3 Scene）的估算成本：**

| 操作 | Token 消耗 |
|------|-----------|
| 3 Scene Writing × 27K | 81,000 |
| 3 Narrative Guard × 9K | 27,000 |
| 1 Character State Machine | 9,000 |
| 1/5 L1 细节重提取 | 500 |
| **合计** | **~117.5K tokens/章** |

相较于 v2.0 审查报告估算的"每 Scene 10-20万"（即每章 30-60万），v3.1 通过去 LLM 化将每章总消耗降至约 11.8 万 tokens，成本降低约 **60-75%**。

**一卷（20章）估算：** ~2.35M tokens
**五卷（100章）估算：** ~11.75M tokens

### 11.2 模型分层策略

```
Tier 1 — 创作核心（必须用最强模型）：
  ├── Scene Writing          → Claude Opus 4 / DeepSeek V4
  ├── Mutation Engine        → Claude Opus 4
  ├── Contradiction Engine   → Claude Opus 4
  └── Creative Planning      → Claude Opus 4

Tier 2 — 分析验证（强模型，可用次强）：
  ├── Narrative Guard        → Claude Sonnet 4 / GPT-4o-mini
  ├── Character State Machine → Claude Sonnet 4
  └── WhatIf Engine          → Claude Sonnet 4

Tier 3 — 辅助任务（小模型即可）：
  ├── L1 细节重提取          → Claude Haiku / Llama-3-8B (本地)
  ├── NoveltyEvaluator 标签提取 → Claude Haiku
  └── StyleExtractor 风格分类 → Claude Haiku

Tier 0 — 确定性代码（零 LLM 调用）：
  ├── Fact Guard
  ├── Style Guard (L3 模板匹配部分)
  ├── StoryOS Agent（log 解析 + 事务级联）
  ├── ReaderOS（全部 7 个指标计算）
  ├── TensionCurve 计算 & 预警
  ├── Plot State Machine 断线检测
  └── GenreFusionEngine 兼容性矩阵
```

### 11.3 Context 缓存策略

同一 Chapter 的多个 Scene 共享大量上下文，利用缓存避免重复的 token 计算：

```python
class ContextCache:
    """
    Chapter 内缓存策略：
    
    Per-Chapter 缓存（Chapter ID 不变则有效）：
    - L1 Hot Memory（5章全文）：Chapter 不变则全文不变
    - L4 Narrative Memory：Chapter 不变则不变
    - L2 Warm Memory 摘要树：Chapter 级别，同章内不变
    
    Per-Scene 缓存（每个 Scene 独立刷新）：
    - Character State Machine：Scene 写作可能改变角色状态
      （如 Scene 2 改变了角色 location，Scene 3 必须用新状态）
    
    失效时机：
    - Per-Chapter keys：Chapter 切换时清空
    - Per-Scene keys：每个 Scene 开始时刷新（不缓存于 _cache 中，直接调用 compute_fn）
    """
    
    # v3.1：标记哪些 key 是 per-scene 的
    PER_SCENE_KEYS = {"char_states"}
    
    def __init__(self):
        self._cache: dict[str, Any] = {}
        self._current_chapter_id: int = None
    
    def get_or_compute(self, key: str, chapter_id: int,
                       compute_fn: callable) -> Any:
        # 章节切换时清空缓存
        if chapter_id != self._current_chapter_id:
            self._cache.clear()
            self._current_chapter_id = chapter_id
        
        # Per-scene keys：不缓存，每次重新计算
        if key in self.PER_SCENE_KEYS:
            return compute_fn()
        
        if key not in self._cache:
            self._cache[key] = compute_fn()
        
        return self._cache[key]
```

使用示例——Writer 的 `build_context` 中：

```python
l1_hot = self.cache.get_or_compute(
    "l1_hot", chapter_id,
    lambda: self.memory.l1.get_recent(n=5)
)
l4_narrative = self.cache.get_or_compute(
    "l4_narrative", chapter_id,
    lambda: self.memory.l4.get_active(chapter_id)
)
char_states = self.cache.get_or_compute(
    "char_states", chapter_id,
    lambda: self.char_sm.get_all_relevant(scene_schema.characters)
)
```

同一 Chapter 的 3-6 个 Scene 共享这些数据，节省 ~60% 的上下文组装开销。

---

## 十二、断点续写（v3.0 完整定义）

### 12.1 Checkpoint 粒度：Scene 级别

```json
{
  "checkpoint_version": "3.0",
  "project_id": "proj_001",
  "timestamp": "2025-01-15T14:30:00Z",
  
  "pipeline_stage": "scene_writing",  
  "chapter_id": 58,
  "scene_id": "58_3",
  "scene_sequence": 3,
  
  "snapshots": {
    "l0_runtime": { "...": "完整 L0 Runtime JSON" },
    "storyos_registries": { "...": "所有 Registry 的当前状态" },
    "character_states": { "...": "所有角色的 State Machine JSON" },
    "reader_state": { "...": "ReaderOS 最新指标" }
  },
  
  "pending_operations": [
    "scene_writing_58_3", "scene_review_58_3", "chapter_assembly_58"
  ],
  
  "completed_operations": [
    "scene_planning_58", "scene_writing_58_1", "scene_writing_58_2",
    "scene_review_58_1", "scene_review_58_2"
  ]
}
```

### 12.2 崩溃恢复路径

```
系统恢复时读取 .storyforge_checkpoint.json：

1. 如果 pipeline_stage == "scene_writing"：
   → 从 snapshot 恢复 L0 Runtime + Character States + Registry
   → 重新执行 Scene Writing（检查是否有未完成的 Scene 输出）
   → 如果有部分输出（LLM 调用超时），重新调用 Writer

2. 如果 pipeline_stage == "scene_review"：
   → Scene 文本已写入磁盘（Chapter MD 文件）
   → 只需重新运行 Reviewer

3. 如果 pipeline_stage == "chapter_assembly"：
   → 所有 Scene 已写入
   → 重新运行 Chapter Assembly

4. 如果 pipeline_stage == "storyos_update"：
   → Chapter 完整，只需重新运行 StoryOS Agent 更新

恢复后校验：
  - 所有 Registry 的 cross_refs 引用完整性
  - L0 Runtime 与 Registry 实际状态的一致性
  - Checkpoint timestamp 与最后写入文件的 timestamp 对比
```

Checkpoint 写入频率：每个 Scene 完成后写入一次（覆盖模式）。

---

## 十三、项目目录结构（v3.0 完整版）

```
storyforge/
│
├── conductor/
│   ├── state_machine.py          # 创作阶段状态机
│   ├── gate_controller.py        # 人工审核门控
│   ├── signal_arbiter.py         # OS 间信号仲裁
│   ├── circuit_breaker.py        # Fact Guard 熔断器（v3.0 新增）
│   └── checkpoint.py             # 断点续写（v3.0 补全粒度定义）
│
├── creative_os/
│   ├── idea_pool.py
│   ├── trope_pool.py
│   ├── mutation_engine.py
│   ├── contradiction_engine.py
│   ├── whatif_engine.py
│   ├── genre_fusion_engine.py    # v3.0 完整补全
│   ├── novelty_evaluator.py      # v3.0 补全所有未定义函数
│   └── story_dna.py
│
├── story_os/
│   ├── registries/
│   │   ├── conflict.py
│   │   ├── promise.py
│   │   ├── mystery.py
│   │   ├── twist.py
│   │   ├── reveal.py
│   │   ├── goal.py
│   │   └── expectation.py
│   ├── registry_transaction.py   # v3.0 新增：跨 Registry 事务管理
│   ├── tension_curve.py          # v3.0 补全 _suggest_tension_boosts
│   └── storyos.py
│
├── memory_os/
│   ├── l0_runtime.py             # v3.0 补全更新机制
│   ├── l1_hot.py                 # v3.0 新增细节重提取
│   ├── l2_warm.py
│   ├── l3_cold/
│   │   ├── chunker.py
│   │   ├── embedder.py
│   │   ├── bm25_index.py
│   │   └── hybrid_search.py      # v3.0 补全 dedup_by_chunk_id
│   ├── l4_narrative.py
│   └── context_cache.py          # v3.0 新增：Context 缓存
│
├── reader_os/
│   ├── state.py
│   ├── calculator.py             # v3.0：零 LLM 调用，全部公式计算
│   └── warnings.py
│
├── scene_engine/
│   ├── schema.py
│   ├── beat_pattern.py
│   └── log_spec.py               # v3.0 新增：SF_LOG 标签规范
│
├── style_engine/                 # v3.0 完整补全（从 v1.0 重新集成）
│   ├── genre_templates/          # L1 流派模板
│   │   ├── cool_novel.yaml
│   │   ├── mystery.yaml
│   │   ├── literary.yaml
│   │   └── scifi.yaml
│   ├── writing_formulas.py       # L2 写作公式
│   ├── constraint_layer.py       # L3 禁忌检测
│   └── style_extractor.py        # 参考文本分析
│
├── consistency/
│   ├── character_state_machine.py  # v3.0 补全 _has_sufficient_trigger
│   └── plot_state_machine.py
│
├── agents/
│   ├── base_agent.py
│   ├── creative_director.py
│   ├── planner.py
│   ├── writer.py                 # v3.0：log_instructions 注入 + 缓存使用
│   ├── reviewer.py               # v3.0：熔断器 + retry hints
│   └── storyos_agent.py          # v3.0：正则解析 log 标签，无 LLM 盲猜
│
├── prompts/
│   ├── creative/
│   │   ├── mutation_engine.yaml
│   │   ├── contradiction_engine.yaml
│   │   ├── whatif_engine.yaml
│   │   ├── genre_fusion.yaml      # v3.0 新增
│   │   └── novelty_evaluator.yaml
│   ├── planning/
│   │   ├── creative_planning.yaml
│   │   └── narrative_planning.yaml
│   ├── writing/
│   │   ├── scene_writer_cool.yaml  # v3.0：增加 log_instructions 区域
│   │   ├── scene_writer_literary.yaml
│   │   └── scene_writer_mystery.yaml
│   ├── review/
│   │   ├── fact_guard.yaml
│   │   ├── narrative_guard.yaml
│   │   └── style_guard.yaml
│   └── consistency/
│       └── state_extractor.yaml   # v3.0：排除信念变化提取
│
├── cost/                          # v3.0 新增
│   ├── token_budget.py            # Token 预算追踪
│   ├── model_router.py            # Tier 1/2/3 模型路由
│   └── llm_usage.jsonl
│
├── projects/{project_id}/
│   ├── story_dna.json
│   ├── novel_blueprint.json
│   ├── storyos/
│   │   ├── conflicts.json
│   │   ├── promises.json
│   │   ├── mysteries.json
│   │   ├── twists.json
│   │   ├── reveals.json
│   │   ├── goals.json
│   │   └── expectations.json
│   ├── memory/
│   │   ├── l0_runtime.json
│   │   ├── l2_warm_summaries/
│   │   └── l3_cold/
│   ├── consistency/
│   │   └── characters/
│   ├── style_engine/
│   │   └── extracted_profile.yaml
│   ├── reader_os/
│   │   └── reader_state_history.jsonl
│   ├── chapters/
│   │   ├── 001_死亡回档.md
│   │   └── ...
│   ├── .storyforge_checkpoint.json  # v3.0：Scene 级别 checkpoint
│   └── .storyforge_status.json
│
├── config/
│   ├── expert_config.yaml
│   └── model_tiers.yaml            # v3.0 新增：模型分层配置
│
└── llm_usage.jsonl
```

---

## 十四、开发路线图（v3.0 调整）

### Phase 1 — 最小可靠闭环（4周）

目标：完成 `Planner → 1章（多Scene）→ Writer（含 log 标签）→ Reviewer（含熔断器）→ StoryOS Update（正则解析）` 的完整循环。

**Week 1-2：**
- Conductor 状态机基础版 + 熔断器框架
- StoryOS Registry CRUD（Conflict/Promise/Mystery）含 cross_refs 外键
- MemoryOS L0/L1/L2 + ContextCache
- Character State Machine 基础版（含 `_has_sufficient_trigger`）

**Week 3-4：**
- Writer Agent（Scene 粒度 + log 标签注入）
- SF_LOG 标签规范 & StoryOS Agent 正则解析器
- Reviewer（Fact Guard 硬规则 + 3次重试熔断）
- Fact Guard 确定性检查项（时间线/状态/规则/Registry/log完整性）
- 完成一章的端到端测试

**Phase 1 验收标准：** 
- 系统能自动写完1章（3-5个Scene），每个 Scene 含完整的 SF_LOG 标签
- Fact Guard 能拦截至少一个一致性错误并成功触发重写
- 第3次重写失败时熔断器正确降级
- StoryOS Agent 正则解析 log 标签更新 Registry 零 LLM 调用

### Phase 2 — 叙事引擎（8周）

- Twist/Reveal/Goal/Expectation Registry（含全部 cross_refs）
- RegistryTransactionManager（跨 Registry 事务级联）
- Tension Curve 引擎 + `_suggest_tension_boosts` 完整实现
- ReaderOS（7个指标，零 LLM 调用）
- MemoryOS L3 Cold（Qdrant + BM25 + dedup_by_chunk_id）
- Plot State Machine + 断线检测
- Scene Schema 2.0 完整版（含 required_logs）
- L1 Hot 细节重提取（每5章触发）

**Phase 2 验收标准：** 
- 系统能写完一卷（20章）
- TensionCurve 预警至少触发一次并影响了写作内容
- 跨 Registry 级联更新正确触发（Mystery revealed → Reveal revealed → Expectation fulfilled）
- ReaderOS 零 LLM 调用，所有指标由公式计算
- L1 细节重提取正确发现潜在遗忘细节

### Phase 3 — 创意引擎（12周）

- CreativeOS 全部 Engine（含 Genre Fusion Engine 完整实现）
- Story DNA + Novel Blueprint 完整流程
- Creative Director Agent
- Novelty Evaluator（四维度完整计算，`_calc_contradiction_depth` 正则匹配，`discussion_potential` 公式化）
- Style Engine 完整集成（L1/L2/L3 + Style Extractor）
- 模型分层路由（Tier 1/2/3 配置）
- Token 预算追踪

**Phase 3 验收标准：** 
- 从用户的一句话意图出发，系统能自动生成 Story DNA → Novel Blueprint
- Novelty Evaluator 四维度评分完全可复现（确定性计算）
- Style Engine 成功约束 Writer 的写作风格
- Token 预算跟踪显示每章成本在预估范围内
- 产出有别于常见套路的创意组合（Novelty ≥ 75）

---

*StoryForge 3.0 — 用确定性代码控制骨架，用 LLM 填充血肉。让 LLM 做它最擅长的事（创作），把一致性、评估、状态管理留在符号系统中。*
