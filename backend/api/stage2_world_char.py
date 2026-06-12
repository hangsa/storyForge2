from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.agents.planner import PlannerAgent
from backend.models.character import Character as CharacterModel

router = APIRouter(prefix="/api/stage2", tags=["stage2"])
fm = FileManager(settings.projects_dir)


@router.get("/world")
async def get_world(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "world.json")
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
        data = {"characters": [data]}
        fm.write_json(project_id, "characters.json", data)

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
    if current != Stage.STAGE2:
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
    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_world(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=project.get("genre", "cool_novel") if project else "cool_novel",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

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
    if current != Stage.STAGE2:
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
    if concept_and_dna is None or world is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "请先生成概念和世界观", "detail": {}},
        )

    # Load existing characters for context (with old-format migration)
    existing = fm.read_json(project_id, "characters.json") or {}
    if isinstance(existing, dict) and "characters" not in existing:
        existing = {"characters": [existing]}
        fm.write_json(project_id, "characters.json", existing)
    existing_characters = existing.get("characters", [])

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=character_type,
            existing_characters=existing_characters,
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
