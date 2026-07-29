import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse
from backend.agents.writer import _resolve_genre_label


def _resolve_genre_extras(genre: str) -> dict[str, str]:
    """Resolve a genre id to its tone, style_rules, and trope_patterns
    formatted for prompt injection.

    Each field is rendered as a multi-line string ready to drop into a
    user_prompt_template. Missing catalog entries return empty strings so
    the prompt still renders without raising.

    Format:
      tone:           the prose block as-is
      style_rules:    numbered list ("1. rule\\n2. rule\\n...")
      trope_patterns: bulleted list ("- name: description\\n...")
    """
    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return {"tone": "", "style_rules": "", "trope_patterns": ""}

    tone = (entry.get("tone") or "").strip()

    rules = entry.get("style_rules") or []
    if rules:
        style_rules = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(rules))
    else:
        style_rules = ""

    tropes = entry.get("trope_patterns") or []
    if tropes:
        trope_patterns = "\n".join(
            f"- {t.get('name', '')}: {t.get('description', '')}"
            for t in tropes
        )
    else:
        trope_patterns = ""

    return {
        "tone": tone,
        "style_rules": style_rules,
        "trope_patterns": trope_patterns,
    }


_FOCUS_VOCAB_PATH = Path(__file__).resolve().parents[2] / "config" / "genre_focus_vocabulary.yaml"


@lru_cache(maxsize=1)
def _resolve_genre_focus_vocabulary() -> str:
    """Load focus vocabulary once and return formatted legend string.

    Returns multi-line text:
      【focus 字段图例】
      - sensory:  感官描写为主，渲染氛围/环境/细节
      - action:   动作/事件推进为主，节奏紧凑
      - dialogue: 对话/心理独白为主，人物互动
      - emotion:  情感波动为主，内心刻画
      - suspense: 悬念/不安为主，信息管控
      - reveal:   揭露/反转为主，情节兑现

    The leading 【focus 字段图例】 header is included so the prompt template
    only needs to place {genre_focus_vocabulary} on its own line.

    Raises FileNotFoundError if the YAML is missing (caller should let it
    propagate so misconfiguration is loud).
    """
    import yaml
    data = yaml.safe_load(_FOCUS_VOCAB_PATH.read_text(encoding="utf-8")) or {}
    legend = data.get("focus_legend") or {}
    lines = ["【focus 字段图例】"]
    for key in ("sensory", "action", "dialogue", "emotion", "suspense", "reveal"):
        desc = legend.get(key, "")
        lines.append(f"- {key}: {desc}")
    return "\n".join(lines)


def _resolve_genre_beat_patterns(
    genre: str,
    outline_text: Optional[str] = "",
) -> str:
    """Return keyword-matched beat templates as a formatted multi-line string,
    INCLUDING the leading 【题材节拍模板】 section header.

    For the given genre, read `beat_patterns` from catalog. If `outline_text`
    is non-empty (and not None), keep only templates where at least one
    keyword is a substring of outline_text. Sort by priority desc.

    Render shape (whole section, including header):
      【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）
      1. keywords=[打脸, 装逼, ...] priority=90
         - 铺垫：对手嚣张/轻视/嘲讽主角 (500 字, focus: dialogue)
         - 交锋：... (700 字, focus: action)
         ...
      2. keywords=[突破, 升级, ...] priority=70
         ...

    If no templates match (after filtering), return empty string. The whole
    section disappears from the rendered prompt — no blank header.

    outline_text=None is normalized to "" (defensive: substring match would
    TypeError on None).
    """
    outline = (outline_text or "")
    filter_active = bool(outline)

    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return ""

    patterns = entry.get("beat_patterns") or []
    if not patterns:
        return ""

    if filter_active:
        matched = [
            tmpl for tmpl in patterns
            if any(kw in outline for kw in tmpl.get("keywords", []))
        ]
    else:
        matched = list(patterns)

    if not matched:
        return ""

    # Sort by priority desc; stable on tie
    matched = sorted(matched, key=lambda t: -t.get("priority", 0))

    lines = ["【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）"]
    for i, tmpl in enumerate(matched, start=1):
        keywords_str = ", ".join(tmpl.get("keywords", []))
        priority = tmpl.get("priority", 0)
        lines.append(f"{i}. keywords=[{keywords_str}] priority={priority}")
        for beat in tmpl.get("beats", []):
            desc = beat.get("description", "")
            words = beat.get("words", 0)
            focus = beat.get("focus", "")
            lines.append(f"   - {desc} ({words} 字, focus: {focus})")
    return "\n".join(lines)


# Role labels surfaced to the LLM. Must match the user-facing wizard labels
# (CharacterStep.tsx CHARACTER_TYPES) so the LLM's output is consistent with
# what the user sees when reviewing.
CHARACTER_ROLE_LABELS = {
    "protagonist": "主角",
    "antagonist": "反派",
    "supporting": "配角",
    "mentor": "导师",
}

# Order in which character types are picked for the outline prompt. The wizard
# default batch (1P + 2A + 3S) defines the "core cast"; if more roles exist
# (e.g. a mentor), they extend the list past 6.
OUTLINE_CAST_PRIORITY = ["protagonist", "antagonist", "supporting", "mentor"]

# Per-role cap when picking the cast for the outline prompt. 1+2+3 = 6, which
# matches the wizard's "1 主角 + 2 反派 + 3 配角" default batch and keeps the
# prompt within its ~8K token budget even with full character data.
OUTLINE_CAST_CAPS = {
    "protagonist": 1,
    "antagonist": 2,
    "supporting": 3,
    "mentor": 6,  # cap loosely; rarely present
}

# Target total word count → user-facing length category. Mirrors the LENGTHS
# options in CreateProjectCard.tsx (短篇快穿 / 标准商业连载 / 宏大史诗巨著).
# Thresholds sit at the midpoints between the user-facing options so a
# slightly custom total (e.g. 60万) falls into the intended bucket.
LENGTH_CATEGORY_THRESHOLDS = (
    (500_000, "短篇快穿"),
    (2_000_000, "标准商业连载"),
)


def length_category_for(target_total_words: int) -> str:
    """Map `project.target_total_words` to the user-facing length category
    the LLM can reason about. Anything above the highest threshold is 宏大史诗巨著.

    Thresholds are exclusive on the lower bound (strict `<`), so a value
    exactly at a midpoint (e.g. 50万 between 短篇快穿 and 标准商业连载) falls
    into the upper bucket — matches the user-facing options (30/100/300 万).
    """
    for threshold, label in LENGTH_CATEGORY_THRESHOLDS:
        if target_total_words < threshold:
            return label
    return "宏大史诗巨著"


def pick_outline_cast(characters: list[dict]) -> list[dict]:
    """Pick up to 6 characters (1 protagonist + 2 antagonists + 3 supporting,
    plus any mentors) for the novel-outline LLM context. Preserves input order
    within each role bucket so the wizard's generation order is respected.

    Each returned entry is a compact, role-labeled view of the character
    containing only the fields the LLM needs to design volumes and key plot
    points: role, name, is_core, personality, current_state, relations.
    Voice signature and growth curve are excluded — the former is scene-level,
    the latter is derived from the outline post-hoc.
    """
    if not characters:
        return []

    by_type: dict[str, list[dict]] = {role: [] for role in OUTLINE_CAST_PRIORITY}
    for c in characters:
        role = c.get("character_type", "supporting")
        if role not in by_type:
            by_type[role] = []
        by_type[role].append(c)

    picked: list[dict] = []
    for role in OUTLINE_CAST_PRIORITY:
        cap = OUTLINE_CAST_CAPS.get(role, 6)
        for c in by_type.get(role, [])[:cap]:
            picked.append({
                "role": CHARACTER_ROLE_LABELS.get(role, role),
                "character_type": role,
                "name": c.get("name", ""),
                "is_core": bool(c.get("is_core_character", False)),
                "personality": c.get("personality", {}),
                "current_state": c.get("current_state", {}),
                "relations": c.get("relations", {}),
            })
    return picked


class PlannerAgent(BaseAgent):
    agent_name = "planner"

    async def generate_concept_and_dna(
        self, initial_intent: str, genre: str = "cool_novel"
    ) -> tuple[dict, LLMResponse]:
        extras = _resolve_genre_extras(genre)
        result, response = await self.generate_from_template(
            "concept_generation",
            initial_intent=initial_intent,
            genre=_resolve_genre_label(genre),
            genre_tone=extras["tone"],
            genre_style_rules=extras["style_rules"],
            genre_trope_patterns=extras["trope_patterns"],
        )
        self.log_usage("concept_generation", response)

        # Light tone-alignment check: if LLM's concept.tone drifts far from
        # the catalog's tone, attach a warning so the frontend can flag it.
        # Non-blocking — the concept is still accepted.
        from backend.style_engine.tone_check import check_tone_alignment
        concept_tone = (
            result.get("concept", {}).get("tone", "")
            if isinstance(result, dict)
            else ""
        )
        alignment = check_tone_alignment(concept_tone, genre)
        if not alignment["aligned"]:
            result.setdefault("warnings", []).append({
                "field": "concept.tone",
                "code": "TONE_ALIGNMENT_LOW",
                "score": alignment["score"],
                "message": alignment["warning"],
            })

        return result, response

    async def generate_concept_from_canvas(
        self, canvas_summary: str, genre: str = "cool_novel"
    ) -> tuple[dict, LLMResponse]:
        """Translate a finalized canvas selected_path into a concept + story_dna.

        Used by /api/v1/projects/<id>/creative/canvas/commit. The summary
        is the selected_path nodes pre-formatted (content + trope_tags +
        novelty_score + mutation_context) by the endpoint.
        """
        result, response = await self.generate_from_template(
            "canvas_to_concept",
            canvas_summary=canvas_summary,
            genre=_resolve_genre_label(genre),
        )
        self.log_usage("canvas_to_concept", response)
        return result, response

    async def generate_world(
        self,
        concept: dict,
        story_dna: dict,
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
        extras = _resolve_genre_extras(genre)
        result, response = await self.generate_from_template(
            "world_generation",
            concept_title=concept.get("title", ""),
            concept_premise=concept.get("premise", ""),
            concept_tone=concept.get("tone", ""),
            concept_theme=concept.get("theme", ""),
            core_contradiction=story_dna.get("core_contradiction", {}).get(
                "statement", ""
            ),
            genre=_resolve_genre_label(genre),
            genre_tone=extras["tone"],
            genre_style_rules=extras["style_rules"],
            genre_trope_patterns=extras["trope_patterns"],
        )
        self.log_usage("world_generation", response)
        return result, response

    async def generate_character(
        self,
        concept: dict,
        world: dict,
        character_type: str = "protagonist",
        character_index: int = 0,
        existing_characters: Optional[list[dict]] = None,
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
        concept_context = json.dumps(concept, ensure_ascii=False, indent=2)

        power_system = world.get("power_system", {})
        if isinstance(power_system, dict):
            ps_name = power_system.get("name", "")
            ps_rules = "\n".join(
                f"  - {r}" for r in power_system.get("core_rules", [])
            )
        else:
            ps_name = str(power_system)
            ps_rules = ""

        type_labels = {
            "protagonist": "主角",
            "antagonist": "反派",
            "supporting": "配角",
            "mentor": "导师",
        }
        is_core = "true" if character_type == "protagonist" else "false"

        existing_chars = existing_characters or []
        if existing_chars:
            existing_summary = json.dumps(
                [
                    {
                        "name": c.get("name", ""),
                        "character_type": c.get("character_type", ""),
                        "core_traits": c.get("personality", {}).get("core_traits", []),
                        "role": c.get("personality", {}).get("beliefs", []),
                    }
                    for c in existing_chars
                ],
                ensure_ascii=False,
                indent=2,
            )
            existing_section = f"已有角色（避免性格/能力重叠）：\n{existing_summary}"
        else:
            existing_section = ""

        extras = _resolve_genre_extras(genre)
        result, response = await self.generate_from_template(
            "character_generation",
            concept_context=concept_context,
            world_era=world.get("era", ""),
            power_system_name=ps_name,
            power_system_rules=ps_rules,
            character_type=character_type,
            character_type_label=type_labels.get(character_type, "角色"),
            is_core_character=is_core,
            existing_characters_section=existing_section,
            genre=_resolve_genre_label(genre),
            genre_tone=extras["tone"],
            genre_style_rules=extras["style_rules"],
            genre_trope_patterns=extras["trope_patterns"],
        )
        self.log_usage("character_generation", response)
        return result, response

    async def generate_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        character: dict,
        chapter_number: int = 1,
        min_words: int = 4000,
        novel_outline: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
        concept_context = json.dumps(concept, ensure_ascii=False, indent=2)
        story_dna_context = json.dumps(story_dna, ensure_ascii=False, indent=2)

        world_context = json.dumps(
            {
                "era": world.get("era", ""),
                "power_system": world.get("power_system", {}).get("name", ""),
                "core_rules": world.get("core_rules", []),
            },
            ensure_ascii=False,
            indent=2,
        )

        char_summary = {
            "name": character.get("name", ""),
            "personality": character.get("personality", {}),
            "current_state": character.get("current_state", {}),
        }
        character_context = json.dumps(char_summary, ensure_ascii=False, indent=2)

        novel_outline_context = (
            json.dumps(novel_outline, ensure_ascii=False, indent=2)
            if novel_outline
            else "（暂无全书大纲 — 章节生成时按故事 DNA 和概念自主设计）"
        )

        result, response = await self.generate_from_template(
            "outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            chapter_number=chapter_number,
            min_words=min_words,
            novel_outline_context=novel_outline_context,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
        )
        self.log_usage("outline_generation", response)
        return result, response

    async def generate_novel_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        characters: list[dict],
        target_total_words: int = 1_000_000,
        min_words: int = 2000,
        map_data: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
        concept_context = json.dumps(concept, ensure_ascii=False, indent=2)
        story_dna_context = json.dumps(story_dna, ensure_ascii=False, indent=2)

        world_context = json.dumps(
            {
                "era": world.get("era", ""),
                "power_system": world.get("power_system", {}).get("name", ""),
                "core_rules": world.get("core_rules", []),
            },
            ensure_ascii=False,
            indent=2,
        )

        # 6-character cast: 1 protagonist + 2 antagonists + 3 supporting, with
        # mentors and any extras appended. See pick_outline_cast() above.
        cast = pick_outline_cast(characters)
        characters_context = json.dumps(
            cast,
            ensure_ascii=False,
            indent=2,
        )

        # Map system context is optional — MapStep is a placeholder today, so
        # the file may not exist. When present, pass the raw dict; the prompt
        # notes the field is optional and the LLM ignores an empty value.
        if map_data:
            map_context = json.dumps(map_data, ensure_ascii=False, indent=2)
        else:
            map_context = "（暂无地图系统信息）"

        # Length category is derived from the project's target total, not the
        # per-chapter min_words (all three new options share 2000 字/章).
        length_category = length_category_for(target_total_words)

        result, response = await self.generate_from_template(
            "novel_outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            characters_context=characters_context,
            map_context=map_context,
            length_category=length_category,
            target_total_words=target_total_words,
            min_words=min_words,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
        )
        self.log_usage("novel_outline_generation", response)
        return result, response
