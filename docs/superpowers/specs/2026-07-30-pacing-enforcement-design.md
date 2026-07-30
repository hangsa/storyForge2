# Pacing 字段生效方案 — 设计

> 适用范围：让 `config/genres/<id>.yaml` 中已有的 `pacing` 6 字段在 AI 生成链路里真正起作用。
> 严格度：**prompt 注入 + review 报告，不 retry**。
> 不改前端（依赖 `chapter_review.json` 已包含 `pacing_compliance` 字段后由前端自然消费）。

---

## 1. 背景与目标

### 1.1 当前状态（已验证）

- `config/genres/<id>.yaml` 7 份题材已定义 `pacing` 块，共 6 字段：`min_beats_per_1k`、`escalation_interval`、`action_ratio`、`max_consecutive_non_action`、`chapter_words.{min,max}`、`scene_words.{min,max}`。
- `GenreCatalog.get_pacing(id)` 已存在并暴露完整 dict。
- `GenreTemplate.get_pacing()`（legacy wrapper）也已存在，但**生产代码无任何调用者**——字段是死配置。
- `WritingFormulaAnalyzer`（`backend/style_engine/writing_formulas.py`）为"先写后检"的 L2 合规检测模板，本方案沿用其形态做 L2 pacing 合规检测。

### 1.2 目标

- 6 个 `pacing` 字段全部在 AI 生成链路里生效。
- 注入时机分两层：Planner（章节级）+ Writer（场景级）。
- 校验时机：章节级 review 一次性产出 `pacing_compliance` 报告。
- **零 retry，零 circuit breaker 改造，零写作流打断**。

---

## 2. 架构

| 层 | 改造点 | 文件 |
|---|---|---|
| 数据层 | 无改动 | `config/genres/*.yaml` |
| Catalog | 已有 `get_pacing()`，复用 | `backend/genres/catalog.py` |
| Planner 注入 | `_resolve_genre_pacing(genre)` + `{genre_pacing}` 占位 | `backend/agents/planner.py` · `backend/prompts/novel_outline_generation.yaml` · `backend/prompts/outline_generation.yaml` |
| Writer 注入 | `_resolve_genre_scene_pacing(genre)` + `{genre_pacing_scene}` 占位 | `backend/agents/writer.py` · 对应 scene writing yaml |
| Pacing 分析器 | `PacingAnalyzer.analyze_sync()` + `check_compliance()` | `backend/style_engine/pacing.py`（新文件） |
| Review 报告 | `_check_pacing(chapter_number)`，复用 `_check_writing_formula` 模板 | `backend/conductor/chapter_review.py` |
| API 输出 | `chapter_review.json` 增字段 `pacing_compliance` | 无需新代码，序列化 review dict 即可 |

---

## 3. 组件

### 3.1 `PacingAnalyzer`（新文件 `backend/style_engine/pacing.py`）

完全仿 `WritingFormulaAnalyzer` 形态：

```python
@dataclass
class PacingStats:
    chapter_word_count: int = 0
    scene_word_counts: list[int] = field(default_factory=list)
    action_ratio: float = 0.0              # 动作段占比
    max_consecutive_non_action: int = 0
    sf_log_tags_per_1k: float = 0.0        # SF_LOG 标签 / (字数/1000)

@dataclass
class PacingCompliance:
    metric: str
    expected: str
    actual: str
    passed: bool
    delta_pct: float = 0.0                 # 偏离百分比，正负皆可
```

公开 API：
```python
class PacingAnalyzer:
    def analyze_sync(self, scene_texts: list[str]) -> PacingStats: ...
    def check_compliance(self, stats: PacingStats, pacing: dict, tolerances: dict | None = None) -> list[PacingCompliance]: ...
```

`tolerances` 形如 `{"action_ratio_tolerance": 0.30, ...}`；缺省字段默认 `0.30`；缺省整个 dict 也用默认。

### 3.2 `ChapterReviewBuilder._check_pacing`

完全仿 `_check_writing_formula`：

```python
def _check_pacing(self, chapter_number: int) -> list[dict]:
    try:
        from backend.style_engine.pacing import PacingAnalyzer
        from backend.style_engine.genre_template import GenreTemplate

        texts = self._collect_scene_texts(chapter_number)
        if not texts:
            return []

        pacing = GenreTemplate().get_pacing(self._detect_genre())
        if not pacing:
            return []

        stats = PacingAnalyzer().analyze_sync(texts)
        tolerances = _extract_tolerances(pacing)   # 见 §3.3
        results = PacingAnalyzer().check_compliance(stats, pacing, tolerances)
        return [
            {
                "metric": r.metric,
                "expected": r.expected,
                "actual": r.actual,
                "passed": r.passed,
                "delta_pct": r.delta_pct,
            }
            for r in results
        ]
    except Exception as e:
        logger.warning("Pacing check failed (non-blocking): %s", e)
        return []
```

写入位置：`build_review()` 中 `formula_compliance` 之后追加 `pacing_compliance`：
```python
"pacing_compliance": self._check_pacing(chapter_number),
```

`_check_writing_formula_async` 同理并行新增 `_check_pacing_async`（保持一致——async 路径仍走 `analyze_sync`，本设计不引入 LLM 参与 pacing）。

### 3.3 注入：Planner 与 Writer 的字段切片

`_resolve_genre_pacing(genre)` 返回整章相关 4 字段（chapter_words、scene_words、escalation_interval、min_beats_per_1k），渲染为多行文本：

```
【题材节奏约束】（仅供大纲章节拆分参考）
- 单章字数：3000~6000 字（参考值，目标 min~max 之间）
- 单场字数：500~2000 字
- SF_LOG 标签密度：≥ 1.5 个/千字
- 冲突升级间隔：每 3 章升级一次冲突烈度
```

`_resolve_genre_scene_pacing(genre)` 返回场景相关 4 字段（scene_words、action_ratio、max_consecutive_non_action、min_beats_per_1k），渲染为：

```
【本场节奏约束】（仅作写作参考，不阻塞）
- 本场字数：500~2000 字（参考值）
- 动作/感官段占比目标：0.45（±30%）
- 连续非动作段最多：2 段
- SF_LOG 标签密度：≥ 1.5 个/千字
```

### 3.4 字段—层映射（注入/校验对应）

| pacing 字段 | Planner 注入 | Writer 注入 | review 校验 | 目标值口径 |
|---|---|---|---|---|
| `chapter_words.{min,max}` | ✅ | ❌ | ✅ 章节级 | target = (min+max)/2 |
| `scene_words.{min,max}` | ✅ | ✅ | ✅ 场景级 | target = (min+max)/2，每场独立判定 |
| `action_ratio` | ❌ | ✅ | ✅ 场景级 | target 直接，**delta_pct = (actual - target) / target**（可负） |
| `max_consecutive_non_action` | ❌ | ✅ | ✅ 场景级 | passed = (actual ≤ target) |
| `min_beats_per_1k` | ❌ | ✅ | ✅ 章节级（聚合） | target 直接；actual 不足时 failed |
| `escalation_interval` | ✅ | ❌ | ❌ | 仅 prompt 注入；不校验（跨章节奏） |

`chapter_words.min` / `chapter_words.max` 单独两条 metric（`chapter_words.min` passed = actual ≥ min；`chapter_words.max` passed = actual ≤ max）。其余数值字段均为 `delta_pct = (actual - target) / target`。

---

## 4. 关键判定口径

### 4.1 "动作段" 定义（采纳方案 (i)）

- 段落级判定：以 `\n\n` 切段。
- 动作段 = 该段不含对白引号（`"`/`"`/`「`/`」`）**且** regex `r'(?:挥|砍|刺|击|撞|踢|抓|夺|逃|冲|扑|挡|躲|闪|跃|跳|抓|撕|咬|撕|撞|坠|爆|射|轰|踢|扑|掀|掀|掣|抬|纵|推|挥|撕|砍|攻|袭|奔|飞|弹|射|引爆|追击|冲撞|扑倒)'` 至少命中 1 次。
- 这条规则可读性优先；后续如要扩展，落到 `pacing.py` 顶部的常量即可，不污染调用方。

> §4.2 替代方案（ii/iii）已被否决，理由：与现有 SF_LOG 体系耦合过深 / 太宽导致失真。

### 4.2 `min_beats_per_1k` 计 "beat"

- 复用 `scene_engine.log_spec` 的 SF_LOG 正则：`r'<!--\s*SF_LOG\s+[a-z_]+'`。
- 整章聚合：`len(matches) / (chapter_word_count / 1000)`。
- 不区分类型（与方案 A 的"宽口径"保持一致）。

### 4.3 容忍度

- 每个字段可独立配 `<field>_tolerance`（`0.30` 表示 ±30%）。
- 未配字段默认 `0.30`；整段未配也默认。
- `max_consecutive_non_action` 例外：直接 `passed = (actual ≤ target)`，没有 tolerance 概念（§4.4）。
- `chapter_words.min` / `chapter_words.max` 例外：单向阈值（`≥ min` / `≤ max`），没有 tolerance。

### 4.4 例外字段的 passed 规则

| metric | passed 规则 |
|---|---|
| `chapter_words.min` | `actual ≥ min` |
| `chapter_words.max` | `actual ≤ max` |
| `max_consecutive_non_action` | `actual ≤ target` |
| `scene_words.min` | `actual ≥ min` |
| `scene_words.max` | `actual ≤ max` |
| `action_ratio` | `abs(actual - target) / target ≤ action_ratio_tolerance` |
| `min_beats_per_1k` | `actual ≥ target`（目标值下限语义） |

---

## 5. 数据流（端到端）

```
1. Planner.generate_novel_outline
   ├─ genre = "xianxia"
   ├─ pacing_text = _resolve_genre_pacing("xianxia")
   └─ render prompt with {genre_pacing}            # 已包含 chapter_words / scene_words / escalation_interval / min_beats_per_1k

2. Writer.write_scene
   ├─ genre = "xianxia"
   ├─ scene_pacing_text = _resolve_genre_scene_pacing("xianxia")
   └─ render scene prompt with {genre_pacing_scene}  # 已包含 scene_words / action_ratio / max_consecutive_non_action / min_beats_per_1k

3. Reviewer.FactGuard + NarrativeGuard + StyleGuard  (不变)

4. ChapterReviewBuilder.build_review(chapter_number)
   └─ pacing_compliance = self._check_pacing(chapter_number)

   PacingAnalyzer.analyze_sync(scene_texts):
     ├─ chapter_word_count = total chars
     ├─ scene_word_counts  = per-scene chars
     ├─ action_ratio        = action_segments / total_segments
     ├─ max_consecutive_non_action = max run of non-action segments
     └─ sf_log_tags_per_1k  = len(re.findall(SF_LOG_RE, merged)) / (total_chars / 1000)

   PacingAnalyzer.check_compliance(stats, pacing, tolerances)
     └─ 7 条 PacingCompliance（scene_words.min / scene_words.max 各按场景循环，chapter_words 仅 1 条聚合）

5. chapter_review.json writes:
   {
     "writing_formula_compliance": [...],
     "pacing_compliance": [
       {"metric": "chapter_words.min", "expected": 3000, "actual": 4200, "passed": true, "delta_pct": 0.0},
       {"metric": "chapter_words.max", "expected": 7000, "actual": 4200, "passed": true, "delta_pct": 0.0},
       {"metric": "scene_words.min",   "expected": 600,  "actual": 480,  "passed": false, "delta_pct": -0.20},
       ...
     ],
     ...
   }
```

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| `{genre_pacing}` / `{genre_pacing_scene}` 在 prompt 模板里没占位 | 注入层 try/except 兜底；log warning；模板原行为不变 |
| 题材 YAML 缺 tolerance 字段 | 整 dict 用默认 `{"*_tolerance": 0.30}`；不抛错 |
| 某场 scene_text 缺失（写前中断） | `_collect_scene_texts` 跳过；该 metric 的 `actual` 留空字符串、`passed` 为 `null` |
| 全章 0 场草稿 | `pacing_compliance` 返回 `[]`；前端卡片显示 "无可校验数据"（前端无需改） |
| `PacingAnalyzer` 异常 | 与现有 `_check_writing_formula` 一致，捕获后 log warning 并返回 `[]`（非阻塞） |
| `GenreCatalog.get_pacing()` 抛错 | `GenreTemplate.get_pacing()` 失败 → `_check_pacing` 返回 `[]` |

---

## 7. 测试

新增 `tests/test_pacing_enforcement.py`，仿 `tests/test_genre_beat_patterns.py` 与 `tests/test_writing_formulas.py` 的组织风格：

### 7.1 TestPromptWiring（4 用例）
- `planner_novel_outline_prompt_contains_genre_pacing_placeholder`
- `planner_outline_prompt_contains_genre_pacing_placeholder`
- `writer_scene_prompt_contains_genre_pacing_scene_placeholder`
- `_resolve_genre_pacing` / `_resolve_genre_scene_pacing` 输出包含题材字段值

### 7.2 TestPacingAnalyzer（6 用例）
- `analyze_sync_empty_texts_returns_zero_stats`
- `analyze_sync_counts_chapter_words_correctly`
- `analyze_sync_counts_scene_words_per_scene`
- `analyze_sync_detects_action_segments_via_verb_regex`
- `analyze_sync_detects_max_consecutive_non_action`
- `analyze_sync_counts_sf_log_tags_per_1k`

### 7.3 TestCompliance（5 用例）
- `check_compliance_scene_words_min_passes_when_above`
- `check_compliance_scene_words_max_fails_when_above`
- `check_compliance_action_ratio_uses_tolerance_window`
- `check_compliance_max_consecutive_non_action_one_sided`
- `check_compliance_min_beats_one_sided_actual_must_meet_target`

### 7.4 TestChapterReview（3 用例）
- `chapter_review_includes_pacing_compliance_key`
- `chapter_review_empty_scene_texts_yields_empty_list`
- `chapter_review_pacing_failure_does_not_block_build`

### 7.5 TestFieldCoverage（2 用例）
- `all_six_pacing_fields_have_injection_or_check_coverage`
- `escalation_interval_only_prompt_no_review_check`

**不在测试范围内**：前端 UI 改动、circuit breaker 行为（本期不引入 retry）。

---

## 8. YAGNI（明确不做）

- ❌ 不做 retry；不挂 circuit breaker；不写入 `force_passed` 兼容说明
- ❌ 不做场景级实时 gate（不写到 scene meta）
- ❌ 不改 Style Sandbox UI（独立 surface）
- ❌ 不改前端组件（依赖 review JSON 字段自然消费）
- ❌ 不为 `escalation_interval` 做 review 校验（跨章节奏）
- ❌ 不引入 LLM 参与 pacing 判定（与 `_check_writing_formula` 的 `analyze_sync` 路径保持对齐）

---

## 9. 文件清单

**新增**：
- `backend/style_engine/pacing.py`（~150 行）
- `tests/test_pacing_enforcement.py`（~280 行，20 用例）

**修改**：
- `backend/agents/planner.py`：新增 `_resolve_genre_pacing()`（仿 `_resolve_genre_beat_patterns` 形态）；2 处 prompt 渲染加 `{genre_pacing}`
- `backend/agents/writer.py`：新增 `_resolve_genre_scene_pacing()`；scene prompt 渲染加 `{genre_pacing_scene}`
- `backend/conductor/chapter_review.py`：新增 `_check_pacing()` / `_check_pacing_async()`；`build_review()` / `build_review_async()` 增字段
- `backend/prompts/novel_outline_generation.yaml`：加 `{genre_pacing}` 占位
- `backend/prompts/outline_generation.yaml`：加 `{genre_pacing}` 占位
- 对应 scene writing prompt yaml：加 `{genre_pacing_scene}` 占位

**不改**：
- `config/genres/*.yaml`（已合规）
- `backend/genres/catalog.py`（已有 `get_pacing()`）
- `backend/api/*`（review dict 序列化天然包含新字段）
- 前端

---

## 10. 验收

- `pytest tests/test_pacing_enforcement.py -v` 全绿。
- `pytest` 全量回归，无新增失败。
- 在某个 xianxia 项目跑完整一章 review，`chapter_reviews/chXX_review.json` 含 `pacing_compliance` 数组，长度 ≥ 1。
- 修改 `config/genres/xianxia.yaml` 的 `pacing.action_ratio` 从 `0.35` 改为 `0.80`，重跑 review，对应 metric 的 `passed` 翻转为 `false`。