"""CharacterDesigner Agent — Growth Workshop discuss (Tier 1)."""

import json
import logging
from pathlib import Path
from typing import Optional

from backend.agents.base_agent import BaseAgent
from backend.growth_curve.workshop.models import WorkshopDiscussResponse

logger = logging.getLogger(__name__)


class CharacterDesigner(BaseAgent):
    agent_name = "character_designer"

    def __init__(
        self,
        project_id: str,
        prompts_dir: Optional[Path] = None,
        model_router=None,
    ):
        super().__init__(project_id=project_id, prompts_dir=prompts_dir, model_router=model_router)

    @staticmethod
    def _stages_text(character: dict) -> str:
        curve = (character.get("growth_curve") or {}).get("stages", [])
        if not curve:
            return "（无成长阶段）"
        lines = []
        for s in curve:
            ch = s.get("bound_chapter") or s.get("chapter_number") or "?"
            lines.append(
                f"- 第{ch}章 {s.get('stage_name', '')} ({s.get('trigger_event_type', '')})"
            )
        return "\n".join(lines)

    @staticmethod
    def _outline_text(outline: dict) -> str:
        chapters = outline.get("chapters", [])
        if not chapters:
            return "（无大纲）"
        lines = [
            f"- 第{ch.get('chapter_number')}章 {ch.get('title', '')}"
            for ch in chapters
        ]
        return "\n".join(lines)

    async def discuss(
        self, *, character: dict, outline: dict, question: str
    ) -> WorkshopDiscussResponse:
        try:
            prompt = self.load_prompt("character_designer/growth_discuss")
            user_prompt = prompt.format_user(
                character_name=character.get("name", ""),
                stages_text=self._stages_text(character),
                outline_text=self._outline_text(outline),
                question=question,
            )
            result = await self.router.execute(
                agent_name=self.agent_name,
                task_name="growth_discuss",
                messages=[
                    {"role": "system", "content": prompt.format_system()},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=prompt.is_json_mode,
                temperature=prompt.temperature,
                max_tokens=prompt.max_tokens,
            )
            content = result.get("content", "")
            if not content:
                return WorkshopDiscussResponse(
                    answer="",
                    suggestions=[],
                    skipped_reason="empty LLM response",
                )
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                # Tolerate non-JSON: treat whole content as the answer
                return WorkshopDiscussResponse(
                    answer=content.strip(), suggestions=[]
                )
            return WorkshopDiscussResponse(
                answer=parsed.get("answer", "").strip(),
                suggestions=list(parsed.get("suggestions", []) or []),
            )
        except Exception as exc:
            return WorkshopDiscussResponse(
                answer="",
                suggestions=[],
                skipped_reason=f"llm error: {type(exc).__name__}: {exc}",
            )
