from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncIterator, Optional

from backend.agents.base_agent import BaseAgent, LLMResponse, StreamChunk

logger = logging.getLogger(__name__)


def _resolve_genre_label(genre: str) -> str:
    """Resolve a genre id to its Chinese label via the catalog.

    Falls back to the raw id if the catalog is unavailable or the entry
    is missing ``label_zh``. This keeps the {genre} prompt placeholder
    human-readable for Chinese prompts while preserving existing behavior
    when the catalog is not yet wired up.
    """
    try:
        from backend.genres.catalog import get_catalog
        label = get_catalog().get(genre).get("label_zh")
        if label:
            return label
    except Exception as e:  # noqa: BLE001 - catalog may be unconfigured in tests
        logger.warning(
            "GenreCatalog unavailable for {genre} placeholder, using raw id '%s': %s",
            genre, e,
        )
    return genre


def _resolve_genre_scene_pacing(genre: str) -> str:
    """Return a multi-line pacing section for scene-level prompt injection.

    Includes 4 scene-level fields (excludes chapter_words + escalation_interval):
      - scene_words.{min, max}
      - action_ratio
      - max_consecutive_non_action
      - min_beats_per_1k

    Returns "" on catalog failure or when no scene-level fields are present.
    """
    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return ""

    pacing = entry.get("pacing") or {}
    if not pacing:
        return ""

    lines = ["【本场节奏约束】（仅作写作参考，不阻塞）"]
    sw = pacing.get("scene_words") or {}
    if isinstance(sw.get("min"), (int, float)) and not isinstance(sw.get("min"), bool) and isinstance(sw.get("max"), (int, float)) and not isinstance(sw.get("max"), bool):
        lines.append(f"- 本场字数：{sw['min']}~{sw['max']} 字（参考值）")
    ar = pacing.get("action_ratio")
    if isinstance(ar, (int, float)) and not isinstance(ar, bool):
        lines.append(f"- 动作/感官段占比目标：{ar}（±30%）")
    mcna = pacing.get("max_consecutive_non_action")
    if isinstance(mcna, (int, float)) and not isinstance(mcna, bool) and mcna >= 0:
        lines.append(f"- 连续非动作段最多：{mcna} 段")
    mbk = pacing.get("min_beats_per_1k")
    if isinstance(mbk, (int, float)) and not isinstance(mbk, bool):
        lines.append(f"- SF_LOG 标签密度：≥ {mbk} 个/千字")
    return "\n".join(lines)


def _name_in_text(name: str, text: str, other_names: set[str] | None = None) -> bool:
    """Match a Chinese character name in CJK text.

    The naive ``name in text`` false-positives when one character's name is
    a substring of another (e.g. ``林`` matches inside ``林峰``). This helper
    uses the project characters list to detect and reject such cases: a name
    matches only if it's not a prefix or suffix of another longer name that
    also appears at the same position.

    ``other_names`` is the set of all OTHER characters' names in the project
    (excluding ``name`` itself). When a longer name that contains ``name`` as
    a substring also appears in ``text``, the longer match wins and this
    helper returns False.
    """
    if not name or not text:
        return False
    if name not in text:
        return False
    if not other_names:
        return True
    # Reject if `name` is a prefix of a longer name that ALSO appears in text.
    for other in other_names:
        if other == name:
            continue
        if len(other) <= len(name):
            continue
        if name in other and other in text:
            # If the longer name appears in text, prefer it over the shorter one.
            return False
    return True


def _build_custom_style_desc(custom_style_config) -> str:
    """Convert a custom_style_config dict (SandboxParams shape) into a Chinese
    description for the writer prompt. Returns "" on None or invalid input.
    """
    if not custom_style_config:
        return ""
    try:
        from backend.style_engine.sandbox_models import SandboxParams
        from backend.style_engine.sandbox_renderer import _build_params_description

        if isinstance(custom_style_config, SandboxParams):
            return _build_params_description(custom_style_config)
        return _build_params_description(SandboxParams(**custom_style_config))
    except Exception:
        return ""


class WriterAgent(BaseAgent):
    agent_name = "writer"

    # Characters appearing in the current scene are surfaced with their full
    # structured personality + voice + state + behavior examples, so the
    # Writer can keep dialogue and decisions in-character. Older characters
    # that lack `behavior_examples` degrade gracefully (a marker note is
    # emitted in place of the examples block).
    #
    # Token budget: ≤4000 tok per call. Priority tiering (POV > antagonist /
    # multi-scene > single-scene supporting > background) drops low-tier
    # examples first when over budget. POV is never truncated.
    _CHAR_CONTEXT_BUDGET_TOKENS = 4000
    _TIER_POV = 1.0
    _TIER_KEY = 0.8
    _TIER_SUPPORTING = 0.5
    _TIER_BACKGROUND = 0.2

    @staticmethod
    def _token_count(s: str) -> int:
        """Rough Chinese-aware token estimate: ~1 token per Chinese char,
        ~0.25 token per ASCII char (whitespace-split). Used for budget
        enforcement only; precision not required."""
        ascii_chars = sum(1 for c in s if c.isascii() and not c.isspace())
        cn_chars = sum(1 for c in s if not c.isascii() and not c.isspace())
        return int(ascii_chars * 0.25 + cn_chars)

    @classmethod
    def _resolve_appearing_characters(
        cls,
        characters: list[dict],
        scene_plan: dict | None,
    ) -> list[tuple[dict, float, bool]]:
        """Return [(character, priority_tier, is_canonical_pov)] for those
        appearing in this scene.

        Selection order:
          1. POV (first protagonist) — always included at tier 1.0.
          2. Other protagonists — also tier 1.0 (protagonists matter), but
             is_canonical_pov=False so the label renders as plain `主角`.
          3. Any character whose name appears in scene_plan.goal/conflict/
             emotional_arc (CJK word-boundary matched, not raw substring).
          4. Remaining characters (will be truncated by budget if too many).
        """
        if not characters:
            return []

        pov = next(
            (c for c in characters if c.get("character_type") == "protagonist"),
            characters[0],
        )
        pov_id = pov.get("id")

        plan_text = ""
        if scene_plan:
            plan_text = " ".join([
                str(scene_plan.get("goal", "")),
                str(scene_plan.get("conflict", "")),
                str(scene_plan.get("emotional_arc", "")),
            ])

        appearing: list[tuple[dict, float, bool]] = []
        pov_added = False

        # Pass 1: POV first (canonical POV), then other protagonists at tier 1.0.
        for c in characters:
            if c.get("character_type") != "protagonist":
                continue
            if c.get("id") == pov_id and not pov_added:
                appearing.append((c, cls._TIER_POV, True))
                pov_added = True
            else:
                # Other protagonists also get tier 1.0; only the canonical POV
                # gets the (POV) suffix.
                appearing.append((c, cls._TIER_POV, False))

        # Pass 2: name-matched non-protagonists.
        all_names = {c.get("name", "") for c in characters if c.get("name")}
        for c in characters:
            if c.get("id") == pov_id:
                continue
            if any(ac.get("id") == c.get("id") for ac, _, _ in appearing):
                continue
            name = c.get("name", "")
            if name and _name_in_text(name, plan_text, all_names - {name}):
                ctype = c.get("character_type", "supporting")
                if ctype == "antagonist":
                    appearing.append((c, cls._TIER_KEY, False))
                else:
                    appearing.append((c, cls._TIER_SUPPORTING, False))

        # Pass 3: remaining characters (will be truncated by budget if too many)
        for c in characters:
            if c.get("id") == pov_id:
                continue
            if any(ac.get("id") == c.get("id") for ac, _, _ in appearing):
                continue
            ctype = c.get("character_type", "supporting")
            if ctype == "antagonist":
                appearing.append((c, cls._TIER_KEY, False))
            else:
                appearing.append((c, cls._TIER_BACKGROUND, False))

        return appearing

    @classmethod
    def _format_character(cls, c: dict, tier: float, max_examples: int = 5,
                         is_pov: bool = False) -> str:
        """Render one character as a multi-line block. Caller controls
        max_examples to compress low-priority characters under budget pressure.

        ``is_pov`` only affects labeling for ``protagonist`` characters: when
        True, the canonical POV gets the ``(主角 (POV))`` label; other
        protagonists get ``(主角)``.
        """
        pers = c.get("personality", {}) or {}
        voice = c.get("voice_signature", {}) or {}
        state = c.get("current_state", {}) or {}
        unknowns = c.get("unknown_to_character", []) or []
        examples = voice.get("behavior_examples") or []

        ctype = c.get("character_type", "supporting")
        if ctype == "protagonist":
            type_label = "主角 (POV)" if is_pov else "主角"
        else:
            type_label_map = {
                "antagonist": "反派",
                "supporting": "配角",
                "mentor": "导师",
            }
            type_label = type_label_map.get(ctype, ctype)

        lines = [f"### {c.get('name', '未知')} ({type_label})"]

        def _list(v):
            if isinstance(v, list) and v:
                return "[" + ", ".join(str(x) for x in v) + "]"
            return "无"

        lines.append(f"- 核心特质: {_list(pers.get('core_traits', []))}")
        lines.append(f"- 信念: {_list(pers.get('beliefs', []))}")
        lines.append(f"- 欲望: {_list(pers.get('desires', []))}")
        lines.append(f"- 恐惧: {_list(pers.get('fears', []))}")
        lines.append(f"- 价值观: {_list(pers.get('values', []))}")

        lines.append(f"- 语言风格: {voice.get('speech_style', '') or '未设定'}")
        lines.append(f"- 思维模式: {voice.get('thought_patterns', '') or '未设定'}")
        lines.append(f"- 行为禁忌: {_list(voice.get('taboos', []))}")

        lines.append(f"- 当前位置: {state.get('location', '') or '未知'}")
        lines.append(f"- 身体状况: {state.get('physical_condition', '') or '未知'}")
        lines.append(f"- 情绪: {state.get('emotional', '') or '未知'}")
        if state.get("known_secrets"):
            lines.append(f"- 已知秘密: {_list(state.get('known_secrets', []))}")

        if unknowns:
            lines.append(f"- 角色不知道: {_list(unknowns)}")

        if examples:
            lines.append("- 行为示例:")
            for ex in examples[:max_examples]:
                lines.append(
                    f"  - 场景「{ex.get('situation', '')}」"
                    f" → 行为「{ex.get('action', '')}」"
                    f" → 台词「{ex.get('speech_sample', '')}」"
                )
        else:
            lines.append("- 行为示例: （无行为示例，按结构化字段演绎）")

        return "\n".join(lines)

    @classmethod
    def _build_characters_context(cls, characters: list[dict], scene_plan: dict | None = None) -> str:
        """Render a per-scene character context block with full structured
        fields + behavior examples for every appearing character, respecting
        the 4000-tok budget via priority-tier truncation.

        Backward compat: characters without `behavior_examples` get a marker
        note instead of the examples block — they still emit full structured
        fields, so behavior consistency is preserved as best the LLM can do
        without examples.
        """
        if not characters:
            return "无角色信息"
        if scene_plan is None:
            return "无角色信息"

        appearing = cls._resolve_appearing_characters(characters, scene_plan)
        if not appearing:
            return "无角色信息"

        # Sort by priority descending so POV (1.0) comes first and gets
        # allocated budget before lower tiers. Stable: ties keep the order
        # they came out of _resolve_appearing_characters.
        appearing_sorted = sorted(appearing, key=lambda x: -x[1])

        # First pass: render every character with full examples. Compute total.
        rendered: list[tuple[dict, float, str, bool]] = []
        total_tokens = 0
        for c, tier, is_pov in appearing_sorted:
            block = cls._format_character(c, tier, max_examples=5, is_pov=is_pov)
            rendered.append((c, tier, block, is_pov))
            total_tokens += cls._token_count(block)

        # If over budget, apply progressive truncation:
        #   background (0.2) → name+one-liner, no examples
        #   supporting (0.5) → max 2 examples
        #   key/antagonist (0.8) → max 3 examples
        #   POV (1.0) → never touched (always 5 examples)
        truncated = False
        if total_tokens > cls._CHAR_CONTEXT_BUDGET_TOKENS:
            truncated = True
            new_rendered: list[tuple[dict, float, str, bool]] = []
            total_tokens = 0
            for c, tier, _block, is_pov in rendered:
                if tier >= cls._TIER_POV:
                    new_block = cls._format_character(c, tier, max_examples=5, is_pov=is_pov)
                elif tier >= cls._TIER_KEY:
                    new_block = cls._format_character(c, tier, max_examples=3, is_pov=is_pov)
                elif tier >= cls._TIER_SUPPORTING:
                    new_block = cls._format_character(c, tier, max_examples=2, is_pov=is_pov)
                else:
                    # background: name + type + one-line behavior hint
                    pers = c.get("personality", {}) or {}
                    name = c.get("name", "未知")
                    ctype = c.get("character_type", "supporting")
                    new_block = (
                        f"### {name} ({ctype}) (仅提及)\n"
                        f"- 核心特质: {', '.join(pers.get('core_traits', [])[:2]) or '无'}\n"
                        f"- 行为示例: （无行为示例，按结构化字段演绎）"
                    )
                new_rendered.append((c, tier, new_block, is_pov))
                total_tokens += cls._token_count(new_block)
            rendered = new_rendered

        if truncated:
            import logging
            logging.getLogger(__name__).debug(
                "characters_context_truncated final_tok=%d",
                total_tokens,
            )

        header = "## 出场角色 (按优先级排序)"
        return header + "\n\n" + "\n\n".join(b for _, _, b, _ in rendered)

    @staticmethod
    def _build_chapter_outline_context(chapter: dict | None) -> str:
        """Render a chapter's title + theme + scene sequence as a ~150-200 tok
        block for the Writer prompt. Empty string on missing/empty input."""
        if not chapter:
            return ""
        lines = ["## 本章大纲"]
        title = chapter.get("title") or ""
        if title:
            lines.append(f"- 标题: {title}")
        theme = chapter.get("theme")
        if theme:
            lines.append(f"- 主题: {theme}")
        scene_plan = chapter.get("scene_plan") or []
        if scene_plan:
            lines.append("- 场景序列:")
            for i, sp in enumerate(scene_plan, 1):
                if not isinstance(sp, dict):
                    parts = [f"  {i}. "]
                else:
                    goal = sp.get("goal") or ""
                    conflict = sp.get("conflict") or ""
                    arc = sp.get("emotional_arc") or ""
                    parts = [f"  {i}. {goal}"]
                    if conflict:
                        parts.append(f"    冲突: {conflict}")
                    if arc:
                        parts.append(f"    情感弧线: {arc}")
                lines.extend(parts)
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
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        custom_style_config_desc: str = "",
        outline_chapter: dict | None = None,
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
            "genre": _resolve_genre_label(genre),
            "core_contradiction": core_contradiction.get("statement", ""),
            "premise": premise,
            "power_system_name": ps_name,
            "power_system_description": ps_desc,
            "core_rules": core_rules_str,
            "ceilings": ceilings_str,
            "characters_context": self._build_characters_context(characters, scene_plan),
            "chapter_outline_context": self._build_chapter_outline_context(outline_chapter),
            "scene_goal": scene_plan.get("goal", ""),
            "scene_conflict": scene_plan.get("conflict", ""),
            "scene_emotional_arc": scene_plan.get("emotional_arc", ""),
            "scene_narrative_role": scene_plan.get("narrative_role", "setup"),
            "required_logs_list": logs_list,
            "l0_context": l0_context,
            "l1_context": l1_context,
            "l2_context": l2_context,
            "l3_context": l3_context,
            "l4_context": l4_context,
            "growth_stage_hint": growth_stage_hint,
            "character_growth_context": character_growth_context,
            "custom_style_config_desc": custom_style_config_desc,
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
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        reader_os_warnings: str = "",
        custom_style_config=None,
        outline_chapter: Optional[dict] = None,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
            l2_context, l3_context, l4_context, growth_stage_hint,
            character_growth_context,
            custom_style_config_desc=_build_custom_style_desc(custom_style_config),
            outline_chapter=outline_chapter,
        )
        template_vars["reader_os_warnings"] = reader_os_warnings
        template_vars["genre_pacing_scene"] = _resolve_genre_scene_pacing(genre)
        return await self.generate_from_template(
            "scene_writing", **template_vars, **kwargs
        )

    async def write_scene_stream(
        self,
        *,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
        scene_plan: dict,
        l0_context: str = "",
        l1_context: str = "",
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        reader_os_warnings: str = "",
        custom_style_config=None,
        outline_chapter: Optional[dict] = None,
        **kwargs,
    ) -> AsyncIterator[StreamChunk]:
        """Stream version of write_scene().

        Same template-variable assembly as write_scene() — calls _build_base_vars()
        with the same args — but pipes the rendered prompt through
        generate_from_template_stream() instead of generate_from_template().
        """
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
            l2_context, l3_context, l4_context, growth_stage_hint,
            character_growth_context,
            custom_style_config_desc=_build_custom_style_desc(custom_style_config),
            outline_chapter=outline_chapter,
        )
        template_vars["reader_os_warnings"] = reader_os_warnings
        template_vars["genre_pacing_scene"] = _resolve_genre_scene_pacing(genre)
        async for chunk in self.generate_from_template_stream(
            "scene_writing", **template_vars, **kwargs
        ):
            yield chunk

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
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        reader_os_warnings: str = "",
        custom_style_config=None,
        outline_chapter: Optional[dict] = None,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
            l2_context, l3_context, l4_context, growth_stage_hint,
            character_growth_context,
            custom_style_config_desc=_build_custom_style_desc(custom_style_config),
            outline_chapter=outline_chapter,
        )
        template_vars["reader_os_warnings"] = reader_os_warnings
        template_vars["retry_hints"] = retry_hints
        template_vars["previous_draft"] = previous_draft
        return await self.generate_from_template(
            "scene_rewrite", **template_vars, **kwargs
        )

    def submit_exemption_if_conflict(
        self,
        *,
        scene_id: str,
        rule_conflict: dict,
        creative_intent: str,
        expected_effect: str,
        project_dir: Path,
    ) -> Optional[dict]:
        """If Writer detects a rule conflict with a defensible creative intent,
        submit an ExemptionRequest via ExemptionManager. Returns the request dict
        (status=pending) or None if intent is empty.
        """
        from backend.models.exemption import ExemptionManager, ExemptionRequest

        if not creative_intent or not creative_intent.strip():
            return None

        # Deterministic-ish ID from scene + rule_id + epoch ms (low collision risk)
        import time
        req_id = f"ex_{scene_id}_{rule_conflict.get('rule_id', 'unknown')}_{int(time.time() * 1000)}"
        req = ExemptionRequest(
            id=req_id,
            scene_id=scene_id,
            rule_to_break=rule_conflict,
            creative_intent=creative_intent,
            expected_effect=expected_effect,
        )
        mgr = ExemptionManager(Path(project_dir))
        mgr.submit(req)
        return {"id": req.id, "status": req.status, "scene_id": req.scene_id}
