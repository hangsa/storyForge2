import json
from pathlib import Path
from typing import Optional

from backend.config import settings


class L2WarmMemory:
    """L2 温记忆 — 全书级结构化摘要，约 4K-8K tokens"""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id
        self._l2_dir = self._project_dir / "memory" / "l2"
        self._summaries_dir = self._l2_dir / "chapter_summaries"

    def _ensure_dirs(self):
        self._summaries_dir.mkdir(parents=True, exist_ok=True)

    def _read_json(self, path: Path) -> Optional[dict]:
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_json(self, path: Path, data: dict):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    # --- Chapter summaries ---

    def get_chapter_summaries(
        self, chapter_range: Optional[tuple[int, int]] = None
    ) -> list[dict]:
        self._ensure_dirs()
        summaries = []
        for f in sorted(self._summaries_dir.glob("ch_*_summary.json")):
            data = self._read_json(f)
            if data:
                ch_num = data.get("chapter_number", 0)
                if chapter_range is None or (chapter_range[0] <= ch_num <= chapter_range[1]):
                    summaries.append(data)
        return summaries

    def save_chapter_summary(self, chapter_number: int, summary: dict):
        self._ensure_dirs()
        summary["chapter_number"] = chapter_number
        self._write_json(
            self._summaries_dir / f"ch_{chapter_number}_summary.json",
            summary,
        )

    # --- Relationship graph ---

    def get_relationship_graph(self) -> dict:
        data = self._read_json(self._l2_dir / "relationship_graph.json")
        return data or {"nodes": [], "edges": []}

    def update_relations(self, relation_changes: list[dict]):
        graph = self.get_relationship_graph()
        existing_edges = {
            (e.get("source"), e.get("target")): e for e in graph.get("edges", [])
        }

        for change in relation_changes:
            key = (change.get("char_a"), change.get("char_b"))
            if key in existing_edges:
                existing_edges[key]["status"] = change.get("status", "neutral")
            else:
                graph.setdefault("edges", []).append({
                    "source": change.get("char_a", ""),
                    "target": change.get("char_b", ""),
                    "status": change.get("status", "neutral"),
                    "last_trigger": change.get("trigger", ""),
                })

            # Ensure nodes exist
            node_ids = {n.get("id") for n in graph.get("nodes", [])}
            for node_id in (change.get("char_a"), change.get("char_b")):
                if node_id and node_id not in node_ids:
                    graph.setdefault("nodes", []).append({"id": node_id, "name": node_id})
                    node_ids.add(node_id)

        self._write_json(self._l2_dir / "relationship_graph.json", graph)

    # --- Timeline ---

    def get_timeline(self) -> list[dict]:
        data = self._read_json(self._l2_dir / "timeline.json")
        return data or []

    def update_timeline(self, chapter_number: int, events: list[dict]):
        timeline = self.get_timeline()
        for event in events:
            event["chapter_number"] = chapter_number
            timeline.append(event)
        self._write_json(self._l2_dir / "timeline.json", timeline)

    # --- Active narrative state ---

    def get_active_narrative_state(self) -> dict:
        data = self._read_json(self._l2_dir / "active_narrative_state.json")
        return data or {
            "unresolved_conflicts": [],
            "open_mysteries": [],
            "pending_promises": [],
            "unrevealed_twists": [],
            "active_goals": [],
            "planted_foreshadowings": [],
        }

    def update_active_narrative_state(self, updates: dict):
        state = self.get_active_narrative_state()
        for category, items in updates.items():
            if category in state and isinstance(items, list):
                existing = set(state[category])
                for item in items:
                    if item not in existing:
                        state[category].append(item)
                        existing.add(item)
        self._write_json(self._l2_dir / "active_narrative_state.json", state)

    # --- Full update from chapter summary ---

    def update_from_summary(self, chapter_number: int, summary: dict,
                            sf_logs: Optional[list[dict]] = None):
        self.save_chapter_summary(chapter_number, summary)

        narrative_affected = summary.get("narrative_assets_affected", {})

        # Update timeline from key events
        key_events = summary.get("key_events", [])
        if key_events:
            self.update_timeline(
                chapter_number,
                [{"event": e, "type": "chapter_event"} for e in key_events],
            )

        # Update relationship graph from SF_LOG relation changes
        if sf_logs:
            relation_changes = [
                log.get("params", {})
                for log in sf_logs
                if log.get("type") == "character_relation_change"
            ]
            if relation_changes:
                self.update_relations(relation_changes)

        # Update active narrative state
        state_updates = {
            "unresolved_conflicts": [
                cid for cid in narrative_affected.get("conflicts_escalated", [])
            ],
        }
        self.update_active_narrative_state(state_updates)

    # --- Context string for Writer ---

    def get_context_string(self, max_tokens: int = 8000) -> str:
        parts = []

        # Priority 1: active narrative state
        state = self.get_active_narrative_state()
        if any(state.values()):
            lines = ["【当前叙事状态】"]
            if state.get("unresolved_conflicts"):
                lines.append(f"  未解决冲突: {', '.join(state['unresolved_conflicts'])}")
            if state.get("open_mysteries"):
                lines.append(f"  未解谜团: {', '.join(state['open_mysteries'])}")
            if state.get("pending_promises"):
                lines.append(f"  待兑现承诺: {', '.join(state['pending_promises'])}")
            parts.append("\n".join(lines))

        # Priority 2: recent chapter summaries (last 5)
        summaries = self.get_chapter_summaries()
        recent = summaries[-5:] if len(summaries) > 5 else summaries
        if recent:
            lines = ["【近期章摘要】"]
            for s in recent:
                lines.append(f"  第{s.get('chapter_number', '?')}章: {s.get('summary', '')[:200]}")
            parts.append("\n".join(lines))

        # Priority 3: relationship graph
        graph = self.get_relationship_graph()
        edges = graph.get("edges", [])
        if edges:
            lines = ["【角色关系】"]
            for e in edges[:20]:  # limit to top 20
                lines.append(
                    f"  {e.get('source', '?')} → {e.get('target', '?')}: {e.get('status', 'neutral')}"
                )
            parts.append("\n".join(lines))

        return "\n\n".join(parts)
