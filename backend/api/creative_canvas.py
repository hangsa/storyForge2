"""Creative Canvas API — WhatIf tree management endpoints.

Provides thin orchestration endpoints for the Creative Canvas frontend:
- GET    /state  — Read canvas_state.json
- POST   /init   — Initialize canvas with root node via WhatIfEngine
- POST   /expand — Expand a node via WhatIfEngine + NoveltyEvaluator + CreativeDirector
- POST   /mutate — Placeholder for mutation operations
- POST   /merge  — Placeholder for node merging
- POST   /evaluate — Re-score a node with NoveltyEvaluator
- POST   /select — Update selected_path and get CreativeDirector path evaluation
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
from backend.models.creative_os import WhatIfNode, NoveltyScore

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


def _read_canvas(project_id: str) -> Optional[dict]:
    """Read canvas_state.json. Returns None if not initialized."""
    path = _get_canvas_path(project_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_canvas(project_id: str, data: dict) -> None:
    """Atomically write canvas_state.json."""
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
        "dimension": node.dimension,
        "novelty_score": node.novelty_score,
        "trope_tags": node.trope_tags,
        "saturation_warning": node.saturation_warning,
        "children_ids": list(node.children_ids),
        "is_expanded": node.is_expanded,
    }


def _dict_to_node(d: dict) -> WhatIfNode:
    """Deserialize a dict back to a WhatIfNode dataclass."""
    return WhatIfNode(
        id=d["id"],
        depth=d["depth"],
        parent_id=d.get("parent_id"),
        content=d.get("content", ""),
        dimension=d.get("dimension", ""),
        novelty_score=d.get("novelty_score", 0.0),
        trope_tags=list(d.get("trope_tags", [])),
        saturation_warning=d.get("saturation_warning"),
        children_ids=list(d.get("children_ids", [])),
        is_expanded=d.get("is_expanded", False),
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
        "root_node_id": root_node.id,
        "nodes": {root_node.id: _node_to_dict(root_node)},
        "edges": [],
        "selected_path": [root_node.id],
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
                    dimension=parent_dict.get("dimension", ""),
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

    # --- Step 4: get suggestion from CreativeDirector --------------------
    suggestion = ""
    try:
        from backend.agents.creative_director import CreativeDirector

        director = CreativeDirector(project_id)
        canvas_stats = {
            "total_nodes": len(canvas["nodes"]),
            "depth_distribution": _compute_depth_distribution(canvas["nodes"]),
            "dimensions_covered": list(
                {n.get("dimension", "") for n in canvas["nodes"].values() if n.get("dimension")}
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
    """Placeholder: apply a mutation operation to a node.

    Request body:
        {"node_id": "wi_001_00", "operation": "inversion"}

    Requires full LLM backend integration (MutationEngine + CreativeDirector).
    """
    _ensure_project(project_id)
    return {
        "error": False,
        "code": "OK",
        "message": "变异功能需要 LLM 后端支持，当前为占位实现",
        "detail": {},
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

    # Validate every node ID exists
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
