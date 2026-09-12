"""Tests for /three-b/meta-decompose + invoke_meta_llm + override behavior.

Covers:
- POST /meta-decompose writes project-level firstness_decompose override
- POST /meta-decompose 503 on LLM exception
- POST /meta-decompose 422 on empty LLM response
- POST /meta-decompose 422 on too-short prompt (Pydantic)
- Subsequent POST /decompose reads the meta-generated override
- POST /decompose WITHOUT override uses YAML defaults
- POST /decompose AFTER user edits prompt_overrides.json uses the edited prompt
- POST /decompose does NOT call invoke_meta_llm (regenerate path)
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.creative_os.three_b_engine import (
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    Unit,
    DimensionDecomposition,
    Dimension,
    atomic_write_state,
)
from backend.main import app
from backend.services.prompt_override_store import (
    PromptOverrideStore,
    get_project_override_store,
    reset_project_override_store,
)

client = TestClient(app)
PROJ_PREFIX = "p_meta_"
BASE = "/api/v1/projects/{project_id}/creative/diverge/three-b"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    reset_project_override_store()
    yield tmp_path
    reset_project_override_store()


@pytest.fixture(autouse=True)
def _reset_engine_state():
    yield
    if hasattr(app.state, "three_b_engine"):
        del app.state.three_b_engine


@pytest.fixture
def mock_router():
    return AsyncMock()


def _route(path: str, project_id: str) -> str:
    return BASE.format(project_id=project_id) + path


def _make_engine_with_overrides(mock_router: AsyncMock) -> ThreeBEngine:
    """Engine wired to the real PromptOverrideStore (per-project file at tmp_path)."""
    return ThreeBEngine(
        model_router=mock_router,
        override_store=get_project_override_store(),
    )


def _make_unit(unit_id: str, dim: Dimension) -> Unit:
    return Unit(id=unit_id, dimension=dim, unit_name="u", description="d")


def _make_basic_dims() -> list[DimensionDecomposition]:
    """Five dims with one unit each — minimum valid for /decompose parse."""
    return [
        DimensionDecomposition(
            dimension=d, insight="i", units=[_make_unit(f"u_{d.value}", d)],
            dimension_status="decomposed",
        )
        for d in Dimension
    ]


def _seed_state_with_dims(project_id: str) -> None:
    state = ThreeBState(
        project_id=project_id,
        raw_intent=RawIntent(prompt="一个少年在废墟里觉醒", genre_primary="玄幻"),
        dimensions=_make_basic_dims(),
        causal_map="x",
        top_level_summary="s",
    )
    atomic_write_state(project_id, state)


# ---------------------------------------------------------------------------
# /meta-decompose endpoint behavior
# ---------------------------------------------------------------------------


def test_meta_decompose_endpoint_writes_override(mock_router):
    """POST /meta-decompose returns the generated prompt AND writes the
    project-level firstness_decompose override so /decompose can read it."""
    engine = _make_engine_with_overrides(mock_router)

    # Stub the LLM router to return a fixed text. invoke_meta_llm then
    # writes the result to the override via PromptOverrideStore.
    mock_router.execute = AsyncMock(
        return_value={"content": "你是一位修仙设定诊断师,专攻灵界天道体系..."}
    )
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/meta-decompose", f"{PROJ_PREFIX}ok"),
        json={
            "prompt": "一个少年在废墟里觉醒,获得阴阳眼",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["generated_prompt"] == "你是一位修仙设定诊断师,专攻灵界天道体系..."
    assert data["written_to_override"] is True

    # Verify the override file actually contains the new system_prompt.
    proj_dir = settings.projects_dir / f"{PROJ_PREFIX}ok"
    override_path = proj_dir / "prompt_overrides.json"
    assert override_path.exists(), f"override file not written at {override_path}"
    payload = json.loads(override_path.read_text(encoding="utf-8"))
    assert "firstness_decompose" in payload
    assert payload["firstness_decompose"]["system_prompt"] == "你是一位修仙设定诊断师,专攻灵界天道体系..."


def test_meta_decompose_failure_returns_503(mock_router):
    engine = _make_engine_with_overrides(mock_router)

    # Router raises — invoke_meta_llm lets it propagate, route catches as 503.
    mock_router.execute = AsyncMock(side_effect=RuntimeError("LLM upstream timeout"))
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/meta-decompose", f"{PROJ_PREFIX}fail"),
        json={"prompt": "一个少年在废墟里觉醒", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert "元提示词生成失败" in detail
    assert "LLM upstream timeout" in detail


def test_meta_decompose_empty_response_returns_422(mock_router):
    engine = _make_engine_with_overrides(mock_router)

    # Router returns empty content — invoke_meta_llm raises ValueError → 422.
    mock_router.execute = AsyncMock(return_value={"content": "   "})
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/meta-decompose", f"{PROJ_PREFIX}empty"),
        json={"prompt": "一个少年在废墟里觉醒", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422
    assert "空文本" in resp.json()["detail"]


def test_meta_decompose_short_prompt_rejected(mock_router):
    """Pydantic min_length=10 on the prompt field — same gate as /decompose."""
    engine = _make_engine_with_overrides(mock_router)
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/meta-decompose", f"{PROJ_PREFIX}short"),
        json={"prompt": "短", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /decompose picks up firstness_decompose override
# ---------------------------------------------------------------------------


def test_subsequent_decompose_reads_meta_override(mock_router):
    """After /meta-decompose writes an override, /decompose must feed it
    to the LLM as system_prompt instead of the YAML default."""
    project_id = f"{PROJ_PREFIX}decomp_after_meta"
    _seed_state_with_dims(project_id)

    engine = _make_engine_with_overrides(mock_router)

    # Step 1: run /meta-decompose to write the override via the real path.
    mock_router.execute = AsyncMock(
        return_value={"content": "## SPECIALIZED-META-PROMPT ##"}
    )
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/meta-decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200, resp.text

    # Step 2: now call /decompose and capture the LLM system message.
    captured: dict[str, Any] = {}

    async def fake_router_execute(*args, **kwargs):
        captured.update(kwargs)
        # Return a valid firstness_decompose JSON shape.
        return {
            "content": json.dumps({
                "dimensions": [
                    {"dimension": d.value, "insight": "i", "units": [
                        {"unit_name": "u", "description": "d"}
                    ]}
                    for d in Dimension
                ],
                "causal_map": "m",
                "top_level_summary": "s",
            })
        }

    mock_router.execute = fake_router_execute  # type: ignore[assignment]

    resp = client.post(
        _route("/decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200, resp.text

    # The router.execute call must have received the meta-generated text
    # as the system message's first entry.
    messages = captured.get("messages", [])
    assert len(messages) >= 1
    assert "## SPECIALIZED-META-PROMPT ##" in messages[0]["content"]


def test_decompose_with_no_override_uses_yaml(mock_router):
    """Fresh project (no prompt_overrides.json) → /decompose uses the YAML."""
    project_id = f"{PROJ_PREFIX}decomp_yaml"
    _seed_state_with_dims(project_id)

    engine = _make_engine_with_overrides(mock_router)

    captured: dict[str, Any] = {}

    async def fake_router_execute(*args, **kwargs):
        captured.update(kwargs)
        return {
            "content": json.dumps({
                "dimensions": [
                    {"dimension": d.value, "insight": "i", "units": [
                        {"unit_name": "u", "description": "d"}
                    ]}
                    for d in Dimension
                ],
                "causal_map": "m",
                "top_level_summary": "s",
            })
        }

    mock_router.execute = fake_router_execute  # type: ignore[assignment]
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200

    # System message must contain the YAML's distinctive "叙事结构诊断师" string.
    messages = captured.get("messages", [])
    assert len(messages) >= 1
    assert "叙事结构诊断师" in messages[0]["content"]


def test_decompose_after_user_edit_uses_edited_prompt(mock_router):
    """The icon-edit flow: write Plaza override with custom text, then
    /decompose must use THAT text (not the meta-generated one or YAML)."""
    project_id = f"{PROJ_PREFIX}decomp_user_edit"
    _seed_state_with_dims(project_id)

    engine = _make_engine_with_overrides(mock_router)

    # Step 1: simulate user icon-edit by writing via the same store
    # the route would call.
    store = get_project_override_store()
    store.set_override(
        project_id,
        "firstness_decompose",
        {"system_prompt": "## USER-EDITED-PROMPT ##"},
    )

    # Step 2: capture router.execute during /decompose.
    captured: dict[str, Any] = {}

    async def fake_router_execute(*args, **kwargs):
        captured.update(kwargs)
        return {
            "content": json.dumps({
                "dimensions": [
                    {"dimension": d.value, "insight": "i", "units": [
                        {"unit_name": "u", "description": "d"}
                    ]}
                    for d in Dimension
                ],
                "causal_map": "m",
                "top_level_summary": "s",
            })
        }

    mock_router.execute = fake_router_execute  # type: ignore[assignment]
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200, resp.text

    messages = captured.get("messages", [])
    assert len(messages) >= 1
    assert "## USER-EDITED-PROMPT ##" in messages[0]["content"]


def test_regenerate_does_not_call_meta(mock_router):
    """POST /decompose alone must not call invoke_meta_llm — meta is only
    triggered by the S1→S2 forward transition's /meta-decompose call."""
    project_id = f"{PROJ_PREFIX}no_meta_on_regen"
    _seed_state_with_dims(project_id)

    engine = _make_engine_with_overrides(mock_router)
    meta_called = []

    async def fake_router_execute(*args, **kwargs):
        return {
            "content": json.dumps({
                "dimensions": [
                    {"dimension": d.value, "insight": "i", "units": [
                        {"unit_name": "u", "description": "d"}
                    ]}
                    for d in Dimension
                ],
                "causal_map": "m",
                "top_level_summary": "s",
            })
        }

    # Track meta-LLM calls (task_name=meta_decompose is the marker).
    original_execute = fake_router_execute

    async def tracking_router_execute(*args, **kwargs):
        if kwargs.get("task_name") == "meta_decompose":
            meta_called.append(kwargs.get("task_name"))
        return await original_execute(*args, **kwargs)

    mock_router.execute = tracking_router_execute  # type: ignore[assignment]
    app.state.three_b_engine = engine

    resp = client.post(
        _route("/decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200, resp.text
    assert meta_called == [], (
        "invoke_meta_llm must NOT fire on /decompose — only /meta-decompose "
        "triggers it. Captured calls: " + repr(meta_called)
    )
