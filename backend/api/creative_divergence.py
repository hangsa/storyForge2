from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.config import settings
from backend.utils.file_manager import FileManager

router = APIRouter(prefix="/api/projects/{project_id}", tags=["creative-divergence"])


def _file_manager() -> FileManager:
    # Per-call factory so tests can patch `settings.projects_dir` via
    # monkeypatch and have the change propagate to every endpoint call.
    # Aligns with the sibling pattern in backend/api/stage2_world_char.py
    # (see project_api_file_manager_pattern memory).
    return FileManager(settings.projects_dir)


CD_FILE = "creative_divergence.json"
CONCEPT_FILE = "concept_and_dna.json"
MAX_PROMPT_LEN = 2000
GENERATE_VARIANT_COUNT = 4
VARIANT_LABELS = ["ALPHA", "BETA", "GAMMA", "DELTA"]


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_LEN)
    count: int = Field(default=GENERATE_VARIANT_COUNT, ge=1, le=8)
    params: Optional[dict] = None


class SelectRequest(BaseModel):
    variant_id: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_cd(project_id: str) -> dict:
    path = _file_manager().projects_dir / project_id / CD_FILE
    if not path.exists():
        return {"prompt": "", "variants": [], "selected_id": None,
                "selected_at": None, "updated_at": None}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_cd(project_id: str, data: dict) -> None:
    data["updated_at"] = _now()
    _file_manager().write_json(project_id, CD_FILE, data)


def _generate_variants(prompt: str, count: int) -> List[dict]:
    # Deterministic stub fallback: backend.creative_os.mutation_engine.mutate_idea
    # and backend.creative_os.idea_pool.sample_idea_pool do not exist in this
    # codebase, so we synthesize variant titles deterministically. Per the plan's
    # Step 5 fallback instruction. Real LLM-backed mutation is a future task.
    out: List[dict] = []
    for i in range(count):
        label = VARIANT_LABELS[i % len(VARIANT_LABELS)]
        title = f"变体 {prompt[:20]} {i + 1}"
        out.append({
            "id": f"var_{uuid.uuid4().hex[:12]}",
            "label": f"概念 {label}",
            "title": title,
            "description": prompt,
            "tags": [],
            "created_at": _now(),
        })
    return out


@router.get("/creative-divergence")
def list_variants(project_id: str):
    data = _read_cd(project_id)
    return {"variants": data["variants"], "selected_id": data.get("selected_id")}


@router.post("/creative-divergence/generate")
def generate_variants(project_id: str, req: GenerateRequest):
    variants = _generate_variants(req.prompt, req.count)
    data = {
        "prompt": req.prompt,
        "variants": variants,
        "selected_id": None,
        "selected_at": None,
        "updated_at": None,
    }
    _write_cd(project_id, data)
    return {"variants": variants}


@router.post("/creative-divergence/select")
def select_variant(project_id: str, req: SelectRequest):
    data = _read_cd(project_id)
    target = next((v for v in data["variants"] if v["id"] == req.variant_id), None)
    if target is None:
        raise HTTPException(status_code=422, detail="variant_id 不存在")
    data["selected_id"] = req.variant_id
    data["selected_at"] = _now()
    _write_cd(project_id, data)

    file_mgr = _file_manager()
    cd = file_mgr.read_json(project_id, CONCEPT_FILE) or {"concept": {}, "story_dna": {}}
    existing_concept = cd.get("concept", {}) or {}
    cd["concept"] = {
        **existing_concept,
        "title": target["title"],
        "genre": (target.get("tags") or [""])[0],
        "premise": target["description"],
        "tone": target.get("tone") or existing_concept.get("tone", ""),
        "theme": target.get("theme") or existing_concept.get("theme", ""),
        "source": "creative_divergence",
        "source_variant_id": req.variant_id,
    }
    file_mgr.write_json(project_id, CONCEPT_FILE, cd)
    return {"concept_payload": cd["concept"]}


@router.get("/creative-divergence/prefill-check")
def prefill_check(project_id: str):
    data = _read_cd(project_id)
    return {
        "exists": bool(data.get("variants")),
        "has_selection": data.get("selected_id") is not None,
    }
