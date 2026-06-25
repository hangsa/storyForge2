import json
from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse


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
        character: dict,
        min_words: int = 4000,
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

        result, response = await self.generate_from_template(
            "novel_outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            min_words=min_words,
        )
        self.log_usage("novel_outline_generation", response)
        return result, response
