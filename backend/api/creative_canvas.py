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
- DELETE /state  — Reset the canvas (delete canvas_state.json)
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.models.creative_os import WhatIfNode, NoveltyScore, BRANCH_STATUS_ACTIVE, BRANCH_STATUS_DIMMED

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/creative/canvas",
    tags=["creative_canvas"],
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

    Migrates v1 → v2 transparently. When a v1 file is encountered, the
    migrated v2 form is written back atomically so subsequent reads skip
    the migration step.

    Always returns a canvas whose `edges` field reflects the current
    `children_ids` on every node (derived at read time).
    """
    path = _get_canvas_path(project_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        canvas = json.load(f)
    if canvas.get("schema_version") != 2:
        migrated = _migrate_v1_to_v2(canvas)
        migrated["edges"] = _derive_edges_from_nodes(migrated.get("nodes", {}))
        # Persist migrated form so future reads skip the migration step.
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(migrated, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
        return migrated
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

    now = datetime.utcnow().isoformat()
    canvas = {
        "schema_version": 2,
        "root_node_id": root_node.id,
        "nodes": {root_node.id: _node_to_dict(root_node)},
        "edges": [],
        "selected_path": [root_node.id],
        "branch_choices": {},
        "evaluations": {},
        "created_at": now,
        "updated_at": now,
    }
    _write_canvas(project_id, canvas)

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

        director = CreativeDirector(project_id)
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

        director = CreativeDirector(project_id)
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
    import uuid
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

        director = CreativeDirector(project_id)
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
async def commit_canvas(project_id: str):
    """Translate canvas selected_path into concept_and_dna.json via LLM.

    Steps:
        1. Read canvas_state.json (400 if not initialized)
        2. Validate selected_path length >= 2 (root + at least one refinement)
        3. Build canvas_summary text from selected_path
        4. Read project.json for genre
        5. Call PlannerAgent.generate_concept_from_canvas
        6. Validate LLM output has story_dna.core_contradiction.statement
        7. Write concept_and_dna.json (last-write-wins; overwrites any existing)
        8. Update canvas_state.json with committed_at + committed_concept_ref
        9. Return {concept, story_dna, source}

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

    selected_path = canvas.get("selected_path") or []
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

    agent = PlannerAgent(project_id)
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

    return {
        "error": False,
        "code": "OK",
        "message": "已提交到概念讨论",
        "detail": {
            "concept": concept,
            "story_dna": story_dna,
            "source": "canvas",
            "committed_at": now,
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
