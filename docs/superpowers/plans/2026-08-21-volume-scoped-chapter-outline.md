# 卷级上下文切片与成长曲线对齐 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 章节大纲改为基于「所属卷完整大纲 + 相邻卷摘要 + 本卷前文 + 对齐后的角色成长曲线」生成，取代当前的整份全书大纲 dump。

**Architecture:** 新增 `backend/outline_context/` 包做卷解析（`volumes.py`）与 prompt 文本渲染（`builder.py`）；新增 `backend/growth_curve/aligner.py` 以 `mc_growth_arc` 为权威源重算成长阶段的章节范围，取代反向推导的 `auto_generator.py`。`planner.generate_outline` 装配这三段上下文，端点保持薄。

**Tech Stack:** Python 3 / FastAPI / pytest。全部为 Tier 0 确定性代码，零 LLM 调用。

**Spec:** `docs/superpowers/specs/2026-08-21-volume-scoped-chapter-outline-design.md`

**分支:** 直接在 `v2.1` 上工作，不开 worktree。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `backend/outline_context/__init__.py` | 空包标记 |
| `backend/outline_context/volumes.py` | 纯解析：`ParsedVolume`、`parse_volumes`、`planned_total`、`locate_volume`。无渲染、无 IO |
| `backend/outline_context/builder.py` | 渲染 prompt 文本：`build_volume_context`、`build_recent_chapters_context` |
| `backend/growth_curve/aligner.py` | `align_growth_curves`：以 `mc_growth_arc` 重算 `target_chapter_range` |
| `backend/growth_curve/auto_generator.py` | **删除** |
| `backend/agents/planner.py` | `generate_outline` 签名与上下文装配 |
| `backend/prompts/outline_generation.yaml` | 新增两个槽位 + 卷约束规则 |
| `backend/prompts/character_generation.yaml` | 移除让 LLM 猜 `target_chapter_range` 的两处 |
| `backend/api/stage3_outline.py` | 对齐器接线、outline 读取提前、`planned_total` 收敛 |
| `backend/api/stage4_writing.py` | `_planned_chapter_total_from_novel_outline` 改为委托 `planned_total` |

---

## Task 1: 卷解析 `outline_context/volumes.py`

**Files:**
- Create: `backend/outline_context/__init__.py`
- Create: `backend/outline_context/volumes.py`
- Test: `tests/test_outline_context_volumes.py`

- [ ] **Step 1: 建包目录与空 `__init__.py`**

```bash
mkdir -p backend/outline_context
touch backend/outline_context/__init__.py
```

- [ ] **Step 2: 写失败测试**

创建 `tests/test_outline_context_volumes.py`：

```python
"""Tests for backend/outline_context/volumes.py — chapter-to-volume mapping."""
import pytest

from backend.outline_context.volumes import (
    ParsedVolume,
    locate_volume,
    parse_volumes,
    planned_total,
)


def _vol(name, rng, summary="", key_events=None):
    return {
        "name": name,
        "chapter_range": rng,
        "summary": summary,
        "key_events": key_events if key_events is not None else [],
    }


class TestParseVolumes:
    def test_parses_well_formed_volumes(self):
        outline = {"volumes": [
            _vol("第一卷", "1-50", "觉醒", ["金手指开启"]),
            _vol("第二卷", "51-120", "宗门之争", ["擂台赛"]),
        ]}
        result = parse_volumes(outline)
        assert len(result) == 2
        assert result[0].name == "第一卷"
        assert (result[0].start, result[0].end) == (1, 50)
        assert result[0].summary == "觉醒"
        assert result[0].key_events == ["金手指开启"]
        assert (result[1].start, result[1].end) == (51, 120)

    def test_index_reflects_sorted_order(self):
        """User hand-edits can leave volumes out of order; index is post-sort."""
        outline = {"volumes": [_vol("第二卷", "51-120"), _vol("第一卷", "1-50")]}
        result = parse_volumes(outline)
        assert [v.name for v in result] == ["第一卷", "第二卷"]
        assert [v.index for v in result] == [0, 1]

    def test_tolerates_whitespace_in_range(self):
        result = parse_volumes({"volumes": [_vol("第一卷", " 1 - 50 ")]})
        assert (result[0].start, result[0].end) == (1, 50)

    @pytest.mark.parametrize("bad_range", ["0-5", "50-1", "abc", "1~5", "", "5", "1-2-3"])
    def test_drops_malformed_ranges(self, bad_range):
        assert parse_volumes({"volumes": [_vol("坏卷", bad_range)]}) == []

    def test_drops_non_dict_volume_entries(self):
        outline = {"volumes": ["不是字典", None, _vol("第一卷", "1-50")]}
        result = parse_volumes(outline)
        assert len(result) == 1
        assert result[0].name == "第一卷"

    def test_drops_non_string_range(self):
        assert parse_volumes({"volumes": [{"name": "x", "chapter_range": 5}]}) == []

    @pytest.mark.parametrize("outline", [None, {}, {"volumes": None}, {"volumes": "x"}, "字符串"])
    def test_degenerate_input_returns_empty(self, outline):
        assert parse_volumes(outline) == []

    def test_non_string_key_events_dropped(self):
        result = parse_volumes({"volumes": [_vol("第一卷", "1-50", key_events=["ok", 42, None])]})
        assert result[0].key_events == ["ok"]


class TestPlannedTotal:
    def test_returns_max_end(self):
        outline = {"volumes": [_vol("一", "1-50"), _vol("二", "51-120")]}
        assert planned_total(outline) == 120

    def test_ignores_malformed_volumes(self):
        outline = {"volumes": [_vol("一", "1-50"), _vol("坏", "999-1")]}
        assert planned_total(outline) == 50

    @pytest.mark.parametrize("outline", [None, {}, {"volumes": []}])
    def test_zero_when_unavailable(self, outline):
        assert planned_total(outline) == 0


class TestLocateVolume:
    @pytest.fixture
    def volumes(self):
        return parse_volumes({"volumes": [
            _vol("第一卷", "1-50"), _vol("第二卷", "51-120"),
        ]})

    def test_inside_volume(self, volumes):
        assert locate_volume(75, volumes).name == "第二卷"

    def test_at_start_boundary(self, volumes):
        assert locate_volume(51, volumes).name == "第二卷"

    def test_at_end_boundary(self, volumes):
        assert locate_volume(50, volumes).name == "第一卷"

    def test_beyond_last_volume_falls_back_to_last(self, volumes):
        """Over-written chapters are narratively a continuation of the last volume."""
        assert locate_volume(500, volumes).name == "第二卷"

    def test_below_first_volume_falls_back_to_first(self):
        volumes = parse_volumes({"volumes": [_vol("第一卷", "10-50")]})
        assert locate_volume(3, volumes).name == "第一卷"

    def test_gap_between_volumes_falls_back_to_earlier(self):
        volumes = parse_volumes({"volumes": [_vol("一", "1-10"), _vol("二", "21-30")]})
        assert locate_volume(15, volumes).name == "一"

    def test_empty_volumes_returns_none(self):
        assert locate_volume(1, []) is None
```

- [ ] **Step 3: 运行测试确认失败**

Run: `source venv/bin/activate && pytest tests/test_outline_context_volumes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.outline_context.volumes'`

- [ ] **Step 4: 实现 `backend/outline_context/volumes.py`**

```python
"""Volume parsing for novel_outline.json — chapter-to-volume mapping.

Pure parsing: no rendering, no IO. Mirrors the frontend's
`frontend/src/utils/outline.ts` (parseVolumes / computePlannedTotal) — the
two implementations must agree, since autopilot never goes through the
browser and would otherwise get different behaviour.
"""
import re
from dataclasses import dataclass
from typing import Optional

CHAPTER_RANGE_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")


@dataclass(frozen=True)
class ParsedVolume:
    index: int
    name: str
    chapter_range: str
    summary: str
    key_events: list[str]
    start: int
    end: int


def parse_volumes(novel_outline: Optional[dict]) -> list[ParsedVolume]:
    """Parse and validate `novel_outline["volumes"]`, sorted by start chapter.

    Drops volumes whose range is malformed, starts below chapter 1, or is
    inverted. `index` is assigned after sorting so callers can address
    neighbours positionally.
    """
    if not isinstance(novel_outline, dict):
        return []
    raw = novel_outline.get("volumes")
    if not isinstance(raw, list):
        return []

    staged: list[tuple[int, int, dict]] = []
    for vol in raw:
        if not isinstance(vol, dict):
            continue
        rng = vol.get("chapter_range")
        if not isinstance(rng, str):
            continue
        match = CHAPTER_RANGE_RE.match(rng)
        if not match:
            continue
        start, end = int(match.group(1)), int(match.group(2))
        if start < 1 or end < start:
            continue
        staged.append((start, end, vol))

    staged.sort(key=lambda item: item[0])

    return [
        ParsedVolume(
            index=i,
            name=str(vol.get("name") or ""),
            chapter_range=str(vol.get("chapter_range") or ""),
            summary=str(vol.get("summary") or ""),
            key_events=[e for e in (vol.get("key_events") or []) if isinstance(e, str)],
            start=start,
            end=end,
        )
        for i, (start, end, vol) in enumerate(staged)
    ]


def planned_total(novel_outline: Optional[dict]) -> int:
    """The user's planned total chapter count — max end across valid volumes.

    Returns 0 when the outline is missing or has no parseable volume; callers
    fall back to `outline.json`'s chapter count in that case.
    """
    return max((v.end for v in parse_volumes(novel_outline)), default=0)


def locate_volume(
    chapter_number: int, volumes: list[ParsedVolume]
) -> Optional[ParsedVolume]:
    """Find the volume owning `chapter_number`, clamping to the nearest volume.

    Out-of-range chapters happen for real: the workspace's "+ 新章节" lets the
    user write past the planned total. Such a chapter is narratively a
    continuation of the last volume, so giving it the last volume's context
    beats giving it the whole book. Returns None only when there is no
    parseable volume at all.
    """
    if not volumes:
        return None
    if chapter_number < volumes[0].start:
        return volumes[0]
    for volume in volumes:
        if volume.start <= chapter_number <= volume.end:
            return volume
    prior = [v for v in volumes if v.start <= chapter_number]
    return prior[-1] if prior else volumes[0]
```

- [ ] **Step 5: 运行测试确认通过**

Run: `source venv/bin/activate && pytest tests/test_outline_context_volumes.py -q`
Expected: PASS，全部通过

- [ ] **Step 6: 提交**

```bash
git add backend/outline_context/__init__.py backend/outline_context/volumes.py tests/test_outline_context_volumes.py
git commit -m "feat(outline-context): add volume parsing and chapter-to-volume mapping"
```

---

## Task 2: 上下文渲染 `outline_context/builder.py`

**Files:**
- Create: `backend/outline_context/builder.py`
- Test: `tests/test_outline_context_builder.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_outline_context_builder.py`：

```python
"""Tests for backend/outline_context/builder.py — prompt text rendering."""
import json

import pytest

from backend.outline_context.builder import (
    build_recent_chapters_context,
    build_volume_context,
)
from backend.outline_context.volumes import locate_volume, parse_volumes

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒与初战", "key_events": ["金手指开启", "首次杀人"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
        {"name": "第三卷 归墟", "chapter_range": "121-200",
         "summary": "直面真相", "key_events": ["师父身死"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起",
         "description": "主角金手指来源", "trigger_chapter_hint": "约第 5 章"},
        {"title": "宗门覆灭", "must_appear_in_volume": "第二卷 试炼",
         "description": "全宗被屠", "trigger_chapter_hint": "约第 110 章"},
    ],
}


class TestBuildVolumeContext:
    def test_first_volume_has_no_previous_section(self):
        text = build_volume_context(NOVEL_OUTLINE, 10)
        assert "【上一卷" not in text
        assert "【当前卷·第一卷 崛起】" in text
        assert "【下一卷·第二卷 试炼】" in text

    def test_last_volume_has_no_next_section(self):
        text = build_volume_context(NOVEL_OUTLINE, 150)
        assert "【上一卷·第二卷 试炼】" in text
        assert "【当前卷·第三卷 归墟】" in text
        assert "【下一卷" not in text

    def test_middle_volume_has_both_neighbours(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "【上一卷·第一卷 崛起】" in text
        assert "【当前卷·第二卷 试炼】" in text
        assert "【下一卷·第三卷 归墟】" in text

    def test_core_conflict_always_injected(self):
        assert "底层少年逆袭" in build_volume_context(NOVEL_OUTLINE, 150)

    def test_current_volume_gets_key_events_neighbours_do_not(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "擂台赛" in text          # current volume's key_events
        assert "金手指开启" not in text  # previous volume gets summary only
        assert "师父身死" not in text    # next volume gets summary only

    def test_current_chapter_position_is_stated(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "第 51-120 章" in text
        assert "本章为第 75 章" in text

    def test_plot_points_filtered_to_current_volume(self):
        text = build_volume_context(NOVEL_OUTLINE, 10)
        assert "上古遗物" in text
        assert "宗门覆灭" not in text

    def test_plot_point_matches_short_volume_name(self):
        """must_appear_in_volume may be an abbreviation of the volume name."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "上古遗物", "must_appear_in_volume": "第一卷",
             "description": "", "trigger_chapter_hint": ""},
        ])
        assert "上古遗物" in build_volume_context(outline, 10)

    def test_all_plot_points_injected_when_none_match_any_volume(self):
        """Systematically unusable must_appear_in_volume → inject everything
        rather than silently dropping the plot points."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "甲", "must_appear_in_volume": "无法对应的卷名",
             "description": "", "trigger_chapter_hint": ""},
            {"title": "乙", "must_appear_in_volume": "",
             "description": "", "trigger_chapter_hint": ""},
        ])
        text = build_volume_context(outline, 10)
        assert "甲" in text and "乙" in text

    def test_empty_when_matching_works_but_current_volume_has_none(self):
        """Matching mechanism works (第二卷 matches) but chapter 10 is in
        第一卷, which owns no plot point → inject none."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "宗门覆灭", "must_appear_in_volume": "第二卷 试炼",
             "description": "", "trigger_chapter_hint": ""},
        ])
        text = build_volume_context(outline, 10)
        assert "宗门覆灭" not in text
        assert "关键情节点" not in text

    def test_no_novel_outline_returns_placeholder(self):
        assert "暂无全书大纲" in build_volume_context(None, 1)
        assert "暂无全书大纲" in build_volume_context({}, 1)

    def test_unparseable_volumes_fall_back_to_full_dump(self):
        outline = {"core_conflict_theme": "主题", "volumes": [{"name": "x", "chapter_range": "坏"}]}
        text = build_volume_context(outline, 1)
        assert json.loads(text) == outline


class TestBuildRecentChaptersContext:
    @pytest.fixture
    def outline(self):
        return {"chapters": [
            {"chapter_number": n, "title": f"第{n}章标题", "theme": f"主题{n}",
             "scene_plan": [
                 {"scene_number": 1, "goal": "开场", "beat_type": "setup"},
                 {"scene_number": 2, "goal": f"悬念{n}", "beat_type": "cliffhanger"},
             ]}
            for n in range(1, 61)
        ]}

    @pytest.fixture
    def volumes(self):
        return parse_volumes(NOVEL_OUTLINE)

    def test_window_is_three_previous_chapters(self, outline, volumes):
        text = build_recent_chapters_context(outline, 40, locate_volume(40, volumes))
        assert "第 37-39 章" in text
        assert "第37章" in text and "第39章" in text
        assert "第36章" not in text
        assert "第40章" not in text

    def test_renders_title_theme_and_closing_scene(self, outline, volumes):
        text = build_recent_chapters_context(outline, 40, locate_volume(40, volumes))
        assert "《第39章标题》" in text
        assert "主题39" in text
        assert "悬念39" in text
        assert "cliffhanger" in text

    def test_window_clipped_at_volume_start(self, outline, volumes):
        """Chapter 52 is the second chapter of 第二卷 (51-120); looking back
        into 第一卷 duplicates the previous-volume summary."""
        text = build_recent_chapters_context(outline, 52, locate_volume(52, volumes))
        assert "第 51-51 章" in text
        assert "第50章" not in text

    def test_first_chapter_of_volume_has_no_previous_text(self, outline, volumes):
        text = build_recent_chapters_context(outline, 51, locate_volume(51, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_chapter_one_has_no_previous_text(self, outline, volumes):
        text = build_recent_chapters_context(outline, 1, locate_volume(1, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_missing_chapters_in_outline_degrade_gracefully(self, volumes):
        text = build_recent_chapters_context({"chapters": []}, 40, locate_volume(40, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_volume_none_degrades_to_plain_window(self, outline):
        text = build_recent_chapters_context(outline, 40, None)
        assert "第 37-39 章" in text

    @pytest.mark.parametrize("outline", [None, {}, {"chapters": None}])
    def test_degenerate_outline_returns_placeholder(self, outline):
        assert build_recent_chapters_context(outline, 40, None) == "（本卷起始章，无前文）"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source venv/bin/activate && pytest tests/test_outline_context_builder.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.outline_context.builder'`

- [ ] **Step 3: 实现 `backend/outline_context/builder.py`**

```python
"""Prompt-text rendering for chapter-outline context.

Every function degrades rather than raises: novel_outline.json is freely
hand-editable in the workspace, so no format assumption is safe.
"""
import json
from typing import Optional

from backend.outline_context.volumes import (
    ParsedVolume,
    locate_volume,
    parse_volumes,
)

RECENT_CHAPTERS_WINDOW = 3
NO_NOVEL_OUTLINE = "（暂无全书大纲 — 章节生成时按故事 DNA 和概念自主设计）"
NO_RECENT_CHAPTERS = "（本卷起始章，无前文）"


def _names_match(volume_name: str, must_appear_in: str) -> bool:
    """Bidirectional substring match — must_appear_in_volume may hold the full
    name ("第一卷 初入异世") or an abbreviation ("第一卷")."""
    left = (volume_name or "").strip()
    right = (must_appear_in or "").strip()
    if not left or not right:
        return False
    return left in right or right in left


def _select_plot_points(
    novel_outline: dict, volumes: list[ParsedVolume], current: ParsedVolume
) -> list[dict]:
    points = [
        p for p in (novel_outline.get("key_plot_points") or []) if isinstance(p, dict)
    ]
    if not points:
        return []
    matchable = any(
        _names_match(v.name, p.get("must_appear_in_volume", ""))
        for p in points
        for v in volumes
    )
    if not matchable:
        # The field is systematically unusable (hand-edited volume names, wrong
        # format). Injecting everything beats silently dropping plot points.
        return points
    return [
        p for p in points
        if _names_match(current.name, p.get("must_appear_in_volume", ""))
    ]


def build_volume_context(novel_outline: Optional[dict], chapter_number: int) -> str:
    """Render the current volume in full plus adjacent volume summaries.

    Falls back to the pre-slicing behaviour (whole-file dump) when volumes
    cannot be parsed, so degraded projects keep working.
    """
    if not isinstance(novel_outline, dict) or not novel_outline:
        return NO_NOVEL_OUTLINE

    volumes = parse_volumes(novel_outline)
    current = locate_volume(chapter_number, volumes)
    if current is None:
        return json.dumps(novel_outline, ensure_ascii=False, indent=2)

    lines: list[str] = []

    theme = str(novel_outline.get("core_conflict_theme") or "").strip()
    if theme:
        lines.append(f"【全书核心冲突】{theme}")
        lines.append("")

    if current.index > 0:
        previous = volumes[current.index - 1]
        lines.append(f"【上一卷·{previous.name}】")
        if previous.summary:
            lines.append(f"摘要：{previous.summary}")
        lines.append("")

    lines.append(
        f"【当前卷·{current.name}】"
        f"（第 {current.start}-{current.end} 章，本章为第 {chapter_number} 章）"
    )
    if current.summary:
        lines.append(f"摘要：{current.summary}")
    if current.key_events:
        lines.append("关键事件：")
        lines.extend(f"- {event}" for event in current.key_events)
    lines.append("")

    if current.index < len(volumes) - 1:
        following = volumes[current.index + 1]
        lines.append(f"【下一卷·{following.name}】")
        if following.summary:
            lines.append(f"摘要：{following.summary}")
        lines.append("")

    points = _select_plot_points(novel_outline, volumes, current)
    if points:
        lines.append("【本卷必须落地的关键情节点】")
        for point in points:
            title = str(point.get("title") or "").strip()
            hint = str(point.get("trigger_chapter_hint") or "").strip()
            lines.append(f"- {title}（触发提示：{hint}）" if hint else f"- {title}")
            description = str(point.get("description") or "").strip()
            if description:
                lines.append(f"  {description}")

    return "\n".join(lines).strip()


def build_recent_chapters_context(
    outline: Optional[dict],
    chapter_number: int,
    volume: Optional[ParsedVolume],
) -> str:
    """Render the previous few chapters of the SAME volume.

    The look-back window is clipped at the volume start: across a volume
    boundary the previous volume's ending is already covered by its summary in
    build_volume_context, so walking back into it is duplicate context.
    """
    lower = chapter_number - RECENT_CHAPTERS_WINDOW
    if volume is not None:
        lower = max(lower, volume.start)
    lower = max(lower, 1)
    upper = chapter_number - 1
    if upper < lower:
        return NO_RECENT_CHAPTERS

    raw = (outline or {}).get("chapters") if isinstance(outline, dict) else None
    chapters = [
        c for c in (raw or [])
        if isinstance(c, dict)
        and isinstance(c.get("chapter_number"), int)
        and lower <= c["chapter_number"] <= upper
    ]
    if not chapters:
        return NO_RECENT_CHAPTERS
    chapters.sort(key=lambda c: c["chapter_number"])

    lines = [
        f"【本卷前文（第 {chapters[0]['chapter_number']}-"
        f"{chapters[-1]['chapter_number']} 章）】"
    ]
    for chapter in chapters:
        title = str(chapter.get("title") or "").strip()
        entry = f"第{chapter['chapter_number']}章《{title}》"
        theme = str(chapter.get("theme") or "").strip()
        if theme:
            entry += f" 主题：{theme}"
        scenes = [s for s in (chapter.get("scene_plan") or []) if isinstance(s, dict)]
        if scenes:
            last = scenes[-1]
            goal = str(last.get("goal") or "").strip()
            if goal:
                entry += f" 收尾于：{goal}"
                beat = str(last.get("beat_type") or last.get("narrative_role") or "").strip()
                if beat:
                    entry += f"（{beat}）"
        lines.append(entry)
    return "\n".join(lines)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `source venv/bin/activate && pytest tests/test_outline_context_builder.py -q`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/outline_context/builder.py tests/test_outline_context_builder.py
git commit -m "feat(outline-context): render volume slice and in-volume recent chapters"
```

---

## Task 3: 成长曲线对齐器

**Files:**
- Create: `backend/growth_curve/aligner.py`
- Delete: `backend/growth_curve/auto_generator.py`
- Modify: `backend/prompts/character_generation.yaml`（移除 `target_chapter_range` 两处）
- Modify: `tests/test_growth_curve.py`（删除 `TestAutoGenerator` 类）
- Test: `tests/test_growth_curve_aligner.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_growth_curve_aligner.py`：

```python
"""Tests for backend/growth_curve/aligner.py — volume-authoritative growth ranges."""
import copy

import pytest

from backend.growth_curve.aligner import align_growth_curves

NOVEL_OUTLINE = {
    "volumes": [
        {"name": "第一卷", "chapter_range": "1-50", "summary": "", "key_events": []},
        {"name": "第二卷", "chapter_range": "51-120", "summary": "", "key_events": []},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "觉醒", "target_chapter_range": "21-60", "description": "能力觉醒"},
        {"label": "背叛", "target_chapter_range": "61-100", "description": "遭师门背叛"},
        {"label": "登顶", "target_chapter_range": "101-120", "description": "问鼎"},
    ],
}


def _stage(number, name="阶段", event_type="moral_awakening", rng="9-9"):
    return {
        "stage_number": number,
        "stage_name": name,
        "trigger_event_type": event_type,
        "trigger_event_description": "描述",
        "character_change": "变化",
        "target_chapter_range": rng,
        "bound_chapter": None,
    }


def _char(name, stages=None, character_type="supporting", with_curve=True):
    char = {"id": name, "name": name, "character_type": character_type,
            "is_core_character": character_type == "protagonist"}
    if with_curve:
        char["growth_curve"] = {"curve_description": "", "stages": stages or []}
    return char


class TestRangeMapping:
    def test_equal_counts_map_one_to_one(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 5)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-20", "21-60", "61-100", "101-120"]

    def test_fewer_stages_than_milestones_spread_across_arc(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 3)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-20", "101-120"]

    def test_more_stages_than_milestones_is_monotonic(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 7)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        starts = [
            int(s["target_chapter_range"].split("-")[0])
            for s in chars[0]["growth_curve"]["stages"]
        ]
        assert starts == sorted(starts)

    def test_single_stage_takes_first_milestone(self):
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "1-20"

    def test_stages_sorted_by_stage_number_before_mapping(self):
        chars = [_char("甲", [_stage(2, "第二"), _stage(1, "第一")])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        by_name = {s["stage_name"]: s["target_chapter_range"]
                   for s in chars[0]["growth_curve"]["stages"]}
        assert by_name["第一"] == "1-20"
        assert by_name["第二"] == "101-120"

    def test_bare_number_milestone_range_accepted(self):
        outline = {"volumes": NOVEL_OUTLINE["volumes"],
                   "mc_growth_arc": [{"label": "x", "target_chapter_range": "7"}]}
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, outline)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "7-7"

    def test_ranges_clamped_to_planned_total(self):
        outline = {"volumes": [{"name": "一", "chapter_range": "1-30"}],
                   "mc_growth_arc": [{"label": "x", "target_chapter_range": "1-999"}]}
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, outline)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "1-30"


class TestNoMilestones:
    def test_even_split_across_planned_total(self):
        outline = {"volumes": [{"name": "一", "chapter_range": "1-30"}], "mc_growth_arc": []}
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, outline)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-10", "11-20", "21-30"]

    def test_no_volumes_still_produces_monotonic_ranges(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, {})
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-1", "2-2", "3-3"]


class TestFieldPreservation:
    def test_only_target_chapter_range_is_written(self):
        stage = _stage(1, "背叛经历", "betrayal_experienced")
        stage["bound_chapter"] = 7
        chars = [_char("甲", [stage])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        result = chars[0]["growth_curve"]["stages"][0]
        assert result["bound_chapter"] == 7
        assert result["stage_name"] == "背叛经历"
        assert result["trigger_event_type"] == "betrayal_experienced"
        assert result["character_change"] == "变化"
        assert result["trigger_event_description"] == "描述"

    def test_idempotent(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        once = copy.deepcopy(chars)
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert chars == once

    def test_character_without_curve_untouched(self):
        chars = [_char("乙", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "growth_curve" not in chars[0]

    def test_empty_character_list(self):
        assert align_growth_curves([], NOVEL_OUTLINE) == []


class TestProtagonistSynthesis:
    def test_protagonist_without_curve_gets_one_from_mc_growth_arc(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert len(stages) == 4
        assert [s["stage_name"] for s in stages] == ["起点", "觉醒", "背叛", "登顶"]
        assert [s["target_chapter_range"] for s in stages] == [
            "1-20", "21-60", "61-100", "101-120",
        ]
        assert all(s["character_change"] == "" for s in stages)
        assert all(s["bound_chapter"] is None for s in stages)

    def test_synthesized_trigger_type_from_keyword_match(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert stages[2]["trigger_event_type"] == "betrayal_experienced"  # "遭师门背叛"

    def test_synthesized_trigger_type_omitted_when_no_keyword_matches(self):
        """No event type is better than a wrong one: binder reads "" and never
        binds, which is the intended silent degradation."""
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "trigger_event_type" not in chars[0]["growth_curve"]["stages"][3]  # "登顶"

    def test_non_protagonist_without_curve_is_not_synthesized(self):
        """Giving an antagonist the protagonist's growth beats is fabrication."""
        chars = [_char("反派", character_type="antagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "growth_curve" not in chars[0]

    def test_protagonist_with_existing_stages_is_not_synthesized(self):
        chars = [_char("主角", [_stage(1, "自定义")], character_type="protagonist")]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert len(stages) == 1
        assert stages[0]["stage_name"] == "自定义"

    def test_protagonist_without_mc_growth_arc_is_not_synthesized(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, {"volumes": NOVEL_OUTLINE["volumes"]})
        assert "growth_curve" not in chars[0]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source venv/bin/activate && pytest tests/test_growth_curve_aligner.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.growth_curve.aligner'`

- [ ] **Step 3: 实现 `backend/growth_curve/aligner.py`**

```python
"""STAGE 3 growth curve alignment — the volume outline is the authority for
when each growth stage happens.

Replaces the old reverse-inference in auto_generator.py, which derived stage
ranges from already-generated chapters and froze them at a degenerate
one-chapter state on the first call of the batch loop.

Tier 0: zero LLM calls, deterministic, idempotent.
"""
import logging
from typing import Optional

from backend.growth_curve.binder import TRIGGER_KEYWORDS
from backend.outline_context.volumes import CHAPTER_RANGE_RE, planned_total

logger = logging.getLogger(__name__)


def _parse_range(value) -> Optional[tuple[int, int]]:
    """Accept both "3-5" and a bare "7" (which becomes (7, 7))."""
    if not isinstance(value, str):
        return None
    match = CHAPTER_RANGE_RE.match(value)
    if match:
        start, end = int(match.group(1)), int(match.group(2))
        if start >= 1 and end >= start:
            return start, end
        return None
    stripped = value.strip()
    if stripped.isdigit() and int(stripped) >= 1:
        return int(stripped), int(stripped)
    return None


def _mc_arc(novel_outline: Optional[dict]) -> list[dict]:
    if not isinstance(novel_outline, dict):
        return []
    return [m for m in (novel_outline.get("mc_growth_arc") or []) if isinstance(m, dict)]


def _milestone_ranges(arc: list[dict]) -> list[tuple[int, int]]:
    parsed = [_parse_range(m.get("target_chapter_range")) for m in arc]
    return [r for r in parsed if r is not None]


def _even_split(count: int, total: int) -> list[tuple[int, int]]:
    """Split [1, total] into `count` contiguous buckets."""
    if count <= 0:
        return []
    total = max(total, count)
    size = total / count
    buckets = []
    for i in range(count):
        start = int(i * size) + 1
        end = total if i == count - 1 else int((i + 1) * size)
        buckets.append((start, max(end, start)))
    return buckets


def _map_stage_ranges(
    stage_count: int, milestones: list[tuple[int, int]], total: int
) -> list[tuple[int, int]]:
    if stage_count <= 0:
        return []
    if not milestones:
        return _even_split(stage_count, total)

    span = len(milestones) - 1
    if stage_count == 1:
        picked = [milestones[0]]
    else:
        picked = [
            milestones[round(i * span / (stage_count - 1))] for i in range(stage_count)
        ]

    if total > 0:
        clamped = []
        for start, end in picked:
            start = min(max(start, 1), total)
            end = min(max(end, 1), total)
            clamped.append((start, max(end, start)))
        return clamped
    return picked


def _event_type_for(text: str) -> Optional[str]:
    for event_type, keywords in TRIGGER_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return event_type
    return None


def _synthesize_protagonist_stages(arc: list[dict]) -> list[dict]:
    """Build stages straight from mc_growth_arc.

    This is a faithful mapping, not invention: mc_growth_arc IS the main
    character's growth arc. Doing the same for other characters would be
    fabrication, so callers must restrict this to the protagonist.
    """
    stages = []
    for i, milestone in enumerate(arc):
        label = str(milestone.get("label") or "").strip()
        description = str(milestone.get("description") or "").strip()
        stage = {
            "stage_number": i + 1,
            "stage_name": label or f"阶段{i + 1}",
            "trigger_event_description": description,
            "character_change": "",
            "target_chapter_range": "",
            "bound_chapter": None,
        }
        event_type = _event_type_for(f"{label} {description}")
        if event_type:
            stage["trigger_event_type"] = event_type
        # No keyword match → leave the field absent. binder.py reads "" from
        # the missing key, gets an empty keyword list, and never binds. A
        # wrong event type would instead produce a wrong bound_chapter.
        stages.append(stage)
    return stages


def align_growth_curves(
    characters: list[dict], novel_outline: Optional[dict]
) -> list[dict]:
    """Re-derive every growth stage's target_chapter_range from the volume
    outline. Mutates in place and returns the list for clarity.

    Only target_chapter_range is written. bound_chapter is left alone — it
    means "actually triggered in chapter N" and remains binder.py's job.
    """
    if not characters:
        return characters

    total = planned_total(novel_outline)
    arc = _mc_arc(novel_outline)
    milestones = _milestone_ranges(arc)

    for char in characters:
        curve = char.get("growth_curve") or {}
        stages = [s for s in (curve.get("stages") or []) if isinstance(s, dict)]

        if not stages and char.get("character_type") == "protagonist" and arc:
            stages = _synthesize_protagonist_stages(arc)
            char["growth_curve"] = {
                "curve_description": curve.get("curve_description", ""),
                "stages": stages,
            }
            logger.info(
                "Synthesized growth curve for protagonist '%s' from mc_growth_arc: "
                "%d stages", char.get("name", "unknown"), len(stages),
            )

        if not stages:
            continue

        ordered = sorted(stages, key=lambda s: s.get("stage_number", 0))
        for stage, (start, end) in zip(
            ordered, _map_stage_ranges(len(ordered), milestones, total)
        ):
            stage["target_chapter_range"] = f"{start}-{end}"

    return characters
```

- [ ] **Step 4: 运行测试确认通过**

Run: `source venv/bin/activate && pytest tests/test_growth_curve_aligner.py -q`
Expected: PASS

- [ ] **Step 5: 删除 `auto_generator.py` 与其测试类**

```bash
git rm backend/growth_curve/auto_generator.py
```

编辑 `tests/test_growth_curve.py`：删除第 383 行的 `class TestAutoGenerator:` 起至文件末尾（第 605 行）的全部内容。文件应以第 380 行 `assert "无效阶段" not in result` 结束。保留 `TestGrowthStage` / binder / `compute_character_growth_context` 的全部测试。

- [ ] **Step 6: 移除 `character_generation.yaml` 里让 LLM 猜章节范围的两处**

编辑 `backend/prompts/character_generation.yaml`，删除第 67 行：

```
  - target_chapter_range 预估该阶段发生在哪些章节（如 "3-5"）
```

并把第 118-125 行的示例中的 `target_chapter_range` 一行删掉，使其变为：

```yaml
        {{
          "stage_number": 1,
          "stage_name": "阶段名称（中文，如：少年意气、坠入深渊、觉醒重生）",
          "trigger_event_type": "world_truth_revealed",
          "trigger_event_description": "触发该阶段的具体事件描述",
          "character_change": "角色在此阶段的内在信念/价值观/性格转变"
        }}
```

注意 `character_change` 行原本以逗号结尾，删除后一行后必须去掉该逗号，否则示例 JSON 非法。

- [ ] **Step 7: 运行成长曲线相关全部测试**

Run: `source venv/bin/activate && pytest tests/test_growth_curve.py tests/test_growth_curve_aligner.py -q`
Expected: PASS，且 `TestAutoGenerator` 不再出现在收集结果中

- [ ] **Step 8: 确认没有遗留引用**

Run: `grep -rn "auto_generate_growth_curves\|auto_generator" backend/ tests/`
Expected: 只剩 `backend/api/stage3_outline.py:154,157` 两行（Task 5 处理）

- [ ] **Step 9: 提交**

```bash
git add backend/growth_curve/aligner.py tests/test_growth_curve_aligner.py \
        tests/test_growth_curve.py backend/prompts/character_generation.yaml
git commit -m "feat(growth-curve): derive stage ranges from volume outline, drop reverse inference"
```

---

## Task 4: planner 装配与 prompt 模板

**Files:**
- Modify: `backend/agents/planner.py:483-540`
- Modify: `backend/prompts/outline_generation.yaml`
- Modify: `tests/test_genre_beat_patterns.py:219`
- Test: `tests/test_planner_outline_context.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_planner_outline_context.py`：

```python
"""Tests for planner.generate_outline's context assembly (v2.1 volume slicing)."""
from unittest.mock import patch

import pytest

from backend.agents.planner import PlannerAgent

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒与初战", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起",
         "description": "金手指来源", "trigger_chapter_hint": "约第 5 章"},
    ],
}

CHARACTERS = [
    {"id": "mc", "name": "林峰", "character_type": "protagonist",
     "is_core_character": True, "personality": {"core_traits": ["坚韧"]},
     "current_state": {}, "relations": {},
     "growth_curve": {"curve_description": "", "stages": [
         {"stage_number": 1, "stage_name": "觉醒", "trigger_event_type": "moral_awakening",
          "trigger_event_description": "顿悟", "character_change": "由怯懦转为果决",
          "target_chapter_range": "1-20", "bound_chapter": None},
     ]}},
    {"id": "bad", "name": "黑袍人", "character_type": "antagonist",
     "is_core_character": False, "personality": {"core_traits": ["阴狠"]},
     "current_state": {}, "relations": {}},
]

OUTLINE = {"chapters": [
    {"chapter_number": 8, "title": "夜袭", "theme": "反击",
     "scene_plan": [{"scene_number": 1, "goal": "反杀追兵", "beat_type": "cliffhanger"}]},
]}


class _Resp:
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    model = "test"
    provider = "test"
    content = "{}"
    latency_ms = 0


async def _render(**overrides) -> str:
    """Run generate_outline with the LLM stubbed and return the user prompt."""
    captured = {}

    async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
        captured["user"] = user_prompt
        captured["system"] = system_prompt
        return {"chapter_number": 1, "scene_plan": []}, _Resp()

    kwargs = dict(
        concept={"title": "测试"},
        story_dna={},
        world={"era": "异世界", "core_rules": []},
        characters=CHARACTERS,
        chapter_number=9,
        min_words=2000,
        novel_outline=NOVEL_OUTLINE,
        outline=OUTLINE,
    )
    kwargs.update(overrides)

    planner = PlannerAgent(project_id="test")
    with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
        await planner.generate_outline(**kwargs)
    return captured["user"]


class TestVolumeSlicing:
    @pytest.mark.asyncio
    async def test_only_current_volume_key_events_injected(self):
        rendered = await _render()
        assert "【当前卷·第一卷 崛起】" in rendered
        assert "金手指开启" in rendered
        assert "擂台赛" not in rendered

    @pytest.mark.asyncio
    async def test_adjacent_volume_summary_injected(self):
        rendered = await _render()
        assert "【下一卷·第二卷 试炼】" in rendered
        assert "宗门之争" in rendered

    @pytest.mark.asyncio
    async def test_current_volume_plot_points_injected(self):
        rendered = await _render()
        assert "上古遗物" in rendered

    @pytest.mark.asyncio
    async def test_no_novel_outline_degrades(self):
        rendered = await _render(novel_outline=None)
        assert "暂无全书大纲" in rendered


class TestGrowthAndCast:
    @pytest.mark.asyncio
    async def test_growth_context_injected(self):
        rendered = await _render()
        assert "角色成长态势" in rendered
        assert "由怯懦转为果决" in rendered

    @pytest.mark.asyncio
    async def test_no_growth_curves_degrades(self):
        rendered = await _render(characters=[
            {"id": "x", "name": "路人", "character_type": "supporting",
             "personality": {}, "current_state": {}, "relations": {}},
        ])
        assert "暂无角色成长曲线" in rendered

    @pytest.mark.asyncio
    async def test_cast_includes_antagonist_not_just_first_character(self):
        rendered = await _render()
        assert "林峰" in rendered
        assert "黑袍人" in rendered


class TestRecentChapters:
    @pytest.mark.asyncio
    async def test_previous_chapter_injected(self):
        rendered = await _render()
        assert "【本卷前文" in rendered
        assert "《夜袭》" in rendered
        assert "反杀追兵" in rendered

    @pytest.mark.asyncio
    async def test_volume_first_chapter_has_no_previous_text(self):
        rendered = await _render(chapter_number=1)
        assert "本卷起始章，无前文" in rendered


class TestPromptOverrideCompatibility:
    @pytest.mark.asyncio
    async def test_pre_change_template_still_renders(self):
        """Prompt Plaza overrides store the full template text. A user override
        saved before this change still contains only the old slots; rendering
        must not raise KeyError."""
        old_template = (
            "故事概念：\n{concept_context}\n\n"
            "Story DNA：\n{story_dna_context}\n\n"
            "世界观：\n{world_context}\n\n"
            "角色设定：\n{character_context}\n\n"
            "全书大纲：\n{novel_outline_context}\n\n"
            "目标章节：第 {chapter_number} 章\n"
            "最低字数：{min_words} 字\n\n"
            "{genre_beat_patterns}\n\n{genre_focus_vocabulary}\n\n"
            "{genre_pacing}\n\n{user_modifications}\n"
        )

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"chapter_number": 1, "scene_plan": []}, _Resp()

        planner = PlannerAgent(project_id="test")
        original_load = PlannerAgent.load_prompt

        def load_with_override(self, template_name, project_id=None):
            prompt = original_load(self, template_name, project_id=project_id)
            if template_name == "outline_generation":
                prompt.user_prompt_template = old_template
            return prompt

        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier), \
             patch.object(PlannerAgent, "load_prompt", new=load_with_override):
            await planner.generate_outline(
                concept={"title": "测试"}, story_dna={},
                world={"era": "异世界", "core_rules": []},
                characters=CHARACTERS, chapter_number=9, min_words=2000,
                novel_outline=NOVEL_OUTLINE, outline=OUTLINE,
            )

        assert "【当前卷·第一卷 崛起】" in captured["user"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source venv/bin/activate && pytest tests/test_planner_outline_context.py -q`
Expected: FAIL — `TypeError: generate_outline() got an unexpected keyword argument 'characters'`

- [ ] **Step 3: 修改 `backend/agents/planner.py` 的模块顶部 import**

在第 8 行 `from backend.models.world import iter_power_systems` 之后追加：

```python
from backend.growth_curve.context import compute_character_growth_context
from backend.outline_context.builder import (
    build_recent_chapters_context,
    build_volume_context,
)
from backend.outline_context.volumes import locate_volume, parse_volumes
```

- [ ] **Step 4: 替换 `generate_outline`（planner.py:483-540 整体）**

```python
    async def generate_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        characters: list[dict],
        chapter_number: int = 1,
        min_words: int = 4000,
        novel_outline: Optional[dict] = None,
        outline: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",
        user_modifications: str = "",
    ) -> tuple[dict, LLMResponse]:
        concept_context = json.dumps(concept, ensure_ascii=False, indent=2)
        story_dna_context = json.dumps(story_dna, ensure_ascii=False, indent=2)

        world_context = json.dumps(
            {
                "era": world.get("era", ""),
                "power_systems": [
                    ps.get("name", "") for ps in iter_power_systems(world)
                ],
                "core_rules": world.get("core_rules", []),
            },
            ensure_ascii=False,
            indent=2,
        )

        # v2.1: the chapter outline used to see only characters[0], leaving
        # antagonists and mentors invisible at planning time. Reuse the same
        # cast the novel outline was designed against.
        character_context = json.dumps(
            pick_outline_cast(characters), ensure_ascii=False, indent=2
        )

        # v2.1: slice the novel outline to the owning volume instead of dumping
        # the whole book. The slot name is unchanged on purpose — Prompt Plaza
        # overrides store full template text, so renaming would break them.
        novel_outline_context = build_volume_context(novel_outline, chapter_number)
        volume = locate_volume(chapter_number, parse_volumes(novel_outline))
        recent_chapters_context = build_recent_chapters_context(
            outline, chapter_number, volume
        )
        character_growth_context = (
            compute_character_growth_context(characters, chapter_number)
            or "（暂无角色成长曲线）"
        )

        from backend.agents._injection_helpers import _build_user_modifications_block
        result, response = await self.generate_from_template(
            "outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            chapter_number=chapter_number,
            min_words=min_words,
            novel_outline_context=novel_outline_context,
            recent_chapters_context=recent_chapters_context,
            character_growth_context=character_growth_context,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
            genre_pacing=_resolve_genre_pacing(genre),
            user_modifications=_build_user_modifications_block(user_modifications),
        )
        self.log_usage("outline_generation", response)
        return result, response
```

- [ ] **Step 5: 更新 `backend/prompts/outline_generation.yaml`**

把 `system_prompt` 的第 19-21 行（原第 9 条）替换为下面两条，其余 1-8 条不动：

```yaml
  9. 本章必须服务于【当前卷】的关键事件与本卷关键情节点；不得推进超出当前卷范围的
     剧情线——后续卷的内容只作为方向参考，不可提前落地
  10. 若下方用户提示中给出了【用户修改意见】，必须把每一条诉求严格落到 JSON 的
     具体字段里——节奏/视角/人设类落到对应字段；若与默认惯例冲突，以用户意见为准，
     不得以"符合网文惯例"为由忽略。【用户修改意见】为空时，按上述 1-9 条默认生成。
```

把 `user_prompt_template` 的第 33-40 行（角色设定 / 全书大纲 / 目标章节 三段）替换为：

```yaml
  出场阵容：
  {character_context}

  角色成长态势：
  {character_growth_context}

  卷级大纲上下文（本章所属卷的完整大纲 + 相邻卷摘要）：
  {novel_outline_context}

  {recent_chapters_context}

  目标章节：第 {chapter_number} 章
  最低字数：{min_words} 字
```

- [ ] **Step 6: 修复 `tests/test_genre_beat_patterns.py:219`**

把第 219 行的 `character={"name": "x"},` 改为：

```python
                characters=[{"name": "x"}],
```

- [ ] **Step 7: 运行测试确认通过**

Run: `source venv/bin/activate && pytest tests/test_planner_outline_context.py tests/test_genre_beat_patterns.py -q`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add backend/agents/planner.py backend/prompts/outline_generation.yaml \
        tests/test_planner_outline_context.py tests/test_genre_beat_patterns.py
git commit -m "feat(planner): assemble volume-scoped chapter outline context"
```

---

## Task 5: 端点接线

**Files:**
- Modify: `backend/api/stage3_outline.py`
- Modify: `backend/api/stage4_writing.py:1529-1563`
- Test: `tests/test_stage3_outline_context.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_stage3_outline_context.py`：

```python
"""Tests for STAGE3 endpoint wiring of volume slicing + growth alignment (v2.1)."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "登顶", "target_chapter_range": "101-120", "description": "问鼎"},
    ],
    "key_plot_points": [],
}

CHAPTER_RESULT = {
    "chapter_number": 1, "title": "开端", "theme": "起势",
    "scene_plan": [{"scene_number": 1, "goal": "开场", "conflict": "",
                    "emotional_arc": "", "narrative_role": "setup",
                    "beat_type": "setup", "required_logs": [],
                    "registry_changes": {"created": [], "updated": []}}],
}


@pytest.fixture
def client():
    return TestClient(app)


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed(projects_dir: Path, proj_id: str, stages_range: str = "9-9"):
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id, "title": "测试小说", "genre": "cool_novel", "min_words": 4000,
        "current_stage": "STAGE3", "stage_history": [], "created_at": "2025-01-01T00:00:00",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试"}, "story_dna": {},
    })
    _write_json(projects_dir, proj_id, "world.json", {
        "era": "异世界", "power_system": {"name": "灵力", "core_rules": []}, "core_rules": [],
    })
    _write_json(projects_dir, proj_id, "characters.json", {"characters": [
        {"id": "mc", "name": "林峰", "character_type": "protagonist",
         "is_core_character": True, "personality": {}, "current_state": {}, "relations": {},
         "growth_curve": {"curve_description": "", "stages": [
             {"stage_number": 1, "stage_name": "起", "trigger_event_type": "moral_awakening",
              "trigger_event_description": "", "character_change": "",
              "target_chapter_range": stages_range, "bound_chapter": None},
             {"stage_number": 2, "stage_name": "承", "trigger_event_type": "moral_awakening",
              "trigger_event_description": "", "character_change": "",
              "target_chapter_range": stages_range, "bound_chapter": None},
         ]}},
    ]})


def _new_project(client, projects_dir) -> str:
    resp = client.post("/api/project/create", json={
        "title": "测试小说", "genre": "cool_novel", "min_words": 4000,
        "free_text": "少年觉醒", "inspiration_source": "web_novel",
    })
    proj_id = resp.json()["detail"]["id"]
    _seed(projects_dir, proj_id)
    return proj_id


def _stage_ranges(projects_dir: Path, proj_id: str) -> list[str]:
    data = json.loads((projects_dir / proj_id / "characters.json").read_text())
    return [s["target_chapter_range"]
            for s in data["characters"][0]["growth_curve"]["stages"]]


class TestAlignmentOnNovelOutlineEndpoints:
    def test_generate_novel_outline_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(NOVEL_OUTLINE), None)
            resp = client.post("/api/stage3/generate-novel-outline",
                               json={"project_id": proj_id})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_put_novel_outline_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)

        resp = client.put("/api/stage3/novel-outline",
                          json={"project_id": proj_id, "novel_outline": dict(NOVEL_OUTLINE)})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_regenerate_section_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(NOVEL_OUTLINE), None)
            resp = client.post(
                f"/api/stage3/regenerate-novel-outline-section?project_id={proj_id}",
                json={"section": "volumes", "user_modifications": ""},
            )

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]


class TestGenerateChapterOutline:
    def test_aligns_on_entry_for_legacy_projects(self, client):
        """Existing projects hold degenerate ranges written by the deleted
        auto_generator. /stage3/generate re-aligns without a manual re-save."""
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))
        assert _stage_ranges(settings.projects_dir, proj_id) == ["9-9", "9-9"]

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            resp = client.post("/api/stage3/generate",
                               json={"project_id": proj_id, "chapter_number": 1})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_planner_receives_characters_list_and_outline(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))
        _write_json(settings.projects_dir, proj_id, "outline.json", {"chapters": [
            dict(CHAPTER_RESULT, chapter_number=1),
        ]})

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT, chapter_number=2), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 2})

        kwargs = mock.call_args.kwargs
        assert isinstance(kwargs["characters"], list)
        assert kwargs["characters"][0]["name"] == "林峰"
        assert kwargs["outline"]["chapters"][0]["chapter_number"] == 1
        assert "character" not in kwargs

    def test_total_chapters_uses_planned_total(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        progress = json.loads((settings.projects_dir / proj_id / "progress.json").read_text())
        assert progress["total_chapters"] == 120
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source venv/bin/activate && pytest tests/test_stage3_outline_context.py -q`
Expected: FAIL — 对齐相关断言全部失败（`["9-9", "9-9"] != ["1-20", "101-120"]`）

- [ ] **Step 3: 在 `stage3_outline.py` 顶部加 import 与共享 helper**

在第 16 行（`)` 结束 `agent_prompt_stores` 的 import 之后）追加：

```python
from backend.growth_curve.aligner import align_growth_curves
from backend.outline_context.volumes import planned_total
```

在 `NOVEL_OUTLINE_SECTION_TO_KEY` 字典定义（第 31 行 `}`）之后追加：

```python
def _realign_growth_curves(project_id: str, novel_outline: dict) -> None:
    """Re-derive growth-stage chapter ranges from the volume outline.

    Called after every write to novel_outline.json. Deterministic and
    idempotent, so re-running it is free.
    """
    characters_data = fm.read_json(project_id, "characters.json") or {}
    characters = characters_data.get("characters", [])
    if not characters:
        return
    align_growth_curves(characters, novel_outline)
    fm.write_json(project_id, "characters.json", {"characters": characters})
```

- [ ] **Step 4: 改造 `/stage3/generate`（stage3_outline.py:84-159）**

把第 84-108 行替换为：

```python
    characters = characters_data.get("characters", [])

    project = fm.read_json(project_id, "project.json")

    novel_outline = fm.read_json(project_id, "novel_outline.json") or None

    # Migration path for projects whose ranges were written by the deleted
    # auto_generator: alignment is deterministic and idempotent, so running it
    # here saves the user from having to re-save the novel outline by hand.
    align_growth_curves(characters, novel_outline)

    # Read before generating: the chapter prompt needs the preceding chapters
    # of this volume. The same dict is reused for the merge below; nothing
    # writes to outline.json in between.
    existing_outline = fm.read_json(project_id, "outline.json") or {}
    if "chapters" not in existing_outline:
        existing_outline = {"chapters": [existing_outline]} if existing_outline else {"chapters": []}

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel") if project else "cool_novel",
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, response = await agent.generate_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            characters=characters,
            chapter_number=data.get("chapter_number", 1),
            min_words=project.get("min_words", 4000) if project else 4000,
            novel_outline=novel_outline,
            outline=existing_outline,
            user_modifications=user_modifications,
        )
```

把第 115-126 行（`# Accumulate chapters:` 到 `fm.write_json(...)`）替换为：

```python
    # Accumulate chapters: upsert this chapter into the outline read above.
    existing_chapters = existing_outline.get("chapters", [])
    existing_chapters = [ch for ch in existing_chapters
                         if ch.get("chapter_number") != result.get("chapter_number")]
    existing_chapters.append(result)
    existing_chapters.sort(key=lambda ch: ch.get("chapter_number", 0))
    merged_outline = {"chapters": existing_chapters}
    fm.write_json(project_id, "outline.json", merged_outline)
```

把第 132-151 行（`progress = ...` 到 `fm.write_json(project_id, "progress.json", progress)`）替换为：

```python
    progress = fm.read_json(project_id, "progress.json") or {}
    novel_total = planned_total(fm.read_json(project_id, "novel_outline.json"))
    outline_count = len(merged_outline["chapters"])
    stored_total = progress.get("total_chapters") or 0
    refreshed = max(stored_total, novel_total, outline_count)
    if refreshed and refreshed != stored_total:
        progress["total_chapters"] = refreshed
        fm.write_json(project_id, "progress.json", progress)
```

把第 153-159 行（auto-generate + bind 段）替换为：

```python
    # Growth-stage ranges were already aligned above from the volume outline;
    # binder only fills bound_chapter (the chapter a stage actually fired in).
    from backend.growth_curve.binder import bind_growth_curve_to_outline
    updated_characters = bind_growth_curve_to_outline(characters, merged_outline)
    fm.write_json(project_id, "characters.json", {"characters": updated_characters})
```

- [ ] **Step 5: 在三个 novel-outline 端点后调用对齐器**

`generate_novel_outline`：在第 286 行 `fm.write_json(project_id, "novel_outline.json", result)` 之后加一行：

```python
    _realign_growth_curves(project_id, result)
```

`update_novel_outline`：在第 314 行 `fm.write_json(project_id, "novel_outline.json", novel_outline_data)` 之后加一行：

```python
    _realign_growth_curves(project_id, novel_outline_data)
```

`regenerate_novel_outline_section`：在第 403 行 `fm.write_json(project_id, "novel_outline.json", merged)` 之后加一行：

```python
    _realign_growth_curves(project_id, merged)
```

- [ ] **Step 6: 把 `stage4_writing.py` 的重复解析器收敛**

把 `backend/api/stage4_writing.py` 第 1529-1563 行（`_CHAPTER_RANGE_RE` 定义与 `_planned_chapter_total_from_novel_outline` 整个函数体）替换为：

```python
def _planned_chapter_total_from_novel_outline(novel_outline: Optional[dict]) -> int:
    """The user's planned total chapter count, parsed from volume ranges.

    Thin alias over outline_context.volumes.planned_total, kept so the two
    call sites below read the same as before.
    """
    from backend.outline_context.volumes import planned_total
    return planned_total(novel_outline)
```

第 1587 行与第 1791 行的调用点不变。

- [ ] **Step 7: 运行测试确认通过**

Run: `source venv/bin/activate && pytest tests/test_stage3_outline_context.py tests/test_stage3_novel_outline.py -q`
Expected: PASS

- [ ] **Step 8: 跑全量后端测试确认无回归**

Run: `source venv/bin/activate && pytest -q`
Expected: PASS（无新增失败）

- [ ] **Step 9: 提交**

```bash
git add backend/api/stage3_outline.py backend/api/stage4_writing.py \
        tests/test_stage3_outline_context.py
git commit -m "feat(stage3): wire growth alignment and volume-scoped outline context"
```

---

## Task 6: 人工验收

prompt 文案变更没有自动化断言，需要跑一次真实生成核对。

**Files:** 无改动

- [ ] **Step 1: 启动后端**

```bash
source venv/bin/activate && uvicorn backend.main:app --reload --port 8000
```

> 注意：编辑后端 `.py` 时若有 cockpit SSE 连接开着，`--reload` 会卡在 "Waiting for connections to close"。验收期间不要开工作台驾驶舱页面。

- [ ] **Step 2: 起前端并走一遍向导**

```bash
cd frontend && npm run dev
```

打开 http://localhost:5173，新建项目，走到步骤 5 生成全书大纲（确保产出 ≥3 卷），再进步骤 6 批量生成章节大纲。

- [ ] **Step 3: 核对 prompt 切片**

查看 `llm_usage.jsonl` 中最后一条 `outline_generation` 记录的 prompt，逐项确认：

1. 只出现当前卷的 `key_events`，其他卷只有 `summary`
2. 首卷章节无「【上一卷」段
3. `key_plot_points` 只含当前卷的
4. 「【角色成长态势」中的章节范围落在合理的卷区间内，不是 `1-1`
5. 第 2 章及以后出现「【本卷前文」段

- [ ] **Step 4: 核对成长曲线落盘**

```bash
python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
for c in d['characters']:
    gc=c.get('growth_curve')
    if gc: print(c['name'], [s['target_chapter_range'] for s in gc['stages']])
" projects/<新项目id>/characters.json
```

Expected: 范围跨越多个卷，单调不减，不是 `1-1` / `9-9` 这类退化值。

- [ ] **Step 5: 记录结论**

若切片或成长范围不符预期，回到对应 Task 修正并补测试。全部符合则本计划完成。

---

## 回滚

每个 Task 一个 commit，`git revert` 单个 commit 即可回退该层。若需整体回退到改动前，`docs/superpowers/specs/2026-08-21-volume-scoped-chapter-outline-design.md` 的提交（`da01006`）之后的所有 commit 均属本次改动。
