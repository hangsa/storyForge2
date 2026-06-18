"""Trope Pool — 套路模式库 (确定性, 零 LLM)."""

import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import yaml

from backend.models.creative_os import Trope

logger = logging.getLogger(__name__)


class TropePool:
    def __init__(
        self, project_dir: Path, catalog_path: Path, embedder=None
    ) -> None:
        self._project_dir = Path(project_dir)
        self._catalog_path = Path(catalog_path)
        self._embedder = embedder
        self._tropes: dict[str, Trope] = {}
        self._vector_index: Optional[dict[str, np.ndarray]] = None
        self._file = self._project_dir / "creative_os" / "trope_pool.json"
        self._load_or_init()

    def _load_or_init(self) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        if self._file.exists():
            self._load_project_snapshot()
        else:
            self._init_from_catalog()

    def _init_from_catalog(self) -> None:
        with open(self._catalog_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        for item in data.get("tropes", []):
            trope = Trope(
                id=item["id"],
                name=item["name"],
                category=item.get("category", ""),
                description=item.get("description", ""),
                market_saturation=item.get("market_saturation", 0.5),
                sub_tropes=item.get("sub_tropes", []),
                common_combinations=item.get("common_combinations", []),
                novelty_penalty_weight=item.get("novelty_penalty_weight", 1.0),
            )
            self._tropes[trope.id] = trope
        self._save()

    def _load_project_snapshot(self) -> None:
        data = json.loads(self._file.read_text(encoding="utf-8"))
        for item in data:
            trope = Trope(
                id=item["id"],
                name=item["name"],
                category=item.get("category", ""),
                description=item.get("description", ""),
                market_saturation=item.get("market_saturation", 0.5),
                sub_tropes=item.get("sub_tropes", []),
                common_combinations=item.get("common_combinations", []),
                novelty_penalty_weight=item.get("novelty_penalty_weight", 1.0),
            )
            self._tropes[trope.id] = trope

    def _save(self) -> None:
        items = []
        for trope in self._tropes.values():
            items.append({
                "id": trope.id,
                "name": trope.name,
                "category": trope.category,
                "description": trope.description,
                "market_saturation": trope.market_saturation,
                "sub_tropes": trope.sub_tropes,
                "common_combinations": trope.common_combinations,
                "novelty_penalty_weight": trope.novelty_penalty_weight,
            })
        self._file.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get_saturation(self, trope_id: str) -> float:
        trope = self._tropes.get(trope_id)
        return trope.market_saturation if trope else 0.5

    def get_saturation_by_tags(self, tags: list[str]) -> float:
        if not tags:
            return 0.5
        sats = [self.get_saturation(t) for t in tags]
        return sum(sats) / len(sats)

    def match_tropes(self, tags: list[str]) -> list[Trope]:
        results = []
        tags_lower = [t.lower() for t in tags]
        for trope in self._tropes.values():
            name_lower = trope.name.lower()
            if any(t in name_lower for t in tags_lower):
                results.append(trope)
            elif any(t in st.lower() for t in tags_lower for st in trope.sub_tropes):
                if trope not in results:
                    results.append(trope)
        return results

    def list_categories(self) -> list[str]:
        return sorted(set(t.category for t in self._tropes.values()))

    def update_saturation(self, trope_id: str, new_value: float, source: str = "user") -> None:
        trope = self._tropes.get(trope_id)
        if trope is not None:
            trope.market_saturation = max(0.0, min(1.0, new_value))
            self._save()
            logger.info("Trope %s saturation updated to %.2f by %s", trope_id, new_value, source)

    def get_vector_index(self) -> dict[str, np.ndarray]:
        if self._vector_index is not None:
            return self._vector_index

        self._vector_index = {}

        if self._embedder is None or not self._embedder.available:
            return self._vector_index

        for trope in self._tropes.values():
            text = f"{trope.name} {trope.description}"
            embedding = self._embedder.embed([text])
            if embedding.shape[0] > 0:
                self._vector_index[trope.id] = embedding[0]

        return self._vector_index
