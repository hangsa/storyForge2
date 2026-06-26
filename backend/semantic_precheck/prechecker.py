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

import yaml

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


class SemanticPrechecker:
    """Tier-3 SF_LOG miss detector. Never blocks."""

    TARGET_EVENT_TYPES = TARGET_EVENT_TYPES

    def __init__(self, model_router) -> None:
        self._router = model_router
        self._prompt = self._load_prompt()

    # --- public ---

    def check(
        self,
        scene_text: str,
        scene_plan: dict,
        character_names: list[str],
    ) -> PrecheckResult:
        """Inspect scene text for missed SF_LOG tags. Returns suggestions only."""
        if self._router is None:
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="no model_router configured",
            )

        if not self._prompt:
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="semantic_precheck.yaml not found",
            )

        if not scene_text or not scene_text.strip():
            return PrecheckResult(
                precheck_passed=True,
                skipped_reason="empty scene text",
            )

        return self._run_llm(scene_text, scene_plan, character_names)

    # --- private ---

    def _load_prompt(self) -> Optional[dict]:
        path = Path("backend/prompts/semantic_precheck.yaml")
        if not path.exists():
            logger.warning("semantic_precheck.yaml not found at %s", path)
            return None
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning("Failed to load semantic_precheck.yaml: %s", e)
            return None
        return {
            "system_prompt": data.get("system_prompt", "").strip(),
            "user_template": data.get("user_prompt_template", "").strip(),
        }

    def _run_llm(
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

        user_prompt = self._prompt["user_template"].format(
            scene_text=snippet,
            declared_changes=declared_str,
            character_names=chars_str,
        )
        messages = [
            {"role": "system", "content": self._prompt["system_prompt"]},
            {"role": "user", "content": user_prompt},
        ]

        try:
            import asyncio
            result_ = asyncio.get_event_loop().run_until_complete(
                self._router.execute(
                    agent_name="reviewer",
                    task_name="semantic_precheck",
                    messages=messages,
                    json_mode=True,
                )
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
