# Wizard Per-Section Regenerate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-section regenerate icon next to every labeled section header in wizard steps 1 (concept), 2 (world), 3 (character, per-card), and 4 (novel outline). Clicking the icon opens the existing `RegenerateModal`; confirming rewrites only that section on disk.

**Architecture:** Four new backend endpoints (`POST /api/stage1/regenerate-section`, `/api/stage2/regenerate-world-section`, `/api/stage2/regenerate-character-section`, `/api/stage3/regenerate-novel-outline-section`) that re-run the relevant `PlannerAgent` method with the current section's context and merge only the targeted section back into the persisted JSON file. One new shared frontend component (`SectionRegenerateButton`) that opens the existing `RegenerateModal` and owns its busy state. Four wizard steps gain per-section icons + a `handleSectionRegenerate` function that calls the matching API wrapper and replaces local state from the response.

**Tech Stack:** FastAPI + Pydantic (backend) · React 18 + Vite + Tailwind + Vitest (frontend) · `PlannerAgent` from `backend/agents/planner.py`.

**Spec:** `docs/superpowers/specs/2026-08-10-wizard-per-section-regenerate-design.md`

---

## Task 1: Backend `POST /api/stage1/regenerate-section`

**Files:**
- Modify: `backend/api/stage1_concept.py`
- Test: `backend/tests/test_stage1_regenerate_section.py`

Sections supported: `concept`, `dna`. Reuses `PlannerAgent.generate_concept_and_dna`. After the agent call, merge only the requested section back into `concept_and_dna.json`; preserve everything else byte-identically. The endpoint validates `section` manually (NOT via Pydantic Literal) so unknown values fail with 400 + VALIDATION_ERROR envelope — Pydantic auto-validation returns 422 with a foreign envelope shape.

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/test_stage1_regenerate_section.py`:

```python
"""Tests for POST /api/stage1/regenerate-section.

Sections: `concept` rewrites only `concept_and_dna.concept`;
`dna` rewrites only `concept_and_dna.story_dna`. Other fields stay
byte-identical. Mirrors the regenerate-examples pattern.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_concept_section"


def _write_concept_and_dna(tmp_path: Path, payload: dict) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "concept_and_dna.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _write_project(tmp_path: Path) -> None:
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({
            "id": PROJ,
            "genre": "cool_novel",
            "initial_intent": {"free_text": "一个少年在废墟里觉醒"},
        }, ensure_ascii=False),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    """PlannerAgent returns a payload with both `concept` and `story_dna`.
    The endpoint must extract only the targeted section."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_concept_and_dna = AsyncMock(return_value=(
            {
                "concept": {
                    "title": "新标题",
                    "genre": "cool_novel",
                    "premise": "新前提",
                    "tone": "热血",
                    "theme": "成长",
                    "target_audience": "男频",
                    "style_template": "升级流",
                },
                "story_dna": {
                    "core_contradiction": {"statement": "新矛盾", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"value_a": "自由", "value_b": "秩序"}],
                },
            },
            None,  # LLMResponse placeholder
        ))
        yield MockPlanner


def _seed_old_payload():
    return {
        "concept": {
            "title": "旧标题",
            "genre": "cool_novel",
            "premise": "旧前提",
            "tone": "轻松",
            "theme": "友情",
            "target_audience": "全年龄",
            "style_template": "日常",
        },
        "story_dna": {
            "core_contradiction": {"statement": "旧矛盾", "side_a": "X", "side_b": "Y"},
            "value_stack": [{"value_a": "信任", "value_b": "背叛"}],
        },
        "warnings": [],  # legacy runtime field — must survive untouched
    }


def test_regenerate_concept_rewrites_only_concept(mock_planner, tmp_path):
    _write_project(tmp_path)
    seeded = _seed_old_payload()
    _write_concept_and_dna(tmp_path, seeded)

    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "concept", "user_modifications": "更热血"},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]

    # Targeted section is replaced.
    assert detail["concept"]["title"] == "新标题"
    assert detail["concept"]["tone"] == "热血"

    # story_dna is preserved byte-identical (same dict values).
    assert detail["story_dna"] == seeded["story_dna"]

    # `warnings` field survives.
    assert detail["warnings"] == seeded["warnings"]


def test_regenerate_dna_rewrites_only_story_dna(mock_planner, tmp_path):
    _write_project(tmp_path)
    seeded = _seed_old_payload()
    _write_concept_and_dna(tmp_path, seeded)

    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "dna", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]

    # story_dna is replaced.
    assert detail["story_dna"]["core_contradiction"]["statement"] == "新矛盾"
    assert detail["story_dna"]["value_stack"] == [{"value_a": "自由", "value_b": "秩序"}]

    # concept is preserved byte-identical.
    assert detail["concept"] == seeded["concept"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write_project(tmp_path)
    _write_concept_and_dna(tmp_path, _seed_old_payload())
    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "title_only", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_missing_project_returns_404(mock_planner, tmp_path):
    # No project.json — planner never gets called.
    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "concept", "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _write_project(tmp_path)
    _write_concept_and_dna(tmp_path, _seed_old_payload())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_concept_and_dna = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage1/regenerate-section?project_id={PROJ}",
            json={"section": "concept", "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source venv/bin/activate && pytest backend/tests/test_stage1_regenerate_section.py -v`
Expected: All 5 tests fail with `404 Not Found` (endpoint doesn't exist yet).

- [ ] **Step 3: Add the endpoint to `backend/api/stage1_concept.py`**

Append to `backend/api/stage1_concept.py` (after the existing `update_concept` function, before any import-block at the bottom):

```python
from pydantic import BaseModel, Field


class RegenerateConceptSectionPayload(BaseModel):
    section: str
    user_modifications: str = Field(default="", max_length=1000)


@router.post("/regenerate-section")
async def regenerate_concept_section(
    project_id: str = Query(...),
    payload: RegenerateConceptSectionPayload = None,
):
    """Re-run concept generation and merge only the requested section
    (`concept` or `story_dna`) back into `concept_and_dna.json`.
    Other fields are preserved byte-identical."""
    # Re-resolve at call time so test mocks patch correctly.
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    if payload.section not in ("concept", "dna"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": f"section 必须是 concept 或 dna，收到 {payload.section}", "detail": {"section": payload.section}},
        )

    project = fm.read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND", "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    existing = fm.read_json(project_id, "concept_and_dna.json") or {}

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        result, _resp = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    new_concept = result.get("concept", {})
    new_dna = result.get("story_dna", {})

    merged = dict(existing)
    if payload.section == "concept":
        merged["concept"] = new_concept
    else:  # "dna"
        merged["story_dna"] = new_dna

    # Drop any runtime warnings from the LLM result — they live in `result`
    # but we never merge the full result, so they don't pollute storage.
    fm.write_json(project_id, "concept_and_dna.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": merged,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source venv/bin/activate && pytest backend/tests/test_stage1_regenerate_section.py -v`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage1_concept.py backend/tests/test_stage1_regenerate_section.py
git commit -m "feat(stage1): add /regenerate-section endpoint for concept + dna"
```

---

## Task 2: Backend `POST /api/stage2/regenerate-world-section`

**Files:**
- Modify: `backend/api/stage2_world_char.py`
- Test: `backend/tests/test_stage2_regenerate_world_section.py`

Sections supported: `era`, `power_system`, `core_rules`, `factions`. Reuses `PlannerAgent.generate_world`. Each section maps to a different top-level key (or sub-key for `power_system`) in `world.json`; `core_rules` is the top-level array.

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/test_stage2_regenerate_world_section.py`:

```python
"""Tests for POST /api/stage2/regenerate-world-section.

Sections: era (era + geography + era_social_structure + era_cultural_history),
power_system (object), factions (array), core_rules (top-level array).
Other top-level keys stay byte-identical.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_world_section"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_old_world():
    return {
        "era": "旧时代",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_system": {
            "name": "旧体系",
            "description": "旧描述",
            "stages": ["旧一阶"],
            "core_rules": ["旧规则"],
            "ceilings": ["旧上限"],
            "cost_system": "旧代价",
        },
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


def _mock_world_payload():
    return {
        "era": "新时代",
        "geography": "新地理",
        "era_social_structure": "新社会",
        "era_cultural_history": "新历史",
        "power_system": {
            "name": "新体系",
            "description": "新描述",
            "stages": ["新一阶", "新二阶"],
            "core_rules": ["新规则"],
            "ceilings": ["新上限"],
            "cost_system": "新代价",
        },
        "factions": [
            {"name": "新势力A", "type": "宗门", "goal": "新目标A", "relations": "新关系A"},
        ],
        "core_rules": ["世界规则新"],
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_world_payload(),
            None,
        ))
        yield MockPlanner


def test_regenerate_era_rewrites_only_era_block(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "era", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["era"] == "新时代"
    assert detail["geography"] == "新地理"
    # power_system / factions / core_rules preserved
    assert detail["power_system"] == _seed_old_world()["power_system"]
    assert detail["factions"] == _seed_old_world()["factions"]
    assert detail["core_rules"] == _seed_old_world()["core_rules"]


def test_regenerate_power_system_rewrites_only_power_system(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "power_system", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["power_system"]["name"] == "新体系"
    assert detail["power_system"]["stages"] == ["新一阶", "新二阶"]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["factions"] == _seed_old_world()["factions"]
    assert detail["core_rules"] == _seed_old_world()["core_rules"]


def test_regenerate_core_rules_rewrites_only_top_level_array(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "core_rules", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["core_rules"] == ["世界规则新"]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_system"] == _seed_old_world()["power_system"]
    assert detail["factions"] == _seed_old_world()["factions"]


def test_regenerate_factions_rewrites_only_factions_array(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "factions", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["factions"]) == 1
    assert detail["factions"][0]["name"] == "新势力A"
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_system"] == _seed_old_world()["power_system"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "history", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_world_section.py -v`
Expected: All tests fail with `404 Not Found`.

- [ ] **Step 3: Add the endpoint to `backend/api/stage2_world_char.py`**

Append to `backend/api/stage2_world_char.py` (after `regenerate_character_examples`, at end of file):

```python
from pydantic import BaseModel, Field


class RegenerateWorldSectionPayload(BaseModel):
    section: str
    user_modifications: str = Field(default="", max_length=1000)


@router.post("/regenerate-world-section")
async def regenerate_world_section(
    project_id: str = Query(...),
    payload: RegenerateWorldSectionPayload = None,
):
    """Re-run world generation and merge only the requested section back
    into world.json. Other top-level keys preserved byte-identical."""
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    if payload.section not in ("era", "power_system", "core_rules", "factions"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": f"section 必须是 era/power_system/core_rules/factions，收到 {payload.section}", "detail": {"section": payload.section}},
        )

    existing = _file_manager().read_json(project_id, "world.json") or {}
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    project = _file_manager().read_json(project_id, "project.json") or {}
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
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    merged = dict(existing)
    if payload.section == "era":
        merged["era"] = result.get("era", existing.get("era", ""))
        merged["geography"] = result.get("geography", existing.get("geography", ""))
        merged["era_social_structure"] = result.get(
            "era_social_structure",
            existing.get("era_social_structure", ""),
        )
        merged["era_cultural_history"] = result.get(
            "era_cultural_history",
            existing.get("era_cultural_history", ""),
        )
    elif payload.section == "power_system":
        merged["power_system"] = result.get("power_system", existing.get("power_system", {}))
    elif payload.section == "core_rules":
        merged["core_rules"] = result.get("core_rules", existing.get("core_rules", []))
    else:  # "factions"
        merged["factions"] = result.get("factions", existing.get("factions", []))

    _file_manager().write_json(project_id, "world.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"world.{payload.section} 已重新生成",
        "detail": merged,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_world_section.py -v`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage2_world_char.py backend/tests/test_stage2_regenerate_world_section.py
git commit -m "feat(stage2): add /regenerate-world-section endpoint (4 sections)"
```

---

## Task 3: Backend `POST /api/stage2/regenerate-character-section`

**Files:**
- Modify: `backend/api/stage2_world_char.py`
- Test: `backend/tests/test_stage2_regenerate_character_section.py`

Sections supported: `personality`, `voice_signature`, `current_state`, `unknown`, `relations`. Each section targets a different top-level key on the character. **`voice_signature` must explicitly preserve `behavior_examples`** even when the LLM returns them. **`personality` supports `keep_existing=true`** to append items rather than replace arrays.

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/test_stage2_regenerate_character_section.py`:

```python
"""Tests for POST /api/stage2/regenerate-character-section.

Sections: personality, voice_signature, current_state, unknown, relations.
Special cases:
- voice_signature must preserve behavior_examples (per-card regenerate
  workflow owns that field)
- personality with keep_existing=true appends items to the existing arrays
  instead of replacing them
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_char_section"
CID = "c1"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_old_character():
    return {
        "id": CID,
        "name": "Alice",
        "character_type": "protagonist",
        "personality": {
            "beliefs": ["旧信A"],
            "desires": ["旧欲"],
            "fears": ["旧恐惧"],
            "values": ["旧价值"],
            "core_traits": ["旧特质A", "旧特质B"],
        },
        "current_state": {
            "location": "旧位置",
            "physical_condition": "旧身体",
            "emotional": "旧情绪",
            "known_secrets": ["旧秘密"],
        },
        "voice_signature": {
            "speech_style": "旧说话",
            "thought_patterns": "旧思维",
            "taboos": ["旧禁忌"],
            "behavior_examples": [
                {"situation": "旧场景", "action": "旧动作", "speech_sample": "旧台词"},
            ],
        },
        "unknown_to_character": ["旧未知"],
        "relations": {"c2": {"status": "盟友", "history": [], "last_update_chapter": 1}},
    }


def _mock_new_character():
    return {
        "id": CID,
        "name": "Alice",
        "character_type": "protagonist",
        "personality": {
            "beliefs": ["新信A", "新信B"],
            "desires": ["新欲"],
            "fears": ["新恐惧"],
            "values": ["新价值"],
            "core_traits": ["新特质A"],
        },
        "current_state": {
            "location": "新位置",
            "physical_condition": "新身体",
            "emotional": "新情绪",
            "known_secrets": ["新秘密"],
        },
        "voice_signature": {
            "speech_style": "新说话",
            "thought_patterns": "新思维",
            "taboos": ["新禁忌"],
            # LLM might return behavior_examples — endpoint must NOT touch the
            # existing ones (per-card regenerate-examples owns that field).
            "behavior_examples": [
                {"situation": "新LLM场景", "action": "新LLM动作", "speech_sample": "新LLM台词"},
            ],
        },
        "unknown_to_character": ["新未知"],
        "relations": {"c2": {"status": "宿敌", "history": [], "last_update_chapter": 2}},
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(return_value=(
            _mock_new_character(),
            None,
        ))
        yield MockPlanner


def test_regenerate_voice_signature_preserves_behavior_examples(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "voice_signature", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    # speech_style / thought_patterns / taboos replaced.
    assert detail["voice_signature"]["speech_style"] == "新说话"
    assert detail["voice_signature"]["thought_patterns"] == "新思维"
    assert detail["voice_signature"]["taboos"] == ["新禁忌"]
    # behavior_examples preserved — LLM's examples are NOT merged.
    assert detail["voice_signature"]["behavior_examples"] == seeded["voice_signature"]["behavior_examples"]
    # Other sections unchanged.
    assert detail["personality"] == seeded["personality"]
    assert detail["current_state"] == seeded["current_state"]
    assert detail["unknown_to_character"] == seeded["unknown_to_character"]
    assert detail["relations"] == seeded["relations"]


def test_regenerate_personality_default_replaces_arrays(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "personality", "keep_existing": False, "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["personality"]["beliefs"] == ["新信A", "新信B"]
    assert detail["personality"]["core_traits"] == ["新特质A"]
    # Old arrays gone.
    assert detail["personality"]["fears"] == ["新恐惧"]
    # Other sections unchanged.
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_personality_keep_existing_appends_items(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "personality", "keep_existing": True, "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    # Existing items first, then LLM items appended per-key.
    assert detail["personality"]["beliefs"] == ["旧信A", "新信A", "新信B"]
    assert detail["personality"]["core_traits"] == ["旧特质A", "旧特质B", "新特质A"]
    assert detail["personality"]["desires"] == ["旧欲", "新欲"]
    assert detail["personality"]["fears"] == ["旧恐惧", "新恐惧"]
    assert detail["personality"]["values"] == ["旧价值", "新价值"]


def test_regenerate_current_state_replaces_only_state(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "current_state", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["current_state"]["location"] == "新位置"
    assert detail["current_state"]["emotional"] == "新情绪"
    assert detail["personality"] == seeded["personality"]
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_unknown_replaces_only_array(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "unknown", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["unknown_to_character"] == ["新未知"]
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_relations_replaces_only_relations(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "relations", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["relations"]["c2"]["status"] == "宿敌"
    assert detail["personality"] == seeded["personality"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "growth_curve", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_unknown_character_id_returns_404(mock_planner, tmp_path):
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id=c_missing",
        json={"section": "personality", "user_modifications": ""},
    )
    assert resp.status_code == 404


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
            json={"section": "personality", "user_modifications": ""},
        )
    assert resp.status_code == 503
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_character_section.py -v`
Expected: All tests fail with `404 Not Found`.

- [ ] **Step 3: Add the endpoint to `backend/api/stage2_world_char.py`**

Append to `backend/api/stage2_world_char.py` (after the regenerate-world-section endpoint):

```python
class RegenerateCharacterSectionPayload(BaseModel):
    section: str
    keep_existing: bool = False
    user_modifications: str = Field(default="", max_length=1000)


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
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    if payload.section not in ("personality", "voice_signature", "current_state", "unknown", "relations"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": f"section 必须是 personality/voice_signature/current_state/unknown/relations，收到 {payload.section}", "detail": {"section": payload.section}},
        )

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _not_found(f"角色不存在: {character_id}")

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
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=target.get("character_type", "supporting"),
            existing_characters=[target],
            genre=genre,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    if payload.section == "personality":
        new_p = result.get("personality", {}) or {}
        if payload.keep_existing:
            existing_p = target.get("personality", {}) or {}
            merged_p = {
                "beliefs": existing_p.get("beliefs", []) + new_p.get("beliefs", []),
                "desires": existing_p.get("desires", []) + new_p.get("desires", []),
                "fears": existing_p.get("fears", []) + new_p.get("fears", []),
                "values": existing_p.get("values", []) + new_p.get("values", []),
                "core_traits": existing_p.get("core_traits", []) + new_p.get("core_traits", []),
            }
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
    else:  # "relations"
        target["relations"] = result.get("relations", {}) or {}

    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": target,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_character_section.py -v`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage2_world_char.py backend/tests/test_stage2_regenerate_character_section.py
git commit -m "feat(stage2): add /regenerate-character-section endpoint (5 sections)"
```

---

## Task 4: Backend `POST /api/stage3/regenerate-novel-outline-section`

**Files:**
- Modify: `backend/api/stage3_outline.py`
- Test: `backend/tests/test_stage3_regenerate_novel_outline_section.py`

Sections supported: `core_conflict`, `volumes`, `mc_growth`, `key_plot`. Each section rewrites only the matching top-level field of `novel_outline.json`. Preserve `generated_at` from the existing file (only `updated_at` is refreshed).

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/test_stage3_regenerate_novel_outline_section.py`:

```python
"""Tests for POST /api/stage3/regenerate-novel-outline-section.

Sections: core_conflict (string), volumes (array), mc_growth (array),
key_plot (array). Other top-level fields stay byte-identical.
generated_at preserved; updated_at refreshed.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_outline_section"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_old_outline():
    return {
        "core_conflict_theme": "旧核心冲突与主题",
        "volumes": [
            {"name": "旧卷一", "chapter_range": "1-10", "summary": "旧摘要", "key_events": ["旧事件"]},
        ],
        "mc_growth_arc": [
            {"label": "旧成长一", "target_chapter_range": "1-5", "description": "旧描述"},
        ],
        "key_plot_points": [
            {"title": "旧情节点", "must_appear_in_volume": "卷一", "description": "旧描述", "trigger_chapter_hint": "1"},
        ],
        "generated_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }


def _mock_new_outline():
    return {
        "core_conflict_theme": "新核心冲突与主题",
        "volumes": [
            {"name": "新卷一", "chapter_range": "1-12", "summary": "新摘要", "key_events": ["新事件"]},
            {"name": "新卷二", "chapter_range": "13-25", "summary": "新二摘要", "key_events": []},
        ],
        "mc_growth_arc": [
            {"label": "新成长一", "target_chapter_range": "1-3", "description": "新描述"},
        ],
        "key_plot_points": [
            {"title": "新情节点", "must_appear_in_volume": "卷一", "description": "新描述", "trigger_chapter_hint": "2"},
        ],
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_novel_outline = AsyncMock(return_value=(
            _mock_new_outline(),
            None,
        ))
        yield MockPlanner


def test_regenerate_core_conflict_replaces_only_string(mock_planner, tmp_path):
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "core_conflict", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["core_conflict_theme"] == "新核心冲突与主题"
    assert detail["volumes"] == seeded["volumes"]
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]
    assert detail["key_plot_points"] == seeded["key_plot_points"]
    assert detail["generated_at"] == seeded["generated_at"]


def test_regenerate_volumes_replaces_only_volumes(mock_planner, tmp_path):
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "volumes", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["volumes"]) == 2
    assert detail["volumes"][0]["name"] == "新卷一"
    assert detail["core_conflict_theme"] == seeded["core_conflict_theme"]
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]
    assert detail["key_plot_points"] == seeded["key_plot_points"]


def test_regenerate_mc_growth_replaces_only_mc_growth(mock_planner, tmp_path):
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "mc_growth", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["mc_growth_arc"][0]["label"] == "新成长一"
    assert detail["volumes"] == seeded["volumes"]


def test_regenerate_key_plot_replaces_only_key_plot(mock_planner, tmp_path):
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "key_plot", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["key_plot_points"][0]["title"] == "新情节点"
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write(tmp_path, "novel_outline.json", _seed_old_outline())
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "themes", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _write(tmp_path, "novel_outline.json", _seed_old_outline())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_novel_outline = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
            json={"section": "volumes", "user_modifications": ""},
        )
    assert resp.status_code == 503
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source venv/bin/activate && pytest backend/tests/test_stage3_regenerate_novel_outline_section.py -v`
Expected: All tests fail with `404 Not Found`.

- [ ] **Step 3: Add the endpoint to `backend/api/stage3_outline.py`**

Append to `backend/api/stage3_outline.py` (after `update_novel_outline`):

```python
from pydantic import BaseModel, Field


class RegenerateNovelOutlineSectionPayload(BaseModel):
    section: str
    user_modifications: str = Field(default="", max_length=1000)


@router.post("/regenerate-novel-outline-section")
async def regenerate_novel_outline_section(
    project_id: str = Query(...),
    payload: RegenerateNovelOutlineSectionPayload = None,
):
    """Re-run novel-outline generation and merge only the requested section
    back into novel_outline.json. Other top-level fields preserved."""
    from backend.agents.planner import PlannerAgent
    from datetime import datetime

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    if payload.section not in ("core_conflict", "volumes", "mc_growth", "key_plot"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": f"section 必须是 core_conflict/volumes/mc_growth/key_plot，收到 {payload.section}", "detail": {"section": payload.section}},
        )

    existing = fm.read_json(project_id, "novel_outline.json") or {}
    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json") or {}
    world = fm.read_json(project_id, "world.json") or {}
    characters_data = fm.read_json(project_id, "characters.json") or {}
    project = fm.read_json(project_id, "project.json") or {}
    map_data = fm.read_json(project_id, "map.json")

    characters = characters_data.get("characters", [])
    min_words = project.get("min_words", 2000)
    target_total_words = project.get("target_total_words", 1_000_000)
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _resp = await agent.generate_novel_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            characters=characters,
            target_total_words=target_total_words,
            min_words=min_words,
            map_data=map_data,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    merged = dict(existing)
    if payload.section == "core_conflict":
        merged["core_conflict_theme"] = result.get(
            "core_conflict_theme",
            existing.get("core_conflict_theme", ""),
        )
    elif payload.section == "volumes":
        merged["volumes"] = result.get("volumes", existing.get("volumes", []))
    elif payload.section == "mc_growth":
        merged["mc_growth_arc"] = result.get(
            "mc_growth_arc",
            existing.get("mc_growth_arc", []),
        )
    else:  # "key_plot"
        merged["key_plot_points"] = result.get(
            "key_plot_points",
            existing.get("key_plot_points", []),
        )

    # Preserve generated_at from the existing file; refresh updated_at only.
    now = datetime.utcnow().isoformat()
    if existing.get("generated_at"):
        merged["generated_at"] = existing["generated_at"]
    else:
        merged["generated_at"] = now
    merged["updated_at"] = now

    fm.write_json(project_id, "novel_outline.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": merged,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source venv/bin/activate && pytest backend/tests/test_stage3_regenerate_novel_outline_section.py -v`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage3_outline.py backend/tests/test_stage3_regenerate_novel_outline_section.py
git commit -m "feat(stage3): add /regenerate-novel-outline-section endpoint (4 sections)"
```

---

## Task 5: Frontend `SectionRegenerateButton` shared component

**Files:**
- Create: `frontend/src/components/shared/SectionRegenerateButton.tsx`
- Create: `frontend/src/test/SectionRegenerateButton.test.tsx`

A small icon button that opens the existing `RegenerateModal`, owns its busy state, and forwards `onRegenerate(text)` to the parent. Used by every wizard section in tasks 7-10.

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/test/SectionRegenerateButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SectionRegenerateButton } from "../components/shared/SectionRegenerateButton";

describe("SectionRegenerateButton", () => {
  it("renders an icon button with the section's test id", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
        testId="world-power-system-regenerate"
      />,
    );
    const btn = screen.getByTestId("world-power-system-regenerate");
    expect(btn).toBeInTheDocument();
  });

  it("opens the RegenerateModal when clicked", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    // Modal title includes the target.
    expect(screen.getByText(/重新生成 — 力量体系/)).toBeInTheDocument();
  });

  it("calls onRegenerate with the typed text on confirm", async () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "更紧凑" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("更紧凑"));
  });

  it("closes the modal on cancel without calling onRegenerate", () => {
    const onRegenerate = vi.fn();
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("regenerate-modal")).not.toBeInTheDocument();
  });

  it("disables the button while onRegenerate is in flight", async () => {
    let resolveFn!: () => void;
    const onRegenerate = vi.fn(
      () => new Promise<void>((r) => { resolveFn = r; }),
    );
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("world-power-system-regenerate")).toBeDisabled(),
    );
    resolveFn();
    await waitFor(() =>
      expect(screen.getByTestId("world-power-system-regenerate")).not.toBeDisabled(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/test/SectionRegenerateButton.test.tsx`
Expected: FAIL — module not found (`SectionRegenerateButton` does not exist yet).

- [ ] **Step 3: Create the component**

Create `frontend/src/components/shared/SectionRegenerateButton.tsx`:

```tsx
import { useState } from "react";
import { RegenerateModal } from "./RegenerateModal";

interface SectionRegenerateButtonProps {
  /** Modal title suffix, e.g. "力量体系". */
  target: string;
  /** Called with the user's modification text on confirm. */
  onRegenerate: (userModifications: string) => Promise<void>;
  /** Disables the icon while the parent is busy for an unrelated reason. */
  disabled?: boolean;
  /** Test id; default `section-regenerate-${target}`. */
  testId?: string;
}

export function SectionRegenerateButton({
  target,
  onRegenerate,
  disabled = false,
  testId,
}: SectionRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (text: string) => {
    setBusy(true);
    try {
      await onRegenerate(text);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={testId ?? `section-regenerate-${target}`}
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        aria-label={`重新生成 — ${target}`}
        title={`重新生成 — ${target}`}
        className="inline-flex items-center justify-center h-6 w-6 rounded text-system-log/50 hover:text-primary-container hover:bg-surface-container transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[14px]">refresh</span>
      </button>
      <RegenerateModal
        open={open}
        target={target}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/test/SectionRegenerateButton.test.tsx`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/SectionRegenerateButton.tsx frontend/src/test/SectionRegenerateButton.test.tsx
git commit -m "feat(shared): add SectionRegenerateButton for per-section regenerate"
```

---

## Task 6: Frontend API client wrappers

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/test/client.test.ts`

Add four thin POST wrappers. Each returns the merged entity (Concept | StoryDNA, World, Character, NovelOutline) so the caller can `setState` directly.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/test/client.test.ts` (inside the existing `describe("stage4 exemptions + sf-log + precheck client", ...)` block, before the closing `});`):

```tsx
  it("regenerateConceptSection_sendsSectionAndModifications", async () => {
    await api.regenerateConceptSection("p1", "concept", "更热血");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage1/regenerate-section?project_id=p1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "concept",
      user_modifications: "更热血",
    });
  });

  it("regenerateWorldSection_postsBody", async () => {
    await api.regenerateWorldSection("p1", "power_system", "");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage2/regenerate-world-section?project_id=p1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "power_system",
      user_modifications: "",
    });
  });

  it("regenerateCharacterSection_includesKeepExisting", async () => {
    await api.regenerateCharacterSection("p1", "c1", "personality", { keepExisting: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage2/regenerate-character-section?project_id=p1&character_id=c1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "personality",
      keep_existing: true,
      user_modifications: "",
    });
  });

  it("regenerateNovelOutlineSection_postsBody", async () => {
    await api.regenerateNovelOutlineSection("p1", "volumes", "");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage3/regenerate-novel-outline-section?project_id=p1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "volumes",
      user_modifications: "",
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/test/client.test.ts`
Expected: The 4 new tests fail with "regenerateConceptSection is not a function" / similar.

- [ ] **Step 3: Add the four wrappers to `frontend/src/api/client.ts`**

Insert the four wrappers in the `api = { ... }` object (after the existing `regenerateCharacterExamples` wrapper, before `growthWorkshopCheck`):

```ts
  regenerateConceptSection: (
    projectId: string,
    section: "concept" | "dna",
    userModifications: string = "",
  ): Promise<ConceptResponse> =>
    request<ConceptResponse>(
      "POST",
      `/stage1/regenerate-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),

  regenerateWorldSection: (
    projectId: string,
    section: "era" | "power_system" | "core_rules" | "factions",
    userModifications: string = "",
  ): Promise<World> =>
    request<World>(
      "POST",
      `/stage2/regenerate-world-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),

  regenerateCharacterSection: (
    projectId: string,
    characterId: string,
    section: "personality" | "voice_signature" | "current_state" | "unknown" | "relations",
    opts: { keepExisting?: boolean; userModifications?: string } = {},
  ): Promise<Character> =>
    request<Character>(
      "POST",
      `/stage2/regenerate-character-section?project_id=${encodeURIComponent(projectId)}&character_id=${encodeURIComponent(characterId)}`,
      {
        section,
        keep_existing: opts.keepExisting ?? false,
        user_modifications: opts.userModifications ?? "",
      },
    ),

  regenerateNovelOutlineSection: (
    projectId: string,
    section: "core_conflict" | "volumes" | "mc_growth" | "key_plot",
    userModifications: string = "",
  ): Promise<NovelOutline> =>
    request<NovelOutline>(
      "POST",
      `/stage3/regenerate-novel-outline-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/test/client.test.ts`
Expected: All client.test.ts tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/test/client.test.ts
git commit -m "feat(client): add 4 per-section regenerate API wrappers"
```

---

## Task 7: Frontend `ConceptStep` per-section regenerate

**Files:**
- Modify: `frontend/src/components/wizard/ConceptStep.tsx`

Two sections: `concept` (the 6 inline fields title/premise/tone/theme/target_audience/style_template, wrapped under a new "概念信息" header) and `dna` ("核心矛盾", already a labeled section). Each gets a `SectionRegenerateButton`.

- [ ] **Step 1: Add the import + state in `ConceptStep.tsx`**

Edit `frontend/src/components/wizard/ConceptStep.tsx`. After `import { RegenerateModal } from "../shared/RegenerateModal";` add:

```tsx
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
```

- [ ] **Step 2: Add a per-section regenerate handler**

After `handleNext` (inside `ConceptStep`), add:

```tsx
  const handleSectionRegenerate = (section: "concept" | "dna") => async (mods: string) => {
    try {
      const result = await api.regenerateConceptSection(projectId, section, mods);
      if (section === "concept" && result.concept) {
        setConcept(result.concept);
        wizard.markStepGenerated(1, { concept: result.concept, story_dna: dnaRef.current });
      } else if (section === "dna" && result.story_dna) {
        setDna(result.story_dna);
        wizard.markStepGenerated(1, { concept: conceptRef.current, story_dna: result.story_dna });
      }
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "板块重新生成失败");
    }
  };
```

- [ ] **Step 3: Wrap the 6 inline concept fields under a labeled "概念信息" header with an icon**

Locate the existing `<div data-testid="concept-form"` block. Insert a new wrapper div **just inside** it (before the existing `<div>` containing the `<label>标题</label>` field). The new wrapper adds the section header with the regenerate icon, and the 6 inline field blocks remain children of a child `<div className="space-y-3">`:

```tsx
        <div data-testid="concept-form" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
              概念信息
            </div>
            <SectionRegenerateButton
              target="概念信息"
              onRegenerate={handleSectionRegenerate("concept")}
              testId="concept-info-regenerate"
            />
          </div>
          <div className="space-y-3">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">标题</label>
            <input
              data-testid="concept-title"
              value={concept.title}
              onChange={(e) => setConcept({ ...concept, title: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">前提</label>
            <AutoTextarea
              data-testid="concept-premise"
              value={concept.premise}
              onChange={(e) => setConcept({ ...concept, premise: e.target.value })}
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">基调</label>
              <input
                data-testid="concept-tone"
                value={concept.tone}
                onChange={(e) => setConcept({ ...concept, tone: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">主题</label>
              <input
                data-testid="concept-theme"
                value={concept.theme}
                onChange={(e) => setConcept({ ...concept, theme: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">目标读者</label>
              <input
                value={concept.target_audience}
                onChange={(e) => setConcept({ ...concept, target_audience: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">风格模板</label>
              <input
                value={concept.style_template}
                onChange={(e) => setConcept({ ...concept, style_template: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
          </div>
```

- [ ] **Step 4: Wrap the "核心矛盾" section header in a flex row with the regenerate icon**

Locate the existing `<div className="border-t border-outline-variant pt-3 space-y-2">` block (the one containing "核心矛盾"). Replace its inner `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾</div>` with:

```tsx
          <div className="border-t border-outline-variant pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">核心矛盾</div>
              <SectionRegenerateButton
                target="核心矛盾"
                onRegenerate={handleSectionRegenerate("dna")}
                testId="concept-dna-regenerate"
              />
            </div>
```

(Keep the rest of that block — the `<AutoTextarea>` for `statement` and the 2-column `side_a`/`side_b` — unchanged.)

- [ ] **Step 5: Run all frontend tests to verify nothing else regressed**

Run: `cd frontend && npx vitest run src/test/InitWizardModal.test.tsx`
Expected: existing tests still pass. (No new assertions added in this task — that's done in task 11.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/ConceptStep.tsx
git commit -m "feat(wizard): add per-section regenerate for concept + dna"
```

---

## Task 8: Frontend `WorldStep` per-section regenerate

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx`

Four sections: `时代与地理`, `力量体系`, `世界规则`, `势力分布`. Each gets a `SectionRegenerateButton` next to its existing labeled header.

- [ ] **Step 1: Add the import**

Edit `frontend/src/components/wizard/WorldStep.tsx`. After `import { RegenerateModal } from "../shared/RegenerateModal";` add:

```tsx
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
```

- [ ] **Step 2: Add a per-section regenerate handler**

After `handleNext` (inside `WorldStep`), add:

```tsx
  const handleSectionRegenerate = (
    section: "era" | "power_system" | "core_rules" | "factions",
  ) => async (mods: string) => {
    try {
      const result = await api.regenerateWorldSection(projectId, section, mods);
      const merged = { ...EMPTY_WORLD, ...result };
      setWorld(merged);
      wizard.markStepGenerated(2, { world: merged });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "板块重新生成失败");
    }
  };
```

- [ ] **Step 3: Wrap each of the 4 section headers with a flex row + icon**

There are 4 locations to change — each replaces a bare `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">SECTION</div>` with a flex row that has the same label on the left and the regenerate icon on the right.

**Location A** (时代与地理): Replace the line `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">时代与地理</div>` with:

```tsx
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">时代与地理</div>
              <SectionRegenerateButton
                target="时代与地理"
                onRegenerate={handleSectionRegenerate("era")}
                testId="world-era-regenerate"
              />
            </div>
```

**Location B** (力量体系): Replace the line `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">力量体系</div>` with:

```tsx
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">力量体系</div>
              <SectionRegenerateButton
                target="力量体系"
                onRegenerate={handleSectionRegenerate("power_system")}
                testId="world-power-system-regenerate"
              />
            </div>
```

**Location C** (世界规则): Replace the line `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">世界规则</div>` with:

```tsx
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">世界规则</div>
              <SectionRegenerateButton
                target="世界规则"
                onRegenerate={handleSectionRegenerate("core_rules")}
                testId="world-core-rules-regenerate"
              />
            </div>
```

**Location D** (势力分布): The existing markup already wraps the label in a flex row with the "+ 添加势力" button on the right. Insert the `SectionRegenerateButton` between the label and the add button. Replace:

```tsx
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">势力分布</div>
              <button
                type="button"
                data-testid="world-faction-add"
                onClick={addFaction}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed
                           border-system-log/30 rounded text-system-log/60
                           hover:text-primary-container hover:border-primary-container/50
                           transition-colors disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-xs">add</span>
                添加势力
              </button>
            </div>
```

with:

```tsx
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">势力分布</div>
              <div className="flex items-center gap-1">
                <SectionRegenerateButton
                  target="势力分布"
                  onRegenerate={handleSectionRegenerate("factions")}
                  testId="world-factions-regenerate"
                />
                <button
                  type="button"
                  data-testid="world-faction-add"
                  onClick={addFaction}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed
                             border-system-log/30 rounded text-system-log/60
                             hover:text-primary-container hover:border-primary-container/50
                             transition-colors disabled:opacity-30"
                >
                  <span className="material-symbols-outlined text-xs">add</span>
                  添加势力
                </button>
              </div>
            </div>
```

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/InitWizardModal.test.tsx`
Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/WorldStep.tsx
git commit -m "feat(wizard): add per-section regenerate for world (4 sections)"
```

---

## Task 9: Frontend `CharacterStep` per-section regenerate (per-card)

**Files:**
- Modify: `frontend/src/components/wizard/CharacterStep.tsx`

Five sections per card: `人格层`, `声音签名`, `当前状态`, `角色不知道的事`, `角色关系`. Each gets a `SectionRegenerateButton`. The handler needs to update both the targeted character in the `characters` list and the `current` field if it points to the same id.

- [ ] **Step 1: Add the import**

Edit `frontend/src/components/wizard/CharacterStep.tsx`. After `import { RegenerateModal } from "../shared/RegenerateModal";` add:

```tsx
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
```

- [ ] **Step 2: Add a per-section regenerate handler**

After `handleRegenerateExamples` (inside `CharacterStep`), add:

```tsx
  const handleSectionRegenerate = (
    characterId: string,
    section: "personality" | "voice_signature" | "current_state" | "unknown" | "relations",
    opts: { keepExisting?: boolean } = {},
  ) => async (mods: string) => {
    try {
      const updated = await api.regenerateCharacterSection(
        projectId,
        characterId,
        section,
        { keepExisting: opts.keepExisting, userModifications: mods },
      );
      setCharacters((prev) => {
        const list = (prev?.characters ?? []).map((c) =>
          c.id === characterId ? { ...c, ...updated } : c,
        );
        return { characters: list, current: prev?.current ?? list[0] };
      });
      // Refresh wizard.data so the indicator stays accurate and prefill
      // re-hydration doesn't overwrite our change. Don't saveStep here —
      // the user may still be editing other sections; the footer "确认
      // 修改并继续" will commit the full list.
      const list = (charactersRef.current?.characters ?? []).map((c) =>
        c.id === characterId ? { ...c, ...updated } : c,
      );
      wizard.markStepGenerated(3, {
        characters: { characters: list, current: charactersRef.current?.current ?? list[0] },
      });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "板块重新生成失败");
    }
  };
```

Note: The `wizard.markStepGenerated` call is a no-op here (the empty payload is ignored); we rely on the subsequent `saveStep` to refresh `wizard.data.characters`. This is intentional — the section regenerate only touches one card, but the wizard indicator cares about the whole list being persisted.

- [ ] **Step 3: Wrap each of the 5 section headers in each character card**

There are 5 occurrences in the `<li>` body. Each replaces a bare `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">SECTION</div>` with a flex row.

**Location A** (人格层). The current line is wrapped in `<div data-testid={`character-${c.id}-personality`} className="space-y-2 border-t border-outline-variant pt-3">` then `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>`. Replace the inner label div with:

```tsx
                    <div className="flex items-center justify-between">
                      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>
                      <SectionRegenerateButton
                        target={`${c.name || c.id} · 人格层`}
                        onRegenerate={handleSectionRegenerate(c.id, "personality")}
                        testId={`character-${c.id}-personality-regenerate`}
                      />
                    </div>
```

**Location B** (声音签名). Same pattern. Replace the line `<div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>` with:

```tsx
                    <div className="flex items-center justify-between">
                      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>
                      <SectionRegenerateButton
                        target={`${c.name || c.id} · 声音签名`}
                        onRegenerate={handleSectionRegenerate(c.id, "voice_signature")}
                        testId={`character-${c.id}-voice-regenerate`}
                      />
                    </div>
```

**Location C** (当前状态). Same pattern:

```tsx
                    <div className="flex items-center justify-between">
                      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">当前状态</div>
                      <SectionRegenerateButton
                        target={`${c.name || c.id} · 当前状态`}
                        onRegenerate={handleSectionRegenerate(c.id, "current_state")}
                        testId={`character-${c.id}-current-state-regenerate`}
                      />
                    </div>
```

**Location D** (角色不知道的事). Same pattern:

```tsx
                    <div className="flex items-center justify-between">
                      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色不知道的事</div>
                      <SectionRegenerateButton
                        target={`${c.name || c.id} · 未知`}
                        onRegenerate={handleSectionRegenerate(c.id, "unknown")}
                        testId={`character-${c.id}-unknown-regenerate`}
                      />
                    </div>
```

**Location E** (角色关系). Same pattern:

```tsx
                    <div className="flex items-center justify-between">
                      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色关系</div>
                      <SectionRegenerateButton
                        target={`${c.name || c.id} · 角色关系`}
                        onRegenerate={handleSectionRegenerate(c.id, "relations")}
                        testId={`character-${c.id}-relations-regenerate`}
                      />
                    </div>
```

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/InitWizardModal.test.tsx src/test/CharacterStep.behavior_examples.test.tsx`
Expected: existing tests pass (behavior_examples regenerate flow is independent and untouched).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/CharacterStep.tsx
git commit -m "feat(wizard): add per-section regenerate for character (5 sections/card)"
```

---

## Task 10: Frontend `OutlineStep` per-section regenerate

**Files:**
- Modify: `frontend/src/components/wizard/OutlineStep.tsx`

Four sections: `核心冲突与主题`, `分卷 / 阶段划分`, `主角成长节点`, `关键情节点`. The first already has an inline `<label>` that becomes a flex-row section header; the others get new section headers wrapping existing fields. **NOTE**: the existing step only renders volumes (no UI for mc_growth_arc / key_plot_points in the wizard — see the comment "详细分卷/情节点编辑可在工作台的大纲标签页内进行"). So we only add section icons for `core_conflict` and `volumes` in this task. Add placeholders for `mc_growth` and `key_plot` if the user has those fields populated on the model — see step 3.

- [ ] **Step 1: Add the import**

Edit `frontend/src/components/wizard/OutlineStep.tsx`. After `import { RegenerateModal } from "../shared/RegenerateModal";` add:

```tsx
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
```

- [ ] **Step 2: Add a per-section regenerate handler**

After `handleNext` (inside `OutlineStep`), add:

```tsx
  const handleSectionRegenerate = (
    section: "core_conflict" | "volumes" | "mc_growth" | "key_plot",
  ) => async (mods: string) => {
    try {
      const result = await api.regenerateNovelOutlineSection(projectId, section, mods);
      setOutline(result);
      wizard.markStepGenerated(5, { novel_outline: result });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "板块重新生成失败");
    }
  };
```

- [ ] **Step 3: Wrap the 核心冲突与主题 label in a flex row + icon**

Locate the existing `<label className="block font-label-mono text-system-log mb-1 text-xs">核心冲突与主题</label>` and the `<AutoTextarea>` immediately following it (which displays `outline.core_conflict_theme`). Replace the `<label>` with a flex row containing the label and the icon, and move the `<AutoTextarea>` outside the flex row. Find this block:

```tsx
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">核心冲突与主题</label>
            <AutoTextarea
              value={outline.core_conflict_theme}
              onChange={(e) => setOutline({ ...outline, core_conflict_theme: e.target.value })}
              rows={5}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>
```

Replace with:

```tsx
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="font-label-mono text-system-log text-xs">核心冲突与主题</div>
              <SectionRegenerateButton
                target="核心冲突与主题"
                onRegenerate={handleSectionRegenerate("core_conflict")}
                testId="outline-core-conflict-regenerate"
              />
            </div>
            <AutoTextarea
              value={outline.core_conflict_theme}
              onChange={(e) => setOutline({ ...outline, core_conflict_theme: e.target.value })}
              rows={5}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>
```

- [ ] **Step 4: Wrap the 分卷/阶段划分 label in a flex row + icon**

Locate the existing `<div className="font-label-mono text-system-log mb-2 text-[10px] uppercase tracking-wider">分卷 / 阶段划分</div>` (inside the `{outline.volumes.length > 0 && ...}` conditional) and replace with:

```tsx
              <div className="flex items-center justify-between mb-2">
                <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">分卷 / 阶段划分</div>
                <SectionRegenerateButton
                  target="分卷划分"
                  onRegenerate={handleSectionRegenerate("volumes")}
                  testId="outline-volumes-regenerate"
                />
              </div>
```

- [ ] **Step 5: Add an mc_growth section header above the existing count line**

The current OutlineStep has no editable UI for `mc_growth_arc` (per the comment "详细分卷/情节点编辑可在工作台的大纲标签页内进行"). Add a small section header so the regenerate icon has a labeled home. Find this block:

```tsx
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            {outline.volumes.length} 个分卷 · {outline.mc_growth_arc.length} 个主角成长节点 · {outline.key_plot_points.length} 个关键情节点
          </div>
```

Replace with three sibling sections (one per array). The volumes count stays inline since it's already covered by the section above; mc_growth and key_plot get their own labeled row with count + icon:

```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between border border-outline-variant rounded-lg px-3 py-2">
              <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
                主角成长节点 · {outline.mc_growth_arc.length}
              </span>
              <SectionRegenerateButton
                target="主角成长节点"
                onRegenerate={handleSectionRegenerate("mc_growth")}
                testId="outline-mc-growth-regenerate"
              />
            </div>
            <div className="flex items-center justify-between border border-outline-variant rounded-lg px-3 py-2">
              <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
                关键情节点 · {outline.key_plot_points.length}
              </span>
              <SectionRegenerateButton
                target="关键情节点"
                onRegenerate={handleSectionRegenerate("key_plot")}
                testId="outline-key-plot-regenerate"
              />
            </div>
          </div>
          <p className="font-body-ui text-system-log/60 text-xs">
            详细分卷/情节点编辑可在工作台的大纲标签页内进行。
          </p>
```

(Keep the existing informational paragraph below the grid.)

- [ ] **Step 7: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/InitWizardModal.test.tsx`
Expected: existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/wizard/OutlineStep.tsx
git commit -m "feat(wizard): add per-section regenerate for novel outline (4 sections)"
```

---

## Task 11: Frontend integration tests

**Files:**
- Modify: `frontend/src/test/InitWizardModal.test.tsx`

Add one test per step that the section regenerate icon is rendered, and one test that clicking the icon calls the right API wrapper. Reuse the test setup that the file already has (mocked `api.*`, `WizardProvider`, project fixtures).

- [ ] **Step 1: Read the existing test setup**

Run: `head -120 frontend/src/test/InitWizardModal.test.tsx`

Identify: (a) how `api` is mocked (e.g. `vi.mock("../api/client")`); (b) what helper renders the wizard; (c) which project fixtures are seeded (e.g. `world.json`, `characters.json`). Use the same patterns.

- [ ] **Step 2: Add `concept` section regenerate test**

Append to `frontend/src/test/InitWizardModal.test.tsx`:

```tsx
  it("concept-step renders section regenerate icon for 概念信息", async () => {
    // Render the modal with concept.json + dna already on disk.
    // ... (use existing test setup)
    await waitFor(() => screen.getByTestId("concept-form"));
    expect(screen.getByTestId("concept-info-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("concept-dna-regenerate")).toBeInTheDocument();
  });

  it("clicking concept-info-regenerate calls regenerateConceptSection", async () => {
    // ... (use existing test setup)
    await waitFor(() => screen.getByTestId("concept-info-regenerate"));
    fireEvent.click(screen.getByTestId("concept-info-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(api.regenerateConceptSection).toHaveBeenCalledWith(
        expect.any(String),
        "concept",
        expect.any(String),
      ),
    );
  });
```

Adjust the project fixture to seed `concept_and_dna.json` so the form renders.

- [ ] **Step 3: Add `world` section regenerate test**

Append:

```tsx
  it("world-step renders 4 section regenerate icons", async () => {
    // ... (use existing test setup; seed world.json)
    await waitFor(() => screen.getByTestId("world-form"));
    expect(screen.getByTestId("world-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-factions-regenerate")).toBeInTheDocument();
  });

  it("clicking world-power-system-regenerate calls regenerateWorldSection", async () => {
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(
        expect.any(String),
        "power_system",
        expect.any(String),
      ),
    );
  });
```

- [ ] **Step 4: Add `character` section regenerate test**

Append:

```tsx
  it("character-step renders 5 section regenerate icons per card", async () => {
    // ... (use existing test setup; seed characters.json with 1 card)
    await waitFor(() => screen.getByTestId("character-form"));
    expect(screen.getByTestId(/character-.*-personality-regenerate/)).toBeInTheDocument();
    expect(screen.getByTestId(/character-.*-voice-regenerate/)).toBeInTheDocument();
    expect(screen.getByTestId(/character-.*-current-state-regenerate/)).toBeInTheDocument();
    expect(screen.getByTestId(/character-.*-unknown-regenerate/)).toBeInTheDocument();
    expect(screen.getByTestId(/character-.*-relations-regenerate/)).toBeInTheDocument();
  });

  it("clicking character-personality-regenerate calls regenerateCharacterSection", async () => {
    const cardId = "c1";
    fireEvent.click(screen.getByTestId(`character-${cardId}-personality-regenerate`));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(api.regenerateCharacterSection).toHaveBeenCalledWith(
        expect.any(String),
        cardId,
        "personality",
        expect.objectContaining({ keepExisting: false }),
      ),
    );
  });
```

- [ ] **Step 5: Add `outline` section regenerate test**

Append:

```tsx
  it("outline-step renders 4 section regenerate icons", async () => {
    // ... (use existing test setup; seed novel_outline.json with volumes)
    await waitFor(() => screen.getByTestId("outline-form"));
    expect(screen.getByTestId("outline-core-conflict-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-volumes-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-mc-growth-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-key-plot-regenerate")).toBeInTheDocument();
  });

  it("clicking outline-volumes-regenerate calls regenerateNovelOutlineSection", async () => {
    fireEvent.click(screen.getByTestId("outline-volumes-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(api.regenerateNovelOutlineSection).toHaveBeenCalledWith(
        expect.any(String),
        "volumes",
        expect.any(String),
      ),
    );
  });
```

- [ ] **Step 6: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/InitWizardModal.test.tsx`
Expected: All new tests pass. If existing tests fail because the wizard form now renders new section headers in their default state, fix the mocks/setup so they accept the new layout.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/test/InitWizardModal.test.tsx
git commit -m "test(wizard): cover per-section regenerate icons + click handlers"
```

---

## Task 12: Final verification

**Files:** none — runs the full test suite and a manual smoke check.

- [ ] **Step 1: Run full backend test suite**

Run: `source venv/bin/activate && pytest -q`
Expected: all pass (the 4 new test files + the existing regenerate-examples test + everything else).

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 3: Smoke test in browser**

1. `source venv/bin/activate && uvicorn backend.main:app --reload --port 8000` (in one terminal)
2. `cd frontend && npm run dev` (in another)
3. Open `http://localhost:5173`. Create or open a project that has at least `concept_and_dna.json`, `world.json`, `characters.json`, and `novel_outline.json` on disk.
4. Open the wizard (bookshelf → click book → "继续编辑"). For each step:
   - Confirm every labeled section header has a refresh icon next to it.
   - Click the icon, type a modification, confirm. Check the corresponding `.json` file on disk: only the targeted section's fields should change; other fields byte-identical.
   - Trigger a regenerate failure (e.g. set `MINIMAX_API_KEY=invalid` and restart): the error banner at the top of the step renders; busy state clears; the icon is re-enabled.
   - Click icon A, then immediately click icon B in a different section: both finalize correctly without clobbering each other.

- [ ] **Step 4: Final commit (only if smoke test surfaced anything)**

If the smoke test surfaced any fix, commit it. Otherwise nothing to do.

```bash
git status  # expect clean
```