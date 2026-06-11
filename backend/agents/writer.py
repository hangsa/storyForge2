from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse


class WriterAgent(BaseAgent):

    @staticmethod
    def _build_characters_context(characters: list[dict]) -> str:
        if not characters:
            return "无角色信息"

        # POV character: first protagonist, or first character
        pov = next(
            (c for c in characters if c.get("character_type") == "protagonist"),
            characters[0],
        )

        def _char_basic(c: dict) -> str:
            cs = c.get("current_state", {})
            return (
                f"- {c.get('name', '未知')}"
                f" | {c.get('character_type', '未知')}"
                f" | 位置：{cs.get('location', '未知')}"
                f" | 情绪：{cs.get('emotional', '平静')}"
            )

        lines = ["【主要角色（POV）】"]
        lines.append(f"- 姓名：{pov.get('name', '主角')}")
        lines.append(f"- 角色类型：{pov.get('character_type', 'protagonist')}")
        lines.append(f"- 当前位置：{pov.get('current_state', {}).get('location', '未知')}")
        lines.append(f"- 当前情绪：{pov.get('current_state', {}).get('emotional', '平静')}")

        taboos = pov.get("voice_signature", {}).get("taboos", [])
        lines.append("- 行为禁忌（绝对不能做）：")
        if taboos:
            for t in taboos:
                lines.append(f"  - {t}")
        else:
            lines.append("  无")

        unknown = pov.get("unknown_to_character", [])
        lines.append("- 角色不知道的信息（不能在文中出现）：")
        if unknown:
            for u in unknown:
                lines.append(f"  - {u}")
        else:
            lines.append("  无")

        others = [c for c in characters if c.get("id") != pov.get("id")]
        if others:
            lines.append("")
            lines.append("【其他出场角色】")
            for c in others:
                lines.append(_char_basic(c))

        return "\n".join(lines)

    def _build_base_vars(
        self,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
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
            "characters_context": self._build_characters_context(characters),
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
        characters: list[dict],
        scene_plan: dict,
        l0_context: str = "",
        l1_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
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
        characters: list[dict],
        scene_plan: dict,
        retry_hints: str,
        previous_draft: str,
        l0_context: str = "",
        l1_context: str = "",
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
        )
        template_vars["retry_hints"] = retry_hints
        template_vars["previous_draft"] = previous_draft
        return await self.generate_from_template(
            "scene_rewrite", **template_vars, **kwargs
        )
