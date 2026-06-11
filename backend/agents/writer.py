from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse


class WriterAgent(BaseAgent):

    def _build_base_vars(
        self,
        genre: str,
        concept: dict,
        world_rules: dict,
        character: dict,
        scene_plan: dict,
        l0_context: str,
        l1_context: str,
    ) -> dict:
        core_contradiction = concept.get("story_dna", {}).get(
            "core_contradiction", {}
        )
        premise = concept.get("concept", {}).get("premise", "")

        power_system = world_rules.get("power_system", {})
        if isinstance(power_system, dict):
            ps_name = power_system.get("name", "")
            ps_desc = power_system.get("description", "")
        else:
            ps_name = str(power_system)
            ps_desc = ""

        core_rules = world_rules.get("core_rules", [])
        core_rules_str = (
            "\n".join(f"  - {r}" for r in core_rules)
            if isinstance(core_rules, list)
            else str(core_rules)
        )

        ceilings = world_rules.get("ceilings", [])
        ceilings_str = (
            "\n".join(f"  - {c}" for c in ceilings)
            if isinstance(ceilings, list)
            else str(ceilings)
        )

        char_name = character.get("name", "主角")
        char_location = character.get("current_state", {}).get("location", "未知")
        char_emotion = character.get("current_state", {}).get("emotion", "平静")

        char_taboos = character.get("voice_signature", {}).get("taboos", [])
        taboos_str = (
            "\n".join(f"  - {t}" for t in char_taboos) if char_taboos else "无"
        )

        char_unknown = character.get("unknown_to_character", [])
        unknown_str = (
            "\n".join(f"  - {u}" for u in char_unknown) if char_unknown else "无"
        )

        required_logs = scene_plan.get("required_logs", [])
        logs_list = (
            "\n".join(f"  - {log_type}" for log_type in required_logs)
            if required_logs
            else "无特殊要求"
        )

        return {
            "genre": genre,
            "core_contradiction": core_contradiction.get("statement", ""),
            "premise": premise,
            "power_system_name": ps_name,
            "power_system_description": ps_desc,
            "core_rules": core_rules_str,
            "ceilings": ceilings_str,
            "character_name": char_name,
            "character_location": char_location,
            "character_emotion": char_emotion,
            "character_taboos": taboos_str,
            "character_unknown": unknown_str,
            "scene_goal": scene_plan.get("goal", ""),
            "scene_conflict": scene_plan.get("conflict", ""),
            "scene_emotional_arc": scene_plan.get("emotional_arc", ""),
            "scene_narrative_role": scene_plan.get("narrative_role", "setup"),
            "required_logs_list": logs_list,
            "l0_context": l0_context,
            "l1_context": l1_context,
        }

    async def write_scene(
        self,
        *,
        genre: str,
        concept: dict,
        world_rules: dict,
        character: dict,
        scene_plan: dict,
        l0_context: str = "",
        l1_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, character, scene_plan,
            l0_context, l1_context,
        )
        return await self.generate_from_template(
            "scene_writing", **template_vars, **kwargs
        )

    async def rewrite_scene(
        self,
        *,
        genre: str,
        concept: dict,
        world_rules: dict,
        character: dict,
        scene_plan: dict,
        retry_hints: str,
        previous_draft: str,
        l0_context: str = "",
        l1_context: str = "",
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, character, scene_plan,
            l0_context, l1_context,
        )
        template_vars["retry_hints"] = retry_hints
        template_vars["previous_draft"] = previous_draft
        return await self.generate_from_template(
            "scene_rewrite", **template_vars, **kwargs
        )
