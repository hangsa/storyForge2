"""Semantic precheck — detect 3 high-importance SF_LOG types the Writer may have missed.

Runs Tier 3 (Claude Haiku) before Fact Guard. Reports suggestions as info only;
never blocks. Failure modes (LLM unavailable, bad JSON, missing prompt) all
degrade to `precheck_passed=True` with empty suggestions.
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)


# 3 event types the precheck is allowed to suggest. Keep the list tight —
# broadening this drifts toward the LLM-as-judge anti-pattern.
TARGET_EVENT_TYPES = (
    "twist_reveal",
    "registry_create",
    "character_relation_change",
)


@dataclass
class PrecheckSuggestion:
    event_type: str            # one of TARGET_EVENT_TYPES
    location_hint: str         # text span / chapter / scene where the event occurs
    suggested_tag: str         # full SF_LOG tag to insert
    reason: str                # why this event probably happened but wasn't tagged
    type: str = "missing_sf_log"
    severity: str = "suggestion"


@dataclass
class PrecheckResult:
    precheck_passed: bool
    suggestions: list[PrecheckSuggestion] = field(default_factory=list)
    tokens_used: int = 0
    skipped_reason: str = ""   # populated when prechecker short-circuits


class SemanticPrechecker(BaseAgent):
    """Tier-3 SF_LOG miss detector. Never blocks.

    v1.9: inherits `BaseAgent` so the 3-tier prompt override chain
    (YAML → global → project) applies to `semantic_precheck`. The prompt is
    re-read on every `check()` call so plaza edits apply without a restart.
    """

    TARGET_EVENT_TYPES = TARGET_EVENT_TYPES

    def __init__(
        self,
        model_router,
        project_id: str = "",
        prompts_dir: Optional[Path] = None,
        override_store=None,
        global_override_store=None,
    ) -> None:
        super().__init__(
            project_id=project_id,
            prompts_dir=prompts_dir,
            model_router=model_router,
            override_store=override_store,
            global_override_store=global_override_store,
        )

    # --- public ---

    async def check(
        self,
        scene_text: str,
        scene_plan: dict,
        character_names: list[str],
    ) -> PrecheckResult:
        """Inspect scene text for missed SF_LOG tags. Returns suggestions only.

        Async because `_run_llm` awaits the model router — calling from inside
        FastAPI's already-running event loop would otherwise fail.
        """
        if self._router is None:
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="no model_router configured",
            )

        if not scene_text or not scene_text.strip():
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="empty scene text",
            )

        return await self._run_llm(scene_text, scene_plan, character_names)

    async def _run_llm(
        self,
        scene_text: str,
        scene_plan: dict,
        character_names: list[str],
    ) -> PrecheckResult:
        # Truncate to ~500 tokens (~1500 zh chars) — Tier 3 budget.
        snippet = scene_text[:1500]
        declared = scene_plan.get("required_logs", []) if isinstance(scene_plan, dict) else []
        chars_str = "、".join(character_names) if character_names else "（未指定）"
        declared_str = ", ".join(declared) if declared else "（无）"

        # v1.9: load semantic_precheck through the 3-tier override chain
        # (YAML → global → project). Per-call load so plaza edits apply
        # without a process restart.
        try:
            prompt = self.load_prompt("semantic_precheck")
        except FileNotFoundError:
            logger.warning("semantic_precheck prompt not found, skipping")
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="semantic_precheck.yaml not found",
            )

        try:
            user_prompt = prompt.format_user(
            scene_text=snippet,
            declared_changes=declared_str,
            character_names=chars_str,
        )
        except (KeyError, IndexError) as e:
            logger.warning("semantic_precheck template format failed: %s", e)
            return PrecheckResult(precheck_passed=True, skipped_reason=f"template error: {e}")
        messages = [
            {"role": "system", "content": prompt.system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            result_ = await self._router.execute(
                agent_name="reviewer",
                task_name="semantic_precheck",
                messages=messages,
                json_mode=True,
            )
        except Exception as e:
            logger.warning("Semantic precheck LLM call failed: %s", e)
            return PrecheckResult(precheck_passed=True, skipped_reason=f"llm error: {e}")

        content = result_.get("content", "")
        if not content:
            return PrecheckResult(precheck_passed=True, skipped_reason="empty LLM response")

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Semantic precheck returned non-JSON: %r", content[:200])
            return PrecheckResult(precheck_passed=True, skipped_reason="non-JSON response")

        suggestions = self._parse_suggestions(parsed.get("suggestions", []))
        tokens = result_.get("usage", {})
        tokens_used = tokens.get("input", 0) + tokens.get("output", 0)

        return PrecheckResult(
            precheck_passed=len(suggestions) == 0,
            suggestions=suggestions,
            tokens_used=tokens_used,
        )

    def _parse_suggestions(self, raw: list) -> list[PrecheckSuggestion]:
        out: list[PrecheckSuggestion] = []
        if not isinstance(raw, list):
            return out
        for item in raw:
            if not isinstance(item, dict):
                continue
            event_type = item.get("event_type", "")
            if event_type not in self.TARGET_EVENT_TYPES:
                continue  # filter — only the 3 sanctioned types
            out.append(PrecheckSuggestion(
                event_type=event_type,
                location_hint=item.get("location_hint", ""),
                suggested_tag=item.get("suggested_tag", ""),
                reason=item.get("reason", ""),
            ))
        return out
