import json
from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse


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
        result, response = await self.generate_from_template(
            "concept_generation",
            initial_intent=initial_intent,
            genre=genre,
        )
        self.log_usage("concept_generation", response)
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
            genre=genre,
        )
        self.log_usage("canvas_to_concept", response)
        return result, response

    async def generate_world(
        self,
        concept: dict,
        story_dna: dict,
        genre: str = "cool_novel",
    ) -> tuple[dict, LLMResponse]:
        result, response = await self.generate_from_template(
            "world_generation",
            concept_title=concept.get("title", ""),
            concept_premise=concept.get("premise", ""),
            concept_tone=concept.get("tone", ""),
            concept_theme=concept.get("theme", ""),
            core_contradiction=story_dna.get("core_contradiction", {}).get(
                "statement", ""
            ),
            genre=genre,
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
        )
        self.log_usage("novel_outline_generation", response)
        return result, response
