"""Creative Canvas API — WhatIf tree management endpoints.

Provides thin orchestration endpoints for the Creative Canvas frontend:
- GET    /state  — Read canvas_state.json
- POST   /init   — Initialize canvas with root node via WhatIfEngine
- POST   /expand — Expand a node via WhatIfEngine + NoveltyEvaluator + CreativeDirector
- POST   /mutate — Recommend a mutation operation (text recommendation only)
- POST   /apply-mutation — Apply a chosen mutation op, create new sibling node
- POST   /merge  — Placeholder for node merging
- POST   /evaluate — Re-score a node with NoveltyEvaluator
- POST   /select — Update selected_path and get CreativeDirector path evaluation
- POST   /commit — Translate selected_path into concept_and_dna.json via LLM
- POST   /contradict — List contradiction template candidates for a variant (PRD §3.2)
- PUT    /contradict — Confirm/customize a contradiction; write to canvas_state.core_contradiction
- GET    /novelty — List-level 4-dim novelty score across selected_path (PRD §3.5)
- DELETE /state  — Reset the canvas (delete canvas_state.json)
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.models.creative_os import (
    WhatIfNode,
    NoveltyScore,
    ContradictionTemplate,
    BRANCH_STATUS_ACTIVE,
    BRANCH_STATUS_DIMMED,
)
from backend.creative_os.contradiction_engine import ContradictionEngine

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/creative/diverge",
    tags=["creative_diverge"],
)


def _get_fm() -> FileManager:
    """Return a FileManager for the current settings.projects_dir.

    Lazily created so that tests can change settings.projects_dir at runtime
    and the API picks up the new path.
    """
    return FileManager(settings.projects_dir)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_canvas_path(project_id: str) -> Path:
    """Return the path to canvas_state.json for a given project."""
    return settings.projects_dir / project_id / "creative_os" / "canvas_state.json"


def _derive_edges_from_nodes(nodes: dict) -> list:
    """Build the edges array from each node's children_ids.

    Single source of truth: callers populate children_ids when expanding or
    applying mutations; this derives the denormalized edges list at read
    time so the persisted edges array can never drift out of sync.
    """
    edges = []
    for parent_id, node in nodes.items():
        for child_id in node.get("children_ids", []) or []:
            edges.append({"from": parent_id, "to": child_id})
    return edges


def _read_canvas(project_id: str) -> Optional[dict]:
    """Read canvas_state.json. Returns None if not initialized.

    Migrates v1 → v2 → v3 transparently. After any migration, the upgraded
    form is written back atomically so subsequent reads skip the migration
    step.

    Always returns a canvas whose `edges` field reflects the current
    `children_ids` on every node (derived at read time).
    """
    path = _get_canvas_path(project_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        canvas = json.load(f)
    needs_persist = False
    schema_version = canvas.get("schema_version")
    # v1 → v2: pre-v2 schema lacked schema_version=2 tag
    if schema_version != 2 and schema_version != 3:
        canvas = _migrate_v1_to_v2(canvas)
        schema_version = 2
        needs_persist = True
    # v2 → v3: introduce idea_variants / core_contradiction / novelty_scores
    # / raw_intent / session_metadata
    if schema_version == 2:
        canvas = _migrate_v2_to_v3(canvas)
        needs_persist = True
    if needs_persist:
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(canvas, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
    canvas["edges"] = _derive_edges_from_nodes(canvas.get("nodes", {}))
    return canvas


def _write_canvas(project_id: str, data: dict, preserve_committed: bool = False) -> None:
    """Atomically write canvas_state.json after validating invariants.

    Raises CanvasInvariantError if the canvas would violate any of the 6
    branching invariants. The file is left untouched in that case.

    By default this call clears the `committed_at` / `committed_concept_ref`
    marker — any edit (expand, apply-mutation, choose-branch, select) should
    invalidate the "已提交" chip on the frontend. Pass preserve_committed=True
    from /commit itself so the marker the endpoint just stamped survives
    the write.
    """
    try:
        _validate_canvas_invariants(data)
    except CanvasInvariantError as exc:
        logger.error("Refusing to write invalid canvas for %s: %s", project_id, exc)
        raise

    # Keep the persisted edges in sync with children_ids so the file on disk
    # matches what _read_canvas would derive (avoids stale edge lists).
    data["edges"] = _derive_edges_from_nodes(data.get("nodes", {}))

    if not preserve_committed:
        data.pop("committed_at", None)
        data.pop("committed_concept_ref", None)

    path = _get_canvas_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)


def _ensure_project(project_id: str) -> None:
    """Raise 404 if the project does not exist."""
    if not _get_fm().project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )


def _node_to_dict(node: WhatIfNode) -> dict:
    """Serialize a WhatIfNode dataclass to a plain dict."""
    return {
        "id": node.id,
        "depth": node.depth,
        "parent_id": node.parent_id,
        "content": node.content,
        "novelty_score": node.novelty_score,
        "trope_tags": node.trope_tags,
        "saturation_warning": node.saturation_warning,
        "children_ids": list(node.children_ids),
        "is_expanded": node.is_expanded,
        "branch_status": node.branch_status,
        "mutation_context": node.mutation_context,
    }


def _dict_to_node(d: dict) -> WhatIfNode:
    """Deserialize a dict back to a WhatIfNode dataclass."""
    return WhatIfNode(
        id=d["id"],
        depth=d["depth"],
        parent_id=d.get("parent_id"),
        content=d.get("content", ""),
        novelty_score=d.get("novelty_score", 0.0),
        trope_tags=list(d.get("trope_tags", [])),
        saturation_warning=d.get("saturation_warning"),
        children_ids=list(d.get("children_ids", [])),
        is_expanded=d.get("is_expanded", False),
        branch_status=d.get("branch_status", BRANCH_STATUS_ACTIVE),
        mutation_context=d.get("mutation_context"),
    )


def _compute_depth_distribution(nodes: dict) -> dict:
    """Compute count of nodes at each depth level."""
    dist = {}
    for node in nodes.values():
        d = str(node.get("depth", 0))
        dist[d] = dist.get(d, 0) + 1
    return dist


def _delete_canvas(project_id: str) -> bool:
    """Delete canvas_state.json for a project. Returns True if deleted."""
    path = _get_canvas_path(project_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def _migrate_v1_to_v2(canvas: dict) -> dict:
    """One-shot migration from v1 (dimension-tagged facets) to v2 (multi-branch).

    Idempotent: passing a v2 canvas through returns it unchanged.

    Steps:
        1. Preserve created_at/updated_at/edges/evaluations
        2. Drop the dimension field on every node
        3. Add branch_status="active" to every node
        4. Rebuild branch_choices from selected_path adjacency
        5. Tag schema_version=2
    """
    if canvas.get("schema_version") == 2:
        return canvas

    migrated = {
        "schema_version": 2,
        "root_node_id": canvas.get("root_node_id"),
        "nodes": {},
        "edges": list(canvas.get("edges", [])),
        "selected_path": list(canvas.get("selected_path", [])),
        "branch_choices": {},
        "evaluations": dict(canvas.get("evaluations", {})),
        "created_at": canvas.get("created_at"),
        "updated_at": canvas.get("updated_at"),
    }

    for nid, node in canvas.get("nodes", {}).items():
        new_node = {k: v for k, v in node.items() if k != "dimension"}
        new_node["branch_status"] = BRANCH_STATUS_ACTIVE
        migrated["nodes"][nid] = new_node

    # Rebuild branch_choices: walk selected_path as parent->child pairs.
    path = migrated["selected_path"]
    for i in range(len(path) - 1):
        parent, child = path[i], path[i + 1]
        parent_node = migrated["nodes"].get(parent, {})
        if child in parent_node.get("children_ids", []):
            migrated["branch_choices"][parent] = child

    return migrated


def _migrate_v2_to_v3(canvas: dict) -> dict:
    """One-shot migration from v2 to v3 schema.

    v3 introduces:
      - idea_variants: list of {id, title, premise_one_line, mutation_type,
        mutation_logic, estimated_novelty, trope_tags, regenerated_count}
        extracted from nodes with a non-empty mutation_context.mut.
      - core_contradiction: None (will be filled by /commit when LLM completes)
      - novelty_scores: None (will be filled by S0-D / WhatIf expansion)
      - raw_intent: None (user must re-supply via S0-A; v2 had no equivalent)
      - session_metadata: {created_at, last_modified_at, elapsed_seconds,
        operation_count, ab_test_bucket}

    Idempotent: passing a v3 canvas through returns it unchanged.
    """
    if canvas.get("schema_version") == 3:
        return canvas

    idea_variants = []
    for node in (canvas.get("nodes") or {}).values():
        mc = node.get("mutation_context") or {}
        if mc.get("mut"):
            idea_variants.append({
                "id": node["id"],
                "title": (node.get("content") or "")[:20],
                "premise_one_line": node.get("content") or "",
                "mutation_type": mc.get("mut"),
                "mutation_logic": mc.get("logic", ""),
                "estimated_novelty": float(node.get("novelty_score") or 0.0),
                "trope_tags": list(node.get("trope_tags") or []),
                "regenerated_count": 0,
            })

    canvas["idea_variants"] = idea_variants
    canvas["core_contradiction"] = None
    canvas["novelty_scores"] = None
    canvas["raw_intent"] = None
    canvas["session_metadata"] = {
        "created_at": canvas.get("created_at", ""),
        "last_modified_at": canvas.get("updated_at", ""),
        "elapsed_seconds": 0,
        "operation_count": 0,
        "ab_test_bucket": "control",
    }
    canvas["schema_version"] = 3
    return canvas


class CanvasInvariantError(Exception):
    """Raised when canvas_state.json violates one of the 6 invariants."""


def _compute_selected_path(nodes: dict, branch_choices: dict,
                           root_id: str) -> list[str]:
    """Walk branch_choices from root, returning the active linear chain.

    Stops when no branch_choices entry exists for the current node, or when
    the chosen child is missing from the parent's children_ids (defensive).
    """
    path = [root_id]
    cursor = root_id
    while cursor in branch_choices:
        nxt = branch_choices[cursor]
        parent_node = nodes.get(cursor, {})
        if nxt not in parent_node.get("children_ids", []):
            break
        path.append(nxt)
        cursor = nxt
    return path


def _validate_canvas_invariants(canvas: dict) -> None:
    """Enforce the 6 branching invariants. Raises CanvasInvariantError on violation.

    Invariants:
        1. Every expanded node has a branch_choices entry.
        2. selected_path is a valid linear chain.
        3. selected_path nodes are all branch_status="active".
        4. branch_choices values point to real children.
        5. dimmed nodes' descendants are all dimmed.
        6. root_node is active.
    """
    nodes = canvas.get("nodes", {})
    branch_choices = canvas.get("branch_choices", {})
    selected_path = canvas.get("selected_path", [])
    root_id = canvas.get("root_node_id")

    # Invariant 6: root is active
    root_node = nodes.get(root_id, {})
    if root_node.get("branch_status") != BRANCH_STATUS_ACTIVE:
        raise CanvasInvariantError(
            f"Invariant 6 violated: root {root_id} must be active"
        )

    # Invariant 1: expanded active nodes have branch_choices.
    #    Dimmed+expanded nodes don't need one — they're off the active path
    #    and their children are all dimmed (invariant 5).
    for nid, node in nodes.items():
        if (node.get("is_expanded")
                and node.get("children_ids")
                and node.get("branch_status") == BRANCH_STATUS_ACTIVE):
            if nid not in branch_choices:
                raise CanvasInvariantError(
                    f"Invariant 1 violated: expanded active node {nid} "
                    f"missing from branch_choices"
                )

    # Invariant 4: branch_choices point to real children
    for parent_id, child_id in branch_choices.items():
        parent_node = nodes.get(parent_id, {})
        if child_id not in parent_node.get("children_ids", []):
            raise CanvasInvariantError(
                f"Invariant 4 violated: {parent_id}'s chosen child "
                f"{child_id} is not in children_ids"
            )

    # Invariant 2: selected_path is linear chain
    if not selected_path:
        raise CanvasInvariantError("Invariant 2 violated: empty selected_path (not a linear chain)")
    if selected_path[0] != root_id:
        raise CanvasInvariantError(
            f"Invariant 2 violated: selected_path starts with "
            f"{selected_path[0]}, expected {root_id} (not a linear chain)"
        )
    for i in range(len(selected_path) - 1):
        cur, nxt = selected_path[i], selected_path[i + 1]
        cur_node = nodes.get(cur, {})
        if nxt not in cur_node.get("children_ids", []):
            raise CanvasInvariantError(
                f"Invariant 2 violated: {nxt} not in {cur}'s children (not a linear chain)"
            )

    # Invariant 3: selected_path nodes all active
    for nid in selected_path:
        if nodes.get(nid, {}).get("branch_status") != BRANCH_STATUS_ACTIVE:
            raise CanvasInvariantError(
                f"Invariant 3 violated: {nid} on selected_path is dimmed (not active)"
            )

    # Invariant 5: dimmed nodes have all-dimmed descendants
    dimmed_set = {nid for nid, n in nodes.items() if n.get("branch_status") == BRANCH_STATUS_DIMMED}
    for dimmed_id in dimmed_set:
        dimmed_node = nodes[dimmed_id]
        for child_id in dimmed_node.get("children_ids", []):
            child = nodes.get(child_id, {})
            if child.get("branch_status") != BRANCH_STATUS_DIMMED:
                raise CanvasInvariantError(
                    f"Invariant 5 violated: {child_id} (child of dimmed "
                    f"{dimmed_id}) is not dimmed"
                )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _build_trope_extraction_llm_client() -> Optional[Any]:
    """Construct a Tier 3 LLM client for trope_extraction.

    Returns None on any failure (no API key, unknown provider, no
    matching model in model_tiers.yaml) — /init then skips the background
    extraction silently. Best-effort by design: a missing LLM must not
    break the user's /init flow.
    """
    try:
        from backend.llm.model_router import get_model_router

        router = get_model_router()
        decision = router.resolve(
            agent_name="creative_director",
            task_name="trope_extraction",
        )
        model_info = router._find_model_info(decision.model_id)
        if model_info is None:
            return None
        provider = router._create_provider_for_model(model_info)
        return provider
    except Exception as exc:
        logger.info("No LLM available for trope extraction: %s", exc)
        return None


# Module-level set that holds fire-and-forget trope-extraction tasks. Without
# a strong reference, asyncio.create_task's coroutine may be garbage-collected
# before its first await under specific event-loop timing (per Python docs).
# Mirrors the project's existing pattern in backend/conductor/autopilot_loop.py
# (self._tasks[project_id] = task). Each task removes itself on completion.
_background_trope_tasks: set[asyncio.Task] = set()


def _save_raw_intent_trope_tags(project_id: str, raw_intent: Optional[dict] = None) -> None:
    """Persist canvas["raw_intent"] (with the freshly-extracted trope_tags)
    back to canvas_state.json. Used as the save_callback for the fire-and-
    forget fill_trope_tags_async task — `raw_intent` is the same dict that
    fill_trope_tags_async mutated, so its in-place trope_tags update is
    what we want to write.

    Performs an atomic targeted update: load → mutate ONLY raw_intent → write.
    Avoids the read-modify-write race that would otherwise overwrite concurrent
    writes from /expand, /choose-branch, /apply-mutation, etc. — we touch only
    `canvas["raw_intent"]` and never re-stamp nodes / branch_choices / updated_at.

    Also passes preserve_committed=True: this is a METADATA-ONLY backfill and
    must NOT invalidate the /commit stamp. The fire-and-forget task fires
    immediately after /init; users typically call /commit within 1-3 seconds,
    and without preserve_committed the commit marker would be silently erased
    once the background task completes (regression: see commit 2569bee review).

    Best-effort by design: a stale read between _read_canvas and _write_canvas
    still leaves a narrow loss-of-update window against concurrent writers
    touching non-raw_intent fields. Full file-level locking / CRDT is out of
    scope — this is the same best-effort guarantee the rest of the canvas
    write path offers.

    If raw_intent is None (callback fired without an arg), this is a no-op.
    """
    if raw_intent is None:
        return
    try:
        canvas = _read_canvas(project_id)
        if canvas is None:
            return
        canvas["raw_intent"] = raw_intent
        _write_canvas(project_id, canvas, preserve_committed=True)
    except Exception as exc:
        logger.warning("Failed to persist trope tags for %s: %s", project_id, exc)


@router.get("/state")
async def get_canvas_state(project_id: str):
    """Read the current canvas state. Returns empty skeleton if not initialized."""
    _ensure_project(project_id)
    canvas = _read_canvas(project_id)
    if canvas is None:
        return {
            "error": False,
            "code": "OK",
            "message": "画布尚未初始化",
            "detail": {
                "root_node_id": None,
                "nodes": {},
                "edges": [],
                "selected_path": [],
            },
        }
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": canvas,
    }


@router.post("/init")
async def init_canvas(project_id: str, data: dict):
    """Initialize the canvas with a root WhatIf node derived from `premise`.

    Request body:
        {"premise": "一个关于永生者寻找死亡方法的故事"}

    Side effect: spawns a fire-and-forget Tier 3 LLM call to extract Trope
    tags for the canvas's raw_intent. Tags are written back to
    canvas_state.json so the next /novelty call uses a real
    market_saturation score instead of the 50.0 fallback (PRD §3.5).
    """
    _ensure_project(project_id)

    premise = data.get("premise", "")
    if not premise:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "premise 不能为空",
                "detail": {},
            },
        )

    from backend.creative_os.whatif_engine import WhatIfEngine

    engine = WhatIfEngine()
    root_node = engine.generate_root(premise)

    now = datetime.now(timezone.utc).isoformat()
    canvas = {
        "schema_version": 3,
        "root_node_id": root_node.id,
        "nodes": {root_node.id: _node_to_dict(root_node)},
        "edges": [],
        "selected_path": [root_node.id],
        "branch_choices": {},
        "evaluations": {},
        "created_at": now,
        "updated_at": now,
        "idea_variants": [],
        "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": premise, "trope_tags": []},
        "session_metadata": {
            "created_at": now,
            "last_modified_at": now,
            "elapsed_seconds": 0,
            "operation_count": 0,
            "ab_test_bucket": "control",
        },
    }
    _write_canvas(project_id, canvas)

    # Fire-and-forget Tier 3 Trope extraction. Best-effort; failures are
    # logged but never surface to the /init caller.
    try:
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        evaluator = NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=ContradictionEngine(),
            model_router=None,
            embedder=None,
        )

        llm_client = _build_trope_extraction_llm_client()
        if llm_client is not None:
            raw_intent_ref = canvas["raw_intent"]
            task = asyncio.create_task(
                evaluator.fill_trope_tags_async(
                    raw_intent=raw_intent_ref,
                    llm_client=llm_client,
                    save_callback=lambda ri: _save_raw_intent_trope_tags(project_id, ri),
                )
            )
            # Hold a strong reference; otherwise the task may be GC'd before
            # its first await under specific event-loop timing. The
            # add_done_callback drops it once the task is finished.
            _background_trope_tasks.add(task)
            task.add_done_callback(_background_trope_tasks.discard)
    except Exception as exc:
        logger.warning("Could not schedule trope extraction for %s: %s", project_id, exc)

    return {
        "error": False,
        "code": "OK",
        "message": "画布初始化成功",
        "detail": canvas,
    }


@router.post("/expand")
async def expand_node(project_id: str, data: dict):
    """Expand a WhatIf node into BREADTH children.

    Request body:
        {"node_id": "wi_001_00"}

    Orchestrates: WhatIfEngine.expand_node() -> NoveltyEvaluator ->
    CreativeDirector.suggest_direction().

    If the LLM backend is not available (NotImplementedError), returns an
    empty children list gracefully so the frontend can show an appropriate
    message.
    """
    _ensure_project(project_id)

    node_id = data.get("node_id", "")
    if not node_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "node_id 不能为空",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    if node_id not in canvas["nodes"]:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "NODE_NOT_FOUND",
                "message": f"节点 {node_id} 不存在",
                "detail": {},
            },
        )

    node = _dict_to_node(canvas["nodes"][node_id])

    if node.branch_status != BRANCH_STATUS_ACTIVE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "DIMMED_NODE_CANNOT_EXPAND",
                "message": f"节点 {node_id} 已被弃选，无法展开",
                "detail": {},
            },
        )

    # --- Step 1: expand via WhatIfEngine --------------------------------
    from backend.creative_os.whatif_engine import WhatIfEngine

    children = []
    try:
        from backend.llm.model_router import get_model_router

        model_router = get_model_router()
        engine = WhatIfEngine(model_router=model_router)
    except Exception:
        engine = WhatIfEngine()

    # Seed the engine's per-depth counter from existing canvas IDs so
    # expanding a sibling of an already-expanded node doesn't regenerate
    # colliding IDs (wi_2_001_00 etc.) and overwrite the prior subtree.
    engine.seed_counter_from_ids(canvas.get("nodes", {}).keys())

    try:
        # Build ancestor chain (root → ... → parent) for narrative continuity.
        # Cap hops at MAX_ANCESTOR_HOPS to prevent infinite loops on cyclic state.
        ancestor_contents: list[str] = []
        MAX_ANCESTOR_HOPS = 16
        try:
            cursor = node
            hops = 0
            while cursor.parent_id and hops < MAX_ANCESTOR_HOPS:
                parent_dict = canvas["nodes"].get(cursor.parent_id)
                if not parent_dict:
                    break
                ancestor_contents.insert(0, parent_dict.get("content", ""))
                cursor = WhatIfNode(
                    id=parent_dict["id"],
                    depth=parent_dict["depth"],
                    parent_id=parent_dict.get("parent_id"),
                    content=parent_dict.get("content", ""),
                )
                hops += 1
            if hops >= MAX_ANCESTOR_HOPS:
                logger.warning(
                    "Ancestor walk hit hop cap %d for node %s; truncating chain",
                    MAX_ANCESTOR_HOPS, node_id,
                )
        except (KeyError, TypeError) as exc:
            logger.warning(
                "Canvas state corrupt while building ancestor chain for %s: %s",
                node_id, exc,
            )
            ancestor_contents = []
        children = await engine.expand_node(node, ancestor_contents=ancestor_contents)
    except NotImplementedError:
        logger.info("WhatIfEngine.expand_node not available (no LLM backend)")
        children = []
    except Exception as exc:
        logger.warning("expand_node failed for node %s: %s", node_id, exc)
        children = []

    # --- Step 2: score children with NoveltyEvaluator --------------------
    scores = {}
    try:
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        contradiction_engine = ContradictionEngine()
        evaluator = NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=contradiction_engine,
            model_router=None,
            embedder=None,
        )
        for child in children:
            score = evaluator.evaluate_node(child)
            scores[child.id] = {
                "total": score.total,
                "market_saturation_score": score.market_saturation_score,
                "trope_similarity_score": score.trope_similarity_score,
                "contradiction_depth_score": score.contradiction_depth_score,
                "discussion_potential_score": score.discussion_potential_score,
                "grade": score.grade,
            }
            child.novelty_score = score.total
    except Exception as exc:
        logger.warning("NoveltyEvaluator unavailable: %s", exc)

    # --- Step 3: persist new children & update parent --------------------
    for child in children:
        canvas["nodes"][child.id] = _node_to_dict(child)
    canvas["nodes"][node_id] = _node_to_dict(node)

    # Set the chosen child for this expansion (the first child becomes active
    # until the user picks another via /choose-branch). The other children
    # default to dimmed — invariant 5 requires a dimmed node's children to
    # all be dimmed, and only one child should be on the active path.
    branch_choices = canvas.setdefault("branch_choices", {})
    if node_id not in branch_choices and children:
        branch_choices[node_id] = children[0].id
        for child in children[1:]:
            child.branch_status = BRANCH_STATUS_DIMMED
            canvas["nodes"][child.id]["branch_status"] = BRANCH_STATUS_DIMMED

    # Recompute selected_path
    canvas["selected_path"] = _compute_selected_path(
        canvas["nodes"], branch_choices, canvas["root_node_id"]
    )

    # --- Step 4: get suggestion from CreativeDirector --------------------
    suggestion = ""
    try:
        from backend.agents.creative_director import CreativeDirector
        from backend.services.agent_prompt_stores import (
            project_override_store,
            global_override_store,
        )

        project = _get_fm().read_json(project_id, "project.json") or {}
        director = CreativeDirector(
            project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
            genre=project.get("genre", "cool_novel"),
        )
        canvas_stats = {
            "total_nodes": len(canvas["nodes"]),
            "depth_distribution": _compute_depth_distribution(canvas["nodes"]),
            "active_count": sum(
                1 for n in canvas["nodes"].values()
                if n.get("branch_status") == BRANCH_STATUS_ACTIVE
            ),
            "max_score": max(
                (n.get("novelty_score", 0) for n in canvas["nodes"].values()),
                default=0,
            ),
            "min_score": min(
                (n.get("novelty_score", 0) for n in canvas["nodes"].values()),
                default=0,
            ),
        }
        suggestion = await director.suggest_direction(node, canvas_stats)
    except Exception as exc:
        logger.warning("CreativeDirector.suggest_direction failed: %s", exc)
        suggestion = ""

    canvas["updated_at"] = datetime.utcnow().isoformat()
    _write_canvas(project_id, canvas)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "nodes": {c.id: _node_to_dict(c) for c in children},
            "scores": scores,
            "suggestion": suggestion,
        },
    }


@router.post("/mutate")
async def mutate_node(project_id: str, data: dict):
    """Recommend a mutation operation for a node.

    Request body:
        {"node_id": "wi_001_00"}

    Returns a 30-80 char text recommendation from CreativeDirector describing
    which mutation op (Inversion/Fusion/Escalation/Subversion) would best
    transform this node's trope. The frontend uses this to preview options;
    the actual application happens via /apply-mutation.
    """
    _ensure_project(project_id)

    node_id = data.get("node_id", "")
    if not node_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "node_id 不能为空",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    if node_id not in canvas["nodes"]:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "NODE_NOT_FOUND",
                "message": f"节点 {node_id} 不存在",
                "detail": {},
            },
        )

    node = _dict_to_node(canvas["nodes"][node_id])

    if node.branch_status != BRANCH_STATUS_ACTIVE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "DIMMED_NODE_CANNOT_MUTATE",
                "message": f"节点 {node_id} 已被弃选，无法分析变异",
                "detail": {},
            },
        )

    recommendation = ""
    try:
        from backend.agents.creative_director import CreativeDirector
        from backend.services.agent_prompt_stores import (
            project_override_store,
            global_override_store,
        )

        project = _get_fm().read_json(project_id, "project.json") or {}
        director = CreativeDirector(
            project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
            genre=project.get("genre", "cool_novel"),
        )
        recommendation = await director.recommend_mutation(node)
    except Exception as exc:
        logger.warning("recommend_mutation failed: %s", exc)
        recommendation = ""

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {"recommendation": recommendation},
    }


@router.post("/apply-mutation")
async def apply_mutation(project_id: str, data: dict):
    """Apply a mutation operation and create a new sibling node.

    Request body:
        {"node_id": "wi_001_00", "operation": "inversion"}

    Effect:
        - Runs MutationEngine.mutate() with the synthetic Trope built from
          the node's content + trope_tags
        - Creates a new WhatIfNode as a SIBLING of the original (same parent)
        - Sets the new node as the parent's chosen branch (active)
        - Marks the original node and its descendants as dimmed
        - Updates branch_choices and recomputes selected_path

    Operations: inversion | escalation | subversion | fusion
    (Fusion requires a second node and is not yet supported here — use
    the placeholder /merge endpoint for cross-node fusion.)
    """
    _ensure_project(project_id)

    node_id = data.get("node_id", "")
    operation = data.get("operation", "")
    if not node_id or not operation:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "node_id 和 operation 都不能为空",
                "detail": {},
            },
        )

    from backend.models.creative_os import MutationOp
    try:
        mutation_op = MutationOp(operation)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_OPERATION",
                "message": f"不支持的变异操作: {operation}",
                "detail": {"valid": [op.value for op in MutationOp]},
            },
        )

    if mutation_op == MutationOp.FUSION:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "FUSION_NOT_SUPPORTED",
                "message": "融合需要两个节点，请使用 /merge 端点",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    nodes = canvas.get("nodes", {})
    if node_id not in nodes:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "NODE_NOT_FOUND",
                "message": f"节点 {node_id} 不存在",
                "detail": {},
            },
        )

    node = _dict_to_node(nodes[node_id])

    if node.branch_status != BRANCH_STATUS_ACTIVE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "DIMMED_NODE_CANNOT_MUTATE",
                "message": f"节点 {node_id} 已被弃选，无法应用变异",
                "detail": {},
            },
        )

    if not node.parent_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "ROOT_CANNOT_MUTATE",
                "message": "根节点无法被变异（无父节点可挂载新兄弟）",
                "detail": {},
            },
        )

    # --- Step 1: build synthetic Trope from node --------------------------
    from backend.models.creative_os import Trope
    synthetic_trope = Trope(
        id=f"synthetic_{node.id}",
        name=(node.trope_tags[0] if node.trope_tags else node.content[:20]),
        category="web_novel",
        description=node.content,
        market_saturation=0.5,
    )

    # --- Step 2: run MutationEngine --------------------------------------
    from backend.creative_os.mutation_engine import MutationEngine
    from backend.llm.model_router import get_model_router

    try:
        router = get_model_router()
        engine = MutationEngine(model_router=router)
    except Exception:
        engine = MutationEngine()

    try:
        mutation_result = await engine.mutate(synthetic_trope, mutation_op, context=node.content)
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_BACKEND_UNAVAILABLE",
                "message": f"变异功能需要 LLM 后端支持：{exc}",
                "detail": {},
            },
        )
    except Exception as exc:
        logger.warning("MutationEngine.mutate failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error": True,
                "code": "MUTATION_FAILED",
                "message": f"变异生成失败：{exc}",
                "detail": {},
            },
        )

    # --- Step 3: build new WhatIfNode ------------------------------------
    # Use mutation_result.core_premise as the new node's content.
    # Tag it with the operation for traceability. Stash the full
    # mutation_result on mutation_context so /commit can pass it to the LLM.
    new_id = f"mu_{uuid.uuid4().hex[:8]}"
    new_node = WhatIfNode(
        id=new_id,
        depth=node.depth,
        parent_id=node.parent_id,
        content=mutation_result.core_premise or f"（{operation} 变异后的节点）",
        novelty_score=0.0,
        trope_tags=[f"mut:{operation}"] + list(node.trope_tags),
        saturation_warning=None,
        children_ids=[],
        is_expanded=False,
        branch_status=BRANCH_STATUS_ACTIVE,
        mutation_context={
            "operation": mutation_result.operation.value,
            "source_trope_id": mutation_result.source_trope_id,
            "core_premise": mutation_result.core_premise,
            "core_conflict": mutation_result.core_conflict,
            "novelty_hook": mutation_result.novelty_hook,
            "self_consistency_check": mutation_result.self_consistency_check,
        },
    )

    # --- Step 4: insert into canvas --------------------------------------
    parent = nodes[node.parent_id]
    new_children = list(parent["children_ids"]) + [new_id]
    parent["children_ids"] = new_children
    nodes[new_id] = _node_to_dict(new_node)

    # --- Step 5: update branch_choices & mark old subtree dimmed ---------
    branch_choices = canvas.setdefault("branch_choices", {})
    previous_active_id = branch_choices.get(node.parent_id)
    branch_choices[node.parent_id] = new_id

    def _collect_descendants(node_id_str: str) -> set[str]:
        result = set()
        stack = [node_id_str]
        while stack:
            cur = stack.pop()
            cur_node = nodes.get(cur, {})
            for child_id in cur_node.get("children_ids", []):
                if child_id not in result:
                    result.add(child_id)
                    stack.append(child_id)
        return result

    # Dim original node + its descendants (invariant 5)
    nodes[node_id]["branch_status"] = BRANCH_STATUS_DIMMED
    for desc_id in _collect_descendants(node_id):
        nodes[desc_id]["branch_status"] = BRANCH_STATUS_DIMMED

    # Drop branch_choices that pointed into the now-dimmed subtree
    if previous_active_id and previous_active_id != new_id:
        for pid, cid in list(branch_choices.items()):
            if pid == node.parent_id:
                continue
            cur = cid
            visited = set()
            drop = False
            while cur and cur not in visited:
                visited.add(cur)
                if nodes.get(cur, {}).get("branch_status") == BRANCH_STATUS_DIMMED:
                    drop = True
                    break
                cur = nodes.get(cur, {}).get("parent_id")
            if drop:
                del branch_choices[pid]

    # --- Step 6: recompute selected_path & validate ----------------------
    canvas["selected_path"] = _compute_selected_path(
        nodes, branch_choices, canvas["root_node_id"]
    )

    try:
        _validate_canvas_invariants(canvas)
    except CanvasInvariantError as exc:
        logger.error("Canvas invariants failed after apply-mutation: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error": True,
                "code": "INVARIANT_VIOLATION",
                "message": str(exc),
                "detail": {},
            },
        )

    canvas["updated_at"] = datetime.utcnow().isoformat()
    _write_canvas(project_id, canvas)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "new_node": _node_to_dict(new_node),
            "mutation_result": {
                "operation": mutation_result.operation.value,
                "source_trope_id": mutation_result.source_trope_id,
                "core_premise": mutation_result.core_premise,
                "core_conflict": mutation_result.core_conflict,
                "novelty_hook": mutation_result.novelty_hook,
                "self_consistency_check": mutation_result.self_consistency_check,
                "tokens_used": mutation_result.tokens_used,
            },
            "dimmed_count": 1 + len(_collect_descendants(node_id)),
        },
    }


@router.post("/merge")
async def merge_nodes(project_id: str, data: dict):
    """Placeholder: merge two WhatIf nodes into a new hybrid node.

    Request body:
        {"node_id_a": "wi_001_00", "node_id_b": "wi_002_00"}

    Requires full LLM backend integration.
    """
    _ensure_project(project_id)
    return {
        "error": False,
        "code": "OK",
        "message": "融合功能需要 LLM 后端支持，当前为占位实现",
        "detail": {},
    }


@router.post("/evaluate")
async def evaluate_node(project_id: str, data: dict):
    """Re-score a node with the NoveltyEvaluator.

    Request body:
        {"node_id": "wi_001_00"}

    Returns the full 4-dimension score breakdown.
    """
    _ensure_project(project_id)

    node_id = data.get("node_id", "")
    if not node_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "node_id 不能为空",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    if node_id not in canvas["nodes"]:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "NODE_NOT_FOUND",
                "message": f"节点 {node_id} 不存在",
                "detail": {},
            },
        )

    node = _dict_to_node(canvas["nodes"][node_id])

    try:
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        contradiction_engine = ContradictionEngine()
        evaluator = NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=contradiction_engine,
            model_router=None,
            embedder=None,
        )
        score = evaluator.evaluate_node(node)

        return {
            "error": False,
            "code": "OK",
            "message": "",
            "detail": {
                "total": score.total,
                "market_saturation_score": score.market_saturation_score,
                "trope_similarity_score": score.trope_similarity_score,
                "contradiction_depth_score": score.contradiction_depth_score,
                "discussion_potential_score": score.discussion_potential_score,
                "grade": score.grade,
            },
        }
    except Exception as exc:
        logger.warning("NoveltyEvaluator failed for node %s: %s", node_id, exc)
        return {
            "error": False,
            "code": "OK",
            "message": "新颖度评估暂不可用",
            "detail": {
                "total": 0.0,
                "market_saturation_score": 0.0,
                "trope_similarity_score": 0.0,
                "contradiction_depth_score": 0.0,
                "discussion_potential_score": 0.0,
                "grade": "未知",
            },
        }


@router.post("/select")
async def select_path(project_id: str, data: dict):
    """Update the canvas selected_path and get a CreativeDirector path evaluation.

    Request body:
        {"path_node_ids": ["wi_001_00", "wi_002_00", "wi_003_00"]}

    Validates that all IDs exist in the canvas, persists the updated path,
    and returns a narrative evaluation of the path.
    """
    _ensure_project(project_id)

    path_node_ids = data.get("path_node_ids", [])
    if not path_node_ids:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "path_node_ids 不能为空",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    # Validate every node ID exists AND is active
    for nid in path_node_ids:
        if nid not in canvas["nodes"]:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": True,
                    "code": "NODE_NOT_FOUND",
                    "message": f"节点 {nid} 不存在",
                    "detail": {},
                },
            )
        if canvas["nodes"][nid].get("branch_status") != BRANCH_STATUS_ACTIVE:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": True,
                    "code": "DIMMED_NODE_IN_PATH",
                    "message": f"路径包含未选节点 {nid}",
                    "detail": {},
                },
            )

    # Persist selected path
    canvas["selected_path"] = list(path_node_ids)
    canvas["updated_at"] = datetime.utcnow().isoformat()

    # Get path evaluation from CreativeDirector
    evaluation = ""
    try:
        from backend.agents.creative_director import CreativeDirector
        from backend.services.agent_prompt_stores import (
            project_override_store,
            global_override_store,
        )

        project = _get_fm().read_json(project_id, "project.json") or {}
        director = CreativeDirector(
            project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
            genre=project.get("genre", "cool_novel"),
        )
        path_nodes = [
            _dict_to_node(canvas["nodes"][nid]) for nid in path_node_ids
        ]
        evaluation = await director.evaluate_path(path_nodes)
    except Exception as exc:
        logger.warning("CreativeDirector.evaluate_path failed: %s", exc)
        evaluation = ""

    # Persist evaluation keyed by path hash, bounding to last 20 entries
    path_hash = "::".join(path_node_ids)
    evaluations = canvas.setdefault("evaluations", {})
    evaluations[path_hash] = {
        "evaluation": evaluation,
        "evaluated_at": datetime.utcnow().isoformat(),
    }
    if len(evaluations) > 20:
        sorted_keys = sorted(evaluations, key=lambda k: evaluations[k]["evaluated_at"])
        for k in sorted_keys[: len(evaluations) - 20]:
            del evaluations[k]

    _write_canvas(project_id, canvas)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "selected_path": path_node_ids,
            "evaluation": evaluation,
            "evaluated_at": evaluations[path_hash]["evaluated_at"],
        },
    }


@router.post("/choose-branch")
async def choose_branch(project_id: str, data: dict):
    """Switch the active branch under a parent node.

    Request body:
        {"parent_node_id": "wi_001_00", "chosen_child_id": "wi_001_02"}

    Effect:
        - Updates branch_choices[parent_node_id] = chosen_child_id
        - Sets chosen_child_id.branch_status = "active"
        - Sets parent's other children to "dimmed" (including the previous active)
        - Cascades dimmed status to all descendants of the now-dimmed siblings
        - Removes branch_choices entries below the new active that pointed into
          the now-dimmed subtree
        - Recomputes selected_path
    """
    _ensure_project(project_id)

    parent_id = data.get("parent_node_id", "")
    chosen_id = data.get("chosen_child_id", "")
    if not parent_id or not chosen_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "parent_node_id 和 chosen_child_id 都不能为空",
                "detail": {},
            },
        )

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    nodes = canvas.get("nodes", {})

    if parent_id not in nodes:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "NODE_NOT_FOUND",
                "message": f"节点 {parent_id} 不存在",
                "detail": {},
            },
        )

    parent_node = nodes[parent_id]

    if chosen_id not in parent_node.get("children_ids", []):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_CHILD",
                "message": f"节点 {chosen_id} 不是 {parent_id} 的子节点",
                "detail": {},
            },
        )

    if not parent_node.get("is_expanded"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "PARENT_NOT_EXPANDED",
                "message": f"节点 {parent_id} 尚未展开，无法选择分支",
                "detail": {},
            },
        )

    branch_choices = canvas.setdefault("branch_choices", {})
    previous_active_id = branch_choices.get(parent_id)

    # 1. Update branch_choices
    branch_choices[parent_id] = chosen_id

    # 2. Mark all sibling children of parent as dimmed.
    #    Note: we keep `is_expanded` as-is per spec ("children 保留").
    #    The frontend's branch_status !== "active" guard already blocks
    #    expanding dimmed nodes, so the children stay visible-but-inert.
    dimmed_ids = set()
    for sibling_id in parent_node.get("children_ids", []):
        if sibling_id != chosen_id:
            nodes[sibling_id]["branch_status"] = BRANCH_STATUS_DIMMED
            dimmed_ids.add(sibling_id)

    # 3. Cascade: dimmed siblings' descendants also become dimmed.
    #    Invariant 5: a dimmed node's children must all be dimmed.
    def _collect_descendants(node_id: str) -> set[str]:
        result = set()
        stack = [node_id]
        while stack:
            cur = stack.pop()
            cur_node = nodes.get(cur, {})
            for child_id in cur_node.get("children_ids", []):
                if child_id not in result:
                    result.add(child_id)
                    stack.append(child_id)
        return result

    if previous_active_id and previous_active_id != chosen_id:
        dimmed_ids.add(previous_active_id)

    for dimmed_id in dimmed_ids:
        for desc_id in _collect_descendants(dimmed_id):
            nodes[desc_id]["branch_status"] = BRANCH_STATUS_DIMMED

    # 4. Activate the chosen child
    nodes[chosen_id]["branch_status"] = BRANCH_STATUS_ACTIVE

    # 5. Drop branch_choices that pointed into the now-dimmed subtree
    to_drop = []
    for pid, cid in list(branch_choices.items()):
        if pid == parent_id:
            continue
        cur = cid
        visited = set()
        drop = False
        while cur and cur not in visited:
            visited.add(cur)
            cur_node = nodes.get(cur, {})
            if cur_node.get("branch_status") == BRANCH_STATUS_DIMMED:
                drop = True
                break
            cur = cur_node.get("parent_id")
        if drop:
            to_drop.append(pid)
    for pid in to_drop:
        del branch_choices[pid]

    # 6. Recompute selected_path
    canvas["selected_path"] = _compute_selected_path(
        nodes, branch_choices, canvas["root_node_id"]
    )
    canvas["updated_at"] = datetime.utcnow().isoformat()

    # 7. Validate invariants before write
    try:
        _validate_canvas_invariants(canvas)
    except CanvasInvariantError as exc:
        logger.error("Canvas invariants failed after choose-branch: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error": True,
                "code": "INVARIANT_VIOLATION",
                "message": str(exc),
                "detail": {},
            },
        )

    _write_canvas(project_id, canvas)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "selected_path": canvas["selected_path"],
            "branch_choices": canvas["branch_choices"],
            "chosen_node": nodes[chosen_id],
            "dimmed_count": len(dimmed_ids),
        },
    }


# W3: Soft cap on per-node content and total summary size. The LLM prompt
# template has max_tokens=4096, and a 10MB node would force us to drop most
# of the context anyway. Truncate with a marker so the LLM knows there's more.
MAX_NODE_CONTENT_CHARS = 8_000
MAX_SUMMARY_CHARS = 32_000


def _format_canvas_summary(selected_path: list, nodes: dict) -> str:
    """Format selected_path nodes into a structured text for the LLM prompt.

    Each node becomes 3-5 lines: header (depth + tags + novelty), content,
    optional mutation_context block. Nodes are ordered root → leaf. Empty
    content is rendered as "（无内容）" so the LLM doesn't lose its place.

    Per-node content is capped at MAX_NODE_CONTENT_CHARS; the assembled
    summary is capped at MAX_SUMMARY_CHARS. Truncations are logged so we
    notice if users start hitting the cap routinely.
    """
    lines: list[str] = []
    truncated_nodes: list[str] = []
    for nid in selected_path:
        node = nodes.get(nid) or {}
        depth = node.get("depth", 0)
        raw_content = (node.get("content") or "").strip()
        if len(raw_content) > MAX_NODE_CONTENT_CHARS:
            truncated_nodes.append(nid)
            content = raw_content[:MAX_NODE_CONTENT_CHARS] + " […截断]"
        else:
            content = raw_content
        tags = node.get("trope_tags") or []
        novelty = node.get("novelty_score", 0.0) or 0.0
        mutation = node.get("mutation_context")

        header = f"[深度 {depth}]"
        if tags:
            header += f" 标签={','.join(tags)}"
        if novelty:
            header += f" 新颖度={novelty:.0f}"
        lines.append(header)
        lines.append(content or "（无内容）")

        if mutation:
            op = mutation.get("operation", "")
            lines.append(f"  [变异 {op}]")
            for label, key in (
                ("核心冲突", "core_conflict"),
                ("新颖钩子", "novelty_hook"),
                ("自洽检查", "self_consistency_check"),
            ):
                val = (mutation.get(key) or "").strip()
                if val:
                    lines.append(f"  {label}: {val}")
        lines.append("")  # blank separator between nodes

    if truncated_nodes:
        logger.warning(
            "canvas_summary truncated %d node(s) for commit prompt: %s",
            len(truncated_nodes), truncated_nodes,
        )

    text = "\n".join(lines).rstrip()
    if len(text) > MAX_SUMMARY_CHARS:
        logger.warning(
            "canvas_summary total length %d exceeds cap %d, truncating",
            len(text), MAX_SUMMARY_CHARS,
        )
        text = text[:MAX_SUMMARY_CHARS] + "\n[…后续内容已截断]"
    return text


@router.post("/commit")
async def commit_canvas(project_id: str, data: dict = {}):
    """Translate canvas selected_path into concept_and_dna.json via LLM.

    Optional body fields:
      - confirmed_path_ids: list[str] override canvas's selected_path
      - value_stack_override: list[dict] replace story_dna.value_stack after LLM
      - user_notes: str (placeholder, ignored for now)

    Steps:
        1. Read canvas_state.json (400 if not initialized)
        2. Validate path length >= 2 (root + at least one refinement)
        3. Build canvas_summary text from path
        4. Read project.json for genre
        5. Call PlannerAgent.generate_concept_from_canvas
        6. Apply optional value_stack_override
        7. Validate LLM output has story_dna.core_contradiction.statement
        8. Write concept_and_dna.json (last-write-wins; overwrites any existing)
        9. Dual-write creative_divergence.json (compat with STAGE1 /concept guard)
       10. Update canvas_state.json with committed_at + committed_concept_ref
       11. Return detail envelope with concept/story_dna + previews + novelty

    LLM output that misses the gate field is returned as 503 with the raw
    payload in `detail` so the frontend can display the agent's text to the
    user verbatim.
    """
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    selected_path = data.get("confirmed_path_ids") or canvas.get("selected_path") or []
    if len(selected_path) < 2:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INSUFFICIENT_PATH",
                "message": (
                    "提交到概念讨论需要 selected_path 至少 2 个节点"
                    "（根节点 + 至少一次细化/变异），当前只有 "
                    f"{len(selected_path)} 个"
                ),
                "detail": {"selected_path_length": len(selected_path)},
            },
        )

    nodes = canvas.get("nodes", {})
    canvas_summary = _format_canvas_summary(selected_path, nodes)

    # Read genre from project.json
    project = _get_fm().read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")

    # LLM translation
    from backend.agents.planner import PlannerAgent
    from backend.services.agent_prompt_stores import (
        project_override_store,
        global_override_store,
    )

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _ = await agent.generate_concept_from_canvas(
            canvas_summary=canvas_summary,
            genre=genre,
        )
    except ValueError as exc:
        # LLM JSON parse failure or output missing required fields surfaced
        # by the base agent. Bubble the message up so the UI can show it.
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_GENERATION_FAILED",
                "message": f"画布翻译失败：{exc}",
                "detail": {},
            },
        )
    except Exception as exc:
        logger.warning("commit_canvas LLM call failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_BACKEND_UNAVAILABLE",
                "message": f"画布翻译失败：{exc}",
                "detail": {},
            },
        )

    # B1: Distinguish "LLM backend degraded / empty" from "LLM returned a
    # well-formed dict that just misses a required field". The base agent
    # silently degrades with {"text": "", "degraded": True} when Tier 2/3 is
    # unavailable — surfacing that as LLM_OUTPUT_INVALID is misleading.
    if not result or result.get("degraded") or not (result.get("concept") or result.get("story_dna")):
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_BACKEND_UNAVAILABLE",
                "message": "画布翻译失败：LLM 后端不可用（已降级或返回为空）",
                "detail": {},
            },
        )

    # Validate gate field
    concept = result.get("concept") or {}
    story_dna = result.get("story_dna") or {}
    statement = (story_dna.get("core_contradiction") or {}).get("statement") or ""
    if not statement.strip():
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_OUTPUT_INVALID",
                "message": (
                    "LLM 输出缺少 story_dna.core_contradiction.statement，"
                    "无法满足 STAGE1→STAGE2 门控要求"
                ),
                "detail": {"raw_output": result},
            },
        )

    style_template = (story_dna.get("style_template") or "").strip()
    if not style_template:
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_OUTPUT_INVALID",
                "message": (
                    "LLM 输出缺少 story_dna.style_template,"
                    " 无法满足 Task 13 契约"
                ),
                "detail": {"raw_output": result},
            },
        )

    ALLOWED_VALUE_STACK_LEVELS = {"personal", "social", "philosophical", "existential"}
    value_stack = story_dna.get("value_stack") or []
    if len(value_stack) != 4:
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_OUTPUT_INVALID",
                "message": (
                    f"LLM 输出 value_stack 长度必须为 4, "
                    f"实际为 {len(value_stack)}"
                ),
                "detail": {"raw_output": result, "got_length": len(value_stack)},
            },
        )

    invalid_levels = [
        (i, vs.get("level"))
        for i, vs in enumerate(value_stack)
        if (vs.get("level") or "").strip() not in ALLOWED_VALUE_STACK_LEVELS
    ]
    if invalid_levels:
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "LLM_OUTPUT_INVALID",
                "message": (
                    f"LLM 输出 value_stack 层级必须是 "
                    f"{sorted(ALLOWED_VALUE_STACK_LEVELS)} 之一, 收到 {invalid_levels}"
                ),
                "detail": {"raw_output": result, "invalid_entries": invalid_levels},
            },
        )

    # Optional caller override: replace story_dna.value_stack with user-provided
    # layers (PRD §6.2 lets the user finalize the four-level value hierarchy
    # post-LLM). Applied AFTER gate validation so a malformed override can't
    # trip the LLM_OUTPUT_INVALID path.
    if data.get("value_stack_override"):
        story_dna["value_stack"] = data["value_stack_override"]

    # W4: Write canvas_state.json FIRST (stamp committed_at), then write
    # concept_and_dna.json. If we crash between the two writes, we end up
    # with "canvas says committed, concept file not yet updated" — the user
    # sees a chip on /stage1/canvas and an empty/old concept on /stage1.
    # The reverse order (concept updated, canvas not stamped) leaves the
    # user with a new concept they have no audit trail for. The former is
    # more recoverable (re-commit overwrites cleanly).
    now = datetime.utcnow().isoformat()
    canvas["committed_at"] = now
    canvas["committed_concept_ref"] = "concept_and_dna.json"
    canvas["updated_at"] = now
    _write_canvas(project_id, canvas, preserve_committed=True)

    # Write concept_and_dna.json (last-write-wins)
    concept_and_dna = {
        "concept": concept,
        "story_dna": story_dna,
        "source": "canvas",
        "canvas_snapshot": {
            "selected_path": selected_path,
            "committed_at": now,
        },
    }
    try:
        _get_fm().write_json(project_id, "concept_and_dna.json", concept_and_dna)
    except OSError as exc:
        # canvas_state.json was already stamped with committed_at above.
        # Leave it stamped: a subsequent /commit will overwrite both files
        # cleanly. Surfacing the IO failure as 503 with a clear code so the
        # UI can show a "retry commit" message instead of a generic error.
        logger.error("commit_canvas concept_and_dna write failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "STORAGE_WRITE_FAILED",
                "message": f"概念文件写入失败：{exc}（画布已标记为已提交，可重试提交）",
                "detail": {},
            },
        )

    # Dual-write: creative_divergence.json (compat with STAGE1 /concept guard
    # in stage1_concept.py:_read_creative_intent). The Stage 1 guard reads
    # `prompt` and exits with INTENT_MISSING if absent. We write the
    # raw_intent prompt so /stage1/concept can proceed even when the
    # canvas-supplied concept is taken. 1700-char cap matches the
    # user_modifications[:1700] slice at stage1_concept.py:95.
    raw_intent = canvas.get("raw_intent") or {}
    cd_compat = {
        "prompt": (raw_intent.get("prompt", "") or "")[:1700],
        "variants": [],
        "selected_id": None,
        "selected_at": now,
        "source": "canvas",
    }
    try:
        _get_fm().write_json(project_id, "creative_divergence.json", cd_compat)
    except OSError as exc:
        logger.error("commit_canvas creative_divergence dual-write failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "STORAGE_WRITE_FAILED",
                "message": f"creative_divergence.json 写入失败：{exc}（概念已写入，可重试）",
                "detail": {},
            },
        )

    novelty = canvas.get("novelty_scores") or {}
    warnings: list[str] = []
    composite = novelty.get("composite")
    if isinstance(composite, (int, float)) and composite < 0.4:
        # D-2: warn-don't-block policy. Submission proceeds; UI surfaces
        # the low-novelty advisory so the user can decide whether to expand
        # / mutate further before re-committing.
        warnings.append("novelty_below_threshold:composite<0.4 仅警告,不阻止")

    return {
        "error": False,
        "code": "OK",
        "message": "已提交到概念讨论",
        "detail": {
            "concept": concept,
            "story_dna": story_dna,
            "source": "canvas",
            "committed_at": now,
            "concept_preview": concept,
            "story_dna_preview": story_dna,
            "novelty_summary": novelty,
            "next_step_url": f"/project/{project_id}/wizard?step=2",
            "warnings": warnings,
        },
    }


@router.delete("/state")
async def delete_canvas(project_id: str):
    """Reset the canvas: delete canvas_state.json. Idempotent.

    Returns the empty skeleton, same shape as GET /state when uninitialized.
    """
    _ensure_project(project_id)
    _delete_canvas(project_id)
    return {
        "error": False,
        "code": "OK",
        "message": "画布已重置",
        "detail": {
            "root_node_id": None,
            "nodes": {},
            "edges": [],
            "selected_path": [],
        },
    }


# ---------------------------------------------------------------------------
# /contradict — PRD §3.2 (S0-C 矛盾设定)
# ---------------------------------------------------------------------------


class ContradictRequest(BaseModel):
    """Request body for POST /contradict: list contradiction template candidates."""

    variant_id: str
    variant_content: str


class ConfirmContradictRequest(BaseModel):
    """Request body for PUT /contradict: user confirms or customizes a contradiction."""

    template_type: str
    statement: str
    side_a: str
    side_b: str
    tension_score: Optional[int] = None
    is_custom: bool = False


def _build_contradiction_engine() -> ContradictionEngine:
    """Return a ContradictionEngine without an LLM router.

    expand() requires a model_router and would raise NotImplementedError; the
    POST /contradict endpoint catches that and falls back to template metadata
    only so the endpoint still works in CI / when LLM is unavailable.
    """
    return ContradictionEngine()


@router.post("/contradict")
async def list_contradictions(project_id: str, request: ContradictRequest):
    """List contradiction template candidates for a variant, sorted by tension_score desc.

    Returns up to 5 candidates. If LLM expansion is unavailable (NotImplementedError
    or any other exception inside the engine), falls back to template metadata
    only — `preview_statement`, `side_a`, and `side_b` are empty strings and
    `tension_score` is 0.
    """
    _ensure_project(project_id)

    engine = _build_contradiction_engine()
    candidates: List[dict] = []
    for template in ContradictionTemplate:
        try:
            expansion = await engine.expand(template, context=request.variant_content)
            core_tension = expansion.core_tension
            element_a = expansion.element_a
            element_b = expansion.element_b
        except (NotImplementedError, Exception) as exc:
            # LLM unavailable (CI / no router) or transient failure: degrade
            # to template metadata only so the frontend can still show the
            # 5 candidate template names. Log at info for diagnostics.
            logger.info(
                "ContradictionEngine.expand unavailable for %s: %s",
                template.value, exc,
            )
            core_tension = ""
            element_a = ""
            element_b = ""
        score = engine.score_depth(core_tension) if core_tension else 0
        candidates.append({
            "template_type": template.value,
            "preview_statement": core_tension,
            "side_a": element_a,
            "side_b": element_b,
            "tension_score": score,
        })
    candidates.sort(key=lambda x: x["tension_score"], reverse=True)
    return {"candidates": candidates[:5]}


@router.put("/contradict")
async def confirm_contradiction(project_id: str, request: ConfirmContradictRequest):
    """User confirms or customizes a contradiction; writes to canvas_state.core_contradiction.

    If `tension_score` is omitted, it is auto-computed from the statement text
    via ContradictionEngine.score_depth(). A `confirmed_at` ISO timestamp is
    stamped on the write so the frontend can show "已确认 at ...".
    """
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化",
                "detail": {},
            },
        )

    engine = _build_contradiction_engine()
    tension = request.tension_score
    if tension is None:
        tension = engine.score_depth(request.statement)

    canvas["core_contradiction"] = {
        "template_type": request.template_type,
        "statement": request.statement,
        "side_a": request.side_a,
        "side_b": request.side_b,
        "tension_score": tension,
        "is_custom": request.is_custom,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
    }
    canvas["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_canvas(project_id, canvas)

    return {"core_contradiction": canvas["core_contradiction"]}


# ---------------------------------------------------------------------------
# /fuse — PRD §3.4 (S0-B 跨体裁融合)
# ---------------------------------------------------------------------------


class FuseRequest(BaseModel):
    """Request body for POST /fuse: cross-genre fusion with distance grading."""

    genre_primary: str
    genre_secondary: str
    prompt: str = ""


def _genre_to_trope(genre: str, prompt: str):
    """Construct a synthetic Trope for a genre name.

    /fuse combines genres abstractly (not from real catalog entries), so we
    build a Trope on the fly rather than going through TropePool.get_by_genre
    (which does not exist in this codebase).
    """
    from backend.models.creative_os import Trope

    return Trope(
        id=f"genre:{genre}",
        name=genre,
        category="genre",
        description=prompt or f"{genre} 体裁",
        market_saturation=0.5,
    )


def _mutation_to_idea_variant(result, genre_a: str, genre_b: str) -> dict:
    """Adapt a MutationResult into the idea_variant schema persisted on the canvas.

    The v3 canvas's idea_variants list is consumed by /commit's LLM prompt as
    candidate concepts; mapping MutationResult → variant here keeps the schema
    consistent with what /apply-mutation already writes.
    """
    return {
        "id": f"var-{uuid.uuid4().hex[:8]}",
        "title": (result.core_premise or "")[:30],
        "premise_one_line": result.core_premise,
        "mutation_type": result.operation.value,
        "mutation_logic": result.core_conflict,
        "estimated_novelty": 0.7,
        "trope_tags": [genre_a, genre_b],
        "regenerated_count": 0,
    }


def _risk_from_distance(distance: int) -> str:
    """Map BFS distance (0-3+) to a risk_level per PRD §3.4.

      - 0 (same genre)        → low
      - 1 (one-hop neighbor)  → low
      - 2 (medium traversal)  → medium
      - 3+ (far/unrelated)    → high
    """
    if distance <= 1:
        return "low"
    if distance == 2:
        return "medium"
    return "high"


def _mutation_op_from_type(t: str):
    """Map a mutation_type string to a MutationOp enum value.

    Returns None for unknown types (e.g., 'custom' from /contradict PUT).
    Callers should default to INVERSION (or any fallback) when None.
    """
    from backend.models.creative_os import MutationOp
    return {
        "inversion": MutationOp.INVERSION,
        "fusion": MutationOp.FUSION,
        "escalation": MutationOp.ESCALATION,
        "subversion": MutationOp.SUBVERSION,
    }.get(t)


@router.post("/mutate/{node_id}/regenerate")
async def regenerate_variant(project_id: str, node_id: str):
    """Re-run mutation for a single idea_variant; preserves ID + increments regenerated_count.

    PRD §3.3 — the user clicks "重新生成" on a single idea card and the system
    produces a fresh MutationResult for the same variant. The original ID and
    an incremented regenerated_count are stamped onto the result so the UI can
    still reference this specific card.

    MutationEngine is constructed lazily — if no router is configured the
    endpoint falls back to a synthesized minimal variant (preserves the same
    count/ID semantics) so CI and dev environments without an LLM still work.
    """
    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化",
                "detail": {},
            },
        )

    variants = canvas.get("idea_variants", []) or []
    variant = next((v for v in variants if v.get("id") == node_id), None)
    if variant is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_NODE_ID",
                "message": f"variant {node_id} 不存在",
                "detail": {},
            },
        )

    from backend.models.creative_os import MutationOp, Trope
    from backend.creative_os.mutation_engine import MutationEngine

    op = _mutation_op_from_type(variant.get("mutation_type", ""))
    if op is None:
        # Unknown / custom mutation_type (e.g., 'custom' from /contradict PUT).
        # Default to INVERSION so we still emit a coherent variant.
        op = MutationOp.INVERSION

    trope = Trope(
        id=f"variant:{node_id}",
        name=variant.get("title", "regen") or "regen",
        category="variant",
        description=variant.get("premise_one_line", "") or "",
        market_saturation=0.5,
    )

    new_variant: Optional[dict] = None
    try:
        mutation_engine = MutationEngine()
        result = await mutation_engine.mutate(
            trope, op, context=variant.get("premise_one_line", "") or ""
        )
        new_variant = _mutation_to_idea_variant(result, "", "")
    except NotImplementedError as exc:
        # No LLM router — synthesize a minimal variant so the endpoint still
        # returns 200 with an incremented regenerated_count.
        logger.info("MutationEngine.mutate unavailable (no LLM): %s", exc)
    except Exception as exc:
        logger.warning("MutationEngine.mutate failed: %s", exc)

    if new_variant is None:
        new_variant = {
            "id": node_id,
            "title": f"{variant.get('title', '')} (重生成)",
            "premise_one_line": variant.get("premise_one_line", ""),
            "mutation_type": op.value,
            "mutation_logic": f"基于 {op.value} 的重新生成",
            "estimated_novelty": variant.get("estimated_novelty", 0.7),
            "trope_tags": list(variant.get("trope_tags", []) or []),
            "regenerated_count": 0,
        }

    # Preserve ID + count from original. The LLM path of _mutation_to_idea_variant
    # mints a new ID and starts count at 0; overwrite them here so the same card
    # in the UI is updated in place.
    new_variant["id"] = node_id
    new_variant["regenerated_count"] = int(variant.get("regenerated_count", 0)) + 1

    canvas["idea_variants"] = [
        dict(new_variant) if v.get("id") == node_id else v
        for v in variants
    ]
    canvas["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_canvas(project_id, canvas)
    return {"variant": new_variant}


@router.post("/fuse")
async def fuse_genres(project_id: str, request: FuseRequest):
    """Cross-genre fusion with distance-based risk grading (PRD §3.4).

    Combines GenreFusionEngine.compute_distance (BFS distance over the genre
    graph) with MutationEngine.fuse (LLM-driven fusion of two Trope objects
    constructed from the genre names). Returns risk_level (low/medium/high)
    derived from the BFS distance and persists the fused variant onto
    canvas_state.idea_variants.

    The MutationEngine call is wrapped in a try/except so the endpoint still
    returns a synthesized minimal variant when the LLM backend is unavailable
    (CI / no router). Distance + risk_level are always computable since they
    don't require an LLM.
    """
    _ensure_project(project_id)

    from backend.creative_os.genre_fusion_engine import GenreFusionEngine
    from backend.creative_os.mutation_engine import MutationEngine

    fusion_engine = GenreFusionEngine()
    distance = fusion_engine.compute_distance(
        request.genre_primary, request.genre_secondary
    )
    compatibility = fusion_engine.get_compatibility(
        request.genre_primary, request.genre_secondary
    )
    risk_level = _risk_from_distance(distance)

    trope_a = _genre_to_trope(request.genre_primary, request.prompt)
    trope_b = _genre_to_trope(request.genre_secondary, request.prompt)

    variant: Optional[dict] = None
    try:
        mutation_engine = MutationEngine()
        mutation_result = await mutation_engine.fuse(trope_a, trope_b)
        variant = _mutation_to_idea_variant(
            mutation_result, request.genre_primary, request.genre_secondary
        )
    except NotImplementedError as exc:
        # LLM backend not available (no model_router). Synthesize a minimal
        # variant from the genres + distance so the endpoint still works in
        # CI / dev environments without a real LLM.
        logger.info("MutationEngine.fuse unavailable (no LLM): %s", exc)
    except Exception as exc:
        logger.warning("MutationEngine.fuse failed: %s", exc)

    if variant is None:
        variant = {
            "id": f"var-{uuid.uuid4().hex[:8]}",
            "title": f"{request.genre_primary}×{request.genre_secondary}",
            "premise_one_line": f"{request.genre_primary} 与 {request.genre_secondary} 融合",
            "mutation_type": "fusion",
            "mutation_logic": f"跨 {distance} 跳距离的体裁融合",
            "estimated_novelty": 0.7,
            "trope_tags": [request.genre_primary, request.genre_secondary],
            "regenerated_count": 0,
        }

    # Persist to canvas_state.idea_variants. If the canvas doesn't exist yet
    # (user fused before /init), seed a minimal v3 canvas with just the
    # variant. This keeps the endpoint usable in isolation while still being
    # safe to call after /init.
    canvas = _read_canvas(project_id)
    if canvas is None:
        # Fresh project (no canvas_state.json) — seed a minimal v3 canvas with
        # a root node so canvas invariants (non-empty selected_path, root_node_id
        # set, chain linear) pass when _write_canvas re-validates.
        now_iso = datetime.now(timezone.utc).isoformat()
        root_id = "wi_001_00"
        canvas = {
            "schema_version": 3,
            "root_node_id": root_id,
            "nodes": {
                root_id: {
                    "id": root_id,
                    "depth": 0,
                    "parent_id": None,
                    "content": "",
                    "dimension": "角色动机",
                    "novelty_score": 0,
                    "trope_tags": [],
                    "saturation_warning": False,
                    "mutation_context": None,
                    "children_ids": [],
                    "is_expanded": False,
                    "branch_status": "active",
                },
            },
            "edges": [],
            "selected_path": [root_id],
            "branch_choices": {},
            "evaluations": {},
            "created_at": now_iso,
            "updated_at": now_iso,
            "committed_at": None,
            "committed_concept_ref": None,
            "idea_variants": [],
            "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": None,
            "session_metadata": {
                "created_at": now_iso,
                "last_modified_at": now_iso,
                "elapsed_seconds": 0,
                "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }
    canvas.setdefault("idea_variants", []).append(variant)
    canvas["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_canvas(project_id, canvas)

    return {
        "variants": [variant],
        "fusion_distance": {
            "distance": distance,
            "compatibility": compatibility,
        },
        "risk_level": risk_level,
    }


@router.get("/novelty")
async def get_list_novelty(project_id: str):
    """List-level novelty evaluation: 4 dimensions + composite + grade.

    Aggregates novelty scores across all nodes in the selected_path.
    Uses NoveltyEvaluator per-node, then averages the 4 dimensions.
    Persists aggregated scores to canvas_state.novelty_scores.

    Per PRD §3.5: list-level (跨节点聚合) 新颖度评估,用于前端轮询展示。
    """
    _ensure_project(project_id)

    canvas = _read_canvas(project_id)
    if canvas is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "CANVAS_NOT_INITIALIZED",
                "message": "画布尚未初始化，请先调用 /init",
                "detail": {},
            },
        )

    nodes = canvas.get("nodes", {})
    selected_path = canvas.get("selected_path", [])

    # Combine content from selected_path
    contents = [
        nodes[nid]["content"]
        for nid in selected_path
        if nid in nodes and nodes[nid].get("content")
    ]
    combined_content = " ".join(contents) if contents else ""

    # Build a TropePool + NoveltyEvaluator (lazy, degrades gracefully)
    try:
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        contradiction_engine = ContradictionEngine()
        evaluator = NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=contradiction_engine,
            model_router=None,
            embedder=None,
        )
        score = evaluator.evaluate(combined_content)
        payload = {
            "error": False,
            "code": "OK",
            "message": "",
            "market_saturation": score.market_saturation_score,
            "trope_similarity": score.trope_similarity_score,
            "contradiction_depth": score.contradiction_depth_score,
            "discussion_potential": score.discussion_potential_score,
            "composite": score.total,
            "grade": score.grade,
            "trope_extraction_status": "pending",  # TODO(Task 12): LLM extraction
        }
    except Exception as exc:
        logger.warning("NoveltyEvaluator unavailable: %s", exc)
        # Fallback: all 4 dims at neutral midpoint (50.0). Matches
        # NoveltyEvaluator's natural empty-input behavior — both
        # _calc_market_saturation and _calc_similarity return 50.0
        # when their inputs are empty, so the fallback should too.
        # composite is the weighted sum of 50.0 across all 4 dims
        # (0.30 + 0.25 + 0.25 + 0.20 = 1.0), so it also stays at 50.0.
        payload = {
            "error": False,
            "code": "OK",
            "message": "新颖度评估暂不可用",
            "market_saturation": 50.0,
            "trope_similarity": 50.0,
            "contradiction_depth": 50.0,
            "discussion_potential": 50.0,
            "composite": 50.0,
            "grade": "中等",
            "trope_extraction_status": "pending",
        }

    payload["computed_at"] = datetime.now(timezone.utc).isoformat()

    canvas["novelty_scores"] = payload
    _write_canvas(project_id, canvas)
    return payload
