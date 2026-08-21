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