"""IdeaPoolImporter — Adapter for idea_variants → IdeaPool.

Used by /mutate and /fuse endpoints to persist generated variants
to the project's IdeaPool (per-project <project>/creative_os/idea_pool.json).
"""

from __future__ import annotations

import json

from backend.creative_os.idea_pool import IdeaPool
from backend.models.creative_os import Idea, IdeaCategory


class IdeaPoolImporter:
    """Adapt idea_variants (PRD §4.2 schema) to Idea dataclass + persist via IdeaPool.add."""

    def __init__(self, pool: IdeaPool):
        self.pool = pool

    def add_batch(self, variants: list[dict], source_stage: str) -> None:
        """Adapt each variant dict to an Idea and persist via pool.add.

        - content: premise_one_line (fallback to title)
        - category: SETTING (ideas from /mutate and /fuse are settings-flavoured)
        - source_stage: caller-supplied tag (e.g., "mutate:inversion", "fuse")
        - source_context: full variant JSON for audit
        - related_elements: trope_tags
        - confidence: estimated_novelty
        """
        for v in variants:
            idea = Idea(
                id=v["id"],
                content=v.get("premise_one_line") or v.get("title", ""),
                category=IdeaCategory.SETTING,
                source_stage=source_stage,
                source_context=json.dumps(v, ensure_ascii=False),
                related_elements=list(v.get("trope_tags") or []),
                confidence=float(v.get("estimated_novelty", 0.0) or 0.0),
            )
            self.pool.add(idea)