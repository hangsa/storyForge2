"""Tests for /b3/meta-decompose + invoke_meta_llm + override behavior.

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
from backend.creative_os.b3_engine import (
    RawIntent,
    B3Engine,
    B3State,
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
BASE = "/api/v1/projects/{project_id}/creative/diverge/b3"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    reset_project_override_store()
    yield tmp_path
    reset_project_override_store()


@pytest.fixture(autouse=True)
def _reset_engine_state():
    yield
    if hasattr(app.state, "b3_engine"):
        del app.state.b3_engine


@pytest.fixture
def mock_router():
    return AsyncMock()


def _route(path: str, project_id: str) -> str:
    return BASE.format(project_id=project_id) + path


def _make_engine_with_overrides(mock_router: AsyncMock) -> B3Engine:
    """Engine wired to the real PromptOverrideStore (per-project file at tmp_path)."""
    return B3Engine(
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
    state = B3State(
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
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

    resp = client.post(
        _route("/meta-decompose", f"{PROJ_PREFIX}empty"),
        json={"prompt": "一个少年在废墟里觉醒", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422
    assert "空文本" in resp.json()["detail"]


def test_meta_decompose_short_prompt_rejected(mock_router):
    """Pydantic min_length=10 on the prompt field — same gate as /decompose."""
    engine = _make_engine_with_overrides(mock_router)
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

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
    app.state.b3_engine = engine

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


def test_meta_decompose_strips_think_block_before_saving_override(mock_router):
    """Regression proj_4e6f888f 2026-09-13: MiniMax-M3-style reasoning model
    wraps the meta-prompt output inside <think>...</think>. invoke_meta_llm
    MUST strip the think block BEFORE writing the project override, or the
    next /decompose call loads a polluted system_prompt and 422s.

    Without the strip, this test sees `system_prompt` containing the literal
    `<think>` opener; with the strip, only the post-think Chinese prose lands
    in the override file and the endpoint echoes the clean text back.
    """
    project_id = f"{PROJ_PREFIX}think_strip"
    engine = _make_engine_with_overrides(mock_router)

    clean_prompt = "## 第一性拆解提示词：修真 · 灵界\n\n按四步法执行..."
    polluted_response = (
        "<think>The user wants a 5-dim deconstruction prompt. "
        "Let me analyze the creative idea first... "
        "Setting types: 宇宙观/天道体系, 力量体系, 势力结构, 主角超常规, 结局. "
        "Now drafting the actual prompt.</think>\n"
        + clean_prompt
    )
    mock_router.execute = AsyncMock(return_value={"content": polluted_response})
    app.state.b3_engine = engine

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
    data = resp.json()
    # Endpoint echoes the clean text (post-strip), not the raw LLM response.
    assert data["generated_prompt"] == clean_prompt
    assert "<think>" not in data["generated_prompt"]

    # And the on-disk override is clean — that's the whole point of the
    # strip at write time: subsequent /decompose loads this as system_prompt.
    override_path = settings.projects_dir / project_id / "prompt_overrides.json"
    payload = json.loads(override_path.read_text(encoding="utf-8"))
    saved_prompt = payload["firstness_decompose"]["system_prompt"]
    assert saved_prompt == clean_prompt
    assert "<think>" not in saved_prompt


def test_meta_decompose_empty_after_think_strip_returns_422(mock_router):
    """If the think block consumes the entire response (model thinks but
    never produces a real prompt), invoke_meta_llm must raise → 422, NOT
    silently save an empty override that crashes the next /decompose.
    """
    project_id = f"{PROJ_PREFIX}think_only"
    engine = _make_engine_with_overrides(mock_router)

    mock_router.execute = AsyncMock(
        return_value={"content": "<think>just thinking, never produced the prompt</think>"}
    )
    app.state.b3_engine = engine

    resp = client.post(
        _route("/meta-decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "",
            "style": "",
        },
    )
    assert resp.status_code == 422, resp.text
    assert "空文本" in resp.json()["detail"]


# ── Regression: decompose schema-invalid response retry ────────────────
#
# proj_4e6f888f 2026-09-13: after MiniMax-M3 timed out 3×, the router
# fell back to deepseek-v4-flash. The fallback returned parseable JSON
# but `{"dimensions": []}` — empty schema. The router's retry logic
# only fires on network/transport errors, NOT on schema-invalid output,
# so the user got 422 "LLM 返回 0 维度,需 5". The engine's `decompose()`
# now retries the whole router.execute once when _parse_decompose_output
# raises — a second shot at the fallback model (or a fresh attempt on
# the primary if it recovers).


def test_decompose_retries_on_schema_invalid_response(mock_router):
    """Fallback model returns parseable JSON but degenerate `dimensions: []`.
    Engine must retry the router once and accept the second response.
    Without the retry, user sees 422 「0 维度」.
    """
    project_id = f"{PROJ_PREFIX}schema_retry"
    _seed_state_with_dims(project_id)
    engine = _make_engine_with_overrides(mock_router)

    valid_dims_payload = {
        "dimensions": [
            {"dimension": d, "insight": f"insight-{d}", "units": []}
            for d in ("ontology", "energetics", "power_structure", "protagonist_engine", "narrative_physics")
        ],
        "causal_map": "cm",
        "top_level_summary": "ts",
    }
    import json as _json

    call_log: list[str] = []

    async def stub_execute(*args, **kwargs):
        # First call returns degenerate schema, second returns valid.
        call_log.append(kwargs.get("task_name") or args[2] if len(args) > 2 else "?")
        if len(call_log) == 1:
            return {
                "content": _json.dumps({"dimensions": [], "causal_map": "", "top_level_summary": ""}),
                "model": "deepseek-v4-flash",
            }
        return {
            "content": _json.dumps(valid_dims_payload),
            "model": "deepseek-v4-flash",
        }

    mock_router.execute = stub_execute
    app.state.b3_engine = engine

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
    body = resp.json()
    assert len(body["dimensions"]) == 5
    # Exactly 2 router calls: degenerate attempt + recovery attempt.
    assert len(call_log) == 2


def test_decompose_raises_after_two_schema_invalid_responses(mock_router):
    """If both attempts return degenerate output, surface the schema error
    to the user rather than retrying forever. With 2 attempts we accept
    either a successful retry or a ValueError; we MUST NOT infinite-loop.
    """
    project_id = f"{PROJ_PREFIX}schema_retry_exhaust"
    _seed_state_with_dims(project_id)
    engine = _make_engine_with_overrides(mock_router)

    import json as _json

    call_count = {"n": 0}

    async def stub_execute(*args, **kwargs):
        call_count["n"] += 1
        return {
            "content": _json.dumps({"dimensions": [], "causal_map": "", "top_level_summary": ""}),
            "model": "deepseek-v4-flash",
        }

    mock_router.execute = stub_execute
    app.state.b3_engine = engine

    resp = client.post(
        _route("/decompose", project_id),
        json={
            "prompt": "一个少年在废墟里觉醒",
            "genre_primary": "玄幻",
            "tone": "",
            "style": "",
        },
    )
    assert resp.status_code == 422, resp.text
    assert "0 维度" in resp.json()["detail"]
    # Exactly 2 calls — engine did NOT loop forever.
    assert call_count["n"] == 2


# ── Regression: meta_decompose.yaml must enforce canonical 5-dim schema ─
#
# proj_4e6f888f 2026-09-13: the meta prompt asked for "Markdown format with
# 已有基本组件/逻辑缺口", the LLM faithfully generated a 6-dim Chinese schema,
# and every subsequent /decompose call timed out ×3 then fell back to
# deepseek-v4-flash which also returned degenerate JSON → user waited 5-7
# minutes per click for a 422/503. Fix: the meta prompt must require the
# LLM to embed the canonical 5-dim JSON template verbatim in its output.


def test_meta_decompose_yaml_enforces_canonical_schema():
    """Regression guard: meta_decompose.yaml system_prompt must include the
    canonical 5-dim JSON template + explicit anti-6-dim / anti-Chinese
    warnings. This is a YAML-content test (not a behavior test) — it pins
    the prompt instructions so a future edit can't silently drop them.
    """
    from pathlib import Path
    import yaml

    yaml_path = (
        Path(__file__).parent.parent
        / "prompts"
        / "creative"
        / "meta_decompose.yaml"
    )
    with open(yaml_path, encoding="utf-8") as f:
        prompt_data = yaml.safe_load(f)

    system = prompt_data["system_prompt"]

    # All 5 canonical dimension names must be present in the meta prompt
    # so the meta-LLM has them when drafting the specialized prompt.
    for dim in (
        "ontology",
        "energetics",
        "power_structure",
        "protagonist_engine",
        "narrative_physics",
    ):
        assert dim in system, (
            f"meta_decompose.yaml missing canonical dimension '{dim}' — "
            f"meta-LLM will not know to enforce this schema"
        )

    # Anti-6-dim warning (chinese「6 维」 / 「第 6」 or English "6th" / "6 dimensions").
    assert (
        "第 6" in system or "6 维" in system or "6 dimensions" in system.lower()
    ), "meta_decompose.yaml must warn against adding a 6th dimension"

    # Anti-Chinese-dim warning.
    assert (
        "中文" in system and ("维度名" in system or "enum" in system.lower())
    ), (
        "meta_decompose.yaml must warn against Chinese dimension names "
        "(backend parses against the English enum)"
    )
