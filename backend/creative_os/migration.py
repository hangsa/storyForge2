"""v3 → v4 canvas_state.json lazy migration.

v3 uses a WhatIfTree model (nodes + edges + selected_path + branch_choices).
v4 uses a 5-step creative path (creative_path[] + root_idea + raw_intent).

Migration is a pure function — it must not mutate the input. Committed v3
projects are migrated in memory only (no write-back, see _read_canvas).
"""
from __future__ import annotations


def _build_root_idea_from_raw_intent(raw_intent: dict) -> dict:
    """Derive root_idea (v4) from raw_intent (v3).

    v4 root_idea is the visual representation; raw_intent remains the
    canonical input contract (see spec §3.6).
    """
    return {
        "prompt": raw_intent.get("prompt", ""),
        "genre": raw_intent.get("genre_primary", ""),
        "premise": raw_intent.get("prompt", ""),
        "extracted": {
            "core_elements": raw_intent.get("trope_tags", []) or [],
            "potential_conflict": "",
        },
    }


def _build_creative_path_from_v3(v3: dict) -> list:
    """Rebuild creative_path from v3 selected_path + nodes + branch_choices.

    Only steps that were actually selected get a creative_path entry. v3
    had no concept of "step type", so operation defaults to "twist" with
    operation_reason="migrated_from_v3".
    """
    selected_path = v3.get("selected_path", [])
    nodes = v3.get("nodes", {})
    branch_choices = v3.get("branch_choices", {})
    creative_path = []
    for i, node_id in enumerate(selected_path):
        node = nodes.get(node_id, {})
        if i == 0:
            opt_id = "option_root"
        else:
            chosen = branch_choices.get(selected_path[i - 1], "unknown")
            opt_id = f"option_{i + 1}_{chosen}"
        creative_path.append({
            "step": i + 1,
            "operation": "twist",
            "operation_reason": "migrated_from_v3",
            "options": [{
                "id": opt_id,
                "title": (node.get("content", "") or "")[:30],
                "premise": node.get("content", ""),
                "logic": "",
                "scores": {"novelty": node.get("novelty_score", 0)},
            }],
            "selected_option_id": opt_id,
            "created_at": node.get("created_at", ""),
            "selected_at": node.get("selected_at", ""),
            "regenerated_count": 0,
            "state": "completed",
        })
    return creative_path


def _build_current_concept_from_v3(v3: dict) -> dict:
    """Build current_concept (v4) from v3 fields.

    For uncommitted canvases, current_concept absorbs core_contradiction.
    For committed canvases, final_concept absorbs it.
    """
    core = v3.get("core_contradiction") or {}
    return {
        "premise": "",
        "core_conflict": core.get("statement", ""),
        "characters": [],
        "world_rules": [],
        "tropes": [],
        "themes": [],
        "novelty": 0.0,
    }


def _migrate_v3_to_v4(canvas: dict) -> dict:
    """Lazy migration. Pure function — does NOT mutate input.

    See spec §3.2 for full field mapping table.
    """
    v3 = canvas
    is_committed = bool(v3.get("committed_at"))
    raw_intent = v3.get("raw_intent") or {}
    core = v3.get("core_contradiction") or {}

    v4 = {
        "schema_version": 4,
        "session_id": v3.get("session_id"),
        "root_idea": _build_root_idea_from_raw_intent(raw_intent),
        "raw_intent": raw_intent,
        "creative_session": {
            "current_step": max(1, len(v3.get("selected_path", []) or [])),
            "max_steps": 5,
            "status": "committed" if is_committed else "active",
        },
        "creative_path": _build_creative_path_from_v3(v3),
        "current_concept": _build_current_concept_from_v3(v3),
        "final_concept": core if is_committed else None,
        "committed": is_committed,
        "committed_at": v3.get("committed_at"),
        "committed_concept_ref": v3.get("committed_concept_ref"),
        "scores": v3.get("novelty_scores") or {},
        "session_metadata": v3.get("session_metadata", {}),
    }
    return v4
