# Phase 4a: WritingFormulaAnalyzer + 模板扩展 — 设计方案

> 日期: 2026-06-15 | 状态: 已确认 | 依赖: Phase 0-3

## 范围

v1.6 TRD Phase 4，写作公式检查部分（Steps 4.3 + 4.5），约 6h。

### 本轮实现

- WritingFormulaAnalyzer：确定性统计（句长、对白比、段落密度）+ Tier 3 LLM 辅助（爽点密度、爽点计数、悬念钩子）
- 体裁模板扩展：`cool_novel.yaml` 新增 `style_formula` 区块
- 集成到 ChapterReviewBuilder，填充 `writing_formula_compliance` 占位

### 本轮不实现

- TabooConstraintChecker（L3 禁忌约束）— TRD 4.4，单独 spec
- 角色成长曲线模型 — TRD 4.1，单独 spec
- 前端 WritingFormulaPanel — Phase 5
- `style_rules` 主观规则（如"配角反应描写"）— 不在本次范围

---

## 1. 架构

```
ChapterReviewBuilder._check_writing_formula()
        │
        ├── 收集章内所有 scene draft 文本
        │
        ▼
WritingFormulaAnalyzer.analyze(scene_texts, genre_template)
        │
        ├── 确定性 (tier_0):
        │     ├── _analyze_sentence_stats()   → avg_length, short/medium/long 分布
        │     ├── _analyze_dialogue_stats()   → ratio, max_consecutive_lines
        │     └── _analyze_paragraph_stats()  → max_sentences, max_words
        │
        ├── LLM 辅助 (Tier 3 Haiku):
        │     ├── _detect_emotional_beats()   → density (per 1000 chars)
        │     ├── _count_satisfaction_beats() → count
        │     └── _detect_suspense_hook()     → bool
        │
        └── check_compliance(stats, formula) → list[ComplianceResult]
              │
              ▼
        填入 review["writing_formula_compliance"]
```

## 2. 确定性检查规则

### 句长统计

复用 `style_extractor.py` 的 `_split_sentences()` 和 `_char_count()`（不复制代码，直接 import）。

| 指标 | 计算方式 | 阈值来源 |
|------|----------|----------|
| avg_sentence_length | 所有句子的平均中文字符数 | `style_formula.sentence.avg_length_max` |
| short_ratio | ≤15 字的句子占比 | `style_formula.sentence.short_pct_min` |
| long_ratio | >40 字的句子占比 | `style_formula.sentence.long_pct_max` |

### 对白统计

复用 `style_extractor.py` 的 `_DIALOGUE_PATTERN` 和 `_char_count()`。

| 指标 | 计算方式 | 阈值来源 |
|------|----------|----------|
| dialogue_ratio | 对白字符数 / 总字符数 | `style_formula.dialogue.ratio_min` |
| max_consecutive_lines | 连续引号对的最大数量 | `style_formula.dialogue.max_consecutive_lines` |

### 段落统计

| 指标 | 计算方式 | 阈值来源 |
|------|----------|----------|
| max_para_sentences | 段落中最大句子数（按 `\n\n` 分段） | `style_formula.paragraph.max_sentences` |
| max_para_words | 段落中最大中文字符数 | `style_formula.paragraph.max_words` |

## 3. LLM 辅助检查 (Tier 3 Haiku)

### 爽点检测

```yaml
prompt: |
  你是一位网文编辑。分析以下章节文本，检测"爽点"（能力展示/打脸/逆袭/收获/突破）。
  输出 JSON：
  {
    "emotional_beat_density": <每千字的爽点数量>,
    "satisfaction_beats": [
      {"type": "能力展示|打脸|逆袭|收获|突破", "description": "一句话描述"}
    ]
  }
```

从 LLM 响应解析 `emotional_beat_density` 和 `satisfaction_beat_count`（`len(satisfaction_beats)`）。

降级：LLM 不可用时，`emotional_beat_density=0.0`, `satisfaction_beat_count=0`，该指标的 compliance 判定为 `passed=True`（不因 LLM 不可用而报假阳性）。

### 悬念钩子检测

```yaml
prompt: |
  你是一位网文编辑。检查章节结尾是否有悬念钩子（新敌人/新目标/新线索/未解谜题）。
  输出 JSON：{"suspense_hook_present": true|false}
```

降级：LLM 不可用时，`suspense_hook_present=False`，compliance 判定为 `passed=True`。

## 4. 数据模型

```python
@dataclass
class ComplianceResult:
    metric: str        # metric name
    expected: str      # human-readable expected value
    actual: str        # human-readable actual value
    passed: bool

@dataclass
class WritingFormulaStats:
    # Deterministic
    avg_sentence_length: float = 0.0
    short_ratio: float = 0.0
    medium_ratio: float = 0.0
    long_ratio: float = 0.0
    dialogue_ratio: float = 0.0
    max_consecutive_dialogue: int = 0
    max_para_sentences: int = 0
    max_para_words: int = 0
    # LLM-assisted (Tier 3)
    emotional_beat_density: float = 0.0
    satisfaction_beat_count: int = 0
    suspense_hook_present: bool = False

class WritingFormulaAnalyzer:
    """L2 写作公式统计 + 合规检查。确定性 + Tier 3 LLM 辅助。"""

    def analyze(
        self, scene_texts: list[str], genre_template: dict
    ) -> WritingFormulaStats:
        """Run full analysis pipeline on chapter scene texts."""
        ...

    def check_compliance(
        self, stats: WritingFormulaStats, formula: dict
    ) -> list[ComplianceResult]:
        """Compare stats against formula thresholds. Returns compliance list."""
        ...
```

## 5. 体裁模板扩展

`data/style/cool_novel.yaml` 新增：

```yaml
style_formula:
  sentence:
    avg_length_max: 30
    short_pct_min: 30
    long_pct_max: 20
  dialogue:
    ratio_min: 0.20
    max_consecutive_lines: 8
  paragraph:
    max_sentences: 5
    max_words: 300
  emotional_beat:
    min_per_1k: 1.5
  satisfaction_beat:
    min_count: 3
  suspense_hook:
    required: true
```

`GenreTemplate` 新增方法 `get_style_formula(template_name)` 读取此区块。

## 6. ChapterReviewBuilder 集成

`ChapterReviewBuilder.build_review()` 中：

```python
# 替换原来的 "writing_formula_compliance": []
review["writing_formula_compliance"] = self._check_writing_formula(chapter_number)
```

`_check_writing_formula()` 方法（同步，确定性检查）：
- 读取章内所有 scene draft 文件
- 调用 `GenreTemplate.get_style_formula()` 获取公式阈值
- 调用 `WritingFormulaAnalyzer.analyze_sync()` → 确定性统计 + `check_compliance()`
- 返回 `list[dict]`，异常时返回 `[]`

`_check_writing_formula_async()` 方法（可选，LLM 增强）：
- 在同步结果基础上，调用 `WritingFormulaAnalyzer.analyze_llm()` 补充爽点/悬念指标
- 失败时静默降级，保留确定性检查结果

`build_review()` 调用同步版本，`build_review_async()` 在获得基础 review 后调用异步版本补充 LLM 指标。与 CoherenceScorer 的 sync→async 升级模式一致。

## 7. 降级策略

| 场景 | 行为 |
|------|------|
| 体裁模板无 `style_formula` 区块 | 返回 `[]`（模板未配置，跳过检查） |
| 章内无 scene draft 文件 | 返回 `[]` |
| 确定性检查异常 | 该指标跳过，记录 warning |
| Tier 3 LLM 不可用 | 爽点/悬念指标 passed=True，不报假阳性 |
| 整体异常 | 返回 `[]`，不阻断评审流程 |

## 8. 文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `backend/style_engine/writing_formulas.py` | **新增** | ~220 行 |
| 2 | `data/style/cool_novel.yaml` | 修改 | +18 行 |
| 3 | `backend/style_engine/genre_template.py` | 修改 | +5 行 (get_style_formula) |
| 4 | `backend/style_engine/__init__.py` | 修改 | +2 行 |
| 5 | `backend/conductor/chapter_review.py` | 修改 | +20 行 |
| 6 | `tests/test_writing_formulas.py` | **新增** | ~12 测试 |

## 9. 验收标准

1. `WritingFormulaAnalyzer.analyze()` 返回正确的句长/对白/段落统计
2. `check_compliance()` 正确对比实际值与模板阈值
3. 爽点检测 + 悬念钩子检测使用 Tier 3 LLM，降级时不报假阳性
4. `ChapterReviewBuilder._check_writing_formula()` 返回合规列表
5. `writing_formula_compliance` 不在是空列表（有 scene draft 时）
6. LLM 不可用时所有 LLM 指标 passed=True
7. 零新增 test 失败（现有 376 passed 保持不变）
