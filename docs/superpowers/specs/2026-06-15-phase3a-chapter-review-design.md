# Phase 3a: 章节评审系统 (Chapter Review) — 设计方案

> 日期: 2026-06-15 | 状态: 已确认 | 依赖: Phase 0-2

## 范围

v1.6 TRD Phase 3，章节评审部分（Steps 3.5），回退系统（3.1/3.2）和讨论话题（3.6）不在本次范围。

### 本轮实现

- ChapterReviewBuilder：评审数据组装
- CoherenceScorer：连贯性评分（规则 + Tier 3 LLM 微调）
- 2 个新增 API 端点 + 1 个修改端点
- progress.py 模型扩展

### 本轮不实现（占位）

- `writing_formula_compliance` → 返回 `[]`，Phase 4.3 填充
- `discussion_topics` → 返回 `[]`，后续回溯补上

---

## 1. 架构与数据流

```
POST /write-scene 成功完成
        │
        ├── StoryOS 更新 (已有)
        ├── 草稿保存 (已有)
        ├── 检查点写入 (已有)
        │
        ▼ (检测 all_scenes_done)
ChapterReviewBuilder._build_review()
    ├── ReaderOS.calculate()              ← 已有，7 项指标快照
    ├── StoryOS 叙事资产统计              ← 已有，registries 读取
    ├── Fact Guard 通过率                 ← 已有，circuit_breaker.get_events()
    ├── Narrative Guard 警告              ← 已有，reviewer 最后警告
    ├── CoherenceScorer.score()           ← ★新增
    ├── writing_formula_compliance        ← 占位 []
    └── discussion_topics                 ← 占位 []
        │
        ▼
projects/{id}/chapter_reviews/ch{N}_review.json
        │
        ▼
write-scene 响应: { chapter_review_ready: true }
```

新增文件: `backend/conductor/chapter_review.py`
修改文件: `backend/api/stage4_writing.py`, `backend/models/progress.py`

---

## 2. CoherenceScorer 评分规则

### 确定性部分 (60% 权重)

三类指标各占 20%，每项 0-100 分，加权求和得基础分。

| 维度 | 权重 | 度量方式 | 来源 |
|------|------|----------|------|
| 叙事资产健康 | 20% | 活跃资产完成率 (resolved/active)，stale 伏笔扣分 | StoryOS registries |
| ReaderOS 状态 | 20% | (追更欲 + 满足感 + 好奇心)/3，疲劳度+挫败感扣分 | ReaderOS calculator |
| Fact Guard 通过率 | 20% | 本章场景首次通过率 (passed/total_checks) | CircuitBreaker events |

### LLM 微调部分 (40% 权重, Tier 3 Haiku)

- 输入: 基础分 + 章节场景摘要 (~800 chars) + 叙事资产摘要 (~500 chars)
- 输出: ±10 微调值 + 一句话点评
- Token 预算: ~1.5K 输入 + ~50 输出
- 最终: `coherence_score = clamp(base_score + llm_delta, 0, 100)`
- LLM 不可用时静默降级为纯规则分数，不阻断评审流程

---

## 3. 数据模型

### ChapterReviewData (backend/models/progress.py)

```python
@dataclass
class ChapterReviewData:
    chapter_number: int
    timestamp: str                              # ISO 8601
    coherence_score: int                        # 0-100
    coherence_comment: str                      # LLM 一句话点评
    reader_os: dict[str, int]                   # 7 项指标快照
    narrative_assets: dict[str, int]            # new/escalated/resolved 计数
    narrative_guard_warnings: list[dict]        # NG 警告摘要
    fact_guard_summary: dict                    # {passed, failed, total, pass_rate}
    writing_formula_compliance: list            # 占位 []，待 Phase 4.3 填充
    discussion_topics: list[str]                # 占位 []，待后续回溯
    decision: Optional[str]                     # null / "approved" / "revise"
    decision_feedback: Optional[str]            # revise 时作者的意见
```

### 存储格式 (JSON)

```json
{
  "chapter_number": 5,
  "timestamp": "2026-06-15T14:40:00Z",
  "coherence_score": 78,
  "coherence_comment": "本章节奏紧凑，但第3幕角色情绪转变略显突然",
  "reader_os": {
    "addiction": 72, "fatigue": 38, "curiosity": 65,
    "tension": 70, "satisfaction": 55, "frustration": 30, "discussion": 60
  },
  "narrative_assets": {
    "new_conflicts": 1, "escalated_conflicts": 1,
    "new_clues": 2, "fulfilled_promises": 1, "revealed_twists": 1,
    "fulfilled_expectations": 2
  },
  "narrative_guard_warnings": [],
  "fact_guard_summary": {
    "passed": 8, "failed": 1, "total": 9, "pass_rate": 0.89
  },
  "writing_formula_compliance": [],
  "discussion_topics": [],
  "decision": null,
  "decision_feedback": null
}
```

存储路径: `projects/{project_id}/chapter_reviews/ch{N}_review.json`

---

## 4. API 设计

### 新增端点

**GET /api/stage4/chapter-review**
```
Query: ?project_id={id}&chapter={n}
→ 200: { error: false, detail: <ChapterReviewData> }
→ 404: { error: true, code: "REVIEW_NOT_FOUND" }
```

**POST /api/stage4/chapter-review/decide**
```
Request:  { project_id, chapter_number, decision: "approved" | "revise", feedback?: string }
→ 200:    { error: false, detail: { status: "ok" } }
→ 400:    { error: true, code: "INVALID_DECISION" }
→ 404:    { error: true, code: "REVIEW_NOT_FOUND" }
```

### 修改端点

**POST /api/stage4/write-scene**
响应新增字段:
```json
{ "chapter_review_ready": true }
```
- `true` → 评审数据已生成
- `false` → 当前场景非章节最后一个
- 评审生成失败 → 不返回该字段（静默降级）

---

## 5. 触发机制与错误处理

### 触发条件

```python
chapter_scenes = [
    s for ch in progress["chapters"]
    if ch["chapter_number"] == current_chapter
    for s in ch["scenes"]
]
all_scenes_done = all(
    s["status"] in ("completed", "force_passed")
    for s in chapter_scenes
)
```

### 触发时机

在 StoryOS 更新、草稿保存、检查点写入**之后**。评审构建用 try/except 包裹，异常时只记日志，核心写作链路不受影响。

### 降级行为

| 失败场景 | 行为 |
|----------|------|
| CoherenceScorer LLM 不可用 | 静默降级为纯规则分数 |
| 评审数据组装失败 | 日志记录，write-scene 正常返回，无 chapter_review_ready |
| 评审文件写入失败 | 日志记录，write-scene 正常返回 |

---

## 6. 文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `backend/conductor/chapter_review.py` | **新增** | ChapterReviewBuilder + CoherenceScorer |
| 2 | `backend/api/stage4_writing.py` | 修改 | 评审触发 + 2 个新端点 + chapter_review_ready |
| 3 | `backend/models/progress.py` | 修改 | ChapterReviewData dataclass |
| 4 | `tests/test_chapter_review.py` | **新增** | 评审数据组装、API 端点、决策写入、降级行为 |

---

## 7. 验收标准

1. 每章最后一个场景完成 → 自动生成 `chapter_reviews/ch{N}_review.json`
2. `coherence_score` 在 0-100 范围，有规则基础分 + LLM 点评
3. LLM 不可用时静默降级为纯规则分数
4. GET chapter-review API 返回完整评审数据，未评审的章节返回 404
5. POST chapter-review/decide 支持 approved/revise 决策，写入文件
6. write-scene 响应正确返回 `chapter_review_ready`
7. `writing_formula_compliance` 和 `discussion_topics` 返回空数组（占位）
