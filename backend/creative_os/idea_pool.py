"""Idea Pool — 灵感种子库 (确定性, 零 LLM)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.models.creative_os import Idea, IdeaCategory

logger = logging.getLogger(__name__)


class IdeaPool:
    def __init__(self, project_dir: Path) -> None:
        self._file = Path(project_dir) / "creative_os" / "idea_pool.json"
        self._ideas: dict[str, Idea] = {}
        self._ensure_file()

    def _ensure_file(self) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        if not self._file.exists():
            self._file.write_text("[]", encoding="utf-8")
        self._load()

    def _load(self) -> None:
        data = json.loads(self._file.read_text(encoding="utf-8"))
        self._ideas = {}
        for item in data:
            idea = Idea(
                id=item["id"],
                content=item["content"],
                category=IdeaCategory(item["category"]),
                source_stage=item.get("source_stage", ""),
                source_context=item.get("source_context", ""),
                related_elements=item.get("related_elements", []),
                confidence=item.get("confidence", 0.0),
                status=item.get("status", "active"),
                created_at=item.get("created_at", ""),
                updated_at=item.get("updated_at", ""),
            )
            self._ideas[idea.id] = idea

    def _save(self) -> None:
        items = []
        for idea in self._ideas.values():
            items.append({
                "id": idea.id,
                "content": idea.content,
                "category": idea.category.value,
                "source_stage": idea.source_stage,
                "source_context": idea.source_context,
                "related_elements": idea.related_elements,
                "confidence": idea.confidence,
                "status": idea.status,
                "created_at": idea.created_at,
                "updated_at": idea.updated_at,
            })
        self._file.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def add(self, idea: Idea) -> None:
        now = datetime.now(timezone.utc).isoformat()
        idea.created_at = now
        idea.updated_at = now
        self._ideas[idea.id] = idea
        self._save()

    def get(self, idea_id: str) -> Optional[Idea]:
        return self._ideas.get(idea_id)

    def list(
        self,
        category: Optional[IdeaCategory] = None,
        source_stage: Optional[str] = None,
        status: str = "active",
    ) -> list[Idea]:
        results = [i for i in self._ideas.values() if i.status == status]
        if category is not None:
            results = [i for i in results if i.category == category]
        if source_stage is not None:
            results = [i for i in results if i.source_stage == source_stage]
        return results

    def update(self, idea_id: str, **kwargs) -> None:
        idea = self._ideas.get(idea_id)
        if idea is None:
            return
        for key, value in kwargs.items():
            if hasattr(idea, key):
                setattr(idea, key, value)
        idea.updated_at = datetime.now(timezone.utc).isoformat()
        self._save()

    def delete(self, idea_id: str) -> None:
        self._ideas.pop(idea_id, None)
        self._save()

    def promote(self, idea_id: str) -> None:
        # TODO(Phase 2): promote should increase a priority field and/or
        # move the idea into the active StoryDNA context. Currently just
        # sets status="active" (already the default for new ideas).
        self.update(idea_id, status="active")

    def archive(self, idea_id: str) -> None:
        self.update(idea_id, status="archived")

    def filter_by_element(self, element: str) -> list[Idea]:
        return [
            i for i in self._ideas.values()
            if i.status == "active" and element in i.related_elements
        ]
