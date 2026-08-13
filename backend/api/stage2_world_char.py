from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api._errors import http_error
from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.agents.planner import PlannerAgent
from backend.models.character import BehaviorExample, Character as CharacterModel, CharacterPatch
from backend.models.world import World, iter_power_systems, _raw_power_systems_list
from backend.services.agent_prompt_stores import (
    project_override_store,
    global_override_store,
)

router = APIRouter(prefix="/api/stage2", tags=["stage2"])
fm = FileManager(settings.projects_dir)

ERA_BLOCK_KEYS = ("era", "geography", "era_social_structure", "era_cultural_history")
PERSONALITY_KEYS = ("beliefs", "desires", "fears", "values", "core_traits")


def _file_manager() -> FileManager:
    return FileManager(settings.projects_dir)


@router.get("/world")
async def get_world(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "world.json")
    # Validate + coerce so legacy/malformed world.json (LLM sometimes ignores
    # the schema and produces objects for fields that should be strings — see
    # proj_ec67d3e2) returns the correct shape. The World model has
    # field_validators that JSON-stringify objects and flatten nested arrays.
    if data:
        try:
            data = World.model_validate(data).model_dump()
        except Exception:
            # Worst case: serve raw data — the frontend has its own
            # normalizeLegacyWorld() fallback and will still render the form.
            pass
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": data or {},
    }


@router.get("/character")
async def get_character(project_id: str = Query(...), character_index: int = Query(None)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "characters.json")

    # Migrate old-format characters.json (single object → {characters: [...]})
    if isinstance(data, dict) and "characters" not in data:
        if data:
            data = {"characters": [data]}
        else:
            data = {"characters": []}
        _file_manager().write_json(project_id, "characters.json", data)

    characters = (data or {}).get("characters", [])

    # Fill missing nested fields with Pydantic model defaults (defense against incomplete LLM output)
    safe_characters = []
    for c in characters:
        try:
            safe_characters.append(CharacterModel(**c).model_dump())
        except Exception:
            c.setdefault("personality", {"core_traits": [], "beliefs": [], "desires": [], "fears": [], "values": []})
            c.setdefault("current_state", {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []})
            c.setdefault("voice_signature", {"speech_style": "", "thought_patterns": "", "taboos": []})
            c.setdefault("unknown_to_character", [])
            c.setdefault("relations", {})
            safe_characters.append(c)

    if character_index is not None and 0 <= character_index < len(safe_characters):
        return {
            "error": False,
            "code": "OK",
            "message": "",
            "detail": {"characters": safe_characters, "current": safe_characters[character_index]},
        }
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {"characters": safe_characters, "current": safe_characters[0] if safe_characters else {}},
    }


@router.post("/generate-world")
async def generate_world(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE2):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE2 操作",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    if concept_and_dna is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "请先生成概念 (STAGE1)", "detail": {}},
        )

    project = fm.read_json(project_id, "project.json")
    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel") if project else "cool_novel",
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, response = await agent.generate_world(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=project.get("genre", "cool_novel") if project else "cool_novel",
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Validate + coerce the LLM result before writing so on-disk world.json
    # always matches the World schema. Without this, the LLM can produce
    # objects for fields the schema expects as strings (proj_ec67d3e2), and
    # the wizard fails to render the form on re-entry.
    try:
        result = World.model_validate(result).model_dump()
    except Exception:
        # If the LLM output is malformed beyond what the validators can fix,
        # write the raw result and let the frontend normalizeLegacyWorld()
        # handle the legacy shape on read.
        pass

    fm.write_json(project_id, "world.json", result)

    return {
        "error": False,
        "code": "OK",
        "message": "世界观生成成功",
        "detail": result,
    }


@router.post("/generate-character")
async def generate_character(data: dict):
    ALLOWED_TYPES = {"protagonist", "antagonist", "supporting", "mentor"}
    project_id = data.get("project_id", "")
    character_type = data.get("character_type", "protagonist")
    character_index = data.get("character_index", 0)
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    if character_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": f"character_type 无效，允许值: {', '.join(sorted(ALLOWED_TYPES))}", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE2):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE2 操作",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    project = fm.read_json(project_id, "project.json") or {}
    if concept_and_dna is None or world is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "请先生成概念和世界观", "detail": {}},
        )

    # Load existing characters for context (with old-format migration)
    existing = fm.read_json(project_id, "characters.json") or {}
    if isinstance(existing, dict) and "characters" not in existing:
        if existing:
            existing = {"characters": [existing]}
        else:
            existing = {"characters": []}
        fm.write_json(project_id, "characters.json", existing)
    existing_characters = existing.get("characters", [])

    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, response = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=character_type,
            existing_characters=existing_characters,
            genre=genre,
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Fill missing nested structures with Pydantic model defaults
    result.setdefault("character_type", character_type)
    if character_type == "protagonist":
        result["is_core_character"] = True
    else:
        result.setdefault("is_core_character", False)

    try:
        char_model = CharacterModel(**result)
        result = char_model.model_dump()
    except Exception:
        result.setdefault("personality", {"core_traits": [], "beliefs": [], "desires": [], "fears": [], "values": []})
        result.setdefault("current_state", {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []})
        result.setdefault("voice_signature", {"speech_style": "", "thought_patterns": "", "taboos": []})
        result.setdefault("unknown_to_character", [])
        result.setdefault("relations", {})
        result.setdefault("growth_curve", None)

    existing_characters.append(result)
    characters = {"characters": existing_characters}
    fm.write_json(project_id, "characters.json", characters)

    return {
        "error": False,
        "code": "OK",
        "message": f"角色生成成功（共 {len(existing_characters)} 个）",
        "detail": {"characters": existing_characters, "created": result},
    }


@router.put("/world")
async def update_world(data: dict):
    project_id = data.get("project_id", "")
    world_data = data.get("world", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    # Validate + coerce so the on-disk world.json always matches the schema.
    # The frontend sends corrected data, but the user can edit raw fields, so
    # defense-in-depth here is cheap.
    try:
        world_data = World.model_validate(world_data).model_dump()
    except Exception:
        pass

    fm.write_json(project_id, "world.json", world_data)

    return {
        "error": False,
        "code": "OK",
        "message": "世界观已更新",
        "detail": world_data,
    }


@router.put("/character")
async def update_character(data: dict):
    project_id = data.get("project_id", "")
    character_data = data.get("character", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    fm.write_json(project_id, "characters.json", character_data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已更新",
        "detail": character_data,
    }


def _not_found(msg: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"error": True, "code": "NOT_FOUND", "message": msg, "detail": {}},
    )


@router.patch("/character/{character_id}")
async def patch_character(
    character_id: str,
    project_id: str = Query(...),
    payload: CharacterPatch = None,
):
    """Partial-update one character. Only fields present in `payload` are written;
    other fields are preserved. Returns the updated character dict."""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    if payload is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "请求体不能为空", "detail": {}},
        )

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _not_found(f"角色不存在: {character_id}")

    patch_dict = payload.model_dump(exclude_none=True)
    if "character_type" in patch_dict and patch_dict["character_type"] not in {
        "protagonist", "antagonist", "supporting", "mentor"
    }:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "character_type 无效", "detail": {}},
        )
    for key, value in patch_dict.items():
        target[key] = value

    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已更新",
        "detail": target,
    }


@router.delete("/character/{character_id}")
async def delete_character(character_id: str, project_id: str = Query(...)):
    """Delete one character and clean up inbound `relations` references in
    every other character. Returns `cascaded_relation_removals` count."""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target_idx = next(
        (i for i, c in enumerate(characters) if c.get("id") == character_id),
        None,
    )
    if target_idx is None:
        raise _not_found(f"角色不存在: {character_id}")

    cascaded = 0
    for c in characters:
        if c.get("id") == character_id:
            continue
        relations = c.get("relations") or {}
        if character_id in relations:
            del relations[character_id]
            c["relations"] = relations
            cascaded += 1

    characters.pop(target_idx)
    data["characters"] = characters
    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已删除",
        "detail": {"deleted_id": character_id, "cascaded_relation_removals": cascaded},
    }


@router.post("/character/{character_id}/regenerate-examples")
async def regenerate_character_examples(
    character_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    """Re-run Character Designer for ONE character and merge only the
    `behavior_examples` field back into voice_signature. Body: `{"keep_existing": false}`.

    Uses PlannerAgent.generate_character for the LLM call (same path as
    /stage2/generate-character); only the behavior_examples from the response
    are merged. Other voice_signature / personality fields are NOT touched.
    """
    # Re-resolve PlannerAgent at call time so the test mock
    # patch("backend.agents.planner.PlannerAgent") intercepts correctly.
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")
    payload = payload or {}
    keep_existing = bool(payload.get("keep_existing", False))

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _not_found(f"角色不存在: {character_id}")

    # Minimal inputs to keep the LLM focused on examples. Reuse existing context if present.
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    world = _file_manager().read_json(project_id, "world.json") or {}
    project = _file_manager().read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        user_modifications = str(payload.get("user_modifications", ""))[:1700]
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=target.get("character_type", "supporting"),
            existing_characters=[target],
            genre=genre,
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    # Extract behavior_examples — accept either top-level or nested under voice_signature.
    new_examples_raw = result.get("behavior_examples")
    if not new_examples_raw:
        new_examples_raw = result.get("voice_signature", {}).get("behavior_examples", [])
    new_examples: list[dict] = []
    for ex in new_examples_raw or []:
        try:
            new_examples.append(BehaviorExample(**ex).model_dump())
        except Exception:
            continue  # skip malformed entries rather than fail the whole call

    vs = target.setdefault("voice_signature", {})
    if keep_existing:
        existing = vs.get("behavior_examples", [])
        vs["behavior_examples"] = existing + new_examples
    else:
        vs["behavior_examples"] = new_examples

    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "行为示例已重新生成",
        "detail": target,
    }


class RegenerateWorldSectionPayload(BaseModel):
    section: str
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-world-section")
async def regenerate_world_section(
    project_id: str = Query(...),
    payload: RegenerateWorldSectionPayload = None,
):
    """Re-run world generation and merge only the requested section back
    into world.json. Other top-level keys preserved byte-identical."""
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    if payload.section not in ("era", "power_system", "core_rules", "factions"):
        raise http_error(
            400,
            "VALIDATION_ERROR",
            f"section 必须是 era/power_system/core_rules/factions，收到 {payload.section}",
            section=payload.section,
        )

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = _file_manager().read_json(project_id, "world.json") or {}
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _resp = await agent.generate_world(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=genre,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    merged = dict(existing)
    if payload.section == "era":
        for key in ERA_BLOCK_KEYS:
            merged[key] = result.get(key, existing.get(key, ""))
    elif payload.section == "power_system":
        # The section literal stays singular (front-end contract), but the
        # stored shape is the `power_systems` array.
        merged["power_systems"] = result.get(
            "power_systems", iter_power_systems(existing)
        )
    elif payload.section == "core_rules":
        merged["core_rules"] = result.get("core_rules", existing.get("core_rules", []))
    else:  # "factions"
        merged["factions"] = result.get("factions", existing.get("factions", []))

    # Validate before writing so a legacy singular `power_system` in either
    # `existing` or the LLM result is folded into `power_systems` here rather
    # than lingering in world.json alongside the new key.
    try:
        merged = World.model_validate(merged).model_dump()
    except Exception:
        merged.pop("power_system", None)

    _file_manager().write_json(project_id, "world.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"world.{payload.section} 已重新生成",
        "detail": merged,
    }


class RegeneratePowerSystemItemPayload(BaseModel):
    system_index: int = Field(ge=0)
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-power-system-item")
async def regenerate_power_system_item(
    project_id: str = Query(...),
    payload: RegeneratePowerSystemItemPayload = None,
):
    """Rewrite a single entry of world.power_systems[index] without touching
    the rest of the array. Other top-level world.json keys preserved
    byte-identical.
    """
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = _file_manager().read_json(project_id, "world.json") or {}
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    genre = project.get("genre", "cool_novel")

    # Use the raw disk array — not `iter_power_systems`, which drops entries
    # whose fields are all blank. The wizard renders those empties as
    # cards (so the user can fill them in or click ↻ on them), and the
    # per-item endpoint must accept the index the user clicked. An empty
    # slot just becomes a `target_system="（空）"` prompt and the LLM
    # generates a fresh one (planner.py:_build_target_fragment).
    raw_systems = _raw_power_systems_list(existing)
    if payload.system_index >= len(raw_systems):
        raise http_error(
            400,
            "VALIDATION_ERROR",
            f"system_index {payload.system_index} 超出范围 (0..{len(raw_systems) - 1})",
            index=payload.system_index,
            total=len(raw_systems),
        )

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        new_system, _resp = await agent.regenerate_power_system(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=genre,
            user_modifications=payload.user_modifications,
            existing_systems=raw_systems,
            target_index=payload.system_index,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    merged = dict(existing)
    next_systems = list(raw_systems)
    next_systems[payload.system_index] = new_system
    merged["power_systems"] = next_systems

    # Validate before writing so a legacy singular `power_system` in either
    # `existing` or the LLM result is folded into `power_systems` here rather
    # than lingering in world.json alongside the new key.
    try:
        merged = World.model_validate(merged).model_dump()
    except Exception:
        merged.pop("power_system", None)

    _file_manager().write_json(project_id, "world.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"world.power_systems[{payload.system_index}] 已重新生成",
        "detail": {
            "system_index": payload.system_index,
            "power_system": new_system,
            "world": merged,
        },
    }


class RegenerateCharacterSectionPayload(BaseModel):
    section: str
    keep_existing: bool = False
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-character-section")
async def regenerate_character_section(
    project_id: str = Query(...),
    character_id: str = Query(...),
    payload: RegenerateCharacterSectionPayload = None,
):
    """Re-run character generation and merge only the requested section
    back into the character dict. Other top-level keys preserved.

    Special cases:
    - `voice_signature`: replaces speech_style / thought_patterns / taboos
      but explicitly preserves `behavior_examples` (per-card regenerate
      workflow owns that field).
    - `personality`: when `keep_existing=True`, appends LLM items to
      existing arrays per-key. When False (default), replaces all arrays.
    """
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    if payload.section not in ("personality", "voice_signature", "current_state", "unknown", "relations"):
        raise http_error(
            400,
            "VALIDATION_ERROR",
            f"section 必须是 personality/voice_signature/current_state/unknown/relations，收到 {payload.section}",
            section=payload.section,
        )

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _not_found(f"角色不存在: {character_id}")

    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    world = _file_manager().read_json(project_id, "world.json") or {}
    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=target.get("character_type", "supporting"),
            existing_characters=[target],
            genre=genre,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    if payload.section == "personality":
        new_p = result.get("personality", {}) or {}
        if payload.keep_existing:
            existing_p = target.get("personality", {}) or {}
            merged_p = {k: existing_p.get(k, []) + new_p.get(k, []) for k in PERSONALITY_KEYS}
            target["personality"] = merged_p
        else:
            target["personality"] = new_p
    elif payload.section == "voice_signature":
        # CRITICAL: behavior_examples is owned by /regenerate-examples.
        # Drop whatever the LLM returned and keep the existing field.
        new_v = result.get("voice_signature", {}) or {}
        existing_v = target.get("voice_signature", {}) or {}
        target["voice_signature"] = {
            "speech_style": new_v.get("speech_style", ""),
            "thought_patterns": new_v.get("thought_patterns", ""),
            "taboos": new_v.get("taboos", []),
            "behavior_examples": existing_v.get("behavior_examples", []),
        }
    elif payload.section == "current_state":
        target["current_state"] = result.get("current_state", {}) or {}
    elif payload.section == "unknown":
        target["unknown_to_character"] = result.get("unknown_to_character", []) or []
    elif payload.section == "relations":
        target["relations"] = result.get("relations", {}) or {}
    else:
        # The 400-validation earlier only fires for values NOT in the whitelist.
        # If we reach here, the validation tuple and the merge chain are out
        # of sync — surface the drift loudly rather than silently storing the
        # wrong section under `relations`.
        raise RuntimeError(f"unhandled section: {payload.section!r}")

    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": target,
    }
